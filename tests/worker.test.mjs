import test from "node:test";
import assert from "node:assert/strict";
import { base64ToBytes, getRateLimitKey, isOriginAllowed } from "../src/index.js";

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
