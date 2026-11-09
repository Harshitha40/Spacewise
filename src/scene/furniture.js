// Procedural, dimension-driven furniture models. Every model is generated from
// the item's real (w, d, h) so the 3D scene is metrically faithful to what the
// user entered. Local frame: origin at footprint centre on the floor, +Z = front.
import * as THREE from 'three';

const matCache = new Map();
function mat(key, opts) {
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial(opts));
  return matCache.get(key);
}

function canvasTex(draw, size = 256, repeat = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}

let _fabric, _wood;
function fabricTex() {
  return _fabric ||= canvasTex((g, s) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 9000; i++) { const v = 225 + Math.random() * 30; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * s, Math.random() * s, 1.4, 1.4); }
  }, 256, 3);
}
function woodTex() {
  return _wood ||= canvasTex((g, s) => {
    g.fillStyle = '#d9b88f'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 2) {
      const v = Math.sin(y * 0.15 + Math.sin(y * 0.02) * 4) * 18;
      g.fillStyle = `rgba(${120 + v},${80 + v},${45 + v},0.18)`; g.fillRect(0, y, s, 2);
    }
  }, 256, 1);
}

export const M = {
  wood: () => mat('wood', { color: 0xb88a5a, map: woodTex(), roughness: 0.55 }),
  darkWood: () => mat('darkWood', { color: 0x6b4a33, map: woodTex(), roughness: 0.5 }),
  white: () => mat('white', { color: 0xf2efe9, roughness: 0.45 }),
  fabric: (c = 0x7d8fa6) => mat('fab' + c, { color: c, map: fabricTex(), roughness: 0.95 }),
  linen: () => mat('linen', { color: 0xf5f2ec, map: fabricTex(), roughness: 0.9 }),
  metal: () => mat('metal', { color: 0x9aa3ad, metalness: 0.85, roughness: 0.3 }),
  black: () => mat('black', { color: 0x15171a, roughness: 0.25, metalness: 0.3 }),
  screen: () => mat('screen', { color: 0x0b0f17, roughness: 0.08, metalness: 0.2, emissive: 0x0a1630, emissiveIntensity: 0.6 }),
  steel: () => mat('steel', { color: 0xd5d9de, metalness: 0.7, roughness: 0.25 }),
  ceramic: () => mat('ceramic', { color: 0xfbfbfb, roughness: 0.15 }),
  leaf: () => mat('leaf', { color: 0x3f8f4e, roughness: 0.8 }),
  pot: () => mat('pot', { color: 0xc96f4a, roughness: 0.7 }),
  stone: () => mat('stone', { color: 0xe7e3dc, roughness: 0.35 }),
};

function box(g, w, h, d, m, x = 0, y = 0, z = 0, r = 0) {
  const geo = r > 0 ? roundedBox(w, h, d, r) : new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = mesh.receiveShadow = true;
  g.add(mesh); return mesh;
}
function cyl(g, rt, rb, h, m, x = 0, y = 0, z = 0, seg = 20) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  mesh.position.set(x, y + h / 2, z); mesh.castShadow = mesh.receiveShadow = true; g.add(mesh); return mesh;
}
function roundedBox(w, h, d, r) {
  r = Math.min(r, w / 2, h / 2, d / 2);
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const geo = new THREE.ExtrudeGeometry(s, { depth: d - 2 * r * 0.5, bevelEnabled: true, bevelThickness: r * 0.5, bevelSize: r * 0.5, bevelSegments: 3, curveSegments: 6 });
  geo.translate(0, 0, -(d - r) / 2);
  geo.computeVertexNormals();
  return geo;
}
function legs(g, w, d, h, m, inset = 0.05, r = 0.025) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, r, r * 0.8, h, m, sx * (w / 2 - inset), 0, sz * (d / 2 - inset), 10);
}

