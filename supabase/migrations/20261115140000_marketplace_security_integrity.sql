-- A redistribuição só limpa pontos do motorista que deixou esta atribuição.
-- Tanto o RPC legado quanto o de compras são SECURITY INVOKER.
grant delete on public.ride_approach_points to service_role;

-- As APIs autorizam e projetam dados privados explicitamente no servidor.
-- Row-level security limita quais pedidos são visíveis e estes grants limitam
-- quais campos uma sessão autenticada pode ler diretamente pelo PostgREST.
revoke select on public.market_orders from public,anon,authenticated;
grant select (id,store_id,store_name,status,logistics_status,subtotal_cents,
  freight_cents,discount_cents,total_cents,platform_fee_cents,payment_method,
  prep_minutes,estimated_distance_meters,estimated_duration_seconds,expires_at,
  created_at,updated_at)
on public.market_orders to authenticated;

-- Motivos internos/auditoria e notas financeiras permanecem nas APIs
-- autorizadas. As políticas de cada tabela continuam em vigor.
revoke select on public.market_order_events,public.market_cash_payments from public,anon,authenticated;
grant select (id,order_id,event_type,created_at) on public.market_order_events to authenticated;
grant select (order_id,amount_cents,store_due_cents,driver_due_cents,
  platform_due_cents,received_at,settled_at) on public.market_cash_payments to authenticated;
