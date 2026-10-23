'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sharpness = require('../app/src/main/assets/sharpness.js');
const source = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/sharpness.js'), 'utf8');
const recipe = (amount = 100, radius = 3, threshold = 0) => ({ version: 1, amount, radius, threshold });
const image = (width, height, make = () => [85, 130, 175, 255]) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(make(x, y), (y * width + x) * 4);
  return { width, height, data };
};
const random = (seed = 0x134abcde) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const aborts = action => assert.throws(action, e => e.name === 'AbortError' && e.code === 'ABORT_ERR');
const decode = value => { const x = value / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; };
const code = y => 255 * (y <= .0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - .055);
const yAt = (d, i) => .2126 * decode(d[i]) + .7152 * decode(d[i + 1]) + .0722 * decode(d[i + 2]);
const maxByteDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const changedPixels = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++; return n; };
const gray = value => [value, value, value, 255];

// Slow, independently indexed convolution reference: no production helpers,
// running-sum recurrence or public plan result feeds its numerical answer.
function reference(im, r) {
  const { width: w, height: h, data: d } = im, count = w * h;
  const sigma = r.radius * Math.min(w, h) / 1000, v = sigma * sigma / 3;
  const n = Math.floor((Math.sqrt(1 + 12 * v) - 1) / 2);
  const f = ((2 * n + 1) * v - n * (n + 1) * (2 * n + 1) / 3) / (2 * ((n + 1) ** 2 - v));
  const norm = 2 * n + 1 + 2 * f;
  const original = new Float64Array(count), coverage = new Float32Array(count), signal = new Float32Array(count);
  for (let j = 0; j < count; j++) { original[j] = yAt(d, j * 4); coverage[j] = d[j * 4 + 3] / 255; signal[j] = d[j * 4 + 3] === 0 ? 0 : code(original[j]) * (d[j * 4 + 3] / 255); }
  function slow(field) {
    for (let stage = 0; stage < 3; stage++) for (const axis of [0, 1]) {
      const next = new Float32Array(count);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let k = -n - 1; k <= n + 1; k++) {
          const xx = axis === 0 ? Math.max(0, Math.min(w - 1, x + k)) : x;
          const yy = axis === 1 ? Math.max(0, Math.min(h - 1, y + k)) : y;
          sum += field[yy * w + xx] * (Math.abs(k) === n + 1 ? f : 1);
        }
        next[y * w + x] = sum / norm;
      }
      field = next;
    }
    return field;
  }
  const blurred = slow(signal), weights = slow(coverage), result = d.slice();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = y * w + x, i = j * 4, originalY = original[j];
    if (!d[i + 3] || !originalY) continue;
    const p = code(originalY), detail = p - blurred[j] / weights[j], a = Math.abs(detail);
    if (a < 1e-5 || a <= r.threshold) continue;
    const softened = (a - r.threshold) ** 2 / (a + r.threshold);
    const capped = Math.sign(detail) * (r.amount / 100) * 12 * softened / (12 + softened);
    const desired = decode(Math.max(0, Math.min(255, p + capped))) - originalY;
    let lo = originalY, hi = originalY;
    for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) if (d[(yy * w + xx) * 4 + 3]) {
      lo = Math.min(lo, original[yy * w + xx]); hi = Math.max(hi, original[yy * w + xx]);
    }
    const room = desired > 0 ? hi - originalY : originalY - lo;
    if (room <= 0 || desired === 0) continue;
    let delta = desired / (1 + Math.abs(desired) / room);
    const color = [decode(d[i]), decode(d[i + 1]), decode(d[i + 2])];
    if (delta > 0) {
      const gamutRoom = originalY * (1 / Math.max(...color) - 1);
      if (gamutRoom <= 0) continue;
      delta = delta / (1 + delta / gamutRoom);
    }
    const gain = (originalY + delta) / originalY;
    for (let c = 0; c < 3; c++) result[i + c] = Math.floor(code(Math.max(0, Math.min(1, color[c] * gain))) + .5 + 1e-10);
  }
  return result;
}

