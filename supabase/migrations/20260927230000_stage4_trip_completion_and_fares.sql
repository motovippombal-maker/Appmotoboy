-- Moto VIP - Etapa 4
-- Evolucao incremental: medicao real, tarifa administravel e conclusao atomica.

alter table public.rides
  add column if not exists estimated_distance_meters integer,
  add column if not exists estimated_duration_seconds integer,
  add column if not exists estimated_fare_cents integer,
  add column if not exists actual_distance_meters integer,
  add column if not exists actual_duration_seconds integer,
  add column if not exists final_fare_cents integer,
  add column if not exists completed_at timestamptz;

update public.rides
set estimated_distance_meters = coalesce(estimated_distance_meters, distance_meters),
    estimated_duration_seconds = coalesce(estimated_duration_seconds, duration_seconds),
    estimated_fare_cents = coalesce(estimated_fare_cents, fare_cents),
    completed_at = coalesce(completed_at, finished_at)
where estimated_distance_meters is null
   or estimated_duration_seconds is null
   or estimated_fare_cents is null
   or (status = 'finalizada' and completed_at is null);

create table if not exists public.ride_location_points (
  id bigint generated always as identity primary key,
  ride_id uuid not null references public.rides(id) on delete cascade,
  driver_id uuid not null references public.drivers(profile_id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_meters numeric(8,2) not null check (accuracy_meters > 0),
  heading numeric(6,2),
  speed_mps numeric(8,2),
  recorded_at timestamptz not null default now(),
  accepted boolean not null default true,
  rejection_reason text
);

create index if not exists ride_location_points_ride_time_idx
  on public.ride_location_points(ride_id, recorded_at, id);

alter table public.ride_location_points enable row level security;

drop policy if exists ride_location_points_read on public.ride_location_points;
create policy ride_location_points_read on public.ride_location_points
for select to authenticated
using (
  (select private.is_admin())
  or exists (
    select 1 from public.rides r
    where r.id = ride_id
      and (r.passenger_id = (select auth.uid()) or r.driver_id = (select auth.uid()))
  )
);

revoke insert, update, delete on public.ride_location_points from anon, authenticated;
grant select on public.ride_location_points to authenticated;
grant select, insert, update, delete on public.ride_location_points to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Os valores preexistentes ficam preservados como rascunho. A central precisa
-- confirma-los explicitamente antes de novas estimativas/solicitacoes.
update public.system_settings
set value = jsonb_build_object(
      'base_cents', coalesce((value->>'base_cents')::integer, 0),
      'per_km_cents', coalesce((value->>'per_km_cents')::integer, 0),
      'per_minute_cents', coalesce((value->>'per_minute_cents')::integer, 0),
      'minimum_cents', coalesce((value->>'minimum_cents')::integer, 0),
      'configured', coalesce((value->>'configured')::boolean, false)
    ),
    description = 'Tarifa administravel: base, quilometro, minuto e minimo. Exige confirmacao da central.',
    updated_at = now()
where key = 'fare';

create or replace function public.geo_distance_meters(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
) returns double precision
language sql immutable parallel safe set search_path = '' as $$
  select 6371000 * 2 * asin(sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2))
    * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
  ));
$$;

revoke all on function public.geo_distance_meters(double precision, double precision, double precision, double precision) from public, anon, authenticated;
grant execute on function public.geo_distance_meters(double precision, double precision, double precision, double precision) to service_role;

create or replace function public.start_ride(p_ride_id uuid, p_driver_id uuid)
returns public.rides
language plpgsql security invoker set search_path = '' as $$
declare
  changed public.rides;
begin
  update public.rides
  set status = 'em_corrida', started_at = now()
  where id = p_ride_id
    and driver_id = p_driver_id
    and status = 'motorista_chegou'
    and started_at is null
    and completed_at is null
    and cancelled_at is null
  returning * into changed;

  if changed.id is null then return null; end if;

  insert into public.ride_history(ride_id, from_status, to_status, actor_id)
  values (p_ride_id, 'motorista_chegou', 'em_corrida', p_driver_id);
  return changed;
end;
$$;

revoke all on function public.start_ride(uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_ride(uuid, uuid) to service_role;

create or replace function public.finish_ride(p_ride_id uuid, p_driver_id uuid)
returns public.rides
language plpgsql security invoker set search_path = '' as $$
declare
  current_ride public.rides;
  changed public.rides;
  fare jsonb;
  measured_distance integer;
  measured_duration integer;
  calculated_fare integer;
begin
  select * into current_ride
  from public.rides
  where id = p_ride_id
    and driver_id = p_driver_id
    and status = 'em_corrida'
    and started_at is not null
    and completed_at is null
    and cancelled_at is null
  for update;

  if current_ride.id is null then return null; end if;

  select value into fare from public.system_settings where key = 'fare';
  if fare is null or coalesce((fare->>'configured')::boolean, false) is not true then
    raise exception 'Tarifa nao configurada' using errcode = 'P0001';
  end if;

  with ordered as (
    select latitude, longitude,
           lag(latitude) over (order by recorded_at, id) as previous_latitude,
           lag(longitude) over (order by recorded_at, id) as previous_longitude
    from public.ride_location_points
    where ride_id = p_ride_id and driver_id = p_driver_id and accepted
  )
  select coalesce(round(sum(public.geo_distance_meters(
    previous_latitude, previous_longitude, latitude, longitude
  )))::integer, 0)
  into measured_distance
  from ordered
  where previous_latitude is not null;

  measured_duration := greatest(1, floor(extract(epoch from (now() - current_ride.started_at)))::integer);
  calculated_fare := greatest(
    coalesce((fare->>'minimum_cents')::integer, 0),
    round(
      coalesce((fare->>'base_cents')::numeric, 0)
      + (measured_distance::numeric / 1000) * coalesce((fare->>'per_km_cents')::numeric, 0)
      + (measured_duration::numeric / 60) * coalesce((fare->>'per_minute_cents')::numeric, 0)
    )::integer
  );

  update public.rides
  set status = 'finalizada',
      completed_at = now(),
      finished_at = now(),
      actual_distance_meters = measured_distance,
      actual_duration_seconds = measured_duration,
      final_fare_cents = calculated_fare,
      fare_cents = calculated_fare
  where id = p_ride_id and status = 'em_corrida'
  returning * into changed;

  if changed.id is null then return null; end if;

  update public.drivers
  set available = true,
      trips_count = trips_count + 1
  where profile_id = p_driver_id
    and approval_status = 'approved'
    and online = true;

  update public.driver_locations set ride_id = null where driver_id = p_driver_id;
  insert into public.ride_history(ride_id, from_status, to_status, actor_id, metadata)
  values (
    p_ride_id, 'em_corrida', 'finalizada', p_driver_id,
    jsonb_build_object(
      'actual_distance_meters', measured_distance,
      'actual_duration_seconds', measured_duration,
      'final_fare_cents', calculated_fare
    )
  );
  return changed;
end;
$$;

revoke all on function public.finish_ride(uuid, uuid) from public, anon, authenticated;
grant execute on function public.finish_ride(uuid, uuid) to service_role;
