import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/engine/evaluate.js';
import { anneal, legalize, STRATEGIES } from '../src/engine/optimizer.js';
import { makeItem, collides } from '../src/core/catalog.js';
import { intersectArea, footprint, outsideArea } from '../src/engine/geometry.js';

const room = { width: 4, length: 3.6, height: 2.7,
  doors: [{ wall: 'S', offset: 0.3, width: 0.85 }],
  windows: [{ wall: 'N', offset: 1.2, width: 1.4, sill: 0.9, height: 1.2 }] };

const messy = () => [
  makeItem('bed', { id: 'bed', x: 2, z: 1.8 }),
  makeItem('nightstand', { id: 'ns', x: 0.4, z: 3.2 }),
  makeItem('wardrobe', { id: 'wd', x: 0.6, z: 0.5, rot: 0 }),
  makeItem('desk', { id: 'desk', x: 2.2, z: 1.0 }),
  makeItem('office_chair', { id: 'ch', x: 3.5, z: 3.0 }),
];

test('overlap area of identical squares', () => {
  const a = makeItem('nightstand', { x: 1, z: 1, w: 1, d: 1 });
  assert.ok(Math.abs(intersectArea(footprint(a), footprint({ ...a, x: 1.5 })) - 0.5) < 1e-9);
});

test('messy layout has collisions and blocked door', () => {
  const r = evaluate({ room, items: messy() });
  assert.ok(r.penalties.overlap > 0, 'expected overlaps');
  assert.ok(r.issues.length > 0);
  console.log('messy score', r.scores, r.issues.map(i => i.msg));
});

test('annealing improves the layout', () => {
  const items = messy();
  const before = evaluate({ room, items }, { fast: true }).cost;
  const t0 = Date.now();
  const res = anneal({ room, items }, 'balanced', 3);
  const after = evaluate({ room, items: res.items });
  console.log(`anneal ${Date.now() - t0}ms cost ${before.toFixed(2)} -> ${res.cost.toFixed(2)}`, after.scores, after.issues.map(i => i.msg));
  assert.ok(res.cost < before);
  assert.equal(after.penalties.overlap, 0);
});

// living room from a photo import: 4 sofas, plants jammed into them, teapoy pushed into a sofa
const living = { width: 4.2, length: 3.8, height: 2.7,
  doors: [{ wall: 'S', offset: 0.35, width: 0.85 }],
  windows: [{ wall: 'N', offset: 1.4, width: 1.4, sill: 0.9, height: 1.3 }] };
const crowded = () => [
  makeItem('sofa', { id: 's1', x: 2.1, z: 3.3, rot: Math.PI }),
  makeItem('sofa', { id: 's2', x: 0.45, z: 2.2, rot: Math.PI / 2 }),
  makeItem('sofa', { id: 's3', x: 3.75, z: 1.6, rot: -Math.PI / 2 }),
  makeItem('sofa', { id: 's4', x: 1.0, z: 1.3, rot: Math.PI / 2 }),
  makeItem('plant', { id: 'p1', x: 3.3, z: 3.3 }),
  makeItem('plant', { id: 'p2', x: 1.2, z: 3.4 }),
  makeItem('plant', { id: 'p3', x: 3.7, z: 2.6 }),
  makeItem('coffee_table', { id: 'ct', x: 2.4, z: 2.6, rot: 0.2 }),
];

function assertLegal(room, items, what) {
  const doorZone = (d) => [[d.offset, 0], [d.offset + d.width, 0], [d.offset + d.width, d.width], [d.offset, d.width]];
  for (const it of items) {
    if (!collides(it)) continue;
    const q = it.rot / (Math.PI / 2);
    assert.ok(Math.abs(q - Math.round(q)) < 1e-6, `${what}: ${it.id} not on a 90° grid (${(it.rot * 180 / Math.PI).toFixed(1)}°)`);
    assert.ok(outsideArea(footprint(it), room.width, room.length) < 1e-3, `${what}: ${it.id} through a wall`);
    for (const d of room.doors) assert.ok(intersectArea(footprint(it), doorZone(d)) < 1e-3, `${what}: ${it.id} blocks the door`);
    for (const o of items) {
      if (o === it || !collides(o)) continue;
      assert.ok(intersectArea(footprint(it), footprint(o)) < 1e-3, `${what}: ${it.id} overlaps ${o.id}`);
    }
  }
}

test('legalize pulls plants and the teapoy out of sofas and squares everything up', () => {
  const items = legalize(living, crowded());
  assertLegal(living, items, 'legalize');
});

test('every strategy returns a physically valid, aligned layout', () => {
  for (const s of Object.keys(STRATEGIES)) {
    for (const seed of [1, 7919]) {
      const res = anneal({ room: living, items: crowded() }, s, seed);
      assertLegal(living, res.items, `${s}/${seed}`);
    }
  }
});
