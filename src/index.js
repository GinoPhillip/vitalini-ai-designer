const MODELS = Object.freeze({
  VP9655: {
    baseImage: "/assets/models/VP9655-base.png",
    texturePrompt:
      "This input is a UV-layout texture atlas for a technical ski jacket. Preserve every UV island, seam boundary, panel position, canvas proportion, and unused background area exactly. Apply the requested graphic design inside the existing garment panels only. Keep every panel self-contained and continuous at shared edges. Return only the flat square texture atlas: no jacket mockup, person, labels, shadows, perspective, or extra objects."
  },
  VP9109: {
    baseImage: "/assets/models/VP9109-base.png",
    texturePrompt:
      "This input is a UV-layout texture atlas for a technical ski jacket. Preserve every UV island, seam boundary, panel position, canvas proportion, and unused background area exactly. Apply the requested graphic design inside the existing garment panels only. Keep every panel self-contained and continuous at shared edges. Return only the flat square texture atlas: no jacket mockup, person, labels, shadows, perspective, or extra objects."
  }
});

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const USER_ID_RE = /^[a-zA-Z0-9_-]{16,80}$/;
const DESIGN_ID_RE = /^[0-9a-f-]{36}$/i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");

    if (url.pathname.startsWith("/api/") && !isOriginAllowed(origin, url.origin, env.ALLOWED_ORIGINS)) {
      return json({ error: "Origin not allowed" }, 403);
    }

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return withCors(new Response(null, { status: 204 }), origin);
    }

    try {
      let response;
      if (request.method === "GET" && url.pathname === "/api/health") {
        response = json({ ok: true, imageModel: env.OPENAI_IMAGE_MODEL || "gpt-image-2" });
      } else if (request.method === "POST" && url.pathname === "/api/generate") {
        response = await generateDesign(request, env);
      } else if (request.method === "GET" && url.pathname === "/api/designs") {
        response = await listDesigns(request, env);
      } else if (request.method === "GET" && /^\/api\/designs\/[^/]+\/image$/.test(url.pathname)) {
        response = await getDesignImage(request, env);
      } else if (url.pathname.startsWith("/api/")) {
        response = json({ error: "Not found" }, 404);
      } else {
        return env.ASSETS.fetch(request);
      }
      return withCors(response, origin);
    } catch (error) {
      console.error("Unhandled request error", error);
      return withCors(json({ error: "The service could not complete the request." }, 500), origin);
    }
  }
};

async function generateDesign(request, env) {
  if (!env.OPENAI_API_KEY) return json({ error: "Image generation is not configured." }, 503);

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 20_000) return json({ error: "Request is too large." }, 413);

  const userId = getUserId(request);
  if (!userId) return json({ error: "Missing or invalid designer ID." }, 400);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Expected a JSON request." }, 400);
  }

  const prompt = String(payload.prompt || "").trim();
  const modelId = String(payload.modelId || "").trim();
  const renderPreset = normalizeRenderPreset(payload.renderPreset ?? payload.quality);
  const model = MODELS[modelId];
  if (!model) return json({ error: "Unknown product model." }, 400);
  if (!renderPreset) return json({ error: "Choose medium, high, or max resolution generation." }, 400);
  if (prompt.length < 3 || prompt.length > 800) {
    return json({ error: "Describe the design in 3 to 800 characters." }, 400);
  }

  if (env.IMAGE_RATE_LIMITER) {
    const { success } = await env.IMAGE_RATE_LIMITER.limit({ key: getRateLimitKey(request, userId) });
    if (!success) return json({ error: "Generation limit reached. Please wait a minute and try again." }, 429);
  }

  const baseRequest = new Request(new URL(model.baseImage, request.url));
  const baseResponse = await env.ASSETS.fetch(baseRequest);
  if (!baseResponse.ok) return json({ error: "The model texture template is unavailable." }, 500);
  const baseImage = await baseResponse.blob();

  const form = new FormData();
  form.append("model", env.OPENAI_IMAGE_MODEL || "gpt-image-2");
  form.append("image[]", baseImage, `${modelId}-uv.png`);
  form.append("prompt", `${model.texturePrompt}\n\nDesign direction from the customer: ${prompt}`);
  form.append("size", renderPreset.size);
  form.append("quality", renderPreset.quality);
  form.append("output_format", "png");

  const openAIResponse = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form
  });

  const requestId = openAIResponse.headers.get("x-request-id");
  const result = await openAIResponse.json().catch(() => null);
  if (!openAIResponse.ok) {
    console.error("OpenAI image error", { status: openAIResponse.status, requestId, code: result?.error?.code });
    const message = openAIResponse.status === 429
      ? "The image service is busy or over quota. Please try again shortly."
      : result?.error?.code === "moderation_blocked"
        ? "That request could not be generated. Try a different design description."
        : "Image generation failed. Please try again.";
    return json({ error: message }, openAIResponse.status === 429 ? 429 : 502);
  }

  const base64 = result?.data?.[0]?.b64_json;
  if (!base64) return json({ error: "The image service returned no texture." }, 502);

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const objectKey = `designs/${userId}/${modelId}/${id}.png`;
  const bytes = base64ToBytes(base64);

  await env.DESIGNS.put(objectKey, bytes, {
    httpMetadata: { contentType: "image/png" },
    customMetadata: { userId, modelId, designId: id }
  });

  try {
    await env.DB.prepare(
      "INSERT INTO designs (id, user_id, model_id, prompt, object_key, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(id, userId, modelId, prompt, objectKey, createdAt).run();
  } catch (error) {
    await env.DESIGNS.delete(objectKey);
    throw error;
  }

  return json({ design: serializeDesign({ id, model_id: modelId, prompt, created_at: createdAt }) }, 201);
}

