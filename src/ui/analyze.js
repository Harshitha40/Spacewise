// Step 2 review: relabel or delete detections, and draw boxes for furniture the detector missed.
import { state } from '../state.js';
import { CATALOG, CATEGORIES, makeItem } from '../core/catalog.js';
import { crop } from '../vision/detector.js';
import { inferRoomType } from '../vision/interpret.js';

const $ = (s) => document.querySelector(s);
const MIN_BOX = 12; // px in photo space; smaller drags are treated as clicks
let selected = null;
let drawing = false;
let lastType = 'sofa';
let manualSeq = 0;

const TYPE_OPTIONS = CATEGORIES.map((cat) => {
  const opts = Object.entries(CATALOG).filter(([, c]) => c.category === cat)
    .map(([k, c]) => `<option value="${k}">${c.label}</option>`).join('');
  return `<optgroup label="${cat}">${opts}</optgroup>`;
}).join('');

export function initAnalyzeEditor() {
  $('#drawBox').onclick = () => setDrawing(!drawing);
  $('#boxes').addEventListener('pointerdown', onPointerDown);
  addEventListener('keydown', (e) => {
    if (state.step !== 'analyze' || e.target.closest('input, select, textarea')) return;
    if (e.key === 'Escape') setDrawing(false);
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); removeDetection(selected); }
    if (e.key === 'b' || e.key === 'B') setDrawing(!drawing);
  });
}

export function resetAnalyzeEditor() {
  selected = null;
  setDrawing(false);
}

function setDrawing(on) {
  drawing = on;
  $('#analyzeWrap').classList.toggle('drawing', on);
  $('#drawBox').classList.toggle('active', on);
  $('#drawBox').textContent = on ? 'Drag on the photo… (Esc to cancel)' : '+ Draw a missing item';
}

