// Step 4 — interactive design studio.
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { state, history } from '../state.js';
import { CATALOG, CATEGORIES, makeItem } from '../core/catalog.js';
import { itemUnit, toItemUnit, fromItemUnit, round, fmtArea } from '../core/units.js';
import { Viewer } from '../scene/viewer.js';
import { PERSONAS } from '../scene/walkthrough.js';
import { drawPlan, drawIcon } from './planDraw.js';
import { inpaintBoxes } from '../vision/detector.js';
import { normAngle, wallLength, rotFacingAway, wallPoint } from '../engine/geometry.js';
import { greedyPlace, rng } from '../engine/optimizer.js';
import { toast } from './toast.js';

const $ = (s) => document.querySelector(s);
let viewer, engine, inited = false, dragTimer = 0, preview = null, diminishedUrl = null;

const project = () => ({ room: state.room, items: preview ? preview.items : state.items });

export function initDesign(eng) {
  engine = eng;
  if (inited) return;
  inited = true;
  viewer = new Viewer($('#viewport'));
  viewer.on.select = (id) => select(id);
  viewer.on.move = (id, x, z, free) => {
    if (preview) return;
    const it = state.items.find((i) => i.id === id); if (!it) return;
    if (!dragTimer) history.push();
    if (!free && CATALOG[it.type].wall === 'back') [x, z] = wallMagnet(it, x, z);
    it.x = x; it.z = z;
    viewer.setItems(state.items);
    clearTimeout(dragTimer); dragTimer = setTimeout(() => (dragTimer = 0), 400);
    throttledAnalyze();
  };
  viewer.on.moveEnd = () => { dragTimer = 0; analyze(); };
  viewer.on.drop = (type, x, z) => addItem(type, x, z);
  viewer.on.walkLock = (locked) => $('#walkHint').classList.toggle('hidden', locked);
  let mmT = 0;
  viewer.on.walkTick = (cam) => {
    if (performance.now() - mmT < 60) return; mmT = performance.now();
    const d = cam.getWorldDirection(cam.position.clone());
    drawPlan($('#minimap'), state.room, state.items, { pad: 8, report: state.report, player: { x: cam.position.x, z: cam.position.z, dx: d.x, dz: d.z } });
  };

  // toolbar
  document.querySelectorAll('#viewSeg button').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  document.querySelectorAll('#toggles button').forEach((b) => (b.onclick = () => { state.toggles[b.dataset.t] = !state.toggles[b.dataset.t]; syncToggles(); refreshOverlays(); }));
  $('#btnUndo').onclick = undo; $('#btnRedo').onclick = redo;
  $('#btnShot').onclick = () => { const a = document.createElement('a'); a.href = viewer.screenshot(); a.download = 'layoutlens.png'; a.click(); };
  $('#sunHour').value = state.hour;
  const sun = () => { state.hour = +$('#sunHour').value; const h = Math.floor(state.hour), m = Math.round((state.hour - h) * 60); $('#sunLabel').textContent = `${h}:${String(m).padStart(2, '0')}`; viewer.setSun(state.hour, state.north); };
  $('#sunHour').oninput = sun; sun();
  $('#northSel').onchange = () => { state.north = $('#northSel').value; viewer.setSun(state.hour, state.north); };
  $('#catSearch').oninput = renderCatalog;
  $('#btnOptimize').onclick = optimize;

  // walkthrough HUD
  $('#personaSeg').innerHTML = Object.entries(PERSONAS).map(([k, p]) => `<button data-p="${k}">${p.label}</button>`).join('');
  document.querySelectorAll('#personaSeg button').forEach((b) => (b.onclick = () => { viewer.walk.setPersona(b.dataset.p); syncHud(); }));
  document.querySelectorAll('#stereoSeg button').forEach((b) => (b.onclick = () => { viewer.walk.stereo = b.dataset.stereo; syncHud(); }));
  $('#xrSlot').append(VRButton.createButton(viewer.renderer));
  viewer.renderer.xr.addEventListener('sessionstart', () => { if (state.view !== 'walk') setView('walk'); });

  // AR HUD
  $('#arDiminish').onchange = applyARBackground;
  $('#arCompare').oninput = () => { viewer.renderer.domElement.style.clipPath = `inset(0 0 0 ${$('#arCompare').value}%)`; };
  $('#arOpacity').oninput = () => { viewer.renderer.domElement.style.opacity = $('#arOpacity').value / 100; };

  addEventListener('keydown', onKey);
  syncToggles(); syncHud(); renderCatalog();
}

