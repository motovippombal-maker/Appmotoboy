create extension if not exists pgcrypto;
create schema if not exists private;

create type public.user_role as enum ('passenger', 'driver', 'admin');
create type public.driver_approval as enum ('pending', 'approved', 'rejected', 'suspended');
create type public.ride_status as enum ('solicitada', 'procurando_motorista', 'aceita', 'motorista_a_caminho', 'motorista_chegou', 'em_corrida', 'finalizada', 'cancelada');
create type public.payment_status as enum ('aguardando_pagamento', 'pago', 'falhou', 'cancelado', 'reembolsado');
create type public.payment_method as enum ('pix', 'cash', 'card');
create type public.offer_status as enum ('pending', 'accepted', 'declined', 'expired');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'passenger',
  full_name text not null default '',
  phone text,
  avatar_url text,
  blocked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.passengers (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  emergency_phone text,
  default_payment_method public.payment_method not null default 'pix',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.drivers (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  approval_status public.driver_approval not null default 'pending',
  online boolean not null default false,
  available boolean not null default false,
  rating numeric(3,2) not null default 5.00 check (rating between 0 and 5),
  trips_count integer not null default 0 check (trips_count >= 0),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(profile_id) on delete cascade,
  brand text not null,
  model text not null,
  color text not null,
  plate text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index vehicles_driver_idx on public.vehicles(driver_id);

create table public.rides (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid not null references public.passengers(profile_id),
  driver_id uuid references public.drivers(profile_id),
  vehicle_id uuid references public.vehicles(id),
  status public.ride_status not null default 'solicitada',
  origin_address text not null,
  origin_lat double precision not null check (origin_lat between -90 and 90),
  origin_lng double precision not null check (origin_lng between -180 and 180),
  destination_address text not null,
  destination_lat double precision not null check (destination_lat between -90 and 90),
  destination_lng double precision not null check (destination_lng between -180 and 180),
  distance_meters integer not null check (distance_meters > 0),
  duration_seconds integer not null check (duration_seconds > 0),
  route_geometry text,
  fare_cents integer not null check (fare_cents > 0),
  payment_method public.payment_method not null default 'pix',
  payment_status public.payment_status not null default 'aguardando_pagamento',
  requested_at timestamptz not null default now(),
  accepted_at timestamptz,
  arrived_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index one_active_ride_per_passenger on public.rides(passenger_id)
  where status not in ('finalizada', 'cancelada');
create unique index one_active_ride_per_driver on public.rides(driver_id)
  where driver_id is not null and status not in ('finalizada', 'cancelada');
create index rides_status_requested_idx on public.rides(status, requested_at desc);
create index rides_passenger_idx on public.rides(passenger_id, created_at desc);
create index rides_driver_idx on public.rides(driver_id, created_at desc);

create table public.ride_requests (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  driver_id uuid not null references public.drivers(profile_id) on delete cascade,
  status public.offer_status not null default 'pending',
  expires_at timestamptz not null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (ride_id, driver_id)
);
create index ride_requests_driver_idx on public.ride_requests(driver_id, status, expires_at);
create index ride_requests_ride_idx on public.ride_requests(ride_id);

create table public.driver_locations (
  driver_id uuid primary key references public.drivers(profile_id) on delete cascade,
  ride_id uuid references public.rides(id) on delete set null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_meters numeric(8,2),
  heading numeric(6,2),
  speed_mps numeric(8,2),
  updated_at timestamptz not null default now()
);
create index driver_locations_fresh_idx on public.driver_locations(updated_at desc);
create index driver_locations_ride_idx on public.driver_locations(ride_id) where ride_id is not null;

create table public.passenger_locations (
  passenger_id uuid primary key references public.passengers(profile_id) on delete cascade,
  ride_id uuid references public.rides(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_meters numeric(8,2),
  updated_at timestamptz not null default now()
);
create index passenger_locations_ride_idx on public.passenger_locations(ride_id) where ride_id is not null;

create table public.ride_history (
  id bigint generated always as identity primary key,
  ride_id uuid not null references public.rides(id) on delete cascade,
  from_status public.ride_status,
  to_status public.ride_status not null,
  actor_id uuid references public.profiles(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index ride_history_ride_idx on public.ride_history(ride_id, created_at);

create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  rater_id uuid not null references public.profiles(id),
  rated_id uuid not null references public.profiles(id),
  score smallint not null check (score between 1 and 5),
  comment text check (char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  unique (ride_id, rater_id)
);
create index ratings_rated_idx on public.ratings(rated_id, created_at desc);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null unique references public.rides(id),
  passenger_id uuid not null references public.passengers(profile_id),
  method public.payment_method not null,
  status public.payment_status not null default 'aguardando_pagamento',
  amount_cents integer not null check (amount_cents > 0),
  provider text,
  provider_reference text unique,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_passenger_idx on public.payments(passenger_id, created_at desc);

create table public.pix_transactions (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.payments(id) on delete cascade,
  provider_charge_id text unique,
  qr_code text,
  qr_code_image_url text,
  expires_at timestamptz,
  provider_payload jsonb not null default '{}'::jsonb,
  webhook_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);

create table public.system_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip_hash text,
  created_at timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs(entity_type, entity_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs(actor_id, created_at desc) where actor_id is not null;

create table public.api_rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 1 check (request_count > 0)
);

insert into public.system_settings(key, value, description) values
  ('fare', '{"base_cents": 500, "per_km_cents": 100, "minimum_cents": 700}'::jsonb, 'Tarifa base, quilômetro e valor mínimo'),
  ('dispatch', '{"offer_seconds": 20, "initial_radius_km": 3, "max_radius_km": 10}'::jsonb, 'Parâmetros de distribuição'),
  ('tracking', '{"available_interval_seconds": 20, "active_ride_interval_seconds": 5}'::jsonb, 'Frequência recomendada do GPS')
on conflict (key) do nothing;

create function private.set_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;

create trigger profiles_updated before update on public.profiles for each row execute function private.set_updated_at();
create trigger passengers_updated before update on public.passengers for each row execute function private.set_updated_at();
create trigger drivers_updated before update on public.drivers for each row execute function private.set_updated_at();
create trigger vehicles_updated before update on public.vehicles for each row execute function private.set_updated_at();
create trigger rides_updated before update on public.rides for each row execute function private.set_updated_at();
create trigger payments_updated before update on public.payments for each row execute function private.set_updated_at();
create trigger pix_transactions_updated before update on public.pix_transactions for each row execute function private.set_updated_at();

create function private.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
declare requested_role public.user_role;
begin
  requested_role := case when new.raw_user_meta_data->>'role' = 'driver' then 'driver'::public.user_role else 'passenger'::public.user_role end;
  insert into public.profiles(id, role, full_name, phone)
  values (new.id, requested_role, coalesce(new.raw_user_meta_data->>'full_name', ''), new.raw_user_meta_data->>'phone');
  if requested_role = 'driver' then insert into public.drivers(profile_id) values (new.id);
  else insert into public.passengers(profile_id) values (new.id); end if;
  return new;
end; $$;
revoke all on function private.handle_new_user() from public;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

create function private.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = (select auth.uid()) and role = 'admin' and not blocked)
$$;
revoke all on function private.is_admin() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

create function private.validate_ride_transition() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = new.status then return new; end if;
  if not (
    (old.status = 'solicitada' and new.status in ('procurando_motorista','cancelada')) or
    (old.status = 'procurando_motorista' and new.status in ('aceita','cancelada')) or
    (old.status = 'aceita' and new.status in ('motorista_a_caminho','cancelada')) or
    (old.status = 'motorista_a_caminho' and new.status in ('motorista_chegou','cancelada')) or
    (old.status = 'motorista_chegou' and new.status in ('em_corrida','cancelada')) or
    (old.status = 'em_corrida' and new.status = 'finalizada')
  ) then raise exception 'Transição de corrida inválida: % -> %', old.status, new.status using errcode = '22023'; end if;
  return new;
end; $$;
create trigger ride_transition_guard before update of status on public.rides for each row execute function private.validate_ride_transition();

create function public.accept_ride(p_ride_id uuid, p_driver_id uuid) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare changed integer; selected_vehicle uuid;
begin
  select id into selected_vehicle from public.vehicles where driver_id = p_driver_id and active order by created_at desc limit 1;
  if selected_vehicle is null then return false; end if;
  update public.rides set driver_id = p_driver_id, vehicle_id = selected_vehicle, status = 'aceita', accepted_at = now()
  where id = p_ride_id and status = 'procurando_motorista' and driver_id is null
    and exists(select 1 from public.drivers where profile_id = p_driver_id and approval_status = 'approved' and online and available);
  get diagnostics changed = row_count;
  if changed = 1 then
    update public.drivers set available = false where profile_id = p_driver_id;
    update public.ride_requests set status = case when driver_id = p_driver_id then 'accepted'::public.offer_status else 'expired'::public.offer_status end, responded_at = now() where ride_id = p_ride_id and status = 'pending';
    insert into public.ride_history(ride_id, from_status, to_status, actor_id) values (p_ride_id, 'procurando_motorista', 'aceita', p_driver_id);
    return true;
  end if;
  return false;
end; $$;
revoke all on function public.accept_ride(uuid, uuid) from public, anon, authenticated;
grant execute on function public.accept_ride(uuid, uuid) to service_role;

create function public.consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare current_count integer;
begin
  insert into public.api_rate_limits(bucket_key, window_started_at, request_count)
  values (p_key, now(), 1)
  on conflict (bucket_key) do update set
    window_started_at = case when public.api_rate_limits.window_started_at < now() - make_interval(secs => p_window_seconds) then now() else public.api_rate_limits.window_started_at end,
    request_count = case when public.api_rate_limits.window_started_at < now() - make_interval(secs => p_window_seconds) then 1 else public.api_rate_limits.request_count + 1 end
  returning request_count into current_count;
  return current_count <= p_limit;
end; $$;
revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

alter table public.profiles enable row level security;
alter table public.passengers enable row level security;
alter table public.drivers enable row level security;
alter table public.vehicles enable row level security;
alter table public.rides enable row level security;
alter table public.ride_requests enable row level security;
alter table public.driver_locations enable row level security;
alter table public.passenger_locations enable row level security;
alter table public.ride_history enable row level security;
alter table public.ratings enable row level security;
alter table public.payments enable row level security;
alter table public.pix_transactions enable row level security;
alter table public.notifications enable row level security;
alter table public.system_settings enable row level security;
alter table public.audit_logs enable row level security;
alter table public.api_rate_limits enable row level security;

create policy profiles_read on public.profiles for select to authenticated using (id = (select auth.uid()) or (select private.is_admin()));
create policy profiles_update on public.profiles for update to authenticated using (id = (select auth.uid()) or (select private.is_admin())) with check (id = (select auth.uid()) or (select private.is_admin()));
create policy passengers_own on public.passengers for select to authenticated using (profile_id = (select auth.uid()) or (select private.is_admin()));
create policy drivers_read on public.drivers for select to authenticated using (profile_id = (select auth.uid()) or approval_status = 'approved' or (select private.is_admin()));
create policy vehicles_read on public.vehicles for select to authenticated using (driver_id = (select auth.uid()) or active or (select private.is_admin()));
create policy rides_read on public.rides for select to authenticated using (passenger_id = (select auth.uid()) or driver_id = (select auth.uid()) or (select private.is_admin()));
create policy ride_requests_read on public.ride_requests for select to authenticated using (driver_id = (select auth.uid()) or (select private.is_admin()));
create policy driver_locations_read on public.driver_locations for select to authenticated using (driver_id = (select auth.uid()) or (select private.is_admin()) or exists(select 1 from public.rides r where r.id = ride_id and r.passenger_id = (select auth.uid()) and r.status not in ('finalizada','cancelada')));
create policy passenger_locations_read on public.passenger_locations for select to authenticated using (passenger_id = (select auth.uid()) or (select private.is_admin()) or exists(select 1 from public.rides r where r.id = ride_id and r.driver_id = (select auth.uid()) and r.status not in ('finalizada','cancelada')));
create policy history_read on public.ride_history for select to authenticated using ((select private.is_admin()) or exists(select 1 from public.rides r where r.id = ride_id and (r.passenger_id = (select auth.uid()) or r.driver_id = (select auth.uid()))));
create policy ratings_read on public.ratings for select to authenticated using (rater_id = (select auth.uid()) or rated_id = (select auth.uid()) or (select private.is_admin()));
create policy payments_read on public.payments for select to authenticated using (passenger_id = (select auth.uid()) or (select private.is_admin()) or exists(select 1 from public.rides r where r.id = ride_id and r.driver_id = (select auth.uid())));
create policy pix_read on public.pix_transactions for select to authenticated using ((select private.is_admin()) or exists(select 1 from public.payments p where p.id = payment_id and p.passenger_id = (select auth.uid())));
create policy notifications_own on public.notifications for select to authenticated using (user_id = (select auth.uid()) or (select private.is_admin()));
create policy settings_read on public.system_settings for select to authenticated using (true);
create policy audit_admin on public.audit_logs for select to authenticated using ((select private.is_admin()));

revoke insert, update, delete on public.rides, public.ride_requests, public.driver_locations, public.passenger_locations, public.ride_history, public.payments, public.pix_transactions, public.notifications, public.audit_logs from anon, authenticated;
grant select on public.profiles, public.passengers, public.drivers, public.vehicles, public.rides, public.ride_requests, public.driver_locations, public.passenger_locations, public.ride_history, public.ratings, public.payments, public.pix_transactions, public.notifications, public.system_settings to authenticated;
grant update(full_name, phone, avatar_url) on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles, public.passengers, public.drivers, public.vehicles, public.rides, public.ride_requests, public.driver_locations, public.passenger_locations, public.ride_history, public.ratings, public.payments, public.pix_transactions, public.notifications, public.system_settings, public.audit_logs, public.api_rate_limits to service_role;
grant usage, select on all sequences in schema public to service_role;

alter publication supabase_realtime add table public.rides;
alter publication supabase_realtime add table public.ride_requests;
alter publication supabase_realtime add table public.driver_locations;
alter publication supabase_realtime add table public.passenger_locations;
alter publication supabase_realtime add table public.notifications;
