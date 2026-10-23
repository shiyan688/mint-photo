'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const levels = require('../app/src/main/assets/levels.js');

const keys = ['red', 'green', 'blue'];
const image = (values = [20, 100, 220, 255], width = values.length / 4, height = 1) => ({ width, height, data: new Uint8ClampedArray(values) });
function ramp() {
  const im = image(new Array(256 * 4).fill(0));
  for (let i = 0; i < 256; i++) im.data.set([i, i, i, 255], i * 4);
  return im;
}
function recipe(master = {}, channels = {}, strength = 1) {
  const r = levels.defaults();
  Object.assign(r.channels.rgb, master);
  for (const [key, value] of Object.entries(channels)) Object.assign(r.channels[key], value);
  r.strength = strength;
  return r;
}
// Independent direct formula, deliberately without production helper calls.
function referenceMap(value, c) {
  const t = Math.min(1, Math.max(0, (value - c.inputBlack) / (c.inputWhite - c.inputBlack)));
  return c.outputBlack + Math.pow(t, 1 / c.gamma) * (c.outputWhite - c.outputBlack);
}
function reference(value, r, channel) {
  const mapped = referenceMap(referenceMap(value, r.channels.rgb), r.channels[channel]);
  return Math.round(value + (mapped - value) * r.strength);
}
function activeRecipe() { return recipe({ gamma: 1.7 }); }
function assertAbort(callback) {
  assert.throws(callback, error => error.name === 'AbortError' && error.code === 'ABORT_ERR');
}
function plainNull(value) {
  if (value !== null && typeof value === 'object') {
    const copy = Object.create(null);
    for (const key of Object.keys(value)) copy[key] = plainNull(value[key]);
    return copy;
  }
  return value;
}

