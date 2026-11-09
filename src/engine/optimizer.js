// Stochastic layout optimiser: simulated annealing with semantic move proposals.
// Independent chains (strategies x restarts) are embarrassingly parallel: in the
// browser they run in a Web-Worker pool, in the native engine as OpenMP threads,
// and the batched cost evaluation is the CUDA target (engine/cpp/src/optimizer.cpp).

import { CATALOG, collides } from '../core/catalog.js';
import { evaluate } from './evaluate.js';
import { localToWorld, wallLength, wallPoint, rotFacingAway, WALLS, normAngle, footprint, intersectArea, outsideArea } from './geometry.js';

export const STRATEGIES = {
  minimal: { label: 'Minimal changes', desc: 'Fixes problems while keeping your arrangement', fresh: false, weights: { movement: 1.2 }, iters: 4000 },
  balanced: { label: 'Balanced', desc: 'Best overall score', fresh: false, weights: { movement: 0.05 }, iters: 6000 },
  spacious: { label: 'Open & walkable', desc: 'Maximises free walking space', fresh: true, weights: { circulation: 12, narrow: 5, clearance: 6 }, iters: 6000 },
  comfort: { label: 'Light & views', desc: 'Prioritises daylight, TV sightlines, glare-free desk', fresh: true, weights: { tv: 5, desk: 5, window: 8 }, iters: 6000 },
};

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

const QUARTER = Math.PI / 2;
export const snapRot = (rot) => normAngle(Math.round(rot / QUARTER) * QUARTER);
const randomQuarter = (r) => normAngle(Math.floor(r() * 4) * QUARTER);
const pick = (arr, r) => arr[Math.floor(r() * arr.length)];

function extents(it) {
  const c = Math.abs(Math.cos(it.rot)), s = Math.abs(Math.sin(it.rot));
  return [(it.w * c + it.d * s) / 2, (it.w * s + it.d * c) / 2];
}
function clampIn(room, it) {
  const [ex, ez] = extents(it);
  it.x = Math.min(Math.max(it.x, ex), Math.max(ex, room.width - ex));
  it.z = Math.min(Math.max(it.z, ez), Math.max(ez, room.length - ez));
}

function snapToWall(room, it, r, wall) {
  wall = wall || WALLS[Math.floor(r() * 4)];
  it.rot = rotFacingAway(wall);
  const L = wallLength(room, wall);
  const t = it.w / 2 + r() * Math.max(0, L - it.w);
  const [x, z] = wallPoint(room, wall, t, it.d / 2 + 0.01);
  it.x = x; it.z = z;
}

