-- PulseOps migration 007: development seed data that does not require auth.users

insert into public.organizations (name, slug, timezone, settings)
values (
  'Acme Technologies',
  'acme-technologies',
  'Europe/London',
  '{"language":"English (UK)","workspace":"acme.pulseops.local"}'::jsonb
)
on conflict (slug) do update
set name = excluded.name,
    timezone = excluded.timezone,
    settings = excluded.settings;

with org as (
  select id from public.organizations where slug = 'acme-technologies'
)
insert into public.teams (organization_id, name, description)
select org.id, team.name, team.description
from org,
(values
  ('Platform Engineering','Owns customer-facing platform services and payment flows.'),
  ('Infrastructure','Owns network, compute, and office connectivity.'),
  ('IT Support','Handles employee support and endpoint operations.'),
  ('Security Operations','Monitors security events and response workflows.'),
  ('Application Support','Owns internal and customer application support.'),
  ('Database Reliability','Owns database operations, performance, and recovery.'),
  ('Identity & Access','Owns authentication, SSO, and access controls.'),
  ('Workplace IT','Owns collaboration tools and workplace technology.'),
  ('IT Operations','Owns PulseOps administration and operating model.')
) as team(name, description)
on conflict (organization_id, name) do update
set description = excluded.description;

with org as (select id from public.organizations where slug = 'acme-technologies'),
team_map as (select id, name from public.teams where organization_id = (select id from org))
insert into public.services (organization_id, name, slug, description, owner_team_id, environment, health, availability_percent)
select org.id, service.name, service.slug, service.description, team_map.id, service.environment::public.environment_type, service.health::public.service_health, service.availability
from org
cross join (values
  ('Authentication API','authentication-api','SSO and session services for employees and customers.','Identity & Access','production','operational',99.99),
  ('Payment Gateway','payment-gateway','Payment authorization, capture, and reconciliation gateway.','Platform Engineering','production','major_incident',99.91),
  ('Corporate VPN','corporate-vpn','Remote access into corporate network services.','Infrastructure','production','degraded',99.72),
  ('Customer Portal','customer-portal','Customer self-service account and support portal.','Application Support','production','operational',99.96),
  ('Microsoft 365','microsoft-365','Collaboration and productivity SaaS suite.','Workplace IT','saas','partial_outage',99.84),
  ('Database Cluster','database-cluster','Primary transactional PostgreSQL cluster.','Database Reliability','production','degraded',99.88),
  ('Email Service','email-service','Inbound and outbound corporate email delivery.','Workplace IT','production','operational',99.98),
  ('Employee Portal','employee-portal','Internal employee services and HR workflows.','Application Support','production','degraded',99.80),
  ('Checkout Service','checkout-service','Customer checkout workflow and order confirmation.','Platform Engineering','production','major_incident',99.89),
  ('Identity Provider','identity-provider','Enterprise identity provider and MFA workflows.','Identity & Access','production','operational',99.97),
  ('External Payment Provider','external-payment-provider','Third-party upstream card processing provider.','Platform Engineering','saas','degraded',99.70)
) as service(name, slug, description, owner, environment, health, availability)
join team_map on team_map.name = service.owner
on conflict (organization_id, slug) do update
set description = excluded.description,
    owner_team_id = excluded.owner_team_id,
    environment = excluded.environment,
    health = excluded.health,
    availability_percent = excluded.availability_percent;

with org as (select id from public.organizations where slug = 'acme-technologies'),
services as (select id, slug from public.services where organization_id = (select id from org))
insert into public.service_dependencies (organization_id, service_id, depends_on_service_id)
select org.id, service.id, dependency.id
from org
join (values
  ('checkout-service','payment-gateway'),
  ('payment-gateway','external-payment-provider'),
  ('customer-portal','authentication-api'),
  ('employee-portal','identity-provider'),
  ('authentication-api','identity-provider')
) as dep(service_slug, dependency_slug) on true
join services service on service.slug = dep.service_slug
join services dependency on dependency.slug = dep.dependency_slug
on conflict (organization_id, service_id, depends_on_service_id) do nothing;

with org as (select id from public.organizations where slug = 'acme-technologies')
insert into public.sla_policies (organization_id, priority, response_minutes, resolution_minutes, enabled)
select org.id, policy.priority::public.incident_priority, policy.response_minutes, policy.resolution_minutes, true
from org,
(values
  ('p1', 15, 60),
  ('p2', 60, 240),
  ('p3', 240, 1440),
  ('p4', 480, 4320)
) as policy(priority, response_minutes, resolution_minutes)
on conflict (organization_id, priority) do update
set response_minutes = excluded.response_minutes,
    resolution_minutes = excluded.resolution_minutes,
    enabled = excluded.enabled;

with org as (select id from public.organizations where slug = 'acme-technologies')
insert into public.knowledge_articles (organization_id, article_number, title, category, summary, content, published, view_count)
select org.id, article.article_number, article.title, article.category, article.summary, article.content, true, article.views
from org,
(values
  ('KB-204','Payment gateway troubleshooting','Payments','Diagnose failed payment authorization and gateway timeout incidents.','Symptoms: failed payments and HTTP 503 responses. Diagnosis: compare gateway health, provider status, and checkout logs. Resolution: enable fallback routing and clear retries after recovery.',1248),
  ('KB-108','Investigating HTTP 503 errors','Applications','Runbook for service unavailable responses in web applications.','Symptoms: 503 responses. Causes: upstream saturation, deployment faults, or dependency outage. Verification: synthetic checks and error-rate recovery.',986),
  ('KB-077','Corporate VPN connectivity recovery','Networking','Steps to recover intermittent corporate VPN sessions.','Check concentrator health, authentication backend latency, DNS, and recent firewall policy changes.',743),
  ('KB-041','Resetting enterprise authentication','Authentication','Operational process for SSO and MFA recovery.','Verify identity provider status, certificate validity, metadata refresh, and affected application configuration.',1104),
  ('KB-132','Database connection pool saturation','Infrastructure','Diagnose and relieve database connection pool exhaustion.','Inspect pool utilization, slow queries, worker saturation, and recent traffic changes before scaling.',681)
) as article(article_number, title, category, summary, content, views)
on conflict (article_number) do update
set title = excluded.title,
    category = excluded.category,
    summary = excluded.summary,
    content = excluded.content,
    published = excluded.published,
    view_count = excluded.view_count;

-- Incident demo data requires real auth users/profiles. After creating demo users,
-- use their profile ids as reporter_id and assignee_id when inserting incidents.
-- The prepare_incident trigger will generate incident_number and SLA deadlines.
