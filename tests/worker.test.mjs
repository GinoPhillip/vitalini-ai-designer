import test from "node:test";
import assert from "node:assert/strict";
import { base64ToBytes, isOriginAllowed } from "../src/index.js";

test("same-origin and configured origins are accepted", () => {
  assert.equal(isOriginAllowed("https://studio.example.com", "https://studio.example.com", ""), true);
  assert.equal(isOriginAllowed("https://preview.example.com", "https://studio.example.com", "https://preview.example.com"), true);
  assert.equal(isOriginAllowed("https://evil.example", "https://studio.example.com", "https://preview.example.com"), false);
});

test("base64 image payloads decode to bytes", () => {
  assert.deepEqual([...base64ToBytes("aGVsbG8=")], [104, 101, 108, 108, 111]);
});