/** Semantic proposal: place an item relative to its functional anchor. */
function relational(room, items, it, r) {
  const find = (...types) => items.find((o) => types.includes(o.type) && o !== it);
  const all = (...types) => items.filter((o) => types.includes(o.type) && o !== it);
  switch (it.type) {
    case 'nightstand': {
      const bed = find('bed'); if (!bed) return false;
      const s = r() < 0.5 ? -1 : 1;
      [it.x, it.z] = localToWorld(bed, s * (bed.w / 2 + it.w / 2 + 0.03), -bed.d / 2 + it.d / 2 + 0.02);
      it.rot = bed.rot; return true;
    }
    case 'coffee_table': {
      const seats = all('sofa'); if (!seats.length) seats.push(...all('armchair'));
      if (!seats.length) return false;
      const sofa = pick(seats, r);
      [it.x, it.z] = localToWorld(sofa, 0, sofa.d / 2 + 0.42 + it.d / 2); it.rot = sofa.rot; return true;
    }
    case 'plant': {
      // a room corner, or tucked beside the arm of a sofa / armchair, never on the seat
      const seats = all('sofa', 'armchair', 'bed');
      if (seats.length && r() < 0.5) {
        const s = pick(seats, r), side = r() < 0.5 ? -1 : 1;
        [it.x, it.z] = localToWorld(s, side * (s.w / 2 + it.w / 2 + 0.05), -s.d / 2 + it.d / 2 + 0.05);
      } else {
        const m = Math.max(it.w, it.d) / 2 + 0.03;
        it.x = r() < 0.5 ? m : room.width - m; it.z = r() < 0.5 ? m : room.length - m;
      }
      it.rot = 0; return true;
    }
    case 'office_chair': {
      const desk = find('desk'); if (!desk) return false;
      [it.x, it.z] = localToWorld(desk, 0, desk.d / 2 + 0.2); it.rot = desk.rot + Math.PI; return true;
    }
    case 'dining_chair': {
      const t = find('dining_table'); if (!t) return false;
      const side = Math.floor(r() * 4);
      const along = (r() - 0.5) * 0.6;
      const pos = [[along * t.w, t.d / 2 + 0.12, Math.PI], [along * t.w, -t.d / 2 - 0.12, 0], [t.w / 2 + 0.12, along * t.d, -Math.PI / 2], [-t.w / 2 - 0.12, along * t.d, Math.PI / 2]][side];
      [it.x, it.z] = localToWorld(t, pos[0], pos[1]); it.rot = t.rot + pos[2]; return true;
    }
    case 'tv_stand': {
      const v = find('sofa', 'armchair', 'bed'); if (!v) return false;
      // put the TV against the wall the viewer is facing
      const f = [Math.sin(v.rot), Math.cos(v.rot)];
      const wall = Math.abs(f[0]) > Math.abs(f[1]) ? (f[0] > 0 ? 'E' : 'W') : (f[1] > 0 ? 'N' : 'S');
      snapToWall(room, it, r, wall);
      if (wall === 'N' || wall === 'S') it.x = v.x + (r() - 0.5) * 0.4; else it.z = v.z + (r() - 0.5) * 0.4;
      return true;
    }
    case 'rug': {
      const a = find('sofa', 'bed', 'dining_table'); if (!a) return false;
      const off = a.type === 'sofa' ? a.d / 2 + 0.5 : 0.3;
      [it.x, it.z] = localToWorld(a, 0, off); it.rot = a.rot; return true;
    }
    default: return false;
  }
}

function propose(room, items, k, r, temp) {
  const it = items[k];
  const c = CATALOG[it.type];
  const u = r();
  if (u < 0.45) {
    const s = 0.04 + 0.8 * temp;
    it.x += gauss(r) * s; it.z += gauss(r) * s;
  } else if (u < 0.6) {
    it.rot = normAngle(it.rot + (r() < 0.5 ? 1 : -1) * Math.PI / 2);
  } else if (u < 0.75) {
    if (c.wall === 'back') snapToWall(room, it, r);
    else if (!relational(room, items, it, r)) it.rot = normAngle(it.rot + Math.PI);
  } else if (u < 0.9) {
    if (!relational(room, items, it, r)) { it.x = r() * room.width; it.z = r() * room.length; it.rot = randomQuarter(r); }
  } else {
    // swap with another movable item of similar role
    const others = items.map((o, i) => i).filter((i) => i !== k && !items[i].locked && (CATALOG[items[i].type].wall === c.wall));
    if (others.length) {
      const o = items[others[Math.floor(r() * others.length)]];
      [it.x, o.x] = [o.x, it.x]; [it.z, o.z] = [o.z, it.z]; [it.rot, o.rot] = [o.rot, it.rot];
      clampIn(room, o);
    }
  }
  clampIn(room, it);
}

