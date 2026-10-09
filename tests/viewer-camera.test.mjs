import test from "node:test";
import assert from "node:assert/strict";
import { copyCamera, zoomCamera } from "../public/viewer-camera.js";

const initial = { position: [0, -10, 3], target: [0, 0, 3] };
test("zoom preserves the user's rotated direction and panned target", () => {
  const current = { position: [11, 2, 3], target: [1, 2, 3] };
  assert.deepEqual(zoomCamera(current, initial, .8), { position: [9, 2, 3], target: [1, 2, 3] });
  assert.deepEqual(current.position, [11, 2, 3]);
});
test("camera zoom is bounded and rejects invalid data", () => {
  assert.equal(zoomCamera(initial, initial, .001).position[1], -4.2);
  assert.equal(zoomCamera(initial, initial, 100).position[1], -28);
  assert.equal(zoomCamera({ position: [0, 0, 3], target: [0, 0, 3] }, initial, .8), null);
  assert.equal(zoomCamera(initial, initial, NaN), null);
  assert.equal(copyCamera({ position: [Infinity, 0, 0], target: [0, 0, 0] }), null);
  const camera = copyCamera(initial); camera.position[0] = 1;
  assert.equal(initial.position[0], 0);
});
