# PulseOps

PulseOps is an enterprise-style **IT incident and operations management platform**. It combines a compact operations dashboard with incident workflows, service ownership, SLA tracking, teams/on-call information, knowledge articles, notifications, audit logs, private attachments, and role-aware administration.

The current implementation keeps the original single-page HTML/CSS design and connects it to **Supabase** rather than introducing a separate application server.

## Stack

- Frontend: HTML, CSS, vanilla JavaScript, hash-based SPA routing
- Backend platform: Supabase
- Database: PostgreSQL
- Authentication: Supabase Auth
- Authorization: PostgreSQL Row Level Security (RLS)
- Realtime: Supabase Realtime/Postgres Changes
- Files: private Supabase Storage bucket
- Privileged server operations: Supabase Edge Functions for administrator user invitations and Pulse AI incident triage

## Architecture

```text
Browser / PulseOps UI
        |
        +-- Supabase JS client (publishable key only)
        |
        +-- Supabase Auth
        |
        +-- PostgREST -> PostgreSQL
        |                 |
        |                 +-- constraints
        |                 +-- triggers/functions
        |                 +-- RLS authorization boundary
        |
        +-- Realtime
        |
        +-- Private Storage
        |
        +-- Edge Function: admin-invite-user
        |                +-- server-side privileged Supabase key
        |
        +-- Edge Function: incident-triage
                         +-- server-side Anthropic API key
```

The browser never requires the database password, service-role key, or secret key. Normal application data access runs as the signed-in user and is constrained by RLS.

## Roles

- **Employee** — report incidents, see incidents they reported, add public comments, upload permitted attachments, read published knowledge articles.
- **Engineer** — work assigned/team incidents, acknowledge/change status, add internal notes, use operational service/team/on-call views.
- **Manager** — team incident management, assignment/priority changes, SLA/analytics/on-call visibility.
- **Administrator** — organization-wide administration, users, SLA policies, audit logs, settings and all operational views.

Role-aware navigation is a UX layer only. Database RLS remains the security boundary.

## Project layout

```text
PulseOps/
├─ pulseops-ui.html
├─ reset-password.html
├─ start-pulseops.bat
├─ supabase-config.example.js
├─ supabase-config.js          # local-only; ignored by git
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

## Local run

Do not open `pulseops-ui.html` directly with `file://` when testing authentication redirects. Serve the folder over HTTP, for example:

```bash
python -m http.server 5501
```

Then open:

```text
http://localhost:5501/pulseops-ui.html
```

If Supabase is not configured, PulseOps intentionally shows a setup screen instead of pretending backend operations succeeded.

## Setup

See **[SUPABASE_SETUP.md](SUPABASE_SETUP.md)** for the complete beginner-friendly setup sequence, migration order, initial administrator bootstrap, Edge Function deployment, and two-session Realtime test.

## Backend features implemented

- Session login/logout and password recovery scaffolding
- Automatic application profile creation for Auth users
- Multi-tenant organization IDs on operational data
- Database-generated incident and knowledge article numbers
- Database-side SLA deadlines
- Controlled incident acknowledge/status/assignment/priority RPCs
- Incident comments and internal notes with visibility policies
- Database-generated incident activity timeline
- Private incident attachment storage and metadata
- Realtime incident/comment/activity/attachment/notification subscriptions plus live service health refresh
- User-specific notifications and read state
- Admin-controlled role/team/status changes
- Manager/Admin service-health updates, service creation with auto-generated slugs, knowledge article editing and on-call schedule management
- CSV export for incident views and live dashboard period controls
- Admin invitation Edge Function
- Pulse AI incident triage Edge Function (Claude API): suggests priority, category, owning team and a rationale for a draft incident, constrained to the organization's real teams and a fixed category list
- Audit logging for operational/admin changes
- RLS policies for role and organization scope
- Hardened password-recovery flow using a dedicated callback page and PKCE, plus a full-viewport application shell

## Security notes

- `supabase-config.js` is ignored by git.
- Only the **Project URL** and **publishable/anon key** belong in browser configuration.
- Never put `SUPABASE_SERVICE_ROLE_KEY`, a Supabase secret key, `ANTHROPIC_API_KEY`, or the database password in frontend files.
- The administrator invitation and Pulse AI triage flows both use Edge Functions so privileged credentials remain server-side.
- User-supplied incident/comment/article text is escaped before being inserted into the UI.
- Internal incident notes are filtered by RLS, not just hidden with CSS.
- Audit logs are append-only from normal browser access.

## Password recovery

PulseOps uses a dedicated `reset-password.html` page for Supabase password recovery so auth callback parameters never conflict with the application's hash router.

- Password-reset redirects are computed from the current origin/path and use PKCE so auth recovery does not collide with PulseOps hash routing.
- A valid recovery session is verified before a password update.
- Successful password changes sign out the temporary recovery session and return to sign-in.
- Expired links and reset-email rate limits receive dedicated user messages.
- For local development, allow `http://localhost:5501/**` (or specifically `http://localhost:5501/reset-password.html`) in Supabase **Authentication → URL Configuration → Redirect URLs**. Request a fresh reset email after changing this configuration.

## Current scope

Pulse AI incident triage (Create Incident page) is live once `incident-triage` is deployed and `ANTHROPIC_API_KEY` is set — see [SUPABASE_SETUP.md](SUPABASE_SETUP.md), section 12. Until then the panel stays inactive rather than returning fabricated results. The dashboard and incident-detail "Pulse AI" panels are still placeholders and are not wired to a live model yet.

No live Supabase credentials are committed to this repository. A real project must be configured before end-to-end database/realtime/storage testing can run.

`start-pulseops.bat` starts a local server and opens PulseOps automatically on Windows; local development defaults to `http://localhost:5501/pulseops-ui.html`.
