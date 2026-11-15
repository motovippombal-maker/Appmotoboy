-- Dados sintéticos, somente em PostgreSQL descartável local, após migrations.
\set ON_ERROR_STOP on
begin;
do $$
begin
  if inet_server_addr() is null or not (inet_server_addr() <<= inet '127.0.0.0/8' or inet_server_addr() = inet '::1')
    or current_setting('marketplace.test_isolated', true) is distinct from 'disposable-local-postgres' then
    raise exception 'Fixture exige PostgreSQL local descartável e confirmação explícita do runner.';
  end if;
  if to_regclass('private.marketplace_operation_environment') is not null then
    insert into private.marketplace_operation_environment(singleton,operation_mode,environment_id,enabled)
      values(true,'isolated_test','794382dd-bec6-4420-9745-56c27410e718',true)
      on conflict(singleton) do nothing;
    if not public.market_confirm_operation_environment('794382dd-bec6-4420-9745-56c27410e718','isolated_test') then
      raise exception 'Atestação de laboratório divergente.';
    end if;
  end if;
end;
$$;

create schema marketplace_test;
create table marketplace_test.identities(label text primary key,id uuid not null unique);
create table marketplace_test.cases(
  label text primary key,
  store_id uuid not null,
  product_id uuid not null,
  cart jsonb not null,
  catalog_fingerprint text not null,
  pickup jsonb not null,
  delivery jsonb not null,
  fare jsonb not null
);
create table marketplace_test.orders(label text primary key,id uuid not null);
grant usage on schema marketplace_test to service_role;
grant select on all tables in schema marketplace_test to service_role;

create function marketplace_test.checkout(p_case text,p_buyer text,p_attempt text)
returns jsonb language sql set search_path = '' as $$
  select public.market_checkout(
    actor.id,c.store_id,md5('market-test:'||p_case||':'||p_buyer||':'||p_attempt)::uuid,
    encode(sha256(convert_to(c.cart::text||c.pickup::text||c.delivery::text,'UTF8')),'hex'),
    c.cart,c.catalog_fingerprint,c.pickup,c.delivery,c.fare
  )
  from marketplace_test.cases c cross join marketplace_test.identities actor
  where c.label=p_case and actor.label=p_buyer
$$;
revoke all on function marketplace_test.checkout(text,text,text) from public,anon,authenticated;
grant execute on function marketplace_test.checkout(text,text,text) to service_role;

do $$
declare
  actor_label text;
  actor_id uuid;
  case_label text;
  fixture_store_id uuid;
  fixture_product_id uuid;
  fixture_area_id uuid;
  area_revision timestamptz;
  region public.fare_regions;
  pickup_json jsonb := '{"address":"Rua de Retirada Sintética, 10","lat":-10.8373,"lng":-38.5357}'::jsonb;
  delivery_json jsonb := '{"address":"Rua de Entrega Sintética, 20","lat":-10.845,"lng":-38.53,"recipientName":"Pessoa Fictícia","recipientPhone":"+5575999991234"}'::jsonb;
  fare_json jsonb;
  cart_json jsonb;
  quote jsonb;
  checked jsonb;
  fixture_order_id uuid;
  merchant_id uuid;
  driver_a_id uuid;
  fixture_ride_id uuid;
