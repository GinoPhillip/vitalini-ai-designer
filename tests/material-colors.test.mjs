import test from "node:test";
import assert from "node:assert/strict";
import { COLORS, STANDARD_NAMES, hexToRgb, hexToLinearRgb, linearRgbToHex, solidColorChannel } from "../public/material-colors.js";

test("palette display colors round-trip through Sketchfab linear channels", () => {
  for (const [, hex] of [...COLORS, ["Black", "#000000"], ["Near black", "#01080a"]]) {
    assert.equal(linearRgbToHex(hexToLinearRgb(hex)), hex);
  }
  const grey = hexToLinearRgb("#808080");
  assert.ok(Math.abs(grey[0] - 0.2158605001) < 1e-9);
  assert.deepEqual(hexToRgb("#ffffff"), [1, 1, 1]);
  assert.deepEqual(hexToLinearRgb("#000000"), [0, 0, 0]);
  assert.equal(linearRgbToHex([-1, 2, 0]), "#00ff00");
  assert.throws(() => hexToLinearRgb("orange"), /Invalid color/);
});

test("trim colors replace texture and stale attenuation without mutating the source", () => {
  const source = { enable: false, factor: 0.4, color: [1, 1, 1], texture: { uid: "old" }, uvSet: 1 };
  const channel = solidColorChannel(source, "#f37120");
  assert.equal(channel.factor, 1);
  assert.equal(channel.enable, true);
  assert.equal(channel.uvSet, 1);
  assert.equal(channel.texture, undefined);
  assert.deepEqual(channel.color, hexToLinearRgb("#f37120"));
  assert.ok(channel.color[1] < hexToRgb("#f37120")[1], "orange must not be passed in display RGB");
  assert.equal(source.factor, 0.4);
  assert.equal(source.texture.uid, "old");
});

test("Italian UI retains original English catalog names and accessibility labels", async () => {
  const keys = ["localStorage", "document", "NodeFilter", "MutationObserver"];
  const previous = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  try {
    globalThis.localStorage = { getItem: () => "it" };
    globalThis.document = { documentElement: {}, body: {}, createTreeWalker: () => ({ nextNode: () => false }), querySelectorAll: () => [] };
    globalThis.NodeFilter = { SHOW_TEXT: 4 };
    globalThis.MutationObserver = class { disconnect() {} observe() {} };
    const { t } = await import("../public/language.js?test=names");
    for (const name of STANDARD_NAMES) assert.equal(t(name), name);
    assert.equal(t("Arancione"), "Orange");
    assert.equal(t("Contrasto"), "Contrast");
    assert.equal(t("Contrast color, Orange"), "Contrast: Orange");
    assert.equal(t("Zipper · Snow"), "Zipper · Snow");
    assert.equal(t("Choose a color"), "Scegli un colore");
    assert.equal(t("Details"), "Dettagli");
  } finally {
    keys.forEach((key, index) => previous[index] ? Object.defineProperty(globalThis, key, previous[index]) : delete globalThis[key]);
  }
});
