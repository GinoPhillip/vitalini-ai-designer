const TEXTURE_PROMPT =
  "This input is a UV-layout texture atlas for a technical ski jacket. Preserve every UV island, seam boundary, panel position, canvas proportion, and unused background area exactly. Apply the requested graphic design inside the existing garment panels only. Keep every panel self-contained and continuous at shared edges. Return only the flat square texture atlas: no jacket mockup, person, labels, shadows, perspective, or extra objects.";

const MODELS = Object.freeze({
  VP9655: { baseImage: "/assets/models/VP9655-base.png", texturePrompt: TEXTURE_PROMPT },
  VP9109: { baseImage: "/assets/models/VP9109-base.png", texturePrompt: TEXTURE_PROMPT }
});

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const UUID_RE = /^[0-9a-f-]{36}$/i;
const LEGACY_USER_ID_RE = /^[a-zA-Z0-9_-]{16,80}$/;
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Kept within the Worker CPU budget; a server-only pepper protects hashes if D1 is exposed.
const PASSWORD_ITERATIONS = 60_000;
const USER_SESSION_DAYS = 30;
const ADMIN_SESSION_HOURS = 12;
const DAILY_GENERATION_LIMIT = 20;
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 15 * 1024 * 1024;
const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const REQUEST_STATUSES = new Set(["new", "in_review", "finalized", "declined"]);
const DESIGN_STATUSES = new Set(["draft", "executive"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");

    if (url.pathname.startsWith("/api/") && !isOriginAllowed(origin, url.origin, env.ALLOWED_ORIGINS)) {
      return withCors(json({ error: "Origin not allowed." }, 403), origin);
    }
    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return withCors(new Response(null, { status: 204 }), origin);
    }

    try {
      let response;
      if (request.method === "GET" && url.pathname === "/api/health") {
        response = json({ ok: true, imageModel: env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-sunburst" });
      } else if (request.method === "POST" && url.pathname === "/api/auth/register") {
        response = await registerUser(request, env);
      } else if (request.method === "POST" && url.pathname === "/api/auth/login") {
        response = await loginUser(request, env);
      } else if (request.method === "POST" && url.pathname === "/api/admin/login") {
        response = await loginAdmin(request, env);
      } else if (url.pathname.startsWith("/api/admin/")) {
        const admin = await authenticateAdmin(request, env);
        response = admin ? await routeAdmin(request, env, admin) : json({ error: "Admin authorization required." }, 401);
      } else if (url.pathname.startsWith("/api/")) {
        const user = await authenticateUser(request, env);
        response = user ? await routeUser(request, env, user) : json({ error: "Sign in to continue." }, 401);
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

async function routeUser(request, env, user) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && path === "/api/auth/session") return getSessionSummary(env, user);
  if (request.method === "POST" && path === "/api/auth/logout") return logoutUser(request, env);
  if (request.method === "GET" && path === "/api/account") return getAccount(env, user);
  if (request.method === "GET" && path === "/api/workspace") return getWorkspace(request, env, user);
  if (request.method === "POST" && path === "/api/workspace") return saveWorkspace(request, env, user);
  if (request.method === "POST" && path === "/api/generate") return generateDesign(request, env, user);
  if (request.method === "GET" && path === "/api/designs") return listDesigns(request, env, user);
  if (request.method === "GET" && /^\/api\/designs\/[^/]+\/image$/.test(path)) return getDesignImage(request, env, user);
  if (request.method === "GET" && path === "/api/logos") return listLogos(env, user);
  if (request.method === "POST" && path === "/api/logos") return uploadLogo(request, env, user);
  if (request.method === "GET" && /^\/api\/logos\/[^/]+\/file$/.test(path)) return getLogoFile(request, env, user);
  if (request.method === "GET" && path === "/api/requests") return listRequests(env, user);
  if (request.method === "POST" && path === "/api/requests") return createDesignRequest(request, env, user);
  if (request.method === "GET" && /^\/api\/requests\/[^/]+\/preview$/.test(path)) return getRequestPreview(request, env, user);
  return json({ error: "Not found." }, 404);
}

async function routeAdmin(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "POST" && path === "/api/admin/logout") return logoutAdmin(request, env);
  if (request.method === "GET" && path === "/api/admin/invites") return listInvites(env);
  if (request.method === "POST" && path === "/api/admin/invites") return createInvite(request, env);
  if (request.method === "GET" && path === "/api/admin/users") return listAdminUsers(env);
  if (request.method === "GET" && /^\/api\/admin\/users\/[^/]+$/.test(path)) return getAdminUser(request, env);
  if (request.method === "PATCH" && /^\/api\/admin\/users\/[^/]+$/.test(path)) return updateAdminUser(request, env);
  if (request.method === "DELETE" && /^\/api\/admin\/users\/[^/]+$/.test(path)) return deleteAdminUser(request, env);
  if (request.method === "GET" && path === "/api/admin/requests") return listAdminRequests(env);
  if (request.method === "GET" && /^\/api\/admin\/requests\/[^/]+$/.test(path)) return getAdminRequest(request, env);
  if (request.method === "PATCH" && /^\/api\/admin\/requests\/[^/]+$/.test(path)) return updateAdminRequest(request, env);
  if (request.method === "PATCH" && /^\/api\/admin\/designs\/[^/]+$/.test(path)) return updateAdminDesign(request, env);
  if (request.method === "GET" && /^\/api\/admin\/designs\/[^/]+\/image$/.test(path)) return getAdminDesignImage(request, env);
  if (request.method === "GET" && /^\/api\/admin\/requests\/[^/]+\/preview$/.test(path)) return getAdminRequestPreview(request, env);
  if (request.method === "GET" && /^\/api\/admin\/logos\/[^/]+\/file$/.test(path)) return getAdminLogoFile(request, env);
  if (request.method === "GET" && /^\/api\/admin\/handoff-assets\/[^/]+$/.test(path)) return getAdminHandoffAsset(request, env);
  return json({ error: "Not found." }, 404);
}

async function registerUser(request, env) {
  if (!(await allowAuthAttempt(request, env))) return json({ error: "Too many attempts. Please wait a minute." }, 429);
  const payload = await readJson(request, 25_000);
  if (payload instanceof Response) return payload;

  const inviteCode = normalizeInviteCode(payload.inviteCode);
  const username = normalizeUsername(payload.username);
  const email = String(payload.email || "").trim().toLowerCase();
  const password = String(payload.password || "");
  const legacyDesignerId = String(payload.legacyDesignerId || "");
  if (!inviteCode) return json({ error: "Enter a valid account creation code." }, 400);
  if (!USERNAME_RE.test(username)) return json({ error: "Username must be 3–32 letters or numbers. Spaces become underscores." }, 400);
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: "Enter a valid email address." }, 400);
  if (password.length < 6 || password.length > 128) return json({ error: "Password must be 6–128 characters." }, 400);
  if (!env.PASSWORD_PEPPER) return json({ error: "Account security is not configured." }, 503);

  const duplicate = await env.DB.prepare("SELECT id FROM users WHERE username = ? OR email = ?").bind(username, email).first();
  if (duplicate) return json({ error: "That username or email is already registered." }, 409);

  const now = new Date().toISOString();
  const codeHash = await sha256Hex(inviteCode);
  const invite = await env.DB.prepare(
    "UPDATE invite_codes SET used_count = used_count + 1, last_used_at = ? WHERE code_hash = ? AND used_count < max_uses AND expires_at > ? RETURNING id"
  ).bind(now, codeHash, now).first();
  if (!invite) return json({ error: "That account creation code is invalid, expired, or already used." }, 400);

  const userId = crypto.randomUUID();
  let userInserted = false;
  try {
    const credentials = await hashPassword(password, env.PASSWORD_PEPPER);
    await env.DB.prepare(
      "INSERT INTO users (id, username, email, password_hash, password_salt, password_iterations, status, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?)"
    ).bind(userId, username, email, credentials.hash, credentials.salt, credentials.iterations, now, now).run();
    userInserted = true;
    if (LEGACY_USER_ID_RE.test(legacyDesignerId)) {
      await env.DB.prepare("UPDATE designs SET user_id = ? WHERE user_id = ?").bind(userId, legacyDesignerId).run();
    }
    const token = await createUserSession(env, userId);
    return json({ token, user: { id: userId, username, email, status: "approved" } }, 201);
  } catch (error) {
    if (userInserted) await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run().catch(() => null);
    await env.DB.prepare("UPDATE invite_codes SET used_count = MAX(used_count - 1, 0) WHERE id = ?").bind(invite.id).run();
    throw error;
  }
}