/** Greedy sampling-based initial placement (used for fresh layouts and photo import without calibration). */
export function greedyPlace(room, items, r, opts = {}) {
  const placed = [];
  const order = items.map((it, i) => i).sort((a, b) => {
    const A = items[a], B = items[b];
    const rank = (it) => (CATALOG[it.type].wall === 'back' ? 0 : 1) * 10 + (['bed', 'sofa', 'dining_table', 'desk'].includes(it.type) ? 0 : 1);
    return rank(A) - rank(B) || B.w * B.d - A.w * A.d;
  });
  for (const k of order) {
    const it = items[k];
    if (it.locked) { placed.push(it); continue; }
    let best = null, bestCost = Infinity;
    for (let s = 0; s < (opts.samples ?? 40); s++) {
      const cand = { ...it };
      if (s % 3 === 0 && relational(room, [...placed, cand], cand, r)) { /* anchored */ }
      else if (CATALOG[it.type].wall === 'back') snapToWall(room, cand, r);
      else { cand.x = r() * room.width; cand.z = r() * room.length; cand.rot = Math.floor(r() * 4) * Math.PI / 2; }
      clampIn(room, cand);
      const cost = evaluate({ room, items: [...placed, cand] }, { fast: true, cell: 0.2 }).cost;
      if (cost < bestCost) { bestCost = cost; best = cand; }
    }
    Object.assign(it, best); placed.push(it);
  }
  return items;
}

// ---- legalisation: the returned layout must be physically valid ------------------
const tucks = (a, b) => (CATALOG[a.type].tuckUnder || []).includes(b.type) || (CATALOG[b.type].tuckUnder || []).includes(a.type);
const solid = (a, b) => a !== b && collides(a) && collides(b) && !tucks(a, b);

function aabb(it) {
  const [ex, ez] = extents(it);
  return [it.x - ex, it.z - ez, it.x + ex, it.z + ez];
}

const doorSwing = (room, d) => [
  wallPoint(room, d.wall, d.offset, 0), wallPoint(room, d.wall, d.offset + d.width, 0),
  wallPoint(room, d.wall, d.offset + d.width, d.width), wallPoint(room, d.wall, d.offset, d.width),
];

/** m² of item k inside other furniture, through a wall, or in a door's swing. */
function violation(room, items, k) {
  const it = items[k];
  if (!collides(it)) return 0;
  const fp = footprint(it);
  let v = outsideArea(fp, room.width, room.length);
  for (const o of items) if (solid(it, o)) v += intersectArea(fp, footprint(o));
  for (const d of room.doors || []) v += intersectArea(fp, doorSwing(room, d));
  return v;
}

const EPS = 1e-3;
const totalViolation = (room, items) => items.reduce((s, _, k) => s + violation(room, items, k), 0);

/** Wall-backed items may only slide along their wall; anything else moves on either axis. */
function slideAxes(it) {
  if (CATALOG[it.type].wall !== 'back') return [0, 1];
  return Math.abs(Math.sin(it.rot)) > 0.5 ? [1] : [0];
}

const boxOverlap = (A, B) => Math.min(A[2], B[2]) - Math.max(A[0], B[0]) > EPS && Math.min(A[3], B[3]) - Math.max(A[1], B[1]) > EPS;

/**
 * Resolve one overlap with box O: try sliding each movable item clear of O in every allowed
 * direction and keep the move that leaves that item least obstructed (ties → shorter move).
 * Only moves that strictly reduce the mover's violation are applied.
 */
function pushClear(room, items, cands) {
  let best = null;
  for (const [m, O] of cands) {
    const k = items.indexOf(m);
    const now = violation(room, items, k);
    const A = aabb(m);
    const x0 = m.x, z0 = m.z;
    for (const axis of slideAxes(m)) {
      const key = axis ? 'z' : 'x';
      for (const delta of [O[axis] - A[axis + 2] - 0.01, O[axis + 2] - A[axis] + 0.01]) {
        m[key] += delta;
        clampIn(room, m);
        const score = violation(room, items, k) + 0.01 * Math.abs(delta);
        if (violation(room, items, k) < now - EPS && (!best || score < best.score)) best = { m, x: m.x, z: m.z, score };
        m.x = x0; m.z = z0;
      }
    }
  }
  if (best) { best.m.x = best.x; best.m.z = best.z; }
  return !!best;
}

