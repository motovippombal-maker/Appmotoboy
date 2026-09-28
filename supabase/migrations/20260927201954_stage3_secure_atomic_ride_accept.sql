-- Etapa 3: reforça o aceite de corrida sem recriar tabelas ou alterar dados existentes.
-- A função continua acessível somente ao service_role e recebe o motorista já
-- autenticado/validado pela API do Moto VIP.

create or replace function public.accept_ride(p_ride_id uuid, p_driver_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed integer;
  selected_vehicle uuid;
  freshness_seconds integer := 60;
begin
  select greatest(
    30,
    least(180, coalesce((value ->> 'available_interval_seconds')::integer, 20) * 3)
  )
  into freshness_seconds
  from public.system_settings
  where key = 'tracking';

  freshness_seconds := coalesce(freshness_seconds, 60);

  select id
  into selected_vehicle
  from public.vehicles
  where driver_id = p_driver_id
    and active
  order by created_at desc
  limit 1;

  if selected_vehicle is null then
    return false;
  end if;

  update public.rides
  set
    driver_id = p_driver_id,
    vehicle_id = selected_vehicle,
    status = 'aceita',
    accepted_at = now()
  where id = p_ride_id
    and status = 'procurando_motorista'
    and driver_id is null
    and exists (
      select 1
      from public.ride_requests request
      where request.ride_id = p_ride_id
        and request.driver_id = p_driver_id
        and request.status = 'pending'
        and request.expires_at > now()
    )
    and exists (
      select 1
      from public.drivers driver
      where driver.profile_id = p_driver_id
        and driver.approval_status = 'approved'
        and driver.online
        and driver.available
    )
    and exists (
      select 1
      from public.driver_locations location
      where location.driver_id = p_driver_id
        and location.updated_at >= now() - make_interval(secs => freshness_seconds)
    );

  get diagnostics changed = row_count;

  if changed <> 1 then
    return false;
  end if;

  update public.drivers
  set available = false
  where profile_id = p_driver_id;

  update public.driver_locations
  set ride_id = p_ride_id
  where driver_id = p_driver_id;

  update public.ride_requests
  set
    status = case
      when driver_id = p_driver_id then 'accepted'::public.offer_status
      else 'expired'::public.offer_status
    end,
    responded_at = now()
  where ride_id = p_ride_id
    and status = 'pending';

  insert into public.ride_history(ride_id, from_status, to_status, actor_id)
  values (p_ride_id, 'procurando_motorista', 'aceita', p_driver_id);

  return true;
end;
$$;

revoke all on function public.accept_ride(uuid, uuid) from public, anon, authenticated;
grant execute on function public.accept_ride(uuid, uuid) to service_role;

comment on function public.accept_ride(uuid, uuid) is
  'Aceite atomico: exige oferta valida, motorista elegivel, veiculo ativo e GPS recente; somente um motorista pode vincular a corrida.';
