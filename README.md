# PulseOps

PulseOps is an enterprise-style IT incident and operations management platform. It provides an operations dashboard, incident workflows, service ownership, SLA tracking, team and on-call information, knowledge articles, notifications, audit logs, private attachments, and role-based administration.

The project keeps a single-page HTML/CSS interface and uses Supabase as its backend platform instead of a separate application server.

## Stack

- Frontend: HTML, CSS, vanilla JavaScript, and hash-based SPA routing
- Backend platform: Supabase
- Database: PostgreSQL
- Authentication: Supabase Auth
- Authorization: PostgreSQL Row Level Security (RLS)
- Realtime updates: Supabase Realtime and Postgres Changes
- File storage: Private Supabase Storage bucket
- Server-side operations: Supabase Edge Functions for administrator invitations and Pulse AI incident triage

## Architecture

```text
Browser / PulseOps UI
        |
        +-- Supabase JavaScript client
        |       +-- publishable key only
        |
        +-- Supabase Auth
        |
        +-- PostgREST -> PostgreSQL
        |                 +-- constraints
        |                 +-- triggers and functions
        |                 +-- RLS authorization boundary
        |
        +-- Supabase Realtime
        |
        +-- Private Storage
        |
        +-- Edge Function: admin-invite-user
        |                 +-- server-side privileged Supabase credentials
        |
        +-- Edge Function: incident-triage
                          +-- server-side Anthropic API key
```

The browser never needs the database password, Supabase service-role key, or any other secret key. Normal application data access is performed as the signed-in user and is limited by PostgreSQL RLS policies.

## Roles

- **Employee**: Report incidents, view incidents they submitted, add public comments, upload permitted attachments, and read published knowledge articles.
- **Engineer**: Work on assigned or team incidents, acknowledge incidents, change status, add internal notes, and use service, team, and on-call views.
- **Manager**: Manage team incidents, update assignments and priorities, and view SLA, analytics, and on-call information.
- **Administrator**: Manage organization-wide users, teams, SLA policies, audit logs, settings, and operational views.

Role-based navigation improves the user experience, but the database RLS policies remain the actual security boundary.

## Project Structure

```text
PulseOps/
├─ pulseops-ui.html
├─ reset-password.html
├─ start-pulseops.bat
├─ supabase-config.example.js
├─ supabase-config.js          # Local-only; ignored by Git
├─ README.md
├─ SUPABASE_SETUP.md
├─ BACKEND_QA.md
├─ LAUNCH_CHECKLIST.md
├─ js/
│  ├─ app.js
│  ├─ supabase-client.js
│  ├─ auth.js
│  ├─ api.js
│  ├─ realtime.js
│  └─ storage.js
└─ supabase/
   ├─ migrations/
   │  ├─ 001_extensions_enums.sql
   │  ├─ 002_core_schema.sql
   │  ├─ 003_functions_triggers.sql
   │  ├─ 004_rls_policies.sql
   │  ├─ 005_storage.sql
   │  ├─ 006_realtime.sql
   │  ├─ 007_seed_data.sql
   │  ├─ 008_backend_completion.sql
   │  ├─ 009_post_setup_hardening.sql
   │  └─ 010_cleanup_and_services.sql
   ├─ functions/
   │  ├─ admin-invite-user/index.ts
   │  └─ incident-triage/index.ts
   ├─ rls-tests.sql
   └─ verify-backend.sql
```

## Local Testing

Do not open `pulseops-ui.html` directly with `file://` when testing authentication redirects. Serve the project folder over HTTP instead:

```bash
python -m http.server 5501
```

Then open:

```text
http://localhost:5501/pulseops-ui.html
```

On Windows, you can also run:

```text
start-pulseops.bat
```

If Supabase is not configured, PulseOps intentionally displays a setup screen instead of pretending that backend operations succeeded.

## Setup

For the complete setup process, see [SUPABASE_SETUP.md](SUPABASE_SETUP.md). It covers:

- The required migration order
- Supabase project configuration
- Initial administrator setup
- Edge Function deployment
- Authentication redirect configuration
- Two-session Realtime testing

## Backend Features

- Session login, logout, and password recovery
- Automatic application profile creation for Supabase Auth users
- Organization IDs on operational data
- Database-generated incident and knowledge article numbers
- Database-generated SLA deadlines
- Controlled RPCs for incident assignment, priority, status, and acknowledgement
- Incident comments and internal notes with visibility policies
- Database-generated incident activity timelines
- Private incident attachments and metadata
- Realtime updates for incidents, comments, activity, attachments, notifications, and service health
- User-specific notifications and read states
- Administrator-controlled role, team, and user status changes
- Manager and administrator service-health updates
- Service creation with automatically generated slugs
- Knowledge article editing
- On-call schedule management
- CSV exports for incident views
- Dashboard period controls
- Administrator invitation Edge Function
- Pulse AI incident triage Edge Function using the Claude API
- Audit logging for operational and administrative changes
- RLS policies scoped by role and organization
- Dedicated password recovery page using PKCE

The Pulse AI incident triage function suggests a priority, category, owning team, and rationale for a draft incident. Suggestions are constrained to the organization's available teams and the supported incident categories.

## Security Notes

- `supabase-config.js` is excluded from Git.
- Only the Supabase project URL and publishable or anon key belong in browser configuration.
- Never place `SUPABASE_SERVICE_ROLE_KEY`, a Supabase secret key, `ANTHROPIC_API_KEY`, or the database password in frontend files.
- Administrator invitations and Pulse AI triage run through Edge Functions so privileged credentials remain server-side.
- User-provided incident, comment, and article text is escaped before being inserted into the UI.
- Internal incident notes are filtered by RLS, not merely hidden with CSS.
- Audit logs are append-only through normal browser access.

## Password Recovery

PulseOps uses a dedicated `reset-password.html` page so Supabase password recovery does not conflict with the application's hash-based routing.

- Password reset redirects are calculated from the current origin and path.
- PKCE is used to keep Supabase recovery separate from the application router.
- A valid recovery session is verified before a password update.
- Successful password changes sign out the temporary recovery session and return the user to sign-in.
- Expired links and reset-email rate limits display dedicated user messages.

For local development, add the following redirect URLs in Supabase under **Authentication > URL Configuration > Redirect URLs**:

```text
http://localhost:5501/**
http://localhost:5501/reset-password.html
```

Request a new reset email after changing the redirect configuration.

## Current Scope

Pulse AI incident triage becomes active after the `incident-triage` Edge Function is deployed and the `ANTHROPIC_API_KEY` secret is configured. See section 12 of [SUPABASE_SETUP.md](SUPABASE_SETUP.md) for details.

Until then, the Create Incident Pulse AI panel remains inactive instead of returning fabricated results. The dashboard and incident-detail Pulse AI panels are currently placeholders and are not connected to a live model.

No live Supabase credentials are committed to this repository. A real Supabase project must be configured before end-to-end database, Realtime, and Storage testing can run.
