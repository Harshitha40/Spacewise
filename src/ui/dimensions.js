// Step 3 — dimensions: room size, openings, per-item sizes, photo calibration.
import { state } from '../state.js';
import { CATALOG, makeItem } from '../core/catalog.js';
import { roomUnit, itemUnit, toRoomUnit, fromRoomUnit, toItemUnit, fromItemUnit, fmtArea, round } from '../core/units.js';
import { calibrate, projectPoint, pixelToFloor } from '../core/homography.js';
import { drawIcon } from './planDraw.js';
import { greedyPlace, legalize, rng } from '../engine/optimizer.js';
import { wallLength, rotFacingAway, WALLS, wallPoint } from '../engine/geometry.js';

const $ = (s) => document.querySelector(s);
export const WALL_NAMES = { N: 'Back wall', S: 'Front wall', E: 'Left wall', W: 'Right wall' };

function numField(label, valueM, kind, onChange, step) {
  const sys = state.units;
  const v = kind === 'room' ? toRoomUnit(valueM, sys) : toItemUnit(valueM, sys);
  const u = kind === 'room' ? roomUnit(sys) : itemUnit(sys);
  const el = document.createElement('label'); el.className = 'field';
  el.innerHTML = `<span>${label} <span class="unit">${u}</span></span><input type="number" min="0" step="${step ?? (kind === 'room' ? 0.1 : 1)}" value="${round(v, kind === 'room' ? 2 : 0)}">`;
  el.querySelector('input').addEventListener('input', (e) => {
    const n = parseFloat(e.target.value); if (!isFinite(n) || n <= 0) return;
    onChange(kind === 'room' ? fromRoomUnit(n, sys) : fromItemUnit(n, sys));
  });
  return el;
}

export function renderDimensions() {
  renderUnits(); renderRoomForm(); renderOpenings(); renderItems(); initCalibration();
}

function renderUnits() {
  document.querySelectorAll('#unitSeg button').forEach((b) => {
    b.classList.toggle('on', b.dataset.units === state.units);
    b.onclick = () => { state.units = b.dataset.units; renderDimensions(); };
  });
}

function updateArea() {
  $('#areaPill').innerHTML = `${state.roomType} · <b>${fmtArea(state.room.width * state.room.length, state.units)}</b> · ${state.items.length} items`;
}

function renderRoomForm() {
  const f = $('#roomForm'); f.innerHTML = '';
  const grid = document.createElement('div'); grid.className = 'fgrid';
  const r = state.room;
  grid.append(
    numField('Width', r.width, 'room', (v) => { r.width = v; updateArea(); redrawCalib(); }),
    numField('Length', r.length, 'room', (v) => { r.length = v; updateArea(); redrawCalib(); }),
    numField('Ceiling', r.height, 'room', (v) => { r.height = v; redrawCalib(); }),
  );
  f.append(grid);
  const hint = document.createElement('p'); hint.className = 'muted small';
  hint.textContent = 'Width runs along the back wall (the wall facing the camera); length runs from the front wall to the back wall.';
  f.append(hint);
  updateArea();
}

function wallSelect(value, onChange) {
  const s = document.createElement('select');
  s.innerHTML = WALLS.map((w) => `<option value="${w}" ${w === value ? 'selected' : ''}>${WALL_NAMES[w]}</option>`).join('');
  s.onchange = () => onChange(s.value);
  return s;
}

function renderOpenings() {
  const mk = (list, el, kind) => {
    el.innerHTML = '';
    list.forEach((o, i) => {
      const card = document.createElement('div'); card.className = 'opening';
      const head = document.createElement('div'); head.className = 'row';
      head.append(wallSelect(o.wall, (w) => { o.wall = w; o.offset = Math.min(o.offset, wallLength(state.room, w) - o.width); }));
      const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕'; x.onclick = () => { list.splice(i, 1); renderOpenings(); };
      head.append(x); card.append(head);
      const g = document.createElement('div'); g.className = 'fgrid';
      g.append(numField('Offset', o.offset, 'room', (v) => (o.offset = v)), numField('Width', o.width, 'room', (v) => (o.width = v)));
      if (kind === 'window') g.append(numField('Sill', o.sill, 'room', (v) => (o.sill = v)), numField('Height', o.height, 'room', (v) => (o.height = v)));
      card.append(g); el.append(card);
    });
  };
  mk(state.room.doors, $('#doorList'), 'door');
  mk(state.room.windows, $('#windowList'), 'window');
  $('#addDoor').onclick = () => { state.room.doors.push({ wall: 'S', offset: 0.3, width: 0.85 }); renderOpenings(); };
  $('#addWindow').onclick = () => { state.room.windows.push({ wall: 'N', offset: 1.0, width: 1.2, sill: 0.9, height: 1.2 }); renderOpenings(); };
}

