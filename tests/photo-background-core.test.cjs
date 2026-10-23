'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const overlay = require('../app/src/main/assets/image-overlay.js');
const core = require('../app/src/main/assets/photo-background.js');
const { LIMITS, defaults, validate, plan, apply } = core;
const recipe = (p = {}) => ({ ...defaults(), ...p });
function image(width, height, pixels = [0, 0, 0, 0]) {
  const data = new Uint8ClampedArray(width * height * 4);
  if (pixels.length === data.length) data.set(pixels);
  else for (let i = 0; i < data.length; i += 4) data.set(pixels, i);
  return { width, height, data };
}
function mask(width, height, values = 0) {
  const data = typeof values === 'number' ? new Float32Array(width * height).fill(values) : new Float32Array(values);
  return { width, height, data };
}
function asset(width, height, pixels) { return overlay.encodeAsset(image(width, height, pixels)); }
function at(im, x = 0, y = 0) { return Array.from(im.data.slice((y * im.width + x) * 4, (y * im.width + x + 1) * 4)); }
function bad(fn, code = 'PHOTO_BACKGROUND_INVALID') { assert.throws(fn, e => e.code === code); }
function near(actual, expected, tolerance = 1) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) assert(Math.abs(actual[i] - expected[i]) <= tolerance, `channel ${i}: ${actual[i]} != ${expected[i]}`);
}
function linear(n) { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }
function srgb(n) { return Math.round(255 * (n <= .0031308 ? n * 12.92 : 1.055 * n ** (1 / 2.4) - .055)); }
function random(seed) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }

// Independent small-image reference. Integrates the original texel rectangles
// for minification; for magnification uses explicit four-neighbor weights.
// Randomized comparisons below intentionally stay below the mip threshold.
function oracle(source, confidence, background, r) {
  const output = image(source.width, source.height), w = source.width, h = source.height;
  const s = r.fit === 'fill' ? Math.max(w / background.width, h / background.height) : Math.min(w / background.width, h / background.height);
  const dw = background.width * s, dh = background.height * s;
  const ox = (w - dw) * r.x, oy = (h - dh) * r.y;
  const back = r.backdrop === null ? null : [1, 3, 5].map(p => linear(parseInt(r.backdrop.slice(p, p + 2), 16)));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, fa = source.data[i + 3] / 255 * confidence.data[y * w + x];
    const sum = [0, 0, 0, 0];
    const l = Math.max(x, ox), t = Math.max(y, oy), rr = Math.min(x + 1, ox + dw), b = Math.min(y + 1, oy + dh);
    const coverage = Math.max(0, rr - l) * Math.max(0, b - t);
    function add(sx, sy, weight) {
      const k = (sy * background.width + sx) * 4, a = background.data[k + 3] / 255;
      for (let c = 0; c < 3; c++) sum[c] += linear(background.data[k + c]) * a * weight;
      sum[3] += a * weight;
    }
    if (coverage > 0) {
      if (s < 1) {
        const lx = (l - ox) / s, rx = (rr - ox) / s, ty = (t - oy) / s, by = (b - oy) / s;
        for (let sy = 0; sy < background.height; sy++) for (let sx = 0; sx < background.width; sx++) {
          const overlap = Math.max(0, Math.min(rx, sx + 1) - Math.max(lx, sx)) * Math.max(0, Math.min(by, sy + 1) - Math.max(ty, sy));
          if (overlap) add(sx, sy, overlap * s * s);
        }
      } else {
        const px = Math.max(0, Math.min(background.width - 1, ((l + rr) / 2 - ox) / s - .5));
        const py = Math.max(0, Math.min(background.height - 1, ((t + b) / 2 - oy) / s - .5));
        const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
        for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) {
          add(Math.min(background.width - 1, ix + xx), Math.min(background.height - 1, iy + yy), (xx ? fx : 1 - fx) * (yy ? fy : 1 - fy) * coverage);
        }
      }
    }
    if (back) { for (let c = 0; c < 3; c++) sum[c] += back[c] * (1 - sum[3]); sum[3] = 1; }
    const oa = fa + sum[3] * (1 - fa), alpha = Math.round(oa * 255);
    if (!alpha) continue;
    for (let c = 0; c < 3; c++) output.data[i + c] = srgb(Math.max(0, Math.min(1, (linear(source.data[i + c]) * fa + sum[c] * (1 - fa)) / oa)));
    output.data[i + 3] = alpha;
  }
  return output;
}

