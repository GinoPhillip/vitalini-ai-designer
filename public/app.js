const API_BASE = (window.VITALINI_API_BASE || "").replace(/\/$/, "");
const SESSION_KEY = "vitalini_client_session_v1";
let sessionToken = localStorage.getItem(SESSION_KEY) || "";
let logoRenderTimer = null;
let logoRenderSequence = 0;

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
  quality: [...document.querySelectorAll('input[name="generationPreset"]')],
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
  logoRemove: document.querySelector("#logoRemoveButton"),
  logoSize: document.querySelector("#logoSize"),
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
  statusTimer: null
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
  if (submit) submit.textContent = busy ? "Please wait…" : form === elements.loginForm ? "Sign in" : "Create approved account";
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
  try { await apiFetch("/api/auth/logout", { method: "POST" }); } catch { /* Local logout still succeeds. */ }
  closeAccount();
  clearSession();
  location.reload();
}

function initialize() {
  if (state.initialized) return;
  state.initialized = true;
  elements.type.innerHTML = Object.keys(CATALOG).map((name) => `<option value="${name}">${name}</option>`).join("");
  renderSelectPicker(elements.type);
  populateModels();

  elements.type.addEventListener("change", populateModels);
  elements.model.addEventListener("change", () => switchModel(elements.model.value));
  elements.prompt.addEventListener("input", updatePromptState);
  elements.generate.addEventListener("click", generateDesign);
  elements.previous.addEventListener("click", () => showHistory(state.historyIndex + 1));
  elements.next.addEventListener("click", () => showHistory(state.historyIndex - 1));
  elements.logoUpload.addEventListener("click", () => elements.logoInput.click());
  elements.logoInput.addEventListener("change", handleLogoUpload);
  elements.logoRemove.addEventListener("click", removeLogo);
  elements.logoSize.addEventListener("input", updateLogoSize);
  elements.logoPreview.addEventListener("pointerdown", beginLogoDrag);
  elements.logoPreview.addEventListener("pointermove", moveLogoDrag);
  elements.logoPreview.addEventListener("pointerup", endLogoDrag);
  elements.logoPreview.addEventListener("pointercancel", endLogoDrag);
  elements.requestMessage.addEventListener("input", updateRequestState);
  elements.requestButton.addEventListener("click", submitDesignRequest);
  elements.accountButton.addEventListener("click", openAccount);
  elements.logout.addEventListener("click", logout);
  document.querySelectorAll("[data-close-account]").forEach((item) => item.addEventListener("click", closeAccount));
  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      elements.prompt.value = button.dataset.prompt;
      updatePromptState();
      elements.prompt.focus();
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
    }
  });
  updatePromptState();
  updateRequestState();
}

function populateModels() {
  const models = CATALOG[elements.type.value] || [];
  elements.model.innerHTML = models.map((model) => `<option value="${model.id}">${model.name}</option>`).join("");
  renderSelectPicker(elements.model);
  if (models[0]) switchModel(models[0].id);
}

function switchModel(modelId) {
  const model = (CATALOG[elements.type.value] || []).find((item) => item.id === modelId);
  if (!model) return;
  state.model = model;
  state.api = null;
  state.materials.clear();
  state.history = [];
  state.historyIndex = -1;
  state.currentTexture = null;
  renderLogoEditor();
  renderMaterialControls();
  updateHistoryUI();
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
    preload: 1,
    dnt: 1,
    transparent: 1,
    camera: 0,
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
          elements.generate.disabled = !elements.prompt.value.trim();
          syncMaterialColors();
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
        closeColorPickers();
        trigger.focus();
      });
    });
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
  if (!prompt || !state.api || state.generating) return;
  const renderPreset = elements.quality.find((option) => option.checked)?.value || "medium-1536";

  setGenerating(true);
  setStatus("Creating a production-ready UV texture. This can take up to two minutes.");
  try {
    const response = await apiFetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, modelId: state.model.id, renderPreset })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Generation failed.");
    state.history.unshift(payload.design);
    state.historyIndex = 0;
    if (payload.usage) state.usage = payload.usage;
    await applyDesign(payload.design);
    setStatus("Texture generated and projected onto the jacket.");
  } catch (error) {
    setStatus(error.message || "Generation failed.", true);
  } finally {
    setGenerating(false);
    updateHistoryUI();
  }
}

async function loadHistory() {
  try {
    const response = await apiFetch(`/api/designs?model_id=${encodeURIComponent(state.model.id)}`);
    if (!response.ok) throw new Error("History is unavailable.");
    const payload = await response.json();
    state.history = payload.designs || [];
    state.historyIndex = -1;
  } catch {
    state.history = [];
    state.historyIndex = -1;
  }
  updateHistoryUI();
}

