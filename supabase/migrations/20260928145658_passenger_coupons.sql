create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = upper(code) and char_length(code) between 3 and 24),
  description text,
  discount_type text not null check (discount_type in ('fixed', 'percentage')),
  discount_value integer not null check (
    (discount_type = 'fixed' and discount_value > 0)
    or (discount_type = 'percentage' and discount_value between 1 and 100)
  ),
  max_discount_cents integer check (max_discount_cents is null or max_discount_cents > 0),
  min_fare_cents integer not null default 0 check (min_fare_cents >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  ride_id uuid not null unique references public.rides(id) on delete cascade,
  discount_cents integer not null check (discount_cents > 0),
  created_at timestamptz not null default now(),
  unique (coupon_id, user_id)
);

alter table public.rides
  add column if not exists coupon_id uuid references public.coupons(id) on delete set null,
  add column if not exists coupon_code text,
  add column if not exists discount_cents integer not null default 0 check (discount_cents >= 0),
  add column if not exists original_fare_cents integer check (original_fare_cents is null or original_fare_cents >= 0);

create index if not exists coupons_active_code_idx on public.coupons (active, code);
create index if not exists coupon_redemptions_coupon_idx on public.coupon_redemptions (coupon_id);
create index if not exists coupon_redemptions_user_idx on public.coupon_redemptions (user_id);

alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;

revoke all on table public.coupons from anon;
revoke all on table public.coupon_redemptions from anon;
grant select, insert, update, delete on table public.coupons to authenticated;
grant select, insert on table public.coupon_redemptions to authenticated;

drop policy if exists coupons_active_read on public.coupons;
create policy coupons_active_read on public.coupons
for select to authenticated
using (active or (select private.is_admin()));

drop policy if exists coupons_admin_write on public.coupons;
create policy coupons_admin_write on public.coupons
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

drop policy if exists coupon_redemptions_own_read on public.coupon_redemptions;
create policy coupon_redemptions_own_read on public.coupon_redemptions
for select to authenticated
using (user_id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists coupon_redemptions_own_insert on public.coupon_redemptions;
create policy coupon_redemptions_own_insert on public.coupon_redemptions
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.rides r
    where r.id = ride_id and r.passenger_id = (select auth.uid())
  )
  and exists (
    select 1 from public.coupons c
    where c.id = coupon_id and c.active
  )
);

