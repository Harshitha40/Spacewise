// Room shell: extruded walls with real openings for doors/windows, floor, ceiling.
import * as THREE from 'three';
import { wallLength, wallInward } from '../engine/geometry.js';

export const WALL_T = 0.12;
const DOOR_H = 2.05;

let floorTex;
function plankTexture() {
  if (floorTex) return floorTex;
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  const rows = 8, ph = 512 / rows;
  for (let r = 0; r < rows; r++) {
    let x = -Math.random() * 300;
    while (x < 512) {
      const len = 200 + Math.random() * 220;
      const base = 168 + Math.random() * 30;
      g.fillStyle = `rgb(${base},${base * 0.74},${base * 0.5})`; g.fillRect(x, r * ph, len, ph);
      for (let k = 0; k < 14; k++) {
        g.strokeStyle = `rgba(90,55,30,${0.05 + Math.random() * 0.08})`; g.lineWidth = 1 + Math.random();
        const yy = r * ph + Math.random() * ph; g.beginPath(); g.moveTo(x, yy);
        g.bezierCurveTo(x + len * 0.3, yy + 3, x + len * 0.6, yy - 3, x + len, yy); g.stroke();
      }
      g.fillStyle = 'rgba(60,35,20,0.55)'; g.fillRect(x, r * ph, 2, ph);
      x += len;
    }
    g.fillStyle = 'rgba(60,35,20,0.5)'; g.fillRect(0, r * ph, 512, 2);
  }
  floorTex = new THREE.CanvasTexture(c);
  floorTex.colorSpace = THREE.SRGBColorSpace; floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.anisotropy = 8;
  return floorTex;
}

function wallTransform(mesh, room, wall) {
  if (wall === 'S') mesh.position.set(0, 0, -WALL_T);
  if (wall === 'N') mesh.position.set(0, 0, room.length);
  if (wall === 'W') { mesh.rotation.y = -Math.PI / 2; mesh.position.set(0, 0, 0); }
  if (wall === 'E') { mesh.rotation.y = -Math.PI / 2; mesh.position.set(room.width + WALL_T, 0, 0); }
}

