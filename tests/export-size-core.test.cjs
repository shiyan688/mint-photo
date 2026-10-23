'use strict';
// Pure dimension/contract tests. No pixel-quality, Canvas or Android claim.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const E = require('../app/src/main/assets/export-size.js');
const script = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/export-size.js'), 'utf8');
const edge = longEdge => ({ version: 1, mode: 'long-edge', longEdge });
const clean = value => JSON.parse(JSON.stringify(value));

test('API and limits are frozen with precisely the accepted exports', () => {
  assert.deepEqual(Object.keys(E).sort(), ['LIMITS', 'defaults', 'plan', 'validate']);
  assert.ok(Object.isFrozen(E));
  assert.ok(Object.isFrozen(E.LIMITS));
  assert.deepEqual(E.LIMITS, { maxEdge: 4096, maxPixels: 8000000, bytesPerPixel: 4, maxPairBytes: 67108864 });
  assert.throws(() => { E.LIMITS.maxEdge = 16384; }, TypeError);
});

test('defaults return fresh strict unchanged recipes', () => {
  const a = E.defaults(), b = E.defaults();
  assert.deepEqual(a, { version: 1, mode: 'unchanged', longEdge: null });
  assert.notEqual(a, b);
  a.mode = 'long-edge'; a.longEdge = 7;
  assert.deepEqual(b, E.defaults());
});

test('validate returns an independent canonical copy and preserves frozen input', () => {
  const recipe = Object.freeze(edge(1024));
  const copy = E.validate(recipe);
  assert.deepEqual(copy, recipe);
  assert.notEqual(copy, recipe);
  copy.longEdge = 200;
  assert.equal(recipe.longEdge, 1024);
  assert.deepEqual(E.validate(Object.freeze(E.defaults())), E.defaults());
});

test('null-prototype, nonwritable and reordered own-data records are supported', () => {
  const recipe = Object.create(null);
  for (const [key, value] of [['longEdge', 21], ['mode', 'long-edge'], ['version', 1]]) {
    Object.defineProperty(recipe, key, { value, enumerable: true });
  }
  assert.deepEqual(E.validate(recipe), edge(21));
  assert.deepEqual(E.plan(100, 51, recipe).output, { width: 21, height: 11 });
});

for (const [name, value] of [
  ['null', null], ['undefined', undefined], ['array', []], ['string', 'unchanged'],
  ['number', 1], ['boolean', true], ['symbol', Symbol('recipe')], ['bigint', 1n],
  ['function', function () {}], ['date', new Date(0)], ['boxed object', new Number(1)],
  ['class instance', new (class Recipe { constructor() { Object.assign(this, edge(100)); } })()]
]) {
  test('invalid recipe record rejects: ' + name, () => assert.throws(() => E.validate(value), TypeError));
}

test('missing, unknown, symbol, hidden and own prototype-special fields reject', () => {
  for (const key of ['version', 'mode', 'longEdge']) {
    const r = edge(200); delete r[key];
    assert.throws(() => E.validate(r), TypeError);
  }
  for (const key of ['other', 'width', '__proto__', 'constructor', Symbol('extra')]) {
    const r = edge(200);
    Object.defineProperty(r, key, { value: 1, enumerable: true });
    assert.throws(() => E.validate(r), TypeError);
  }
  const hiddenExtra = edge(200);
  Object.defineProperty(hiddenExtra, 'hidden', { value: 1 });
  assert.throws(() => E.validate(hiddenExtra), TypeError);
  const hiddenRequired = edge(200);
  Object.defineProperty(hiddenRequired, 'mode', { value: 'long-edge', enumerable: false });
  assert.throws(() => E.validate(hiddenRequired), TypeError);
});

test('required and unknown getters/setters are rejected without invoking them', () => {
  let calls = 0;
  for (const key of ['version', 'mode', 'longEdge', 'extra']) {
    for (const descriptor of [
      { get() { calls++; throw new Error('Getter must never run'); } },
      { set(_) { calls++; throw new Error('Setter must never run'); } },
      { get() { calls++; return 100; }, set(_) { calls++; } }
    ]) {
      const r = edge(200);
      Object.defineProperty(r, key, { ...descriptor, enumerable: true, configurable: true });
      assert.throws(() => E.validate(r), TypeError);
      assert.throws(() => E.plan(1000, 500, r), TypeError);
    }
  }
  assert.equal(calls, 0);
});