async function loginUser(request, env) {
  if (!(await allowAuthAttempt(request, env))) return json({ error: "Too many attempts. Please wait a minute." }, 429);
  const payload = await readJson(request, 20_000);
  if (payload instanceof Response) return payload;
  const identity = String(payload.identity || "").trim();
  const password = String(payload.password || "");
  if (!identity || !password) return json({ error: "Enter your username or email and password." }, 400);

  const user = await env.DB.prepare(
    "SELECT id, username, email, password_hash, password_salt, password_iterations, status FROM users WHERE username = ? OR email = ?"
  ).bind(identity, identity.toLowerCase()).first();
  const valid = user && env.PASSWORD_PEPPER && await verifyPassword(password, env.PASSWORD_PEPPER, user.password_salt, user.password_hash, user.password_iterations);
  if (!valid) return json({ error: "Incorrect username, email, or password." }, 401);
  if (user.status !== "approved") return json({ error: "This account is not currently approved." }, 403);

  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(now, user.id).run();
  const token = await createUserSession(env, user.id);
  return json({ token, user: publicUser(user) });
}

async function loginAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) return json({ error: "Admin access is not configured." }, 503);
  if (!(await allowAuthAttempt(request, env))) return json({ error: "Too many attempts. Please wait a minute." }, 429);
  const payload = await readJson(request, 10_000);
  if (payload instanceof Response) return payload;
  if (!timingSafeEqualText(String(payload.password || ""), env.ADMIN_PASSWORD)) {
    return json({ error: "Incorrect admin password." }, 401);
  }
  const token = randomToken(32);
  const now = new Date();
  const expires = new Date(now.getTime() + ADMIN_SESSION_HOURS * 60 * 60 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256Hex(token), now.toISOString(), expires).run();
  return json({ token, expiresAt: expires });
}

