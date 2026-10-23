'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Tone = require('../app/src/main/assets/advanced-tone.js');

function image(pixels, width = pixels.length) {
  return { width, height: pixels.length / width, data: Uint8ClampedArray.from(pixels.flat()) };
}
function ramp() { return image(Array.from({ length: 256 }, (_, v) => [v, v, v, 255])); }
function recipe(change) { const value = Tone.defaults(); if (change) change(value); return value; }
function rgbAt(value, index = 0) { return [...value.data.slice(index * 4, index * 4 + 3)]; }
function allBands(values) { return recipe(r => r.hsl.forEach(b => Object.assign(b, values))); }
function close(actual, expected, tolerance = 1) {
  assert.equal(actual.length, expected.length);
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) <= tolerance, `${actual} != ${expected} at ${i}`));
}
function hslRgb(h, s = 1, l = .5) {
  // Independent HSL reference via the CSS hue-to-RGB formulation.
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map(n => {
    const k = (n + h / 30) % 12;
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
  });
}
function hslOf(rgb) {
  const [r, g, b] = rgb.map(v => v / 255), hi = Math.max(r, g, b), lo = Math.min(r, g, b), d = hi - lo, l = (hi + lo) / 2;
  if (d === 0) return [0, 0, l];
  const h = (hi === r ? (g - b) / d : hi === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  return [(h + 360) % 360, d / (1 - Math.abs(2 * l - 1)), l];
}

test('UMD browser global and CommonJS expose the same dependency-free API', () => {
  const sandbox = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../app/src/main/assets/advanced-tone.js'), 'utf8'), sandbox);
  assert.equal(typeof sandbox.MintAdvancedTone.apply, 'function');
  assert.deepEqual(Object.keys(sandbox.MintAdvancedTone), Object.keys(Tone));
  assert.ok(Object.isFrozen(Tone));
});
test('defaults are independent, exact identity; validate clones and preserves optional null', () => {
  const a = Tone.defaults(), b = Tone.defaults();
  assert.equal(Tone.validate(null), null);
  assert.equal(Tone.isActive(null), false);
  assert.equal(Tone.isActive(a), false);
  assert.equal(a.curveMode, 'monotone');
  const copy = Tone.validate(a);
  copy.curves.red[1] = .2; copy.hsl[0].hue = 30;
  assert.deepEqual(a, b);
  a.hsl[0].hue = 1;
  assert.equal(Tone.isActive(a), true);
});
test('null, identity, disabled, and zero strength are byte-exact and allocation-free', () => {
  const input = image([[11, 27, 98, 0], [0, 0, 0, 255], [255, 255, 255, 17], [99, 128, 173, 1]]);
  const before = input.data.slice();
  for (const r of [null, Tone.defaults(), recipe(v => { v.enabled = false; v.hsl[0].hue = 30; }), recipe(v => { v.strength = 0; v.curves.rgb[2] = .3; })]) {
    assert.equal(Tone.apply(input, r), input);
    assert.deepEqual(input.data, before);
  }
});
test('inactive recipes and no-op images are still validated; undefined is not null', () => {
  assert.throws(() => Tone.validate(undefined));
  assert.throws(() => Tone.apply({ width: 0, height: 1, data: new Uint8Array(0) }, null));
  assert.throws(() => Tone.apply(ramp(), recipe(r => { r.enabled = false; r.hsl[2].hue = NaN; })));
  assert.throws(() => Tone.isActive(recipe(r => { r.strength = 0; delete r.curveMode; })));
});
test('versions, ranges, unexpected fields, and nonfinite values fail closed', () => {
  const mutations = [r => { r.version = 2; }, r => { r.enabled = 1; }, r => { r.strength = -.1; }, r => { r.strength = 1.01; }, r => { r.strength = NaN; }, r => { r.curveMode = 'implicit'; }, r => { r.curves.rgb[2] = Infinity; }, r => { r.curves.blue[0] = -.01; }, r => { r.hsl[7].hue = 30.01; }, r => { r.hsl[0].saturation = -101; }, r => { r.hsl[3].luminance = 101; }, r => { r.extra = true; }, r => { r.curves.rgb.extra = 1; }, r => { r.hsl[0].constructor = 1; }, r => { r[Symbol('x')] = 1; }];
  for (const mutation of mutations) assert.throws(() => Tone.validate(recipe(mutation)), TypeError);
});
test('custom prototypes, inherited fields, sparse arrays, and array subclasses are rejected', () => {
  class Curve extends Array {}
  const cases = [r => Object.setPrototypeOf(r, { evil: 1 }), r => Object.setPrototypeOf(r.curves, { evil: 1 }), r => Object.setPrototypeOf(r.hsl[0], { evil: 1 }), r => { r.curves.red = new Curve(...Tone.NODES); }, r => { delete r.hsl[2]; }, r => { delete r.curves.rgb[2]; }, r => { r.curves.red = Array(5); }, r => { r.hsl = Array(8); }, r => { delete r.enabled; Object.setPrototypeOf(r, { enabled: true }); }];
  for (const mutation of cases) assert.throws(() => Tone.validate(recipe(mutation)));
  const nullable = recipe(); Object.setPrototypeOf(nullable, null); Object.setPrototypeOf(nullable.curves, null);
  assert.deepEqual(Tone.validate(nullable), Tone.defaults());
});
test('recipe, nested array, image, and options accessors never execute', () => {
  let executed = 0;
  const getter = { enumerable: true, configurable: true, get() { executed++; return 1; } };
  for (const mutate of [r => Object.defineProperty(r, 'strength', getter), r => Object.defineProperty(r, 'curves', getter), r => Object.defineProperty(r.curves, 'rgb', getter), r => Object.defineProperty(r.curves.rgb, '2', getter), r => Object.defineProperty(r.hsl, '0', getter), r => Object.defineProperty(r.hsl[0], 'hue', getter)]) assert.throws(() => Tone.validate(recipe(mutate)));
  const input = ramp(); Object.defineProperty(input, 'width', getter);
  assert.throws(() => Tone.apply(input, null));
  const options = {}; Object.defineProperty(options, 'shouldCancel', getter);
  assert.throws(() => Tone.apply(ramp(), null, options));
  const histogramOptions = {}; Object.defineProperty(histogramOptions, 'maxSamples', getter);
  assert.throws(() => Tone.histogram(ramp(), histogramOptions));
  assert.equal(executed, 0);
});
test('image dimensions, RGBA lengths, shared buffers and sample budgets are bounded', () => {
  for (const [width, height] of [[0, 1], [-1, 1], [1.5, 1], [Infinity, 1], [16385, 1], [8001, 8000], [16384, 16384]]) assert.throws(() => Tone.apply({ width, height, data: new Uint8Array(4) }, null), /dimensions/);
  for (const data of [new Uint8Array(3), new Float32Array(4), [1, 2, 3, 4], new Uint8Array(new SharedArrayBuffer(4))]) assert.throws(() => Tone.apply({ width: 1, height: 1, data }, null));
  for (const maxSamples of [0, -1, 1.5, NaN, Infinity, 64000001, '100']) assert.throws(() => Tone.histogram(ramp(), { maxSamples }));
  assert.throws(() => Tone.histogram(ramp(), { maxSamples: 10, arbitrary: true }));
});
test('typed-array shadow getters are not executed and detached views are rejected', () => {
  const data = Uint8Array.of(10, 20, 30, 255); let called = 0;
  for (const key of ['length', 'buffer']) Object.defineProperty(data, key, { get() { called++; throw new Error('Do not invoke'); } });
  assert.deepEqual(rgbAt(Tone.apply({ width: 1, height: 1, data }, allBands({ luminance: 10 }))), [13, 26, 40]);
  assert.equal(called, 0);
  const detached = new Uint8Array(4); structuredClone(detached.buffer, { transfer: [detached.buffer] });
  assert.throws(() => Tone.apply({ width: 1, height: 1, data: detached }, null));
});
test('monotone mode rejects hidden reversal; free mode is explicit and bounded', () => {
  const r = recipe(v => { v.curves.rgb = [0, .8, .3, .9, 1]; });
  assert.throws(() => Tone.validate(r), /nondecreasing/);
  r.curveMode = 'free';
  assert.equal(Tone.validate(r).curveMode, 'free');
  assert.doesNotThrow(() => Tone.apply(ramp(), r));
});
test('dense PCHIP preserves segment extrema for adversarial free curves', () => {
  const curves = [[0, 1, 0, 1, 0], [1, 0, 1, 0, 1], [.2, .8, .8, .1, .6], [.5, .5, .5, .5, .5], [1, .75, .5, .25, 0], [0, .001, .999, .999, 1]];
  for (const y of curves) {
    const output = Tone.apply(ramp(), recipe(r => { r.curveMode = 'free'; r.curves.rgb = [...y]; }));
    for (let i = 0; i < 256; i++) {
      const segment = Math.min(3, Math.floor(i / 255 * 4));
      const low = Math.min(y[segment], y[segment + 1]) * 255, high = Math.max(y[segment], y[segment + 1]) * 255;
      const v = output.data[i * 4];
      assert.ok(v >= low - .5 && v <= high + .5, `Overshoot ${y}, input=${i}, output=${v}`);
      assert.equal(v, output.data[i * 4 + 1]); assert.equal(v, output.data[i * 4 + 2]);
    }
  }
});
test('monotone gradients stay monotone including plateaus and asymmetric endpoint slopes', () => {
  const curves = [[0, 0, .5, 1, 1], [.1, .2, .2, .2, .9], [0, .001, .01, .5, 1], [0, .5, .99, .999, 1]];
  for (const y of curves) {
    const out = Tone.apply(ramp(), recipe(r => { r.curves.rgb = y; }));
    for (let i = 1; i < 256; i++) assert.ok(out.data[i * 4] >= out.data[(i - 1) * 4]);
  }
});
test('master curve precedes channel curves, with no intermediate byte quantization', () => {
  const r = recipe(v => { v.curves.rgb = [0, .1, .3, .7, 1]; v.curves.red = [0, .4, .65, .85, 1]; });
  const out = Tone.apply(image([[128, 128, 128, 255]]), r);
  // Independent Hermite evaluation for these nodes at 128/255.
  function reference(y, x) {
    const d = y.slice(1).map((v, i) => 4 * (v - y[i])), m = [0, 0, 0, 0, 0];
    const edge = (a, b) => Math.sign((3 * a - b) / 2) !== Math.sign(a) ? 0 : Math.sign(a) !== Math.sign(b) ? Math.sign(a) * Math.min(Math.abs((3 * a - b) / 2), Math.abs(3 * a)) : (3 * a - b) / 2;
    m[0] = edge(d[0], d[1]); m[4] = edge(d[3], d[2]);
    for (let i = 1; i < 4; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : 2 / (1 / d[i - 1] + 1 / d[i]);
    const k = Math.min(3, Math.floor(x * 4)), t = x * 4 - k;
    return y[k] * (1 + 2 * t) * (1 - t) ** 2 + m[k] / 4 * t * (1 - t) ** 2 + y[k + 1] * t * t * (3 - 2 * t) + m[k + 1] / 4 * t * t * (t - 1);
  }
  const master = reference(r.curves.rgb, 128 / 255), right = reference(r.curves.red, master) * 255, wrong = reference(r.curves.rgb, reference(r.curves.red, 128 / 255)) * 255;
  close(rgbAt(out), [right, master * 255, master * 255]);
  assert.ok(Math.abs(out.data[0] - wrong) > 15);
});
test('active processing never mutates source and preserves every alpha and hidden RGB byte', () => {
  const input = image(Array.from({ length: 256 }, (_, a) => [a, 255 - a, (a * 97) % 256, a]));
  const before = input.data.slice(), r = recipe(v => { v.curves.rgb[2] = .65; v.hsl.forEach(b => { b.hue = 30; b.saturation = -100; b.luminance = 100; }); });
  const out = Tone.apply(input, r);
  assert.notEqual(out, input); assert.notEqual(out.data, input.data); assert.deepEqual(input.data, before);
  for (let i = 3; i < out.data.length; i += 4) assert.equal(out.data[i], before[i]);
  assert.deepEqual(out.data.slice(0, 4), before.slice(0, 4));
});
test('strength is one final blend, not repeated per curve or HSL stage', () => {
  const input = image([[93, 142, 201, 255], [190, 94, 67, 17], [21, 220, 144, 0]]);
  const r = recipe(v => { v.curves.rgb[2] = .65; v.curves.red[1] = .35; v.hsl.forEach(b => Object.assign(b, { hue: 17, saturation: -44, luminance: 31 })); });
  const full = Tone.apply(input, r); r.strength = .5; const half = Tone.apply(input, r);
  for (let i = 0; i < input.data.length; i++) assert.ok(Math.abs(half.data[i] - (input.data[i] + full.data[i]) / 2) <= .5);
});
test('HSL preserves the full achromatic ramp even with all controls at extrema', () => {
  for (const sign of [-1, 1]) {
    const input = ramp(), out = Tone.apply(input, allBands({ hue: sign * 30, saturation: sign * 100, luminance: sign * 100 }));
    assert.deepEqual(out.data, input.data);
  }
});
test('HSL is gamma-codevalue HSL, not a white overlay or linear-light substitute', () => {
  const input = image([[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]]);
  const bright = Tone.apply(input, allBands({ luminance: 100 })), dark = Tone.apply(input, allBands({ luminance: -100 }));
  close(rgbAt(bright, 0), [255, 128, 128], 0); close(rgbAt(dark, 0), [128, 0, 0], 0);
  close(rgbAt(bright, 1), [128, 255, 128], 0); close(rgbAt(dark, 2), [0, 0, 128], 0);
  const desaturated = Tone.apply(input, allBands({ saturation: -100 }));
  for (let i = 0; i < 3; i++) close(rgbAt(desaturated, i), [128, 128, 128], 0);
});
test('uniform hue shifts rotate all spectral colors by at most 30 degrees', () => {
  const hues = Array.from({ length: 360 }, (_, h) => h), input = image(hues.map(h => [...hslRgb(h), 255]));
  for (const shift of [-30, 30]) {
    const out = Tone.apply(input, allBands({ hue: shift }));
    for (let i = 0; i < 360; i++) close(rgbAt(out, i), hslRgb((hslOf(rgbAt(input, i))[0] + shift + 360) % 360), 1);
  }
});
test('eight hue bands use adjacent partition-of-unity weights and original pre-HSL hue', () => {
  const r = recipe(v => { v.hsl[0] = { hue: 30, saturation: -100, luminance: 100 }; v.hsl[1] = { hue: -30, saturation: 0, luminance: -100 }; });
  for (const hue of [0, 10, 15, 20, 30, 45, 345, 359]) {
    const input = image([[...hslRgb(hue), 255]]), [h, s, l] = hslOf(rgbAt(input));
    let a = 0, b = 0, t = 0;
    while (a < 7 && h >= Tone.CENTERS[a + 1]) a++;
    b = (a + 1) % 8; t = (h - Tone.CENTERS[a]) / ((a === 7 ? 360 : Tone.CENTERS[b]) - Tone.CENTERS[a]);
    const mix = key => r.hsl[a][key] * (1 - t) + r.hsl[b][key] * t;
    const expected = hslRgb((h + mix('hue') + 360) % 360, Math.max(0, Math.min(1, s * (1 + mix('saturation') / 100))), Math.max(0, Math.min(1, l + mix('luminance') * .0025)));
    close(rgbAt(Tone.apply(input, r)), expected);
  }
});
test('spectral wrap and every adjacent band boundary remain continuous', () => {
  const r = recipe(v => v.hsl.forEach((b, i) => Object.assign(b, { hue: i % 2 ? -30 : 30, saturation: i % 2 ? -80 : 40, luminance: i % 2 ? -40 : 40 })));
  const hues = [359.9, 0, .1, 29.9, 30, 30.1, 59.9, 60, 60.1, 119.9, 120, 120.1, 179.9, 180, 180.1, 239.9, 240, 240.1, 269.9, 270, 270.1, 299.9, 300, 300.1];
  const out = Tone.apply(image(hues.map(h => [...hslRgb(h), 255])), r);
  for (let i = 0; i < hues.length; i += 3) { close(rgbAt(out, i), rgbAt(out, i + 1), 4); close(rgbAt(out, i + 1), rgbAt(out, i + 2), 4); }
});
test('near-gray soft gate tends to zero and has no threshold jump at S=.1', () => {
  const r = allBands({ hue: 30, saturation: 100, luminance: 100 });
  const gray = image([[128, 128, 128, 255], [129, 128, 128, 255], [128, 129, 128, 255], [128, 128, 129, 255]]);
  const out = Tone.apply(gray, r);
  assert.deepEqual(out.data, gray.data);
  const before = image([[...hslRgb(20, .095), 255], [...hslRgb(20, .1), 255], [...hslRgb(20, .105), 255]]);
  const after = Tone.apply(before, r);
  close(rgbAt(after, 0), rgbAt(after, 1), 3); close(rgbAt(after, 1), rgbAt(after, 2), 3);
});
test('one-code near-black and near-white chroma cannot turn into a saturated color cast', () => {
  const pixels = [];
  for (const base of [0, 254]) for (let bits = 1; bits < 7; bits++) pixels.push([base + (bits & 1), base + ((bits >> 1) & 1), base + ((bits >> 2) & 1), 255]);
  const input = image(pixels);
  for (const sign of [-1, 1]) for (let band = 0; band < 8; band++) {
    const r = recipe(v => { v.hsl[band] = { hue: sign * 30, saturation: sign * 100, luminance: sign * 100 }; });
    const out = Tone.apply(input, r);
    for (let i = 0; i < pixels.length; i++) close(rgbAt(out, i), rgbAt(input, i), 3);
  }
  for (const sign of [-1, 1]) {
    const out = Tone.apply(input, allBands({ hue: sign * 30, saturation: sign * 100, luminance: sign * 100 }));
    for (let i = 0; i < pixels.length; i++) close(rgbAt(out, i), rgbAt(input, i), 3);
  }
});
test('chroma gate varies smoothly at its threshold for dark and light spectral colors', () => {
  const r = allBands({ hue: 30, saturation: 100, luminance: 100 });
  // Sector endpoints retain exact hue after 8-bit quantization at low chroma.
  for (const hue of Tone.CENTERS.filter(h => h % 60 === 0)) for (const light of [.025, .975]) {
    const source = image([-.002, 0, .002].map(delta => [...hslRgb(hue, 1, light + delta), 255]));
    const out = Tone.apply(source, r);
    close(rgbAt(out, 0), rgbAt(out, 1), 5); close(rgbAt(out, 1), rgbAt(out, 2), 5);
  }
});
test('saturation doubles rather than adds chroma, and luminance changes stay within .25', () => {
  const pixels = Tone.CENTERS.flatMap(h => [.25, .5, .75].flatMap(l => [.2, .4, .7].map(s => [...hslRgb(h, s, l), 255])));
  const input = image(pixels), saturated = Tone.apply(input, allBands({ saturation: 100 }));
  for (let i = 0; i < pixels.length; i++) {
    const [h, s, l] = hslOf(rgbAt(input, i));
    close(rgbAt(saturated, i), hslRgb(h, Math.min(1, s * 2), l), 1);
  }
  for (const sign of [-1, 1]) {
    const out = Tone.apply(input, allBands({ luminance: sign * 100 }));
    for (let i = 0; i < pixels.length; i++) assert.ok(Math.abs(hslOf(rgbAt(out, i))[2] - hslOf(rgbAt(input, i))[2]) <= .25 + 1 / 255);
  }
});
test('pre-aborted no-op, mid-render cancellation, and throwing callbacks preserve input', () => {
  const input = ramp(), before = input.data.slice();
  for (const r of [null, Tone.defaults(), allBands({ hue: 1 })]) assert.throws(() => Tone.apply(input, r, { shouldCancel: () => true }), e => e.name === 'AbortError' && e.code === 'ABORT_ERR');
  const tall = image(Array.from({ length: 128 * 128 }, () => [180, 20, 40, 255]), 128), tallBefore = tall.data.slice();
  let calls = 0;
  assert.throws(() => Tone.apply(tall, allBands({ hue: 30 }), { shouldCancel: () => ++calls === 3 }), { name: 'AbortError' });
  assert.equal(calls, 3); assert.deepEqual(tall.data, tallBefore);
  assert.throws(() => Tone.apply(input, null, { shouldCancel: 1 }));
  assert.throws(() => Tone.apply(input, null, { shouldCancel() { throw new Error('callback failed'); } }), /callback failed/);
  assert.deepEqual(input.data, before);
});
test('row chunks are bounded by rows and pixel count, and completion checks cancellation', () => {
  const input = { width: 16384, height: 9, data: new Uint8Array(16384 * 9 * 4) };
  let calls = 0;
  Tone.apply(input, allBands({ hue: 1 }), { shouldCancel() { calls++; return false; } });
  assert.equal(calls, 5); // preflight + three <=4-row chunks + completion
});
test('histogram excludes alpha0, weights partial alpha, and reports codevalue luma', () => {
  const input = image([[255, 0, 0, 255], [0, 255, 0, 128], [0, 0, 255, 0], [255, 255, 255, 255], [0, 0, 0, 255]]), before = input.data.slice();
  const h = Tone.histogram(input), weight = 128 / 255;
  assert.equal(h.totalPixels, 5); assert.equal(h.sampledPixels, 5); assert.equal(h.visibleSamples, 4); assert.equal(h.effectiveSamples, 3 + weight);
  assert.equal(h.bins.luma[54], 1); assert.equal(h.bins.luma[182], weight); assert.equal(h.bins.luma[18], 0);
  assert.equal(h.bins.blue[255], 1); assert.equal(h.bins.red[255], 2);
  assert.equal(h.endpoints.red.whiteFraction, 2 / (3 + weight));
  assert.equal(h.alphaWeighting, 'alpha/255'); assert.equal(h.colorSpace, 'gamma-encoded-sRGB'); assert.equal(h.approximate, false);
  for (const bins of Object.values(h.bins)) assert.ok(Math.abs(bins.reduce((a, b) => a + b, 0) - h.effectiveSamples) < 1e-12);
  assert.deepEqual(input.data, before);
});
test('empty visible histogram remains finite and does not invent endpoint percentages', () => {
  const h = Tone.histogram(image([[0, 0, 0, 0], [255, 255, 255, 0]]));
  assert.equal(h.sampledPixels, 2); assert.equal(h.visibleSamples, 0); assert.equal(h.effectiveSamples, 0);
  for (const stats of Object.values(h.endpoints)) assert.deepEqual(stats, { black: 0, white: 0, blackFraction: 0, whiteFraction: 0 });
});
test('histogram uses exact bounded deterministic stratification, not fixed-step sampling', () => {
  const input = image(Array.from({ length: 65536 }, (_, i) => i % 4 === 0 ? [255, 0, 0, 255] : i % 4 === 1 ? [0, 255, 0, 255] : i % 4 === 2 ? [0, 0, 255, 255] : [255, 255, 255, 0]), 256);
  const h = Tone.histogram(input, { maxSamples: 4096 });
  assert.deepEqual(Tone.histogram(input, { maxSamples: 4096 }), h);
  assert.equal(h.sampledPixels, 4096); assert.equal(h.stride, 16); assert.equal(h.stratumMaxPixels, 16);
  assert.equal(h.samplingMethod, 'deterministic-stratified-hash-v1'); assert.equal(h.approximate, true);
  assert.match(h.strideMeaning, /not a fixed/);
  for (const key of ['red', 'green', 'blue']) assert.ok(h.bins[key][255] > 850 && h.bins[key][255] < 1200, `${key} phase missing`);
  assert.ok(h.visibleSamples > 2800 && h.visibleSamples < 3300);
  const uneven = Tone.histogram(ramp(), { maxSamples: 100 });
  assert.equal(uneven.sampledPixels, 100); assert.equal(uneven.stratumMaxPixels, 3);
  assert.equal(Tone.histogram(ramp(), { maxSamples: 999 }).samplingMethod, 'all-pixels');
});