export function renderDetections({ animate = false } = {}) {
  const W = state.photo.w, H = state.photo.h;
  const boxes = $('#boxes'), list = $('#detList');
  list.classList.toggle('still', !animate);
  boxes.classList.toggle('still', !animate);
  boxes.querySelectorAll('.bbox').forEach((b) => b.remove());
  list.innerHTML = '';
  // smaller boxes stack on top so a box nested inside a bigger one stays clickable
  const bySize = [...state.detections].sort((a, b) => b.bbox[2] * b.bbox[3] - a.bbox[2] * a.bbox[3]);
  state.detections.forEach((d, i) => {
    const [x, y, w, h] = d.bbox;
    const manual = d.cls === 'manual';
    const conf = manual ? 'yours' : `${Math.round(d.score * 100)}%`;
    const b = document.createElement('div');
    b.className = `bbox${manual ? ' manual' : ''}${d.id === selected ? ' sel' : ''}`;
    b.dataset.id = d.id;
    Object.assign(b.style, { left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%`, width: `${(w / W) * 100}%`, height: `${(h / H) * 100}%`, animationDelay: `${i * 60}ms`, zIndex: 1 + bySize.indexOf(d) });
    b.innerHTML = `<span>${CATALOG[d.type].label} · ${conf}</span>`;
    boxes.append(b);

    const row = document.createElement('div');
    row.className = `det${d.id === selected ? ' sel' : ''}`;
    row.dataset.id = d.id;
    row.style.animationDelay = `${i * 60}ms`;
    const note = manual ? 'Drawn by you' : `COCO: ${d.cls}${d.why ? ` · ${d.why}` : ''}`;
    row.innerHTML = `<img src="${d.thumb}" alt=""><div class="det-body"><select aria-label="Furniture type">${TYPE_OPTIONS}</select><small>${note}</small></div><span class="conf">${conf}</span><button class="icon-btn det-del" title="Remove (Del)" aria-label="Remove">×</button>`;
    const sel = row.querySelector('select');
    sel.value = d.type;
    sel.onchange = () => retype(d, sel.value);
    sel.onfocus = () => select(d.id, false);
    row.querySelector('.det-del').onclick = (e) => { e.stopPropagation(); removeDetection(d.id); };
    row.onclick = (e) => { if (!e.target.closest('select')) select(d.id, false); };
    row.onmouseenter = () => b.classList.add('hover');
    row.onmouseleave = () => b.classList.remove('hover');
    list.append(row);
  });
  if (!state.detections.length) list.innerHTML = '<p class="muted small">No furniture listed yet. Use <b>Draw a missing item</b> to add each piece.</p>';
  state.roomType = inferRoomType(state.detections.map((d) => d.type));
  $('#roomType').innerHTML = `<small>Detected room type</small>${state.roomType}`;
  $('#detCount').textContent = `${state.detections.length} item${state.detections.length === 1 ? '' : 's'}`;
}

function select(id, scrollRow = true) {
  selected = id;
  document.querySelectorAll('#boxes .bbox, #detList .det').forEach((el) => el.classList.toggle('sel', el.dataset.id === id));
  if (scrollRow) document.querySelector(`#detList .det[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function retype(d, type) {
  d.type = type;
  lastType = type;
  const i = state.items.findIndex((it) => it.det === d.id);
  // new type → its catalogue dimensions; the old ones belonged to a different object
  if (i >= 0) state.items[i] = makeItem(type, { id: state.items[i].id, det: d.id });
  renderDetections();
}

function removeDetection(id) {
  state.detections = state.detections.filter((d) => d.id !== id);
  state.items = state.items.filter((it) => it.det !== id);
  if (selected === id) selected = null;
  renderDetections();
}

function addManual(bbox) {
  const d = { id: `m${++manualSeq}`, cls: 'manual', type: lastType, score: 1, bbox, why: '', thumb: crop(state.photo.el, bbox) };
  state.detections.unshift(d);
  state.items.push(makeItem(d.type, { det: d.id }));
  selected = d.id;
  renderDetections();
  const sel = document.querySelector(`#detList .det[data-id="${d.id}"] select`);
  sel?.scrollIntoView({ block: 'nearest' });
  sel?.focus();
}

function toPhoto(e) {
  const r = $('#analyzeImg').getBoundingClientRect();
  return [
    Math.min(state.photo.w, Math.max(0, ((e.clientX - r.left) / r.width) * state.photo.w)),
    Math.min(state.photo.h, Math.max(0, ((e.clientY - r.top) / r.height) * state.photo.h)),
  ];
}

function onPointerDown(e) {
  if (!state.photo || e.button !== 0) return;
  if (!drawing) {
    const hit = e.target.closest('.bbox');
    if (hit) select(hit.dataset.id);
    return;
  }
  e.preventDefault();
  const layer = $('#boxes');
  layer.setPointerCapture(e.pointerId);
  const [x0, y0] = toPhoto(e);
  const ghost = document.createElement('div');
  ghost.className = 'bbox manual drawing-box';
  layer.append(ghost);
  let box = [x0, y0, 0, 0];
  const move = (ev) => {
    const [x1, y1] = toPhoto(ev);
    box = [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)];
    Object.assign(ghost.style, {
      left: `${(box[0] / state.photo.w) * 100}%`, top: `${(box[1] / state.photo.h) * 100}%`,
      width: `${(box[2] / state.photo.w) * 100}%`, height: `${(box[3] / state.photo.h) * 100}%`,
    });
  };
  const up = () => {
    layer.removeEventListener('pointermove', move);
    layer.removeEventListener('pointerup', up);
    layer.removeEventListener('pointercancel', up);
    ghost.remove();
    setDrawing(false);
    if (box[2] >= MIN_BOX && box[3] >= MIN_BOX) addManual(box.map(Math.round));
  };
  layer.addEventListener('pointermove', move);
  layer.addEventListener('pointerup', up);
  layer.addEventListener('pointercancel', up);
}
