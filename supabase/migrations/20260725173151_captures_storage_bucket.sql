-- Private bucket for uploaded capture PDFs, no public URLs (architecture.md).
insert into storage.buckets (id, name, public)
values ('captures', 'captures', false)
on conflict (id) do nothing;

-- Owner-only access, scoped to a per-user path prefix: <uid>/<file>.
create policy captures_owner_select on storage.objects
  for select to authenticated
  using (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text);

create policy captures_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text);

create policy captures_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text);

create policy captures_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text);
