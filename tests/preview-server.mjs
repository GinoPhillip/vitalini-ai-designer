// Isolated UI fixtures. This server never contacts OpenAI or the production API.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";

const root = resolve("public");
const port = Number(process.env.PORT || 4173);
const user = { id: "preview-client", username: "Studio_preview", email: "preview@example.test", status: "approved" };
const usage = { used: 2, limit: 20, remaining: 18 };
const designs = [
  { id: "preview-1", modelId: "VP9655", prompt: "Minimal alpine geometry in ice blue, bone white, and deep navy", status: "draft", imageUrl: "/api/designs/preview-1/image" },
  { id: "preview-2", modelId: "VP9655", prompt: "Quiet tonal topographic lines in charcoal and graphite", status: "draft", imageUrl: "/api/designs/preview-2/image" }
];
const requests = [];
const logos = [{ id: "11111111-1111-4111-8111-111111111111", name: "Vitalini.png", fileUrl: "/api/logos/11111111-1111-4111-8111-111111111111/file" }];
const logoFiles = new Map();
const edits = new Map();
let workspace = null;
const adminRequestId = "77777777-7777-4777-8777-777777777777";
const adminDesignId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const adminProfile = () => ({ user, usage, designs: [{ ...designs[0], id: adminDesignId, createdAt: "2026-10-09T10:00:00Z", imageUrl: `/api/admin/designs/${adminDesignId}/image` }],
  logos: logos.map((logo) => ({ ...logo, fileUrl: `/api/admin/logos/${logo.id}/file` })),
  requests: [{ id: adminRequestId, design_id: adminDesignId, message: "Please keep the blue accents and place the club logo on the chest.", status: "new", created_at: "2026-10-09T11:00:00Z" }] });
