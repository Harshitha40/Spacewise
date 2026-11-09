import './styles.css';
import { state, history, serialize, defaultRoom } from './state.js';
import { makeItem } from './core/catalog.js';
import { detectFurniture, loadDetector } from './vision/detector.js';
import { renderDimensions, placeItems, runCalibration, redrawCalib } from './ui/dimensions.js';
import { initDesign, enterDesign } from './ui/design.js';
import { LocalEngine, RemoteEngine } from './engine/index.js';
import { SAMPLES } from './samples.js';
import { initAnalyzeEditor, renderDetections, resetAnalyzeEditor } from './ui/analyze.js';
import { toast } from './ui/toast.js';

const $ = (s) => document.querySelector(s);
const STEPS = ['upload', 'analyze', 'dimensions', 'design'];
let engine = new LocalEngine();

// Optional native engine: ?engine=http://localhost:8787
(async () => {
  const url = new URLSearchParams(location.search).get('engine');
  if (url) {
    const remote = new RemoteEngine(url);
    try { if (await remote.ping()) { engine = remote; toast('Connected to native C++ engine'); } } catch { toast('Native engine unreachable — using browser engine', true); }
  }
  $('#engineBadge').textContent = engine instanceof RemoteEngine ? 'native C++ engine' : `browser engine · ${engine.threads} threads`;
})();

function go(step) {
  if (step === 'analyze' && !state.photo) return;
  if (step === 'design' && state.step !== 'design') {
    placeItems();
    runCalibration();
  }
  state.step = step;
  document.querySelectorAll('.step').forEach((s) => s.classList.toggle('active', s.id === `step-${step}`));
  const idx = STEPS.indexOf(step);
  document.querySelectorAll('#stepper button').forEach((b) => {
    const i = STEPS.indexOf(b.dataset.step);
    b.classList.toggle('active', i === idx);
    b.classList.toggle('done', i < idx);
    b.disabled = (b.dataset.step === 'analyze' && !state.photo) || (i > idx && !state.reached?.has(b.dataset.step));
  });
  (state.reached ||= new Set()).add(step);
  if (step === 'dimensions') { renderDimensions(); requestAnimationFrame(redrawCalib); }
  if (step === 'design') { initDesign(engine); enterDesign(); }
}
document.querySelectorAll('#stepper button').forEach((b) => (b.onclick = () => go(b.dataset.step)));
document.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) go(g.dataset.goto); });
addEventListener('resize', () => state.step === 'dimensions' && redrawCalib());

// ---------------------------------------------------------------- upload
const dz = $('#dropzone');
$('#fileInput').onchange = (e) => e.target.files[0] && loadPhoto(e.target.files[0]);
dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) loadPhoto(f); });
// warm up the detector in the background so analysis starts instantly
setTimeout(() => loadDetector().catch(() => {}), 1500);

function loadPhoto(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      resetProject();
      state.photo = { url: reader.result, el: img, w: img.naturalWidth, h: img.naturalHeight, name: file.name };
      go('analyze');
      analyzePhoto();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function resetProject() {
  Object.assign(state, { photo: null, detections: [], items: [], calib: null, calibration: null, selected: null, report: null, suggestions: null, roomType: 'Room', room: defaultRoom(), reached: new Set() });
  history.clear();
}

async function analyzePhoto() {
  const img = $('#analyzeImg'); img.src = state.photo.url;
  $('#boxes').innerHTML = ''; $('#detList').innerHTML = ''; $('#roomType').innerHTML = ''; $('#detCount').textContent = '';
  $('#scanline').style.display = ''; $('#toDims').disabled = true; $('#drawBox').disabled = true;
  resetAnalyzeEditor();
  const status = (t) => ($('#analyzeStatus').innerHTML = `<span class="spinner"></span><span>${t}</span>`);
  status('Preparing…');
  try {
    const res = await detectFurniture(state.photo.el, status);
    state.detections = res.detections; state.roomType = res.roomType;
    state.items = res.detections.map((d) => makeItem(d.type, { det: d.id }));
    $('#analyzeStatus').innerHTML = `<span style="color:var(--green)">✓</span><span>Found ${res.detections.length} furniture item${res.detections.length === 1 ? '' : 's'} (${res.raw.length} raw boxes over 7 passes)</span>`;
  } catch (e) {
    console.error(e);
    $('#analyzeStatus').innerHTML = `<span style="color:var(--amber)">▲</span><span>Detector unavailable (${e.message?.slice(0, 60) || 'offline'}). Draw boxes around your furniture below.</span>`;
  }
  $('#scanline').style.display = 'none';
  renderDetections({ animate: true });
  $('#drawBox').disabled = false;
  $('#toDims').disabled = false;
}
initAnalyzeEditor();
$('#toDims').onclick = () => go('dimensions');
$('#toDesign').onclick = () => {
  if (!(state.room.width > 0.5 && state.room.length > 0.5)) { toast('Please enter the room size', true); return; }
  go('design');
};

// ---------------------------------------------------------------- samples / save / open
document.querySelectorAll('[data-sample]').forEach((b) => (b.onclick = () => {
  resetProject();
  const s = SAMPLES[b.dataset.sample]();
  state.room = s.room; state.roomType = s.roomType; state.units = 'metric';
  state.items = s.items.map((it) => ({ ...it, placed: true }));
  state.reached = new Set(['upload', 'dimensions']);
  go('design');
}));

$('#btnSave').onclick = () => {
  const blob = new Blob([serialize()], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'room-layout.layoutlens.json'; a.click();
  toast('Project saved');
};
$('#btnOpen').onclick = () => $('#fileOpen').click();
$('#fileOpen').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.format !== 'layoutlens/1') throw new Error('Not a LayoutLens project');
    resetProject();
    Object.assign(state, { units: data.units, roomType: data.roomType, room: data.room, items: data.items.map((i) => ({ ...i, placed: true })), calib: data.calib, detections: data.detections || [] });
    if (data.photo?.url) {
      const img = new Image();
      await new Promise((r) => { img.onload = r; img.src = data.photo.url; });
      state.photo = { ...data.photo, el: img };
      state.detections.forEach((d) => { d.thumb = ''; });
    }
    state.reached = new Set(STEPS);
    go('design');
    toast('Project opened');
  } catch (err) { toast('Could not open: ' + err.message, true); }
  e.target.value = '';
};

go('upload');