test('frozen API, fresh defaults, CommonJS/browser/AMD dependency contract', () => {
  assert(Object.isFrozen(core)); assert(Object.isFrozen(LIMITS));
  assert.deepEqual(Object.keys(core).sort(), ['LIMITS', 'defaults', 'validate', 'plan', 'apply'].sort());
  assert.notEqual(defaults(), defaults()); assert(Object.isFrozen(defaults()));
  assert.deepEqual(defaults(), { version: 1, fit: 'fill', x: .5, y: .5, backdrop: null });
  const code = fs.readFileSync(__dirname + '/../app/src/main/assets/photo-background.js', 'utf8');
  const browser = { MintImageOverlay: overlay }; vm.runInNewContext(code, browser);
  assert.equal(typeof browser.MintPhotoBackground.apply, 'function');
  let amd; const define = (dependencies, factory) => { assert.equal(dependencies[0], './image-overlay'); amd = factory(overlay); }; define.amd = {};
  vm.runInNewContext(code, { define }); assert.equal(typeof amd.plan, 'function');
  assert.throws(() => vm.runInNewContext(code, {}), /requires MintImageOverlay/);
});

test('canonical recipe snapshots and strict complete finite schemas', () => {
  const r = recipe({ x: -0, y: -0, backdrop: '#AbCdEF' }), got = validate(r);
  assert(Object.isFrozen(got)); assert.equal(got.backdrop, '#abcdef'); assert(!Object.is(got.x, -0));
  r.x = 1; assert.equal(got.x, 0);
  assert.deepEqual(validate(Object.assign(Object.create(null), defaults())), defaults());
  let calls = 0;
  for (const key of Object.keys(defaults())) {
    const missing = recipe(); delete missing[key]; bad(() => validate(missing));
    const getter = recipe(); Object.defineProperty(getter, key, { enumerable: true, get() { calls++; throw Error('getter'); } }); bad(() => validate(getter));
    const hidden = recipe(); Object.defineProperty(hidden, key, { enumerable: false, value: hidden[key] }); bad(() => validate(hidden));
  }
  for (const v of [null, undefined, [], new Date(), true, '{}', Object.assign(Object.create({}), defaults()), { ...defaults(), extra: 1 }, { ...defaults(), [Symbol()]: 1 }]) bad(() => validate(v));
  for (const x of [NaN, Infinity, -Infinity, '0', null, true, new Number(.5)]) bad(() => validate(recipe({ x })));
  for (const x of [-.001, 1.001]) bad(() => validate(recipe({ x })), 'PHOTO_BACKGROUND_LIMIT');
  for (const patch of [{ version: 2 }, { fit: 'cover' }, { fit: 'contain' }, { backdrop: '#abc' }, { backdrop: 'red' }, { backdrop: '#ffffff00' }, { backdrop: false }]) bad(() => validate(recipe(patch)));
  assert.equal(calls, 0);
});

