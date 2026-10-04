import test from "node:test";
import assert from "node:assert/strict";
import { constrainFloatingRect, defaultFloatingRect } from "./floating-geometry.ts";

test("the floating window remains reachable after desktop dragging or viewport shrink", () => {
  const result = constrainFloatingRect({ x: 9999, y: -100, width: 1200, height: 900 }, 1000, 700);
  assert.deepEqual(result, { x: 12, y: 12, width: 976, height: 676 });
  assert.deepEqual(constrainFloatingRect(result, 400, 600), { x: 12, y: 12, width: 376, height: 576 });
});

test("stored non-finite window values cannot hide the controls off-screen", () => {
  const result = constrainFloatingRect({ x: NaN, y: Infinity, width: NaN, height: Infinity }, 1200, 900);
  assert.ok(Object.values(result).every(Number.isFinite));
  const normal = defaultFloatingRect(1920, 1080);
  assert.ok(normal.x > 500 && normal.width < 1920);
});
