'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../../app/src/main/assets/manual-tools.js');
const P = require('../../../app/src/main/assets/project-core.js');
const { harness, surface } = require('./harness.cjs');
const modes = { manualBloat: 'bloat', manualPucker: 'pucker', manualTwistCW: 'twist-cw', manualTwistCCW: 'twist-ccw' };
const point = { x: .5, y: .5 }, plain = value => JSON.parse(JSON.stringify(value));

test('all four UI modes make actual pixels on release, preserve source and round-trip history', () => {
  for (const [id, kind] of Object.entries(modes)) {
    const h = harness(), original = h.base.data.slice(); h.click(id); h.slide('m-radius', 16); h.stroke([point]);
    assert.equal(h.draft.liquify.length, 1); assert.equal(h.draft.liquify[0].kind, kind);
    assert.deepEqual(h.base.data, original);
    const copy = surface(h.base.width, h.base.height, original); h.env.ManualRetouchUI.apply(copy, h.draft);
    assert.notDeepEqual(copy.data, original);
    const op = plain(h.draft), expected = M.liquify({ width: h.base.width, height: h.base.height, data: original }, op.liquify, { sourceRevision: op.sourceRevision });
    assert.deepEqual(copy.data, expected.data);
    const source = { blob: new Blob(['x'], { type: 'image/png' }), name: 'synthetic.png', mime: 'image/png', width: 128, height: 128, origin: 'original' };
    const project = P.makeProject(source, [op], []), restored = P.restoreProject(P.draftRecord(project));
    assert.deepEqual(restored.ops, project.ops); assert.equal(restored.source.blob, source.blob);
    const replay = surface(128, 128, original); h.env.ManualRetouchUI.apply(replay, h.inRealm(restored.ops[0]));
    assert.deepEqual(replay.data, copy.data);
  }
});

test('new UI mode cancel and midgesture mode switch commit nothing', () => {
  for (const id of Object.keys(modes)) {
    const h = harness(); h.click(id); h.stroke([point], true); assert.equal(h.draft.liquify.length, 0);
    const d = h.draft, token = h.env.ManualRetouchUI.start(d, point); h.click('manualHeal');
    h.env.ManualRetouchUI.finish(d, point, token, false); assert.equal(d.liquify.length, 0);
  }
});

test('repair and deformation radius/strength defaults and saved controls remain independent', () => {
  const h = harness(); assert.equal(+h.nodes['m-radius'].value, 1.8); assert.equal(+h.nodes['m-strength'].value, 100);
  h.click('manualBloat'); assert.equal(+h.nodes['m-radius'].value, 8); assert.equal(+h.nodes['m-strength'].value, 40);
  assert.equal(h.nodes['m-hardness'].disabled, true); assert.equal(h.nodes['m-radius'].max, '25');
  h.slide('m-radius', 16); h.slide('m-strength', 70); h.click('manualHeal');
  assert(Math.abs(+h.nodes['m-radius'].value - 1.8) < 1e-9); assert.equal(h.nodes['mv-radius'].textContent, '1.8');
  assert.equal(+h.nodes['m-strength'].value, 100); assert.equal(h.nodes['m-hardness'].disabled, false);
  h.slide('m-radius', 2); h.slide('m-strength', 55); h.click('manualTwistCCW');
  assert.equal(+h.nodes['m-radius'].value, 16); assert.equal(+h.nodes['m-strength'].value, 70);
  h.click('manualClone'); assert.equal(+h.nodes['m-radius'].value, 2); assert.equal(+h.nodes['m-strength'].value, 55);
});

test('new UI modes and direct Android replay refuse even partially transparent input', () => {
  for (const [id, kind] of Object.entries(modes)) {
    const h = harness(); h.base.data[3] = 128; const original = h.base.data.slice(); h.click(id);
    assert(h.notices.some(text => text.includes('透明'))); assert.equal(h.draft.liquify.length, 0);
    const op = plain(h.draft); op.liquify = [{ kind, sourceRevision: op.sourceRevision, radius: .16, strength: .4, points: [point], selection: null }];
    assert.throws(() => h.env.ManualRetouchUI.apply(surface(128, 128, original), op), /透明/);
    assert.deepEqual(h.base.data, original);
  }
});

test('new deformations cannot reinterpret a repair donor in the same batch', () => {
  const h = harness(); h.click('manualClone'); h.click('sampleSource'); h.stroke([{ x: .25, y: .5 }]); h.stroke([{ x: .6, y: .5 }]);
  assert.equal(h.draft.repair.length, 1); const before = plain(h.draft);
  for (const id of Object.keys(modes)) { h.click(id); assert(h.notices.at(-1).includes('先应用')); assert.deepEqual(plain(h.draft), before); }
});

test('no export route rejects the new stroke; working-only success is stated explicitly', () => {
  const rejected = harness({ adapter: { assess: () => ({ original: { allowed: false, error: 'original-budget' }, working: { allowed: false, error: 'working-budget' } }) } });
  rejected.click('manualBloat'); rejected.stroke([point]); assert.equal(rejected.draft.liquify.length, 0); assert.equal(rejected.notices.at(-1), 'working-budget');
  const working = harness({ adapter: { assess: () => ({ original: { allowed: false }, working: { allowed: true } }) } });
  working.click('manualBloat'); working.stroke([point]); assert.equal(working.draft.liquify.length, 1);
  assert(working.nodes.manualStatus.textContent.includes('仅可导出工作尺寸'));
});

test('late controls and gesture callbacks cannot mutate a replacement manual session', () => {
  const h = harness(); h.click('manualBloat');
  const old = h.draft, token = h.env.ManualRetouchUI.start(old, point), click = h.nodes.manualPucker.onclick, slide = h.nodes['m-strength'].oninput;
  h.env.ManualRetouchUI.release(); h.env.ManualRetouchUI.setup(h.adapter); const next = plain(h.draft);
  click(); slide({ target: { value: 99 } }); h.env.ManualRetouchUI.finish(old, point, token, false);
  assert.deepEqual(plain(h.draft), next); assert.equal(+h.nodes['m-strength'].value, 100); assert.equal(old.liquify.length, 0);
});

test('new-mode local undo and clear restore command history without altering source', () => {
  const h = harness(), original = h.base.data.slice(); h.click('manualBloat'); h.stroke([point]); h.click('manualTwistCW'); h.stroke([point]);
  assert.equal(h.draft.liquify.length, 2); h.click('undoLocal'); assert.equal(h.draft.liquify.length, 1);
  assert.equal(h.draft.liquify[0].kind, 'bloat'); h.click('clearLocal'); assert.equal(h.draft.liquify.length, 0);
  const copy = surface(128, 128, original); h.env.ManualRetouchUI.apply(copy, h.draft); assert.deepEqual(copy.data, original); assert.deepEqual(h.base.data, original);
});
