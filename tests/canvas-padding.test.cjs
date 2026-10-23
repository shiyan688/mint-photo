'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const padding = require('../app/src/main/assets/canvas-padding.js');
const sourceCode = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/canvas-padding.js'), 'utf8');

const recipe = (changes = {}) => Object.assign(padding.defaults(), changes);
function fixture(width = 5, height = 3, Type = Uint8ClampedArray) {
  const data = new Type(width * height * 4);
  for (let i = 0; i < data.length; i++) data[i] = (i * 73 + 19) % 256;
  for (let i = 3; i < data.length; i += 12) data[i] = 0; // Preserve nonzero RGB underneath alpha zero.
  return { width, height, data };
}
function nullRecord(value) { return Object.assign(Object.create(null), value); }
function untouched(im, fn) {
  const before = Array.from(im.data);
  fn();
  assert.deepEqual(Array.from(im.data), before);
}

// Independent per-output-pixel oracle. Does not call core defaults/validate/plan/apply.
function reference(im, r) {
  const unit = Math.min(im.width, im.height);
  const p = Object.fromEntries(['top', 'right', 'bottom', 'left'].map(k => [k, Math.floor(unit * r[k] + 0.5)]));
  const width = im.width + p.left + p.right, height = im.height + p.top + p.bottom;
  const color = Number('0x' + r.color.substring(1));
  const alpha = Math.floor(r.opacity * 255 + 0.5);
  const border = alpha ? [color >>> 16, (color >>> 8) & 255, color & 255, alpha] : [0, 0, 0, 0];
  const data = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = x - p.left, sy = y - p.top;
      if (sx >= 0 && sx < im.width && sy >= 0 && sy < im.height) {
        const i = 4 * (sy * im.width + sx);
        data.push(im.data[i], im.data[i + 1], im.data[i + 2], im.data[i + 3]);
      } else data.push(...border);
    }
  }
  return { width, height, data };
}
function sameAsReference(im, r, opts) {
  const expected = reference(im, r);
  const actual = padding.apply(im, r, opts);
  assert.equal(actual.width, expected.width);
  assert.equal(actual.height, expected.height);
  assert.ok(actual.data instanceof Uint8ClampedArray);
  assert.deepEqual(Array.from(actual.data), expected.data);
  return actual;
}

test('CommonJS API, immutable ceilings, independent defaults, and exact plan keys', () => {
  assert.deepEqual(Object.keys(padding), ['version', 'LIMITS', 'defaults', 'validate', 'measure', 'plan', 'apply']);
  assert.ok(Object.isFrozen(padding));
  assert.ok(Object.isFrozen(padding.LIMITS));
  assert.deepEqual(padding.LIMITS, { maxPixels: 67108864, maxEdge: 16384 });
  const a = padding.defaults(), b = padding.defaults();
  assert.notEqual(a, b);
  a.left = 0.5;
  assert.equal(b.left, 0);
  assert.deepEqual(padding.plan(5, 3, b), {
    inputSize: { width: 5, height: 3 }, outputSize: { width: 5, height: 3 },
    padding: { top: 0, right: 0, bottom: 0, left: 0 }
  });
});

test('UMD browser-global and AMD loading need no DOM, canvas, or require', () => {
  const globalContext = vm.createContext({});
  vm.runInContext(sourceCode, globalContext);
  assert.equal(vm.runInContext('MintCanvasPadding.plan(3, 2, MintCanvasPadding.defaults()).outputSize.width', globalContext), 3);
  let amdApi;
  const define = (deps, factory) => { assert.deepEqual(Array.from(deps), []); amdApi = factory(); };
  define.amd = {};
  vm.runInNewContext(sourceCode, { define });
  assert.equal(amdApi.version, '1.0.0');
  assert.equal(amdApi.defaults().top, 0);
});

