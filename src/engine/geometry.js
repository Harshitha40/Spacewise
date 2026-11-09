// 2D/3D geometric primitives for oriented furniture boxes.
// Pure functions, no DOM / three.js dependency, so they run in Web Workers and
// mirror 1:1 the C++ engine (engine/cpp/src/geometry.cpp).

export function localToWorld(it, lx, lz) {
  const c = Math.cos(it.rot), s = Math.sin(it.rot);
  return [it.x + lx * c + lz * s, it.z - lx * s + lz * c];
}

export function worldToLocal(it, x, z) {
  const c = Math.cos(it.rot), s = Math.sin(it.rot);
  const dx = x - it.x, dz = z - it.z;
  return [dx * c - dz * s, dx * s + dz * c];
}

export function forward(it) { return [Math.sin(it.rot), Math.cos(it.rot)]; }

/** Oriented rectangle in item-local coords -> world polygon (CCW in x/z). */
export function localRect(it, x0, z0, x1, z1) {
  return [localToWorld(it, x0, z0), localToWorld(it, x1, z0), localToWorld(it, x1, z1), localToWorld(it, x0, z1)];
}

export function footprint(it, pad = 0) {
  const hw = it.w / 2 + pad, hd = it.d / 2 + pad;
  return localRect(it, -hw, -hd, hw, hd);
}

export function polyArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, z1] = p[i], [x2, z2] = p[(i + 1) % p.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}

function ensureCCW(p) { return polyArea(p) < 0 ? p.slice().reverse() : p; }

export function polyBounds(p) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  return [x0, z0, x1, z1];
}

/** Sutherland–Hodgman clip of convex subject by convex clip polygon. */
export function clipConvex(subject, clip) {
  let out = ensureCCW(subject);
  const c = ensureCCW(clip);
  for (let i = 0; i < c.length && out.length; i++) {
    const [ax, az] = c[i], [bx, bz] = c[(i + 1) % c.length];
    const inside = (p) => (bx - ax) * (p[1] - az) - (bz - az) * (p[0] - ax) >= 0;
    const input = out; out = [];
    for (let j = 0; j < input.length; j++) {
      const P = input[j], Q = input[(j + 1) % input.length];
      const pin = inside(P), qin = inside(Q);
      if (pin) out.push(P);
      if (pin !== qin) {
        const dx = Q[0] - P[0], dz = Q[1] - P[1];
        const den = (bx - ax) * dz - (bz - az) * dx;
        if (Math.abs(den) > 1e-12) {
          const t = ((ax - P[0]) * (bz - az) - (az - P[1]) * (bx - ax)) / -den;
          out.push([P[0] + t * dx, P[1] + t * dz]);
        }
      }
    }
  }
  return out;
}

export function intersectArea(a, b) {
  const ba = polyBounds(a), bb = polyBounds(b);
  if (ba[2] <= bb[0] || bb[2] <= ba[0] || ba[3] <= bb[1] || bb[3] <= ba[1]) return 0;
  const r = clipConvex(a, b);
  return r.length >= 3 ? Math.abs(polyArea(r)) : 0;
}

/** Area of polygon lying outside the room rectangle [0,W]x[0,L]. */
export function outsideArea(p, W, L) {
  const inside = clipConvex(p, [[0, 0], [W, 0], [W, L], [0, L]]);
  return Math.abs(polyArea(p)) - (inside.length >= 3 ? Math.abs(polyArea(inside)) : 0);
}

export function pointInItem(it, x, z, pad = 0) {
  const [lx, lz] = worldToLocal(it, x, z);
  return Math.abs(lx) <= it.w / 2 + pad && Math.abs(lz) <= it.d / 2 + pad;
}

/** 3D segment vs oriented box (item footprint extruded to height h). Returns hit t in [0,1] or -1. */
export function segmentHitsItem(it, p, q, shrink = 0) {
  const [ax, az] = worldToLocal(it, p[0], p[2]);
  const [bx, bz] = worldToLocal(it, q[0], q[2]);
  const o = [ax, p[1], az], d = [bx - ax, q[1] - p[1], bz - az];
  const mn = [-it.w / 2 + shrink, 0, -it.d / 2 + shrink], mx = [it.w / 2 - shrink, it.h, it.d / 2 - shrink];
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-9) { if (o[k] < mn[k] || o[k] > mx[k]) return -1; continue; }
    let ta = (mn[k] - o[k]) / d[k], tb = (mx[k] - o[k]) / d[k];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return -1;
  }
  return t0;
}

/** Distance from point to an item's footprint rectangle (0 if inside). */
export function distToItem(it, x, z) {
  const [lx, lz] = worldToLocal(it, x, z);
  const dx = Math.max(Math.abs(lx) - it.w / 2, 0), dz = Math.max(Math.abs(lz) - it.d / 2, 0);
  return Math.hypot(dx, dz);
}

export const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const angleBetween = (u, v) => {
  const lu = Math.hypot(u[0], u[1]) || 1, lv = Math.hypot(v[0], v[1]) || 1;
  return Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (lu * lv))));
};

// ---- Room wall helpers -------------------------------------------------------
// Walls: S (z=0), N (z=L), W (x=0), E (x=W). `offset` runs along +x (S/N) or +z (W/E).
export const WALLS = ['S', 'N', 'W', 'E'];

export function wallLength(room, wall) { return wall === 'S' || wall === 'N' ? room.width : room.length; }

export function wallPoint(room, wall, t, inset = 0) {
  switch (wall) {
    case 'S': return [t, inset];
    case 'N': return [t, room.length - inset];
    case 'W': return [inset, t];
    case 'E': return [room.width - inset, t];
  }
}
export function wallInward(wall) {
  return { S: [0, 1], N: [0, -1], W: [1, 0], E: [-1, 0] }[wall];
}
/** rot so that an item's back faces `wall` (front points into the room). */
export function rotFacingAway(wall) {
  return { S: 0, N: Math.PI, W: Math.PI / 2, E: -Math.PI / 2 }[wall];
}
export function wallAlong(wall) { return wall === 'S' || wall === 'N' ? [1, 0] : [0, 1]; }

export function normAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}
