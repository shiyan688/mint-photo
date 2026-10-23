'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const O = require('../app/src/main/assets/local-tone-operation.js');
const L = require('../app/src/main/assets/local-adjustments.js');
const M = require('../app/src/main/assets/manual-tools.js');
const REV = 'synthetic:immutable-source:v1';
const clone = value => JSON.parse(JSON.stringify(value));
const point = (x, y) => ({ x, y });
const brush = (override = {}) => ({ kind: 'brush', mode: 'add', radius: .18, points: [point(.5, .5)], ...override });
const lasso = (override = {}) => ({ kind: 'lasso', mode: 'add', points: [point(.2, .2), point(.8, .2), point(.8, .8), point(.2, .8)], ...override });
const selection = (override = {}) => ({ version: 1, sourceRevision: REV, base: 'none', inverted: false,
  feather: 0, commands: [], ...override });
const radial = () => ({ kind: 'radial', cx: .5, cy: .5, rx: .4, ry: .35, feather: .3 });
const linear = (override = {}) => ({ kind: 'linear', x0: .2, y0: .3, x1: .8, y1: .7, reverse: false, ...override });
const selected = (override = {}) => ({ kind: 'selection', selection: selection(override) });
const settings = (override = {}) => ({ exposure: 0, contrast: 0, saturation: 0, temperature: 0, ...override });
const layer = (override = {}) => ({ id: 'layer-1', name: '局部调色', enabled: true, opacity: .8,
  sourceRevision: REV, adjustments: settings({ exposure: 16 }), mask: radial(), ...override });
const operation = (layers = [layer()]) => ({ type: 'local-tone', sourceRevision: REV, layers });
function picture(width = 65, height = 49, ArrayType = Uint8ClampedArray) {
  const data = new ArrayType(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    data.set([30 + x % 130, 60 + y % 150, 100 + (x + y) % 100, y === 0 ? 0 : (x % 3 ? 255 : 81)], i);
  }
  return { width, height, data };
}
function assertSourceSafe(source, before, output) {
  assert.deepEqual(source.data, before);
  if (!output) return;
  for (let i = 0; i < before.length; i += 4) {
    assert.equal(output.data[i + 3], before[i + 3]);
    if (before[i + 3] === 0) assert.deepEqual(Array.from(output.data.subarray(i, i + 4)), Array.from(before.subarray(i, i + 4)));
  }
}
function browser(files = ['manual-tools', 'local-adjustments', 'local-tone-operation']) {
  const context = vm.createContext({});
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/src/main/assets/' + file + '.js'), 'utf8'), context);
  return context;
}

