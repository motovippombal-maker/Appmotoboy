-- Expansão aditiva. Não altera tarifas nem dados de corridas.
create table public.delivery_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  cash_enabled boolean not null default true,
  card_on_delivery_enabled boolean not null default false,
  minimum_fee_cents integer check (minimum_fee_cents >= 0),
  per_km_cents integer check (per_km_cents >= 0),
  max_distance_meters integer check (max_distance_meters > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  check (not enabled or (minimum_fee_cents is not null and per_km_cents is not null and max_distance_meters is not null and (cash_enabled or card_on_delivery_enabled)))
);
insert into public.delivery_settings(singleton) values (true);

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  name text not null check (char_length(trim(name)) between 2 and 120),
  responsible_name text not null check (char_length(trim(responsible_name)) between 2 and 120),
  phone text not null,
  whatsapp text,
  document text,
  description text,
  cuisine text not null default 'Outros',
  address text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  city text not null default 'Ribeira do Pombal',
  state text not null default 'BA',
  logo_url text,
  cover_url text,
  preparation_minutes integer not null default 30 check (preparation_minutes between 1 and 240),
  minimum_order_cents integer not null default 0 check (minimum_order_cents >= 0),
  opens_at time,
  closes_at time,
  check ((opens_at is null and closes_at is null) or
    (opens_at is not null and closes_at is not null and opens_at <> closes_at)),
  accepting_orders boolean not null default false,
  status text not null default 'pending' check (status in ('draft','pending','approved','rejected','suspended')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index restaurants_catalog_idx on public.restaurants(status, city, cuisine, name);
create index restaurants_owner_idx on public.restaurants(owner_id);

create table public.restaurant_staff (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner','manager','staff')),
  created_at timestamptz not null default now(),
  primary key (restaurant_id, user_id)
);
create index restaurant_staff_user_idx on public.restaurant_staff(user_id);

create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 80),
  sort_order integer not null default 0,
  active boolean not null default true,
  unique (restaurant_id, name)
);
create index menu_categories_restaurant_idx on public.menu_categories(restaurant_id, sort_order);

create table public.menu_products (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  category_id uuid references public.menu_categories(id),
  name text not null check (char_length(trim(name)) between 2 and 120),
  description text,
  image_url text,
  price_cents integer not null check (price_cents >= 0),
  available boolean not null default true,
  archived boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id)
);
create index menu_products_catalog_idx on public.menu_products(restaurant_id, archived, available, sort_order);

create table public.menu_option_groups (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.menu_products(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 80),
  min_choices integer not null default 0 check (min_choices >= 0),
  max_choices integer not null default 1 check (max_choices between 1 and 30),
  sort_order integer not null default 0,
  check (min_choices <= max_choices)
);
create index menu_option_groups_product_idx on public.menu_option_groups(product_id, sort_order);

create table public.menu_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.menu_option_groups(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  price_cents integer not null default 0 check (price_cents >= 0),
  available boolean not null default true,
  sort_order integer not null default 0
);
create index menu_options_group_idx on public.menu_options(group_id, sort_order);

create table public.driver_delivery_preferences (
  driver_id uuid primary key references public.drivers(profile_id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.food_orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  customer_id uuid not null references public.passengers(profile_id),
  restaurant_id uuid not null references public.restaurants(id),
  driver_id uuid references public.drivers(profile_id),
  idempotency_key uuid not null,
  status text not null default 'received' check (status in ('received','accepted','preparing','ready','assigned','at_restaurant','picked_up','on_the_way','delivered','rejected','cancelled','delivery_failed')),
  payment_method text not null check (payment_method in ('cash','card_on_delivery')),
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','failed','refunded')),
  address jsonb not null,
  distance_meters integer not null check (distance_meters > 0),
  subtotal_cents integer not null check (subtotal_cents >= 0),
  delivery_fee_cents integer not null check (delivery_fee_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  restaurant_snapshot jsonb not null,
  change_for_cents integer,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (customer_id, idempotency_key),
  check (total_cents = subtotal_cents + delivery_fee_cents),
  check (change_for_cents is null or (payment_method = 'cash' and change_for_cents >= total_cents))
);
create index food_orders_customer_idx on public.food_orders(customer_id, created_at desc);
create index food_orders_restaurant_idx on public.food_orders(restaurant_id, status, created_at desc);
create index food_orders_driver_idx on public.food_orders(driver_id, status, created_at desc);
create unique index one_active_food_delivery_per_driver on public.food_orders(driver_id)
  where driver_id is not null and status in ('assigned','at_restaurant','picked_up','on_the_way');

create table public.food_delivery_locations (
  order_id uuid primary key references public.food_orders(id) on delete cascade,
  driver_id uuid not null references public.drivers(profile_id),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_meters numeric(8,2) check (accuracy_meters >= 0),
  updated_at timestamptz not null default now()
);

create table public.food_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.food_orders(id) on delete cascade,
  product_id uuid references public.menu_products(id) on delete set null,
  name text not null,
  quantity integer not null check (quantity between 1 and 99),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  options jsonb not null default '[]'::jsonb,
  notes text,
  line_total_cents integer not null check (line_total_cents >= 0)
);
create index food_order_items_order_idx on public.food_order_items(order_id);

create table public.food_order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.food_orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_id uuid references public.profiles(id),
  note text,
  created_at timestamptz not null default now()
);
create index food_order_events_order_idx on public.food_order_events(order_id, created_at);