async function authenticateUser(request, env) {
  const token = bearerToken(request);
  if (!token) return null;
  const now = new Date().toISOString();
  const user = await env.DB.prepare(
    "SELECT u.id, u.username, u.email, u.status, u.created_at FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'approved'"
  ).bind(await sha256Hex(token), now).first();
  return user || null;
}

async function authenticateAdmin(request, env) {
  const token = bearerToken(request);
  if (!token) return null;
  return env.DB.prepare("SELECT token_hash FROM admin_sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(await sha256Hex(token), new Date().toISOString()).first();
}

async function logoutUser(request, env) {
  const token = bearerToken(request);
  if (token) await env.DB.prepare("DELETE FROM user_sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  return json({ ok: true });
}

async function logoutAdmin(request, env) {
  const token = bearerToken(request);
  if (token) await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  return json({ ok: true });
}

async function createUserSession(env, userId) {
  const token = randomToken(32);
  const now = new Date();
  const expires = new Date(now.getTime() + USER_SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO user_sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(await sha256Hex(token), userId, now.toISOString(), expires, now.toISOString()).run();
  return token;
}

async function getSessionSummary(env, user) {
  const usage = await getDailyUsage(env, user.id);
  return json({ user: publicUser(user), usage });
}

async function getAccount(env, user) {
  const usage = await getDailyUsage(env, user.id);
  const counts = await env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM designs WHERE user_id = ?) AS designs, (SELECT COUNT(*) FROM logos WHERE user_id = ?) AS logos, (SELECT COUNT(*) FROM design_requests WHERE user_id = ?) AS requests"
  ).bind(user.id, user.id, user.id).first();
  const { results: requests = [] } = await env.DB.prepare(
    "SELECT id, design_id, message, status, created_at, updated_at FROM design_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 20"
  ).bind(user.id).all();
  return json({ user: publicUser(user), usage, counts, requests });
}

async function generateDesign(request, env, user) {
  if (!env.OPENAI_API_KEY) return json({ error: "Image generation is not configured." }, 503);
  const payload = await readJson(request, 20_000);
  if (payload instanceof Response) return payload;

  const prompt = String(payload.prompt || "").trim();
  const modelId = String(payload.modelId || "").trim();
  const renderPreset = normalizeRenderPreset();
  const model = MODELS[modelId];
  if (!model) return json({ error: "Unknown product model." }, 400);
  if (prompt.length < 3 || prompt.length > 800) return json({ error: "Describe the design in 3 to 800 characters." }, 400);

  if (env.IMAGE_RATE_LIMITER) {
    const { success } = await env.IMAGE_RATE_LIMITER.limit({ key: getRateLimitKey(request, user.id) });
    if (!success) return json({ error: "Generation limit reached. Please wait a minute and try again." }, 429);
  }

  const baseRequest = new Request(new URL(model.baseImage, request.url));
  const baseResponse = await env.ASSETS.fetch(baseRequest);
  if (!baseResponse.ok) return json({ error: "The model texture template is unavailable." }, 500);
  const reservation = await reserveDailyGeneration(env, user.id);
  if (!reservation) return json({ error: `Daily generation limit reached (${DAILY_GENERATION_LIMIT}/day).` }, 429);

  const form = new FormData();
  form.append("model", env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-sunburst");
  form.append("image[]", await baseResponse.blob(), `${modelId}-uv.png`);
  form.append("prompt", `${model.texturePrompt}\n\nDesign direction from the customer: ${prompt}`);
  form.append("size", renderPreset.size);
  form.append("quality", renderPreset.quality);
  form.append("output_format", "png");

  let openAIResponse;
  try {
    openAIResponse = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: form
    });
  } catch (error) {
    await releaseDailyGeneration(env, user.id);
    throw error;
  }

  const requestId = openAIResponse.headers.get("x-request-id");
  const result = await openAIResponse.json().catch(() => null);
  if (!openAIResponse.ok) {
    await releaseDailyGeneration(env, user.id);
    console.error("OpenAI image error", { status: openAIResponse.status, requestId, code: result?.error?.code });
    const message = openAIResponse.status === 429
      ? "The image service is busy or over quota. Please try again shortly."
      : result?.error?.code === "moderation_blocked"
        ? "That request could not be generated. Try a different design description."
        : "Image generation failed. Please try again.";
    return json({ error: message }, openAIResponse.status === 429 ? 429 : 502);
  }

  const base64 = result?.data?.[0]?.b64_json;
  if (!base64) {
    await releaseDailyGeneration(env, user.id);
    return json({ error: "The image service returned no texture." }, 502);
  }
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const objectKey = `designs/${user.id}/${modelId}/${id}.png`;
  const bytes = base64ToBytes(base64);
  await env.DESIGNS.put(objectKey, bytes, {
    httpMetadata: { contentType: "image/png" },
    customMetadata: { userId: user.id, modelId, designId: id }
  });

  try {
    await env.DB.prepare(
      "INSERT INTO designs (id, user_id, model_id, prompt, object_key, created_at, status, render_preset, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)"
    ).bind(id, user.id, modelId, prompt, objectKey, createdAt, renderPreset.name, createdAt).run();
  } catch (error) {
    await env.DESIGNS.delete(objectKey);
    throw error;
  }

  return json({
    design: serializeDesign({ id, model_id: modelId, prompt, created_at: createdAt, status: "draft", render_preset: renderPreset.name }),
    usage: { used: reservation.generation_count, limit: DAILY_GENERATION_LIMIT, remaining: DAILY_GENERATION_LIMIT - reservation.generation_count }
  }, 201);
}