function renderItems() {
  const el = $('#itemCards'); el.innerHTML = '';
  $('#itemCount').textContent = `(${state.items.length})`;
  const sel = $('#addType');
  sel.innerHTML = Object.entries(CATALOG).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join('');
  $('#addItem').onclick = () => { state.items.push(makeItem(sel.value)); renderItems(); updateArea(); };
  state.items.forEach((it, idx) => {
    const c = CATALOG[it.type];
    const card = document.createElement('div'); card.className = 'icard';
    card.style.animationDelay = `${idx * 30}ms`;
    const head = document.createElement('div'); head.className = 'icard-head';
    const det = state.detections.find((d) => d.id === it.det);
    if (det) { const img = document.createElement('img'); img.src = det.thumb; head.append(img); }
    else { const cv = document.createElement('canvas'); cv.width = 52; cv.height = 52; head.append(cv); requestAnimationFrame(() => drawIcon(cv, it.type)); }
    const ts = document.createElement('select');
    ts.innerHTML = Object.entries(CATALOG).map(([k, cc]) => `<option value="${k}" ${k === it.type ? 'selected' : ''}>${cc.label}</option>`).join('');
    ts.onchange = () => { const n = CATALOG[ts.value]; Object.assign(it, { type: ts.value, w: n.w, d: n.d, h: n.h }); renderItems(); };
    const src = document.createElement('span'); src.className = 'src' + (det ? '' : ' manual'); src.textContent = det ? `AI ${Math.round(det.score * 100)}%` : 'manual';
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕';
    x.onclick = () => { state.items.splice(idx, 1); renderItems(); updateArea(); };
    head.append(ts, src, x); card.append(head);
    if (c.presets) {
      const pr = document.createElement('div'); pr.className = 'presets';
      for (const [name, [w, d]] of Object.entries(c.presets)) {
        const b = document.createElement('button'); b.textContent = name;
        if (Math.abs(it.w - w) < 0.01 && Math.abs(it.d - d) < 0.01) b.classList.add('on');
        b.onclick = () => { it.w = w; it.d = d; renderItems(); };
        pr.append(b);
      }
      card.append(pr);
    }
    const labels = c.dimLabels || ['Width', 'Depth', 'Height'];
    const g = document.createElement('div'); g.className = 'fgrid';
    g.append(numField(labels[0], it.w, 'item', (v) => (it.w = v)), numField(labels[1], it.d, 'item', (v) => (it.d = v)), numField(labels[2], it.h, 'item', (v) => (it.h = v)));
    card.append(g);
    el.append(card);
  });
}

// ---------------------------------------------------------------- calibration
let drag = -1;
function defaultCalib() {
  const p = state.photo;
  return { img: [[p.w * 0.28, p.h * 0.42], [p.w * 0.72, p.h * 0.42], [p.w * 0.95, p.h * 0.9], [p.w * 0.05, p.h * 0.9]], depth: Math.min(2.0, state.room.length * 0.6) };
}
export function calibPlanPoints() {
  const { width: W, length: L } = state.room, d = Math.min(state.calib.depth, L);
  // photo looks at the back wall (N): photo-left = E wall (x = W), photo-right = W wall (x = 0)
  return [[W, L], [0, L], [0, L - d], [W, L - d]];
}
export function runCalibration() {
  if (!state.photo || !state.calib) { state.calibration = null; return null; }
  state.calibration = calibrate(calibPlanPoints(), state.calib.img, state.photo.w, state.photo.h);
  return state.calibration;
}

function initCalibration() {
  const stage = $('#calibStage'), img = $('#calibImg'), cv = $('#calibCanvas');
  if (!state.photo) {
    stage.classList.add('empty'); img.removeAttribute('src'); cv.style.display = 'none';
    stage.dataset.msg = '';
    $('#calibStatus').className = 'calib-status';
    $('#calibStatus').textContent = 'No photo — AR overlay is unavailable for sample rooms. Everything else works.';
    $('#calibDepth').disabled = true;
    return;
  }
  stage.classList.remove('empty'); cv.style.display = '';
  $('#calibDepth').disabled = false;
  state.calib ||= defaultCalib();
  img.src = state.photo.url;
  img.onload = redrawCalib;
  const depth = $('#calibDepth');
  depth.value = round(toRoomUnit(state.calib.depth, state.units), 2);
  $('#calibDepthUnit').textContent = roomUnit(state.units);
  depth.oninput = () => { const v = parseFloat(depth.value); if (v > 0) { state.calib.depth = fromRoomUnit(v, state.units); redrawCalib(); } };
  const toImg = (e) => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * state.photo.w, ((e.clientY - r.top) / r.height) * state.photo.h]; };
  cv.onpointerdown = (e) => {
    const p = toImg(e); const r = cv.getBoundingClientRect(); const tol = (18 / r.width) * state.photo.w;
    drag = state.calib.img.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < tol);
    if (drag >= 0) cv.setPointerCapture(e.pointerId);
  };
  cv.onpointermove = (e) => { if (drag < 0) return; state.calib.img[drag] = toImg(e); redrawCalib(); };
  cv.onpointerup = () => { drag = -1; };
  if (img.complete) redrawCalib();
}

