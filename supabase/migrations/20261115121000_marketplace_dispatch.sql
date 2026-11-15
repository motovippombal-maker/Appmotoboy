-- Marketplace uses the ride engine exclusively for delivery. Commercial,
-- stock and money remain in market_orders and market_cash_payments.
alter table public.rides
  add column market_order_id uuid references public.market_orders(id) on delete restrict,
  add column market_dispatch_source text check (market_dispatch_source in ('preferred','network')),
  add column market_delivery_exception_at timestamptz,
  add constraint market_ride_service_check check (
    (market_order_id is not null and service_type = 'delivery' and payment_method = 'cash')
    or (market_order_id is null and market_dispatch_source is null and market_delivery_exception_at is null)
  );
alter table public.ride_requests
  add column market_dispatch_source text check (market_dispatch_source in ('preferred','network'));
alter table public.market_orders
  add column dispatch_attempts integer not null default 0 check (dispatch_attempts >= 0),
  add column dispatch_next_at timestamptz,
  add column dispatch_exhausted_at timestamptz;

drop index public.one_active_ride_per_passenger;
create unique index one_active_ride_per_passenger on public.rides(passenger_id)
  where market_order_id is null and status not in ('finalizada','cancelada');
create unique index market_order_one_active_ride on public.rides(market_order_id)
  where market_order_id is not null and status not in ('finalizada','cancelada');
create index market_ride_history_idx on public.rides(market_order_id, created_at desc) where market_order_id is not null;
create index market_dispatch_due_idx on public.market_orders(dispatch_next_at, id)
  where status = 'ready' and logistics_status = 'awaiting_driver' and dispatch_exhausted_at is null;
-- one_active_ride_per_driver is deliberately unchanged across both workflows.

drop policy rides_read on public.rides;
create policy rides_read on public.rides for select to authenticated using (
  passenger_id = (select auth.uid()) or (select private.is_admin()) or (
    driver_id = (select auth.uid()) and (market_order_id is null or status not in ('finalizada','cancelada'))
  )
);

insert into public.system_settings(key,value) values ('marketplace_dispatch',
  '{"offer_seconds":30,"retry_seconds":60,"max_attempts":20,"gps_age_seconds":75,"gps_accuracy_meters":100,"max_pickup_distance_meters":15000}'::jsonb
) on conflict (key) do nothing;
grant usage on schema private to service_role;

create function private.market_dispatch_setting(p_config jsonb,p_key text,p_default integer,p_min integer,p_max integer)
returns integer language sql immutable set search_path = '' as $$
  select case when p_config->>p_key ~ '^[0-9]{1,6}$'
    then greatest(p_min,least(p_max,(p_config->>p_key)::integer)) else p_default end
$$;

