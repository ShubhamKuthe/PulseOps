-- PulseOps migration 004: Row Level Security and grants

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.services enable row level security;
alter table public.service_dependencies enable row level security;
alter table public.sla_policies enable row level security;
alter table public.incidents enable row level security;
alter table public.incident_comments enable row level security;
alter table public.incident_activity enable row level security;
alter table public.incident_attachments enable row level security;
alter table public.notifications enable row level security;
alter table public.knowledge_articles enable row level security;
alter table public.on_call_schedules enable row level security;
alter table public.audit_logs enable row level security;
alter table public.incident_relations enable row level security;

revoke all on all tables in schema public from anon;
grant usage on schema public to anon, authenticated;
revoke create on schema public from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;

revoke update on public.profiles from authenticated;
grant update (full_name, avatar_url, last_active_at, updated_at) on public.profiles to authenticated;

revoke insert, update, delete on public.organizations from authenticated;

create policy organizations_select_own
on public.organizations for select
to authenticated
using (id = public.current_organization_id());

create policy profiles_select_self
on public.profiles for select
to authenticated
using (id = auth.uid());

create policy profiles_select_same_org
on public.profiles for select
to authenticated
using (organization_id = public.current_organization_id());

create policy profiles_update_self_safe_columns
on public.profiles for update
to authenticated
using (id = auth.uid() and organization_id = public.current_organization_id())
with check (id = auth.uid() and organization_id = public.current_organization_id());

create policy teams_select_same_org
on public.teams for select
to authenticated
using (organization_id = public.current_organization_id());

create policy teams_admin_write
on public.teams for all
to authenticated
using (organization_id = public.current_organization_id() and public.is_admin())
with check (organization_id = public.current_organization_id() and public.is_admin());

create policy services_select_same_org
on public.services for select
to authenticated
using (organization_id = public.current_organization_id());

create policy services_manager_admin_write
on public.services for all
to authenticated
using (organization_id = public.current_organization_id() and public.is_manager_or_admin())
with check (organization_id = public.current_organization_id() and public.is_manager_or_admin());

create policy service_dependencies_select_same_org
on public.service_dependencies for select
to authenticated
using (organization_id = public.current_organization_id());

create policy service_dependencies_admin_write
on public.service_dependencies for all
to authenticated
using (organization_id = public.current_organization_id() and public.is_admin())
with check (organization_id = public.current_organization_id() and public.is_admin());

create policy sla_policies_select_engineers_plus
on public.sla_policies for select
to authenticated
using (organization_id = public.current_organization_id() and public.current_user_role() in ('engineer','manager','administrator'));

create policy sla_policies_admin_write
on public.sla_policies for all
to authenticated
using (organization_id = public.current_organization_id() and public.is_admin())
with check (organization_id = public.current_organization_id() and public.is_admin());

create policy incidents_select_role_scope
on public.incidents for select
to authenticated
using (public.can_view_incident(id));

create policy incidents_employee_create
on public.incidents for insert
to authenticated
with check (
  organization_id = public.current_organization_id()
  and reporter_id = auth.uid()
);

create policy incidents_manage_role_scope
on public.incidents for update
to authenticated
using (public.can_manage_incident(id))
with check (
  organization_id = public.current_organization_id()
  and public.can_manage_incident(id)
);

create policy incident_comments_select_visibility
on public.incident_comments for select
to authenticated
using (
  public.can_view_incident(incident_id)
  and (
    visibility = 'public'
    or public.current_user_role() in ('engineer','manager','administrator')
  )
);

create policy incident_comments_insert_visible_incident
on public.incident_comments for insert
to authenticated
with check (
  public.can_view_incident(incident_id)
  and author_id = auth.uid()
  and (
    visibility = 'public'
    or public.current_user_role() in ('engineer','manager','administrator')
  )
);

create policy incident_comments_update_own_recent
on public.incident_comments for update
to authenticated
using (author_id = auth.uid() and created_at > now() - interval '15 minutes')
with check (author_id = auth.uid());

create policy incident_activity_select_viewable_incident
on public.incident_activity for select
to authenticated
using (public.can_view_incident(incident_id));

create policy incident_attachments_select_viewable_incident
on public.incident_attachments for select
to authenticated
using (public.can_view_incident(incident_id));

create policy incident_attachments_insert_viewable_incident
on public.incident_attachments for insert
to authenticated
with check (public.can_view_incident(incident_id) and uploaded_by = auth.uid());

create policy notifications_select_own
on public.notifications for select
to authenticated
using (user_id = auth.uid() and organization_id = public.current_organization_id());

create policy notifications_update_own_read_state
on public.notifications for update
to authenticated
using (user_id = auth.uid() and organization_id = public.current_organization_id())
with check (user_id = auth.uid() and organization_id = public.current_organization_id());

create policy knowledge_select_published_or_manager
on public.knowledge_articles for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and (published = true or public.current_user_role() in ('manager','administrator'))
);

create policy knowledge_manager_admin_write
on public.knowledge_articles for all
to authenticated
using (organization_id = public.current_organization_id() and public.current_user_role() in ('manager','administrator'))
with check (organization_id = public.current_organization_id() and public.current_user_role() in ('manager','administrator'));

create policy on_call_select_engineers_plus
on public.on_call_schedules for select
to authenticated
using (organization_id = public.current_organization_id() and public.current_user_role() in ('engineer','manager','administrator'));

create policy on_call_manager_admin_write
on public.on_call_schedules for all
to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    public.is_admin()
    or (public.current_user_role() = 'manager' and team_id is not distinct from public.current_team_id())
  )
)
with check (
  organization_id = public.current_organization_id()
  and (
    public.is_admin()
    or (public.current_user_role() = 'manager' and team_id is not distinct from public.current_team_id())
  )
);

create policy audit_logs_select_admin
on public.audit_logs for select
to authenticated
using (organization_id = public.current_organization_id() and public.is_admin());

create policy incident_relations_select_viewable
on public.incident_relations for select
to authenticated
using (public.can_view_incident(incident_id) and public.can_view_incident(related_incident_id));

create policy incident_relations_manager_admin_write
on public.incident_relations for all
to authenticated
using (organization_id = public.current_organization_id() and public.is_manager_or_admin())
with check (organization_id = public.current_organization_id() and public.is_manager_or_admin());
