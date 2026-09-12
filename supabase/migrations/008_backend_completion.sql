-- PulseOps migration 008: backend completion, hardened workflows, notifications, and admin RPCs

-- -----------------------------------------------------------------------------
-- Profile email support (safe denormalized copy of auth.users.email for directory UI)
-- -----------------------------------------------------------------------------
alter table public.profiles add column if not exists email text null;
create index if not exists profiles_email_idx on public.profiles(lower(email));

update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id
  and p.email is distinct from u.email;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_org_id uuid;
  requested_org_id uuid;
begin
  begin
    requested_org_id := nullif(new.raw_app_meta_data ->> 'organization_id', '')::uuid;
  exception when others then
    requested_org_id := null;
  end;

  select id into target_org_id
  from public.organizations
  where id = requested_org_id
     or slug = coalesce(new.raw_app_meta_data ->> 'organization_slug', 'acme-technologies')
  order by case when id = requested_org_id then 0 else 1 end
  limit 1;

  if target_org_id is null then
    insert into public.organizations (name, slug, timezone)
    values ('Acme Technologies', 'acme-technologies', 'Europe/London')
    on conflict (slug) do update set updated_at = now()
    returning id into target_org_id;
  end if;

  insert into public.profiles (id, organization_id, full_name, email, role, status)
  values (
    new.id,
    target_org_id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, 'new-user'), '@', 1), 'New User'),
    new.email,
    'employee',
    'active'
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = case when public.profiles.full_name = '' then excluded.full_name else public.profiles.full_name end,
      updated_at = now();

  return new;
end;
$$;

create or replace function public.sync_auth_user_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.profiles
  set email = new.email,
      updated_at = now()
  where id = new.id;
  return new;
end;
$$;

drop trigger if exists sync_auth_user_email_after_update on auth.users;
create trigger sync_auth_user_email_after_update
after update of email on auth.users
for each row execute function public.sync_auth_user_email();

-- -----------------------------------------------------------------------------
-- Safer incident insert/update preparation
-- -----------------------------------------------------------------------------
create or replace function public.prepare_incident()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  caller_org uuid;
  policy record;
  service_org uuid;
  service_owner uuid;
  team_org uuid;
begin
  if caller is not null then
    select organization_id into caller_org
    from public.profiles
    where id = caller and status = 'active';

    if caller_org is null then
      raise exception 'Active PulseOps profile required';
    end if;

    new.organization_id := caller_org;
    new.reporter_id := caller;
    new.incident_number := public.next_incident_number();
    new.created_at := now();
    new.updated_at := now();
    new.status := 'open';
    new.assignee_id := null;
    new.acknowledged_at := null;
    new.resolved_at := null;
    new.closed_at := null;
  else
    if new.incident_number is null or new.incident_number = '' then
      new.incident_number := public.next_incident_number();
    end if;
    new.created_at := coalesce(new.created_at, now());
  end if;

  if new.organization_id is null or new.reporter_id is null then
    raise exception 'Incident organization and reporter are required';
  end if;

  if new.service_id is not null then
    select organization_id, owner_team_id into service_org, service_owner
    from public.services where id = new.service_id;
    if service_org is distinct from new.organization_id then
      raise exception 'Selected service is not in this organization';
    end if;
    if new.team_id is null then new.team_id := service_owner; end if;
  end if;

  if new.team_id is not null then
    select organization_id into team_org from public.teams where id = new.team_id;
    if team_org is distinct from new.organization_id then
      raise exception 'Selected team is not in this organization';
    end if;
  end if;

  select response_minutes, resolution_minutes into policy
  from public.sla_policies
  where organization_id = new.organization_id
    and priority = new.priority
    and enabled = true
  limit 1;

  if policy.response_minutes is not null then
    new.response_sla_deadline := new.created_at + make_interval(mins => policy.response_minutes);
    new.resolution_sla_deadline := new.created_at + make_interval(mins => policy.resolution_minutes);
  end if;

  return new;
end;
$$;

create or replace function public.validate_incident_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  service_org uuid;
  team_org uuid;
  assignee_org uuid;
  assignee_team uuid;
  assignee_status public.user_status;
  assignee_role public.user_role;
