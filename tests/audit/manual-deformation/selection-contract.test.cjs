'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./harness.cjs');
const center = { x: .5, y: .5 }, other = { x: .75, y: .5 };
const at = (mask, p) => mask[Math.round(p.y * 127) * 128 + Math.round(p.x * 127)];

test('subtract from unrestricted starts all-minus-brush, not an empty selection', () => {
  const h = harness(); assert.equal(h.draft.selection, null);
  h.click('selectionSubtract'); h.stroke([center]);
  const mask = h.mask();
  assert.equal(at(mask, center), 0); assert.equal(at(mask, other), 1);
  assert(mask.some(value => value === 1), 'Subtract must not silently exclude the entire photograph');
});

test('add after inversion adds to the visible selection', () => {
  const h = harness(); h.click('selectBrush'); h.stroke([center]); h.click('selectionInvert');
  assert.equal(at(h.mask(), center), 0); assert.equal(at(h.mask(), other), 1);
  h.stroke([center]);
  assert.equal(at(h.mask(), center), 1); assert.equal(at(h.mask(), other), 1);
});

test('subtract after inversion removes from the visible selection', () => {
  const h = harness(); h.click('selectBrush'); h.stroke([center]); h.click('selectionInvert');
  h.click('selectionSubtract'); h.stroke([other]);
  assert.equal(at(h.mask(), center), 0); assert.equal(at(h.mask(), other), 0);
  assert.equal(h.mask()[0], 1);
});

test('feather on unrestricted selection keeps the image selected', () => {
  const h = harness(); h.slide('m-feather', 3);
  const mask = h.mask();
  assert(mask === null || mask.every(value => value === 1), 'Feather must not turn unrestricted into select-nothing');
});

test('selection-control changes do not retarget a saved liquify command', () => {
  const h = harness(); h.click('selectionAll'); h.click('manualPush'); h.slide('m-radius', 8);
  h.stroke([{ x: .45, y: .5 }, { x: .55, y: .5 }]); assert.equal(h.draft.liquify.length, 1);
  const saved = JSON.stringify(h.draft.liquify[0].selection);
  h.click('selectionEmpty'); h.click('selectionInvert'); h.slide('m-feather', 4);
  assert.equal(JSON.stringify(h.draft.liquify[0].selection), saved);
});

test('selection edit refuses a stale gesture rather than replacing a newer selection', () => {
  const h = harness(); h.click('selectBrush');
  const d = h.draft, token = h.env.ManualRetouchUI.start(d, center);
  h.click('selectionAll'); const newer = JSON.stringify(d.selection);
  h.env.ManualRetouchUI.finish(d, other, token, false);
  assert.equal(JSON.stringify(d.selection), newer); assert(h.notices.some(text => text.includes('途中选区已改变')));
});

test('cancelled selection gesture does not save even a single tap', () => {
  const h = harness(); h.click('selectBrush'); h.stroke([center], true);
  assert.equal(h.draft.selection, null);
  h.click('selectionAll'); const before = JSON.stringify(h.draft.selection);
  h.click('selectionSubtract'); h.stroke([center], true);
  assert.equal(JSON.stringify(h.draft.selection), before);
});

test('missing new-selection helper fails closed instead of reverting to v29 selection defects', () => {
  const h = harness(); h.env.MintSelectionEdit = null; h.click('selectionSubtract'); h.stroke([center]);
  assert.equal(h.draft.selection, null);
  assert(h.notices.some(text => text.includes('核心缺失')));
});
