-- PulseOps backend verification helper (read-only)
-- Run in Supabase SQL Editor after migrations 001-009.

-- Core tables expected by the frontend.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'organizations','profiles','teams','services','service_dependencies',
    'sla_policies','incidents','incident_comments','incident_activity',
    'incident_attachments','notifications','knowledge_articles',
    'on_call_schedules','audit_logs','incident_relations'
  )
order by table_name;

-- RLS should be enabled on all application tables.
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in (
    'organizations','profiles','teams','services','service_dependencies',
    'sla_policies','incidents','incident_comments','incident_activity',
    'incident_attachments','notifications','knowledge_articles',
    'on_call_schedules','audit_logs','incident_relations'
  )
order by relname;

-- Confirm critical post-setup policies/triggers exist.
select schemaname, tablename, policyname
from pg_policies
where schemaname = 'public'
  and policyname in (
    'incident_attachments_delete_manage',
    'incident_comments_select_visibility',
    'incidents_select_role_scope',
    'notifications_select_own',
    'audit_logs_select_admin'
  )
order by tablename, policyname;

select event_object_table as table_name, trigger_name
from information_schema.triggers
where trigger_schema = 'public'
  and trigger_name in (
    'prepare_knowledge_article_before_insert',
    'prepare_on_call_schedule_before_write',
    'audit_on_call_after_change',
    'validate_team_before_write',
    'validate_service_before_write'
  )
order by event_object_table, trigger_name;

-- Seed sanity.
select 'organizations' as entity, count(*) as rows from public.organizations
union all select 'teams', count(*) from public.teams
union all select 'services', count(*) from public.services
union all select 'sla_policies', count(*) from public.sla_policies
union all select 'knowledge_articles', count(*) from public.knowledge_articles;