begin
  -- Immutable identity/tenancy fields can never be rewritten through app updates.
  new.id := old.id;
  new.organization_id := old.organization_id;
  new.incident_number := old.incident_number;
  new.reporter_id := old.reporter_id;
  new.created_at := old.created_at;

  if new.service_id is not null then
    select organization_id into service_org from public.services where id = new.service_id;
    if service_org is distinct from old.organization_id then
      raise exception 'Selected service is not in this organization';
    end if;
  end if;

  if new.team_id is not null then
    select organization_id into team_org from public.teams where id = new.team_id;
    if team_org is distinct from old.organization_id then
      raise exception 'Selected team is not in this organization';
    end if;
  end if;

  if new.assignee_id is not null then
    select organization_id, team_id, status, role
      into assignee_org, assignee_team, assignee_status, assignee_role
    from public.profiles where id = new.assignee_id;

    if assignee_org is distinct from old.organization_id or assignee_status <> 'active' then
      raise exception 'Selected assignee is not an active user in this organization';
    end if;
    if assignee_role not in ('engineer', 'manager', 'administrator') then
      raise exception 'Selected assignee cannot work incidents';
    end if;
    if new.team_id is not null and assignee_team is distinct from new.team_id and assignee_role <> 'administrator' then
      raise exception 'Selected assignee does not belong to the selected team';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_incident_before_update on public.incidents;
create trigger validate_incident_before_update
before update on public.incidents
for each row execute function public.validate_incident_update();

-- -----------------------------------------------------------------------------
-- Controlled incident workflow RPCs
-- -----------------------------------------------------------------------------
create or replace function public.assign_incident(
  incident_uuid uuid,
  next_team_id uuid,
  next_assignee_id uuid
)
returns public.incidents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  role_value public.user_role := public.current_user_role();
  org_id uuid := public.current_organization_id();
  current_team uuid := public.current_team_id();
  candidate_team uuid;
  candidate_org uuid;
  candidate_role public.user_role;
  candidate_status public.user_status;
  changed public.incidents;
begin
  if not public.can_manage_incident(incident_uuid) then
    raise exception 'Not authorized to assign this incident';
  end if;

  if next_team_id is not null then
    select organization_id into candidate_org from public.teams where id = next_team_id;
    if candidate_org is distinct from org_id then raise exception 'Invalid team'; end if;
  end if;

  if role_value = 'manager' and next_team_id is distinct from current_team then
    raise exception 'Managers may only assign incidents within their own team';
  end if;

  if next_assignee_id is not null then
    select organization_id, team_id, role, status
      into candidate_org, candidate_team, candidate_role, candidate_status
    from public.profiles where id = next_assignee_id;

    if candidate_org is distinct from org_id or candidate_status <> 'active' then
      raise exception 'Invalid assignee';
    end if;
    if candidate_role not in ('engineer','manager','administrator') then
      raise exception 'Assignee must be an engineer, manager, or administrator';
    end if;
    if next_team_id is not null and candidate_team is distinct from next_team_id and candidate_role <> 'administrator' then
      raise exception 'Assignee must belong to the selected team';
    end if;
  end if;

  if role_value = 'engineer' then
    if next_assignee_id is distinct from auth.uid() or next_team_id is distinct from current_team then
      raise exception 'Engineers may only self-assign incidents in their own team';
    end if;
  end if;

  update public.incidents
  set team_id = next_team_id,
      assignee_id = next_assignee_id
  where id = incident_uuid
    and organization_id = org_id
  returning * into changed;

  return changed;
end;
$$;

create or replace function public.change_incident_priority(
  incident_uuid uuid,
  next_priority public.incident_priority
)
returns public.incidents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  role_value public.user_role := public.current_user_role();
  changed public.incidents;
begin
  if role_value not in ('manager','administrator') then
    raise exception 'Manager or administrator privileges required';
  end if;
  if not public.can_manage_incident(incident_uuid) then
    raise exception 'Not authorized to reprioritize this incident';
  end if;

  update public.incidents
  set priority = next_priority
  where id = incident_uuid
    and organization_id = public.current_organization_id()
  returning * into changed;

  return changed;
end;
$$;

create or replace function public.change_incident_status(incident_uuid uuid, next_status public.incident_status)
returns public.incidents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_status public.incident_status;
  changed public.incidents;
  allowed boolean := false;
