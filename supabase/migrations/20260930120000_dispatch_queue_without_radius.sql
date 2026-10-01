-- O despacho segue a fila de cadastro/rodizio, sem usar distancia ou GPS.
-- Migration incremental: preserva corridas e cadastros existentes.

create sequence if not exists public.driver_dispatch_order_seq;
alter table public.drivers add column if not exists dispatch_order bigint;
alter table public.drivers add column if not exists on_shift boolean not null default true;

with ordered as (
  select profile_id, row_number() over (order by created_at, profile_id) as queue_position
  from public.drivers
  where dispatch_order is null
), base as (
  select coalesce(max(dispatch_order), 0) as last_position from public.drivers
)
update public.drivers driver
set dispatch_order = base.last_position + ordered.queue_position
from ordered, base
where driver.profile_id = ordered.profile_id;

select setval('public.driver_dispatch_order_seq',
  greatest(1, coalesce((select max(dispatch_order) from public.drivers), 0)),
  (select count(*) > 0 from public.drivers));
alter table public.drivers alter column dispatch_order set default nextval('public.driver_dispatch_order_seq');
alter table public.drivers alter column dispatch_order set not null;
create unique index if not exists drivers_dispatch_order_idx on public.drivers(dispatch_order);
revoke all on sequence public.driver_dispatch_order_seq from public, anon, authenticated;
grant usage, select on sequence public.driver_dispatch_order_seq to service_role;

update public.system_settings
set value = (value - 'initial_radius_km' - 'max_radius_km') || jsonb_build_object('mode', 'round_robin')
where key = 'dispatch';