export function redrawCalib() {
  const cv = $('#calibCanvas'), img = $('#calibImg');
  if (!state.photo || !img.clientWidth) return;
  cv.width = img.clientWidth * 2; cv.height = img.clientHeight * 2;
  const g = cv.getContext('2d'); const k = cv.width / state.photo.w;
  g.clearRect(0, 0, cv.width, cv.height);
  const cal = runCalibration();
  const st = $('#calibStatus');
  if (cal?.ok) {
    const W = state.room.width, L = state.room.length, H = state.room.height;
    const line = (a, b, color, w = 2) => {
      const pa = projectPoint(cal, a), pb = projectPoint(cal, b); if (!pa || !pb) return;
      g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.moveTo(pa[0] * k, pa[1] * k); g.lineTo(pb[0] * k, pb[1] * k); g.stroke();
    };
    for (let x = 0; x <= W + 1e-6; x += 0.5) line([x, 0, Math.max(0, L - 4)], [x, 0, L], 'rgba(34,211,238,0.35)', 1.5);
    for (let z = L; z >= Math.max(0, L - 4) - 1e-6; z -= 0.5) line([0, 0, z], [W, 0, z], 'rgba(34,211,238,0.35)', 1.5);
    line([0, 0, L], [0, H, L], 'rgba(139,92,246,0.9)', 3); line([W, 0, L], [W, H, L], 'rgba(139,92,246,0.9)', 3);
    line([0, H, L], [W, H, L], 'rgba(139,92,246,0.9)', 3);
    st.className = 'calib-status ok';
    st.innerHTML = `✓ Camera recovered — height <b>${toRoomUnit(cal.position[1], state.units).toFixed(1)} ${roomUnit(state.units)}</b>, vertical FOV <b>${cal.fovY.toFixed(0)}°</b>${cal.estimatedFocal ? '' : ' (assumed)'}. The purple frame should line up with the back wall's corners and ceiling.`;
  } else {
    st.className = 'calib-status bad'; st.textContent = cal?.error || 'Place the pins to calibrate.';
  }
  // quad + pins
  const pts = state.calib.img.map(([u, v]) => [u * k, v * k]);
  g.fillStyle = 'rgba(139,92,246,0.14)'; g.strokeStyle = '#a78bfa'; g.lineWidth = 2.5;
  g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p))); g.closePath(); g.fill(); g.stroke();
  pts.forEach((p, i) => {
    g.fillStyle = '#8b5cf6'; g.beginPath(); g.arc(p[0], p[1], 15, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'white'; g.lineWidth = 3; g.stroke();
    g.fillStyle = 'white'; g.font = 'bold 15px Inter'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ABCD'[i], p[0], p[1] + 1);
  });
}

// ---------------------------------------------------------------- placement
/** Place unplaced items: from the photo (calibrated) or by greedy layout. */
export function placeItems() {
  const room = state.room;
  const pending = state.items.filter((it) => !it.placed);
  if (!pending.length) return;
  const cal = state.calibration;
  const usePhoto = cal?.ok && $('#useDetPos').checked;
  const r = rng(42);
  const fromPhoto = [];
  for (const it of pending) {
    const det = state.detections.find((d) => d.id === it.det);
    if (usePhoto && det) {
      const [bx, by, bw, bh] = det.bbox;
      let [x, z] = pixelToFloor(cal, bx + bw / 2, by + bh * 0.97);
      const dx = x - cal.position[0], dz = z - cal.position[2], n = Math.hypot(dx, dz) || 1;
      x += (dx / n) * it.d / 2; z += (dz / n) * it.d / 2;
      it.x = x; it.z = z;
      it.rot = Math.atan2(-dx, -dz); // face the camera
      if (CATALOG[it.type].wall === 'back') snapNearestWall(room, it);
      it.x = Math.min(Math.max(it.x, 0.1), room.width - 0.1); it.z = Math.min(Math.max(it.z, 0.1), room.length - 0.1);
      fromPhoto.push(it);
    }
  }
  const rest = pending.filter((it) => !fromPhoto.includes(it));
  if (rest.length) {
    const placed = state.items.filter((it) => it.placed || fromPhoto.includes(it)).map((it) => ({ ...it, locked: true }));
    const out = greedyPlace(room, [...placed, ...rest.map((it) => ({ ...it }))], r, { samples: 60 });
    rest.forEach((it, i) => Object.assign(it, { x: out[placed.length + i].x, z: out[placed.length + i].z, rot: out[placed.length + i].rot }));
  }
  // photo projections are approximate: square items up and pull them out of each other,
  // leaving anything the user already placed where it is
  legalize(room, state.items.map((it) => (pending.includes(it) ? it : { ...it, locked: true })), r);
  pending.forEach((it) => (it.placed = true));
}

function snapNearestWall(room, it) {
  const d = { S: it.z, N: room.length - it.z, W: it.x, E: room.width - it.x };
  const w = Object.keys(d).sort((a, b) => d[a] - d[b])[0];
  if (d[w] > 1.2) return;
  it.rot = rotFacingAway(w);
  const t = w === 'S' || w === 'N' ? it.x : it.z;
  const [x, z] = wallPoint(room, w, Math.min(Math.max(t, it.w / 2), wallLength(room, w) - it.w / 2), it.d / 2 + 0.01);
  it.x = x; it.z = z;
}
