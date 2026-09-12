/* ==========================================================
   PULSEOPS FRONTEND SPA
   ========================================================== */
const PRIORITY_LABELS = { p1:"P1 Critical", p2:"P2 High", p3:"P3 Medium", p4:"P4 Low" };
// Mirrors the transition table enforced by public.change_incident_status()
// in supabase/migrations/008_backend_completion.sql. Keep these in sync so
// the UI never offers a transition the database will reject.
const STATUS_TRANSITIONS = {
  open: ["acknowledged","investigating","in_progress","waiting","resolved"],
  acknowledged: ["investigating","in_progress","waiting","monitoring","resolved"],
  investigating: ["in_progress","waiting","monitoring","resolved"],
  in_progress: ["investigating","waiting","monitoring","resolved"],
  waiting: ["investigating","in_progress","monitoring","resolved"],
  monitoring: ["investigating","in_progress","resolved"],
  resolved: ["monitoring","closed"],
  closed: []
};
const ROUTES = {"Overview":"overview","Incidents":"incidents","My Incidents":"my-incidents","Create Incident":"create-incident","Services":"services","Teams":"teams","SLA Management":"sla","On-Call":"on-call","Analytics":"analytics","Knowledge Base":"knowledge","Users":"users","Audit Logs":"audit","Settings":"settings"};
const NAV_BY_ROUTE = {overview:"Overview",incidents:"Incidents",incident:"Incidents","my-incidents":"My Incidents","create-incident":"Create Incident",services:"Services",service:"Services",teams:"Teams",team:"Teams",sla:"SLA Management","on-call":"On-Call",analytics:"Analytics",knowledge:"Knowledge Base",article:"Knowledge Base",users:"Users",audit:"Audit Logs",settings:"Settings"};
const appShell = document.getElementById("appShell");
const appMain = document.getElementById("appMain");

const APP_DATA = {
  currentUser:{id:null,name:"PulseOps User",email:"",role:"Employee",roleValue:"employee",team:"",teamId:null,organization:""},
  organization:null,
  services:[],
  teams:[],
  incidents:[],
  users:[],
  slaPolicies:[],
  knowledgeArticles:[],
  auditLogs:[],
  notifications:[],
  onCallSchedules:[],
  dependencies:[]
};

const appState = {
  currentRoute:"overview",
  routeParam:null,
  booted:false,
  backendReady:false,
  authSession:null,
  authProfile:null,
  authError:"",
  recoveryMode:false,
  recoveryInvalid:false,
  eventsWired:false,
  authListenerWired:false,
  selectedIncident:null,
  incidentBundle:null,
  articleDetail:null,
  incidentTab:"activity",
  realtimeRefreshTimer:null,
  backendRefreshTimer:null,
  backendWarnings:[],
  dashboardRangeDays:30,
  incidentFilters:{view:"All",query:"",status:"",priority:"",service:"",team:"",assignee:"",date:"",sort:"createdOrder",dir:"desc",page:1,pageSize:10,selected:new Set()},
  settingsTab:"General",
  knowledgeCategory:"All",
  myTab:"Needs Attention",
  triage:{status:"idle",data:null,error:null}
};

