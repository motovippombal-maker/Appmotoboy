-- Moto SyXp - Etapa 2
-- Estabiliza expiracao de ofertas e operacoes criticas do ciclo da corrida.
-- Migration incremental: nao remove dados nem recria estruturas existentes.

create index if not exists ride_requests_pending_expiration_idx
  on public.ride_requests(expires_at, ride_id)
  where status = 'pending';

create or replace function public.expire_ride_searches(p_ride_id uuid default null)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ended record;
  ended_count integer := 0;
begin
  update public.ride_requests
  set status = 'expired',
      responded_at = coalesce(responded_at, now())
  where status = 'pending'
    and expires_at <= now()
    and (p_ride_id is null or ride_id = p_ride_id);

  for ended in
    update public.rides ride
    set status = 'cancelada',
        cancelled_at = now(),
        cancellation_reason = 'Nenhum motorista aceitou a solicitacao a tempo.'
    where ride.status = 'procurando_motorista'
      and ride.driver_id is null
      and (p_ride_id is null or ride.id = p_ride_id)
      and exists (
        select 1
        from public.ride_requests request
        where request.ride_id = ride.id
      )
      and not exists (
        select 1
        from public.ride_requests request
        where request.ride_id = ride.id
          and request.status = 'pending'
          and request.expires_at > now()
      )
    returning ride.id, ride.passenger_id
  loop
    update public.ride_requests
    set status = 'expired',
        responded_at = coalesce(responded_at, now())
    where ride_id = ended.id
      and status = 'pending';

    update public.passenger_locations
    set ride_id = null
    where passenger_id = ended.passenger_id
      and ride_id = ended.id;

    insert into public.ride_history(ride_id, from_status, to_status, metadata)
    values (
      ended.id,
      'procurando_motorista',
      'cancelada',
      jsonb_build_object('reason', 'no_driver_found')
    );

    insert into public.notifications(user_id, type, title, body, data)
    values (
      ended.passenger_id,
      'ride.no_driver_found',
      'Nenhum motorista encontrado',
      'Nenhum motorista aceitou a corrida. Voce pode tentar novamente.',
      jsonb_build_object('rideId', ended.id)
    );

    ended_count := ended_count + 1;
  end loop;

  return ended_count;
end;
$$;

revoke all on function public.expire_ride_searches(uuid) from public, anon, authenticated;
grant execute on function public.expire_ride_searches(uuid) to service_role;

create or replace function public.cancel_ride(
  p_ride_id uuid,
  p_actor_id uuid,
  p_reason text default null
)
returns public.rides
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_ride public.rides;
  changed public.rides;
begin
  select *
  into current_ride
  from public.rides
  where id = p_ride_id
  for update;

  if current_ride.id is null then
    return null;
  end if;

  if current_ride.status = 'cancelada' then
    return current_ride;
  end if;

  if current_ride.status in ('em_corrida', 'finalizada') then
    return null;
  end if;

  update public.rides
  set status = 'cancelada',
      cancelled_at = now(),
      cancelled_by = p_actor_id,
      cancellation_reason = nullif(trim(p_reason), '')
  where id = p_ride_id
    and status = current_ride.status
  returning * into changed;

  if changed.id is null then
    return null;
  end if;

  update public.ride_requests
  set status = 'expired',
      responded_at = coalesce(responded_at, now())
  where ride_id = p_ride_id
    and status = 'pending';

  update public.passenger_locations
  set ride_id = null
  where passenger_id = current_ride.passenger_id
    and ride_id = p_ride_id;

  if current_ride.driver_id is not null then
    update public.drivers driver
    set available = true
    where driver.profile_id = current_ride.driver_id
      and driver.approval_status = 'approved'
      and driver.online = true
      and not exists (
        select 1
        from public.rides other_ride
        where other_ride.driver_id = driver.profile_id
          and other_ride.id <> p_ride_id
          and other_ride.status not in ('finalizada', 'cancelada')
      );

    update public.driver_locations
    set ride_id = null
    where driver_id = current_ride.driver_id
      and ride_id = p_ride_id;
  end if;

  insert into public.ride_history(ride_id, from_status, to_status, actor_id)
  values (p_ride_id, current_ride.status, 'cancelada', p_actor_id);

  insert into public.audit_logs(actor_id, action, entity_type, entity_id)
  values (p_actor_id, 'ride.cancelada', 'ride', p_ride_id::text);

  return changed;