test('inherited required or unknown fields and custom prototypes reject without reads', () => {
  let calls = 0;
  for (const base of [edge(200), { extra: true }, Object.create(null)]) {
    const r = Object.create(base);
    if (!base.mode) Object.assign(r, edge(200));
    assert.throws(() => E.validate(r), TypeError);
  }
  const proto = {};
  Object.defineProperty(proto, 'mode', { get() { calls++; return 'long-edge'; }, enumerable: true });
  const r = Object.create(proto);
  Object.defineProperties(r, { version: { value: 1, enumerable: true }, longEdge: { value: 20, enumerable: true } });
  assert.throws(() => E.validate(r), TypeError);
  assert.equal(calls, 0);
});

test('version, mode, and edge types are strict and never coerced', () => {
  for (const version of [0, 2, -1, 1.1, '1', true, null, undefined, NaN, Infinity, 1n]) {
    assert.throws(() => E.validate({ ...edge(100), version }), /version/);
  }
  for (const mode of ['', 'original', 'working', 'Long-edge', 'LONG-EDGE', null, undefined, true, 1]) {
    assert.throws(() => E.validate({ ...edge(100), mode }), /mode/);
  }
  let coerces = 0;
  const bad = { valueOf() { coerces++; return 100; }, toString() { coerces++; return '100'; } };
  for (const longEdge of [0, -0, -1, 0.1, 1.5, 4097, 1e30, NaN, Infinity, -Infinity, '100', null, undefined, true, false, 1n, Symbol('edge'), bad, new Number(100)]) {
    assert.throws(() => E.validate(edge(longEdge)), RangeError);
  }
  assert.equal(coerces, 0);
});

test('unchanged requires explicit null and cannot carry a stale requested edge', () => {
  for (const longEdge of [undefined, 0, 1, 100, '', false, {}, []]) {
    assert.throws(() => E.validate({ version: 1, mode: 'unchanged', longEdge }), /null/);
  }
  assert.deepEqual(E.validate(E.defaults()), E.defaults());
});

test('long-edge validates the inclusive 1..4096 endpoints', () => {
  assert.deepEqual(E.validate(edge(1)), edge(1));
  assert.deepEqual(E.validate(edge(4096)), edge(4096));
});

for (const [name, width, height, requested, output] of [
  ['wide exact ratio', 3000, 2000, 1500, [1500, 1000]],
  ['tall exact ratio', 2000, 3000, 1500, [1000, 1500]],
  ['square', 2000, 2000, 777, [777, 777]],
  ['odd wide', 3001, 2001, 1024, [1024, 683]],
  ['odd tall', 2001, 3001, 1024, [683, 1024]],
  ['half-up tie landscape', 4, 2, 3, [3, 2]],
  ['half-up tie portrait', 2, 4, 3, [2, 3]],
  ['round down', 7, 4, 4, [4, 2]],
  ['round up', 7, 5, 4, [4, 3]],
  ['tiny 2x1', 2, 1, 1, [1, 1]],
  ['tiny 1x2', 1, 2, 1, [1, 1]],
  ['ultrawide minimum one', 4096, 1, 1, [1, 1]],
  ['ultratall minimum one', 1, 4096, 1, [1, 1]],
  ['post crop fixture', 1501, 500, 750, [750, 250]],
  ['post rotation fixture', 500, 1501, 750, [250, 750]],
  ['post padding fixture', 1300, 1100, 650, [650, 550]]
]) {
  test('dimensions are exact: ' + name, () => {
    const recipe = edge(requested), p = E.plan(width, height, recipe);
    assert.deepEqual(p.input, { width, height });
    assert.deepEqual(p.output, { width: output[0], height: output[1] });
    assert.deepEqual(p.recipe, recipe);
    assert.notEqual(p.recipe, recipe);
    assert.equal(p.resized, true);
    assert.equal(p.requestedEdge, requested);
    assert.equal(Math.max(p.output.width, p.output.height), requested);
    assert.equal(p.scale, requested / Math.max(width, height));
  });
}

test('unchanged preserves dimensions exactly and accounts for no extra pixel allocation', () => {
  const p = E.plan(3001, 2001, E.defaults());
  assert.deepEqual(p.input, p.output);
  assert.notEqual(p.input, p.output);
  assert.equal(p.resized, false);
  assert.equal(p.requestedEdge, null);
  assert.equal(p.scale, 1);
  assert.deepEqual(p.allocation, {
    bytesPerPixel: 4, inputBytes: 24020004, outputBytes: 24020004,
    extraBytes: 0, peakBytes: 24020004, pairBytes: 48040008, maxPairBytes: 67108864
  });
});

