-- O administrador escolhe entre rodizio e oferta simultanea.
-- Nenhum modo usa raio ou proximidade para selecionar motoristas.
update public.system_settings
set value = (value - 'initial_radius_km' - 'max_radius_km') ||
  jsonb_build_object('mode', case when value ->> 'mode' = 'broadcast' then 'broadcast' else 'round_robin' end,
    'mode_switch_ready', true)
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
  dispatch_mode text := 'round_robin';
begin
  select * into target_ride from public.rides where id = p_ride_id for update;
  if target_ride.id is null or target_ride.status <> 'procurando_motorista' or target_ride.driver_id is not null then
    return null;
  end if;

  -- Serializa ofertas concorrentes e mudancas de modo feitas pelo ADM.
  select greatest(15, least(90, coalesce((value ->> 'offer_seconds')::integer, 20))),
    case when value ->> 'mode' = 'broadcast' then 'broadcast' else 'round_robin' end
  into offer_seconds, dispatch_mode
  from public.system_settings where key = 'dispatch' for update;
  offer_seconds := coalesce(offer_seconds, 20);

  update public.ride_requests
  set status = 'expired', responded_at = coalesce(responded_at, now())
  where ride_id = p_ride_id and status = 'pending'
    and (expires_at <= now() or not exists (
      select 1 from public.drivers driver
      join public.profiles profile on profile.id = driver.profile_id
      where driver.profile_id = public.ride_requests.driver_id
        and driver.approval_status = 'approved'
        and driver.online and driver.available and driver.on_shift and not driver.queue_paused and not profile.blocked
        and exists (select 1 from public.vehicles vehicle where vehicle.driver_id = driver.profile_id and vehicle.active)
        and not exists (select 1 from public.rides active_ride where active_ride.driver_id = driver.profile_id and active_ride.status not in ('finalizada', 'cancelada'))
    ));

  select driver_id into selected_driver
  from public.ride_requests
  where ride_id = p_ride_id and status = 'pending' and expires_at > now()
  limit 1;
  if selected_driver is not null then return selected_driver; end if;

  if dispatch_mode = 'broadcast' then
    with offered as (
      insert into public.ride_requests(ride_id, driver_id, expires_at)
      select p_ride_id, driver.profile_id, now() + make_interval(secs => offer_seconds)
      from public.drivers driver
      join public.profiles profile on profile.id = driver.profile_id
      where driver.approval_status = 'approved'
        and driver.online and driver.available and driver.on_shift and not driver.queue_paused and not profile.blocked
        and exists (select 1 from public.vehicles vehicle where vehicle.driver_id = driver.profile_id and vehicle.active)
        and not exists (select 1 from public.rides active_ride where active_ride.driver_id = driver.profile_id and active_ride.status not in ('finalizada', 'cancelada'))
        and not exists (select 1 from public.ride_requests previous where previous.ride_id = p_ride_id and previous.driver_id = driver.profile_id)
        and not exists (select 1 from public.ride_requests pending where pending.driver_id = driver.profile_id and pending.status = 'pending' and pending.expires_at > now())
      on conflict (ride_id, driver_id) do nothing
      returning driver_id
    )
    select driver_id into selected_driver from offered limit 1;
    return selected_driver;
  end if;

  select driver.profile_id into selected_driver
  from public.drivers driver
  join public.profiles profile on profile.id = driver.profile_id
  where driver.approval_status = 'approved'
    and driver.online and driver.available and driver.on_shift and not driver.queue_paused and not profile.blocked
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
  if new.status = 'aceita' and old.status = 'procurando_motorista' and new.driver_id is not null
    and exists (select 1 from public.system_settings where key = 'dispatch' and value ->> 'mode' = 'round_robin') then
    perform 1 from public.system_settings where key = 'dispatch' for update;
    update public.drivers
    set dispatch_order = nextval('public.driver_dispatch_order_seq')
    where profile_id = new.driver_id;
  end if;
  return new;
end;
$$;
revoke all on function private.advance_driver_dispatch_queue() from public, anon, authenticated;

create or replace function private.notify_new_offer()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  is_broadcast boolean;
begin
  select value ->> 'mode' = 'broadcast' into is_broadcast
  from public.system_settings where key = 'dispatch';
  insert into public.notifications(user_id, type, title, body, data)
  values (new.driver_id, 'ride.offer', 'Nova corrida',
    case when coalesce(is_broadcast, false)
      then format('Nova corrida para motoristas disponíveis. Você tem %s segundos para responder.', greatest(1, ceil(extract(epoch from new.expires_at - now()))::integer))
      else format('É a sua vez. Você tem %s segundos para responder.', greatest(1, ceil(extract(epoch from new.expires_at - now()))::integer)) end,
    jsonb_build_object('rideId', new.ride_id, 'offerId', new.id));
  return new;
end;
$$;
revoke all on function private.notify_new_offer() from public;
