// Visual analytics drawn in the 3D scene: walkability & daylight heatmaps,
// animated circulation flows, TV sightlines, clearance zones, collision shells.
import * as THREE from 'three';
import { BODY_RADIUS, COMFORT_RADIUS } from '../engine/grid.js';

const COLORS = { collision: 0xff3b5c, blocking: 0xff9f1c, warn: 0xffd23f, ok: 0x2ee6a6, path: 0x38bdf8 };

function heatPlane(room, nx, nz, data, y) {
  const tex = new THREE.DataTexture(data, nx, nz, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(room.width, room.length), m);
  mesh.rotation.x = -Math.PI / 2; mesh.position.set(room.width / 2, y, room.length / 2);
  mesh.renderOrder = 2;
  return mesh;
}

// perceptual colormap for daylight factor (0..5 %)
function dfColor(v) {
  const t = Math.min(1, v / 0.05);
  const stops = [[0.05, 0.03, 0.25], [0.35, 0.12, 0.6], [0.85, 0.3, 0.45], [0.99, 0.65, 0.2], [1, 0.95, 0.6]];
  const s = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(s)), f = s - i;
  return stops[i].map((c, k) => c + (stops[i + 1][k] - c) * f);
}

export class Overlays {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group(); this.root.name = 'overlays';
    scene.add(this.root);
    this.layers = {};
    this.flows = [];
    this.pulse = [];
    this.t = 0;
  }
  clear(name) {
    const g = this.layers[name];
    if (g) { this.root.remove(g); g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } }); }
    delete this.layers[name];
    if (name === 'paths') this.flows = [];
    if (name === 'flags') this.pulse = [];
  }
  layer(name) { this.clear(name); const g = new THREE.Group(); g.name = name; this.root.add(g); this.layers[name] = g; return g; }

  update(room, items, report, toggles) {
    this.room = room;
    ['walk', 'daylight', 'paths', 'sight', 'zones', 'flags', 'doors'].forEach((n) => this.clear(n));
    if (!report) return;
    this.drawDoors(room);
    if (toggles.collisions) this.drawFlags(items, report);
    if (toggles.walkability) this.drawWalkability(room, report);
    if (toggles.daylight && report.daylight) this.drawDaylight(room, report.daylight);
    if (toggles.paths) this.drawPaths(report);
    if (toggles.sightlines) this.drawSightlines(report);
    if (toggles.clearance) this.drawZones(report);
  }

  drawDoors(room) {
    const g = this.layer('doors');
    for (const d of room.doors || []) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0); shape.absarc(0, 0, d.width, 0, Math.PI / 2, false); shape.lineTo(0, 0);
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape, 24), new THREE.MeshBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
      mesh.rotation.x = -Math.PI / 2;
      const hinge = { S: [d.offset, 0], N: [d.offset + d.width, room.length], W: [0, d.offset + d.width], E: [room.width, d.offset] }[d.wall];
      const rot = { S: 0, N: Math.PI, W: -Math.PI / 2, E: Math.PI / 2 }[d.wall];
      mesh.position.set(hinge[0], 0.008, hinge[1]);
      mesh.rotation.z = rot;
      g.add(mesh);
    }
  }

  drawFlags(items, report) {
    const g = this.layer('flags');
    for (const it of items) {
      const f = report.flags[it.id]; if (!f) continue;
      const color = f.collision ? COLORS.collision : f.blocking ? COLORS.blocking : COLORS.warn;
      const geo = new THREE.BoxGeometry(it.w + 0.04, Math.max(it.h, 0.05) + 0.04, it.d + 0.04);
      const shell = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false }));
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 }));
      const holder = new THREE.Group(); holder.add(shell, edges);
      holder.position.set(it.x, Math.max(it.h, 0.05) / 2 + 0.01, it.z); holder.rotation.y = it.rot;
      g.add(holder);
      if (f.collision || f.blocking) this.pulse.push(shell.material);
    }
  }

  drawWalkability(room, report) {
    const { grid: gr, reach } = report;
    const data = new Uint8Array(gr.nx * gr.nz * 4);
    for (let j = 0; j < gr.nz; j++) for (let i = 0; i < gr.nx; i++) {
      const id = j * gr.nx + i, o = ((gr.nz - 1 - j) * gr.nx + i) * 4;
      if (gr.occ[id] >= 0) { data[o + 3] = 0; continue; }
      const d = gr.dist[id];
      let c;
      if (reach[id] !== -2) c = d >= COMFORT_RADIUS ? [46, 230, 166, 120] : [255, 200, 60, 150];
      else if (d >= BODY_RADIUS) c = [255, 59, 92, 150]; // walkable but cut off
      else c = [255, 59, 92, 40]; // too tight
      data.set(c, o);
    }
    this.layer('walk').add(heatPlane(room, gr.nx, gr.nz, data, 0.01));
  }

  drawDaylight(room, dl) {
    const data = new Uint8Array(dl.nx * dl.nz * 4);
    for (let j = 0; j < dl.nz; j++) for (let i = 0; i < dl.nx; i++) {
      const v = dl.df[j * dl.nx + i], o = ((dl.nz - 1 - j) * dl.nx + i) * 4;
      const c = dfColor(v);
      data.set([c[0] * 255, c[1] * 255, c[2] * 255, 175], o);
    }
    this.layer('daylight').add(heatPlane(room, dl.nx, dl.nz, data, 0.012));
  }

  drawPaths(report) {
    const g = this.layer('paths');
    const mat = new THREE.MeshBasicMaterial({ color: COLORS.path, transparent: true, opacity: 0.55, depthWrite: false });
    const dotGeo = new THREE.SphereGeometry(0.045, 12, 12);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xe0f7ff });
    for (const p of report.paths) {
      if (p.pts.length < 2) continue;
      const v = p.pts.map(([x, z]) => new THREE.Vector3(x, 0.03, z));
      const curve = new THREE.CatmullRomCurve3(v, false, 'centripetal', 0.2);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, v.length * 6), 0.018, 6, false), mat);
      g.add(tube);
      const len = curve.getLength();
      const n = Math.max(1, Math.round(len / 0.9));
      for (let k = 0; k < n; k++) {
        const dot = new THREE.Mesh(dotGeo, dotMat); g.add(dot);
        this.flows.push({ curve, dot, phase: k / n, speed: 0.55 / Math.max(len, 0.3) });
      }
      const end = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.1, 24), new THREE.MeshBasicMaterial({ color: COLORS.path, side: THREE.DoubleSide }));
      end.rotation.x = -Math.PI / 2; end.position.copy(v[v.length - 1]); g.add(end);
    }
  }

  drawSightlines(report) {
    const g = this.layer('sight');
    for (const s of report.sightlines) {
      const color = s.ok ? (s.glare > 0.3 ? COLORS.warn : COLORS.ok) : COLORS.collision;
      const a = new THREE.Vector3(...s.from), b = new THREE.Vector3(...s.to);
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.05, a.distanceTo(b), 12, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false }));
      cone.position.copy(a).add(b).multiplyScalar(0.5);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      g.add(cone);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 16), new THREE.MeshBasicMaterial({ color }));
      eye.position.copy(a); g.add(eye);
    }
  }

  drawZones(report) {
    const g = this.layer('zones');
    for (const z of report.zones) {
      const s = new THREE.Shape(z.poly.map(([x, y]) => new THREE.Vector2(x, -y)));
      const bad = z.frac > 0.3;
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshBasicMaterial({ color: bad ? COLORS.collision : 0x60a5fa, transparent: true, opacity: bad ? 0.28 : 0.14, depthWrite: false, side: THREE.DoubleSide }));
      mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0.015; g.add(mesh);
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(z.poly.map(([x, y]) => new THREE.Vector3(x, 0.016, y))), new THREE.LineDashedMaterial({ color: bad ? COLORS.collision : 0x60a5fa, dashSize: 0.06, gapSize: 0.04 }));
      line.computeLineDistances(); g.add(line);
    }
  }

  tick(dt) {
    this.t += dt;
    for (const f of this.flows) {
      f.phase = (f.phase + dt * f.speed) % 1;
      f.dot.position.copy(f.curve.getPointAt(f.phase));
      f.dot.position.y = 0.05 + Math.abs(Math.sin(f.phase * Math.PI * 14)) * 0.015;
    }
    const a = 0.12 + 0.12 * (0.5 + 0.5 * Math.sin(this.t * 5));
    for (const m of this.pulse) m.opacity = a;
  }
}