const adminRequest = () => ({ id: adminRequestId, userId: user.id, username: user.username, email: user.email,
  message: adminProfile().requests[0].message, status: "new", createdAt: "2026-10-09T11:00:00Z",
  logoId: logos[0].id, previewUrl: `/api/admin/requests/${adminRequestId}/preview`, design: adminProfile().designs[0],
  placement: { logos: [{ id: logos[0].id, instanceId: "ffffffff-ffff-4fff-8fff-ffffffffffff", x: 68, y: 58, size: 18, rotation: 15 }],
    trimColors: [{ label: "Zipper", material: "Zipper__Velcro_FRONT_2559", color: "#00183f" }] } });
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp" };
const json = (res, value, status = 200) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(value)); };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const path = url.pathname;
  try {
    if (path === "/config.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end('window.VITALINI_API_BASE = "";'); }
    if (path === "/api/admin/login") return json(res, { token: "preview-admin-only" });
    if (path === "/api/admin/users") return json(res, { users: [{ ...user, design_count: designs.length, request_count: 1 }] });
    if (path === "/api/admin/invites") return json(res, { invites: [] });
    if (path === "/api/admin/requests") return json(res, { requests: [{ ...adminProfile().requests[0], username: user.username, model_id: "VP9655" }] });
    if (path === `/api/admin/requests/${adminRequestId}`) return json(res, { request: adminRequest(), profile: adminProfile() });
    if (path.startsWith("/api/admin/users/")) return json(res, adminProfile());
    if (path === `/api/admin/requests/${adminRequestId}/preview`) {
      const base = await readFile(resolve(root, "assets/models/VP9655-base.png"));
      res.writeHead(200, { "content-type": "image/svg+xml" });
      return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="756" height="756"><image width="756" height="756" href="data:image/png;base64,${base.toString("base64")}"/><g transform="translate(516 438) rotate(15)"><rect x="-68" y="-27" width="136" height="54" rx="8" fill="#172b3b"/><text x="0" y="3" font-family="sans-serif" font-weight="700" font-size="17" fill="white" text-anchor="middle">SKI CLUB</text></g></svg>`);
    }
    if (path.startsWith("/api/admin/designs/") && path.endsWith("/image")) {
      res.writeHead(200, { "content-type": "image/png" }); return res.end(await readFile(resolve(root, "assets/models/VP9655-base.png")));
    }
    if (path === "/api/auth/login" || path === "/api/auth/register" || path === "/api/auth/session") return json(res, { token: "preview-only", user, usage });
    if (path === "/api/auth/logout") return json(res, { ok: true });
    if (path === "/api/workspace") {
      if (req.method === "GET") {
        const modelId = url.searchParams.get("model_id");
        const designId = url.searchParams.get("design_id") || null;
        return json(res, { workspace: modelId ? { modelId, designId, edit: edits.get(designId || `base:${modelId}`) || null } : workspace });
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      workspace = JSON.parse(Buffer.concat(chunks).toString());
      edits.set(workspace.designId || `base:${workspace.modelId}`, workspace.edit);
      return json(res, { ok: true });
    }
    if (path === "/api/account") return json(res, { user, usage, counts: { designs: designs.length, logos: 2, requests: requests.length }, requests });
    if (path === "/api/designs") return json(res, { designs: designs.map((design) => ({ ...design, modelId: url.searchParams.get("model_id") })) });
    if (path === "/api/generate") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString());
      const design = { ...designs[0], id: `preview-${Date.now()}`, prompt: payload.prompt, modelId: payload.modelId };
      designs.unshift(design);
      return setTimeout(() => json(res, { design, usage }), 2200);
    }
    if (path === "/api/logos") {
      if (req.method === "GET") return json(res, { logos });
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const request = new Request(url, { method: "POST", headers: req.headers, body: Buffer.concat(chunks) });
      const form = await request.formData();
      const logo = form.get("logo");
      const entry = { id: crypto.randomUUID(), name: logo.name };
      entry.fileUrl = `/api/logos/${entry.id}/file`;
      logos.unshift(entry);
      logoFiles.set(entry.id, { bytes: Buffer.from(await logo.arrayBuffer()), type: logo.type });
      return json(res, { logo: entry }, 201);
    }
    if (path === "/api/requests") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const request = { id: crypto.randomUUID(), message: body.message, status: "new" };
      requests.unshift(request);
      return json(res, { request }, 201);
    }
    if (path.startsWith("/api/logos/") || path.startsWith("/api/admin/logos/")) {
      const logo = logoFiles.get(path.split("/")[path.startsWith("/api/admin/") ? 4 : 3]);
      if (logo) { res.writeHead(200, { "content-type": logo.type }); return res.end(logo.bytes); }
      res.writeHead(200, { "content-type": "image/svg+xml" });
      return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="160" viewBox="0 0 400 160"><rect x="5" y="5" width="390" height="150" rx="24" fill="#172b3b"/><text x="200" y="75" text-anchor="middle" font-family="sans-serif" font-size="45" font-weight="700" fill="white">SKI CLUB</text><text x="200" y="117" text-anchor="middle" font-family="sans-serif" font-size="25" fill="#9bdded">VITALINI</text></svg>');
    }
    let filename = path.startsWith("/api/logos/") ? "assets/vitalini-logo.png" : path.startsWith("/api/designs/") ? "assets/models/VP9655-base.png" : path === "/" ? "index.html" : decodeURIComponent(path.slice(1));
    const file = resolve(root, filename);
    if (!file.startsWith(`${root}/`)) return json(res, { error: "Not found" }, 404);
    let data = await readFile(file);
    if (["index.html", "admin.html"].includes(filename)) data = Buffer.from(data.toString().replace("</body>", '<div style="position:fixed;z-index:200;bottom:8px;right:12px;font:9px system-ui;color:#647a61;pointer-events:none">LOCAL PREVIEW · FIXTURE DATA</div></body>'));
    res.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  } catch (error) { json(res, { error: error.message }, 404); }
});
server.listen(port, "127.0.0.1", () => console.log(`Isolated UI preview: http://127.0.0.1:${port}`));
