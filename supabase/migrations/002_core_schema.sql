-- PulseOps migration 002: core relational schema

create sequence if not exists public.incident_number_seq start with 1001;
create sequence if not exists public.knowledge_article_number_seq start with 1;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  timezone text not null default 'UTC',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  full_name text not null,
  email text null,
  role public.user_role not null default 'employee',
  team_id uuid null,
  avatar_url text null,
  status public.user_status not null default 'active',
  last_active_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text not null default '',
  lead_id uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

alter table public.profiles
  add constraint profiles_team_id_fkey
  foreign key (team_id) references public.teams(id) on delete set null;

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  description text not null default '',
  owner_team_id uuid null references public.teams(id) on delete set null,
  environment public.environment_type not null default 'production',
  health public.service_health not null default 'operational',
  availability_percent numeric(5,2) not null default 100 check (availability_percent >= 0 and availability_percent <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table if not exists public.service_dependencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  depends_on_service_id uuid not null references public.services(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint service_dependencies_no_self check (service_id <> depends_on_service_id),
  unique (organization_id, service_id, depends_on_service_id)
);

create table if not exists public.sla_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  priority public.incident_priority not null,
  response_minutes integer not null check (response_minutes > 0),
  resolution_minutes integer not null check (resolution_minutes > 0),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, priority)
);

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  incident_number text not null unique,
  title text not null check (length(trim(title)) > 0),
  description text not null default '',
  status public.incident_status not null default 'open',
  priority public.incident_priority not null default 'p3',
  service_id uuid null references public.services(id) on delete set null,
  team_id uuid null references public.teams(id) on delete set null,
  reporter_id uuid not null references public.profiles(id) on delete restrict,
  assignee_id uuid null references public.profiles(id) on delete set null,
  category text null,
  impact text null,
  urgency text null,
  affected_scope text null,
  environment public.environment_type not null default 'production',
  location text null,
  ai_category text null,
  ai_confidence integer null check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 100)),
  ai_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  acknowledged_at timestamptz null,
  resolved_at timestamptz null,
  closed_at timestamptz null,
  response_sla_deadline timestamptz null,
  resolution_sla_deadline timestamptz null
);

create table if not exists public.incident_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  incident_id uuid not null references public.incidents(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  body text not null check (length(trim(body)) > 0),
  visibility public.comment_visibility not null default 'public',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.incident_activity (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  incident_id uuid not null references public.incidents(id) on delete cascade,
  actor_id uuid null references public.profiles(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.incident_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  incident_id uuid not null references public.incidents(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type public.notification_type not null default 'system',
  title text not null,
  body text not null,
  incident_id uuid null references public.incidents(id) on delete cascade,
  read_at timestamptz null,
  created_at timestamptz not null default now()
);

create table if not exists public.knowledge_articles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  article_number text not null unique,
  title text not null,
  category text not null,
  summary text not null default '',
  content text not null default '',
  author_id uuid null references public.profiles(id) on delete set null,
  published boolean not null default false,
  view_count integer not null default 0 check (view_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.on_call_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint on_call_ends_after_starts check (ends_at > starts_at)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid null references public.profiles(id) on delete set null,
  action text not null,
  object_type text not null,
  object_id text null,
  details jsonb not null default '{}'::jsonb,
  source text not null default 'web',
  created_at timestamptz not null default now()
);

create table if not exists public.incident_relations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  incident_id uuid not null references public.incidents(id) on delete cascade,
  related_incident_id uuid not null references public.incidents(id) on delete cascade,
  relation_type text not null default 'related',
  created_at timestamptz not null default now(),
  constraint incident_relations_no_self check (incident_id <> related_incident_id),
  unique (organization_id, incident_id, related_incident_id)
);

create index if not exists profiles_organization_idx on public.profiles(organization_id);
create index if not exists profiles_email_idx on public.profiles(lower(email));
create index if not exists profiles_team_idx on public.profiles(team_id);
create index if not exists teams_organization_idx on public.teams(organization_id);
create index if not exists services_organization_health_idx on public.services(organization_id, health);
create index if not exists service_dependencies_service_idx on public.service_dependencies(service_id);
create index if not exists incidents_organization_status_idx on public.incidents(organization_id, status);
create index if not exists incidents_organization_priority_idx on public.incidents(organization_id, priority);
create index if not exists incidents_assignee_idx on public.incidents(assignee_id);
create index if not exists incidents_team_idx on public.incidents(team_id);
create index if not exists incidents_service_idx on public.incidents(service_id);
create index if not exists incidents_reporter_idx on public.incidents(reporter_id);
create index if not exists incidents_created_idx on public.incidents(organization_id, created_at desc);
create index if not exists comments_incident_idx on public.incident_comments(incident_id, created_at);
create index if not exists activity_incident_idx on public.incident_activity(incident_id, created_at desc);
create index if not exists notifications_user_read_idx on public.notifications(user_id, read_at, created_at desc);
create index if not exists audit_logs_org_created_idx on public.audit_logs(organization_id, created_at desc);
create index if not exists knowledge_category_idx on public.knowledge_articles(organization_id, category, published);