async function reserveDailyGeneration(env, userId) {
  const now = new Date().toISOString();
  return env.DB.prepare(
    "INSERT INTO daily_generation_usage (user_id, usage_date, generation_count, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id, usage_date) DO UPDATE SET generation_count = generation_count + 1, updated_at = excluded.updated_at WHERE generation_count < ? RETURNING generation_count"
  ).bind(userId, now.slice(0, 10), now, DAILY_GENERATION_LIMIT).first();
}

async function releaseDailyGeneration(env, userId) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE daily_generation_usage SET generation_count = MAX(generation_count - 1, 0), updated_at = ? WHERE user_id = ? AND usage_date = ?"
  ).bind(now, userId, now.slice(0, 10)).run();
}

async function getDailyUsage(env, userId) {
  const today = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare("SELECT generation_count FROM daily_generation_usage WHERE user_id = ? AND usage_date = ?")
    .bind(userId, today).first();
  const used = Number(row?.generation_count || 0);
  return { used, limit: DAILY_GENERATION_LIMIT, remaining: Math.max(0, DAILY_GENERATION_LIMIT - used), date: today };
}

async function listDesigns(request, env, user) {
  const modelId = new URL(request.url).searchParams.get("model_id") || "";
  if (!MODELS[modelId]) return json({ error: "Invalid history request." }, 400);
  const { results = [] } = await env.DB.prepare(
    "SELECT id, model_id, prompt, created_at, status, render_preset FROM designs WHERE user_id = ? AND model_id = ? ORDER BY created_at DESC LIMIT 100"
  ).bind(user.id, modelId).all();
  return json({ designs: results.map(serializeDesign) });
}

async function getDesignImage(request, env, user) {
  const designId = pathPart(request, 3);
  if (!UUID_RE.test(designId)) return json({ error: "Invalid image request." }, 400);
  const design = await env.DB.prepare("SELECT object_key FROM designs WHERE id = ? AND user_id = ?").bind(designId, user.id).first();
  return design ? r2Response(env, design.object_key, `${designId}.png`) : json({ error: "Design not found." }, 404);
}

async function listLogos(env, user) {
  const { results = [] } = await env.DB.prepare(
    "SELECT id, name, content_type, size_bytes, created_at FROM logos WHERE user_id = ? ORDER BY created_at DESC"
  ).bind(user.id).all();
  return json({ logos: results.map((logo) => ({ ...logo, fileUrl: `/api/logos/${logo.id}/file` })) });
}

