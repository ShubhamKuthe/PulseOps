import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

type InvitePayload = {
  email: string;
  fullName?: string;
  role?: "employee" | "engineer" | "manager" | "administrator";
  teamId?: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || readNamedKey("SUPABASE_PUBLISHABLE_KEYS");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || readNamedKey("SUPABASE_SECRET_KEYS");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Edge Function is not configured." }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } }
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) {
    return json({ error: "Authentication required." }, 401);
  }

  const { data: caller, error: callerError } = await userClient
    .from("profiles")
    .select("id, organization_id, role, status")
    .eq("id", authData.user.id)
    .single();

  if (callerError || !caller || caller.status !== "active" || caller.role !== "administrator") {
    return json({ error: "Administrator privileges required." }, 403);
  }

  const payload = await req.json() as InvitePayload;
  const email = String(payload.email || "").trim().toLowerCase();
  const role = payload.role || "employee";
  const allowedRoles = new Set(["employee", "engineer", "manager", "administrator"]);

  if (!email || !email.includes("@")) {
    return json({ error: "A valid email is required." }, 400);
  }
  if (!allowedRoles.has(role)) {
    return json({ error: "Invalid role." }, 400);
  }

  if (payload.teamId) {
    const { data: team, error: teamError } = await userClient
      .from("teams")
      .select("id")
      .eq("id", payload.teamId)
      .eq("organization_id", caller.organization_id)
      .single();
    if (teamError || !team) return json({ error: "Selected team is not available." }, 400);
  }

  const { data: invite, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { full_name: payload.fullName || email.split("@")[0] }
  });

  if (inviteError || !invite.user) {
    return json({ error: inviteError?.message || "Unable to invite user." }, 400);
  }

  const { error: profileError } = await adminClient
    .from("profiles")
    .update({
      organization_id: caller.organization_id,
      full_name: payload.fullName || email.split("@")[0],
      role,
      team_id: payload.teamId || null,
      status: "active"
    })
    .eq("id", invite.user.id);

  if (profileError) {
    return json({ error: "Invitation sent, but profile update failed." }, 500);
  }

  await adminClient.from("audit_logs").insert({
    organization_id: caller.organization_id,
    actor_id: caller.id,
    action: "invite_user",
    object_type: "profile",
    object_id: invite.user.id,
    details: { email, role, team_id: payload.teamId || null },
    source: "edge_function"
  });

  return json({ userId: invite.user.id, email, role }, 200);
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}


function readNamedKey(name: string): string | undefined {
  const raw = Deno.env.get(name);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
    if (parsed && typeof parsed === "object") {
      const defaultKey = typeof parsed.default === "string" ? parsed.default : undefined;
      const firstKey = Object.values(parsed).find((value) => typeof value === "string");
      return defaultKey || (typeof firstKey === "string" ? firstKey : undefined);
    }
  } catch (_) {
    return raw;
  }
  return undefined;
}