/** Iteratively push furniture out of door swings and out of each other. */
function separate(room, items, passes = 80) {
  const doors = (room.doors || []).map((d) => {
    const p = doorSwing(room, d), xs = p.map((q) => q[0]), zs = p.map((q) => q[1]);
    return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
  });
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (const D of doors) for (const m of items) {
      if (!m.locked && collides(m) && boxOverlap(aabb(m), D)) moved = pushClear(room, items, [[m, D]]) || moved;
    }
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (!solid(a, b) || !boxOverlap(aabb(a), aabb(b))) continue;
      const cands = [[a, aabb(b)], [b, aabb(a)]].filter(([m]) => !m.locked);
      moved = pushClear(room, items, cands) || moved;
    }
    if (!moved) break;
  }
}

/** Re-seat item k at the best collision-free spot found by sampling. */
function relocate(room, items, k, r, tries = 300) {
  const it = items[k];
  const orig = { x: it.x, z: it.z, rot: it.rot };
  let best = null, bestCost = Infinity;
  for (let s = 0; s < tries; s++) {
    if (s % 3 === 0 && relational(room, items, it, r)) { /* anchored */ }
    else if (CATALOG[it.type].wall === 'back') snapToWall(room, it, r);
    else { it.x = r() * room.width; it.z = r() * room.length; it.rot = randomQuarter(r); }
    it.rot = snapRot(it.rot);
    clampIn(room, it);
    if (violation(room, items, k) > EPS) continue;
    const c = evaluate({ room, items }, { fast: true, cell: 0.2 }).cost;
    if (c < bestCost) { bestCost = c; best = { x: it.x, z: it.z, rot: it.rot }; }
  }
  Object.assign(it, best || orig);
  return !!best;
}

/** Candidate poses for an item: every wall slot for wall-backed items, a floor grid otherwise. */
function* poses(room, it, r, items) {
  yield { x: it.x, z: it.z, rot: snapRot(it.rot) };
  for (let s = 0; s < 12; s++) {
    const c = { ...it };
    if (relational(room, items, c, r)) yield { x: c.x, z: c.z, rot: snapRot(c.rot), anchored: true };
  }
  const step = 0.1;
  if (CATALOG[it.type].wall === 'back') {
    for (const wall of WALLS) {
      const L = wallLength(room, wall);
      for (let t = it.w / 2; t <= L - it.w / 2 + 1e-9; t += step) {
        const [x, z] = wallPoint(room, wall, t, it.d / 2 + 0.01);
        yield { x, z, rot: rotFacingAway(wall), corner: Math.min(t - it.w / 2, L - it.w / 2 - t) };
      }
    }
  }
  for (const rot of [0, QUARTER, Math.PI, -QUARTER]) {
    for (let x = step / 2; x < room.width; x += step) for (let z = step / 2; z < room.length; z += step) yield { x, z, rot };
  }
}

/**
 * Re-seat the movable items largest-first, each at its best collision-free pose.
 * mode 'home': closest to where it was. mode 'compact': wall items packed from the corners
 * outward, which frees whole wall runs when the room is crowded.
 * Functional anchors (teapoy before a sofa, plant beside it) are preferred in both modes.
 */
function repack(room, items, r, mode) {
  const fixed = items.filter((it) => it.locked || !collides(it));
  const order = items.filter((it) => !fixed.includes(it)).sort((a, b) => b.w * b.d - a.w * a.d);
  const placed = [...fixed];
  for (const it of order) {
    const home = { x: it.x, z: it.z };
    let best = null, bestScore = Infinity, fallback = null, fallbackV = Infinity;
    for (const p of poses(room, it, r, placed)) {
      Object.assign(it, p);
      clampIn(room, it);
      const v = violation(room, [...placed, it], placed.length);
      const near = Math.hypot(it.x - home.x, it.z - home.z);
      const compactWall = mode === 'compact' && CATALOG[it.type].wall === 'back';
      const score = (compactWall ? (p.corner ?? 50) * 10 + near * 0.1 : near) - (p.anchored ? 1 : 0);
      if (v <= EPS) { if (score < bestScore) { bestScore = score; best = { x: it.x, z: it.z, rot: it.rot }; } }
      else if (v < fallbackV) { fallbackV = v; fallback = { x: it.x, z: it.z, rot: it.rot }; }
    }
    Object.assign(it, best || fallback);
    placed.push(it);
  }
}

