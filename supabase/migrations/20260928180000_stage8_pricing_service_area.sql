-- Moto SyXp - ETAPA 3: autoridade de preco e area de atendimento.
-- Nao cadastra limites reais: a area oficial deve ser configurada antes da producao.

create table if not exists public.service_areas (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 100),
  boundary jsonb not null check (
    jsonb_typeof(boundary) = 'object'
    and boundary->>'type' in ('Polygon', 'MultiPolygon')
    and jsonb_typeof(boundary->'coordinates') = 'array'
  ),
  active boolean not null default true,
  allow_origins boolean not null default true,
  allow_destinations boolean not null default true,
  priority integer not null default 0 check (priority between -100000 and 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.service_areas is
  'Poligonos GeoJSON oficiais da area atendida. Nenhum limite real e criado automaticamente.';
comment on column public.service_areas.boundary is
  'GeoJSON Polygon ou MultiPolygon em ordem [longitude, latitude].';
comment on column public.service_areas.priority is
  'Maior prioridade vence quando mais de uma area contem a coordenada.';

create unique index if not exists service_areas_name_unique_idx
  on public.service_areas(lower(trim(name)));
create index if not exists service_areas_active_priority_idx
  on public.service_areas(active, priority desc, name);

drop trigger if exists service_areas_updated on public.service_areas;
create trigger service_areas_updated
before update on public.service_areas
for each row execute function private.set_updated_at();

alter table public.service_areas enable row level security;

drop policy if exists service_areas_admin_read on public.service_areas;
create policy service_areas_admin_read on public.service_areas
for select to authenticated using ((select private.is_admin()));

revoke insert, update, delete on public.service_areas from anon, authenticated;
grant select on public.service_areas to authenticated;
grant select, insert, update, delete on public.service_areas to service_role;

alter table public.fare_regions
  add column if not exists boundary jsonb,
  add column if not exists priority integer not null default 0;

alter table public.fare_regions
  drop constraint if exists fare_regions_boundary_geojson_check;
alter table public.fare_regions
  add constraint fare_regions_boundary_geojson_check check (
    boundary is null or (
      jsonb_typeof(boundary) = 'object'
      and boundary->>'type' in ('Polygon', 'MultiPolygon')
      and jsonb_typeof(boundary->'coordinates') = 'array'
    )
  );

alter table public.fare_regions
  drop constraint if exists fare_regions_priority_check;
alter table public.fare_regions
  add constraint fare_regions_priority_check
  check (priority between -100000 and 100000);

comment on column public.fare_regions.boundary is
  'Poligono GeoJSON opcional da tarifa especial. A tarifa padrao deve permanecer sem poligono.';
comment on column public.fare_regions.priority is
  'Maior prioridade vence em sobreposicoes; empate usa nome e id em ordem crescente.';

create index if not exists fare_regions_active_priority_idx
  on public.fare_regions(active, is_default, priority desc, name);

alter table public.rides
  add column if not exists service_area_id uuid references public.service_areas(id) on delete set null,
  add column if not exists service_area_name text,
  add column if not exists fare_quote_fingerprint text;

create index if not exists rides_service_area_idx
  on public.rides(service_area_id, created_at desc)
  where service_area_id is not null;