begin
  if not public.can_manage_incident(incident_uuid) then
    raise exception 'Not authorized to change this incident';
  end if;

  select status into current_status
  from public.incidents
  where id = incident_uuid and organization_id = public.current_organization_id();

  if current_status is null then raise exception 'Incident not found'; end if;
  if current_status = next_status then allowed := true;
  elsif current_status = 'open' and next_status in ('acknowledged','investigating','in_progress','waiting','resolved') then allowed := true;
  elsif current_status = 'acknowledged' and next_status in ('investigating','in_progress','waiting','monitoring','resolved') then allowed := true;
  elsif current_status = 'investigating' and next_status in ('in_progress','waiting','monitoring','resolved') then allowed := true;
  elsif current_status = 'in_progress' and next_status in ('investigating','waiting','monitoring','resolved') then allowed := true;
  elsif current_status = 'waiting' and next_status in ('investigating','in_progress','monitoring','resolved') then allowed := true;
  elsif current_status = 'monitoring' and next_status in ('investigating','in_progress','resolved') then allowed := true;
  elsif current_status = 'resolved' and next_status in ('monitoring','closed') then allowed := true;
  end if;

  if not allowed then
    raise exception 'Invalid incident status transition from % to %', current_status, next_status;
  end if;

  update public.incidents
  set status = next_status,
      acknowledged_at = case
        when next_status in ('acknowledged','investigating','in_progress','waiting','monitoring','resolved','closed')
          then coalesce(acknowledged_at, now())
        else acknowledged_at
      end,
      resolved_at = case
        when next_status = 'resolved' then coalesce(resolved_at, now())
        when current_status = 'resolved' and next_status = 'monitoring' then null
        else resolved_at
      end,
      closed_at = case when next_status = 'closed' then coalesce(closed_at, now()) else closed_at end
  where id = incident_uuid
    and organization_id = public.current_organization_id()
  returning * into changed;

  return changed;
end;
$$;

-- -----------------------------------------------------------------------------
-- Admin-only operations
-- -----------------------------------------------------------------------------
create or replace function public.admin_update_user(
  target_user_id uuid,
  next_role public.user_role,
  next_team_id uuid,
  next_status public.user_status
)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_org uuid := public.current_organization_id();
  target_org uuid;
  team_org uuid;
  changed public.profiles;
begin
  if not public.is_admin() then
    raise exception 'Administrator privileges required';
  end if;

  select organization_id into target_org from public.profiles where id = target_user_id;
  if target_org is distinct from caller_org then raise exception 'User not found in this organization'; end if;

  if next_team_id is not null then
    select organization_id into team_org from public.teams where id = next_team_id;
    if team_org is distinct from caller_org then raise exception 'Invalid team'; end if;
  end if;

  if target_user_id = auth.uid() and next_status = 'disabled' then
    raise exception 'You cannot disable your own administrator account';
  end if;

  update public.profiles
  set role = next_role,
      team_id = next_team_id,
      status = next_status
  where id = target_user_id and organization_id = caller_org
  returning * into changed;

  insert into public.audit_logs (organization_id, actor_id, action, object_type, object_id, details, source)
  values (caller_org, auth.uid(), 'user_access_updated', 'profile', target_user_id::text,
    jsonb_build_object('role', next_role, 'team_id', next_team_id, 'status', next_status), 'rpc');

  return changed;
end;
$$;

create or replace function public.admin_update_sla_policy(
  policy_uuid uuid,
  next_response_minutes integer,
  next_resolution_minutes integer,
  next_enabled boolean
)
returns public.sla_policies
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed public.sla_policies;
begin
  if not public.is_admin() then raise exception 'Administrator privileges required'; end if;
  if next_response_minutes <= 0 or next_resolution_minutes <= 0 then raise exception 'SLA values must be positive'; end if;

  update public.sla_policies
  set response_minutes = next_response_minutes,
      resolution_minutes = next_resolution_minutes,
      enabled = next_enabled
  where id = policy_uuid and organization_id = public.current_organization_id()
  returning * into changed;

  if changed.id is null then raise exception 'SLA policy not found'; end if;
  return changed;
end;
$$;

create or replace function public.admin_update_organization_settings(next_settings jsonb)
returns public.organizations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed public.organizations;
begin
  if not public.is_admin() then raise exception 'Administrator privileges required'; end if;
  update public.organizations
  set settings = coalesce(next_settings, '{}'::jsonb)
  where id = public.current_organization_id()
  returning * into changed;
  return changed;
end;
$$;

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed_count integer;
begin
  update public.notifications
  set read_at = coalesce(read_at, now())
  where user_id = auth.uid()
    and organization_id = public.current_organization_id()
    and read_at is null;
  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Notification triggers
