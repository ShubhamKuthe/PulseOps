(function () {
  "use strict";

  const channels = new Map();
  const supabase = () => window.PulseOpsSupabase && window.PulseOpsSupabase.client;

  async function unsubscribe(name) {
    const client = supabase();
    const channel = channels.get(name);
    if (client && channel) {
      try { await client.removeChannel(channel); } catch (_) {}
    }
    channels.delete(name);
  }

  async function unsubscribeAll() {
    const names = [...channels.keys()];
    await Promise.all(names.map(unsubscribe));
  }

  function replaceChannel(name, build) {
    const client = supabase();
    if (!client) return null;
    const previous = channels.get(name);
    if (previous) client.removeChannel(previous).catch(() => {});
    const channel = build(client.channel(`pulseops:${name}`));
    channel.subscribe();
    channels.set(name, channel);
    return channel;
  }

  function subscribeToIncident(incidentId, handlers) {
    if (!incidentId) return null;
    const h = handlers || {};
    return replaceChannel("active-incident", channel => channel
      .on("postgres_changes", { event: "*", schema: "public", table: "incidents", filter: `id=eq.${incidentId}` }, h.incident || function () {})
      .on("postgres_changes", { event: "*", schema: "public", table: "incident_activity", filter: `incident_id=eq.${incidentId}` }, h.activity || function () {})
      .on("postgres_changes", { event: "*", schema: "public", table: "incident_comments", filter: `incident_id=eq.${incidentId}` }, h.comments || function () {})
      .on("postgres_changes", { event: "*", schema: "public", table: "incident_attachments", filter: `incident_id=eq.${incidentId}` }, h.attachments || function () {})
    );
  }

  function subscribeToIncidentList(handler) {
    return replaceChannel("incident-list", channel => channel
      .on("postgres_changes", { event: "*", schema: "public", table: "incidents" }, handler || function () {})
    );
  }

  function subscribeToServices(handler) {
    return replaceChannel("services", channel => channel
      .on("postgres_changes", { event:"*", schema:"public", table:"services" }, handler || function () {})
    );
  }

  function subscribeToNotifications(userId, handler) {
    if (!userId) return null;
    return replaceChannel("notifications", channel => channel
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, handler || function () {})
    );
  }

  window.PulseOpsRealtime = {
    subscribeToIncident,
    subscribeToIncidentList,
    subscribeToServices,
    subscribeToNotifications,
    unsubscribe,
    unsubscribeAll
  };
})();