async function showHistory(index) {
  if (index < -1 || index >= state.history.length || state.generating) return;
  if (index === -1) {
    state.historyIndex = -1;
    state.currentTexture = null;
    updateHistoryUI();
    updateRequestState();
    elements.designStatus.textContent = "Draft";
    elements.designStatus.classList.remove("is-executive");
    try {
      await resetDesignMaterial(state.model.designMaterial);
      renderLogoEditor();
      setStatus("Blank jacket ready. Use the back arrow to revisit saved designs.");
    } catch {
      setStatus("The blank jacket could not be restored.", true);
    }
    return;
  }
  state.historyIndex = index;
  updateHistoryUI();
  setStatus("Applying saved texture…");
  try {
    await applyDesign(state.history[index]);
    setStatus(`Showing design ${state.history.length - index} of ${state.history.length}.`);
  } catch (error) {
    setStatus(error.message || "Saved design could not be loaded.", true);
  }
}

async function applyDesign(design) {
  const response = await apiFetch(design.imageUrl);
  if (!response.ok) throw new Error("Texture image is unavailable.");
  const blob = await response.blob();
  const dataUrl = await blobToDataUrl(blob);
  const baseImage = await loadImage(dataUrl);
  state.currentTexture = { dataUrl, baseDataUrl: dataUrl, baseImage, prompt: design.prompt, id: design.id, status: design.status || "draft" };
  if (state.logos.length) {
    await renderLogoComposite(true);
  } else {
    await applyTexture(state.model.designMaterial, dataUrl);
    await renderLogoEditor();
  }
  elements.prompt.value = design.prompt || elements.prompt.value;
  elements.designStatus.textContent = state.currentTexture.status === "executive" ? "Executive" : "Draft";
  elements.designStatus.classList.toggle("is-executive", state.currentTexture.status === "executive");
  updatePromptState();
  updateRequestState();
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
  elements.generate.disabled = value || !state.api || !elements.prompt.value.trim();
  elements.type.disabled = value;
  elements.model.disabled = value;
  elements.quality.forEach((option) => { option.disabled = value; });
  [elements.type, elements.model].forEach((select) => {
    const trigger = document.querySelector(`.select-picker[data-select="${select.id}"] .select-picker__trigger`);
    if (trigger) trigger.disabled = value || select.options.length === 0;
  });
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
  elements.generate.disabled = state.generating || !state.api || !elements.prompt.value.trim();
}

function updateHistoryUI() {
  const total = state.history.length;
  const position = state.historyIndex < 0 ? 0 : total - state.historyIndex;
  elements.historyPosition.textContent = `${position} / ${total}`;
  elements.previous.disabled = state.generating || !total || state.historyIndex >= total - 1;
  elements.next.disabled = state.generating || state.historyIndex < 0;
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
    const aspect = image.naturalHeight / image.naturalWidth || 1;
    const offset = ((state.logos.length % 3) - 1) * 7;
    const logo = {
      id: payload.logo.id,
      name: payload.logo.name || file.name,
      image,
      dataUrl,
      x: 50 + offset,
      y: 50 + offset,
      size: Math.min(18, 68 / aspect)
    };
    clampLogo(logo);
    state.logos.push(logo);
    state.selectedLogoId = logo.id;
    elements.logoEditor.hidden = false;
    renderLogoLayers();
    if (state.currentTexture) await renderLogoComposite(true);
    else await renderLogoEditor();
    setStatus("Logo added. Drag it on the preview or use the size slider.");
  } catch (error) {
    setStatus(error.message || "Logo upload failed.", true);
  } finally {
    elements.logoUpload.disabled = false;
    elements.logoUpload.textContent = state.logos.length ? "Add another logo" : "Add logo";
    elements.logoInput.value = "";
  }
}

function selectedLogo() {
  return state.logos.find((logo) => logo.id === state.selectedLogoId) || null;
}

function logoMaxSize(logo) {
  const aspect = logo.image.naturalHeight / logo.image.naturalWidth || 1;
  return Math.max(1, Math.min(45, 88 / aspect));
}

function clampLogo(logo) {
  const aspect = logo.image.naturalHeight / logo.image.naturalWidth || 1;
  logo.size = Math.max(1, Math.min(logoMaxSize(logo), Number(logo.size) || 18));
  const halfWidth = logo.size / 2;
  const halfHeight = logo.size * aspect / 2;
  logo.x = Math.max(halfWidth, Math.min(100 - halfWidth, Number(logo.x) || 50));
  logo.y = Math.max(halfHeight, Math.min(100 - halfHeight, Number(logo.y) || 50));
}

function selectLogo(id) {
  if (!state.logos.some((logo) => logo.id === id)) return;
  state.selectedLogoId = id;
  renderLogoLayers();
  renderLogoEditor();
}

function renderLogoLayers() {
  elements.logoLayerList.innerHTML = state.logos.map((logo, index) => `
    <button class="logo-layer${logo.id === state.selectedLogoId ? " is-selected" : ""}" type="button" data-logo-id="${logo.id}" aria-pressed="${logo.id === state.selectedLogoId}">
      <img src="${logo.dataUrl}" alt=""><span>${escapeMarkup(logo.name || `Logo ${index + 1}`)}</span>
    </button>`).join("");
  elements.logoLayerList.querySelectorAll("[data-logo-id]").forEach((button) => button.addEventListener("click", () => selectLogo(button.dataset.logoId)));
  const logo = selectedLogo();
  elements.logoName.textContent = logo?.name || "Selected logo";
  elements.logoRemove.disabled = !logo;
  if (logo) {
    elements.logoSize.max = String(logoMaxSize(logo));
    elements.logoSize.value = String(logo.size);
  }
}