test('zero padding is byte-exact but independently allocated, including hidden RGB', () => {
  for (const Type of [Uint8Array, Uint8ClampedArray]) {
    const im = fixture(7, 4, Type), before = Array.from(im.data);
    const out = sameAsReference(im, recipe());
    assert.notEqual(out, im);
    assert.notEqual(out.data, im.data);
    assert.notEqual(out.data.buffer, im.data.buffer);
    assert.deepEqual(Array.from(out.data), before);
    out.data[0] ^= 255;
    assert.deepEqual(Array.from(im.data), before);
  }
});

test('quantization uses input short edge independently, with half pixels rounded upward', () => {
  const r = recipe({ top: 0.5, right: 0.25, bottom: 0.1, left: 0.4 });
  assert.deepEqual(padding.plan(11, 5, r), {
    inputSize: { width: 11, height: 5 }, outputSize: { width: 14, height: 9 },
    padding: { top: 3, right: 1, bottom: 1, left: 2 }
  });
  assert.deepEqual(padding.plan(5, 11, r), {
    inputSize: { width: 5, height: 11 }, outputSize: { width: 8, height: 15 },
    padding: { top: 3, right: 1, bottom: 1, left: 2 }
  });
  assert.equal(padding.plan(1, 1, recipe({ left: 0.5 })).padding.left, 1);
  assert.equal(padding.plan(1, 1, recipe({ left: 0.499999999999 })).padding.left, 0);
  const tiny = sameAsReference(fixture(3, 2), recipe({ top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 }));
  assert.equal(tiny.width, 3);
  assert.equal(tiny.height, 2);
});

test('asymmetric padding copies each source byte at exactly the left/top offset', () => {
  for (const [width, height] of [[11, 5], [5, 11], [1, 7], [8, 1]]) {
    const im = fixture(width, height);
    untouched(im, () => sameAsReference(im, recipe({ top: 0.5, right: 0.25, bottom: 0.1, left: 0.4, color: '#12aBef', opacity: 0.5 })));
  }
});

test('padding alpha is nearest RGBA8, unpremultiplied, and canonical zero below half a byte', () => {
  for (const opacity of [0, Number.MIN_VALUE, 0.001, 0.5 / 255, 0.25, 0.5, 0.75, 1]) {
    const im = fixture(2, 2);
    const r = recipe({ top: 0.5, right: 0.5, bottom: 0.5, left: 0.5, color: '#f18a73', opacity });
    const out = sameAsReference(im, r);
    const alpha = Math.round(opacity * 255);
    assert.deepEqual(Array.from(out.data.slice(0, 4)), alpha ? [241, 138, 115, alpha] : [0, 0, 0, 0]);
    assert.equal(out.data[4 * (out.width + 1)], im.data[0]);
    assert.equal(out.data[4 * (out.width + 1) + 3], 0);
  }
});

test('repeated padding recomputes against the new short edge and retains earlier bytes', () => {
  const r = recipe({ top: 0.5, right: 0.5, bottom: 0.5, left: 0.5, color: '#123456', opacity: 0.5 });
  let im = fixture(3, 5);
  for (let iteration = 0; iteration < 4; iteration++) {
    const before = Array.from(im.data);
    const next = sameAsReference(im, r);
    assert.deepEqual(Array.from(im.data), before);
    im = next;
  }
  assert.equal(im.width, 63);
  assert.equal(im.height, 65);
});

test('seeded reference comparison over 400 dimensions, fractions, colors, and opacities', () => {
  let state = 0x93c7a152;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  for (let n = 0; n < 400; n++) {
    const im = fixture(1 + Math.floor(random() * 37), 1 + Math.floor(random() * 37), n % 2 ? Uint8Array : Uint8ClampedArray);
    const r = recipe({
      top: random() / 2, right: random() / 2, bottom: random() / 2, left: random() / 2,
      color: '#' + Math.floor(random() * 0x1000000).toString(16).padStart(6, '0'),
      opacity: n % 7 === 0 ? 0 : random()
    });
    untouched(im, () => sameAsReference(im, r));
  }
});

