# PulseOps Supabase Setup

This guide assumes you have never used Supabase before. Complete the steps in order.

## 1. Create the Supabase project

1. Sign in to Supabase.
2. Create a new project named `pulseops`.
3. Choose a region near your intended users (UK/Europe is sensible for a UK-hosted demo).
4. Generate a strong database password and save it privately in a password manager.
5. Wait for the project to finish provisioning.

**Do not put the database password in PulseOps frontend files.**

## 2. Get the frontend-safe project values

In the Supabase project settings/API area, copy:

- Project URL
- Publishable key (or the legacy anon key if that is what your project UI exposes)

Do **not** copy a secret key or service-role key into the browser application.

## 3. Configure PulseOps locally

`supabase-config.js` is already ignored by git. Fill it with only the frontend-safe values:

```js
window.PULSEOPS_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
  supabasePublishableKey: "YOUR_PUBLISHABLE_KEY"
};
```

Keep `supabase-config.example.js` as the shareable template.

## 4. Apply the database migrations

Open **SQL Editor** in Supabase and run the files in this exact order:

1. `supabase/migrations/001_extensions_enums.sql`
2. `supabase/migrations/002_core_schema.sql`
3. `supabase/migrations/003_functions_triggers.sql`
4. `supabase/migrations/004_rls_policies.sql`
5. `supabase/migrations/005_storage.sql`
6. `supabase/migrations/006_realtime.sql`
7. `supabase/migrations/007_seed_data.sql`
8. `supabase/migrations/008_backend_completion.sql`
9. `supabase/migrations/009_post_setup_hardening.sql`

Run each script only after the preceding script succeeds.

Migration 008 adds the controlled incident/admin workflows, profile-email sync, notifications, validation and restricted grants expected by the frontend. Migration 009 completes attachment deletion permissions, knowledge-article authorship, on-call validation/auditing, and cross-tenant relationship validation for teams/services.

## 5. Verify the seed organization

The seed data creates the demo organization:

```text
Acme Technologies
slug: acme-technologies
timezone: Europe/London
```

It also creates teams, services, SLA policies, knowledge articles and dependencies. Auth users are intentionally **not** seeded through unsafe SQL.

## 6. Create the first Auth user

Use the Supabase Authentication dashboard to create the first user with your email address.

The `handle_new_auth_user` trigger should automatically create a matching `public.profiles` row with the default role `employee`.

Never make signup metadata capable of choosing `administrator`. PulseOps deliberately ignores role elevation from untrusted signup metadata.

## 7. Promote the first administrator once

After the first account exists, open SQL Editor and run the following statement after replacing the placeholder email:

```sql
update public.profiles
set role = 'administrator'
where id = (
  select id
  from auth.users
  where lower(email) = lower('REPLACE_WITH_ADMIN_EMAIL')
);
```

Confirm exactly one intended user was updated.

This is the bootstrap step only. Afterward, PulseOps administrators can manage users through the application workflow.

## 8. Configure Auth URLs

In Supabase Authentication URL/Redirect settings, add your local PulseOps URL, for example:

```text
Site URL:
http://localhost:5501/pulseops-ui.html

Allowed redirect URL:
http://localhost:5501/pulseops-ui.html
```

If you later deploy PulseOps, add the production HTTPS URL as well.

## 9. Run PulseOps through a local web server

From the PulseOps folder:

```bash
python -m http.server 5501
```

Open:

```text
http://localhost:5501/pulseops-ui.html
```

You should now see the PulseOps login screen instead of the "Supabase is not configured" screen.

## 10. Test administrator login

Sign in using the Auth account you promoted.

Verify that the administrator can see:

- Overview
- Incidents
- My Incidents
- Create Incident
- Services
- Teams
- SLA Management
- On-Call
- Analytics
- Knowledge Base
- Users
- Audit Logs
- Settings

If the account is still shown as Employee, sign out and sign back in after confirming the profile row was updated.

## 11. Deploy the administrator invite Edge Function

The Users page invokes:

