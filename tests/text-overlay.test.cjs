'use strict';
// Portable schema/layout/ordering tests. No native font or pixel goldens here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const T = require('../app/src/main/assets/text-overlay.js');
const recipe = override => ({ ...T.defaults(), text: 'Mint portrait', ...override });
const source = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/text-overlay.js'), 'utf8');
function context() {
  const stack = [], draws = [], measures = [];
  const ctx = { font: '17px sentinel', textAlign: 'right', textBaseline: 'top', direction: 'rtl',
    globalAlpha: .25, globalCompositeOperation: 'destination-out', filter: 'blur(9px)',
    lineJoin: 'bevel', shadowBlur: 21, shadowOffsetX: 8, shadowOffsetY: 7, shadowColor: '#ff00ff',
    save() { stack.push(Object.fromEntries(Object.entries(this).filter(([, value]) => typeof value !== 'function'))); },
    restore() { const state = stack.pop(); for (const key of Object.keys(this)) if (typeof this[key] !== 'function') delete this[key]; Object.assign(this, state); },
    measureText(value) {
      measures.push({ text: value, font: this.font });
      const size = Number(/([\d.]+)px/.exec(this.font)[1]);
      const width = Array.from(value).length * size * .6;
      return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width,
        actualBoundingBoxAscent: size * .8, actualBoundingBoxDescent: size * .2 };
    },
    setTransform(...args) { draws.push({ call: 'setTransform', args }); },
    translate(...args) { draws.push({ call: 'translate', args }); },
    rotate(...args) { draws.push({ call: 'rotate', args }); },
    strokeText(...args) { draws.push({ call: 'strokeText', args, alpha: this.globalAlpha,
      composite: this.globalCompositeOperation, join: this.lineJoin, color: this.strokeStyle, filter: this.filter }); },
    fillText(...args) { draws.push({ call: 'fillText', args, alpha: this.globalAlpha,
      composite: this.globalCompositeOperation, color: this.fillStyle, filter: this.filter }); }
  };
  return { ctx, draws, measures, stack };
}
test('CommonJS/browser expose the same frozen API and exact limits/defaults', () => {
  assert.deepEqual(Object.keys(T), ['LIMITS', 'defaults', 'validate', 'isActive', 'layout', 'render']);
  assert.ok(Object.isFrozen(T)); assert.ok(Object.isFrozen(T.LIMITS));
  assert.deepEqual(T.LIMITS, { text: 500, explicitLines: 12, wrappedLines: 128, edge: 16384, pixels: 67108864, canonicalMinEdge: 1024 });
  assert.deepEqual(T.defaults(), { version: 1, text: '', x: .5, y: .5, size: .08, boxWidth: .9, rotation: 0,
    align: 'center', fontFamily: 'sans', bold: true, italic: false, lineHeight: 1.25, color: '#ffffff', opacity: 1,
    outlineWidth: 0, outlineColor: '#000000', shadow: false });
  const sandbox = vm.createContext({}); vm.runInContext(source, sandbox);
  assert.equal(vm.runInContext('typeof MintTextOverlay.render', sandbox), 'function');
  assert.equal(vm.runInContext('JSON.stringify(MintTextOverlay.validate(MintTextOverlay.defaults()))', sandbox), JSON.stringify(T.defaults()));
  assert.notEqual(T.defaults(), T.defaults());
});
test('validation snapshots round-trip without input mutation and accepts null prototypes', () => {
  const input = recipe({ text: '薄荷\n🧑🏽‍🚀 e\u0301', color: '#ABC123' });
  const saved = T.validate(Object.assign(Object.create(null), input));
  assert.deepEqual(saved, input); assert.equal(Object.getPrototypeOf(saved), Object.prototype);
  input.text = 'edited'; assert.notEqual(input.text, saved.text);
  assert.deepEqual(T.validate(JSON.parse(JSON.stringify(saved))), saved);
  assert.doesNotThrow(() => T.validate(Object.freeze(saved)));
});
test('every recipe field is mandatory own enumerable data; no accessors execute', () => {
  let calls = 0;
  for (const key of Object.keys(T.defaults())) for (const mutation of ['missing', 'getter', 'hidden']) {
    const input = recipe();
    if (mutation === 'missing') delete input[key];
    if (mutation === 'getter') Object.defineProperty(input, key, { enumerable: true, get() { calls++; throw Error('must not execute'); } });
    if (mutation === 'hidden') Object.defineProperty(input, key, { enumerable: false });
    assert.throws(() => T.validate(input), TypeError, mutation + ':' + key);
  }
  for (const input of [null, undefined, [], {}, new Date(), Object.create(recipe()),
    { ...recipe(), extra: 1 }, { ...recipe(), [Symbol('x')]: 1 }, Object.setPrototypeOf(recipe(), { unknown: true })])
    assert.throws(() => T.validate(input), TypeError);
  assert.equal(calls, 0);
});
test('all number, enum, color and boolean bounds reject without coercion', () => {
  const ranges = { x: [0, 1], y: [0, 1], size: [.01, .5], boxWidth: [.05, 1], rotation: [-180, 180],
    lineHeight: [1, 2.5], opacity: [0, 1], outlineWidth: [0, .15] };
  let calls = 0;
  for (const [key, [min, max]] of Object.entries(ranges)) {
    for (const value of [min, max]) assert.equal(T.validate(recipe({ [key]: value }))[key], value);
    for (const value of [min - .001, max + .001, NaN, Infinity, -Infinity, String(min), null,
      { valueOf() { calls++; return min; } }]) assert.throws(() => T.validate(recipe({ [key]: value })), TypeError, key);
  }
  for (const key of ['bold', 'italic', 'shadow']) for (const value of [0, 1, 'true', null])
    assert.throws(() => T.validate(recipe({ [key]: value })), TypeError);
  for (const key of ['color', 'outlineColor']) for (const value of ['red', '#fff', '#ffffffff', '#GG0000', ' #ffffff', '#ffffff\n', {}, null])
    assert.throws(() => T.validate(recipe({ [key]: value })), TypeError);
  for (const bad of [{ align: 'start' }, { fontFamily: 'Arial' }, { version: 2 }, { version: '1' }])
    assert.throws(() => T.validate(recipe(bad)), TypeError);
  assert.equal(calls, 0); assert.equal(Object.is(T.validate(recipe({ rotation: -0 })).rotation, -0), false);
});
test('500 Unicode points and 12 explicit lines are inclusive, with malformed/control input rejected', () => {
  for (const text of ['a'.repeat(500), '😀'.repeat(500), Array(12).fill('').join('\n'), 'é e\u0301 🧑🏽‍🚀'])
    assert.equal(T.validate(recipe({ text })).text, text);
  for (const text of ['a'.repeat(501), '😀'.repeat(501), Array(13).fill('').join('\n'), '\ud800', '\udc00', '\ud800a', 'a\udc00'])
    assert.throws(() => T.validate(recipe({ text })), TypeError);
  for (let point = 0; point <= 159; point++) if (point !== 10 && (point < 32 || point >= 127))
    assert.throws(() => T.validate(recipe({ text: String.fromCharCode(point) })), TypeError, 'control ' + point);
});
test('empty/zero opacity are true no-draws; invalid inactive recipes still reject', () => {
  for (const r of [T.defaults(), recipe({ opacity: 0 })]) {
    const { ctx, draws } = context(); assert.equal(T.isActive(r), false);
    T.render(ctx, 300, 200, r); assert.equal(draws.length, 0);
  }
  assert.equal(T.isActive(recipe()), true); assert.equal(T.isActive(recipe({ text: ' ' })), true);
  assert.throws(() => T.isActive(recipe({ text: '', size: 9 })));
});
test('all image size bounds are checked before draws, including the exact 64 Mi pixel boundary', () => {
  const { ctx, draws } = context();
  for (const [w, h] of [[0, 1], [-1, 1], [1, 0], [1.5, 2], [NaN, 2], [Infinity, 2], ['1', 2], [16385, 1], [1, 16385], [8193, 8192]])
    assert.throws(() => T.render(ctx, w, h, recipe()), TypeError);
  for (const [w, h] of [[1, 1], [16384, 1], [8192, 8192], [16384, 4096]])
    assert.doesNotThrow(() => T.layout(ctx, w, h, recipe()));
  assert.equal(draws.length, 0);
});
test('canonical measurement preserves same-aspect wrapping and normalized geometry at output scales', () => {
  const r = recipe({ text: 'Portrait line one and two 薄荷人像 with words', boxWidth: .61, size: .09, rotation: 37, shadow: true, outlineWidth: .1 });
  const plans = [[256, 192], [1024, 768], [2048, 1536]].map(([w, h]) => {
    const { ctx, measures } = context(), plan = T.layout(ctx, w, h, r);
    assert.ok(measures.every(m => m.font === 'normal 700 92.16px sans-serif'));
    return plan;
  });
  for (const plan of plans) {
    assert.deepEqual(plan.lines.map(l => l.text), plans[0].lines.map(l => l.text));
    const factor = plan.width / plans[0].width;
    for (let i = 0; i < plan.lines.length; i++) for (const key of ['width', 'x', 'y'])
      assert.ok(Math.abs(plan.lines[i][key] / factor - plans[0].lines[i][key]) < 1e-9);
    for (let i = 0; i < 4; i++) for (const key of ['x', 'y'])
      assert.ok(Math.abs(plan.corners[i][key] / factor - plans[0].corners[i][key]) < 1e-9);
  }
});
test('explicit newlines, trailing blank lines and wrapped whitespace are preserved', () => {
  const { ctx } = context();
  const value = 'alpha  beta\n\n薄荷人像\n';
  const plan = T.layout(ctx, 1024, 1024, recipe({ text: value, size: .06, boxWidth: .2 }));
  assert.equal(plan.lines.map(l => l.text).join(''), value.replace(/\n/g, ''));
  assert.equal(plan.lines.at(-1).text, '');
  const explicit = T.layout(ctx, 1024, 1024, recipe({ text: 'a\n\nb\n', boxWidth: 1 }));
  assert.deepEqual(explicit.lines.map(l => l.text), ['a', '', 'b', '']);
});
test('Intl and no-Intl fallback do not split combining, surrogate, flag, or ZWJ graphemes', () => {
  const clusters = ['e\u0301', '🧑🏽‍🚀', '🇨🇳', '❤️', '👨‍👩‍👧‍👦'];
  for (const fallback of [false, true]) {
    const sandbox = vm.createContext(fallback ? { Intl: undefined } : {}); vm.runInContext(source, sandbox);
    const { ctx } = context(); sandbox.ctx = ctx;
    for (const cluster of clusters) {
      sandbox.value = cluster.repeat(3);
      const lines = vm.runInContext('MintTextOverlay.layout(ctx,1024,1024,{...MintTextOverlay.defaults(),text:value,size:.5,boxWidth:.05}).lines', sandbox);
      assert.deepEqual(Array.from(lines, l => l.text), [cluster, cluster, cluster]);
    }
  }
});
test('128 wrapped lines is inclusive; 129 fails atomically rather than truncating', () => {
  const { ctx, draws, stack } = context();
  assert.equal(T.layout(ctx, 1024, 1024, recipe({ text: 'X'.repeat(128), size: .5, boxWidth: .05 })).lines.length, 128);
  assert.throws(() => T.render(ctx, 1024, 1024, recipe({ text: 'X'.repeat(129), size: .5, boxWidth: .05 })), /wrapped line limit/);
  assert.equal(draws.length, 0); assert.equal(stack.length, 0); assert.equal(ctx.font, '17px sentinel');
});
test('alignment is inside a centered box; rotation and corners use the center anchor', () => {
  const { ctx } = context();
  for (const align of ['left', 'center', 'right']) {
    const plan = T.layout(ctx, 400, 200, recipe({ text: 'Hi', x: .25, y: .75, align, rotation: 90, boxWidth: .5 }));
    assert.deepEqual(plan.anchor, { x: 100, y: 150 }); assert.equal(plan.boxBounds.left, -100); assert.equal(plan.boxBounds.right, 100);
    assert.ok(Math.abs(plan.lines[0].x - (align === 'left' ? -100 : align === 'right' ? 100 - plan.lines[0].width : -plan.lines[0].width / 2)) < 1e-9);
    assert.ok(Math.abs(plan.corners[0].x - (100 - plan.bounds.top)) < 1e-9);
    assert.ok(Math.abs(plan.corners[0].y - (150 + plan.bounds.left)) < 1e-9);
  }
});
test('render resets source-over/transform/styles and draws round outline behind fill, then restores state', () => {
  const { ctx, draws, stack } = context(), before = { ...ctx };
  const r = recipe({ text: 'a\nb', rotation: 17, opacity: .4, outlineWidth: .1, color: '#123456', outlineColor: '#abcdef', shadow: true });
  const plan = T.render(ctx, 400, 300, r);
  assert.deepEqual(draws[0], { call: 'setTransform', args: [1, 0, 0, 1, 0, 0] });
  assert.deepEqual(draws[1], { call: 'translate', args: [200, 150] });
  assert.deepEqual(draws[2], { call: 'rotate', args: [plan.radians] });
  assert.deepEqual(draws.slice(3).map(d => d.call), ['strokeText', 'fillText', 'strokeText', 'fillText']);
  for (const draw of draws.slice(3)) { assert.equal(draw.alpha, .4); assert.equal(draw.composite, 'source-over'); assert.equal(draw.filter, 'none'); }
  assert.equal(draws[3].join, 'round'); assert.equal(draws[3].color, '#abcdef'); assert.equal(draws[4].color, '#123456');
  assert.deepEqual(ctx, before); assert.equal(stack.length, 0);
});
test('Canvas measure/draw failures restore context; measurement failures draw no pixels', () => {
  let set = context(); set.ctx.measureText = () => ({ width: NaN });
  assert.throws(() => T.render(set.ctx, 320, 240, recipe()), /metrics/); assert.equal(set.draws.length, 0);
  assert.equal(set.ctx.font, '17px sentinel'); assert.equal(set.stack.length, 0);
  set = context(); set.ctx.fillText = () => { throw Error('runtime failure'); };
  assert.throws(() => T.render(set.ctx, 320, 240, recipe()), /runtime failure/);
  assert.equal(set.ctx.font, '17px sentinel'); assert.equal(set.stack.length, 0);
});
