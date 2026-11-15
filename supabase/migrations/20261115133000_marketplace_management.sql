-- Service-only commands for store management. Status, membership and audit data
-- are committed together; a revoked member cannot finish a later mutation.
create or replace function public.market_manage_store(
  p_actor_id uuid,
  p_action text,
  p_store_id uuid default null,
  p_target_id uuid default null,
  p_parent_id uuid default null,
  p_data jsonb default '{}'::jsonb,
  p_reason text default null
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  actor public.profiles;
  store public.market_stores;
  product public.market_products;
  member_role text;
  target uuid := p_target_id;
begin
  select * into actor from public.profiles where id = p_actor_id for share;
  if not found or actor.blocked then raise exception 'MARKET_FORBIDDEN' using errcode = '42501'; end if;
  if p_action = 'createStore' then
    if actor.role <> 'admin' then raise exception 'MARKET_FORBIDDEN' using errcode = '42501'; end if;
    insert into public.market_stores(slug,name,description,category,image_url,cover_url,address,latitude,longitude,service_area_id,status,is_open,prep_minutes,hours)
    values (p_data->>'slug', p_data->>'name', p_data->>'description', p_data->>'category', p_data->>'image_url',p_data->>'cover_url',p_data->>'address',
      (p_data->>'latitude')::double precision,(p_data->>'longitude')::double precision,(p_data->>'service_area_id')::uuid,'pending',
      (p_data->>'is_open')::boolean,(p_data->>'prep_minutes')::integer,p_data->'hours')
    returning * into store;
    target := store.id;
  else
    select * into store from public.market_stores where id = p_store_id for update;
    if not found then raise exception 'MARKET_STORE_NOT_FOUND' using errcode = 'P0002'; end if;
    if actor.role <> 'admin' then
      select role::text into member_role from public.market_store_members
      where store_id = store.id and user_id = p_actor_id for share;
      if member_role is null or p_action in ('setStoreStatus','setStorePickup','setMember')
        or (p_action = 'setPreferredDriver' and member_role <> 'owner') then
        raise exception 'MARKET_FORBIDDEN' using errcode = '42501';
      end if;
    end if;

    case p_action
    when 'saveStore' then
      update public.market_stores set name = p_data->>'name', description = p_data->>'description',
        category = p_data->>'category', image_url = p_data->>'image_url', cover_url = p_data->>'cover_url',
        is_open = (p_data->>'is_open')::boolean, prep_minutes = (p_data->>'prep_minutes')::integer, hours = p_data->'hours'
      where id = store.id returning id into target;
    when 'setStorePickup' then
      update public.market_stores set address = p_data->>'address',latitude = (p_data->>'latitude')::double precision,
        longitude = (p_data->>'longitude')::double precision,service_area_id = (p_data->>'service_area_id')::uuid
      where id = store.id returning id into target;
    when 'setStoreStatus' then
      if char_length(trim(coalesce(p_reason,''))) < 3 then raise exception 'MARKET_REASON_REQUIRED' using errcode = '22023'; end if;
      -- Update status without touching commercial orders or any accepted delivery.
      update public.market_stores set status = case p_data->>'status'
        when 'approved' then 'approved' when 'suspended' then 'suspended' when 'pending' then 'pending' end,
        active = p_data->>'status' <> 'suspended' where id = store.id returning id into target;
    when 'setMember' then
      if char_length(trim(coalesce(p_reason,''))) < 3 then raise exception 'MARKET_REASON_REQUIRED' using errcode = '22023'; end if;
      if p_data->>'role' is null then
        delete from public.market_store_members where store_id = store.id and user_id = p_target_id;
      else
        if not exists (select 1 from public.profiles where id = p_target_id and not blocked) then
          raise exception 'MARKET_MEMBER_UNAVAILABLE' using errcode = '22023';
        end if;
        insert into public.market_store_members(store_id,user_id,role)
        values (store.id,p_target_id,case p_data->>'role' when 'owner' then 'owner' when 'manager' then 'manager' end)
        on conflict (store_id,user_id) do update set role = excluded.role;
      end if;
    when 'setPreferredDriver' then
      if p_target_id is not null and not exists (
        select 1 from public.drivers driver join public.profiles profile on profile.id = driver.profile_id
        where driver.profile_id = p_target_id and driver.approval_status = 'approved' and not profile.blocked
      ) then raise exception 'MARKET_DRIVER_UNAVAILABLE' using errcode = '22023'; end if;
      update public.market_stores set preferred_driver_id = p_target_id where id = store.id;
    when 'saveCategory' then
      if p_target_id is null then
        insert into public.market_categories(store_id,name,active,sort_order)
        values (store.id,p_data->>'name',(p_data->>'active')::boolean,(p_data->>'sort_order')::integer) returning id into target;
      else
        update public.market_categories set name = p_data->>'name',active = (p_data->>'active')::boolean,sort_order = (p_data->>'sort_order')::integer
        where id = p_target_id and store_id = store.id returning id into target;
      end if;
    when 'saveProduct' then
      if p_data->>'category_id' is not null and not exists (select 1 from public.market_categories where id = (p_data->>'category_id')::uuid and store_id = store.id) then
        raise exception 'MARKET_TARGET_NOT_FOUND' using errcode = 'P0002';
      end if;
      if p_target_id is null then
        insert into public.market_products(store_id,category_id,name,description,image_url,price_cents,stock_quantity,active,sort_order)
        values (store.id,(p_data->>'category_id')::uuid,p_data->>'name',p_data->>'description',p_data->>'image_url',
          (p_data->>'price_cents')::integer,(p_data->>'stock_quantity')::integer,(p_data->>'active')::boolean,(p_data->>'sort_order')::integer)
        returning id into target;
      else
        select * into product from public.market_products where id = p_target_id and store_id = store.id for update;
        if not found then raise exception 'MARKET_TARGET_NOT_FOUND' using errcode = 'P0002'; end if;
        if not (p_data ? 'expected_stock') or product.stock_quantity is distinct from (p_data->>'expected_stock')::integer then
          raise exception 'MARKET_STOCK_CHANGED' using errcode = '40001';
        end if;
        update public.market_products set category_id = (p_data->>'category_id')::uuid,name = p_data->>'name',description = p_data->>'description',
          image_url = p_data->>'image_url',price_cents = (p_data->>'price_cents')::integer,stock_quantity = (p_data->>'stock_quantity')::integer,
          active = (p_data->>'active')::boolean,sort_order = (p_data->>'sort_order')::integer
        where id = product.id and store_id = store.id returning id into target;
      end if;
    when 'saveGroup' then
      if not exists (select 1 from public.market_products where id = p_parent_id and store_id = store.id) then
        raise exception 'MARKET_TARGET_NOT_FOUND' using errcode = 'P0002';
      end if;
      if p_target_id is null then
        insert into public.market_option_groups(store_id,product_id,name,min_select,max_select,active,sort_order)
        values (store.id,p_parent_id,p_data->>'name',(p_data->>'min_select')::integer,(p_data->>'max_select')::integer,
          (p_data->>'active')::boolean,(p_data->>'sort_order')::integer) returning id into target;
      else
        update public.market_option_groups set name = p_data->>'name',min_select = (p_data->>'min_select')::integer,
          max_select = (p_data->>'max_select')::integer,active = (p_data->>'active')::boolean,sort_order = (p_data->>'sort_order')::integer
        where id = p_target_id and product_id = p_parent_id and store_id = store.id returning id into target;
      end if;
    when 'saveOption' then
      if not exists (select 1 from public.market_option_groups where id = p_parent_id and store_id = store.id) then
        raise exception 'MARKET_TARGET_NOT_FOUND' using errcode = 'P0002';
      end if;
      if p_target_id is null then
        insert into public.market_options(store_id,group_id,name,price_cents,active,sort_order)
        values (store.id,p_parent_id,p_data->>'name',(p_data->>'price_cents')::integer,(p_data->>'active')::boolean,
          (p_data->>'sort_order')::integer) returning id into target;
      else
        update public.market_options set name = p_data->>'name',price_cents = (p_data->>'price_cents')::integer,
          active = (p_data->>'active')::boolean,sort_order = (p_data->>'sort_order')::integer
        where id = p_target_id and group_id = p_parent_id and store_id = store.id returning id into target;
      end if;
    else raise exception 'MARKET_INVALID_ACTION' using errcode = '22023';
    end case;
    if target is null and p_action in ('saveCategory','saveProduct','saveGroup','saveOption') then
      raise exception 'MARKET_TARGET_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values (p_actor_id,'marketplace.' || p_action,'market_store',store.id::text,
    jsonb_strip_nulls(jsonb_build_object('targetId',target,'parentId',p_parent_id,'reason',p_reason,
      'status',case when p_action = 'setStoreStatus' then p_data->>'status' end,
      'role',case when p_action = 'setMember' then p_data->>'role' end)));
  return jsonb_build_object('storeId',store.id,'id',target);
end;
$$;

revoke all on function public.market_manage_store(uuid,text,uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.market_manage_store(uuid,text,uuid,uuid,uuid,jsonb,text) to service_role;

-- Public delivery of catalog assets uses immutable object URLs; browsers never
-- write objects directly. Supabase provides Storage, isolated SQL fixtures may not.
do $$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
    values ('marketplace-images','marketplace-images',true,3145728,array['image/jpeg','image/png','image/webp'])
    on conflict(id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

    drop policy if exists market_images_insert_server_only on storage.objects;
    create policy market_images_insert_server_only on storage.objects as restrictive for insert to anon, authenticated
      with check (bucket_id <> 'marketplace-images');
    drop policy if exists market_images_update_server_only on storage.objects;
    create policy market_images_update_server_only on storage.objects as restrictive for update to anon, authenticated
      using (bucket_id <> 'marketplace-images') with check (bucket_id <> 'marketplace-images');
    drop policy if exists market_images_delete_server_only on storage.objects;
    create policy market_images_delete_server_only on storage.objects as restrictive for delete to anon, authenticated
      using (bucket_id <> 'marketplace-images');
  end if;
end;
$$;
