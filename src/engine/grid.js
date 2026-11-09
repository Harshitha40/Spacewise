// Walkability analysis on a uniform floor raster.
//   1. rasterise furniture footprints (occupancy)
//   2. Euclidean-approximate distance transform to obstacles and walls (2-pass chamfer)
//   3. a cell is walkable when clearance >= body radius
//   4. BFS from door entry cells -> reachability + shortest-path tree
// The three stages are data-parallel and are the kernels targeted by the
// OpenMP/CUDA back-end (see engine/cpp/src/walkability.cpp).

import { polyBounds, footprint, pointInItem, wallPoint, wallInward } from './geometry.js';
import { CATALOG } from '../core/catalog.js';

export const BODY_RADIUS = 0.3;     // 60 cm minimum passage
export const COMFORT_RADIUS = 0.45; // 90 cm comfortable walkway

export function isObstacle(it) {
  const c = CATALOG[it.type];
  // movable chairs that tuck under tables/desks are pushed aside when walking
  return c.collide !== false && it.h > 0.05 && !c.tuckUnder;
}

export function buildGrid(room, items, cell = 0.1, skip = -1) {
  const nx = Math.max(2, Math.ceil(room.width / cell)), nz = Math.max(2, Math.ceil(room.length / cell));
  const N = nx * nz;
  const occ = new Int16Array(N).fill(-1);
  for (let k = 0; k < items.length; k++) {
    if (k === skip || !isObstacle(items[k])) continue;
    const it = items[k];
    const [x0, z0, x1, z1] = polyBounds(footprint(it));
    const i0 = Math.max(0, Math.floor(x0 / cell)), i1 = Math.min(nx - 1, Math.floor(x1 / cell));
    const j0 = Math.max(0, Math.floor(z0 / cell)), j1 = Math.min(nz - 1, Math.floor(z1 / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (pointInItem(it, (i + 0.5) * cell, (j + 0.5) * cell)) occ[j * nx + i] = k;
    }
  }
  // distance transform, seeded with exact distance to walls
  const dist = new Float32Array(N);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const id = j * nx + i;
    if (occ[id] >= 0) { dist[id] = 0; continue; }
    const cx = (i + 0.5) * cell, cz = (j + 0.5) * cell;
    dist[id] = Math.min(cx, room.width - cx, cz, room.length - cz);
  }
  const a = cell, b = cell * Math.SQRT2;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const id = j * nx + i; let v = dist[id];
    if (i > 0) v = Math.min(v, dist[id - 1] + a);
    if (j > 0) {
      v = Math.min(v, dist[id - nx] + a);
      if (i > 0) v = Math.min(v, dist[id - nx - 1] + b);
      if (i < nx - 1) v = Math.min(v, dist[id - nx + 1] + b);
    }
    dist[id] = v;
  }
  for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const id = j * nx + i; let v = dist[id];
    if (i < nx - 1) v = Math.min(v, dist[id + 1] + a);
    if (j < nz - 1) {
      v = Math.min(v, dist[id + nx] + a);
      if (i < nx - 1) v = Math.min(v, dist[id + nx + 1] + b);
      if (i > 0) v = Math.min(v, dist[id + nx - 1] + b);
    }
    dist[id] = v;
  }
  return { nx, nz, cell, occ, dist, room };
}

/** Cells just inside each door, at body-radius depth. */
export function doorSeeds(g, room) {
  const seeds = [];
  (room.doors || []).forEach((door, di) => {
    const inward = wallInward(door.wall);
    const depth = BODY_RADIUS + g.cell * 0.6;
    const cells = [];
    for (let t = door.offset + 0.12; t <= door.offset + door.width - 0.12 + 1e-6; t += g.cell / 2) {
      const [x, z] = wallPoint(room, door.wall, t, depth);
      const i = Math.floor(x / g.cell), j = Math.floor(z / g.cell);
      if (i >= 0 && j >= 0 && i < g.nx && j < g.nz) cells.push(j * g.nx + i);
    }
    seeds.push({ door: di, cells: [...new Set(cells)], inward });
  });
  return seeds;
}

/** Multi-source BFS (8-connected) over walkable cells. */
export function reachability(g, seeds, radius = BODY_RADIUS) {
  const { nx, nz, dist } = g;
  const N = nx * nz;
  const parent = new Int32Array(N).fill(-2); // -2 unvisited, -1 root
  const queue = new Int32Array(N);
  let qh = 0, qt = 0;
  const blockedDoors = [];
  for (const s of seeds) {
    let any = false;
    for (const c of s.cells) if (dist[c] >= radius && parent[c] === -2) { parent[c] = -1; queue[qt++] = c; any = true; }
    else if (dist[c] >= radius) any = true;
    if (!any) blockedDoors.push(s.door);
  }
  const di = [1, -1, 0, 0, 1, 1, -1, -1], dj = [0, 0, 1, -1, 1, -1, 1, -1];
  while (qh < qt) {
    const c = queue[qh++]; const i = c % nx, j = (c / nx) | 0;
    for (let k = 0; k < 8; k++) {
      const ii = i + di[k], jj = j + dj[k];
      if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
      const n = jj * nx + ii;
      if (parent[n] !== -2 || dist[n] < radius) continue;
      if (k >= 4 && (dist[j * nx + ii] < radius || dist[jj * nx + i] < radius)) continue; // no corner cutting
      parent[n] = c; queue[qt++] = n;
    }
  }
  return { parent, reachedCount: qt, blockedDoors };
}

export function cellOf(g, x, z) {
  const i = Math.floor(x / g.cell), j = Math.floor(z / g.cell);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) return -1;
  return j * g.nx + i;
}

/** Find a reached cell within `r` metres of (x,z); returns cell id or -1. */
export function nearestReached(g, parent, x, z, r = 0.2) {
  const R = Math.ceil(r / g.cell);
  const ci = Math.floor(x / g.cell), cj = Math.floor(z / g.cell);
  let best = -1, bd = Infinity;
  for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
    const i = ci + di, j = cj + dj;
    if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) continue;
    const id = j * g.nx + i;
    if (parent[id] === -2) continue;
    const d = di * di + dj * dj;
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}

export function tracePath(g, parent, cell) {
  const pts = [];
  let c = cell, guard = g.nx * g.nz;
  while (c >= 0 && guard--) {
    pts.push([((c % g.nx) + 0.5) * g.cell, (((c / g.nx) | 0) + 0.5) * g.cell]);
    c = parent[c];
  }
  return simplifyPath(pts.reverse());
}

function simplifyPath(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(cross) > 1e-6) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
