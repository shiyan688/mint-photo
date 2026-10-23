'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const balance = require('../app/src/main/assets/light-balance.js');
const source = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/light-balance.js'), 'utf8');
const desaturatingControl = require('../quality/light-balance-qa/desaturating-tone-control.cjs');
// The control's UMD publish is shared global state; restore the candidate.
globalThis.MintLightBalance = balance;

const image = (values = [20, 100, 220, 255], width = values.length / 4, height = 1) => ({ width, height, data: new Uint8ClampedArray(values) });
const recipe = (shadows = 0, highlights = 0, whiteBalance = { r: 1, g: 1, b: 1 }) => ({ version: 1, shadows, highlights, whiteBalance });
const activeRecipe = () => recipe(65, -55, { r: 1.15, g: .95, b: 1.2 });
const aborts = fn => assert.throws(fn, e => e.name === 'AbortError' && e.code === 'ABORT_ERR');
function patch(rgb, width = 9, height = 9, alpha = 255) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...rgb, alpha], i);
  return { width, height, data };
}
function ramp() {
  const data = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) data.set([i, i, i, 255], i * 4);
  return { width: 256, height: 1, data };
}
function nullRecord(value) {
  if (value && typeof value === 'object') {
    const out = Object.create(null);
    for (const key of Object.keys(value)) out[key] = nullRecord(value[key]);
    return out;
  }
  return value;
}
// Independent scalar reference: linear WB, common maximum normalization,
// logistic-form eased tone and common RGB scaling/maximum normalization.
// No production numerical helpers or look-up table are used.
const linear = code => { const x = code / 255; return x > .04045 ? ((x + .055) / 1.055) ** 2.4 : x / 12.92; };
const code = value => Math.floor(255 * (value > .0031308 ? 1.055 * Math.max(0, value) ** (1 / 2.4) - .055 : 12.92 * value) + .5 + 1e-10);
const luma = v => v[0] * .2126 + v[1] * .7152 + v[2] * .0722;
function scalarReference(rgba, r) {
  if (rgba[3] === 0) return rgba;
  const gains = [r.whiteBalance.r, r.whiteBalance.g, r.whiteBalance.b];
  const wb = rgba.slice(0, 3).map((v, i) => linear(v) * gains[i]);
  const maximum = Math.max(1, ...wb), bounded = wb.map(v => v / maximum), y = luma(bounded);
  const delta = 2 * Math.log(2) * (r.shadows / 100 * (1 - y) ** 2 + r.highlights / 100 * y ** 2);
  const eased = Math.sign(delta) * delta * delta / (Math.abs(delta) + .1);
  const target = y === 0 || y === 1 ? y : 1 / (1 + Math.exp(-Math.log(y / (1 - y)) - eased));
  const scaled = bounded.map(v => y === 0 ? 0 : v * target / y);
  const toneMaximum = Math.max(1, ...scaled), output = scaled.map(v => v / toneMaximum);
  return [...output.map(v => Math.max(0, Math.min(255, code(v)))), rgba[3]];
}

function hueRamp() {
  const colors = [];
  for (let i = 0; i < 256; i++) colors.push([255, i, 0]);
  for (let i = 255; i >= 0; i--) colors.push([i, 255, 0]);
  for (let i = 0; i < 256; i++) colors.push([0, 255, i]);
  for (let i = 255; i >= 0; i--) colors.push([0, i, 255]);
  for (let i = 0; i < 256; i++) colors.push([i, 0, 255]);
  for (let i = 255; i >= 0; i--) colors.push([255, 0, i]);
  const im = image(colors.flatMap(c => [...c, 255]));
  return { colors, im };
}
// Rejected control is retained as a regression witness, not a fallback API.
function oldControl(rgb, r) {
  const gains = [r.whiteBalance.r, r.whiteBalance.g, r.whiteBalance.b];
  const raw = rgb.map((v, i) => linear(v) * gains[i]);
  const gainedY = luma(raw), y = Math.max(0, Math.min(1, gainedY)), d = raw.map(v => v - gainedY);
  const fit = (target, delta) => Math.min(1, ...delta.map(v => v > 0 ? (1 - target) / v : v < 0 ? -target / v : 1));
  const wbScale = fit(y, d), exp = Math.exp(2 * Math.log(2) * (r.shadows / 100 * (1 - y) ** 2 + r.highlights / 100 * y ** 2));
  const mapped = y * exp / (1 - y + y * exp), scaled = d.map(v => v * wbScale * (y > 0 ? mapped / y : 0)), finalScale = fit(mapped, scaled);
  return scaled.map(v => code(Math.max(0, Math.min(1, mapped + v * finalScale))));
}
function adjacentPeak(pixels, stride) {
  let maximum = 0;
  for (let i = stride; i < pixels.length; i += stride) for (let c = 0; c < 3; c++) maximum = Math.max(maximum, Math.abs(pixels[i + c] - pixels[i - stride + c]));
  return maximum;
}

