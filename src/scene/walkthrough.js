// Desktop VR walkthrough: first-person navigation with a physical body capsule
// that collides with walls and furniture, eye-height "personas" (standing adult,
// wheelchair user, child) for accessibility evaluation, and stereoscopic output
// (red/cyan anaglyph, side-by-side for cardboard viewers, WebXR when available).
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { AnaglyphEffect } from 'three/examples/jsm/effects/AnaglyphEffect.js';
import { StereoEffect } from 'three/examples/jsm/effects/StereoEffect.js';
import { worldToLocal, localToWorld, wallPoint, wallInward } from '../engine/geometry.js';
import { CATALOG } from '../core/catalog.js';

export const PERSONAS = {
  adult: { label: 'Standing adult', eye: 1.62, radius: 0.22 },
  wheelchair: { label: 'Wheelchair user', eye: 1.2, radius: 0.38 },
  child: { label: 'Child (7 yrs)', eye: 1.05, radius: 0.18 },
};

export class Walkthrough {
  constructor(renderer, dom) {
    this.renderer = renderer;
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, 60);
    this.controls = new PointerLockControls(this.camera, dom);
    this.keys = new Set();
    this.vel = new THREE.Vector3();
    this.persona = 'adult';
    this.stereo = 'off';
    this.anaglyph = new AnaglyphEffect(renderer);
    this.sbs = new StereoEffect(renderer);
    this.sbs.setEyeSeparation(0.064);
    this.bob = 0;
    this.collisions = 0;
    this._kd = (e) => { if (this.active) { this.keys.add(e.code); if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault(); } };
    this._ku = (e) => this.keys.delete(e.code);
    addEventListener('keydown', this._kd); addEventListener('keyup', this._ku);
  }
  enter(room, items) {
    this.active = true; this.room = room; this.items = items;
    const door = room.doors?.[0];
    let start = [room.width / 2, room.length / 2], look = [room.width / 2, room.length / 2 + 1];
    if (door) {
      const inward = wallInward(door.wall);
      start = wallPoint(room, door.wall, door.offset + door.width / 2, 0.6);
      look = [start[0] + inward[0], start[1] + inward[1]];
    }
    this.camera.position.set(start[0], PERSONAS[this.persona].eye, start[1]);
    this.camera.lookAt(look[0], PERSONAS[this.persona].eye - 0.1, look[1]);
  }
  exit() { this.active = false; this.keys.clear(); if (this.controls.isLocked) this.controls.unlock(); }
  setItems(items) { this.items = items; }
  setPersona(p) { this.persona = p; this.camera.position.y = PERSONAS[p].eye; }
  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.anaglyph.setSize(w, h); this.sbs.setSize(w, h); }

  resolveCollisions(p) {
    const r = PERSONAS[this.persona].radius;
    let hit = false;
    p.x = Math.min(Math.max(p.x, r), this.room.width - r);
    p.z = Math.min(Math.max(p.z, r), this.room.length - r);
    for (const it of this.items) {
      const c = CATALOG[it.type];
      if (c.collide === false || it.h < 0.25) continue;
      const [lx, lz] = worldToLocal(it, p.x, p.z);
      const hw = it.w / 2, hd = it.d / 2;
      const cx = Math.max(-hw, Math.min(hw, lx)), cz = Math.max(-hd, Math.min(hd, lz));
      const dx = lx - cx, dz = lz - cz, d = Math.hypot(dx, dz);
      if (d < r) {
        hit = true;
        let nx, nz;
        if (d > 1e-6) { nx = dx / d; nz = dz / d; }
        else { // centre inside the box: push out along the shallowest axis
          const px = hw - Math.abs(lx), pz = hd - Math.abs(lz);
          if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; } else { nx = 0; nz = Math.sign(lz) || 1; }
        }
        const [wx, wz] = localToWorld(it, cx + nx * r, cz + nz * r);
        p.x = wx; p.z = wz;
      }
    }
    return hit;
  }

  update(dt) {
    if (!this.active) return;
    const speed = (this.keys.has('ShiftLeft') ? 2.6 : 1.4);
    const f = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    const s = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    const target = new THREE.Vector3();
    if (f || s) {
      const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
      const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
      target.addScaledVector(dir, f).addScaledVector(right, s).normalize().multiplyScalar(speed);
    }
    this.vel.lerp(target, 1 - Math.exp(-dt * 10));
    const p = this.camera.position;
    p.x += this.vel.x * dt; p.z += this.vel.z * dt;
    if (this.resolveCollisions(p)) this.collisions++;
    const moving = this.vel.length() > 0.1;
    this.bob += moving ? dt * 9 : 0;
    p.y = PERSONAS[this.persona].eye + (moving ? Math.sin(this.bob) * 0.018 : 0);
  }

  render(scene) {
    if (this.stereo === 'anaglyph') this.anaglyph.render(scene, this.camera);
    else if (this.stereo === 'sbs') this.sbs.render(scene, this.camera);
    else this.renderer.render(scene, this.camera);
  }
}
