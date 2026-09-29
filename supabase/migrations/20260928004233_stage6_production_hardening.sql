-- Moto VIP - Etapa 6
-- Endurecimento incremental para Push, consultas operacionais e producao.
-- Nao recria nem remove estruturas/dados existentes.

-- Esta migration precede a Etapa 5 pelo timestamp e precisa garantir a
-- dependencia usada por notification_push_deliveries. A Etapa 5 mantem o
-- mesmo CREATE TABLE IF NOT EXISTS para bancos que ja seguiram outra ordem.
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

create table if not exists public.notification_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'retry', 'sent', 'expired', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(notification_id, subscription_id)
);

create index if not exists notification_push_pending_idx
  on public.notification_push_deliveries(next_attempt_at, created_at)
  where status in ('pending', 'processing', 'retry');

create index if not exists rides_driver_completed_idx
  on public.rides(driver_id, completed_at desc)
  where status = 'finalizada';

create index if not exists rides_finance_period_idx
  on public.rides(created_at desc)
  where status in ('finalizada', 'cancelada');

alter table public.notification_push_deliveries enable row level security;

drop policy if exists notification_push_admin_read on public.notification_push_deliveries;
create policy notification_push_admin_read on public.notification_push_deliveries
for select to authenticated using ((select private.is_admin()));

revoke insert, update, delete on public.notification_push_deliveries from anon, authenticated;
grant select on public.notification_push_deliveries to authenticated;
grant select, insert, update, delete on public.notification_push_deliveries to service_role;

create trigger notification_push_deliveries_updated
before update on public.notification_push_deliveries
for each row execute function private.set_updated_at();

create or replace function private.enqueue_notification_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notification_push_deliveries(notification_id, subscription_id)
  select new.id, subscription.id
  from public.push_subscriptions subscription
  where subscription.user_id = new.user_id
    and subscription.active = true
  on conflict (notification_id, subscription_id) do nothing;
  return new;
end;
$$;

revoke all on function private.enqueue_notification_push() from public, anon, authenticated;
grant execute on function private.enqueue_notification_push() to service_role;

drop trigger if exists enqueue_notification_push on public.notifications;
create trigger enqueue_notification_push
after insert on public.notifications
for each row execute function private.enqueue_notification_push();