test('asset schema and base64 use the frozen strict overlay validator', () => {
  const a = asset(1, 1, [1, 2, 3, 255]);
  for (const key of Object.keys(a)) {
    const missing = { ...a }; delete missing[key]; bad(() => plan(1, 1, missing, defaults()));
    let calls = 0; const getter = { ...a }; Object.defineProperty(getter, key, { enumerable: true, get() { calls++; return a[key]; } });
    bad(() => plan(1, 1, getter, defaults())); assert.equal(calls, 0);
  }
  for (const data of ['AAAAAB==', 'AAAAAA\n=', 'AAAAAA__', 'AAAAAA=A', 'AAAAA===', new String(a.data)]) bad(() => plan(1, 1, { ...a, data }, defaults()));
  for (const patch of [{ version: 0 }, { url: 'https://example.invalid/' }, { uri: 'file:///x' }, { [Symbol()]: true }]) bad(() => plan(1, 1, { ...a, ...patch }, defaults()));
  bad(() => plan(1, 1, Object.assign(Object.create({}), a), defaults()));
  for (const [width, height] of [[0, 1], [1025, 1], [1, 1025], [1.1, 1], [NaN, 1]]) bad(() => plan(1, 1, { ...a, width, height }, defaults()), 'PHOTO_BACKGROUND_LIMIT');
});

test('image and mask records reject own getters, inherited fields, hidden keys, extras and symbols', () => {
  const a = asset(1, 1, [1, 2, 3, 255]); let calls = 0;
  for (const which of ['image', 'mask']) for (const key of ['width', 'height', 'data']) {
    const value = which === 'image' ? image(1, 1) : mask(1, 1);
    Object.defineProperty(value, key, { enumerable: true, get() { calls++; throw Error('getter'); } });
    bad(() => apply(which === 'image' ? value : image(1, 1), which === 'mask' ? value : mask(1, 1), a, defaults()));
  }
  for (const which of ['image', 'mask']) for (const shape of ['missing', 'extra', 'symbol', 'hidden', 'prototype']) {
    let value = which === 'image' ? image(1, 1) : mask(1, 1);
    if (shape === 'missing') delete value.data;
    if (shape === 'extra') value.extra = true;
    if (shape === 'symbol') value[Symbol()] = true;
    if (shape === 'hidden') Object.defineProperty(value, 'data', { enumerable: false, value: value.data });
    if (shape === 'prototype') value = Object.assign(Object.create({ get poisoned() { calls++; } }), value);
    bad(() => apply(which === 'image' ? value : image(1, 1), which === 'mask' ? value : mask(1, 1), a, defaults()));
  }
  assert.equal(calls, 0);
});

