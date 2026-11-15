-- One active user per browser Push endpoint. Preserve subscription and
-- delivery history; resolve pre-existing duplicates to the newest row.
with active_rank as (
  select id,row_number() over(partition by endpoint order by updated_at desc,created_at desc,id desc) as rank
  from public.push_subscriptions where active
)
update public.push_subscriptions s set active=false
from active_rank r where s.id=r.id and r.rank>1;

create unique index push_subscriptions_one_active_endpoint on public.push_subscriptions(endpoint)
  where active;

create function public.register_push_subscription(
  p_user_id uuid,p_endpoint text,p_p256dh text,p_auth text,p_user_agent text
)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not exists(select 1 from public.profiles where id=p_user_id and not blocked) then
    raise exception 'Usuário sem permissão para receber avisos.' using errcode='42501';
  end if;
  -- Serialize even the first registration, when no row exists to lock.
  perform pg_advisory_xact_lock(hashtextextended(p_endpoint,14715));
  update public.push_subscriptions set active=false
    where endpoint=p_endpoint and user_id<>p_user_id and active;
  insert into public.push_subscriptions(user_id,endpoint,p256dh,auth,user_agent,active)
  values(p_user_id,p_endpoint,p_p256dh,p_auth,left(p_user_agent,512),true)
  on conflict(user_id,endpoint) do update set
    p256dh=excluded.p256dh,auth=excluded.auth,user_agent=excluded.user_agent,active=true;
