import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createZip, crc32 } from "../public/zip.js";
import { buildRequestPackage, VECTOR_BRIEF, requestLogoIds, usedRequestLogos } from "../public/request-package.js";
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
  const load = async (path) => { calls.push(path); return new Blob([path], { type: path.endsWith("preview") ? "image/jpeg" : "image/png" }); };
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
  assert.equal(calls.length, 4); assert.equal(calls.some((path) => path.includes(unrelated)), false);
  assert.equal(Object.values(entries).map((value) => Buffer.from(value, "base64").toString()).join("\n").includes("private@example.test"), false);
  assert.equal(JSON.stringify(r), before);
});

test("legacy/no-logo requests work and missing assets fail without a misleading partial ZIP", async () => {
  const r = request(); r.placement = null; r.logoId = logoId;
  assert.deepEqual(requestLogoIds(r), [logoId]); assert.equal(usedRequestLogos(r, library).length, 1);
  const image = async () => new Blob(["test"], { type: "image/png" });
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
