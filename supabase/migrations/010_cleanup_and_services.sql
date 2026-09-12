-- PulseOps migration 010: dead policy cleanup and service creation support
-- Run after 009_post_setup_hardening.sql.

-- ---------------------------------------------------------------------------
-- Drop dead incidents UPDATE policy
-- ---------------------------------------------------------------------------
-- Migration 008 revoked UPDATE on public.incidents from authenticated, so all
-- status/priority/assignment changes now go exclusively through the
-- security-definer RPC functions (change_incident_status, assign_incident,
-- change_incident_priority). This RLS policy from migration 004 can no
-- longer authorize anything (the underlying table privilege is gone), so it
-- is inert. Drop it to avoid leaving misleading dead code in place.
drop policy if exists incidents_manage_role_scope on public.incidents;

-- ---------------------------------------------------------------------------
-- Service creation support
-- ---------------------------------------------------------------------------
-- public.services.slug is not null + unique per organization, but nothing
-- previously generated it outside of the manual seed data. The UI now
-- supports creating a service directly, so auto-derive a URL-safe slug from
-- the service name when one isn't supplied, guaranteeing uniqueness within
-- the organization.
create or replace function public.prepare_service_slug()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base_slug text;
  candidate text;
  suffix int := 0;
begin
  new.organization_id := coalesce(new.organization_id, public.current_organization_id());

  if new.slug is null or btrim(new.slug) = '' then
    base_slug := lower(regexp_replace(coalesce(new.name, ''), '[^a-zA-Z0-9]+', '-', 'g'));
    base_slug := trim(both '-' from base_slug);
    if base_slug = '' then
      base_slug := 'service';
    end if;

    candidate := base_slug;
    while exists (
      select 1 from public.services
      where organization_id = new.organization_id
        and slug = candidate
        and id is distinct from new.id
    ) loop
      suffix := suffix + 1;
      candidate := base_slug || '-' || suffix;
    end loop;

    new.slug := candidate;
  end if;

  return new;
end;
$$;

drop trigger if exists prepare_service_slug_before_insert on public.services;
create trigger prepare_service_slug_before_insert
before insert on public.services
for each row execute function public.prepare_service_slug();

-- Note: service creation/updates are already captured in the audit stream
-- by the audit_services_after_change trigger created in migration 003 —
-- no additional audit trigger is needed here.
