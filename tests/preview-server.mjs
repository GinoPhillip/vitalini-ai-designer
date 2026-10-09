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
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp" };
const json = (res, value, status = 200) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(value)); };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const path = url.pathname;
  try {
    if (path === "/config.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end('window.VITALINI_API_BASE = "";'); }
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
    if (path.startsWith("/api/logos/")) {
      const logo = logoFiles.get(path.split("/")[3]);
      if (logo) { res.writeHead(200, { "content-type": logo.type }); return res.end(logo.bytes); }
      res.writeHead(200, { "content-type": "image/svg+xml" });
      return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="160" viewBox="0 0 400 160"><rect x="5" y="5" width="390" height="150" rx="24" fill="#172b3b"/><text x="200" y="75" text-anchor="middle" font-family="sans-serif" font-size="45" font-weight="700" fill="white">SKI CLUB</text><text x="200" y="117" text-anchor="middle" font-family="sans-serif" font-size="25" fill="#9bdded">VITALINI</text></svg>');
    }
    let filename = path.startsWith("/api/logos/") ? "assets/vitalini-logo.png" : path.startsWith("/api/designs/") ? "assets/models/VP9655-base.png" : path === "/" ? "index.html" : decodeURIComponent(path.slice(1));
    const file = resolve(root, filename);
    if (!file.startsWith(`${root}/`)) return json(res, { error: "Not found" }, 404);
    let data = await readFile(file);
    if (filename === "index.html") data = Buffer.from(data.toString().replace("</body>", '<div style="position:fixed;z-index:200;bottom:8px;right:12px;font:9px system-ui;color:#647a61;pointer-events:none">LOCAL PREVIEW · FIXTURE DATA</div></body>'));
    res.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  } catch (error) { json(res, { error: error.message }, 404); }
});
server.listen(port, "127.0.0.1", () => console.log(`Isolated UI preview: http://127.0.0.1:${port}`));