// Interface, sharing and precision.
test('CommonJS and browser-global UMD APIs are frozen and agree', () => {
  assert.equal(globalThis.MintLevels, levels);
  assert.equal(Object.isFrozen(levels), true);
  assert.equal(Object.isFrozen(levels.LIMITS), true);
  assert.equal(Object.isFrozen(levels.CHANNELS), true);
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/src/main/assets/levels.js'), 'utf8'), context);
  assert.equal(vm.runInContext('typeof MintLevels.apply', context), 'function');
  assert.equal(vm.runInContext('MintLevels.buildLuts(MintLevels.defaults()).red[177]', context), 177);
});
test('defaults are independent exact identity records; validate deep-copies', () => {
  const a = levels.defaults(), b = levels.defaults();
  assert.deepEqual(a, { version: 1, strength: 1, channels: Object.fromEntries(['rgb', ...keys].map(k => [k, { inputBlack: 0, inputWhite: 255, gamma: 1, outputBlack: 0, outputWhite: 255 }])) });
  const v = levels.validate(a);
  a.channels.rgb.gamma = 2;
  assert.equal(v.channels.rgb.gamma, 1);
  assert.equal(a.channels.red.gamma, 1);
  assert.equal(b.channels.rgb.gamma, 1);
  assert.notEqual(v, a);
  assert.notEqual(v.channels, a.channels);
  assert.equal(levels.isActive(a), true);
  assert.equal(levels.isActive(b), false);
});
test('all 256 default ramp values and null/zero-strength are byte-exact identity', () => {
  const im = ramp();
  for (const r of [levels.defaults(), null, recipe({ gamma: 2 }, {}, 0)]) {
    assert.equal(levels.isActive(r), false);
    assert.equal(levels.apply(im, r), im);
    const lut = levels.buildLuts(r);
    for (const key of keys) assert.deepEqual(lut[key], Uint8Array.from({ length: 256 }, (_, i) => i));
  }
  assert.equal(levels.validate(null), null);
});
test('all 256 values, all channels, randomized recipes match direct formula', () => {
  let seed = 0x1e7e15;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const sampleChannel = () => {
    const inputBlack = Math.floor(random() * 255), outputBlack = Math.floor(random() * 256);
    return { inputBlack, inputWhite: inputBlack + 1 + Math.floor(random() * (255 - inputBlack)), gamma: .1 + random() * 9.9, outputBlack, outputWhite: outputBlack + Math.floor(random() * (256 - outputBlack)) };
  };
  const im = ramp(), before = im.data.slice();
  for (let iteration = 0; iteration < 120; iteration++) {
    const r = recipe(sampleChannel(), Object.fromEntries(keys.map(k => [k, sampleChannel()])), random());
    const out = levels.apply(im, r), lut = levels.buildLuts(r);
    assert.notEqual(out.data, im.data);
    for (const [index, key] of keys.entries()) {
      for (let value = 0; value < 256; value++) {
        assert.equal(lut[key][value], reference(value, r, key), `${iteration}/${key}/${value}`);
        assert.equal(out.data[value * 4 + index], lut[key][value]);
        assert.equal(out.data[value * 4 + 3], 255);
      }
    }
  }
  assert.deepEqual(im.data, before);
});
test('full-ramp monotonicity and bounds hold across endpoint/gamma/strength extremes', () => {
  for (const gamma of [.1, .25, .65, 1, 1.7, 4, 10]) {
    for (const strength of [0, .25, .5, 1]) {
      for (const interval of [[0, 255], [0, 1], [254, 255], [30, 220]]) {
        for (const output of [[0, 255], [18, 239], [128, 128]]) {
          const r = recipe({ inputBlack: interval[0], inputWhite: interval[1], outputBlack: output[0], outputWhite: output[1], gamma }, { red: { gamma: .65 }, green: { gamma: 1.7 } }, strength);
          for (const key of keys) {
            const lut = levels.buildLuts(r)[key];
            for (let i = 0; i < 256; i++) {
              assert.ok(Number.isInteger(lut[i]) && lut[i] >= 0 && lut[i] <= 255);
              if (i > 0) assert.ok(lut[i] >= lut[i - 1]);
            }
          }
        }
      }
    }
  }
});
test('gamma convention: >1 brightens and <1 darkens; endpoints stay fixed', () => {
  for (const gamma of [.1, .5, 1, 2, 10]) {
    const lut = levels.buildLuts(recipe({ gamma })).red;
    assert.equal(lut[0], 0); assert.equal(lut[255], 255);
    for (let i = 1; i < 255; i++) {
      if (gamma < 1) assert.ok(lut[i] <= i);
      if (gamma > 1) assert.ok(lut[i] >= i);
    }
  }
  assert.equal(levels.buildLuts(recipe({ gamma: 2 })).red[64], 128);
  assert.equal(levels.buildLuts(recipe({ gamma: .5 })).red[128], 64);
});
test('input/output endpoints clamp conventionally; equal outputs are permitted', () => {
  const r = recipe({ inputBlack: 30, inputWhite: 210, outputBlack: 17, outputWhite: 231 });
  const lut = levels.buildLuts(r).red;
  for (let v = 0; v <= 30; v++) assert.equal(lut[v], 17);
  for (let v = 210; v <= 255; v++) assert.equal(lut[v], 231);
  assert.equal(lut[120], 124);
  assert.deepEqual(levels.buildLuts(recipe({ outputBlack: 73, outputWhite: 73 })).red, new Uint8Array(256).fill(73));
});
test('master-only neutral ramps remain neutral; one channel does not edit others', () => {
  const master = levels.apply(ramp(), recipe({ gamma: 1.7, inputBlack: 10, outputWhite: 240 }));
  for (let i = 0; i < 256; i++) assert.equal(master.data[i * 4], master.data[i * 4 + 1]), assert.equal(master.data[i * 4], master.data[i * 4 + 2]);
  const out = levels.apply(ramp(), recipe({}, { red: { gamma: 2 } }));
  for (let i = 0; i < 256; i++) {
    assert.equal(out.data[i * 4 + 1], i);
    assert.equal(out.data[i * 4 + 2], i);
  }
});
test('master precedes individual channel, with no intermediate quantization', () => {
  const master = { inputBlack: 15, inputWhite: 242, outputBlack: 3, outputWhite: 249, gamma: 1.7 };
  const channel = { inputBlack: 41, inputWhite: 214, outputBlack: 12, outputWhite: 229, gamma: .65 };
  const r = recipe(master, { red: channel });
  const lut = levels.buildLuts(r).red;
  assert.equal(lut[26], 13);
  assert.equal(Math.round(referenceMap(Math.round(referenceMap(26, master)), channel)), 12);
  assert.notEqual(lut[100], Math.round(referenceMap(referenceMap(100, channel), master)));
  for (let i = 0; i < 256; i++) assert.equal(lut[i], reference(i, r, 'red'));
});
test('strength blends exactly once with original, after complete composition', () => {
  const r = recipe({ gamma: 2.4, inputBlack: 10, outputWhite: 241 }, { red: { gamma: .65, inputBlack: 34, outputBlack: 9 } }, .35);
  const lut = levels.buildLuts(r).red;
  let differedFromDoubleStrength = false, differedFromPreRounded = false;
  for (let i = 0; i < 256; i++) {
    const mapped = referenceMap(referenceMap(i, r.channels.rgb), r.channels.red);
    const early = i + (referenceMap(i, r.channels.rgb) - i) * r.strength;
    const twice = Math.round(early + (referenceMap(early, r.channels.red) - early) * r.strength);
    assert.equal(lut[i], Math.round(i + (mapped - i) * r.strength));
    if (lut[i] !== twice) differedFromDoubleStrength = true;
    if (lut[i] !== Math.round(i + (Math.round(mapped) - i) * r.strength)) differedFromPreRounded = true;
  }
  assert.equal(differedFromDoubleStrength, true);
  assert.equal(differedFromPreRounded, true);
});
test('final rounding is explicit half-up, not Uint8ClampedArray ties-to-even', () => {
  const half = recipe({ inputWhite: 2, outputWhite: 1 });
  assert.deepEqual([...levels.apply(image([1, 1, 1, 255]), half).data], [1, 1, 1, 255]);
  assert.equal(levels.buildLuts(recipe({ outputBlack: 1, outputWhite: 1 }, {}, .5)).red[0], 1);
  assert.equal(levels.buildLuts(recipe({ outputBlack: 255, outputWhite: 255 }, {}, .5)).red[254], 255);
});
test('alpha and alpha-zero hidden RGB are exact; nonzero alpha does not premultiply', () => {
  const im = image(new Array(256 * 4).fill(0));
  for (let a = 0; a < 256; a++) im.data.set([37, 91, 162, a], a * 4);
  const before = im.data.slice(), r = activeRecipe(), out = levels.apply(im, r), lut = levels.buildLuts(r);
  for (let a = 0; a < 256; a++) {
    assert.equal(out.data[a * 4 + 3], a);
    assert.equal(out.data[a * 4], a === 0 ? 37 : lut.red[37]);
    assert.equal(out.data[a * 4 + 1], a === 0 ? 91 : lut.green[91]);
    assert.equal(out.data[a * 4 + 2], a === 0 ? 162 : lut.blue[162]);
  }
  assert.deepEqual(im.data, before);
});
test('Uint8Array, Uint8ClampedArray and offset views work without mutating input', () => {
  for (const Type of [Uint8Array, Uint8ClampedArray]) {
    const backing = new Type([8, 8, 8, 8, 20, 100, 220, 255, 9, 9, 9, 9]);
    const view = backing.subarray(4, 8), before = backing.slice();
    const out = levels.apply({ width: 1, height: 1, data: view }, activeRecipe());
    assert.ok(out.data instanceof Uint8ClampedArray);
    assert.notEqual(out.data.buffer, backing.buffer);
    assert.deepEqual(backing, before);
  }
});
test('returned LUTs are independent and cannot corrupt later output', () => {
  const r = activeRecipe(), a = levels.buildLuts(r), b = levels.buildLuts(r);
  a.red.fill(0); a.green = null;
  assert.ok(b.red[100] > 0);
  assert.equal(levels.apply(image(), r).data[0], b.red[20]);
});

