import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createZip, crc32 } from "../public/zip.js";
import { buildRequestPackage, VECTOR_BRIEF, QUALITY_EXAMPLES, requestLogoIds, usedRequestLogos } from "../public/request-package.js";
const id = "77777777-7777-4777-8777-777777777777", designId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const logoId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", unrelated = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const library = [{ id: logoId, name: "../Club logo.png" }, { id: unrelated, name: "Unrelated.png" }];
const request = () => ({ id, username: "Client", email: "private@example.test", message: "Keep blue.\nLogo on chest.", createdAt: "2026-10-09",
  design: { id: designId, modelId: "VP9655", prompt: "Blue stripes" },
  placement: { logos: [{ id: logoId, instanceId: id, x: 68, y: 58, size: 18, rotation: 35 },
    { id: logoId, instanceId: designId, x: 25, y: 60, size: 12, rotation: -20 }], trimColors: [{ color: "#00183f", label: "Zipper" }] } });

function unzip(blobBytes) {
  // Independent standard-library reader validates CRC, UTF-8 names and all records.
  return JSON.parse(execFileSync("python3", ["-c", "import sys,io,zipfile,json,base64;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));assert z.testzip() is None;print(json.dumps({n:base64.b64encode(z.read(n)).decode() for n in z.namelist()}))"], { input: blobBytes, maxBuffer: 4 * 1024 * 1024 }).toString());
}
const text = (entries, path) => Buffer.from(entries[path], "base64").toString();
const fixtureType = (path) => path.endsWith("ai-agent-instructions-v2") ? "text/markdown; charset=utf-8" : path.endsWith("procedural-workflow") ? "text/plain; charset=utf-8" : path.endsWith("preview") ? "image/jpeg" : "image/png";
const fixtureLoad = async (path) => new Blob([path], { type: fixtureType(path) });

test("ZIP store files open independently with binary content, UTF-8 names, and CRC checks", async () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const blob = await createZip([{ name: "00_brief.txt", data: "First" }, { name: "loghi/biancà.png", data: new Uint8Array([0, 255, 1]) }]);
  const entries = unzip(Buffer.from(await blob.arrayBuffer()));
  assert.deepEqual(Object.keys(entries), ["00_brief.txt", "loghi/biancà.png"]);
  assert.deepEqual([...Buffer.from(entries["loghi/biancà.png"], "base64")], [0, 255, 1]);
  await assert.rejects(createZip([{ name: "../escape", data: "bad" }]), /filename/);
  await assert.rejects(createZip([{ name: "a", data: "1" }, { name: "a", data: "2" }]), /filename/);
});

test("request package includes snapshots, only used logos, notes, model, source and composite", async () => {
  const calls = [];
  const load = async (path) => { calls.push(path); return fixtureLoad(path); };
  const r = request(), before = JSON.stringify(r);
  const bundle = await buildRequestPackage(r, library, load, load);
  const entries = unzip(Buffer.from(await bundle.blob.arrayBuffer()));
  assert.equal(Object.keys(entries)[0], "00_VECTOR_REBUILD_BRIEF.txt");
  assert.equal(text(entries, "00_VECTOR_REBUILD_BRIEF.txt"), VECTOR_BRIEF);
  assert.ok(text(entries, "01_CLIENT_NOTES.txt").includes(r.message));
  const manifest = JSON.parse(text(entries, "02_MODEL_AND_PLACEMENT.json"));
  assert.equal(manifest.modelId, "VP9655");
  assert.equal(manifest.logos.length, 1); assert.equal(manifest.placements.length, 2);
  assert.equal(manifest.placements[0].rotationDegrees, 35);
  assert.equal(manifest.placements[1].rotationDegrees, -20);
  assert.equal(manifest.placements[0].file, "logos/01_Club-logo.png");
  assert.ok(text(entries, manifest.files.submittedWithLogos).includes(`/requests/${id}/preview`));
  assert.ok(text(entries, manifest.files.originalWithoutLogoOverlays).includes(`/designs/${designId}/image`));
  assert.equal(calls.length, 17); assert.equal(calls.some((path) => path.includes(unrelated)), false);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.productionPreparation.matchesCurrentModel, true);
  assert.equal(manifest.files.productionLayout, "design/04_PRODUCTION_LAYOUT.png");
  assert.equal(text(entries, manifest.files.historicalWorkflow), "/api/admin/handoff-assets/procedural-workflow");
  assert.match(text(entries, "references/00_REFERENCE_SCOPE.txt"), /DO NOT copy/);
  assert.match(text(entries, "04_PRODUCTION_READINESS_CHECKLIST.txt"), /NOT PROVIDED/);
  assert.match(text(entries, manifest.files.pastWorkCutLineExample), /past-work-cut-lines/);
  assert.equal(manifest.files.aiAgentInstructions, "04_AI_AGENT_INSTRUCTIONS.md");
  assert.equal(text(entries, manifest.files.aiAgentInstructions), "/api/admin/handoff-assets/ai-agent-instructions-v2");
  assert.equal(manifest.files.contrastTrimReference, "trims/CONTRAST.png");
  assert.equal(manifest.files.zipperTrimReference, "trims/ZIPPER.png");
  assert.match(text(entries, manifest.files.contrastTrimReference), /contrast-trim/);
  assert.match(text(entries, manifest.files.zipperTrimReference), /zipper-trim/);
  assert.deepEqual(manifest.files.qualityExamples, QUALITY_EXAMPLES.map((stem) => `examples/${stem}.png`));
  assert.match(text(entries, "references/00_REFERENCE_SCOPE.txt"), /QUALITY and PROCESS ONLY/);
  assert.equal(Object.values(entries).map((value) => Buffer.from(value, "base64").toString()).join("\n").includes("private@example.test"), false);
  assert.equal(JSON.stringify(r), before);
});

