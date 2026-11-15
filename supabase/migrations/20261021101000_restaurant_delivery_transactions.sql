-- O servidor usa exclusivamente estas operações transacionais para confirmar pedidos.
create or replace function public.create_food_order(
  p_customer_id uuid, p_restaurant_id uuid, p_idempotency_key uuid,
  p_items jsonb, p_address jsonb, p_distance_meters integer,
  p_payment_method text, p_change_for_cents integer,
  p_expected_subtotal_cents integer, p_expected_delivery_fee_cents integer
) returns public.food_orders
language plpgsql security invoker set search_path = '' as $$
declare
  setting public.delivery_settings;
  restaurant public.restaurants;
  existing public.food_orders;
  created public.food_orders;
  item jsonb;
  product public.menu_products;
  option_group public.menu_option_groups;
  chosen uuid[];
  option_record public.menu_options;
  item_options jsonb;
  unit_cents integer;
  subtotal integer := 0;
  fee integer;
  item_count integer := 0;
  local_clock time;
begin
  select * into existing from public.food_orders
  where customer_id = p_customer_id and idempotency_key = p_idempotency_key;
  if found then return existing; end if;
  if not exists (select 1 from public.passengers where profile_id = p_customer_id)
    or exists (select 1 from public.profiles where id = p_customer_id and blocked) then
    raise exception 'Cliente não autorizado.' using errcode = 'P0001';
  end if;
  select * into setting from public.delivery_settings where singleton for share;
  if setting.singleton is null or not setting.enabled then
    raise exception 'Delivery ainda não configurado.' using errcode = 'P0001';
  end if;
  select * into restaurant from public.restaurants where id = p_restaurant_id for share;
  if restaurant.id is null or restaurant.status <> 'approved' or not restaurant.accepting_orders then
    raise exception 'Restaurante indisponível.' using errcode = 'P0001';
  end if;
  local_clock := (now() at time zone 'America/Bahia')::time;
  if restaurant.opens_at is not null and restaurant.closes_at is not null and (
    (restaurant.opens_at < restaurant.closes_at and not (local_clock >= restaurant.opens_at and local_clock < restaurant.closes_at))
    or (restaurant.opens_at > restaurant.closes_at and not (local_clock >= restaurant.opens_at or local_clock < restaurant.closes_at))
    or restaurant.opens_at = restaurant.closes_at
  ) then raise exception 'Restaurante fora do horário.' using errcode = 'P0001'; end if;
  if p_distance_meters is null or p_distance_meters <= 0 or p_distance_meters > setting.max_distance_meters then
    raise exception 'Endereço fora da área de atendimento.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_address) <> 'object'
    or char_length(trim(coalesce(p_address->>'street', ''))) < 3
    or char_length(trim(coalesce(p_address->>'number', ''))) < 1
    or char_length(trim(coalesce(p_address->>'district', ''))) < 2
    or char_length(trim(coalesce(p_address->>'city', ''))) < 2
    or p_address->>'lat' is null
    or p_address->>'lng' is null
    or (p_address->>'lat')::double precision not between -90 and 90
    or (p_address->>'lng')::double precision not between -180 and 180 then
    raise exception 'Endereço incompleto ou inválido.' using errcode = 'P0001';
  end if;
  if p_payment_method not in ('cash','card_on_delivery') then
    raise exception 'Forma de pagamento indisponível.' using errcode = 'P0001';
  end if;
  if (p_payment_method = 'cash' and not setting.cash_enabled)
    or (p_payment_method = 'card_on_delivery' and not setting.card_on_delivery_enabled) then
    raise exception 'Forma de pagamento desabilitada.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then
    raise exception 'Carrinho inválido.' using errcode = 'P0001';
  end if;

  -- Bloqueia os produtos enquanto o retrato de preço é calculado.
  for item in select value from jsonb_array_elements(p_items)
  loop
    item_count := item_count + 1;
    if coalesce((item->>'quantity')::integer, 0) not between 1 and 99 then
      raise exception 'Quantidade inválida.' using errcode = 'P0001';
    end if;
    select * into product from public.menu_products
    where id = (item->>'productId')::uuid and restaurant_id = p_restaurant_id
      and available and not archived for share;
    if product.id is null then raise exception 'Produto indisponível.' using errcode = 'P0001'; end if;
    if jsonb_typeof(coalesce(item->'optionIds', '[]'::jsonb)) <> 'array' then
      raise exception 'Adicionais inválidos.' using errcode = 'P0001';
    end if;
    select coalesce(array_agg(value::uuid), array[]::uuid[]) into chosen
    from jsonb_array_elements_text(coalesce(item->'optionIds', '[]'::jsonb));
    if cardinality(chosen) <> (select count(distinct id) from unnest(chosen) id) then
      raise exception 'Adicionais repetidos.' using errcode = 'P0001';
    end if;
    unit_cents := product.price_cents;
    item_options := '[]'::jsonb;
    for option_group in select * from public.menu_option_groups where product_id = product.id order by sort_order, id
    loop
      if (select count(*) from public.menu_options where group_id = option_group.id and id = any(chosen))
         not between option_group.min_choices and option_group.max_choices then
        raise exception 'Escolhas obrigatórias ou limite de adicionais inválido.' using errcode = 'P0001';
      end if;
      for option_record in select * from public.menu_options
        where group_id = option_group.id and id = any(chosen) for share
      loop
        if not option_record.available then raise exception 'Adicional indisponível.' using errcode = 'P0001'; end if;
        unit_cents := unit_cents + option_record.price_cents;
        item_options := item_options || jsonb_build_array(jsonb_build_object(
          'id', option_record.id, 'group', option_group.name,
          'name', option_record.name, 'priceCents', option_record.price_cents));
      end loop;
    end loop;
    if jsonb_array_length(item_options) <> cardinality(chosen) then
      raise exception 'Adicional não pertence ao produto.' using errcode = 'P0001';
    end if;
    subtotal := subtotal + unit_cents * (item->>'quantity')::integer;
    if subtotal > 100000000 then raise exception 'Valor do pedido acima do limite.' using errcode = 'P0001'; end if;
  end loop;
  if subtotal < restaurant.minimum_order_cents then
    raise exception 'Pedido abaixo do mínimo do restaurante.' using errcode = 'P0001';
  end if;
  fee := greatest(setting.minimum_fee_cents, ceil(p_distance_meters::numeric * setting.per_km_cents / 1000)::integer);
  if subtotal is distinct from p_expected_subtotal_cents or fee is distinct from p_expected_delivery_fee_cents then
    raise exception 'O preço mudou. Calcule novamente antes de confirmar.' using errcode = 'P0001';
  end if;
  if p_change_for_cents is not null and (p_payment_method <> 'cash' or p_change_for_cents < subtotal + fee) then
    raise exception 'Valor para troco inválido.' using errcode = 'P0001';
  end if;
  insert into public.food_orders(customer_id, restaurant_id, idempotency_key, address, distance_meters,
    payment_method, change_for_cents, subtotal_cents, delivery_fee_cents, total_cents, restaurant_snapshot)
  values (p_customer_id, p_restaurant_id, p_idempotency_key, p_address, p_distance_meters,
    p_payment_method, p_change_for_cents, subtotal, fee, subtotal + fee,
    jsonb_build_object('name', restaurant.name, 'address', restaurant.address,
      'lat', restaurant.latitude, 'lng', restaurant.longitude))
  on conflict (customer_id, idempotency_key) do nothing returning * into created;
  if created.id is null then
    select * into created from public.food_orders
    where customer_id = p_customer_id and idempotency_key = p_idempotency_key;
    return created;
  end if;
  for item in select value from jsonb_array_elements(p_items)
  loop
    select * into product from public.menu_products where id = (item->>'productId')::uuid;
    unit_cents := product.price_cents;
    item_options := '[]'::jsonb;
    for option_record in select o.* from public.menu_options o
      where o.id in (select value::uuid from jsonb_array_elements_text(coalesce(item->'optionIds', '[]'::jsonb)))
    loop
      unit_cents := unit_cents + option_record.price_cents;
      item_options := item_options || jsonb_build_array(jsonb_build_object(
        'id', option_record.id, 'name', option_record.name, 'priceCents', option_record.price_cents));
    end loop;
    insert into public.food_order_items(order_id, product_id, name, quantity, unit_price_cents,
      options, notes, line_total_cents)
    values (created.id, product.id, product.name, (item->>'quantity')::integer, unit_cents,
      item_options, left(coalesce(item->>'notes', ''), 300), unit_cents * (item->>'quantity')::integer);
  end loop;
  insert into public.food_order_events(order_id, to_status, actor_id)
  values (created.id, 'received', p_customer_id);
  return created;