// Public format and exact identity.
test('UMD browser and CommonJS API agree and public constants are frozen', () => {
  assert.equal(globalThis.MintLightBalance, balance);
  assert.ok(Object.isFrozen(balance)); assert.ok(Object.isFrozen(balance.LIMITS));
  const context = vm.createContext({}); vm.runInContext(source, context);
  assert.equal(vm.runInContext('typeof MintLightBalance.deriveWhiteBalance', context), 'function');
  assert.equal(vm.runInContext('MintLightBalance.isActive(MintLightBalance.defaults())', context), false);
});
test('defaults, validation and samples produce independent plain portable records', () => {
  const a = balance.defaults(), b = balance.defaults(), v = balance.validate(a);
  assert.deepEqual(a, recipe()); assert.notEqual(a, b); assert.notEqual(a.whiteBalance, b.whiteBalance);
  a.whiteBalance.r = 2; assert.equal(v.whiteBalance.r, 1); assert.equal(b.whiteBalance.r, 1);
  assert.equal(balance.isActive(a), true); assert.equal(balance.isActive(b), false);
  assert.equal(balance.validate(null), null);
  const gains = balance.deriveWhiteBalance(patch([180, 150, 115]), { x: .5, y: .5 });
  assert.deepEqual(Object.keys(gains), ['r', 'g', 'b']);
  assert.equal(Object.getPrototypeOf(gains), Object.prototype);
  const saved = JSON.parse(JSON.stringify(recipe(0, 0, gains)));
  assert.deepEqual(balance.validate(saved), saved);
});
test('neutral/null preserves original object, all code values, alpha and hidden RGB exactly', () => {
  const im = image(new Array(256 * 4).fill(0));
  for (let i = 0; i < 256; i++) im.data.set([i, 255 - i, (i * 37) % 256, i], i * 4);
  const before = im.data.slice();
  for (const r of [null, balance.defaults(), recipe(-0, -0)]) {
    assert.equal(balance.apply(im, r), im); assert.deepEqual(im.data, before);
  }
});
test('active output is independently owned; alpha and zero-alpha hidden RGB are exact', () => {
  const im = image(new Array(256 * 4).fill(0));
  for (let a = 0; a < 256; a++) im.data.set([37, 91, 162, a], a * 4);
  const before = im.data.slice(), out = balance.apply(im, activeRecipe());
  assert.notEqual(out, im); assert.notEqual(out.data, im.data); assert.notEqual(out.data.buffer, im.data.buffer);
  assert.deepEqual([...out.data.slice(0, 4)], [37, 91, 162, 0]);
  for (let a = 1; a < 256; a++) {
    assert.equal(out.data[a * 4 + 3], a);
    assert.deepEqual([...out.data.slice(a * 4, a * 4 + 3)], [...out.data.slice(4, 7)]);
  }
  assert.deepEqual(im.data, before); out.data.fill(0); assert.deepEqual(im.data, before);
});
test('native byte arrays and offset views work without touching adjacent backing bytes', () => {
  for (const Type of [Uint8Array, Uint8ClampedArray]) {
    const backing = new Type([1, 2, 3, 4, 50, 100, 150, 128, 5, 6, 7, 8]), before = backing.slice();
    const im = { width: 1, height: 1, data: backing.subarray(4, 8) };
    assert.equal(balance.apply(im, null), im);
    const out = balance.apply(im, activeRecipe());
    assert.ok(out.data instanceof Uint8ClampedArray); assert.deepEqual(backing, before);
  }
});

