(function () {
  "use strict";

  const supabase = () => window.PulseOpsSupabase && window.PulseOpsSupabase.client;

  function assertClient() {
    const client = supabase();
    if (!client) throw new Error("Supabase is not configured.");
    return client;
  }

  function titleCaseEnum(value) {
    return String(value || "")
      .split("_")
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function priorityLabel(priority) {
    return { p1:"P1 Critical", p2:"P2 High", p3:"P3 Medium", p4:"P4 Low" }[priority] || priority;
  }

  function initials(name) {
    return String(name || "")
      .split(/\s+/)
      .filter(Boolean)
      .map(part => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "--";
  }

  function formatDurationMinutes(total) {
    const minutes = Number(total || 0);
    if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440} days`;
    if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}h`;
    return `${minutes} min`;
  }

  function mapProfile(row) {
    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.full_name || "Unknown User",
      email: row.email || "",
      role: titleCaseEnum(row.role),
      roleValue: row.role,
      teamId: row.team_id || (row.team && row.team.id) || null,
      team: row.team ? row.team.name : "",
      status: titleCaseEnum(row.status),
      statusValue: row.status,
      lastActive: row.last_active_at ? new Date(row.last_active_at).toLocaleString() : "Never",
      avatarUrl: row.avatar_url || ""
    };
  }

  function mapService(row) {
    return {
      uuid: row.id,
      id: row.slug || row.id,
      slug: row.slug,
      name: row.name,
      description: row.description || "",
      owner: row.owner_team ? row.owner_team.name : "Unassigned",
      ownerTeamId: row.owner_team_id,
      environment: titleCaseEnum(row.environment),
      environmentValue: row.environment,
      health: titleCaseEnum(row.health),
      healthValue: row.health,
      availability: `${Number(row.availability_percent == null ? 100 : row.availability_percent).toFixed(2)}%`,
      availabilityValue: Number(row.availability_percent == null ? 100 : row.availability_percent),
      openIncidents: Number(row.open_incident_count || 0),
      lastIncident: row.last_incident_number || "None"
    };
  }

  function mapTeam(row) {
    return {
      uuid: row.id,
      id: row.id,
      name: row.name,
      description: row.description || "",
      leadId: row.lead_id || (row.lead && row.lead.id) || null,
      lead: row.lead ? row.lead.full_name : "Unassigned",
      members: Number(row.member_count || 0),
      openIncidents: Number(row.open_incident_count || 0),
      critical: Number(row.critical_incident_count || 0),
      onCall: row.current_on_call || "Unassigned",
      avgResolution: row.average_resolution || "n/a",
      services: (row.services || []).map(service => service.name)
    };
  }

  function mapIncident(row) {
    const created = row.created_at ? new Date(row.created_at) : null;
    const updated = row.updated_at ? new Date(row.updated_at) : null;
    const unresolved = !["resolved", "closed"].includes(row.status);
    const deadline = row.resolution_sla_deadline ? new Date(row.resolution_sla_deadline) : null;
    const responseDeadline = row.response_sla_deadline ? new Date(row.response_sla_deadline) : null;
    const minutesLeft = deadline ? Math.round((deadline.getTime() - Date.now()) / 60000) : null;
    const sla = unresolved && minutesLeft !== null
      ? minutesLeft <= 0 ? "Breached" : minutesLeft < 60 ? `${minutesLeft}m left` : `${Math.floor(minutesLeft / 60)}h ${Math.abs(minutesLeft % 60)}m`
      : "Met";

    return {
      uuid: row.id,
      id: row.incident_number,
      title: row.title,
      priority: row.priority,
      priorityLabel: priorityLabel(row.priority),
      status: titleCaseEnum(row.status),
      statusValue: row.status,
      service: row.service ? row.service.name : "Unassigned",
      serviceId: row.service_id,
      serviceSlug: row.service ? row.service.slug : null,
      assignee: row.assignee ? row.assignee.full_name : "Unassigned",
      assigneeId: row.assignee_id,
      initials: row.assignee ? initials(row.assignee.full_name) : "--",
      team: row.team ? row.team.name : "Unassigned",
      teamId: row.team_id,
      reporter: row.reporter ? row.reporter.full_name : "Unknown",
      reporterId: row.reporter_id,
      created: created ? created.toLocaleString() : "",
      updated: updated ? updated.toLocaleString() : "",
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
      createdOrder: created ? created.getTime() : 0,
      acknowledgedAt: row.acknowledged_at || null,
      resolvedAt: row.resolved_at || null,
      closedAt: row.closed_at || null,
      responseSlaDeadline: row.response_sla_deadline || null,
      resolutionSlaDeadline: row.resolution_sla_deadline || null,
      responseSla: responseDeadline && row.acknowledged_at
        ? `${Math.max(0, Math.round((new Date(row.acknowledged_at) - created) / 60000))}m`
        : responseDeadline ? "Pending" : "n/a",
      sla,
      slaClass: sla === "Breached" || (minutesLeft !== null && minutesLeft < 30) ? "urgent" : (minutesLeft !== null && minutesLeft < 120) ? "soon" : "",
      category: row.category || row.ai_category || "",
      environment: titleCaseEnum(row.environment),
      environmentValue: row.environment,
      affectedUsers: row.affected_scope || "",
      desc: row.description || "",
      atRisk: unresolved && minutesLeft !== null && minutesLeft <= 60,
      impact: row.impact || "",
      urgency: row.urgency || "",
      location: row.location || "",
      aiCategory: row.ai_category || "",
      aiConfidence: row.ai_confidence,
      aiReason: row.ai_reason || "",
      timeline: [],
      log: []
    };
  }

  function humanizeActivity(activity) {
    const details = activity.details || {};
    const actor = activity.actor ? activity.actor.full_name : "PulseOps System";
    const values = {
      incident_created: `${actor} created the incident`,
      status_changed: `${actor} changed status from ${titleCaseEnum(details.from)} to ${titleCaseEnum(details.to)}`,
      priority_changed: `${actor} changed priority from ${priorityLabel(details.from)} to ${priorityLabel(details.to)}`,
      assigned: `${actor} changed the incident assignee`,
      team_changed: `${actor} changed the owning team`,
      resolved: `${actor} resolved the incident`,
      comment_added: `${actor} added a ${details.visibility === "internal" ? "internal note" : "comment"}`
    };
    return values[activity.action] || `${actor} ${titleCaseEnum(activity.action).toLowerCase()}`;
  }

  async function loadInitialData() {
    const client = assertClient();
    const [organization, services, teams, profiles, sla, articles, logs, notifications, incidents, onCall, dependencies] = await Promise.all([
      client.from("organizations").select("id, name, slug, timezone, settings, created_at, updated_at").limit(1).maybeSingle(),
      client.from("services").select("id, organization_id, name, slug, description, owner_team_id, environment, health, availability_percent, owner_team:teams(id, name)").order("name"),
      client.from("teams").select("id, organization_id, name, description, lead_id, lead:profiles!teams_lead_id_fkey(id, full_name), services(id, name)").order("name"),
      client.from("profiles").select("id, organization_id, email, full_name, role, status, team_id, avatar_url, last_active_at, team:teams!profiles_team_id_fkey(id, name)").order("full_name"),
      client.from("sla_policies").select("*").order("priority"),
      client.from("knowledge_articles").select("id, article_number, title, category, summary, author:profiles(id, full_name), published, view_count, updated_at").order("updated_at", { ascending:false }),
      client.from("audit_logs").select("id, action, object_type, object_id, details, source, created_at, actor:profiles(id, full_name)").order("created_at", { ascending:false }).limit(100),
      client.from("notifications").select("id, type, title, body, incident_id, read_at, created_at, incident:incidents(incident_number)").order("created_at", { ascending:false }).limit(50),
      client.from("incidents").select("*, service:services(id, name, slug), team:teams(id, name), reporter:profiles!incidents_reporter_id_fkey(id, full_name), assignee:profiles!incidents_assignee_id_fkey(id, full_name)").order("created_at", { ascending:false }).range(0, 249),
      client.from("on_call_schedules").select("id, team_id, profile_id, starts_at, ends_at, team:teams(id, name), profile:profiles(id, full_name)").lte("starts_at", new Date(Date.now() + 7 * 86400000).toISOString()).gte("ends_at", new Date(Date.now() - 86400000).toISOString()).order("starts_at"),
      client.from("service_dependencies").select("id, service_id, depends_on_service_id, service:services!service_dependencies_service_id_fkey(id, name, slug), dependency:services!service_dependencies_depends_on_service_id_fkey(id, name, slug)")
    ]);

    const namedResponses = { organization, services, teams, profiles, sla, articles, logs, notifications, incidents, onCall, dependencies };
    const backendWarnings = [];
    Object.entries(namedResponses).forEach(([name, response]) => {
      if (response && response.error) {
        backendWarnings.push({
          stage:name,
          message:response.error.message || String(response.error),
          code:response.error.code || null,
          details:response.error.details || null,
          hint:response.error.hint || null
        });
        console.error(`[PulseOps] Initial data query failed: ${name}`, response.error);
        response.data = name === "organization" ? null : [];
      }
    });

    const mappedIncidents = (incidents.data || []).map(mapIncident);
    const mappedUsers = (profiles.data || []).map(mapProfile);
    const now = Date.now();

    const mappedTeams = (teams.data || []).map(row => {
      const teamUsers = mappedUsers.filter(user => user.teamId === row.id && user.statusValue === "active");
      const teamOpenIncidents = mappedIncidents.filter(incident => incident.teamId === row.id && !["resolved", "closed"].includes(incident.statusValue));
      const teamResolved = mappedIncidents.filter(incident => incident.teamId === row.id && incident.resolvedAt && incident.createdAt);
      const avgResolutionMinutes = teamResolved.length
        ? Math.round(teamResolved.reduce((sum, incident) => sum + Math.max(0, (new Date(incident.resolvedAt).getTime() - new Date(incident.createdAt).getTime()) / 60000), 0) / teamResolved.length)
        : null;
      const currentSchedule = (onCall.data || []).find(schedule => schedule.team_id === row.id && new Date(schedule.starts_at).getTime() <= now && new Date(schedule.ends_at).getTime() >= now);
      return mapTeam({
        ...row,
        member_count: teamUsers.length,
        open_incident_count: teamOpenIncidents.length,
        critical_incident_count: teamOpenIncidents.filter(incident => incident.priority === "p1").length,
        current_on_call: currentSchedule && currentSchedule.profile ? currentSchedule.profile.full_name : "Unassigned",
        average_resolution: avgResolutionMinutes == null ? "n/a" : formatDurationMinutes(avgResolutionMinutes)
      });
    });

    const mappedServices = (services.data || []).map(row => {
      const serviceIncidents = mappedIncidents.filter(incident => incident.serviceId === row.id);
      const openIncidents = serviceIncidents.filter(incident => !["resolved", "closed"].includes(incident.statusValue));
      return mapService({
        ...row,
        open_incident_count: openIncidents.length,
        last_incident_number: serviceIncidents[0] ? serviceIncidents[0].id : null
      });
    });

    return {
      organization: organization.data ? {
        id: organization.data.id,
        name: organization.data.name,
        slug: organization.data.slug,
        timezone: organization.data.timezone,
        settings: organization.data.settings || {}
      } : null,
      services: mappedServices,
      teams: mappedTeams,
      users: mappedUsers,
      slaPolicies: (sla.data || []).map(policy => {
        const completed = mappedIncidents.filter(i => i.priority === policy.priority && i.resolvedAt && i.resolutionSlaDeadline);
        const met = completed.filter(i => new Date(i.resolvedAt).getTime() <= new Date(i.resolutionSlaDeadline).getTime()).length;
        return {
          id: policy.id,
          policy: priorityLabel(policy.priority),
          priority: policy.priority,
          response: formatDurationMinutes(policy.response_minutes),
          responseMinutes: policy.response_minutes,
          resolution: formatDurationMinutes(policy.resolution_minutes),
          resolutionMinutes: policy.resolution_minutes,
          compliance: completed.length ? `${((met / completed.length) * 100).toFixed(1)}%` : "n/a",
          atRisk: mappedIncidents.filter(i => i.priority === policy.priority && i.atRisk).length,
          breaches: mappedIncidents.filter(i => i.priority === policy.priority && i.sla === "Breached").length,
          status: policy.enabled ? "Active" : "Disabled",
          enabled: policy.enabled
        };
      }),
      knowledgeArticles: (articles.data || []).map(article => ({
        uuid: article.id,
        id: article.article_number,
        title: article.title,
        category: article.category,
        author: article.author ? article.author.full_name : "Unknown",
        updated: article.updated_at ? new Date(article.updated_at).toLocaleDateString() : "",
        views: article.view_count || 0,
        summary: article.summary || "",
        published: article.published
      })),
      auditLogs: (logs.data || []).map(log => ({
        id: log.id,
        timestamp: log.created_at ? new Date(log.created_at).toLocaleString() : "",
        user: log.actor ? log.actor.full_name : "PulseOps System",
        action: titleCaseEnum(log.action),
        object: log.object_id || log.object_type,
        details: log.details ? Object.entries(log.details).map(([k,v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ") : "",
        source: log.source || "Web"
      })),
      notifications: (notifications.data || []).map(notification => ({
        id: notification.id,
        type: notification.type === "sla_warning" ? "warn" : notification.type === "resolved" ? "ok" : "info",
        title: notification.title,
        desc: notification.body,
        time: notification.created_at ? new Date(notification.created_at).toLocaleString() : "",
        read: Boolean(notification.read_at),
        incidentId: notification.incident ? notification.incident.incident_number : null,
        uuid: notification.incident_id
      })),
      incidents: mappedIncidents,
      onCallSchedules: (onCall.data || []).map(schedule => ({
        id: schedule.id,
        teamId: schedule.team_id,
        team: schedule.team ? schedule.team.name : "Unknown team",
        profileId: schedule.profile_id,
        profile: schedule.profile ? schedule.profile.full_name : "Unknown user",
        startsAt: schedule.starts_at,
        endsAt: schedule.ends_at
      })),
      dependencies: (dependencies.data || []).map(dep => ({
        id: dep.id,
        serviceId: dep.service_id,
        dependsOnServiceId: dep.depends_on_service_id,
        service: dep.service ? dep.service.name : "",
        dependency: dep.dependency ? dep.dependency.name : ""
      })),
      backendWarnings
    };
  }

  async function getIncidentByNumber(incidentNumber) {
    const client = assertClient();
    const { data, error } = await client
      .from("incidents")
      .select("*, service:services(id, name, slug), team:teams(id, name), reporter:profiles!incidents_reporter_id_fkey(id, full_name), assignee:profiles!incidents_assignee_id_fkey(id, full_name)")
      .eq("incident_number", incidentNumber)
      .single();
    if (error) throw error;
    return mapIncident(data);
  }

  async function getIncidentBundle(incidentNumber) {
    const client = assertClient();
    const incident = await getIncidentByNumber(incidentNumber);
    const [comments, activity, attachments, relations] = await Promise.all([
      client.from("incident_comments").select("id, body, visibility, created_at, updated_at, author:profiles(id, full_name)").eq("incident_id", incident.uuid).order("created_at", { ascending:true }),
      client.from("incident_activity").select("id, action, details, created_at, actor:profiles(id, full_name)").eq("incident_id", incident.uuid).order("created_at", { ascending:true }),
      client.from("incident_attachments").select("id, storage_path, file_name, mime_type, size_bytes, created_at, uploaded_by, uploader:profiles!incident_attachments_uploaded_by_fkey(id, full_name)").eq("incident_id", incident.uuid).order("created_at", { ascending:false }),
      client.from("incident_relations").select("id, relation_type, related:incidents!incident_relations_related_incident_id_fkey(id, incident_number, title)").eq("incident_id", incident.uuid)
    ]);
    const failed = [comments, activity, attachments, relations].find(result => result.error);
    if (failed) throw failed.error;

    const mappedActivity = (activity.data || []).map(item => ({
      id: item.id,
      action: item.action,
      details: item.details || {},
      actor: item.actor ? item.actor.full_name : "PulseOps System",
      createdAt: item.created_at,
      time: item.created_at ? new Date(item.created_at).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }) : "",
      text: humanizeActivity(item)
    }));
    incident.timeline = mappedActivity.map(item => [item.time, item.text]);
    incident.log = [...mappedActivity].reverse().slice(0, 8).map(item => [item.time, item.text]);

    return {
      incident,
      comments: (comments.data || []).map(comment => ({
        id: comment.id,
        body: comment.body,
        visibility: comment.visibility,
        author: comment.author ? comment.author.full_name : "Unknown",
        createdAt: comment.created_at,
        time: comment.created_at ? new Date(comment.created_at).toLocaleString() : ""
      })),
      activity: mappedActivity,
      attachments: (attachments.data || []).map(file => ({
        id: file.id,
        storagePath: file.storage_path,
        storage_path: file.storage_path,
        fileName: file.file_name,
        file_name: file.file_name,
        mimeType: file.mime_type,
        sizeBytes: Number(file.size_bytes || 0),
        uploadedBy: file.uploader ? file.uploader.full_name : "Unknown",
        createdAt: file.created_at
      })),
      relations: (relations.data || []).map(relation => ({
        id: relation.id,
        type: relation.relation_type,
        incidentNumber: relation.related ? relation.related.incident_number : "",
        title: relation.related ? relation.related.title : ""
      }))
    };
  }

  async function createIncident(input) {
    const client = assertClient();
    const payload = {
      title: String(input.title || "").trim(),
      description: String(input.desc || "").trim(),
      service_id: input.serviceId || null,
      team_id: input.teamId || null,
      priority: input.priority || "p3",
      category: input.category || null,
      impact: input.impact || null,
      urgency: input.urgency || null,
      affected_scope: input.affected || null,
      environment: input.environment || "production",
      location: input.location || null,
      ai_category: input.aiCategory || null,
      ai_confidence: input.aiConfidence !== undefined && input.aiConfidence !== null ? Number(input.aiConfidence) : null,
      ai_reason: input.aiReason || null
    };
    const { data, error } = await client
      .from("incidents")
      .insert(payload)
      .select("*, service:services(id, name, slug), team:teams(id, name), reporter:profiles!incidents_reporter_id_fkey(id, full_name), assignee:profiles!incidents_assignee_id_fkey(id, full_name)")
      .single();
    if (error) throw error;
    return mapIncident(data);
  }

  async function getTriageSuggestion(input) {
    const client = assertClient();
    const { data, error } = await client.functions.invoke("incident-triage", {
      body: {
        title: input.title || "",
        description: input.description || "",
        service: input.service || null,
        affected: input.affected || null,
        impact: input.impact || null,
        environment: input.environment || null,
        location: input.location || null
      }
    });
    if (error) throw error;
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  async function acknowledgeIncident(incidentUuid) {
    const client = assertClient();
    const { data, error } = await client.rpc("acknowledge_incident", { incident_uuid: incidentUuid });
    if (error) throw error;
    return data;
  }

  async function changeIncidentStatus(incidentUuid, status) {
    const client = assertClient();
    const { data, error } = await client.rpc("change_incident_status", { incident_uuid: incidentUuid, next_status: status });
    if (error) throw error;
    return data;
  }

  async function assignIncident(incidentUuid, teamId, assigneeId) {
    const client = assertClient();
    const { data, error } = await client.rpc("assign_incident", {
      incident_uuid: incidentUuid,
      next_team_id: teamId || null,
      next_assignee_id: assigneeId || null
    });
    if (error) throw error;
    return data;
  }

  async function changeIncidentPriority(incidentUuid, priority) {
    const client = assertClient();
    const { data, error } = await client.rpc("change_incident_priority", { incident_uuid: incidentUuid, next_priority: priority });
    if (error) throw error;
    return data;
  }

  async function addIncidentComment(incidentUuid, body, visibility) {
    const client = assertClient();
    const { data, error } = await client
      .from("incident_comments")
      .insert({ incident_id: incidentUuid, body: String(body || "").trim(), visibility: visibility || "public" })
      .select("id, body, visibility, created_at, author:profiles(id, full_name)")
      .single();
    if (error) throw error;
    return data;
  }

  async function getNotifications() {
    const client = assertClient();
    const { data, error } = await client
      .from("notifications")
      .select("id, type, title, body, incident_id, read_at, created_at, incident:incidents(incident_number)")
      .order("created_at", { ascending:false })
      .limit(50);
    if (error) throw error;
    return (data || []).map(notification => ({
      id: notification.id,
      type: notification.type === "sla_warning" ? "warn" : notification.type === "resolved" ? "ok" : "info",
      title: notification.title,
      desc: notification.body,
      time: notification.created_at ? new Date(notification.created_at).toLocaleString() : "",
      read: Boolean(notification.read_at),
      incidentId: notification.incident ? notification.incident.incident_number : null,
      uuid: notification.incident_id
    }));
  }

  async function markNotificationRead(notificationId) {
    const client = assertClient();
    const { error } = await client.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", notificationId);
    if (error) throw error;
  }

  async function markAllNotificationsRead() {
    const client = assertClient();
    const { error } = await client.rpc("mark_all_notifications_read");
    if (error) throw error;
  }

  async function getKnowledgeArticle(articleNumber) {
    const client = assertClient();
    const { data, error } = await client
      .from("knowledge_articles")
      .select("id, article_number, title, category, summary, content, published, view_count, created_at, updated_at, author:profiles(id, full_name)")
      .eq("article_number", articleNumber)
      .single();
    if (error) throw error;
    await client.rpc("increment_article_view", { article_uuid: data.id }).catch(() => {});
    return {
      uuid: data.id,
      id: data.article_number,
      title: data.title,
      category: data.category,
      summary: data.summary || "",
      content: data.content || "",
      published: data.published,
      views: Number(data.view_count || 0) + 1,
      author: data.author ? data.author.full_name : "Unknown",
      updated: data.updated_at ? new Date(data.updated_at).toLocaleDateString() : ""
    };
  }

  async function saveTeam(input) {
    const client = assertClient();
    const payload = {
      name:String(input.name || "").trim(),
      description:String(input.description || "").trim(),
      lead_id:input.leadId || null
    };
    let query;
    if (input.id) {
      query = client.from("teams").update(payload).eq("id", input.id);
    } else {
      const { data:userData, error:userError } = await client.auth.getUser();
      if (userError) throw userError;
      const { data:profile, error:profileError } = await client.from("profiles").select("organization_id").eq("id", userData.user.id).single();
      if (profileError) throw profileError;
      payload.organization_id = profile.organization_id;
      query = client.from("teams").insert(payload);
    }
    const { data, error } = await query.select("id, name, description, lead_id").single();
    if (error) throw error;
    return data;
  }

  async function saveService(input) {
    const client = assertClient();
    const payload = {
      name: String(input.name || "").trim(),
      description: String(input.description || "").trim(),
      owner_team_id: input.ownerTeamId || null,
      environment: input.environment || "production",
      health: input.health || "operational",
      availability_percent: input.availabilityPercent !== undefined ? Number(input.availabilityPercent) : 100
    };
    let query;
    if (input.id) {
      query = client.from("services").update(payload).eq("id", input.id);
    } else {
      const { data:userData, error:userError } = await client.auth.getUser();
      if (userError) throw userError;
      const { data:profile, error:profileError } = await client.from("profiles").select("organization_id").eq("id", userData.user.id).single();
      if (profileError) throw profileError;
      payload.organization_id = profile.organization_id;
      query = client.from("services").insert(payload);
    }
    const { data, error } = await query.select("id, name, slug").single();
    if (error) {
      if (String(error?.code) === "23505") throw new Error("A service with a very similar name already exists. Choose a different name.");
      throw error;
    }
    return data;
  }

  async function saveKnowledgeArticle(input) {
    const client = assertClient();
    const payload = {
      title:String(input.title || "").trim(),
      category:String(input.category || "General").trim(),
      summary:String(input.summary || "").trim(),
      content:String(input.content || "").trim(),
      published:Boolean(input.published)
    };
    let query;
    if (input.id) query = client.from("knowledge_articles").update(payload).eq("id", input.id);
    else query = client.from("knowledge_articles").insert(payload);
    const { data, error } = await query.select("id, article_number, title, category, summary, content, published, view_count, created_at, updated_at").single();
    if (error) throw error;
    return data;
  }

  async function saveOnCallSchedule(input) {
    const client = assertClient();
    const payload = {
      team_id: input.teamId,
      profile_id: input.profileId,
      starts_at: input.startsAt,
      ends_at: input.endsAt
    };
    let query;
    if (input.id) {
      query = client.from("on_call_schedules").update(payload).eq("id", input.id);
    } else {
      const { data:userData, error:userError } = await client.auth.getUser();
      if (userError) throw userError;
      const { data:profile, error:profileError } = await client.from("profiles").select("organization_id").eq("id", userData.user.id).single();
      if (profileError) throw profileError;
      payload.organization_id = profile.organization_id;
      query = client.from("on_call_schedules").insert(payload);
    }
    const { data, error } = await query.select("id, team_id, profile_id, starts_at, ends_at").single();
    if (error) throw error;
    return data;
  }

  async function deleteOnCallSchedule(scheduleId) {
    const client = assertClient();
    const { error } = await client.from("on_call_schedules").delete().eq("id", scheduleId);
    if (error) throw error;
  }

  async function updateCurrentProfile(input) {
    const client = assertClient();
    const payload = {};
    if (input.fullName !== undefined) payload.full_name = String(input.fullName || "").trim();
    if (input.avatarUrl !== undefined) payload.avatar_url = input.avatarUrl || null;
    payload.last_active_at = new Date().toISOString();
    const { data, error } = await client.from("profiles").update(payload).eq("id", (await client.auth.getUser()).data.user.id).select("id, full_name, avatar_url, last_active_at").single();
    if (error) throw error;
    return data;
  }

  async function updateSlaPolicy(policyId, input) {
    const client = assertClient();
    const { data, error } = await client.rpc("admin_update_sla_policy", {
      policy_uuid: policyId,
      next_response_minutes: Number(input.responseMinutes),
      next_resolution_minutes: Number(input.resolutionMinutes),
      next_enabled: Boolean(input.enabled)
    });
    if (error) throw error;
    return data;
  }

  async function adminUpdateUser(userId, input) {
    const client = assertClient();
    const { data, error } = await client.rpc("admin_update_user", {
      target_user_id: userId,
      next_role: input.role,
      next_team_id: input.teamId || null,
      next_status: input.status
    });
    if (error) throw error;
    return data;
  }

  async function inviteUser(input) {
    const client = assertClient();
    const { data, error } = await client.functions.invoke("admin-invite-user", { body: input });
    if (error) throw error;
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  async function updateOrganizationSettings(settings) {
    const client = assertClient();
    const { data, error } = await client.rpc("admin_update_organization_settings", { next_settings: settings });
    if (error) throw error;
    return data;
  }

  window.PulseOpsAPI = {
    titleCaseEnum,
    priorityLabel,
    mapIncident,
    loadInitialData,
    getIncidentByNumber,
    getIncidentBundle,
    createIncident,
    getTriageSuggestion,
    acknowledgeIncident,
    changeIncidentStatus,
    assignIncident,
    changeIncidentPriority,
    addIncidentComment,
    getNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    getKnowledgeArticle,
    saveTeam,
    saveService,
    saveKnowledgeArticle,
    saveOnCallSchedule,
    deleteOnCallSchedule,
    updateCurrentProfile,
    updateSlaPolicy,
    adminUpdateUser,
    inviteUser,
    updateOrganizationSettings
  };
})();
