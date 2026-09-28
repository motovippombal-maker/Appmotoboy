-- Moto VIP - Etapa 5
-- Evolucao incremental de pagamentos, historicos, avaliacoes e notificacoes.

alter type public.payment_status add value if not exists 'expirado';

create table if not exists public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  provider_reference text,
  event_type text not null,
  payload_hash text not null,
  processed_at timestamptz not null default now(),
  unique(provider, event_id)
);

create index if not exists payment_webhook_reference_idx
  on public.payment_webhook_events(provider, provider_reference);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, endpoint)
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions(user_id, active);

create trigger push_subscriptions_updated
before update on public.push_subscriptions
for each row execute function private.set_updated_at();

alter table public.payment_webhook_events enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_own_read on public.push_subscriptions;
create policy push_subscriptions_own_read on public.push_subscriptions
for select to authenticated
using (user_id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists payment_webhook_admin_read on public.payment_webhook_events;
create policy payment_webhook_admin_read on public.payment_webhook_events
for select to authenticated using ((select private.is_admin()));

revoke insert, update, delete on public.payment_webhook_events, public.push_subscriptions from anon, authenticated;
grant select on public.push_subscriptions to authenticated;
grant select on public.payment_webhook_events to authenticated;
grant select, insert, update, delete on public.payment_webhook_events, public.push_subscriptions to service_role;

insert into public.system_settings(key, value, description)
values ('commission', '{"configured":false,"percentage_bps":0,"fixed_cents":0}'::jsonb, 'Comissao futura da plataforma. Nao aplicada enquanto configured=false.')
on conflict (key) do nothing;

create or replace function private.ensure_finished_ride_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'finalizada' and old.status is distinct from new.status then
    insert into public.payments(ride_id, passenger_id, method, status, amount_cents)
    values (
      new.id,
      new.passenger_id,
      new.payment_method,
      'aguardando_pagamento',
      coalesce(new.final_fare_cents, new.fare_cents)
    )
    on conflict (ride_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function private.ensure_finished_ride_payment() from public;
drop trigger if exists ensure_finished_ride_payment on public.rides;
create trigger ensure_finished_ride_payment
after update of status on public.rides
for each row execute function private.ensure_finished_ride_payment();

insert into public.payments(ride_id, passenger_id, method, status, amount_cents)
select r.id, r.passenger_id, r.payment_method, r.payment_status, coalesce(r.final_fare_cents, r.fare_cents)
from public.rides r
where r.status = 'finalizada'
on conflict (ride_id) do nothing;

create or replace function private.notify_ride_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  notification_title text;
  notification_body text;
begin
  if old.status = new.status then return new; end if;
  notification_title := case new.status
    when 'aceita' then 'Corrida aceita'
    when 'motorista_a_caminho' then 'Motorista a caminho'
    when 'motorista_chegou' then 'Seu motorista chegou'
    when 'em_corrida' then 'Corrida iniciada'
    when 'finalizada' then 'Corrida finalizada'
    when 'cancelada' then 'Corrida cancelada'
    else null
  end;
  notification_body := case new.status
    when 'aceita' then 'Um motorista aceitou sua corrida.'
    when 'motorista_a_caminho' then 'Seu motorista está chegando ao ponto de embarque.'
    when 'motorista_chegou' then 'Seu motorista chegou ao local de embarque.'
    when 'em_corrida' then 'Sua corrida foi iniciada.'
    when 'finalizada' then 'A corrida foi finalizada. Confira o resumo e o pagamento.'
    when 'cancelada' then 'A corrida foi cancelada.'
    else null
  end;
  if notification_title is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (new.passenger_id, 'ride.' || new.status::text, notification_title, notification_body, jsonb_build_object('rideId', new.id));
  end if;
  if new.status = 'finalizada' and new.driver_id is not null then
    insert into public.notifications(user_id, type, title, body, data)
    values (new.driver_id, 'ride.finalizada', 'Corrida finalizada', 'A corrida foi concluída e adicionada aos seus ganhos brutos.', jsonb_build_object('rideId', new.id));
  end if;
  return new;
end;
$$;

revoke all on function private.notify_ride_change() from public;
drop trigger if exists notify_ride_change on public.rides;
create trigger notify_ride_change
after update of status on public.rides
for each row execute function private.notify_ride_change();

create or replace function private.notify_new_offer()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications(user_id, type, title, body, data)
  values (new.driver_id, 'ride.offer', 'Nova corrida disponível', 'Uma nova solicitação está disponível para você.', jsonb_build_object('rideId', new.ride_id, 'offerId', new.id));
  return new;
end;
$$;

revoke all on function private.notify_new_offer() from public;
drop trigger if exists notify_new_offer on public.ride_requests;
create trigger notify_new_offer
after insert on public.ride_requests
for each row execute function private.notify_new_offer();

create or replace function private.sync_payment_state()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.rides set payment_status = new.status where id = new.ride_id;
  if old.status is distinct from new.status and new.status = 'pago' then
    insert into public.notifications(user_id, type, title, body, data)
    values (new.passenger_id, 'payment.paid', 'Pagamento confirmado', 'Seu pagamento foi confirmado com segurança.', jsonb_build_object('rideId', new.ride_id, 'paymentId', new.id));
  end if;
  return new;
end;
$$;

revoke all on function private.sync_payment_state() from public;
drop trigger if exists sync_payment_state on public.payments;
create trigger sync_payment_state
after update of status on public.payments
for each row execute function private.sync_payment_state();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'payments'
  ) then
    alter publication supabase_realtime add table public.payments;
  end if;
end $$;
