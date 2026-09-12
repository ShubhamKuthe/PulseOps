# PulseOps — Remaining Launch Checklist

Everything that could be fixed in code has been fixed and saved directly into this folder (see the summary at the bottom). What's left below all requires signing into your Supabase project dashboard, which I don't have credentials for, so these need to be done by you.

## 1. Run the new database migration

A new migration file was added: `supabase/migrations/010_cleanup_and_services.sql`. It does two things:

- Removes a leftover, inactive permission rule on incidents that a previous migration already made redundant (pure cleanup, no behavior change).
- Adds the server-side logic that lets the new **"New Service"** button on the Services page work — it automatically generates a unique internal identifier for each service you create, so you don't have to.

**Action:** Open the SQL editor in your Supabase project dashboard (or use the Supabase CLI if you have it linked) and run this file, the same way you ran migrations 001–009 during setup. It only needs to run once.

## 2. Confirm the invite-user function is deployed

The Users page sends invitations through a server-side function called `admin-invite-user` (source at `supabase/functions/admin-invite-user/index.ts`). If you haven't deployed it yet, or aren't sure:

**Action:** In your Supabase dashboard, check **Edge Functions** for `admin-invite-user`. If it's not listed, deploy it with the Supabase CLI:
```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy admin-invite-user
```
Then test it once by inviting a test user from the Users page.

## 3. Set your production sign-in URLs (only if/when you host this somewhere other than your own computer)

Right now your Auth settings likely only allow `http://localhost:5501/pulseops-ui.html`. If you deploy PulseOps to a real domain later:

**Action:** In Supabase → Authentication → URL Configuration, add your production URL as both the Site URL and an Allowed Redirect URL, alongside (or instead of) the localhost one. Skip this for now if you're only running PulseOps locally.

## 4. (Optional) Turn on real Pulse AI incident triage

The Create Incident page has a "Pulse AI Triage" panel with a "Get AI Suggestion" button. It's fully built now, but it needs a live connection to an AI provider to actually work — until you do this step, clicking the button will show a "not configured" message.

**Action:**
1. Get an API key from an Anthropic account (console.anthropic.com) with billing enabled.
2. Set it as a secret: `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`
3. Deploy the function: `supabase functions deploy incident-triage`
4. Test it: fill in a title and description on Create Incident, click "Get AI Suggestion," confirm you get a real priority/category/team suggestion back.

Full details are in `SUPABASE_SETUP.md`, section 12. Skip this if you don't want AI triage yet — the rest of the app works fine without it.

## 5. Quick smoke test after the migration

Once migration 010 has run, do a fast manual pass to confirm everything is wired up:

- Go to **Services → New Service**, create one, confirm it saves and appears in the list.
- Open an incident and change its status (only valid next-steps should be offered).
- Change a priority and confirm no error toast appears on success.
- Create a new incident and confirm it saves cleanly.

---

## What was already done for you in this session

- Fixed the incident status dropdown so it only offers valid next statuses.
- Fixed a bug where successful actions (status changes, priority changes, incident creation) incorrectly showed a "could not complete the request" error, across every place that pattern existed.
- Removed a stored-XSS issue where a user's display name could inject HTML on shared pages.
- Cleaned up a leftover duplicate database permission rule.
- Rewrote all user-facing text across the app to remove backend/technical language (Supabase, database, RLS, Edge Function, etc.) so the product reads as a finished, professional tool rather than a work-in-progress.
- Added a full "Create Service" flow (button, form, and the underlying save logic) — previously services could only be edited, not created.
- Fixed the SLA Compliance gauge on the dashboard overlapping its own caption text.
- Built real Pulse AI incident triage on the Create Incident page: a "Get AI Suggestion" button that calls a new server-side function (`incident-triage`), which asks Claude to suggest a priority, category and owning team for the incident you're describing, with a confidence score and short rationale. "Apply Suggestions" now applies the real result instead of a hardcoded example. Needs step 4 above to actually go live.