test('strict native array brands, realm, fixed attached buffers and lengths', () => {
  const a = asset(1, 1, [1, 2, 3, 255]);
  for (const data of [[], Buffer.alloc(4), new Uint16Array(4), new Float32Array(4), new DataView(new ArrayBuffer(4)), new Uint8Array(5), new Proxy(new Uint8Array(4), {}), vm.runInNewContext('new Uint8Array(4)')]) bad(() => apply({ width: 1, height: 1, data }, mask(1, 1), a, defaults()));
  for (const data of [[], new Float64Array(1), new Uint8Array(1), new Float32Array(2), new Proxy(new Float32Array(1), {}), vm.runInNewContext('new Float32Array(1)')]) bad(() => apply(image(1, 1), { width: 1, height: 1, data }, a, defaults()));
  class U8 extends Uint8Array {} class F32 extends Float32Array {} class AB extends ArrayBuffer {}
  bad(() => apply({ width: 1, height: 1, data: new U8(4) }, mask(1, 1), a, defaults()));
  bad(() => apply(image(1, 1), { width: 1, height: 1, data: new F32(1) }, a, defaults()));
  for (const [Type, which] of [[Uint8Array, 'image'], [Float32Array, 'mask']]) {
    const n = which === 'image' ? 4 : 1;
    const buffers = [new AB(4)];
    if (typeof SharedArrayBuffer !== 'undefined') buffers.push(new SharedArrayBuffer(4));
    if (Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')) buffers.push(new ArrayBuffer(4, { maxByteLength: 8 }));
    for (const buffer of buffers) {
      const value = { width: 1, height: 1, data: new Type(buffer, 0, n) };
      bad(() => apply(which === 'image' ? value : image(1, 1), which === 'mask' ? value : mask(1, 1), a, defaults()));
    }
    const data = new Type(n); structuredClone(data, { transfer: [data.buffer] });
    const value = { width: 1, height: 1, data };
    bad(() => apply(which === 'image' ? value : image(1, 1), which === 'mask' ? value : mask(1, 1), a, defaults()));
  }
});

test('intrinsic typed getters bypass shadow getters; offset views work without reading outside them', () => {
  const ib = new Uint8Array([9, 9, 9, 9, 17, 39, 227, 255, 8, 8, 8, 8]);
  const mb = new Float32Array([NaN, 1, NaN]);
  const im = { width: 1, height: 1, data: ib.subarray(4, 8) }, m = { width: 1, height: 1, data: mb.subarray(1, 2) };
  let calls = 0;
  for (const data of [im.data, m.data]) for (const key of ['length', 'buffer', 'byteOffset', 'subarray', 'set']) Object.defineProperty(data, key, { get() { calls++; throw Error('shadow'); } });
  assert.equal(apply(im, m, asset(1, 1, [255, 0, 0, 255]), defaults()), im);
  assert.equal(calls, 0); assert.equal(mb[2] !== mb[2], true);
});

test('strict mask dimensions and continuous finite range, including every value before identity return', () => {
  const im = image(2, 1, [3, 4, 5, 255]), a = asset(1, 1, [0, 0, 0, 0]);
  bad(() => apply(im, mask(1, 2, 1), a, defaults()));
  for (const value of [NaN, Infinity, -Infinity, -.001, 1.001]) bad(() => apply(im, mask(2, 1, [1, value]), a, defaults()));
  assert.equal(apply(im, mask(2, 1, 1), a, defaults()), im);
  const nullImage = Object.assign(Object.create(null), im), nullMask = Object.assign(Object.create(null), mask(2, 1, 1));
  assert.equal(apply(nullImage, nullMask, a, defaults()), nullImage);
});

test('integer target limits checked by plan and apply before image/mask traversal', () => {
  const a = asset(1, 1, [0, 0, 0, 0]);
  for (const [w, h] of [[0, 1], [1, 0], [1.5, 1], [4097, 1], [4000, 2001], [NaN, 1], [1, Infinity], ['2', 2]]) {
    bad(() => plan(w, h, a, defaults()), 'PHOTO_BACKGROUND_LIMIT');
    bad(() => apply({ width: w, height: h, data: new Uint8Array(4) }, mask(1, 1), a, defaults()), 'PHOTO_BACKGROUND_LIMIT');
  }
});

test('fill crop and fit padding placement are exact on asymmetric synthetic images', () => {
  const a = asset(4, 2, [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
    20, 30, 40, 255, 50, 60, 70, 255, 80, 90, 100, 255, 110, 120, 130, 255]);
  for (const x of [0, .5, 1]) {
    const r = recipe({ x }), p = plan(2, 2, a, r), result = apply(image(2, 2), mask(2, 2), a, r);
    assert.equal(p.left, -2 * x); assert.equal(p.top, 0); assert.equal(p.drawWidth, 4);
    const decoded = overlay.decodeAsset(a);
    for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) assert.deepEqual(at(result, xx, yy), at(decoded, xx + x * 2, yy));
  }
  const two = asset(2, 1, [255, 0, 0, 255, 0, 0, 255, 255]);
  for (const y of [0, .5, 1]) {
    const r = recipe({ fit: 'fit', y }), p = plan(2, 3, two, r), result = apply(image(2, 3), mask(2, 3), two, r);
    assert.equal(p.top, 2 * y); assert.equal(p.drawHeight, 1);
    for (let yy = 0; yy < 3; yy++) assert.deepEqual(at(result, 0, yy), yy === y * 2 ? [255, 0, 0, 255] : [0, 0, 0, 0]);
  }
});