// Cancellation and bounded storage.
test('cancellation checks identity operations too and propagates callback errors', () => {
  const im = image();
  assertAbort(() => levels.apply(im, levels.defaults(), { shouldCancel: () => true }));
  assertAbort(() => levels.apply(im, null, { shouldCancel: () => true }));
  const error = new Error('caller failure');
  assert.throws(() => levels.apply(im, activeRecipe(), { shouldCancel: () => { throw error; } }), err => err === error);
});
test('cancellation before first allocation and before image allocation is observable', () => {
  const allocations = [];
  const track = (Type, label) => new Proxy(Type, { construct(Target, args) { allocations.push([label, args[0]]); return new Target(...args); } });
  const context = vm.createContext({ Uint8Array: track(Uint8Array, 'u8'), Uint8ClampedArray: track(Uint8ClampedArray, 'clamped'), ArrayBuffer });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/src/main/assets/levels.js'), 'utf8'), context);
  vm.runInContext('var im = { width: 1, height: 1, data: new Uint8ClampedArray([20, 100, 220, 255]) }; var r = MintLevels.defaults(); r.channels.rgb.gamma = 2;', context);
  allocations.length = 0;
  assertAbort(() => vm.runInContext('MintLevels.apply(im, r, { shouldCancel: () => true })', context));
  assert.deepEqual(allocations, []);
  assertAbort(() => vm.runInContext('var calls = 0; MintLevels.apply(im, r, { shouldCancel: () => ++calls === 2 })', context));
  assert.deepEqual(allocations.map(v => v[0]), ['u8', 'u8', 'u8']);
});
test('cancels during chunks and at final publication, never returns partial output', () => {
  const im = { width: 4096, height: 65, data: new Uint8Array(4096 * 65 * 4).fill(255) }, before = im.data.slice();
  let checkpoints = 0, published;
  assertAbort(() => { published = levels.apply(im, activeRecipe(), { shouldCancel: () => ++checkpoints === 5 }); });
  assert.equal(checkpoints, 5);
  assert.equal(published, undefined);
  assert.deepEqual(im.data, before);
  let total = 0;
  levels.apply(image(), activeRecipe(), { shouldCancel: () => { total++; return false; } });
  assert.equal(total, 4); // Before LUTs, before image output, one chunk, before return.
  let calls = 0;
  assertAbort(() => levels.apply(image(), activeRecipe(), { shouldCancel: () => ++calls === total }));
});
test('callbacks that detach validated input throw instead of publishing corruption', () => {
  for (const at of [1, 2, 3, 4]) {
    const im = image();
    let calls = 0, published;
    assert.throws(() => { published = levels.apply(im, activeRecipe(), { shouldCancel: () => { if (++calls === at) structuredClone(im.data.buffer, { transfer: [im.data.buffer] }); return false; } }); }, TypeError);
    assert.equal(published, undefined);
  }
});
test('maximum edge and pixel cap are inclusive; invalid dimensions are rejected early', () => {
  assert.deepEqual(levels.LIMITS, { pixels: 64000000, edge: 16384, chunkPixels: 65536, chunkRows: 32 });
  for (const [width, height] of [[16384, 1], [1, 16384]]) {
    const im = { width, height, data: new Uint8Array(width * height * 4) };
    assert.equal(levels.apply(im, null), im);
  }
  for (const [width, height] of [[0, 1], [-1, 1], [1, 0], [1.1, 1], [NaN, 1], [Infinity, 1], ['1', 1], [16385, 1], [1, 16385], [8001, 8000], [16384, 16384], [Number.MAX_SAFE_INTEGER, 1]]) {
    assert.throws(() => levels.apply({ width, height, data: new Uint8Array(4) }, null), /dimensions/);
  }
  // At 64 MP only the small descriptor and dimensions are inspected before
  // rejecting this intentionally short buffer. Avoid a 256 MB test allocation.
  assert.throws(() => levels.apply({ width: 8000, height: 8000, data: new Uint8Array(4) }, null), /buffer or length/);
});

