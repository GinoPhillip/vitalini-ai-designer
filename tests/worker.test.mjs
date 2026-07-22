import test from "node:test";
import assert from "node:assert/strict";
import { base64ToBytes, getRateLimitKey, isOriginAllowed, normalizeRenderPreset } from "../src/index.js";

test("same-origin and configured origins are accepted", () => {
  assert.equal(isOriginAllowed("https://studio.example.com", "https://studio.example.com", ""), true);
  assert.equal(isOriginAllowed("https://preview.example.com", "https://studio.example.com", "https://preview.example.com"), true);
  assert.equal(isOriginAllowed("https://evil.example", "https://studio.example.com", "https://preview.example.com"), false);
});

test("base64 image payloads decode to bytes", () => {
  assert.deepEqual([...base64ToBytes("aGVsbG8=")], [104, 101, 108, 108, 111]);
});

test("generation rate limiting uses the Cloudflare client address", () => {
  const request = new Request("https://studio.example.com/api/generate", {
    headers: { "cf-connecting-ip": "203.0.113.7" }
  });
  assert.equal(getRateLimitKey(request, "designer-123456789"), "203.0.113.7:generate");
  assert.equal(getRateLimitKey(new Request("https://studio.example.com"), "designer-123456789"), "designer-123456789:generate");
});

test("generation presets map to server-controlled quality and size", () => {
  assert.deepEqual(normalizeRenderPreset(undefined), { name: "medium-1536", quality: "medium", size: "1536x1536" });
  assert.deepEqual(normalizeRenderPreset("MEDIUM-2000"), { name: "medium-2000", quality: "medium", size: "2000x2000" });
  assert.deepEqual(normalizeRenderPreset("high-1536"), { name: "high-1536", quality: "high", size: "1536x1536" });
  assert.deepEqual(normalizeRenderPreset("high-2000"), { name: "high-2000", quality: "high", size: "2000x2000" });
  assert.equal(normalizeRenderPreset("low"), null);
  assert.equal(normalizeRenderPreset("medium"), null);
  assert.equal(normalizeRenderPreset("auto"), null);
});
