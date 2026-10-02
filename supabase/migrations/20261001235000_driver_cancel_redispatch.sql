-- Keep the passenger's original request when a driver withdraws before boarding.
alter table public.rides add column if not exists redispatch_started_at timestamptz;
alter table public.rides add column if not exists early_end_reason text;
alter table public.rides add column if not exists early_end_at timestamptz;

create or replace function private.validate_ride_transition()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = new.status then return new; end if;
  if not (
    (old.status = 'solicitada' and new.status in ('procurando_motorista','cancelada')) or
    (old.status = 'procurando_motorista' and new.status in ('aceita','cancelada')) or
    (old.status = 'aceita' and new.status in ('motorista_a_caminho','cancelada')) or
    (old.status = 'motorista_a_caminho' and new.status in ('motorista_chegou','cancelada')) or
    (old.status = 'motorista_chegou' and new.status in ('em_corrida','cancelada')) or
    (old.status = 'em_corrida' and new.status = 'finalizada') or
    (old.status in ('aceita','motorista_a_caminho','motorista_chegou')
      and new.status = 'procurando_motorista' and old.driver_id is not null
      and new.driver_id is null and new.redispatch_started_at is not null)
  ) then raise exception 'Transição de corrida inválida: % -> %', old.status, new.status using errcode = '22023'; end if;
  return new;
end;
$$;

create or replace function private.require_verified_arrival_for_no_show()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'cancelada' and new.termination_code = 'no_show'
    and (old.status <> 'motorista_chegou' or not old.arrival_verified
      or old.arrival_server_at is null) then
    raise exception 'Ausencia exige chegada verificada pelo GPS.' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists require_verified_arrival_for_no_show on public.rides;
create trigger require_verified_arrival_for_no_show before update of status on public.rides
for each row execute function private.require_verified_arrival_for_no_show();

create table if not exists public.ride_driver_cancellations (
  id bigint generated always as identity primary key,
  ride_id uuid not null references public.rides(id) on delete cascade,
  driver_id uuid not null references public.drivers(profile_id),
  passenger_id uuid not null references public.passengers(profile_id),
  previous_status public.ride_status not null,
  reason_code text not null check (reason_code in
    ('mechanical','personal','cannot_reach','unsafe','passenger_requested','address','other')),
  reason_text text not null,
  accepted_at timestamptz,
  arrived_at timestamptz,
  cancelled_at timestamptz not null default now(),
  gps_lat double precision,
  gps_lng double precision,
  gps_accuracy_meters numeric,
  gps_recorded_at timestamptz,
  next_driver_id uuid references public.drivers(profile_id),
  next_accepted_at timestamptz,
  unique (ride_id, driver_id)
);
create index if not exists ride_driver_cancellations_time_idx
  on public.ride_driver_cancellations(cancelled_at desc);
create index if not exists ride_driver_cancellations_driver_idx
  on public.ride_driver_cancellations(driver_id, cancelled_at desc);
alter table public.ride_driver_cancellations enable row level security;
revoke all on public.ride_driver_cancellations from public, anon, authenticated;
grant select, insert, update on public.ride_driver_cancellations to service_role;
grant usage, select on sequence public.ride_driver_cancellations_id_seq to service_role;

create or replace view public.driver_cancellation_metrics with (security_invoker = true) as
select driver.profile_id as driver_id,
  coalesce(accepted.total,0)::integer as accepted,
  coalesce(completed.total,0)::integer as completed,
  coalesce(cancelled.total,0)::integer as cancelled,
  case when coalesce(accepted.total,0) = 0 then 0
    else round(100.0 * coalesce(cancelled.total,0) / accepted.total)::integer end as cancellation_rate
from public.drivers driver
left join (select actor_id,count(*) as total from public.ride_history
  where to_status = 'aceita' group by actor_id) accepted on accepted.actor_id = driver.profile_id
left join (select driver_id,count(*) as total from public.rides
  where status = 'finalizada' group by driver_id) completed on completed.driver_id = driver.profile_id
left join (select driver_id,count(*) as total from public.ride_driver_cancellations
  group by driver_id) cancelled on cancelled.driver_id = driver.profile_id;