```text
admin-invite-user
```

The function source is:

```text
supabase/functions/admin-invite-user/index.ts
```

If you use the Supabase CLI, authenticate/link the project and deploy it:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy admin-invite-user
```

The function expects Supabase's server-side environment values. Supabase-hosted Edge Functions commonly provide the project URL plus legacy anon/service-role values; the implementation also accepts newer publishable/secret-key environment representations when available.

**Never copy the service-role/secret key into `supabase-config.js`.**

If your deployment environment does not automatically expose the required server secret, configure it as an Edge Function secret in Supabase—not in frontend JavaScript.

## 12. Deploy the Pulse AI incident triage function (optional)

The Create Incident page's "Pulse AI Triage" panel calls a second Edge Function, `incident-triage`, which analyzes the title/description you're typing and suggests a priority, category, and owning team. It calls the Anthropic Claude API server-side — the API key is never exposed to the browser. Skip this step if you don't want AI triage yet; the rest of PulseOps works fine without it, the panel just stays inactive.

The function source is:

```text
supabase/functions/incident-triage/index.ts
```

1. Get an API key from an Anthropic account (console.anthropic.com), with billing enabled — every triage suggestion is a paid API call.
2. Set it as an Edge Function secret (never in `supabase-config.js` or any frontend file):

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

3. Deploy the function:

```bash
supabase functions deploy incident-triage
```

4. (Optional) The function defaults to a specific Claude model snapshot. Model names are periodically retired — if triage suggestions start failing, check console.anthropic.com/docs for the current recommended fast/small model and override it without redeploying:

```bash
supabase secrets set ANTHROPIC_MODEL=the-current-model-id
```

5. Test it: go to Create Incident, fill in a title and description, and click "Get AI Suggestion."

## 13. Verify Storage

Open Storage and confirm a private bucket exists:

```text
incident-attachments
```

Expected limit:

```text
10 MB per file
```

PulseOps accepts these frontend file extensions:

```text
png, jpg, jpeg, webp, pdf, txt, log
```

The bucket is private. Files are opened through short-lived signed URLs after authorization.

## 14. Verify RLS is enabled

In Table Editor/Database policies, confirm RLS is enabled for application tables including:

- organizations
- profiles
- teams
- services
- service_dependencies
- sla_policies
- incidents
- incident_comments
- incident_activity
- incident_attachments
- notifications
- knowledge_articles
- on_call_schedules
- audit_logs
- incident_relations

Do not disable RLS to fix a frontend error. Fix the policy or query instead.

## 15. Invite test users

From the administrator Users page, invite several accounts, for example:

- Employee
- Engineer
- Manager

Give engineer/manager users appropriate teams.

Do not hardcode shared demo passwords in the repository.

For an enterprise-style demo, disable open public signup in Supabase Auth once the initial administrator is bootstrapped and use invitations instead.

## 16. Test role behavior

### Employee

Verify the employee can create an incident and see incidents they reported, but cannot open administrator routes or internal notes.

### Engineer

Verify the engineer can see incidents assigned to them/their team, acknowledge permitted incidents, change allowed workflow status, add internal notes, and upload attachments.

### Manager

Verify the manager can manage incidents within the permitted team scope and change priority/assignment where the database permits it.

### Administrator

Verify the administrator can access organization-wide data, edit SLA policies, invite/change/disable users, and read audit logs.

## 17. Run the RLS test checklist

Open:

```text
supabase/rls-tests.sql
```

It contains a manual test checklist. Use separate test accounts/sessions to verify important negative cases such as:

- one employee cannot read an unrelated employee incident
- employees cannot retrieve internal notes
- users cannot modify their own role/organization ID
- users cannot read another user's notifications
- normal browser users cannot insert/edit audit logs
- attachment access follows incident authorization

RLS should be tested using authenticated user sessions, not only the SQL Editor's elevated context.

## 18. Test Realtime with two browser sessions

Use two separate browser profiles/incognito contexts.

Suggested test:

1. Sign in as an Employee in Browser A.
2. Create an incident.
3. Sign in as an Engineer/Administrator in Browser B.
4. Open the same incident.
5. In Browser B, acknowledge/change the incident status or add a comment.
6. Confirm Browser A updates without a full page refresh when the record is within its RLS visibility.
7. Assign an incident to Browser B's user and verify the notification bell updates.

## 19. Test attachments

1. Open an authorized incident.
2. Upload a small permitted file.
3. Confirm metadata appears in `incident_attachments`.
4. Confirm the actual object exists in the private Storage bucket.
5. Click Open in PulseOps and verify a signed URL is created.
6. Attempt the same object as an unrelated user and confirm access is denied.

## 20. Password recovery

Use **Forgot Password** on the login screen.

The flow uses Supabase Auth and listens for the `PASSWORD_RECOVERY` auth event. The recovery page allows the signed recovery session to set a new password.

Ensure your local/production redirect URLs are allowed in Supabase Auth settings.

## 21. Troubleshooting

### "Supabase is not configured"

Check `supabase-config.js` contains the correct Project URL and publishable/anon key and that the file is loaded by `pulseops-ui.html`.

### Login works but profile fails

Check that the Auth user has a row in `public.profiles`. Confirm the `on_auth_user_created` trigger exists and migrations 003/008 completed.

### Permission/RLS error

Do not add a service-role key to the browser. Verify the user's profile role/team/organization and the relevant RLS policy.

### Invite User fails

Confirm `admin-invite-user` is deployed, the caller is an active administrator, and the Edge Function has access to server-side Supabase credentials.

### Realtime does not update

Confirm migration 006 was applied and the relevant tables are part of the Realtime publication. Also confirm RLS allows the signed-in user to see the changed row.

### Attachments fail

Confirm migration 005/008 was applied, the bucket is private, the user can view/manage the incident, and the file is <= 10 MB with an allowed type.

## What is intentionally not configured here

- No real Project URL or publishable key is included in this ZIP.
- No database password is included.
- No service-role or secret key is included.
- Pulse AI incident triage (Create Incident page) calls a live LLM once you deploy `incident-triage` and set `ANTHROPIC_API_KEY` (step 12) — until then the panel stays inactive. The dashboard and incident-detail "Pulse AI" panels are still placeholders and don't call a live LLM.
- End-to-end live Supabase verification requires your project credentials and test accounts.

### Password recovery callback

PulseOps uses a dedicated `reset-password.html` page for Supabase password recovery so auth callback parameters never conflict with the application's hash router. For local development, allow `http://localhost:5501/**` (or specifically `http://localhost:5501/reset-password.html`) in Supabase **Authentication → URL Configuration → Redirect URLs**. Request a fresh reset email after changing this configuration.


## 22. Current build completion checks

After migration 010 is applied, verify these live workflows:

1. Create an incident and confirm the database-generated `INC-xxxx` number and SLA deadlines.
2. Open the same incident in a second authorized browser session; change status/assignment and confirm Realtime updates without refresh.
3. Add a public comment and an internal note; confirm an Employee session never receives the internal note.
4. Upload/open/delete an attachment and confirm the private bucket uses signed URLs.
5. As Manager/Admin, update a Service health state and confirm the other session refreshes from Realtime.
6. As Manager/Admin, create a new Service and confirm it gets a unique slug automatically.
7. As Manager/Admin, create/edit a knowledge article.
8. As Manager/Admin, create/edit an on-call schedule; non-authorized users must be denied by RLS.
9. As Admin, deploy `admin-invite-user` and invite an Employee/Engineer/Manager account.
10. If `incident-triage` is deployed, fill in a title/description on Create Incident and click "Get AI Suggestion"; confirm a real suggestion appears (not the old hardcoded example) and "Apply Suggestions" fills in Category/Urgency.
11. Confirm Audit Logs contain service, team, SLA, incident, knowledge and on-call changes where applicable.

See `BACKEND_QA.md` for a role-by-role checklist.
