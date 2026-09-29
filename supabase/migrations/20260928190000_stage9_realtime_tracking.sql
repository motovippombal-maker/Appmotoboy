-- Moto SyXp - ETAPA 5: presenca Realtime e localizacao monotona do motorista.
-- Migration incremental: nao remove dados nem recria tabelas.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'drivers'
  ) then
    alter publication supabase_realtime add table public.drivers;
  end if;
end;
$$;

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
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  applied boolean := false;
begin
  if p_latitude is null or p_latitude < -90 or p_latitude > 90
    or p_longitude is null or p_longitude < -180 or p_longitude > 180
    or p_recorded_at is null then
    return false;
  end if;

  insert into public.driver_locations(
    driver_id,
    ride_id,
    latitude,
    longitude,
    accuracy_meters,
    heading,
    speed_mps,
    updated_at
  )
  values (
    p_driver_id,
    p_ride_id,
    p_latitude,
    p_longitude,
    p_accuracy_meters,
    p_heading,
    p_speed_mps,
    p_recorded_at
  )
  on conflict (driver_id) do update
  set ride_id = coalesce(excluded.ride_id, public.driver_locations.ride_id),
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      accuracy_meters = excluded.accuracy_meters,
      heading = excluded.heading,
      speed_mps = excluded.speed_mps,
      updated_at = excluded.updated_at
  where public.driver_locations.updated_at < excluded.updated_at
  returning true into applied;

  if coalesce(applied, false) then
    update public.drivers
    set updated_at = p_recorded_at
    where profile_id = p_driver_id
      and online = true
      and available = true;
  end if;

  return coalesce(applied, false);
end;
$$;

revoke all on function public.upsert_driver_location_if_newer(
  uuid, uuid, double precision, double precision, numeric, numeric, numeric, timestamptz
) from public, anon, authenticated;
grant execute on function public.upsert_driver_location_if_newer(
  uuid, uuid, double precision, double precision, numeric, numeric, numeric, timestamptz
) to service_role;

comment on function public.upsert_driver_location_if_newer(
  uuid, uuid, double precision, double precision, numeric, numeric, numeric, timestamptz
) is 'Mantem somente a posicao valida mais recente de cada motorista; eventos fora de ordem sao ignorados.';