function initials(name){return String(name||"?").split(/\s+/).filter(Boolean).map(p=>p[0]).join("").slice(0,2).toUpperCase()||"?";}
function slug(text){return String(text).toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");}
function esc(value){return String(value ?? "").replace(/[&<>'"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[ch]));}
function priorityBadge(p){return `<span class="priority-badge ${p}"><span class="dot"></span>${PRIORITY_LABELS[p] || p}</span>`;}
function statusBadge(s){return `<span class="status-badge ${slug(s)}">${esc(s)}</span>`;}
function healthBadge(h){return `<span class="health-badge ${slug(h)}">${esc(h)}</span>`;}
function avatar(n){return `<span class="avatar">${esc(initials(n))}</span>`;}
function pageHeader(title,subtitle,actions="",kicker=""){return `<div class="page-header"><div>${kicker?`<div class="page-kicker">${kicker}</div>`:""}<h1 class="page-title">${title}</h1><div class="page-subtitle">${subtitle}</div></div><div class="page-actions">${actions}</div></div>`;}
function metric(label,value,sub){return `<div class="metric-card"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-sub">${esc(sub)}</div></div>`;}
function iconSearch(){return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.5-4.5"/></svg>`;}
function plusIcon(){return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>`;}
function emptyState(t,b,a=""){return `<div class="empty-state"><h3>${t}</h3><p>${b}</p>${a}</div>`;}
function unique(arr,key){return [...new Set(arr.map(x=>x[key]).filter(Boolean))].sort();}
function incidentById(id){return APP_DATA.incidents.find(i=>i.id===id);}
function serviceById(id){return APP_DATA.services.find(s=>s.id===id) || null;}
function parseHash(){const [route,param]=(location.hash || "#overview").slice(1).split("/"); return {route:route || "overview",param:param?decodeURIComponent(param):null};}
function navigate(route,param){const next=`#${route}${param?`/${encodeURIComponent(param)}`:""}`; location.hash===next ? renderPage() : location.hash=next;}
function safeErrorMessage(error){
  const message = String(error && error.message ? error.message : error || "Something went wrong.");
  const code = String(error && error.code ? error.code : "");
  if (/invalid login credentials|email not confirmed/i.test(message)) return "The email or password is incorrect, or the account is not ready yet.";
  if (/same password|different from the old|new password should be different/i.test(message)) return "Choose a new password that is different from your current password.";
  if (/weak password|password should contain|password must/i.test(message)) return message;
  if (/otp_expired|expired|recovery_session_missing|no session|session missing/i.test(`${code} ${message}`)) return "This password reset link is no longer valid. Request a new reset email.";
  if (/rate limit|too many requests|email rate limit/i.test(message)) return "Too many reset requests were sent. Please wait before requesting another email.";
  if (/jwt|auth|session|refresh token/i.test(message)) return "Your session is no longer valid. Please sign in again.";
  if (/permission|policy|rls|not authorized|forbidden|row-level security/i.test(message)) return "You do not have permission to perform that action.";
  if (/function.*not found|edge function|failed to send a request to the edge function/i.test(message)) return "This feature isn't available yet. Contact your workspace administrator.";
  if (/network|fetch|failed to fetch/i.test(message)) return "PulseOps couldn't reach the server. Check your connection and try again.";
  if (/duplicate|violates|invalid input|check constraint/i.test(message)) return "The submitted data did not pass validation.";
  if (/attachment|10 mb|allowed attachment/i.test(message)) return message;
  if (/invalid incident status transition|closed incidents cannot transition|resolved incidents may only/i.test(message)) return "That status change isn't allowed from the incident's current status. Refresh the incident to see valid next steps.";
  if (/not authorized to (change|assign|acknowledge|reprioritize)/i.test(message)) return "You do not have permission to make that change to this incident.";
  if (/AI triage|title and description are required/i.test(message)) return message;
  return "PulseOps couldn't complete that request. Please try again, and contact your workspace administrator if it keeps happening.";
}

function recoveryIntent(){
  const url=new URL(window.location.href);
  if(url.searchParams.get("recovery")==="1") return true;
  const hash=String(url.hash||"");
  return /(?:^|[&#])type=recovery(?:&|$)/i.test(hash) || /(?:^|[&#])error_code=otp_expired(?:&|$)/i.test(hash);
}

function recoveryUrlError(){
  const url=new URL(window.location.href);
  const hashParams=new URLSearchParams(String(url.hash||"").replace(/^#/,""));
  const code=url.searchParams.get("error_code") || hashParams.get("error_code") || "";
  const desc=url.searchParams.get("error_description") || hashParams.get("error_description") || "";
  if(code || desc) return {code,description:desc};
  return null;
}

function clearRecoveryUrl(){
  const url=new URL(window.location.href);
  ["recovery","code","error","error_code","error_description"].forEach(key=>url.searchParams.delete(key));
  url.hash="";
  history.replaceState({},document.title,url.pathname + (url.search ? url.search : ""));
}

const ROLE_ALLOWED_ROUTES = {
  employee:new Set(["overview","my-incidents","create-incident","incident","knowledge","article"]),
  engineer:new Set(["overview","incidents","my-incidents","create-incident","incident","services","service","teams","team","on-call","knowledge","article"]),
  manager:new Set(["overview","incidents","my-incidents","create-incident","incident","services","service","teams","team","sla","on-call","analytics","knowledge","article"]),
  administrator:new Set(["overview","incidents","my-incidents","create-incident","incident","services","service","teams","team","sla","on-call","analytics","knowledge","article","users","audit","settings"])
};
const ROLE_NAV_ITEMS = {
  employee:new Set(["Overview","My Incidents","Create Incident","Knowledge Base"]),
  engineer:new Set(["Overview","Incidents","My Incidents","Create Incident","Services","Teams","On-Call","Knowledge Base"]),
  manager:new Set(["Overview","Incidents","My Incidents","Create Incident","Services","Teams","SLA Management","On-Call","Analytics","Knowledge Base"]),
  administrator:new Set(Object.keys(ROUTES))
};

function currentRole(){return String(appState.authProfile?.role || "employee").toLowerCase();}
function roleDisplay(role=currentRole()){return role.split("_").map(p=>p.charAt(0).toUpperCase()+p.slice(1)).join(" ");}
function routeAllowed(route){return (ROLE_ALLOWED_ROUTES[currentRole()] || ROLE_ALLOWED_ROUTES.employee).has(route);}
function canManageIncidentUI(){return ["engineer","manager","administrator"].includes(currentRole());}
function canPrioritizeIncidentUI(){return ["manager","administrator"].includes(currentRole());}
function isAdminUI(){return currentRole()==="administrator";}
function setChromeMode(authMode){appShell.classList.toggle("auth-mode",Boolean(authMode));}
function formatBytes(bytes){const n=Number(bytes||0); if(n<1024) return `${n} B`; if(n<1048576) return `${(n/1024).toFixed(1)} KB`; return `${(n/1048576).toFixed(1)} MB`;}

function applyRoleNavigation(){
  const allowed=ROLE_NAV_ITEMS[currentRole()] || ROLE_NAV_ITEMS.employee;
  document.querySelectorAll(".nav-item").forEach(item=>{item.style.display=allowed.has(item.dataset.nav)?"":"none";});
  document.querySelectorAll(".nav-group").forEach(group=>{
    const visible=[...group.querySelectorAll(".nav-item")].some(item=>item.style.display!=="none");
    group.style.display=visible?"":"none";
  });
}

function updateProfileChrome(){
  const profile=appState.authProfile;
  if(!profile) return;
  const name=profile.full_name || "PulseOps User";
  const role=roleDisplay(profile.role);
  const avatarBtn=document.getElementById("avatarBtn");
  if(avatarBtn) avatarBtn.textContent=initials(name);
  const nameEl=document.querySelector(".profile-name");
  const roleEl=document.querySelector(".profile-role");
  if(nameEl) nameEl.textContent=name;
  if(roleEl) roleEl.textContent=role;
}

function renderAccessRestricted(){
  setChromeMode(false);
  appMain.innerHTML=`<div class="page-stack">${pageHeader("Access restricted","You do not have permission to view this page.",`<button class="btn-primary" data-route="overview">Return to Overview</button>`)}<div class="section-panel">${emptyState("This area is restricted","Your account role doesn't have access to this section. Contact your workspace administrator if you believe this is a mistake.")}</div></div>`;
}

function renderDataError(title,error){
  setChromeMode(false);
  appMain.innerHTML=`<div class="page-stack">${pageHeader(title,"PulseOps could not load this data.",`<button class="btn-secondary" data-route="overview">Overview</button><button class="btn-primary" id="retryRouteLoad">Retry</button>`)}<div class="error-banner">${esc(safeErrorMessage(error))}</div></div>`;
}

async function refreshCurrentIncident(){
  const id=appState.routeParam;
  if(appState.currentRoute!=="incident" || !id) return;
  try{
    const bundle=await window.PulseOpsAPI.getIncidentBundle(id);
    appState.incidentBundle=bundle;
    const idx=APP_DATA.incidents.findIndex(i=>i.id===bundle.incident.id);
    if(idx>=0) APP_DATA.incidents[idx]=bundle.incident; else APP_DATA.incidents.unshift(bundle.incident);
    if(appState.currentRoute==="incident" && appState.routeParam===id){appMain.innerHTML=renderIncidentDetails(id); runPostRender();}
  }catch(error){console.error("Incident refresh failed",error);}
}

function setupRouteRealtime(){
  if(!window.PulseOpsRealtime) return;
  window.PulseOpsRealtime.unsubscribe("active-incident");
  if(appState.currentRoute==="incident" && appState.incidentBundle?.incident?.uuid){
    const refresh=()=>{clearTimeout(appState.realtimeRefreshTimer); appState.realtimeRefreshTimer=setTimeout(refreshCurrentIncident,180);};
    window.PulseOpsRealtime.subscribeToIncident(appState.incidentBundle.incident.uuid,{incident:refresh,activity:refresh,comments:refresh,attachments:refresh});
  }
}

function renderDeveloperSetup(errorText=""){
  setChromeMode(true);
  document.querySelectorAll(".nav-item").forEach(item=>item.classList.remove("active"));
  appMain.innerHTML = `<div class="auth-wrap"><section class="auth-card"><svg class="brand-mark" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="7" fill="#2F6BFF"/><path d="M5 12.5H8.2L10 8L13.2 17L15 12.5H19" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><h1 class="auth-title">Backend connection required</h1><p class="auth-copy">PulseOps needs to be connected to your organization's backend before it can run. Add your project URL and publishable key to <code>supabase-config.js</code>, then apply the database migrations in order.</p>${errorText?`<div class="error-banner">${esc(errorText)}</div>`:""}<div class="setup-list"><code>cp supabase-config.example.js supabase-config.js</code><code>supabaseUrl: "https://YOUR_PROJECT.supabase.co"</code><code>supabasePublishableKey: "YOUR_PUBLISHABLE_KEY"</code></div><p class="auth-copy" style="margin-top:12px;">For authentication redirects and reliable browser behavior, run PulseOps from a local HTTP server rather than opening the file directly.</p><button class="btn-primary" id="retryConfigBtn" style="justify-content:center;width:100%;">Retry connection</button></section></div>`;
}

function renderLogin(errorText=""){
  setChromeMode(true);
  document.querySelectorAll(".nav-item").forEach(item=>item.classList.remove("active"));
  appMain.innerHTML = `<div class="auth-wrap"><form class="auth-card" id="loginForm"><svg class="brand-mark" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="7" fill="#2F6BFF"/><path d="M5 12.5H8.2L10 8L13.2 17L15 12.5H19" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><h1 class="auth-title">Sign in to PulseOps</h1><p class="auth-copy">Use your company PulseOps account.</p>${errorText?`<div class="error-banner">${esc(errorText)}</div>`:""}<div class="form-row"><label class="form-label" for="loginEmail">Email</label><input class="form-input" id="loginEmail" type="email" autocomplete="email" required></div><div class="form-row"><label class="form-label" for="loginPassword">Password</label><input class="form-input" id="loginPassword" type="password" autocomplete="current-password" required></div><div class="modal-foot" style="padding:0;margin-top:16px;border-top:none;"><button type="button" class="btn-secondary" id="resetPasswordBtn">Forgot Password</button><button type="submit" class="btn-primary">Sign In</button></div></form></div>`;
}

function renderDisabledAccount(){
  setChromeMode(true);
  appMain.innerHTML = `<div class="auth-wrap"><section class="auth-card"><h1 class="auth-title">Your PulseOps account has been disabled.</h1><p class="auth-copy">Contact your administrator to restore access.</p><button class="btn-secondary" id="disabledSignOut">Sign Out</button></section></div>`;
}

function renderPasswordRecovery(errorText=""){
  setChromeMode(true);
  if(appState.recoveryInvalid){
    appMain.innerHTML=`<div class="auth-wrap"><section class="auth-card"><svg class="brand-mark" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="7" fill="#2F6BFF"/><path d="M5 12.5H8.2L10 8L13.2 17L15 12.5H19" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><h1 class="auth-title">Password reset link expired</h1><p class="auth-copy">This reset link is no longer valid. Return to sign in and request a new password reset email.</p>${errorText?`<div class="error-banner">${esc(errorText)}</div>`:""}<button class="btn-primary" id="recoveryBackToLogin" style="width:100%;justify-content:center;">Back to Sign In</button></section></div>`;
    return;
  }
  appMain.innerHTML=`<div class="auth-wrap"><form class="auth-card" id="recoveryForm"><svg class="brand-mark" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="7" fill="#2F6BFF"/><path d="M5 12.5H8.2L10 8L13.2 17L15 12.5H19" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><h1 class="auth-title">Set a new password</h1><p class="auth-copy">Choose a new password with at least 8 characters. Use a password different from your current one.</p>${errorText?`<div class="error-banner">${esc(errorText)}</div>`:""}<div class="form-row"><label class="form-label" for="recoveryPassword">New password</label><input class="form-input" id="recoveryPassword" type="password" autocomplete="new-password" minlength="8" required></div><div class="form-row"><label class="form-label" for="recoveryConfirm">Confirm password</label><input class="form-input" id="recoveryConfirm" type="password" autocomplete="new-password" minlength="8" required></div><button class="btn-primary" id="recoverySubmitBtn" type="submit" style="width:100%;justify-content:center;">Update Password</button></form></div>`;
}

function renderLoadingShell(){
  setChromeMode(false);
  appMain.innerHTML = `<div class="page-stack"><div class="page-header"><div><div class="loading-skeleton" style="width:160px;margin-bottom:12px;"></div><div class="loading-skeleton" style="width:260px;"></div></div></div><div class="metrics-grid">${[1,2,3,4].map(()=>`<div class="metric-card"><div class="loading-skeleton"></div><div class="loading-skeleton" style="width:60%;margin-top:14px;height:24px;"></div></div>`).join("")}</div><div class="section-panel">${[1,2,3,4,5].map(()=>`<div class="loading-skeleton" style="margin-bottom:12px;"></div>`).join("")}</div></div>`;
}

function updateActiveNav(){
  applyRoleNavigation();
  const nav = NAV_BY_ROUTE[appState.currentRoute] || "Overview";
  document.querySelectorAll(".nav-item").forEach(item=>item.classList.toggle("active", item.dataset.nav===nav && item.style.display!=="none"));
}

async function renderPage(){
  if (!appState.backendReady) { renderDeveloperSetup(appState.authError); return; }
  if (appState.recoveryMode) { renderPasswordRecovery(appState.authError); return; }
  if (!appState.authSession) { renderLogin(appState.authError); return; }
  if (appState.authProfile && appState.authProfile.status === "disabled") { renderDisabledAccount(); return; }

  setChromeMode(false);
  const parsed = parseHash();
  appState.currentRoute = parsed.route;
  appState.routeParam = parsed.param;

  if(!routeAllowed(parsed.route)){renderAccessRestricted(); updateActiveNav(); return;}

  try{
    if(parsed.route==="incident" && parsed.param){
      if(!appState.incidentBundle || appState.incidentBundle.incident.id!==parsed.param){
        renderLoadingShell();
        const bundle=await window.PulseOpsAPI.getIncidentBundle(parsed.param);
        appState.incidentBundle=bundle;
        const idx=APP_DATA.incidents.findIndex(i=>i.id===bundle.incident.id);
        if(idx>=0) APP_DATA.incidents[idx]=bundle.incident; else APP_DATA.incidents.unshift(bundle.incident);
      }
    } else {
      appState.incidentBundle=null;
    }

    if(parsed.route==="article" && parsed.param){
      if(!appState.articleDetail || appState.articleDetail.id!==parsed.param){
        renderLoadingShell();
        appState.articleDetail=await window.PulseOpsAPI.getKnowledgeArticle(parsed.param);
      }
    } else appState.articleDetail=null;
  }catch(error){
    console.error("Route data load failed",error);
    renderDataError(parsed.route==="incident"?"Incident unavailable":"Unable to load page",error);
    return;
  }

  updateActiveNav();
  closeAllDropdowns();
  if (window.innerWidth <= 860) appShell.classList.remove("mobile-nav-open");
  const renderers = {overview:renderOverview,incidents:renderIncidents,"my-incidents":renderMyIncidents,"create-incident":renderCreateIncident,incident:()=>renderIncidentDetails(parsed.param),services:renderServices,service:()=>renderServiceDetails(parsed.param),teams:renderTeams,team:()=>renderTeamDetails(parsed.param),sla:renderSLA,"on-call":renderOnCall,analytics:renderAnalytics,knowledge:renderKnowledgeBase,article:()=>renderKnowledgeArticle(parsed.param),users:renderUsers,audit:renderAuditLogs,settings:renderSettings};
  appMain.innerHTML = (renderers[parsed.route] || renderOverview)();
  runPostRender();
  setupRouteRealtime();
}

function dashboardRange(){
  const days=Number(appState.dashboardRangeDays||30);
  const end=new Date(); end.setHours(23,59,59,999);
  const start=new Date(end); start.setDate(end.getDate()-Math.max(0,days-1)); start.setHours(0,0,0,0);
  return {days,start,end};
}
function isSameLocalDay(value,day=new Date()){
  if(!value) return false;
  const d=new Date(value);
  return d.getFullYear()===day.getFullYear() && d.getMonth()===day.getMonth() && d.getDate()===day.getDate();
}
function slaComplianceValue(){
  const completed=APP_DATA.incidents.filter(i=>i.resolvedAt && i.resolutionSlaDeadline);
  if(!completed.length) return 100;
  const met=completed.filter(i=>new Date(i.resolvedAt).getTime()<=new Date(i.resolutionSlaDeadline).getTime()).length;
  return Math.round((met/completed.length)*1000)/10;
}
function renderOverview(){
  const {days,start,end}=dashboardRange();
  const open=APP_DATA.incidents.filter(i=>!["resolved","closed"].includes(i.statusValue));
  const period=APP_DATA.incidents.filter(i=>i.createdAt && new Date(i.createdAt)>=start && new Date(i.createdAt)<=end);
  const resolvedToday=APP_DATA.incidents.filter(i=>["resolved","closed"].includes(i.statusValue) && isSameLocalDay(i.resolvedAt||i.updatedAt)).length;
  const compliance=slaComplianceValue();
  const rangeLabel=`${start.toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"})} – ${end.toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"})}`;
  const rangeOptions=[[7,"Last 7 days"],[30,"Last 30 days"],[90,"Last 90 days"]];
  const breakdown={
    infrastructure:period.filter(i=>["Networking","Database","Infrastructure"].includes(i.category)).length,
    applications:period.filter(i=>["Applications","Payment Systems","SaaS"].includes(i.category)).length,
    security:period.filter(i=>["Security","Authentication"].includes(i.category)).length
  };
  const distSource=period.length?period:APP_DATA.incidents;
  return `<div class="dash-header"><h1 class="dash-title">Dashboard</h1><div class="dash-controls"><div class="dropdown-anchor"><button class="control-btn" id="dateRangeBtn"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="16" rx="2"/><path d="M3.5 9.5h17M8 3v3M16 3v3"/></svg><span>${esc(rangeLabel)}</span><svg class="chev" viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></button><div class="dropdown" id="dateDropdown" style="width:170px;padding:6px;">${rangeOptions.map(([value,label])=>`<div class="cmdk-item ${days===value?"selected":""}" data-range-days="${value}">${label}</div>`).join("")}<div class="cmdk-item ${days===120?"selected":""}" data-range-days="120">Last 120 days</div></div></div><button class="control-btn" id="customizeBtn">Customize</button><button class="btn-primary" id="newIncidentBtn">${plusIcon()}New Incident</button></div></div>
  <div class="kpi-grid">${renderKpi("OPEN INCIDENTS",open.length,"blue","neutral","LIVE","current accessible scope")}${renderKpi("CRITICAL INCIDENTS",open.filter(i=>i.priority==="p1").length,"red","neutral","LIVE","current accessible scope")}${renderKpi("SLA AT RISK",open.filter(i=>i.atRisk).length,"amber","neutral","LIVE","deadline based")}${renderKpi("RESOLVED TODAY",resolvedToday,"green","neutral","TODAY",new Date().toLocaleDateString())}</div>
  <div class="main-grid"><div class="col-left"><div class="panel"><div class="panel-head"><span class="panel-title">Incident Activity</span><button class="panel-more" title="Refresh dashboard" data-dashboard-refresh><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="5.5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="18.5" r="1"/></svg></button></div><div class="activity-body"><div class="activity-metric"><div class="activity-big">${period.length}</div><div class="activity-caption">Created in selected period</div><div class="activity-delta"><span class="delta-caption">Live data · ${days} days</span></div></div><div class="chart-wrap"><div class="chart-legend"><span class="legend-item"><span class="legend-dot created"></span>Created</span><span class="legend-item"><span class="legend-dot resolved"></span>Resolved</span></div><svg id="activityChart" viewBox="0 0 560 150" width="100%" height="150" style="overflow:visible;"></svg></div></div><div class="breakdown"><div class="breakdown-item"><div class="breakdown-top"><div class="breakdown-icon" style="background:var(--primary-pale)"></div><div><div class="breakdown-num">${breakdown.infrastructure}</div><div class="breakdown-label">Infrastructure</div></div></div><div class="breakdown-bar"><div class="breakdown-bar-fill" style="width:${period.length?Math.max(4,Math.round(breakdown.infrastructure/period.length*100)):0}%;background:var(--primary)"></div></div></div><div class="breakdown-item"><div class="breakdown-top"><div class="breakdown-icon" style="background:var(--success-pale)"></div><div><div class="breakdown-num">${breakdown.applications}</div><div class="breakdown-label">Applications</div></div></div><div class="breakdown-bar"><div class="breakdown-bar-fill" style="width:${period.length?Math.max(4,Math.round(breakdown.applications/period.length*100)):0}%;background:var(--success)"></div></div></div><div class="breakdown-item"><div class="breakdown-top"><div class="breakdown-icon" style="background:var(--warning-pale)"></div><div><div class="breakdown-num">${breakdown.security}</div><div class="breakdown-label">Security</div></div></div><div class="breakdown-bar"><div class="breakdown-bar-fill" style="width:${period.length?Math.max(4,Math.round(breakdown.security/period.length*100)):0}%;background:var(--warning)"></div></div></div></div></div><div class="panel"><div class="panel-head"><span class="panel-title">Active Incidents</span><button class="panel-more" title="View incident list" data-route="incidents"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="5.5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="18.5" r="1"/></svg></button></div>${open.length?renderCompactIncidentTable(open.slice(0,5)):emptyState("No active incidents","Everything in your access scope is resolved or closed.")}<div class="table-footer"><span>Showing ${Math.min(5,open.length)} of ${open.length} open incidents</span><span>Updated live</span></div></div></div>
  <div class="col-right"><div class="panel"><div class="panel-head"><span class="panel-title">Priority Distribution</span><button class="panel-more" title="Open analytics" data-route="analytics"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="5.5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="18.5" r="1"/></svg></button></div><div class="priority-bars" id="priorityBars">${["p1","p2","p3","p4"].map((priority,i)=>{const count=distSource.filter(x=>x.priority===priority).length;const max=Math.max(1,...["p1","p2","p3","p4"].map(p=>distSource.filter(x=>x.priority===p).length));return `<div class="p-bar-col"><span class="p-bar-num">${count}</span><div class="p-bar ${priority==="p1"?"emphasis":""}" data-h="${Math.max(16,Math.round((count/max)*90))}" style="height:0"></div><span class="p-bar-label">P${i+1}</span></div>`;}).join("")}</div></div><div class="panel"><div class="panel-head"><span class="panel-title">SLA Compliance</span><button class="panel-more" data-route="sla" title="Open SLA management"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="5.5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="18.5" r="1"/></svg></button></div><div class="sla-gauge-wrap"><div class="sla-gauge-arc"><svg viewBox="0 0 200 110" width="180" height="99"><path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="var(--bg)" stroke-width="14" stroke-linecap="round"/><path id="slaArc" data-compliance="${compliance}" d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="url(#slaGrad)" stroke-width="14" stroke-linecap="round" stroke-dasharray="251.3" stroke-dashoffset="251.3"/><defs><linearGradient id="slaGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#2DBE78"/><stop offset="100%" stop-color="#22A868"/></linearGradient></defs></svg><div class="sla-value">${compliance.toFixed(1)}%</div></div><div class="sla-sub">Resolved incidents within resolution SLA</div><button class="sla-btn" data-route="sla">View details</button></div></div><div class="ai-panel"><div class="ai-orb"></div><div class="ai-head"><svg class="ai-sparkle" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/><circle cx="12" cy="12" r="2.3"/></svg><span class="ai-title">Pulse AI</span></div><div class="ai-text">Pulse AI is coming soon and will surface automated insights across your workspace here.</div><div class="ai-suggested-label">SYSTEM STATUS</div><div class="ai-suggested-text">${appState.backendWarnings.length?`${appState.backendWarnings.length} data warning(s) need attention`:`All systems connected`}</div><button class="ai-btn" id="reviewIncidentsBtn">Review critical incidents</button><div class="health-list">${APP_DATA.services.slice(0,4).map(s=>`<div class="health-row" data-route="service" data-param="${s.id}"><span class="health-name">${esc(s.name)}</span><span class="health-status"><span class="health-dot ${s.health==="Operational"?"op":s.health==="Major Incident"?"major":"deg"}"></span>${esc(s.health)}</span></div>`).join("")}</div></div></div></div>`;
}
function renderKpi(label,value,color,deltaClass,delta,caption){return `<div class="kpi-card"><div class="kpi-top"><span class="kpi-label">${label}</span><div class="kpi-icon ${color}"></div></div><div class="kpi-value">${value}</div><div class="kpi-delta"><span class="delta-pill ${deltaClass}">${delta}</span><span class="delta-caption">${caption}</span></div></div>`;}

function selectFilter(id,label,options,value,labeler=v=>v){return `<select class="form-select" id="${id}" aria-label="${label}"><option value="">${label}</option>${options.map(o=>`<option value="${esc(o)}" ${String(value)===String(o)?"selected":""}>${esc(labeler(o))}</option>`).join("")}</select>`;}
function renderIncidents(){
  const f=appState.incidentFilters, rows=getFilteredIncidents(), pages=Math.max(1,Math.ceil(rows.length/f.pageSize)); f.page=Math.min(f.page,pages);
  const start=(f.page-1)*f.pageSize, pageRows=rows.slice(start,start+f.pageSize);
  const me=appState.authProfile?.id;
  const counts={All:APP_DATA.incidents.length,Open:APP_DATA.incidents.filter(i=>!["Resolved","Closed"].includes(i.status)).length,Critical:APP_DATA.incidents.filter(i=>i.priority==="p1").length,"My Incidents":APP_DATA.incidents.filter(i=>currentRole()==="employee"?i.reporterId===me:i.assigneeId===me).length,Unassigned:APP_DATA.incidents.filter(i=>i.assignee==="Unassigned").length,"SLA At Risk":APP_DATA.incidents.filter(i=>i.atRisk).length,Resolved:APP_DATA.incidents.filter(i=>["Resolved","Closed"].includes(i.status)).length};
  const views=["All","Open","Critical","My Incidents","Unassigned","SLA At Risk","Resolved"];
  return `<div class="page-stack">${pageHeader("Incidents","Track and manage operational incidents across your organization.",`<button class="btn-secondary" id="exportIncidentsBtn">Export CSV</button><button class="btn-primary" id="newIncidentBtn">${plusIcon()}New Incident</button>`)}<div class="tab-row">${views.map(v=>`<button class="tab-btn ${f.view===v?"active":""}" data-incident-view="${v}">${v}<span class="tab-count">${counts[v]}</span></button>`).join("")}</div><div class="section-panel"><div class="filter-bar"><div class="input-wrap">${iconSearch()}<input class="form-input" id="incidentSearch" placeholder="Search incidents..." value="${esc(f.query)}"></div>${selectFilter("incidentStatus","Status",["Open","Acknowledged","Investigating","In Progress","Waiting","Monitoring","Resolved","Closed"],f.status)}${selectFilter("incidentPriority","Priority",["p1","p2","p3","p4"],f.priority,v=>PRIORITY_LABELS[v])}${selectFilter("incidentService","Service",unique(APP_DATA.incidents,"service"),f.service)}${selectFilter("incidentTeam","Team",unique(APP_DATA.incidents,"team"),f.team)}${selectFilter("incidentAssignee","Assignee",unique(APP_DATA.incidents,"assignee"),f.assignee)}${selectFilter("incidentDate","Date",["Today","Last 7 days","Last 30 days"],f.date)}<button class="btn-secondary" data-toast="Advanced filters opened">More Filters</button><button class="btn-ghost" id="resetIncidentFilters">Reset</button></div></div><div class="section-panel">${rows.length?renderIncidentTable(pageRows)+renderPagination(rows.length,start,pageRows.length,pages,f.page):emptyState("No incidents match these filters.","Clear filters or widen the date range.",`<button class="btn-secondary" id="resetIncidentFilters">Clear filters</button>`)}</div></div>`;
}
function renderIncidentTable(rows){return `<div class="table-wrap"><table class="data-table"><thead><tr><th><input class="table-check" type="checkbox"></th>${["ID","Incident","Priority","Status","Service","Assignee","Team","Created","Updated","SLA"].map(h=>`<th class="sortable" data-sort="${h==="Incident"?"title":h==="Created"?"createdOrder":h.toLowerCase()}">${h}</th>`).join("")}<th>Actions</th></tr></thead><tbody>${rows.map(i=>`<tr data-incident-preview="${i.id}"><td><input class="table-check incident-select" type="checkbox" data-id="${i.id}" ${appState.incidentFilters.selected.has(i.id)?"checked":""}></td><td class="incident-id">${i.id}</td><td><div class="table-main">${esc(i.title)}</div><div class="table-sub">${esc(i.desc)}</div></td><td>${priorityBadge(i.priority)}</td><td>${statusBadge(i.status)}</td><td>${esc(i.service)}</td><td><div class="person-cell">${avatar(i.assignee)}${esc(i.assignee)}</div></td><td>${esc(i.team)}</td><td class="mono">${esc(i.created)}</td><td class="mono">${esc(i.updated)}</td><td class="sla-cell ${i.slaClass}">${esc(i.sla)}</td><td><button class="icon-only" title="Copy incident link" data-copy="${i.id}"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1"/></svg></button></td></tr>`).join("")}</tbody></table></div>`;}
function renderPagination(total,start,count,pages,page){return `<div class="pagination"><span>Showing ${start+1}-${start+count} of ${total} incidents</span><div class="pagination-actions"><button class="btn-secondary" id="prevIncPage" ${page<=1?"disabled":""}>Previous</button><button class="btn-secondary" id="nextIncPage" ${page>=pages?"disabled":""}>Next</button></div></div>`;}

function getFilteredIncidents(){
  const f=appState.incidentFilters;
  let rows=[...APP_DATA.incidents];
  const me=appState.authProfile?.id;

  if(f.view==="Open") rows=rows.filter(i=>!["Resolved","Closed"].includes(i.status));
  if(f.view==="Critical") rows=rows.filter(i=>i.priority==="p1");
  if(f.view==="My Incidents") rows=rows.filter(i=>currentRole()==="employee"?i.reporterId===me:i.assigneeId===me);
  if(f.view==="Unassigned") rows=rows.filter(i=>i.assignee==="Unassigned");
  if(f.view==="SLA At Risk") rows=rows.filter(i=>i.atRisk);
  if(f.view==="Resolved") rows=rows.filter(i=>["Resolved","Closed"].includes(i.status));

  if(f.query){
    const q=f.query.toLowerCase();
    rows=rows.filter(i=>[i.id,i.title,i.desc,i.service,i.assignee,i.team,i.reporter].some(v=>String(v||"").toLowerCase().includes(q)));
  }
  if(f.status) rows=rows.filter(i=>i.status===f.status);
  if(f.priority) rows=rows.filter(i=>i.priority===f.priority);
  if(f.service) rows=rows.filter(i=>i.service===f.service);
  if(f.team) rows=rows.filter(i=>i.team===f.team);
  if(f.assignee) rows=rows.filter(i=>i.assignee===f.assignee);

  if(f.date){
    const now=new Date();
    let start=null;
    if(f.date==="Today"){start=new Date(now);start.setHours(0,0,0,0);}
    if(f.date==="Last 7 days"){start=new Date(now);start.setDate(now.getDate()-6);start.setHours(0,0,0,0);}
    if(f.date==="Last 30 days"){start=new Date(now);start.setDate(now.getDate()-29);start.setHours(0,0,0,0);}
    if(start) rows=rows.filter(i=>i.createdAt && new Date(i.createdAt)>=start);
  }

  const dir=f.dir==="asc"?1:-1;
  rows.sort((a,b)=>{
    let av=a[f.sort],bv=b[f.sort];
    if(f.sort==="priority"){av=["p1","p2","p3","p4"].indexOf(a.priority);bv=["p1","p2","p3","p4"].indexOf(b.priority);}
    if(f.sort==="createdOrder"){av=a.createdAt?new Date(a.createdAt).getTime():0;bv=b.createdAt?new Date(b.createdAt).getTime():0;}
    if(typeof av==="string") return av.localeCompare(String(bv||""))*dir;
    return ((av||0)-(bv||0))*dir;
  });
  return rows;
}

function renderCompactIncidentTable(rows){
  if(!rows.length) return emptyState("No incidents","No incident records are available in your current scope.");
  return `<div class="table-wrap"><table class="incident-table"><thead><tr><th>ID</th><th>Incident</th><th>Priority</th><th>Service</th><th>Assignee</th><th>SLA</th></tr></thead><tbody>${rows.map(i=>`<tr data-incident-preview="${esc(i.id)}"><td class="incident-id">${esc(i.id)}</td><td class="incident-name">${esc(i.title)}</td><td>${priorityBadge(i.priority)}</td><td>${esc(i.service)}</td><td><div class="assignee-cell">${avatar(i.assignee)}${esc(i.assignee)}</div></td><td class="sla-cell ${i.slaClass}">${esc(i.sla)}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderMyIncidents(){
  const me=appState.authProfile?.id;
  const employee=currentRole()==="employee";
  let assigned=APP_DATA.incidents.filter(i=>employee?i.reporterId===me:i.assigneeId===me);
  const tabs=["Needs Attention","In Progress","Waiting","Monitoring","Recently Resolved"];
  const predicates={
    "Needs Attention":i=>!["Resolved","Closed"].includes(i.status)&&(i.atRisk||i.priority==="p1"),
    "In Progress":i=>["Acknowledged","Investigating","In Progress"].includes(i.status),
    Waiting:i=>i.status==="Waiting",
    Monitoring:i=>i.status==="Monitoring",
    "Recently Resolved":i=>["Resolved","Closed"].includes(i.status)
  };
  const visible=assigned.filter(predicates[appState.myTab]||(()=>true));
  const open=assigned.filter(i=>!["Resolved","Closed"].includes(i.status));
  return `<div class="page-stack">${pageHeader(employee?"My Reported Incidents":"My Incidents",employee?"Issues you reported and their current resolution status.":"Your assigned operational work and active response queue.",`<button class="btn-primary" id="newIncidentBtn">${plusIcon()}New Incident</button>`)}<div class="metrics-grid">${metric(employee?"Reported":"Assigned",open.length,"Open work items")}${metric("Critical",open.filter(i=>i.priority==="p1").length,"Immediate review")}${metric("SLA At Risk",open.filter(i=>i.atRisk).length,"Needs action")}${metric("Resolved",assigned.filter(i=>["Resolved","Closed"].includes(i.status)).length,"Visible history")}</div><div class="tab-row">${tabs.map(t=>`<button class="tab-btn ${appState.myTab===t?"active":""}" data-my-tab="${t}">${t}</button>`).join("")}</div><div class="section-panel">${visible.length?renderCompactIncidentTable(visible.slice(0,20)):emptyState("Nothing in this view","There are no incidents matching this work state.")}</div></div>`;
}

function formSelect(id,label,options){return `<div><label class="form-label">${label}</label><select class="form-select" id="${id}">${options.map(o=>`<option>${esc(o)}</option>`).join("")}</select></div>`;}
function renderCreateIncident(){
  appState.triage={status:"idle",data:null,error:null};
  return `<div class="page-stack">${pageHeader("Create Incident","Report an operational issue or service disruption.",`<button class="btn-secondary" data-route="my-incidents">Cancel</button>`)}<div class="create-grid"><form class="section-panel" id="createIncidentForm"><div class="form-grid"><div class="span-2"><label class="form-label" for="ciTitle">Incident title</label><input class="form-input" id="ciTitle" required minlength="4" placeholder="e.g. Checkout returning 503 errors"></div><div class="span-2"><label class="form-label" for="ciDesc">Description</label><textarea class="form-textarea" id="ciDesc" required placeholder="Describe what's happening, when it started, and who's affected"></textarea></div>${formSelect("ciService","Affected service",APP_DATA.services.map(s=>s.name))}${formSelect("ciCategory","Category",["Payment Systems","Networking","Authentication","Applications","Database","Security","Hardware"])}${formSelect("ciAffected","Affected users",["Single user","Small group","Department","Organization-wide","Customers"])}${formSelect("ciImpact","Impact",["Low productivity impact","Internal service degradation","Customer-facing degradation","Revenue impacting outage"])}${formSelect("ciUrgency","Urgency",["Low","Medium","High","Critical"])}${formSelect("ciEnvironment","Environment",["Production","Staging","Development","SaaS"])}<div><label class="form-label" for="ciLocation">Location</label><input class="form-input" id="ciLocation" placeholder="EU & UK regions"></div><div><label class="form-label">Reporter</label><input class="form-input" value="${esc(APP_DATA.currentUser.name)}" disabled></div><div class="span-2"><label class="form-label" for="ciAttachment">Attachment (optional)</label><input class="form-input" id="ciAttachment" type="file" accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.log"><div class="form-help">Stored securely · maximum 10 MB.</div></div></div><div class="modal-foot" style="padding-left:0;padding-right:0;margin-top:14px;"><button type="button" class="btn-secondary" data-route="my-incidents">Cancel</button><button type="submit" class="btn-primary">Create Incident</button></div></form><aside class="section-panel triage-panel"><div class="section-head"><div><div class="section-title">Pulse AI Triage</div><div class="section-note">AI-assisted suggestions based on the details you enter below.</div></div></div><button type="button" class="btn-secondary" id="getTriageBtn" style="width:100%;justify-content:center;margin-bottom:12px;">Get AI Suggestion</button><div id="triageBox">${renderTriage()}</div><button class="btn-secondary" id="applyTriage" style="width:100%;justify-content:center;margin-top:14px;">Apply Suggestions</button></aside></div></div>`;
}

function renderTriage(){
  const t=appState.triage||{status:"idle"};
  if(t.status==="loading") return `<div class="suggestion-box"><div class="table-sub">Analyzing incident details...</div></div>`;
  if(t.status==="error") return `<div class="suggestion-box"><div class="error-banner">${esc(t.error||"AI triage could not analyze this incident.")}</div></div>`;
  if(t.status==="ready" && t.data){
    const d=t.data;
    const confidence=Math.max(0,Math.min(100,Number(d.confidence||0)));
    return `<div class="suggestion-box"><div class="suggestion-row"><span class="suggestion-label">Suggested Priority</span><span class="suggestion-value">${esc(PRIORITY_LABELS[d.priority]||d.priority)}</span></div><div class="suggestion-row"><span class="suggestion-label">Suggested Team</span><span class="suggestion-value">${esc(d.suggestedTeam||"Unassigned")}</span></div><div class="suggestion-row"><span class="suggestion-label">Category</span><span class="suggestion-value">${esc(d.category)}</span></div><div class="suggestion-row"><span class="suggestion-label">Confidence</span><span class="suggestion-value">${confidence}%</span></div><div class="confidence-bar"><div class="confidence-fill" style="width:${confidence}%"></div></div><div class="table-sub">${esc(d.rationale||"")}</div></div>`;
  }
  return `<div class="suggestion-box"><div class="table-sub">Add a title and description, then click "Get AI Suggestion" above for a priority, category and team recommendation.</div></div>`;
}
async function createIncident(v){
  if (!appState.backendReady || !window.PulseOpsAPI) {showToast("Not connected to the backend. Incident was not created.","error"); return false;}
  const service=APP_DATA.services.find(s=>s.name===v.service) || APP_DATA.services[0];
  const team=APP_DATA.teams.find(t=>t.name===v.team || t.name===service?.owner);
  const priority=v.priority || (v.urgency==="Critical"?"p1":v.urgency==="High"?"p2":v.urgency==="Medium"?"p3":"p4");
  if(!v.title || v.title.trim().length<4){showToast("Enter a clear incident title before creating.","warning"); return false;}

  let created;
  try{
    created=await window.PulseOpsAPI.createIncident({...v,priority,serviceId:service?.uuid||service?.id||null,teamId:team?.uuid||team?.id||null,environment:String(v.environment||service?.environmentValue||"production").toLowerCase().replace(/\s+/g,"_")});
  }catch(error){
    console.error("Create incident failed",error); showToast(safeErrorMessage(error),"error"); return false;
  }

  // The incident row itself is now saved. The attachment upload and the
  // dashboard refresh below are best-effort follow-ups — a failure there
  // must never be reported as if the incident wasn't created.
  let toastMessage=`Incident ${created.id} created successfully`, toastType="success";
  if(v.file){
    try{
      await window.PulseOpsStorage.uploadIncidentAttachment(appState.authProfile.organization_id,created.uuid,v.file);
    }catch(error){
      console.error("Attachment upload during incident creation failed",error);
      toastMessage=`Incident ${created.id} was created, but the attachment failed to upload: ${safeErrorMessage(error)}`;
      toastType="warning";
    }
  }
  try{
    await loadBackendData({showLoading:false});
  }catch(error){
    console.error("Post-create refresh failed (the incident itself was saved):",error);
  }
  showToast(toastMessage,toastType);
  navigate("incident",created.id);
  return true;
}

function renderIncidentDetails(id){
  const bundle=appState.incidentBundle;
  const i=(bundle && bundle.incident.id===id)?bundle.incident:incidentById(id);
  if(!i) return `<div class="page-stack">${pageHeader("Incident not found","This incident is unavailable or outside your access scope.",`<button class="btn-primary" data-route="my-incidents">Back</button>`)}</div>`;
  const activity=bundle?.activity||[];
  const comments=bundle?.comments||[];
  const attachments=bundle?.attachments||[];
  const relations=bundle?.relations||[];
  const manage=canManageIncidentUI();
  const internalAllowed=currentRole()!=="employee";
  if(appState.incidentTab==="internal" && !internalAllowed) appState.incidentTab="comments";
  const tabRows=appState.incidentTab==="activity"?activity:comments.filter(c=>appState.incidentTab==="internal"?c.visibility==="internal":c.visibility==="public");
  const actionButtons=manage?`<button class="btn-secondary" data-incident-action="acknowledge" data-incident-id="${i.id}">Acknowledge</button><button class="btn-secondary" data-incident-action="assign" data-incident-id="${i.id}">Assign</button><button class="btn-secondary" data-incident-action="status" data-incident-id="${i.id}">Change Status</button>${canPrioritizeIncidentUI()?`<button class="btn-secondary" data-incident-action="priority" data-incident-id="${i.id}">Priority</button>`:""}`:"";
  const impactItems=[i.affectedUsers||"Impact scope not specified",i.impact||"Impact not specified",i.location||"Location not specified",i.environment||"Environment not specified"];
  const activityContent=appState.incidentTab==="activity"?`<div class="timeline">${activity.length?activity.map(a=>`<div class="timeline-row"><span class="timeline-time">${esc(a.time)}</span><span class="timeline-dot"></span><span class="timeline-text">${esc(a.text)}</span></div>`).join(""):emptyState("No activity yet","Operational changes will appear here automatically.")}</div>`:`<div class="comment-stack">${tabRows.length?tabRows.map(c=>`<div class="comment-card"><div class="comment-meta"><strong>${esc(c.author)}</strong><span>${esc(c.time)}</span></div><div>${esc(c.body)}</div></div>`).join(""):emptyState(appState.incidentTab==="internal"?"No internal notes":"No comments","Add the first update to this incident.")}${canManageIncidentUI()||appState.incidentTab==="comments"?`<form id="incidentCommentForm" class="comment-composer"><textarea class="form-textarea" id="incidentCommentBody" required placeholder="${appState.incidentTab==="internal"?"Add an internal engineering note...":"Add a comment..."}"></textarea><button class="btn-primary" type="submit">Add ${appState.incidentTab==="internal"?"Internal Note":"Comment"}</button></form>`:""}</div>`;
  return `<div class="page-stack">${pageHeader(i.id,`Reported: ${esc(i.created)} | Reporter: ${esc(i.reporter)}`,actionButtons,`<button data-route="incidents">Incidents</button><span>/</span><span>${esc(i.id)}</span>`)}<div class="detail-title-row"><h1>${esc(i.title)}</h1>${priorityBadge(i.priority)}${statusBadge(i.status)}<span class="status-badge">${esc(i.service)}</span></div><div class="detail-layout"><div class="page-stack"><section class="section-panel"><div class="section-title">Description</div><p class="article-body" style="margin-top:8px;">${esc(i.desc)}</p></section><section class="section-panel"><div class="section-title">Impact</div><div class="impact-list" style="margin-top:12px;">${impactItems.map(x=>`<div class="impact-item">${esc(x)}</div>`).join("")}</div></section><section class="section-panel"><div class="section-head"><span class="section-title">Timeline</span><span class="section-note">Automatically tracked</span></div><div class="timeline">${i.timeline?.length?i.timeline.map(t=>`<div class="timeline-row"><span class="timeline-time">${esc(t[0])}</span><span class="timeline-dot"></span><span class="timeline-text">${esc(t[1])}</span></div>`).join(""):emptyState("No timeline events","Changes will appear here as the incident is worked.")}</div></section><section class="section-panel"><div class="tab-row"><button class="tab-btn ${appState.incidentTab==="activity"?"active":""}" data-incident-tab="activity">Activity</button><button class="tab-btn ${appState.incidentTab==="comments"?"active":""}" data-incident-tab="comments">Comments</button>${internalAllowed?`<button class="tab-btn ${appState.incidentTab==="internal"?"active":""}" data-incident-tab="internal">Internal Notes</button>`:""}</div><div style="margin-top:14px;">${activityContent}</div></section><section class="section-panel"><div class="section-head"><span class="section-title">Attachments</span><span class="section-note">Stored securely</span></div>${attachments.length?`<div class="related-list">${attachments.map(a=>`<div class="related-item"><div><div class="table-main">${esc(a.fileName)}</div><div class="table-sub">${formatBytes(a.sizeBytes)} · ${esc(a.uploadedBy)}</div></div><div style="display:flex;gap:6px;"><button class="btn-secondary" data-attachment-open="${a.id}">Open</button>${manage?`<button class="btn-danger" data-attachment-delete="${a.id}">Delete</button>`:""}</div></div>`).join("")}</div>`:emptyState("No attachments","Screenshots and logs uploaded to this incident will appear here.")}${manage||i.reporterId===appState.authProfile?.id?`<div class="form-row" style="margin-top:14px;"><input class="form-input" id="incidentAttachmentInput" type="file" accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.log"><button class="btn-secondary" id="uploadAttachmentBtn" style="margin-top:8px;">Upload Attachment</button></div>`:""}</section></div><aside class="page-stack"><section class="section-panel"><div class="section-title">People</div><div class="meta-grid"><div class="meta-card"><div class="meta-label">ASSIGNEE</div><div class="person-cell">${avatar(i.assignee)}${esc(i.assignee)}</div></div><div class="meta-card"><div class="meta-label">TEAM</div><div>${esc(i.team)}</div></div><div class="meta-card"><div class="meta-label">REPORTER</div><div>${esc(i.reporter)}</div></div></div></section><section class="section-panel"><div class="section-title">Incident</div><div class="meta-grid"><div class="meta-card"><div class="meta-label">PRIORITY</div>${priorityBadge(i.priority)}</div><div class="meta-card"><div class="meta-label">STATUS</div>${statusBadge(i.status)}</div><div class="meta-card"><div class="meta-label">CATEGORY</div><div>${esc(i.category||"Uncategorized")}</div></div><div class="meta-card"><div class="meta-label">SERVICE</div><div>${esc(i.service)}</div></div><div class="meta-card"><div class="meta-label">ENVIRONMENT</div><div>${esc(i.environment)}</div></div></div></section><section class="section-panel"><div class="section-title">SLA</div><div class="meta-card"><div class="meta-label">RESPONSE SLA</div><div class="table-main">${esc(i.acknowledgedAt?"Acknowledged":"Pending")}</div><div class="table-sub">${esc(i.responseSla||"n/a")}</div></div><div class="meta-card"><div class="meta-label">RESOLUTION SLA</div><div class="sla-cell ${i.slaClass}">${esc(i.sla.includes("left")?i.sla.replace("left","remaining"):i.sla)}</div></div><div class="meta-card"><div class="meta-label">DATES</div><div class="table-sub">Created ${esc(i.created)}<br>Updated ${esc(i.updated)}</div></div></section><section class="ai-panel"><div class="ai-head"><span class="ai-title">Pulse AI</span></div><div class="ai-text">Pulse AI is coming soon. Automated insights for this incident will appear here once it's enabled for your workspace.</div></section><section class="section-panel"><div class="section-title">Related Information</div><div class="related-list" style="margin-top:10px;">${relations.length?relations.map(r=>`<div class="related-item" data-route="incident" data-param="${esc(r.incidentNumber)}"><span>${esc(r.incidentNumber)} ${esc(r.title)}</span></div>`).join(""):""}${APP_DATA.knowledgeArticles.slice(0,2).map(a=>`<div class="related-item" data-route="article" data-param="${esc(a.id)}"><span>${esc(a.id)} ${esc(a.title)}</span></div>`).join("")}</div></section></aside></div></div>`;
}

function renderServices(){const canCreate=["manager","administrator"].includes(currentRole());return `<div class="page-stack">${pageHeader("Services","Monitor operational health and ownership across business services.",`<button class="btn-secondary" data-dashboard-refresh>Refresh status</button>${canCreate?`<button class="btn-primary" data-modal="service">${plusIcon()}New Service</button>`:""}`)}<div class="section-panel"><div class="filter-bar" style="grid-template-columns:minmax(220px,1.6fr) repeat(3,minmax(140px,1fr));"><div class="input-wrap">${iconSearch()}<input class="form-input" placeholder="Search services..."></div>${selectFilter("env","Environment",["Production","SaaS","Staging"],"")}${selectFilter("health","Health",["Operational","Degraded","Partial Outage","Major Incident"],"")}${selectFilter("owner","Owner",APP_DATA.teams.map(t=>t.name),"")}</div></div><div class="section-panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Service</th><th>Owner</th><th>Environment</th><th>Health</th><th>Availability</th><th>Open Incidents</th><th>Last Incident</th></tr></thead><tbody>${APP_DATA.services.map(s=>`<tr data-route="service" data-param="${esc(s.id)}"><td><div class="table-main">${esc(s.name)}</div><div class="table-sub">Business service</div></td><td>${esc(s.owner)}</td><td>${esc(s.environment)}</td><td>${healthBadge(s.health)}</td><td class="mono">${esc(s.availability)}</td><td>${Number(s.openIncidents||0)}</td><td class="incident-id">${esc(s.lastIncident)}</td></tr>`).join("")}</tbody></table></div></div></div>`;}
function renderServiceDetails(id){
  const s=serviceById(id);
  if(!s) return emptyState("Service unavailable","This service is outside your access scope.");
  const serviceUuid=s.uuid||s.id;
  const related=APP_DATA.incidents.filter(i=>i.serviceId===serviceUuid).slice(0,10);
  const deps=APP_DATA.dependencies.filter(d=>d.serviceId===serviceUuid);
  return `<div class="page-stack">${pageHeader(esc(s.name),`${esc(s.owner)} | ${esc(s.environment)}`,`<button class="btn-secondary" data-route="services">All Services</button>${["manager","administrator"].includes(currentRole())?`<button class="btn-secondary" data-modal="service" data-service="${esc(serviceUuid)}">Update Service</button>`:""}<button class="btn-primary" data-route="incidents">View Incidents</button>`,`<button data-route="services">Services</button><span>/</span><span>${esc(s.name)}</span>`)}<div class="metrics-grid">${metric("Health",s.health,"Current state")}${metric("Owner",s.owner,"Primary team")}${metric("Availability",s.availability,"Configured availability")}${metric("Open Incidents",s.openIncidents,"Visible active work")}</div><div class="detail-layout"><section class="section-panel"><div class="section-title">Recent Incidents</div><div style="margin-top:16px;">${related.length?renderCompactIncidentTable(related):emptyState("No visible incidents","No incidents for this service are visible in your current role scope.")}</div></section><aside class="section-panel"><div class="section-title">Dependencies</div><div class="dependency-chain" style="margin-top:14px;">${deps.length?deps.map((d,idx)=>`${idx?'<span class="dependency-arrow">↓</span>':''}<span class="dependency-node">${esc(d.dependency)}</span>`).join(""):emptyState("No dependencies","No service dependencies are recorded.")}</div></aside></div></div>`;
}

function renderTeams(){return `<div class="page-stack">${pageHeader("Teams","Operational ownership, workload, and on-call coverage.",isAdminUI()?`<button class="btn-primary" data-modal="team">${plusIcon()}New Team</button>`:"")}<div class="section-panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Team</th><th>Lead</th><th>Members</th><th>Open Incidents</th><th>Critical</th><th>On-Call</th><th>Average Resolution</th></tr></thead><tbody>${APP_DATA.teams.map(t=>`<tr data-route="team" data-param="${esc(t.id)}"><td><div class="table-main">${esc(t.name)}</div><div class="table-sub">Owns ${esc(t.services.join(", ")||"No services assigned")}</div></td><td><div class="person-cell">${avatar(t.lead)}${esc(t.lead)}</div></td><td>${Number(t.members||0)}</td><td>${Number(t.openIncidents||0)}</td><td>${Number(t.critical||0)}</td><td>${esc(t.onCall)}</td><td>${esc(t.avgResolution)}</td></tr>`).join("")}</tbody></table></div></div></div>`;}
function renderTeamDetails(id){const t=APP_DATA.teams.find(x=>x.id===id); if(!t) return emptyState("Team unavailable","This team is outside your access scope."); const related=APP_DATA.incidents.filter(i=>i.team===t.name).slice(0,6); return `<div class="page-stack">${pageHeader(esc(t.name),`Lead: ${esc(t.lead)} | On-call: ${esc(t.onCall)}`,`<button class="btn-secondary" data-route="teams">All Teams</button>${isAdminUI()?`<button class="btn-primary" data-modal="team" data-team="${esc(t.id)}">Edit Team</button>`:""}`,`<button data-route="teams">Teams</button><span>/</span><span>${esc(t.name)}</span>`)}<div class="metrics-grid">${metric("Members",t.members,"Active engineers")}${metric("Open Incidents",t.openIncidents,"Current workload")}${metric("Critical",t.critical,"P1 incidents")}${metric("Avg Resolution",t.avgResolution,"30 day average")}</div><div class="detail-layout"><section class="section-panel"><div class="section-title">Open Incidents</div><div style="margin-top:12px;">${renderCompactIncidentTable(related)}</div></section><aside class="section-panel"><div class="section-title">Services Owned</div><div class="related-list" style="margin-top:10px;">${t.services.map(name=>`<div class="related-item"><span>${esc(name)}</span><span>${healthBadge((APP_DATA.services.find(s=>s.name===name)||{}).health || "Operational")}</span></div>`).join("")}</div></aside></div></div>`;}
function renderSLA(){
  const atRisk=APP_DATA.incidents.filter(i=>i.atRisk).length;
  const breached=APP_DATA.incidents.filter(i=>i.sla==="Breached").length;
  const editable=isAdminUI();
  return `<div class="page-stack">${pageHeader("SLA Management","Define and monitor response and resolution commitments.","")}<div class="metrics-grid">${metric("Overall Compliance",`${slaComplianceValue().toFixed(1)}%`,"Resolved incidents within SLA")}${metric("At Risk",atRisk,"Visible active incidents")}${metric("Breached",breached,"Visible unresolved incidents")}${metric("Policies",APP_DATA.slaPolicies.length,"Active policy definitions")}</div><div class="section-panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Policy</th><th>Priority</th><th>Response Target</th><th>Resolution Target</th><th>Compliance</th><th>At Risk</th><th>Breaches</th><th>Status</th><th>Actions</th></tr></thead><tbody>${APP_DATA.slaPolicies.map(p=>`<tr><td class="table-main">${esc(p.policy)}</td><td>${priorityBadge(p.priority)}</td><td>${esc(p.response)}</td><td>${esc(p.resolution)}</td><td class="mono">${esc(p.compliance)}</td><td>${p.atRisk}</td><td>${p.breaches}</td><td>${statusBadge(p.status)}</td><td>${editable?`<button class="btn-secondary" data-modal="sla" data-policy="${p.id}">Edit</button>`:'<span class="muted">Read only</span>'}</td></tr>`).join("")}</tbody></table></div></div></div>`;
}

function renderOnCall(){
  let schedules=APP_DATA.onCallSchedules||[];
  const canEdit=["manager","administrator"].includes(currentRole());
  if(currentRole()==="manager" && APP_DATA.currentUser.teamId) schedules=schedules.filter(s=>s.teamId===APP_DATA.currentUser.teamId);
  const current=Date.now();
  const active=schedules.filter(s=>new Date(s.startsAt).getTime()<=current&&new Date(s.endsAt).getTime()>=current);
  const fallbackTeams=currentRole()==="manager"?APP_DATA.teams.filter(t=>t.id===APP_DATA.currentUser.teamId):APP_DATA.teams;
  const cards=(active.length?active:fallbackTeams.slice(0,4).map(t=>({team:t.name,profile:t.onCall,endsAt:null}))).slice(0,4);
  const actions=canEdit?`<button class="btn-primary" data-modal="oncall">${plusIcon()}Add Schedule</button>`:"";
  return `<div class="page-stack">${pageHeader("On-Call","Current responders and upcoming coverage schedules.",actions)}<div class="metrics-grid">${cards.map(s=>metric(s.team,s.profile,s.endsAt?`Until ${new Date(s.endsAt).toLocaleString()}`:"No active schedule")).join("")}</div><div class="section-panel"><div class="section-head"><span class="section-title">Upcoming Schedule</span><span class="section-note">${esc(APP_DATA.organization?.timezone||"Europe/London")}</span></div>${schedules.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Team</th><th>Responder</th><th>Starts</th><th>Ends</th>${canEdit?"<th>Actions</th>":""}</tr></thead><tbody>${schedules.map(s=>`<tr><td>${esc(s.team)}</td><td>${esc(s.profile)}</td><td>${esc(new Date(s.startsAt).toLocaleString())}</td><td>${esc(new Date(s.endsAt).toLocaleString())}</td>${canEdit?`<td><div style="display:flex;gap:6px;"><button class="btn-secondary" data-modal="oncall" data-schedule="${esc(s.id)}">Edit</button><button class="btn-danger" data-delete-oncall="${esc(s.id)}">Delete</button></div></td>`:""}</tr>`).join("")}</tbody></table></div>`:emptyState("No schedules yet",canEdit?"Add your first on-call schedule.":"No schedules are visible for your role.")}</div></div>`;
}

function miniChart(vals,emphasis){return `<div class="mini-chart">${vals.map((v,i)=>`<div class="mini-bar ${i===emphasis?"emphasis":""}" style="height:${Math.max(10,Math.min(100,v+30))}px"></div>`).join("")}</div><div class="chart-label">Calculated from incidents visible to your account</div>`;}

function renderAnalytics(){
  const rows=APP_DATA.incidents;
  const open=rows.filter(i=>!["Resolved","Closed"].includes(i.status));
  const priorityCounts=["p1","p2","p3","p4"].map(p=>rows.filter(i=>i.priority===p).length*5);
  const serviceCounts=APP_DATA.services.slice(0,6).map(s=>rows.filter(i=>i.serviceId===(s.uuid||s.id)).length*5);
  const teamCounts=APP_DATA.teams.slice(0,5).map(t=>open.filter(i=>i.teamId===(t.uuid||t.id)).length*6);
  const topService=APP_DATA.services.map(s=>({name:s.name,count:rows.filter(i=>i.serviceId===(s.uuid||s.id)).length})).sort((a,b)=>b.count-a.count)[0]||{name:"n/a",count:0};
  const topCategory=Object.entries(rows.reduce((a,i)=>{const k=i.category||"Uncategorized";a[k]=(a[k]||0)+1;return a;},{})).sort((a,b)=>b[1]-a[1])[0]||["n/a",0];
  return `<div class="page-stack">${pageHeader("Analytics","Operational performance and incident trends for data visible to your role.",`<div class="tab-row"><button class="tab-btn">7 days</button><button class="tab-btn active">30 days</button><button class="tab-btn">90 days</button></div>`)}<div class="metrics-grid">${metric("Total incidents",rows.length,"Visible records")}${metric("Open",open.length,"Current workload")}${metric("SLA At Risk",open.filter(i=>i.atRisk).length,"Resolution deadline approaching")}${metric("Breached",open.filter(i=>i.sla==="Breached").length,"Past resolution SLA")}</div><div class="metrics-grid">${metric("Resolved",rows.filter(i=>["Resolved","Closed"].includes(i.status)).length,"Visible history")}${metric("Top Service",topService.name,`${topService.count} incidents`)}${metric("Top Category",topCategory[0],`${topCategory[1]} incidents`)}${metric("Team Load",APP_DATA.teams.sort((a,b)=>b.openIncidents-a.openIncidents)[0]?.name||"n/a","Most visible open work")}</div><div class="split-layout"><section class="section-panel"><div class="section-title">Priority distribution</div>${miniChart(priorityCounts,priorityCounts.indexOf(Math.max(...priorityCounts)))}</section><section class="section-panel"><div class="section-title">Incidents by service</div>${miniChart(serviceCounts,serviceCounts.indexOf(Math.max(...serviceCounts)))}</section></div><div class="split-layout"><section class="section-panel"><div class="section-title">Team workload</div>${miniChart(teamCounts,teamCounts.indexOf(Math.max(...teamCounts)))}</section><section class="section-panel"><div class="section-title">Data scope</div><div class="article-body" style="margin-top:12px;"><p>Analytics reflect the incidents your account has access to. Administrators see organization-wide data; other roles see the scope permitted by their role.</p></div></section></div></div>`;
}

function renderKnowledgeBase(){
  const cats=["All","Networking","Authentication","Payments","Infrastructure","Security","Applications","Hardware"];
  const rows=APP_DATA.knowledgeArticles.filter(a=>appState.knowledgeCategory==="All"||a.category===appState.knowledgeCategory);
  const manage=["manager","administrator"].includes(currentRole());
  const actions=manage?`<button class="btn-primary" data-modal="article">${plusIcon()}New Article</button>`:"";
  return `<div class="page-stack">${pageHeader("Knowledge Base","Operational runbooks and troubleshooting documentation.",actions)}<div class="section-panel"><div class="filter-bar" style="grid-template-columns:minmax(220px,1fr) auto;"><div class="input-wrap">${iconSearch()}<input class="form-input" placeholder="Search knowledge base..."></div><div class="tab-row">${cats.map(c=>`<button class="tab-btn ${appState.knowledgeCategory===c?"active":""}" data-kb-category="${esc(c)}">${esc(c)}</button>`).join("")}</div></div></div><div class="section-panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Article</th><th>Category</th><th>Author</th><th>Updated</th><th>Views</th>${manage?"<th>Actions</th>":""}</tr></thead><tbody>${rows.map(a=>`<tr data-route="article" data-param="${esc(a.id)}"><td><div class="table-main">${esc(a.id)} ${esc(a.title)}</div><div class="table-sub">${esc(a.summary||"Runbook and troubleshooting guidance")}</div></td><td>${esc(a.category)}</td><td>${esc(a.author)}</td><td>${esc(a.updated)}</td><td>${Number(a.views||0)}</td>${manage?`<td><button class="btn-secondary" data-modal="article" data-article="${esc(a.id)}">Edit</button></td>`:""}</tr>`).join("")}</tbody></table></div></div></div>`;
}
function renderKnowledgeArticle(id){
  const a=(appState.articleDetail&&appState.articleDetail.id===id)?appState.articleDetail:APP_DATA.knowledgeArticles.find(x=>x.id===id);
  if(!a) return emptyState("Article unavailable","This knowledge article is not visible to your account.");
  const content=String(a.content||a.summary||"No article content has been added yet.");
  const paragraphs=content.split(/\n{2,}/).filter(Boolean);
  const manage=["manager","administrator"].includes(currentRole());
  return `<div class="page-stack">${pageHeader(esc(a.title),`${esc(a.category)} | ${esc(a.author)} | Updated ${esc(a.updated)}`,`<button class="btn-secondary" data-route="knowledge">Back</button>${manage?`<button class="btn-primary" data-modal="article" data-article="${esc(a.id)}">Edit Article</button>`:""}`,`<button data-route="knowledge">Knowledge Base</button><span>/</span><span>${esc(a.id)}</span>`)}<section class="section-panel"><article class="article-body"><p class="table-sub" style="margin-bottom:18px;">${esc(a.summary||"")}</p>${paragraphs.map(p=>`<p>${esc(p)}</p>`).join("")}</article></section></div>`;
}

function renderUsers(){
  return `<div class="page-stack">${pageHeader("Users","Manage workspace access, teams, and operational roles.",`<button class="btn-primary" data-modal="invite">${plusIcon()}Invite User</button>`)}<div class="section-panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>User</th><th>Email</th><th>Role</th><th>Team</th><th>Status</th><th>Last Active</th><th>Actions</th></tr></thead><tbody>${APP_DATA.users.map(u=>`<tr><td><div class="person-cell">${avatar(u.name)}<span class="table-main">${esc(u.name)}</span></div></td><td>${esc(u.email||"—")}</td><td>${esc(u.role)}</td><td>${esc(u.team||"Unassigned")}</td><td>${statusBadge(u.status)}</td><td>${esc(u.lastActive)}</td><td><button class="btn-secondary" data-modal="user" data-user="${u.id}">Edit</button> ${u.statusValue!=="disabled"?`<button class="btn-danger" data-modal="disable" data-user="${u.id}">Disable</button>`:""}</td></tr>`).join("")}</tbody></table></div></div></div>`;
}

function renderAuditLogs(){return `<div class="page-stack">${pageHeader("Audit Logs","Immutable record of administrative and operational actions.","")}<div class="section-panel"><div class="filter-bar" style="grid-template-columns:minmax(220px,1.5fr) repeat(4,140px);"><div class="input-wrap">${iconSearch()}<input class="form-input" placeholder="Search logs..."></div>${selectFilter("au","User",unique(APP_DATA.auditLogs,"user"),"")}${selectFilter("aa","Action",unique(APP_DATA.auditLogs,"action"),"")}${selectFilter("ao","Object",["Incident","SLA Policy","User","Service"],"")}${selectFilter("as","Source",unique(APP_DATA.auditLogs,"source"),"")}</div></div><div class="section-panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Object</th><th>Details</th><th>Source</th></tr></thead><tbody>${APP_DATA.auditLogs.map(l=>`<tr><td class="mono">${esc(l.timestamp)}</td><td>${esc(l.user)}</td><td>${esc(l.action)}</td><td class="incident-id">${esc(l.object)}</td><td>${esc(l.details)}</td><td>${esc(l.source)}</td></tr>`).join("")}</tbody></table></div></div></div>`;}
function settingsRows(rows,toggles=false){return rows.map((r,i)=>`<div class="setting-row"><div><div class="table-main">${esc(r[0])}</div><div class="table-sub">${esc(r[1])}</div></div>${toggles?`<button class="toggle ${i!==2?"on":""}" aria-label="Toggle ${esc(r[0])}"></button>`:""}</div>`).join("");}
function renderSettingsPanel(tab){
  if(tab==="Organization"){
    const org=APP_DATA.organization||{};
    return settingsRows([["Organization",org.name||"Unavailable"],["Workspace slug",org.slug||"—"],["Timezone",org.timezone||"—"],["Data health",appState.backendWarnings.length?`${appState.backendWarnings.length} item(s) need attention`:"All data loaded successfully"]]);
  }
  if(tab==="General"){
    return settingsRows([["Signed-in user",APP_DATA.currentUser.name],["Role",APP_DATA.currentUser.role],["Organization",APP_DATA.organization?.name||APP_DATA.currentUser.organization||"—"],["Connection status",appState.backendReady?"Connected":"Not configured"],["Live updates","Incidents, services, and notifications update automatically"]]);
  }
  if(tab==="Integrations") return ["Microsoft Teams","Slack","Jira","Email","Webhook","REST API"].map(n=>`<div class="setting-row"><div><div class="table-main">${n}</div><div class="table-sub">Not yet available</div></div><span class="status-badge">Available later</span></div>`).join("");
  if(tab==="Security") return settingsRows([["Session security","Industry-standard secure authentication"],["MFA / SSO","Available when configured by your administrator"],["Data access control","Enforced automatically for every request, at the account level"],["Admin operations","Protected server-side operations"],["Attachment access","Private storage with per-incident access control"]]);
  if(tab==="API"){
    const base=window.PulseOpsSupabase?.config?.supabaseUrl||"";
    return `<div class="setting-row"><div><div class="table-main">API endpoint</div><div class="table-sub">${esc(base?`${base}/rest/v1`:"Not configured")}</div></div><button class="btn-secondary" data-copy="api">Copy</button></div><div class="setting-row"><div><div class="table-main">Browser credential policy</div><div class="table-sub">Only a public, restricted access key is used in the browser. Full administrative credentials are never exposed here.</div></div></div>`;
  }
  if(tab==="Appearance") return settingsRows([["Theme","Light / Dark"],["Compact layout","Enabled"],["Sidebar","Collapsible"]]);
  if(tab==="Notifications") return settingsRows([["In-app notifications","Delivered instantly and saved for later review"],["Assignment alerts","Automatic"],["Incident updates","Automatic"],["Comment alerts","Automatic"]]);
  if(tab==="Incident Management") return settingsRows([["Incident numbering","Assigned automatically"],["SLA enforcement","Calculated automatically"],["Activity timeline","Recorded automatically"],["Assignment validation","Validated automatically"]]);
  return settingsRows([["Data boundary","Scoped to your organization"],["Browser credential","Public access key only"],["Privileged operations","Protected server-side operations"],["Security hardening","Up to date"]]);
}
function renderSettings(){const tabs=["General","Organization","Incident Management","Notifications","Integrations","Security","API","Appearance"]; return `<div class="page-stack">${pageHeader("Settings","Review your workspace configuration and security settings.",`<span class="status-badge">Administrator</span>`)}<div class="settings-layout"><nav class="settings-tabs">${tabs.map(t=>`<button class="settings-tab ${appState.settingsTab===t?"active":""}" data-settings-tab="${t}">${t}</button>`).join("")}</nav><section class="section-panel">${renderSettingsPanel(appState.settingsTab)}</section></div></div>`;}

async function loadBackendData(options={}){
  const showLoading=options.showLoading!==false;
  if(showLoading) renderLoadingShell();
  const data = await window.PulseOpsAPI.loadInitialData();
  APP_DATA.organization = data.organization || null;
  appState.backendWarnings = data.backendWarnings || [];
  APP_DATA.services = data.services || [];
  APP_DATA.teams = data.teams || [];
  APP_DATA.users = data.users || [];
  APP_DATA.slaPolicies = data.slaPolicies || [];
  APP_DATA.knowledgeArticles = data.knowledgeArticles || [];
  APP_DATA.auditLogs = data.auditLogs || [];
  APP_DATA.notifications = data.notifications || [];
  APP_DATA.incidents = data.incidents || [];
  APP_DATA.onCallSchedules = data.onCallSchedules || [];
  APP_DATA.dependencies = data.dependencies || [];
  if (appState.authProfile) {
    const mapped=APP_DATA.users.find(u=>u.id===appState.authProfile.id);
    APP_DATA.currentUser = mapped ? {...mapped, organization:APP_DATA.organization?.name || ""} : {
      id:appState.authProfile.id,
      name:appState.authProfile.full_name || "PulseOps User",
      email:appState.authProfile.email || appState.authSession?.user?.email || "",
      role:roleDisplay(appState.authProfile.role),
      roleValue:String(appState.authProfile.role || "employee").toLowerCase(),
      team:appState.authProfile.team ? appState.authProfile.team.name : "",
      teamId:appState.authProfile.team_id || appState.authProfile.team?.id || null,
      organization:APP_DATA.organization?.name || ""
    };
  }
  updateProfileChrome();
  applyRoleNavigation();
  renderNotifications();
  return data;
}

async function refreshNotifications(){
  if(!appState.authSession || !window.PulseOpsAPI) return;
  try{
    APP_DATA.notifications=await window.PulseOpsAPI.getNotifications();
    renderNotifications();
  }catch(error){console.error("Notification refresh failed",error);}
}

function scheduleBackendRefresh(options={}){
  clearTimeout(appState.backendRefreshTimer);
  appState.backendRefreshTimer=setTimeout(async()=>{
    try{
      await loadBackendData({showLoading:false});
      if(options.render!==false && appState.authSession && !appState.recoveryMode) await renderPage();
    }catch(error){console.error("Realtime data refresh failed",error);}
  },180);
}

function setupGlobalRealtime(){
  if(!window.PulseOpsRealtime || !appState.authProfile) return;
  window.PulseOpsRealtime.subscribeToNotifications(appState.authProfile.id,()=>refreshNotifications());
  window.PulseOpsRealtime.subscribeToIncidentList(()=>scheduleBackendRefresh({render:appState.currentRoute!=="incident"}));
  window.PulseOpsRealtime.subscribeToServices(()=>scheduleBackendRefresh({render:["overview","services","service"].includes(appState.currentRoute)}));
}

async function establishAuthenticatedApp(session) {
  console.log("[PulseOps] Starting authenticated application initialization.");

  appState.authSession = session;

  if (!session) {
    console.warn("[PulseOps] No authenticated session available.");
    appState.authProfile = null;
    if (window.PulseOpsRealtime) {
      try { await window.PulseOpsRealtime.unsubscribeAll(); } catch (_) {}
    }
    renderLogin(appState.authError);
    return;
  }

  console.log("[PulseOps] Authentication confirmed for:", session.user?.email);

  let profile;
  try {
    profile = await window.PulseOpsAuth.loadProfile();
  } catch (error) {
    console.error("[PulseOps] AUTH SUCCEEDED but profile loading failed:", {
      stage: "profile-load",
      message: error?.message,
      code: error?.code,
      details: error?.details,
      hint: error?.hint
    });

    appState.authProfile = null;
    setChromeMode(true);
    appMain.innerHTML = `
      <div class="auth-wrap">
        <section class="auth-card">
          <svg class="brand-mark" viewBox="0 0 24 24" fill="none">
            <rect width="24" height="24" rx="7" fill="#2F6BFF"/>
            <path d="M5 12.5H8.2L10 8L13.2 17L15 12.5H19" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <h1 class="auth-title">Signed in, but PulseOps could not load your profile</h1>
          <p class="auth-copy">Your email and password were accepted. The problem is with loading your workspace profile, not your login credentials.</p>
          <div class="error-banner">${esc(error?.message || "Profile loading failed.")}</div>
          <button class="btn-secondary" id="disabledSignOut">Sign Out</button>
        </section>
      </div>
    `;
    return;
  }

  if (!profile) {
    console.error("[PulseOps] AUTH SUCCEEDED but no profiles row exists.");
    setChromeMode(true);
    appMain.innerHTML = `
      <div class="auth-wrap">
        <section class="auth-card">
          <h1 class="auth-title">PulseOps profile unavailable</h1>
          <p class="auth-copy">Authentication succeeded, but this account does not have a PulseOps application profile.</p>
          <button class="btn-secondary" id="disabledSignOut">Sign Out</button>
        </section>
      </div>
    `;
    return;
  }

  appState.authProfile = profile;
  console.log("[PulseOps] Profile accepted:", {
    role: profile.role,
    status: profile.status,
    organization: profile.organization_id
  });
  updateProfileChrome();

  if (profile.status === "disabled") {
    if (window.PulseOpsRealtime) {
      try { await window.PulseOpsRealtime.unsubscribeAll(); } catch (_) {}
    }
    renderDisabledAccount();
    return;
  }

  try {
    const result = await loadBackendData();
    appState.backendWarnings = result?.backendWarnings || [];
  } catch (error) {
    console.error("[PulseOps] User is logged in, but initial backend data failed:", {
      stage: "backend-data",
      message: error?.message,
      code: error?.code,
      details: error?.details,
      hint: error?.hint
    });
    appState.backendWarnings = [{
      stage: "initial-data",
      message: error?.message || String(error),
      code: error?.code || null
    }];
  }

  try {
    setupGlobalRealtime();
  } catch (error) {
    console.warn("[PulseOps] Realtime setup failed. Application will continue:", error);
  }

  if (!location.hash || recoveryIntent()) location.hash = "#overview";
  await renderPage();

  console.log("[PulseOps] Application initialized successfully.");

  if (appState.backendWarnings && appState.backendWarnings.length) {
    console.warn("[PulseOps] Application loaded with backend warnings:", appState.backendWarnings);
    showToast(`Signed in. ${appState.backendWarnings.length} backend dataset${appState.backendWarnings.length === 1 ? "" : "s"} need attention.`, "warning");
  } else {
    console.log("[PulseOps] Backend initialization successful.");
  }
}

function ensureAuthListener(){
  if(appState.authListenerWired || !window.PulseOpsAuth) return;
  appState.authListenerWired=true;
  window.PulseOpsAuth.onAuthStateChange((event,session)=>{
    setTimeout(async()=>{
      try{
        if(event==="PASSWORD_RECOVERY"){
          appState.authSession=session;
          appState.recoveryMode=true;
          appState.recoveryInvalid=!session;
          appState.authError=appState.recoveryInvalid?"This password reset link is no longer valid. Request a new reset email.":"";
          renderPasswordRecovery(appState.authError);
          return;
        }
        if(event==="SIGNED_OUT"){
          appState.authSession=null;
          appState.authProfile=null;
          appState.incidentBundle=null;
          appState.articleDetail=null;
          APP_DATA.notifications=[];
          if(window.PulseOpsRealtime) await window.PulseOpsRealtime.unsubscribeAll();
          if(!appState.recoveryMode) renderLogin();
          return;
        }
        if(event==="SIGNED_IN" && session){
          if(appState.recoveryMode || recoveryIntent()){
            appState.authSession=session;
            appState.recoveryMode=true;
            appState.recoveryInvalid=false;
            appState.authError="";
            renderPasswordRecovery();
            return;
          }
          if(!appState.authSession || appState.authSession.user?.id!==session.user?.id){
            appState.recoveryMode=false;
            await establishAuthenticatedApp(session);
          }
        }
      }catch(error){
        console.error("Auth state handling failed",error);
        appState.authError=safeErrorMessage(error);
        if(appState.recoveryMode) renderPasswordRecovery(appState.authError);
        else {
          const state=await window.PulseOpsAuth.getSession().catch(()=>({session:null}));
          if(state?.session){
            appState.authSession=state.session;
            setChromeMode(true);
            appMain.innerHTML=`<div class="auth-wrap"><section class="auth-card"><h1 class="auth-title">Signed in, but PulseOps hit an error</h1><p class="auth-copy">Your authentication session is valid. The error details below may help your administrator troubleshoot.</p><div class="error-banner">${esc(error?.message||"Backend initialization failed.")}</div><button class="btn-secondary" id="disabledSignOut">Sign Out</button></section></div>`;
          }else renderLogin(appState.authError);
        }
      }
    },0);
  });
}

async function bootstrapApp() {
  if (!appState.eventsWired) wireEvents();

  const supabaseState = window.PulseOpsSupabase;
  appState.backendReady = Boolean(
    supabaseState &&
    supabaseState.config &&
    supabaseState.config.configured &&
    supabaseState.client
  );

  if (!appState.backendReady) {
    console.error("[PulseOps] Supabase configuration missing.");
    renderDeveloperSetup();
    return;
  }

  console.log("[PulseOps] Supabase client configured.");

  const urlRecoveryError = recoveryUrlError();
  appState.recoveryMode = recoveryIntent();

  if (urlRecoveryError) {
    appState.recoveryMode = true;
    appState.recoveryInvalid = true;
    appState.authError = "This password reset link is no longer valid. Request a new reset email.";
    renderPasswordRecovery(appState.authError);
    ensureAuthListener();
    return;
  }

  ensureAuthListener();

  try {
    renderLoadingShell();
    console.log("[PulseOps] Checking existing Supabase session...");

    const sessionState = await window.PulseOpsAuth.getSession();
    if (sessionState.error) throw sessionState.error;

    if (appState.recoveryMode) {
      appState.authSession = sessionState.session || null;
      appState.recoveryInvalid = !sessionState.session;
      appState.authError = appState.recoveryInvalid
        ? "This password reset link is no longer valid. Request a new reset email."
        : "";
      renderPasswordRecovery(appState.authError);
      return;
    }

    if (!sessionState.session) {
      console.log("[PulseOps] No session. Showing login.");
      appState.authSession = null;
      appState.authProfile = null;
      renderLogin();
      return;
    }

    console.log("[PulseOps] Existing authenticated session found:", sessionState.session.user?.email);
    await establishAuthenticatedApp(sessionState.session);
  } catch (error) {
    console.error("[PulseOps] Bootstrap failed:", {
      message: error?.message,
      code: error?.code,
      details: error?.details,
      hint: error?.hint
    });

    try {
      const state = await window.PulseOpsAuth.getSession();
      if (state?.session) {
        appState.authSession = state.session;
        setChromeMode(true);
        appMain.innerHTML = `
          <div class="auth-wrap">
            <section class="auth-card">
              <h1 class="auth-title">Signed in, but PulseOps could not initialize</h1>
              <p class="auth-copy">Your session is valid. A required data request failed right after login.</p>
              <div class="error-banner">${esc(error?.message || "Application initialization failed.")}</div>
              <button class="btn-secondary" id="disabledSignOut">Sign Out</button>
            </section>
          </div>
        `;
        return;
      }
    } catch (sessionCheckError) {
      console.error("[PulseOps] Session verification failed:", sessionCheckError);
    }

    appState.authError = safeErrorMessage(error);
    if (appState.recoveryMode) {
      appState.recoveryInvalid = true;
      renderPasswordRecovery(appState.authError);
      return;
    }
    renderLogin(appState.authError);
  }
}

function runPostRender(){if(appState.currentRoute==="overview"){drawActivityChart(); animateOnLoad();}}
function drawActivityChart(){
  const svg=document.getElementById("activityChart"); if(!svg) return;
  const w=560,h=150,padL=6,padR=6,padT=10,padB=24,n=12;
  const range=dashboardRange();
  const end=range.end;
  const start=range.start;
  const span=(end-start)/n;
  const created=Array(n).fill(0),resolved=Array(n).fill(0);
  APP_DATA.incidents.forEach(i=>{
    const c=i.createdAt?new Date(i.createdAt):null;
    if(c&&c>=start&&c<=end){const idx=Math.min(n-1,Math.max(0,Math.floor((c-start)/span)));created[idx]++;}
    if(["resolved","closed"].includes(i.statusValue)){
      const r=i.resolvedAt?new Date(i.resolvedAt):(i.updatedAt?new Date(i.updatedAt):null);
      if(r&&r>=start&&r<=end){const idx=Math.min(n-1,Math.max(0,Math.floor((r-start)/span)));resolved[idx]++;}
    }
  });
  const max=Math.max(1,...created,...resolved)*1.15;
  const x=i=>padL+((w-padL-padR)/(n-1))*i, y=v=>padT+(h-padT-padB)*(1-v/max);
  const path=a=>a.map((v,i)=>(i?"L":"M")+x(i).toFixed(1)+","+y(v).toFixed(1)).join(" ");
  const area=a=>path(a)+` L${x(n-1).toFixed(1)},${h-padB} L${x(0).toFixed(1)},${h-padB} Z`;
  let out=`<defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2F6BFF" stop-opacity="0.14"/><stop offset="100%" stop-color="#2F6BFF" stop-opacity="0"/></linearGradient></defs><line x1="${padL}" y1="${h-padB}" x2="${w-padR}" y2="${h-padB}" stroke="var(--border)"/><path d="${area(created)}" fill="url(#areaGrad)"/><path d="${path(resolved)}" fill="none" stroke="#B7BEC8" stroke-width="1.6" stroke-dasharray="4 3"/><path d="${path(created)}" fill="none" stroke="#2F6BFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  [0,3,6,8,11].forEach((idx,li)=>{const d=new Date(start.getTime()+idx*span);const label=d.toLocaleDateString(undefined,{day:"numeric",month:"short"});out+=`<text x="${x(idx).toFixed(1)}" y="${h-6}" font-size="9.5" fill="#9BA2AC" text-anchor="${li===0?"start":li===4?"end":"middle"}" font-family="Inter, sans-serif">${esc(label)}</text>`;});
  out+=`<circle cx="${x(n-1).toFixed(1)}" cy="${y(created[n-1]).toFixed(1)}" r="3.2" fill="#2F6BFF" stroke="#fff" stroke-width="1.5"/>`;
  svg.innerHTML=out;
}
function animateOnLoad(){requestAnimationFrame(()=>{document.querySelectorAll("#priorityBars .p-bar").forEach(b=>b.style.height=b.dataset.h+"px"); const arc=document.getElementById("slaArc"); if(arc){const compliance=Math.max(0,Math.min(100,Number(arc.dataset.compliance||100)));arc.style.transition="stroke-dashoffset 1.1s cubic-bezier(.2,.8,.25,1)"; setTimeout(()=>arc.style.strokeDashoffset=251.3*(1-compliance/100),120);}});}

function renderNotifications(){
  const unread=APP_DATA.notifications.filter(n=>!n.read).length;
  const dot=document.querySelector(".notif-dot");
  const dd=document.getElementById("notifDropdown");
  if(dot) dot.style.display=unread?"block":"none";
  if(!dd) return;
  const rows=APP_DATA.notifications.length
    ? APP_DATA.notifications.map(n=>`<div class="notif-row ${n.read?"":"unread"}" data-notification="${esc(n.id)}"><div class="notif-icon ${esc(n.type)}"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 8.3v7.4M8.3 12h7.4"/></svg></div><div class="notif-body-text"><div class="notif-title">${esc(n.title)}</div><div class="notif-desc">${esc(n.desc)}</div><div class="notif-time">${esc(n.time)}</div></div></div>`).join("")
    : `<div class="empty-state" style="padding:22px 14px;"><h3>No notifications</h3><p>You're all caught up.</p></div>`;
  dd.innerHTML=`<div class="notif-head">Notifications <span>${unread} new</span></div><div class="notif-list">${rows}</div><div class="notif-foot"><button class="btn-ghost" id="markAllRead" ${unread?"":"disabled"}>Mark all as read</button>${isAdminUI()?'<button class="btn-ghost" data-route="audit">Audit logs</button>':''}</div>`;
}

function renderCommandResults(q=""){
  const query=String(q||"").trim().toLowerCase();
  const list=document.getElementById("cmdkList");
  if(!list) return;
  const base=[
    {label:"Create new incident",type:"Action",action:"new",route:"create-incident"},
    {label:"View critical incidents",type:"Incidents",route:"incidents",view:"Critical"},
    {label:"SLA at risk",type:"Incidents",route:"incidents",view:"SLA At Risk"},
    {label:"Open Analytics",type:"Page",route:"analytics"},
    {label:"Open Settings",type:"Page",route:"settings"}
  ].filter(item=>item.action==="new" || routeAllowed(item.route));
  const all=[
    ...base,
    ...APP_DATA.incidents.map(i=>({label:`${i.id} ${i.title}`,type:"Incident",route:"incident",param:i.id})),
    ...(routeAllowed("service")?APP_DATA.services.map(s=>({label:s.name,type:"Service",route:"service",param:s.id})):[]),
    ...(routeAllowed("users")?APP_DATA.users.map(u=>({label:u.name,type:"User",route:"users"})):[]),
    ...APP_DATA.knowledgeArticles.map(a=>({label:`${a.id} ${a.title}`,type:"Article",route:"article",param:a.id}))
  ].filter(r=>(!r.route||routeAllowed(r.route))&&(!query||r.label.toLowerCase().includes(query)||r.type.toLowerCase().includes(query))).slice(0,12);
  list.innerHTML=all.length?all.map((r,i)=>`<div class="cmdk-item ${i===0?"selected":""}" data-cmd-action="${r.action||"route"}" data-route="${r.route||""}" data-param="${r.param||""}" data-view="${r.view||""}">${iconSearch()}<span>${esc(r.label)}</span><span class="muted" style="margin-left:auto;font-size:11px;">${esc(r.type)}</span></div>`).join(""):emptyState("No results","Try another search term.");
}

function csvCell(value){
  const text=String(value??"");
  return `"${text.replace(/"/g,'""')}"`;
}
function exportIncidentsCsv(){
  const rows=getFilteredIncidents();
  const header=["Incident","Title","Priority","Status","Service","Assignee","Team","Reporter","Created","Updated","SLA"];
  const body=rows.map(i=>[i.id,i.title,i.priorityLabel,i.status,i.service,i.assignee,i.team,i.reporter,i.created,i.updated,i.sla].map(csvCell).join(","));
  const csv='\uFEFF'+[header.map(csvCell).join(","),...body].join("\r\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=`pulseops-incidents-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  showToast(`Exported ${rows.length} incident${rows.length===1?"":"s"}.`,"success");
}

function openCmdk(){
  if(!appState.authSession || appState.recoveryMode) return;
  document.getElementById("cmdkOverlay").classList.add("open");
  renderCommandResults();
  setTimeout(()=>document.getElementById("cmdkInput")?.focus(),40);
}
function closeCmdk(){const el=document.getElementById("cmdkOverlay"); if(el) el.classList.remove("open"); const input=document.getElementById("cmdkInput"); if(input) input.value="";}
function closeAllDropdowns(){document.querySelectorAll(".dropdown").forEach(d=>d.classList.remove("open"));}
function setupDropdown(btnId,dropdownId){const btn=document.getElementById(btnId),dd=document.getElementById(dropdownId); if(!btn||!dd)return; btn.addEventListener("click",e=>{e.stopPropagation(); const will=!dd.classList.contains("open"); closeAllDropdowns(); if(will) dd.classList.add("open");});}
function showToast(text,type="success"){const toast=document.getElementById("toast"); if(!toast)return; toast.className=`toast ${type} show`; const label=document.getElementById("toastText"); if(label) label.textContent=text; clearTimeout(window.toastTimer); window.toastTimer=setTimeout(()=>toast.classList.remove("show"),2600);}
function closeModal(){const overlay=document.getElementById("modalOverlay"), modal=document.querySelector("#modalOverlay .modal"); if(overlay) overlay.classList.remove("open"); if(modal){modal.classList.remove("modal-sm"); delete modal.dataset.mode; delete modal.dataset.contextId;}}

function selectOptions(items,valueKey,labelKey,selected,blankLabel="Unassigned"){
  return `<option value="">${esc(blankLabel)}</option>`+items.map(item=>`<option value="${esc(item[valueKey])}" ${String(item[valueKey])===String(selected||"")?"selected":""}>${esc(item[labelKey])}</option>`).join("");
}

function openQuickIncidentModal(){
  const modal=document.querySelector("#modalOverlay .modal");
  if(!modal) return;
  modal.dataset.mode="quick-create";
  modal.innerHTML=`<div class="modal-head"><span class="modal-title">Create Incident</span><button class="modal-close" data-close-modal aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><div class="modal-body"><div class="form-row"><label class="form-label" for="quickTitle">Incident title</label><input class="form-input" id="quickTitle" minlength="4" required placeholder="e.g. Checkout returning 503 errors"></div><div class="form-row"><label class="form-label" for="quickDesc">Description</label><textarea class="form-textarea" id="quickDesc" required placeholder="Describe what's happening"></textarea></div><div class="form-row form-row-split"><div><label class="form-label" for="quickService">Affected service</label><select class="form-select" id="quickService">${APP_DATA.services.map(s=>`<option value="${esc(s.uuid||s.id)}">${esc(s.name)}</option>`).join("")}</select></div><div><label class="form-label" for="quickPriority">Priority</label><select class="form-select" id="quickPriority"><option value="p1">P1 Critical</option><option value="p2">P2 High</option><option value="p3" selected>P3 Medium</option><option value="p4">P4 Low</option></select></div></div><div class="form-row form-row-split"><div><label class="form-label" for="quickAffected">Affected users</label><select class="form-select" id="quickAffected"><option>Single user</option><option>Small group</option><option>Department</option><option>Organization-wide</option><option>Customers</option></select></div><div><label class="form-label" for="quickTeam">Assign team</label><select class="form-select" id="quickTeam">${selectOptions(APP_DATA.teams,"id","name",null,"Use service owner")}</select></div></div><div class="form-row"><label class="form-label" for="quickFile">Attachment (optional)</label><input class="form-input" id="quickFile" type="file" accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.log"><div class="form-help">Stored securely · maximum 10 MB.</div></div></div><div class="modal-foot"><button class="btn-secondary" data-close-modal>Cancel</button><button class="btn-primary" id="quickCreateIncident" style="height:34px;">Create Incident</button></div>`;
  document.getElementById("modalOverlay").classList.add("open");
}

function openUtilityModal(kind,contextId=""){
  const modal=document.querySelector("#modalOverlay .modal");
  if(!modal) return;
  modal.classList.add("modal-sm");
  modal.dataset.mode=kind;
  modal.dataset.contextId=contextId||"";
  let title="PulseOps",body="",confirm="Save",confirmClass="btn-primary",showConfirm=true;

  if(kind==="help"){
    title="Help & Support"; showConfirm=false;
    body=`<div class="related-list"><div class="related-item"><span>Documentation</span><span class="muted">Setup Guide</span></div><div class="related-item"><span>Keyboard Shortcuts</span><span class="muted">Ctrl / Cmd + K</span></div><div class="related-item"><span>Contact Operations</span><span class="muted">Workspace administrator</span></div><div class="related-item"><span>Report Problem</span><span class="muted">Create an incident</span></div></div>`;
  }else if(kind==="profile"){
    title="Profile"; confirm="Save Profile";
    body=`<div class="form-row"><label class="form-label" for="utilityProfileName">Full name</label><input class="form-input" id="utilityProfileName" required value="${esc(appState.authProfile?.full_name||APP_DATA.currentUser.name||"")}"></div><div class="form-row"><label class="form-label">Email</label><input class="form-input" value="${esc(appState.authProfile?.email||appState.authSession?.user?.email||"")}" disabled></div><div class="form-help">Role and organization are controlled by your workspace administrators.</div>`;
  }else if(kind==="invite"){
    title="Invite User"; confirm="Send Invitation";
    body=`<div class="form-row"><label class="form-label" for="utilityEmail">Email</label><input class="form-input" id="utilityEmail" type="email" required placeholder="name@company.com"></div><div class="form-row"><label class="form-label" for="utilityName">Full name</label><input class="form-input" id="utilityName" required placeholder="Alex Morgan"></div><div class="form-row form-row-split"><div><label class="form-label" for="utilityRole">Role</label><select class="form-select" id="utilityRole"><option value="employee">Employee</option><option value="engineer">Engineer</option><option value="manager">Manager</option><option value="administrator">Administrator</option></select></div><div><label class="form-label" for="utilityTeam">Team</label><select class="form-select" id="utilityTeam">${selectOptions(APP_DATA.teams,"id","name",null)}</select></div></div><div class="form-help">The invitation is sent through a protected server-side operation. No administrative credentials are ever exposed to the browser.</div>`;
  }else if(kind==="user"){
    const user=APP_DATA.users.find(u=>u.id===contextId); if(!user) return;
    title="Edit User";
    body=`<div class="form-row"><label class="form-label">User</label><input class="form-input" value="${esc(user.name)} (${esc(user.email||"no email")})" disabled></div><div class="form-row"><label class="form-label" for="utilityRole">Role</label><select class="form-select" id="utilityRole">${["employee","engineer","manager","administrator"].map(r=>`<option value="${r}" ${r===user.roleValue?"selected":""}>${roleDisplay(r)}</option>`).join("")}</select></div><div class="form-row"><label class="form-label" for="utilityTeam">Team</label><select class="form-select" id="utilityTeam">${selectOptions(APP_DATA.teams,"id","name",user.teamId)}</select></div><div class="form-row"><label class="form-label" for="utilityStatus">Status</label><select class="form-select" id="utilityStatus"><option value="active" ${user.statusValue==="active"?"selected":""}>Active</option><option value="disabled" ${user.statusValue==="disabled"?"selected":""}>Disabled</option></select></div>`;
  }else if(kind==="disable"){
    const user=APP_DATA.users.find(u=>u.id===contextId); if(!user) return;
    title="Disable User"; confirm="Disable User"; confirmClass="btn-danger";
    body=`<p class="auth-copy">Disable <strong>${esc(user.name)}</strong>? Their profile will remain for audit/history, but PulseOps access will be blocked.</p>`;
  }else if(kind==="sla"){
    const policy=APP_DATA.slaPolicies.find(p=>p.id===contextId); if(!policy) return;
    title=`Edit ${policy.policy}`;
    body=`<div class="form-row"><label class="form-label" for="utilityResponse">Response target (minutes)</label><input class="form-input" id="utilityResponse" type="number" min="1" value="${Number(policy.responseMinutes)}"></div><div class="form-row"><label class="form-label" for="utilityResolution">Resolution target (minutes)</label><input class="form-input" id="utilityResolution" type="number" min="1" value="${Number(policy.resolutionMinutes)}"></div><div class="form-row"><label class="form-label" for="utilityEnabled">Policy state</label><select class="form-select" id="utilityEnabled"><option value="true" ${policy.enabled?"selected":""}>Active</option><option value="false" ${!policy.enabled?"selected":""}>Disabled</option></select></div>`;
  }else if(kind==="service"){
    const service=contextId?APP_DATA.services.find(x=>(x.uuid||x.id)===contextId):null;
    if(contextId && !service) return;
    const healthValues=["operational","degraded","partial_outage","major_incident"];
    const environmentValues=[["production","Production"],["staging","Staging"],["development","Development"],["saas","SaaS"]];
    if(service){
      title=`Update ${service.name}`;
      confirm="Save Changes";
      body=`<div class="form-row"><label class="form-label" for="utilityHealth">Health</label><select class="form-select" id="utilityHealth">${healthValues.map(v=>`<option value="${v}" ${v===service.healthValue?"selected":""}>${roleDisplay(v)}</option>`).join("")}</select></div><div class="form-row"><label class="form-label" for="utilityAvailability">Availability %</label><input class="form-input" id="utilityAvailability" type="number" min="0" max="100" step="0.01" value="${Number(service.availabilityValue||100)}"></div><div class="form-row"><label class="form-label" for="utilityTeam">Owner team</label><select class="form-select" id="utilityTeam">${selectOptions(APP_DATA.teams,"id","name",service.ownerTeamId,"Unassigned")}</select></div>`;
    }else{
      title="New Service";
      confirm="Create Service";
      body=`<div class="form-row"><label class="form-label" for="utilityServiceName">Service name</label><input class="form-input" id="utilityServiceName" required placeholder="Payment Gateway"></div><div class="form-row"><label class="form-label" for="utilityServiceDescription">Description</label><textarea class="form-textarea" id="utilityServiceDescription" placeholder="What this service does and who depends on it"></textarea></div><div class="form-row form-row-split"><div><label class="form-label" for="utilityEnvironment">Environment</label><select class="form-select" id="utilityEnvironment">${environmentValues.map(([v,l])=>`<option value="${v}">${l}</option>`).join("")}</select></div><div><label class="form-label" for="utilityTeam">Owner team</label><select class="form-select" id="utilityTeam">${selectOptions(APP_DATA.teams,"id","name",null,"Unassigned")}</select></div></div>`;
    }
  }else if(kind==="team"){
    const team=contextId?APP_DATA.teams.find(x=>x.id===contextId):null;
    title=team?`Edit ${team.name}`:"New Team";
    confirm=team?"Save Team":"Create Team";
    const leads=APP_DATA.users.filter(u=>u.statusValue==="active"&&["engineer","manager","administrator"].includes(u.roleValue));
    body=`<div class="form-row"><label class="form-label" for="utilityTeamName">Team name</label><input class="form-input" id="utilityTeamName" required value="${esc(team?.name||"")}" placeholder="Platform Engineering"></div><div class="form-row"><label class="form-label" for="utilityTeamDescription">Description</label><textarea class="form-textarea" id="utilityTeamDescription" placeholder="What this team owns and responds to">${esc(team?.description||"")}</textarea></div><div class="form-row"><label class="form-label" for="utilityTeamLead">Team lead</label><select class="form-select" id="utilityTeamLead">${selectOptions(leads,"id","name",team?.leadId||null,"Unassigned")}</select></div>`;
  }else if(kind==="article"){
    const article=contextId?((appState.articleDetail&&appState.articleDetail.id===contextId)?appState.articleDetail:APP_DATA.knowledgeArticles.find(x=>x.id===contextId)):null;
    title=article?`Edit ${article.id}`:"New Knowledge Article";
    confirm=article?"Save Article":"Create Article";
    body=`<div class="form-row"><label class="form-label" for="utilityArticleTitle">Title</label><input class="form-input" id="utilityArticleTitle" required value="${esc(article?.title||"")}" placeholder="Troubleshooting corporate VPN"></div><div class="form-row form-row-split"><div><label class="form-label" for="utilityArticleCategory">Category</label><select class="form-select" id="utilityArticleCategory">${["Networking","Authentication","Payments","Infrastructure","Security","Applications","Hardware"].map(c=>`<option ${c===(article?.category||"Networking")?"selected":""}>${c}</option>`).join("")}</select></div><div><label class="form-label" for="utilityPublished">State</label><select class="form-select" id="utilityPublished"><option value="true" ${article?.published!==false?"selected":""}>Published</option><option value="false" ${article?.published===false?"selected":""}>Draft</option></select></div></div><div class="form-row"><label class="form-label" for="utilityArticleSummary">Summary</label><textarea class="form-textarea" id="utilityArticleSummary" placeholder="Short operational summary">${esc(article?.summary||"")}</textarea></div><div class="form-row"><label class="form-label" for="utilityArticleContent">Content</label><textarea class="form-textarea" id="utilityArticleContent" style="min-height:180px" placeholder="Symptoms, diagnosis, resolution, verification...">${esc(article?.content||"")}</textarea></div>`;
  }else if(kind==="oncall"){
    const schedule=contextId?APP_DATA.onCallSchedules.find(x=>x.id===contextId):null;
    title=schedule?"Edit On-Call Schedule":"Add On-Call Schedule";
    const allowedTeams=currentRole()==="manager"?APP_DATA.teams.filter(t=>t.id===APP_DATA.currentUser.teamId):APP_DATA.teams;
    const selectedTeam=schedule?.teamId||allowedTeams[0]?.id||"";
    const workers=APP_DATA.users.filter(u=>u.statusValue==="active"&&["engineer","manager","administrator"].includes(u.roleValue)&&(currentRole()!=="manager"||!APP_DATA.currentUser.teamId||u.teamId===APP_DATA.currentUser.teamId));
    const localValue=value=>value?new Date(new Date(value).getTime()-new Date(value).getTimezoneOffset()*60000).toISOString().slice(0,16):"";
    body=`<div class="form-row"><label class="form-label" for="utilityTeam">Team</label><select class="form-select" id="utilityTeam">${selectOptions(allowedTeams,"id","name",selectedTeam,"Select team")}</select></div><div class="form-row"><label class="form-label" for="utilityAssignee">Responder</label><select class="form-select" id="utilityAssignee">${selectOptions(workers,"id","name",schedule?.profileId||null,"Select responder")}</select></div><div class="form-row form-row-split"><div><label class="form-label" for="utilityStarts">Starts</label><input class="form-input" id="utilityStarts" type="datetime-local" value="${esc(localValue(schedule?.startsAt))}"></div><div><label class="form-label" for="utilityEnds">Ends</label><input class="form-input" id="utilityEnds" type="datetime-local" value="${esc(localValue(schedule?.endsAt))}"></div></div>`;
  }else if(kind==="assign"){
    const inc=incidentById(contextId); if(!inc) return;
    title=`Assign ${inc.id}`;
    const teams=currentRole()==="engineer"?APP_DATA.teams.filter(t=>t.id===APP_DATA.currentUser.teamId):APP_DATA.teams;
    const workers=currentRole()==="engineer"?APP_DATA.users.filter(u=>u.id===APP_DATA.currentUser.id):APP_DATA.users.filter(u=>u.statusValue==="active"&&["engineer","manager","administrator"].includes(u.roleValue));
    body=`<div class="form-row"><label class="form-label" for="utilityTeam">Team</label><select class="form-select" id="utilityTeam">${selectOptions(teams,"id","name",inc.teamId,"Select team")}</select></div><div class="form-row"><label class="form-label" for="utilityAssignee">Assignee</label><select class="form-select" id="utilityAssignee">${selectOptions(workers,"id","name",inc.assigneeId,"Unassigned")}</select></div><div class="form-help">Organization, role and team membership are validated automatically.</div>`;
  }else if(kind==="status"){
    const inc=incidentById(contextId); if(!inc) return;
    title=`Change ${inc.id} Status`;
    const nextStatuses=STATUS_TRANSITIONS[inc.statusValue]||[];
    if(!nextStatuses.length){
      showConfirm=false;
      body=`<p class="auth-copy">${esc(inc.id)} is <strong>${esc(roleDisplay(inc.statusValue))}</strong>, which is a final state. Closed incidents cannot transition to another status.</p>`;
    }else{
      const statuses=[inc.statusValue,...nextStatuses];
      body=`<div class="form-row"><label class="form-label" for="utilityStatus">Status</label><select class="form-select" id="utilityStatus">${statuses.map(s=>`<option value="${s}" ${s===inc.statusValue?"selected":""}>${roleDisplay(s)}</option>`).join("")}</select></div><div class="form-help">Only valid workflow transitions from the current status (${esc(roleDisplay(inc.statusValue))}) are listed.</div>`;
    }
  }else if(kind==="priority"){
    const inc=incidentById(contextId); if(!inc) return;
    title=`Change ${inc.id} Priority`;
    body=`<div class="form-row"><label class="form-label" for="utilityPriority">Priority</label><select class="form-select" id="utilityPriority">${Object.entries(PRIORITY_LABELS).map(([v,l])=>`<option value="${v}" ${v===inc.priority?"selected":""}>${l}</option>`).join("")}</select></div><div class="form-help">Changing priority recalculates SLA deadlines from the original incident creation time.</div>`;
  }else return;

  modal.innerHTML=`<div class="modal-head"><span class="modal-title">${esc(title)}</span><button class="modal-close" data-close-modal aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><div class="modal-body">${body}</div><div class="modal-foot"><button class="btn-secondary" data-close-modal>${showConfirm?"Cancel":"Close"}</button>${showConfirm?`<button class="${confirmClass}" id="utilityConfirm">${esc(confirm)}</button>`:""}</div>`;
  document.getElementById("modalOverlay").classList.add("open");
}

async function reloadAfterMutation(message,options={}){
  // The mutation itself has already succeeded by the time this runs (the
  // caller only reaches here after its RPC/API call resolved without
  // throwing). Show the success toast now, then best-effort refresh the
  // dashboard data. A refresh hiccup (flaky network, a transient query
  // error) must never be reported as if the change itself failed.
  showToast(message,options.type||"success");
  try{
    await loadBackendData({showLoading:false});
    if(options.refreshIncident!==false && appState.currentRoute==="incident" && appState.routeParam){
      appState.incidentBundle=await window.PulseOpsAPI.getIncidentBundle(appState.routeParam);
    }
  }catch(error){
    console.error("Post-update refresh failed (the change itself was saved):",error);
  }
  try{
    await renderPage();
  }catch(error){
    console.error("Post-update re-render failed (the change itself was saved):",error);
  }
}

async function handleModalConfirm(modal){
  const mode=modal.dataset.mode, id=modal.dataset.contextId;
  const button=document.getElementById("utilityConfirm");
  const originalButtonText=button?button.textContent:"Save";
  if(button){button.disabled=true; button.textContent="Working...";}
  try{
    if(mode==="profile"){
      const fullName=document.getElementById("utilityProfileName").value.trim();
      if(!fullName) throw new Error("Full name is required.");
      const updated=await window.PulseOpsAPI.updateCurrentProfile({fullName});
      appState.authProfile.full_name=updated.full_name;
      closeModal(); await reloadAfterMutation("Profile updated",{refreshIncident:false});
    }else if(mode==="invite"){
      const email=document.getElementById("utilityEmail")?.value.trim();
      const fullName=document.getElementById("utilityName")?.value.trim();
      if(!email || !email.includes("@")) throw new Error("A valid email is required.");
      if(!fullName) throw new Error("A full name is required.");
      await window.PulseOpsAPI.inviteUser({email,fullName,role:document.getElementById("utilityRole").value,teamId:document.getElementById("utilityTeam").value||null});
      closeModal(); await reloadAfterMutation("Invitation sent",{refreshIncident:false});
    }else if(mode==="user"){
      await window.PulseOpsAPI.adminUpdateUser(id,{role:document.getElementById("utilityRole").value,teamId:document.getElementById("utilityTeam").value||null,status:document.getElementById("utilityStatus").value});
      closeModal(); await reloadAfterMutation("User access updated",{refreshIncident:false});
    }else if(mode==="disable"){
      const user=APP_DATA.users.find(u=>u.id===id); if(!user) throw new Error("User not found.");
      await window.PulseOpsAPI.adminUpdateUser(id,{role:user.roleValue,teamId:user.teamId||null,status:"disabled"});
      closeModal(); await reloadAfterMutation("User disabled",{refreshIncident:false});
    }else if(mode==="sla"){
      await window.PulseOpsAPI.updateSlaPolicy(id,{responseMinutes:document.getElementById("utilityResponse").value,resolutionMinutes:document.getElementById("utilityResolution").value,enabled:document.getElementById("utilityEnabled").value==="true"});
      closeModal(); await reloadAfterMutation("SLA policy updated",{refreshIncident:false});
    }else if(mode==="service"){
      if(id){
        const availability=Number(document.getElementById("utilityAvailability").value);
        if(!Number.isFinite(availability)||availability<0||availability>100) throw new Error("Availability must be between 0 and 100.");
        await window.PulseOpsAPI.saveService({id,health:document.getElementById("utilityHealth").value,availabilityPercent:availability,ownerTeamId:document.getElementById("utilityTeam").value||null});
        closeModal(); await reloadAfterMutation("Service updated",{refreshIncident:false});
      }else{
        const name=document.getElementById("utilityServiceName").value.trim();
        if(!name) throw new Error("Service name is required.");
        await window.PulseOpsAPI.saveService({name,description:document.getElementById("utilityServiceDescription").value,environment:document.getElementById("utilityEnvironment").value,ownerTeamId:document.getElementById("utilityTeam").value||null});
        closeModal(); await reloadAfterMutation("Service created",{refreshIncident:false});
      }
    }else if(mode==="team"){
      const name=document.getElementById("utilityTeamName").value.trim();
      if(!name) throw new Error("Team name is required.");
      await window.PulseOpsAPI.saveTeam({id:id||null,name,description:document.getElementById("utilityTeamDescription").value,leadId:document.getElementById("utilityTeamLead").value||null});
      closeModal(); await reloadAfterMutation(id?"Team updated":"Team created",{refreshIncident:false});
    }else if(mode==="article"){
      const title=document.getElementById("utilityArticleTitle").value.trim();
      if(!title) throw new Error("Article title is required.");
      const existing=id?((appState.articleDetail&&appState.articleDetail.id===id)?appState.articleDetail:APP_DATA.knowledgeArticles.find(a=>a.id===id)):null;
      await window.PulseOpsAPI.saveKnowledgeArticle({id:existing?.uuid||null,title,category:document.getElementById("utilityArticleCategory").value,summary:document.getElementById("utilityArticleSummary").value,content:document.getElementById("utilityArticleContent").value,published:document.getElementById("utilityPublished").value==="true"});
      closeModal(); appState.articleDetail=null; await reloadAfterMutation(existing?"Knowledge article updated":"Knowledge article created",{refreshIncident:false});
    }else if(mode==="oncall"){
      const teamId=document.getElementById("utilityTeam").value,profileId=document.getElementById("utilityAssignee").value;
      const startsRaw=document.getElementById("utilityStarts").value,endsRaw=document.getElementById("utilityEnds").value;
      if(!teamId||!profileId||!startsRaw||!endsRaw) throw new Error("Team, responder, start, and end are required.");
      const startsAt=new Date(startsRaw),endsAt=new Date(endsRaw);
      if(!(endsAt>startsAt)) throw new Error("On-call end time must be after the start time.");
      await window.PulseOpsAPI.saveOnCallSchedule({id:id||null,teamId,profileId,startsAt:startsAt.toISOString(),endsAt:endsAt.toISOString()});
      closeModal(); await reloadAfterMutation(id?"On-call schedule updated":"On-call schedule created",{refreshIncident:false});
    }else if(mode==="assign"){
      const inc=incidentById(id); if(!inc) throw new Error("Incident not found.");
      await window.PulseOpsAPI.assignIncident(inc.uuid,document.getElementById("utilityTeam").value||null,document.getElementById("utilityAssignee").value||null);
      closeModal(); await reloadAfterMutation("Incident assignment updated");
    }else if(mode==="status"){
      const inc=incidentById(id); if(!inc) throw new Error("Incident not found.");
      await window.PulseOpsAPI.changeIncidentStatus(inc.uuid,document.getElementById("utilityStatus").value);
      closeModal(); await reloadAfterMutation("Incident status updated");
    }else if(mode==="priority"){
      const inc=incidentById(id); if(!inc) throw new Error("Incident not found.");
      await window.PulseOpsAPI.changeIncidentPriority(inc.uuid,document.getElementById("utilityPriority").value);
      closeModal(); await reloadAfterMutation("Incident priority updated");
    }
  }catch(error){console.error(`${mode} workflow failed`,error); showToast(safeErrorMessage(error),"error"); if(button){button.disabled=false; button.textContent=originalButtonText;}}
}

async function handleIncidentAction(action,incidentNumber){
  const inc=incidentById(incidentNumber); if(!inc){showToast("Incident not found.","error");return;}
  if(action==="assign"||action==="status"||action==="priority"){openUtilityModal(action,incidentNumber);return;}
  if(action==="acknowledge"){
    try{await window.PulseOpsAPI.acknowledgeIncident(inc.uuid); await reloadAfterMutation("Incident acknowledged");}
    catch(error){console.error("Acknowledge failed",error);showToast(safeErrorMessage(error),"error");}
  }
}

function openDrawer(id){
  const i=incidentById(id); if(!i) return;
  appState.selectedIncident=id;
  document.getElementById("drawerId").textContent=i.id;
  document.getElementById("drawerTitle").textContent=i.title;
  const p=document.getElementById("drawerPriority"); p.className="priority-badge "+i.priority; p.innerHTML=`<span class="dot"></span>${esc(i.priorityLabel)}`;
  const s=document.getElementById("drawerStatus"); s.className="status-badge "+slug(i.status); s.textContent=i.status;
  document.getElementById("drawerService").textContent=i.service;
  document.getElementById("drawerSla").textContent=String(i.sla||"n/a").replace("left","remaining");
  document.getElementById("drawerAssignee").textContent=i.assignee;
  document.getElementById("drawerTeam").textContent=i.team;
  document.getElementById("drawerReported").textContent=i.created;
  document.getElementById("drawerDesc").textContent=i.desc;
  document.getElementById("drawerLog").innerHTML=(i.log||[]).length?i.log.map((r,idx)=>`<div class="log-row"><span class="log-time">${esc(r[0])}</span><div class="log-dot-col"><span class="log-dot"></span>${idx<i.log.length-1?'<span class="log-line"></span>':""}</div><span class="log-text">${esc(r[1])}</span></div>`).join(""):`<div class="table-sub">Open the full incident to load its activity.</div>`;
  document.querySelector(".drawer-foot").innerHTML=`${canManageIncidentUI()?`<button class="btn-secondary" data-incident-action="acknowledge" data-incident-id="${esc(i.id)}">Acknowledge</button><button class="btn-secondary" data-incident-action="status" data-incident-id="${esc(i.id)}">Update Status</button>`:""}<button class="btn-primary" data-route="incident" data-param="${esc(i.id)}" style="height:32px;">View Full Incident</button>`;
  document.getElementById("drawerOverlay").classList.add("open");
}
function closeDrawer(){document.getElementById("drawerOverlay").classList.remove("open");}

async function openAttachment(attachmentId){
  const attachment=appState.incidentBundle?.attachments?.find(a=>a.id===attachmentId);
  if(!attachment){showToast("Attachment not found.","error");return;}
  const tab=window.open("about:blank","_blank");
  try{
    const url=await window.PulseOpsStorage.createSignedAttachmentUrl(attachment.storagePath||attachment.storage_path,false);
    if(tab){tab.opener=null;tab.location.href=url;} else window.location.href=url;
  }catch(error){if(tab)tab.close();console.error("Attachment open failed",error);showToast(safeErrorMessage(error),"error");}
}

async function deleteCurrentIncidentAttachment(attachmentId){
  const attachment=appState.incidentBundle?.attachments?.find(a=>a.id===attachmentId);
  if(!attachment){showToast("Attachment not found.","error");return;}
  if(!confirm(`Delete ${attachment.fileName}? This cannot be undone.`)) return;
  try{
    await window.PulseOpsStorage.deleteIncidentAttachment({id:attachment.id,storage_path:attachment.storagePath||attachment.storage_path});
    await refreshCurrentIncident();
    showToast("Attachment deleted");
  }catch(error){console.error("Attachment delete failed",error);showToast(safeErrorMessage(error),"error");}
}

async function uploadCurrentIncidentAttachment(){
  const file=document.getElementById("incidentAttachmentInput")?.files?.[0];
  const inc=appState.incidentBundle?.incident;
  if(!file||!inc){showToast("Choose a file to upload.","warning");return;}
  const button=document.getElementById("uploadAttachmentBtn"); if(button){button.disabled=true;button.textContent="Uploading...";}
  try{
    await window.PulseOpsStorage.uploadIncidentAttachment(appState.authProfile.organization_id,inc.uuid,file);
    await refreshCurrentIncident();
    showToast("Attachment uploaded");
  }catch(error){console.error("Attachment upload failed",error);showToast(safeErrorMessage(error),"error");}
  finally{if(button){button.disabled=false;button.textContent="Upload Attachment";}}
}

async function copyValue(kind){
  const value=kind==="api"?(window.PulseOpsSupabase?.config?.supabaseUrl?`${window.PulseOpsSupabase.config.supabaseUrl}/rest/v1`:"Not configured."):String(kind||"");
  try{await navigator.clipboard.writeText(value);showToast("Copied to clipboard","info");}
  catch(_){showToast("Copy is unavailable in this browser.","warning");}
}

async function handleActionClick(e){
  if(e.target.id==="retryConfigBtn"){window.location.reload(); return;}
  if(e.target.id==="retryRouteLoad"){await renderPage(); return;}
  if(e.target.id==="disabledSignOut"){
    try{await window.PulseOpsAuth.signOut();}catch(error){console.error(error);} return;
  }
  if(e.target.id==="recoveryBackToLogin"){
    appState.recoveryMode=false; appState.recoveryInvalid=false; appState.authError=""; clearRecoveryUrl(); renderLogin(); return;
  }
  if(e.target.id==="resetPasswordBtn"){
    const email=document.getElementById("loginEmail")?.value;
    if(!email){showToast("Enter your email before requesting a reset.","warning"); return;}
    try{await window.PulseOpsAuth.resetPassword(email);showToast("If an account exists, reset instructions have been sent.","info");}
    catch(error){
      console.error("Password reset failed",error);
      const message=String(error?.message||"");
      if(/rate limit|too many requests|email rate limit/i.test(message)) showToast("Too many reset requests were sent. Please wait before requesting another email.","warning");
      else showToast("If an account exists, reset instructions have been sent.","info");
    }
    return;
  }
  const route=e.target.closest("[data-route]"); if(route && !e.target.closest("[data-modal],[data-delete-oncall]")){e.preventDefault(); closeDrawer(); navigate(route.dataset.route,route.dataset.param||null); return;}
  const incidentAction=e.target.closest("[data-incident-action]"); if(incidentAction){await handleIncidentAction(incidentAction.dataset.incidentAction,incidentAction.dataset.incidentId);return;}
  const preview=e.target.closest("[data-incident-preview]"); if(preview && !e.target.closest("button,input,a")){openDrawer(preview.dataset.incidentPreview); return;}
  const view=e.target.closest("[data-incident-view]"); if(view){appState.incidentFilters.view=view.dataset.incidentView; appState.incidentFilters.page=1; await renderPage(); return;}
  const sort=e.target.closest("[data-sort]"); if(sort){const f=appState.incidentFilters,key=sort.dataset.sort; f.dir=f.sort===key&&f.dir==="asc"?"desc":"asc"; f.sort=key; await renderPage(); return;}
  const tab=e.target.closest("[data-incident-tab]"); if(tab){appState.incidentTab=tab.dataset.incidentTab; await renderPage();return;}
  const attachment=e.target.closest("[data-attachment-open]"); if(attachment){await openAttachment(attachment.dataset.attachmentOpen);return;}
  const attachmentDelete=e.target.closest("[data-attachment-delete]"); if(attachmentDelete){await deleteCurrentIncidentAttachment(attachmentDelete.dataset.attachmentDelete);return;}
  if(e.target.id==="uploadAttachmentBtn"){await uploadCurrentIncidentAttachment();return;}
  if(e.target.id==="exportIncidentsBtn"){exportIncidentsCsv();return;}
  if(e.target.closest("[data-dashboard-refresh]")){try{await loadBackendData({showLoading:false});await renderPage();showToast("Dashboard refreshed","info");}catch(error){console.error(error);showToast(safeErrorMessage(error),"error");}return;}
  if(e.target.id==="newIncidentBtn"){openQuickIncidentModal(); return;}
  if(e.target.id==="customizeBtn"){showToast("Dashboard customization is not persisted in this backend phase.","info"); return;}
  if(e.target.id==="reviewIncidentsBtn"){const target=APP_DATA.incidents.find(i=>i.priority==="p1")||APP_DATA.incidents[0]; if(target) openDrawer(target.id); return;}
  if(e.target.id==="dateRangeBtn" || e.target.closest("#dateRangeBtn")){e.stopPropagation(); const dd=document.getElementById("dateDropdown"), will=dd&&!dd.classList.contains("open"); closeAllDropdowns(); if(will) dd.classList.add("open"); return;}
  const range=e.target.closest("#dateDropdown .cmdk-item"); if(range){appState.dashboardRangeDays=Number(range.dataset.rangeDays||30);closeAllDropdowns();await renderPage();showToast(`Dashboard range updated to ${appState.dashboardRangeDays} days`,"info");return;}
  if(e.target.id==="resetIncidentFilters"){appState.incidentFilters={...appState.incidentFilters,view:"All",query:"",status:"",priority:"",service:"",team:"",assignee:"",date:"",page:1,selected:new Set()}; showToast("Filters cleared","info"); await renderPage(); return;}
  if(e.target.id==="prevIncPage"){appState.incidentFilters.page=Math.max(1,appState.incidentFilters.page-1); await renderPage(); return;}
  if(e.target.id==="nextIncPage"){appState.incidentFilters.page++; await renderPage(); return;}
  const my=e.target.closest("[data-my-tab]"); if(my){appState.myTab=my.dataset.myTab; await renderPage(); return;}
  const kb=e.target.closest("[data-kb-category]"); if(kb){appState.knowledgeCategory=kb.dataset.kbCategory; await renderPage(); return;}
  const st=e.target.closest("[data-settings-tab]"); if(st){appState.settingsTab=st.dataset.settingsTab; await renderPage(); return;}
  const modal=e.target.closest("[data-modal]"); if(modal){
    const context=modal.dataset.policy||modal.dataset.user||modal.dataset.incident||modal.dataset.service||modal.dataset.team||modal.dataset.article||modal.dataset.schedule||"";
    if(modal.dataset.modal==="article" && context && (!appState.articleDetail || appState.articleDetail.id!==context)){
      try{appState.articleDetail=await window.PulseOpsAPI.getKnowledgeArticle(context);}catch(error){console.error("Article load for editing failed",error);showToast(safeErrorMessage(error),"error");return;}
    }
    openUtilityModal(modal.dataset.modal,context); return;
  }
  const deleteSchedule=e.target.closest("[data-delete-oncall]"); if(deleteSchedule){
    if(!confirm("Delete this on-call schedule?")) return;
    try{await window.PulseOpsAPI.deleteOnCallSchedule(deleteSchedule.dataset.deleteOncall);await reloadAfterMutation("On-call schedule deleted",{refreshIncident:false});}
    catch(error){console.error("On-call delete failed",error);showToast(safeErrorMessage(error),"error");}
    return;
  }
  const copy=e.target.closest("[data-copy]"); if(copy){await copyValue(copy.dataset.copy); return;}
  const toast=e.target.closest("[data-toast]"); if(toast){showToast(toast.dataset.toast,"info"); return;}
  if(e.target.id==="getTriageBtn"){
    const title=document.getElementById("ciTitle")?.value.trim()||"";
    const desc=document.getElementById("ciDesc")?.value.trim()||"";
    if(title.length<4||!desc){showToast("Add a title (4+ characters) and a description first.","warning"); return;}
    appState.triage={status:"loading",data:null,error:null};
    const box=document.getElementById("triageBox"); if(box) box.innerHTML=renderTriage();
    try{
      const suggestion=await window.PulseOpsAPI.getTriageSuggestion({
        title,description:desc,
        service:document.getElementById("ciService")?.value||null,
        affected:document.getElementById("ciAffected")?.value||null,
        impact:document.getElementById("ciImpact")?.value||null,
        environment:document.getElementById("ciEnvironment")?.value||null,
        location:document.getElementById("ciLocation")?.value||null
      });
      appState.triage={status:"ready",data:suggestion,error:null};
    }catch(error){
      console.error("Triage suggestion failed",error);
      appState.triage={status:"error",data:null,error:safeErrorMessage(error)};
    }
    const box2=document.getElementById("triageBox"); if(box2) box2.innerHTML=renderTriage();
    return;
  }
  if(e.target.id==="applyTriage"){
    const t=appState.triage;
    if(!t||t.status!=="ready"||!t.data){showToast("Get an AI suggestion first.","warning"); return;}
    const cat=document.getElementById("ciCategory"), urgency=document.getElementById("ciUrgency");
    const urgencyByPriority={p1:"Critical",p2:"High",p3:"Medium",p4:"Low"};
    if(cat && t.data.category) cat.value=t.data.category;
    if(urgency && urgencyByPriority[t.data.priority]) urgency.value=urgencyByPriority[t.data.priority];
    showToast("AI suggestions applied","info"); return;
  }
  const toggle=e.target.closest(".toggle"); if(toggle){toggle.classList.toggle("on");}
}

function handleInput(e){
  const f=appState.incidentFilters;
  const map={incidentSearch:"query",incidentStatus:"status",incidentPriority:"priority",incidentService:"service",incidentTeam:"team",incidentAssignee:"assignee",incidentDate:"date"};
  if(map[e.target.id]){f[map[e.target.id]]=e.target.value; f.page=1; renderPage();}
  if(e.target.classList.contains("incident-select")){e.target.checked?f.selected.add(e.target.dataset.id):f.selected.delete(e.target.dataset.id);}
}

async function handleSubmit(e) {
  if (e.target.id === "loginForm") {
    e.preventDefault();

    const emailInput = document.getElementById("loginEmail");
    const passwordInput = document.getElementById("loginPassword");
    const submit = e.target.querySelector('[type="submit"]');
    const email = String(emailInput?.value || "").trim().toLowerCase();
    const password = String(passwordInput?.value || "");

    if (!email || !password) {
      appState.authError = "Enter your email and password.";
      renderLogin(appState.authError);
      return;
    }

    if (submit) {
      submit.disabled = true;
      submit.textContent = "Signing In...";
    }

    let authData;
    try {
      console.log("[PulseOps Login] Stage 1: Supabase authentication...");
      authData = await window.PulseOpsAuth.signIn(email, password);
      console.log("[PulseOps Login] Stage 1 successful.", authData?.user?.id);
    } catch (error) {
      console.error("[PulseOps Login] Supabase authentication failed:", {
        stage: "supabase-sign-in",
        message: error?.message,
        code: error?.code,
        status: error?.status
      });
      appState.authError = safeErrorMessage(error);
      renderLogin(appState.authError);
      return;
    }

    if (!authData?.session) {
      console.error("[PulseOps Login] Authentication returned no session.");
      appState.authError = "Your credentials were accepted, but no active session was returned. Please try signing in again.";
      renderLogin(appState.authError);
      return;
    }

    appState.authError = "";

    try {
      console.log("[PulseOps Login] Stage 2: initializing PulseOps...");
      await establishAuthenticatedApp(authData.session);
    } catch (error) {
      console.error("[PulseOps Login] Authentication succeeded but application initialization failed:", {
        stage: "post-auth-initialization",
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint
      });

      appState.authSession = authData.session;
      setChromeMode(true);
      appMain.innerHTML = `
        <div class="auth-wrap">
          <section class="auth-card">
            <svg class="brand-mark" viewBox="0 0 24 24" fill="none">
              <rect width="24" height="24" rx="7" fill="#2F6BFF"/>
              <path d="M5 12.5H8.2L10 8L13.2 17L15 12.5H19" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <h1 class="auth-title">You're signed in</h1>
            <p class="auth-copy">Your email and password were accepted, but PulseOps encountered an error while loading the application.</p>
            <div class="error-banner">${esc(error?.message || "Application initialization failed.")}</div>
            <p class="auth-copy">If this keeps happening, contact your workspace administrator with the error details above.</p>
            <button class="btn-secondary" id="disabledSignOut">Sign Out</button>
          </section>
        </div>
      `;
    }
    return;
  }

  if (e.target.id === "recoveryForm") {
    e.preventDefault();
    const password = document.getElementById("recoveryPassword").value;
    const confirmPassword = document.getElementById("recoveryConfirm").value;

    if (password.length < 8) {
      renderPasswordRecovery("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      renderPasswordRecovery("Passwords do not match.");
      return;
    }

    const submit = document.getElementById("recoverySubmitBtn");
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Updating...";
    }

    try {
      const state = await window.PulseOpsAuth.getSession();
      if (state.error) throw state.error;
      if (!state.session) {
        const err = new Error("This password reset link is no longer valid. Request a new reset email.");
        err.code = "recovery_session_missing";
        throw err;
      }
      await window.PulseOpsAuth.updatePassword(password);
      try { await window.PulseOpsAuth.signOut(); } catch (signOutError) { console.warn("Recovery sign-out warning", signOutError); }
      appState.authSession = null;
      appState.authProfile = null;
      appState.recoveryMode = false;
      appState.recoveryInvalid = false;
      appState.authError = "";
      clearRecoveryUrl();
      renderLogin();
      showToast("Password updated successfully. Sign in with your new password.", "success");
    } catch (error) {
      console.error("Password update failed", {message:error?.message,status:error?.status,code:error?.code,error});
      const message = safeErrorMessage(error);
      if (/no longer valid/i.test(message)) appState.recoveryInvalid = true;
      renderPasswordRecovery(message);
    }
    return;
  }

  if (e.target.id === "createIncidentForm") {
    e.preventDefault();
    const triage=appState.triage;
    const triageReady=triage && triage.status==="ready" && triage.data;
    await createIncident({
      title: document.getElementById("ciTitle").value,
      desc: document.getElementById("ciDesc").value,
      service: document.getElementById("ciService").value,
      category: document.getElementById("ciCategory").value,
      affected: document.getElementById("ciAffected").value,
      impact: document.getElementById("ciImpact").value,
      urgency: document.getElementById("ciUrgency").value,
      environment: document.getElementById("ciEnvironment").value,
      location: document.getElementById("ciLocation").value,
      file: document.getElementById("ciAttachment")?.files?.[0] || null,
      aiCategory: triageReady ? triage.data.category : null,
      aiConfidence: triageReady ? triage.data.confidence : null,
      aiReason: triageReady ? triage.data.rationale : null
    });
    return;
  }

  if (e.target.id === "incidentCommentForm") {
    e.preventDefault();
    const body = document.getElementById("incidentCommentBody")?.value.trim();
    const inc = appState.incidentBundle?.incident;
    if (!body || !inc) return;

    const button = e.target.querySelector('[type="submit"]');
    if (button) {
      button.disabled = true;
      button.textContent = "Adding...";
    }

    try {
      await window.PulseOpsAPI.addIncidentComment(inc.uuid, body, appState.incidentTab === "internal" ? "internal" : "public");
      await refreshCurrentIncident();
      showToast(appState.incidentTab === "internal" ? "Internal note added" : "Comment added");
    } catch (error) {
      console.error("Comment failed", error);
      showToast(safeErrorMessage(error), "error");
      if (button) {
        button.disabled = false;
        button.textContent = appState.incidentTab === "internal" ? "Add Internal Note" : "Add Comment";
      }
    }
    return;
  }
}

function wireEvents(){
  if(appState.eventsWired) return;
  appState.eventsWired=true;
  document.getElementById("sidebarToggle")?.addEventListener("click",()=>{window.innerWidth<=860?appShell.classList.toggle("mobile-nav-open"):appShell.classList.toggle("sidebar-collapsed");});
  document.querySelectorAll(".nav-item").forEach(item=>item.addEventListener("click",()=>{const route=ROUTES[item.dataset.nav]||"overview";if(routeAllowed(route)) navigate(route);}));
  setupDropdown("notifBtn","notifDropdown"); setupDropdown("avatarBtn","profileDropdown");
  document.addEventListener("click",e=>{if(!e.target.closest(".dropdown-anchor")) closeAllDropdowns();});
  document.getElementById("globalSearch")?.addEventListener("focus",openCmdk); document.getElementById("searchField")?.addEventListener("click",openCmdk);
  document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openCmdk();}if(e.key==="Escape"){closeCmdk();closeModal();closeDrawer();}});
  document.getElementById("cmdkOverlay")?.addEventListener("click",e=>{if(e.target.id==="cmdkOverlay")closeCmdk();});
  document.getElementById("cmdkInput")?.addEventListener("input",e=>renderCommandResults(e.target.value));
  document.getElementById("cmdkList")?.addEventListener("click",e=>{const item=e.target.closest(".cmdk-item");if(!item)return;closeCmdk();if(item.dataset.cmdAction==="new")openQuickIncidentModal();else{if(item.dataset.view){appState.incidentFilters.view=item.dataset.view;appState.incidentFilters.page=1;}navigate(item.dataset.route,item.dataset.param||null);}});
  document.getElementById("notifDropdown")?.addEventListener("click",async e=>{
    const n=e.target.closest("[data-notification]");
    if(n){const note=APP_DATA.notifications.find(x=>x.id===n.dataset.notification);if(note){try{if(!note.read)await window.PulseOpsAPI.markNotificationRead(note.id);note.read=true;renderNotifications();if(note.incidentId)navigate("incident",note.incidentId);}catch(error){console.error("Notification update failed",error);showToast(safeErrorMessage(error),"error");}}return;}
    if(e.target.id==="markAllRead"){try{await window.PulseOpsAPI.markAllNotificationsRead();APP_DATA.notifications.forEach(x=>x.read=true);renderNotifications();showToast("All notifications marked as read");}catch(error){console.error(error);showToast(safeErrorMessage(error),"error");}return;}
    const route=e.target.closest("[data-route]"); if(route) navigate(route.dataset.route,route.dataset.param||null);
  });
  document.querySelector(".profile-dropdown")?.addEventListener("click",async e=>{const text=e.target.textContent.trim();if(text==="Profile"){closeAllDropdowns();openUtilityModal("profile");return;}if(text==="Settings"){if(routeAllowed("settings"))navigate("settings");else showToast("Settings are restricted to administrators.","warning");return;}if(text==="Sign out"){try{await window.PulseOpsAuth.signOut();}catch(error){console.error("Sign out failed",error);showToast(safeErrorMessage(error),"error");}}});
  document.getElementById("viewStatusBtn")?.addEventListener("click",()=>routeAllowed("services")?navigate("services"):navigate("overview"));
  document.querySelector(".help-link")?.addEventListener("click",()=>openUtilityModal("help"));
  document.getElementById("themeBtn")?.addEventListener("click",()=>{const dark=document.documentElement.dataset.theme!=="dark";document.documentElement.dataset.theme=dark?"dark":"light";localStorage.setItem("pulseops-theme",dark?"dark":"light");showToast(dark?"Dark mode enabled":"Light mode enabled","info");});
  document.getElementById("modalOverlay")?.addEventListener("click",async e=>{
    if(e.target.id==="modalOverlay"||e.target.closest("[data-close-modal]")){closeModal();return;}
    if(e.target.id==="quickCreateIncident"){
      const serviceId=document.getElementById("quickService").value,service=APP_DATA.services.find(s=>(s.uuid||s.id)===serviceId),teamId=document.getElementById("quickTeam").value,team=APP_DATA.teams.find(t=>t.id===teamId);
      const btn=e.target;btn.disabled=true;btn.textContent="Creating...";
      const ok=await createIncident({title:document.getElementById("quickTitle").value,desc:document.getElementById("quickDesc").value,service:service?.name||"",priority:document.getElementById("quickPriority").value,affected:document.getElementById("quickAffected").value,team:team?.name||"",file:document.getElementById("quickFile")?.files?.[0]||null});
      if(ok) closeModal(); else {btn.disabled=false;btn.textContent="Create Incident";}
      return;
    }
    if(e.target.id==="utilityConfirm"){await handleModalConfirm(document.querySelector("#modalOverlay .modal"));}
  });
  document.getElementById("drawerCloseBtn")?.addEventListener("click",closeDrawer);
  document.getElementById("drawerOverlay")?.addEventListener("click",async e=>{if(e.target.id==="drawerOverlay"){closeDrawer();return;}await handleActionClick(e);});
  appMain.addEventListener("click",handleActionClick);
  appMain.addEventListener("input",handleInput);
  appMain.addEventListener("change",handleInput);
  appMain.addEventListener("submit",handleSubmit);
  window.addEventListener("hashchange",()=>renderPage());
}

const savedTheme=localStorage.getItem("pulseops-theme");
if(savedTheme==="dark") document.documentElement.dataset.theme="dark";
bootstrapApp();