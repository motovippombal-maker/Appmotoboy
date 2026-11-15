-- Workers podem reivindicar lotes disjuntos de pedidos que compartilham
-- produtos. A ordem de expiração não é uma ordem global de locks de estoque.
-- Congele o lote e bloqueie seus produtos em ordem de ID antes de cancelar.
create or replace function public.market_expire_orders(p_limit integer default 50)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  claimed_orders uuid[];
  expired_order uuid;
  changed integer := 0;
begin
  select array_agg(claimed.id order by claimed.expires_at,claimed.id)
    into claimed_orders
    from (
      select o.id,o.expires_at
      from public.market_orders o
      where o.status = 'pending' and o.expires_at <= clock_timestamp()
      order by o.expires_at,o.id
      limit least(200,greatest(1,coalesce(p_limit,50)))
      for update of o skip locked
    ) claimed;
  if claimed_orders is null then return 0; end if;

  -- Checkout e liberação unitária também usam product_id em ordem crescente.
  -- Inclua todas as reservas do lote, ainda que cada pedido tenha só um item.
  perform 1
    from public.market_products p
    where exists (
      select 1 from public.market_stock_reservations r
      where r.order_id = any(claimed_orders) and r.product_id = p.id
        and r.released_at is null and r.consumed_at is null
    )
    order by p.id
    for update of p;

  foreach expired_order in array claimed_orders loop
    update public.market_orders set status = 'cancelled',logistics_status = 'cancelled'
      where id = expired_order;
    insert into public.market_order_events(order_id,event_type,metadata)
      values(expired_order,'order.expired',jsonb_build_object('reason','Tempo de confirmação da loja esgotado'));
    changed := changed + 1;
  end loop;
  return changed;
end;
$$;
