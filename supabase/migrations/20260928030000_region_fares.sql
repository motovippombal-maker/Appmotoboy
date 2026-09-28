-- Moto VIP - Tarifas por regiao/bairro
-- Evolucao incremental: preserva a tarifa por distancia para uso futuro.

create table if not exists public.fare_regions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 80),
  amount_cents integer not null check (amount_cents between 1 and 1000000),
  active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists fare_regions_name_unique_idx
  on public.fare_regions(lower(trim(name)));

create unique index if not exists fare_regions_single_default_idx
  on public.fare_regions(is_default)
  where is_default = true;

create index if not exists fare_regions_active_idx
  on public.fare_regions(active, name);

drop trigger if exists fare_regions_updated on public.fare_regions;
create trigger fare_regions_updated
before update on public.fare_regions
for each row execute function private.set_updated_at();

alter table public.fare_regions enable row level security;

drop policy if exists fare_regions_admin_read on public.fare_regions;
create policy fare_regions_admin_read on public.fare_regions
for select to authenticated using ((select private.is_admin()));

revoke insert, update, delete on public.fare_regions from anon, authenticated;
grant select on public.fare_regions to authenticated;
grant select, insert, update, delete on public.fare_regions to service_role;

insert into public.fare_regions(name, amount_cents, active, is_default)
values
  ('Tarifa padrão da cidade', 500, true, true),
  ('Pombalzinho', 700, true, false),
  ('Vila Operária', 700, true, false)
on conflict do nothing;

update public.system_settings
set value = coalesce(value, '{}'::jsonb) || jsonb_build_object(
      'pricing_mode', 'region',
      'configured', true,
      'per_minute_cents', 0
    ),
    description = 'Tarifa por regiao ativa. Componentes por distancia preservados para uso futuro.',
    updated_at = now()
where key = 'fare';

alter table public.rides
  add column if not exists fare_region_id uuid references public.fare_regions(id) on delete set null,
  add column if not exists fare_region_name text,
  add column if not exists fare_pricing_mode text not null default 'distance'
    check (fare_pricing_mode in ('distance', 'region')),
  add column if not exists fare_rule_snapshot jsonb not null default '{}'::jsonb;

create index if not exists rides_fare_region_idx
  on public.rides(fare_region_id, created_at desc)
  where fare_region_id is not null;

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

  if current_ride.fare_pricing_mode = 'region' then
    calculated_fare := greatest(1, coalesce(current_ride.estimated_fare_cents, current_ride.fare_cents));
  else
    calculated_fare := greatest(
      coalesce((fare->>'minimum_cents')::integer, 0),
      round(
        coalesce((fare->>'base_cents')::numeric, 0)
        + (measured_distance::numeric / 1000) * coalesce((fare->>'per_km_cents')::numeric, 0)
        + (measured_duration::numeric / 60) * coalesce((fare->>'per_minute_cents')::numeric, 0)
      )::integer
    );
  end if;

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
      'final_fare_cents', calculated_fare,
      'fare_pricing_mode', current_ride.fare_pricing_mode,
      'fare_region_name', current_ride.fare_region_name
    )
  );
  return changed;
end;
$$;

revoke all on function public.finish_ride(uuid, uuid) from public, anon, authenticated;
grant execute on function public.finish_ride(uuid, uuid) to service_role;