export function enterDesign() {
  preview = null; state.suggestions = null;
  viewer.setRoom(state.room);
  viewer.setItems(state.items, { animate: true });
  viewer.setCalibration(state.calibration, state.photo?.url);
  diminishedUrl = null;
  applyARBackground();
  $('#suggestions').innerHTML = ''; $('#optMeta').textContent = '';
  setView(state.view);
  analyze();
  requestAnimationFrame(() => viewer.resize());
}

// ---------------------------------------------------------------- analysis
let lastAnalyze = 0, pendingAnalyze = 0;
function throttledAnalyze() {
  const now = performance.now();
  if (now - lastAnalyze > 90) analyze();
  else { clearTimeout(pendingAnalyze); pendingAnalyze = setTimeout(analyze, 100); }
}
function analyze() {
  lastAnalyze = performance.now();
  const t0 = performance.now();
  state.report = engine.analyze(project());
  state.report.ms = performance.now() - t0;
  refreshOverlays();
  renderScore(); renderIssues(); renderRoomItems(); renderInspector();
  $('#btnUndo').disabled = !history.canUndo; $('#btnRedo').disabled = !history.canRedo;
}
function refreshOverlays() { viewer.updateOverlays(state.report, state.toggles); }

function scoreColor(s) { return s >= 80 ? '#2ee6a6' : s >= 60 ? '#ffd23f' : s >= 40 ? '#ffb020' : '#ff3b5c'; }
function renderScore() {
  const r = state.report, s = r.scores;
  $('#scoreVal').textContent = s.total;
  const arc = $('#scoreArc'); arc.style.strokeDashoffset = 326.7 * (1 - s.total / 100); arc.style.stroke = scoreColor(s.total);
  const cats = [['safety', 'Safety'], ['circulation', 'Circulation'], ['function', 'Function'], ['comfort', 'Light & views']];
  $('#catBars').innerHTML = cats.map(([k, l]) => `<div class="cb"><div><span>${l}</span><b>${s[k]}</b></div><div class="track"><div class="fill" style="width:${s[k]}%;background:${scoreColor(s[k])}"></div></div></div>`).join('');
  const st = r.stats;
  $('#stats').innerHTML = `
    <div class="stat" title="Reachable walking area relative to the empty room"><b>${Math.round(st.usable * 100)}%</b><small>Walkable</small></div>
    <div class="stat" title="Mean daylight factor at desk height (uniform sky)"><b>${(st.meanDF * 100).toFixed(1)}%</b><small>Daylight factor</small></div>
    <div class="stat" title="Floor area with daylight factor ≥ 2%"><b>${Math.round(st.litFraction * 100)}%</b><small>Well-lit area</small></div>`;
}

function renderIssues() {
  const list = state.report.issues;
  $('#issueCount').textContent = list.length ? `${list.length}` : '';
  const el = $('#issues');
  if (!list.length) { el.innerHTML = `<div class="all-good"><b>✓ No issues found</b>This layout is collision-free, walkable and well arranged.</div>`; return; }
  el.innerHTML = '';
  list.slice(0, 40).forEach((iss, i) => {
    const d = document.createElement('div'); d.className = `issue ${iss.severity}`; d.style.animationDelay = `${i * 25}ms`;
    d.innerHTML = `<i>${iss.severity === 'error' ? '!' : iss.severity === 'warn' ? '▲' : 'i'}</i><span>${iss.msg}</span>`;
    d.onclick = () => iss.items[0] && select(iss.items[0]);
    el.append(d);
  });
}

function renderRoomItems() {
  const el = $('#roomItems'); el.innerHTML = '';
  const items = project().items;
  $('#roomItemsCount').textContent = `${items.length} items · ${fmtArea(state.room.width * state.room.length, state.units)}`;
  for (const it of items) {
    const f = state.report?.flags[it.id] || {};
    const cls = f.collision ? 'collision' : f.blocking ? 'blocking' : f.warn ? 'warn' : '';
    const row = document.createElement('div'); row.className = 'ri' + (state.selected === it.id ? ' sel' : '');
    row.innerHTML = `<i class="sw ${cls}"></i><span>${CATALOG[it.type].label}</span><small>${round(toItemUnit(it.w, state.units), 0)}×${round(toItemUnit(it.d, state.units), 0)}</small><button title="${it.locked ? 'Unlock' : 'Lock (optimiser keeps it in place)'}">${it.locked ? '🔒' : '🔓'}</button>`;
    row.onclick = () => select(it.id);
    row.querySelector('button').onclick = (e) => { e.stopPropagation(); if (preview) return; it.locked = !it.locked; renderRoomItems(); renderInspector(); };
    el.append(row);
  }
}

