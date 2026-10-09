export const COLORS = [
  ["Snow", "#ffffff"], ["Anthracite", "#394d55"], ["Grey", "#abacaa"],
  ["Deep navy", "#00183f"], ["Capri", "#283484"], ["Marine", "#0966a7"],
  ["Sky", "#00b4dc"], ["Amalfi", "#08a8ac"], ["Forest", "#027039"],
  ["Olive", "#6d7e27"], ["Acid green", "#92f28c"], ["Fluo green", "#93c55f"],
  ["Purple", "#822f8c"], ["Amaranth", "#a90056"], ["Fluo pink", "#ec008b"],
  ["Limoncello", "#dfe915"], ["Sun", "#f7df18"], ["Saffron", "#ffc507"],
  ["Orange", "#f37120"], ["Red", "#ed1b23"], ["Burgundy", "#84002c"]
];

export const STANDARD_NAMES = new Set([
  ...COLORS.map(([name]) => name), "Contrast", "Zipper",
  "Glacier", "Race day", "Monochrome", "Jackets", "Jacket"
]);

export function hexToRgb(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error("Invalid color.");
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255];
}

// Sketchfab's own configurator converts display sRGB to linear material colors:
// https://github.com/sketchfab/configurator-framework/blob/master/src/lib/Colors.js
export function hexToLinearRgb(hex) {
  return hexToRgb(hex).map((value) => value <= 0.04045
    ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
}

export function linearRgbToHex(rgb) {
  return `#${rgb.slice(0, 3).map((value) => {
    const linear = Math.max(0, Math.min(1, Number(value) || 0));
    const srgb = linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
    return Math.round(srgb * 255).toString(16).padStart(2, "0");
  }).join("")}`;
}

export function solidColorChannel(channel, hex) {
  const next = { ...channel, enable: true, factor: 1, color: hexToLinearRgb(hex) };
  delete next.texture;
  return next;
}