// Strict recipes, image records and options; no ordinary getters execute.
test('malformed recipes are rejected even when strength is zero', () => {
  for (const value of [undefined, false, 1, 'recipe', [], () => {}]) assert.throws(() => levels.validate(value), TypeError);
  const mutations = [
    r => delete r.version, r => r.version = 2, r => r.extra = 1,
    r => r.strength = NaN, r => r.strength = Infinity, r => r.strength = -.1, r => r.strength = 1.1, r => r.strength = '1',
    r => r.channels = null, r => r.channels.extra = {}, r => delete r.channels.blue,
    r => r.channels.rgb = [], r => r.channels.rgb.gamma = NaN, r => r.channels.rgb.gamma = Infinity,
    r => r.channels.rgb.gamma = .0999, r => r.channels.rgb.gamma = 10.0001,
    r => r.channels.rgb.inputBlack = -1, r => r.channels.rgb.inputWhite = 256,
    r => r.channels.rgb.inputBlack = .5, r => r.channels.rgb.outputWhite = 254.5,
    r => r.channels.rgb.inputBlack = 255, r => r.channels.rgb.inputWhite = 0,
    r => { r.channels.rgb.outputBlack = 200; r.channels.rgb.outputWhite = 199; },
    r => r.channels.rgb.outputBlack = NaN, r => r.channels.rgb.extra = 0,
    r => { r.strength = 0; r.channels.blue.gamma = NaN; }
  ];
  for (const mutate of mutations) { const r = levels.defaults(); mutate(r); assert.throws(() => levels.validate(r), TypeError); }
});
test('numeric endpoint/gamma bounds and null-prototype data records are accepted', () => {
  assert.doesNotThrow(() => levels.validate(recipe({ gamma: .1, inputBlack: 0, inputWhite: 1, outputBlack: 0, outputWhite: 0 })));
  assert.doesNotThrow(() => levels.validate(recipe({ gamma: 10, inputBlack: 254, inputWhite: 255, outputBlack: 255, outputWhite: 255 })));
  assert.deepEqual(levels.validate(plainNull(levels.defaults())), levels.defaults());
  const im = Object.assign(Object.create(null), image());
  assert.equal(levels.apply(im, null, Object.create(null)), im);
});
test('unknown, hidden, symbol, accessor and custom prototype records reject without getter calls', () => {
  let reads = 0;
  for (const choose of [r => r, r => r.channels, r => r.channels.rgb]) {
    for (const modify of [
      o => o.extra = 1,
      o => Object.defineProperty(o, 'hidden', { value: 1 }),
      o => o[Symbol('extra')] = 1,
      o => Object.setPrototypeOf(o, { inherited: 1 }),
      o => { const key = Object.keys(o)[0]; Object.defineProperty(o, key, { enumerable: true, get() { reads++; throw new Error('getter executed'); } }); },
      o => { const key = Object.keys(o)[0]; Object.defineProperty(o, key, { value: o[key], enumerable: false }); }
    ]) {
      const r = levels.defaults(); modify(choose(r)); assert.throws(() => levels.validate(r), TypeError);
    }
  }
  assert.equal(reads, 0);
});
test('image getters, fields and prototypes reject before reading values', () => {
  let reads = 0;
  for (const modify of [
    im => delete im.data,
    im => im.extra = 1,
    im => Object.defineProperty(im, 'hidden', { value: 1 }),
    im => im[Symbol()] = 1,
    im => Object.setPrototypeOf(im, { width: 1 }),
    ...['width', 'height', 'data'].map(key => im => Object.defineProperty(im, key, { enumerable: true, get() { reads++; throw new Error('getter executed'); } }))
  ]) {
    const im = image(); modify(im); assert.throws(() => levels.apply(im, null), TypeError);
  }
  assert.equal(reads, 0);
});
test('options reject unknown/hidden/symbol/accessor/prototype and invalid callbacks', () => {
  let reads = 0;
  const accessor = {}; Object.defineProperty(accessor, 'shouldCancel', { enumerable: true, get() { reads++; return () => false; } });
  const hidden = {}; Object.defineProperty(hidden, 'shouldCancel', { value: () => false });
  const symbol = { [Symbol('option')]: 1 };
  const inherited = Object.create({ shouldCancel() { reads++; return false; } });
  for (const opt of [null, [], false, { unknown: true }, { shouldCancel: 0 }, { shouldCancel: null }, { shouldCancel: NaN }, accessor, hidden, symbol, inherited]) {
    assert.throws(() => levels.apply(image(), activeRecipe(), opt), TypeError);
  }
  assert.equal(reads, 0);
  assert.doesNotThrow(() => levels.apply(image(), activeRecipe(), { shouldCancel: undefined }));
});
test('invalid recipes/options are rejected before invoking cancellation callbacks', () => {
  let calls = 0;
  const r = levels.defaults(); r.strength = 0; r.channels.rgb.gamma = NaN;
  assert.throws(() => levels.apply(image(), r, { shouldCancel: () => { calls++; return false; } }), TypeError);
  assert.throws(() => levels.apply(image(), activeRecipe(), { shouldCancel: () => { calls++; return false; }, unknown: 1 }), TypeError);
  assert.equal(calls, 0);
});
test('wrong, fake, shared, detached, resizable and incorrect-size storage reject', () => {
  const dataValues = [[], {}, null, new Uint16Array(4), new Int8Array(4), new Float32Array(4), new DataView(new ArrayBuffer(4)), new Uint8Array(3), new Uint8Array(5), Object.create(Uint8Array.prototype), new Proxy(new Uint8Array(4), {}), Buffer.alloc(4)];
  class Subclass extends Uint8Array {}
  dataValues.push(new Subclass(4));
  const detached = new Uint8Array(4); structuredClone(detached.buffer, { transfer: [detached.buffer] }); dataValues.push(detached);
  if (typeof SharedArrayBuffer === 'function') dataValues.push(new Uint8Array(new SharedArrayBuffer(4)));
  if (Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')) dataValues.push(new Uint8Array(new ArrayBuffer(4, { maxByteLength: 8 })));
  for (const data of dataValues) assert.throws(() => levels.apply({ width: 1, height: 1, data }, null), TypeError);
});
test('typed-array shadow getters/methods are never invoked', () => {
  const im = image(); let reads = 0;
  for (const key of ['length', 'buffer', 'byteLength', 'byteOffset', 'slice', 'set', Symbol.iterator]) Object.defineProperty(im.data, key, { get() { reads++; throw new Error('typed-array trap'); } });
  const out = levels.apply(im, activeRecipe());
  assert.equal(out.width, 1);
  assert.equal(out.data[3], 255);
  assert.equal(reads, 0);
});
test('mutating caller recipe inside cancellation callback cannot alter validated mapping', () => {
  const r = activeRecipe(), expected = levels.buildLuts(r).red[20];
  const out = levels.apply(image(), r, { shouldCancel() { r.channels.rgb.gamma = 0; r.strength = NaN; return false; } });
  assert.equal(out.data[0], expected);
});
test('output construction never dispatches inherited record-key setters', () => {
  const names = ['version', 'strength', 'channels', 'rgb', 'red', 'green', 'blue', 'inputBlack', 'inputWhite', 'gamma', 'outputBlack', 'outputWhite', 'width', 'height', 'data'];
  const previous = names.map(name => [name, Object.getOwnPropertyDescriptor(Object.prototype, name)]);
  let setterCalls = 0;
  try {
    for (const name of names) Object.defineProperty(Object.prototype, name, { configurable: true, set() { setterCalls++; } });
    const r = levels.defaults(); r.channels.rgb.gamma = 2;
    const validated = levels.validate(r), luts = levels.buildLuts(r);
    const out = levels.apply({ width: 1, height: 1, data: new Uint8Array([20, 100, 220, 255]) }, r);
    for (const key of ['rgb', ...keys]) assert.ok(Object.hasOwn(validated.channels, key));
    for (const key of keys) assert.ok(Object.hasOwn(luts, key));
    for (const key of ['width', 'height', 'data']) assert.ok(Object.hasOwn(out, key));
    assert.equal(setterCalls, 0);
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(Object.prototype, name, descriptor);
      else delete Object.prototype[name];
    }
  }
});
test('own output property descriptors do not inspect inherited get/set accessors', () => {
  const names = ['get', 'set'];
  const previous = names.map(name => [name, Object.getOwnPropertyDescriptor(Object.prototype, name)]);
  let getterCalls = 0, result, failure;
  try {
    for (const name of names) Object.defineProperty(Object.prototype, name, { __proto__: null, configurable: true, get() { getterCalls++; throw new Error('inherited descriptor accessor executed'); } });
    const r = levels.defaults(); r.channels.rgb.gamma = 2;
    const validated = levels.validate(r), luts = levels.buildLuts(r);
    const output = levels.apply({ width: 1, height: 1, data: new Uint8Array([20, 100, 220, 255]) }, r);
    result = { validated, luts, output };
  } catch (error) {
    failure = error;
  } finally {
    // Remove both polluted names before restoring any ordinary descriptor.
    for (const name of names) delete Object.prototype[name];
    for (const [name, descriptor] of previous) if (descriptor) Object.defineProperty(Object.prototype, name, descriptor);
  }
  assert.equal(failure, undefined);
  assert.equal(getterCalls, 0);
  assert.equal(result.validated.channels.rgb.gamma, 2);
  assert.equal(result.output.data[0], result.luts.red[20]);
});
