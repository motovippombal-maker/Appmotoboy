-- Marketplace comercial. As corridas e entregas avulsas permanecem independentes.
create table public.market_stores (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 90),
  name text not null check (length(btrim(name)) between 2 and 100),
  description text not null default '' check (length(description) <= 1000),
  category text not null check (length(btrim(category)) between 2 and 60),
  image_url text check (length(image_url) <= 2000),
  cover_url text check (length(cover_url) <= 2000),
  address text not null check (length(btrim(address)) between 5 and 240),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  city text not null default 'Ribeira do Pombal' check (length(btrim(city)) between 2 and 100),
  state text not null default 'BA' check (state ~ '^[A-Z]{2}$'),
  service_area_id uuid references public.service_areas(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','approved','suspended')),
  active boolean not null default true,
  is_open boolean not null default false,
  prep_minutes integer check (prep_minutes between 1 and 240),
  hours jsonb not null default '{}'::jsonb check (jsonb_typeof(hours) = 'object'),
  preferred_driver_id uuid references public.drivers(profile_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.market_store_members (
  store_id uuid not null references public.market_stores(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner','manager')),
  created_at timestamptz not null default now(),
  primary key (store_id,user_id)
);
create index market_store_members_user_idx on public.market_store_members(user_id,store_id);

create table public.market_categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.market_stores(id) on delete restrict,
  name text not null check (length(btrim(name)) between 2 and 100),
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order between 0 and 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id,id)
);
create index market_categories_store_idx on public.market_categories(store_id,sort_order,id);

create table public.market_products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.market_stores(id) on delete restrict,
  category_id uuid,
  name text not null check (length(btrim(name)) between 2 and 100),
  description text not null default '' check (length(description) <= 1000),
  image_url text check (length(image_url) <= 2000),
  price_cents integer not null check (price_cents between 0 and 10000000),
  stock_quantity integer check (stock_quantity >= 0),
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order between 0 and 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id,id),
  foreign key (store_id,category_id) references public.market_categories(store_id,id)
);
create index market_products_store_idx on public.market_products(store_id,category_id,sort_order,id);

create table public.market_option_groups (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.market_stores(id) on delete restrict,
  product_id uuid not null,
  name text not null check (length(btrim(name)) between 2 and 100),
  min_select integer not null default 0 check (min_select between 0 and 50),
  max_select integer not null default 1 check (max_select between 1 and 50),
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order between 0 and 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id,id),
  foreign key (store_id,product_id) references public.market_products(store_id,id),
  check (min_select <= max_select)
);
create index market_option_groups_product_idx on public.market_option_groups(store_id,product_id,sort_order,id);

create table public.market_options (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.market_stores(id) on delete restrict,
  group_id uuid not null,
  name text not null check (length(btrim(name)) between 2 and 100),
  price_cents integer not null default 0 check (price_cents between 0 and 10000000),
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order between 0 and 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (store_id,group_id) references public.market_option_groups(store_id,id)
);
create index market_options_group_idx on public.market_options(store_id,group_id,sort_order,id);

create table public.market_orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.market_stores(id) on delete restrict,
  customer_id uuid not null references public.passengers(profile_id) on delete restrict,
  assigned_driver_id uuid references public.drivers(profile_id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','preparing','ready','delivered','rejected','cancelled')),
  logistics_status text not null default 'not_requested' check (
    logistics_status in ('not_requested','awaiting_driver','assigned','in_delivery','delivered','exception','cancelled')
  ),
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  catalog_fingerprint text not null check (catalog_fingerprint ~ '^[a-f0-9]{64}$'),
  store_name text not null,
  pickup_address text not null check (length(pickup_address) between 5 and 240),
  pickup_lat double precision not null check (pickup_lat between -90 and 90),
  pickup_lng double precision not null check (pickup_lng between -180 and 180),
  destination_address text not null check (length(btrim(destination_address)) between 5 and 240),
  destination_lat double precision not null check (destination_lat between -90 and 90),
  destination_lng double precision not null check (destination_lng between -180 and 180),
  recipient_name text not null check (length(btrim(recipient_name)) between 2 and 100),
  recipient_phone text not null check (public.normalize_brazilian_phone(recipient_phone) is not null and recipient_phone = public.normalize_brazilian_phone(recipient_phone)),
  delivery_notes text check (length(delivery_notes) <= 300),
  prep_minutes integer check (prep_minutes between 1 and 240),
  estimated_distance_meters integer check (estimated_distance_meters > 0),
  estimated_duration_seconds integer check (estimated_duration_seconds > 0),
  route_geometry text check (length(route_geometry) <= 1000000),
  subtotal_cents integer not null check (subtotal_cents between 0 and 100000000),
  freight_cents integer not null check (freight_cents between 0 and 100000000),
  discount_cents integer not null default 0 check (discount_cents between 0 and subtotal_cents + freight_cents),
  total_cents integer not null check (total_cents = subtotal_cents + freight_cents - discount_cents),
  platform_fee_cents integer not null default 0 check (platform_fee_cents between 0 and freight_cents),
  payment_method text not null default 'cash' check (payment_method = 'cash'),
  fare_rule_snapshot jsonb not null check (jsonb_typeof(fare_rule_snapshot) = 'object'),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id,idempotency_key)
);
create index market_orders_customer_idx on public.market_orders(customer_id,created_at desc,id);
create index market_orders_store_idx on public.market_orders(store_id,created_at desc,id);
create index market_orders_driver_idx on public.market_orders(assigned_driver_id,created_at desc,id) where assigned_driver_id is not null;
create index market_orders_pending_expiry_idx on public.market_orders(expires_at,id) where status = 'pending';