-- -----------------------------------------------------------------------------
create or replace function public.notify_incident_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  notification_kind public.notification_type;
begin
  if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null and new.assignee_id is distinct from actor then
    insert into public.notifications (organization_id, user_id, type, title, body, incident_id)
    values (new.organization_id, new.assignee_id, 'assignment', 'Incident assigned', new.incident_number || ' has been assigned to you.', new.id);
  end if;

  if new.status is distinct from old.status then
    notification_kind := case when new.status = 'resolved' then 'resolved'::public.notification_type else 'incident'::public.notification_type end;
    if new.reporter_id is not null and new.reporter_id is distinct from actor then
      insert into public.notifications (organization_id, user_id, type, title, body, incident_id)
      values (
        new.organization_id,
        new.reporter_id,
        notification_kind,
        case when new.status = 'resolved' then 'Incident resolved' else 'Incident updated' end,
        new.incident_number || ' is now ' || replace(new.status::text, '_', ' ') || '.',
        new.id
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists notify_incident_changes_after_update on public.incidents;
create trigger notify_incident_changes_after_update
after update of assignee_id, status on public.incidents
for each row execute function public.notify_incident_changes();

create or replace function public.notify_comment_participants()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inc public.incidents;
begin
  select * into inc from public.incidents where id = new.incident_id;

  if new.visibility = 'public' then
    if inc.reporter_id is not null and inc.reporter_id is distinct from new.author_id then
      insert into public.notifications (organization_id, user_id, type, title, body, incident_id)
      values (new.organization_id, inc.reporter_id, 'comment', 'New incident comment', 'A new comment was added to ' || inc.incident_number || '.', inc.id);
    end if;
  end if;

  if inc.assignee_id is not null and inc.assignee_id is distinct from new.author_id then
    insert into public.notifications (organization_id, user_id, type, title, body, incident_id)
    values (
      new.organization_id,
      inc.assignee_id,
      'comment',
      case when new.visibility = 'internal' then 'New internal note' else 'New incident comment' end,
      'A new ' || case when new.visibility = 'internal' then 'internal note' else 'comment' end || ' was added to ' || inc.incident_number || '.',
      inc.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists notify_comment_participants_after_insert on public.incident_comments;
create trigger notify_comment_participants_after_insert
after insert on public.incident_comments
for each row execute function public.notify_comment_participants();

-- -----------------------------------------------------------------------------
-- Grants: narrow direct browser writes; sensitive changes go through RPCs.
-- -----------------------------------------------------------------------------
revoke create on schema public from public, anon, authenticated;

-- Organizations are tenant roots. Browsers may read only their own row and never write it directly.
alter table public.organizations enable row level security;
drop policy if exists organizations_select_own on public.organizations;
create policy organizations_select_own
on public.organizations for select
to authenticated
using (id = public.current_organization_id());
revoke insert, update, delete on public.organizations from authenticated;

-- Disabled users must still be able to read their own profile so the UI can show the disabled-account state.
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self
on public.profiles for select
to authenticated
using (id = auth.uid());

revoke update, delete on public.incidents from authenticated;
grant insert on public.incidents to authenticated;

revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
revoke insert, delete on public.notifications from authenticated;

revoke insert, update, delete on public.incident_activity from authenticated;
revoke insert, update, delete on public.audit_logs from authenticated;

revoke update on public.incident_comments from authenticated;
grant update (body, updated_at) on public.incident_comments to authenticated;

revoke update on public.sla_policies from authenticated;

-- Attachment metadata may be removed only by users who can manage the incident.
drop policy if exists incident_attachments_delete_manage_incident on public.incident_attachments;
create policy incident_attachments_delete_manage_incident
on public.incident_attachments for delete
to authenticated
using (public.can_manage_incident(incident_id));

grant delete on public.incident_attachments to authenticated;

-- Keep sensitive security-definer functions off anon/public and explicitly available to authenticated users.
revoke execute on function public.assign_incident(uuid, uuid, uuid) from public, anon;
revoke execute on function public.change_incident_priority(uuid, public.incident_priority) from public, anon;
revoke execute on function public.change_incident_status(uuid, public.incident_status) from public, anon;
revoke execute on function public.acknowledge_incident(uuid) from public, anon;
revoke execute on function public.admin_update_user(uuid, public.user_role, uuid, public.user_status) from public, anon;
revoke execute on function public.admin_update_sla_policy(uuid, integer, integer, boolean) from public, anon;
revoke execute on function public.admin_update_organization_settings(jsonb) from public, anon;
revoke execute on function public.mark_all_notifications_read() from public, anon;
revoke execute on function public.increment_article_view(uuid) from public, anon;

grant execute on function public.assign_incident(uuid, uuid, uuid) to authenticated;
grant execute on function public.change_incident_priority(uuid, public.incident_priority) to authenticated;
grant execute on function public.change_incident_status(uuid, public.incident_status) to authenticated;
grant execute on function public.acknowledge_incident(uuid) to authenticated;
grant execute on function public.admin_update_user(uuid, public.user_role, uuid, public.user_status) to authenticated;
grant execute on function public.admin_update_sla_policy(uuid, integer, integer, boolean) to authenticated;
grant execute on function public.admin_update_organization_settings(jsonb) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;
grant execute on function public.increment_article_view(uuid) to authenticated;

-- Storage bucket should match frontend validation (10 MB).
update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array[
      'image/png','image/jpeg','image/webp','application/pdf','text/plain',
      'text/csv','application/json','application/octet-stream'
    ]
where id = 'incident-attachments';