function updateLogoSize() {
  const logo = selectedLogo();
  if (!logo) return;
  logo.size = Number(elements.logoSize.value);
  clampLogo(logo);
  elements.logoSize.value = String(logo.size);
  renderLogoEditor();
  scheduleLogoComposite();
}

function scheduleLogoComposite() {
  clearTimeout(logoRenderTimer);
  logoRenderTimer = setTimeout(() => {
    if (state.currentTexture) renderLogoComposite(true).catch((error) => setStatus(error.message, true));
  }, 170);
}

async function removeLogo() {
  const index = state.logos.findIndex((logo) => logo.id === state.selectedLogoId);
  if (index < 0) return;
  state.logos.splice(index, 1);
  state.selectedLogoId = state.logos[Math.min(index, state.logos.length - 1)]?.id || null;
  elements.logoEditor.hidden = state.logos.length === 0;
  elements.logoUpload.textContent = state.logos.length ? "Add another logo" : "Add logo";
  renderLogoLayers();
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
  const dataUrl = await composeCurrentTexture("image/png");
  if (sequence !== logoRenderSequence) return null;
  state.currentTexture.dataUrl = dataUrl;
  if (applyToModel) await applyTexture(state.model.designMaterial, dataUrl);
  await renderLogoEditor();
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
    context.drawImage(logo.image, centerX - width / 2, centerY - height / 2, width, height);
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
    context.drawImage(logo.image, rect.x, rect.y, rect.width, rect.height);
    if (logo.id === state.selectedLogoId) {
      context.save();
      context.strokeStyle = "rgba(255,255,255,.96)";
      context.lineWidth = 7;
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
      context.strokeStyle = "#171716";
      context.lineWidth = 3;
      context.setLineDash([12, 9]);
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
      context.restore();
    }
  }
  if (!state.currentTexture && state.logos.length === 0) {
    context.fillStyle = "#8a8983";
    context.font = "32px system-ui";
    context.textAlign = "center";
    context.fillText("Open or generate a design first", elements.logoPreview.width / 2, elements.logoPreview.height / 2);
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
  const point = previewPoint(event);
  const logo = [...state.logos].reverse().find((item) => {
    const rect = getLogoRect(item);
    return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
  });
  if (!logo) return;
  selectLogo(logo.id);
  const rect = getLogoRect(logo);
  state.logoDrag = { id: logo.id, offsetX: point.x - rect.centerX, offsetY: point.y - rect.centerY };
  elements.logoPreview.setPointerCapture(event.pointerId);
  elements.logoPreview.classList.add("is-dragging");
  event.preventDefault();
}

function moveLogoDrag(event) {
  if (!state.logoDrag) return;
  const logo = state.logos.find((item) => item.id === state.logoDrag.id);
  if (!logo) return;
  const point = previewPoint(event);
  logo.x = ((point.x - state.logoDrag.offsetX) / elements.logoPreview.width) * 100;
  logo.y = ((point.y - state.logoDrag.offsetY) / elements.logoPreview.height) * 100;
  clampLogo(logo);
  renderLogoEditor();
  scheduleLogoComposite();
  event.preventDefault();
}

function endLogoDrag(event) {
  if (!state.logoDrag) return;
  state.logoDrag = null;
  elements.logoPreview.classList.remove("is-dragging");
  if (elements.logoPreview.hasPointerCapture(event.pointerId)) elements.logoPreview.releasePointerCapture(event.pointerId);
  scheduleLogoComposite();
}

function updateRequestState() {
  const messageReady = elements.requestMessage.value.trim().length >= 3;
  elements.requestButton.disabled = !state.currentTexture || !messageReady || state.generating;
}

async function submitDesignRequest() {
  if (!state.currentTexture) return;
  const message = elements.requestMessage.value.trim();
  if (message.length < 3) return;
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
        placement: { logos: state.logos.map((logo) => ({ id: logo.id, x: logo.x, y: logo.y, size: logo.size, logoName: logo.name })) }
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Request could not be sent.");
    elements.requestMessage.value = "";
    setStatus("Request saved in the Vitalini admin workspace.");
    if (!elements.accountDrawer.hidden) await loadAccount();
  } catch (error) {
    setStatus(error.message || "Request could not be sent.", true);
  } finally {
    elements.requestButton.textContent = "Submit design request";
    updateRequestState();
  }
}

async function openAccount() {
  elements.accountDrawer.hidden = false;
  elements.accountButton.setAttribute("aria-expanded", "true");
  await loadAccount();
}

function closeAccount() {
  elements.accountDrawer.hidden = true;
  elements.accountButton.setAttribute("aria-expanded", "false");
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
      ? payload.requests.map((item) => `<div class="account-request-item"><strong>${escapeMarkup(item.status.replace("_", " "))}</strong><span>${escapeMarkup(item.message.slice(0, 120))}</span></div>`).join("")
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

bootstrap();
