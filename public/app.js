import { t } from "./language.js?v=20261009-2";
import { normalizeRotation, rotatedExtent, logoLocalPoint } from "./logo-geometry.js?v=20261009-1";
import { copyCamera, zoomCamera } from "./viewer-camera.js?v=20261009-2";

const API_BASE = (window.VITALINI_API_BASE || "").replace(/\/$/, "");
const SESSION_KEY = "vitalini_client_session_v1";
let sessionToken = localStorage.getItem(SESSION_KEY) || "";
let logoRenderTimer = null;
let logoRenderSequence = 0;
let generationClock = null;
let generationStartedAt = 0;
let historySequence = 0;
let workspaceTimer = null;
let workspaceQueue = Promise.resolve();
let draftCache = { last: null, edits: {}, pending: {} };
const logoAssets = new Map();

const CATALOG = {
  Jackets: [
    {
      id: "VP9655",
      name: "VP9655",
      sketchfabUid: "81627c97044d48c48acf09dc4dd81aae",
      designMaterial: "Giacca1_FRONT_2563",
      materials: [
        { label: "Contrast", material: "Contrasto_FRONT_2545" },
        { label: "Zipper", material: "Zipper__Velcro_FRONT_2559" }
      ]
    },
    {
      id: "VP9109",
      name: "VP9109",
      sketchfabUid: "58f6159cf20a482eb3c1cbdc319dbce4",
      designMaterial: "Copri_Zip_FRONT_2569",
      materials: [
        { label: "Contrast", material: "Copri_Zip_FRONT_2569_0" },
        { label: "Zipper", material: "Copri_Zip_FRONT_2569_1" }
      ]
    }
  ]
};

const COLORS = [
  ["Snow", "#ffffff"], ["Anthracite", "#394d55"], ["Grey", "#abacaa"],
  ["Deep navy", "#00183f"], ["Capri", "#283484"], ["Marine", "#0966a7"],
  ["Sky", "#00b4dc"], ["Amalfi", "#08a8ac"], ["Forest", "#027039"],
  ["Olive", "#6d7e27"], ["Acid green", "#92f28c"], ["Fluo green", "#93c55f"],
  ["Purple", "#822f8c"], ["Amaranth", "#a90056"], ["Fluo pink", "#ec008b"],
  ["Limoncello", "#dfe915"], ["Sun", "#f7df18"], ["Saffron", "#ffc507"],
  ["Orange", "#f37120"], ["Red", "#ed1b23"], ["Burgundy", "#84002c"]
];

const elements = {
  authGate: document.querySelector("#authGate"),
  appShell: document.querySelector("#appShell"),
  loginTab: document.querySelector("#loginTab"),
  registerTab: document.querySelector("#registerTab"),
  loginForm: document.querySelector("#loginForm"),
  registerForm: document.querySelector("#registerForm"),
  registerUsername: document.querySelector("#registerUsername"),
  authError: document.querySelector("#authError"),
  iframe: document.querySelector("#viewer"),
  type: document.querySelector("#typeSelect"),
  model: document.querySelector("#modelSelect"),
  prompt: document.querySelector("#prompt"),
  promptCount: document.querySelector("#promptCount"),
  generate: document.querySelector("#generateButton"),
  status: document.querySelector("#generationStatus"),
  materialControls: document.querySelector("#materialControls"),
  historyPosition: document.querySelector("#historyPosition"),
  previous: document.querySelector("#previousButton"),
  next: document.querySelector("#nextButton"),
  logoInput: document.querySelector("#logoInput"),
  logoUpload: document.querySelector("#logoUploadButton"),
  logoEditor: document.querySelector("#logoEditor"),
  logoPreview: document.querySelector("#logoPreview"),
  logoLayerList: document.querySelector("#logoLayerList"),
  logoName: document.querySelector("#logoName"),
  logoLibrary: document.querySelector("#logoLibraryList"),
  logoSize: document.querySelector("#logoSize"),
  logoRotation: document.querySelector("#logoRotation"),
  requestMessage: document.querySelector("#requestMessage"),
  requestButton: document.querySelector("#requestButton"),
  designStatus: document.querySelector("#designStatus"),
  accountButton: document.querySelector("#accountButton"),
  accountInitial: document.querySelector("#accountInitial"),
  accountDrawer: document.querySelector("#accountDrawer"),
  accountUsername: document.querySelector("#accountUsername"),
  accountEmail: document.querySelector("#accountEmail"),
  accountUsage: document.querySelector("#accountUsage"),
  accountDesigns: document.querySelector("#accountDesigns"),
  accountLogos: document.querySelector("#accountLogos"),
  accountRequests: document.querySelector("#accountRequests"),
  accountRequestList: document.querySelector("#accountRequestList"),
  logout: document.querySelector("#logoutButton")
};

const state = {
  api: null,
  viewerReady: false,
  model: null,
  materials: new Map(),
  history: [],
  historyIndex: -1,
  currentTexture: null,
  user: null,
  usage: null,
  logos: [],
  selectedLogoId: null,
  logoDrag: null,
  initialized: false,
  generating: false,
  bootSequence: 0,
  statusTimer: null,
  activeTab: "design",
  applyingHistory: false,
  historyLoading: false,
  submittingRequest: false,
  library: [], restoring: true, restoreTarget: null,
  initialCamera: null, cameraBusy: false
};

const designerId = getDesignerId();

function getDesignerId() {
  const key = "vitalini_designer_id_v2";
  let value = localStorage.getItem(key);
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem(key, value);
  }
  return value;
}

async function bootstrap() {
  wireAuthentication();
  if (sessionToken) {
    try {
      const response = await apiFetch("/api/auth/session");
      if (response.ok) {
        const payload = await response.json();
        activateWorkspace(payload.user, payload.usage);
        return;
      }
    } catch {
      // The sign-in screen below is the safe fallback.
    }
    clearSession();
  }
  showAuth("login");
}

function wireAuthentication() {
  elements.loginTab.addEventListener("click", () => showAuth("login"));
  elements.registerTab.addEventListener("click", () => showAuth("register"));
  elements.loginForm.addEventListener("submit", login);
  elements.registerForm.addEventListener("submit", register);
  [elements.loginTab, elements.registerTab].forEach((tab, index, tabs) => {
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const next = tabs[1 - index];
      next.click();
      next.focus();
    });
  });
  elements.registerUsername.addEventListener("input", () => {
    const normalized = elements.registerUsername.value.replace(/\s/g, "_");
    if (normalized !== elements.registerUsername.value) elements.registerUsername.value = normalized;
  });
}

function showAuth(mode) {
  const registering = mode === "register";
  elements.authGate.hidden = false;
  elements.appShell.hidden = true;
  elements.loginForm.hidden = registering;
  elements.registerForm.hidden = !registering;
  elements.loginTab.classList.toggle("is-active", !registering);
  elements.registerTab.classList.toggle("is-active", registering);
  elements.loginTab.setAttribute("aria-selected", String(!registering));
  elements.registerTab.setAttribute("aria-selected", String(registering));
  elements.loginTab.tabIndex = registering ? -1 : 0;
  elements.registerTab.tabIndex = registering ? 0 : -1;
  elements.authError.textContent = "";
  document.body.classList.remove("is-auth-loading");
}

async function login(event) {
  event.preventDefault();
  setAuthBusy(elements.loginForm, true);
  try {
    const response = await publicApiFetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identity: document.querySelector("#loginIdentity").value,
        password: document.querySelector("#loginPassword").value
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Sign in failed.");
    saveSession(payload.token);
    activateWorkspace(payload.user, payload.usage);
  } catch (error) {
    elements.authError.textContent = error.message || "Sign in failed.";
  } finally {
    setAuthBusy(elements.loginForm, false);
  }
}

