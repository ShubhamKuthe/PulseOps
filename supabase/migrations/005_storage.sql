-- PulseOps migration 005: Supabase Storage bucket and policies

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'incident-attachments',
  'incident-attachments',
  false,
  10485760,
  array['image/png','image/jpeg','image/webp','application/pdf','text/plain','text/csv','application/json','application/octet-stream']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.storage_path_uuid_segment(path text, segment integer)
returns uuid
language plpgsql
immutable
as $$
declare
  value text;
begin
  value := split_part(path, '/', segment);
  if value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return value::uuid;
  end if;
  return null;
end;
$$;

create policy incident_attachment_storage_select
on storage.objects for select
to authenticated
using (
  bucket_id = 'incident-attachments'
  and public.can_view_incident(public.storage_path_uuid_segment(name, 2))
);

create policy incident_attachment_storage_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'incident-attachments'
  and public.storage_path_uuid_segment(name, 1) = public.current_organization_id()
  and public.can_view_incident(public.storage_path_uuid_segment(name, 2))
);

create policy incident_attachment_storage_update_delete
on storage.objects for all
to authenticated
using (
  bucket_id = 'incident-attachments'
  and public.can_manage_incident(public.storage_path_uuid_segment(name, 2))
)
with check (
  bucket_id = 'incident-attachments'
  and public.storage_path_uuid_segment(name, 1) = public.current_organization_id()
  and public.can_manage_incident(public.storage_path_uuid_segment(name, 2))
);