export function normalizeWorkspaceEdit(input) {
  if (!input || typeof input !== "object" || !Array.isArray(input.logos) || input.logos.length > 8) return null;
  const logos = [];
  const instances = new Set();
  for (const item of input.logos) {
    if (!item || !UUID_RE.test(item.id) || !UUID_RE.test(item.instanceId) || instances.has(item.instanceId)) return null;
    if (![item.x, item.y, item.size, item.rotation].every(Number.isFinite)) return null;
    if (item.x < 0 || item.x > 100 || item.y < 0 || item.y > 100 || item.size < 1 || item.size > 45 || Math.abs(item.rotation) > 180) return null;
    instances.add(item.instanceId);
    logos.push({ id: item.id, instanceId: item.instanceId, x: item.x, y: item.y, size: item.size, rotation: item.rotation });
  }
  const colors = Array.isArray(input.colors) ? input.colors : [];
  if (colors.length > 2 || colors.some((color) => !/^#[0-9a-f]{6}$/i.test(color))) return null;
  return { logos, colors, message: String(input.message || "").slice(0, 2000), prompt: String(input.prompt || "").slice(0, 800) };
}

async function getWorkspace(request, env, user) {
  const url = new URL(request.url);
  let modelId = url.searchParams.get("model_id");
  let designId = url.searchParams.get("design_id") || null;
  if (!modelId) {
    const last = await env.DB.prepare("SELECT model_id, design_id FROM client_workspaces WHERE user_id = ?").bind(user.id).first();
    if (!last) return json({ workspace: null });
    modelId = last.model_id; designId = last.design_id;
  }
  if (!MODELS[modelId] || (designId && !UUID_RE.test(designId))) return json({ error: "Invalid saved workspace." }, 400);
  if (designId && !await env.DB.prepare("SELECT id FROM designs WHERE id = ? AND user_id = ? AND model_id = ?").bind(designId, user.id, modelId).first()) return json({ error: "Design not found." }, 404);
  const key = designId || `base:${modelId}`;
  const row = await env.DB.prepare("SELECT edit_json, updated_at FROM design_edits WHERE user_id = ? AND design_key = ?").bind(user.id, key).first();
  return json({ workspace: { modelId, designId, edit: parseJsonObject(row?.edit_json), updatedAt: row?.updated_at || null } });
}

async function saveWorkspace(request, env, user) {
  const payload = await readJson(request, 20_000);
  if (payload instanceof Response) return payload;
  const modelId = String(payload.modelId || "");
  const designId = payload.designId || null;
  const edit = normalizeWorkspaceEdit(payload.edit);
  if (!MODELS[modelId] || (designId && (typeof designId !== "string" || !UUID_RE.test(designId))) || !edit) return json({ error: "Invalid saved workspace." }, 400);
  if (designId && !await env.DB.prepare("SELECT id FROM designs WHERE id = ? AND user_id = ? AND model_id = ?").bind(designId, user.id, modelId).first()) return json({ error: "Design not found." }, 404);
  for (const id of new Set(edit.logos.map((logo) => logo.id))) {
    if (!await env.DB.prepare("SELECT id FROM logos WHERE id = ? AND user_id = ?").bind(id, user.id).first()) return json({ error: "Logo not found." }, 404);
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO design_edits (user_id, design_key, model_id, design_id, edit_json, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, design_key) DO UPDATE SET edit_json = excluded.edit_json, updated_at = excluded.updated_at")
      .bind(user.id, designId || `base:${modelId}`, modelId, designId, JSON.stringify(edit), now),
    env.DB.prepare("INSERT INTO client_workspaces (user_id, model_id, design_id, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET model_id = excluded.model_id, design_id = excluded.design_id, updated_at = excluded.updated_at")
      .bind(user.id, modelId, designId, now)
  ]);
  return json({ ok: true, updatedAt: now });
}

async function uploadLogo(request, env, user) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_LOGO_BYTES + 100_000) return json({ error: "Logo is too large (5 MB maximum)." }, 413);
  const form = await request.formData().catch(() => null);
  const file = form?.get("logo");
  if (!file || typeof file.arrayBuffer !== "function") return json({ error: "Choose a logo file." }, 400);
  if (!LOGO_TYPES.has(file.type) || file.size < 1 || file.size > MAX_LOGO_BYTES) {
    return json({ error: "Use a PNG, JPEG, or WebP logo up to 5 MB." }, 400);
  }
  const id = crypto.randomUUID();
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const objectKey = `logos/${user.id}/${id}.${extension}`;
  const createdAt = new Date().toISOString();
  await env.DESIGNS.put(objectKey, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { userId: user.id, logoId: id }
  });
  try {
    await env.DB.prepare(
      "INSERT INTO logos (id, user_id, name, object_key, content_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, user.id, safeFilename(file.name || `logo.${extension}`), objectKey, file.type, file.size, createdAt).run();
  } catch (error) {
    await env.DESIGNS.delete(objectKey);
    throw error;
  }
  return json({ logo: { id, name: safeFilename(file.name), contentType: file.type, sizeBytes: file.size, createdAt, fileUrl: `/api/logos/${id}/file` } }, 201);
}

async function getLogoFile(request, env, user) {
  const logoId = pathPart(request, 3);
  if (!UUID_RE.test(logoId)) return json({ error: "Invalid logo request." }, 400);
  const logo = await env.DB.prepare("SELECT object_key, name FROM logos WHERE id = ? AND user_id = ?").bind(logoId, user.id).first();
  return logo ? r2Response(env, logo.object_key, logo.name) : json({ error: "Logo not found." }, 404);
}

async function createDesignRequest(request, env, user) {
  const payload = await readJson(request, 22 * 1024 * 1024);
  if (payload instanceof Response) return payload;
  const designId = String(payload.designId || "");
  const logoIds = [...new Set((Array.isArray(payload.logoIds) ? payload.logoIds : [payload.logoId]).filter(Boolean).map(String))].slice(0, 8);
  const logoId = logoIds[0] || "";
  const message = String(payload.message || "").trim();
  const placement = payload.placement && typeof payload.placement === "object" ? payload.placement : null;
  if (!UUID_RE.test(designId)) return json({ error: "Choose a generated design first." }, 400);
  if (message.length < 3 || message.length > 2000) return json({ error: "Add a message between 3 and 2,000 characters." }, 400);
  const design = await env.DB.prepare("SELECT id, model_id, prompt FROM designs WHERE id = ? AND user_id = ?").bind(designId, user.id).first();
  if (!design) return json({ error: "Design not found." }, 404);
  for (const requestedLogoId of logoIds) {
    const logo = UUID_RE.test(requestedLogoId) && await env.DB.prepare("SELECT id FROM logos WHERE id = ? AND user_id = ?").bind(requestedLogoId, user.id).first();
    if (!logo) return json({ error: "One of the selected logos is unavailable." }, 400);
  }

  const preview = parseImageDataUrl(String(payload.previewDataUrl || ""));
  if (!preview || preview.bytes.byteLength > MAX_PREVIEW_BYTES) return json({ error: "The request preview is missing or too large." }, 400);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const objectKey = `requests/${user.id}/${id}.${preview.extension}`;
  await env.DESIGNS.put(objectKey, preview.bytes, {
    httpMetadata: { contentType: preview.contentType },
    customMetadata: { userId: user.id, requestId: id, designId }
  });
  try {
    await env.DB.prepare(
      "INSERT INTO design_requests (id, user_id, design_id, logo_id, message, placement_json, preview_object_key, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)"
    ).bind(id, user.id, designId, logoId || null, message, JSON.stringify({ ...(placement || {}), logoIds }), objectKey, now, now).run();
  } catch (error) {
    await env.DESIGNS.delete(objectKey);
    throw error;
  }

  return json({
    request: { id, designId, message, status: "new", createdAt: now, previewUrl: `/api/requests/${id}/preview` }
  }, 201);
}

