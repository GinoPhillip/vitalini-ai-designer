import { buildRequestPackage, usedRequestLogos } from "./request-package.js?v=20261009-7";
const API_BASE = (window.VITALINI_API_BASE || "").replace(/\/$/, "");
const ADMIN_SESSION_KEY = "vitalini_admin_session_v1";
let adminToken = sessionStorage.getItem(ADMIN_SESSION_KEY) || "";
let dashboard = { users: [], invites: [], requests: [] };
let statusTimer = null;
let currentUser = null;
let currentRequest = null;
let currentRequestLibrary = [];
let requestExportBusy = false;

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
      const params = new URLSearchParams(location.search);
      if (params.get("request")) await openRequest(params.get("request"));
      else if (params.get("user")) await openUser(params.get("user"));
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
  document.querySelector("#backToRequests").addEventListener("click", () => showView("requests"));
  document.querySelector("#detailAccountStatus").addEventListener("click", toggleUserStatus);
  document.querySelector("#deleteAccountButton").addEventListener("click", deleteCurrentUser);
  document.querySelector("#requestDetailStatus").addEventListener("change", (event) => currentRequest && updateRequestStatus(currentRequest.id, event.target.value));
  document.querySelector("#requestPackageButton").addEventListener("click", downloadRequestPackage);
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
    const params = new URLSearchParams(location.search);
    if (params.get("request")) await openRequest(params.get("request"));
    else if (params.get("user")) await openUser(params.get("user"));
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
  document.querySelectorAll("[data-request]").forEach((button) => button.addEventListener("click", () => openRequest(button.dataset.request)));
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
  return `<div class="data-row"><div class="data-row__main"><strong>${escapeHtml(item.username || "Client")} · ${escapeHtml(item.model_id || "Design")}</strong><span>${escapeHtml(item.message.slice(0,100))}</span></div><span>${formatDate(item.created_at)}</span><select aria-label="Request status" data-request-status="${item.id}">${statusOptions(item.status)}</select><button data-request="${item.id}" type="button">Open request</button></div>`;
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
  document.querySelector("#detailDesigns").innerHTML = designCards(payload.designs);
  document.querySelector("#detailLogos").innerHTML = logoCards(payload.logos);
  document.querySelector("#detailRequests").innerHTML = requestRows(payload.requests);
  bindProfileActions(document.querySelector("#userDetailView"));
  hydrateImages(document.querySelector("#userDetailView"));
}