create table public.food_payment_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.food_orders(id),
  actor_id uuid not null references public.profiles(id),
  event_type text not null check (event_type in ('collected','adjustment')),
  amount_cents integer not null check (amount_cents >= 0),
  method text not null,
  created_at timestamptz not null default now(),
  unique (order_id, event_type)
);
create index food_payment_events_order_idx on public.food_payment_events(order_id, created_at);

create table public.food_pickup_confirmations (
  order_id uuid primary key references public.food_orders(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  confirmed_at timestamptz not null default now()
);

create table public.restaurant_favorites (
  customer_id uuid not null references public.passengers(profile_id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (customer_id, restaurant_id)
);

create table public.food_reviews (
  order_id uuid primary key references public.food_orders(id) on delete cascade,
  customer_id uuid not null references public.passengers(profile_id),
  restaurant_id uuid not null references public.restaurants(id),
  driver_id uuid references public.drivers(profile_id),
  restaurant_score smallint not null check (restaurant_score between 1 and 5),
  delivery_score smallint check (delivery_score between 1 and 5),
  comment text check (char_length(comment) <= 500),
  created_at timestamptz not null default now()
);
create index food_reviews_restaurant_idx on public.food_reviews(restaurant_id, created_at desc);

create or replace function private.restaurant_access(p_restaurant_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.restaurant_staff
    where restaurant_id = p_restaurant_id and user_id = p_user_id
  ) or exists (
    select 1 from public.restaurants where id = p_restaurant_id and owner_id = p_user_id
  );
$$;

insert into public.restaurant_staff(restaurant_id, user_id, role)
select id, owner_id, 'owner' from public.restaurants on conflict do nothing;

create or replace function private.restaurant_owner_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.restaurant_staff(restaurant_id, user_id, role)
  values (new.id, new.owner_id, 'owner') on conflict do nothing;
  return new;
end;
$$;
create trigger restaurant_owner_membership after insert on public.restaurants
for each row execute function private.restaurant_owner_membership();

create trigger restaurants_updated before update on public.restaurants for each row execute function private.set_updated_at();
create trigger menu_products_updated before update on public.menu_products for each row execute function private.set_updated_at();
create trigger food_orders_updated before update on public.food_orders for each row execute function private.set_updated_at();

alter table public.delivery_settings enable row level security;
alter table public.restaurants enable row level security;
alter table public.restaurant_staff enable row level security;
alter table public.menu_categories enable row level security;
alter table public.menu_products enable row level security;
alter table public.menu_option_groups enable row level security;
alter table public.menu_options enable row level security;
alter table public.driver_delivery_preferences enable row level security;
alter table public.food_orders enable row level security;
alter table public.food_delivery_locations enable row level security;
alter table public.food_order_items enable row level security;
alter table public.food_order_events enable row level security;
alter table public.food_payment_events enable row level security;
alter table public.food_pickup_confirmations enable row level security;
alter table public.restaurant_favorites enable row level security;
alter table public.food_reviews enable row level security;

create policy restaurants_read on public.restaurants for select to authenticated
using (status = 'approved' or owner_id = (select auth.uid()) or (select private.is_admin()) or private.restaurant_access(id, (select auth.uid())));
create policy restaurant_staff_read on public.restaurant_staff for select to authenticated
using (user_id = (select auth.uid()) or (select private.is_admin()));
create policy menu_categories_read on public.menu_categories for select to authenticated
using (exists (select 1 from public.restaurants r where r.id = restaurant_id and r.status = 'approved') or private.restaurant_access(restaurant_id, (select auth.uid())) or (select private.is_admin()));
create policy menu_products_read on public.menu_products for select to authenticated
using (exists (select 1 from public.restaurants r where r.id = restaurant_id and r.status = 'approved') or private.restaurant_access(restaurant_id, (select auth.uid())) or (select private.is_admin()));
create policy menu_option_groups_read on public.menu_option_groups for select to authenticated
using (exists (select 1 from public.menu_products p where p.id = product_id and (private.restaurant_access(p.restaurant_id, (select auth.uid())) or exists (select 1 from public.restaurants r where r.id = p.restaurant_id and r.status = 'approved'))) or (select private.is_admin()));
create policy menu_options_read on public.menu_options for select to authenticated
using (exists (select 1 from public.menu_option_groups g join public.menu_products p on p.id = g.product_id where g.id = group_id and (private.restaurant_access(p.restaurant_id, (select auth.uid())) or exists (select 1 from public.restaurants r where r.id = p.restaurant_id and r.status = 'approved'))) or (select private.is_admin()));
create policy driver_delivery_preferences_read on public.driver_delivery_preferences for select to authenticated
using (driver_id = (select auth.uid()) or (select private.is_admin()));
create policy food_orders_read on public.food_orders for select to authenticated
using (customer_id = (select auth.uid()) or driver_id = (select auth.uid()) or private.restaurant_access(restaurant_id, (select auth.uid())) or (select private.is_admin()));
create policy food_delivery_locations_read on public.food_delivery_locations for select to authenticated
using (exists (select 1 from public.food_orders o where o.id = order_id and o.status in ('assigned','at_restaurant','picked_up','on_the_way') and (o.customer_id = (select auth.uid()) or o.driver_id = (select auth.uid()) or private.restaurant_access(o.restaurant_id, (select auth.uid())) or (select private.is_admin()))));
create policy food_order_items_read on public.food_order_items for select to authenticated
using (exists (select 1 from public.food_orders o where o.id = order_id and (o.customer_id = (select auth.uid()) or o.driver_id = (select auth.uid()) or private.restaurant_access(o.restaurant_id, (select auth.uid())) or (select private.is_admin()))));
create policy food_order_events_read on public.food_order_events for select to authenticated
using (exists (select 1 from public.food_orders o where o.id = order_id and (o.customer_id = (select auth.uid()) or o.driver_id = (select auth.uid()) or private.restaurant_access(o.restaurant_id, (select auth.uid())) or (select private.is_admin()))));
create policy food_payment_events_read on public.food_payment_events for select to authenticated
using (exists (select 1 from public.food_orders o where o.id = order_id and (o.customer_id = (select auth.uid()) or o.driver_id = (select auth.uid()) or private.restaurant_access(o.restaurant_id, (select auth.uid())) or (select private.is_admin()))));
create policy food_pickup_confirmations_read on public.food_pickup_confirmations for select to authenticated
using (exists (select 1 from public.food_orders o where o.id = order_id and (o.customer_id = (select auth.uid()) or o.driver_id = (select auth.uid()) or private.restaurant_access(o.restaurant_id, (select auth.uid())) or (select private.is_admin()))));
create policy restaurant_favorites_read on public.restaurant_favorites for select to authenticated
using (customer_id = (select auth.uid()));
create policy food_reviews_read on public.food_reviews for select to authenticated
using (customer_id = (select auth.uid()) or private.restaurant_access(restaurant_id, (select auth.uid())) or (select private.is_admin()));

revoke all on public.delivery_settings, public.restaurants, public.restaurant_staff, public.menu_categories, public.menu_products, public.menu_option_groups, public.menu_options, public.driver_delivery_preferences, public.food_orders, public.food_delivery_locations, public.food_order_items, public.food_order_events, public.food_payment_events, public.food_pickup_confirmations, public.restaurant_favorites, public.food_reviews from anon, authenticated;
grant select on public.restaurants, public.restaurant_staff, public.menu_categories, public.menu_products, public.menu_option_groups, public.menu_options, public.driver_delivery_preferences, public.food_orders, public.food_delivery_locations, public.food_order_items, public.food_order_events, public.food_payment_events, public.food_pickup_confirmations, public.restaurant_favorites, public.food_reviews to authenticated;
grant all on public.delivery_settings, public.restaurants, public.restaurant_staff, public.menu_categories, public.menu_products, public.menu_option_groups, public.menu_options, public.driver_delivery_preferences, public.food_orders, public.food_delivery_locations, public.food_order_items, public.food_order_events, public.food_payment_events, public.food_pickup_confirmations, public.restaurant_favorites, public.food_reviews to service_role;
grant usage, select on sequence public.food_orders_order_number_seq, public.food_order_events_id_seq to service_role;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.food_orders;
    alter publication supabase_realtime add table public.food_delivery_locations;
  end if;
end $$;
