-- Posicao individual baseada na mesma ordem e elegibilidade do despacho.
alter table public.drivers add column if not exists queue_paused boolean not null default false;
alter table public.drivers add column if not exists queue_entered_at timestamptz;
-- A entrada anterior à migração não pode ser reconstruída com precisão.

update public.system_settings
set value = value || jsonb_build_object('pause_return', coalesce(value ->> 'pause_return', 'end'),
  'queue_alert_positions', coalesce(value -> 'queue_alert_positions', '[3,2,1]'::jsonb))
where key = 'dispatch';

create or replace function private.track_driver_queue_entry()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.online and not old.online then
    new.queue_paused := false;
    new.dispatch_order := nextval('public.driver_dispatch_order_seq');
  elsif new.on_shift and not old.on_shift and new.available then
    new.dispatch_order := nextval('public.driver_dispatch_order_seq');
  end if;
  if new.queue_paused then new.available := false; end if;
  if new.online and new.available and new.on_shift and not new.queue_paused
    and (not old.online or not old.available or not old.on_shift or old.queue_paused) then
    new.queue_entered_at := now();
  end if;
  return new;
end;
$$;
revoke all on function private.track_driver_queue_entry() from public;
drop trigger if exists track_driver_queue_entry on public.drivers;
create trigger track_driver_queue_entry before update on public.drivers
for each row execute function private.track_driver_queue_entry();

-- Serializa o aceite com a pausa, inclusive no instante em que a oferta expira.
create or replace function private.prevent_paused_ride_accept()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  current_driver public.drivers;
begin
  if new.status = 'aceita' and old.status = 'procurando_motorista' and new.driver_id is not null then
    select * into current_driver from public.drivers where profile_id = new.driver_id for update;
    if current_driver.profile_id is null or current_driver.queue_paused or not current_driver.online
      or not current_driver.available or not current_driver.on_shift then
      raise exception 'Motorista indisponível para aceitar esta corrida.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_paused_ride_accept() from public;
drop trigger if exists verify_queue_pause_on_accept on public.rides;
create trigger verify_queue_pause_on_accept before update of status on public.rides
for each row execute function private.prevent_paused_ride_accept();

