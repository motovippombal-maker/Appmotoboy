-- Fail closed. Installation does not activate test or commercial activity.
-- Only the SQL owner may attest the environment and explicitly enable it.
create table private.marketplace_operation_environment (
  singleton boolean primary key check (singleton),
  operation_mode text not null check (operation_mode in ('isolated_test', 'production')),
  environment_id uuid not null,
  enabled boolean not null default false
);
revoke all on table private.marketplace_operation_environment from public, anon, authenticated, service_role;

create function public.market_confirm_operation_environment(p_environment_id uuid, p_operation_mode text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.marketplace_operation_environment
    where singleton and enabled and environment_id = p_environment_id and operation_mode = p_operation_mode
  )
$$;
revoke all on function public.market_confirm_operation_environment(uuid, text) from public, anon, authenticated;
grant execute on function public.market_confirm_operation_environment(uuid, text) to service_role;

create function private.market_require_operation_enabled()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- SHARE allows concurrent business transactions, but conflicts with the
  -- owner's UPDATE enabled=false. After that commit, subsequent writes fail.
  perform 1 from private.marketplace_operation_environment where singleton and enabled for share;
  if not found then raise exception 'MARKETPLACE_OPERATIONS_PAUSED' using errcode = 'P0001'; end if;
  return new;
end;
$$;
revoke all on function private.market_require_operation_enabled() from public, anon, authenticated, service_role;

create trigger market_operation_order_insert before insert on public.market_orders
for each row execute function private.market_require_operation_enabled();
create trigger market_operation_order_processing before update of status, logistics_status on public.market_orders
for each row when (
  (old.status is distinct from new.status and new.status in ('preparing','ready','delivered')) or
  (old.logistics_status is distinct from new.logistics_status and new.logistics_status in ('assigned','in_delivery','delivered'))
) execute function private.market_require_operation_enabled();
create trigger market_operation_cash before update of received_at, settled_at on public.market_cash_payments
for each row when (old.received_at is distinct from new.received_at or old.settled_at is distinct from new.settled_at)
execute function private.market_require_operation_enabled();
create trigger market_operation_logistics before insert on public.rides
for each row when (new.market_order_id is not null) execute function private.market_require_operation_enabled();
create trigger market_operation_ride_progress before update of status on public.rides
for each row when (
  new.market_order_id is not null and old.status is distinct from new.status
  and new.status in ('aceita','motorista_a_caminho','motorista_chegou','em_corrida','finalizada')
) execute function private.market_require_operation_enabled();
create trigger market_operation_offer before insert on public.ride_requests
for each row when (new.market_dispatch_source is not null) execute function private.market_require_operation_enabled();

-- 1450 installed the RPC but intentionally withheld access during rollout.
grant execute on function public.market_record_cash_action(uuid,uuid,text,integer,text,text) to service_role;
