# PulseOps Backend QA Checklist

Use this after migrations 001–010 are applied and the `admin-invite-user` Edge Function is deployed.

## 1. Administrator smoke test

- Sign in as Administrator.
- Confirm Overview, Incidents, Services, Teams, SLA, On-Call, Analytics, Knowledge Base, Users, Audit Logs and Settings load.
- Create an incident and confirm a database-generated incident number appears.
- Change priority, assignment and status.
- Add a public comment and internal note.
- Upload, open and delete an attachment.
- Change Service health and availability.
- Create a new Service and confirm it gets a unique slug automatically.
- Create/edit a Team.
- Create/edit a Knowledge article.
- Create/edit/delete an On-Call schedule.
- Export Incidents as CSV.
- Confirm Audit Logs record the relevant changes.

## 2. Realtime two-browser test

Use two separate browser profiles/incognito sessions.

1. Employee reports an incident.
2. Engineer opens the incident.
3. Engineer acknowledges it.
4. Employee should see the status change without refreshing while the incident is open.
5. Engineer adds a public comment; Employee should receive it live.
6. Engineer adds an internal note; Employee must **not** receive the internal note.
7. Engineer resolves the incident.
8. Employee should receive a notification and the incident should update live.

## 3. Storage test

- Upload PNG/PDF/TXT/LOG files under 10 MB.
- Confirm the bucket remains private.
- Confirm authorized users can open a short-lived signed URL.
- Confirm an unauthorized user cannot access another incident's attachment.
- Confirm Engineer/Manager/Admin can delete an attachment on an incident they can manage after migration 009.

## 4. RLS negative tests

Use separate accounts:

- Employee A cannot read an unrelated Employee B incident.
- Employee cannot retrieve internal notes.
- Employee cannot open admin routes or query Audit Logs.
- Engineer cannot change their own role/organization.
- Manager cannot manage another team's on-call schedule.
- User cannot read another user's notifications.
- Cross-organization service/team relationships are rejected.

## 5. Edge Functions

Deploy `supabase/functions/admin-invite-user/index.ts`.

Then from Users:

- Invite Employee.
- Invite Engineer with a Team.
- Invite Manager with a Team.
- Verify each profile has the requested role/team but remains in the caller's organization.
- Verify no service-role/secret key exists in browser files.

If `supabase/functions/incident-triage/index.ts` is deployed with `ANTHROPIC_API_KEY` set, also test Pulse AI triage from Create Incident:

- Fill in a title and description, click "Get AI Suggestion."
- Confirm a real priority/category/team/confidence/rationale is returned, not the old static example.
- Confirm "Apply Suggestions" fills in Category and Urgency on the form.
- Confirm no Anthropic key exists in browser files.
- Create the incident and confirm `ai_category`, `ai_confidence` and `ai_reason` are populated on the row.

## 6. Final production checks

- Replace local Auth redirect URLs with the production HTTPS URL in Supabase while keeping localhost for development if needed.
- Keep `supabase-config.js` ignored by Git.
- Never commit database passwords, service-role keys, Supabase secret keys, or `ANTHROPIC_API_KEY`.
- Run browser console QA: no uncaught errors and no duplicate Realtime subscriptions.