begin
  foreach actor_label in array array['buyer_a','buyer_b','merchant','staff','driver_a','driver_b','admin'] loop
    actor_id := md5('motopombal-audit:'||actor_label)::uuid;
    insert into auth.users(id,raw_user_meta_data) values (actor_id,
      jsonb_build_object('role',case when actor_label like 'driver_%' then 'driver' else 'passenger' end,'full_name','Fixture '||actor_label));
    insert into marketplace_test.identities values(actor_label,actor_id);
    if actor_label='admin' then
      update public.profiles set role='admin' where id=actor_id;
    elsif actor_label like 'driver_%' then
      insert into public.vehicles(driver_id,brand,model,color,plate)
        values(actor_id,'Honda','CG','Preta',case when actor_label='driver_a' then 'TST1A01' else 'TST1B02' end);
      update public.drivers set approval_status='approved',online=true,available=true,on_shift=true where profile_id=actor_id;
      insert into public.driver_locations(driver_id,latitude,longitude,accuracy_meters)
        values(actor_id,case when actor_label='driver_a' then -10.8374 else -10.8390 end,-38.5357,8);
    end if;
  end loop;
  select id into merchant_id from marketplace_test.identities i where i.label='merchant';
  select id into driver_a_id from marketplace_test.identities i where i.label='driver_a';
  insert into public.service_areas(name,boundary)
     values('Área sintética — concorrência',
       '{"type":"Polygon","coordinates":[[[-38.6,-10.9],[-38.4,-10.9],[-38.4,-10.7],[-38.6,-10.7],[-38.6,-10.9]]]}'::jsonb)
     returning id,updated_at into fixture_area_id,area_revision;
  select * into strict region from public.fare_regions where is_default and active;
  fare_json := jsonb_build_object('freightCents',region.amount_cents,'discountCents',0,'distanceMeters',1500,'durationSeconds',600,
    'ruleSnapshot',jsonb_build_object('regionId',region.id,'regionName',region.name,'amountCents',region.amount_cents,
      'regionUpdatedAt',region.updated_at,'originServiceAreaId',fixture_area_id,'originServiceAreaUpdatedAt',area_revision,
      'serviceAreaId',fixture_area_id,'serviceAreaName','Área sintética — concorrência','serviceAreaUpdatedAt',area_revision));

  foreach case_label in array array['stock','idem','delivery_a','delivery_b','receipt','settlement','staff','expiry','partial'] loop
    insert into public.market_stores(slug,name,category,address,latitude,longitude,service_area_id,status,is_open,preferred_driver_id)
      values('teste-'||replace(case_label,'_','-'),'Loja sintética '||case_label,'Comida',pickup_json->>'address',
        (pickup_json->>'lat')::double precision,(pickup_json->>'lng')::double precision,fixture_area_id,'approved',true,driver_a_id)
      returning id into fixture_store_id;
    insert into public.market_store_members(store_id,user_id,role)
      select fixture_store_id,i.id,case when i.label='merchant' then 'owner' else 'manager' end
      from marketplace_test.identities i where i.label in ('merchant','staff');
    insert into public.market_products(store_id,name,price_cents,stock_quantity)
      values(fixture_store_id,'Produto sintético '||case_label,1000,case case_label when 'stock' then 1 when 'expiry' then 1 else 10 end)
      returning id into fixture_product_id;
    cart_json := jsonb_build_array(jsonb_build_object('productId',fixture_product_id,'quantity',1,'optionIds','[]'::jsonb));
    quote := public.market_quote_catalog(fixture_store_id,cart_json);
    insert into marketplace_test.cases values(case_label,fixture_store_id,fixture_product_id,cart_json,quote->>'cartFingerprint',pickup_json,delivery_json,fare_json);
    if case_label in ('delivery_a','delivery_b','receipt','settlement','staff','expiry') then
      checked := marketplace_test.checkout(case_label,'buyer_a','seed');
      fixture_order_id := (checked->>'orderId')::uuid;
      insert into marketplace_test.orders values(case_label,fixture_order_id);
      if case_label in ('delivery_a','delivery_b','receipt','settlement') then
        perform public.market_transition_order(merchant_id,fixture_order_id,'accept');
        perform public.market_transition_order(merchant_id,fixture_order_id,'ready');
      end if;
      if case_label in ('receipt','settlement') then
        if not public.dispatch_market_order(fixture_order_id) then raise exception 'Fixture: oferta não criada'; end if;
        select id into strict fixture_ride_id from public.rides where market_order_id=fixture_order_id;
        if not public.accept_market_delivery(fixture_ride_id,driver_a_id) then raise exception 'Fixture: aceite não confirmado'; end if;
        -- Chegada preparada como fixture: não homologa o GPS.
        update public.rides set status='motorista_a_caminho' where id=fixture_ride_id;
        update public.rides set status='motorista_chegou',arrival_verified=true,arrived_at=now(),arrival_server_at=now() where id=fixture_ride_id;
        perform public.market_driver_delivery_action(fixture_ride_id,driver_a_id,'pickup');
        perform public.market_driver_delivery_action(fixture_ride_id,driver_a_id,'complete');
        if case_label='settlement' then
          if to_regprocedure('public.market_record_cash_action(uuid,uuid,text,integer,text,text)') is not null then
            perform public.market_record_cash_action(driver_a_id,fixture_order_id,'receive',
              (select amount_cents from public.market_cash_payments where order_id=fixture_order_id),null,'Recebimento sintético');
          else
            perform public.market_cash_action(driver_a_id,fixture_order_id,'receive','Recebimento sintético antes da migration financeira');
          end if;
        end if;
      elsif case_label='expiry' then
        update public.market_orders set expires_at=clock_timestamp()-interval '1 minute' where id=fixture_order_id;
      end if;
    end if;
  end loop;
end;
$$;
commit;
