-- ETAPA 7: pagamentos em dinheiro, gratuidade e resgate concorrente de cupons.
-- Sem backfill ou alteração de valores de corridas existentes.
alter table public.rides drop constraint if exists rides_fare_cents_check;
alter table public.rides add constraint rides_fare_cents_check check (fare_cents >= 0);
alter table public.rides alter column payment_method set default 'cash';
alter table public.passengers alter column default_payment_method set default 'cash';

alter table public.coupons
  add column if not exists usage_limit integer check (usage_limit is null or usage_limit > 0);

drop trigger if exists coupons_updated on public.coupons;
create trigger coupons_updated before update on public.coupons
for each row execute function private.set_updated_at();

create or replace function private.validate_coupon_redemption()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  coupon public.coupons;
  ride public.rides;
  expected_discount integer;
  used_count integer;
begin
  select * into coupon from public.coupons where id = new.coupon_id for update;
  select * into ride from public.rides where id = new.ride_id;
  if coupon.id is null or ride.id is null or not coupon.active
    or (coupon.starts_at is not null and coupon.starts_at > now())
    or (coupon.ends_at is not null and coupon.ends_at < now()) then
    raise exception 'Cupom indisponivel' using errcode = 'P0001';
  end if;
  if ride.passenger_id <> new.user_id or ride.coupon_id <> coupon.id
    or ride.coupon_code <> coupon.code
    or ride.original_fare_cents is null
    or ride.original_fare_cents < coupon.min_fare_cents then
    raise exception 'Cupom nao corresponde a corrida' using errcode = 'P0001';
  end if;
  expected_discount := case coupon.discount_type
    when 'fixed' then coupon.discount_value
    else round(ride.original_fare_cents::numeric * coupon.discount_value / 100)::integer
  end;
  expected_discount := least(expected_discount, coalesce(coupon.max_discount_cents, expected_discount), ride.original_fare_cents);
  if expected_discount <= 0 or new.discount_cents <> expected_discount
    or ride.discount_cents <> expected_discount
    or ride.fare_cents <> ride.original_fare_cents - expected_discount then
    raise exception 'Desconto do cupom mudou; calcule novamente' using errcode = 'P0001';
  end if;
  select count(*) into used_count from public.coupon_redemptions where coupon_id = coupon.id;
  if coupon.usage_limit is not null and used_count >= coupon.usage_limit then
    raise exception 'Limite do cupom atingido' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.validate_coupon_redemption() from public;
drop trigger if exists validate_coupon_redemption on public.coupon_redemptions;
create trigger validate_coupon_redemption before insert on public.coupon_redemptions
for each row execute function private.validate_coupon_redemption();

create or replace function private.ensure_finished_ride_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  amount integer;
  created_payment_id uuid;
begin
  if new.status = 'finalizada' and old.status is distinct from new.status then
    amount := coalesce(new.final_fare_cents, new.fare_cents);
    if amount = 0 then
      if exists (select 1 from public.payments where ride_id = new.id) then
        raise exception 'Corrida gratuita ja possui cobranca' using errcode = 'P0001';
      end if;
      update public.rides set payment_status = 'pago' where id = new.id;
      insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
      values (new.driver_id, 'payment.waived', 'ride', new.id::text,
        jsonb_build_object('original_fare_cents', new.original_fare_cents, 'discount_cents', new.discount_cents, 'final_fare_cents', 0));
    else
      insert into public.payments(ride_id, passenger_id, method, status, amount_cents)
      values (new.id, new.passenger_id, new.payment_method, 'aguardando_pagamento', amount)
      on conflict (ride_id) do nothing returning id into created_payment_id;
      if created_payment_id is not null then
        insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
        values (new.driver_id, 'payment.created', 'payment', created_payment_id::text,
          jsonb_build_object('ride_id', new.id, 'method', new.payment_method, 'amount_cents', amount));
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.confirm_cash_payment(p_ride_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  ride public.rides;
  payment public.payments;
  actor_role public.user_role;
begin
  select * into ride from public.rides where id = p_ride_id for update;
  if ride.id is null then raise exception 'Corrida nao encontrada' using errcode = 'P0001'; end if;
  select role into actor_role from public.profiles where id = p_actor_id and not blocked;
  if not ((actor_role = 'driver' and ride.driver_id = p_actor_id) or actor_role = 'admin') then
    raise exception 'Ator sem permissao para confirmar dinheiro' using errcode = 'P0001';
  end if;
  if ride.status <> 'finalizada' or ride.payment_method <> 'cash'
    or coalesce(ride.final_fare_cents, ride.fare_cents) <= 0 then
    raise exception 'Corrida nao admite confirmacao em dinheiro' using errcode = 'P0001';
  end if;
  select * into payment from public.payments where ride_id = ride.id for update;
  if payment.id is null or payment.passenger_id <> ride.passenger_id
    or payment.method <> 'cash'
    or payment.amount_cents <> coalesce(ride.final_fare_cents, ride.fare_cents) then
    raise exception 'Pagamento nao corresponde a corrida' using errcode = 'P0001';
  end if;
  if payment.status = 'pago' then
    return jsonb_build_object('paymentId', payment.id, 'duplicate', true);
  end if;
  if payment.status <> 'aguardando_pagamento' then
    raise exception 'Pagamento nao esta pendente' using errcode = 'P0001';
  end if;
  update public.payments set status = 'pago', paid_at = now() where id = payment.id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (p_actor_id, 'payment.cash.confirmed', 'payment', payment.id::text,
    jsonb_build_object('ride_id', ride.id, 'amount_cents', payment.amount_cents));
  return jsonb_build_object('paymentId', payment.id, 'duplicate', false);
end;
$$;

revoke all on function public.confirm_cash_payment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.confirm_cash_payment(uuid, uuid) to service_role;

create or replace function private.prevent_financial_reassignment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.ride_id is distinct from new.ride_id
    or old.passenger_id is distinct from new.passenger_id
    or old.method is distinct from new.method
    or old.amount_cents is distinct from new.amount_cents then
    raise exception 'Vinculo financeiro imutavel' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_financial_reassignment() from public;
drop trigger if exists prevent_financial_reassignment on public.payments;
create trigger prevent_financial_reassignment before update on public.payments
for each row execute function private.prevent_financial_reassignment();

comment on function public.confirm_cash_payment(uuid, uuid) is
  'Confirma dinheiro atomicamente para motorista vinculado ou administrador; repeticoes nao duplicam auditoria.';

-- Preserva o lifecycle existente e permite valor final zero em tarifa regional com cupom integral.
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
    calculated_fare := greatest(0, coalesce(current_ride.estimated_fare_cents, current_ride.fare_cents));
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
