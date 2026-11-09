import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrate, projectPoint, pixelToFloor } from '../src/core/homography.js';

// Synthetic OpenCV camera looking into the room from near the south wall.
function synthCamera({ pos, target, fovY, W, H }) {
  const f = (H / 2) / Math.tan((fovY * Math.PI) / 360);
  const fw = target.map((v, i) => v - pos[i]); const n = Math.hypot(...fw); const zc = fw.map((v) => v / n);
  const down = [0, -1, 0];
  let xc = [zc[1] * down[2] - zc[2] * down[1], zc[2] * down[0] - zc[0] * down[2], zc[0] * down[1] - zc[1] * down[0]];
  const xn = Math.hypot(...xc); xc = xc.map((v) => v / xn);
  const yc = [zc[1] * xc[2] - zc[2] * xc[1], zc[2] * xc[0] - zc[0] * xc[2], zc[0] * xc[1] - zc[1] * xc[0]];
  return (p) => {
    const d = p.map((v, i) => v - pos[i]);
    const X = d[0] * xc[0] + d[1] * xc[1] + d[2] * xc[2];
    const Y = d[0] * yc[0] + d[1] * yc[1] + d[2] * yc[2];
    const Z = d[0] * zc[0] + d[1] * zc[1] + d[2] * zc[2];
    return [f * X / Z + W / 2, f * Y / Z + H / 2];
  };
}

test('recovers camera pose and focal length from a floor rectangle', () => {
  const W = 1600, H = 1200;
  const cam = { pos: [2.1, 1.45, -0.3], target: [1.8, 0.6, 3.0], fovY: 52, W, H };
  const proj = synthCamera(cam);
  const plan = [[0.5, 3.4], [3.5, 3.4], [3.5, 1.2], [0.5, 1.2]];
  const img = plan.map(([x, z]) => proj([x, 0, z]));
  const cal = calibrate(plan, img, W, H);
  assert.ok(cal.ok, cal.error);
  assert.ok(Math.abs(cal.fovY - 52) < 0.5, `fov ${cal.fovY}`);
  cal.position.forEach((v, i) => assert.ok(Math.abs(v - cam.pos[i]) < 0.02, `pos ${cal.position}`));
  // reprojection of a 3D point above the floor
  const p = [1.0, 1.2, 2.5];
  const a = proj(p), b = projectPoint(cal, p);
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1.0);
  const fl = pixelToFloor(cal, ...proj([2.2, 0, 2.0]));
  assert.ok(Math.hypot(fl[0] - 2.2, fl[1] - 2.0) < 1e-6);
});
