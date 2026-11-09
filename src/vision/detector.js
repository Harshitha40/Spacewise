// In-browser furniture detection (TensorFlow.js COCO-SSD) and a lightweight
// diminished-reality inpainting used to "remove" original furniture from the
// photo when previewing a new layout in AR.
import { CATALOG } from '../core/catalog.js';
import { interpretDetections, inferRoomType } from './interpret.js';

let modelPromise;
export function loadDetector(onStatus) {
  if (!modelPromise) {
    modelPromise = (async () => {
      onStatus?.('Loading TensorFlow.js…');
      const tf = await import('@tensorflow/tfjs');
      await tf.ready();
      onStatus?.(`Loading detection model (${tf.getBackend()})…`);
      const coco = await import('@tensorflow-models/coco-ssd');
      return coco.load({ base: 'mobilenet_v2' });
    })().catch((e) => { modelPromise = null; throw e; });
  }
  return modelPromise;
}

export async function detectFurniture(img, onStatus) {
  const model = await loadDetector(onStatus);
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const passes = detectionPasses(W, H);
  const raw = [];
  for (let i = 0; i < passes.length; i++) {
    onStatus?.(`Analysing photo… pass ${i + 1}/${passes.length}`);
    raw.push(...await runPass(model, img, passes[i], W, H));
  }
  const dets = interpretDetections(raw, W, H).map((d, i) => ({ id: `d${i}`, ...d, thumb: crop(img, d.bbox) }));
  return { detections: dets, roomType: inferRoomType(dets.map((d) => d.type)), raw };
}

// COCO-SSD squashes its input to 300×300, so large furniture clipped by the frame and
// small items lose detail. Re-running on a mirrored copy and on overlapping zoomed
// crops (slicing-aided inference) recovers them; interpret.js fuses the duplicates.
function detectionPasses(W, H) {
  const passes = [{ x: 0, y: 0, w: W, h: H }, { x: 0, y: 0, w: W, h: H, flip: true }];
  const tw = W * 0.6, th = H * 0.6;
  for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) {
    passes.push({ x: (W - tw) * fx, y: (H - th) * fy, w: tw, h: th });
  }
  return passes;
}

async function runPass(model, img, p, W, H) {
  const s = Math.min(1, 640 / Math.max(p.w, p.h));
  const c = document.createElement('canvas');
  c.width = Math.round(p.w * s); c.height = Math.round(p.h * s);
  const g = c.getContext('2d');
  if (p.flip) { g.translate(c.width, 0); g.scale(-1, 1); }
  g.drawImage(img, p.x, p.y, p.w, p.h, 0, 0, c.width, c.height);
  const res = await model.detect(c, 40, 0.15);
  const tol = 3;
  return res.map((r) => {
    let [x, y, w, h] = r.bbox;
    if (p.flip) x = c.width - x - w;
    const box = [p.x + x / s, p.y + y / s, w / s, h / s];
    // touching a crop edge that is not the photo border means the object was cut off
    const cut = (x < tol && p.x > 0) || (y < tol && p.y > 0) ||
      (x + w > c.width - tol && p.x + p.w < W - 1) || (y + h > c.height - tol && p.y + p.h < H - 1);
    return { class: r.class, score: r.score, bbox: box, cut };
  });
}

export function crop(img, [x, y, w, h], size = 120) {
  const c = document.createElement('canvas');
  const s = size / Math.max(w, h);
  c.width = Math.max(1, w * s); c.height = Math.max(1, h * s);
  c.getContext('2d').drawImage(img, x, y, w, h, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

/**
 * Multi-scale diffusion inpainting of the detected furniture boxes
 * (push-pull pyramid). Fast enough for interactive use on a laptop CPU.
 */
export function inpaintBoxes(img, boxes, maxDim = 720) {
  const sc = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.round(img.naturalWidth * sc), H = Math.round(img.naturalHeight * sc);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, W, H);
  const id = g.getImageData(0, 0, W, H);
  const mask = new Uint8Array(W * H);
  for (const [x, y, w, h] of boxes) {
    const m = 0.04;
    const x0 = Math.max(0, Math.floor((x - w * m) * sc)), y0 = Math.max(0, Math.floor((y - h * m) * sc));
    const x1 = Math.min(W, Math.ceil((x + w * (1 + m)) * sc)), y1 = Math.min(H, Math.ceil((y + h * (1 + m)) * sc));
    for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) mask[j * W + i] = 1;
  }
  // build pyramid of (premultiplied colour, weight)
  const levels = [];
  let cw = W, chh = H;
  let col = new Float32Array(W * H * 3), wt = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) {
    if (mask[k]) continue;
    wt[k] = 1; col[k * 3] = id.data[k * 4]; col[k * 3 + 1] = id.data[k * 4 + 1]; col[k * 3 + 2] = id.data[k * 4 + 2];
  }
  levels.push({ w: cw, h: chh, col, wt });
  while (cw > 2 && chh > 2) {
    const nw = Math.ceil(cw / 2), nh = Math.ceil(chh / 2);
    const nc = new Float32Array(nw * nh * 3), nwt = new Float32Array(nw * nh);
    for (let j = 0; j < chh; j++) for (let i = 0; i < cw; i++) {
      const s = j * cw + i, d = (j >> 1) * nw + (i >> 1);
      nwt[d] += wt[s]; nc[d * 3] += col[s * 3]; nc[d * 3 + 1] += col[s * 3 + 1]; nc[d * 3 + 2] += col[s * 3 + 2];
    }
    levels.push({ w: nw, h: nh, col: nc, wt: nwt });
    cw = nw; chh = nh; col = nc; wt = nwt;
  }
  // normalise each level: colour = sum/weight, confidence alpha = min(1, weight)
  for (const L of levels) {
    L.a = new Float32Array(L.w * L.h);
    for (let k = 0; k < L.w * L.h; k++) {
      if (L.wt[k] > 0) for (let ch = 0; ch < 3; ch++) L.col[k * 3 + ch] /= L.wt[k];
      L.a[k] = Math.min(1, L.wt[k]);
    }
  }
  // pull: blend each level with the (already filled) coarser level by confidence
  for (let l = levels.length - 2; l >= 0; l--) {
    const L = levels[l], C = levels[l + 1];
    for (let j = 0; j < L.h; j++) for (let i = 0; i < L.w; i++) {
      const k = j * L.w + i, a = L.a[k];
      if (a >= 1) continue;
      const ck = Math.min(C.h - 1, j >> 1) * C.w + Math.min(C.w - 1, i >> 1);
      for (let ch = 0; ch < 3; ch++) L.col[k * 3 + ch] = a * L.col[k * 3 + ch] + (1 - a) * C.col[ck * 3 + ch];
      L.a[k] = 1;
    }
  }
  const L0 = levels[0];
  for (let k = 0; k < W * H; k++) {
    if (!mask[k]) continue;
    const n = (Math.random() - 0.5) * 6; // film grain hides the smooth fill
    id.data[k * 4] = L0.col[k * 3] + n; id.data[k * 4 + 1] = L0.col[k * 3 + 1] + n; id.data[k * 4 + 2] = L0.col[k * 3 + 2] + n;
  }
  g.putImageData(id, 0, 0);
  return c.toDataURL('image/jpeg', 0.9);
}

export const TYPES_FOR_PICKER = Object.keys(CATALOG);