test('validate accepts JSON/null-prototype/frozen data and returns a canonical copy', () => {
  const imported = JSON.parse('{"version":1,"top":0,"right":0.5,"bottom":0.25,"left":0,"color":"#aBcDeF","opacity":0.8}');
  const out = padding.validate(Object.freeze(imported));
  assert.notEqual(out, imported);
  assert.equal(out.color, '#abcdef');
  assert.equal(imported.color, '#aBcDeF');
  assert.deepEqual(padding.validate(nullRecord(imported)), out);
  const negativeZero = padding.validate(recipe({ top: -0, right: -0, bottom: -0, left: -0, opacity: -0 }));
  for (const key of ['top', 'right', 'bottom', 'left', 'opacity']) assert.ok(!Object.is(negativeZero[key], -0));
  sameAsReference(nullRecord(fixture()), nullRecord(recipe()), nullRecord({ maxPixels: 100, maxEdge: 10 }));
});

test('recipe requires every own enumerable field and rejects hidden, symbol, unknown, and inherited fields', () => {
  for (const key of Object.keys(recipe())) {
    const missing = recipe(); delete missing[key];
    assert.throws(() => padding.validate(missing), /missing/);
    const hidden = recipe(); Object.defineProperty(hidden, key, { enumerable: false });
    assert.throws(() => padding.validate(hidden), /unsupported/);
  }
  for (const key of ['unknown', '__proto__', 'toJSON']) {
    const extra = recipe(); Object.defineProperty(extra, key, { value: true, enumerable: true });
    assert.throws(() => padding.validate(extra), /unsupported/);
  }
  const extraHidden = recipe(); Object.defineProperty(extraHidden, 'secret', { value: 1 });
  assert.throws(() => padding.validate(extraHidden), /unsupported/);
  assert.throws(() => padding.validate({ ...recipe(), [Symbol('x')]: 1 }), /unsupported/);
  assert.throws(() => padding.validate(Object.create(recipe())), /plain data/);
  assert.throws(() => padding.validate(Object.assign(Object.create({ arbitrary: 1 }), recipe())), /plain data/);
  for (const invalid of [undefined, null, [], new Date(), () => recipe(), 'recipe', 1, true]) {
    assert.throws(() => padding.validate(invalid), /plain data/);
  }
});

test('rejects every unsupported recipe scalar without coercion', () => {
  for (const key of ['top', 'right', 'bottom', 'left']) {
    for (const bad of [-1, -Number.MIN_VALUE, 0.5000000001, NaN, Infinity, -Infinity, '0.1', null, undefined, {}, new Number(0.2)]) {
      assert.throws(() => padding.validate(recipe({ [key]: bad })));
    }
  }
  for (const bad of [-0.1, 1.0000001, NaN, Infinity, '0.5', null, false]) assert.throws(() => padding.validate(recipe({ opacity: bad })));
  for (const bad of [0, 2, '1', null, true]) assert.throws(() => padding.validate(recipe({ version: bad })));
  for (const bad of ['#fff', '#12345678', '123456', 'red', '#12345g', ' #123456', '#123456 ', '', null, {}, new String('#123456')]) {
    assert.throws(() => padding.validate(recipe({ color: bad })));
  }
  let coerced = 0;
  assert.throws(() => padding.validate(recipe({ left: { valueOf() { coerced++; return 0.2; } } })));
  assert.equal(coerced, 0);
});

test('recipe, options, and image accessors are rejected without invoking them', () => {
  let reads = 0;
  for (const key of Object.keys(recipe())) {
    const r = recipe(); Object.defineProperty(r, key, { get() { reads++; throw Error('executed'); }, enumerable: true });
    assert.throws(() => padding.validate(r), /unsupported/);
  }
  for (const key of ['maxPixels', 'maxEdge', 'shouldCancel']) {
    const o = {}; Object.defineProperty(o, key, { get() { reads++; throw Error('executed'); }, enumerable: true });
    assert.throws(() => padding.plan(1, 1, recipe(), o), /unsupported/);
    assert.throws(() => padding.apply(fixture(1, 1), recipe(), o), /unsupported/);
  }
  for (const key of ['width', 'height', 'data']) {
    const im = fixture(); Object.defineProperty(im, key, { get() { reads++; throw Error('executed'); }, enumerable: true });
    assert.throws(() => padding.apply(im, recipe()), /unsupported/);
  }
  assert.equal(reads, 0);
});

