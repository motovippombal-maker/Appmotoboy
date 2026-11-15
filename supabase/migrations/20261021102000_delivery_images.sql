-- Executado no Supabase, onde o schema storage existe. O teste PGlite ignora o bucket.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
    values ('restaurant-images', 'restaurant-images', true, 3145728,
      array['image/jpeg','image/png','image/webp'])
    on conflict (id) do nothing;
  end if;
end $$;