async function listDesigns(request, env) {
  const userId = getUserId(request);
  const modelId = new URL(request.url).searchParams.get("model_id") || "";
  if (!userId || !MODELS[modelId]) return json({ error: "Invalid history request." }, 400);

  const { results = [] } = await env.DB.prepare(
    "SELECT id, model_id, prompt, created_at FROM designs WHERE user_id = ? AND model_id = ? ORDER BY created_at ASC LIMIT 100"
  ).bind(userId, modelId).all();

  return json({ designs: results.map(serializeDesign) });
}

async function getDesignImage(request, env) {
  const userId = getUserId(request);
  const parts = new URL(request.url).pathname.split("/");
  const designId = parts[3] || "";
  if (!userId || !DESIGN_ID_RE.test(designId)) return json({ error: "Invalid image request." }, 400);

  const design = await env.DB.prepare(
    "SELECT object_key FROM designs WHERE id = ? AND user_id = ?"
  ).bind(designId, userId).first();
  if (!design) return json({ error: "Design not found." }, 404);

  const object = await env.DESIGNS.get(design.object_key);
  if (!object) return json({ error: "Design image not found." }, 404);

  const headers = new Headers({
    "content-type": object.httpMetadata?.contentType || "image/png",
    "cache-control": "private, no-store",
    "content-disposition": `inline; filename=\"${designId}.png\"`
  });
  return new Response(object.body, { headers });
}

function serializeDesign(row) {
  return {
    id: row.id,
    modelId: row.model_id,
    prompt: row.prompt,
    createdAt: row.created_at,
    imageUrl: `/api/designs/${row.id}/image`
  };
}

function getUserId(request) {
  const value = request.headers.get("x-designer-id") || "";
  return USER_ID_RE.test(value) ? value : null;
}

export function isOriginAllowed(origin, requestOrigin, configuredOrigins = "") {
  if (!origin || origin === requestOrigin) return true;
  return configuredOrigins.split(",").map((item) => item.trim()).filter(Boolean).includes(origin);
}

export function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function getRateLimitKey(request, userId) {
  const clientIp = request.headers.get("cf-connecting-ip");
  return `${clientIp || userId}:generate`;
}

export function normalizeRenderPreset(value) {
  const presetName = value === undefined || value === null || value === ""
    ? "medium"
    : String(value).trim().toLowerCase();
  const presets = {
    medium: { name: "medium", quality: "medium", size: "1024x1024" },
    high: { name: "high", quality: "high", size: "1024x1024" },
    max: { name: "max", quality: "high", size: "1536x1536" }
  };
  return presets[presetName] || null;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function withCors(response, origin) {
  const headers = new Headers(response.headers);
  if (origin) headers.set("access-control-allow-origin", origin);
  headers.set("vary", "Origin");
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  headers.set("access-control-allow-headers", "Content-Type, X-Designer-ID");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
