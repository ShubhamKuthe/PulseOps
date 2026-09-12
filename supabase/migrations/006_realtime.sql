-- PulseOps migration 006: Realtime publication configuration

alter table public.incidents replica identity full;
alter table public.incident_comments replica identity full;
alter table public.incident_activity replica identity full;
alter table public.notifications replica identity full;
alter table public.services replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.incidents;
exception when duplicate_object then null; end $$;

do $$
begin
  alter publication supabase_realtime add table public.incident_comments;
exception when duplicate_object then null; end $$;

do $$
begin
  alter publication supabase_realtime add table public.incident_activity;
exception when duplicate_object then null; end $$;

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;

do $$
begin
  alter publication supabase_realtime add table public.services;
exception when duplicate_object then null; end $$;