async function listRequests(env, user) {
  const { results = [] } = await env.DB.prepare(
    "SELECT id, design_id, message, status, created_at, updated_at FROM design_requests WHERE user_id = ? ORDER BY created_at DESC"
  ).bind(user.id).all();
  return json({ requests: results.map((item) => ({ ...item, previewUrl: `/api/requests/${item.id}/preview` })) });
}

async function getRequestPreview(request, env, user) {
  const id = pathPart(request, 3);
  if (!UUID_RE.test(id)) return json({ error: "Invalid request preview." }, 400);
  const row = await env.DB.prepare("SELECT preview_object_key FROM design_requests WHERE id = ? AND user_id = ?").bind(id, user.id).first();
  return row ? r2Response(env, row.preview_object_key, `vitalini-request-${id}.jpg`) : json({ error: "Request not found." }, 404);
}

async function createInvite(request, env) {
  const payload = await readJson(request, 10_000);
  if (payload instanceof Response) return payload;
  const label = String(payload.label || "").trim().slice(0, 120);
  const validDays = Math.min(90, Math.max(1, Number(payload.validDays) || 14));
  const maxUses = Math.min(50, Math.max(1, Number(payload.maxUses) || 1));
  const code = makeInviteCode();
  const id = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO invite_codes (id, code_hash, label, max_uses, used_count, expires_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)"
  ).bind(id, await sha256Hex(normalizeInviteCode(code)), label, maxUses, expiresAt, now.toISOString()).run();
  return json({ invite: { id, code, label, maxUses, usedCount: 0, expiresAt, createdAt: now.toISOString() } }, 201);
}

async function listInvites(env) {
  const { results = [] } = await env.DB.prepare(
    "SELECT id, label, max_uses, used_count, expires_at, created_at, last_used_at FROM invite_codes ORDER BY created_at DESC LIMIT 100"
  ).all();
  return json({ invites: results });
}

async function listAdminUsers(env) {
  const { results = [] } = await env.DB.prepare(
    "SELECT u.id, u.username, u.email, u.status, u.created_at, u.last_login_at, (SELECT COUNT(*) FROM designs d WHERE d.user_id = u.id) AS design_count, (SELECT COUNT(*) FROM design_requests r WHERE r.user_id = u.id) AS request_count FROM users u ORDER BY u.created_at DESC"
  ).all();
  return json({ users: results });
}

async function updateAdminUser(request, env) {
  const userId = pathPart(request, 4);
  const payload = await readJson(request, 10_000);
  if (payload instanceof Response) return payload;
  const status = String(payload.status || "");
  if (!UUID_RE.test(userId) || !["approved", "suspended"].includes(status)) return json({ error: "Invalid client status." }, 400);
  const result = await env.DB.prepare("UPDATE users SET status = ? WHERE id = ? RETURNING id")
    .bind(status, userId).first();
  if (!result) return json({ error: "User not found." }, 404);
  if (status === "suspended") await env.DB.prepare("DELETE FROM user_sessions WHERE user_id = ?").bind(userId).run();
  return json({ id: userId, status });
}

async function deleteAdminUser(request, env) {
  const userId = pathPart(request, 4);
  if (!UUID_RE.test(userId)) return json({ error: "Invalid user." }, 400);
  const user = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();
  if (!user) return json({ error: "User not found." }, 404);
  const [designObjects, logoObjects, requestObjects] = await Promise.all([
    env.DB.prepare("SELECT object_key FROM designs WHERE user_id = ?").bind(userId).all(),
    env.DB.prepare("SELECT object_key FROM logos WHERE user_id = ?").bind(userId).all(),
    env.DB.prepare("SELECT preview_object_key FROM design_requests WHERE user_id = ?").bind(userId).all()
  ]);
  const objectKeys = [
    ...(designObjects.results || []).map((item) => item.object_key),
    ...(logoObjects.results || []).map((item) => item.object_key),
    ...(requestObjects.results || []).map((item) => item.preview_object_key)
  ].filter(Boolean);
  await Promise.all(objectKeys.map((key) => env.DESIGNS.delete(key)));
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
  return json({ id: userId, deleted: true, privateFilesDeleted: objectKeys.length });
}

async function getAdminUser(request, env) {
  const userId = pathPart(request, 4);
  if (!UUID_RE.test(userId)) return json({ error: "Invalid user." }, 400);
  const profile = await getAdminUserProfile(env, userId);
  return profile ? json(profile) : json({ error: "User not found." }, 404);
}

async function getAdminUserProfile(env, userId) {
  const user = await env.DB.prepare("SELECT id, username, email, status, created_at, last_login_at FROM users WHERE id = ?").bind(userId).first();
  if (!user) return null;
  const [designResult, logoResult, requestResult, usage] = await Promise.all([
    env.DB.prepare("SELECT id, model_id, prompt, status, render_preset, created_at, updated_at FROM designs WHERE user_id = ? ORDER BY created_at DESC").bind(userId).all(),
    env.DB.prepare("SELECT id, name, content_type, size_bytes, created_at FROM logos WHERE user_id = ? ORDER BY created_at DESC").bind(userId).all(),
    env.DB.prepare("SELECT id, design_id, message, status, created_at, updated_at FROM design_requests WHERE user_id = ? ORDER BY created_at DESC").bind(userId).all(),
    getDailyUsage(env, userId)
  ]);
  return {
    user,
    usage,
    designs: (designResult.results || []).map((item) => ({ ...serializeDesign(item), imageUrl: `/api/admin/designs/${item.id}/image` })),
    logos: (logoResult.results || []).map((item) => ({ ...item, fileUrl: `/api/admin/logos/${item.id}/file` })),
    requests: (requestResult.results || []).map((item) => ({ ...item, previewUrl: `/api/admin/requests/${item.id}/preview` }))
  };
}