// ---------------------------------------------------------------- catalog / items
function renderCatalog() {
  const q = ($('#catSearch').value || '').toLowerCase();
  const el = $('#catalog'); el.innerHTML = '';
  for (const cat of CATEGORIES) {
    const types = Object.entries(CATALOG).filter(([k, c]) => c.category === cat && (!q || c.label.toLowerCase().includes(q)));
    if (!types.length) continue;
    const h = document.createElement('div'); h.className = 'cat-group'; h.textContent = cat; el.append(h);
    for (const [k, c] of types) {
      const d = document.createElement('div'); d.className = 'cat-item'; d.draggable = true; d.title = `${c.label} — drag into the room or click to add`;
      const cv = document.createElement('canvas'); d.append(cv);
      const s = document.createElement('span'); s.textContent = c.label; d.append(s);
      d.ondragstart = (e) => { e.dataTransfer.setData('text/furniture', k); e.dataTransfer.effectAllowed = 'copy'; };
      d.onclick = () => addItem(k);
      el.append(d);
      requestAnimationFrame(() => drawIcon(cv, k));
    }
  }
}

function addItem(type, x, z) {
  if (preview) discardPreview();
  history.push();
  const it = makeItem(type, { placed: true });
  if (x === undefined) {
    const out = greedyPlace(state.room, [...state.items.map((i) => ({ ...i, locked: true })), { ...it }], rng(Date.now() & 0xffff), { samples: 50 });
    Object.assign(it, { x: out[out.length - 1].x, z: out[out.length - 1].z, rot: out[out.length - 1].rot });
  } else {
    it.x = x; it.z = z;
    if (CATALOG[type].wall === 'back') { const near = nearestWall(it); if (near.d < 1.0) { it.rot = rotFacingAway(near.w); [it.x, it.z] = wallMagnet(it, x, z); } }
  }
  state.items.push(it);
  viewer.setItems(state.items, { animate: true });
  select(it.id);
  analyze();
  toast(`${CATALOG[type].label} added`);
}

function nearestWall(it) {
  const d = { S: it.z, N: state.room.length - it.z, W: it.x, E: state.room.width - it.x };
  const w = Object.keys(d).sort((a, b) => d[a] - d[b])[0];
  return { w, d: d[w] };
}
/** Snap the back of wall-standing items flush to the wall they face away from. */
function wallMagnet(it, x, z) {
  const tol = 0.15;
  const back = { S: 0, N: Math.PI, W: Math.PI / 2, E: -Math.PI / 2 };
  for (const [w, rot] of Object.entries(back)) {
    if (Math.abs(normAngle(it.rot - rot)) > 0.05) continue;
    const t = w === 'S' || w === 'N' ? x : z;
    const [wx, wz] = wallPoint(state.room, w, t, it.d / 2 + 0.01);
    if (Math.hypot(wx - x, wz - z) < tol) return [wx, wz];
  }
  return [x, z];
}

function select(id) {
  if (state.view === 'walk') return;
  state.selected = id; viewer.select(id); renderRoomItems(); renderInspector();
}