revoke all on public.driver_cancellation_metrics from public,anon,authenticated;
grant select on public.driver_cancellation_metrics to service_role;

create or replace function private.link_redispatched_driver()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status = 'aceita' and old.status = 'procurando_motorista' and new.driver_id is not null then
    update public.ride_driver_cancellations
    set next_driver_id = new.driver_id, next_accepted_at = now()
    where id = (select id from public.ride_driver_cancellations
      where ride_id = new.id and next_driver_id is null order by id desc limit 1);
  end if;
  return new;
end;
$$;
revoke all on function private.link_redispatched_driver() from public;
drop trigger if exists link_redispatched_driver on public.rides;
create trigger link_redispatched_driver after update of status on public.rides
for each row execute function private.link_redispatched_driver();

create or replace function public.driver_cancel_and_redispatch(
  p_ride_id uuid, p_driver_id uuid, p_reason_code text, p_reason_text text
)
returns public.rides language plpgsql security invoker set search_path = '' as $$
declare
  current_ride public.rides;
  changed public.rides;
  current_location public.driver_locations;
  cancellation_id bigint;
  offered_driver uuid;
begin
  select * into current_ride from public.rides where id = p_ride_id for update;
  if current_ride.id is null then return null; end if;
  -- A delayed retry from a former driver may not touch a later assignment.
  if exists (select 1 from public.ride_driver_cancellations
    where ride_id = p_ride_id and driver_id = p_driver_id) then return current_ride; end if;
  if current_ride.driver_id is distinct from p_driver_id or
    current_ride.status not in ('aceita','motorista_a_caminho','motorista_chegou') or
    p_reason_code not in ('mechanical','personal','cannot_reach','unsafe','passenger_requested','address','other') or
    nullif(trim(p_reason_text),'') is null or length(p_reason_text) > 300 then return null; end if;

  select * into current_location from public.driver_locations where driver_id = p_driver_id;
  insert into public.ride_driver_cancellations(ride_id,driver_id,passenger_id,previous_status,
    reason_code,reason_text,accepted_at,arrived_at,gps_lat,gps_lng,gps_accuracy_meters,gps_recorded_at)
  values (p_ride_id,p_driver_id,current_ride.passenger_id,current_ride.status,
    p_reason_code,trim(p_reason_text),current_ride.accepted_at,current_ride.arrived_at,
    current_location.latitude,current_location.longitude,current_location.accuracy_meters,current_location.updated_at)
  returning id into cancellation_id;

  update public.rides set status = 'procurando_motorista', driver_id = null, vehicle_id = null,
    accepted_at = null, arrived_at = null, arrival_server_at = null, arrival_verified = false,
    queue_reserved_at = null, queue_reserved_order = null, redispatch_started_at = now()
  where id = p_ride_id and driver_id = p_driver_id and status = current_ride.status
  returning * into changed;
  if changed.id is null then raise exception 'Corrida mudou durante o cancelamento.'; end if;

  update public.ride_requests set status = 'expired', responded_at = coalesce(responded_at,now())
  where ride_id = p_ride_id and status = 'pending';
  update public.driver_locations set ride_id = null where driver_id = p_driver_id and ride_id = p_ride_id;
  delete from public.ride_approach_points where ride_id = p_ride_id and driver_id = p_driver_id;
  update public.drivers driver set available = true
  where profile_id = p_driver_id and approval_status = 'approved' and online and on_shift
    and not queue_paused and not exists (select 1 from public.rides active_ride
      where active_ride.driver_id = p_driver_id and active_ride.status not in ('finalizada','cancelada'));

  insert into public.ride_history(ride_id,from_status,to_status,actor_id,metadata)
  values (p_ride_id,current_ride.status,'procurando_motorista',p_driver_id,
    jsonb_build_object('event','driver_cancelled','cancellationId',cancellation_id,
      'reasonCode',p_reason_code,'reason',trim(p_reason_text)));
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values (p_driver_id,'ride.driver_cancelled','ride',p_ride_id::text,
    jsonb_build_object('cancellationId',cancellation_id,'previousStatus',current_ride.status,
      'reasonCode',p_reason_code));
  insert into public.notifications(user_id,type,title,body,data) values
    (current_ride.passenger_id,'ride.driver_cancelled','Procurando outro motorista',
      'O motorista precisou cancelar. Estamos procurando outro motorista para você.',
      jsonb_build_object('rideId',p_ride_id,'cancellationId',cancellation_id)),
    (p_driver_id,'ride.driver_cancelled','Corrida cancelada',
      'A corrida foi retirada da sua tela e voltou para a distribuição.',
      jsonb_build_object('rideId',p_ride_id,'cancellationId',cancellation_id));
  offered_driver := public.dispatch_next_offer(p_ride_id);
  return changed;