end;
$$;
revoke all on function public.create_food_order(uuid, uuid, uuid, jsonb, jsonb, integer, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.create_food_order(uuid, uuid, uuid, jsonb, jsonb, integer, text, integer, integer, integer) to service_role;

create or replace function public.accept_food_delivery(p_order_id uuid, p_driver_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare target public.food_orders; driver public.drivers;
begin
  select * into driver from public.drivers where profile_id = p_driver_id for update;
  if driver.profile_id is null or driver.approval_status <> 'approved'
    or not driver.online or not driver.available or not driver.on_shift
    or exists (select 1 from public.profiles where id = p_driver_id and blocked)
    or not exists (select 1 from public.driver_delivery_preferences where driver_id = p_driver_id and enabled)
    or exists (select 1 from public.rides where driver_id = p_driver_id and status not in ('finalizada','cancelada'))
    or exists (select 1 from public.food_orders where driver_id = p_driver_id and status in ('assigned','at_restaurant','picked_up','on_the_way'))
  then return false; end if;
  select * into target from public.food_orders where id = p_order_id for update;
  if target.id is null or target.status <> 'ready' then return false; end if;
  update public.food_orders set driver_id = p_driver_id, status = 'assigned' where id = p_order_id;
  update public.drivers set available = false where profile_id = p_driver_id;
  insert into public.food_order_events(order_id, from_status, to_status, actor_id)
  values (p_order_id, 'ready', 'assigned', p_driver_id);
  return true;
end;
$$;
revoke all on function public.accept_food_delivery(uuid, uuid) from public, anon, authenticated;
grant execute on function public.accept_food_delivery(uuid, uuid) to service_role;

create or replace function public.release_food_delivery(p_order_id uuid, p_driver_id uuid, p_reason text)
returns public.food_orders language plpgsql security invoker set search_path = '' as $$
declare target public.food_orders; previous_status text;
begin
  perform 1 from public.drivers where profile_id = p_driver_id for update;
  select * into target from public.food_orders where id = p_order_id for update;
  if target.id is null or target.driver_id <> p_driver_id or target.status not in ('assigned','at_restaurant')
    or char_length(trim(coalesce(p_reason,''))) < 3 then
    raise exception 'Não é possível devolver esta entrega.' using errcode = 'P0001';
  end if;
  previous_status := target.status;
  delete from public.food_delivery_locations where order_id = p_order_id;
  delete from public.food_pickup_confirmations where order_id = p_order_id;
  update public.food_orders set status = 'ready', driver_id = null where id = p_order_id returning * into target;
  update public.drivers d set available = d.online and d.on_shift and not d.queue_paused
    and not exists (select 1 from public.rides r where r.driver_id = d.profile_id and r.status not in ('finalizada','cancelada'))
    where d.profile_id = p_driver_id;
  insert into public.food_order_events(order_id, from_status, to_status, actor_id, note)
  values (p_order_id, previous_status, 'ready', p_driver_id, p_reason);
  return target;
end;
$$;
revoke all on function public.release_food_delivery(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.release_food_delivery(uuid, uuid, text) to service_role;

create or replace function public.transition_food_order(p_order_id uuid, p_actor_id uuid, p_to_status text, p_note text default null)
returns public.food_orders language plpgsql security invoker set search_path = '' as $$
declare target public.food_orders; actor_role public.user_role; allowed boolean := false;
begin
  select * into target from public.food_orders where id = p_order_id for update;
  if target.id is null then raise exception 'Pedido não encontrado.' using errcode = 'P0001'; end if;
  select role into actor_role from public.profiles where id = p_actor_id and not blocked;
  if actor_role is null then raise exception 'Usuário não autorizado.' using errcode = 'P0001'; end if;
  if p_to_status = 'cancelled' and target.status = 'received' and p_actor_id = target.customer_id then allowed := true; end if;
  if exists (select 1 from public.restaurant_staff
    where restaurant_id = target.restaurant_id and user_id = p_actor_id) then
    allowed := allowed or (target.status = 'received' and p_to_status in ('accepted','rejected'))
      or (target.status = 'accepted' and p_to_status = 'preparing')
      or (target.status = 'preparing' and p_to_status = 'ready');
  end if;
  if p_actor_id = target.driver_id then
    allowed := allowed or (target.status = 'assigned' and p_to_status = 'at_restaurant')
      or (target.status = 'at_restaurant' and p_to_status = 'picked_up')
      or (target.status = 'picked_up' and p_to_status = 'on_the_way')
      or (target.status = 'on_the_way' and p_to_status = 'delivered');
  end if;
  if actor_role = 'admin' then
    allowed := allowed or (target.status not in ('delivered','cancelled','rejected','delivery_failed')
      and p_to_status in ('cancelled','delivery_failed'));
  end if;
  if not allowed then raise exception 'Transição de pedido não permitida.' using errcode = 'P0001'; end if;
  if target.status = 'at_restaurant' and p_to_status = 'picked_up'
    and not exists (select 1 from public.food_pickup_confirmations where order_id = p_order_id) then
    raise exception 'Restaurante ainda não confirmou a retirada.' using errcode = 'P0001';
  end if;
  if p_to_status in ('cancelled','rejected','delivery_failed') and char_length(trim(coalesce(p_note,''))) < 3 then
    raise exception 'Informe o motivo.' using errcode = 'P0001';
  end if;
  update public.food_orders set status = p_to_status,
    cancellation_reason = case when p_to_status in ('cancelled','rejected','delivery_failed') then p_note else cancellation_reason end,
    completed_at = case when p_to_status = 'delivered' then now() else completed_at end
  where id = p_order_id returning * into target;
  insert into public.food_order_events(order_id, from_status, to_status, actor_id, note)
  values (p_order_id, (select from_status from (values
    (case p_to_status when 'accepted' then 'received' when 'rejected' then 'received'
      when 'preparing' then 'accepted' when 'ready' then 'preparing'
      when 'at_restaurant' then 'assigned' when 'picked_up' then 'at_restaurant'
      when 'on_the_way' then 'picked_up' when 'delivered' then 'on_the_way'
      else null end)) s(from_status)), p_to_status, p_actor_id, p_note);
  if p_to_status in ('delivered','cancelled','delivery_failed') and target.driver_id is not null then
    update public.drivers d set available = d.online and d.on_shift and not d.queue_paused
      and not exists (select 1 from public.rides r where r.driver_id = d.profile_id and r.status not in ('finalizada','cancelada'))
    where d.profile_id = target.driver_id;
  end if;
  return target;
end;
$$;
revoke all on function public.transition_food_order(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.transition_food_order(uuid, uuid, text, text) to service_role;

create or replace function public.confirm_food_pickup(p_order_id uuid, p_actor_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare target public.food_orders;
begin
  select * into target from public.food_orders where id = p_order_id for update;
  if target.id is null or target.status <> 'at_restaurant'
    or not exists (select 1 from public.restaurant_staff where restaurant_id = target.restaurant_id and user_id = p_actor_id)
    or exists (select 1 from public.profiles where id = p_actor_id and blocked) then
    raise exception 'Confirmação de retirada não permitida.' using errcode = 'P0001';
  end if;
  insert into public.food_pickup_confirmations(order_id, actor_id)
  values (p_order_id, p_actor_id) on conflict (order_id) do nothing;
  return true;
end;
$$;
revoke all on function public.confirm_food_pickup(uuid, uuid) from public, anon, authenticated;
grant execute on function public.confirm_food_pickup(uuid, uuid) to service_role;

create or replace function public.confirm_food_payment(p_order_id uuid, p_actor_id uuid)
returns public.food_orders language plpgsql security invoker set search_path = '' as $$
declare target public.food_orders; actor_role public.user_role;
begin
  select * into target from public.food_orders where id = p_order_id for update;
  if target.id is null then raise exception 'Pedido não encontrado.' using errcode = 'P0001'; end if;
  select role into actor_role from public.profiles where id = p_actor_id and not blocked;
  if actor_role is null or not (
    p_actor_id = target.driver_id or actor_role = 'admin'
    or exists (select 1 from public.restaurant_staff where restaurant_id = target.restaurant_id and user_id = p_actor_id)
  ) then raise exception 'Sem permissão para confirmar o recebimento.' using errcode = 'P0001'; end if;
  if target.payment_status = 'paid' then return target; end if;
  if target.status <> 'delivered' or target.payment_status <> 'pending' then
    raise exception 'Pagamento não pode ser confirmado neste estado.' using errcode = 'P0001';
  end if;
  insert into public.food_payment_events(order_id, actor_id, event_type, amount_cents, method)
  values (p_order_id, p_actor_id, 'collected', target.total_cents, target.payment_method);
  update public.food_orders set payment_status = 'paid' where id = p_order_id returning * into target;
  return target;
end;
$$;
revoke all on function public.confirm_food_payment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.confirm_food_payment(uuid, uuid) to service_role;

create or replace function public.food_order_metrics(p_restaurant_id uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'received', count(*) filter (where status = 'received'),
    'preparing', count(*) filter (where status in ('accepted','preparing')),
    'ready', count(*) filter (where status = 'ready'),
    'inDelivery', count(*) filter (where status in ('assigned','at_restaurant','picked_up','on_the_way')),
    'delivered', count(*) filter (where status = 'delivered'),
    'cancelled', count(*) filter (where status in ('cancelled','rejected','delivery_failed')),
    'salesTodayCents', coalesce(sum(total_cents) filter (where status = 'delivered' and (completed_at at time zone 'America/Bahia')::date = (now() at time zone 'America/Bahia')::date), 0),
    'salesMonthCents', coalesce(sum(total_cents) filter (where status = 'delivered' and date_trunc('month', completed_at at time zone 'America/Bahia') = date_trunc('month', now() at time zone 'America/Bahia')), 0),
    'unpaidCents', coalesce(sum(total_cents) filter (where status = 'delivered' and payment_status = 'pending'), 0)
  ) from public.food_orders where p_restaurant_id is null or restaurant_id = p_restaurant_id;
$$;
revoke all on function public.food_order_metrics(uuid) from public, anon, authenticated;
grant execute on function public.food_order_metrics(uuid) to service_role;

-- Corrida e entrega partilham o bloqueio da linha do motorista.
create or replace function private.guard_ride_vs_food_delivery()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.driver_id is not null and (tg_op = 'INSERT' or old.driver_id is distinct from new.driver_id) then
    perform 1 from public.drivers where profile_id = new.driver_id for update;
    if exists (select 1 from public.food_orders
      where driver_id = new.driver_id and status in ('assigned','at_restaurant','picked_up','on_the_way')) then
      raise exception 'Motorista está em entrega de restaurante.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_ride_vs_food_delivery before insert or update of driver_id on public.rides
for each row execute function private.guard_ride_vs_food_delivery();

create or replace function private.guard_driver_delivery_availability()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.available or not new.online) and exists (select 1 from public.food_orders
    where driver_id = new.profile_id and status in ('assigned','at_restaurant','picked_up','on_the_way')) then
    raise exception 'Motorista com entrega ativa.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger guard_driver_delivery_availability before update of online, available on public.drivers
for each row execute function private.guard_driver_delivery_availability();