test('equal requested edge is identity without losing the explicit request', () => {
  for (const [width, height] of [[3001, 2001], [2001, 3001], [1, 1], [4096, 1], [2000, 2000]]) {
    const requested = Math.max(width, height), p = E.plan(width, height, edge(requested));
    assert.deepEqual(p.output, { width, height });
    assert.equal(p.resized, false);
    assert.equal(p.scale, 1);
    assert.equal(p.requestedEdge, requested);
    assert.equal(p.allocation.extraBytes, 0);
    assert.equal(p.allocation.peakBytes, width * height * 4);
    assert.equal(p.allocation.pairBytes, width * height * 8);
  }
});

test('upscaling rejects explicitly instead of silently clamping or inventing pixels', () => {
  for (const [width, height, requested] of [[20, 10, 21], [10, 20, 21], [1, 1, 2], [4000, 2000, 4096]]) {
    assert.throws(() => E.plan(width, height, edge(requested)), error => {
      assert.equal(error.name, 'RangeError');
      assert.match(error.message, /Upscaling is not allowed/);
      assert.match(error.message, new RegExp(String(requested)));
      assert.match(error.message, new RegExp(String(Math.max(width, height))));
      return true;
    });
  }
});

test('input dimension types are strict, bounded and never coerced', () => {
  let coerces = 0;
  const object = { valueOf() { coerces++; return 10; } };
  for (const value of [0, -0, -1, 0.5, 4097, 1e30, NaN, Infinity, -Infinity, '100', null, undefined, true, false, 1n, Symbol('dimension'), object, new Number(100)]) {
    assert.throws(() => E.plan(value, 1, E.defaults()), RangeError);
    assert.throws(() => E.plan(1, value, E.defaults()), RangeError);
    assert.throws(() => E.plan(value, 1, edge(1)), RangeError);
    assert.throws(() => E.plan(1, value, edge(1)), RangeError);
  }
  assert.equal(coerces, 0);
});

test('8MP and 4096 per-edge limits hold before any final downsizing', () => {
  for (const [w, h] of [[4000, 2000], [2000, 4000], [4096, 1953], [1953, 4096], [2828, 2828], [1, 4096]]) {
    assert.deepEqual(E.plan(w, h, E.defaults()).output, { width: w, height: h });
  }
  for (const [w, h] of [[4000, 2001], [2001, 4000], [4096, 1954], [1954, 4096], [2829, 2829], [4096, 4096], [4097, 1], [1, 4097]]) {
    assert.throws(() => E.plan(w, h, E.defaults()), RangeError);
    assert.throws(() => E.plan(w, h, edge(1)), RangeError);
  }
});

test('allocation accounts for processed input plus one new RGBA8 output, not encoded bytes', () => {
  const p = E.plan(4000, 2000, edge(2000));
  assert.deepEqual(p.allocation, {
    bytesPerPixel: 4, inputBytes: 32000000, outputBytes: 8000000,
    extraBytes: 8000000, peakBytes: 40000000, pairBytes: 40000000, maxPairBytes: 67108864
  });
  const maximumIdentity = E.plan(4000, 2000, E.defaults());
  assert.equal(maximumIdentity.allocation.pairBytes, 64000000);
  assert.ok(maximumIdentity.allocation.pairBytes < E.LIMITS.maxPairBytes);
  const nearlyIdentity = E.plan(4000, 2000, edge(3999));
  assert.equal(nearlyIdentity.allocation.outputBytes, 3999 * 2000 * 4);
  assert.equal(nearlyIdentity.allocation.peakBytes, 63992000);
});

test('all returned metadata and recipes are detached and caller mutation cannot affect another plan', () => {
  const r = edge(100), before = clean(r), a = E.plan(300, 200, r);
  a.recipe.longEdge = 50; a.input.width = 1; a.output.height = 1; a.allocation.maxPairBytes = 1;
  assert.deepEqual(r, before);
  const b = E.plan(300, 200, r);
  assert.deepEqual(b.output, { width: 100, height: 67 });
  assert.deepEqual(b.recipe, before);
  assert.equal(b.allocation.maxPairBytes, 67108864);
  assert.deepEqual(r, before);
});

test('invalid calls leave frozen and mutable recipe state untouched', () => {
  for (const r of [edge(200), Object.freeze(edge(200))]) {
    const before = Object.getOwnPropertyDescriptors(r);
    assert.throws(() => E.plan(100, 80, r), /Upscaling/);
    assert.deepEqual(Object.getOwnPropertyDescriptors(r), before);
    assert.throws(() => E.plan(4096, 4096, r), /pixel export budget/);
    assert.deepEqual(Object.getOwnPropertyDescriptors(r), before);
  }
});