function renderInspector() {
  const el = $('#inspector');
  const it = project().items.find((i) => i.id === state.selected);
  if (!it || state.view === 'walk' || state.view === 'ar') { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const c = CATALOG[it.type], u = itemUnit(state.units), sys = state.units;
  const f = state.report?.flags[it.id] || {};
  const status = f.collision ? '<span style="color:var(--red)">● Colliding</span>' : f.blocking ? '<span style="color:var(--amber)">● Blocking a path</span>' : f.warn ? '<span style="color:#ffd23f">● Needs attention</span>' : '<span style="color:var(--green)">● OK</span>';
  el.innerHTML = `<h3>${c.label}<button class="x" id="insClose">✕</button></h3>
    <div class="small muted" style="margin:-4px 0 10px">${status}</div>
    <div class="fgrid">
      <label class="field"><span>W <span class="unit">${u}</span></span><input type="number" data-k="w" value="${round(toItemUnit(it.w, sys), 0)}"></label>
      <label class="field"><span>D <span class="unit">${u}</span></span><input type="number" data-k="d" value="${round(toItemUnit(it.d, sys), 0)}"></label>
      <label class="field"><span>H <span class="unit">${u}</span></span><input type="number" data-k="h" value="${round(toItemUnit(it.h, sys), 0)}"></label>
    </div>
    <div class="btns">
      <button class="mini" data-a="rl">⟲ 90°</button><button class="mini" data-a="rr">⟳ 90°</button>
      <button class="mini" data-a="lock">${it.locked ? '🔒 Locked' : '🔓 Lock'}</button>
    </div>
    <div class="btns"><button class="mini" data-a="dup">Duplicate</button><button class="mini" data-a="del" style="color:var(--red)">Delete</button></div>`;
  el.querySelector('#insClose').onclick = () => select(null);
  el.querySelectorAll('input[data-k]').forEach((inp) => (inp.onchange = () => {
    const v = parseFloat(inp.value); if (!(v > 0) || preview) return;
    history.push(); it[inp.dataset.k] = fromItemUnit(v, sys); viewer.setItems(state.items); analyze();
  }));
  el.querySelectorAll('button[data-a]').forEach((b) => (b.onclick = () => action(b.dataset.a)));
}

function action(a) {
  if (preview) { toast('Apply or discard the suggestion first'); return; }
  const it = state.items.find((i) => i.id === state.selected); if (!it) return;
  if (a === 'lock') { it.locked = !it.locked; renderInspector(); renderRoomItems(); return; }
  history.push();
  if (a === 'rl' || a === 'rr' || a === 'q' || a === 'e') it.rot = normAngle(it.rot + ({ rl: 1, rr: -1, q: 1 / 6, e: -1 / 6 }[a]) * Math.PI / 2);
  if (a === 'del') { state.items = state.items.filter((i) => i !== it); state.selected = null; viewer.select(null); }
  if (a === 'dup') { const n = makeItem(it.type, { ...it, id: undefined, placed: true, x: it.x + 0.3, z: it.z + 0.3 }); delete n.id; n.id = makeItem(it.type).id; state.items.push(n); state.selected = n.id; viewer.select(n.id); }
  viewer.setItems(state.items, { animate: a === 'rl' || a === 'rr' || a === 'dup' });
  analyze();
}

function undo() { if (preview) discardPreview(); if (history.undo()) { viewer.setItems(state.items, { animate: true }); analyze(); } }
function redo() { if (preview) discardPreview(); if (history.redo()) { viewer.setItems(state.items, { animate: true }); analyze(); } }

function onKey(e) {
  if (state.step !== 'design' || e.target.matches('input, select, textarea')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (state.view === 'walk') return;
  const k = e.key.toLowerCase();
  if (['1', '2', '3', '4'].includes(k)) { setView(['orbit', 'plan', 'walk', 'ar'][+k - 1]); return; }
  if (!state.selected) return;
  if (k === 'r') action('rr');
  else if (k === 'q') action('q');
  else if (k === 'e') action('e');
  else if (k === 'delete' || k === 'backspace') action('del');
  else if (k === 'escape') select(null);
}

// ---------------------------------------------------------------- views
function setView(v) {
  state.view = v;
  document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  const arOk = !!state.calibration?.ok;
  $('#arEmpty').classList.toggle('hidden', !(v === 'ar' && !arOk));
  $('#arHud').classList.toggle('hidden', !(v === 'ar' && arOk));
  $('#walkHud').classList.toggle('hidden', v !== 'walk');
  $('#kbdHint').classList.toggle('hidden', v === 'walk' || v === 'ar');
  $('#vpFloat').classList.toggle('hidden', v === 'walk');
  $('#sunBar').classList.toggle('hidden', v === 'ar');
  viewer.renderer.domElement.style.clipPath = v === 'ar' ? `inset(0 0 0 ${$('#arCompare').value}%)` : '';
  viewer.renderer.domElement.style.opacity = v === 'ar' ? $('#arOpacity').value / 100 : 1;
  viewer.setMode(v === 'ar' && !arOk ? 'orbit' : v);
  if (v === 'walk') { viewer.select(null); syncHud(); }
  else viewer.select(state.selected);
  renderInspector();
}

function syncToggles() { document.querySelectorAll('#toggles button').forEach((b) => b.classList.toggle('on', !!state.toggles[b.dataset.t])); }
function syncHud() {
  document.querySelectorAll('#personaSeg button').forEach((b) => b.classList.toggle('on', b.dataset.p === viewer.walk.persona));
  document.querySelectorAll('#stereoSeg button').forEach((b) => b.classList.toggle('on', b.dataset.stereo === viewer.walk.stereo));
}

function applyARBackground() {
  if (!state.photo) { viewer.setARBackground(null); return; }
  if ($('#arDiminish').checked && state.detections.length) {
    if (!diminishedUrl) diminishedUrl = inpaintBoxes(state.photo.el, state.items.map((it) => state.detections.find((d) => d.id === it.det)?.bbox).filter(Boolean));
    viewer.setARBackground(diminishedUrl);
  } else viewer.setARBackground(state.photo.url);
}

// ---------------------------------------------------------------- optimisation
async function optimize() {
  if (preview) discardPreview();
  if (!state.items.length) { toast('Add some furniture first'); return; }
  const btn = $('#btnOptimize'), bar = $('#optProgress');
  btn.disabled = true; bar.classList.remove('hidden'); bar.firstElementChild.style.width = '0%';
  $('#suggestions').innerHTML = ''; $('#optMeta').textContent = `Running parallel annealing chains on ${engine.threads ?? '?'} threads…`;
  try {
    const res = await engine.optimize({ room: state.room, items: state.items }, { restarts: 4 }, (p) => (bar.firstElementChild.style.width = `${Math.round(p * 100)}%`));
    state.suggestions = res.suggestions.sort((a, b) => b.report.scores.total - a.report.scores.total);
    $('#optMeta').textContent = `${res.chains} chains · ${res.threads} threads · ${(res.ms / 1000).toFixed(1)} s — click a layout to preview it`;
    renderSuggestions();
  } catch (e) {
    console.error(e); toast('Optimisation failed: ' + e.message, true);
  } finally {
    btn.disabled = false; setTimeout(() => bar.classList.add('hidden'), 400);
  }
}

function renderSuggestions() {
  const el = $('#suggestions'); el.innerHTML = '';
  const base = (preview ? state.baseReport : state.report)?.scores.total ?? 0;
  state.suggestions.forEach((s, i) => {
    const d = document.createElement('div'); d.className = 'sugg' + (preview?.index === i ? ' on' : ''); d.style.animationDelay = `${i * 70}ms`;
    const delta = s.report.scores.total - base;
    d.innerHTML = `<canvas></canvas><div><b>${s.label}<span class="sc">${s.report.scores.total}</span></b><small>${s.desc}</small>
      <span class="delta ${delta < 0 ? 'neg' : ''}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)} pts · ${s.report.issues.filter((x) => x.severity !== 'info').length} issues</span>
      ${preview?.index === i ? '<div class="sugg-actions"><button class="primary" data-a="apply">Apply</button><button class="ghost" data-a="discard">Discard</button></div>' : ''}</div>`;
    d.onclick = (e) => {
      const a = e.target.dataset?.a;
      if (a === 'apply') { e.stopPropagation(); applyPreview(); return; }
      if (a === 'discard') { e.stopPropagation(); discardPreview(); return; }
      showPreview(i);
    };
    el.append(d);
    requestAnimationFrame(() => drawPlan(d.querySelector('canvas'), state.room, s.items, { pad: 6, report: s.report }));
  });
}

function showPreview(i) {
  if (!preview) state.baseReport = state.report;
  preview = { index: i, items: state.suggestions[i].items.map((it) => ({ ...it })) };
  viewer.setItems(preview.items, { animate: true });
  analyze(); renderSuggestions();
  toast(`Previewing “${state.suggestions[i].label}” — Apply to keep it`);
}
function applyPreview() {
  history.push();
  state.items = preview.items.map((it) => ({ ...it, placed: true }));
  preview = null; state.suggestions = null; $('#suggestions').innerHTML = ''; $('#optMeta').textContent = '';
  viewer.setItems(state.items); analyze(); diminishedUrl = diminishedUrl; toast('Layout applied ✓');
}
function discardPreview() {
  preview = null; viewer.setItems(state.items, { animate: true }); analyze();
  if (state.suggestions) renderSuggestions();
}
