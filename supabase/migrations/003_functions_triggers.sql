-- PulseOps migration 003: helper functions, triggers, and controlled RPCs

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.next_incident_number()
returns text
language sql
as $$
  select 'INC-' || nextval('public.incident_number_seq')::text;
$$;

create or replace function public.next_article_number()
returns text
language sql
as $$
  select 'KB-' || lpad(nextval('public.knowledge_article_number_seq')::text, 3, '0');
$$;

create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.profiles where id = auth.uid() and status = 'active';
$$;

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and status = 'active';
$$;

create or replace function public.current_team_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select team_id from public.profiles where id = auth.uid() and status = 'active';
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'administrator', false);
$$;

create or replace function public.is_manager_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('manager', 'administrator'), false);
$$;

create or replace function public.can_view_incident(incident_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.incidents i
    where i.id = incident_uuid
      and i.organization_id = public.current_organization_id()
      and (
        public.current_user_role() = 'administrator'
        or i.reporter_id = auth.uid()
        or i.assignee_id = auth.uid()
        or (
          public.current_user_role() in ('engineer', 'manager')
          and i.team_id is not distinct from public.current_team_id()
        )
      )
  );
$$;

create or replace function public.can_manage_incident(incident_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.incidents i
    where i.id = incident_uuid
      and i.organization_id = public.current_organization_id()
      and (
        public.current_user_role() = 'administrator'
        or (
          public.current_user_role() = 'manager'
          and i.team_id is not distinct from public.current_team_id()
        )
        or (
          public.current_user_role() = 'engineer'
          and (i.assignee_id = auth.uid() or i.team_id is not distinct from public.current_team_id())
        )
      )
  );
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
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

  insert into public.profiles (id, organization_id, full_name, role, status)
  values (
    new.id,
    target_org_id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1), 'New User'),
    'employee',
    'active'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.prepare_incident()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_org uuid;
  policy record;
begin
  select organization_id into profile_org
  from public.profiles
  where id = coalesce(new.reporter_id, auth.uid());

  new.organization_id := coalesce(new.organization_id, profile_org, public.current_organization_id());
  new.reporter_id := coalesce(new.reporter_id, auth.uid());

  if new.incident_number is null or new.incident_number = '' then
    new.incident_number := public.next_incident_number();
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