test('fit fractional border uses analytic area coverage instead of a threshold', () => {
  const a = asset(2, 1, [80, 120, 200, 255]);
  const result = apply(image(2, 2), mask(2, 2), a, recipe({ fit: 'fit' }));
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) assert.deepEqual(at(result, x, y), [80, 120, 200, 128]);
  const edge = apply(image(2, 2), mask(2, 2), a, recipe({ fit: 'fit', y: .1 }));
  near(at(edge, 0, 0), [80, 120, 200, 230]); near(at(edge, 0, 1), [80, 120, 200, 26]);
});

test('foreground confidence is multiplied by source alpha, not thresholded', () => {
  const src = image(5, 1, [255, 0, 0, 128]), m = mask(5, 1, [0, .25, .5, .75, 1]), a = asset(1, 1, [0, 0, 255, 255]);
  const result = apply(src, m, a, defaults());
  for (let x = 0; x < 5; x++) {
    const fa = 128 / 255 * m.data[x];
    near(at(result, x), [srgb(fa), 0, srgb(1 - fa), 255], 0);
  }
  assert.deepEqual(at(result, 0), [0, 0, 255, 255]); assert(at(result, 1)[0] < at(result, 2)[0]);
});

test('linear-light blend differs from an sRGB byte midpoint', () => {
  const result = apply(image(1, 1, [255, 255, 255, 255]), mask(1, 1, .5), asset(1, 1, [0, 0, 0, 255]), defaults());
  assert.deepEqual(at(result), [188, 188, 188, 255]);
});

test('optional backdrop sits behind photo alpha and fit padding before foreground composition', () => {
  const a = asset(1, 1, [255, 0, 0, 128]), r = recipe({ fit: 'fit', x: 0, backdrop: '#0000ff' });
  const result = apply(image(3, 1), mask(3, 1), a, r);
  near(at(result), [188, 0, 187, 255]); assert.deepEqual(at(result, 1), [0, 0, 255, 255]);
  const transparent = apply(image(1, 1, [71, 82, 93, 0]), mask(1, 1, 1), asset(1, 1, [123, 45, 67, 0]), recipe({ backdrop: '#234567' }));
  assert.deepEqual(at(transparent), [35, 69, 103, 255]);
});

test('transparent hidden RGB never bleeds during bilinear or area filtering', () => {
  const a = asset(2, 1, [0, 255, 0, 0, 255, 0, 0, 255]);
  const enlarged = apply(image(8, 4, [0, 0, 255, 0]), mask(8, 4, 1), a, defaults());
  for (let i = 0; i < enlarged.data.length; i += 4) {
    assert.equal(enlarged.data[i + 1], 0); assert.equal(enlarged.data[i + 2], 0);
    if (enlarged.data[i + 3]) assert.equal(enlarged.data[i], 255);
  }
  const reduced = apply(image(1, 1), mask(1, 1), a, recipe({ fit: 'fit' }));
  near(at(reduced), [255, 0, 0, 64]);
});

test('fully transparent outputs normalize hidden colors; no source RGB leaks at mask zero', () => {
  const src = image(1, 1, [255, 65, 127, 0]);
  assert.deepEqual(at(apply(src, mask(1, 1, 1), asset(1, 1, [3, 9, 222, 0]), defaults())), [0, 0, 0, 0]);
  assert.deepEqual(at(apply(image(1, 1, [255, 0, 0, 255]), mask(1, 1, 0), asset(1, 1, [0, 255, 0, 255]), defaults())), [0, 255, 0, 255]);
  assert.deepEqual(at(apply(image(1, 1, [255, 0, 0, 1]), mask(1, 1, .0001), asset(1, 1, [0, 0, 0, 0]), defaults())), [0, 0, 0, 0]);
});

test('transparent background preserves selected source RGB exactly and scales only alpha', () => {
  const src = image(1, 1, [17, 39, 227, 137]), a = asset(1, 1, [255, 255, 255, 0]);
  assert.equal(apply(src, mask(1, 1, 1), a, defaults()), src);
  assert.deepEqual(at(apply(src, mask(1, 1, .5), a, defaults())), [17, 39, 227, 69]);
});