end;
$$;
revoke all on function public.driver_cancel_and_redispatch(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.driver_cancel_and_redispatch(uuid,uuid,text,text) to service_role;

create or replace function public.end_ride_early(p_ride_id uuid,p_driver_id uuid,p_reason text)
returns public.rides language plpgsql security invoker set search_path = '' as $$
declare current_ride public.rides; changed public.rides;
begin
  select * into current_ride from public.rides where id = p_ride_id for update;
  if current_ride.id is null or current_ride.driver_id is distinct from p_driver_id then return null; end if;
  if current_ride.status = 'finalizada' and current_ride.early_end_at is not null then return current_ride; end if;
  if current_ride.status <> 'em_corrida' or nullif(trim(p_reason),'') is null
    or length(p_reason) > 300 then return null; end if;
  changed := public.finish_ride(p_ride_id,p_driver_id);
  if changed.id is null then return null; end if;
  update public.rides set early_end_reason = trim(p_reason), early_end_at = now()
  where id = p_ride_id returning * into changed;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values (p_driver_id,'ride.ended_early','ride',p_ride_id::text,
    jsonb_build_object('reason',trim(p_reason)));
  insert into public.notifications(user_id,type,title,body,data)
  values (changed.passenger_id,'ride.ended_early','Viagem encerrada antecipadamente',
    'O motorista encerrou a viagem antes do destino. Confira os detalhes e procure o suporte se necessário.',
    jsonb_build_object('rideId',p_ride_id,'reason',trim(p_reason)));
  return changed;
end;
$$;
revoke all on function public.end_ride_early(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.end_ride_early(uuid,uuid,text) to service_role;

-- An unassigned redispatched ride remains searchable for a bounded period.
create or replace function public.expire_ride_searches(p_ride_id uuid default null)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  searching record;
  changed_count integer := 0;
  offer_count_before integer;
begin
  for searching in
    select ride.id, ride.passenger_id, ride.redispatch_started_at
    from public.rides ride
    where ride.status = 'procurando_motorista' and ride.driver_id is null
      and (p_ride_id is null or ride.id = p_ride_id)
      and exists (select 1 from public.ride_requests request where request.ride_id = ride.id)
    for update of ride skip locked
  loop
    select count(*) into offer_count_before from public.ride_requests where ride_id = searching.id;
    if public.dispatch_next_offer(searching.id) is not null then
      if (select count(*) from public.ride_requests where ride_id = searching.id) > offer_count_before then
        changed_count := changed_count + 1;
      end if;
      continue;
    end if;
    if searching.redispatch_started_at is not null and
      now() < searching.redispatch_started_at + interval '5 minutes' then continue; end if;
    update public.rides set status = 'cancelada', cancelled_at = now(),
      cancellation_reason = 'Nenhum motorista elegivel aceitou a solicitacao.'
    where id = searching.id and status = 'procurando_motorista';
    update public.passenger_locations set ride_id = null
    where passenger_id = searching.passenger_id and ride_id = searching.id;
    insert into public.ride_history(ride_id,from_status,to_status,metadata)
    values (searching.id,'procurando_motorista','cancelada',jsonb_build_object('reason','no_driver_found'));
    insert into public.notifications(user_id,type,title,body,data)
    values (searching.passenger_id,'ride.no_driver_found','Nenhum motorista disponível',
      'Nenhum outro motorista aceitou a corrida. Você pode tentar novamente.',
      jsonb_build_object('rideId',searching.id));
    changed_count := changed_count + 1;
  end loop;
  return changed_count;
end;
$$;
revoke all on function public.expire_ride_searches(uuid) from public,anon,authenticated;
grant execute on function public.expire_ride_searches(uuid) to service_role;