create or replace function public.recalculate_incident_sla_on_priority_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  policy record;
begin
  if new.priority is distinct from old.priority and new.status not in ('resolved', 'closed') then
    select response_minutes, resolution_minutes into policy
    from public.sla_policies
    where organization_id = new.organization_id
      and priority = new.priority
      and enabled = true
    limit 1;

    if policy.response_minutes is not null then
      new.response_sla_deadline := old.created_at + make_interval(mins => policy.response_minutes);
      new.resolution_sla_deadline := old.created_at + make_interval(mins => policy.resolution_minutes);
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.log_incident_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.incident_activity (organization_id, incident_id, actor_id, action, details)
    values (new.organization_id, new.id, new.reporter_id, 'incident_created', jsonb_build_object('incident_number', new.incident_number));
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.incident_activity (organization_id, incident_id, actor_id, action, details)
    values (new.organization_id, new.id, auth.uid(), 'status_changed', jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  if new.priority is distinct from old.priority then
    insert into public.incident_activity (organization_id, incident_id, actor_id, action, details)
    values (new.organization_id, new.id, auth.uid(), 'priority_changed', jsonb_build_object('from', old.priority, 'to', new.priority));
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    insert into public.incident_activity (organization_id, incident_id, actor_id, action, details)
    values (new.organization_id, new.id, auth.uid(), 'assigned', jsonb_build_object('from', old.assignee_id, 'to', new.assignee_id));
  end if;

  if new.team_id is distinct from old.team_id then
    insert into public.incident_activity (organization_id, incident_id, actor_id, action, details)
    values (new.organization_id, new.id, auth.uid(), 'team_changed', jsonb_build_object('from', old.team_id, 'to', new.team_id));
  end if;

  if new.resolved_at is not null and old.resolved_at is null then
    insert into public.incident_activity (organization_id, incident_id, actor_id, action, details)
    values (new.organization_id, new.id, auth.uid(), 'resolved', '{}'::jsonb);
  end if;

  return new;
end;
$$;

create or replace function public.log_comment_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.incident_activity (organization_id, incident_id, actor_id, action, details)
  values (new.organization_id, new.incident_id, new.author_id, 'comment_added', jsonb_build_object('visibility', new.visibility));
  return new;
end;
$$;

create or replace function public.audit_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_org uuid;
  object_id text;
begin
  row_org := coalesce(new.organization_id, old.organization_id, public.current_organization_id());
  object_id := coalesce(new.id::text, old.id::text);

  insert into public.audit_logs (organization_id, actor_id, action, object_type, object_id, details, source)
  values (
    row_org,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    object_id,
    jsonb_build_object('table', tg_table_name),
    'database'
  );

  return coalesce(new, old);
end;
$$;

create or replace function public.set_child_organization_and_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  incident_org uuid;
begin
  if tg_table_name in ('incident_comments', 'incident_attachments') then
    select organization_id into incident_org from public.incidents where id = new.incident_id;
    new.organization_id := incident_org;
  else
    new.organization_id := coalesce(new.organization_id, public.current_organization_id());
  end if;

  if tg_table_name = 'incident_comments' then
    new.author_id := coalesce(new.author_id, auth.uid());
  elsif tg_table_name = 'incident_attachments' then
    new.uploaded_by := coalesce(new.uploaded_by, auth.uid());
  end if;

  return new;
end;
$$;

create or replace function public.set_article_number()
returns trigger
language plpgsql
as $$
begin
  new.organization_id := coalesce(new.organization_id, public.current_organization_id());
  if new.article_number is null or new.article_number = '' then
    new.article_number := public.next_article_number();
  end if;
  return new;
end;
$$;

create or replace function public.increment_article_view(article_uuid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.knowledge_articles
  set view_count = view_count + 1
  where id = article_uuid
    and organization_id = public.current_organization_id()
    and published = true;
end;
$$;

create or replace function public.acknowledge_incident(incident_uuid uuid)
returns public.incidents
language plpgsql
security definer
set search_path = public
as $$
declare
  changed public.incidents;
begin
  if not public.can_manage_incident(incident_uuid) then
    raise exception 'Not authorized to acknowledge this incident';
  end if;

  update public.incidents
  set status = case when status = 'open' then 'acknowledged' else status end,
      acknowledged_at = coalesce(acknowledged_at, now())
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
set search_path = public
as $$
declare
  current_status public.incident_status;
  changed public.incidents;
begin
  if not public.can_manage_incident(incident_uuid) then
    raise exception 'Not authorized to change this incident';
  end if;

  select status into current_status from public.incidents where id = incident_uuid;

  if current_status = 'closed' then
    raise exception 'Closed incidents cannot transition';
  end if;

  if current_status = 'resolved' and next_status not in ('closed', 'monitoring') then
    raise exception 'Resolved incidents may only close or return to monitoring';
  end if;

  update public.incidents
  set status = next_status,
      acknowledged_at = case when next_status in ('acknowledged','investigating','in_progress','waiting','monitoring','resolved','closed') then coalesce(acknowledged_at, now()) else acknowledged_at end,
      resolved_at = case when next_status = 'resolved' then coalesce(resolved_at, now()) else resolved_at end,
      closed_at = case when next_status = 'closed' then coalesce(closed_at, now()) else closed_at end
  where id = incident_uuid
    and organization_id = public.current_organization_id()
  returning * into changed;

  return changed;
end;
$$;

create trigger set_organizations_updated_at before update on public.organizations for each row execute function public.set_updated_at();
create trigger set_profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger set_teams_updated_at before update on public.teams for each row execute function public.set_updated_at();
create trigger set_services_updated_at before update on public.services for each row execute function public.set_updated_at();
create trigger set_sla_policies_updated_at before update on public.sla_policies for each row execute function public.set_updated_at();
create trigger set_incidents_updated_at before update on public.incidents for each row execute function public.set_updated_at();
create trigger set_incident_comments_updated_at before update on public.incident_comments for each row execute function public.set_updated_at();
create trigger set_knowledge_articles_updated_at before update on public.knowledge_articles for each row execute function public.set_updated_at();
create trigger set_on_call_schedules_updated_at before update on public.on_call_schedules for each row execute function public.set_updated_at();

create trigger prepare_incident_before_insert before insert on public.incidents for each row execute function public.prepare_incident();
create trigger recalculate_incident_sla_before_update before update of priority on public.incidents for each row execute function public.recalculate_incident_sla_on_priority_change();
create trigger log_incident_activity_after_insert after insert on public.incidents for each row execute function public.log_incident_activity();
create trigger log_incident_activity_after_update after update on public.incidents for each row execute function public.log_incident_activity();
create trigger set_comment_org_author before insert on public.incident_comments for each row execute function public.set_child_organization_and_author();
create trigger set_attachment_org_uploader before insert on public.incident_attachments for each row execute function public.set_child_organization_and_author();
create trigger log_comment_activity_after_insert after insert on public.incident_comments for each row execute function public.log_comment_activity();
create trigger set_article_number_before_insert before insert on public.knowledge_articles for each row execute function public.set_article_number();

create trigger audit_teams_after_change after insert or update or delete on public.teams for each row execute function public.audit_changes();
create trigger audit_services_after_change after insert or update or delete on public.services for each row execute function public.audit_changes();
create trigger audit_sla_after_change after insert or update or delete on public.sla_policies for each row execute function public.audit_changes();
create trigger audit_incidents_after_change after insert or update or delete on public.incidents for each row execute function public.audit_changes();
create trigger audit_knowledge_after_change after insert or update or delete on public.knowledge_articles for each row execute function public.audit_changes();
