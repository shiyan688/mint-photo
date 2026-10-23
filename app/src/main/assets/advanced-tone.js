/* Deterministic, display-referred tone controls for 8-bit gamma-encoded sRGB.
 * Conventional curves/HSL, not learned retouching or RAW highlight recovery.
 * The browser and export worker intentionally share this dependency-free core. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MintAdvancedTone = api;
})(typeof globalThis === 'object' ? globalThis : null, function () {
  'use strict';

  const LIMITS = Object.freeze({ pixels: 64000000, edge: 16384, chunkPixels: 65536, chunkRows: 32, histogramSamples: 262144 });
  const NODES = Object.freeze([0, .25, .5, .75, 1]);
  const BANDS = Object.freeze(['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta']);
  const CENTERS = Object.freeze([0, 30, 60, 120, 180, 240, 270, 300]);
  const CHANNELS = Object.freeze(['rgb', 'red', 'green', 'blue']);
  const LUT_STEPS = 4096;
  const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
  const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
  const typedGet = Object.fromEntries(['length', 'buffer'].map(k => [k, Object.getOwnPropertyDescriptor(typedPrototype, k).get]));
  const bufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;

  function check(condition, message) {
    if (!condition) throw new TypeError(message);
  }
  function record(value, keys, label, optional = []) {
    check(value !== null && typeof value === 'object' && !Array.isArray(value), `Invalid ${label}`);
    const proto = Object.getPrototypeOf(value);
    check(proto === Object.prototype || proto === null, `Invalid ${label} prototype`);
    const own = Reflect.ownKeys(value);
    check(own.length >= keys.length && own.length <= keys.length + optional.length, `Invalid ${label} fields`);
    const out = Object.create(null);
    for (const key of own) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      check(typeof key === 'string' && (keys.includes(key) || optional.includes(key)) && descriptor.enumerable && Object.hasOwn(descriptor, 'value'), `Invalid ${label} field`);
      out[key] = descriptor.value;
    }
    for (const key of keys) check(Object.hasOwn(out, key), `Missing ${label} field: ${key}`);
    return out;
  }
  function array(value, length, label) {
    check(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, `Invalid ${label} array`);
    const size = Object.getOwnPropertyDescriptor(value, 'length');
    check(size.value === length, `Invalid ${label} length`);
    const own = Reflect.ownKeys(value);
    check(own.length === length + 1, `Invalid ${label} array fields`);
    const out = new Array(length);
    for (let i = 0; i < length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      check(descriptor && descriptor.enumerable && Object.hasOwn(descriptor, 'value'), `Invalid ${label} element`);
      out[i] = descriptor.value;
    }
    return out;
  }
  function number(value, low, high, label) {
    check(typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high, `Invalid ${label}`);
    return value;
  }
  function defaults() {
    return {
      version: 1, enabled: true, strength: 1, curveMode: 'monotone',
      curves: { rgb: [...NODES], red: [...NODES], green: [...NODES], blue: [...NODES] },
      hsl: BANDS.map(() => ({ hue: 0, saturation: 0, luminance: 0 }))
    };
  }
  function validate(recipe) {
    if (recipe === null) return null;
    const r = record(recipe, ['version', 'enabled', 'strength', 'curveMode', 'curves', 'hsl'], 'advanced tone recipe');
    check(r.version === 1, 'Unsupported advanced tone recipe version');
    check(typeof r.enabled === 'boolean', 'Invalid advanced tone visibility');
    check(r.curveMode === 'monotone' || r.curveMode === 'free', 'Invalid curve mode');
    const sourceCurves = record(r.curves, CHANNELS, 'curves');
    const curves = {};
    for (const key of CHANNELS) {
      curves[key] = array(sourceCurves[key], 5, `${key} curve`).map(v => number(v, 0, 1, `${key} curve value`));
      if (r.curveMode === 'monotone') {
        check(curves[key].every((v, i, values) => i === 0 || v >= values[i - 1]), 'Monotone curves must be nondecreasing');
      }
    }
    const hsl = array(r.hsl, 8, 'HSL bands').map((band, i) => {
      const b = record(band, ['hue', 'saturation', 'luminance'], `${BANDS[i]} HSL band`);
      return { hue: number(b.hue, -30, 30, 'hue'), saturation: number(b.saturation, -100, 100, 'saturation'), luminance: number(b.luminance, -100, 100, 'luminance') };
    });
    return { version: 1, enabled: r.enabled, strength: number(r.strength, 0, 1, 'strength'), curveMode: r.curveMode, curves, hsl };
  }
  function curvesActive(r) { return CHANNELS.some(k => r.curves[k].some((v, i) => v !== NODES[i])); }
  function hslActive(r) { return r.hsl.some(b => b.hue !== 0 || b.saturation !== 0 || b.luminance !== 0); }
  function active(r) { return r !== null && r.enabled && r.strength > 0 && (curvesActive(r) || hslActive(r)); }
  function isActive(recipe) { return active(validate(recipe)); }

  function validateImage(image) {
    const im = record(image, ['width', 'height', 'data'], 'image');
    const { width, height, data } = im;
    check(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width >= 1 && height >= 1 && width <= LIMITS.edge && height <= LIMITS.edge && width * height <= LIMITS.pixels, 'Invalid image dimensions (maximum 64 MP and 16384 per edge)');
    check(data instanceof Uint8Array || data instanceof Uint8ClampedArray, 'Expected an RGBA8 typed array');
    // Intrinsic getters avoid executing shadowed length/buffer accessors.
    const length = typedGet.length.call(data), buffer = typedGet.buffer.call(data);
    check(buffer instanceof ArrayBuffer && length === width * height * 4 && bufferByteLength.call(buffer) > 0, 'Invalid RGBA8 buffer or length');
    return { width, height, data, length };
  }
  function options(value, key) {
    return value === undefined ? Object.create(null) : record(value, [], 'options', [key]);
  }
  function cancelIfNeeded(shouldCancel) {
    if (shouldCancel && shouldCancel()) {
      const error = new Error('Advanced tone rendering cancelled');
      error.name = 'AbortError'; error.code = 'ABORT_ERR';
      throw error;
    }
  }

  // Uniform-grid PCHIP: zero slopes at turns; harmonic means elsewhere.
  // Each segment is bounded by its own endpoint values, even in free mode.
  function denseCurve(y, mode) {
    const d = new Float64Array(4), m = new Float64Array(5);
    for (let i = 0; i < 4; i++) d[i] = (y[i + 1] - y[i]) * 4;
    for (let i = 1; i < 4; i++) m[i] = d[i - 1] * d[i] > 0 ? 2 * d[i - 1] * d[i] / (d[i - 1] + d[i]) : 0;
    function endpoint(a, b) {
      let slope = (3 * a - b) / 2;
      if (slope * a <= 0) slope = 0;
      else if (a * b < 0 && Math.abs(slope) > 3 * Math.abs(a)) slope = 3 * a;
      return slope;
    }
    m[0] = endpoint(d[0], d[1]); m[4] = endpoint(d[3], d[2]);
    const lut = new Float64Array(LUT_STEPS + 1);
    for (let i = 0; i <= LUT_STEPS; i++) {
      const x = i / LUT_STEPS * 4, segment = Math.min(3, Math.floor(x)), t = x - segment;
      const t2 = t * t, t3 = t2 * t;
      const value = (2 * t3 - 3 * t2 + 1) * y[segment] + (t3 - 2 * t2 + t) * .25 * m[segment] + (-2 * t3 + 3 * t2) * y[segment + 1] + (t3 - t2) * .25 * m[segment + 1];
      const low = Math.min(y[segment], y[segment + 1]), high = Math.max(y[segment], y[segment + 1]);
      check(Number.isFinite(value) && value >= low - 1e-12 && value <= high + 1e-12, 'Curve LUT failed segment bounds validation');
      lut[i] = clamp(value, low, high);
      check(lut[i] >= 0 && lut[i] <= 1 && (mode !== 'monotone' || i === 0 || lut[i] >= lut[i - 1] - 1e-12), 'Curve LUT failed range or monotonicity validation');
    }
    return lut;
  }
  function lookup(lut, value) {
    const position = clamp(value, 0, 1) * LUT_STEPS, index = Math.min(LUT_STEPS - 1, Math.floor(position));
    return lut[index] + (lut[index + 1] - lut[index]) * (position - index);
  }
  function channelLuts(recipe) {
    const master = denseCurve(recipe.curves.rgb, recipe.curveMode);
    return CHANNELS.slice(1).map(key => {
      const channel = denseCurve(recipe.curves[key], recipe.curveMode), lut = new Float64Array(256);
      for (let i = 0; i < 256; i++) {
        lut[i] = lookup(channel, lookup(master, i / 255));
        check(Number.isFinite(lut[i]) && lut[i] >= 0 && lut[i] <= 1, 'Composed curve LUT is invalid');
      }
      return lut;
    });
  }

  function apply(image, recipe, applyOptions) {
    const im = validateImage(image), r = validate(recipe), opt = options(applyOptions, 'shouldCancel');
    check(opt.shouldCancel === undefined || typeof opt.shouldCancel === 'function', 'Invalid cancellation callback');
    const shouldCancel = opt.shouldCancel;
    cancelIfNeeded(shouldCancel);
    if (!active(r)) return image;
    const luts = curvesActive(r) ? channelLuts(r) : null, useHsl = hslActive(r);
    const { width, height, data, length } = im, output = new Uint8ClampedArray(length);
    const rows = Math.max(1, Math.min(LIMITS.chunkRows, Math.floor(LIMITS.chunkPixels / width)));
    for (let y = 0; y < height; y += rows) {
      cancelIfNeeded(shouldCancel);
      const start = y * width * 4, end = Math.min(height, y + rows) * width * 4;
      // Copy alpha and hidden RGB exactly, without dispatching user methods.
      for (let i = start; i < end; i += 4) {
        const sourceR = data[i], sourceG = data[i + 1], sourceB = data[i + 2], alpha = data[i + 3];
        output[i] = sourceR; output[i + 1] = sourceG; output[i + 2] = sourceB; output[i + 3] = alpha;
        if (alpha === 0) continue;
        let red = luts ? luts[0][sourceR] : sourceR / 255;
        let green = luts ? luts[1][sourceG] : sourceG / 255;
        let blue = luts ? luts[2][sourceB] : sourceB / 255;
        if (useHsl) {
          const high = Math.max(red, green, blue), low = Math.min(red, green, blue), chroma = high - low;
          // Exact achromatic pixels have no hue and must not acquire one.
          if (chroma > 0) {
            const light = (high + low) / 2, saturation = chroma / (1 - Math.abs(2 * light - 1));
            let hue = high === red ? ((green - blue) / chroma) % 6 : high === green ? (blue - red) / chroma + 2 : (red - green) / chroma + 4;
            hue *= 60; if (hue < 0) hue += 360;
            let band = 0;
            while (band < 7 && hue >= CENTERS[band + 1]) band++;
            const next = (band + 1) % 8, endHue = band === 7 ? 360 : CENTERS[next];
            const weight = (hue - CENTERS[band]) / (endHue - CENTERS[band]);
            const a = r.hsl[band], b = r.hsl[next];
            const hueShift = a.hue * (1 - weight) + b.hue * weight;
            const saturationShift = a.saturation * (1 - weight) + b.saturation * weight;
            const luminanceShift = a.luminance * (1 - weight) + b.luminance * weight;
            // Smoothly remove hue-band effects near gray; selection never follows
            // the shifted hue, and all three controls use the same original weights.
            // Saturation alone reaches 1 for one-code near-black/white noise.
            // The chroma gate prevents that noise from receiving a large L shift.
            const gateT = Math.min(1, saturation / .1), chromaT = Math.min(1, chroma / .05);
            const gate = gateT * gateT * (3 - 2 * gateT) * chromaT * chromaT * (3 - 2 * chromaT);
            if (hueShift !== 0 || saturationShift !== 0 || luminanceShift !== 0) {
              const h = ((hue + hueShift * gate + 360) % 360) / 60;
              const s = clamp(saturation * (1 + saturationShift * gate / 100), 0, 1);
              const l = clamp(light + luminanceShift * .0025 * gate, 0, 1);
              const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(h % 2 - 1)), m = l - c / 2;
              if (h < 1) { red = c + m; green = x + m; blue = m; }
              else if (h < 2) { red = x + m; green = c + m; blue = m; }
              else if (h < 3) { red = m; green = c + m; blue = x + m; }
              else if (h < 4) { red = m; green = x + m; blue = c + m; }
              else if (h < 5) { red = x + m; green = m; blue = c + m; }
              else { red = c + m; green = m; blue = x + m; }
            }
          }
        }
        // Single strength blend after the complete curve + HSL operation.
        output[i] = sourceR + (red * 255 - sourceR) * r.strength;
        output[i + 1] = sourceG + (green * 255 - sourceG) * r.strength;
        output[i + 2] = sourceB + (blue * 255 - sourceB) * r.strength;
      }
    }
    cancelIfNeeded(shouldCancel);
    return { width, height, data: output };
  }

  function histogram(image, histogramOptions) {
    const { width, height, data } = validateImage(image), opt = options(histogramOptions, 'maxSamples');
    const maxSamples = opt.maxSamples === undefined ? LIMITS.histogramSamples : opt.maxSamples;
    check(Number.isSafeInteger(maxSamples) && maxSamples >= 1 && maxSamples <= LIMITS.pixels, 'Invalid histogram sample budget');
    const totalPixels = width * height, sampleCount = Math.min(totalPixels, maxSamples), stride = Math.ceil(totalPixels / sampleCount);
    const bins = { red: new Float64Array(256), green: new Float64Array(256), blue: new Float64Array(256), luma: new Float64Array(256) };
    let sampledPixels = 0, visibleSamples = 0, effectiveSamples = 0;
    for (let sample = 0; sample < sampleCount; sample++) {
      const begin = Math.floor(sample * totalPixels / sampleCount), end = Math.floor((sample + 1) * totalPixels / sampleCount);
      // A fixed-step scan can select only one phase of a periodic texture.
      // Stratification bounds spatial gaps; deterministic integer avalanche
      // changes phase within each stratum without random runtime state.
      let hash = (sample + 1) ^ 0x51f15e5d;
      hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
      hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
      hash = (hash ^ (hash >>> 16)) >>> 0;
      const pixel = begin + Math.floor(hash / 4294967296 * (end - begin));
      sampledPixels++;
      const i = pixel * 4, alpha = data[i + 3];
      if (alpha === 0) continue;
      visibleSamples++;
      const weight = alpha / 255, red = data[i], green = data[i + 1], blue = data[i + 2];
      effectiveSamples += weight;
      bins.red[red] += weight; bins.green[green] += weight; bins.blue[blue] += weight;
      bins.luma[Math.round(.2126 * red + .7152 * green + .0722 * blue)] += weight;
    }
    const endpoints = {};
    for (const key of ['red', 'green', 'blue', 'luma']) {
      endpoints[key] = { black: bins[key][0], white: bins[key][255], blackFraction: effectiveSamples ? bins[key][0] / effectiveSamples : 0, whiteFraction: effectiveSamples ? bins[key][255] / effectiveSamples : 0 };
    }
    return {
      bins, sampledPixels, visibleSamples, effectiveSamples, totalPixels, stride, maxSamples,
      alphaWeighting: 'alpha/255', colorSpace: 'gamma-encoded-sRGB',
      luma: '0.2126R+0.7152G+0.0722B (code values)', endpoints, approximate: sampleCount < totalPixels,
      samplingMethod: sampleCount === totalPixels ? 'all-pixels' : 'deterministic-stratified-hash-v1',
      strideMeaning: 'maximum stratum width; not a fixed stepping interval', stratumMaxPixels: stride
    };
  }

  return Object.freeze({ LIMITS, NODES, BANDS, CENTERS, defaults, validate, isActive, apply, histogram });
});