create table public.market_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.market_orders(id) on delete restrict,
  product_id uuid not null references public.market_products(id) on delete restrict,
  product_name text not null,
  quantity integer not null check (quantity between 1 and 99),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  line_total_cents integer not null check (line_total_cents >= 0)
);
create index market_order_items_order_idx on public.market_order_items(order_id,id);

create table public.market_stock_reservations (
  order_id uuid not null references public.market_orders(id) on delete restrict,
  product_id uuid not null references public.market_products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  released_at timestamptz,
  consumed_at timestamptz,
  check (released_at is null or consumed_at is null),
  primary key (order_id,product_id)
);
create index market_stock_active_product_idx on public.market_stock_reservations(product_id)
  where released_at is null and consumed_at is null;

create table public.market_order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.market_orders(id) on delete restrict,
  event_type text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);
create index market_order_events_order_idx on public.market_order_events(order_id,id);

create table public.market_cash_payments (
  order_id uuid primary key references public.market_orders(id) on delete restrict,
  amount_cents integer not null check (amount_cents >= 0),
  store_due_cents integer not null check (store_due_cents >= 0),
  driver_due_cents integer not null check (driver_due_cents >= 0),
  platform_due_cents integer not null default 0 check (platform_due_cents >= 0),
  received_by uuid references public.profiles(id) on delete restrict,
  received_at timestamptz,
  receipt_note text check (length(receipt_note) <= 300),
  settled_by uuid references public.profiles(id) on delete restrict,
  settled_at timestamptz,
  settlement_note text check (length(settlement_note) <= 300),
  check (amount_cents = store_due_cents + driver_due_cents + platform_due_cents),
  check ((received_at is null) = (received_by is null)),
  check ((settled_at is null) = (settled_by is null)),
  check (settled_at is null or (received_at is not null and settled_at >= received_at))
);

create trigger market_stores_updated before update on public.market_stores for each row execute function private.set_updated_at();
create trigger market_categories_updated before update on public.market_categories for each row execute function private.set_updated_at();
create trigger market_products_updated before update on public.market_products for each row execute function private.set_updated_at();
create trigger market_option_groups_updated before update on public.market_option_groups for each row execute function private.set_updated_at();
create trigger market_options_updated before update on public.market_options for each row execute function private.set_updated_at();
create trigger market_orders_updated before update on public.market_orders for each row execute function private.set_updated_at();

-- A mudança de modo de estoque não pode perder as reservas abertas de um produto.
create function private.market_guard_stock_mode()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (old.stock_quantity is null) is distinct from (new.stock_quantity is null) and exists (
    select 1 from public.market_stock_reservations where product_id = old.id
      and released_at is null and consumed_at is null
  ) then raise exception 'MARKET_STOCK_MODE_RESERVED'; end if;
  return new;
end;
$$;
create trigger market_products_stock_mode before update of stock_quantity on public.market_products
  for each row execute function private.market_guard_stock_mode();
revoke all on function private.market_guard_stock_mode() from public,anon,authenticated;

