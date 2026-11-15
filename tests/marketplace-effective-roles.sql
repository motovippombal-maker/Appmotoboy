-- After independently verifying the local disposable cluster and seeding
-- marketplace-concurrency-fixture.sql, run before settling the seed order.
-- Set marketplace.test_isolated to disposable-local-postgres in this session.
\set ON_ERROR_STOP on
begin;
do $$
begin
  if current_database() !~ '^motopombal_audit_(rls|clean_[a-z0-9]{1,12})$'
    or inet_server_addr() is null
    or not (inet_server_addr() <<= inet '127.0.0.0/8' or inet_server_addr() = inet '::1')
    or current_setting('cluster_name') !~ '^motopombal-audit-[0-9]{8}$'
    or current_setting('marketplace.test_isolated',true) is distinct from 'disposable-local-postgres'
  then raise exception 'REFUSED_NON_LAB_TARGET'; end if;
  perform set_config('marketplace.audit_settlement',(select id::text from marketplace_test.orders where label='settlement'),true);
  perform set_config('marketplace.audit_own_shop',(select id::text from marketplace_test.orders where label='staff'),true);
  perform set_config('marketplace.audit_other_shop',(select id::text from marketplace_test.orders where label='expiry'),true);
  perform set_config('marketplace.audit_staff',(select id::text from marketplace_test.identities where label='staff'),true);
  perform set_config('marketplace.audit_buyer',(select id::text from marketplace_test.identities where label='buyer_b'),true);
  perform set_config('marketplace.audit_driver',(select id::text from marketplace_test.identities where label='driver_a'),true);
  perform set_config('marketplace.audit_delivery',(select r.id::text from public.rides r where r.market_order_id=current_setting('marketplace.audit_settlement')::uuid),true);
end $$;
set local role service_role;
do $$
declare fixture jsonb;
begin
  fixture := marketplace_test.checkout('idem','buyer_b','effective-roles');
  perform set_config('marketplace.audit_buyer_order',fixture->>'orderId',true);
end $$;
reset role;
delete from public.market_store_members where user_id=current_setting('marketplace.audit_staff')::uuid
  and store_id=(select store_id from marketplace_test.cases where label='expiry');

set local role authenticated;
do $$
declare ours uuid:=current_setting('marketplace.audit_own_shop')::uuid;
  other uuid:=current_setting('marketplace.audit_other_shop')::uuid;
  field text;
begin
  perform set_config('request.jwt.claim.sub',current_setting('marketplace.audit_staff'),true);
  perform set_config('marketplace.test_user',current_setting('marketplace.audit_staff'),true);
  if not exists(select id from public.market_orders where id=ours)
    or exists(select id from public.market_orders where id=other)
    or exists(select id from public.market_order_items where order_id=other)
    or exists(select order_id from public.market_cash_payments where order_id=other)
  then raise exception 'MERCHANT_RLS_FAILED'; end if;
  foreach field in array array['recipient_name','recipient_phone','destination_lat','destination_lng','idempotency_key','request_fingerprint','catalog_fingerprint','route_geometry']
  loop
    begin
      execute format('select %I from public.market_orders where id=$1',field) using ours;
      raise exception 'PII_OR_INTERNAL_FIELD_VISIBLE';
    exception when insufficient_privilege then null;
    end;
  end loop;
  begin perform metadata from public.market_order_events where order_id=ours; raise exception 'METADATA_VISIBLE';
  exception when insufficient_privilege then null; end;
  begin perform settlement_note from public.market_cash_payments where order_id=ours; raise exception 'NOTE_VISIBLE';
  exception when insufficient_privilege then null; end;
  begin update public.market_store_members set role='owner' where user_id=current_setting('marketplace.audit_staff')::uuid;
    raise exception 'MERCHANT_ROLE_ESCALATED';
  exception when insufficient_privilege then null; end;
  begin
    if to_regprocedure('public.market_record_cash_action(uuid,uuid,text,integer,text,text)') is not null then
      perform public.market_record_cash_action(current_setting('marketplace.audit_staff')::uuid,ours,'settle',1000,'repasse-direto');
    else
      perform public.market_cash_action(current_setting('marketplace.audit_staff')::uuid,ours,'settle');
    end if;
    raise exception 'PRIVILEGED_RPC_DIRECTLY_ACCESSIBLE';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',current_setting('marketplace.audit_buyer'),true);
  perform set_config('marketplace.test_user',current_setting('marketplace.audit_buyer'),true);
  if not exists(select id from public.market_orders where id=current_setting('marketplace.audit_buyer_order')::uuid)
    or exists(select id from public.market_orders where id=ours)
  then raise exception 'CUSTOMER_RLS_FAILED'; end if;
  perform set_config('request.jwt.claim.sub',current_setting('marketplace.audit_driver'),true);
  perform set_config('marketplace.test_user',current_setting('marketplace.audit_driver'),true);
  if exists(select id from public.rides where id=current_setting('marketplace.audit_delivery')::uuid)
    or exists(select id from public.market_orders where id=current_setting('marketplace.audit_settlement')::uuid)
  then raise exception 'TERMINAL_DRIVER_RLS_FAILED'; end if;
