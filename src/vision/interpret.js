// Turns raw multi-pass COCO-SSD boxes into furniture detections.
// COCO has a single "dining table" class and no "coffee table", so tables and chairs
// are resolved from scene layout (what seating and objects surround them) rather than the label.

const MIN_SCORE = {
  couch: 0.2, chair: 0.25, bed: 0.3, bench: 0.3, 'dining table': 0.2,
  'potted plant': 0.3, tv: 0.3, laptop: 0.35, book: 0.3,
};
const minScore = (cls) => MIN_SCORE[cls] ?? 0.35;
const SEATING = new Set(['couch', 'chair', 'bed', 'bench']);
const WORK = new Set(['laptop', 'keyboard', 'mouse']);

export const area = (b) => b[2] * b[3];
export function inter(a, b) {
  const x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]);
  const x1 = Math.min(a[0] + a[2], b[0] + b[2]), y1 = Math.min(a[1] + a[3], b[1] + b[3]);
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
}
export const iou = (a, b) => { const i = inter(a, b); return i / (area(a) + area(b) - i || 1); };
/** Intersection over the smaller box — catches a fragment sitting inside a full box. */
export const ios = (a, b) => inter(a, b) / (Math.min(area(a), area(b)) || 1);
const unionBox = (a, b) => {
  const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]);
  return [x0, y0, Math.max(a[0] + a[2], b[0] + b[2]) - x0, Math.max(a[1] + a[3], b[1] + b[3]) - y0];
};
const grow = ([x, y, w, h], fx, fy) => [x - w * fx, y - h * fy, w * (1 + 2 * fx), h * (1 + 2 * fy)];
const aspect = (b) => b[2] / (b[3] || 1);
const cx = (b) => b[0] + b[2] / 2;
const bottom = (b) => b[1] + b[3];

/**
 * Greedy same-class fusion of boxes from several detection passes.
 * `cut` boxes (clipped by an interior tile edge) are unioned into their partner so a sofa
 * split across two crops becomes one box; agreeing passes nudge the confidence up.
 */
export function fuseBoxes(raw) {
  const sorted = [...raw].sort((a, b) => b.score - a.score);
  const out = [];
  for (const r of sorted) {
    const m = out.find((o) => o.class === r.class &&
      (iou(o.bbox, r.bbox) > 0.5 || ios(o.bbox, r.bbox) > 0.7 || ((o.cut || r.cut) && ios(o.bbox, r.bbox) > 0.3)));
    if (!m) { out.push({ class: r.class, score: r.score, bbox: [...r.bbox], cut: !!r.cut, votes: 1 }); continue; }
    if (r.cut || m.cut) m.bbox = unionBox(m.bbox, r.bbox);
    m.cut = m.cut && r.cut;
    m.votes++;
    m.score = Math.min(0.99, m.score + 0.03);
  }
  return out;
}

/** One physical seat often fires as both "chair" and "couch" (or "bed"); keep the label that fits its shape. */
export function resolveSeatingConflicts(dets) {
  const prior = (d) => {
    const a = aspect(d.bbox);
    if (d.class === 'chair') return a > 1.5 ? 0.55 : 1;
    if (d.class === 'couch') return a < 0.8 ? 0.7 : 1;
    return 0.9;
  };
  const drop = new Set();
  for (let i = 0; i < dets.length; i++) for (let j = i + 1; j < dets.length; j++) {
    const a = dets[i], b = dets[j];
    if (a.class === b.class || !SEATING.has(a.class) || !SEATING.has(b.class)) continue;
    if (drop.has(a) || drop.has(b) || ios(a.bbox, b.bbox) < 0.6) continue;
    drop.add(a.score * prior(a) >= b.score * prior(b) ? b : a);
  }
  return dets.filter((d) => !drop.has(d));
}

/** A low teapoy often also fires as "bench"; when a bench sits on a table box, it is that table. */
export function absorbBenchesIntoTables(dets) {
  const tables = dets.filter((d) => d.class === 'dining table');
  return dets.filter((d) => {
    if (d.class !== 'bench') return true;
    const t = tables.find((tb) => ios(tb.bbox, d.bbox) > 0.5);
    if (!t) return true;
    t.score = Math.max(t.score, d.score);
    return false;
  });
}

/** Chairs pulled up to a table: narrow, overlapping the table's surroundings, and rising above its top. */
function chairsAround(table, chairs) {
  const zone = grow(table.bbox, 0.35, 0.25);
  return chairs.filter((c) => inter(zone, c.bbox) > 0 && aspect(c.bbox) < 0.9 && c.bbox[1] < table.bbox[1]);
}

/** Sofa or armchair next to the table (horizontally overlapping or within half a table width). */
function seatingNear(table, seats) {
  const t = table.bbox;
  return seats.some((s) => {
    const gap = Math.max(s.bbox[0] - (t[0] + t[2]), t[0] - (s.bbox[0] + s.bbox[2]), 0);
    return gap < t[2] * 0.5 && Math.abs(bottom(s.bbox) - bottom(t)) < Math.max(t[3], s.bbox[3]) * 1.5;
  });
}

// objects resting on a table poke up above its box, so test against a taller zone
const onTable = (o, t) => ios(o.bbox, grow(t.bbox, 0.1, 0.3)) > 0.6;

