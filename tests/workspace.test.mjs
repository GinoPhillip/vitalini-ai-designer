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