test('UMD publishes the frozen dependency-free API in Node and browser realms', () => {
  assert.equal(globalThis.MintSharpness, sharpness); assert.ok(Object.isFrozen(sharpness)); assert.ok(Object.isFrozen(sharpness.LIMITS));
  const c = vm.createContext({}); vm.runInContext(source, c);
  assert.equal(vm.runInContext('typeof MintSharpness.apply', c), 'function');
  assert.equal(vm.runInContext('MintSharpness.isActive(MintSharpness.defaults())', c), false);
});
test('defaults and validation return independent portable plain records; null stays null', () => {
  const a = sharpness.defaults(), b = sharpness.defaults();
  assert.deepEqual(a, recipe(0, 1, 3)); assert.notEqual(a, b);
  const v = sharpness.validate(a); a.amount = 40; assert.equal(v.amount, 0); assert.equal(b.amount, 0);
  assert.deepEqual(sharpness.validate(JSON.parse(JSON.stringify(recipe(3.25, .875, 1.125)))), recipe(3.25, .875, 1.125));
  assert.deepEqual(sharpness.validate(Object.assign(Object.create(null), recipe())), recipe());
  assert.equal(sharpness.validate(null), null); assert.equal(sharpness.isActive(null), false);
  assert.equal(sharpness.isActive(a), true);
});
test('null and all amount-zero recipes return the original object and every byte unchanged', () => {
  const im = image(256, 1, x => [x, 255 - x, x * 37 % 256, x]), before = im.data.slice();
  for (const r of [null, sharpness.defaults(), recipe(0, .3, 30), recipe(-0, 3, 0)]) assert.equal(sharpness.apply(im, r), im);
  assert.deepEqual(im.data, before);
});
test('active output is owned, deterministic, and cannot mutate source or adjacent offset bytes', () => {
  const im = image(257, 257, (x, y) => gray(40 + (x * 7 + y * 11) % 180)), before = im.data.slice();
  const a = sharpness.apply(im, recipe()), b = sharpness.apply(im, recipe());
  assert.notEqual(a, im); assert.notEqual(a.data.buffer, im.data.buffer); assert.deepEqual(a.data, b.data); assert.ok(changedPixels(a.data, im.data) > 1000);
  a.data.fill(0); assert.deepEqual(im.data, before);
  for (const Type of [Uint8Array, Uint8ClampedArray]) {
    const backing = new Type([1, 2, 3, 4, 65, 90, 120, 255, 5, 6, 7, 8]), copy = backing.slice();
    const pixel = { width: 1, height: 1, data: backing.subarray(4, 8) }, out = sharpness.apply(pixel, recipe());
    assert.ok(out.data instanceof Uint8ClampedArray); assert.deepEqual(backing, copy); assert.deepEqual([...out.data], [65, 90, 120, 255]);
  }
});
test('plan is dimensions-only, no allocation, and off has zero workspace/work', () => {
  const c = vm.createContext({}); vm.runInContext(source, c);
  const output = vm.runInContext(`(() => {
    let allocations = 0;
    for (const name of ['Float32Array', 'Float64Array', 'Uint8ClampedArray']) globalThis[name] = new Proxy(globalThis[name], { construct(t,a) { allocations++; return Reflect.construct(t,a); } });
    const p = MintSharpness.plan({width:4096,height:4096},{version:1,amount:100,radius:3,threshold:0});
    return [allocations,p.maxWorkingBytes,p.workUnits];
  })()`, c);
  assert.equal(output[0], 0); assert.equal(output[1], 268535808); assert.equal(output[2], 403783680);
  for (const r of [null, sharpness.defaults()]) {
    const p = sharpness.plan({ width: 4096, height: 4096 }, r);
    assert.equal(p.workUnits, 0); assert.equal(p.maxWorkingBytes, 0); assert.equal(p.opaqueWorkingBytes, 0); assert.equal(p.maxTotalBytes, 67108864);
  }
  assert.throws(() => sharpness.plan(image(1, 1), recipe()), /fields/);
});
test('radius is exact short-edge normalized variance with continuous fractional taps, not a pixel floor', () => {
  for (const size of [{ width: 1, height: 1 }, { width: 720, height: 1080 }, { width: 1000, height: 1300 }, { width: 16384, height: 1024 }, { width: 4096, height: 4096 }]) for (const radius of [.3, .577350269, 1, 1.41421356, 3]) {
    const p = sharpness.plan(size, recipe(100, radius)), n = p.boxRadius, f = p.edgeWeight;
    const actualVariance = (n * (n + 1) * (2 * n + 1) / 3 + 2 * f * (n + 1) ** 2) / (2 * n + 1 + 2 * f);
    assert.equal(p.sigmaPixels, radius * Math.min(size.width, size.height) / 1000);
    assert.ok(Math.abs(actualVariance * 3 - p.sigmaPixels ** 2) < 1e-10);
    assert.ok(p.maxWorkingBytes <= sharpness.LIMITS.workingBytes);
    assert.equal(p.maxTotalBytes, p.inputBytes + p.maxWorkingBytes);
  }
  const a = sharpness.plan({ width: 500, height: 750 }, recipe()), b = sharpness.plan({ width: 1000, height: 1500 }, recipe());
  assert.equal(a.sigmaPixels * 2, b.sigmaPixels);
});
test('opaque and alpha-weighted convolution match an independent brute-force reference', () => {
  const rand = random();
  const im = image(257, 257, (x, y) => [Math.floor(rand() * 256), Math.floor(rand() * 256), Math.floor(rand() * 256), (x + y) % 7 === 0 ? 0 : (x + y) % 5 === 0 ? 51 : 255]);
  for (const r of [recipe(100, 3, 0), recipe(63.25, 2.5, 4)]) {
    const actual = sharpness.apply(im, r).data, expected = reference(im, r);
    assert.ok(maxByteDiff(actual, expected) <= 1); assert.ok(changedPixels(actual, im.data) > 1000);
  }
  for (let i = 3; i < im.data.length; i += 4) im.data[i] = 255;
  assert.ok(maxByteDiff(sharpness.apply(im, recipe()).data, reference(im, recipe())) <= 1);
});
test('flat images, one-pixel/one-row/one-column inputs and borders stay byte-exact', () => {
  for (const [w, h] of [[1, 1], [1, 19], [19, 1], [2, 2], [513, 497]]) for (const color of [[0, 0, 0, 255], [255, 255, 255, 255], [45, 120, 234, 255], [55, 130, 200, 63], [251, 4, 180, 0]]) {
    const im = image(w, h, () => color); assert.deepEqual(sharpness.apply(im, recipe()).data, im.data);
  }
});
test('all alpha values are unchanged and zero-coverage hidden RGB cannot affect visible pixels', () => {
  const rand = random(), im = image(400, 400, (x, y) => [70 + x % 128, 70 + y % 128, 110, (x * 13 + y * 7) % 256]);
  const changedHidden = { ...im, data: im.data.slice() }, before = im.data.slice();
  for (let i = 0; i < im.data.length; i += 4) if (im.data[i + 3] === 0) for (let c = 0; c < 3; c++) changedHidden.data[i + c] = Math.floor(rand() * 256);
  const a = sharpness.apply(im, recipe()).data, b = sharpness.apply(changedHidden, recipe()).data;
  for (let i = 0; i < a.length; i += 4) {
    assert.equal(a[i + 3], im.data[i + 3]);
    if (im.data[i + 3] === 0) { assert.deepEqual(a.slice(i, i + 4), im.data.slice(i, i + 4)); assert.deepEqual(b.slice(i, i + 4), changedHidden.data.slice(i, i + 4)); }
    else assert.deepEqual(a.slice(i, i + 4), b.slice(i, i + 4));
  }
  assert.deepEqual(im.data, before);
});
test('constant opaque colors beside transparency stay exact, without dark matte fringes', () => {
  for (const alpha of [0, 1, 47, 127, 254]) {
    const im = image(600, 600, (x, y) => x < 300 && y < 400 ? [71, 117, 182, 255] : alpha === 0 ? [(x * 17) % 256, (y * 13) % 256, 255, 0] : [71, 117, 182, alpha]);
    assert.deepEqual(sharpness.apply(im, recipe()).data, im.data);
  }
});
test('full strength does not create extrema, halos or clipping on sharp gray and saturated steps', () => {
  for (const [left, right] of [[[0, 0, 0], [255, 255, 255]], [[40, 40, 40], [220, 220, 220]], [[255, 0, 0], [0, 0, 255]], [[70, 20, 10], [220, 80, 30]]]) {
    const im = image(1000, 1000, x => [...(x < 500 ? left : right), 255]);
    assert.deepEqual(sharpness.apply(im, recipe()).data, im.data);
  }
});
test('full strength preserves smooth ramps without edge reversals or increased endpoints', () => {
  const im = image(1000, 1000, x => gray(Math.round(20 + x * 215 / 999))), out = sharpness.apply(im, recipe()).data;
  assert.ok(maxByteDiff(out, im.data) <= 1);
  for (let x = 1; x < 1000; x++) assert.ok(out[x * 4] >= out[(x - 1) * 4]);
  assert.equal(out[0], 20); assert.equal(out[999 * 4], 235);
});
test('blurred edge has a meaningful, bounded increase in center slope without invented extrema', () => {
  const im = image(1000, 1000, x => gray(Math.round(40 + 180 / (1 + Math.exp(-(x - 500) / 2))))), out = sharpness.apply(im, recipe()).data;
  const originalSlope = im.data[501 * 4] - im.data[499 * 4], improvedSlope = out[501 * 4] - out[499 * 4];
  assert.ok(improvedSlope >= originalSlope * 1.1, `${originalSlope} -> ${improvedSlope}`);
  assert.ok(maxByteDiff(out, im.data) >= 3); assert.ok(maxByteDiff(out, im.data) <= 12);
  for (let x = 0; x < 1000; x++) { assert.ok(out[x * 4] >= 40 && out[x * 4] <= 220); if (x) assert.ok(out[x * 4] >= out[(x - 1) * 4]); }
});
test('threshold suppresses seeded low-amplitude noise; amount zero is not a denoiser', () => {
  const rand = random(), im = image(512, 512, () => gray(128 + Math.floor(rand() * 17) - 8));
  const a = sharpness.apply(im, recipe(100, 3, 0)).data, b = sharpness.apply(im, recipe(100, 3, 3)).data, c = sharpness.apply(im, recipe(100, 3, 30)).data;
  const variance = d => { let sum = 0; for (let i = 0; i < d.length; i += 4) sum += (d[i] - 128) ** 2; return sum / (d.length / 4); };
  assert.ok(changedPixels(a, im.data) > 1000); assert.ok(changedPixels(b, im.data) < changedPixels(a, im.data)); assert.deepEqual(c, im.data);
  assert.ok(variance(a) >= variance(im.data)); assert.ok(variance(a) <= variance(im.data) * 1.3);
  assert.ok(variance(b) <= variance(a)); assert.ok(maxByteDiff(a, im.data) <= 3);
});
test('all-visible luminance remains inside the original local range, to byte rounding tolerance', () => {
  const rand = random(), im = image(300, 300, () => [Math.floor(rand() * 256), Math.floor(rand() * 256), Math.floor(rand() * 256), rand() < .1 ? 0 : 255]), out = sharpness.apply(im, recipe()).data;
  for (let y = 0; y < 300; y++) for (let x = 0; x < 300; x++) {
    const i = (y * 300 + x) * 4; if (!im.data[i + 3]) continue;
    let lo = Infinity, hi = -Infinity;
    for (let yy = Math.max(0, y - 1); yy <= Math.min(299, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(299, x + 1); xx++) {
      const k = (yy * 300 + xx) * 4; if (!im.data[k + 3]) continue;
      const p = code(yAt(im.data, k)); lo = Math.min(lo, p); hi = Math.max(hi, p);
    }
    const p = code(yAt(out, i)); assert.ok(p >= lo - .55 && p <= hi + .55);
    assert.ok(Math.abs(p - code(yAt(im.data, i))) <= 12.55);
  }
});
test('saturated colors keep zero channels and common linear color direction instead of whitening', () => {
  const im = image(512, 512, (x, y) => { const v = 30 + (x * 7 + y * 11) % 210; return x < 256 ? [v, Math.round(v * .4), 0, 255] : [0, Math.round(v * .3), v, 255]; });
  const out = sharpness.apply(im, recipe()).data; let changed = 0;
  for (let i = 0; i < out.length; i += 4) {
    const a = [decode(im.data[i]), decode(im.data[i + 1]), decode(im.data[i + 2])], b = [decode(out[i]), decode(out[i + 1]), decode(out[i + 2])];
    const originalMax = Math.max(...a), finalMax = Math.max(...b);
    for (let c = 0; c < 3; c++) { if (a[c] === 0) assert.equal(out[i + c], 0); assert.ok(Math.abs(a[c] / originalMax - b[c] / finalMax) < .025); }
    if (out[i] !== im.data[i] || out[i + 1] !== im.data[i + 1] || out[i + 2] !== im.data[i + 2]) changed++;
  }
  assert.ok(changed > 1000);
});

// Adversarial schema, storage, and cancellation boundaries.
test('rejects unknown, missing, unsafe-prototype, inherited, symbol and nonenumerable recipe fields', () => {
  const invalid = [undefined, [], 1, '', true, new Date(), { ...recipe(), revision: 1 }, { ...recipe(), version: 2 }, Object.create(recipe()), Object.assign(Object.create({ inherited: 1 }), recipe()), { ...recipe(), [Symbol('x')]: 1 }];
  const hidden = recipe(); Object.defineProperty(hidden, 'amount', { value: 100, enumerable: false }); invalid.push(hidden);
  const missing = recipe(); delete missing.radius; invalid.push(missing);
  for (const r of invalid) assert.throws(() => sharpness.validate(r), TypeError);
});
test('finite primitive ranges reject coercions even while amount is off', () => {
  for (const [field, values] of Object.entries({ amount: [-1, 100.01, NaN, Infinity, '10', null, new Number(10)], radius: [0, .2999, 3.001, NaN, -Infinity, '1'], threshold: [-.01, 30.01, NaN, Infinity, '3'] })) for (const value of values) assert.throws(() => sharpness.validate({ ...recipe(0), [field]: value }), TypeError);
});
test('record accessors are never invoked for recipe, image, dimensions or cancellation options', () => {
  let gets = 0;
  const bad = (base, key) => { Object.defineProperty(base, key, { get() { gets++; throw new Error('getter'); }, enumerable: true }); return base; };
  const im = image(1, 1);
  assert.throws(() => sharpness.validate(bad(recipe(), 'radius')), TypeError);
  assert.throws(() => sharpness.apply(bad({ ...im }, 'data'), recipe()), TypeError);
  assert.throws(() => sharpness.plan(bad({ width: 1, height: 1 }, 'width'), recipe()), TypeError);
  assert.throws(() => sharpness.apply(im, recipe(), bad({}, 'shouldCancel')), TypeError);
  assert.equal(gets, 0);
});
test('dimension, storage and options validation happens before processing, also on identity', () => {
  for (const size of [{ width: 0, height: 1 }, { width: 1.5, height: 1 }, { width: 16385, height: 1 }, { width: 4097, height: 4096 }, { width: NaN, height: 1 }, { width: '1', height: 1 }, { width: 1, height: Infinity }]) {
    assert.throws(() => sharpness.plan(size, recipe()), TypeError); assert.throws(() => sharpness.apply({ ...size, data: new Uint8Array(4) }, null), TypeError);
  }
  class Bytes extends Uint8Array {}
  const invalid = [[], new Uint16Array(4), new DataView(new ArrayBuffer(4)), new Bytes(4), new Uint8Array(3), new Proxy(new Uint8Array(4), {})];
  if (typeof SharedArrayBuffer === 'function') invalid.push(new Uint8Array(new SharedArrayBuffer(4)));
  for (const data of invalid) assert.throws(() => sharpness.apply({ width: 1, height: 1, data }, null), TypeError);
  for (const options of [null, [], { unknown: true }, { shouldCancel: true }, Object.create({ shouldCancel() {} })]) assert.throws(() => sharpness.apply(image(1, 1), null, options), TypeError);
});
test('resizable and detached storage are rejected when supported', () => {
  if ('resizable' in ArrayBuffer.prototype) {
    const buffer = new ArrayBuffer(4, { maxByteLength: 8 });
    assert.throws(() => sharpness.apply({ width: 1, height: 1, data: new Uint8Array(buffer) }, null), TypeError);
  }
  const im = image(1, 1); structuredClone(im.data.buffer, { transfer: [im.data.buffer] });
  assert.throws(() => sharpness.apply(im, recipe()), TypeError);
});
test('intrinsic typed storage getters bypass shadowed metadata and typed methods', () => {
  const im = image(1, 1), before = [...im.data]; let gets = 0;
  for (const key of ['length', 'buffer', 'byteLength', 'byteOffset', 'slice', 'set']) Object.defineProperty(im.data, key, { get() { gets++; throw Error('shadow'); } });
  assert.deepEqual([...sharpness.apply(im, recipe()).data], before); assert.equal(gets, 0);
});
test('cancel before processing allocates no typed buffers, including identity', () => {
  const c = vm.createContext({}); vm.runInContext(source, c);
  const result = vm.runInContext(`(() => {
    const image = {width:1,height:1,data:new Uint8Array([1,2,3,255])}; let allocations=0, aborts=0;
    for (const name of ['Float32Array', 'Float64Array', 'Uint8ClampedArray']) globalThis[name] = new Proxy(globalThis[name], {construct(t,a) {allocations++; return Reflect.construct(t,a);}});
    for (const recipe of [null,{version:1,amount:100,radius:3,threshold:0}]) try {MintSharpness.apply(image,recipe,{shouldCancel:()=>true});} catch (e) {if(e.name==='AbortError' && e.code==='ABORT_ERR') aborts++;}
    return [allocations,aborts];
  })()`, c);
  assert.deepEqual([...result], [0, 2]);
});
test('cancellation during allocation/blur/alpha/output and final checkpoint publishes nothing', () => {
  const im = image(300, 300, (x, y) => [x % 256, y % 256, 120, (x + y) % 256]), before = im.data.slice(); let total = 0;
  sharpness.apply(im, recipe(), { shouldCancel() { total++; return false; } });
  for (const stop of [1, 2, 3, 4, 10, Math.floor(total / 2), total - 1, total]) {
    let calls = 0, output;
    aborts(() => { output = sharpness.apply(im, recipe(), { shouldCancel() { return ++calls === stop; } }); });
    assert.equal(output, undefined); assert.deepEqual(im.data, before);
  }
});
test('callback transfer at initial or later checkpoints rejects detached data, never zero-filled output', () => {
  for (const at of [1, 8]) {
    const im = image(100, 100); let calls = 0;
    assert.throws(() => sharpness.apply(im, recipe(), { shouldCancel() { if (++calls === at) structuredClone(im.data.buffer, { transfer: [im.data.buffer] }); return false; } }), /buffer changed/);
  }
});
test('byte results do not depend on cancellation callback presence or chunk boundaries', () => {
  const im = image(1031, 1003, (x, y) => gray(30 + (x * 5 + y * 3) % 190));
  assert.deepEqual(sharpness.apply(im, recipe()).data, sharpness.apply(im, recipe(), { shouldCancel: () => false }).data);
});
