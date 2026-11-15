-- Reutiliza a caixa de notificações e a fila push existentes, sem criar um canal paralelo.
create or replace function private.notify_food_order_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  title text;
  message text;
begin
  if tg_op = 'INSERT' then
    insert into public.notifications(user_id, type, title, body, data)
    values (new.customer_id, 'food.customer.received', 'Pedido recebido',
      'Seu pedido foi enviado ao restaurante.', jsonb_build_object('foodOrderId', new.id));
    insert into public.notifications(user_id, type, title, body, data)
    select s.user_id, 'food.restaurant.new', 'Novo pedido de comida',
      'Confira e responda ao pedido recebido.', jsonb_build_object('foodOrderId', new.id)
    from public.restaurant_staff s where s.restaurant_id = new.restaurant_id;
    return new;
  end if;

  if old.status is distinct from new.status then
    title := case new.status
      when 'accepted' then 'Pedido aceito'
      when 'preparing' then 'Pedido em preparo'
      when 'ready' then 'Pedido pronto'
      when 'assigned' then 'Entregador confirmado'
      when 'at_restaurant' then 'Entregador no restaurante'
      when 'picked_up' then 'Pedido retirado'
      when 'on_the_way' then 'Pedido a caminho'
      when 'delivered' then 'Pedido entregue'
      when 'rejected' then 'Pedido recusado'
      when 'cancelled' then 'Pedido cancelado'
      when 'delivery_failed' then 'Entrega não concluída'
      else null
    end;
    if title is not null then
      message := case new.status
        when 'rejected' then 'O restaurante recusou o pedido. Confira o motivo no acompanhamento.'
        when 'cancelled' then 'O pedido foi cancelado. Confira o motivo no acompanhamento.'
        when 'delivery_failed' then 'A entrega não foi concluída. Confira o acompanhamento.'
        else 'Acompanhe as próximas etapas do seu pedido no MotoPombal.'
      end;
      insert into public.notifications(user_id, type, title, body, data)
      values (new.customer_id, 'food.customer.status', title, message,
        jsonb_build_object('foodOrderId', new.id, 'status', new.status));
    end if;
    if new.status in ('ready','assigned','picked_up','delivered','cancelled','delivery_failed') then
      insert into public.notifications(user_id, type, title, body, data)
      select s.user_id, 'food.restaurant.status', title,
        'O pedido teve uma atualização.', jsonb_build_object('foodOrderId', new.id, 'status', new.status)
      from public.restaurant_staff s where s.restaurant_id = new.restaurant_id;
    end if;
    if new.status = 'ready' then
      insert into public.notifications(user_id, type, title, body, data)
      select d.profile_id, 'food.driver.offer', 'Entrega de restaurante disponível',
        'Um pedido está pronto para retirada. Confira a lista de entregas.',
        jsonb_build_object('foodOrderId', new.id)
      from public.drivers d
      join public.driver_delivery_preferences pref on pref.driver_id = d.profile_id and pref.enabled
      join public.profiles p on p.id = d.profile_id and not p.blocked
      left join public.driver_locations location on location.driver_id = d.profile_id
      where d.approval_status = 'approved' and d.online and d.available and d.on_shift
        and not exists (select 1 from public.rides ride where ride.driver_id = d.profile_id
          and ride.status not in ('finalizada','cancelada'))
        and not exists (select 1 from public.food_orders active_order where active_order.driver_id = d.profile_id
          and active_order.status in ('assigned','at_restaurant','picked_up','on_the_way'))
      order by case when location.updated_at > now() - interval '5 minutes'
        then power(location.latitude - (select r.latitude from public.restaurants r where r.id = new.restaurant_id), 2)
          + power(location.longitude - (select r.longitude from public.restaurants r where r.id = new.restaurant_id), 2)
        else 999 end, d.updated_at
      limit 30;
    end if;
    if new.driver_id is not null and new.status in ('assigned','cancelled','delivery_failed') then
      insert into public.notifications(user_id, type, title, body, data)
      values (new.driver_id, 'food.driver.status', title,
        'Confira sua entrega no MotoPombal.', jsonb_build_object('foodOrderId', new.id, 'status', new.status));
    end if;
  end if;
  if old.payment_status is distinct from new.payment_status and new.payment_status = 'paid' then
    insert into public.notifications(user_id, type, title, body, data)
    values (new.customer_id, 'food.customer.payment', 'Pagamento registrado',
      'O recebimento do pedido foi registrado.', jsonb_build_object('foodOrderId', new.id));
  end if;
  return new;
end;
$$;
revoke all on function private.notify_food_order_change() from public;
create trigger notify_food_order_change
after insert or update of status, payment_status, driver_id on public.food_orders
for each row execute function private.notify_food_order_change();
