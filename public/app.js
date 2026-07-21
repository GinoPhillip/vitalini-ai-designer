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
  quality: [...document.querySelectorAll('input[name="generationPreset"]')],
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

function initialize() {
  elements.type.innerHTML = Object.keys(CATALOG).map((name) => `<option value="${name}">${name}</option>`).join("");
  renderSelectPicker(elements.type);
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
  const renderPreset = elements.quality.find((option) => option.checked)?.value || "medium";

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