function classifyTable(t, ctx) {
  if (ctx.work.some((w) => onTable(w, t))) return { type: 'desk', why: 'laptop / keyboard on it' };
  const diners = chairsAround(t, ctx.chairs);
  if (diners.length >= 2) return { type: 'dining_table', why: `${diners.length} chairs around it` };
  let s = 0;
  const why = [];
  if (ctx.couches.length) { s += 2; why.push('sofa in room'); }
  if (seatingNear(t, [...ctx.couches, ...ctx.chairs.filter((c) => aspect(c.bbox) >= 0.9)])) { s += 1; why.push('beside seating'); }
  if (aspect(t.bbox) > 1.4) { s += 0.5; why.push('low & wide'); }
  s -= 2 * diners.length;
  if (s > 0) return { type: 'coffee_table', why: why.join(', ') };
  if (ctx.hasBed && !ctx.couches.length) return { type: 'desk', why: 'bedroom, no dining chairs' };
  return { type: 'dining_table', why: diners.length ? 'chair at it' : 'no sofa nearby' };
}

function classifyChair(c, ctx, tables) {
  const at = tables.find((t) => inter(grow(t.det.bbox, 0.35, 0.25), c.bbox) > 0 && aspect(c.bbox) < 0.9);
  if (at?.type === 'dining_table') return { type: 'dining_chair', why: 'at dining table' };
  if (at?.type === 'desk' || ctx.work.length) return { type: 'office_chair', why: 'at desk' };
  return { type: 'armchair', why: aspect(c.bbox) >= 0.9 ? 'wide upholstered seat' : 'free-standing' };
}

const DIRECT = { tv: 'tv_stand', refrigerator: 'fridge', oven: 'stove', toilet: 'toilet', 'potted plant': 'plant' };

/**
 * raw: [{ class, score, bbox:[x,y,w,h], cut? }] from all passes, in image pixels.
 * Returns [{ cls, type, score, bbox, why }] with at most one item per physical object.
 */
export function interpretDetections(raw, imgW, imgH) {
  // score thresholds apply after fusion, so weak boxes from several passes can corroborate each other
  const fused = absorbBenchesIntoTables(fuseBoxes(raw)).filter((d) => d.score >= minScore(d.class));
  const dets = resolveSeatingConflicts(fused);
  const of = (cls) => dets.filter((d) => d.class === cls);
  const classes = new Set(dets.map((d) => d.class));
  const edge = (b) => b[0] < imgW * 0.02 || b[1] < imgH * 0.02 || b[0] + b[2] > imgW * 0.98 || b[1] + b[3] > imgH * 0.98;
  const couchScore = Math.max(0, ...of('couch').map((d) => d.score));

  // daybeds / settees fire as "bed" or "bench" in rooms that clearly have a sofa
  const sofaLike = (d) => (d.class === 'bed' && classes.has('couch') && (edge(d.bbox) || d.score < couchScore)) ||
    (d.class === 'bench' && (classes.has('couch') || classes.has('tv')));
  const couches = dets.filter((d) => d.class === 'couch' || sofaLike(d));
  const ctx = {
    couches,
    chairs: of('chair'),
    work: dets.filter((d) => WORK.has(d.class)),
    hasBed: dets.some((d) => d.class === 'bed' && !sofaLike(d)),
  };

  const out = [];
  const add = (d, type, why = '') => out.push({ cls: d.class, type, score: d.score, bbox: d.bbox, why });

  for (const d of couches) add(d, 'sofa', d.class === 'couch' ? '' : `${d.class} next to sofa → settee`);
  for (const d of of('bed')) if (!sofaLike(d)) add(d, 'bed');

  const tables = of('dining table').map((t) => ({ det: t, ...classifyTable(t, ctx) }));
  for (const t of tables) add(t.det, t.type, t.why);
  for (const c of ctx.chairs) { const r = classifyChair(c, ctx, tables); add(c, r.type, r.why); }

  for (const l of of('laptop')) if (!tables.some((t) => onTable(l, t.det))) add(l, 'desk', 'laptop, no table');
  for (const d of dets) if (DIRECT[d.class]) add(d, DIRECT[d.class]);
  if (!classes.has('toilet')) for (const d of of('sink')) add(d, 'kitchen_counter');
  if (!classes.has('oven') && !classes.has('sink')) for (const d of of('microwave')) add(d, 'kitchen_counter');
  const books = of('book');
  if (books.length >= 3) add(books.reduce((a, b) => ({ ...b, bbox: unionBox(a.bbox, b.bbox), score: Math.max(a.score, b.score) })), 'bookshelf', `${books.length} books`);

  return out.sort((a, b) => b.score - a.score);
}

export function inferRoomType(types) {
  const s = new Set(types);
  if (s.has('toilet')) return 'Bathroom';
  if (s.has('bed')) return 'Bedroom';
  if (s.has('fridge') || s.has('stove') || s.has('kitchen_counter')) return 'Kitchen';
  if (s.has('sofa') || s.has('tv_stand') || s.has('coffee_table')) return 'Living room';
  if (s.has('dining_table')) return 'Dining room';
  if (s.has('desk')) return 'Home office';
  return 'Room';
}
