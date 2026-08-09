const API_BASE = (window.VITALINI_API_BASE || "").replace(/\/$/, "");
const ADMIN_SESSION_KEY = "vitalini_admin_session_v1";
let adminToken = sessionStorage.getItem(ADMIN_SESSION_KEY) || "";
let dashboard = { users: [], invites: [], requests: [] };
let statusTimer = null;
let currentUser = null;

const elements = {
  login: document.querySelector("#adminLogin"), shell: document.querySelector("#adminShell"), loginForm: document.querySelector("#adminLoginForm"),
  password: document.querySelector("#adminPassword"), loginError: document.querySelector("#adminLoginError"), logout: document.querySelector("#adminLogout"),
  nav: [...document.querySelectorAll("[data-view]")], views: [...document.querySelectorAll(".admin-view")], status: document.querySelector("#adminStatus"),
  inviteForm: document.querySelector("#inviteForm"), newCode: document.querySelector("#newCode"), newCodeValue: document.querySelector("#newCodeValue"), copyCode: document.querySelector("#copyCode"),
  inviteList: document.querySelector("#inviteList"), userList: document.querySelector("#userList"), requestList: document.querySelector("#requestList"), overviewRequests: document.querySelector("#overviewRequests")
};

async function bootstrap() {
  wireEvents();
  if (adminToken) {
    const response = await adminFetch("/api/admin/users").catch(() => null);
    if (response?.ok) {
      elements.login.hidden = true;
      elements.shell.hidden = false;
      await loadDashboard();
      const requestedUser = new URLSearchParams(location.search).get("user");
      if (requestedUser) await openUser(requestedUser);
      return;
    }
    clearAdminSession();
  }
  elements.login.hidden = false;
}

function wireEvents() {
  elements.loginForm.addEventListener("submit", login);
  elements.logout.addEventListener("click", logout);
  elements.nav.forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
  document.querySelectorAll("[data-refresh]").forEach((button) => button.addEventListener("click", loadDashboard));
  elements.inviteForm.addEventListener("submit", createInvite);
  elements.copyCode.addEventListener("click", () => navigator.clipboard.writeText(elements.newCodeValue.textContent));
  document.querySelector("#backToUsers").addEventListener("click", () => showView("users"));
  document.querySelector("#detailAccountStatus").addEventListener("click", toggleUserStatus);
}