export function buildRoom(room) {
  const group = new THREE.Group();
  const H = room.height;
  const walls = [];

  // floor
  const tex = plankTexture().clone(); tex.needsUpdate = true; tex.repeat.set(room.width / 2.2, room.length / 2.2);
  const floorMatWood = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0.02 });
  const floorMatShadow = new THREE.ShadowMaterial({ opacity: 0.38 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(room.width, room.length), floorMatWood);
  floor.rotation.x = -Math.PI / 2; floor.position.set(room.width / 2, 0, room.length / 2);
  floor.receiveShadow = true; floor.name = 'floor';
  group.add(floor);

  // outer slab, so the cutaway room reads as a model
  const slab = new THREE.Mesh(new THREE.BoxGeometry(room.width + 2 * WALL_T, 0.08, room.length + 2 * WALL_T),
    new THREE.MeshStandardMaterial({ color: 0xd8d3cb, roughness: 0.9 }));
  slab.position.set(room.width / 2, -0.04 - 0.001, room.length / 2); slab.receiveShadow = true;
  group.add(slab);

  for (const wall of ['S', 'N', 'W', 'E']) {
    const len = wallLength(room, wall);
    const ext = wall === 'S' || wall === 'N' ? WALL_T : 0;
    const s = new THREE.Shape();
    s.moveTo(-ext, 0); s.lineTo(len + ext, 0); s.lineTo(len + ext, H); s.lineTo(-ext, H); s.closePath();
    const openings = [];
    for (const win of room.windows || []) if (win.wall === wall) openings.push({ kind: 'window', u0: win.offset, u1: win.offset + win.width, v0: win.sill, v1: Math.min(H - 0.05, win.sill + win.height) });
    for (const door of room.doors || []) if (door.wall === wall) openings.push({ kind: 'door', u0: door.offset, u1: door.offset + door.width, v0: 0.0, v1: Math.min(H - 0.1, DOOR_H) });
    for (const o of openings) {
      const hole = new THREE.Path();
      // door holes are cut 1 mm above the floor to keep the shape valid
      const v0 = o.kind === 'door' ? 0.001 : o.v0;
      hole.moveTo(o.u0, v0); hole.lineTo(o.u0, o.v1); hole.lineTo(o.u1, o.v1); hole.lineTo(o.u1, v0); hole.closePath();
      s.holes.push(hole);
    }
    const geo = new THREE.ExtrudeGeometry(s, { depth: WALL_T, bevelEnabled: false });
    const m = new THREE.MeshStandardMaterial({ color: 0xefeae2, roughness: 0.92 });
    const mesh = new THREE.Mesh(geo, m);
    wallTransform(mesh, room, wall);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.name = 'wall-' + wall;
    group.add(mesh);

    // fixtures (frames, glass, door leaf) share the wall's local frame
    const fx = new THREE.Group(); wallTransform(fx, room, wall); group.add(fx);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    for (const o of openings) {
      const w = o.u1 - o.u0, h = o.v1 - o.v0, cx = (o.u0 + o.u1) / 2;
      const rim = (bw, bh, x, y) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, WALL_T + 0.02), frameMat);
        b.position.set(x, y, WALL_T / 2); b.castShadow = true; fx.add(b);
      };
      const ft = 0.05;
      rim(ft, h, o.u0 - ft / 2 + 0.001, o.v0 + h / 2); rim(ft, h, o.u1 + ft / 2 - 0.001, o.v0 + h / 2);
      rim(w + 2 * ft, ft, cx, o.v1 + ft / 2);
      if (o.kind === 'window') {
        rim(w + 2 * ft + 0.04, ft * 0.8, cx, o.v0 - ft * 0.4);
        rim(0.03, h, cx, o.v0 + h / 2);
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshPhysicalMaterial({
          color: 0xcfe8ff, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0, side: THREE.DoubleSide, depthWrite: false,
        }));
        glass.position.set(cx, o.v0 + h / 2, WALL_T / 2); fx.add(glass);
      } else {
        // open door leaf, hinged at u0, swung 70deg into the room
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(w - 0.02, h - 0.02, 0.04), new THREE.MeshStandardMaterial({ color: 0xf7f4ef, roughness: 0.5 }));
        const hinge = new THREE.Group();
        // wall-local +z points into the room for S/E walls, out of it for N/W
        const inwardLocal = wall === 'S' || wall === 'E' ? 1 : -1;
        hinge.position.set(o.u0, 0, inwardLocal > 0 ? WALL_T : 0);
        leaf.position.set((w - 0.02) / 2, (h - 0.02) / 2 + 0.01, 0.02 * inwardLocal);
        hinge.rotation.y = -inwardLocal * (70 * Math.PI) / 180;
        hinge.add(leaf); leaf.castShadow = true; fx.add(hinge);
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 12), new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.9, roughness: 0.3 }));
        knob.position.set(w - 0.1, 1.0, 0.04 * inwardLocal); hinge.add(knob);
      }
    }
    walls.push({ wall, mesh, fixtures: fx, inward: wallInward(wall), center: wallCenter(room, wall) });
  }

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(room.width + 0.3, room.length + 0.3), new THREE.MeshStandardMaterial({ color: 0xfaf8f4, roughness: 1, side: THREE.DoubleSide }));
  ceiling.rotation.x = Math.PI / 2; ceiling.position.set(room.width / 2, H, room.length / 2);
  ceiling.visible = false; ceiling.name = 'ceiling';
  group.add(ceiling);

  const lamp = new THREE.PointLight(0xffe2b8, 0, 9, 1.6);
  lamp.position.set(room.width / 2, H - 0.25, room.length / 2);
  group.add(lamp);
  const lampShade = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.18, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0xf3ead9, emissive: 0xffd79a, emissiveIntensity: 0.0, side: THREE.DoubleSide }));
  lampShade.position.copy(lamp.position); lampShade.visible = false; group.add(lampShade);

  /** Hide walls between camera and room (dollhouse cutaway) while keeping them in the shadow pass. */
  function setCutaway(camPos, enabled) {
    for (const w of walls) {
      const dx = camPos.x - w.center[0], dz = camPos.z - w.center[1];
      const outside = enabled && dx * w.inward[0] + dz * w.inward[1] < 0;
      w.mesh.material.colorWrite = !outside;
      w.mesh.material.depthWrite = !outside;
      w.fixtures.visible = !outside;
    }
  }
  function setMode(mode) {
    const ar = mode === 'ar';
    floor.material = ar ? floorMatShadow : floorMatWood;
    slab.visible = !ar;
    walls.forEach((w) => { w.mesh.visible = !ar; w.fixtures.visible = !ar; });
    ceiling.visible = mode === 'walk';
    lampShade.visible = mode === 'walk';
    lamp.intensity = mode === 'walk' ? 6 : 0;
    lampShade.material.emissiveIntensity = mode === 'walk' ? 0.8 : 0;
  }
  return { group, walls, floor, ceiling, setCutaway, setMode };
}

function wallCenter(room, wall) {
  return { S: [room.width / 2, 0], N: [room.width / 2, room.length], W: [0, room.length / 2], E: [room.width, room.length / 2] }[wall];
}
