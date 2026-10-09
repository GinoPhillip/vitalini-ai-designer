import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import worker, { normalizeWorkspaceEdit } from "../src/index.js";
import { normalizeRotation, rotatedExtent, logoLocalPoint } from "../public/logo-geometry.js";

const client = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const design = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const logo = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const instance = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const edit = () => ({ logos: [{ id: logo, instanceId: instance, x: 43, y: 62, size: 20, rotation: 35 }], colors: ["#ffffff", "#00183f"], message: "Please refine", prompt: "Blue stripes" });

function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of ["0001_create_designs.sql", "0002_client_portal.sql", "0003_saved_workspace.sql"]) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  for (const [id, name] of [[client, "client"], [other, "other"]]) {
    sqlite.prepare("INSERT INTO users (id,username,email,password_hash,password_salt,password_iterations,created_at) VALUES (?,?,?,?,?,?,?)").run(id, name, `${name}@example.test`, "test-only", "test-only", 1, "2026-01-01");
    sqlite.prepare("INSERT INTO user_sessions VALUES (?,?,?,?,?)").run(createHash("sha256").update(name).digest("hex"), id, "2026-01-01", "2099-01-01", "2026-01-01");
  }
  sqlite.prepare("INSERT INTO designs (id,user_id,model_id,prompt,object_key,created_at) VALUES (?,?,?,?,?,?)").run(design, client, "VP9655", "Blue stripes", "test.png", "2026-01-01");
  sqlite.prepare("INSERT INTO logos VALUES (?,?,?,?,?,?,?)").run(logo, client, "Club.png", "logo.png", "image/png", 10, "2026-01-01");
  const prepare = (sql) => {
    let args = [];
    return { bind(...values) { args = values; return this; },
      async first() { return sqlite.prepare(sql).get(...args) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      async run() { return sqlite.prepare(sql).run(...args); } };
  };
  return { sqlite, env: { DB: { prepare, batch: async (items) => Promise.all(items.map((item) => item.run())) } } };
}

function request(token, method, body, query = "") {
  return new Request(`https://studio.test/api/workspace${query}`, { method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}) });
}