create or replace function public.dispatch_next_offer(p_ride_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_ride public.rides;
  selected_driver uuid;
  offer_seconds integer := 20;
begin
  select * into target_ride from public.rides where id = p_ride_id for update;
  if target_ride.id is null or target_ride.status <> 'procurando_motorista' or target_ride.driver_id is not null then
    return null;
  end if;

  -- Uma unica linha bloqueada serializa selecoes concorrentes da fila.
  perform 1 from public.system_settings where key = 'dispatch' for update;
  select greatest(15, least(90, coalesce((value ->> 'offer_seconds')::integer, 20)))
    into offer_seconds from public.system_settings where key = 'dispatch';
  offer_seconds := coalesce(offer_seconds, 20);

  update public.ride_requests
  set status = 'expired', responded_at = coalesce(responded_at, now())
  where ride_id = p_ride_id and status = 'pending'
    and (expires_at <= now() or not exists (
      select 1 from public.drivers driver
      join public.profiles profile on profile.id = driver.profile_id
      where driver.profile_id = public.ride_requests.driver_id
        and driver.approval_status = 'approved'
        and driver.online and driver.available and driver.on_shift and not profile.blocked
        and exists (select 1 from public.vehicles vehicle where vehicle.driver_id = driver.profile_id and vehicle.active)
        and not exists (select 1 from public.rides active_ride where active_ride.driver_id = driver.profile_id and active_ride.status not in ('finalizada', 'cancelada'))
    ));

  select driver_id into selected_driver
  from public.ride_requests
  where ride_id = p_ride_id and status = 'pending' and expires_at > now()
  limit 1;
  if selected_driver is not null then return selected_driver; end if;

  select driver.profile_id into selected_driver
  from public.drivers driver
  join public.profiles profile on profile.id = driver.profile_id
  where driver.approval_status = 'approved'
    and driver.online and driver.available and driver.on_shift and not profile.blocked
    and exists (select 1 from public.vehicles vehicle where vehicle.driver_id = driver.profile_id and vehicle.active)
    and not exists (select 1 from public.rides active_ride where active_ride.driver_id = driver.profile_id and active_ride.status not in ('finalizada', 'cancelada'))
    and not exists (select 1 from public.ride_requests previous where previous.ride_id = p_ride_id and previous.driver_id = driver.profile_id)
    and not exists (select 1 from public.ride_requests pending where pending.driver_id = driver.profile_id and pending.status = 'pending' and pending.expires_at > now())
  order by driver.dispatch_order, driver.profile_id
  limit 1;

  if selected_driver is null then return null; end if;
  insert into public.ride_requests(ride_id, driver_id, expires_at)
  values (p_ride_id, selected_driver, now() + make_interval(secs => offer_seconds));
  return selected_driver;
end;
$$;
revoke all on function public.dispatch_next_offer(uuid) from public, anon, authenticated;
grant execute on function public.dispatch_next_offer(uuid) to service_role;

create or replace function private.advance_driver_dispatch_queue()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'aceita' and old.status = 'procurando_motorista' and new.driver_id is not null then
    perform 1 from public.system_settings where key = 'dispatch' for update;
    update public.drivers
    set dispatch_order = nextval('public.driver_dispatch_order_seq')
    where profile_id = new.driver_id;
  end if;
  return new;
end;
$$;
revoke all on function private.advance_driver_dispatch_queue() from public, anon, authenticated;
drop trigger if exists advance_driver_dispatch_queue on public.rides;
create trigger advance_driver_dispatch_queue
after update of status on public.rides
for each row execute function private.advance_driver_dispatch_queue();

create or replace function public.accept_ride(p_ride_id uuid, p_driver_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed integer;
  selected_vehicle uuid;
begin
  select id into selected_vehicle
  from public.vehicles
  where driver_id = p_driver_id and active
  order by created_at desc limit 1;
  if selected_vehicle is null then return false; end if;

  update public.rides
  set driver_id = p_driver_id, vehicle_id = selected_vehicle,
      status = 'aceita', accepted_at = now()
  where id = p_ride_id and status = 'procurando_motorista' and driver_id is null
    and exists (
      select 1 from public.ride_requests request
      where request.ride_id = p_ride_id and request.driver_id = p_driver_id
        and request.status = 'pending' and request.expires_at > now()
    )
    and exists (
      select 1 from public.drivers driver
      join public.profiles profile on profile.id = driver.profile_id
      where driver.profile_id = p_driver_id and driver.approval_status = 'approved'
        and driver.online and driver.available and driver.on_shift and not profile.blocked
    );
  get diagnostics changed = row_count;
  if changed <> 1 then return false; end if;

  update public.drivers set available = false where profile_id = p_driver_id;
  update public.driver_locations set ride_id = p_ride_id where driver_id = p_driver_id;
  update public.ride_requests
  set status = case when driver_id = p_driver_id then 'accepted'::public.offer_status else 'expired'::public.offer_status end,
      responded_at = now()
  where ride_id = p_ride_id and status = 'pending';
  insert into public.ride_history(ride_id, from_status, to_status, actor_id)
  values (p_ride_id, 'procurando_motorista', 'aceita', p_driver_id);
  return true;
end;
$$;
revoke all on function public.accept_ride(uuid, uuid) from public, anon, authenticated;
grant execute on function public.accept_ride(uuid, uuid) to service_role;

create or replace function public.expire_ride_searches(p_ride_id uuid default null)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  searching record;
  ended_count integer := 0;
  advanced_count integer := 0;
  offer_count_before integer;
begin
  for searching in
    select ride.id, ride.passenger_id
    from public.rides ride
    where ride.status = 'procurando_motorista' and ride.driver_id is null
      and (p_ride_id is null or ride.id = p_ride_id)
      and exists (select 1 from public.ride_requests request where request.ride_id = ride.id)
    for update of ride skip locked
  loop
    -- A corrida é bloqueada antes das ofertas, na mesma ordem do aceite.
    select count(*) into offer_count_before
    from public.ride_requests request where request.ride_id = searching.id;
    if public.dispatch_next_offer(searching.id) is not null then
      if (select count(*) from public.ride_requests request where request.ride_id = searching.id) > offer_count_before then
        advanced_count := advanced_count + 1;
      end if;
      continue;
    end if;
    update public.rides
    set status = 'cancelada', cancelled_at = now(),
        cancellation_reason = 'Nenhum motorista elegivel aceitou a solicitacao.'
    where id = searching.id and status = 'procurando_motorista';
    update public.passenger_locations set ride_id = null
    where passenger_id = searching.passenger_id and ride_id = searching.id;
    insert into public.ride_history(ride_id, from_status, to_status, metadata)
    values (searching.id, 'procurando_motorista', 'cancelada', jsonb_build_object('reason', 'no_driver_found'));
    insert into public.notifications(user_id, type, title, body, data)
    values (searching.passenger_id, 'ride.no_driver_found', 'Nenhum motorista disponível',
      'Nenhum motorista aceitou a corrida. Você pode tentar novamente.', jsonb_build_object('rideId', searching.id));
    ended_count := ended_count + 1;
  end loop;
  return ended_count + advanced_count;
end;
$$;
revoke all on function public.expire_ride_searches(uuid) from public, anon, authenticated;
grant execute on function public.expire_ride_searches(uuid) to service_role;
