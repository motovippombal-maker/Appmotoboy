-- Serializa a mudança online/offline com o aceite de corrida, que também
-- bloqueia a linha do motorista antes de confirmar a atribuição.
create or replace function public.set_driver_online_status(
  p_driver_id uuid,
  p_online boolean,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy_meters numeric default null,
  p_recorded_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_driver public.drivers;
  active_ride_id uuid;
  changed public.drivers;
begin
  select * into current_driver
  from public.drivers
  where profile_id = p_driver_id
  for update;
  if current_driver.profile_id is null then
    raise exception 'Motorista não encontrado.' using errcode = 'P0001';
  end if;

  select id into active_ride_id
  from public.rides
  where driver_id = p_driver_id and status not in ('finalizada', 'cancelada')
  limit 1;
  if not p_online and active_ride_id is not null then
    raise exception 'Conclua ou cancele a corrida antes de ficar offline.' using errcode = 'P0001';
  end if;
  if p_online and (
    current_driver.approval_status <> 'approved'
    or exists (select 1 from public.profiles where id = p_driver_id and blocked)
    or not exists (select 1 from public.vehicles where driver_id = p_driver_id and active)
  ) then
    raise exception 'Motorista não está aprovado ou não possui moto ativa.' using errcode = 'P0001';
  end if;

  update public.drivers
  set online = p_online,
      on_shift = p_online,
      available = p_online and active_ride_id is null
        and (not current_driver.queue_paused or not current_driver.online)
  where profile_id = p_driver_id
  returning * into changed;

  if p_online and p_latitude is not null and p_longitude is not null then
    perform public.upsert_driver_location_if_newer(
      p_driver_id, active_ride_id, p_latitude, p_longitude,
      p_accuracy_meters, null, null, coalesce(p_recorded_at, now())
    );
  end if;
  if not p_online then
    update public.driver_locations set ride_id = null where driver_id = p_driver_id;
  end if;
  return jsonb_build_object('online', changed.online, 'available', changed.available,
    'activeRideId', active_ride_id);
end;
$$;
revoke all on function public.set_driver_online_status(uuid, boolean, double precision, double precision, numeric, timestamptz) from public, anon, authenticated;
grant execute on function public.set_driver_online_status(uuid, boolean, double precision, double precision, numeric, timestamptz) to service_role;
