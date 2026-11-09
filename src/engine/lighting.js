// Daylight & visibility analysis.
//
// Daylight factor (DF) uses the CIE uniform-sky "sky component" of a vertical
// glazed opening, integrated numerically over window patches with furniture
// occlusion tested by 3D segment/box intersection:
//     DF(p) = tau * sum_k  A_k * cos(theta_w) * cos(theta_p) / (pi * d^2)
// where theta_w is the angle at the window patch, theta_p the angle to the
// horizontal work-plane normal. DF >= 2% is the common "adequately daylit"
// threshold (BS 8206-2 / EN 17037 guidance).

import { wallPoint, wallInward, segmentHitsItem, forward, angleBetween, localToWorld } from './geometry.js';
import { CATALOG } from '../core/catalog.js';

export const WORK_PLANE = 0.75;
const TAU = 0.7; // glazing transmittance

export function windowPatches(room, win, nu = 4, nv = 3) {
  const patches = [];
  const inward = wallInward(win.wall);
  const du = win.width / nu, dv = win.height / nv;
  for (let a = 0; a < nu; a++) for (let b = 0; b < nv; b++) {
    const [x, z] = wallPoint(room, win.wall, win.offset + (a + 0.5) * du, 0.001);
    patches.push({ p: [x, win.sill + (b + 0.5) * dv, z], n: inward, area: du * dv });
  }
  return patches;
}

export function daylightAt(room, items, x, z, patches, occlusion = true, y = WORK_PLANE) {
  let df = 0;
  for (const pt of patches) {
    const dx = x - pt.p[0], dy = y - pt.p[1], dz = z - pt.p[2];
    const d2 = dx * dx + dy * dy + dz * dz; const d = Math.sqrt(d2);
    const cw = (dx * pt.n[0] + dz * pt.n[1]) / d;
    const cp = -dy / d;
    if (cw <= 0 || cp <= 0) continue;
    if (occlusion) {
      let blocked = false;
      for (const it of items) {
        if (CATALOG[it.type].collide === false || it.h < y) continue;
        if (segmentHitsItem(it, [x, y, z], pt.p, 0.01) >= 0) { blocked = true; break; }
      }
      if (blocked) continue;
    }
    df += pt.area * cw * cp / (Math.PI * d2);
  }
  return TAU * df;
}

export function allPatches(room) {
  return (room.windows || []).flatMap((w) => windowPatches(room, w));
}

export function daylightMap(room, items, cell = 0.2) {
  const nx = Math.max(2, Math.ceil(room.width / cell)), nz = Math.max(2, Math.ceil(room.length / cell));
  const patches = allPatches(room);
  const df = new Float32Array(nx * nz);
  let sum = 0, lit = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const v = daylightAt(room, items, (i + 0.5) * cell, (j + 0.5) * cell, patches, true);
    df[j * nx + i] = v; sum += v; if (v >= 0.02) lit++;
  }
  return { nx, nz, cell, df, mean: sum / (nx * nz), litFraction: lit / (nx * nz) };
}

/** Eye point of a seated / lying viewer. */
export function viewerEye(it) {
  const c = CATALOG[it.type];
  const [x, z] = localToWorld(it, 0, it.type === 'bed' ? -it.d * 0.15 : it.d * 0.05);
  return [x, c.seat ?? 0.9, z];
}

export function screenCenter(tv) {
  const c = CATALOG.tv_stand;
  const [x, z] = localToWorld(tv, 0, -tv.d * 0.15);
  return [x, tv.h + c.screen.h / 2, z];
}

/** Line-of-sight test from eye to target ignoring the endpoints' own items. */
export function lineOfSight(items, eye, target, ignore = []) {
  const blockers = [];
  for (const it of items) {
    if (ignore.includes(it) || CATALOG[it.type].collide === false) continue;
    if (segmentHitsItem(it, eye, target, 0.02) >= 0) blockers.push(it);
  }
  return blockers;
}

/** TV viewing quality: distance, viewing angles, occlusion, window glare. */
export function tvViewing(room, items, tv, viewer) {
  const eye = viewerEye(viewer), scr = screenCenter(tv);
  const toViewer = [eye[0] - scr[0], eye[2] - scr[2]];
  const toTv = [-toViewer[0], -toViewer[1]];
  const dist = Math.hypot(toViewer[0], toViewer[1]);
  const screenAngle = angleBetween(forward(tv), toViewer);
  const viewerAngle = angleBetween(forward(viewer), toTv);
  const blockers = lineOfSight(items, eye, scr, [tv, viewer]);
  // glare: a window visible behind the screen from the viewer (within 25 deg of gaze)
  let glare = 0;
  for (const w of room.windows || []) {
    const [wx, wz] = wallPoint(room, w.wall, w.offset + w.width / 2);
    const toWin = [wx - eye[0], wz - eye[2]];
    const ang = angleBetween(toTv, toWin);
    if (ang < 0.44 && Math.hypot(toWin[0], toWin[1]) > dist) glare = Math.max(glare, 1 - ang / 0.44);
    // reflection: window directly behind viewer, in front of the screen normal
    const back = angleBetween([-toTv[0], -toTv[1]], toWin);
    if (back < 0.35) glare = Math.max(glare, 0.6 * (1 - back / 0.35));
  }
  const ideal = (CATALOG.tv_stand.screen.size) * 1.6; // ~1.6x diagonal
  return { eye, scr, dist, ideal, screenAngle, viewerAngle, blockers, glare };
}

/** Desk ergonomics: daylight on the desk and window position relative to gaze. */
export function deskDaylight(room, items, desk) {
  const patches = allPatches(room);
  const [x, z] = localToWorld(desk, 0, 0);
  const df = daylightAt(room, items, x, z, patches, true, desk.h + 0.05);
  const gaze = forward(desk).map((v) => -v); // seated user looks towards the desk back
  let glare = 0, side = 0;
  for (const w of room.windows || []) {
    const [wx, wz] = wallPoint(room, w.wall, w.offset + w.width / 2);
    const ang = angleBetween(gaze, [wx - x, wz - z]);
    if (ang < 0.6) glare = Math.max(glare, 1 - ang / 0.6);            // facing the window (contrast glare)
    if (ang > Math.PI - 0.6) glare = Math.max(glare, 0.7 * (1 - (Math.PI - ang) / 0.6)); // window behind (screen reflections)
    side = Math.max(side, Math.sin(ang));                                // side-light is ideal
  }
  return { df, glare, side };
}
