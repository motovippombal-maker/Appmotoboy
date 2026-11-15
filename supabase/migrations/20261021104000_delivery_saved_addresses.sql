create table public.food_saved_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.passengers(profile_id) on delete cascade,
  label text not null check (char_length(trim(label)) between 2 and 50),
  address jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index food_saved_addresses_customer_idx on public.food_saved_addresses(customer_id, created_at desc);
create trigger food_saved_addresses_updated before update on public.food_saved_addresses
for each row execute function private.set_updated_at();
alter table public.food_saved_addresses enable row level security;
create policy food_saved_addresses_read on public.food_saved_addresses for select to authenticated
using (customer_id = (select auth.uid()));
revoke all on public.food_saved_addresses from anon, authenticated;
grant select on public.food_saved_addresses to authenticated;
grant all on public.food_saved_addresses to service_role;