end $$;
reset role;
select 'RLS_PII_PRIVILEGES_OK';
set local role anon;
do $$
begin
  begin perform id from public.market_stores; raise exception 'ANON_RAW_CATALOG_VISIBLE';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'ANON_RESTRICTED_OK';

set local role service_role;
do $$
declare fixture_order uuid:=current_setting('marketplace.audit_settlement')::uuid;
  order_info public.market_orders;
  ledger public.market_cash_payments;
  event_rows integer;
  explicit_cash boolean:=to_regprocedure('public.market_record_cash_action(uuid,uuid,text,integer,text,text)') is not null;
  merchant uuid:=(select id from marketplace_test.identities where label='merchant');
  unrelated uuid:=(select id from marketplace_test.identities where label='driver_b');
begin
  select * into strict order_info from public.market_orders where id=fixture_order;
  select * into strict ledger from public.market_cash_payments where order_id=fixture_order;
  if order_info.status <> 'delivered' or ledger.received_at is null or ledger.settled_at is not null
    or ledger.amount_cents <> order_info.total_cents or ledger.store_due_cents <> order_info.subtotal_cents
    or ledger.driver_due_cents <> order_info.freight_cents or ledger.platform_due_cents <> 0
    or exists(select 1 from public.payments where ride_id=current_setting('marketplace.audit_delivery')::uuid)
  then raise exception 'FINANCIAL_SEPARATION_FAILED'; end if;
  begin
    if explicit_cash then
      perform public.market_record_cash_action(unrelated,fixture_order,'settle',ledger.store_due_cents,'repasse-terceiro');
    else
      perform public.market_cash_action(unrelated,fixture_order,'settle');
    end if;
    raise exception 'UNAUTHORIZED_SETTLEMENT';
  exception when raise_exception then
    if sqlerrm <> 'MARKET_FORBIDDEN' then raise; end if;
  end;
  if explicit_cash then
    if ledger.received_amount_cents is distinct from ledger.amount_cents then raise exception 'RECEIPT_AMOUNT_UNEXPECTED'; end if;
    perform public.market_record_cash_action(merchant,fixture_order,'settle',ledger.store_due_cents,'repasse-rls','Repasse sintético');
    perform public.market_record_cash_action(merchant,fixture_order,'settle',ledger.store_due_cents,'repasse-rls','Reenvio sintético');
    if not exists (select 1 from public.market_cash_payments where order_id=fixture_order
      and settlement_reference='repasse-rls' and settled_amount_cents=store_due_cents)
    then raise exception 'SETTLEMENT_AMOUNT_UNEXPECTED'; end if;
  else
    perform public.market_cash_action(merchant,fixture_order,'settle','Repasse sintético');
    perform public.market_cash_action(merchant,fixture_order,'settle','Reenvio sintético');
  end if;
  select count(*) into event_rows from public.market_order_events where order_id=fixture_order and event_type='payment.store_settled';
  if event_rows<>1 or not exists(select 1 from public.market_cash_payments
    where order_id=fixture_order and settled_at>=received_at and settled_by=merchant and settlement_note='Repasse sintético')
  then raise exception 'SETTLEMENT_IDEMPOTENCY_FAILED'; end if;
end $$;
reset role;
select 'CASH_SETTLEMENT_AUDIT_OK';

insert into storage.buckets(id,name,public) values ('fixture-other','fixture-other',false);
insert into storage.objects(bucket_id) values ('marketplace-images'),('fixture-other');
set local role authenticated;
do $$
declare found_count integer;
begin
  begin insert into storage.objects(bucket_id) values ('marketplace-images'); raise exception 'MARKET_IMAGE_UPLOAD_NOT_BLOCKED';
  exception when insufficient_privilege then null; end;
  update storage.objects set bucket_id='fixture-other' where bucket_id='marketplace-images';
  get diagnostics found_count=row_count;
  if found_count<>0 then raise exception 'MARKET_IMAGE_UPDATE_NOT_BLOCKED'; end if;
  delete from storage.objects where bucket_id='marketplace-images';
  get diagnostics found_count=row_count;
  if found_count<>0 then raise exception 'MARKET_IMAGE_DELETE_NOT_BLOCKED'; end if;
  insert into storage.objects(bucket_id) values ('fixture-other');
end $$;
reset role;
select 'STORAGE_POLICY_FIXTURE_OK';
rollback;