const builders = {
  bed(g, { w, d, h }) {
    const frameH = h * 0.45;
    box(g, w, frameH, d, M.darkWood(), 0, 0.05, 0, 0.02);
    legs(g, w, d, 0.05, M.darkWood(), 0.08, 0.03);
    box(g, w - 0.04, h - frameH - 0.05, d - 0.06, M.linen(), 0, frameH + 0.05, 0.02, 0.06);
    box(g, w + 0.02, 0.06, d * 0.55, M.fabric(0x6f8fb0), 0, h - 0.01, d * 0.2, 0.03); // duvet fold
    const pw = Math.min(0.62, (w - 0.15) / 2);
    for (const s of w > 1.2 ? [-1, 1] : [0]) box(g, pw, 0.12, 0.38, M.white(), s * (pw / 2 + 0.03), h, -d / 2 + 0.3, 0.05);
    box(g, w + 0.04, 1.0, 0.08, M.darkWood(), 0, 0, -d / 2 - 0.02, 0.02); // headboard
  },
  nightstand(g, { w, d, h }) {
    box(g, w, h - 0.08, d, M.wood(), 0, 0.08, 0, 0.015);
    legs(g, w, d, 0.08, M.darkWood(), 0.04, 0.015);
    box(g, w - 0.06, 0.005, 0.01, M.darkWood(), 0, h * 0.55, d / 2);
    cyl(g, 0.07, 0.09, 0.06, M.white(), w * 0.2, h, -d * 0.1); // lamp base
    cyl(g, 0.012, 0.012, 0.3, M.metal(), w * 0.2, h + 0.06, -d * 0.1, 8);
    cyl(g, 0.09, 0.13, 0.16, M.linen(), w * 0.2, h + 0.3, -d * 0.1);
  },
  wardrobe(g, { w, d, h }) {
    box(g, w, h, d, M.white(), 0, 0, 0, 0.01);
    box(g, 0.006, h - 0.1, 0.005, M.darkWood(), 0, 0.05, d / 2 + 0.002);
    for (const s of [-1, 1]) box(g, 0.015, 0.25, 0.02, M.metal(), s * 0.05, h * 0.5, d / 2 + 0.01);
  },
  dresser(g, { w, d, h }) {
    box(g, w, h - 0.1, d, M.wood(), 0, 0.1, 0, 0.012);
    legs(g, w, d, 0.1, M.darkWood(), 0.05, 0.02);
    for (let i = 0; i < 3; i++) {
      const y = 0.15 + (i + 0.5) * (h - 0.2) / 3;
      box(g, w - 0.08, 0.004, 0.006, M.darkWood(), 0, y + (h - 0.2) / 6 - 0.01, d / 2);
      box(g, 0.14, 0.02, 0.02, M.metal(), 0, y, d / 2 + 0.01);
    }
  },
  desk(g, { w, d, h }) {
    box(g, w, 0.03, d, M.wood(), 0, h - 0.03, 0, 0.01);
    for (const s of [-1, 1]) box(g, 0.04, h - 0.03, d - 0.06, M.metal(), s * (w / 2 - 0.04), 0, 0);
    box(g, 0.5, 0.3, 0.02, M.black(), 0, h + 0.12, -d * 0.25); // monitor
    box(g, 0.48, 0.27, 0.005, M.screen(), 0, h + 0.135, -d * 0.25 + 0.012);
    box(g, 0.05, 0.12, 0.05, M.black(), 0, h, -d * 0.25 - 0.02);
    box(g, 0.4, 0.015, 0.13, M.black(), 0, h, d * 0.15);
  },
  office_chair(g, { w, d, h }) {
    cyl(g, 0.28, 0.28, 0.03, M.black(), 0, 0.05, 0, 5);
    cyl(g, 0.025, 0.025, 0.4, M.metal(), 0, 0.06, 0, 8);
    box(g, w * 0.85, 0.08, d * 0.8, M.fabric(0x3a4150), 0, 0.46, 0.02, 0.03);
    box(g, w * 0.8, h - 0.55, 0.06, M.fabric(0x3a4150), 0, 0.55, -d * 0.38, 0.03);
  },
  bookshelf(g, { w, d, h }) {
    const t = 0.02, m = M.wood();
    for (const s of [-1, 1]) box(g, t, h, d, m, s * (w / 2 - t / 2), 0, 0);
    box(g, w, h, 0.01, m, 0, 0, -d / 2 + 0.005);
    const n = Math.max(3, Math.round(h / 0.38));
    const colors = [0xb54a3c, 0x2f5d8a, 0xe0b04a, 0x3f7f5f, 0x6a4c93, 0xd8d2c4];
    for (let i = 0; i <= n; i++) {
      const y = (i * (h - t)) / n;
      box(g, w - 2 * t, t, d - 0.01, m, 0, y, 0.005);
      if (i < n) {
        let x = -w / 2 + t + 0.02;
        while (x < w / 2 - 0.08) {
          const bw = 0.02 + Math.random() * 0.03, bh = (h / n) * (0.6 + Math.random() * 0.3);
          box(g, bw, bh, d * 0.75, M.fabric(colors[Math.floor(Math.random() * colors.length)]), x + bw / 2, y + t, 0);
          x += bw + 0.004;
        }
      }
    }
  },
  sofa(g, { w, d, h }) {
    const c = M.fabric(0x8c97a8), seatH = 0.42, arm = 0.16;
    box(g, w, 0.28, d, c, 0, 0.08, 0, 0.04);
    legs(g, w, d, 0.08, M.darkWood(), 0.08, 0.02);
    const n = w > 1.8 ? 3 : 2, cw = (w - 2 * arm) / n;
    for (let i = 0; i < n; i++) box(g, cw - 0.02, 0.12, d - 0.25, c, -w / 2 + arm + cw * (i + 0.5), 0.33, 0.1, 0.05);
    box(g, w, h - 0.33, 0.22, c, 0, 0.33, -d / 2 + 0.11, 0.06);
    for (const s of [-1, 1]) box(g, arm, seatH + 0.2 - 0.08, d, c, s * (w / 2 - arm / 2), 0.08, 0, 0.05);
    for (let i = 0; i < n; i++) box(g, cw * 0.55, 0.32, 0.12, M.fabric(0xd9c8a9), -w / 2 + arm + cw * (i + 0.5), seatH + 0.05, -d / 2 + 0.3, 0.05);
  },
  armchair(g, { w, d, h }) {
    const c = M.fabric(0xc9875b);
    box(g, w, 0.3, d, c, 0, 0.1, 0, 0.05);
    legs(g, w, d, 0.1, M.darkWood(), 0.06, 0.02);
    box(g, w - 0.3, 0.12, d - 0.25, c, 0, 0.4, 0.08, 0.05);
    box(g, w, h - 0.4, 0.18, c, 0, 0.4, -d / 2 + 0.09, 0.06);
    for (const s of [-1, 1]) box(g, 0.15, 0.32, d, c, s * (w / 2 - 0.075), 0.38, 0, 0.05);
  },
  coffee_table(g, { w, d, h }) {
    box(g, w, 0.04, d, M.wood(), 0, h - 0.04, 0, 0.015);
    box(g, w - 0.1, 0.02, d - 0.1, M.darkWood(), 0, 0.12, 0);
    legs(g, w, d, h - 0.04, M.darkWood(), 0.05, 0.02);
    cyl(g, 0.08, 0.06, 0.1, M.ceramic(), w * 0.2, h, 0);
  },
  tv_stand(g, { w, d, h }) {
    box(g, w, h - 0.08, d, M.darkWood(), 0, 0.08, 0, 0.012);
    legs(g, w, d, 0.08, M.metal(), 0.06, 0.015);
    const sw = Math.min(w * 0.9, 1.25 * 0.87), sh = sw * 0.5625;
    box(g, 0.25, 0.02, 0.18, M.black(), 0, h, -d * 0.15);
    box(g, 0.04, 0.12, 0.03, M.black(), 0, h, -d * 0.15);
    box(g, sw, sh, 0.04, M.black(), 0, h + 0.1, -d * 0.15);
    box(g, sw - 0.03, sh - 0.03, 0.005, M.screen(), 0, h + 0.115, -d * 0.15 + 0.022);
  },
  rug(g, { w, d }) {
    const tex = canvasTex((c, s) => {
      c.fillStyle = '#b9a58a'; c.fillRect(0, 0, s, s);
      c.strokeStyle = '#8a6f52'; c.lineWidth = 10; c.strokeRect(14, 14, s - 28, s - 28);
      c.strokeStyle = '#e8dcc8'; c.lineWidth = 3; c.strokeRect(34, 34, s - 68, s - 68);
      for (let i = 0; i < 6000; i++) { c.fillStyle = `rgba(255,255,255,${Math.random() * 0.06})`; c.fillRect(Math.random() * s, Math.random() * s, 2, 2); }
    }, 256, 1);
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), m);
    mesh.position.y = 0.006; mesh.receiveShadow = true; g.add(mesh);
  },
  plant(g, { w, h }) {
    cyl(g, w * 0.32, w * 0.24, h * 0.3, M.pot(), 0, 0, 0);
    const leaves = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(w * (0.22 + Math.random() * 0.12), 0), M.leaf());
      const a = (i / 9) * Math.PI * 2, r = w * 0.18 * Math.random();
      s.position.set(Math.cos(a) * r, h * (0.45 + Math.random() * 0.45), Math.sin(a) * r);
      s.castShadow = true; leaves.add(s);
    }
    g.add(leaves);
  },
  dining_table(g, { w, d, h }) {
    box(g, w, 0.04, d, M.wood(), 0, h - 0.04, 0, 0.015);
    legs(g, w, d, h - 0.04, M.darkWood(), 0.08, 0.03);
  },
  dining_chair(g, { w, d, h }) {
    box(g, w, 0.04, d * 0.9, M.wood(), 0, 0.44, 0.02, 0.01);
    legs(g, w, d * 0.9, 0.44, M.darkWood(), 0.03, 0.015);
    box(g, w, h - 0.48, 0.03, M.wood(), 0, 0.48, -d / 2 + 0.04, 0.01);
  },
  kitchen_counter(g, { w, d, h }) {
    box(g, w, h - 0.04 - 0.1, d - 0.03, M.white(), 0, 0.1, -0.015);
    box(g, w, 0.1, d - 0.08, M.black(), 0, 0, -0.04);
    box(g, w + 0.02, 0.04, d + 0.02, M.stone(), 0, h - 0.04, 0);
    const n = Math.max(1, Math.round(w / 0.6));
    for (let i = 1; i < n; i++) box(g, 0.004, h - 0.18, 0.004, M.black(), -w / 2 + (i * w) / n, 0.12, d / 2 - 0.015);
    for (let i = 0; i < n; i++) box(g, 0.12, 0.015, 0.02, M.metal(), -w / 2 + ((i + 0.5) * w) / n, h - 0.14, d / 2 - 0.01);
    box(g, 0.5, 0.01, 0.38, M.steel(), w * 0.2, h - 0.005, 0); // sink
    cyl(g, 0.012, 0.012, 0.25, M.steel(), w * 0.2, h, -d * 0.35, 8);
  },
  fridge(g, { w, d, h }) {
    box(g, w, h, d, M.steel(), 0, 0, 0, 0.03);
    box(g, w - 0.02, 0.006, 0.006, M.black(), 0, h * 0.62, d / 2);
    box(g, 0.025, 0.4, 0.03, M.black(), -w / 2 + 0.08, h * 0.68, d / 2 + 0.015);
    box(g, 0.025, 0.3, 0.03, M.black(), -w / 2 + 0.08, h * 0.25, d / 2 + 0.015);
  },
  stove(g, { w, d, h }) {
    box(g, w, h, d, M.steel(), 0, 0, 0, 0.01);
    box(g, w - 0.1, h * 0.45, 0.01, M.black(), 0, 0.15, d / 2);
    box(g, w, 0.01, d, M.black(), 0, h, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, 0.08, 0.08, 0.008, M.metal(), sx * w * 0.22, h + 0.01, sz * d * 0.2);
  },
  toilet(g, { w, d, h }) {
    cyl(g, w * 0.32, w * 0.24, 0.38, M.ceramic(), 0, 0, d * 0.08);
    const seat = cyl(g, w * 0.5, w * 0.5, 0.05, M.ceramic(), 0, 0.38, d * 0.12, 24); seat.scale.z = 1.35;
    box(g, w, h - 0.38, 0.2, M.ceramic(), 0, 0.38, -d / 2 + 0.1, 0.03);
  },
};

export function createFurniture(item) {
  const root = new THREE.Group();
  const inner = new THREE.Group();
  (builders[item.type] || builders.dresser)(inner, item);
  root.add(inner);
  root.userData.itemId = item.id;
  root.position.set(item.x, 0, item.z);
  root.rotation.y = item.rot;
  root.traverse((o) => { if (o.isMesh) o.userData.itemId = item.id; });
  return root;
}

export function disposeObject(o) {
  o.traverse((c) => { if (c.isMesh) c.geometry.dispose(); });
}
