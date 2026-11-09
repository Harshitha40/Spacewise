import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretDetections, inferRoomType, fuseBoxes } from '../src/vision/interpret.js';

const W = 395, H = 530;
const det = (cls, score, bbox, cut = false) => ({ class: cls, score, bbox, cut });
const types = (out) => out.map((d) => d.type).sort();

// living room photo: sofa at the back, teapoy in front, wing chair + daybed on the left
const livingRoom = [
  det('couch', 0.49, [240, 202, 153, 98]),
  det('dining table', 0.43, [139, 255, 157, 102]),
  det('potted plant', 0.4, [103, 197, 32, 32]),
  det('chair', 0.32, [0, 185, 85, 115]),
  det('bed', 0.33, [0, 300, 175, 230]),
];

test('table in front of a sofa with no dining chairs is a coffee table', () => {
  const out = interpretDetections(livingRoom, W, H);
  const table = out.find((d) => d.cls === 'dining table');
  assert.equal(table.type, 'coffee_table');
  assert.match(table.why, /sofa/);
});

test('every sofa-like seat is found: couch plus daybed reported as "bed"', () => {
  const out = interpretDetections(livingRoom, W, H);
  assert.equal(out.filter((d) => d.type === 'sofa').length, 2);
  assert.ok(!out.some((d) => d.type === 'bed'));
  assert.equal(out.find((d) => d.cls === 'chair').type, 'armchair');
  assert.equal(inferRoomType(out.map((d) => d.type)), 'Living room');
});

test('table with chairs pulled up to it is a dining table, even with a sofa in view', () => {
  const out = interpretDetections([
    det('couch', 0.7, [0, 250, 160, 90]),
    det('dining table', 0.6, [200, 260, 140, 70]),
    det('chair', 0.5, [190, 220, 45, 120]),
    det('chair', 0.5, [300, 220, 45, 120]),
    det('chair', 0.45, [250, 215, 40, 90]),
  ], W, H);
  assert.equal(out.find((d) => d.cls === 'dining table').type, 'dining_table');
  assert.equal(out.filter((d) => d.type === 'dining_chair').length, 3);
});

test('two separate sofas are both kept', () => {
  const out = interpretDetections([
    det('couch', 0.8, [10, 200, 170, 90]),
    det('couch', 0.6, [220, 210, 160, 85]),
  ], W, H);
  assert.equal(out.filter((d) => d.type === 'sofa').length, 2);
});

test('fragments of one sofa from different crops fuse into one box', () => {
  const fused = fuseBoxes([
    det('couch', 0.45, [240, 202, 153, 98]),
    det('couch', 0.6, [240, 202, 90, 98], true),
    det('couch', 0.5, [242, 204, 150, 95]),
  ]);
  assert.equal(fused.length, 1);
  assert.equal(fused[0].votes, 3);
  assert.ok(fused[0].bbox[2] >= 150);
});

test('a wide seat firing as both chair and couch is reported once, as a sofa', () => {
  const out = interpretDetections([
    det('chair', 0.5, [100, 200, 200, 90]),
    det('couch', 0.42, [105, 205, 195, 85]),
  ], W, H);
  assert.deepEqual(types(out), ['sofa']);
});

test('teapoy also firing as "bench" is not counted as an extra sofa', () => {
  const out = interpretDetections([
    det('couch', 0.8, [241, 215, 150, 79]),
    det('dining table', 0.17, [140, 237, 158, 135]),
    det('dining table', 0.23, [136, 226, 100, 130], true),
    det('bench', 0.59, [129, 195, 176, 160]),
  ], W, H);
  assert.deepEqual(types(out), ['coffee_table', 'sofa']);
  assert.ok(out.find((d) => d.type === 'coffee_table').bbox[2] > 150);
});

test('laptop on a table makes it a desk without a duplicate desk', () => {
  const out = interpretDetections([
    det('dining table', 0.6, [100, 250, 160, 80]),
    det('laptop', 0.7, [150, 230, 50, 35]),
    det('chair', 0.5, [130, 230, 50, 110]),
  ], W, H);
  assert.deepEqual(types(out), ['desk', 'office_chair']);
});

test('bedroom bed stays a bed', () => {
  const out = interpretDetections([det('bed', 0.8, [50, 200, 250, 200])], W, H);
  assert.deepEqual(types(out), ['bed']);
  assert.equal(inferRoomType(types(out)), 'Bedroom');
});
