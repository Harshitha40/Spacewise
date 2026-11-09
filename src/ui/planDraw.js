// 2D top-down plan renderer (canvas) used for suggestion thumbnails, catalog
// icons and the walkthrough minimap. Orientation matches the 3D plan view:
// back wall (N, z = L) at the top, as seen from the photo's viewpoint.
import { CATALOG } from '../core/catalog.js';
import { footprint, localToWorld } from '../engine/geometry.js';

const FILL = {
  Bedroom: '#8b9cf6', Living: '#f59e8b', Office: '#6ee7b7', Dining: '#fcd34d', Kitchen: '#93c5fd', Bathroom: '#c4b5fd',
};

export function drawPlan(canvas, room, items, opts = {}) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const cw = canvas.clientWidth || canvas.width, ch = canvas.clientHeight || canvas.height;
  canvas.width = cw * dpr; canvas.height = ch * dpr;
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cw, ch);
  const pad = opts.pad ?? 10;
  const s = Math.min((cw - 2 * pad) / room.width, (ch - 2 * pad) / room.length);
  const ox = (cw - room.width * s) / 2, oy = (ch - room.length * s) / 2;
  const P = (x, z) => [ox + (room.width - x) * s, oy + (room.length - z) * s];

  g.fillStyle = opts.floor ?? 'rgba(255,255,255,0.05)';
  g.fillRect(ox, oy, room.width * s, room.length * s);
  g.strokeStyle = opts.wall ?? 'rgba(226,232,240,0.85)'; g.lineWidth = Math.max(2, s * 0.08);
  g.strokeRect(ox, oy, room.width * s, room.length * s);
  // openings
  const seg = (wall, t0, t1, color, lw) => {
    const a = { S: [t0, 0], N: [t0, room.length], W: [0, t0], E: [room.width, t0] }[wall];
    const b = { S: [t1, 0], N: [t1, room.length], W: [0, t1], E: [room.width, t1] }[wall];
    g.strokeStyle = color; g.lineWidth = lw; g.beginPath(); g.moveTo(...P(...a)); g.lineTo(...P(...b)); g.stroke();
  };
  for (const w of room.windows || []) seg(w.wall, w.offset, w.offset + w.width, '#7dd3fc', Math.max(3, s * 0.08));
  for (const d of room.doors || []) seg(d.wall, d.offset, d.offset + d.width, opts.doorColor ?? '#0f172a', Math.max(3, s * 0.1));

  const flags = opts.report?.flags || {};
  for (const it of items) {
    const c = CATALOG[it.type];
    const poly = footprint(it).map(([x, z]) => P(x, z));
    g.beginPath(); poly.forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p))); g.closePath();
    g.fillStyle = c.collide === false ? 'rgba(200,180,150,0.25)' : (FILL[c.category] || '#cbd5e1');
    g.globalAlpha = c.collide === false ? 1 : 0.85; g.fill(); g.globalAlpha = 1;
    const f = flags[it.id];
    g.strokeStyle = f?.collision ? '#ff3b5c' : f?.blocking ? '#ff9f1c' : 'rgba(15,23,42,0.6)';
    g.lineWidth = f?.collision || f?.blocking ? 2 : 1; g.stroke();
    // front tick
    if (c.collide !== false) {
      const a = P(...localToWorld(it, -it.w * 0.3, it.d / 2 - 0.04)), b = P(...localToWorld(it, it.w * 0.3, it.d / 2 - 0.04));
      g.strokeStyle = 'rgba(15,23,42,0.55)'; g.lineWidth = Math.max(1, s * 0.03);
      g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke();
    }
  }
  if (opts.player) {
    const [px, pz] = P(opts.player.x, opts.player.z);
    g.fillStyle = 'rgba(139,92,246,0.25)'; g.beginPath(); g.moveTo(px, pz);
    const fov = 0.6, r = 2.2 * s;
    // world view direction (dx, dz) is mirrored on screen (-x, -z)
    const ang = Math.atan2(-opts.player.dz, -opts.player.dx);
    g.arc(px, pz, r, ang - fov, ang + fov); g.closePath(); g.fill();
    g.fillStyle = '#a78bfa'; g.beginPath(); g.arc(px, pz, 5, 0, Math.PI * 2); g.fill();
  }
  return { s, P };
}

/** Small top-down icon of a catalog type. */
export function drawIcon(canvas, type) {
  const c = CATALOG[type];
  const room = { width: Math.max(c.w, c.d) * 1.15, length: Math.max(c.w, c.d) * 1.15 };
  drawPlan(canvas, room, [{ id: 'i', type, x: room.width / 2, z: room.length / 2, rot: Math.PI, w: c.w, d: c.d, h: c.h }], { pad: 4, floor: 'transparent', wall: 'transparent' });
}