create function private.market_driver_eligible(p_ride_id uuid,p_driver_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(
    select 1 from public.drivers d
    join public.profiles p on p.id=d.profile_id and p.role='driver' and not p.blocked
    where d.profile_id=p_driver_id and d.approval_status='approved' and d.online and d.available and d.on_shift and not d.queue_paused
      and exists (select 1 from public.vehicles v where v.driver_id=d.profile_id and v.active)
      and not exists (select 1 from public.rides r where r.driver_id=d.profile_id and r.status not in ('finalizada','cancelada'))
      and not exists (select 1 from public.ride_requests rr where rr.driver_id=d.profile_id and rr.ride_id<>p_ride_id
        and rr.status='pending' and rr.expires_at>now())
  )
$$;

create function private.market_driver_pickup_distance(p_ride public.rides,p_driver_id uuid,p_config jsonb)
returns double precision language sql stable security invoker set search_path = '' as $$
  select distance.meters
  from public.driver_locations loc
  cross join lateral (select public.geo_distance_meters((p_ride).origin_lat,(p_ride).origin_lng,loc.latitude,loc.longitude) as meters) distance
  where loc.driver_id=p_driver_id
    and private.market_driver_eligible((p_ride).id,p_driver_id)
    and loc.updated_at between now()-make_interval(secs=>private.market_dispatch_setting(p_config,'gps_age_seconds',75,15,180)) and now()+interval '30 seconds'
    and loc.latitude between -90 and 90 and loc.longitude between -180 and 180
    and loc.accuracy_meters between 0 and private.market_dispatch_setting(p_config,'gps_accuracy_meters',100,20,500)
    and distance.meters <= private.market_dispatch_setting(p_config,'max_pickup_distance_meters',15000,100,100000)
$$;
revoke all on function private.market_dispatch_setting(jsonb,text,integer,integer,integer),
  private.market_driver_pickup_distance(public.rides,uuid,jsonb),private.market_driver_eligible(uuid,uuid) from public,anon,authenticated;
grant execute on function private.market_dispatch_setting(jsonb,text,integer,integer,integer),
  private.market_driver_pickup_distance(public.rides,uuid,jsonb),private.market_driver_eligible(uuid,uuid) to service_role;

create function public.dispatch_market_order(p_order_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  current_order public.market_orders;
  current_ride public.rides;
  preferred_driver uuid;
  chosen_driver uuid;
  source text;
  dispatch_config jsonb;
  offer_seconds integer;
  retry_seconds integer;
  max_attempts integer;
  offer_until timestamptz;
begin
  -- Order -> ride -> shared dispatch mutex. This also serializes two callers
  -- for one order and prevents reservations across both dispatch policies.
  select * into current_order from public.market_orders where id=p_order_id for update;
  if current_order.id is null or current_order.status<>'ready'
    or current_order.logistics_status<>'awaiting_driver' or current_order.dispatch_exhausted_at is not null
    or current_order.dispatch_next_at>now() then return false; end if;
  select value into dispatch_config from public.system_settings where key='marketplace_dispatch';
  offer_seconds := private.market_dispatch_setting(dispatch_config,'offer_seconds',30,15,90);
  retry_seconds := private.market_dispatch_setting(dispatch_config,'retry_seconds',60,15,900);
  max_attempts := private.market_dispatch_setting(dispatch_config,'max_attempts',20,1,100);
  select * into current_ride from public.rides where market_order_id=p_order_id
    and status not in ('finalizada','cancelada') for update;

  if current_ride.id is null then
    if exists(select 1 from public.profiles where id=current_order.customer_id and blocked) then
      update public.market_orders set dispatch_exhausted_at=now(),dispatch_next_at=null where id=p_order_id;
      insert into public.market_order_events(order_id,event_type,metadata)
      values(p_order_id,'dispatch_waiting_support',jsonb_build_object('reason','customer_blocked'));
      return false;
    end if;
    insert into public.rides(passenger_id,status,market_order_id,service_type,service_details,
      origin_address,origin_lat,origin_lng,destination_address,destination_lat,destination_lng,distance_meters,duration_seconds,
      estimated_distance_meters,estimated_duration_seconds,route_geometry,fare_cents,estimated_fare_cents,
      fare_pricing_mode,fare_rule_snapshot,fare_region_name,service_area_name,payment_method)
    values(current_order.customer_id,'procurando_motorista',p_order_id,'delivery',
      jsonb_strip_nulls(jsonb_build_object('description','Pedido de compras','recipientName',current_order.recipient_name,
        'recipientPhone',current_order.recipient_phone,'dropoffNotes',current_order.delivery_notes)),
      current_order.pickup_address,current_order.pickup_lat,current_order.pickup_lng,
      current_order.destination_address,current_order.destination_lat,current_order.destination_lng,
      coalesce(current_order.estimated_distance_meters,greatest(1,round(public.geo_distance_meters(
        current_order.pickup_lat,current_order.pickup_lng,current_order.destination_lat,current_order.destination_lng))::integer)),
      coalesce(current_order.estimated_duration_seconds,1),
      current_order.estimated_distance_meters,current_order.estimated_duration_seconds,current_order.route_geometry,
      current_order.freight_cents,current_order.freight_cents,'region',current_order.fare_rule_snapshot,
      current_order.fare_rule_snapshot->>'regionName',current_order.fare_rule_snapshot->>'serviceAreaName','cash')
    returning * into current_ride;
    insert into public.ride_history(ride_id,to_status,metadata)
    values(current_ride.id,'procurando_motorista',jsonb_build_object('marketOrderId',p_order_id));
  end if;
  if current_ride.status<>'procurando_motorista' or current_ride.driver_id is not null then return false; end if;

  perform 1 from public.system_settings where key='dispatch' for update;
  update public.ride_requests rr set status='expired',responded_at=coalesce(rr.responded_at,now())
  where rr.ride_id=current_ride.id and rr.status='pending' and
    (rr.expires_at<=now()
     or case rr.market_dispatch_source
       when 'preferred' then not private.market_driver_eligible(current_ride.id,rr.driver_id)
       else private.market_driver_pickup_distance(current_ride,rr.driver_id,dispatch_config) is null end);
  select expires_at into offer_until from public.ride_requests
  where ride_id=current_ride.id and status='pending' and expires_at>now()
  order by created_at,id limit 1;
  if offer_until is not null then
    update public.market_orders set dispatch_next_at=offer_until where id=p_order_id;
    return false;
  end if;
  if current_order.dispatch_attempts>=max_attempts then
    update public.market_orders set dispatch_exhausted_at=now(),dispatch_next_at=null where id=p_order_id;
    insert into public.market_order_events(order_id,event_type,metadata)
    values(p_order_id,'dispatch_waiting_support',jsonb_build_object('reason','attempts_exhausted','rideId',current_ride.id));
    return false;
  end if;

  -- Only the first offer can be preferential. A refusal or expiry always
  -- moves to the network, and rejected drivers are not recycled in this ride.
  if not exists(select 1 from public.ride_requests where ride_id=current_ride.id) then
    select preferred_driver_id into preferred_driver from public.market_stores where id=current_order.store_id;
    -- The store's pickup and destination were already validated in checkout.
    -- The linked driver's eligibility does not depend on a GPS-based rank.
    select d.profile_id into chosen_driver from public.drivers d
      where d.profile_id=preferred_driver and private.market_driver_eligible(current_ride.id,d.profile_id)
      for key share of d skip locked;
  end if;
  source := 'preferred';
  if chosen_driver is null then
    source := 'network';
    select d.profile_id into chosen_driver
      from public.drivers d
      cross join lateral (select private.market_driver_pickup_distance(current_ride,d.profile_id,dispatch_config) as meters) distance
      where distance.meters is not null
        and not exists(select 1 from public.ride_requests rr where rr.ride_id=current_ride.id and rr.driver_id=d.profile_id)
      order by distance.meters,d.profile_id
      limit 1 for key share of d skip locked;
  end if;
  if chosen_driver is null then
    update public.market_orders set dispatch_attempts=dispatch_attempts+1,dispatch_next_at=now()+make_interval(secs=>retry_seconds)
    where id=p_order_id;
    return false;
  end if;
  offer_until := now()+make_interval(secs=>offer_seconds);
  insert into public.ride_requests(ride_id,driver_id,expires_at,market_dispatch_source)
  values(current_ride.id,chosen_driver,offer_until,source);
  update public.market_orders set dispatch_attempts=dispatch_attempts+1,dispatch_next_at=offer_until where id=p_order_id;
  insert into public.market_order_events(order_id,event_type,metadata)
  values(p_order_id,'delivery_offered',jsonb_build_object('rideId',current_ride.id,'source',source));
  return true;
end;
$$;

create function public.dispatch_due_market_orders(p_limit integer default 25)
returns integer language plpgsql security invoker set search_path = '' as $$
declare candidate uuid; offered integer := 0;
begin
  for candidate in
    select o.id from public.market_orders o
    where o.status='ready' and o.logistics_status='awaiting_driver' and o.dispatch_exhausted_at is null
      and (o.dispatch_next_at is null or o.dispatch_next_at<=now())
    order by o.dispatch_next_at nulls first,o.id
    limit greatest(1,least(100,coalesce(p_limit,25))) for update of o skip locked
  loop
    if public.dispatch_market_order(candidate) then offered:=offered+1; end if;
  end loop;
  return offered;
end;
$$;

create function public.accept_market_delivery(p_ride_id uuid,p_driver_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  current_order public.market_orders;
  current_ride public.rides;
  offer public.ride_requests;
  selected_vehicle uuid;
  dispatch_config jsonb;
begin
  select o.* into current_order from public.market_orders o join public.rides r on r.market_order_id=o.id
  where r.id=p_ride_id for update of o;
  if current_order.id is null then return false; end if;
  select * into current_ride from public.rides where id=p_ride_id for update;
  if current_ride.driver_id=p_driver_id and current_ride.status in ('aceita','motorista_a_caminho','motorista_chegou','em_corrida') then return true; end if;
  if current_order.status<>'ready' or current_order.logistics_status<>'awaiting_driver'
    or current_ride.status<>'procurando_motorista' or current_ride.driver_id is not null then return false; end if;
  perform 1 from public.drivers where profile_id=p_driver_id for update;
  select * into offer from public.ride_requests where ride_id=p_ride_id and driver_id=p_driver_id
    and status='pending' and expires_at>clock_timestamp() and market_dispatch_source is not null for update;
  if offer.id is null then return false; end if;
  select value into dispatch_config from public.system_settings where key='marketplace_dispatch';
  if (case offer.market_dispatch_source
    when 'preferred' then not private.market_driver_eligible(current_ride.id,p_driver_id)
    else private.market_driver_pickup_distance(current_ride,p_driver_id,dispatch_config) is null end) then return false; end if;
  select id into selected_vehicle from public.vehicles where driver_id=p_driver_id and active
  order by created_at desc,id limit 1 for share;
  if selected_vehicle is null then return false; end if;
  update public.market_orders set logistics_status='assigned',assigned_driver_id=p_driver_id,dispatch_next_at=null
  where id=current_order.id;
  update public.rides set driver_id=p_driver_id,vehicle_id=selected_vehicle,status='aceita',
    accepted_at=now(),market_dispatch_source=offer.market_dispatch_source where id=p_ride_id;
  update public.drivers set available=false where profile_id=p_driver_id;
  update public.driver_locations set ride_id=p_ride_id where driver_id=p_driver_id;
  update public.ride_requests set status=case when id=offer.id then 'accepted'::public.offer_status else 'expired'::public.offer_status end,
    responded_at=now() where ride_id=p_ride_id and status='pending';
  insert into public.ride_history(ride_id,from_status,to_status,actor_id,metadata)
  values(p_ride_id,'procurando_motorista','aceita',p_driver_id,jsonb_build_object('marketOrderId',current_order.id,'source',offer.market_dispatch_source));
  insert into public.market_order_events(order_id,event_type,actor_id,metadata)
  values(current_order.id,'delivery_assigned',p_driver_id,jsonb_build_object('rideId',p_ride_id,'source',offer.market_dispatch_source));
  return true;
exception when unique_violation then
  -- The unchanged cross-workflow active-driver index is the final guard.
  return false;
end;
$$;

-- Submission always locks the order before the ride. Delivery completion
-- only settles logistics; cash and store repasse require independent actors.
create function private.market_finish_delivery(p_ride public.rides,p_actor_id uuid,p_reason text)
returns public.rides language plpgsql security invoker set search_path = '' as $$
declare changed public.rides;
begin
  update public.market_orders set status='delivered',logistics_status='delivered',
    dispatch_next_at=null where id=p_ride.market_order_id and status='ready'
    and logistics_status in ('in_delivery','exception') and assigned_driver_id=p_ride.driver_id;
  if not found then return null; end if;
  update public.rides set status='finalizada',completed_at=now(),finished_at=now(),
    final_fare_cents=estimated_fare_cents,actual_duration_seconds=greatest(1,floor(extract(epoch from now()-started_at))::integer),
    market_delivery_exception_at=null
    where id=p_ride.id and status='em_corrida' returning * into changed;
  if changed.id is null then raise exception 'A entrega mudou durante a conclusão.' using errcode='40001'; end if;
  update public.driver_locations set ride_id=null where driver_id=p_ride.driver_id and ride_id=p_ride.id;
  update public.drivers d set available=true where d.profile_id=p_ride.driver_id and d.approval_status='approved'
    and d.online and d.on_shift and not d.queue_paused and exists(select 1 from public.profiles where id=d.profile_id and not blocked)
    and not exists(select 1 from public.rides r where r.driver_id=d.profile_id and r.status not in ('finalizada','cancelada'));
  insert into public.ride_history(ride_id,from_status,to_status,actor_id,metadata)
  values(p_ride.id,'em_corrida','finalizada',p_actor_id,jsonb_build_object('marketOrderId',p_ride.market_order_id));
  insert into public.market_order_events(order_id,event_type,actor_id,metadata)
  values(p_ride.market_order_id,'delivered',p_actor_id,
    jsonb_strip_nulls(jsonb_build_object('rideId',p_ride.id,'resolution',p_reason)));
  return changed;
end;
$$;

create function public.market_driver_delivery_action(
  p_ride_id uuid,p_driver_id uuid,p_action text,p_reason text default null,p_reason_code text default null
)
returns public.rides language plpgsql security invoker set search_path = '' as $$
declare
  current_order public.market_orders;
  current_ride public.rides;
  changed public.rides;
  current_location public.driver_locations;
  change_data jsonb;
begin
  select o.* into current_order from public.market_orders o join public.rides r on r.market_order_id=o.id
  where r.id=p_ride_id for update of o;
  if current_order.id is null then return null; end if;
  select * into current_ride from public.rides where id=p_ride_id for update;
  if p_action='withdraw' and exists(select 1 from public.ride_driver_cancellations
    where ride_id=p_ride_id and driver_id=p_driver_id) then return null; end if;
  if current_ride.driver_id is distinct from p_driver_id or current_order.assigned_driver_id is distinct from p_driver_id
    or not exists(select 1 from public.profiles where id=p_driver_id and role='driver') then return null; end if;
  if (p_action='pickup' and current_ride.status='em_corrida') or
     (p_action='complete' and current_ride.status='finalizada') or
     (p_action='exception' and current_ride.market_delivery_exception_at is not null) then return current_ride; end if;
  if current_order.status<>'ready' then return null; end if;
  if p_action='pickup' and current_ride.status='motorista_chegou' and current_order.logistics_status='assigned'
    and current_ride.arrival_verified then
    update public.market_orders set logistics_status='in_delivery' where id=current_order.id;
    changed:=public.start_ride(p_ride_id,p_driver_id);
    if changed.id is null then raise exception 'A entrega mudou durante a retirada.' using errcode='40001'; end if;
    insert into public.market_order_events(order_id,event_type,actor_id,metadata)
    values(current_order.id,'picked_up',p_driver_id,jsonb_build_object('rideId',p_ride_id));
    return changed;
  elsif p_action='complete' and current_ride.status='em_corrida' and current_order.logistics_status='in_delivery'
    and current_ride.market_delivery_exception_at is null then
    return private.market_finish_delivery(current_ride,p_driver_id,null);
  elsif p_action='exception' and current_ride.status='em_corrida' and current_order.logistics_status='in_delivery'
    and length(btrim(coalesce(p_reason,''))) between 3 and 300 then
    update public.market_orders set logistics_status='exception' where id=current_order.id;
    update public.rides set market_delivery_exception_at=now() where id=p_ride_id returning * into changed;
    insert into public.market_order_events(order_id,event_type,actor_id,metadata)
    values(current_order.id,'delivery_exception',p_driver_id,jsonb_build_object('rideId',p_ride_id,'reason',btrim(p_reason)));
    insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
    values(p_driver_id,'market.delivery_exception','market_order',current_order.id::text,jsonb_build_object('rideId',p_ride_id));
    insert into public.notifications(user_id,type,title,body,data)
    values(current_order.customer_id,'market.delivery_exception','Entrega em análise',
      'A central precisa verificar uma ocorrência após a retirada.',jsonb_build_object('orderId',current_order.id));
    return changed;
  elsif p_action='withdraw' and current_ride.status in ('aceita','motorista_a_caminho','motorista_chegou')
    and current_order.logistics_status='assigned'
    and length(btrim(coalesce(p_reason,''))) between 1 and 300
    and p_reason_code in ('mechanical','personal','cannot_reach','unsafe','passenger_requested','address','other') then
    select * into current_location from public.driver_locations where driver_id=p_driver_id;
    insert into public.ride_driver_cancellations(ride_id,driver_id,passenger_id,previous_status,
      reason_code,reason_text,accepted_at,arrived_at,gps_lat,gps_lng,gps_accuracy_meters,gps_recorded_at)
    values(p_ride_id,p_driver_id,current_ride.passenger_id,current_ride.status,
      p_reason_code,btrim(p_reason),current_ride.accepted_at,current_ride.arrived_at,current_location.latitude,
      current_location.longitude,current_location.accuracy_meters,current_location.updated_at);
    update public.market_orders set logistics_status='awaiting_driver',assigned_driver_id=null,
      dispatch_attempts=0,dispatch_exhausted_at=null,dispatch_next_at=now() where id=current_order.id;
    update public.rides set status='procurando_motorista',driver_id=null,vehicle_id=null,accepted_at=null,
      arrival_server_at=null,arrived_at=null,arrival_verified=false,market_dispatch_source=null,redispatch_started_at=now()
    where id=p_ride_id returning * into changed;
    update public.ride_requests set status='expired',responded_at=now() where ride_id=p_ride_id and status='pending';
    update public.driver_locations set ride_id=null where driver_id=p_driver_id and ride_id=p_ride_id;
    delete from public.ride_approach_points where ride_id=p_ride_id and driver_id=p_driver_id;
    update public.drivers d set available=true where d.profile_id=p_driver_id and d.approval_status='approved'
      and d.online and d.on_shift and not d.queue_paused and exists(select 1 from public.profiles where id=d.profile_id and not blocked);
    change_data:=jsonb_build_object('rideId',p_ride_id,'reasonCode',p_reason_code);
    insert into public.ride_history(ride_id,from_status,to_status,actor_id,metadata)
    values(p_ride_id,current_ride.status,'procurando_motorista',p_driver_id,change_data);
    insert into public.market_order_events(order_id,event_type,actor_id,metadata)
    values(current_order.id,'delivery_driver_withdrew',p_driver_id,change_data);
    insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
    values(p_driver_id,'market.delivery_driver_withdrew','market_order',current_order.id::text,change_data);
    return changed;
  end if;
  return null;
end;
$$;

create function public.market_admin_delivery_action(p_actor_id uuid,p_order_id uuid,p_action text,p_reason text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare current_order public.market_orders; current_ride public.rides; changed public.rides;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role='admin' and not blocked)
    then raise exception 'Administração obrigatória.' using errcode='42501'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 3 and 300 then return false; end if;
  select * into current_order from public.market_orders where id=p_order_id for update;
  if current_order.id is null or current_order.status<>'ready' then return false; end if;
  select * into current_ride from public.rides where market_order_id=p_order_id
    and status not in ('finalizada','cancelada') for update;
  if p_action='retry' and current_order.logistics_status='awaiting_driver' and current_order.dispatch_exhausted_at is not null
    and (current_ride.id is null or current_ride.status='procurando_motorista') then
    if current_ride.id is not null then
      update public.ride_requests set status='expired',responded_at=now() where ride_id=current_ride.id and status='pending';
      update public.rides set status='cancelada',cancelled_at=now(),cancelled_by=p_actor_id,cancellation_reason='Nova tentativa autorizada pela central'
        where id=current_ride.id;
      insert into public.ride_history(ride_id,from_status,to_status,actor_id,metadata)
      values(current_ride.id,'procurando_motorista','cancelada',p_actor_id,jsonb_build_object('event','market_dispatch_retried'));
    end if;
    update public.market_orders set dispatch_attempts=0,dispatch_exhausted_at=null,dispatch_next_at=now() where id=p_order_id;
  elsif (p_action='cancel' and current_order.logistics_status in ('awaiting_driver','assigned')
      and (current_ride.id is null or current_ride.status in ('procurando_motorista','aceita','motorista_a_caminho','motorista_chegou')))
    or (p_action in ('returned_restock','close_without_restock') and current_order.logistics_status='exception'
      and current_ride.status='em_corrida' and current_ride.market_delivery_exception_at is not null) then
    if p_action='close_without_restock' then
      update public.market_stock_reservations set consumed_at=now()
      where order_id=p_order_id and released_at is null and consumed_at is null;
    end if;
    update public.market_orders set status='cancelled',logistics_status='cancelled',dispatch_next_at=null where id=p_order_id;
    if current_ride.id is not null then
      update public.rides set status='cancelada',cancelled_at=now(),cancelled_by=p_actor_id,
        market_delivery_exception_at=null,cancellation_reason=btrim(p_reason) where id=current_ride.id;
      update public.ride_requests set status='expired',responded_at=now() where ride_id=current_ride.id and status='pending';
      update public.driver_locations set ride_id=null where ride_id=current_ride.id and driver_id=current_ride.driver_id;
      update public.drivers d set available=true where d.profile_id=current_ride.driver_id and d.approval_status='approved'
        and d.online and d.on_shift and not d.queue_paused and exists(select 1 from public.profiles where id=d.profile_id and not blocked);
      insert into public.ride_history(ride_id,from_status,to_status,actor_id,metadata)
      values(current_ride.id,current_ride.status,'cancelada',p_actor_id,jsonb_build_object('marketOrderId',p_order_id,'event',p_action));
    end if;
  elsif p_action='resume' and current_order.logistics_status='exception'
    and current_ride.status='em_corrida' and current_ride.market_delivery_exception_at is not null then
    update public.market_orders set logistics_status='in_delivery' where id=p_order_id;
    update public.rides set market_delivery_exception_at=null where id=current_ride.id;
  elsif p_action='delivered' and current_order.logistics_status='exception'
    and current_ride.status='em_corrida' and current_ride.market_delivery_exception_at is not null then
    changed:=private.market_finish_delivery(current_ride,p_actor_id,btrim(p_reason));
    if changed.id is null then return false; end if;
  else return false;
  end if;
  insert into public.market_order_events(order_id,event_type,actor_id,metadata)
  values(p_order_id,'delivery_admin_'||p_action,p_actor_id,
    jsonb_build_object('rideId',current_ride.id,'reason',btrim(p_reason)));
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(p_actor_id,'market.delivery_admin_'||p_action,'market_order',p_order_id::text,
    jsonb_build_object('rideId',current_ride.id,'reason',btrim(p_reason)));
  return true;
end;
$$;

-- Preserve every existing transition. Only a marketplace exception may
-- close after pickup without representing the order as delivered/paid.
create or replace function private.validate_ride_transition()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = new.status then return new; end if;
  if not (
    (old.status = 'solicitada' and new.status in ('procurando_motorista','cancelada')) or
    (old.status = 'procurando_motorista' and new.status in ('aceita','cancelada')) or
    (old.status = 'aceita' and new.status in ('motorista_a_caminho','cancelada')) or
    (old.status = 'motorista_a_caminho' and new.status in ('motorista_chegou','cancelada')) or
    (old.status = 'motorista_chegou' and new.status in ('em_corrida','cancelada')) or
    (old.status = 'em_corrida' and new.status = 'finalizada') or
    (old.status = 'em_corrida' and new.status = 'cancelada' and old.market_order_id is not null
      and old.market_delivery_exception_at is not null and new.cancelled_by is not null) or
    (old.status in ('aceita','motorista_a_caminho','motorista_chegou')
      and new.status = 'procurando_motorista' and old.driver_id is not null
      and new.driver_id is null and new.redispatch_started_at is not null)
  ) then raise exception 'Transição de corrida inválida: % -> %', old.status, new.status using errcode = '22023'; end if;
  return new;
end;
$$;

create function public.decline_market_delivery(p_ride_id uuid,p_driver_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare current_order public.market_orders;
begin
  select o.* into current_order from public.market_orders o join public.rides r on r.market_order_id=o.id
  where r.id=p_ride_id for update of o;
  if current_order.id is null then return null; end if;
  if exists(select 1 from public.ride_requests where ride_id=p_ride_id and driver_id=p_driver_id
    and status='declined' and market_dispatch_source is not null) then return current_order.id; end if;
  if current_order.status<>'ready' or current_order.logistics_status<>'awaiting_driver' then return null; end if;
  update public.ride_requests set status='declined',responded_at=now()
  where ride_id=p_ride_id and driver_id=p_driver_id and status='pending'
    and market_dispatch_source is not null and expires_at>clock_timestamp();
  if not found then return null; end if;
  update public.market_orders set dispatch_next_at=now() where id=current_order.id;
  insert into public.market_order_events(order_id,event_type,actor_id,metadata)
  values(current_order.id,'delivery_declined',p_driver_id,jsonb_build_object('rideId',p_ride_id));
  return current_order.id;
end;
$$;

-- Guard split state at the DB boundary as well as the API. The commercial
-- state is updated in the same transaction before advancing its ride.
create function private.guard_market_ride()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare current_order public.market_orders;
begin
  if tg_op='UPDATE' and old.market_order_id is distinct from new.market_order_id then
    raise exception 'Vínculo logístico do pedido é imutável.' using errcode='23514';
  end if;
  if new.market_order_id is null then return new; end if;
  select * into current_order from public.market_orders where id=new.market_order_id;
  if current_order.customer_id is distinct from new.passenger_id then
    raise exception 'Cliente não corresponde ao pedido.' using errcode='23514';
  end if;
  if (new.status='procurando_motorista' and
      (current_order.status<>'ready' or current_order.logistics_status<>'awaiting_driver' or new.driver_id is not null))
    or (new.status in ('aceita','motorista_a_caminho','motorista_chegou') and
      (current_order.status<>'ready' or current_order.logistics_status<>'assigned'
       or current_order.assigned_driver_id is distinct from new.driver_id or new.market_dispatch_source is null))
    or (new.status='em_corrida' and
      (current_order.status<>'ready' or current_order.assigned_driver_id is distinct from new.driver_id
       or current_order.logistics_status not in ('in_delivery','exception')
       or (current_order.logistics_status='exception') is distinct from (new.market_delivery_exception_at is not null)))
    or (new.status='finalizada' and (current_order.status<>'delivered' or current_order.logistics_status<>'delivered'
      or current_order.assigned_driver_id is distinct from new.driver_id))
    or (new.status='cancelada' and
      (new.termination_code is not null or current_order.logistics_status not in ('awaiting_driver','cancelled'))) then
    raise exception 'Use a transição do pedido comercial.' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_market_ride() from public,anon,authenticated;
create trigger guard_market_ride before insert or update of status,market_order_id,market_delivery_exception_at on public.rides
for each row execute function private.guard_market_ride();

-- Marketplace changes must not alter round-robin position or create a second
-- receivable in the legacy ride payment ledger.
drop trigger advance_driver_dispatch_queue on public.rides;
create trigger advance_driver_dispatch_queue after update of status on public.rides
for each row when (new.market_order_id is null) execute function private.advance_driver_dispatch_queue();
drop trigger reserve_queue_position_on_accept on public.rides;
create trigger reserve_queue_position_on_accept before update of status on public.rides
for each row when (new.market_order_id is null) execute function private.reserve_queue_position_on_accept();
drop trigger ensure_finished_ride_payment on public.rides;
create trigger ensure_finished_ride_payment after update of status on public.rides
for each row when (new.market_order_id is null) execute function private.ensure_finished_ride_payment();

create function private.reject_market_ride_payment()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists(select 1 from public.rides r where r.id=new.ride_id and r.market_order_id is not null) then
    raise exception 'Use o caixa do pedido de compras.' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function private.reject_market_ride_payment() from public,anon,authenticated;
create trigger reject_market_ride_payment before insert or update of ride_id on public.payments
for each row execute function private.reject_market_ride_payment();

drop trigger notify_ride_change on public.rides;
create trigger notify_ride_change after update of status on public.rides
for each row when (new.market_order_id is null) execute function private.notify_ride_change();

create or replace function private.notify_new_offer()
returns trigger language plpgsql security definer set search_path = '' as $$
declare is_broadcast boolean; response_seconds integer;
begin
  response_seconds := greatest(1,ceil(extract(epoch from new.expires_at-now()))::integer);
  if new.market_dispatch_source is not null then
    insert into public.notifications(user_id,type,title,body,data)
    values(new.driver_id,'ride.offer','Nova entrega de compras',
      format('Pedido pronto para retirada. Você tem %s segundos para responder.',response_seconds),
      jsonb_build_object('rideId',new.ride_id,'offerId',new.id,'source',new.market_dispatch_source));
    return new;
  end if;
  select value->>'mode'='broadcast' into is_broadcast from public.system_settings where key='dispatch';
  insert into public.notifications(user_id,type,title,body,data)
  values(new.driver_id,'ride.offer','Nova corrida',
    case when coalesce(is_broadcast,false)
      then format('Nova corrida para motoristas disponíveis. Você tem %s segundos para responder.',response_seconds)
      else format('É a sua vez. Você tem %s segundos para responder.',response_seconds) end,
    jsonb_build_object('rideId',new.ride_id,'offerId',new.id));
  return new;
end;
$$;

-- Original round-robin / broadcast function stays intact.
alter function public.dispatch_next_offer(uuid) rename to dispatch_regular_ride_offer;
create function public.dispatch_next_offer(p_ride_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
begin
  if exists(select 1 from public.rides where id=p_ride_id and market_order_id is not null) then return null; end if;
  return public.dispatch_regular_ride_offer(p_ride_id);
end;
$$;

-- Latest ordinary expiry/recovery implementation, scoped to ordinary rides.
create or replace function public.expire_ride_searches(p_ride_id uuid default null)
returns integer language plpgsql security invoker set search_path = '' as $$
declare searching record; changed_count integer := 0; offer_count_before integer; incomplete_coupon boolean; offered_driver uuid;
begin
  for searching in
    select ride.id,ride.passenger_id,ride.redispatch_started_at,ride.coupon_id,ride.discount_cents
    from public.rides ride
    where ride.status='procurando_motorista' and ride.driver_id is null and ride.market_order_id is null
      and (p_ride_id is null or ride.id=p_ride_id)
      and (exists(select 1 from public.ride_requests request where request.ride_id=ride.id)
        or ride.created_at<=now()-interval '2 minutes')
    for update of ride skip locked
  loop
    select count(*) into offer_count_before from public.ride_requests where ride_id=searching.id;
    incomplete_coupon := offer_count_before=0 and searching.coupon_id is not null and not exists(
      select 1 from public.coupon_redemptions redemption where redemption.ride_id=searching.id
        and redemption.coupon_id=searching.coupon_id and redemption.user_id=searching.passenger_id
        and redemption.discount_cents=searching.discount_cents);
    offered_driver := null;
    if not incomplete_coupon then offered_driver := public.dispatch_next_offer(searching.id); end if;
    if offered_driver is not null then
      if (select count(*) from public.ride_requests where ride_id=searching.id)>offer_count_before then
        changed_count:=changed_count+1;
      end if;
      continue;
    end if;
    if not incomplete_coupon and searching.redispatch_started_at is not null and
      now()<searching.redispatch_started_at+interval '5 minutes' then continue; end if;
    update public.rides set status='cancelada',cancelled_at=now(),
      cancellation_reason=case when incomplete_coupon then 'Reserva do cupom não foi concluída. Solicite novamente.'
        else 'Nenhum motorista elegivel aceitou a solicitacao.' end
      where id=searching.id and status='procurando_motorista';
    if offer_count_before=0 then delete from public.coupon_redemptions where ride_id=searching.id; end if;
    update public.passenger_locations set ride_id=null where passenger_id=searching.passenger_id and ride_id=searching.id;
    insert into public.ride_history(ride_id,from_status,to_status,metadata)
    values(searching.id,'procurando_motorista','cancelada',jsonb_build_object('reason',
      case when incomplete_coupon then 'request_incomplete' else 'no_driver_found' end));
    insert into public.notifications(user_id,type,title,body,data)
    values(searching.passenger_id,'ride.no_driver_found',
      case when incomplete_coupon then 'Solicitação encerrada' else 'Nenhum motorista disponível' end,
      case when incomplete_coupon then 'Não foi possível concluir a solicitação. Você pode tentar novamente.'
        else 'Nenhum outro motorista aceitou a corrida. Você pode tentar novamente.' end,
      jsonb_build_object('rideId',searching.id));
    changed_count:=changed_count+1;
  end loop;
  return changed_count;
end;
$$;

revoke all on function public.dispatch_market_order(uuid),public.dispatch_due_market_orders(integer),
  public.accept_market_delivery(uuid,uuid),public.decline_market_delivery(uuid,uuid),
  public.market_driver_delivery_action(uuid,uuid,text,text,text),public.market_admin_delivery_action(uuid,uuid,text,text),
  public.dispatch_next_offer(uuid),public.expire_ride_searches(uuid),private.market_finish_delivery(public.rides,uuid,text)
  from public,anon,authenticated;
grant execute on function public.dispatch_market_order(uuid),public.dispatch_due_market_orders(integer),
  public.accept_market_delivery(uuid,uuid),public.decline_market_delivery(uuid,uuid),
  public.market_driver_delivery_action(uuid,uuid,text,text,text),public.market_admin_delivery_action(uuid,uuid,text,text),
  public.dispatch_next_offer(uuid),public.expire_ride_searches(uuid),private.market_finish_delivery(public.rides,uuid,text)
  to service_role;