test("legacy/no-logo requests work and missing assets fail without a misleading partial ZIP", async () => {
  const r = request(); r.placement = null; r.logoId = logoId;
  assert.deepEqual(requestLogoIds(r), [logoId]); assert.equal(usedRequestLogos(r, library).length, 1);
  const image = fixtureLoad;
  const legacy = await buildRequestPackage(r, library, image, image);
  const entries = unzip(Buffer.from(await legacy.blob.arrayBuffer()));
  assert.match(JSON.parse(text(entries, "02_MODEL_AND_PLACEMENT.json")).placementNote, /Legacy/);
  r.logoId = null;
  const empty = await buildRequestPackage(r, library, image, image);
  assert.equal(empty.files.some((name) => name.startsWith("logos/")), false);
  await assert.rejects(buildRequestPackage(request(), [], image, image), /unavailable/);
  await assert.rejects(buildRequestPackage(request(), library, async () => { throw new Error("403"); }, image), /403/);
  await assert.rejects(buildRequestPackage({ ...r, id: "../../escape" }, library, image, image), /Unsupported/);
});

test("other-model production layouts are reference-only and all reference bytes are preserved", async () => {
  const r = request(); r.design.modelId = "VP9109";
  const exact = new Uint8Array([0, 255, 80, 13, 10, 239, 187, 191]);
  const load = async (path) => path.includes("handoff-assets") ? new Blob([exact], { type: fixtureType(path) }) : fixtureLoad(path);
  const bundle = await buildRequestPackage(r, library, load, fixtureLoad);
  const entries = unzip(Buffer.from(await bundle.blob.arrayBuffer()));
  const manifest = JSON.parse(text(entries, "02_MODEL_AND_PLACEMENT.json"));
  assert.equal(manifest.files.productionLayout, null);
  assert.equal(manifest.productionPreparation.matchesCurrentModel, false);
  assert.match(manifest.productionPreparation.layoutRole, /OTHER MODEL/);
  for (const name of [manifest.files.suppliedLayoutReference, manifest.files.historicalWorkflow, manifest.files.pastWorkExample, manifest.files.pastWorkCutLineExample,
    manifest.files.aiAgentInstructions, manifest.files.contrastTrimReference, manifest.files.zipperTrimReference, ...manifest.files.qualityExamples]) {
    assert.deepEqual(new Uint8Array(Buffer.from(entries[name], "base64")), exact);
  }
  assert.equal(entries["design/04_PRODUCTION_LAYOUT.png"], undefined);
  await assert.rejects(buildRequestPackage(r, library, async (path) => path.includes("handoff-assets") ? new Blob([], { type: "image/png" }) : fixtureLoad(path), fixtureLoad), /reference is missing/);
  await assert.rejects(buildRequestPackage(r, library, async (path) => path.endsWith("procedural-workflow") ? new Blob(["<html>Login</html>"], { type: "text/html" }) : fixtureLoad(path), fixtureLoad), /workflow is missing/);
});

test("every new trim, example and updated instruction is required; wrong MIME fails export", async () => {
  const assets = ["contrast-trim", "zipper-trim", "ai-agent-instructions-v2", ...QUALITY_EXAMPLES.map((stem) => `quality-${stem}`)];
  for (const id of assets) {
    await assert.rejects(buildRequestPackage(request(), library, async (path) => path.endsWith(`/${id}`) ? new Blob([]) : fixtureLoad(path), fixtureLoad), /missing or unsupported/);
    await assert.rejects(buildRequestPackage(request(), library, async (path) => path.endsWith(`/${id}`) ? new Blob(["<html>error</html>"], { type: "text/html" }) : fixtureLoad(path), fixtureLoad), /missing or unsupported/);
  }
});