test('optional fields never read inherited getters, even on Object.prototype', () => {
  let reads = 0;
  const keys = ['shouldCancel', 'maxPixels', 'maxEdge'];
  for (const key of keys) Object.defineProperty(Object.prototype, key, { configurable: true, get() { reads++; throw Error('inherited getter'); } });
  try {
    const out = padding.apply(fixture(1, 1), recipe());
    assert.equal(out.width, 1);
    assert.equal(padding.plan(2, 2, recipe(), {}).outputSize.height, 2);
  } finally { for (const key of keys) delete Object.prototype[key]; }
  assert.equal(reads, 0);
  assert.throws(() => padding.plan(1, 1, recipe(), Object.create({ get shouldCancel() { reads++; } })), /plain data/);
  assert.equal(reads, 0);
});

test('options allow only positive integer ceilings that tighten hard limits', () => {
  assert.deepEqual(padding.plan(2, 2, recipe(), { maxPixels: 4, maxEdge: 2 }).outputSize, { width: 2, height: 2 });
  assert.deepEqual(padding.plan(2, 2, recipe(), { maxPixels: 67108864, maxEdge: 16384 }).outputSize, { width: 2, height: 2 });
  for (const [key, limit] of [['maxPixels', 67108864], ['maxEdge', 16384]]) {
    for (const bad of [0, -1, 0.5, limit + 1, NaN, Infinity, '100', null, undefined]) {
      assert.throws(() => padding.plan(1, 1, recipe(), { [key]: bad }));
    }
  }
  for (const bad of [undefined, null, true, 1, 'fn', {}]) assert.throws(() => padding.plan(1, 1, recipe(), { shouldCancel: bad }), /function/);
  for (const bad of [null, [], true, 'options', Object.create({ maxEdge: 1 }), { extra: 1 }, { [Symbol('x')]: 1 }]) {
    assert.throws(() => padding.plan(1, 1, recipe(), bad));
  }
  const hidden = {}; Object.defineProperty(hidden, 'maxEdge', { value: 1 });
  assert.throws(() => padding.plan(1, 1, recipe(), hidden), /unsupported/);
});

test('hard input/output pixel and edge ceilings are inclusive and cannot be loosened', () => {
  assert.equal(padding.plan(8192, 8192, recipe()).outputSize.width, 8192);
  assert.equal(padding.plan(16384, 4096, recipe()).outputSize.width, 16384);
  assert.equal(padding.plan(4096, 4096, recipe({ top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 })).outputSize.width, 8192);
  assert.equal(padding.plan(16383, 2, recipe({ left: 0.5 })).outputSize.width, 16384);
  for (const dims of [[8193, 8192], [16384, 4097], [16385, 1], [1, 16385], [0, 1], [-1, 1], [1.5, 2], [NaN, 1], [Infinity, 1], [Number.MAX_SAFE_INTEGER, 1], ['3', 1]]) {
    assert.throws(() => padding.plan(...dims, recipe()));
  }
  assert.throws(() => padding.plan(8192, 8192, recipe({ top: 0.5 })), /output pixel/);
  assert.throws(() => padding.plan(16384, 2, recipe({ left: 0.5 })), /output width/);
  assert.throws(() => padding.plan(2, 16384, recipe({ top: 0.5 })), /output height/);
});

test('mobile 8M/4096 caller limits apply to both input and output', () => {
  const mobile = { maxPixels: 8000000, maxEdge: 4096 };
  assert.deepEqual(padding.plan(4000, 2000, recipe(), mobile).outputSize, { width: 4000, height: 2000 });
  assert.throws(() => padding.plan(4001, 2000, recipe(), mobile), /input pixel/);
  assert.throws(() => padding.plan(4097, 1, recipe(), mobile), /input width/);
  assert.throws(() => padding.plan(4000, 2000, recipe({ top: 0.001 }), mobile), /output pixel/);
  assert.throws(() => padding.plan(4096, 2, recipe({ left: 0.5 }), mobile), /output width/);
});

