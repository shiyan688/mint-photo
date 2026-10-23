'use strict';
// Read-only integration evidence. Does not edit ProjectCore or render pixels.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const E = require('../app/src/main/assets/export-size.js');
const assets = process.env.MINT_PROJECT_ASSETS || path.join(__dirname, '../app/src/main/assets');
const P = require(path.join(assets, 'project-core.js'));
const C = require(path.join(assets, 'canvas-padding.js'));
const edge = longEdge => ({ version: 1, mode: 'long-edge', longEdge });
const source = (width, height, origin = 'original') => ({
  width, height, origin, name: 'dimension-only.png', mime: 'image/png',
  blob: new Blob(['dimension-only fixture, not a decodable image'], { type: 'image/png' })
});
const crop = (w, h) => ({ type: 'crop', x: 0, y: 0, w, h });
const padding = changes => ({ type: 'canvas-padding', recipe: { ...C.defaults(), ...changes } });
const composed = (s, ops, mode, recipe) => {
  const processed = P.planExport(s, ops, mode);
  return { processed, final: E.plan(processed.output.width, processed.output.height, recipe) };
};

test('final request uses post-crop/post-rotation dimensions, not original source dimensions', () => {
  const result = composed(source(3001, 2001), [crop(0.5, 0.25), { type: 'rotate' }], 'original', edge(750));
  assert.deepEqual(result.processed.input, { width: 3001, height: 2001 });
  assert.deepEqual(result.processed.output, { width: 500, height: 1501 });
  assert.deepEqual(result.final.input, result.processed.output);
  assert.deepEqual(result.final.output, { width: 250, height: 750 });
  assert.equal(result.processed.usesOriginal, true);
});

test('original and working bases remain explicit and independent of requested final edge', () => {
  const s = source(4000, 2000), ops = [crop(0.5, 1)];
  const original = composed(s, ops, 'original', edge(1000));
  const working = composed(s, ops, 'working', edge(1000));
  assert.deepEqual(original.processed.input, { width: 4000, height: 2000 });
  assert.deepEqual(original.final.input, { width: 2000, height: 2000 });
  assert.deepEqual(working.processed.input, { width: 2560, height: 1280 });
  assert.deepEqual(working.final.input, { width: 1280, height: 1280 });
  assert.deepEqual(original.final.output, { width: 1000, height: 1000 });
  assert.deepEqual(working.final.output, { width: 1000, height: 1000 });
  assert.equal(original.processed.mode, 'original');
  assert.equal(working.processed.mode, 'working');
  assert.equal(original.processed.usesOriginal, true);
  assert.equal(working.processed.usesOriginal, false);
  assert.throws(() => composed(s, ops, 'working', edge(1500)), /Upscaling/);
  assert.deepEqual(composed(s, ops, 'original', edge(1500)).final.output, { width: 1500, height: 1500 });
});

test('padding is included before the final aspect-preserving downsize', () => {
  const s = source(1000, 800), ops = [padding({ left: 0.25, right: 0.125, top: 0.25, bottom: 0.125 })];
  const result = composed(s, ops, 'original', edge(650));
  assert.deepEqual(result.processed.output, { width: 1300, height: 1100 });
  assert.deepEqual(result.final.output, { width: 650, height: 550 });
  assert.equal(s.width, 1000); assert.equal(s.height, 800);
  assert.deepEqual(ops[0].recipe, { ...C.defaults(), left: 0.25, right: 0.125, top: 0.25, bottom: 0.125 });
});

test('small final output never bypasses an over-budget original source', () => {
  assert.throws(() => composed(source(6000, 4000), [crop(0.1, 0.1)], 'original', edge(1)), /预算/);
  const result = composed(source(6000, 4000), [], 'working', edge(1000));
  assert.deepEqual(result.processed.input, { width: 2560, height: 1707 });
  assert.deepEqual(result.final.output, { width: 1000, height: 667 });
});

test('small final output never bypasses an oversized intermediate even after a later crop', () => {
  const s = source(3000, 2000);
  const ops = [padding({ left: 0.5, right: 0.5 }), crop(0.1, 0.1)];
  assert.throws(() => composed(s, ops, 'original', edge(1)), /预算|range|budget|width/);
});

test('legacy working-copy source cannot be relabeled as original by a final resize', () => {
  const s = source(2000, 1000, 'legacy-working-copy');
  assert.throws(() => composed(s, [], 'original', edge(1000)), /旧版|原始/);
  const result = composed(s, [], 'working', edge(1000));
  assert.equal(result.processed.usesOriginal, false);
  assert.match(result.processed.warning, /旧版/);
  assert.deepEqual(result.final.output, { width: 1000, height: 500 });
});
