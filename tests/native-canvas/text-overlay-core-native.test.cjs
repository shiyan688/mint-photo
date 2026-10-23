'use strict';
// LOCAL native Skia pixel correctness only. Requires the already installed Canvas.
// No downloaded fonts, cross-platform pixel goldens, or added dependencies.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../app/src/main/assets/text-overlay.js');
const { createCanvas } = require('@napi-rs/canvas');
const local = test;
const recipe = override => ({ ...T.defaults(), text: 'Mint 薄荷', ...override });
const pixels = canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
function image(width = 320, height = 240) {
  const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#42617e'; ctx.fillRect(0, 0, width, height);
  ctx.clearRect(0, 0, 40, 35); return canvas;
}
local('native Canvas: empty and zero opacity leave every source byte exactly unchanged', () => {
  for (const r of [T.defaults(), recipe({ opacity: 0, outlineWidth: .15, shadow: true })]) {
    const canvas = image(), before = pixels(canvas).slice();
    T.render(canvas.getContext('2d'), canvas.width, canvas.height, r);
    assert.deepEqual(pixels(canvas), before);
  }
});
local('native Canvas: active fill/outline/shadow changes pixels and preserves distant original alpha/color', () => {
  for (const override of [{}, { outlineWidth: .12 }, { shadow: true }, { outlineWidth: .15, shadow: true, rotation: 33 }]) {
    const canvas = image(), before = pixels(canvas).slice();
    T.render(canvas.getContext('2d'), canvas.width, canvas.height, recipe(override));
    const after = pixels(canvas); assert.notDeepEqual(after, before);
    assert.deepEqual(after.slice(0, 4), before.slice(0, 4));
    assert.deepEqual(after.slice(-4), before.slice(-4));
  }
});
local('native Canvas: same-engine replay, JSON recipe roundtrip, and text history replay are byte identical', () => {
  const O = require('../../app/src/main/assets/text-overlay-operation.js');
  const raw = [{ type: 'text-overlay', action: 'add', id: 'one', recipe: recipe({ text: 'Old' }) },
    { type: 'text-overlay', action: 'replace', id: 'one', recipe: recipe({ text: 'New\n薄荷 🧑🏽‍🚀', outlineWidth: .1, shadow: true, rotation: -18 }) }];
  const a = image(), b = image(), c = image();
  for (const op of O.collapse(raw)) T.render(a.getContext('2d'), a.width, a.height, op.recipe);
  T.render(b.getContext('2d'), b.width, b.height, JSON.parse(JSON.stringify(raw[1].recipe)));
  T.render(c.getContext('2d'), c.width, c.height, raw[1].recipe);
  assert.deepEqual(pixels(a), pixels(b)); assert.deepEqual(pixels(a), pixels(c));
});
local('native Canvas: real glyph measurement keeps preview/export line breaks and normalized layout stable', () => {
  const r = recipe({ text: '薄荷人像 编辑文字 Mixed words and emoji 🧑🏽‍🚀 e\u0301\nSecond line', size: .1, boxWidth: .45, rotation: 27 });
  for (const family of ['sans', 'serif', 'mono']) {
    const plans = [[240, 320], [480, 640], [1200, 1600]].map(([w, h]) => {
      const canvas = createCanvas(w, h); return T.render(canvas.getContext('2d'), w, h, { ...r, fontFamily: family });
    });
    for (const plan of plans) {
      assert.deepEqual(plan.lines.map(l => l.text), plans[0].lines.map(l => l.text));
      const factor = plan.width / plans[0].width;
      for (let i = 0; i < plan.lines.length; i++) for (const key of ['width', 'x', 'y'])
        assert.ok(Math.abs(plan.lines[i][key] / factor - plans[0].lines[i][key]) < 1e-7);
    }
  }
});
local('native Canvas: invalid schema or 129 wrapped lines fails before the first pixel changes', () => {
  const canvas = image(), before = pixels(canvas).slice(), ctx = canvas.getContext('2d');
  for (const r of [recipe({ color: 'red' }), recipe({ text: 'W'.repeat(129), size: .5, boxWidth: .05 })]) {
    assert.throws(() => T.render(ctx, canvas.width, canvas.height, r));
    assert.deepEqual(pixels(canvas), before);
  }
});
local('native Canvas: source-over opacity on a transparent destination is bounded and context state restored', () => {
  const canvas = createCanvas(240, 180), ctx = canvas.getContext('2d');
  ctx.globalCompositeOperation = 'destination-out'; ctx.globalAlpha = .1; ctx.font = '11px serif';
  const before = { alpha: ctx.globalAlpha, composite: ctx.globalCompositeOperation, font: ctx.font };
  T.render(ctx, canvas.width, canvas.height, recipe({ text: 'MINT', opacity: .4, size: .3 }));
  const data = pixels(canvas), alpha = [];
  for (let i = 3; i < data.length; i += 4) alpha.push(data[i]);
  assert.ok(Math.max(...alpha) >= 99 && Math.max(...alpha) <= 103);
  assert.equal(ctx.globalAlpha, before.alpha); assert.equal(ctx.globalCompositeOperation, before.composite); assert.equal(ctx.font, before.font);
});