test('metadata measure accepts an 80MP original and oversized theoretical output without rendering', () => {
  const r = recipe({ top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 });
  assert.deepEqual(padding.measure(10000, 8000, r), {
    inputSize: { width: 10000, height: 8000 }, outputSize: { width: 18000, height: 16000 },
    padding: { top: 4000, right: 4000, bottom: 4000, left: 4000 }
  });
  assert.throws(() => padding.plan(10000, 8000, recipe()), /input pixel/);
  assert.throws(() => padding.plan(10000, 8000, r), /input pixel/);
  assert.equal(padding.plan(2560, 2048, recipe({ top: 0.1 }), { maxPixels: 8000000, maxEdge: 4096 }).outputSize.height, 2253);
});

test('measure and plan share identical dimensions and integer fraction quantization', () => {
  for (const [width, height] of [[1, 1], [11, 5], [5, 11], [67, 48], [2560, 2048]]) {
    const r = recipe({ top: 0.5, right: 0.25, bottom: 0.1, left: 0.4 });
    assert.deepEqual(padding.measure(width, height, r), padding.plan(width, height, r));
  }
  assert.deepEqual(padding.measure(1000000, 1000000, recipe()).outputSize, { width: 1000000, height: 1000000 });
  assert.deepEqual(padding.measure(500000, 500000, recipe({ top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 })).outputSize, { width: 1000000, height: 1000000 });
});

test('measure rejects oversized output edges, unsafe or invalid inputs, and invalid recipes', () => {
  for (const [width, height] of [[1000001, 1], [1, 1000001], [Number.MAX_SAFE_INTEGER, 2], [Number.MAX_SAFE_INTEGER + 1, 1], [1e200, 1e200], [0, 1], [1, -1], [1.1, 2], [NaN, 2], [Infinity, 1], ['1', 1], [null, 1]]) {
    assert.throws(() => padding.measure(width, height, recipe()));
  }
  assert.throws(() => padding.measure(1000000, 1, recipe({ left: 0.5 })), /metadata output width/);
  assert.throws(() => padding.measure(1, 1000000, recipe({ top: 0.5 })), /metadata output height/);
  assert.throws(() => padding.measure(500001, 500001, recipe({ left: 0.5, right: 0.5 })), /metadata output width/);
  let reads = 0;
  const r = recipe(); Object.defineProperty(r, 'left', { enumerable: true, get() { reads++; return 0; } });
  assert.throws(() => padding.measure(10000, 8000, r), /unsupported/);
  assert.equal(reads, 0);
});

test('image schema, byte count, and RGBA8 element type must be exact', () => {
  for (const data of [new Uint8Array(3), new Uint8Array(5), new Uint16Array(2), new Int8Array(4), new Float32Array(1), new DataView(new ArrayBuffer(4)), [1, 2, 3, 4], new ArrayBuffer(4), null, {}]) {
    assert.throws(() => padding.apply({ width: 1, height: 1, data }, recipe()), /RGBA8/);
  }
  for (const key of ['width', 'height', 'data']) {
    const im = fixture(); delete im[key]; assert.throws(() => padding.apply(im, recipe()), /missing/);
    const hidden = fixture(); Object.defineProperty(hidden, key, { enumerable: false }); assert.throws(() => padding.apply(hidden, recipe()), /unsupported/);
  }
  assert.throws(() => padding.apply({ ...fixture(), extra: true }, recipe()), /unsupported/);
  assert.throws(() => padding.apply({ ...fixture(), [Symbol('x')]: 1 }, recipe()), /unsupported/);
  assert.throws(() => padding.apply(Object.assign(Object.create({}), fixture()), recipe()), /plain data/);
});

