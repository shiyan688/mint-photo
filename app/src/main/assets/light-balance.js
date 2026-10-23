/* Conventional display-referred light balance for unpremultiplied RGBA8 sRGB.
 * No learned processing, local masks, RAW reconstruction or clipped-detail recovery.
 * Keep this dependency-free module identical in desktop/mobile/preview/export. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MintLightBalance = api;
})(typeof globalThis === 'object' ? globalThis : null, function () {
  'use strict';

  const LIMITS = Object.freeze({ pixels: 64000000, edge: 16384, chunkPixels: 65536, chunkRows: 32, gainMin: .25, gainMax: 4, sampleRadiusMax: .05, sampleRadiusPixelsMin: 2, sampleRadiusPixelsMax: 32, sampleMin: 9 });
  const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
  const typedGet = Object.fromEntries(['length', 'buffer', 'byteLength', 'byteOffset'].map(key => [key, Object.getOwnPropertyDescriptor(typedPrototype, key).get]));
  const bufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
  const bufferResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable');
  const WR = .2126, WG = .7152, WB = .0722, TONE_SCALE = 2 * Math.LN2, TONE_KNEE = .1;
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

  function check(condition, message) {
    if (!condition) throw new TypeError(message);
  }
  function record(value, required, label, optional = []) {
    check(value !== null && typeof value === 'object' && !Array.isArray(value), `Invalid ${label}`);
    const proto = Object.getPrototypeOf(value);
    check(proto === Object.prototype || proto === null, `Invalid ${label} prototype`);
    const own = Reflect.ownKeys(value);
    check(own.length >= required.length && own.length <= required.length + optional.length, `Invalid ${label} fields`);
    const out = Object.create(null);
    for (const key of own) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      check(typeof key === 'string' && (required.includes(key) || optional.includes(key)) && descriptor && descriptor.enumerable && Object.hasOwn(descriptor, 'value'), `Invalid ${label} field`);
      out[key] = descriptor.value;
    }
    for (const key of required) check(Object.hasOwn(out, key), `Missing ${label} field: ${key}`);
    return out;
  }
  function number(value, low, high, label) {
    check(typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high, `Invalid ${label}`);
    return value;
  }
  function defaults() {
    return { version: 1, shadows: 0, highlights: 0, whiteBalance: { r: 1, g: 1, b: 1 } };
  }
  function validate(recipe) {
    if (recipe === null) return null;
    const r = record(recipe, ['version', 'shadows', 'highlights', 'whiteBalance'], 'light-balance recipe');
    check(r.version === 1, 'Unsupported light-balance recipe version');
    const w = record(r.whiteBalance, ['r', 'g', 'b'], 'white-balance gains');
    return {
      version: 1,
      shadows: number(r.shadows, -100, 100, 'shadows'),
      highlights: number(r.highlights, -100, 100, 'highlights'),
      whiteBalance: {
        r: number(w.r, LIMITS.gainMin, LIMITS.gainMax, 'red gain'),
        g: number(w.g, LIMITS.gainMin, LIMITS.gainMax, 'green gain'),
        b: number(w.b, LIMITS.gainMin, LIMITS.gainMax, 'blue gain')
      }
    };
  }
  function active(r) {
    return r !== null && (r.shadows !== 0 || r.highlights !== 0 || r.whiteBalance.r !== 1 || r.whiteBalance.g !== 1 || r.whiteBalance.b !== 1);
  }
  function isActive(recipe) { return active(validate(recipe)); }

  function validateImage(image) {
    const im = record(image, ['width', 'height', 'data'], 'light-balance image');
    const { width, height, data } = im;
    check(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width >= 1 && height >= 1 && width <= LIMITS.edge && height <= LIMITS.edge && width * height <= LIMITS.pixels, 'Invalid image dimensions (maximum 64 MP and 16384 per edge)');
    check(data !== null && typeof data === 'object' && ArrayBuffer.isView(data), 'Expected an RGBA8 typed array');
    const proto = Object.getPrototypeOf(data);
    check(proto === Uint8Array.prototype || proto === Uint8ClampedArray.prototype, 'Expected a native Uint8Array or Uint8ClampedArray');
    const length = typedGet.length.call(data), buffer = typedGet.buffer.call(data);
    const byteLength = typedGet.byteLength.call(data), byteOffset = typedGet.byteOffset.call(data);
    // The intrinsic rejects shared storage, including cross-realm shared buffers.
    const backingLength = bufferByteLength.call(buffer);
    check(length === width * height * 4 && byteLength === length && backingLength > 0 && byteOffset + length <= backingLength, 'Invalid RGBA8 buffer or length');
    check(!bufferResizable || !bufferResizable.get.call(buffer), 'Resizable RGBA8 buffers are unsupported');
    return { width, height, data, length, buffer, backingLength, byteOffset };
  }
  function validateOptions(value) {
    const opt = value === undefined ? Object.create(null) : record(value, [], 'light-balance options', ['shouldCancel']);
    check(opt.shouldCancel === undefined || typeof opt.shouldCancel === 'function', 'Invalid cancellation callback');
    return opt;
  }
  function checkpoint(shouldCancel, image) {
    if (shouldCancel && shouldCancel()) {
      const error = new Error('Light-balance processing cancelled');
      error.name = 'AbortError'; error.code = 'ABORT_ERR';
      throw error;
    }
    check(typedGet.length.call(image.data) === image.length && typedGet.byteOffset.call(image.data) === image.byteOffset && bufferByteLength.call(image.buffer) === image.backingLength, 'RGBA8 buffer changed during light balance');
  }
  function decode(value) {
    const x = value / 255;
    return x <= .04045 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4);
  }
  function encode(value) {
    const x = clamp(value, 0, 1);
    // A sub-nanocode tolerance stabilizes mathematical half-up ties after
    // floating-point decode/encode arithmetic; it is not image quantization.
    return Math.floor(255 * (x <= .0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - .055) + .5 + 1e-10);
  }
  function luminance(r, g, b) { return WR * r + WG * g + WB * b; }
  function tone(y, shadows, highlights) {
    if (y === 0 || y === 1 || (shadows === 0 && highlights === 0)) return y;
    const d = TONE_SCALE * (shadows * (1 - y) * (1 - y) + highlights * y * y);
    // C1 easing removes the chroma cusp where brightening changes to
    // darkening. Its derivative is in [0,1], so monotonicity is retained.
    const eased = d * Math.abs(d) / (Math.abs(d) + TONE_KNEE), oddsScale = Math.exp(eased);
    return y * oddsScale / (1 - y + y * oddsScale);
  }

  function apply(image, recipe, applyOptions) {
    const im = validateImage(image), r = validate(recipe), opt = validateOptions(applyOptions);
    const shouldCancel = opt.shouldCancel;
    checkpoint(shouldCancel, im);
    if (!active(r)) return image;
    const linear = new Float64Array(256);
    for (let i = 0; i < 256; i++) linear[i] = decode(i);
    checkpoint(shouldCancel, im); // Before image-sized allocation.
    const { width, height, data, length } = im, output = new Uint8ClampedArray(length);
    const rows = Math.max(1, Math.min(LIMITS.chunkRows, Math.floor(LIMITS.chunkPixels / width)));
    const gains = r.whiteBalance, shadows = r.shadows / 100, highlights = r.highlights / 100;
    for (let row = 0; row < height; row += rows) {
      checkpoint(shouldCancel, im);
      const end = Math.min(height, row + rows) * width * 4;
      for (let i = row * width * 4; i < end; i += 4) {
        const red = data[i], green = data[i + 1], blue = data[i + 2], alpha = data[i + 3];
        output[i + 3] = alpha;
        if (alpha === 0) { output[i] = red; output[i + 1] = green; output[i + 2] = blue; continue; }
        const wr = linear[red] * gains.r, wg = linear[green] * gains.g, wb = linear[blue] * gains.b;
        // WB gamut policy: normalize ALL channels together only when needed.
        // Ratios survive, but out-of-gamut gained luminance is not preserved.
        const maximum = Math.max(1, wr, wg, wb), br = wr / maximum, bg = wg / maximum, bb = wb / maximum;
        const y = clamp(luminance(br, bg, bb), 0, 1), mappedY = tone(y, shadows, highlights);
        // Scale the corrected linear RGB together, preserving its ratios.
        // If tone lift leaves gamut, normalize ALL channels together again.
        // This preserves color direction, but sacrifices target luminance
        // for out-of-gamut pixels. It does not recover clipped information.
        const scale = y > 0 ? mappedY / y : 0;
        const tr = br * scale, tg = bg * scale, tb = bb * scale;
        const toneMaximum = Math.max(1, tr, tg, tb);
        output[i] = encode(tr / toneMaximum);
        output[i + 1] = encode(tg / toneMaximum);
        output[i + 2] = encode(tb / toneMaximum);
      }
    }
    checkpoint(shouldCancel, im);
    return { width, height, data: output };
  }

  function sampleError(message, code) {
    const error = new RangeError(message); error.code = code; throw error;
  }
  function median(values) {
    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  }
  function trimmedMean(values) {
    values.sort((a, b) => a - b);
    const trim = Math.floor(values.length * .2), end = values.length - trim;
    let sum = 0;
    for (let i = trim; i < end; i++) sum += values[i];
    return sum / (end - trim);
  }
  function deriveWhiteBalance(image, selection, sampleOptions) {
    const im = validateImage(image), s = record(selection, ['x', 'y'], 'white-balance sample', ['radius']);
    const x = number(s.x, 0, 1, 'sample x'), y = number(s.y, 0, 1, 'sample y');
    const radius = s.radius === undefined ? .01 : number(s.radius, 0, LIMITS.sampleRadiusMax, 'sample radius');
    const opt = validateOptions(sampleOptions), shouldCancel = opt.shouldCancel;
    checkpoint(shouldCancel, im); // Before allocating bounded sample arrays.
    const cx = Math.round(x * (im.width - 1)), cy = Math.round(y * (im.height - 1));
    const pixels = clamp(Math.round(radius * Math.min(im.width, im.height)), LIMITS.sampleRadiusPixelsMin, LIMITS.sampleRadiusPixelsMax);
    const left = Math.max(0, cx - pixels), right = Math.min(im.width - 1, cx + pixels);
    const top = Math.max(0, cy - pixels), bottom = Math.min(im.height - 1, cy + pixels);
    const total = (right - left + 1) * (bottom - top + 1), samples = [], logRG = [], logBG = [];
    for (let row = top; row <= bottom; row++) {
      if ((row - top) % 8 === 0) checkpoint(shouldCancel, im);
      for (let col = left; col <= right; col++) {
        const i = (row * im.width + col) * 4, d = im.data;
        // Unpremultiplied partial alpha can be mathematically processed, but
        // is not trustworthy neutral-patch evidence. Do not weight it in.
        if (d[i + 3] !== 255 || d[i] <= 8 || d[i + 1] <= 8 || d[i + 2] <= 8 || d[i] >= 247 || d[i + 1] >= 247 || d[i + 2] >= 247) continue;
        const r = decode(d[i]), g = decode(d[i + 1]), b = decode(d[i + 2]), l = luminance(r, g, b);
        if (l < .01 || l > .9) continue;
        const rg = Math.log(r / g), bg = Math.log(b / g);
        samples.push({ r, g, b, rg, bg }); logRG.push(rg); logBG.push(bg);
      }
    }
    checkpoint(shouldCancel, im);
    if (samples.length < LIMITS.sampleMin || samples.length < total * .5) sampleError('Choose a larger, opaque, unclipped neutral patch with enough midtone detail', 'WB_SAMPLE_INSUFFICIENT');
    const centerRG = median(logRG), centerBG = median(logBG), rs = [], gs = [], bs = [];
    for (const sample of samples) {
      if (Math.abs(sample.rg - centerRG) <= .15 && Math.abs(sample.bg - centerBG) <= .15) {
        rs.push(sample.r); gs.push(sample.g); bs.push(sample.b);
      }
    }
    checkpoint(shouldCancel, im);
    if (rs.length < LIMITS.sampleMin || rs.length < samples.length * .6) sampleError('Choose a more consistently neutral patch, without mixed colors', 'WB_SAMPLE_INCONSISTENT');
    // Robust channel means set the neutral direction. A common normalization
    // preserves the arithmetic mean luminance of all accepted inliers, not
    // merely the independently trimmed representative RGB.
    let sumR = 0, sumG = 0, sumB = 0;
    for (let i = 0; i < rs.length; i++) { sumR += rs[i]; sumG += gs[i]; sumB += bs[i]; }
    const meanR = trimmedMean(rs), meanG = trimmedMean(gs), meanB = trimmedMean(bs);
    const normalization = luminance(sumR, sumG, sumB) / luminance(sumR / meanR, sumG / meanG, sumB / meanB);
    const gains = meanR === meanG && meanG === meanB ? { r: 1, g: 1, b: 1 } : { r: normalization / meanR, g: normalization / meanG, b: normalization / meanB };
    if (![gains.r, gains.g, gains.b].every(value => Number.isFinite(value) && value >= LIMITS.gainMin && value <= LIMITS.gainMax)) sampleError('This patch needs white-balance gains outside the supported 0.25–4 range', 'WB_GAIN_RANGE');
    checkpoint(shouldCancel, im);
    return gains;
  }

  return Object.freeze({ LIMITS, defaults, validate, isActive, apply, deriveWhiteBalance });
});
