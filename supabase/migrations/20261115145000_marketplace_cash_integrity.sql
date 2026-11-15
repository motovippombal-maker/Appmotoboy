-- amount_cents is the expected total. A legacy date without an amount records an
-- old declaration, not a verified amount. Do not infer received/settled cents.
alter table public.market_cash_payments
  add column received_amount_cents integer,
  add column settled_amount_cents integer,
  add column receipt_reference text,
  add column settlement_reference text,
  add constraint market_cash_actual_receipt_valid check (
    (received_amount_cents is null or (received_at is not null and received_amount_cents between 0 and 200000000))
    and (receipt_reference is null or (received_amount_cents is not null and length(btrim(receipt_reference)) between 3 and 120))
  ),
  add constraint market_cash_actual_settlement_valid check (
    (settled_amount_cents is null or (settled_at is not null
      and received_amount_cents is not distinct from amount_cents
      and settled_amount_cents = store_due_cents and settlement_reference is not null))
    and (settlement_reference is null or (settled_amount_cents is not null and length(btrim(settlement_reference)) between 3 and 120))
  );

comment on column public.market_cash_payments.received_amount_cents is
  'Valor informado pelo responsável. NULL com data histórica significa valor não comprovado.';
comment on column public.market_cash_payments.settled_amount_cents is
  'Repasse integral declarado pela loja, com referência, separado do recebimento. NULL com data histórica significa valor não comprovado.';

-- Cash and item writes go through SECURITY DEFINER RPCs. Delivery routines
-- can append their events but cannot update or delete the audit trail.
revoke insert,update,delete on public.market_cash_payments,public.market_order_items
  from public,anon,authenticated,service_role;
revoke update,delete on public.market_order_events from public,anon,authenticated,service_role;

create function private.market_immutable_snapshot()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'MARKET_FINANCIAL_SNAPSHOT_IMMUTABLE';
end;
$$;
revoke all on function private.market_immutable_snapshot() from public,anon,authenticated,service_role;
create trigger market_order_items_frozen before update or delete on public.market_order_items
  for each row execute function private.market_immutable_snapshot();
create trigger market_cash_snapshot_no_delete before delete on public.market_cash_payments
  for each row execute function private.market_immutable_snapshot();
create trigger market_financial_events_frozen before update or delete on public.market_order_events
  for each row when (old.event_type like 'payment.%') execute function private.market_immutable_snapshot();

create function private.market_guard_order_price()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.id,new.store_id,new.customer_id,new.subtotal_cents,new.freight_cents,new.discount_cents,
      new.total_cents,new.platform_fee_cents,new.payment_method,new.fare_rule_snapshot,new.catalog_fingerprint,
      new.request_fingerprint,new.idempotency_key)
    is distinct from
     (old.id,old.store_id,old.customer_id,old.subtotal_cents,old.freight_cents,old.discount_cents,
      old.total_cents,old.platform_fee_cents,old.payment_method,old.fare_rule_snapshot,old.catalog_fingerprint,
      old.request_fingerprint,old.idempotency_key)
  then raise exception 'MARKET_FINANCIAL_SNAPSHOT_IMMUTABLE'; end if;
  return new;
end;
$$;
revoke all on function private.market_guard_order_price() from public,anon,authenticated,service_role;
create trigger market_orders_price_frozen before update on public.market_orders
  for each row execute function private.market_guard_order_price();

