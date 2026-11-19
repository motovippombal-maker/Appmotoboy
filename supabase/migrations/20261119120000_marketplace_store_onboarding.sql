-- Autoatendimento de Compras: não muda o papel global do usuário nem aprova
-- a loja. Os cadastros assistidos e suas reaprovações continuam preservados.
-- O SQL Editor deve executar o arquivo completo: a troca da RPC é atômica.
begin;
create table private.market_store_registration_requests (
  actor_id uuid not null references public.profiles(id) on delete restrict,
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  store_id uuid not null unique references public.market_stores(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (actor_id,idempotency_key)
);
alter table private.market_store_registration_requests enable row level security;
revoke all on private.market_store_registration_requests from public,anon,authenticated,service_role;

create function public.market_register_store(p_actor_id uuid,p_idempotency_key uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor public.profiles;
  prior private.market_store_registration_requests;
  registered public.market_stores;
  normalized jsonb;
  fingerprint text;
  pickup_lat double precision;
  pickup_lng double precision;
begin
  select * into actor from public.profiles where id=p_actor_id and not blocked for share;
  if not found then raise exception 'MARKET_FORBIDDEN' using errcode='42501'; end if;
  if p_idempotency_key is null or jsonb_typeof(p_data) is distinct from 'object'
    or jsonb_typeof(p_data->'pickup') is distinct from 'object'
  then raise exception 'MARKET_REGISTRATION_INVALID' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(p_data) k(name) where name not in ('slug','name','description','category','pickup'))
    or exists(select 1 from jsonb_object_keys(p_data->'pickup') k(name) where name not in ('address','latitude','longitude'))
    or jsonb_typeof(p_data->'slug') is distinct from 'string'
    or jsonb_typeof(p_data->'name') is distinct from 'string'
    or jsonb_typeof(p_data->'category') is distinct from 'string'
    or ((p_data ? 'description') and jsonb_typeof(p_data->'description') is distinct from 'string')
    or jsonb_typeof(p_data#>'{pickup,address}') is distinct from 'string'
    or jsonb_typeof(p_data#>'{pickup,latitude}') is distinct from 'number'
    or jsonb_typeof(p_data#>'{pickup,longitude}') is distinct from 'number'
  then raise exception 'MARKET_REGISTRATION_INVALID' using errcode='22023'; end if;
  pickup_lat := (p_data#>>'{pickup,latitude}')::double precision;
  pickup_lng := (p_data#>>'{pickup,longitude}')::double precision;
  if not (length(btrim(p_data->>'slug')) between 3 and 80 and btrim(p_data->>'slug') ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and length(btrim(p_data->>'name')) between 2 and 100
    and length(btrim(p_data->>'category')) between 2 and 60
    and length(btrim(coalesce(p_data->>'description',''))) <= 1000
    and length(btrim(p_data#>>'{pickup,address}')) between 5 and 240
    and pickup_lat between -90 and 90 and pickup_lng between -180 and 180)
  then raise exception 'MARKET_REGISTRATION_INVALID' using errcode='22023'; end if;
  normalized := jsonb_build_object('slug',btrim(p_data->>'slug'),'name',btrim(p_data->>'name'),
    'description',btrim(coalesce(p_data->>'description','')),'category',btrim(p_data->>'category'),
    'address',btrim(p_data#>>'{pickup,address}'),'latitude',pickup_lat,'longitude',pickup_lng);
  fingerprint := encode(sha256(convert_to(normalized::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('market-register-store:'||p_actor_id::text||':'||p_idempotency_key::text,0));
  select * into prior from private.market_store_registration_requests
    where actor_id=p_actor_id and idempotency_key=p_idempotency_key;
  if found then
    if prior.request_fingerprint is distinct from fingerprint then raise exception 'MARKET_REGISTRATION_CONFLICT'; end if;
    -- Nunca recria um vínculo removido pela central e não relata o estado antigo.
    if not exists(select 1 from public.market_store_members where store_id=prior.store_id and user_id=p_actor_id)
      then raise exception 'MARKET_FORBIDDEN' using errcode='42501'; end if;
    select * into registered from public.market_stores where id=prior.store_id;
    return jsonb_build_object('storeId',registered.id,'slug',registered.slug,'status',registered.status,'active',registered.active,'reused',true);
  end if;
  insert into public.market_stores(slug,name,description,category,address,latitude,longitude,status,active,is_open)
    values(normalized->>'slug',normalized->>'name',normalized->>'description',normalized->>'category',
      normalized->>'address',pickup_lat,pickup_lng,'pending',false,false)
    returning * into registered;
  insert into public.market_store_members(store_id,user_id,role) values(registered.id,p_actor_id,'owner');
  insert into private.market_store_registration_requests(actor_id,idempotency_key,request_fingerprint,store_id)
    values(p_actor_id,p_idempotency_key,fingerprint,registered.id);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
    values(p_actor_id,'marketplace.registerStore','market_store',registered.id::text,'{"source":"self_service","memberRole":"owner"}'::jsonb);
  return jsonb_build_object('storeId',registered.id,'slug',registered.slug,'status',registered.status,'active',registered.active,'reused',false);
end;
$$;
revoke all on function public.market_register_store(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.market_register_store(uuid,uuid,jsonb) to service_role;

create function private.market_store_readiness_issues(p_store public.market_stores)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare issues jsonb := '[]'::jsonb;
begin
  if not exists(select 1 from public.market_store_members m join public.profiles p on p.id=m.user_id
    where m.store_id=p_store.id and m.role='owner' and not p.blocked)
  then issues := issues || '"owner"'::jsonb; end if;
  if length(btrim(p_store.address)) < 5 or not (p_store.latitude between -90 and 90 and p_store.longitude between -180 and 180)
  then issues := issues || '"pickup"'::jsonb; end if;
  if not exists(select 1 from public.market_products p where p.store_id=p_store.id and p.active
    and (p.stock_quantity is null or p.stock_quantity>0)
    and (p.category_id is null or exists(select 1 from public.market_categories c where c.store_id=p.store_id and c.id=p.category_id and c.active))
    and not exists(select 1 from public.market_option_groups g where g.store_id=p.store_id and g.product_id=p.id and g.active
      and (select count(*) from public.market_options o where o.store_id=g.store_id and o.group_id=g.id and o.active)<g.min_select))
  then issues := issues || '"catalog"'::jsonb; end if;
  return issues;
end;
$$;
revoke all on function private.market_store_readiness_issues(public.market_stores) from public,anon,authenticated,service_role;

create function public.market_store_readiness(p_actor_id uuid,p_store_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare shop public.market_stores; required boolean; issues jsonb;
begin
  if not private.market_can_manage(p_actor_id,p_store_id) then raise exception 'MARKET_FORBIDDEN' using errcode='42501'; end if;
  select * into shop from public.market_stores where id=p_store_id;
  if not found then raise exception 'MARKET_STORE_NOT_FOUND' using errcode='P0002'; end if;
  required := exists(select 1 from private.market_store_registration_requests where store_id=p_store_id);
  issues := case when required then private.market_store_readiness_issues(shop) else '[]'::jsonb end;
  return jsonb_build_object('required',required,'ready',issues='[]'::jsonb,'issues',issues);
end;
$$;
revoke all on function public.market_store_readiness(uuid,uuid) from public,anon,authenticated;
grant execute on function public.market_store_readiness(uuid,uuid) to service_role;

create function private.market_require_self_service_readiness()
returns trigger language plpgsql security definer set search_path = '' as $$
declare issues jsonb;
begin
  if new.status='approved' and new.active and (old.status is distinct from 'approved' or not old.active)
    and exists(select 1 from private.market_store_registration_requests where store_id=new.id)
  then
    issues := private.market_store_readiness_issues(new);
    if issues <> '[]'::jsonb then raise exception 'MARKET_STORE_NOT_READY' using detail=issues::text; end if;
    new.is_open := false;
  end if;
  return new;
end;
$$;
revoke all on function private.market_require_self_service_readiness() from public,anon,authenticated,service_role;
create trigger market_require_self_service_readiness before update of status,active on public.market_stores
  for each row execute function private.market_require_self_service_readiness();

-- Reutiliza a implementação auditada no schema privado, executável só pelo
-- backend. Só o vínculo preferencial ganha validação transacional extra.
alter function public.market_manage_store(uuid,text,uuid,uuid,uuid,jsonb,text) set schema private;
revoke all on function private.market_manage_store(uuid,text,uuid,uuid,uuid,jsonb,text)
  from public,anon,authenticated,service_role;
grant execute on function private.market_manage_store(uuid,text,uuid,uuid,uuid,jsonb,text) to service_role;

create function public.market_manage_store(
  p_actor_id uuid,p_action text,p_store_id uuid default null,p_target_id uuid default null,
  p_parent_id uuid default null,p_data jsonb default '{}'::jsonb,p_reason text default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare actor public.profiles; shop public.market_stores;
begin
  if p_action='setPreferredDriver' then
    select * into actor from public.profiles where id=p_actor_id and not blocked for share;
    if not found then raise exception 'MARKET_FORBIDDEN' using errcode='42501'; end if;
    if actor.role<>'admin' then
      select * into shop from public.market_stores where id=p_store_id for update;
      if not found then raise exception 'MARKET_STORE_NOT_FOUND' using errcode='P0002'; end if;
      if not (shop.status='approved' and shop.active) then
        raise exception 'MARKET_STORE_NOT_APPROVED' using errcode='42501';
      end if;
    end if;
  end if;
  return private.market_manage_store(p_actor_id,p_action,p_store_id,p_target_id,p_parent_id,p_data,p_reason);
end;
$$;
revoke all on function public.market_manage_store(uuid,text,uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.market_manage_store(uuid,text,uuid,uuid,uuid,jsonb,text) to service_role;
commit;
