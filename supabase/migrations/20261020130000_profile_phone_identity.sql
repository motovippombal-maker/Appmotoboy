-- Telefones de contato permanecem editáveis; identidades de login são resolvidas
-- sem escolher arbitrariamente um perfil. Não reescreve dados legados.
create or replace function public.normalize_brazilian_phone(p_phone text)
returns text language plpgsql immutable strict set search_path = '' as $$
declare digits text;
begin
  digits := regexp_replace(p_phone, '[^0-9]', '', 'g');
  if length(digits) in (12, 13) and left(digits, 2) = '55' then
    digits := substr(digits, 3);
  end if;
  if digits !~ '^(1[1-9]|[2-9][0-9])[1-9][0-9]{7,8}$' then return null; end if;
  return '+55' || digits;
end;
$$;

-- Interrompe a migração antes de criar índice/trigger se houver dados ambíguos.
-- A central precisa conferir a titularidade e corrigir esses casos manualmente.
do $$
begin
  if exists (
    select public.normalize_brazilian_phone(phone)
    from public.profiles
    where public.normalize_brazilian_phone(phone) is not null
    group by public.normalize_brazilian_phone(phone) having count(*) > 1
  ) then
    raise exception 'Telefones duplicados após normalização. Resolva a titularidade manualmente antes de reaplicar esta migração; nenhum perfil ou telefone foi removido.'
      using errcode = '23505', constraint = 'profiles_phone_normalized_unique';
  end if;
  if exists (
    select 1 from public.profiles profile join auth.users account
      on lower(to_jsonb(account) ->> 'email') =
        replace(public.normalize_brazilian_phone(profile.phone), '+', '') || '@phone.motovip.invalid'
      and account.id <> profile.id
  ) then
    raise exception 'Telefone de perfil conflita com o alias de login de outra conta. Resolva a titularidade manualmente; nenhum perfil ou telefone foi removido.'
      using errcode = '23505', constraint = 'profiles_phone_auth_alias_unique';
  end if;
  if exists (
    select lower(to_jsonb(account) ->> 'email') from auth.users account
    where lower(to_jsonb(account) ->> 'email') like '%@phone.motovip.invalid'
    group by lower(to_jsonb(account) ->> 'email') having count(*) > 1
  ) then
    raise exception 'Alias de telefone associado a mais de uma conta. Resolva a titularidade manualmente; nenhum usuário foi removido.'
      using errcode = '23505', constraint = 'profiles_phone_auth_alias_unique';
  end if;
end;
$$;

create unique index if not exists profiles_phone_normalized_unique
  on public.profiles(public.normalize_brazilian_phone(phone))
  where public.normalize_brazilian_phone(phone) is not null;

create or replace function private.normalize_profile_phone()
returns trigger language plpgsql security definer set search_path = '' as $$
declare normalized text;
begin
  if tg_op = 'UPDATE' and new.phone is not distinct from old.phone then return new; end if;
  if new.phone is null or btrim(new.phone) = '' then new.phone := null; return new; end if;
  normalized := public.normalize_brazilian_phone(new.phone);
  if normalized is null then raise exception 'Telefone brasileiro inválido.' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phone-identity:' || normalized, 0));
  -- Trocar o contato não libera o alias interno original para outra conta.
  if exists (select 1 from auth.users account
    where lower(to_jsonb(account) ->> 'email') = replace(normalized, '+', '') || '@phone.motovip.invalid'
      and account.id <> new.id) then
    raise exception 'Telefone reservado ao login de outra conta.'
      using errcode = '23505', constraint = 'profiles_phone_auth_alias_unique';
  end if;
  new.phone := normalized;
  return new;
end;
$$;
revoke all on function private.normalize_profile_phone() from public, anon, authenticated;
drop trigger if exists normalize_profile_phone on public.profiles;
create trigger normalize_profile_phone before insert or update of phone on public.profiles
for each row execute function private.normalize_profile_phone();

-- Bloqueia também o caminho inverso: um cadastro direto no Auth não pode criar
-- um alias interno que pertença ao telefone de contato de outra conta legada.
create or replace function private.protect_phone_auth_alias()
returns trigger language plpgsql security definer set search_path = '' as $$
declare next_email text; normalized text;
begin
  next_email := lower(to_jsonb(new) ->> 'email');
  if tg_op = 'UPDATE' then
    if next_email is not distinct from lower(to_jsonb(old) ->> 'email') then return new; end if;
  end if;
  if next_email is null or next_email not like '%@phone.motovip.invalid' then return new; end if;
  normalized := public.normalize_brazilian_phone(split_part(next_email, '@', 1));
  if normalized is null then raise exception 'Alias de telefone inválido.' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phone-identity:' || normalized, 0));
  if exists (select 1 from auth.users account
    where lower(to_jsonb(account) ->> 'email') = next_email and account.id <> new.id) then
    raise exception 'Telefone reservado ao login de outra conta.'
      using errcode = '23505', constraint = 'profiles_phone_auth_alias_unique';
  end if;
  if exists (select 1 from public.profiles profile
    where public.normalize_brazilian_phone(profile.phone) = normalized and profile.id <> new.id) then
    raise exception 'Telefone já cadastrado em outra conta.'
      using errcode = '23505', constraint = 'profiles_phone_auth_alias_unique';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_phone_auth_alias() from public, anon, authenticated;
drop trigger if exists protect_phone_auth_alias on auth.users;
create trigger protect_phone_auth_alias before insert or update on auth.users
for each row execute function private.protect_phone_auth_alias();

create or replace function public.resolve_phone_login(p_phone text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare normalized text; resolved record; matching_profiles integer; matching_aliases integer;
begin
  normalized := public.normalize_brazilian_phone(p_phone);
  if normalized is null then raise exception 'Telefone brasileiro inválido.' using errcode = '22023'; end if;
  -- Preserva o login original de contas criadas por telefone, mesmo após uma
  -- alteração legítima de contato. E-mails de contas legadas são preservados.
  select count(*) into matching_aliases from auth.users account
  where lower(to_jsonb(account) ->> 'email') = replace(normalized, '+', '') || '@phone.motovip.invalid';
  if matching_aliases > 1 then
    raise exception 'Alias de telefone associado a mais de uma conta; resolução manual necessária.' using errcode = '23505';
  end if;
  select account.id, to_jsonb(account) ->> 'email' as email into resolved
  from auth.users account
  where lower(to_jsonb(account) ->> 'email') = replace(normalized, '+', '') || '@phone.motovip.invalid';
  if found then return jsonb_build_object('id', resolved.id, 'email', resolved.email); end if;
  select count(*) into matching_profiles from public.profiles
  where public.normalize_brazilian_phone(phone) = normalized;
  if matching_profiles > 1 then
    raise exception 'Telefone associado a mais de uma conta; resolução manual necessária.' using errcode = '23505';
  end if;
  select profile.id, to_jsonb(account) ->> 'email' as email into resolved
  from public.profiles profile join auth.users account on account.id = profile.id
  where public.normalize_brazilian_phone(profile.phone) = normalized;
  if not found then return null; end if;
  return jsonb_build_object('id', resolved.id, 'email', resolved.email);
end;
$$;
revoke all on function public.resolve_phone_login(text) from public, anon, authenticated;
grant execute on function public.resolve_phone_login(text) to service_role;

comment on index public.profiles_phone_normalized_unique is
  'Unicidade do telefone brasileiro, incluindo formatos com DDD, pontuação e prefixo +55. Dados legados não são reescritos.';