async function listAdminRequests(env) {
  const { results = [] } = await env.DB.prepare(
    "SELECT r.id, r.user_id, r.design_id, r.message, r.status, r.created_at, r.updated_at, u.username, u.email, d.model_id FROM design_requests r JOIN users u ON u.id = r.user_id JOIN designs d ON d.id = r.design_id ORDER BY r.created_at DESC"
  ).all();
  return json({ requests: results.map((item) => ({ ...item, previewUrl: `/api/admin/requests/${item.id}/preview` })) });
}

async function getAdminRequest(request, env) {
  const requestId = pathPart(request, 4);
  if (!UUID_RE.test(requestId)) return json({ error: "Invalid request." }, 400);
  const item = await env.DB.prepare(
    "SELECT r.id, r.user_id, r.design_id, r.logo_id, r.message, r.placement_json, r.status, r.created_at, r.updated_at, u.username, u.email, d.model_id, d.prompt, d.status AS design_status, d.render_preset, d.created_at AS design_created_at FROM design_requests r JOIN users u ON u.id = r.user_id JOIN designs d ON d.id = r.design_id WHERE r.id = ?"
  ).bind(requestId).first();
  if (!item) return json({ error: "Request not found." }, 404);
  const profile = await getAdminUserProfile(env, item.user_id);
  return json({
    request: {
      id: item.id,
      userId: item.user_id,
      logoId: item.logo_id || null,
      message: item.message,
      placement: parseJsonObject(item.placement_json),
      status: item.status,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      username: item.username,
      email: item.email,
      previewUrl: `/api/admin/requests/${item.id}/preview`,
      design: {
        id: item.design_id,
        modelId: item.model_id,
        prompt: item.prompt,
        status: item.design_status || "draft",
        renderPreset: item.render_preset || null,
        createdAt: item.design_created_at,
        imageUrl: `/api/admin/designs/${item.design_id}/image`
      }
    },
    profile
  });
}

async function updateAdminRequest(request, env) {
  const id = pathPart(request, 4);
  const payload = await readJson(request, 10_000);
  if (payload instanceof Response) return payload;
  const status = String(payload.status || "");
  if (!UUID_RE.test(id) || !REQUEST_STATUSES.has(status)) return json({ error: "Invalid request status." }, 400);
  const updatedAt = new Date().toISOString();
  const result = await env.DB.prepare("UPDATE design_requests SET status = ?, updated_at = ? WHERE id = ? RETURNING id")
    .bind(status, updatedAt, id).first();
  return result ? json({ id, status, updatedAt }) : json({ error: "Request not found." }, 404);
}

async function updateAdminDesign(request, env) {
  const id = pathPart(request, 4);
  const payload = await readJson(request, 10_000);
  if (payload instanceof Response) return payload;
  const status = String(payload.status || "");
  if (!UUID_RE.test(id) || !DESIGN_STATUSES.has(status)) return json({ error: "Invalid design status." }, 400);
  const updatedAt = new Date().toISOString();
  const result = await env.DB.prepare("UPDATE designs SET status = ?, updated_at = ? WHERE id = ? RETURNING id")
    .bind(status, updatedAt, id).first();
  return result ? json({ id, status, updatedAt }) : json({ error: "Design not found." }, 404);
}

async function getAdminDesignImage(request, env) {
  const id = pathPart(request, 4);
  if (!UUID_RE.test(id)) return json({ error: "Invalid design." }, 400);
  const row = await env.DB.prepare("SELECT object_key FROM designs WHERE id = ?").bind(id).first();
  return row ? r2Response(env, row.object_key, `${id}.png`) : json({ error: "Design not found." }, 404);
}

async function getAdminRequestPreview(request, env) {
  const id = pathPart(request, 4);
  if (!UUID_RE.test(id)) return json({ error: "Invalid request." }, 400);
  const row = await env.DB.prepare("SELECT preview_object_key FROM design_requests WHERE id = ?").bind(id).first();
  return row ? r2Response(env, row.preview_object_key, `vitalini-request-${id}.jpg`) : json({ error: "Request not found." }, 404);
}

async function getAdminLogoFile(request, env) {
  const id = pathPart(request, 4);
  if (!UUID_RE.test(id)) return json({ error: "Invalid logo." }, 400);
  const row = await env.DB.prepare("SELECT object_key, name FROM logos WHERE id = ?").bind(id).first();
  return row ? r2Response(env, row.object_key, row.name) : json({ error: "Logo not found." }, 404);
}