// Pixel-level independent numerical and perceptual invariants.
test('random pixels and full gain/tone extremes match independent scalar reference', () => {
  let seed = 0x51adbeef;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const im = image(new Array(1024 * 4).fill(0));
  for (let i = 0; i < im.data.length; i++) im.data[i] = Math.floor(random() * 256);
  im.data.set([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
  const cases = [recipe(100, -100), recipe(-100, 100), recipe(100, 100), recipe(-100, -100), recipe(0, 0, { r: 4, g: .25, b: 4 }), recipe(0, 0, { r: .25, g: 4, b: .25 }), recipe(55, -35, { r: 4, g: 4, b: 4 })];
  for (let i = 0; i < 40; i++) cases.push(recipe(random() * 200 - 100, random() * 200 - 100, { r: .25 + random() * 3.75, g: .25 + random() * 3.75, b: .25 + random() * 3.75 }));
  const before = im.data.slice();
  for (const [n, r] of cases.entries()) {
    const out = balance.apply(im, r);
    for (let i = 0; i < im.data.length; i += 4) assert.deepEqual([...out.data.slice(i, i + 4)], scalarReference([...im.data.slice(i, i + 4)], r), `${n}/${i / 4}`);
  }
  assert.deepEqual(im.data, before);
});
test('every integer slider value at opposing extremes gives neutral monotone full ramps', () => {
  const im = ramp();
  for (let slider = -100; slider <= 100; slider++) {
    for (const other of [-100, 0, 100]) {
      for (const r of [recipe(slider, other), recipe(other, slider)]) {
        const out = balance.apply(im, r).data;
        assert.deepEqual([...out.slice(0, 4)], [0, 0, 0, 255]);
        assert.deepEqual([...out.slice(-4)], [255, 255, 255, 255]);
        for (let i = 0; i < 256; i++) {
          assert.equal(out[i * 4], out[i * 4 + 1]); assert.equal(out[i * 4], out[i * 4 + 2]);
          if (i) assert.ok(out[i * 4] >= out[(i - 1) * 4], `monotonic at ${r.shadows}/${r.highlights}/${i}`);
        }
      }
    }
  }
});
test('all slider-pair corners have positive analytic luminance derivative throughout range', () => {
  for (const s of [-1, 1]) for (const h of [-1, 1]) {
    for (let i = 1; i < 10000; i++) {
      const y = i / 10000, d = 2 * Math.log(2) * (s * (1 - y) ** 2 + h * y ** 2);
      const magnitude = Math.abs(d), easeDerivative = magnitude * (magnitude + .2) / (magnitude + .1) ** 2;
      const derivative = 1 / (y * (1 - y)) + easeDerivative * 4 * Math.log(2) * (-s * (1 - y) + h * y);
      assert.ok(derivative >= 4 - 4 * Math.log(2) - 1e-12);
    }
  }
});
test('slider signs brighten/darken, endpoints fixed, fractional values remain supported', () => {
  const im = ramp();
  for (const value of [-100, -23.75, .125, 100]) for (const r of [recipe(value, 0), recipe(0, value)]) {
    const out = balance.apply(im, r).data;
    for (let i = 0; i < 256; i++) assert.ok(value > 0 ? out[i * 4] >= i : out[i * 4] <= i);
  }
  const neutral = balance.apply(im, recipe(0, 0, { r: 2, g: 2, b: 2 })).data;
  for (let i = 0; i < 256; i++) assert.equal(neutral[i * 4], neutral[i * 4 + 1]), assert.equal(neutral[i * 4], neutral[i * 4 + 2]);
});
test('pointwise mapping does not depend on neighbors, crop, order or chunk boundary', () => {
  const im = patch([73, 111, 192], 71, 65), r = activeRecipe();
  im.data.set([120, 180, 80, 255], (32 * 71 + 35) * 4);
  const out = balance.apply(im, r), alone = balance.apply(image([120, 180, 80, 255]), r);
  assert.deepEqual([...out.data.slice((32 * 71 + 35) * 4, (32 * 71 + 35) * 4 + 4)], [...alone.data]);
  const reference = balance.apply(image([73, 111, 192, 255]), r).data;
  assert.deepEqual([...out.data.slice(0, 4)], [...reference]); assert.deepEqual([...out.data.slice(-4)], [...reference]);
});
test('hue-transition ramps are continuous and match hue-direction gamut reference', () => {
  const { colors, im } = hueRamp();
  for (const r of [recipe(100, -100), recipe(-100, 100), activeRecipe(), recipe(100, 100, { r: 4, g: .25, b: 1 }), recipe(-100, -100, { r: .25, g: 4, b: .25 })]) {
    const out = balance.apply(im, r).data;
    for (let i = 0; i < colors.length; i++) {
      assert.deepEqual([...out.slice(i * 4, i * 4 + 4)], scalarReference([...colors[i], 255], r));
      if (i) for (let c = 0; c < 3; c++) assert.ok(Math.abs(out[i * 4 + c] - out[(i - 1) * 4 + c]) <= 8, `abrupt channel step at ${i}/${c}`);
    }
  }
});
test('saturated-ramp regression improves old control without weakening the eight-code threshold', () => {
  const { colors, im } = hueRamp();
  const cases = [recipe(100, -100), recipe(-100, 100), activeRecipe(), recipe(100, 100, { r: 4, g: .25, b: 1 }), recipe(-100, -100, { r: .25, g: 4, b: .25 })];
  const before = [], after = [];
  for (const r of cases) {
    before.push(adjacentPeak(colors.flatMap(rgb => oldControl(rgb, r)), 3));
    after.push(adjacentPeak(balance.apply(im, r).data, 4));
  }
  assert.deepEqual(before, [18, 17, 48, 32, 52]);
  assert.deepEqual(after, [2, 2, 2, 8, 3]);
  for (const peak of after) assert.ok(peak <= 8);
});
test('all 243 endpoint/gain-corner hue ramps remain bounded with disclosed extreme-gain slope', () => {
  const { im } = hueRamp(); let peak = 0, controlPeak = 0;
  for (const s of [-100, 0, 100]) for (const h of [-100, 0, 100]) for (const r of [.25, 1, 4]) for (const g of [.25, 1, 4]) for (const b of [.25, 1, 4]) {
    peak = Math.max(peak, adjacentPeak(balance.apply(im, recipe(s, h, { r, g, b })).data, 4));
    controlPeak = Math.max(controlPeak, adjacentPeak(desaturatingControl.apply(im, recipe(s, h, { r, g, b })).data, 4));
  }
  // This wider-domain counterexample is intentionally not hidden: a 16:1
  // gain ratio still amplifies a one-code input step to 13 output codes in
  // the candidate. Retain the 15-code rejected-control witness explicitly.
  assert.equal(controlPeak, 15);
  assert.equal(peak, 13); assert.ok(peak <= 15);
});
test('WB uses linear light before tone, with no intermediate byte quantization', () => {
  const im = image([180, 150, 115, 255, 31, 75, 128, 255]), r = activeRecipe();
  const out = balance.apply(im, r);
  for (let i = 0; i < 8; i += 4) assert.deepEqual([...out.data.slice(i, i + 4)], scalarReference([...im.data.slice(i, i + 4)], r));
  const reverse = balance.apply(balance.apply(im, recipe(r.shadows, r.highlights)), recipe(0, 0, r.whiteBalance));
  assert.notDeepEqual(out.data, reverse.data);
  const naive = im.data.map((v, i) => i % 4 === 3 ? v : Math.min(255, Math.round(v * [r.whiteBalance.r, r.whiteBalance.g, r.whiteBalance.b][i % 4])));
  assert.notDeepEqual(balance.apply(im, recipe(0, 0, r.whiteBalance)).data, naive);
});
test('out-of-gamut WB scales channels together, preserving ratios rather than requested luminance', () => {
  const im = image([200, 100, 70, 255]), r = recipe(0, 0, { r: 4, g: 1, b: 1 });
  const out = balance.apply(im, r).data;
  assert.deepEqual([...out], scalarReference([...im.data], r));
  assert.equal(out[0], 255); assert.ok(out[1] < 100 && out[2] < 70);
  const v = [linear(200) * 4, linear(100), linear(70)], max = Math.max(...v);
  for (let i = 0; i < 3; i++) assert.equal(out[i], code(v[i] / max));
  assert.ok(luma([...out.slice(0, 3)].map(linear)) < luma(v));
});
test('mathematical half-up WB ties are stable and uniform gray sampling returns exact unit gains', () => {
  const out = balance.apply(image([0, 6, 0, 255]), recipe(0, 0, { r: .25, g: .25, b: .25 }));
  assert.equal(out.data[1], 2);
  const gains = balance.deriveWhiteBalance(patch([128, 128, 128]), { x: .5, y: .5 });
  assert.deepEqual(gains, { r: 1, g: 1, b: 1 });
  assert.equal(balance.isActive(recipe(0, 0, gains)), false);
});

// Selected-neutral-patch estimation.
test('warm, cool, green and magenta neutral patches become gray with preserved luminance', () => {
  for (const rgb of [[180, 150, 115], [115, 150, 180], [130, 165, 140], [175, 135, 170], [128, 128, 128]]) {
    const im = patch(rgb), before = im.data.slice(), gains = balance.deriveWhiteBalance(im, { x: .5, y: .5 });
    const originalY = luma(rgb.map(linear)), corrected = rgb.map((v, i) => linear(v) * [gains.r, gains.g, gains.b][i]);
    assert.ok(Math.abs(luma(corrected) - originalY) < 1e-14);
    assert.ok(Math.max(...corrected) - Math.min(...corrected) < 1e-14);
    const out = balance.apply(im, recipe(0, 0, gains));
    assert.equal(out.data[0], out.data[1]); assert.equal(out.data[0], out.data[2]);
    assert.ok(Math.abs(linear(out.data[0]) - originalY) < .005);
    assert.deepEqual(im.data, before);
  }
});
test('patch shading and modest chromaticity noise preserve the accepted arithmetic mean luminance', () => {
  const im = patch([0, 0, 0], 5, 5), rgbs = [];
  for (let i = 0; i < 25; i++) {
    const scale = .35 + i * .016, rgb = [code(scale * 1.2), code(scale * (1 + (i % 3 - 1) * .015)), code(scale * .85)];
    rgbs.push(rgb); im.data.set([...rgb, 255], i * 4);
  }
  const gains = balance.deriveWhiteBalance(im, { x: .5, y: .5, radius: 0 });
  let before = 0, after = 0;
  for (const rgb of rgbs) { const v = rgb.map(linear); before += luma(v); after += luma(v.map((x, i) => x * [gains.r, gains.g, gains.b][i])); }
  assert.ok(Math.abs(before - after) < 1e-12);
});
test('derived gains preserve arithmetic mean before gamut, but cannot promise it after gamut normalization', () => {
  const im = patch([243, 243, 224], 5, 5); im.data.set([243, 243, 238, 255], 0);
  const gains = balance.deriveWhiteBalance(im, { x: .5, y: .5 }), w = [gains.r, gains.g, gains.b];
  let original = 0, gained = 0, bounded = 0, outOfGamut = false;
  for (let i = 0; i < 25; i++) {
    const rgb = [...im.data.slice(i * 4, i * 4 + 3)].map(linear), corrected = rgb.map((v, c) => v * w[c]), maximum = Math.max(1, ...corrected);
    original += luma(rgb); gained += luma(corrected); bounded += luma(corrected) / maximum; outOfGamut ||= maximum > 1;
  }
  assert.ok(Math.abs(original - gained) < 1e-12); assert.equal(outOfGamut, true); assert.ok(bounded < original);
  const out = balance.apply(im, recipe(0, 0, gains));
  assert.deepEqual([...out.data.slice(0, 4)], scalarReference([...im.data.slice(0, 4)], recipe(0, 0, gains)));
});
test('robust patch estimator rejects minority colored outliers without shifting neutral gains', () => {
  const im = patch([180, 150, 115], 5, 5), expected = balance.deriveWhiteBalance(im, { x: .5, y: .5 });
  for (let i = 0; i < 8; i++) im.data.set([60, 180, 150, 255], i * 4);
  const actual = balance.deriveWhiteBalance(im, { x: .5, y: .5 });
  for (const key of ['r', 'g', 'b']) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-13);
});
test('sampling is clipped, normalized, spatially bounded and deterministic at edges', () => {
  const im = patch([180, 150, 115], 150, 100);
  const expected = balance.deriveWhiteBalance(im, { x: .5, y: .5 });
  for (const x of [0, .5, 1]) for (const y of [0, .5, 1]) {
    const gains = balance.deriveWhiteBalance(im, { x, y, radius: 0 });
    for (const key of ['r', 'g', 'b']) assert.ok(Math.abs(gains[key] - expected[key]) < 1e-13);
  }
  const wide = patch([0, 0, 0], 1400, 1400);
  for (let row = 668; row <= 732; row++) for (let col = 668; col <= 732; col++) wide.data.set([180, 150, 115, 255], (row * 1400 + col) * 4);
  // Requested radius is 70 pixels. Its 32-pixel cap must sample only the
  // known neutral 65-square, not the much larger unusable black surrounding.
  const capped = balance.deriveWhiteBalance(wide, { x: .5, y: .5, radius: .05 });
  for (const key of ['r', 'g', 'b']) assert.ok(Math.abs(capped[key] - expected[key]) < 1e-12);
});
test('too-dark/clipped/transparent/partial-alpha/too-small patches reject with explicit code', () => {
  for (const im of [patch([9, 9, 9]), patch([0, 110, 150]), patch([247, 150, 115]), patch([180, 150, 255]), patch([180, 150, 115], 9, 9, 0), patch([180, 150, 115], 9, 9, 254), patch([180, 150, 115], 2, 2)]) {
    const before = im.data.slice();
    assert.throws(() => balance.deriveWhiteBalance(im, { x: .5, y: .5 }), e => e instanceof RangeError && e.code === 'WB_SAMPLE_INSUFFICIENT');
    assert.deepEqual(im.data, before);
  }
  const sparse = patch([180, 150, 115], 5, 5);
  for (let i = 0; i < 13; i++) sparse.data[i * 4 + 3] = 128;
  assert.throws(() => balance.deriveWhiteBalance(sparse, { x: .5, y: .5 }), e => e.code === 'WB_SAMPLE_INSUFFICIENT');
});
test('mixed colors and out-of-budget gains reject, never silently clamp', () => {
  const mixed = patch([180, 150, 115], 5, 5);
  for (let i = 0; i < 13; i++) mixed.data.set([60, 180, 150, 255], i * 4);
  assert.throws(() => balance.deriveWhiteBalance(mixed, { x: .5, y: .5 }), e => e.code === 'WB_SAMPLE_INCONSISTENT');
  assert.throws(() => balance.deriveWhiteBalance(patch([225, 35, 35]), { x: .5, y: .5 }), e => e.code === 'WB_GAIN_RANGE');
});

// Strict external records and backing storage.
test('malformed recipes and all finite scalar bounds are strictly validated', () => {
  for (const value of [undefined, false, 1, 'recipe', [], () => {}]) assert.throws(() => balance.validate(value), TypeError);
  const mutations = [r => delete r.version, r => r.version = 2, r => r.extra = 0, r => r.whiteBalance = null, r => delete r.whiteBalance.b, r => r.whiteBalance.extra = 1];
  for (const key of ['shadows', 'highlights']) for (const v of [NaN, Infinity, -Infinity, '0', null, -100.001, 100.001]) mutations.push(r => r[key] = v);
  for (const key of ['r', 'g', 'b']) for (const v of [NaN, Infinity, '1', null, .24999, 4.0001]) mutations.push(r => r.whiteBalance[key] = v);
  for (const mutate of mutations) { const r = recipe(); mutate(r); assert.throws(() => balance.validate(r), TypeError); }
  assert.doesNotThrow(() => balance.validate(recipe(-100, 100, { r: .25, g: 1, b: 4 })));
  assert.deepEqual(balance.validate(nullRecord(recipe())), recipe());
  const im = Object.assign(Object.create(null), image()); assert.equal(balance.apply(im, null, Object.create(null)), im);
});
test('unknown, hidden, symbol, accessor and inherited record fields reject without getters', () => {
  let reads = 0;
  const changes = [o => o.extra = 1, o => Object.defineProperty(o, 'hidden', { value: 1 }), o => o[Symbol()] = 1, o => Object.setPrototypeOf(o, { inherited: 1 }), o => { const k = Object.keys(o)[0]; Object.defineProperty(o, k, { enumerable: true, get() { reads++; throw Error('getter'); } }); }, o => { const k = Object.keys(o)[0]; Object.defineProperty(o, k, { value: o[k], enumerable: false }); }];
  for (const select of [r => r, r => r.whiteBalance]) for (const modify of changes) { const r = recipe(); modify(select(r)); assert.throws(() => balance.validate(r), TypeError); }
  for (const modify of changes) { const im = image(); modify(im); assert.throws(() => balance.apply(im, null), TypeError); }
  for (const modify of changes) { const s = { x: .5, y: .5 }; modify(s); assert.throws(() => balance.deriveWhiteBalance(patch([128, 128, 128]), s), TypeError); }
  assert.equal(reads, 0);
});
test('sample coordinates/radius and options reject malformed data before calling callbacks', () => {
  const im = patch([128, 128, 128]); let calls = 0;
  for (const s of [null, [], {}, { x: 0 }, { x: -1, y: 0 }, { x: 1.001, y: 0 }, { x: 0, y: NaN }, { x: '0', y: 0 }, { x: 0, y: 0, radius: -.01 }, { x: 0, y: 0, radius: .05001 }, { x: 0, y: 0, radius: Infinity }, { x: 0, y: 0, radius: null }]) assert.throws(() => balance.deriveWhiteBalance(im, s, { shouldCancel() { calls++; } }), TypeError);
  const getter = {}; Object.defineProperty(getter, 'shouldCancel', { enumerable: true, get() { calls++; } });
  const hidden = {}; Object.defineProperty(hidden, 'shouldCancel', { value: () => false });
  for (const o of [null, [], false, { unknown: 1 }, { shouldCancel: 0 }, { shouldCancel: null }, { [Symbol()]: 1 }, Object.create({ shouldCancel() { calls++; } }), getter, hidden]) {
    assert.throws(() => balance.apply(im, activeRecipe(), o), TypeError);
    assert.throws(() => balance.deriveWhiteBalance(im, { x: .5, y: .5 }, o), TypeError);
  }
  assert.equal(calls, 0);
});
test('core limits are inclusive and invalid dimensions fail before buffer work', () => {
  assert.equal(balance.LIMITS.pixels, 64000000); assert.equal(balance.LIMITS.edge, 16384);
  for (const [width, height] of [[16384, 1], [1, 16384]]) { const im = { width, height, data: new Uint8Array(width * height * 4) }; assert.equal(balance.apply(im, null), im); }
  for (const [width, height] of [[0, 1], [1, 0], [-1, 1], [1.1, 1], [NaN, 1], [Infinity, 1], ['1', 1], [16385, 1], [1, 16385], [8001, 8000], [16384, 16384]]) assert.throws(() => balance.apply({ width, height, data: new Uint8Array(4) }, null), /dimensions/);
  assert.throws(() => balance.apply({ width: 8000, height: 8000, data: new Uint8Array(4) }, null), /buffer or length/);
});
test('wrong/fake/subclass/shared/detached/resizable backing storage is rejected', () => {
  const values = [null, [], {}, new Uint16Array(4), new Int8Array(4), new Float32Array(4), new DataView(new ArrayBuffer(4)), new Uint8Array(3), new Uint8Array(5), Object.create(Uint8Array.prototype), new Proxy(new Uint8Array(4), {}), Buffer.alloc(4)];
  class Subclass extends Uint8Array {} values.push(new Subclass(4));
  const detached = new Uint8Array(4); structuredClone(detached.buffer, { transfer: [detached.buffer] }); values.push(detached);
  if (typeof SharedArrayBuffer === 'function') values.push(new Uint8Array(new SharedArrayBuffer(4)));
  if (Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')) values.push(new Uint8Array(new ArrayBuffer(4, { maxByteLength: 8 })));
  for (const data of values) {
    assert.throws(() => balance.apply({ width: 1, height: 1, data }, null), TypeError);
    assert.throws(() => balance.deriveWhiteBalance({ width: 1, height: 1, data }, { x: 0, y: 0 }), TypeError);
  }
});
test('typed-array shadow getters and methods are never dispatched', () => {
  const im = patch([180, 150, 115]); let reads = 0;
  for (const key of ['length', 'buffer', 'byteLength', 'byteOffset', 'slice', 'set', Symbol.iterator]) Object.defineProperty(im.data, key, { get() { reads++; throw Error('typed-array trap'); } });
  assert.equal(balance.apply(im, activeRecipe()).data[3], 255);
  assert.ok(balance.deriveWhiteBalance(im, { x: .5, y: .5 }).r > 0);
  assert.equal(reads, 0);
});

// Cancellation and no partial publication.
test('identity operations also cancel and callback failures propagate without writes', () => {
  const im = image(), before = im.data.slice();
  for (const r of [null, recipe(), activeRecipe()]) aborts(() => balance.apply(im, r, { shouldCancel: () => true }));
  const expected = Error('caller failure');
  assert.throws(() => balance.apply(im, activeRecipe(), { shouldCancel() { throw expected; } }), e => e === expected);
  aborts(() => balance.deriveWhiteBalance(patch([128, 128, 128]), { x: .5, y: .5 }, { shouldCancel: () => true }));
  assert.deepEqual(im.data, before);
});
test('cancellation precedes LUT/output allocation and final result publication', () => {
  const allocations = [];
  const track = (Type, name) => new Proxy(Type, { construct(Target, args) { allocations.push([name, args[0]]); return new Target(...args); } });
  const context = vm.createContext({ Uint8Array, Uint8ClampedArray: track(Uint8ClampedArray, 'rgba'), Float64Array: track(Float64Array, 'linear'), ArrayBuffer });
  vm.runInContext(source, context);
  vm.runInContext('var im={width:1,height:1,data:new Uint8ClampedArray([50,100,150,255])};var r=MintLightBalance.defaults();r.shadows=50;', context);
  allocations.length = 0;
  aborts(() => vm.runInContext('MintLightBalance.apply(im,r,{shouldCancel:()=>true})', context)); assert.deepEqual(allocations, []);
  aborts(() => vm.runInContext('var n=0;MintLightBalance.apply(im,r,{shouldCancel:()=>++n===2})', context)); assert.deepEqual(allocations, [['linear', 256]]);
  let total = 0; balance.apply(image(), activeRecipe(), { shouldCancel() { total++; return false; } }); assert.equal(total, 4);
  let calls = 0; aborts(() => balance.apply(image(), activeRecipe(), { shouldCancel: () => ++calls === total }));
});
test('chunk cancellation and patch-loop cancellation never return partial results or mutate input', () => {
  const im = patch([100, 120, 140], 4096, 65), before = im.data.slice(); let published, calls = 0;
  aborts(() => { published = balance.apply(im, activeRecipe(), { shouldCancel: () => ++calls === 5 }); });
  assert.equal(published, undefined); assert.deepEqual(im.data, before);
  const sample = patch([180, 150, 115], 1400, 700), sampleBefore = sample.data.slice(); calls = 0;
  aborts(() => { published = balance.deriveWhiteBalance(sample, { x: .5, y: .5, radius: .05 }, { shouldCancel: () => ++calls === 5 }); });
  assert.equal(published, undefined); assert.deepEqual(sample.data, sampleBefore);
});
test('detachment in every callback checkpoint rejects instead of publishing corruption', () => {
  for (const at of [1, 2, 3, 4]) {
    const im = image(); let calls = 0, published;
    assert.throws(() => { published = balance.apply(im, activeRecipe(), { shouldCancel() { if (++calls === at) structuredClone(im.data.buffer, { transfer: [im.data.buffer] }); return false; } }); }, TypeError);
    assert.equal(published, undefined);
  }
  for (const at of [1, 2, 3, 4, 5]) {
    const im = patch([180, 150, 115], 5, 5); let calls = 0, published;
    assert.throws(() => { published = balance.deriveWhiteBalance(im, { x: .5, y: .5 }, { shouldCancel() { if (++calls === at) structuredClone(im.data.buffer, { transfer: [im.data.buffer] }); return false; } }); }, TypeError);
    assert.equal(published, undefined);
  }
});
test('caller recipe/selection mutations inside callback do not change validated operation', () => {
  const im = patch([180, 150, 115]), r = activeRecipe(), expected = balance.apply(im, r);
  const actual = balance.apply(im, r, { shouldCancel() { r.whiteBalance.r = NaN; r.shadows = 10000; return false; } });
  assert.deepEqual(actual, expected);
  const selection = { x: .5, y: .5 }, gains = balance.deriveWhiteBalance(im, selection);
  assert.deepEqual(balance.deriveWhiteBalance(im, selection, { shouldCancel() { selection.x = NaN; selection.radius = 100; return false; } }), gains);
});
test('inherited output setters and descriptor get/set pollution are not invoked', () => {
  const names = ['version', 'shadows', 'highlights', 'whiteBalance', 'r', 'g', 'b', 'width', 'height', 'data', 'get', 'set'];
  const previous = names.map(n => [n, Object.getOwnPropertyDescriptor(Object.prototype, n)]); let calls = 0, failure;
  try {
    for (const n of names) Object.defineProperty(Object.prototype, n, { __proto__: null, configurable: true, set() { calls++; throw Error('inherited setter'); } });
    const r = activeRecipe(), im = patch([180, 150, 115]);
    const v = balance.validate(r), out = balance.apply(im, r), gains = balance.deriveWhiteBalance(im, { x: .5, y: .5 });
    assert.ok(Object.hasOwn(v, 'whiteBalance')); assert.ok(Object.hasOwn(out, 'data')); assert.ok(Object.hasOwn(gains, 'r'));
  } catch (e) { failure = e; } finally {
    for (const n of names) delete Object.prototype[n];
    for (const [n, d] of previous) if (d) Object.defineProperty(Object.prototype, n, d);
  }
  assert.equal(failure, undefined); assert.equal(calls, 0);
});

