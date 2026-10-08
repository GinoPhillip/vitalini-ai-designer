import test from "node:test";
import assert from "node:assert/strict";
import { contoursAt, pointOnContour, mapElevation } from "../public/topography.js";

test("a radial height field produces one closed overhead contour", () => {
  const field = Array.from({ length: 41 }, (_, y) => Array.from({ length: 41 }, (_, x) => 1 - ((x - 20) ** 2 + (y - 20) ** 2) / 400));
  const paths = contoursAt(field, 1, 1, .5);
  assert.equal(paths.length, 1);
  assert.deepEqual(paths[0][0], paths[0].at(-1));
  for (const [x, y] of paths[0]) assert.ok(Math.abs(Math.hypot(x - 20, y - 20) - Math.sqrt(200)) < .03);
});

test("an edge-to-edge contour stays continuous and within the map", () => {
  const field = Array.from({ length: 7 }, () => [0, 1, 2, 3, 4]);
  const [path] = contoursAt(field, 10, 10, 1.5);
  assert.equal(path.length, 7);
  for (const [x, y] of path) { assert.equal(x, 15); assert.ok(y >= 0 && y <= 60); }
  assert.deepEqual(new Set([path[0][1], path.at(-1)[1]]), new Set([0, 60]));
});

test("saddle cells generate two paths without crossing", () => {
  const paths = contoursAt([[1, 0], [0, 1]], 10, 10, .5);
  assert.equal(paths.length, 2);
  assert.ok(paths.every((path) => path.length === 2 && path.flat().every(Number.isFinite)));
});

test("wordmark sampling uses contour arc length", () => {
  const path = [[0, 0], [10, 0], [10, 10]];
  assert.deepEqual(pointOnContour(path, 5, [0, 10, 20]), [5, 0]);
  assert.deepEqual(pointOnContour(path, 15, [0, 10, 20]), [10, 5]);
});

test("procedural elevation is finite and deterministic", () => {
  for (let y = 0; y <= 1; y += .1) for (let x = 0; x <= 1; x += .1) {
    assert.ok(Number.isFinite(mapElevation(x, y)));
    assert.equal(mapElevation(x, y), mapElevation(x, y));
  }
});
