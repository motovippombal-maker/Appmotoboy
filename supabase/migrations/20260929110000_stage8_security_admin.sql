-- ETAPA 8: endurecimento incremental. Nao altera nem apaga dados existentes.
-- A aplicacao usa service_role apenas no backend; authenticated conserva leitura
-- sujeita a RLS e edicao das tres colunas publicas do proprio perfil.
revoke insert, update, delete on public.profiles, public.passengers,
  public.drivers, public.vehicles, public.rides, public.ride_requests,
  public.driver_locations, public.passenger_locations, public.ride_history,
  public.ride_location_points, public.ratings, public.payments,
  public.pix_transactions, public.notifications, public.system_settings,
  public.audit_logs, public.api_rate_limits, public.fare_regions,
  public.service_areas, public.quick_places, public.coupons,
  public.coupon_redemptions, public.payment_webhook_events,
  public.push_subscriptions, public.notification_push_deliveries
from public, anon, authenticated;

grant update(full_name, phone, avatar_url) on public.profiles to authenticated;

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
using (id = (select auth.uid()) and not blocked)
with check (id = (select auth.uid()) and not blocked);

drop policy if exists drivers_read on public.drivers;
create policy drivers_read on public.drivers for select to authenticated
using (profile_id = (select auth.uid()) or approval_status = 'approved'
  or (select private.is_admin()));

drop policy if exists vehicles_read on public.vehicles;
create policy vehicles_read on public.vehicles for select to authenticated
using (driver_id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists settings_read on public.system_settings;
create policy settings_read on public.system_settings for select to authenticated
using ((select private.is_admin()));

drop policy if exists coupons_active_read on public.coupons;
create policy coupons_admin_read on public.coupons for select to authenticated
using ((select private.is_admin()));

drop policy if exists coupons_admin_write on public.coupons;
drop policy if exists coupon_redemptions_own_insert on public.coupon_redemptions;

create or replace function private.protect_profile_admin_fields()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    if old.id is distinct from new.id or old.role is distinct from new.role
      or old.blocked is distinct from new.blocked
      or old.created_at is distinct from new.created_at then
      raise exception 'Campos administrativos do perfil sao imutaveis pelo usuario'
        using errcode = '42501';
    end if;
    if old.avatar_url is distinct from new.avatar_url
      and new.avatar_url is not null
      and new.avatar_url not like new.id::text || '/%' then
      raise exception 'Foto deve pertencer ao proprio perfil' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.protect_profile_admin_fields() from public, anon, authenticated;
drop trigger if exists protect_profile_admin_fields on public.profiles;
create trigger protect_profile_admin_fields before update on public.profiles
for each row execute function private.protect_profile_admin_fields();

create or replace function private.vehicle_change_requires_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.driver_id is distinct from new.driver_id then
    raise exception 'Veiculo nao pode trocar de motorista' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.brand is not distinct from new.brand
    and old.model is not distinct from new.model
    and old.color is not distinct from new.color
    and old.plate is not distinct from new.plate
    and old.active is not distinct from new.active then
    return new;
  end if;
  if exists (
    select 1 from public.rides
    where driver_id = new.driver_id and status not in ('finalizada', 'cancelada')
  ) then
    raise exception 'Conclua ou cancele a corrida antes de trocar a moto'
      using errcode = 'P0001';
  end if;
  update public.drivers
  set approval_status = 'pending', approved_at = null, online = false, available = false
  where profile_id = new.driver_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id)
  values (new.driver_id, 'vehicle.requires_review', 'vehicle', new.id::text);
  return new;
end;
$$;

revoke all on function private.vehicle_change_requires_review() from public, anon, authenticated;
drop trigger if exists vehicle_change_requires_review on public.vehicles;
create trigger vehicle_change_requires_review
after insert or update of brand, model, color, plate, active, driver_id on public.vehicles
for each row execute function private.vehicle_change_requires_review();

create or replace function public.admin_set_driver_approval(
  p_driver_id uuid, p_actor_id uuid, p_status text
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor public.profiles;
  target public.profiles;
  target_driver public.drivers;
  next_status public.driver_approval;
begin
  if p_status not in ('approved', 'rejected', 'blocked', 'pending') then
    raise exception 'Estado administrativo invalido' using errcode = 'P0001';
  end if;
  select * into actor from public.profiles where id = p_actor_id;
  if actor.id is null or actor.role <> 'admin' or actor.blocked then
    raise exception 'Somente administrador ativo pode alterar aprovacao'
      using errcode = '42501';
  end if;
  select * into target from public.profiles where id = p_driver_id for update;
  select * into target_driver from public.drivers where profile_id = p_driver_id for update;
  if target.id is null or target.role <> 'driver' or target_driver.profile_id is null then
    raise exception 'Motorista nao encontrado' using errcode = 'P0001';
  end if;
  if p_status = 'approved' and not exists (
    select 1 from public.vehicles where driver_id = p_driver_id and active
  ) then
    raise exception 'Motorista sem veiculo ativo' using errcode = 'P0001';
  end if;
  next_status := case p_status when 'blocked' then 'suspended'::public.driver_approval
    else p_status::public.driver_approval end;
  update public.drivers
  set approval_status = next_status,
      approved_at = case when p_status = 'approved' then now() else null end,
      online = false, available = false
  where profile_id = p_driver_id;
  update public.profiles set blocked = (p_status = 'blocked') where id = p_driver_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (p_actor_id, 'driver.' || p_status, 'driver', p_driver_id::text,
    jsonb_build_object('previous_status', target_driver.approval_status));
  return jsonb_build_object('profile_id', p_driver_id, 'approval_status', next_status,
    'blocked', (p_status = 'blocked'));
end;
$$;

revoke all on function public.admin_set_driver_approval(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.admin_set_driver_approval(uuid, uuid, text) to service_role;

create or replace function private.reject_blocked_ride_participants()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.profiles where id = new.passenger_id and blocked) then
      raise exception 'Passageiro bloqueado nao pode solicitar corrida' using errcode = '42501';
    end if;
  elsif new.status = 'aceita' and old.status is distinct from new.status then
    if exists (select 1 from public.profiles where id = new.driver_id and blocked) then
      raise exception 'Motorista bloqueado nao pode aceitar corrida' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.reject_blocked_ride_participants()
from public, anon, authenticated;
drop trigger if exists reject_blocked_ride_participants on public.rides;
create trigger reject_blocked_ride_participants before insert or update of status on public.rides
for each row execute function private.reject_blocked_ride_participants();