create or replace function public.driver_queue_snapshot(p_driver_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  own_driver public.drivers;
  queue_status text;
  queue_position integer;
  queue_total integer;
  return_policy text;
begin
  select * into own_driver from public.drivers where profile_id = p_driver_id;
  if own_driver.profile_id is null then return null; end if;
  select coalesce(value ->> 'pause_return', 'end') into return_policy
  from public.system_settings where key = 'dispatch';
  if own_driver.approval_status <> 'approved'
    or exists (select 1 from public.profiles p where p.id = p_driver_id and p.blocked) then
    queue_status := 'suspended';
  elsif not own_driver.online then queue_status := 'offline';
  elsif exists (select 1 from public.rides r where r.driver_id = p_driver_id and r.status not in ('finalizada','cancelada')) then
    queue_status := 'on_ride';
  elsif exists (select 1 from public.ride_requests rr where rr.driver_id = p_driver_id and rr.status = 'pending' and rr.expires_at > now()) then
    queue_status := 'offer';
  elsif own_driver.queue_paused then queue_status := 'paused';
  elsif not own_driver.on_shift or not own_driver.available then queue_status := 'unavailable';
  elsif not exists (select 1 from public.vehicles v where v.driver_id = p_driver_id and v.active) then
    queue_status := 'unavailable';
  else queue_status := 'queued';
  end if;

  with eligible as (
    select d.profile_id, d.dispatch_order from public.drivers d
    join public.profiles p on p.id = d.profile_id
    where d.approval_status = 'approved' and d.online and d.available and d.on_shift
      and not d.queue_paused and not p.blocked
      and exists (select 1 from public.vehicles v where v.driver_id = d.profile_id and v.active)
      and not exists (select 1 from public.rides r where r.driver_id = d.profile_id and r.status not in ('finalizada','cancelada'))
      and not exists (select 1 from public.ride_requests rr where rr.driver_id = d.profile_id and rr.status = 'pending' and rr.expires_at > now())
  ), ranked as (
    select profile_id, row_number() over (order by dispatch_order, profile_id)::integer as position from eligible
  )
  select (select count(*)::integer from eligible),
    (select position from ranked where profile_id = p_driver_id)
  into queue_total, queue_position;

  return jsonb_build_object('status', queue_status,
    'position', case when queue_status = 'queued' then queue_position else null end,
    'ahead', case when queue_status = 'queued' then queue_position - 1 else null end,
    'total', queue_total, 'enteredAt', own_driver.queue_entered_at,
    'updatedAt', now(), 'returnPolicy', coalesce(return_policy, 'end'));
end;
$$;
revoke all on function public.driver_queue_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.driver_queue_snapshot(uuid) to service_role;

create or replace function public.set_driver_queue_paused(p_driver_id uuid, p_paused boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  own_driver public.drivers;
  return_policy text;
begin
  select * into own_driver from public.drivers where profile_id = p_driver_id for update;
  if own_driver.profile_id is null then raise exception 'Motorista não encontrado.'; end if;
  perform 1 from public.system_settings where key = 'dispatch' for update;
  select coalesce(value ->> 'pause_return', 'end') into return_policy
  from public.system_settings where key = 'dispatch';
  if not own_driver.online or not own_driver.on_shift or own_driver.approval_status <> 'approved'
    or exists (select 1 from public.profiles p where p.id = p_driver_id and p.blocked) then
    raise exception 'Fique online e aprovado para alterar sua pausa.';
  end if;
  if exists (select 1 from public.rides r where r.driver_id = p_driver_id and r.status not in ('finalizada','cancelada'))
    or exists (select 1 from public.ride_requests rr where rr.driver_id = p_driver_id and rr.status = 'pending' and rr.expires_at > now()) then
    raise exception 'Responda à oferta ou conclua a corrida antes de alterar a pausa.';
  end if;
  if not p_paused and not exists (select 1 from public.vehicles v where v.driver_id = p_driver_id and v.active) then
    raise exception 'Cadastre uma moto ativa para voltar à fila.';
  end if;
  if own_driver.queue_paused is distinct from p_paused then
    update public.drivers set queue_paused = p_paused, available = not p_paused,
      dispatch_order = case when not p_paused and coalesce(return_policy, 'end') = 'end'
        then nextval('public.driver_dispatch_order_seq') else dispatch_order end
    where profile_id = p_driver_id;
  end if;
  return public.driver_queue_snapshot(p_driver_id);
end;
$$;
revoke all on function public.set_driver_queue_paused(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_driver_queue_paused(uuid, boolean) to service_role;

create table if not exists public.driver_queue_alert_state (
  driver_id uuid primary key references public.drivers(profile_id) on delete cascade,
  status text not null default 'offline',
  position integer,
  alerted_positions integer[] not null default '{}'::integer[],
  updated_at timestamptz not null default now()
);
alter table public.driver_queue_alert_state add column if not exists alerted_positions integer[] not null default '{}'::integer[];
revoke all on public.driver_queue_alert_state from public, anon, authenticated;
grant select, insert, update on public.driver_queue_alert_state to service_role;

create or replace function public.observe_driver_queue(p_driver_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  snapshot jsonb;
  previous public.driver_queue_alert_state;
  current_status text;
  current_position integer;
  alert_positions jsonb;
  alert_type text;
  alert_title text;
  alert_body text;
  notification_id uuid;
begin
  insert into public.driver_queue_alert_state(driver_id) values (p_driver_id) on conflict do nothing;
  select * into previous from public.driver_queue_alert_state where driver_id = p_driver_id for update;
  snapshot := public.driver_queue_snapshot(p_driver_id);
  current_status := snapshot ->> 'status';
  current_position := (snapshot ->> 'position')::integer;
  select coalesce(value -> 'queue_alert_positions', '[3,2,1]'::jsonb)
    into alert_positions from public.system_settings where key = 'dispatch';
  if current_status = 'queued' then
    if previous.status <> 'queued' then
      alert_type := 'queue.joined';
      alert_title := case when previous.status = 'on_ride' then 'Você voltou para a fila' else 'Você entrou na fila' end;
      alert_body := format('Sua posição atual é %sº.', current_position);
    elsif current_position < previous.position and alert_positions @> to_jsonb(current_position)
      and not current_position = any(previous.alerted_positions) then
      alert_type := 'queue.advanced';
      alert_title := case current_position when 1 then 'Você é o próximo!' when 2 then 'Fique atento' else 'Fila avançou' end;
      alert_body := case current_position when 1 then 'Fique disponível. A próxima corrida elegível poderá ser oferecida a você.'
        when 2 then 'Você está em 2º lugar.' else format('Você agora está em %sº lugar.', current_position) end;
    end if;
  end if;
  if alert_type is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (p_driver_id, alert_type, alert_title, alert_body, jsonb_build_object('position', current_position))
    returning id into notification_id;
  end if;
  update public.driver_queue_alert_state set status = current_status, position = current_position,
    alerted_positions = case
      when current_status <> 'queued' then '{}'::integer[]
      when previous.status <> 'queued' then case when alert_positions @> to_jsonb(current_position)
        then array[current_position] else '{}'::integer[] end
      when alert_type = 'queue.advanced' then array_append(previous.alerted_positions, current_position)
      else previous.alerted_positions end,
    updated_at = now()
  where driver_id = p_driver_id;
  return snapshot || jsonb_build_object('notificationId', notification_id);
end;
$$;
revoke all on function public.observe_driver_queue(uuid) from public, anon, authenticated;
grant execute on function public.observe_driver_queue(uuid) to service_role;

create or replace function private.notify_new_offer()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications(user_id, type, title, body, data)
  values (new.driver_id, 'ride.offer', 'Nova corrida',
    format('É a sua vez. Você tem %s segundos para responder.', greatest(1, ceil(extract(epoch from new.expires_at - now()))::integer)),
    jsonb_build_object('rideId', new.ride_id, 'offerId', new.id));
  return new;
end;
$$;
revoke all on function private.notify_new_offer() from public;