create function private.market_guard_cash_integrity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.market_orders o where o.id=new.order_id and o.payment_method='cash'
        and o.total_cents=new.amount_cents and o.subtotal_cents=new.store_due_cents
        and o.freight_cents=new.driver_due_cents and o.platform_fee_cents=new.platform_due_cents
        and o.subtotal_cents=(select sum(i.line_total_cents) from public.market_order_items i where i.order_id=o.id)
    ) then raise exception 'MARKET_PAYMENT_SNAPSHOT_INVALID'; end if;
    if new.received_at is not null or new.settled_at is not null then raise exception 'MARKET_PAYMENT_ACTION_REQUIRED'; end if;
    return new;
  end if;
  if (new.order_id,new.amount_cents,new.store_due_cents,new.driver_due_cents,new.platform_due_cents)
      is distinct from (old.order_id,old.amount_cents,old.store_due_cents,old.driver_due_cents,old.platform_due_cents)
    or (old.received_at is not null and (new.received_at,new.received_by,new.received_amount_cents,new.receipt_reference,new.receipt_note)
      is distinct from (old.received_at,old.received_by,old.received_amount_cents,old.receipt_reference,old.receipt_note))
    or (old.settled_at is not null and (new.settled_at,new.settled_by,new.settled_amount_cents,new.settlement_reference,new.settlement_note)
      is distinct from (old.settled_at,old.settled_by,old.settled_amount_cents,old.settlement_reference,old.settlement_note))
  then raise exception 'MARKET_FINANCIAL_SNAPSHOT_IMMUTABLE'; end if;
  if (old.received_at is null and new.received_at is not null and new.received_amount_cents is null)
    or (old.settled_at is null and new.settled_at is not null and new.settled_amount_cents is null)
  then raise exception 'MARKET_PAYMENT_AMOUNT_INVALID'; end if;
  return new;
end;
$$;
revoke all on function private.market_guard_cash_integrity() from public,anon,authenticated,service_role;
create trigger market_cash_integrity before insert or update on public.market_cash_payments
  for each row execute function private.market_guard_cash_integrity();

-- Keep historical event records untouched. New reported movements are unique
-- and must match the ledger entry and its actor.
create unique index market_cash_reported_event_once on public.market_order_events(order_id,event_type)
  where event_type in ('payment.cash_received','payment.store_settled') and metadata ? 'reportedCents';

create function private.market_guard_financial_event()
returns trigger language plpgsql set search_path = '' as $$
declare ledger public.market_cash_payments;
  actor uuid;
  expected integer;
  reported integer;
  reference text;
begin
  select * into ledger from public.market_cash_payments where order_id=new.order_id;
  if new.event_type = 'payment.cash_received' then
    actor := ledger.received_by;
    expected := ledger.amount_cents;
    reported := ledger.received_amount_cents;
    reference := ledger.receipt_reference;
  elsif new.event_type = 'payment.store_settled' then
    actor := ledger.settled_by;
    expected := ledger.store_due_cents;
    reported := ledger.settled_amount_cents;
    reference := ledger.settlement_reference;
  else raise exception 'MARKET_PAYMENT_ACTION_REQUIRED';
  end if;
  if actor is null or reported is null or new.actor_id is distinct from actor
    or new.metadata->'reportedCents' is distinct from to_jsonb(reported)
    or new.metadata->'expectedCents' is distinct from to_jsonb(expected)
    or new.metadata->>'reference' is distinct from reference
  then raise exception 'MARKET_PAYMENT_ACTION_REQUIRED'; end if;
  return new;
end;
$$;
revoke all on function private.market_guard_financial_event() from public,anon,authenticated,service_role;
create trigger market_financial_event_matches_ledger before insert on public.market_order_events
  for each row when (new.event_type like 'payment.%') execute function private.market_guard_financial_event();