end;
$$;
revoke all on function public.register_push_subscription(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.register_push_subscription(uuid,text,text,text,text) to service_role;

alter table public.notifications add column market_order_event_id bigint
  references public.market_order_events(id) on delete restrict;
create unique index notifications_market_event_recipient_idx on public.notifications(market_order_event_id,user_id)
  where market_order_event_id is not null;

-- Reuse the existing notification inbox/Realtime publication and its
-- transacional Push outbox; SQL never calls a provider. IDs are opaque
-- pointers and every destination page reauthorizes before showing data.
create function private.publish_market_order_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  current_order public.market_orders;
  customer_title text;
  merchant_title text;
  admin_title text;
begin
  case new.event_type
    when 'order.created' then merchant_title := 'Novo pedido de compras';
    when 'order.preparing' then customer_title := 'Pedido confirmado pela loja';
    when 'order.rejected' then customer_title := 'Pedido recusado pela loja';
    when 'order.ready' then customer_title := 'Pedido pronto para retirada';
    when 'order.expired' then
      customer_title := 'Prazo de confirmação encerrado';
      merchant_title := 'Prazo de confirmação encerrado';
    when 'order.cancelled' then
      customer_title := 'Pedido de compras cancelado';
      merchant_title := 'Pedido de compras cancelado';
    when 'delivery_assigned' then customer_title := 'Entregador confirmou a entrega';
    when 'picked_up' then customer_title := 'Pedido a caminho';
    when 'delivered' then customer_title := 'Pedido entregue';
    when 'delivery_driver_withdrew' then
      customer_title := 'Buscando outro entregador';
      merchant_title := 'Buscando outro entregador';
    when 'dispatch_waiting_support' then
      customer_title := 'Entrega aguardando atendimento';
      merchant_title := 'Entrega aguardando atendimento';
      admin_title := 'Entrega de compras precisa de atendimento';
    when 'delivery_exception' then
      -- 1210 already sends the customer one transactional alert.
      merchant_title := 'Entrega de compras em atendimento';
      admin_title := 'Entrega de compras precisa de atendimento';
    when 'delivery_admin_resume' then customer_title := 'Entrega retomada';
    when 'delivery_admin_cancel' then
      customer_title := 'Pedido de compras cancelado';
      merchant_title := 'Pedido de compras cancelado';
    when 'delivery_admin_returned_restock' then
      customer_title := 'Entrega de compras encerrada';
      merchant_title := 'Entrega de compras encerrada';
    when 'delivery_admin_close_without_restock' then
      customer_title := 'Entrega de compras encerrada';
      merchant_title := 'Entrega de compras encerrada';
    else return new;
  end case;
  select * into current_order from public.market_orders where id=new.order_id;
  with recipients as (
    select p.id,'customer'::text as audience,customer_title as title,1 as sequence
    from public.profiles p where p.id=current_order.customer_id and customer_title is not null and not p.blocked
    union all
    select p.id,'merchant',merchant_title,2
    from public.market_store_members m join public.profiles p on p.id=m.user_id and not p.blocked
    where m.store_id=current_order.store_id and m.role in ('owner','manager') and merchant_title is not null
    union all
    select p.id,'admin',admin_title,3
    from public.profiles p where p.role='admin' and not p.blocked and admin_title is not null
  ), distinct_recipients as (
    select distinct on (id) id,audience,title from recipients
    where id is distinct from new.actor_id
    order by id,sequence desc
  )
  insert into public.notifications(user_id,type,title,body,data,market_order_event_id)
  select id,'market.order_update',title,'Abra o MotoPombal para consultar o pedido.',
    jsonb_build_object('orderId',new.order_id,'audience',audience),new.id
  from distinct_recipients
  on conflict(market_order_event_id,user_id) where market_order_event_id is not null do nothing;
  return new;
end;
$$;
revoke all on function private.publish_market_order_notification() from public,anon,authenticated;
create trigger publish_market_order_notification after insert on public.market_order_events
  for each row execute function private.publish_market_order_notification();

-- GPS now serializes driver -> driver_locations. Keep the existing market
-- behaviour while taking the same driver lock before withdraw/complete or an
-- administrative closure touches the location. Overall order remains:
-- market order -> ride -> driver -> driver_locations.
alter function public.market_driver_delivery_action(uuid,uuid,text,text,text)
  rename to market_driver_delivery_action_body;
alter function public.market_driver_delivery_action_body(uuid,uuid,text,text,text) set schema private;

create function public.market_driver_delivery_action(
  p_ride_id uuid,p_driver_id uuid,p_action text,p_reason text default null,p_reason_code text default null
)
returns public.rides language plpgsql security invoker set search_path = '' as $$
declare current_order_id uuid; current_driver_id uuid;
begin
  select o.id into current_order_id from public.market_orders o
  join public.rides r on r.market_order_id=o.id where r.id=p_ride_id for update of o;
  if current_order_id is null then return null; end if;
  -- A GPS INSERT may need KEY SHARE for its ride_id foreign key. This
  -- weaker lock lets it finish before we lock the driver and upgrade.
  select driver_id into current_driver_id from public.rides where id=p_ride_id for no key update;
  if current_driver_id=p_driver_id then
    perform 1 from public.drivers where profile_id=current_driver_id for update;
  end if;
  return private.market_driver_delivery_action_body(p_ride_id,p_driver_id,p_action,p_reason,p_reason_code);
end;
$$;

alter function public.market_admin_delivery_action(uuid,uuid,text,text)
  rename to market_admin_delivery_action_body;
alter function public.market_admin_delivery_action_body(uuid,uuid,text,text) set schema private;

create function public.market_admin_delivery_action(p_actor_id uuid,p_order_id uuid,p_action text,p_reason text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare current_driver_id uuid;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role='admin' and not blocked) then
    raise exception 'Administração obrigatória.' using errcode='42501';
  end if;
  perform 1 from public.market_orders where id=p_order_id for update;
  if not found then return false; end if;
  select driver_id into current_driver_id from public.rides where market_order_id=p_order_id
    and status not in ('finalizada','cancelada') for no key update;
  if current_driver_id is not null then
    perform 1 from public.drivers where profile_id=current_driver_id for update;
  end if;
  return private.market_admin_delivery_action_body(p_actor_id,p_order_id,p_action,p_reason);
end;
$$;

revoke all on function public.market_driver_delivery_action(uuid,uuid,text,text,text),
  public.market_admin_delivery_action(uuid,uuid,text,text),
  private.market_driver_delivery_action_body(uuid,uuid,text,text,text),
  private.market_admin_delivery_action_body(uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.market_driver_delivery_action(uuid,uuid,text,text,text),
  public.market_admin_delivery_action(uuid,uuid,text,text),
  private.market_driver_delivery_action_body(uuid,uuid,text,text,text),
  private.market_admin_delivery_action_body(uuid,uuid,text,text) to service_role;