async function openRequest(requestId) {
  try {
    const response = await adminFetch(`/api/admin/requests/${encodeURIComponent(requestId)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Design request could not be loaded.");
    renderRequestDetail(payload);
    showView("requestDetail");
    history.replaceState(null,"",`${location.pathname}?request=${encodeURIComponent(requestId)}`);
  } catch (error) { showStatus(error.message, true); }
}

function renderRequestDetail(payload) {
  currentRequest = payload.request;
  const request = payload.request;
  document.querySelector("#requestDetailTitle").textContent = `${request.username} · ${request.design.modelId}`;
  document.querySelector("#requestDetailMeta").textContent = `${formatDate(request.createdAt)} · ${request.email}`;
  document.querySelector("#requestDetailMessage").textContent = request.message;
  document.querySelector("#requestDetailStatus").innerHTML = statusOptions(request.status);
  document.querySelector("#requestDetailModel").textContent = `${request.design.modelId} · ${request.design.status}`;
  document.querySelector("#requestDetailPrompt").textContent = request.design.prompt;
  const trims = Array.isArray(request.placement?.trimColors) ? request.placement.trimColors : [];
  document.querySelector("#requestDetailTrims").innerHTML = trims.filter((trim) => /^#[0-9a-f]{6}$/i.test(trim.color)).map((trim) => `<span><i style="background:${trim.color}"></i>${escapeHtml(trim.label)} <b>${escapeHtml(trim.color)}</b></span>`).join("");
  setPrivateImage(document.querySelector("#requestDetailPreview"), request.previewUrl);
  setPrivateImage(document.querySelector("#requestDetailDesign"), request.design.imageUrl);

  const profile = payload.profile;
  currentRequestLibrary = profile.logos;
  const usedContainer = document.querySelector("#requestUsedLogos");
  try {
    const used = usedRequestLogos(request, profile.logos);
    usedContainer.innerHTML = used.length ? logoCards(used) : "<p>No client logos were placed in this request.</p>";
  } catch (error) { usedContainer.textContent = error.message; }
  document.querySelector("#requestPackageButton").disabled = requestExportBusy;
  document.querySelector("#requestPackageStatus").textContent = "";
  document.querySelector("#requestProfileName").textContent = profile.user.username;
  document.querySelector("#requestProfileEmail").textContent = profile.user.email;
  document.querySelector("#requestProfileUsage").textContent = `${profile.usage.used} / ${profile.usage.limit}`;
  document.querySelector("#requestProfileDesignCount").textContent = profile.designs.length;
  document.querySelector("#requestProfileLogoCount").textContent = profile.logos.length;
  document.querySelector("#requestProfileRequestCount").textContent = profile.requests.length;
  document.querySelector("#requestProfileDesigns").innerHTML = designCards(profile.designs);
  document.querySelector("#requestProfileLogos").innerHTML = logoCards(profile.logos);
  document.querySelector("#requestProfileRequests").innerHTML = requestRows(profile.requests);
  const view = document.querySelector("#requestDetailView");
  bindProfileActions(view);
  hydrateImages(view);
}

async function downloadRequestPackage() {
  if (!currentRequest || requestExportBusy) return;
  const request = structuredClone(currentRequest), library = structuredClone(currentRequestLibrary);
  const button = document.querySelector("#requestPackageButton"), status = document.querySelector("#requestPackageStatus");
  requestExportBusy = true; button.disabled = true;
  button.textContent = "Preparing ZIP…";
  status.textContent = "Fetching artwork, logos and production references…";
  try {
    const loadPrivate = async (path) => {
      const response = await adminFetch(path);
      if (!response.ok) throw new Error("A private asset could not be downloaded. Please sign in again or retry.");
      return response.blob();
    };
    const loadTemplate = async (path) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error("The jacket UV guide could not be loaded. Please retry.");
      return response.blob();
    };
    const bundle = await buildRequestPackage(request, library, loadPrivate, loadTemplate);
    const url = URL.createObjectURL(bundle.blob), link = document.createElement("a");
    link.href = url; link.download = bundle.filename;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    if (currentRequest?.id === request.id) status.textContent = "ZIP downloaded. Extract it and open the rebuild brief in your coding assistant.";
    showStatus("Production handoff ZIP downloaded. No AI generation was run.");
  } catch (error) {
    if (currentRequest?.id === request.id) status.textContent = error.message;
    showStatus(error.message, true);
  } finally {
    requestExportBusy = false; button.disabled = false; button.textContent = "Download production handoff ZIP ↓";
  }
}

function designCards(items) {
  return items.length ? items.map((item) => `<article class="creation-card"><img data-auth-src="${item.imageUrl}" alt="${escapeHtml(item.modelId)} design"><div class="creation-card__body"><strong>${escapeHtml(item.modelId)} · ${formatDate(item.createdAt)}</strong><p>${escapeHtml(item.prompt)}</p><select data-design-status="${item.id}" aria-label="Design production status"><option value="draft" ${item.status === "draft" ? "selected" : ""}>Draft</option><option value="executive" ${item.status === "executive" ? "selected" : ""}>Executive</option></select></div></article>`).join("") : "<p>No creations yet.</p>";
}

function logoCards(items) {
  return items.length ? items.map((item) => `<article class="logo-card"><img data-auth-src="${item.fileUrl}" alt="${escapeHtml(item.name)}"><span>${escapeHtml(item.name)}</span></article>`).join("") : "<p>No logos uploaded.</p>";
}

function requestRows(items) {
  return items.length ? items.map((item) => `<div class="data-row"><div class="data-row__main"><strong>${formatDate(item.created_at)}</strong><span>${escapeHtml(item.message)}</span></div><span>${item.design_id.slice(0,8)}</span><select data-request-status="${item.id}">${statusOptions(item.status)}</select><button data-request="${item.id}" type="button">Open request</button></div>`).join("") : emptyRow("No design requests yet.");
}

function bindProfileActions(container) {
  container.querySelectorAll("[data-design-status]").forEach((select) => select.addEventListener("change", () => updateDesignStatus(select.dataset.designStatus, select.value)));
  container.querySelectorAll("[data-request-status]").forEach((select) => select.addEventListener("change", () => updateRequestStatus(select.dataset.requestStatus, select.value)));
  container.querySelectorAll("[data-request]").forEach((button) => button.addEventListener("click", () => openRequest(button.dataset.request)));
}

function setPrivateImage(image, path) {
  image.removeAttribute("src");
  image.dataset.authSrc = path;
  delete image.dataset.hydrated;
}

async function hydrateImages(container = document) {
  await Promise.all([...container.querySelectorAll("img[data-auth-src]:not([data-hydrated])")].map(async (image) => {
    image.dataset.hydrated = "true";
    try { image.src = await authenticatedObjectUrl(image.dataset.authSrc); }
    catch { image.alt = "Private image unavailable"; }
  }));
}

async function authenticatedObjectUrl(path) {
  const response = await adminFetch(path);
  if (!response.ok) throw new Error("Private image unavailable.");
  return URL.createObjectURL(await response.blob());
}

async function updateRequestStatus(id,status) {
  const response = await adminFetch(`/api/admin/requests/${id}`, { method:"PATCH", headers:{"content-type":"application/json"}, body:JSON.stringify({ status }) });
  if (!response.ok) return showStatus("Request status could not be updated.", true);
  if (currentRequest?.id === id) currentRequest.status = status;
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

async function deleteCurrentUser() {
  if (!currentUser) return;
  const confirmed = window.confirm(`Permanently delete ${currentUser.username}? This removes the account, designs, logos, requests, sessions, and private files.`);
  if (!confirmed) return;
  const button = document.querySelector("#deleteAccountButton");
  button.disabled = true;
  try {
    const response = await adminFetch(`/api/admin/users/${currentUser.id}`, { method:"DELETE" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Account could not be deleted.");
    currentUser = null;
    await loadDashboard();
    showView("users");
    showStatus("Client account and private files deleted.");
  } catch (error) { showStatus(error.message, true); }
  finally { button.disabled = false; }
}

function showView(name) {
  elements.views.forEach((view) => { view.hidden = view.id !== `${name}View`; });
  elements.nav.forEach((button) => button.classList.toggle("is-active", button.dataset.view === name));
  if (!["userDetail", "requestDetail"].includes(name)) history.replaceState(null,"",location.pathname);
}

function adminFetch(path,options={}) { const headers=new Headers(options.headers||{}); headers.set("authorization",`Bearer ${adminToken}`); return fetch(`${API_BASE}${path}`,{...options,headers,cache:"no-store"}); }
function statusOptions(current) { return [["new","New"],["in_review","In review"],["finalized","Finalized"],["declined","Declined"]].map(([value,label])=>`<option value="${value}" ${current===value?"selected":""}>${label}</option>`).join(""); }
function emptyRow(message) { return `<div class="data-row"><div class="data-row__main"><strong>${escapeHtml(message)}</strong></div></div>`; }
function formatDate(value) { return value ? new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(new Date(value)) : "—"; }
function escapeHtml(value) { return String(value??"").replace(/[&<>'"]/g,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[character]); }
function showStatus(message,isError=false) { clearTimeout(statusTimer); elements.status.textContent=message; elements.status.classList.toggle("is-error",isError); elements.status.classList.add("is-visible"); statusTimer=setTimeout(()=>elements.status.classList.remove("is-visible"),2600); }

bootstrap();