test('every opaque foreground pixel is exact and remains at original coordinates for all placements', () => {
  const src = image(7, 5), m = mask(7, 5), rng = random(91);
  for (let pixel = 0; pixel < 35; pixel++) {
    for (let c = 0; c < 3; c++) src.data[pixel * 4 + c] = Math.floor(rng() * 256);
    src.data[pixel * 4 + 3] = 255; m.data[pixel] = pixel % 3 === 0 ? 1 : .3;
  }
  const a = asset(3, 8, [255, 255, 255, 255]);
  for (const fit of ['fill', 'fit']) for (const x of [0, .37, 1]) for (const y of [0, .61, 1]) {
    const result = apply(src, m, a, recipe({ fit, x, y, backdrop: '#112233' }));
    assert.equal(result.width, 7); assert.equal(result.height, 5);
    for (let pixel = 0; pixel < 35; pixel += 3) assert.deepEqual(Array.from(result.data.slice(pixel * 4, pixel * 4 + 4)), Array.from(src.data.slice(pixel * 4, pixel * 4 + 4)));
  }
  assert.equal(apply(src, mask(7, 5, 1), a, defaults()), src);
});

test('source, mask and embedded asset never mutate, including shared backing stores', () => {
  const src = image(3, 2, [99, 42, 210, 150]), m = mask(3, 2, [.1, .2, .3, .4, .5, .6]), a = asset(2, 1, [10, 20, 30, 128]);
  const beforeSource = Buffer.from(src.data), beforeMask = Buffer.from(m.data.buffer), beforeAsset = JSON.stringify(a);
  const result = apply(src, m, a, defaults());
  assert.notEqual(result.data, src.data); assert.deepEqual(Buffer.from(src.data), beforeSource); assert.deepEqual(Buffer.from(m.data.buffer), beforeMask); assert.equal(JSON.stringify(a), beforeAsset);
  const shared = new Float32Array([.5, .75]), sharedBefore = Buffer.from(shared.buffer);
  const aliasImage = { width: 2, height: 1, data: new Uint8Array(shared.buffer) };
  const aliasMask = { width: 2, height: 1, data: shared };
  apply(aliasImage, aliasMask, a, defaults()); assert.deepEqual(Buffer.from(shared.buffer), sharedBefore);
});

test('small randomized images match independent linear-light oracle without mips', () => {
  const rng = random(523);
  for (let n = 0; n < 120; n++) {
    const w = 2 + Math.floor(rng() * 6), h = 2 + Math.floor(rng() * 6);
    const aw = 1 + Math.floor(rng() * 4), ah = 1 + Math.floor(rng() * 4);
    const src = image(w, h), bg = image(aw, ah), m = mask(w, h);
    for (let i = 0; i < src.data.length; i++) src.data[i] = Math.floor(rng() * 256);
    for (let i = 0; i < bg.data.length; i++) bg.data[i] = Math.floor(rng() * 256);
    for (let i = 0; i < m.data.length; i++) m.data[i] = rng();
    const r = recipe({ fit: n % 2 ? 'fit' : 'fill', x: rng(), y: rng(), backdrop: n % 3 ? null : '#325ab7' });
    const a = overlay.encodeAsset(bg); assert.equal(plan(w, h, a, r).mipLevels, 0);
    const expected = oracle(src, m, bg, r), actual = apply(src, m, a, r);
    near(actual.data, expected.data, 1);
  }
});

test('minification suppresses checkerboard aliasing in linear light, not arbitrary pixelation', () => {
  const bg = image(512, 512);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const i = (y * 512 + x) * 4, v = (x + y) % 2 ? 255 : 0;
    bg.data[i] = v; bg.data[i + 1] = v; bg.data[i + 2] = v; bg.data[i + 3] = 255;
  }
  const a = overlay.encodeAsset(bg), r = defaults(), p = plan(7, 7, a, r);
  assert(p.mipLevels > 0); assert(p.mipWidth / p.drawWidth <= 2);
  const result = apply(image(7, 7), mask(7, 7), a, r);
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) assert.deepEqual(at(result, x, y), [188, 188, 188, 255]);
});