-- Cutover exclusivo do caixa de Compras: a assinatura antiga não recebe o
-- valor real e clientes antigos exibem valor esperado como recebido ao ver
-- um carimbo de data. Preserve leitura/histórico, mas não grave um carimbo
-- novo sem valor. Checkout, cozinha, despacho e entrega continuam separados.
create or replace function public.market_cash_action(p_actor_id uuid,p_order_id uuid,p_action text,p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'MARKET_PAYMENT_AMOUNT_REQUIRED';
end;
$$;
revoke all on function public.market_cash_action(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.market_cash_action(uuid,uuid,text,text) to service_role;

create function public.market_record_cash_action(
  p_actor_id uuid,p_order_id uuid,p_action text,p_amount_cents integer,p_reference text default null,p_note text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current_order public.market_orders;
  actor public.profiles;
  payment public.market_cash_payments;
  evidence_reference text := nullif(btrim(p_reference),'');
  evidence_note text := nullif(btrim(p_note),'');
begin
  select * into actor from public.profiles where id=p_actor_id and not blocked;
  if not found then raise exception 'MARKET_FORBIDDEN'; end if;
  if p_action in ('refund','adjust') then raise exception 'MARKET_REFUND_POLICY_NOT_CONFIGURED'; end if;
  if p_action is null or p_action not in ('receive','settle') or coalesce(length(evidence_note),0)>300
    then raise exception 'MARKET_ACTION_INVALID'; end if;
  if p_amount_cents is null or p_amount_cents not between 0 and 200000000
    then raise exception 'MARKET_PAYMENT_AMOUNT_INVALID'; end if;
  if (p_action='settle' or evidence_reference is not null)
    and not coalesce(length(evidence_reference) between 3 and 120,false)
  then raise exception 'MARKET_PAYMENT_REFERENCE_REQUIRED'; end if;
  select * into current_order from public.market_orders where id=p_order_id for update;
  if not found then raise exception 'MARKET_ORDER_NOT_FOUND'; end if;
  if p_action='receive' and actor.role <> 'admin' and not (
    actor.role='driver' and p_actor_id is not distinct from current_order.assigned_driver_id
  ) then raise exception 'MARKET_FORBIDDEN'; end if;
  if p_action='settle' and not private.market_can_manage(p_actor_id,current_order.store_id)
    then raise exception 'MARKET_FORBIDDEN'; end if;
  if not (current_order.status='delivered' and current_order.logistics_status='delivered')
    then raise exception 'MARKET_PAYMENT_NOT_READY'; end if;
  select * into payment from public.market_cash_payments where order_id=p_order_id for update;
  if not found then raise exception 'MARKET_PAYMENT_NOT_READY'; end if;
  if (payment.received_at is not null and payment.received_amount_cents is null)
    or (payment.settled_at is not null and payment.settled_amount_cents is null)
  then raise exception 'MARKET_PAYMENT_LEGACY_UNVERIFIED'; end if;

  if p_action='receive' then
    if payment.received_at is not null then
      if payment.received_amount_cents is distinct from p_amount_cents
        or payment.receipt_reference is distinct from evidence_reference
      then raise exception 'MARKET_PAYMENT_CONFLICT'; end if;
    else
      update public.market_cash_payments set received_at=clock_timestamp(),received_by=p_actor_id,
        received_amount_cents=p_amount_cents,receipt_reference=evidence_reference,receipt_note=evidence_note
        where order_id=p_order_id returning * into payment;
      insert into public.market_order_events(order_id,event_type,actor_id,metadata)
        values(p_order_id,'payment.cash_received',p_actor_id,jsonb_strip_nulls(jsonb_build_object(
          'expectedCents',payment.amount_cents,'reportedCents',p_amount_cents,
          'deltaCents',p_amount_cents-payment.amount_cents,'reference',evidence_reference)));
    end if;
  else
    if payment.received_at is null then raise exception 'MARKET_PAYMENT_NOT_RECEIVED'; end if;
    if payment.received_amount_cents is distinct from payment.amount_cents then raise exception 'MARKET_PAYMENT_DIVERGENT'; end if;
    if payment.settled_at is not null then
      if payment.settled_amount_cents is distinct from p_amount_cents
        or payment.settlement_reference is distinct from evidence_reference
      then raise exception 'MARKET_PAYMENT_CONFLICT'; end if;
    else
      if p_amount_cents is distinct from payment.store_due_cents then raise exception 'MARKET_PAYMENT_AMOUNT_INVALID'; end if;
      update public.market_cash_payments set settled_at=clock_timestamp(),settled_by=p_actor_id,
        settled_amount_cents=p_amount_cents,settlement_reference=evidence_reference,settlement_note=evidence_note
        where order_id=p_order_id returning * into payment;
      insert into public.market_order_events(order_id,event_type,actor_id,metadata)
        values(p_order_id,'payment.store_settled',p_actor_id,jsonb_build_object(
          'expectedCents',payment.store_due_cents,'reportedCents',p_amount_cents,'reference',evidence_reference));
    end if;
  end if;
  return jsonb_build_object('orderId',p_order_id,'receivedAt',payment.received_at,'settledAt',payment.settled_at,
    'receivedAmountCents',payment.received_amount_cents,'settledAmountCents',payment.settled_amount_cents);
end;
$$;
-- A 1460 instala a proteção de ambiente e só então habilita a chamada pelo
-- servidor. Até lá, instalar esta preparação não abre outro caminho de caixa.
revoke all on function public.market_record_cash_action(uuid,uuid,text,integer,text,text)
  from public,anon,authenticated,service_role;
