-- PulseOps migration 009: post-setup workflow completion and hardening
-- Run after 008_backend_completion.sql.

-- ---------------------------------------------------------------------------
-- Attachment metadata deletion
-- ---------------------------------------------------------------------------
-- Storage object deletion was already limited to users who can manage the
-- incident. Mirror that rule on the metadata row so UI deletion can complete.
--
-- Migration 008 created this policy under the name
-- incident_attachments_delete_manage_incident. Drop that copy here so this
-- migration replaces it instead of leaving two overlapping DELETE policies
-- on the same table (verify-backend.sql only checks for the name below).
drop policy if exists incident_attachments_delete_manage_incident on public.incident_attachments;
drop policy if exists incident_attachments_delete_manage on public.incident_attachments;
create policy incident_attachments_delete_manage
on public.incident_attachments for delete
to authenticated
using (
  organization_id = public.current_organization_id()
  and public.can_manage_incident(incident_id)
);

-- ---------------------------------------------------------------------------
-- Knowledge article authorship
-- ---------------------------------------------------------------------------
create or replace function public.prepare_knowledge_article()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.organization_id := coalesce(new.organization_id, public.current_organization_id());
  new.author_id := coalesce(new.author_id, auth.uid());
  if new.article_number is null or new.article_number = '' then
    new.article_number := public.next_article_number();
  end if;
  return new;
end;
$$;

drop trigger if exists set_article_number_before_insert on public.knowledge_articles;
drop trigger if exists prepare_knowledge_article_before_insert on public.knowledge_articles;
create trigger prepare_knowledge_article_before_insert
before insert on public.knowledge_articles
for each row execute function public.prepare_knowledge_article();

-- ---------------------------------------------------------------------------
-- On-call schedule validation
-- ---------------------------------------------------------------------------
create or replace function public.prepare_on_call_schedule()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  team_org uuid;
  responder_org uuid;
  responder_team uuid;
  responder_status public.user_status;
  responder_role public.user_role;
begin
  select organization_id into team_org
  from public.teams
  where id = new.team_id;

  if team_org is null then
    raise exception 'Selected team does not exist';
  end if;

  select organization_id, team_id, status, role
  into responder_org, responder_team, responder_status, responder_role
  from public.profiles
  where id = new.profile_id;

  if responder_org is null then
    raise exception 'Selected responder does not exist';
  end if;

  if team_org is distinct from public.current_organization_id()
     or responder_org is distinct from public.current_organization_id() then
    raise exception 'On-call team and responder must belong to your organization';
  end if;

  if responder_status <> 'active' then
    raise exception 'On-call responder must be active';
  end if;

  if responder_role not in ('engineer','manager','administrator') then
    raise exception 'On-call responder must be an engineer, manager, or administrator';
  end if;

  if responder_team is not null and responder_team is distinct from new.team_id
     and responder_role <> 'administrator' then
    raise exception 'On-call responder must belong to the selected team';
  end if;

  if new.ends_at <= new.starts_at then
    raise exception 'On-call end time must be after the start time';
  end if;

  new.organization_id := team_org;
  return new;
end;
$$;

drop trigger if exists prepare_on_call_schedule_before_write on public.on_call_schedules;
create trigger prepare_on_call_schedule_before_write
before insert or update on public.on_call_schedules
for each row execute function public.prepare_on_call_schedule();

-- Preserve schedule administration in the immutable audit stream.
drop trigger if exists audit_on_call_after_change on public.on_call_schedules;
create trigger audit_on_call_after_change
after insert or update or delete on public.on_call_schedules
for each row execute function public.audit_changes();

-- ---------------------------------------------------------------------------
-- Cross-tenant relationship hardening for team/service administration
-- ---------------------------------------------------------------------------
create or replace function public.validate_team_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  lead_org uuid;
begin
  new.organization_id := coalesce(new.organization_id, public.current_organization_id());
  if new.organization_id is distinct from public.current_organization_id() then
    raise exception 'Team must belong to your organization';
  end if;
  if new.lead_id is not null then
    select organization_id into lead_org from public.profiles where id = new.lead_id;
    if lead_org is null or lead_org is distinct from new.organization_id then
      raise exception 'Team lead must belong to the same organization';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_team_before_write on public.teams;
create trigger validate_team_before_write
before insert or update on public.teams
for each row execute function public.validate_team_write();

create or replace function public.validate_service_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_org uuid;
begin
  new.organization_id := coalesce(new.organization_id, public.current_organization_id());
  if new.organization_id is distinct from public.current_organization_id() then
    raise exception 'Service must belong to your organization';
  end if;
  if new.owner_team_id is not null then
    select organization_id into owner_org from public.teams where id = new.owner_team_id;
    if owner_org is null or owner_org is distinct from new.organization_id then
      raise exception 'Service owner team must belong to the same organization';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_service_before_write on public.services;
create trigger validate_service_before_write
before insert or update on public.services
for each row execute function public.validate_service_write();

-- Incident detail pages already subscribe to attachment metadata changes. Add
-- the metadata table to the Realtime publication so uploads/deletes propagate
-- between authorized sessions without refresh.
alter table public.incident_attachments replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.incident_attachments;
exception when duplicate_object then null;
end $$;
