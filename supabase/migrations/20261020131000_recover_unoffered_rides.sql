-- Recupera solicitações interrompidas após o INSERT e antes do primeiro despacho.
-- A janela de dois minutos protege a criação ainda em andamento na API.
grant select, delete on public.coupon_redemptions to service_role;

create or replace function public.expire_ride_searches(p_ride_id uuid default null)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  searching record;
  changed_count integer := 0;
  offer_count_before integer;
  incomplete_coupon boolean;
  offered_driver uuid;
begin
  for searching in
    select ride.id, ride.passenger_id, ride.redispatch_started_at, ride.coupon_id, ride.discount_cents
    from public.rides ride
    where ride.status = 'procurando_motorista' and ride.driver_id is null
      and (p_ride_id is null or ride.id = p_ride_id)
      and (
        exists (select 1 from public.ride_requests request where request.ride_id = ride.id)
        or ride.created_at <= now() - interval '2 minutes'
      )
    for update of ride skip locked
  loop
    select count(*) into offer_count_before from public.ride_requests where ride_id = searching.id;
    incomplete_coupon := offer_count_before = 0 and searching.coupon_id is not null and not exists (
      select 1 from public.coupon_redemptions redemption where redemption.ride_id = searching.id
        and redemption.coupon_id = searching.coupon_id and redemption.user_id = searching.passenger_id
        and redemption.discount_cents = searching.discount_cents
    );
    offered_driver := null;
    if not incomplete_coupon then offered_driver := public.dispatch_next_offer(searching.id); end if;
    if offered_driver is not null then
      if (select count(*) from public.ride_requests where ride_id = searching.id) > offer_count_before then
        changed_count := changed_count + 1;
      end if;
      continue;
    end if;
    if not incomplete_coupon and searching.redispatch_started_at is not null and
      now() < searching.redispatch_started_at + interval '5 minutes' then continue; end if;
    update public.rides set status = 'cancelada', cancelled_at = now(),
      cancellation_reason = case when incomplete_coupon then 'Reserva do cupom não foi concluída. Solicite novamente.'
        else 'Nenhum motorista elegivel aceitou a solicitacao.' end
    where id = searching.id and status = 'procurando_motorista';
    -- A reserva de uma solicitação que nunca foi distribuída não consome o cupom.
    if offer_count_before = 0 then
      delete from public.coupon_redemptions where ride_id = searching.id;
    end if;
    update public.passenger_locations set ride_id = null
    where passenger_id = searching.passenger_id and ride_id = searching.id;
    insert into public.ride_history(ride_id,from_status,to_status,metadata)
    values (searching.id,'procurando_motorista','cancelada',jsonb_build_object('reason',
      case when incomplete_coupon then 'request_incomplete' else 'no_driver_found' end));
    insert into public.notifications(user_id,type,title,body,data)
    values (searching.passenger_id,'ride.no_driver_found',
      case when incomplete_coupon then 'Solicitação encerrada' else 'Nenhum motorista disponível' end,
      case when incomplete_coupon then 'Não foi possível concluir a solicitação. Você pode tentar novamente.'
        else 'Nenhum outro motorista aceitou a corrida. Você pode tentar novamente.' end,
      jsonb_build_object('rideId',searching.id));
    changed_count := changed_count + 1;
  end loop;
  return changed_count;
end;
$$;
revoke all on function public.expire_ride_searches(uuid) from public, anon, authenticated;
grant execute on function public.expire_ride_searches(uuid) to service_role;