test('nonzero-offset byte views copy only their exact visible RGBA span', () => {
  for (const Type of [Uint8Array, Uint8ClampedArray]) {
    const backing = new Type(36); backing.fill(254);
    const data = new Type(backing.buffer, 7, 24);
    data.set(fixture(3, 2).data);
    const im = { width: 3, height: 2, data };
    const before = Array.from(backing);
    sameAsReference(im, recipe({ left: 0.5, top: 0.5 }));
    assert.deepEqual(Array.from(backing), before);
  }
});

test('typed array attacker-defined accessors and species are never read', () => {
  const im = fixture(3, 2, Uint8Array);
  const original = new Uint8Array(im.data);
  let reads = 0;
  for (const key of ['buffer', 'byteOffset', 'byteLength', 'length', 'constructor', Symbol.toStringTag]) {
    Object.defineProperty(im.data, key, { get() { reads++; throw Error('unsafe typed getter'); } });
  }
  const out = padding.apply(im, recipe());
  assert.deepEqual(Array.from(out.data), Array.from(original));
  assert.equal(reads, 0);
  const spoof = {}; Object.defineProperty(spoof, Symbol.toStringTag, { get() { reads++; return 'Uint8Array'; } });
  assert.throws(() => padding.apply({ width: 1, height: 1, data: spoof }, recipe()), /RGBA8/);
  assert.throws(() => padding.apply({ width: 1, height: 1, data: new Proxy(new Uint8Array(4), { get() { reads++; } }) }, recipe()), /RGBA8/);
  assert.equal(reads, 0);
});

test('native cross-realm byte arrays are accepted without instanceof assumptions', () => {
  const data = vm.runInNewContext('new Uint8Array([1, 2, 3, 0])');
  assert.deepEqual(Array.from(padding.apply({ width: 1, height: 1, data }, recipe()).data), [1, 2, 3, 0]);
});

test('shared, detached, and out-of-bounds resizable backing stores are rejected', () => {
  if (typeof SharedArrayBuffer === 'function') {
    for (const Type of [Uint8Array, Uint8ClampedArray]) {
      assert.throws(() => padding.apply({ width: 1, height: 1, data: new Type(new SharedArrayBuffer(4)) }, recipe()), /RGBA8/);
    }
    const crossRealm = vm.runInNewContext('new Uint8Array(new SharedArrayBuffer(4))');
    assert.throws(() => padding.apply({ width: 1, height: 1, data: crossRealm }, recipe()), /RGBA8/);
  }
  const detached = fixture(1, 1); structuredClone(detached.data.buffer, { transfer: [detached.data.buffer] });
  assert.throws(() => padding.apply(detached, recipe()), /RGBA8/);
  if (typeof ArrayBuffer.prototype.resize === 'function') {
    const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
    const data = new Uint8Array(buffer, 4, 4); buffer.resize(4);
    assert.throws(() => padding.apply({ width: 1, height: 1, data }, recipe()), /RGBA8/);
  }
});

test('cancellation before work, during rows, and after copying never changes input', () => {
  for (const targetCall of [1, 2, 3, 5]) {
    const im = fixture(8, 49), before = Array.from(im.data);
    let calls = 0;
    assert.throws(() => padding.apply(im, recipe(), { shouldCancel() { return ++calls === targetCall; } }), { name: 'AbortError' });
    assert.equal(calls, targetCall);
    assert.deepEqual(Array.from(im.data), before);
  }
  let calls = 0;
  const im = fixture(8, 49);
  sameAsReference(im, recipe(), { shouldCancel() { calls++; return false; } });
  assert.equal(calls, 5); // Before allocation, before rows 16/32/48, and after all rows.
  assert.throws(() => padding.plan(1, 1, recipe(), { shouldCancel: () => true }), { name: 'AbortError' });
  const failure = new Error('callback failed');
  untouched(im, () => assert.throws(() => padding.apply(im, recipe(), { shouldCancel() { throw failure; } }), e => e === failure));
});

