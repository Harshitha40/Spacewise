// Layout evaluation: one function shared by the interactive analyser (full mode)
// and the stochastic optimiser (fast mode). Every penalty term is a physically
// meaningful quantity (m² of overlap, m of misalignment, % of unreachable floor,
// daylight factor ...), which makes the objective interpretable and reportable.

import { CATALOG, collides } from '../core/catalog.js';
import {
  footprint, localRect, intersectArea, outsideArea, localToWorld, worldToLocal, forward,
  angleBetween, dist2, wallPoint, wallInward, WALLS, normAngle,
} from './geometry.js';
import { buildGrid, doorSeeds, reachability, nearestReached, tracePath, isObstacle, COMFORT_RADIUS, BODY_RADIUS } from './grid.js';
import { daylightMap, tvViewing, deskDaylight } from './lighting.js';

export const DEFAULT_WEIGHTS = {
  overlap: 30, bounds: 30, door: 12, doorBlocked: 12, access: 3, circulation: 4, narrow: 1.5,
  clearance: 4, wall: 2, window: 3, relation: 1.5, tv: 1.5, desk: 1.5, movement: 0,
};
const CATS = {
  safety: ['overlap', 'bounds'],
  circulation: ['door', 'doorBlocked', 'access', 'circulation', 'narrow'],
  function: ['clearance', 'wall', 'window', 'relation'],
  comfort: ['tv', 'desk'],
};
const CAT_SCALE = { safety: 3, circulation: 6, function: 5, comfort: 4 };
const CAT_WEIGHT = { safety: 0.3, circulation: 0.3, function: 0.25, comfort: 0.15 };

const tuck = (a, b) => (CATALOG[a.type].tuckUnder || []).includes(b.type) || (CATALOG[b.type].tuckUnder || []).includes(a.type);
const label = (it) => CATALOG[it.type].label;

function clearanceZones(it) {
  const c = CATALOG[it.type].clearance || {};
  const hw = it.w / 2, hd = it.d / 2, z = [];
  if (c.front) z.push({ side: 'front', poly: localRect(it, -hw, hd, hw, hd + c.front) });
  if (c.back) z.push({ side: 'back', poly: localRect(it, -hw, -hd - c.back, hw, -hd) });
  if (c.sides) {
    const z0 = it.type === 'bed' ? -hd + 0.4 : -hd;
    z.push({ side: 'left', poly: localRect(it, -hw - c.sides, z0, -hw, hd) });
    z.push({ side: 'right', poly: localRect(it, hw, z0, hw + c.sides, hd) });
  }
  return z;
}

function accessPoints(it) {
  const hw = it.w / 2, hd = it.d / 2, off = 0.38;
  return (CATALOG[it.type].access || []).map((side) => {
    const p = side === 'front' ? localToWorld(it, 0, hd + off)
      : side === 'left' ? localToWorld(it, -hw - off, 0.1)
        : localToWorld(it, hw + off, 0.1);
    return { side, p };
  });
}

function doorZone(room, door) {
  return [
    wallPoint(room, door.wall, door.offset, 0), wallPoint(room, door.wall, door.offset + door.width, 0),
    wallPoint(room, door.wall, door.offset + door.width, door.width), wallPoint(room, door.wall, door.offset, door.width),
  ];
}

function windowZone(room, win) {
  return [
    wallPoint(room, win.wall, win.offset, 0), wallPoint(room, win.wall, win.offset + win.width, 0),
    wallPoint(room, win.wall, win.offset + win.width, 0.45), wallPoint(room, win.wall, win.offset, 0.45),
  ];
}

/** distance of item's back edge to the best wall + orientation misalignment */
export function wallFit(room, it) {
  const back = localToWorld(it, 0, -it.d / 2);
  const bdir = forward(it).map((v) => -v);
  let best = Infinity, bestWall = null;
  for (const w of WALLS) {
    const out = wallInward(w).map((v) => -v);
    const d = w === 'S' ? back[1] : w === 'N' ? room.length - back[1] : w === 'W' ? back[0] : room.width - back[0];
    const mis = 1 - (bdir[0] * out[0] + bdir[1] * out[1]);
    const v = Math.abs(d) + mis * 1.5;
    if (v < best) { best = v; bestWall = w; }
  }
  return { penalty: Math.max(0, best - 0.06), wall: bestWall };
}