test('odd-dimensional minification preserves whole-image premultiplied color/alpha means', () => {
  const bg = image(63, 17), rng = random(917), sums = [0, 0, 0, 0];
  for (let i = 0; i < bg.data.length; i += 4) {
    for (let c = 0; c < 4; c++) bg.data[i + c] = Math.floor(rng() * 256);
    const a = bg.data[i + 3] / 255; sums[3] += a;
    for (let c = 0; c < 3; c++) sums[c] += linear(bg.data[i + c]) * a;
  }
  const a = overlay.encodeAsset(bg), r = recipe({ fit: 'fit' }), result = apply(image(1, 1), mask(1, 1), a, r);
  const expected = sums.slice(0, 3).map(n => srgb(n / sums[3])); expected.push(Math.round(sums[3] / (63 * 17) * 17 / 63 * 255));
  near(at(result), expected, 1);
});

test('extreme aspect ratios preserve tiny geometric coverage and never stretch foreground', () => {
  for (const [aw, ah, w, h] of [[1, 1024, 4096, 1], [1024, 1, 1, 4096]]) {
    const a = asset(aw, ah, [255, 0, 0, 255]);
    const p = plan(w, h, a, recipe({ fit: 'fit' }));
    assert(Number.isFinite(p.scale)); assert(p.mipLevels > 0); assert(p.extraBytes <= LIMITS.maxExtraBytes);
    const fit = apply(image(w, h), mask(w, h), a, recipe({ fit: 'fit' }));
    assert(fit.data.every(v => v === 0), 'sub-half-alpha fit coverage is transparent, not enlarged');
    const fill = apply(image(w, h), mask(w, h), a, defaults());
    for (let pixel = 0; pixel < w * h; pixel++) assert.deepEqual(at(fill, pixel % w, Math.floor(pixel / w)), [255, 0, 0, 255]);
  }
});

test('budget plan is frozen, integer, conservative about decoded + full float mip chain + output', () => {
  const a = asset(1024, 1024, [5, 9, 17, 127]), p = plan(17, 13, a, defaults());
  assert(Object.isFrozen(p)); assert(Object.isFrozen(p.bounds)); assert(Object.isFrozen(p.mipSizes));
  for (const size of p.mipSizes) assert(Object.isFrozen(size));
  assert.equal(p.decodedBytes, 1024 * 1024 * 4); assert.equal(p.baseLinearBytes, 1024 * 1024 * 16);
  assert.equal(p.mipBytes, p.mipSizes.reduce((s, item) => s + item.width * item.height * 16, 0));
  assert.equal(p.outputBytes, 17 * 13 * 4);
  assert.equal(p.extraBytes, p.allowanceBytes + p.decodedBytes + p.baseLinearBytes + p.mipBytes + p.outputBytes);
  assert(Number.isSafeInteger(p.extraBytes)); assert(Number.isSafeInteger(p.workUnits));
  assert(p.extraBytes <= LIMITS.maxExtraBytes); assert(p.workUnits <= LIMITS.maxWorkUnits);
  const large = plan(4000, 2000, a, defaults());
  assert.equal(large.targetPixels, 8000000); assert(large.extraBytes <= LIMITS.maxExtraBytes); assert(large.workUnits <= LIMITS.maxWorkUnits);
});