test('source detachment or resize in a cancellation callback cannot yield corrupted output', () => {
  for (const detachAt of [1, 2, 5]) {
    const im = fixture(8, 49);
    let calls = 0;
    assert.throws(() => padding.apply(im, recipe(), { shouldCancel() {
      if (++calls === detachAt) structuredClone(im.data.buffer, { transfer: [im.data.buffer] });
      return false;
    } }), /became unavailable/);
  }
  if (typeof ArrayBuffer.prototype.resize === 'function') {
    const buffer = new ArrayBuffer(4, { maxByteLength: 8 });
    assert.throws(() => padding.apply({ width: 1, height: 1, data: new Uint8Array(buffer) }, recipe(), {
      shouldCancel() { buffer.resize(0); return false; }
    }), /became unavailable/);
  }
});

function trackedContext() {
  const ctx = vm.createContext({});
  vm.runInContext(`
    const OriginalClamped = Uint8ClampedArray;
    let allocations = 0, lastAllocation;
    Uint8ClampedArray = function (length) { allocations++; return lastAllocation = new OriginalClamped(length); };
    Uint8ClampedArray.prototype = OriginalClamped.prototype;
  `, ctx);
  vm.runInContext(sourceCode, ctx);
  vm.runInContext('const core = MintCanvasPadding; const r = core.defaults(); const im = { width: 2, height: 49, data: new Uint8Array(2 * 49 * 4).fill(77) };', ctx);
  return ctx;
}

test('allocation instrumentation proves cancellation and output limits precede output allocation', () => {
  const ctx = trackedContext();
  assert.throws(() => vm.runInContext('core.apply(im, r, { shouldCancel() { return true; } })', ctx), /cancelled/);
  assert.equal(vm.runInContext('allocations', ctx), 0);
  assert.equal(vm.runInContext('core.measure(10000, 8000, r).outputSize.width', ctx), 10000);
  assert.throws(() => vm.runInContext('core.plan(10000, 8000, r)', ctx), /input pixel/);
  assert.throws(() => vm.runInContext('core.apply({ width: 10000, height: 8000, data: new Uint8Array(0) }, r)', ctx), /input pixel/);
  assert.equal(vm.runInContext('allocations', ctx), 0);
  assert.throws(() => vm.runInContext('core.apply(im, { ...r, top: 0.5 }, { maxPixels: 98 })', ctx), /output pixel/);
  assert.equal(vm.runInContext('allocations', ctx), 0);
  assert.throws(() => vm.runInContext('core.apply(im, { ...r, left: 0.5 }, { maxEdge: 49, maxPixels: 98 })', ctx), /output pixel/);
  assert.equal(vm.runInContext('allocations', ctx), 0);
  assert.throws(() => vm.runInContext('core.apply({ width: 49, height: 2, data: im.data }, { ...r, left: 0.5 }, { maxEdge: 49 })', ctx), /output width/);
  assert.equal(vm.runInContext('allocations', ctx), 0);
});

test('mid-loop and final cancellation discard independently allocated, partially/fully written output', () => {
  const ctx = trackedContext();
  assert.throws(() => vm.runInContext('let polls = 0; core.apply(im, r, { shouldCancel() { return ++polls === 2; } })', ctx), /cancelled/);
  assert.equal(vm.runInContext('allocations', ctx), 1);
  assert.equal(vm.runInContext('lastAllocation[0]', ctx), 77);
  assert.equal(vm.runInContext('lastAllocation[16 * 2 * 4]', ctx), 0);
  assert.equal(vm.runInContext('im.data.every(x => x === 77)', ctx), true);
  assert.throws(() => vm.runInContext('polls = 0; core.apply(im, r, { shouldCancel() { return ++polls === 5; } })', ctx), /cancelled/);
  assert.equal(vm.runInContext('allocations', ctx), 2);
  assert.equal(vm.runInContext('lastAllocation.every(x => x === 77)', ctx), true);
  assert.equal(vm.runInContext('im.data.every(x => x === 77)', ctx), true);
});
