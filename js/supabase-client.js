(function () {
  "use strict";

  function readConfig() {
    const config = window.PULSEOPS_CONFIG || {};
    const supabaseUrl = String(config.supabaseUrl || "").trim();
    const supabasePublishableKey = String(config.supabasePublishableKey || "").trim();
    const configured =
      supabaseUrl.startsWith("https://") &&
      supabasePublishableKey.length > 20 &&
      !supabaseUrl.includes("YOUR_") &&
      !supabasePublishableKey.includes("YOUR_");

    return { supabaseUrl, supabasePublishableKey, configured };
  }

  function createPulseOpsClient() {
    const config = readConfig();
    if (!config.configured) {
      return { config, client: null };
    }

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("Supabase JS client failed to load.");
    }

    const client = window.supabase.createClient(
      config.supabaseUrl,
      config.supabasePublishableKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "pkce"
        }
      }
    );

    return { config, client };
  }

  window.PulseOpsSupabase = createPulseOpsClient();
})();