export function evaluate(project, opts = {}) {
  const { room } = project;
  const items = project.items;
  const fast = !!opts.fast;
  const W = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) };
  const P = Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((k) => [k, 0]));
  const issues = [];
  const flags = {};
  const flag = (it, f) => { (flags[it.id] ||= {})[f] = true; };
  const add = (severity, category, msg, its, point) => { if (!fast) issues.push({ severity, category, msg, items: its.map((i) => i.id), point }); };

  const fps = items.map((it) => footprint(it));
  const byType = {};
  items.forEach((it) => (byType[it.type] ||= []).push(it));

  // ---- 1. collisions & bounds -------------------------------------------------
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    if (!collides(a)) continue;
    const out = outsideArea(fps[i], room.width, room.length);
    if (out > 1e-3) { P.bounds += out; flag(a, 'collision'); add('error', 'safety', `${label(a)} goes through a wall`, [a]); }
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      if (!collides(b) || tuck(a, b)) continue;
      const ov = intersectArea(fps[i], fps[j]);
      if (ov > 1e-3) {
        // fixed charge per pair so the optimiser can't trade a "small" interpenetration for other gains
        P.overlap += ov + 0.02; flag(a, 'collision'); flag(b, 'collision');
        add('error', 'safety', `${label(a)} collides with ${label(b)} (${Math.round(ov * 1e4)} cm²)`, [a, b]);
      }
    }
  }

  // ---- 2. ergonomic clearance zones --------------------------------------------
  const zones = [];
  items.forEach((it, i) => {
    for (const z of clearanceZones(it)) {
      const area = Math.abs(z.poly.reduce((s, p, k, arr) => s + (p[0] * arr[(k + 1) % arr.length][1] - arr[(k + 1) % arr.length][0] * p[1]), 0)) / 2;
      let blocked = outsideArea(z.poly, room.width, room.length) * 0.6; // walls block less than furniture (you can still stand there)
      const by = [];
      items.forEach((o, j) => {
        if (j === i || !isObstacle(o) || tuck(it, o) || (CATALOG[o.type].low && CATALOG[it.type].seat)) return;
        const ov = intersectArea(z.poly, fps[j]);
        if (ov > 1e-3) { blocked += ov; by.push(o); }
      });
      const frac = blocked / area;
      P.clearance += blocked;
      if (!fast) zones.push({ id: it.id, side: z.side, poly: z.poly, frac });
      if (frac > 0.3 && by.length) {
        flag(it, 'warn');
        add('warn', 'function', `${label(it)} ${z.side} clearance blocked by ${by.map(label).join(', ')}`, [it, ...by]);
      }
    }
  });

  // ---- 3. doors & windows ------------------------------------------------------
  (room.doors || []).forEach((door) => {
    const zp = doorZone(room, door);
    items.forEach((it, j) => {
      if (!isObstacle(it)) return;
      const ov = intersectArea(zp, fps[j]);
      if (ov > 1e-3) { P.door += ov; flag(it, 'blocking'); add('error', 'circulation', `${label(it)} blocks the door swing`, [it]); }
    });
  });
  (room.windows || []).forEach((win) => {
    const zp = windowZone(room, win);
    items.forEach((it, j) => {
      if (!isObstacle(it) || it.h < win.sill + 0.1) return;
      const ov = intersectArea(zp, fps[j]);
      if (ov > 1e-3) { P.window += ov; flag(it, 'warn'); add('warn', 'function', `${label(it)} covers a window`, [it]); }
    });
  });

  // ---- 4. wall affinity -----------------------------------------------------------
  for (const it of items) {
    if (CATALOG[it.type].wall !== 'back') continue;
    const f = wallFit(room, it);
    P.wall += f.penalty;
    if (f.penalty > 0.35) add('info', 'function', `${label(it)} usually stands with its back to a wall`, [it]);
  }

  // ---- 5. walkability -------------------------------------------------------------
  const g = buildGrid(room, items, opts.cell ?? (fast ? 0.15 : 0.1));
  let seeds = doorSeeds(g, room);
  if (!seeds.length) { // no doors: seed at the most open cell
    let best = 0; for (let k = 1; k < g.dist.length; k++) if (g.dist[k] > g.dist[best]) best = k;
    seeds = [{ door: -1, cells: [best] }];
  }
  const R = reachability(g, seeds);
  P.doorBlocked += R.blockedDoors.length;
  if (!fast) R.blockedDoors.forEach(() => add('error', 'circulation', 'A doorway is blocked — nobody can walk in', []));
  let free = 0, narrow = 0;
  for (let k = 0; k < g.occ.length; k++) {
    if (g.occ[k] < 0) free++;
    if (R.parent[k] !== -2 && g.dist[k] < COMFORT_RADIUS) narrow++;
  }
  // reachable walking area relative to the walking area of the same room when empty
  const emptyWalk = Math.max(1, ((room.width - 2 * BODY_RADIUS) * (room.length - 2 * BODY_RADIUS)) / (g.cell * g.cell));
  const usable = Math.min(1, R.reachedCount / emptyWalk);
  // below ~30 % reachable floor the room stops working, so the penalty steepens there
  P.circulation += 1 - usable + 4 * Math.max(0, 0.3 - usable);
  P.narrow += R.reachedCount ? narrow / R.reachedCount : 0;

  const unreachable = [];
  const paths = [];
  for (const it of items) {
    for (const ap of accessPoints(it)) {
      if (ap.p[0] < 0 || ap.p[1] < 0 || ap.p[0] > room.width || ap.p[1] > room.length) {
        // access side faces a wall - only a problem for front access
        if (ap.side === 'front') { P.access += 1; unreachable.push({ it, ap }); }
        continue;
      }
      const c = nearestReached(g, R.parent, ap.p[0], ap.p[1], 0.25);
      if (c < 0) { P.access += 1; unreachable.push({ it, ap }); }
      else if (!fast) paths.push({ id: it.id, side: ap.side, pts: tracePath(g, R.parent, c) });
    }
  }
  // bed: at least one side must be reachable (single-side access in small rooms is OK)
  for (const bed of byType.bed || []) {
    const u = unreachable.filter((u) => u.it === bed);
    if (u.length === 1) { P.access -= 0.7; u[0].soft = true; }
  }
  if (!fast && unreachable.length) {
    // culprit search: which single item, if removed, restores access?
    const cache = new Map();
    for (const u of unreachable) {
      const culprits = [];
      items.forEach((o, k) => {
        if (o === u.it || !isObstacle(o) || dist2([o.x, o.z], u.ap.p) > 3.5) return;
        let gr = cache.get(k);
        if (!gr) { const g2 = buildGrid(room, items, g.cell, k); gr = { g2, r2: reachability(g2, doorSeeds(g2, room).length ? doorSeeds(g2, room) : seeds) }; cache.set(k, gr); }
        if (nearestReached(gr.g2, gr.r2.parent, u.ap.p[0], u.ap.p[1], 0.25) >= 0) culprits.push(o);
      });
      culprits.forEach((c) => flag(c, 'blocking'));
      flag(u.it, 'warn');
      const why = culprits.length ? ` — blocked by ${culprits.map(label).join(', ')}` : '';
      add(u.soft ? 'info' : 'warn', 'circulation', `Can't walk to the ${u.ap.side} of the ${label(u.it)}${why}`, [u.it, ...culprits], u.ap.p);
    }
  }
  if (!fast && usable < 0.35) add('warn', 'circulation', `Only ${Math.round(usable * 100)}% of the room's walking area remains reachable`, []);

  // ---- 6. functional relations ------------------------------------------------------
  const rel = (pen, msg, its) => { P.relation += pen; if (pen > 0.45) add('info', 'function', msg, its); };
  for (const ns of byType.nightstand || []) {
    let best = Infinity, bb = null;
    for (const bed of byType.bed || []) for (const s of [-1, 1]) {
      const t = localToWorld(bed, s * (bed.w / 2 + ns.w / 2 + 0.03), -bed.d / 2 + ns.d / 2 + 0.02);
      const d = dist2(t, [ns.x, ns.z]) + 0.3 * Math.abs(normAngle(ns.rot - bed.rot));
      if (d < best) { best = d; bb = bed; }
    }
    if (bb) rel(best, `Nightstand is not beside the bed head`, [ns, bb]);
  }
  for (const ct of byType.coffee_table || []) {
    const seats = byType.sofa?.length ? byType.sofa : byType.armchair || [];
    let best = Infinity, bs = null;
    for (const sofa of seats) {
      const t = localToWorld(sofa, 0, sofa.d / 2 + 0.42 + ct.d / 2);
      const d = dist2(t, [ct.x, ct.z]) * 0.8 + 0.2 * Math.abs(Math.sin(ct.rot - sofa.rot));
      if (d < best) { best = d; bs = sofa; }
    }
    if (bs) rel(best, `${label(ct)} should sit ~45 cm in front of a ${label(bs)}`, [ct, bs]);
  }
  for (const p of byType.plant || []) {
    const [ex, ez] = [p.w / 2, p.d / 2];
    const gap = Math.min(p.x - ex, room.width - p.x - ex, p.z - ez, room.length - p.z - ez);
    rel(Math.max(0, gap - 0.3) * 0.5, 'Plant is standing in the middle of the floor', [p]);
  }
  const chairTo = (chair, tables, gap) => {
    let best = Infinity, bt = null;
    for (const t of tables) {
      const [lx, lz] = worldToLocal(t, chair.x, chair.z);
      const cx = Math.max(-t.w / 2, Math.min(t.w / 2, lx)), cz = Math.max(-t.d / 2, Math.min(t.d / 2, lz));
      const edge = localToWorld(t, cx, cz);
      const outside = Math.hypot(lx - cx, lz - cz);
      const toward = [edge[0] - chair.x, edge[1] - chair.z];
      const face = outside > 0.01 ? angleBetween(forward(chair), toward) : 0;
      const d = Math.abs(outside - gap) + 0.4 * face;
      if (d < best) { best = d; bt = t; }
    }
    return [best, bt];
  };
  for (const ch of byType.dining_chair || []) {
    const [d, t] = chairTo(ch, byType.dining_table || [], 0.12);
    if (t) rel(d, 'Dining chair is not placed at the table', [ch, t]);
  }
  for (const ch of byType.office_chair || []) {
    const desk = (byType.desk || [])[0];
    if (!desk) continue;
    const t = localToWorld(desk, 0, desk.d / 2 + 0.2);
    rel(dist2(t, [ch.x, ch.z]) + 0.3 * angleBetween(forward(ch), forward(desk).map((v) => -v)), 'Desk chair should be at the desk', [ch, desk]);
  }

  // ---- 7. visual comfort: TV sightlines, desk daylight -------------------------------
  const sightlines = [];
  for (const tv of byType.tv_stand || []) {
    const viewer = (byType.sofa || [])[0] || (byType.armchair || [])[0] || (byType.bed || [])[0];
    if (!viewer) continue;
    const v = tvViewing(room, items, tv, viewer);
    let pen = Math.max(0, v.screenAngle - 0.35) + Math.max(0, v.viewerAngle - 0.45)
      + Math.max(0, 1.2 - v.dist) + Math.max(0, v.dist - 4.5) * 0.5 + v.glare * 0.8 + (v.blockers.length ? 1.5 : 0);
    P.tv += pen;
    if (!fast) {
      sightlines.push({ from: v.eye, to: v.scr, ok: !v.blockers.length && v.screenAngle < 0.6 && v.viewerAngle < 0.7, glare: v.glare });
      if (v.blockers.length) { v.blockers.forEach((b) => flag(b, 'blocking')); add('warn', 'comfort', `${v.blockers.map(label).join(', ')} blocks the view of the TV from the ${label(viewer)}`, [tv, viewer, ...v.blockers]); }
      else if (v.screenAngle > 0.6 || v.viewerAngle > 0.7) add('warn', 'comfort', `TV and ${label(viewer)} are not facing each other`, [tv, viewer]);
      if (v.glare > 0.3) add('warn', 'comfort', 'Window glare on the TV screen', [tv]);
      if (v.dist > 4.5) add('info', 'comfort', `TV is ${v.dist.toFixed(1)} m from the ${label(viewer)} — far for comfortable viewing`, [tv, viewer]);
    }
  }
  for (const desk of byType.desk || []) {
    const d = deskDaylight(room, items, desk);
    const pen = d.glare * 1.2 + (room.windows?.length ? Math.max(0, 1 - d.df / 0.02) * 0.6 + (1 - d.side) * 0.3 : 0);
    P.desk += pen;
    if (!fast) {
      if (d.glare > 0.35) add('warn', 'comfort', 'Desk orientation causes screen glare (window in front or behind)', [desk]);
      if (room.windows?.length && d.df < 0.01) add('info', 'comfort', `Desk gets little daylight (DF ${(d.df * 100).toFixed(1)}%)`, [desk]);
    }
  }

  // ---- 8. stability w.r.t. a reference layout (optimiser "minimal change") ------------
  if (opts.reference && W.movement) {
    for (const it of items) {
      const r = opts.reference[it.id]; if (!r) continue;
      P.movement += Math.hypot(it.x - r.x, it.z - r.z) + 0.3 * Math.abs(Math.sin((it.rot - r.rot) / 2)) * 2;
    }
  }

  let cost = 0;
  for (const k in P) cost += W[k] * P[k];
  if (fast) return { cost, penalties: P };

  const scores = {};
  let total = 0;
  for (const [cat, keys] of Object.entries(CATS)) {
    const pen = keys.reduce((s, k) => s + W[k] * Math.max(0, P[k]), 0);
    scores[cat] = Math.round(100 * Math.exp(-pen / CAT_SCALE[cat]));
    total += CAT_WEIGHT[cat] * scores[cat];
  }
  if (P.overlap + P.bounds > 0.01) total = Math.min(total, 60);
  scores.total = Math.round(total);

  const daylight = room.windows?.length ? daylightMap(room, items, 0.2) : null;
  const order = { error: 0, warn: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    cost, penalties: P, scores, issues, flags, paths, zones, sightlines, grid: g, reach: R.parent, daylight,
    stats: {
      usable, freeArea: free * g.cell * g.cell, roomArea: room.width * room.length,
      narrowFraction: P.narrow, meanDF: daylight?.mean ?? 0, litFraction: daylight?.litFraction ?? 0,
      unreachable: unreachable.length,
    },
  };
}