test('CommonJS and browser UMD expose the same strict API and bounded limits', () => {
  assert.deepEqual(Object.keys(O), ['LIMITS', 'validate', 'changed', 'apply']);
  assert.equal(O.LIMITS.pixels, 16777216); assert.equal(O.LIMITS.edge, 16384);
  assert.equal(O.LIMITS.layers, 8); assert.equal(O.LIMITS.selectionCommands, 128); assert.equal(O.LIMITS.selectionPoints, 4096);
  assert.ok(Object.isFrozen(O)); assert.ok(Object.isFrozen(O.LIMITS));
  const ctx = browser();
  assert.equal(vm.runInContext('typeof MintLocalToneOperation.apply', ctx), 'function');
  assert.equal(vm.runInContext('Object.isFrozen(MintLocalToneOperation)', ctx), true);
  assert.equal(require('../app/src/main/assets/manual-tools.cjs'), M);
});
test('validation has stable JSON round trips and independent deep selection snapshots', () => {
  const input = operation([layer({ mask: selected({ commands: [brush(), lasso()], feather: .03 }) }),
    layer({ id: 'two', mask: linear(), adjustments: settings({ saturation: -100, temperature: 100 }) })]);
  const saved = O.validate(input), roundtrip = O.validate(clone(saved));
  assert.deepEqual(saved, input); assert.deepEqual(roundtrip, saved);
  input.layers[0].mask.selection.commands[0].points[0].x = 0;
  input.layers[0].adjustments.exposure = 100; input.layers[1].name = 'changed';
  assert.equal(saved.layers[0].mask.selection.commands[0].points[0].x, .5);
  assert.equal(saved.layers[0].adjustments.exposure, 16); assert.equal(saved.layers[1].name, '局部调色');
  saved.layers[0].mask.selection.commands[1].points[0].y = .9;
  assert.equal(roundtrip.layers[0].mask.selection.commands[1].points[0].y, .2);
});
test('history changed preserves intentionally created neutral, disabled and empty-mask layers', () => {
  assert.equal(O.changed(operation([])), false);
  for (const item of [layer(), layer({ enabled: false }), layer({ opacity: 0 }),
    layer({ adjustments: settings() }), layer({ mask: selected() })]) assert.equal(O.changed(operation([item])), true);
  assert.throws(() => O.changed({ ...operation(), unsupported: true }));
});
test('all shared mask types and extrema normalize identically to desktop schema', () => {
  for (const mask of [radial(), linear(), linear({ reverse: true }), selected(),
    selected({ base: 'all', inverted: true, feather: .1, commands: [brush({ mode: 'subtract', radius: .5 })] })]) {
    const layers = [layer({ mask, adjustments: settings({ exposure: -100, contrast: 100, saturation: -100, temperature: 100 }) })];
    assert.deepEqual(O.validate(operation(layers)).layers, L.validateLayers(layers, { sourceRevision: REV }));
  }
});
test('invalid operation, layer, adjustment and mask schemas reject without coercion', () => {
  const bad = [null, undefined, [], {}, { ...operation(), type: 'tone' }, { ...operation(), sourceRevision: '' },
    { ...operation(), sourceRevision: 'a\n' }, { ...operation(), sourceRevision: 'x'.repeat(161) },
    { ...operation(), extra: 1 }, operation([layer({ id: '' })]), operation([layer({ name: '' })]),
    operation([layer({ enabled: 1 })]), operation([layer({ opacity: -1 })]), operation([layer({ opacity: Infinity })]),
    operation([layer({ adjustments: { ...settings(), surprise: 1 } })]), operation([layer({ adjustments: settings({ exposure: NaN }) })]),
    operation([layer({ adjustments: settings({ contrast: 101 }) })]), operation([layer({ adjustments: settings({ temperature: '1' }) })]),
    operation([layer({ mask: null })]), operation([layer({ mask: { ...radial(), kind: 'unknown' } })]),
    operation([layer({ mask: { ...radial(), rx: .001 } })]), operation([layer({ mask: { ...radial(), feather: 0 } })]),
    operation([layer({ mask: { ...radial(), cx: 2 } })]), operation([layer({ mask: linear({ x1: .2, y1: .3 }) })]),
    operation([layer({ mask: linear({ reverse: 'false' }) })]), operation([layer({ mask: { ...radial(), extra: 1 } })]),
    operation([layer(), layer()]), operation([layer({ mask: { kind: 'selection', selection: null } })])];
  for (const input of bad) assert.throws(() => O.validate(input));
  let coerced = 0;
  assert.throws(() => O.validate(operation([layer({ adjustments: settings({ exposure: { valueOf() { coerced++; return 1; } } }) })])));
  assert.equal(coerced, 0);
});
test('strict own data rejects inherited, accessor, symbol, nonenumerable and unsafe prototypes at every depth', () => {
  let calls = 0;
  const targets = [
    op => [op, 'type'], op => [op, 'layers'], op => [op.layers[0], 'name'],
    op => [op.layers[0].adjustments, 'exposure'], op => [op.layers[0].mask, 'kind'],
    op => [op.layers[0].mask, 'selection'], op => [op.layers[0].mask.selection, 'version'],
    op => [op.layers[0].mask.selection.commands[0], 'kind'],
    op => [op.layers[0].mask.selection.commands[0].points[0], 'x']
  ];
  for (const target of targets) {
    for (const mutation of ['getter', 'hidden', 'symbol', 'prototype', 'missing']) {
      const op = operation([layer({ mask: selected({ commands: [brush()] }) })]);
      const [object, key] = target(op);
      if (mutation === 'getter') Object.defineProperty(object, key, { enumerable: true, get() { calls++; return null; } });
      if (mutation === 'hidden') Object.defineProperty(object, key, { enumerable: false });
      if (mutation === 'symbol') object[Symbol('extra')] = true;
      if (mutation === 'prototype') Object.setPrototypeOf(object, { injected: true });
      if (mutation === 'missing') delete object[key];
      assert.throws(() => O.validate(op), mutation + ':' + key);
    }
  }
  assert.equal(calls, 0);
  const inherited = Object.create(operation()); assert.throws(() => O.validate(inherited));
  const nullProto = Object.assign(Object.create(null), operation()); assert.deepEqual(O.validate(nullProto), operation());
});
test('arrays must be dense own data without extra fields or custom prototypes', () => {
  let calls = 0;
  const targets = [op => [op, 'layers'], op => [op.layers[0].mask.selection, 'commands'],
    op => [op.layers[0].mask.selection.commands[0], 'points']];
  for (const target of targets) for (const mutation of ['sparse', 'getter', 'hidden', 'symbol', 'extra', 'prototype']) {
    const op = operation([layer({ mask: selected({ commands: [brush()] }) })]), [object, key] = target(op), values = object[key];
    if (mutation === 'sparse') delete values[0];
    if (mutation === 'getter') Object.defineProperty(values, 0, { enumerable: true, get() { calls++; return null; } });
    if (mutation === 'hidden') Object.defineProperty(values, 0, { enumerable: false });
    if (mutation === 'symbol') values[Symbol('x')] = 1;
    if (mutation === 'extra') values.extra = 1;
    if (mutation === 'prototype') Object.setPrototypeOf(values, { inherited: true });
    assert.throws(() => O.validate(op), mutation + ':' + key);
  }
  assert.equal(calls, 0);
});
test('selection recipe version, geometry and all revision boundaries are mandatory', () => {
  for (const override of [{ version: 2 }, { base: 'invalid' }, { inverted: 1 }, { feather: -.01 }, { feather: .11 },
    { commands: [brush({ radius: .001 })] }, { commands: [brush({ mode: 'replace' })] },
    { commands: [brush({ points: [] })] }, { commands: [brush({ points: [point(Infinity, .5)] })] },
    { commands: [lasso({ points: [point(.1, .1), point(.5, .5), point(.9, .9)] })] }, { sourceRevision: 'other' }])
    assert.throws(() => O.validate(operation([layer({ mask: selected(override) })])));
  assert.throws(() => O.validate(operation([layer({ sourceRevision: 'other' })])), /another source revision/);
  assert.throws(() => O.apply(picture(), operation(), { sourceRevision: 'other' }), /another source revision/);
  assert.doesNotThrow(() => O.apply(picture(), operation(), { sourceRevision: REV }));
});
test('aggregate budgets span all layers including disabled and neutral selection snapshots', () => {
  const layers = Array.from({ length: 8 }, (_, i) => layer({ id: String(i), mask: selected({ commands: Array.from({ length: 16 }, () => brush()) }) }));
  assert.equal(O.validate(operation(layers)).layers.length, 8);
  assert.throws(() => O.validate(operation([...layers, layer({ id: 'ninth' })])), /count/);
  layers[7].mask.selection.commands.push(brush()); layers[7].enabled = false;
  assert.throws(() => O.validate(operation(layers)), /aggregate selection commands/);
  const large = operation([layer({ mask: selected({ commands: [brush({ points: Array.from({ length: 2048 }, () => point(.5, .5)) })] }) }),
    layer({ id: 'two', adjustments: settings(), mask: selected({ commands: [brush({ points: Array.from({ length: 2048 }, () => point(.5, .5)) })] }) })]);
  assert.doesNotThrow(() => O.validate(large));
  large.layers[1].mask.selection.commands[0].points.push(point(.5, .5));
  assert.throws(() => O.validate(large), /aggregate selection points/);
});
test('radial, gradient, selection and combined ordered pixels exactly equal unchanged desktop math', () => {
  const masks = [radial(), linear(), linear({ reverse: true }),
    selected({ commands: [brush(), lasso({ mode: 'subtract' })], feather: .025, inverted: true }),
    selected({ commands: [lasso(), brush({ mode: 'subtract', radius: .06 })], feather: .035 })];
  for (const ArrayType of [Uint8Array, Uint8ClampedArray]) for (const mask of masks) {
    const im = picture(65, 49, ArrayType), before = im.data.slice();
    const layers = [layer({ mask, adjustments: settings({ exposure: 18, contrast: -12, saturation: 27, temperature: 9 }) })];
    const output = O.apply(im, operation(layers)), expected = L.apply(im, layers, { sourceRevision: REV });
    assert.deepEqual(output, expected); assertSourceSafe(im, before, output);
  }
  const im = picture(), before = im.data.slice(), layers = masks.map((mask, i) => layer({ id: String(i), mask,
    opacity: .3 + i * .1, adjustments: settings({ exposure: i * 3 - 4, contrast: 12 - i, saturation: -5, temperature: i * 2 }) }));
  const output = O.apply(im, operation(layers));
  assert.deepEqual(output, L.apply(im, layers, { sourceRevision: REV })); assertSourceSafe(im, before, output);
  assert.notDeepEqual(output.data, before);
});
test('zero parameters, visibility, opacity and known or raster-empty selections are byte-exact', () => {
  const im = picture(), before = im.data.slice();
  const cases = [[], [layer({ adjustments: settings() })], [layer({ enabled: false })], [layer({ opacity: 0 })],
    [layer({ mask: selected() })], [layer({ mask: selected({ base: 'all', inverted: true, feather: .1 }) })],
    [layer({ mask: selected({ commands: [brush({ mode: 'subtract' })], feather: .02 }) })]];
  for (const layers of cases) {
    const out = O.apply(im, operation(layers)); assert.deepEqual(out.data, before); assertSourceSafe(im, before, out);
  }
});
test('selected weight zero stays exact, feather mixes only selected pixels, all alpha and hidden RGB survive', () => {
  const im = picture(101, 81), before = im.data.slice();
  const mask = selected({ commands: [lasso()], feather: .05 });
  const weights = M.rasterizeSelection(im.width, im.height, mask.selection, { sourceRevision: REV });
  const out = O.apply(im, operation([layer({ mask, opacity: 1, adjustments: settings({ exposure: 30 }) })]));
  let mixed = 0, changed = 0, untouched = 0;
  for (let p = 0; p < weights.length; p++) {
    const i = p * 4;
    if (weights[p] === 0) { assert.deepEqual(out.data.subarray(i, i + 4), before.subarray(i, i + 4)); untouched++; }
    else if (before[i + 3]) {
      if (weights[p] < 1) mixed++;
      if (out.data[i] !== before[i]) changed++;
    }
  }
  assert.ok(mixed > 0 && changed > 0 && untouched > 0); assertSourceSafe(im, before, out);
});
test('selection coverage keeps normalized lasso geometry across preview and full resolution', () => {
  const mask = selected({ commands: [lasso()] }), op = operation([layer({ mask, opacity: 1, adjustments: settings({ exposure: 40 }) })]);
  function flat(n) { const im = picture(n, n); for (let i = 0; i < im.data.length; i += 4) im.data.set([80, 100, 120, 255], i); return im; }
  const small = O.apply(flat(51), op), large = O.apply(flat(101), op);
  for (let y = 0; y < 51; y++) for (let x = 0; x < 51; x++) {
    const a = (y * 51 + x) * 4, b = (y * 2 * 101 + x * 2) * 4;
    assert.deepEqual(small.data.subarray(a, a + 4), large.data.subarray(b, b + 4));
  }
});
test('radial and gradient sample centers keep identical normalized coordinates across odd scale factors', () => {
  for (const mask of [radial(), linear(), linear({ reverse: true })]) {
    const make = n => { const im = picture(n, n); for (let i = 0; i < im.data.length; i += 4) im.data.set([80, 100, 120, 255], i); return im; };
    const op = operation([layer({ mask, opacity: 1 })]), small = O.apply(make(17), op), large = O.apply(make(51), op);
    for (let y = 0; y < 17; y++) for (let x = 0; x < 17; x++) {
      const a = (y * 17 + x) * 4, b = ((3 * y + 1) * 51 + 3 * x + 1) * 4;
      assert.deepEqual(small.data.subarray(a, a + 4), large.data.subarray(b, b + 4));
    }
  }
});
test('cancellation before, between and after layers never exposes partial output or mutates source', () => {
  const op = operation([layer(), layer({ id: 'second', mask: linear() })]);
  for (const at of [1, 2, 3, 4]) {
    const im = picture(), before = im.data.slice(); let calls = 0, output = null;
    assert.throws(() => { output = O.apply(im, op, { shouldCancel: () => ++calls === at }); },
      { name: 'AbortError', code: 'LOCAL_TONE_CANCELLED' });
    assert.equal(calls, at); assert.equal(output, null); assertSourceSafe(im, before);
  }
  let calls = 0;
  O.apply(picture(), op, { shouldCancel: () => { calls++; return false; } });
  assert.equal(calls, 4); // This adapter explicitly does not claim within-loop cancellation.
});
test('options never invoke inherited or accessor cancellation hooks', () => {
  let calls = 0;
  const inherited = Object.create({ shouldCancel() { calls++; return true; } });
  const accessor = {}; Object.defineProperty(accessor, 'shouldCancel', { enumerable: true, get() { calls++; return () => false; } });
  const revisionAccessor = {}; Object.defineProperty(revisionAccessor, 'sourceRevision', { enumerable: true, get() { calls++; return REV; } });
  for (const options of [inherited, accessor, revisionAccessor, null, { shouldCancel: false },
    { sourceRevision: undefined }, { extra: 1 }, { [Symbol('hidden')]: true }])
    assert.throws(() => O.apply(picture(), operation(), options));
  assert.equal(calls, 0);
});
test('cancellation callback cannot change the validated operation snapshot mid-render', () => {
  const input = operation(), expected = O.apply(picture(), clone(input));
  let calls = 0;
  const result = O.apply(picture(), input, { shouldCancel() {
    if (++calls === 1) { input.layers[0].adjustments.exposure = 100; input.layers[0].mask.cx = 0; input.layers.push(layer({ id: 'injected' })); }
    return false;
  } });
  assert.deepEqual(result, expected);
});
test('image validation enforces 16MP/16K edges, own safe metadata and exact RGBA length', () => {
  for (const im of [null, {}, { width: 16385, height: 1, data: new Uint8Array() },
    { width: 4097, height: 4096, data: new Uint8Array() }, { width: 1, height: 0, data: new Uint8Array() },
    { width: 1.5, height: 1, data: new Uint8Array(4) }, { width: 1, height: 1, data: new Uint8Array(3) },
    { width: 1, height: 1, data: [1, 2, 3, 255] }, { width: 1, height: 1, data: new Float32Array(4) }])
    assert.throws(() => O.apply(im, operation([])));
  assert.doesNotThrow(() => O.apply(picture(16384, 1), operation([])));
  let calls = 0;
  for (const key of ['width', 'height', 'data']) {
    const im = picture(); Object.defineProperty(im, key, { enumerable: true, get() { calls++; return 1; } });
    assert.throws(() => O.apply(im, operation()));
  }
  assert.equal(calls, 0);
});
test('typed-array own metadata and iterator accessors cannot run during rendering', () => {
  const im = picture(), before = im.data.slice(); let calls = 0;
  for (const key of ['length', 'buffer', 'byteOffset', Symbol.iterator])
    Object.defineProperty(im.data, key, { get() { calls++; throw Error('unsafe getter'); } });
  const out = O.apply(im, operation());
  assert.equal(calls, 0); assert.notDeepEqual(out.data, before);
  assert.deepEqual(new Uint8ClampedArray(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'buffer').get.call(im.data)), before);
});
test('descriptor-copy records cannot invoke inherited Object.prototype setters', () => {
  const input = operation(), im = picture(), expected = O.apply(im, input); let calls = 0, output, saved;
  // Use keys not assigned dynamically by the shared implementation, so this
  // specifically proves the adapter's canonical copies have null prototypes.
  const keys = ['type', 'layers', 'sourceRevision', 'adjustments', 'mask', 'width', 'height', 'data', 'shouldCancel'];
  try {
    for (const key of keys) Object.defineProperty(Object.prototype, key, { configurable: true, set() { calls++; } });
    saved = O.validate(input);
    output = O.apply(im, input, { sourceRevision: REV, shouldCancel: () => false });
  } finally { for (const key of keys) delete Object.prototype[key]; }
  assert.equal(calls, 0); assert.deepEqual(saved, input); assert.deepEqual(output, expected);
});
test('polluted shared-validator assignment targets reject without invoking setters', () => {
  const input = operation([layer({ mask: selected({ commands: [brush()] }) })]);
  for (const key of ['exposure', 'contrast', 'saturation', 'temperature', 'radius', 'points']) {
    let calls = 0, error;
    try {
      Object.defineProperty(Object.prototype, key, { configurable: true, set() { calls++; } });
      try { O.validate(input); } catch (e) { error = e; }
    } finally { delete Object.prototype[key]; }
    assert.equal(calls, 0); assert.match(error.message, /Unsafe shared/);
  }
  const im = picture(), before = im.data.slice(); let error, output = null;
  try {
    try { output = O.apply(im, input, { shouldCancel() {
      Object.defineProperty(Object.prototype, 'exposure', { configurable: true, set() { throw Error('unsafe setter'); } });
      return false;
    } }); } catch (e) { error = e; }
  } finally { delete Object.prototype.exposure; }
  assert.match(error.message, /Unsafe shared/); assert.equal(output, null); assertSourceSafe(im, before);
});
test('shared or detached RGBA storage rejects before alias construction or callbacks', () => {
  let calls = 0;
  const options = { shouldCancel: () => { calls++; return false; } };
  for (const ArrayType of [Uint8Array, Uint8ClampedArray]) {
    const shared = new ArrayType(new SharedArrayBuffer(4)); shared.set([1, 2, 3, 255]);
    assert.throws(() => O.apply({ width: 1, height: 1, data: shared }, operation([]), options), /Shared RGBA/);
    assert.deepEqual(Array.from(shared), [1, 2, 3, 255]);
    const detached = new ArrayType(4); structuredClone(detached.buffer, { transfer: [detached.buffer] });
    assert.throws(() => O.apply({ width: 1, height: 1, data: detached }, operation([]), options), /Detached/);
  }
  assert.equal(calls, 0);
});
test('missing browser dependencies reject even neutral or explicit-empty selection operations', () => {
  const noLocal = browser(['local-tone-operation']);
  noLocal.inputJSON = JSON.stringify(operation([]));
  assert.throws(() => vm.runInContext('MintLocalToneOperation.validate(JSON.parse(inputJSON))', noLocal), /unavailable/);
  const noManual = browser(['local-adjustments', 'local-tone-operation']);
  for (const item of [layer({ mask: selected(), adjustments: settings() }), layer({ mask: selected({ commands: [brush()] }) })]) {
    noManual.inputJSON = JSON.stringify(operation([item]));
    assert.throws(() => vm.runInContext('MintLocalToneOperation.validate(JSON.parse(inputJSON))', noManual), /unavailable/);
  }
});
test('browser module matches CommonJS pixel output and late layer errors cannot mutate original', () => {
  const ctx = browser(), op = operation([layer({ mask: selected({ commands: [brush(), lasso()], feather: .02 }) })]), im = picture(17, 13);
  ctx.inputJSON = JSON.stringify(op); ctx.imageJSON = JSON.stringify({ width: im.width, height: im.height, data: Array.from(im.data) });
  const actual = vm.runInContext(`(() => { const im = JSON.parse(imageJSON); im.data = new Uint8ClampedArray(im.data);
    return Array.from(MintLocalToneOperation.apply(im, JSON.parse(inputJSON), {sourceRevision: ${JSON.stringify(REV)}}).data); })()`, ctx);
  assert.deepEqual(Array.from(actual), Array.from(O.apply(im, op).data));
  ctx.inputJSON = JSON.stringify(operation([layer(), layer({ id: 'second', mask: linear() })]));
  assert.equal(vm.runInContext(`(() => { const original = MintLocalAdjustments, im = JSON.parse(imageJSON); im.data = new Uint8ClampedArray(im.data);
    const before = Array.from(im.data).join(','); let calls = 0, output = null;
    globalThis.MintLocalAdjustments = { validateLayers: original.validateLayers, apply(...args) { if (++calls === 2) throw Error('layer failure'); return original.apply(...args); } };
    try { output = MintLocalToneOperation.apply(im, JSON.parse(inputJSON)); } catch (error) { if (error.message !== 'layer failure') throw error; }
    return calls === 2 && output === null && before === Array.from(im.data).join(','); })()`, ctx), true);
});