async function r2Response(env, objectKey, filename) {
  const object = await env.DESIGNS.get(objectKey);
  if (!object) return json({ error: "File not found." }, 404);
  const headers = new Headers({
    "content-type": object.httpMetadata?.contentType || "application/octet-stream",
    "cache-control": "private, no-store",
    "content-disposition": `inline; filename="${safeFilename(filename)}"`
  });
  return new Response(object.body, { headers });
}

async function getAdminHandoffAsset(request, env) {
  const assets = {
    "production-layout-vp9655": ["admin-handoff/v1/vp9655-production-layout.png", "VP9655-production-layout.png"],
    "past-work-example": ["admin-handoff/v1/past-work-example.png", "PAST_WORK-example.png"],
    "past-work-cut-lines": ["admin-handoff/v1/past-work-cut-lines.png", "PAST_WORK-cut-lines.png"],
    "procedural-workflow": ["admin-handoff/v1/opus-procedural-workflow.txt", "operator-supplied-workflow.txt"],
    "contrast-trim": ["admin-handoff/v2/CONTRAST.png", "CONTRAST.png"],
    "zipper-trim": ["admin-handoff/v2/ZIPPER.png", "ZIPPER.png"],
    "ai-agent-instructions-v2": ["admin-handoff/v2/04_AI_AGENT_INSTRUCTIONS.md", "04_AI_AGENT_INSTRUCTIONS.md"],
    "quality-01_hidden_zones_no_stretch": ["admin-handoff/v2/examples/01_hidden_zones_no_stretch.png", "01_hidden_zones_no_stretch.png"],
    "quality-02_vector_quality": ["admin-handoff/v2/examples/02_vector_quality.png", "02_vector_quality.png"],
    "quality-03_sky_and_edges": ["admin-handoff/v2/examples/03_sky_and_edges.png", "03_sky_and_edges.png"],
    "quality-04_exact_cut_lines": ["admin-handoff/v2/examples/04_exact_cut_lines.png", "04_exact_cut_lines.png"],
    "quality-05_seam_artifact": ["admin-handoff/v2/examples/05_seam_artifact.png", "05_seam_artifact.png"],
    "quality-06_target_result": ["admin-handoff/v2/examples/06_target_result.png", "06_target_result.png"]
  };
  const id = pathPart(request, 4);
  const asset = Object.hasOwn(assets, id) ? assets[id] : null;
  return asset ? r2Response(env, asset[0], asset[1]) : json({ error: "Reference not found." }, 404);
}

function serializeDesign(row) {
  return {
    id: row.id,
    modelId: row.model_id,
    prompt: row.prompt,
    status: row.status || "draft",
    renderPreset: row.render_preset || null,
    createdAt: row.created_at,
    imageUrl: `/api/designs/${row.id}/image`
  };
}

function publicUser(user) {
  return { id: user.id, username: user.username, email: user.email, status: user.status, createdAt: user.created_at };
}

async function readJson(request, maxBytes) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxBytes) return json({ error: "Request is too large." }, 413);
  try {
    return await request.json();
  } catch {
    return json({ error: "Expected a JSON request." }, 400);
  }
}

async function allowAuthAttempt(request, env) {
  if (!env.IMAGE_RATE_LIMITER) return true;
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const { success } = await env.IMAGE_RATE_LIMITER.limit({ key: `auth:${ip}` });
  return success;
}

function bearerToken(request) {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

async function hashPassword(password, pepper, salt = randomToken(16), iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`${password}\u0000${pepper}`), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: base64UrlToBytes(salt), iterations, hash: "SHA-256" },
    key,
    256
  );
  return { hash: bytesToBase64Url(new Uint8Array(bits)), salt, iterations };
}

async function verifyPassword(password, pepper, salt, expectedHash, iterations) {
  const actual = await hashPassword(password, pepper, salt, Number(iterations));
  return timingSafeEqualBytes(base64UrlToBytes(actual.hash), base64UrlToBytes(expectedHash));
}

function timingSafeEqualText(a, b) {
  return timingSafeEqualBytes(new TextEncoder().encode(a), new TextEncoder().encode(b));
}

function timingSafeEqualBytes(a, b) {
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) difference |= (a[index] || 0) ^ (b[index] || 0);
  return difference === 0;
}

async function sha256Hex(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return base64ToBytes(normalized);
}

function makeInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const value = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
  return `VTLN-${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`;
}

export function normalizeInviteCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normalizeUsername(value) {
  return String(value || "").trim().replace(/\s+/g, "_");
}

function parseImageDataUrl(value) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(value);
  if (!match) return null;
  try {
    const bytes = base64ToBytes(match[2]);
    return { bytes, contentType: match[1], extension: match[1] === "image/png" ? "png" : match[1] === "image/webp" ? "webp" : "jpg" };
  } catch {
    return null;
  }
}

function parseJsonObject(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function safeFilename(value) {
  return String(value || "file").replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 120) || "file";
}

function pathPart(request, index) {
  return new URL(request.url).pathname.split("/")[index] || "";
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

export function normalizeRenderPreset() {
  return { name: "medium-1536", quality: "medium", size: "1536x1536" };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function withCors(response, origin) {
  const headers = new Headers(response.headers);
  if (origin) headers.set("access-control-allow-origin", origin);
  headers.set("vary", "Origin");
  headers.set("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
  headers.set("access-control-allow-headers", "Content-Type, Authorization, X-Designer-ID");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