test("handoff references require admin authentication and only serve fixed private keys", async () => {
  const { sqlite, env } = database();
  sqlite.prepare("INSERT INTO admin_sessions (token_hash,created_at,expires_at) VALUES (?,?,?)").run(createHash("sha256").update("admin").digest("hex"), "2026-01-01", "2099-01-01");
  const keys = [];
  env.DESIGNS = { async get(key) { keys.push(key); return { body: "private-reference", httpMetadata: { contentType: key.endsWith(".txt") ? "text/plain" : "image/png" } }; } };
  const req = (token, name = "production-layout-vp9655") => new Request(`https://studio.test/api/admin/handoff-assets/${name}`, { headers: { authorization: `Bearer ${token}` } });
  for (const token of ["client", "other", "unknown", ""]) assert.equal((await worker.fetch(req(token), env)).status, 401);
  assert.equal(keys.length, 0);
  for (const name of ["production-layout-vp9655", "past-work-example", "past-work-cut-lines", "procedural-workflow"]) {
    const response = await worker.fetch(req("admin", name), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(await response.text(), "private-reference");
  }
  assert.deepEqual(keys, ["admin-handoff/v1/vp9655-production-layout.png", "admin-handoff/v1/past-work-example.png", "admin-handoff/v1/past-work-cut-lines.png", "admin-handoff/v1/opus-procedural-workflow.txt"]);
  assert.equal((await worker.fetch(req("admin", "__proto__"), env)).status, 404);
  assert.equal((await worker.fetch(req("admin", "some-other-client.png"), env)).status, 404);
  assert.equal(keys.length, 4);
  env.DESIGNS.get = async () => null;
  assert.equal((await worker.fetch(req("admin"), env)).status, 404);
  sqlite.close();
});

test("workspace validation rejects invalid placement, excessive logos and executable colors", () => {
  assert.deepEqual(normalizeWorkspaceEdit(edit()), edit());
  const invalid = edit(); invalid.logos[0].rotation = NaN;
  assert.equal(normalizeWorkspaceEdit(invalid), null);
  assert.equal(normalizeWorkspaceEdit({ ...edit(), logos: Array(9).fill(edit().logos[0]) }), null);
  assert.equal(normalizeWorkspaceEdit({ ...edit(), colors: ["url(javascript:bad)"] }), null);
  assert.equal(normalizeWorkspaceEdit({ ...edit(), logos: [edit().logos[0], edit().logos[0]] }), null);
});

test("rotation bounds and hit testing account for orientation", () => {
  assert.equal(normalizeRotation(450), 90);
  assert.equal(normalizeRotation(-450), -90);
  const extent = rotatedExtent(20, 2, 90);
  assert.ok(Math.abs(extent.x - 20) < 1e-8 && Math.abs(extent.y - 10) < 1e-8);
  const local = logoLocalPoint({ x: 10, y: 30 }, { centerX: 10, centerY: 10 }, 90);
  assert.ok(Math.abs(local.x - 20) < 1e-8 && Math.abs(local.y) < 1e-8);
});

test("account workspace survives new requests and stores edits separately per design", async () => {
  const { sqlite, env } = database();
  const snapshot = { modelId: "VP9655", designId: design, edit: edit() };
  assert.equal((await worker.fetch(request("client", "POST", snapshot), env)).status, 200);
  assert.deepEqual((await (await worker.fetch(request("client", "GET"), env)).json()).workspace.edit, edit());
  const blank = { ...snapshot, designId: null, edit: { ...edit(), logos: [] } };
  assert.equal((await worker.fetch(request("client", "POST", blank), env)).status, 200);
  assert.equal((await (await worker.fetch(request("client", "GET"), env)).json()).workspace.designId, null);
  const saved = await worker.fetch(request("client", "GET", null, `?model_id=VP9655&design_id=${design}`), env);
  assert.deepEqual((await saved.json()).workspace.edit, edit());
  sqlite.close();
});

test("workspace API never exposes another client's designs or logos", async () => {
  const { sqlite, env } = database();
  assert.equal((await worker.fetch(request("other", "POST", { modelId: "VP9655", designId: design, edit: edit() }), env)).status, 404);
  assert.equal((await worker.fetch(request("other", "POST", { modelId: "VP9655", designId: null, edit: edit() }), env)).status, 404);
  assert.equal((await worker.fetch(request("other", "GET", null, `?model_id=VP9655&design_id=${design}`), env)).status, 404);
  assert.equal((await worker.fetch(request("unknown", "GET"), env)).status, 401);
  sqlite.close();
});

test("new workspace tables cascade on account deletion", async () => {
  const { sqlite, env } = database();
  await worker.fetch(request("client", "POST", { modelId: "VP9655", designId: design, edit: edit() }), env);
  sqlite.prepare("DELETE FROM users WHERE id = ?").run(client);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM design_edits").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM client_workspaces").get().n, 0);
  sqlite.close();
});

test("admin request details expose the legacy logo reference only to authenticated admins", async () => {
  const { sqlite, env } = database();
  const requestId = "77777777-7777-4777-8777-777777777777";
  sqlite.prepare("INSERT INTO admin_sessions (token_hash,created_at,expires_at) VALUES (?,?,?)").run(createHash("sha256").update("admin").digest("hex"), "2026-01-01", "2099-01-01");
  sqlite.prepare("INSERT INTO design_requests (id,user_id,design_id,logo_id,message,preview_object_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(requestId, client, design, logo, "Please refine", "preview.jpg", "2026-01-01", "2026-01-01");
  const req = (token) => new Request(`https://studio.test/api/admin/requests/${requestId}`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal((await worker.fetch(req("client"), env)).status, 401);
  const response = await worker.fetch(req("admin"), env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.request.logoId, logo);
  assert.equal(payload.profile.logos[0].id, logo);
  assert.equal(payload.request.design.modelId, "VP9655");
  sqlite.close();
});

test("submitted requests persist all verified logo references for the handoff", async () => {
  const { sqlite, env } = database();
  env.DESIGNS = { put: async () => {}, delete: async () => {} };
  const body = { designId: design, logoIds: [logo, logo], message: "Please refine", placement: { logos: edit().logos },
    previewDataUrl: "data:image/png;base64,iVBORw0KGgo=" };
  const response = await worker.fetch(new Request("https://studio.test/api/requests", { method: "POST", headers: { authorization: "Bearer client", "content-type": "application/json" }, body: JSON.stringify(body) }), env);
  assert.equal(response.status, 201);
  const saved = sqlite.prepare("SELECT placement_json FROM design_requests").get();
  assert.deepEqual(JSON.parse(saved.placement_json).logoIds, [logo]);
  assert.deepEqual(JSON.parse(saved.placement_json).logos, edit().logos);
  sqlite.close();
});