test('invalid schemas and dimensions do not reach a bulk typed-array allocation', () => {
  const file = fs.readFileSync(__dirname + '/../app/src/main/assets/photo-background.js', 'utf8');
  let allocations = 0;
  function TrackedFloat32(...args) { allocations++; return new Float32Array(...args); } TrackedFloat32.prototype = Float32Array.prototype;
  function TrackedClamped(...args) { allocations++; return new Uint8ClampedArray(...args); } TrackedClamped.prototype = Uint8ClampedArray.prototype;
  const assetCopy = value => ({ version: value.version, width: value.width, height: value.height, data: value.data });
  const overlayBridge = { validateAsset: value => overlay.validateAsset(assetCopy(value)), decodeAsset: value => overlay.decodeAsset(assetCopy(value)) };
  const sandbox = { module: { exports: {} }, require: () => overlayBridge, Uint8Array, Uint8ClampedArray: TrackedClamped,
    Float32Array: TrackedFloat32, Float64Array, ArrayBuffer, Object, Reflect, Number, Math, TypeError, RangeError, Error };
  vm.runInNewContext(file, sandbox); const isolated = sandbox.module.exports;
  // Supply records in its realm; buffer brands remain the explicitly injected natives.
  const run = (expression, props = {}) => { Object.assign(sandbox, props); return vm.runInNewContext(expression, sandbox); };
  const a = asset(1, 1, [1, 2, 3, 255]);
  assert.throws(() => run('module.exports.plan(4000, 2001, a, module.exports.defaults())', { a }));
  assert.throws(() => isolated.apply(image(1, 1), mask(1, 1, NaN), a, defaults(), {}), /Mask confidence must be finite/);
  assert.equal(allocations, 0);
  near(at(isolated.apply(image(1, 1), mask(1, 1), a, defaults(), {})), [1, 2, 3, 255], 0);
  assert.equal(allocations, 2, 'positive control: linear base and output allocations are tracked');
});

test('strict cancellation options and accessor rejection without execution', () => {
  const im = image(1, 1), m = mask(1, 1), a = asset(1, 1, [1, 2, 3, 255]); let calls = 0;
  for (const v of [null, [], true, { shouldCancel: true }, { other: () => false }, Object.create({ shouldCancel() {} })]) bad(() => apply(im, m, a, defaults(), v));
  const getter = {}; Object.defineProperty(getter, 'shouldCancel', { enumerable: true, get() { calls++; return () => false; } });
  bad(() => apply(im, m, a, defaults(), getter)); assert.equal(calls, 0);
  assert.deepEqual(at(apply(im, m, a, defaults(), Object.assign(Object.create(null), { shouldCancel: () => false }))), [1, 2, 3, 255]);
});

test('cooperative cancellation in mask, conversion, mips and output never mutates caller inputs', () => {
  const im = image(129, 127, [10, 80, 200, 100]), m = mask(129, 127, .3), a = asset(513, 511, [200, 150, 20, 180]);
  const before = Buffer.from(im.data), maskBefore = Buffer.from(m.data.buffer), assetBefore = JSON.stringify(a);
  let totalCalls = 0; apply(im, m, a, defaults(), { shouldCancel() { totalCalls++; return false; } });
  assert(totalCalls > 200);
  for (const threshold of [1, 2, 3, 6, 15, 40, 100, totalCalls - 1, totalCalls]) {
    let calls = 0; assert.throws(() => apply(im, m, a, defaults(), { shouldCancel() { return ++calls >= threshold; } }), error => error.code === 'PHOTO_BACKGROUND_CANCELLED' && error.name === 'AbortError');
    assert.deepEqual(Buffer.from(im.data), before); assert.deepEqual(Buffer.from(m.data.buffer), maskBefore); assert.equal(JSON.stringify(a), assetBefore);
  }
});

test('all-opaque identity still validates malformed asset and responds to cancellation', () => {
  const src = image(1, 1, [1, 2, 3, 255]), m = mask(1, 1, 1), a = asset(1, 1, [0, 0, 0, 0]);
  bad(() => apply(src, m, { ...a, data: 'AAAAAB==' }, defaults()));
  let calls = 0; bad(() => apply(src, m, a, defaults(), { shouldCancel() { return ++calls === 4; } }), 'PHOTO_BACKGROUND_CANCELLED');
});