end;
$$;

revoke all on function public.cancel_ride(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_ride(uuid, uuid, text) to service_role;

create or replace function public.start_ride(p_ride_id uuid, p_driver_id uuid)
returns public.rides
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_ride public.rides;
  changed public.rides;
begin
  select *
  into current_ride
  from public.rides
  where id = p_ride_id
    and driver_id = p_driver_id
  for update;

  if current_ride.id is null then
    return null;
  end if;

  if current_ride.status = 'em_corrida' and current_ride.started_at is not null then
    return current_ride;
  end if;

  if current_ride.status <> 'motorista_chegou'
    or current_ride.started_at is not null
    or current_ride.completed_at is not null
    or current_ride.cancelled_at is not null then
    return null;
  end if;

  update public.rides
  set status = 'em_corrida',
      started_at = now()
  where id = p_ride_id
    and driver_id = p_driver_id
    and status = 'motorista_chegou'
    and started_at is null
    and completed_at is null
    and cancelled_at is null
  returning * into changed;

  if changed.id is null then
    return null;
  end if;

  insert into public.ride_history(ride_id, from_status, to_status, actor_id)
  values (p_ride_id, 'motorista_chegou', 'em_corrida', p_driver_id);

  insert into public.audit_logs(actor_id, action, entity_type, entity_id)
  values (p_driver_id, 'ride.em_corrida', 'ride', p_ride_id::text);

  return changed;
end;
$$;

revoke all on function public.start_ride(uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_ride(uuid, uuid) to service_role;

create or replace function public.finish_ride(p_ride_id uuid, p_driver_id uuid)
returns public.rides
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_ride public.rides;
  changed public.rides;
  fare jsonb;
  measured_distance integer;
  measured_duration integer;
  calculated_fare integer;
begin
  select *
  into current_ride
  from public.rides
  where id = p_ride_id
    and driver_id = p_driver_id
  for update;

  if current_ride.id is null then
    return null;
  end if;

  if current_ride.status = 'finalizada' and current_ride.completed_at is not null then
    return current_ride;
  end if;

  if current_ride.status <> 'em_corrida'
    or current_ride.started_at is null
    or current_ride.completed_at is not null
    or current_ride.cancelled_at is not null then
    return null;
  end if;

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
  where id = p_ride_id
    and driver_id = p_driver_id
    and status = 'em_corrida'
  returning * into changed;

  if changed.id is null then
    return null;
  end if;

  update public.drivers driver
  set available = true,
      trips_count = trips_count + 1
  where driver.profile_id = p_driver_id
    and driver.approval_status = 'approved'
    and driver.online = true
    and not exists (
      select 1
      from public.rides other_ride
      where other_ride.driver_id = driver.profile_id
        and other_ride.id <> p_ride_id
        and other_ride.status not in ('finalizada', 'cancelada')
    );

  update public.driver_locations
  set ride_id = null
  where driver_id = p_driver_id
    and ride_id = p_ride_id;

  insert into public.ride_history(ride_id, from_status, to_status, actor_id, metadata)
  values (
    p_ride_id,
    'em_corrida',
    'finalizada',
    p_driver_id,
    jsonb_build_object(
      'actual_distance_meters', measured_distance,
      'actual_duration_seconds', measured_duration,
      'final_fare_cents', calculated_fare,
      'fare_pricing_mode', current_ride.fare_pricing_mode,
      'fare_region_name', current_ride.fare_region_name
    )
  );

  insert into public.audit_logs(actor_id, action, entity_type, entity_id)
  values (p_driver_id, 'ride.finalizada', 'ride', p_ride_id::text);

  return changed;
end;
$$;

revoke all on function public.finish_ride(uuid, uuid) from public, anon, authenticated;
grant execute on function public.finish_ride(uuid, uuid) to service_role;

comment on function public.expire_ride_searches(uuid) is
  'Expira ofertas vencidas e encerra atomicamente buscas sem ofertas validas.';
comment on function public.cancel_ride(uuid, uuid, text) is
  'Cancelamento idempotente com limpeza condicionada a corrida original.';
