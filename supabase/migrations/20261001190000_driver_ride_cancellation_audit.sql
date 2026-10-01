-- O servidor continua sendo a autoridade para encerramento e cobrança.
alter table public.rides add column if not exists cancellation_fee_cents integer not null default 0;
alter table public.rides add column if not exists cancellation_fee_reason text;
alter table public.rides add column if not exists cancellation_evidence jsonb;
alter table public.rides add column if not exists termination_code text;
alter table public.rides add column if not exists no_show_at timestamptz;
alter table public.rides add column if not exists queue_reserved_at timestamptz;
alter table public.rides add column if not exists queue_reserved_order bigint;
alter table public.rides add column if not exists arrival_verified boolean not null default false;
alter table public.rides add column if not exists arrival_server_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.rides'::regclass and conname = 'rides_cancellation_fee_nonnegative') then
    alter table public.rides add constraint rides_cancellation_fee_nonnegative check (cancellation_fee_cents >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.rides'::regclass and conname = 'rides_termination_code_check') then
    alter table public.rides add constraint rides_termination_code_check check (termination_code is null or termination_code in ('cancelled','no_show'));
  end if;
end $$;

insert into public.system_settings(key,value,description)
values ('cancellation_policy', '{"fee_active":false,"free_seconds":120,"minimum_travel_meters":250,"fee_cents":500,"after_arrival_fee_cents":500,"arrival_radius_meters":130,"no_show_seconds":300,"preserve_queue_on_passenger_cancel":true}'::jsonb,
  'Regras de chegada, espera, cancelamento e prioridade do motorista')
on conflict (key) do nothing;

create table if not exists public.ride_approach_points (
  id bigint generated always as identity primary key,
  ride_id uuid not null references public.rides(id) on delete cascade,
  driver_id uuid not null references public.drivers(profile_id),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_meters double precision not null check (accuracy_meters between 0 and 40),
  recorded_at timestamptz not null default now()
);
create index if not exists ride_approach_points_ride_time_idx on public.ride_approach_points(ride_id, recorded_at);
alter table public.ride_approach_points enable row level security;
revoke all on public.ride_approach_points from public, anon, authenticated;
grant select, insert on public.ride_approach_points to service_role;
grant usage, select on sequence public.ride_approach_points_id_seq to service_role;

create or replace function private.reserve_queue_position_on_accept()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status = 'aceita' and old.status = 'procurando_motorista' and new.driver_id is not null then
    select queue_entered_at,dispatch_order into new.queue_reserved_at,new.queue_reserved_order
    from public.drivers where profile_id = new.driver_id;
  end if;
  return new;
end;
$$;
revoke all on function private.reserve_queue_position_on_accept() from public;
drop trigger if exists reserve_queue_position_on_accept on public.rides;
create trigger reserve_queue_position_on_accept before update of status on public.rides
for each row execute function private.reserve_queue_position_on_accept();

create or replace function public.cancel_ride(p_ride_id uuid,p_actor_id uuid,p_reason text default null)
returns public.rides language plpgsql security invoker set search_path = '' as $$
declare
  current_ride public.rides;
  changed public.rides;
  policy jsonb;
  no_show boolean;
  point_count integer := 0;
  max_step_speed numeric := 0;
  first_point public.ride_approach_points;
  last_point public.ride_approach_points;
  latest_location public.driver_locations;
  elapsed_seconds integer := 0;
  traveled_meters numeric := 0;
  pickup_meters numeric := null;
  fee integer := 0;
  fee_reason text := null;
  evidence jsonb;
begin
  select * into current_ride from public.rides where id = p_ride_id for update;
  if current_ride.id is null then return null; end if;
  if current_ride.status = 'cancelada' then return current_ride; end if;
  if current_ride.status in ('em_corrida','finalizada') then return null; end if;
  select value into policy from public.system_settings where key = 'cancellation_policy';
  no_show := p_reason = 'NO_SHOW';
  if no_show then
    if p_actor_id is distinct from current_ride.driver_id or current_ride.status <> 'motorista_chegou'
      or current_ride.arrival_server_at is null
      or now() < current_ride.arrival_server_at + make_interval(secs => coalesce((policy->>'no_show_seconds')::integer,300))
    then return null; end if;
  end if;
  if current_ride.accepted_at is not null then
    elapsed_seconds := greatest(0,extract(epoch from now() - current_ride.accepted_at)::integer);
  end if;
  if current_ride.driver_id is not null then
    select * into latest_location from public.driver_locations where driver_id = current_ride.driver_id;
    if latest_location.updated_at >= now() - interval '30 seconds'
      and latest_location.accuracy_meters <= 40 and latest_location.ride_id = p_ride_id then
      pickup_meters := 111195 * sqrt(power(latest_location.latitude-current_ride.origin_lat,2)
        + power((latest_location.longitude-current_ride.origin_lng)*cos(radians(current_ride.origin_lat)),2));
    end if;
    select count(*),coalesce(max(step_meters / greatest(step_seconds,1)),0)
      into point_count,max_step_speed
    from (
      select 111195 * sqrt(power(latitude-lag(latitude) over (order by recorded_at,id),2)
        + power((longitude-lag(longitude) over (order by recorded_at,id))
          * cos(radians(latitude)),2)) as step_meters,
        extract(epoch from recorded_at-lag(recorded_at) over (order by recorded_at,id)) as step_seconds
      from public.ride_approach_points where ride_id = p_ride_id
    ) segments;
    select * into first_point from public.ride_approach_points where ride_id = p_ride_id order by recorded_at,id limit 1;
    select * into last_point from public.ride_approach_points where ride_id = p_ride_id order by recorded_at desc,id desc limit 1;
    if first_point.id is not null and last_point.id is not null then
      traveled_meters := 111195 * sqrt(power(last_point.latitude-first_point.latitude,2)
        + power((last_point.longitude-first_point.longitude)*cos(radians(first_point.latitude)),2));
    end if;
  end if;
  if coalesce((policy->>'fee_active')::boolean,false) then
    if (no_show and current_ride.arrival_verified) or
      (p_actor_id = current_ride.passenger_id and current_ride.status = 'motorista_chegou'
      and current_ride.arrival_verified and current_ride.arrived_at is not null
      and pickup_meters <= coalesce((policy->>'arrival_radius_meters')::integer,130)) then
      fee := coalesce((policy->>'after_arrival_fee_cents')::integer,0);
      fee_reason := case when no_show then 'no_show' else 'driver_arrived' end;
    elsif p_actor_id = current_ride.passenger_id and elapsed_seconds > coalesce((policy->>'free_seconds')::integer,120)
      and point_count >= 3 and last_point.recorded_at >= now() - interval '30 seconds'
      and last_point.recorded_at - first_point.recorded_at >= interval '10 seconds'
      and traveled_meters >= coalesce((policy->>'minimum_travel_meters')::integer,250)
      and traveled_meters <= elapsed_seconds * 25 and max_step_speed <= 20 then
      fee := coalesce((policy->>'fee_cents')::integer,0);
      fee_reason := 'verified_driver_travel';
    end if;
  end if;
  evidence := jsonb_build_object('accepted_at',current_ride.accepted_at,'cancelled_at',now(),
    'driver_lat',case when pickup_meters is not null then latest_location.latitude else null end,
    'driver_lng',case when pickup_meters is not null then latest_location.longitude else null end,
    'pickup_lat',current_ride.origin_lat,'pickup_lng',current_ride.origin_lng,
    'distance_to_pickup_meters',round(pickup_meters), 'elapsed_seconds',elapsed_seconds,
    'approach_points',point_count,'verified_displacement_meters',round(traveled_meters),
    'max_segment_speed_mps',round(max_step_speed,1),
    'reason',p_reason,'fee_reason',fee_reason);
  update public.rides set status = 'cancelada', cancelled_at = now(), cancelled_by = p_actor_id,
    cancellation_reason = nullif(trim(p_reason),''), cancellation_fee_cents = fee,
    cancellation_fee_reason = fee_reason, cancellation_evidence = evidence,
    termination_code = case when no_show then 'no_show' else 'cancelled' end,
    no_show_at = case when no_show then now() else null end
  where id = p_ride_id and status = current_ride.status returning * into changed;
  if changed.id is null then return null; end if;
  update public.ride_requests set status = 'expired', responded_at = coalesce(responded_at,now())
  where ride_id = p_ride_id and status = 'pending';
  update public.passenger_locations set ride_id = null where passenger_id = current_ride.passenger_id and ride_id = p_ride_id;
  if current_ride.driver_id is not null then
    update public.drivers driver set available = true
    where driver.profile_id = current_ride.driver_id and driver.approval_status = 'approved'
      and driver.online and not driver.queue_paused and not exists (
        select 1 from public.rides other_ride where other_ride.driver_id = driver.profile_id
          and other_ride.id <> p_ride_id and other_ride.status not in ('finalizada','cancelada'));
    if p_actor_id = current_ride.passenger_id and coalesce((policy->>'preserve_queue_on_passenger_cancel')::boolean,true)
      and current_ride.queue_reserved_order is not null then
      update public.drivers set queue_entered_at = coalesce(current_ride.queue_reserved_at,queue_entered_at),
        dispatch_order = current_ride.queue_reserved_order
      where profile_id = current_ride.driver_id and online and available and not queue_paused;
    end if;
    update public.driver_locations set ride_id = null where driver_id = current_ride.driver_id and ride_id = p_ride_id;
    insert into public.notifications(user_id,type,title,body,data)
    values (current_ride.driver_id,'ride.cancelada',
      case when no_show then 'Passageiro não apareceu' else 'Corrida cancelada' end,
      case when p_actor_id = current_ride.passenger_id then 'O passageiro cancelou a corrida.'
        when no_show then 'Tempo de espera encerrado.' else 'A corrida foi encerrada.' end,
      jsonb_build_object('rideId',p_ride_id,'feeCents',fee,'feeReason',fee_reason));
  end if;
  insert into public.ride_history(ride_id,from_status,to_status,actor_id,metadata)
  values (p_ride_id,current_ride.status,'cancelada',p_actor_id,
    jsonb_build_object('terminationCode',case when no_show then 'no_show' else 'cancelled' end,
      'feeCents',fee,'feeReason',fee_reason,'evidence',evidence));
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values (p_actor_id,case when no_show then 'ride.no_show' else 'ride.cancelada' end,'ride',p_ride_id::text,evidence);
  return changed;
end;
$$;
revoke all on function public.cancel_ride(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.cancel_ride(uuid,uuid,text) to service_role;