async function register(event) {
  event.preventDefault();
  setAuthBusy(elements.registerForm, true);
  try {
    const response = await publicApiFetch("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json", "x-designer-id": designerId },
      body: JSON.stringify({
        inviteCode: document.querySelector("#registerCode").value,
        username: document.querySelector("#registerUsername").value,
        email: document.querySelector("#registerEmail").value,
        password: document.querySelector("#registerPassword").value,
        legacyDesignerId: designerId
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Account creation failed.");
    saveSession(payload.token);
    activateWorkspace(payload.user, payload.usage);
  } catch (error) {
    elements.authError.textContent = error.message || "Account creation failed.";
  } finally {
    setAuthBusy(elements.registerForm, false);
  }
}

function setAuthBusy(form, busy) {
  form.querySelectorAll("input, button").forEach((control) => { control.disabled = busy; });
  const submit = form.querySelector("button[type='submit']");
  if (submit) submit.textContent = busy ? "Opening your workspace…" : form === elements.loginForm ? "Enter the studio ↗" : "Create your workspace ↗";
}

function saveSession(token) {
  sessionToken = token;
  localStorage.setItem(SESSION_KEY, token);
}

function clearSession() {
  sessionToken = "";
  localStorage.removeItem(SESSION_KEY);
  state.user = null;
}

function activateWorkspace(user, usage) {
  state.user = user;
  state.usage = usage || { used: 0, limit: 20, remaining: 20 };
  elements.authGate.hidden = true;
  elements.appShell.hidden = false;
  document.body.classList.remove("is-auth-loading");
  elements.accountInitial.textContent = (user.username || "V").slice(0, 1).toUpperCase();
  initialize();
}

async function logout() {
  rememberWorkspace();
  await flushWorkspace();
  try { await apiFetch("/api/auth/logout", { method: "POST" }); } catch { /* Local logout still succeeds. */ }
  closeAccount();
  clearSession();
  location.reload();
}

async function initialize() {
  if (state.initialized) return;
  state.initialized = true;
  elements.type.innerHTML = Object.keys(CATALOG).map((name) => `<option value="${name}">${name}</option>`).join("");
  renderSelectPicker(elements.type);
  populateModels(false);

  elements.type.addEventListener("change", populateModels);
  elements.model.addEventListener("change", () => switchModel(elements.model.value));
  elements.prompt.addEventListener("input", updatePromptState);
  elements.generate.addEventListener("click", generateDesign);
  elements.previous.addEventListener("click", () => showHistory(state.historyIndex + 1));
  elements.next.addEventListener("click", () => showHistory(state.historyIndex - 1));
  elements.logoUpload.addEventListener("click", () => elements.logoInput.click());
  elements.logoInput.addEventListener("change", handleLogoUpload);
  elements.logoSize.addEventListener("input", updateLogoSize);
  elements.logoRotation.addEventListener("input", updateLogoRotation);
  elements.logoPreview.addEventListener("pointerdown", beginLogoDrag);
  elements.logoPreview.addEventListener("pointermove", moveLogoDrag);
  elements.logoPreview.addEventListener("pointerup", endLogoDrag);
  elements.logoPreview.addEventListener("pointercancel", endLogoDrag);
  elements.logoPreview.addEventListener("keydown", moveLogoWithKeyboard);
  wireStudioWorkflow();
  elements.requestMessage.addEventListener("input", () => { updateRequestState(); rememberWorkspace(); });
  elements.prompt.addEventListener("input", () => rememberWorkspace());
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushWorkspace(); });
  window.addEventListener("pagehide", flushWorkspace);
  elements.requestButton.addEventListener("click", submitDesignRequest);
  elements.accountButton.addEventListener("click", openAccount);
  elements.logout.addEventListener("click", logout);
  document.querySelectorAll("[data-close-account]").forEach((item) => item.addEventListener("click", closeAccount));
  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      elements.prompt.value = button.dataset.prompt;
      updatePromptState();
      rememberWorkspace();
      elements.prompt.focus({ preventScroll: true });
    });
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".color-picker")) closeColorPickers();
    if (!event.target.closest(".select-picker")) closeSelectPickers();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeColorPickers();
      closeSelectPickers();
      if (!elements.accountDrawer.hidden) closeAccount();
      if (elements.appShell.classList.contains("is-focused")) toggleFocusView(false);
    }
    if (event.key === "Tab" && !elements.accountDrawer.hidden) trapAccountFocus(event);
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !state.generating && elements.accountDrawer.hidden && !elements.generate.disabled) {
      event.preventDefault();
      generateDesign();
    }
  });
  updatePromptState();
  updateRequestState();
  await restoreWorkspace();
}

function wireStudioWorkflow() {
  const tabs = [...document.querySelectorAll("[data-studio-tab]")];
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => setStudioTab(tab.dataset.studioTab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      setStudioTab(tabs[nextIndex].dataset.studioTab);
      tabs[nextIndex].focus();
    });
  });
  document.querySelectorAll("[data-go-tab]").forEach((button) => button.addEventListener("click", () => {
    setStudioTab(button.dataset.goTab);
    document.querySelector(`#tab-${button.dataset.goTab}`).focus();
  }));
  document.querySelector("#focusButton").addEventListener("click", () => toggleFocusView());
  document.querySelectorAll("[data-camera-action]").forEach((button) => {
    button.addEventListener("click", () => adjustJacketCamera(button.dataset.cameraAction));
  });
}

function updateCameraControls() {
  document.querySelectorAll("[data-camera-action]").forEach((button) => {
    button.disabled = !state.viewerReady || !state.initialCamera || state.cameraBusy;
  });
}

function adjustJacketCamera(action) {
  if (!state.viewerReady || !state.initialCamera || state.cameraBusy) return;
  const api = state.api, boot = state.bootSequence;
  state.cameraBusy = true;
  updateCameraControls();
  const finish = (error) => {
    if (boot !== state.bootSequence) return;
    state.cameraBusy = false;
    updateCameraControls();
    if (error) setStatus("The jacket view could not be adjusted. Please try again.", true);
  };
  const move = (camera) => {
    if (boot !== state.bootSequence) return;
    if (!camera) return finish(true);
    // Instant steps avoid overlapping animations when the user taps repeatedly.
    api.setCameraLookAt(camera.position, camera.target, 0, finish);
  };
  if (action === "reset") return move(copyCamera(state.initialCamera));
  api.getCameraLookAt((error, camera) => {
    if (boot !== state.bootSequence) return;
    if (error) return finish(error);
    move(zoomCamera(camera, state.initialCamera, action === "in" ? .8 : 1.25));
  });
}