async function login(event) {
  event.preventDefault();
  elements.loginError.textContent = "";
  const button = elements.loginForm.querySelector("button");
  button.disabled = true;
  try {
    const response = await fetch(`${API_BASE}/api/admin/login`, { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ password:elements.password.value }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Admin login failed.");
    adminToken = payload.token;
    sessionStorage.setItem(ADMIN_SESSION_KEY, adminToken);
    elements.login.hidden = true;
    elements.shell.hidden = false;
    await loadDashboard();
  } catch (error) { elements.loginError.textContent = error.message; }
  finally { button.disabled = false; }
}

async function logout() {
  try { await adminFetch("/api/admin/logout", { method:"POST" }); } catch { /* Local logout continues. */ }
  clearAdminSession();
  location.reload();
}

function clearAdminSession() { adminToken = ""; sessionStorage.removeItem(ADMIN_SESSION_KEY); }

async function loadDashboard() {
  try {
    const [usersResponse, invitesResponse, requestsResponse] = await Promise.all([
      adminFetch("/api/admin/users"), adminFetch("/api/admin/invites"), adminFetch("/api/admin/requests")
    ]);
    if ([usersResponse, invitesResponse, requestsResponse].some((response) => !response.ok)) throw new Error("Admin data could not be loaded.");
    const [users, invites, requests] = await Promise.all([usersResponse.json(), invitesResponse.json(), requestsResponse.json()]);
    dashboard = { users:users.users || [], invites:invites.invites || [], requests:requests.requests || [] };
    renderDashboard();
    showStatus("Admin data refreshed.");
  } catch (error) { showStatus(error.message, true); }
}

function renderDashboard() {
  document.querySelector("#metricUsers").textContent = dashboard.users.filter((item) => item.status === "approved").length;
  document.querySelector("#metricInvites").textContent = dashboard.invites.filter((item) => item.used_count < item.max_uses && new Date(item.expires_at) > new Date()).length;
  document.querySelector("#metricRequests").textContent = dashboard.requests.filter((item) => ["new","in_review"].includes(item.status)).length;
  document.querySelector("#metricDesigns").textContent = dashboard.users.reduce((sum,item) => sum + Number(item.design_count || 0), 0);
  elements.inviteList.innerHTML = dashboard.invites.length ? dashboard.invites.map(renderInvite).join("") : emptyRow("No account codes yet.");
  elements.userList.innerHTML = dashboard.users.length ? dashboard.users.map(renderUser).join("") : emptyRow("No approved clients yet.");
  elements.requestList.innerHTML = dashboard.requests.length ? dashboard.requests.map(renderRequest).join("") : emptyRow("No design requests yet.");
  elements.overviewRequests.innerHTML = dashboard.requests.length ? dashboard.requests.slice(0,6).map(renderRequest).join("") : emptyRow("No design requests yet.");
  document.querySelectorAll("[data-user]").forEach((button) => button.addEventListener("click", () => openUser(button.dataset.user)));
  document.querySelectorAll("[data-request-status]").forEach((select) => select.addEventListener("change", () => updateRequestStatus(select.dataset.requestStatus, select.value)));
}

function renderInvite(item) {
  const available = item.used_count < item.max_uses && new Date(item.expires_at) > new Date();
  return `<div class="data-row"><div class="data-row__main"><strong>${escapeHtml(item.label || "Unlabelled client code")}</strong><span>Created ${formatDate(item.created_at)}</span></div><span>${item.used_count} / ${item.max_uses} uses</span><span>Expires ${formatDate(item.expires_at)}</span><span class="status-pill">${available ? "available" : "closed"}</span></div>`;
}

function renderUser(item) {
  return `<div class="data-row"><div class="data-row__main"><strong>${escapeHtml(item.username)}</strong><span>${escapeHtml(item.email)}</span></div><span>${item.design_count} creations</span><span class="status-pill status-pill--${item.status}">${escapeHtml(item.status)}</span><button data-user="${item.id}" type="button">Open client</button></div>`;
}

function renderRequest(item) {
  return `<div class="data-row"><div class="data-row__main"><strong>${escapeHtml(item.username || "Client")} · ${escapeHtml(item.model_id || "Design")}</strong><span>${escapeHtml(item.message.slice(0,100))}</span></div><span>${formatDate(item.created_at)}</span><select aria-label="Request status" data-request-status="${item.id}">${statusOptions(item.status)}</select><button data-user="${item.user_id}" type="button">View client</button></div>`;
}

async function createInvite(event) {
  event.preventDefault();
  try {
    const response = await adminFetch("/api/admin/invites", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ label:document.querySelector("#inviteLabel").value, validDays:Number(document.querySelector("#inviteDays").value), maxUses:Number(document.querySelector("#inviteUses").value) }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Code could not be created.");
    elements.newCode.hidden = false;
    elements.newCodeValue.textContent = payload.invite.code;
    elements.inviteForm.reset();
    await loadDashboard();
  } catch (error) { showStatus(error.message, true); }
}

async function openUser(userId) {
  try {
    const response = await adminFetch(`/api/admin/users/${encodeURIComponent(userId)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Client could not be loaded.");
    renderUserDetail(payload);
    showView("userDetail");
    history.replaceState(null,"",`${location.pathname}?user=${encodeURIComponent(userId)}`);
  } catch (error) { showStatus(error.message, true); }
}

function renderUserDetail(payload) {
  currentUser = payload.user;
  document.querySelector("#detailUsername").textContent = payload.user.username;
  document.querySelector("#detailEmail").textContent = payload.user.email;
  const statusButton = document.querySelector("#detailAccountStatus");
  statusButton.textContent = payload.user.status === "approved" ? "Suspend access" : "Restore access";
  statusButton.classList.toggle("is-restore", payload.user.status !== "approved");
  document.querySelector("#detailUsage").textContent = `${payload.usage.used} / ${payload.usage.limit}`;
  document.querySelector("#detailDesignCount").textContent = payload.designs.length;
  document.querySelector("#detailLogoCount").textContent = payload.logos.length;
  document.querySelector("#detailRequestCount").textContent = payload.requests.length;
  document.querySelector("#detailDesigns").innerHTML = payload.designs.length ? payload.designs.map((item) => `<article class="creation-card"><img data-auth-src="${item.imageUrl}" alt="${escapeHtml(item.modelId)} design"><div class="creation-card__body"><strong>${escapeHtml(item.modelId)} · ${formatDate(item.createdAt)}</strong><p>${escapeHtml(item.prompt)}</p><select data-design-status="${item.id}" aria-label="Design production status"><option value="draft" ${item.status === "draft" ? "selected" : ""}>Draft</option><option value="executive" ${item.status === "executive" ? "selected" : ""}>Executive</option></select></div></article>`).join("") : "<p>No creations yet.</p>";
  document.querySelector("#detailLogos").innerHTML = payload.logos.length ? payload.logos.map((item) => `<article class="logo-card"><img data-auth-src="${item.fileUrl}" alt="${escapeHtml(item.name)}"><span>${escapeHtml(item.name)}</span></article>`).join("") : "<p>No logos uploaded.</p>";
  document.querySelector("#detailRequests").innerHTML = payload.requests.length ? payload.requests.map((item) => `<div class="data-row"><div class="data-row__main"><strong>${formatDate(item.created_at)}</strong><span>${escapeHtml(item.message)}</span></div><span>${item.design_id.slice(0,8)}</span><select data-request-status="${item.id}">${statusOptions(item.status)}</select><a href="#" data-preview="${item.previewUrl}">Open preview</a></div>`).join("") : emptyRow("No design requests yet.");
  document.querySelectorAll("[data-design-status]").forEach((select) => select.addEventListener("change", () => updateDesignStatus(select.dataset.designStatus, select.value)));
  document.querySelectorAll("[data-request-status]").forEach((select) => select.addEventListener("change", () => updateRequestStatus(select.dataset.requestStatus, select.value)));
  document.querySelectorAll("[data-preview]").forEach((link) => link.addEventListener("click", async (event) => { event.preventDefault(); const url = await authenticatedObjectUrl(link.dataset.preview); window.open(url,"_blank","noopener"); }));
  hydrateImages();
}

async function hydrateImages() {
  await Promise.all([...document.querySelectorAll("img[data-auth-src]")].map(async (image) => { try { image.src = await authenticatedObjectUrl(image.dataset.authSrc); } catch { image.alt = "Private image unavailable"; } }));
}

async function authenticatedObjectUrl(path) {
  const response = await adminFetch(path);
  if (!response.ok) throw new Error("Private image unavailable.");
  return URL.createObjectURL(await response.blob());
}

async function updateRequestStatus(id,status) {
  const response = await adminFetch(`/api/admin/requests/${id}`, { method:"PATCH", headers:{"content-type":"application/json"}, body:JSON.stringify({ status }) });
  if (!response.ok) return showStatus("Request status could not be updated.", true);
  showStatus("Request status updated.");
}

async function updateDesignStatus(id,status) {
  const response = await adminFetch(`/api/admin/designs/${id}`, { method:"PATCH", headers:{"content-type":"application/json"}, body:JSON.stringify({ status }) });
  if (!response.ok) return showStatus("Design status could not be updated.", true);
  showStatus("Design production status updated.");
}

async function toggleUserStatus() {
  if (!currentUser) return;
  const status = currentUser.status === "approved" ? "suspended" : "approved";
  const button = document.querySelector("#detailAccountStatus");
  button.disabled = true;
  try {
    const response = await adminFetch(`/api/admin/users/${currentUser.id}`, { method:"PATCH", headers:{"content-type":"application/json"}, body:JSON.stringify({ status }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Client access could not be updated.");
    currentUser.status = status;
    button.textContent = status === "approved" ? "Suspend access" : "Restore access";
    button.classList.toggle("is-restore", status !== "approved");
    await loadDashboard();
    showStatus(status === "approved" ? "Client access restored." : "Client access suspended and active sessions closed.");
  } catch (error) { showStatus(error.message, true); }
  finally { button.disabled = false; }
}

function showView(name) {
  elements.views.forEach((view) => { view.hidden = view.id !== `${name}View`; });
  elements.nav.forEach((button) => button.classList.toggle("is-active", button.dataset.view === name));
  if (name !== "userDetail") history.replaceState(null,"",location.pathname);
}

function adminFetch(path,options={}) { const headers=new Headers(options.headers||{}); headers.set("authorization",`Bearer ${adminToken}`); return fetch(`${API_BASE}${path}`,{...options,headers,cache:"no-store"}); }
function statusOptions(current) { return [["new","New"],["in_review","In review"],["finalized","Finalized"],["declined","Declined"]].map(([value,label])=>`<option value="${value}" ${current===value?"selected":""}>${label}</option>`).join(""); }
function emptyRow(message) { return `<div class="data-row"><div class="data-row__main"><strong>${escapeHtml(message)}</strong></div></div>`; }
function formatDate(value) { return value ? new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(new Date(value)) : "—"; }
function escapeHtml(value) { return String(value??"").replace(/[&<>'"]/g,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[character]); }
function showStatus(message,isError=false) { clearTimeout(statusTimer); elements.status.textContent=message; elements.status.classList.toggle("is-error",isError); elements.status.classList.add("is-visible"); statusTimer=setTimeout(()=>elements.status.classList.remove("is-visible"),2600); }

bootstrap();
