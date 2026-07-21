const API_BASE = (window.VITALINI_API_BASE || "").replace(/\/$/, "");

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
  download: document.querySelector("#downloadButton")
};

const state = {
  api: null,
  model: null,
  materials: new Map(),
  history: [],
  historyIndex: -1,
  currentTexture: null,
  generating: false,
  bootSequence: 0
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

function initialize() {
  elements.type.innerHTML = Object.keys(CATALOG).map((name) => `<option value="${name}">${name}</option>`).join("");
  populateModels();

  elements.type.addEventListener("change", populateModels);
  elements.model.addEventListener("change", () => switchModel(elements.model.value));
  elements.prompt.addEventListener("input", updatePromptState);
  elements.generate.addEventListener("click", generateDesign);
  elements.previous.addEventListener("click", () => showHistory(state.historyIndex - 1));
  elements.next.addEventListener("click", () => showHistory(state.historyIndex + 1));
  elements.download.addEventListener("click", downloadCurrentTexture);
  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      elements.prompt.value = button.dataset.prompt;
      updatePromptState();
      elements.prompt.focus();
    });
  });
  updatePromptState();
}

function populateModels() {
  const models = CATALOG[elements.type.value] || [];
  elements.model.innerHTML = models.map((model) => `<option value="${model.id}">${model.name}</option>`).join("");
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
        api.getMaterialList((error, materials) => {
          if (error) {
            setStatus("The jacket materials could not be loaded.", true);
            return;
          }
          state.materials = new Map(materials.map((material) => [material.name, material]));
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
      <label for="material-${index}">${item.label}</label>
      <div class="material-picker" style="--swatch:#ffffff">
        <select id="material-${index}" data-material="${item.material}">
          ${COLORS.map(([name, value]) => `<option value="${value}">${name}</option>`).join("")}
        </select>
      </div>
    </div>
  `).join("");

  elements.materialControls.querySelectorAll("select").forEach((select) => {
    select.addEventListener("change", () => {
      select.parentElement.style.setProperty("--swatch", select.value);
      applyColor(select.dataset.material, select.value);
    });
  });
}

function syncMaterialColors() {
  elements.materialControls.querySelectorAll("select").forEach((select) => {
    const material = findMaterial(select.dataset.material);
    const channel = material && getColorChannel(material);
    const color = channel?.color;
    if (!Array.isArray(color)) return;
    const hex = rgbToHex(color);
    const closest = COLORS.reduce((best, entry) => colorDistance(hex, entry[1]) < colorDistance(hex, best[1]) ? entry : best, COLORS[0]);
    select.value = closest[1];
    select.parentElement.style.setProperty("--swatch", closest[1]);
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

async function generateDesign() {
  const prompt = elements.prompt.value.trim();
  if (!prompt || !state.api || state.generating) return;

  setGenerating(true);
  setStatus("Creating a production-ready UV texture. This can take up to two minutes.");
  try {
    const response = await apiFetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, modelId: state.model.id })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Generation failed.");
    state.history.push(payload.design);
    state.historyIndex = state.history.length - 1;
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
  setStatus("Loading your saved designs…");
  try {
    const response = await apiFetch(`/api/designs?model_id=${encodeURIComponent(state.model.id)}`);
    if (!response.ok) throw new Error("History is unavailable.");
    const payload = await response.json();
    state.history = payload.designs || [];
    state.historyIndex = state.history.length - 1;
    if (state.historyIndex >= 0) await applyDesign(state.history[state.historyIndex]);
    setStatus(state.history.length ? "Latest saved design restored." : "Ready for a new design.");
  } catch {
    state.history = [];
    state.historyIndex = -1;
    setStatus("3D preview is ready. Saved history will appear after the backend is configured.");
  }
  updateHistoryUI();
}

async function showHistory(index) {
  if (index < 0 || index >= state.history.length || state.generating) return;
  state.historyIndex = index;
  updateHistoryUI();
  setStatus("Applying saved texture…");
  try {
    await applyDesign(state.history[index]);
    setStatus(`Showing design ${index + 1} of ${state.history.length}.`);
  } catch (error) {
    setStatus(error.message || "Saved design could not be loaded.", true);
  }
}

async function applyDesign(design) {
  const response = await apiFetch(design.imageUrl);
  if (!response.ok) throw new Error("Texture image is unavailable.");
  const blob = await response.blob();
  const dataUrl = await blobToDataUrl(blob);
  await applyTexture(state.model.designMaterial, dataUrl);
  state.currentTexture = { dataUrl, prompt: design.prompt, id: design.id };
  elements.prompt.value = design.prompt || elements.prompt.value;
  updatePromptState();
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
  headers.set("x-designer-id", designerId);
  return fetch(`${API_BASE}${path}`, { ...options, headers, cache: "no-store" });
}

function setGenerating(value) {
  state.generating = value;
  elements.generate.classList.toggle("is-loading", value);
  elements.generate.querySelector("span").textContent = value ? "Generating design…" : "Generate design";
  elements.generate.disabled = value || !state.api || !elements.prompt.value.trim();
  elements.type.disabled = value;
  elements.model.disabled = value;
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("is-error", isError);
}

function updatePromptState() {
  elements.promptCount.textContent = `${elements.prompt.value.length} / 800`;
  elements.generate.disabled = state.generating || !state.api || !elements.prompt.value.trim();
}

function updateHistoryUI() {
  const total = state.history.length;
  const position = total ? state.historyIndex + 1 : 0;
  elements.historyPosition.textContent = `${position} / ${total}`;
  elements.previous.disabled = state.generating || position <= 1;
  elements.next.disabled = state.generating || !total || position >= total;
  elements.download.disabled = !state.currentTexture;
}

function downloadCurrentTexture() {
  if (!state.currentTexture) return;
  const anchor = document.createElement("a");
  anchor.href = state.currentTexture.dataUrl;
  anchor.download = `${state.model.id}-ai-design-${state.currentTexture.id}.png`;
  anchor.click();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
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

initialize();