function setStudioTab(name) {
  if (!["design", "details", "logos", "review"].includes(name)) return;
  state.activeTab = name;
  closeColorPickers();
  closeSelectPickers();
  document.querySelectorAll("[data-studio-tab]").forEach((tab) => {
    const selected = tab.dataset.studioTab === name;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll(".workflow-panel").forEach((panel) => { panel.hidden = panel.id !== `panel-${name}`; });
  document.querySelector(".studio__content").scrollTop = 0;
  if (name === "review") updateReview();
  if (name === "logos") { renderLogoEditor(); renderLogoLibrary(); }
}

function toggleFocusView(force) {
  const focused = typeof force === "boolean" ? force : !elements.appShell.classList.contains("is-focused");
  elements.appShell.classList.toggle("is-focused", focused);
  document.body.classList.toggle("is-preview-focused", focused);
  const button = document.querySelector("#focusButton");
  button.setAttribute("aria-pressed", String(focused));
  button.setAttribute("aria-label", focused ? "Return to design controls" : "Expand jacket preview");
  button.querySelector("b").textContent = focused ? "Back to studio" : "Focus view";
}

function updateReview() {
  document.querySelector("#reviewModel").textContent = state.model?.name || "Jacket";
  const reviewPrompt = document.querySelector("#reviewPrompt");
  reviewPrompt.toggleAttribute("data-no-translate", Boolean(state.currentTexture));
  reviewPrompt.textContent = state.currentTexture?.prompt || "Generate a design, or revisit one of your saved ideas to get started.";
  const image = document.querySelector("#reviewPreview");
  image.hidden = !state.currentTexture;
  if (state.currentTexture) image.src = state.currentTexture.dataUrl;
  else image.removeAttribute("src");
  document.querySelector("#reviewColors").innerHTML = [...elements.materialControls.querySelectorAll(".color-picker")].map((picker) =>
    `<span><i style="--swatch:${picker.dataset.color}"></i>${escapeMarkup(picker.dataset.label)} · ${escapeMarkup(COLORS.find((entry) => entry[1] === picker.dataset.color)?.[0] || picker.dataset.color)}</span>`).join("");
  document.querySelector("#stageDesignLabel").textContent = state.currentTexture ? "Custom artwork" : "Base garment";
}

function moveLogoWithKeyboard(event) {
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
  const logo = selectedLogo();
  if (!logo) return;
  event.preventDefault();
  const delta = event.shiftKey ? 2 : .5;
  if (event.key === "ArrowUp") logo.y -= delta;
  if (event.key === "ArrowDown") logo.y += delta;
  if (event.key === "ArrowLeft") logo.x -= delta;
  if (event.key === "ArrowRight") logo.x += delta;
  clampLogo(logo);
  renderLogoEditor();
  scheduleLogoComposite();
  rememberWorkspace();
}

function trapAccountFocus(event) {
  const focusable = [...elements.accountDrawer.querySelectorAll("button:not(:disabled), a[href], input:not(:disabled)")];
  const first = focusable[0], last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}

function populateModels(boot = true) {
  const models = CATALOG[elements.type.value] || [];
  elements.model.innerHTML = models.map((model) => `<option value="${model.id}">${model.name}</option>`).join("");
  renderSelectPicker(elements.model);
  if (boot && models[0]) switchModel(models[0].id);
}

function switchModel(modelId) {
  if (state.generating || state.applyingHistory || state.submittingRequest) return;
  const model = (CATALOG[elements.type.value] || []).find((item) => item.id === modelId);
  if (!model) return;
  if (state.model && !state.restoring) { rememberWorkspace(); flushWorkspace(); }
  state.model = model;
  state.api = null;
  state.viewerReady = false;
  state.initialCamera = null;
  state.cameraBusy = false;
  updateCameraControls();
  state.historyLoading = true;
  elements.iframe.classList.remove("is-ready");
  state.materials.clear();
  state.history = [];
  state.historyIndex = -1;
  historySequence++;
  state.applyingHistory = false;
  state.currentTexture = null;
  state.logos = [];
  state.selectedLogoId = null;
  logoRenderSequence++;
  clearTimeout(logoRenderTimer);
  elements.prompt.value = "";
  elements.requestMessage.value = "";
  elements.logoEditor.hidden = true;
  document.querySelector("#stageModelName").textContent = model.name;
  elements.designStatus.textContent = "Draft";
  elements.designStatus.classList.remove("is-executive");
  renderLogoEditor();
  renderMaterialControls();
  updateHistoryUI();
  updateReview();
  bootViewer(model);
}

function bootViewer(model) {
  const sequence = ++state.bootSequence;
  elements.generate.disabled = true;

  if (!window.Sketchfab) {
    setStatus("The 3D viewer library could not be loaded.", true);
    return;
  }

  const client = new window.Sketchfab("1.12.1", elements.iframe);
  client.init(model.sketchfabUid, {
    autostart: 1,
    preload: matchMedia("(pointer: coarse)").matches ? 0 : 1,
    dnt: 1,
    transparent: 1,
    camera: 0,
    navigation: "orbit",
    scrollwheel: 1,
    orbit_constraint_pan: 0,
    ui_controls: 1,
    ui_infos: 0,
    ui_help: 0,
    ui_settings: 0,
    ui_inspector: 0,
    ui_annotations: 0,
    ui_animations: 0,
    ui_ar: 0,
    ui_vr: 0,
    ui_fullscreen: 0,
    ui_stop: 0,
    ui_watermark: 0,
    ui_watermark_link: 0,
    success(api) {
      if (sequence !== state.bootSequence) return;
      state.api = api;
      api.start();
      api.addEventListener("viewerready", () => {
        if (sequence !== state.bootSequence) return;
        api.getCameraLookAt((error, camera) => {
          if (sequence !== state.bootSequence) return;
          state.initialCamera = error ? null : copyCamera(camera);
          updateCameraControls();
        });
        api.getMaterialList(async (error, materials) => {
          if (error) {
            setStatus("The jacket materials could not be loaded.", true);
            return;
          }
          state.materials = new Map(materials.map((material) => [material.name, material]));
          try {
            await resetDesignMaterial(model.designMaterial);
          } catch (resetError) {
            console.warn("The default design texture could not be cleared", resetError);
          }
          if (sequence !== state.bootSequence) return;
          state.viewerReady = true;
          updateCameraControls();
          elements.iframe.classList.add("is-ready");
          updatePromptState();
          syncMaterialColors();
          state.defaultColors = [...elements.materialControls.querySelectorAll(".color-picker")].map((picker) => picker.dataset.color);
          loadHistory();
        });
      });
    },
    error() {
      if (sequence !== state.bootSequence) return;
      setStatus("The 3D model could not be initialized.", true);
    }
  });
}

function renderMaterialControls() {
  elements.materialControls.innerHTML = state.model.materials.map((item, index) => `
    <div class="material-row">
      <span class="material-label" id="material-label-${index}">${item.label}</span>
      <div class="color-picker" data-material="${item.material}" data-label="${item.label}" data-color="#ffffff">
        <button class="color-picker__trigger" id="material-${index}" type="button" aria-label="${item.label} color, Snow" aria-expanded="false" aria-controls="material-menu-${index}">
          <span class="color-picker__swatch" style="--swatch:#ffffff" aria-hidden="true"></span>
          <span class="color-picker__value">Snow</span>
          <span class="color-picker__chevron" aria-hidden="true">⌄</span>
        </button>
        <div class="color-picker__menu" id="material-menu-${index}" role="listbox" aria-labelledby="material-label-${index}" hidden>
          <span class="color-picker__menu-title">Choose a color</span>
          <div class="color-picker__grid">
            ${COLORS.map(([name, value]) => `<button class="color-option" type="button" role="option" aria-label="${name}" aria-selected="${value === "#ffffff"}" data-color="${value}" style="--swatch:${value}" title="${name}"></button>`).join("")}
          </div>
        </div>
      </div>
    </div>
  `).join("");

  elements.materialControls.querySelectorAll(".color-picker").forEach((picker) => {
    const trigger = picker.querySelector(".color-picker__trigger");
    const menu = picker.querySelector(".color-picker__menu");
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      const shouldOpen = menu.hidden;
      closeColorPickers();
      closeSelectPickers();
      if (shouldOpen) {
        menu.hidden = false;
        picker.classList.add("is-open");
        trigger.setAttribute("aria-expanded", "true");
      }
    });
    picker.querySelectorAll(".color-option").forEach((option) => {
      option.addEventListener("click", (event) => {
        event.stopPropagation();
        setPickerColor(picker, option.dataset.color);
        applyColor(picker.dataset.material, option.dataset.color);
        rememberWorkspace();
        closeColorPickers();
        trigger.focus();
      });
    });
    wirePickerKeyboard(picker, ".color-option", 7);
  });
}

function syncMaterialColors() {
  elements.materialControls.querySelectorAll(".color-picker").forEach((picker) => {
    const material = findMaterial(picker.dataset.material);
    const channel = material && getColorChannel(material);
    const color = channel?.color;
    if (!Array.isArray(color)) return;
    const hex = rgbToHex(color);
    const closest = COLORS.reduce((best, entry) => colorDistance(hex, entry[1]) < colorDistance(hex, best[1]) ? entry : best, COLORS[0]);
    setPickerColor(picker, closest[1]);
  });
}

function setPickerColor(picker, hex) {
  const entry = COLORS.find(([, value]) => value === hex) || COLORS[0];
  picker.dataset.color = entry[1];
  picker.querySelector(".color-picker__swatch").style.setProperty("--swatch", entry[1]);
  picker.querySelector(".color-picker__value").textContent = entry[0];
  picker.querySelector(".color-picker__trigger").setAttribute("aria-label", `${picker.dataset.label} color, ${entry[0]}`);
  picker.querySelectorAll(".color-option").forEach((option) => {
    option.setAttribute("aria-selected", String(option.dataset.color === entry[1]));
  });
  if (state.activeTab === "review") updateReview();
}

function closeColorPickers() {
  elements.materialControls.querySelectorAll(".color-picker.is-open").forEach((picker) => {
    picker.classList.remove("is-open");
    picker.querySelector(".color-picker__trigger").setAttribute("aria-expanded", "false");
    picker.querySelector(".color-picker__menu").hidden = true;
  });
}

function renderSelectPicker(select) {
  const picker = document.querySelector(`.select-picker[data-select="${select.id}"]`);
  if (!picker) return;
  const trigger = picker.querySelector(".select-picker__trigger");
  const value = picker.querySelector(".select-picker__value");
  const menu = picker.querySelector(".select-picker__menu");
  const options = [...select.options];
  const selected = options.find((option) => option.value === select.value) || options[0];

  value.textContent = selected?.textContent || "Select";
  trigger.disabled = select.disabled || options.length === 0;
  trigger.setAttribute("aria-expanded", "false");
  picker.classList.remove("is-open");
  menu.hidden = true;
  menu.innerHTML = options.map((option) => `
    <button class="select-picker__option" type="button" role="option" aria-selected="${option.value === selected?.value}" data-value="${option.value}">
      <span>${option.textContent}</span><i aria-hidden="true">✓</i>
    </button>
  `).join("");

  trigger.onclick = (event) => {
    event.stopPropagation();
    const shouldOpen = menu.hidden;
    closeSelectPickers();
    closeColorPickers();
    if (shouldOpen) {
      menu.hidden = false;
      picker.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
    }
  };

  menu.querySelectorAll(".select-picker__option").forEach((option) => {
    option.addEventListener("click", (event) => {
      event.stopPropagation();
      select.value = option.dataset.value;
      value.textContent = option.querySelector("span").textContent;
      menu.querySelectorAll(".select-picker__option").forEach((item) => {
        item.setAttribute("aria-selected", String(item === option));
      });
      closeSelectPickers();
      select.dispatchEvent(new Event("change"));
      trigger.focus();
    });
  });
  wirePickerKeyboard(picker, ".select-picker__option", 1);
}

function wirePickerKeyboard(picker, optionSelector, columns) {
  picker.onkeydown = (event) => {
    const trigger = picker.querySelector("button");
    const menu = picker.querySelector('[role="listbox"]');
    const options = [...menu.querySelectorAll(optionSelector)];
    if (!options.length) return;
    if (event.target === trigger && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      if (menu.hidden) trigger.click();
      (options.find((option) => option.getAttribute("aria-selected") === "true") || options[0]).focus();
      return;
    }
    const index = options.indexOf(document.activeElement);
    if (index < 0) return;
    if (event.key === "Escape") { event.preventDefault(); closeColorPickers(); closeSelectPickers(); trigger.focus(); return; }
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const delta = { ArrowDown: columns, ArrowUp: -columns, ArrowLeft: -1, ArrowRight: 1 }[event.key];
    const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (index + delta + options.length) % options.length;
    options[next].focus();
  };
}

function closeSelectPickers() {
  document.querySelectorAll(".select-picker.is-open").forEach((picker) => {
    picker.classList.remove("is-open");
    picker.querySelector(".select-picker__trigger").setAttribute("aria-expanded", "false");
    picker.querySelector(".select-picker__menu").hidden = true;
  });
}

function applyColor(materialName, hex) {
  const material = findMaterial(materialName);
  if (!state.api || !material) return;
  const channelName = getColorChannelName(material);
  const channel = { ...(material.channels[channelName] || {}) };
  channel.enable = true;
  channel.factor = typeof channel.factor === "number" ? channel.factor : 1;
  channel.color = hexToRgb(hex);
  delete channel.texture;
  material.channels = { ...material.channels, [channelName]: channel };
  state.api.setMaterial(material, (error) => error && console.warn("Material color update failed", error));
}

function resetDesignMaterial(materialName) {
  const material = findMaterial(materialName);
  if (!state.api || !material) return Promise.resolve();
  const channelName = getColorChannelName(material);
  const channel = { ...(material.channels[channelName] || {}) };
  channel.enable = true;
  channel.factor = typeof channel.factor === "number" ? channel.factor : 1;
  channel.color = [1, 1, 1];
  delete channel.texture;
  material.channels = { ...material.channels, [channelName]: channel };
  return new Promise((resolve, reject) => {
    state.api.setMaterial(material, (error) => error ? reject(error) : resolve());
  });
}

async function generateDesign() {
  const prompt = elements.prompt.value.trim();
  if (prompt.length < 3 || !state.viewerReady || state.historyLoading || state.generating || state.applyingHistory || state.submittingRequest) return;

  setGenerating(true);
  try {
    const response = await apiFetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, modelId: state.model.id })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Generation failed.");
    state.history.unshift(payload.design);
    state.historyIndex = 0;
    if (payload.usage) state.usage = payload.usage;
    await applyDesign(payload.design, { fresh: true });
    rememberWorkspace();
    setStatus("Texture generated and projected onto the jacket.");
  } catch (error) {
    setStatus(error.message || "Generation failed.", true);
  } finally {
    setGenerating(false);
    updateHistoryUI();
  }
}

function workspaceKey(modelId = state.model?.id, designId = state.currentTexture?.id) {
  return designId || `base:${modelId}`;
}

function cacheWorkspace() {
  try { localStorage.setItem(`vitalini_workspace_v2:${state.user.id}`, JSON.stringify(draftCache)); }
  catch { /* Account storage remains available when browser storage is full. */ }
}

function rememberWorkspace() {
  if (state.restoring || state.applyingHistory || state.historyLoading || !state.model || !state.user) return;
  const snapshot = { modelId: state.model.id, designId: state.currentTexture?.id || null, edit: {
    logos: state.logos.map(({ id, instanceId, x, y, size, rotation }) => ({ id, instanceId, x, y, size, rotation })),
    colors: [...elements.materialControls.querySelectorAll(".color-picker")].map((picker) => picker.dataset.color),
    message: elements.requestMessage.value, prompt: elements.prompt.value
  } };
  const key = workspaceKey(snapshot.modelId, snapshot.designId);
  draftCache.last = snapshot;
  draftCache.edits[key] = snapshot.edit;
  draftCache.pending[key] = snapshot;
  cacheWorkspace();
  document.querySelector("#workspaceSaveStatus").textContent = "Saving…";
  clearTimeout(workspaceTimer);
  workspaceTimer = setTimeout(flushWorkspace, 250);
}

function flushWorkspace() {
  clearTimeout(workspaceTimer);
  const entries = Object.entries(draftCache.pending);
  const lastKey = draftCache.last && workspaceKey(draftCache.last.modelId, draftCache.last.designId);
  entries.sort(([a], [b]) => Number(a === lastKey) - Number(b === lastKey));
  for (const [key, snapshot] of entries) {
    const serialized = JSON.stringify(snapshot);
    workspaceQueue = workspaceQueue.then(async () => {
      try {
        const response = await apiFetch("/api/workspace", { method: "POST", keepalive: true,
          headers: { "content-type": "application/json" }, body: serialized });
        if (!response.ok) throw new Error("Save failed");
        if (JSON.stringify(draftCache.pending[key]) === serialized) delete draftCache.pending[key];
        cacheWorkspace();
        document.querySelector("#workspaceSaveStatus").textContent = Object.keys(draftCache.pending).length ? "Saving…" : "Saved automatically";
      } catch {
        document.querySelector("#workspaceSaveStatus").textContent = "Saved on this device. Account sync pending.";
      }
    });
  }
  return workspaceQueue;
}

async function restoreWorkspace() {
  try { const local = JSON.parse(localStorage.getItem(`vitalini_workspace_v2:${state.user.id}`));
    if (local?.edits && local?.pending) draftCache = local; } catch { /* No local draft. */ }
  const [saved, library] = await Promise.all([
    apiFetch("/api/workspace").then((r) => r.ok ? r.json() : null).catch(() => null),
    apiFetch("/api/logos").then((r) => r.ok ? r.json() : null).catch(() => null)
  ]);
  state.library = library?.logos || [];
  state.restoreTarget = Object.keys(draftCache.pending).length ? draftCache.last : saved?.workspace || draftCache.last;
  const modelId = state.restoreTarget?.modelId;
  if (CATALOG.Jackets.some((model) => model.id === modelId)) elements.model.value = modelId;
  renderSelectPicker(elements.model);
  switchModel(elements.model.value);
}

async function savedEdit(designId) {
  const key = workspaceKey(state.model.id, designId);
  if (draftCache.pending[key]) return draftCache.pending[key].edit;
  try {
    const response = await apiFetch(`/api/workspace?model_id=${state.model.id}&design_id=${designId || ""}`);
    if (response.ok) return (await response.json()).workspace?.edit || null;
  } catch { /* Use the locally saved edit when offline. */ }
  return draftCache.edits[key] || null;
}

async function restoreEdit(edit, guard) {
  const logos = await Promise.all((edit?.logos || []).map(async (placement) => {
    const asset = await getLogoAsset(placement.id);
    return { ...asset, ...placement, instanceId: placement.instanceId || crypto.randomUUID(), rotation: placement.rotation || 0 };
  }));
  if (guard && (guard.sequence !== historySequence || guard.boot !== state.bootSequence)) return false;
  state.logos = logos;
  state.selectedLogoId = logos[0]?.instanceId || null;
  elements.logoEditor.hidden = !logos.length;
  elements.requestMessage.value = edit?.message || "";
  elements.prompt.value = edit?.prompt || "";
  [...elements.materialControls.querySelectorAll(".color-picker")].forEach((picker, index) => {
    const color = edit?.colors?.[index] || state.defaultColors?.[index] || "#ffffff";
    setPickerColor(picker, color); applyColor(picker.dataset.material, color);
  });
  renderLogoLayers();
  return true;
}

async function loadHistory() {
  const modelId = state.model.id;
  const sequence = state.bootSequence;
  try {
    const response = await apiFetch(`/api/designs?model_id=${encodeURIComponent(modelId)}`);
    if (!response.ok) throw new Error("History is unavailable.");
    const payload = await response.json();
    if (sequence !== state.bootSequence) return;
    state.history = payload.designs || [];
    state.historyIndex = -1;
  } catch {
    if (sequence !== state.bootSequence) return;
    state.history = [];
    state.historyIndex = -1;
  }
  if (sequence !== state.bootSequence) return;
  state.historyLoading = false;
  updatePromptState();
  updateHistoryUI();
  const target = state.restoreTarget;
  state.restoreTarget = null;
  if (target?.modelId === modelId) {
    const index = state.history.findIndex((item) => item.id === target.designId);
    if (index >= 0) await showHistory(index);
    else { await restoreEdit(target.edit || await savedEdit(null)); await renderLogoEditor(); }
  } else { await restoreEdit(await savedEdit(null)); await renderLogoEditor(); }
  if (sequence !== state.bootSequence) return;
  state.restoring = false;
  updatePromptState();
  updateHistoryUI();
  rememberWorkspace();
  if (state.activeTab === "logos") renderLogoLibrary();
  updateRequestState();
}

async function showHistory(index) {
  if (index < -1 || index >= state.history.length || state.generating || state.applyingHistory || state.submittingRequest) return;
  rememberWorkspace();
  state.applyingHistory = true;
  clearTimeout(logoRenderTimer);
  logoRenderSequence++;
  const sequence = ++historySequence;
  const boot = state.bootSequence;
  updatePromptState();
  updateHistoryUI();
  await flushWorkspace();
  if (index === -1) {
    state.historyIndex = -1;
    state.currentTexture = null;
    updateHistoryUI();
    updateRequestState();
    elements.designStatus.textContent = "Draft";
    elements.designStatus.classList.remove("is-executive");
    try {
      await resetDesignMaterial(state.model.designMaterial);
      await restoreEdit(await savedEdit(null), { sequence, boot });
      renderLogoEditor();
      setStatus("Blank jacket ready. Use the back arrow to revisit saved designs.");
    } catch {
      setStatus("The blank jacket could not be restored.", true);
    }
    state.applyingHistory = false;
    rememberWorkspace();
    updatePromptState();
    updateHistoryUI();
    updateReview();
    return;
  }
  state.historyIndex = index;
  updateHistoryUI();
  setStatus("Applying saved texture…");
  try {
    await applyDesign(state.history[index], { sequence, boot });
    setStatus(`Showing design ${state.history.length - index} of ${state.history.length}.`);
  } catch (error) {
    setStatus(error.message || "Saved design could not be loaded.", true);
  } finally {
    if (sequence === historySequence && boot === state.bootSequence) {
      state.applyingHistory = false;
      rememberWorkspace();
      updatePromptState();
      updateHistoryUI();
    }
  }
}

async function applyDesign(design, guard) {
  const edit = guard?.fresh ? null : await savedEdit(design.id);
  const response = await apiFetch(design.imageUrl);
  if (!response.ok) throw new Error("Texture image is unavailable.");
  const blob = await response.blob();
  const dataUrl = await blobToDataUrl(blob);
  const baseImage = await loadImage(dataUrl);
  if (guard && !guard.fresh && (guard.sequence !== historySequence || guard.boot !== state.bootSequence)) return;
  if (!guard?.fresh && !await restoreEdit(edit, guard)) return;
  state.currentTexture = { dataUrl, baseDataUrl: dataUrl, baseImage, prompt: design.prompt, id: design.id, status: design.status || "draft" };
  if (state.logos.length) {
    await renderLogoComposite(true);
  } else {
    await applyTexture(state.model.designMaterial, dataUrl);
    await renderLogoEditor();
  }
  elements.prompt.value = design.prompt || elements.prompt.value;
  if (edit?.prompt) elements.prompt.value = edit.prompt;
  elements.designStatus.textContent = state.currentTexture.status === "executive" ? "Executive" : "Draft";
  elements.designStatus.classList.toggle("is-executive", state.currentTexture.status === "executive");
  updatePromptState();
  updateRequestState();
  updateReview();
}

function applyTexture(materialName, dataUrl) {
  if (!state.api) return Promise.reject(new Error("The 3D viewer is not ready."));
  return new Promise((resolve, reject) => {
    state.api.addTexture(dataUrl, (textureError, textureUid) => {
      if (textureError) return reject(new Error("The generated texture could not be loaded."));
      state.api.getMaterialList((listError, materials) => {
        if (listError) return reject(listError);
        state.materials = new Map(materials.map((material) => [material.name, material]));
        const material = findMaterial(materialName);
        if (!material) return reject(new Error(`Material “${materialName}” was not found in this model.`));
        const channelName = getColorChannelName(material);
        const channel = { ...(material.channels[channelName] || {}) };
        channel.enable = true;
        channel.factor = typeof channel.factor === "number" ? channel.factor : 1;
        channel.texture = { uid: textureUid };
        channel.color = [1, 1, 1];
        material.channels = { ...material.channels, [channelName]: channel };
        state.api.setMaterial(material, (setError) => setError ? reject(setError) : resolve());
      });
    });
  });
}

function findMaterial(name) {
  if (state.materials.has(name)) return state.materials.get(name);
  const normalized = name.toLowerCase();
  return [...state.materials.entries()].find(([key]) => key.toLowerCase() === normalized || key.toLowerCase().includes(normalized))?.[1] || null;
}

function getColorChannelName(material) {
  const channels = material.channels || {};
  return ["AlbedoPBR", "DiffusePBR", "DiffuseColor", "BaseColor", "AlbedoColor"].find((key) => channels[key]) || "AlbedoPBR";
}

function getColorChannel(material) {
  return material.channels?.[getColorChannelName(material)];
}

function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (sessionToken) headers.set("authorization", `Bearer ${sessionToken}`);
  return fetch(`${API_BASE}${path}`, { ...options, headers, cache: "no-store" });
}

function publicApiFetch(path, options = {}) {
  return fetch(`${API_BASE}${path}`, { ...options, cache: "no-store" });
}

function setGenerating(value) {
  state.generating = value;
  elements.generate.classList.toggle("is-loading", value);
  elements.generate.querySelector("span").textContent = value ? "Generating design…" : "Generate design";
  updatePromptState();
  document.querySelector("#generationProgress").hidden = !value;
  elements.prompt.disabled = value;
  document.querySelectorAll("[data-prompt]").forEach((button) => { button.disabled = value; });
  clearInterval(generationClock);
  if (value) {
    generationStartedAt = Date.now();
    updateGenerationClock();
    generationClock = setInterval(updateGenerationClock, 1000);
  }
}

function updateGenerationClock() {
  const elapsed = Math.floor((Date.now() - generationStartedAt) / 1000);
  document.querySelector("#generationElapsed").textContent = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  document.querySelector("#generationPhase").textContent = elapsed < 18 ? "Translating your design direction…" : elapsed < 65 ? "Creating your jacket artwork…" : "Still working. Detailed designs can take a little longer.";
}

function setStatus(message, isError = false) {
  clearTimeout(state.statusTimer);
  elements.status.textContent = message;
  elements.status.classList.toggle("is-error", isError);
  elements.status.classList.toggle("is-visible", Boolean(message));
  if (message && !isError) {
    state.statusTimer = setTimeout(() => elements.status.classList.remove("is-visible"), 3200);
  }
}

function updatePromptState() {
  elements.promptCount.textContent = `${elements.prompt.value.length} / 800`;
  const busy = state.generating || state.applyingHistory || state.submittingRequest || state.historyLoading || state.restoring;
  elements.generate.disabled = busy || state.historyLoading || !state.viewerReady || elements.prompt.value.trim().length < 3;
  [elements.type, elements.model].forEach((select) => {
    select.disabled = busy;
    const trigger = document.querySelector(`.select-picker[data-select="${select.id}"] .select-picker__trigger`);
    if (trigger) trigger.disabled = busy || select.options.length === 0;
  });
  document.querySelectorAll("[data-prompt]").forEach((button) => button.classList.toggle("is-selected", button.dataset.prompt === elements.prompt.value));
  elements.logoUpload.disabled = busy;
  elements.logoSize.disabled = busy;
  elements.logoRotation.disabled = busy;
}

function updateHistoryUI() {
  const total = state.history.length;
  const position = state.historyIndex < 0 ? 0 : total - state.historyIndex;
  elements.historyPosition.textContent = `${position} / ${total}`;
  elements.previous.disabled = state.generating || state.applyingHistory || state.submittingRequest || state.historyLoading || !total || state.historyIndex >= total - 1;
  elements.next.disabled = state.generating || state.applyingHistory || state.submittingRequest || state.historyLoading || state.historyIndex < 0;
  updateRequestState();
}

async function handleLogoUpload() {
  const file = elements.logoInput.files?.[0];
  if (!file) return;
  if (state.logos.length >= 8) {
    setStatus("You can place up to eight logos on one design.", true);
    elements.logoInput.value = "";
    return;
  }
  if (!(["image/png", "image/jpeg", "image/webp"].includes(file.type)) || file.size > 5 * 1024 * 1024) {
    setStatus("Use a PNG, JPEG, or WebP logo up to 5 MB.", true);
    elements.logoInput.value = "";
    return;
  }

  elements.logoUpload.disabled = true;
  elements.logoUpload.textContent = "Uploading logo…";
  try {
    const dataUrl = await fileToDataUrl(file);
    const image = await loadImage(dataUrl);
    const form = new FormData();
    form.append("logo", file);
    const response = await apiFetch("/api/logos", { method: "POST", body: form });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Logo upload failed.");
    const asset = { id: payload.logo.id, name: payload.logo.name || file.name, image, dataUrl };
    logoAssets.set(asset.id, Promise.resolve(asset));
    state.library.unshift({ ...payload.logo, name: asset.name });
    await addLogoAsset(asset.id);
    renderLogoLibrary();
  } catch (error) {
    setStatus(error.message || "Logo upload failed.", true);
  } finally {
    elements.logoUpload.disabled = false;
    elements.logoUpload.textContent = state.logos.length ? "Add another logo" : "Add logo";
    elements.logoInput.value = "";
  }
}

function selectedLogo() {
  return state.logos.find((logo) => logo.instanceId === state.selectedLogoId) || null;
}

async function getLogoAsset(id) {
  if (!logoAssets.has(id)) logoAssets.set(id, (async () => {
    const entry = state.library.find((logo) => logo.id === id);
    const response = await apiFetch(`/api/logos/${encodeURIComponent(id)}/file`);
    if (!response.ok) throw new Error("Saved logo could not be loaded.");
    const dataUrl = await blobToDataUrl(await response.blob());
    return { id, name: entry?.name || "Logo", dataUrl, image: await loadImage(dataUrl) };
  })().catch((error) => { logoAssets.delete(id); throw error; }));
  return logoAssets.get(id);
}

async function renderLogoLibrary() {
  if (state.activeTab !== "logos") return;
  document.querySelector("#logoLibraryEmpty").hidden = !!state.library.length;
  elements.logoLibrary.innerHTML = state.library.map((entry) => `<button type="button" class="logo-library__item" data-library-id="${entry.id}" aria-label="${escapeMarkup(t("Add saved logo") + ": " + entry.name)}"><span class="logo-library__thumbnail"><img alt="" hidden><b aria-hidden="true">+</b></span><span data-no-translate>${escapeMarkup(entry.name)}</span></button>`).join("");
  for (const button of elements.logoLibrary.querySelectorAll("[data-library-id]")) {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try { await addLogoAsset(button.dataset.libraryId); }
      catch (error) { setStatus(error.message, true); }
      finally { button.disabled = false; }
    });
    getLogoAsset(button.dataset.libraryId).then((asset) => {
      if (!button.isConnected) return;
      const image = button.querySelector("img"); image.src = asset.dataUrl; image.hidden = false;
    }).catch(() => { /* The add action reports a failed download. */ });
  }
}

async function addLogoAsset(id) {
  if (state.restoring || state.historyLoading || state.applyingHistory || state.submittingRequest) return;
  if (state.logos.length >= 8) { setStatus("You can place up to eight logos on one design.", true); return; }
  const modelId = state.model.id, designId = state.currentTexture?.id;
  const asset = await getLogoAsset(id);
  if (modelId !== state.model.id || designId !== state.currentTexture?.id || state.logos.length >= 8 || state.applyingHistory || state.historyLoading) return;
  const aspect = asset.image.naturalHeight / asset.image.naturalWidth || 1;
  const offset = ((state.logos.length % 3) - 1) * 7;
  const logo = { ...asset, instanceId: crypto.randomUUID(), x: 50 + offset, y: 50 + offset,
    size: Math.min(18, 68 / aspect), rotation: 0 };
  clampLogo(logo);
  state.logos.push(logo);
  state.selectedLogoId = logo.instanceId;
  elements.logoEditor.hidden = false;
  renderLogoLayers();
  rememberWorkspace();
  if (state.currentTexture) await renderLogoComposite(true);
  else await renderLogoEditor();
  setStatus("Logo added. Drag to move; use the sliders to resize or rotate.");
}

function logoMaxSize(logo) {
  const aspect = logo.image.naturalHeight / logo.image.naturalWidth || 1;
  const extent = rotatedExtent(1, aspect, logo.rotation || 0);
  return Math.max(1, Math.min(45, 88 / (2 * Math.max(extent.x, extent.y))));
}

function clampLogo(logo) {
  const aspect = logo.image.naturalHeight / logo.image.naturalWidth || 1;
  logo.size = Math.max(1, Math.min(logoMaxSize(logo), Number(logo.size) || 18));
  logo.rotation = normalizeRotation(logo.rotation);
  const extent = rotatedExtent(logo.size, aspect, logo.rotation);
  logo.x = Math.max(extent.x, Math.min(100 - extent.x, Number.isFinite(logo.x) ? logo.x : 50));
  logo.y = Math.max(extent.y, Math.min(100 - extent.y, Number.isFinite(logo.y) ? logo.y : 50));
}

function selectLogo(id) {
  if (!state.logos.some((logo) => logo.instanceId === id)) return;
  state.selectedLogoId = id;
  renderLogoLayers();
  renderLogoEditor();
}

function renderLogoLayers() {
  elements.logoLayerList.innerHTML = state.logos.map((logo, index) => `
    <div class="logo-layer${logo.instanceId === state.selectedLogoId ? " is-selected" : ""}">
      <button class="logo-layer__select" type="button" data-logo-id="${logo.instanceId}" aria-pressed="${logo.instanceId === state.selectedLogoId}"><img src="${logo.dataUrl}" alt=""><span data-no-translate>${escapeMarkup(logo.name || `Logo ${index + 1}`)}</span></button>
      <button class="logo-layer__remove" type="button" data-remove-logo="${logo.instanceId}" aria-label="${escapeMarkup(t("Remove logo") + ": " + logo.name)}">×</button>
    </div>`).join("");
  elements.logoLayerList.querySelectorAll("[data-logo-id]").forEach((button) => button.addEventListener("click", () => selectLogo(button.dataset.logoId)));
  elements.logoLayerList.querySelectorAll("[data-remove-logo]").forEach((button) => button.addEventListener("click", () => removeLogo(button.dataset.removeLogo)));
  const logo = selectedLogo();
  elements.logoName.textContent = logo?.name || "Selected logo";
  if (logo) {
    elements.logoSize.max = String(logoMaxSize(logo));
    elements.logoSize.value = String(logo.size);
    document.querySelector("#logoSizeValue").textContent = `${Math.round(logo.size)}%`;
    elements.logoRotation.value = String(Math.round(logo.rotation || 0));
    document.querySelector("#logoRotationValue").textContent = `${Math.round(logo.rotation || 0)}°`;
  }
}

function updateLogoSize() {
  const logo = selectedLogo();
  if (!logo) return;
  logo.size = Number(elements.logoSize.value);
  clampLogo(logo);
  elements.logoSize.value = String(logo.size);
  document.querySelector("#logoSizeValue").textContent = `${Math.round(logo.size)}%`;
  renderLogoEditor();
  scheduleLogoComposite();
  rememberWorkspace();
}

function updateLogoRotation() {
  const logo = selectedLogo();
  if (!logo) return;
  logo.rotation = Number(elements.logoRotation.value);
  clampLogo(logo);
  renderLogoLayers();
  renderLogoEditor();
  scheduleLogoComposite();
  rememberWorkspace();
}

function scheduleLogoComposite() {
  clearTimeout(logoRenderTimer);
  logoRenderTimer = setTimeout(() => {
    if (state.currentTexture) renderLogoComposite(true).catch((error) => setStatus(error.message, true));
  }, 170);
}

async function removeLogo(instanceId = state.selectedLogoId) {
  const index = state.logos.findIndex((logo) => logo.instanceId === instanceId);
  if (index < 0) return;
  state.logos.splice(index, 1);
  state.selectedLogoId = state.logos[Math.min(index, state.logos.length - 1)]?.instanceId || null;
  elements.logoEditor.hidden = state.logos.length === 0;
  elements.logoUpload.textContent = state.logos.length ? "Add another logo" : "Add logo";
  renderLogoLayers();
  rememberWorkspace();
  if (state.currentTexture) {
    try { await renderLogoComposite(true); } catch (error) { setStatus(error.message || "Logo could not be removed.", true); }
  } else {
    await renderLogoEditor();
  }
  setStatus("Logo removed from this design.");
}

async function renderLogoComposite(applyToModel) {
  if (!state.currentTexture?.baseDataUrl) return null;
  const sequence = ++logoRenderSequence;
  const texture = state.currentTexture;
  const dataUrl = await composeCurrentTexture("image/png");
  if (sequence !== logoRenderSequence || texture !== state.currentTexture) return null;
  state.currentTexture.dataUrl = dataUrl;
  if (applyToModel) await applyTexture(state.model.designMaterial, dataUrl);
  await renderLogoEditor();
  updateReview();
  return dataUrl;
}

async function composeCurrentTexture(type = "image/png", quality) {
  if (!state.currentTexture?.baseDataUrl) return null;
  const base = state.currentTexture.baseImage || await loadImage(state.currentTexture.baseDataUrl);
  state.currentTexture.baseImage = base;
  const canvas = document.createElement("canvas");
  canvas.width = base.naturalWidth || base.width;
  canvas.height = base.naturalHeight || base.height;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(base, 0, 0, canvas.width, canvas.height);
  for (const logo of state.logos) {
    clampLogo(logo);
    const aspect = logo.image.naturalHeight / logo.image.naturalWidth || 1;
    const width = canvas.width * (logo.size / 100);
    const height = width * aspect;
    const centerX = canvas.width * (logo.x / 100);
    const centerY = canvas.height * (logo.y / 100);
    context.save();
    context.translate(centerX, centerY);
    context.rotate((logo.rotation || 0) * Math.PI / 180);
    context.drawImage(logo.image, -width / 2, -height / 2, width, height);
    context.restore();
  }
  return canvas.toDataURL(type, quality);
}

function getLogoRect(logo, width = elements.logoPreview.width, height = elements.logoPreview.height) {
  const aspect = logo.image.naturalHeight / logo.image.naturalWidth || 1;
  const logoWidth = width * (logo.size / 100);
  const logoHeight = logoWidth * aspect;
  const centerX = width * (logo.x / 100);
  const centerY = height * (logo.y / 100);
  return { x: centerX - logoWidth / 2, y: centerY - logoHeight / 2, width: logoWidth, height: logoHeight, centerX, centerY };
}

async function renderLogoEditor() {
  const context = elements.logoPreview.getContext("2d");
  context.clearRect(0, 0, elements.logoPreview.width, elements.logoPreview.height);
  context.fillStyle = "#f4f3ef";
  context.fillRect(0, 0, elements.logoPreview.width, elements.logoPreview.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  if (state.currentTexture?.baseDataUrl) {
    try {
      const base = state.currentTexture.baseImage || await loadImage(state.currentTexture.baseDataUrl);
      state.currentTexture.baseImage = base;
      context.drawImage(base, 0, 0, elements.logoPreview.width, elements.logoPreview.height);
    } catch { /* Keep the neutral preview background. */ }
  }
  for (const logo of state.logos) {
    const rect = getLogoRect(logo);
    context.save();
    context.translate(rect.centerX, rect.centerY);
    context.rotate((logo.rotation || 0) * Math.PI / 180);
    context.drawImage(logo.image, -rect.width / 2, -rect.height / 2, rect.width, rect.height);
    if (logo.instanceId === state.selectedLogoId) {
      context.save();
      context.strokeStyle = "rgba(255,255,255,.96)";
      context.lineWidth = 7;
      context.strokeRect(-rect.width / 2, -rect.height / 2, rect.width, rect.height);
      context.strokeStyle = "#171716";
      context.lineWidth = 3;
      context.setLineDash([12, 9]);
      context.strokeRect(-rect.width / 2, -rect.height / 2, rect.width, rect.height);
      context.restore();
    }
    context.restore();
  }
  if (!state.currentTexture && state.logos.length === 0) {
    context.fillStyle = "#8a8983";
    context.font = "32px system-ui";
    context.textAlign = "center";
    context.fillText(t("Open or generate a design first"), elements.logoPreview.width / 2, elements.logoPreview.height / 2);
  }
}

function previewPoint(event) {
  const bounds = elements.logoPreview.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) * (elements.logoPreview.width / bounds.width),
    y: (event.clientY - bounds.top) * (elements.logoPreview.height / bounds.height)
  };
}

function beginLogoDrag(event) {
  if (event.button !== 0 || state.generating || state.applyingHistory || state.submittingRequest || state.logoDrag) return;
  const point = previewPoint(event);
  const logo = [...state.logos].reverse().find((item) => {
    const rect = getLogoRect(item);
    const local = logoLocalPoint(point, rect, item.rotation || 0);
    return Math.abs(local.x) <= rect.width / 2 && Math.abs(local.y) <= rect.height / 2;
  });
  if (!logo) return;
  selectLogo(logo.instanceId);
  const rect = getLogoRect(logo);
  state.logoDrag = { id: logo.instanceId, pointerId: event.pointerId,
    offsetX: point.x - rect.centerX, offsetY: point.y - rect.centerY };
  elements.logoPreview.setPointerCapture(event.pointerId);
  elements.logoPreview.classList.add("is-dragging");
  event.preventDefault();
}

function moveLogoDrag(event) {
  if (!state.logoDrag || event.pointerId !== state.logoDrag.pointerId) return;
  const logo = state.logos.find((item) => item.instanceId === state.logoDrag.id);
  if (!logo) return;
  const point = previewPoint(event);
  const drag = state.logoDrag;
  logo.x = ((point.x - drag.offsetX) / elements.logoPreview.width) * 100;
  logo.y = ((point.y - drag.offsetY) / elements.logoPreview.height) * 100;
  clampLogo(logo);
  renderLogoLayers();
  renderLogoEditor();
  scheduleLogoComposite();
  rememberWorkspace();
  event.preventDefault();
}

function endLogoDrag(event) {
  if (!state.logoDrag || event.pointerId !== state.logoDrag.pointerId) return;
  state.logoDrag = null;
  elements.logoPreview.classList.remove("is-dragging");
  if (elements.logoPreview.hasPointerCapture(event.pointerId)) elements.logoPreview.releasePointerCapture(event.pointerId);
  scheduleLogoComposite();
  rememberWorkspace();
}

function updateRequestState() {
  const messageReady = elements.requestMessage.value.trim().length >= 3;
  elements.requestButton.disabled = !state.currentTexture || !messageReady || state.generating || state.applyingHistory || state.submittingRequest;
}

async function submitDesignRequest() {
  if (!state.currentTexture || state.submittingRequest || state.generating || state.applyingHistory) return;
  const message = elements.requestMessage.value.trim();
  if (message.length < 3) return;
  state.submittingRequest = true;
  updatePromptState();
  updateHistoryUI();
  elements.requestButton.disabled = true;
  elements.requestButton.textContent = "Sending request…";
  try {
    const previewDataUrl = await composeCurrentTexture("image/jpeg", .9) || state.currentTexture.dataUrl;
    const response = await apiFetch("/api/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        designId: state.currentTexture.id,
        logoId: state.logos[0]?.id || null,
        logoIds: state.logos.map((logo) => logo.id),
        message,
        previewDataUrl,
        placement: {
          logos: state.logos.map((logo) => ({ id: logo.id, instanceId: logo.instanceId, x: logo.x, y: logo.y, size: logo.size, rotation: logo.rotation || 0, logoName: logo.name })),
          trimColors: [...elements.materialControls.querySelectorAll(".color-picker")].map((picker) => ({ label: picker.dataset.label, material: picker.dataset.material, color: picker.dataset.color }))
        }
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Request could not be sent.");
    elements.requestMessage.value = "";
    rememberWorkspace();
    setStatus("Request saved in the Vitalini admin workspace.");
    if (!elements.accountDrawer.hidden) await loadAccount();
  } catch (error) {
    setStatus(error.message || "Request could not be sent.", true);
  } finally {
    state.submittingRequest = false;
    elements.requestButton.textContent = "Submit design request";
    updateRequestState();
    updatePromptState();
    updateHistoryUI();
  }
}

async function openAccount() {
  elements.accountDrawer.hidden = false;
  elements.accountButton.setAttribute("aria-expanded", "true");
  elements.appShell.inert = true;
  elements.accountDrawer.querySelector(".account-drawer__close").focus();
  await loadAccount();
}

function closeAccount() {
  elements.accountDrawer.hidden = true;
  elements.accountButton.setAttribute("aria-expanded", "false");
  elements.appShell.inert = false;
  elements.accountButton.focus();
}

async function loadAccount() {
  try {
    const response = await apiFetch("/api/account");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Account information is unavailable.");
    state.user = payload.user;
    state.usage = payload.usage;
    elements.accountUsername.textContent = payload.user.username;
    elements.accountEmail.textContent = payload.user.email;
    elements.accountUsage.textContent = `${payload.usage.used} / ${payload.usage.limit}`;
    elements.accountDesigns.textContent = payload.counts.designs;
    elements.accountLogos.textContent = payload.counts.logos;
    elements.accountRequests.textContent = payload.counts.requests;
    elements.accountRequestList.innerHTML = payload.requests.length
      ? payload.requests.map((item) => `<div class="account-request-item"><strong>${escapeMarkup(item.status.replace("_", " "))}</strong><span data-no-translate>${escapeMarkup(item.message.slice(0, 120))}</span></div>`).join("")
      : "<div class=\"account-request-item\"><strong>No requests yet</strong><span>Your submitted design requests will appear here.</span></div>";
  } catch (error) {
    setStatus(error.message || "Account information is unavailable.", true);
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function fileToDataUrl(file) {
  return blobToDataUrl(file);
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image could not be loaded."));
    image.src = dataUrl;
  });
}

function escapeMarkup(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255];
}

function rgbToHex(rgb) {
  return `#${rgb.slice(0, 3).map((value) => Math.round(value * 255).toString(16).padStart(2, "0")).join("")}`;
}

function colorDistance(a, b) {
  const av = hexToRgb(a);
  const bv = hexToRgb(b);
  return av.reduce((sum, value, index) => sum + Math.pow(value - bv[index], 2), 0);
}

document.addEventListener("vitalini:language", () => {
  if (state.initialized) { updateReview(); renderLogoEditor(); }
});
bootstrap();
