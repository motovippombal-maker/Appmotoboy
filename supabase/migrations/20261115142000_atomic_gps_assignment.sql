-- The ride read at the HTTP boundary can become obsolete before the write.
-- Authenticate the association again while processing the GPS sample.
create or replace function public.upsert_driver_location_if_newer(
  p_driver_id uuid,
  p_ride_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters numeric,
  p_heading numeric,
  p_speed_mps numeric,
  p_recorded_at timestamptz
)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  driver_online boolean;
  active_ride uuid;
  applied boolean;
begin
  if p_latitude is null or p_latitude not between -90 and 90
    or p_longitude is null or p_longitude not between -180 and 180
    or p_recorded_at is null or not isfinite(p_recorded_at)
    or p_recorded_at > clock_timestamp() + interval '30 seconds' then
    return false;
  end if;

  -- Order matches acceptance and online/offline (driver then location).
  -- Non-key driver updates used by legacy cancellation remain compatible.
  select driver.online into driver_online from public.drivers driver
    where driver.profile_id = p_driver_id for key share;
  if not found then return false; end if;

  -- If cancellation is already clearing the last sample, wait here and
  -- resolve the assignment using the committed state after that change.
  perform 1 from public.driver_locations where driver_id = p_driver_id for update;
  select id into active_ride from public.rides
    where driver_id = p_driver_id and status not in ('finalizada', 'cancelada');
  if p_ride_id is not null and p_ride_id is distinct from active_ride then return false; end if;
  if p_ride_id is null and not driver_online then return false; end if;

  insert into public.driver_locations(
    driver_id, ride_id, latitude, longitude, accuracy_meters, heading, speed_mps, updated_at
  ) values (
    p_driver_id, active_ride, p_latitude, p_longitude, p_accuracy_meters, p_heading, p_speed_mps, p_recorded_at
  )
  on conflict (driver_id) do update
  set ride_id = excluded.ride_id,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      accuracy_meters = excluded.accuracy_meters,
      heading = excluded.heading,
      speed_mps = excluded.speed_mps,
      updated_at = excluded.updated_at
  where public.driver_locations.updated_at < excluded.updated_at
  returning true into applied;
  -- Location freshness lives on driver_locations. Do not emit a presence
  -- update on drivers for every GPS packet.
  return coalesce(applied, false);
end;
$$;

drop policy driver_locations_read on public.driver_locations;
create policy driver_locations_read on public.driver_locations for select to authenticated using (
  driver_id = (select auth.uid()) or (select private.is_admin()) or exists (
    select 1 from public.rides ride
    where ride.id = driver_locations.ride_id
      and ride.driver_id = driver_locations.driver_id
      and ride.passenger_id = (select auth.uid())
      and ride.status not in ('finalizada', 'cancelada')
  )
);