create function private.market_hours_valid(p_hours jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare day record; slot jsonb;
begin
  if p_hours is null or jsonb_typeof(p_hours) <> 'object' then return false; end if;
  for day in select key,value from jsonb_each(p_hours) loop
    if day.key !~ '^[1-7]$' or jsonb_typeof(day.value) <> 'array' then return false; end if;
    if jsonb_array_length(day.value) > 12 then return false; end if;
    for slot in select value from jsonb_array_elements(day.value) loop
      if jsonb_typeof(slot) <> 'object'
        or not coalesce((slot->>'open') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$',false)
        or not coalesce((slot->>'close') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$',false)
        or slot->>'open' = slot->>'close' then return false; end if;
    end loop;
  end loop;
  return true;
end;
$$;
alter table public.market_stores add constraint market_store_hours_valid check (private.market_hours_valid(hours));
revoke all on function private.market_hours_valid(jsonb) from public,anon,authenticated;
grant execute on function private.market_hours_valid(jsonb) to service_role;

create function private.market_store_open_at(s public.market_stores, p_now timestamptz)
returns boolean language plpgsql stable set search_path = '' as $$
declare local_now timestamp; day text; previous_day text; current_time_text text; slot jsonb;
begin
  if s.id is null or not (s.active and s.is_open and s.status = 'approved') then return false; end if;
  if s.hours = '{}'::jsonb then return true; end if;
  local_now := p_now at time zone 'America/Bahia';
  day := extract(isodow from local_now)::integer::text;
  previous_day := (extract(isodow from local_now - interval '1 day')::integer)::text;
  current_time_text := to_char(local_now,'HH24:MI');
  for slot in select value from jsonb_array_elements(coalesce(s.hours->day,'[]'::jsonb)) loop
    if slot->>'open' <= current_time_text
      and (slot->>'close' < slot->>'open' or current_time_text < slot->>'close') then return true; end if;
  end loop;
  for slot in select value from jsonb_array_elements(coalesce(s.hours->previous_day,'[]'::jsonb)) loop
    if slot->>'close' < slot->>'open' and current_time_text < slot->>'close' then return true; end if;
  end loop;
  return false;
end;
$$;
revoke all on function private.market_store_open_at(public.market_stores,timestamptz) from public,anon,authenticated;

create function public.market_store_open(p_store_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select private.market_store_open_at(s,now()) from public.market_stores s where s.id = p_store_id),false)
$$;
create function public.market_store_open_statuses(p_store_ids uuid[])
returns table (id uuid,is_open boolean) language sql stable security definer set search_path = '' as $$
  select s.id,private.market_store_open_at(s,now()) from public.market_stores s
  where s.id = any(p_store_ids) and s.status = 'approved' and s.active
$$;

create function private.market_cart_snapshot(p_store_id uuid,p_cart jsonb,p_lock boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.market_stores;
  p public.market_products;
  line jsonb;
  entries jsonb := '[]'::jsonb;
  selected_options jsonb;
  product_ids uuid[];
  option_ids uuid[];
  option_count integer;
  valid_count integer;
  quantity integer;
  addons bigint;
  line_total bigint;
  subtotal bigint := 0;
  problem record;
begin
  select * into s from public.market_stores where id = p_store_id;
  if not private.market_store_open_at(s,clock_timestamp()) then raise exception 'MARKET_STORE_CLOSED'; end if;
  if p_cart is null or jsonb_typeof(p_cart) <> 'array' then raise exception 'MARKET_CART_INVALID'; end if;
  if jsonb_array_length(p_cart) not between 1 and 50 then raise exception 'MARKET_CART_INVALID'; end if;
  for line in select value from jsonb_array_elements(p_cart) loop
    if jsonb_typeof(line) <> 'object'
      or not coalesce((line->>'productId') ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$',false)
      or jsonb_typeof(line->'quantity') is distinct from 'number'
      or not coalesce((line->>'quantity') ~ '^[1-9][0-9]?$',false)
      or jsonb_typeof(line->'optionIds') is distinct from 'array' then raise exception 'MARKET_CART_INVALID'; end if;
    if jsonb_array_length(line->'optionIds') > 50 or exists (
      select 1 from jsonb_array_elements_text(line->'optionIds') v(val)
        where not coalesce(val ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$',false)
    ) then raise exception 'MARKET_OPTIONS_INVALID'; end if;
  end loop;
  select array_agg(distinct (v.value->>'productId')::uuid) into product_ids from jsonb_array_elements(p_cart) v(value);
  if p_lock then
    -- O lock da loja em checkout ordena as compras da mesma loja. Os locks de
    -- catálogo impedem alteração dos dados efetivamente cotados até o commit.
    perform 1 from public.market_products
      where store_id = p_store_id and id = any(product_ids) order by id for update;
    perform 1 from public.market_categories c
      where c.store_id = p_store_id and exists (select 1 from public.market_products p1
        where p1.store_id = c.store_id and p1.category_id = c.id and p1.id = any(product_ids)) order by c.id for share;
    perform 1 from public.market_option_groups g
      where g.store_id = p_store_id and g.product_id = any(product_ids) order by g.id for share;
    perform 1 from public.market_options o
      where o.store_id = p_store_id and exists (select 1 from public.market_option_groups g
        where g.store_id = o.store_id and g.id = o.group_id and g.product_id = any(product_ids)) order by o.id for share;
  end if;
  for problem in
    select (entry.value->>'productId')::uuid as product_id, sum((entry.value->>'quantity')::integer) as requested
      from jsonb_array_elements(p_cart) entry(value) group by (entry.value->>'productId')::uuid
  loop
    select * into p from public.market_products where id = problem.product_id and store_id = p_store_id and active;
    if not found or (p.category_id is not null and not exists (
      select 1 from public.market_categories where store_id = p_store_id and id = p.category_id and active
    )) then raise exception 'MARKET_PRODUCT_UNAVAILABLE'; end if;
    if p.stock_quantity is not null and p.stock_quantity < problem.requested then raise exception 'MARKET_STOCK_UNAVAILABLE'; end if;
  end loop;
  for line in select value from jsonb_array_elements(p_cart) loop
    select * into p from public.market_products where id = (line->>'productId')::uuid and store_id = p_store_id;
    quantity := (line->>'quantity')::integer;
    select array_agg(val::uuid order by val::uuid),count(*),count(distinct val::uuid)
      into option_ids,option_count,valid_count from jsonb_array_elements_text(line->'optionIds') v(val);
    if option_count <> valid_count then raise exception 'MARKET_OPTIONS_INVALID'; end if;
    select count(*),coalesce(sum(o.price_cents),0),
      coalesce(jsonb_agg(jsonb_build_object(
        'id',o.id,'groupId',g.id,'groupName',g.name,'name',o.name,'priceCents',o.price_cents
      ) order by o.id),'[]'::jsonb)
      into valid_count,addons,selected_options
      from public.market_options o join public.market_option_groups g on (g.store_id,g.id) = (o.store_id,o.group_id)
      where o.store_id = p_store_id and g.product_id = p.id and o.active and g.active and o.id = any(option_ids);
    if option_count <> valid_count or exists (
      select 1 from public.market_option_groups g where g.store_id = p_store_id and g.product_id = p.id and g.active
        and (select count(*) from public.market_options o where o.store_id = p_store_id
          and o.group_id = g.id and o.active and o.id = any(option_ids)) not between g.min_select and g.max_select
    ) then raise exception 'MARKET_OPTIONS_INVALID'; end if;
    line_total := (p.price_cents::bigint + addons) * quantity;
    subtotal := subtotal + line_total;
    if subtotal > 100000000 then raise exception 'MARKET_TOTAL_INVALID'; end if;
    entries := entries || jsonb_build_array(jsonb_build_object(
      'productId',p.id,'productName',p.name,'quantity',quantity,
      'unitPriceCents',p.price_cents,'options',selected_options,'lineTotalCents',line_total
    ));
  end loop;
  return jsonb_build_object(
    'cartFingerprint',encode(sha256(convert_to(jsonb_build_object(
      'items',entries,'storeName',s.name,'prepMinutes',s.prep_minutes,
      'pickupAddress',s.address,'pickupLat',s.latitude,'pickupLng',s.longitude,'storeServiceAreaId',s.service_area_id
    )::text,'UTF8')),'hex'),
    'subtotalCents',subtotal,'items',entries,
    'store',jsonb_build_object('id',s.id,'slug',s.slug,'name',s.name,'address',s.address,'latitude',s.latitude,
      'longitude',s.longitude,'prep_minutes',s.prep_minutes,'service_area_id',s.service_area_id)
  );
end;
$$;
revoke all on function private.market_cart_snapshot(uuid,jsonb,boolean) from public,anon,authenticated;

create function public.market_quote_catalog(p_store_id uuid,p_cart jsonb)
returns jsonb language sql security definer set search_path = '' as $$
  select private.market_cart_snapshot(p_store_id,p_cart,false)
$$;

-- O servidor calcula e autentica a cotação regional. O banco compara os
-- registros da regra cotada, o ponto de retirada e o catálogo sob lock.
create function public.market_checkout(
  p_customer_id uuid,p_store_id uuid,p_idempotency_key uuid,p_request_fingerprint text,
  p_cart jsonb,p_catalog_fingerprint text,p_pickup jsonb,p_delivery jsonb,p_fare jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.market_stores;
  previous public.market_orders;
  new_order_id uuid;
  catalog jsonb;
  items jsonb;
  item jsonb;
  rule jsonb;
  subtotal integer;
  freight integer;
  recipient_phone text;
  reservation record;
  day_revision timestamptz;
begin
  if not exists (select 1 from public.profiles where id = p_customer_id and role = 'passenger' and not blocked)
    then raise exception 'MARKET_FORBIDDEN'; end if;
  if p_idempotency_key is null or not coalesce(p_request_fingerprint ~ '^[a-f0-9]{64}$',false)
    then raise exception 'MARKET_CART_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('market-checkout:' || p_customer_id::text || ':' || p_idempotency_key::text,0));
  select * into previous from public.market_orders where customer_id = p_customer_id and idempotency_key = p_idempotency_key;
  if found then
    if previous.request_fingerprint is distinct from p_request_fingerprint or previous.store_id is distinct from p_store_id
      then raise exception 'MARKET_IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('orderId',previous.id,'reused',true);
  end if;

  select * into s from public.market_stores where id = p_store_id for update;
  if not private.market_store_open_at(s,clock_timestamp()) then raise exception 'MARKET_STORE_CLOSED'; end if;
  if s.address is distinct from p_pickup->>'address'
    or s.latitude is distinct from (p_pickup->>'lat')::double precision
    or s.longitude is distinct from (p_pickup->>'lng')::double precision
    then raise exception 'MARKET_LOCATION_CHANGED'; end if;
  if jsonb_typeof(p_delivery) is distinct from 'object'
    or not coalesce(length(btrim(p_delivery->>'address')) between 5 and 240,false)
    or not coalesce(length(btrim(p_delivery->>'recipientName')) between 2 and 100,false)
    or coalesce(length(p_delivery->>'notes'),0) > 300
    or jsonb_typeof(p_delivery->'lat') is distinct from 'number'
    or jsonb_typeof(p_delivery->'lng') is distinct from 'number'
    or not coalesce((p_delivery->>'lat')::double precision between -90 and 90,false)
    or not coalesce((p_delivery->>'lng')::double precision between -180 and 180,false)
    then raise exception 'MARKET_DELIVERY_INVALID'; end if;
  recipient_phone := public.normalize_brazilian_phone(p_delivery->>'recipientPhone');
  if recipient_phone is null then raise exception 'MARKET_DELIVERY_INVALID'; end if;

  rule := p_fare->'ruleSnapshot';
  if jsonb_typeof(rule) is distinct from 'object'
    or not coalesce((p_fare->>'freightCents') ~ '^(0|[1-9][0-9]{0,8})$',false)
    or (p_fare->>'discountCents') is distinct from '0'
    then raise exception 'MARKET_FARE_CHANGED'; end if;
  freight := (p_fare->>'freightCents')::integer;
  if freight > 100000000 or (rule->>'amountCents') is distinct from freight::text
    then raise exception 'MARKET_FARE_CHANGED'; end if;
  if s.service_area_id is not null and s.service_area_id is distinct from (rule->>'serviceAreaId')::uuid
    then raise exception 'MARKET_OUTSIDE_AREA'; end if;
  select updated_at into day_revision from public.fare_regions
    where id = (rule->>'regionId')::uuid and active and amount_cents = freight for share;
  if day_revision is null or day_revision is distinct from (rule->>'regionUpdatedAt')::timestamptz
    then raise exception 'MARKET_FARE_CHANGED'; end if;
  select updated_at into day_revision from public.service_areas
    where id = (rule->>'originServiceAreaId')::uuid and active and allow_origins for share;
  if day_revision is null or day_revision is distinct from (rule->>'originServiceAreaUpdatedAt')::timestamptz
    then raise exception 'MARKET_FARE_CHANGED'; end if;
  select updated_at into day_revision from public.service_areas
    where id = (rule->>'serviceAreaId')::uuid and active and allow_destinations for share;
  if day_revision is null or day_revision is distinct from (rule->>'serviceAreaUpdatedAt')::timestamptz
    then raise exception 'MARKET_FARE_CHANGED'; end if;
  catalog := private.market_cart_snapshot(p_store_id,p_cart,true);
  if (catalog->>'cartFingerprint') is distinct from p_catalog_fingerprint then
    raise exception 'MARKET_CATALOG_CHANGED';
  end if;
  subtotal := (catalog->>'subtotalCents')::integer;
  items := catalog->'items';
  insert into public.market_orders (
    store_id,customer_id,idempotency_key,request_fingerprint,catalog_fingerprint,store_name,
    pickup_address,pickup_lat,pickup_lng,destination_address,destination_lat,destination_lng,recipient_name,recipient_phone,delivery_notes,
    prep_minutes,estimated_distance_meters,estimated_duration_seconds,route_geometry,
    subtotal_cents,freight_cents,discount_cents,total_cents,fare_rule_snapshot
  ) values (
    s.id,p_customer_id,p_idempotency_key,p_request_fingerprint,p_catalog_fingerprint,s.name,s.address,s.latitude,s.longitude,
    btrim(p_delivery->>'address'),(p_delivery->>'lat')::double precision,(p_delivery->>'lng')::double precision,
    btrim(p_delivery->>'recipientName'),recipient_phone,nullif(btrim(p_delivery->>'notes'),''),
    s.prep_minutes,(p_fare->>'distanceMeters')::integer,(p_fare->>'durationSeconds')::integer,p_fare->>'geometry',
    subtotal,freight,0,subtotal+freight,rule
  ) returning id into new_order_id;
  for item in select value from jsonb_array_elements(items) loop
    insert into public.market_order_items(order_id,product_id,product_name,quantity,unit_price_cents,options,line_total_cents)
      values(new_order_id,(item->>'productId')::uuid,item->>'productName',(item->>'quantity')::integer,
        (item->>'unitPriceCents')::integer,item->'options',(item->>'lineTotalCents')::integer);
  end loop;
  for reservation in
    select (value->>'productId')::uuid as product_id,sum((value->>'quantity')::integer)::integer as quantity
      from jsonb_array_elements(items) group by (value->>'productId')::uuid order by (value->>'productId')::uuid
  loop
    update public.market_products set stock_quantity = stock_quantity - reservation.quantity
      where id = reservation.product_id and store_id = s.id and stock_quantity is not null and stock_quantity >= reservation.quantity;
    if found then
      insert into public.market_stock_reservations(order_id,product_id,quantity) values(new_order_id,reservation.product_id,reservation.quantity);
    elsif exists(select 1 from public.market_products where id = reservation.product_id and stock_quantity is not null) then
      raise exception 'MARKET_STOCK_UNAVAILABLE';
    end if;
  end loop;
  insert into public.market_cash_payments(order_id,amount_cents,store_due_cents,driver_due_cents)
    values(new_order_id,subtotal+freight,subtotal,freight);
  insert into public.market_order_events(order_id,event_type,actor_id) values(new_order_id,'order.created',p_customer_id);
  return jsonb_build_object('orderId',new_order_id,'reused',false);
end;
$$;

create function private.market_release_stock(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare reservation record;
begin
  for reservation in select product_id,quantity from public.market_stock_reservations
    where order_id = p_order_id and released_at is null and consumed_at is null order by product_id for update
  loop
    update public.market_products set stock_quantity = stock_quantity + reservation.quantity
      where id = reservation.product_id and stock_quantity is not null;
    if not found then raise exception 'MARKET_STOCK_INCONSISTENT'; end if;
    update public.market_stock_reservations set released_at = now()
      where order_id = p_order_id and product_id = reservation.product_id;
  end loop;
end;
$$;
revoke all on function private.market_release_stock(uuid) from public,anon,authenticated;

create function private.market_order_stock_finish()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'delivered' and old.status is distinct from new.status then
    update public.market_stock_reservations set consumed_at = now()
      where order_id = new.id and released_at is null and consumed_at is null;
  elsif new.status in ('rejected','cancelled') and old.status is distinct from new.status then
    perform private.market_release_stock(new.id);
  end if;
  return new;
end;
$$;
create trigger market_order_stock_finish after update of status on public.market_orders
  for each row execute function private.market_order_stock_finish();
revoke all on function private.market_order_stock_finish() from public,anon,authenticated;

create function private.market_order_guard_transition()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if not (
    (old.status = 'pending' and new.status in ('preparing','rejected','cancelled'))
    or (old.status = 'preparing' and new.status in ('ready','cancelled'))
    or (old.status = 'ready' and new.status in ('delivered','cancelled'))
  ) then raise exception 'MARKET_TRANSITION_INVALID'; end if;
  return new;
end;
$$;
create trigger market_order_guard_transition before update of status on public.market_orders
  for each row execute function private.market_order_guard_transition();
revoke all on function private.market_order_guard_transition() from public,anon,authenticated;

create function private.market_can_manage(p_actor_id uuid,p_store_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles profile where profile.id = p_actor_id and not profile.blocked
    and (profile.role = 'admin' or exists (
      select 1 from public.market_store_members member where member.store_id = p_store_id and member.user_id = profile.id
    ))
  )
$$;
revoke all on function private.market_can_manage(uuid,uuid) from public,anon,authenticated;

create function private.market_can_read_store(p_store_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.market_can_manage((select auth.uid()),p_store_id)
$$;
create function private.market_can_read_order(p_order_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.market_orders orders join public.profiles profile on profile.id = (select auth.uid())
    where orders.id = p_order_id and not profile.blocked and (
      orders.customer_id = profile.id or private.market_can_manage(profile.id,orders.store_id)
    )
  )
$$;
revoke all on function private.market_can_read_store(uuid),private.market_can_read_order(uuid) from public,anon,authenticated;
grant execute on function private.market_can_read_store(uuid),private.market_can_read_order(uuid) to authenticated;

create function public.market_transition_order(p_actor_id uuid,p_order_id uuid,p_action text,p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current_order public.market_orders;
  next_status text;
  next_logistics text;
begin
  select * into current_order from public.market_orders where id = p_order_id for update;
  if not found then raise exception 'MARKET_ORDER_NOT_FOUND'; end if;
  if not private.market_can_manage(p_actor_id,current_order.store_id) then raise exception 'MARKET_FORBIDDEN'; end if;
  next_status := case p_action when 'accept' then 'preparing' when 'reject' then 'rejected'
    when 'ready' then 'ready' when 'cancel' then 'cancelled' end;
  if next_status is null then raise exception 'MARKET_TRANSITION_INVALID'; end if;
  if current_order.status = next_status then
    return jsonb_build_object('orderId',current_order.id,'status',current_order.status,'logisticsStatus',current_order.logistics_status);
  end if;
  if (p_action in ('accept','reject') and current_order.status <> 'pending')
    or (p_action = 'ready' and current_order.status <> 'preparing')
    or (p_action = 'cancel' and current_order.status not in ('pending','preparing'))
    then raise exception 'MARKET_TRANSITION_INVALID'; end if;
  if current_order.status = 'pending' and p_action <> 'cancel' and clock_timestamp() >= current_order.expires_at
    then raise exception 'MARKET_ORDER_EXPIRED'; end if;
  if p_action in ('accept','ready') and not exists (
    select 1 from public.market_stores where id = current_order.store_id and active and status = 'approved'
  ) then raise exception 'MARKET_STORE_CLOSED'; end if;
  if p_action in ('reject','cancel') and not coalesce(length(btrim(p_reason)) between 3 and 300,false)
    then raise exception 'MARKET_REASON_REQUIRED'; end if;
  next_logistics := case next_status when 'ready' then 'awaiting_driver' when 'rejected' then 'cancelled'
    when 'cancelled' then 'cancelled' else current_order.logistics_status end;
  update public.market_orders set status = next_status, logistics_status = next_logistics where id = p_order_id;
  insert into public.market_order_events(order_id,event_type,actor_id,metadata) values(
    p_order_id,'order.' || next_status,p_actor_id,
    case when next_status in ('rejected','cancelled') then jsonb_build_object('reason',btrim(p_reason)) else '{}'::jsonb end
  );
  return jsonb_build_object('orderId',p_order_id,'status',next_status,'logisticsStatus',next_logistics);
end;
$$;

create function public.market_cancel_order(p_customer_id uuid,p_order_id uuid,p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_order public.market_orders;
begin
  if not exists(select 1 from public.profiles where id = p_customer_id and role = 'passenger' and not blocked)
    then raise exception 'MARKET_FORBIDDEN'; end if;
  select * into current_order from public.market_orders where id = p_order_id and customer_id = p_customer_id for update;
  if not found then raise exception 'MARKET_ORDER_NOT_FOUND'; end if;
  if current_order.status = 'cancelled' then
    return jsonb_build_object('orderId',p_order_id,'status','cancelled','logisticsStatus','cancelled');
  end if;
  if current_order.status <> 'pending' then raise exception 'MARKET_TRANSITION_INVALID'; end if;
  if coalesce(length(btrim(p_reason)),0) > 300 then raise exception 'MARKET_REASON_REQUIRED'; end if;
  update public.market_orders set status = 'cancelled',logistics_status = 'cancelled' where id = p_order_id;
  insert into public.market_order_events(order_id,event_type,actor_id,metadata)
    values(p_order_id,'order.cancelled',p_customer_id,jsonb_build_object('reason',nullif(btrim(p_reason),'')));
  return jsonb_build_object('orderId',p_order_id,'status','cancelled','logisticsStatus','cancelled');
end;
$$;

create function public.market_expire_orders(p_limit integer default 50)
returns integer language plpgsql security definer set search_path = '' as $$
declare expired record; changed integer := 0;
begin
  for expired in
    select id from public.market_orders where status = 'pending' and expires_at <= clock_timestamp()
    order by expires_at,id limit least(200,greatest(1,coalesce(p_limit,50))) for update skip locked
  loop
    update public.market_orders set status = 'cancelled',logistics_status = 'cancelled' where id = expired.id;
    insert into public.market_order_events(order_id,event_type,metadata)
      values(expired.id,'order.expired',jsonb_build_object('reason','Tempo de confirmação da loja esgotado'));
    changed := changed + 1;
  end loop;
  return changed;
end;
$$;

create function public.market_cash_action(p_actor_id uuid,p_order_id uuid,p_action text,p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current_order public.market_orders;
  actor public.profiles;
  payment public.market_cash_payments;
begin
  select * into actor from public.profiles where id = p_actor_id and not blocked;
  if not found then raise exception 'MARKET_FORBIDDEN'; end if;
  if p_action is null or p_action not in ('receive','settle') or coalesce(length(btrim(p_note)),0) > 300
    then raise exception 'MARKET_ACTION_INVALID'; end if;
  select * into current_order from public.market_orders where id = p_order_id for update;
  if not found then raise exception 'MARKET_ORDER_NOT_FOUND'; end if;
  if p_action = 'receive' and actor.role <> 'admin' and not (
    actor.role = 'driver' and p_actor_id is not distinct from current_order.assigned_driver_id
  ) then raise exception 'MARKET_FORBIDDEN'; end if;
  if p_action = 'settle' and not private.market_can_manage(p_actor_id,current_order.store_id)
    then raise exception 'MARKET_FORBIDDEN'; end if;
  if not (current_order.status = 'delivered' and current_order.logistics_status = 'delivered')
    then raise exception 'MARKET_PAYMENT_NOT_READY'; end if;
  select * into payment from public.market_cash_payments where order_id = p_order_id for update;
  if not found then raise exception 'MARKET_PAYMENT_NOT_READY'; end if;
  if p_action = 'receive' and payment.received_at is null then
    update public.market_cash_payments set received_at = clock_timestamp(),received_by = p_actor_id,
      receipt_note = nullif(btrim(p_note),'') where order_id = p_order_id returning * into payment;
    insert into public.market_order_events(order_id,event_type,actor_id)
      values(p_order_id,'payment.cash_received',p_actor_id);
  elsif p_action = 'settle' then
    if payment.received_at is null then raise exception 'MARKET_PAYMENT_NOT_RECEIVED'; end if;
    if payment.settled_at is null then
      update public.market_cash_payments set settled_at = clock_timestamp(),settled_by = p_actor_id,
        settlement_note = nullif(btrim(p_note),'') where order_id = p_order_id returning * into payment;
      insert into public.market_order_events(order_id,event_type,actor_id)
        values(p_order_id,'payment.store_settled',p_actor_id);
    end if;
  end if;
  return jsonb_build_object('orderId',p_order_id,'receivedAt',payment.received_at,'settledAt',payment.settled_at);
end;
$$;

alter table public.market_stores enable row level security;
alter table public.market_store_members enable row level security;
alter table public.market_categories enable row level security;
alter table public.market_products enable row level security;
alter table public.market_option_groups enable row level security;
alter table public.market_options enable row level security;
alter table public.market_orders enable row level security;
alter table public.market_order_items enable row level security;
alter table public.market_order_events enable row level security;
alter table public.market_stock_reservations enable row level security;
alter table public.market_cash_payments enable row level security;

-- A API de catálogo é a superfície pública: projeta campos aprovados e não
-- expõe vínculos, estoque reservado, contatos ou informações financeiras.
create policy market_stores_member_read on public.market_stores for select to authenticated
  using (private.market_can_read_store(id));
create policy market_members_store_read on public.market_store_members for select to authenticated
  using (private.market_can_read_store(store_id));
create policy market_categories_store_read on public.market_categories for select to authenticated
  using (private.market_can_read_store(store_id));
create policy market_products_store_read on public.market_products for select to authenticated
  using (private.market_can_read_store(store_id));
create policy market_groups_store_read on public.market_option_groups for select to authenticated
  using (private.market_can_read_store(store_id));
create policy market_options_store_read on public.market_options for select to authenticated
  using (private.market_can_read_store(store_id));
create policy market_orders_participants_read on public.market_orders for select to authenticated
  using (private.market_can_read_order(id));
create policy market_items_participants_read on public.market_order_items for select to authenticated
  using (private.market_can_read_order(order_id));
create policy market_events_store_read on public.market_order_events for select to authenticated
  using (exists (select 1 from public.market_orders orders where orders.id = order_id and private.market_can_read_store(orders.store_id)));
create policy market_cash_store_read on public.market_cash_payments for select to authenticated
  using (exists (select 1 from public.market_orders orders where orders.id = order_id and private.market_can_read_store(orders.store_id)));

revoke all on public.market_stores,public.market_store_members,public.market_categories,public.market_products,
  public.market_option_groups,public.market_options,public.market_orders,public.market_order_items,
  public.market_order_events,public.market_stock_reservations,public.market_cash_payments from public,anon,authenticated;
grant select on public.market_stores,public.market_store_members,public.market_categories,public.market_products,
  public.market_option_groups,public.market_options,public.market_orders,public.market_order_items,
  public.market_order_events,public.market_cash_payments to authenticated;
grant select,insert,update on public.market_stores,public.market_store_members,public.market_categories,public.market_products,
  public.market_option_groups,public.market_options,public.market_orders,public.market_order_items,
  public.market_order_events,public.market_stock_reservations,public.market_cash_payments to service_role;
grant delete on public.market_store_members to service_role;
revoke all on sequence public.market_order_events_id_seq from public,anon,authenticated;
grant usage,select on sequence public.market_order_events_id_seq to service_role;

revoke all on function public.market_store_open(uuid),public.market_store_open_statuses(uuid[]),
  public.market_quote_catalog(uuid,jsonb),public.market_checkout(uuid,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb),
  public.market_transition_order(uuid,uuid,text,text),public.market_cancel_order(uuid,uuid,text),
  public.market_expire_orders(integer),public.market_cash_action(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.market_store_open(uuid),public.market_store_open_statuses(uuid[]),
  public.market_quote_catalog(uuid,jsonb),public.market_checkout(uuid,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb),
  public.market_transition_order(uuid,uuid,text,text),public.market_cancel_order(uuid,uuid,text),
  public.market_expire_orders(integer),public.market_cash_action(uuid,uuid,text,text) to service_role;
