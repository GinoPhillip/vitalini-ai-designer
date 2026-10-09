import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("third inspiration uses clear large-scale graphics and stays inside the prompt limit", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const presets = [...html.matchAll(/data-prompt="([^"]+)"[^>]*>(.*?)<\/button>/gs)];
  assert.equal(presets.length, 3);
  assert.equal(presets[0][1], "Minimal alpine geometry in ice blue, bone white, and deep navy");
  assert.equal(presets[1][1], "Energetic abstract racing stripes in orange, scarlet, and black");
  const [, prompt, content] = presets[2];
  assert.ok(prompt.length <= 150, "customer-facing preset stays short");
  assert.match(prompt, /wide chest stripe/);
  assert.match(prompt, /large back chevron/);
  assert.match(prompt, /no tiny patterns/);
  assert.match(content, /Monochrome/);
  assert.match(content, /inspiration-art--mono/);
  const language = await readFile(new URL("../public/language.js", import.meta.url), "utf8");
  assert.match(language, /"Monochrome": "Monocromatico"/);
  assert.match(language, /"Bold & clean": "Deciso e pulito"/);
});