test('JSON recipe and plan round trips are lossless and revalidation is stable', () => {
  for (const r of [E.defaults(), edge(1), edge(17), edge(4096)]) {
    assert.deepEqual(E.validate(clean(r)), r);
    assert.deepEqual(E.validate(E.validate(r)), r);
    const p = E.plan(4096, 1000, r);
    assert.deepEqual(clean(p), p);
    assert.deepEqual(E.plan(p.input.width, p.input.height, clean(p.recipe)), p);
  }
});

test('transpose symmetry, integer rounding, identity and byte invariants across 12,000 deterministic inputs', () => {
  let state = 0x12345678;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
  for (let i = 0; i < 12000; i++) {
    const width = next() % 4096 + 1;
    const height = next() % Math.min(4096, Math.floor(8000000 / width)) + 1;
    const inputLong = Math.max(width, height), inputShort = Math.min(width, height);
    const request = next() % inputLong + 1;
    const p = E.plan(width, height, edge(request));
    const q = E.plan(height, width, edge(request));
    const short = Math.max(1, Math.round(inputShort * request / inputLong));
    assert.deepEqual(q.output, { width: p.output.height, height: p.output.width });
    assert.equal(Math.max(p.output.width, p.output.height), request);
    assert.equal(Math.min(p.output.width, p.output.height), short);
    assert.ok(Number.isInteger(p.output.width) && Number.isInteger(p.output.height));
    assert.ok(p.output.width >= 1 && p.output.height >= 1);
    assert.ok(p.output.width <= width && p.output.height <= height);
    assert.equal(p.resized, request < inputLong);
    assert.equal(p.allocation.inputBytes, width * height * 4);
    assert.equal(p.allocation.outputBytes, p.output.width * p.output.height * 4);
    assert.equal(p.allocation.extraBytes, p.resized ? p.allocation.outputBytes : 0);
    assert.equal(p.allocation.peakBytes, p.allocation.inputBytes + p.allocation.extraBytes);
    assert.equal(p.allocation.pairBytes, p.allocation.inputBytes + p.allocation.outputBytes);
    assert.ok(p.allocation.pairBytes <= E.LIMITS.maxPairBytes);
  }
});

test('browser UMD, CommonJS and AMD exports agree without global leakage', () => {
  const browser = {};
  vm.runInNewContext(script, browser);
  assert.deepEqual(Object.keys(browser.MintExportSize).sort(), Object.keys(E).sort());
  assert.deepEqual(clean(browser.MintExportSize.plan(30, 20, browser.MintExportSize.defaults())), E.plan(30, 20, E.defaults()));
  const cjs = { module: { exports: {} } };
  vm.runInNewContext(script, cjs);
  assert.equal(cjs.MintExportSize, undefined);
  assert.deepEqual(Object.keys(cjs.module.exports).sort(), Object.keys(E).sort());
  let amd;
  function define(dependencies, factory) { assert.equal(dependencies.length, 0); amd = factory(); }
  define.amd = true;
  const env = { define };
  vm.runInNewContext(script, env);
  assert.equal(env.MintExportSize, undefined);
  assert.deepEqual(Object.keys(amd).sort(), Object.keys(E).sort());
  assert.deepEqual(clean(amd.defaults()), E.defaults());
});

test('planner requires no DOM, image pixel allocator, timers, network or module dependencies', () => {
  const forbidden = () => { throw new Error('Forbidden pixel allocation or platform access'); };
  const sandbox = {};
  for (const key of ['document', 'window', 'Image', 'ImageData', 'HTMLCanvasElement', 'OffscreenCanvas',
    'ArrayBuffer', 'Uint8Array', 'Uint8ClampedArray', 'Float32Array', 'fetch', 'XMLHttpRequest',
    'setTimeout', 'setInterval', 'require']) {
    Object.defineProperty(sandbox, key, { get: forbidden, configurable: false });
  }
  vm.runInNewContext(script, sandbox);
  const p = vm.runInNewContext("MintExportSize.plan(4000, 2000, {version:1, mode:'long-edge', longEdge:1000})", sandbox);
  assert.deepEqual(clean(p.output), { width: 1000, height: 500 });
});

test('plain records are realm-local; JSON parsed in the consuming realm is accepted', () => {
  const env = {};
  vm.runInNewContext(script, env);
  assert.throws(() => env.MintExportSize.validate(edge(100)), /prototype/);
  const r = vm.runInNewContext("JSON.parse('{\"version\":1,\"mode\":\"long-edge\",\"longEdge\":100}')", env);
  assert.deepEqual(clean(env.MintExportSize.validate(r)), edge(100));
});
