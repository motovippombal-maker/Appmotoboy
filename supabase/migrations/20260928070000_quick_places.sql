-- Moto VIP - catálogo administrável de pontos rápidos

create table if not exists public.quick_places (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 100),
  address text not null check (char_length(trim(address)) between 5 and 240),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  category text not null check (category in (
    'hospital', 'education', 'bus_station', 'government', 'market',
    'pharmacy', 'square', 'fuel', 'bank', 'atm', 'restaurant', 'hotel',
    'church', 'sports', 'gym', 'store', 'moto_vip', 'generic'
  )),
  icon text not null check (icon in (
    'hospital', 'education', 'bus', 'government', 'market', 'pharmacy',
    'square', 'fuel', 'bank', 'atm', 'restaurant', 'hotel', 'church',
    'sports', 'gym', 'store', 'bike', 'pin'
  )),
  color text not null default '#f2ad00'
    check (color ~ '^#[0-9A-Fa-f]{6}$'),
  active boolean not null default true,
  featured boolean not null default false,
  sort_order integer not null default 0 check (sort_order between 0 and 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists quick_places_name_address_unique_idx
  on public.quick_places(lower(trim(name)), lower(trim(address)));

create index if not exists quick_places_public_order_idx
  on public.quick_places(active, featured desc, sort_order, name);

drop trigger if exists quick_places_updated on public.quick_places;
create trigger quick_places_updated
before update on public.quick_places
for each row execute function private.set_updated_at();

alter table public.quick_places enable row level security;

drop policy if exists quick_places_active_read on public.quick_places;
create policy quick_places_active_read on public.quick_places
for select to authenticated
using (active or (select private.is_admin()));

revoke insert, update, delete on public.quick_places from anon, authenticated;
grant select on public.quick_places to authenticated;
grant select, insert, update, delete on public.quick_places to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'quick_places'
     ) then
    alter publication supabase_realtime add table public.quick_places;
  end if;
end $$;

insert into public.quick_places
  (name, address, latitude, longitude, category, icon, color, active, featured, sort_order)
values
  ('Rodoviária', 'Terminal Rodoviário, Ribeira do Pombal - BA', -10.8422, -38.5299, 'bus_station', 'bus', '#0964ed', true, true, 10),
  ('Hospital Municipal', 'Hospital Geral Santa Tereza, Ribeira do Pombal - BA', -10.8389, -38.5318, 'hospital', 'hospital', '#ed1828', true, true, 20),
  ('Prefeitura', 'Prefeitura Municipal de Ribeira do Pombal - BA', -10.8349, -38.5402, 'government', 'government', '#eaa400', true, true, 30),
  ('Mercado Municipal', 'Mercado Municipal, Ribeira do Pombal - BA', -10.8406, -38.5361, 'market', 'market', '#07995c', true, true, 40),
  ('Centro Educacional', 'Centro Educacional, Ribeira do Pombal - BA', -10.8368, -38.5377, 'education', 'education', '#8034e8', true, true, 50),
  ('Praça Getúlio Vargas', 'Praça Getúlio Vargas, Ribeira do Pombal - BA', -10.8448, -38.5365, 'square', 'square', '#0c963d', true, true, 60)
on conflict do nothing;