const poseOf = (items) => items.map((it) => ({ x: it.x, z: it.z, rot: it.rot }));
const setPose = (items, p) => items.forEach((it, i) => Object.assign(it, p[i]));

/**
 * Snap every movable item to a 90° grid and remove all furniture / wall / door-swing
 * interpenetration: small pushes, then relocation of what is still stuck, then a full
 * repack as the last resort. Mutates and returns `items`.
 */
export function legalize(room, items, r = rng(7)) {
  for (const it of items) if (!it.locked) { it.rot = snapRot(it.rot); clampIn(room, it); }
  separate(room, items);
  for (let round = 0; round < 2 && totalViolation(room, items) > EPS; round++) {
    const stuck = items.map((_, k) => k).filter((k) => !items[k].locked && violation(room, items, k) > EPS)
      .sort((p, q) => items[p].w * items[p].d - items[q].w * items[q].d);
    for (const k of stuck) if (violation(room, items, k) > EPS) relocate(room, items, k, r);
    separate(room, items);
  }
  if (totalViolation(room, items) <= EPS) return items;
  const start = poseOf(items);
  let best = null, bestV = Infinity;
  for (const mode of ['home', 'compact']) {
    setPose(items, start);
    repack(room, items, r, mode);
    const v = totalViolation(room, items);
    if (v < bestV) { bestV = v; best = poseOf(items); }
    if (v <= EPS) break;
  }
  setPose(items, best);
  return items;
}

export function anneal(project, strategyKey, seed = 1, onProgress) {
  const strat = STRATEGIES[strategyKey];
  const r = rng(seed);
  const room = project.room;
  const reference = Object.fromEntries(project.items.map((it) => [it.id, { x: it.x, z: it.z, rot: it.rot }]));
  let items = project.items.map((it) => ({ ...it, rot: it.locked ? it.rot : snapRot(it.rot) }));
  if (strat.fresh) greedyPlace(room, items, r);
  // physical validity dominates the search; legalize() then removes any remainder
  const opts = { fast: true, weights: { overlap: 150, bounds: 150, door: 60, ...strat.weights }, reference };
  const movable = items.map((it, i) => i).filter((i) => !items[i].locked);
  let cost = evaluate({ room, items }, opts).cost;
  let best = items.map((it) => ({ ...it })), bestCost = cost;
  if (!movable.length) return { items: best, cost: bestCost };
  const finish = () => { legalize(room, best, r); return { items: best, cost: evaluate({ room, items: best }, opts).cost }; };
  const N = project.iterations ?? strat.iters;
  const T0 = 3.0, T1 = 0.004;
  for (let n = 0; n < N; n++) {
    const frac = n / N;
    const T = T0 * Math.pow(T1 / T0, frac);
    const k = movable[Math.floor(r() * movable.length)];
    const backup = items.map((it) => ({ x: it.x, z: it.z, rot: it.rot }));
    propose(room, items, k, r, 1 - frac);
    const c = evaluate({ room, items }, opts).cost;
    if (c <= cost || r() < Math.exp((cost - c) / T)) {
      cost = c;
      if (c < bestCost) { bestCost = c; best = items.map((it) => ({ ...it })); }
    } else {
      items.forEach((it, i) => { it.x = backup[i].x; it.z = backup[i].z; it.rot = backup[i].rot; });
    }
    if (onProgress && n % 250 === 0) onProgress(frac, bestCost);
  }
  return finish();
}
