// Main 3D viewport. Modes:
//   orbit — dollhouse 3D view with automatic wall cutaway
//   plan  — orthographic top-down plan with labels
//   walk  — desktop VR first-person walkthrough (+ stereo / WebXR)
//   ar    — 3D layout registered onto the user's own photograph
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { buildRoom } from './roomBuilder.js';
import { createFurniture, disposeObject } from './furniture.js';
import { Overlays } from './overlays.js';
import { Walkthrough } from './walkthrough.js';
import { CATALOG } from '../core/catalog.js';
import { normAngle } from '../engine/geometry.js';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Viewer {
  constructor(container) {
    this.el = container;
    this.on = {};
    this.mode = 'orbit';
    this.meshes = new Map();
    this.tweens = [];
    this.items = [];

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.xr.enabled = true;
    container.appendChild(r.domElement);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'label-layer';
    container.appendChild(this.labels.domElement);

    const scene = this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.35;

    this.hemi = new THREE.HemisphereLight(0xf4f7ff, 0x8a7a66, 0.9); scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);

    this.cam = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
    this.cam.position.set(-3, 6, -3);
    this.controls = new OrbitControls(this.cam, r.domElement);
    this.controls.enableDamping = true; this.controls.maxPolarAngle = Math.PI * 0.48; this.controls.minDistance = 1.5; this.controls.maxDistance = 30;
    this.ortho = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
    this.ortho.up.set(0, 0, 1);
    this.planControls = new OrbitControls(this.ortho, r.domElement);
    this.planControls.enableRotate = false; this.planControls.enabled = false;
    this.planControls.screenSpacePanning = true;
    this.arCam = new THREE.PerspectiveCamera(50, 1, 0.05, 100);
    this.arCam.matrixAutoUpdate = false;

    this.walk = new Walkthrough(r, r.domElement);
    this.walk.controls.addEventListener('lock', () => this.on.walkLock?.(true));
    this.walk.controls.addEventListener('unlock', () => this.on.walkLock?.(false));
    scene.add(this.walk.camera);

    this.overlays = new Overlays(scene);
    this.selection = new THREE.Group(); scene.add(this.selection);

    this.raycaster = new THREE.Raycaster();
    this.floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.bindPointer();
    this.clock = new THREE.Clock();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(container);
    this.resize();
    r.setAnimationLoop(() => this.frame());
  }

  // ---------------------------------------------------------------- room/items
  setRoom(room) {
    this.room = room;
    if (this.roomObj) { this.scene.remove(this.roomObj.group); disposeObject(this.roomObj.group); }
    this.roomObj = buildRoom(room);
    this.scene.add(this.roomObj.group);
    this.roomObj.setMode(this.mode);
    const cx = room.width / 2, cz = room.length / 2, span = Math.max(room.width, room.length);
    this.controls.target.set(cx, 0.6, cz);
    if (!this._framed) { this.cam.position.set(cx - span * 0.55, span * 1.15, cz - span * 0.95); this._framed = true; }
    this.planControls.target.set(cx, 0, cz);
    this.ortho.position.set(cx, 20, cz); this.ortho.lookAt(cx, 0, cz);
    const s = this.sun.shadow.camera; const e = span * 0.9 + 1;
    s.left = -e; s.right = e; s.top = e; s.bottom = -e; s.near = 0.5; s.far = 40; s.updateProjectionMatrix();
    this.setSun(this.hour ?? 14, this.north ?? 'N');
    this.fitPlan();
  }

  setItems(items, { animate = false } = {}) {
    this.items = items;
    const seen = new Set();
    for (const it of items) {
      seen.add(it.id);
      const key = `${it.type}|${it.w.toFixed(3)}|${it.d.toFixed(3)}|${it.h.toFixed(3)}`;
      let m = this.meshes.get(it.id);
      if (m && m.userData.key !== key) { this.scene.remove(m); disposeObject(m); m = null; }
      if (!m) {
        m = createFurniture(it); m.userData.key = key;
        m.scale.setScalar(animate ? 0.01 : 1);
        if (animate) this.tweens.push({ obj: m, from: { x: it.x, z: it.z, rot: it.rot, s: 0.01 }, to: { x: it.x, z: it.z, rot: it.rot, s: 1 }, t: 0, dur: 0.5 });
        this.scene.add(m); this.meshes.set(it.id, m);
        this.addLabel(m, it);
      } else if (animate) {
        const from = { x: m.position.x, z: m.position.z, rot: m.rotation.y, s: 1 };
        const to = { x: it.x, z: it.z, rot: from.rot + normAngle(it.rot - from.rot), s: 1 };
        this.tweens = this.tweens.filter((t) => t.obj !== m);
        this.tweens.push({ obj: m, from, to, t: 0, dur: 0.9 });
      } else {
        this.tweens = this.tweens.filter((t) => t.obj !== m);
        m.position.set(it.x, 0, it.z); m.rotation.y = it.rot;
      }
      m.userData.label.element.textContent = CATALOG[it.type].label;
    }
    for (const [id, m] of this.meshes) if (!seen.has(id)) { this.scene.remove(m); disposeObject(m); m.userData.label?.element.remove(); this.meshes.delete(id); }
    this.walk.setItems(items);
    this.refreshSelection();
  }

  addLabel(m, it) {
    const div = document.createElement('div'); div.className = 'plan-label';
    const lab = new CSS2DObject(div); lab.position.set(0, Math.max(it.h, 0.1) + 0.05, 0);
    m.add(lab); m.userData.label = lab; lab.visible = this.mode === 'plan';
  }

  select(id) { this.selectedId = id; this.refreshSelection(); }
  refreshSelection() {
    this.selection.clear();
    const it = this.items.find((i) => i.id === this.selectedId);
    if (!it) return;
    const geo = new THREE.BoxGeometry(it.w + 0.06, Math.max(it.h, 0.04) + 0.06, it.d + 0.06);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x8b5cf6 }));
    edges.position.set(it.x, Math.max(it.h, 0.04) / 2 + 0.01, it.z); edges.rotation.y = it.rot;
    const ring = new THREE.Mesh(new THREE.RingGeometry(Math.hypot(it.w, it.d) / 2 + 0.08, Math.hypot(it.w, it.d) / 2 + 0.12, 64), new THREE.MeshBasicMaterial({ color: 0x8b5cf6, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(it.x, 0.02, it.z);
    // front arrow
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 3), new THREE.MeshBasicMaterial({ color: 0x8b5cf6 }));
    arrow.rotation.set(Math.PI / 2, 0, 0);
    const holder = new THREE.Group(); holder.add(arrow); arrow.position.set(0, 0, it.d / 2 + 0.2);
    holder.position.set(it.x, 0.03, it.z); holder.rotation.y = it.rot;
    this.selection.add(edges, ring, holder);
  }

  updateOverlays(report, toggles) { this.report = report; this.toggles = toggles; this.overlays.update(this.room, this.items, report, toggles); }

  // ---------------------------------------------------------------- sun
  setSun(hour, north = 'N') {
    this.hour = hour; this.north = north;
    if (!this.room) return;
    const n = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] }[north];
    const e = [-n[1], n[0]];
    const tt = (hour - 6) / 12;
    const elev = Math.max(0.04, Math.sin(Math.PI * tt)) * (Math.PI / 180) * 58;
    const az = Math.PI / 2 + Math.PI * tt; // east -> south -> west
    const dx = n[0] * Math.cos(az) + e[0] * Math.sin(az), dz = n[1] * Math.cos(az) + e[1] * Math.sin(az);
    const c = new THREE.Vector3(this.room.width / 2, 0, this.room.length / 2);
    const d = 14;
    this.sun.position.set(c.x + dx * Math.cos(elev) * d, Math.sin(elev) * d, c.z + dz * Math.cos(elev) * d);
    this.sun.target.position.copy(c);
    const warm = Math.sin(Math.PI * tt);
    this.sun.color.setHSL(0.09, 0.8, 0.55 + 0.4 * warm);
    this.sun.intensity = 0.6 + 2.4 * Math.max(0, warm);
    this.hemi.intensity = 0.45 + 0.55 * Math.max(0, warm);
  }

  // ---------------------------------------------------------------- modes
  setMode(mode) {
    if (this.mode === 'walk' && mode !== 'walk') this.walk.exit();
    this.mode = mode;
    this.controls.enabled = mode === 'orbit';
    this.planControls.enabled = mode === 'plan';
    this.roomObj?.setMode(mode);
    for (const m of this.meshes.values()) if (m.userData.label) m.userData.label.visible = mode === 'plan';
    this.labels.domElement.style.display = mode === 'plan' ? '' : 'none';
    this.selection.visible = mode !== 'walk' && mode !== 'ar';
    this.renderer.setClearAlpha(mode === 'ar' ? 0 : 1);
    this.renderer.setClearColor(mode === 'ar' ? 0x000000 : 0x0d1017, mode === 'ar' ? 0 : 1);
    this.el.classList.toggle('ar-mode', mode === 'ar');
    this.scene.background = mode === 'walk' ? this.sky() : null;
    if (mode === 'walk') this.walk.enter(this.room, this.items);
    if (mode === 'plan') this.fitPlan();
    this.resize();
  }

  sky() {
    if (!this._sky) {
      const c = document.createElement('canvas'); c.width = 4; c.height = 256;
      const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, '#6fa8e8'); gr.addColorStop(0.5, '#cfe4f7'); gr.addColorStop(0.52, '#b9c7a8'); gr.addColorStop(1, '#7d8f6a');
      g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
      this._sky = new THREE.CanvasTexture(c); this._sky.colorSpace = THREE.SRGBColorSpace; this._sky.mapping = THREE.EquirectangularReflectionMapping;
    }
    return this._sky;
  }

  setCalibration(cal, photoUrl) {
    this.cal = cal; this.photoUrl = photoUrl;
    if (cal?.ok) {
      const m = new THREE.Matrix4().set(...cal.viewMatrix);
      this.arCam.matrixWorld.copy(m.invert());
      this.arCam.matrixWorldInverse.copy(new THREE.Matrix4().set(...cal.viewMatrix));
      this.arCam.fov = cal.fovY; this.arCam.aspect = cal.imgW / cal.imgH; this.arCam.updateProjectionMatrix();
    }
    this.resize();
  }
  setARBackground(url) { this.el.style.setProperty('--ar-bg', url ? `url(${url})` : 'none'); }

  fitPlan() {
    if (!this.room) return;
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1, a = w / h;
    const pad = 0.8, rw = this.room.width + pad * 2, rl = this.room.length + pad * 2;
    let hw, hh;
    if (rw / rl > a) { hw = rw / 2; hh = hw / a; } else { hh = rl / 2; hw = hh * a; }
    // camera up=+z: back wall (N) at the top of the plan, as seen from the photo viewpoint
    Object.assign(this.ortho, { left: -hw, right: hw, top: hh, bottom: -hh, zoom: 1 });
    this.ortho.updateProjectionMatrix();
    const cx = this.room.width / 2, cz = this.room.length / 2;
    this.planControls.target.set(cx, 0, cz); this.ortho.position.set(cx, 20, cz); this.planControls.update();
  }

  /** viewport rect (CSS px) occupied by the photo in AR mode (object-fit: contain) */
  arRect() {
    const W = this.el.clientWidth, H = this.el.clientHeight;
    if (!this.cal?.ok) return { x: 0, y: 0, w: W, h: H };
    const a = this.cal.imgW / this.cal.imgH;
    let w = W, h = W / a; if (h > H) { h = H; w = H * a; }
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h); this.labels.setSize(w, h);
    this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
    this.walk.resize(w, h);
    if (this.mode === 'plan') this.fitPlan();
    const rc = this.arRect();
    this.el.style.setProperty('--ar-x', rc.x + 'px'); this.el.style.setProperty('--ar-y', rc.y + 'px');
    this.el.style.setProperty('--ar-w', rc.w + 'px'); this.el.style.setProperty('--ar-h', rc.h + 'px');
  }

  activeCamera() {
    return { orbit: this.cam, plan: this.ortho, walk: this.walk.camera, ar: this.arCam }[this.mode];
  }

  // ---------------------------------------------------------------- interaction
  ndc(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (this.mode === 'ar') {
      const rc = this.arRect();
      return new THREE.Vector2(((e.clientX - rect.left - rc.x) / rc.w) * 2 - 1, -((e.clientY - rect.top - rc.y) / rc.h) * 2 + 1);
    }
    return new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }
  floorPoint(e) {
    this.raycaster.setFromCamera(this.ndc(e), this.activeCamera());
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.floorPlane, p) ? p : null;
  }
  pick(e) {
    this.raycaster.setFromCamera(this.ndc(e), this.activeCamera());
    const hits = this.raycaster.intersectObjects([...this.meshes.values()], true);
    return hits.length ? hits[0].object.userData.itemId : null;
  }

  bindPointer() {
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => {
      if (this.mode === 'walk') { if (!this.walk.controls.isLocked) this.walk.controls.lock(); return; }
      if (e.button !== 0) return;
      const id = this.pick(e);
      this.on.select?.(id);
      if (!id) return;
      const it = this.items.find((i) => i.id === id);
      if (!it || it.locked) return;
      const p = this.floorPoint(e); if (!p) return;
      this.drag = { id, dx: it.x - p.x, dz: it.z - p.z, moved: false };
      this.controls.enabled = false; this.planControls.enabled = false;
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (this.mode === 'walk') return;
      if (!this.drag) { dom.style.cursor = this.pick(e) ? 'grab' : ''; return; }
      const p = this.floorPoint(e); if (!p) return;
      dom.style.cursor = 'grabbing';
      let x = p.x + this.drag.dx, z = p.z + this.drag.dz;
      if (!e.altKey) { x = Math.round(x / 0.05) * 0.05; z = Math.round(z / 0.05) * 0.05; }
      this.drag.moved = true;
      this.on.move?.(this.drag.id, x, z, e.altKey);
    });
    const end = (e) => {
      if (!this.drag) return;
      const d = this.drag; this.drag = null;
      this.controls.enabled = this.mode === 'orbit'; this.planControls.enabled = this.mode === 'plan';
      dom.releasePointerCapture?.(e.pointerId);
      if (d.moved) this.on.moveEnd?.(d.id);
    };
    dom.addEventListener('pointerup', end); dom.addEventListener('pointercancel', end);
    this.el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    this.el.addEventListener('drop', (e) => {
      e.preventDefault();
      const type = e.dataTransfer.getData('text/furniture'); if (!type) return;
      const p = this.floorPoint(e);
      this.on.drop?.(type, p ? p.x : this.room.width / 2, p ? p.z : this.room.length / 2);
    });
  }

  // ---------------------------------------------------------------- loop
  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    for (const tw of this.tweens) {
      tw.t = Math.min(1, tw.t + dt / tw.dur); const k = ease(tw.t);
      tw.obj.position.set(tw.from.x + (tw.to.x - tw.from.x) * k, 0, tw.from.z + (tw.to.z - tw.from.z) * k);
      tw.obj.rotation.y = tw.from.rot + (tw.to.rot - tw.from.rot) * k;
      tw.obj.scale.setScalar(tw.from.s + (tw.to.s - tw.from.s) * k);
    }
    this.tweens = this.tweens.filter((t) => t.t < 1);
    this.overlays.tick(dt);
    if (!this.roomObj) return;
    const W = this.el.clientWidth, H = this.el.clientHeight;
    if (this.mode === 'orbit') { this.controls.update(); this.roomObj.setCutaway(this.cam.position, true); }
    else this.roomObj.setCutaway(this.cam.position, false);
    if (this.mode === 'plan') this.planControls.update();
    if (this.mode === 'walk') { this.walk.update(dt); this.on.walkTick?.(this.walk.camera); this.walk.render(this.scene); return; }
    if (this.mode === 'ar') {
      const rc = this.arRect();
      this.renderer.setScissorTest(true);
      this.renderer.setViewport(rc.x, H - rc.y - rc.h, rc.w, rc.h);
      this.renderer.setScissor(0, 0, W, H);
      this.renderer.clear();
      this.renderer.setScissor(rc.x, H - rc.y - rc.h, rc.w, rc.h);
      this.renderer.render(this.scene, this.arCam);
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, W, H);
      return;
    }
    const cam = this.activeCamera();
    this.renderer.render(this.scene, cam);
    if (this.mode === 'plan') this.labels.render(this.scene, cam);
  }

  screenshot() { return this.renderer.domElement.toDataURL('image/png'); }
}
