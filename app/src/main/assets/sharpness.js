/* Conservative classical luminance unsharp detail for unpremultiplied RGBA8 sRGB.
 * Not deconvolution, learned restoration, denoising or missing-detail recovery.
 * The recipe radius is normalized to a 1000-pixel SHORT EDGE, not preview pixels. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MintSharpness = api;
})(typeof globalThis === 'object' ? globalThis : null, function () {
  'use strict';

  const LIMITS = Object.freeze({ pixels: 16777216, edge: 16384, chunkPixels: 65536, chunkRows: 32, referenceShortEdge: 1000, radiusMin: .3, radiusMax: 3, deltaCodes: 12, workingBytes: 268830720 });
  const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
  const typedGet = Object.fromEntries(['length', 'buffer', 'byteLength', 'byteOffset'].map(key => [key, Object.getOwnPropertyDescriptor(typedPrototype, key).get]));
  const bufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
  const bufferResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable');
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const WR = .2126, WG = .7152, WB = .0722;

  function check(condition, message) { if (!condition) throw new TypeError(message); }
  function record(value, required, label, optional = []) {
    check(value !== null && typeof value === 'object' && !Array.isArray(value), `Invalid ${label}`);
    const proto = Object.getPrototypeOf(value);
    check(proto === Object.prototype || proto === null, `Invalid ${label} prototype`);
    const own = Reflect.ownKeys(value), out = Object.create(null);
    check(own.length >= required.length && own.length <= required.length + optional.length, `Invalid ${label} fields`);
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
  function defaults() { return { version: 1, amount: 0, radius: 1, threshold: 3 }; }
  function validate(recipe) {
    if (recipe === null) return null;
    const r = record(recipe, ['version', 'amount', 'radius', 'threshold'], 'sharpness recipe');
    check(r.version === 1, 'Unsupported sharpness recipe version');
    return { version: 1, amount: number(r.amount, 0, 100, 'sharpness amount'), radius: number(r.radius, LIMITS.radiusMin, LIMITS.radiusMax, 'sharpness radius'), threshold: number(r.threshold, 0, 30, 'sharpness threshold') };
  }
  function active(r) { return r !== null && r.amount > 0; }
  function isActive(recipe) { return active(validate(recipe)); }
  function validateSize(size) {
    const s = record(size, ['width', 'height'], 'sharpness size');
    const { width, height } = s;
    check(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width >= 1 && height >= 1 && width <= LIMITS.edge && height <= LIMITS.edge && width * height <= LIMITS.pixels, 'Invalid image dimensions (maximum 16777216 pixels and 16384 per edge)');
    return { width, height };
  }
  function validateImage(image) {
    const im = record(image, ['width', 'height', 'data'], 'sharpness image');
    const { width, height, data } = im;
    check(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width >= 1 && height >= 1 && width <= LIMITS.edge && height <= LIMITS.edge && width * height <= LIMITS.pixels, 'Invalid image dimensions (maximum 16777216 pixels and 16384 per edge)');
    check(data !== null && typeof data === 'object' && ArrayBuffer.isView(data), 'Expected an RGBA8 typed array');
    const proto = Object.getPrototypeOf(data);
    check(proto === Uint8Array.prototype || proto === Uint8ClampedArray.prototype, 'Expected a native Uint8Array or Uint8ClampedArray');
    const length = typedGet.length.call(data), buffer = typedGet.buffer.call(data);
    const byteLength = typedGet.byteLength.call(data), byteOffset = typedGet.byteOffset.call(data);
    // Intrinsic getters reject shared storage and bypass shadowed properties.
    const backingLength = bufferByteLength.call(buffer);
    check(length === width * height * 4 && byteLength === length && backingLength > 0 && byteOffset + length <= backingLength, 'Invalid RGBA8 buffer or length');
    check(!bufferResizable || !bufferResizable.get.call(buffer), 'Resizable RGBA8 buffers are unsupported');
    return { width, height, data, length, buffer, backingLength, byteOffset };
  }
  function validateOptions(value) {
    const opt = value === undefined ? Object.create(null) : record(value, [], 'sharpness options', ['shouldCancel']);
    check(opt.shouldCancel === undefined || typeof opt.shouldCancel === 'function', 'Invalid cancellation callback');
    return opt;
  }
  function checkpoint(shouldCancel, image) {
    if (shouldCancel && shouldCancel()) {
      const error = new Error('Sharpness processing cancelled');
      error.name = 'AbortError'; error.code = 'ABORT_ERR'; throw error;
    }
    check(typedGet.length.call(image.data) === image.length && typedGet.byteOffset.call(image.data) === image.byteOffset && bufferByteLength.call(image.buffer) === image.backingLength, 'RGBA8 buffer changed during sharpening');
  }
  function planning(im, r) {
    const enabled = active(r), pixels = im.width * im.height;
    const sigmaPixels = r === null ? 0 : r.radius * Math.min(im.width, im.height) / LIMITS.referenceShortEdge;
    const variance = sigmaPixels * sigmaPixels / 3;
    const boxRadius = Math.floor((Math.sqrt(1 + 12 * variance) - 1) / 2);
    const baseVariance = boxRadius * (boxRadius + 1) / 3;
    // Unit taps on [-n,n], fractional taps f at +/-(n+1). Each stage's
    // exact per-axis variance is sigma^2/3; no integer-radius jump or floor.
    const edgeWeight = clamp((variance - baseVariance) * (2 * boxRadius + 1) / (2 * ((boxRadius + 1) * (boxRadius + 1) - variance)), 0, 1);
    const maxWorkingBytes = enabled ? pixels * 16 + im.width * 24 + 256 * 8 : 0;
    check(Number.isSafeInteger(maxWorkingBytes) && maxWorkingBytes <= LIMITS.workingBytes, 'Sharpness working-memory budget exceeded');
    // Work units are conservative scheduling weights, not CPU instructions.
    const workUnits = enabled ? 24 * pixels + 6 * (im.width + im.height) * (2 * boxRadius + 1) : 0;
    return { active: enabled, width: im.width, height: im.height, pixels, sigmaPixels, boxRadius, edgeWeight, supportPixels: 3 * (boxRadius + (edgeWeight > 0 ? 1 : 0)), blurPassesPerField: enabled ? 6 : 0, maxBlurPixelVisits: enabled ? pixels * 12 : 0, workUnits, inputBytes: pixels * 4, opaqueWorkingBytes: enabled ? pixels * 12 + im.width * 24 + 256 * 8 : 0, maxWorkingBytes, maxTotalBytes: pixels * 4 + maxWorkingBytes };
  }
  function plan(size, recipe) { return planning(validateSize(size), validate(recipe)); }
  function decode(x) { return x <= .04045 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); }
  function code(x) { return 255 * (x <= .0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - .055); }
  function encode(x) { return Math.floor(code(clamp(x, 0, 1)) + .5 + 1e-10); }
  function luma(data, i, lut) { return WR * lut[data[i]] + WG * lut[data[i + 1]] + WB * lut[data[i + 2]]; }

  function horizontal(source, target, im, p, shouldCancel, rows) {
    const w = im.width, h = im.height, n = p.boxRadius, f = p.edgeWeight, scale = 1 / (2 * n + 1 + 2 * f);
    for (let y = 0; y < h; y++) {
      if (y % rows === 0) checkpoint(shouldCancel, im);
      const start = y * w; let sum = 0;
      for (let k = -n; k <= n; k++) sum += source[start + clamp(k, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        const right = source[start + Math.min(w - 1, x + n + 1)];
        target[start + x] = (sum + f * (source[start + Math.max(0, x - n - 1)] + right)) * scale;
        sum += right - source[start + Math.max(0, x - n)];
      }
    }
  }
  function vertical(source, target, im, p, shouldCancel, rows, sums) {
    const w = im.width, h = im.height, n = p.boxRadius, f = p.edgeWeight, scale = 1 / (2 * n + 1 + 2 * f);
    for (let x = 0; x < w; x++) {
      if (x % 1024 === 0) checkpoint(shouldCancel, im);
      let sum = 0;
      for (let k = -n; k <= n; k++) sum += source[clamp(k, 0, h - 1) * w + x];
      sums[x] = sum;
    }
    for (let y = 0; y < h; y++) {
      if (y % rows === 0) checkpoint(shouldCancel, im);
      const start = y * w, outerTop = Math.max(0, y - n - 1) * w, top = Math.max(0, y - n) * w, bottom = Math.min(h - 1, y + n + 1) * w;
      for (let x = 0; x < w; x++) {
        const right = source[bottom + x];
        target[start + x] = (sums[x] + f * (source[outerTop + x] + right)) * scale;
        sums[x] += right - source[top + x];
      }
    }
  }
  function blur(field, scratch, im, p, shouldCancel, rows, rowBuffer) {
    for (let stage = 0; stage < 3; stage++) {
      horizontal(field, scratch, im, p, shouldCancel, rows);
      vertical(scratch, field, im, p, shouldCancel, rows, rowBuffer);
    }
  }

  function apply(image, recipe, applyOptions) {
    const im = validateImage(image), r = validate(recipe), opt = validateOptions(applyOptions), p = planning(im, r);
    const shouldCancel = opt.shouldCancel;
    checkpoint(shouldCancel, im);
    if (!p.active) return image;
    const { width, height, data, length } = im, count = width * height;
    const rows = Math.max(1, Math.min(LIMITS.chunkRows, Math.floor(LIMITS.chunkPixels / width)));
    const lut = new Float64Array(256);
    for (let i = 0; i < 256; i++) lut[i] = decode(i / 255);
    checkpoint(shouldCancel, im); const blurred = new Float32Array(count);
    checkpoint(shouldCancel, im); const scratch = new Float32Array(count);
    // This small array serves first as vertical running sums, then as three
    // rows of original linear luminance. No full-sized local-range images.
    checkpoint(shouldCancel, im); const rowBuffer = new Float64Array(width * 3);
    let opaque = true;
    for (let y = 0; y < height; y++) {
      if (y % rows === 0) checkpoint(shouldCancel, im);
      for (let j = y * width, end = j + width; j < end; j++) {
        const i = j * 4, alpha = data[i + 3];
        if (alpha !== 255) opaque = false;
        // Hidden RGB at zero coverage never enters any neighborhood.
        blurred[j] = alpha === 0 ? 0 : code(luma(data, i, lut)) * (alpha / 255);
      }
    }
    blur(blurred, scratch, im, p, shouldCancel, rows, rowBuffer);
    let weights = null;
    if (!opaque) {
      checkpoint(shouldCancel, im); weights = new Float32Array(count);
      for (let y = 0; y < height; y++) {
        if (y % rows === 0) checkpoint(shouldCancel, im);
        for (let j = y * width, end = j + width; j < end; j++) weights[j] = data[j * 4 + 3] / 255;
      }
      blur(weights, scratch, im, p, shouldCancel, rows, rowBuffer);
    }
    checkpoint(shouldCancel, im); const output = new Uint8ClampedArray(length);
    const loadRow = y => {
      const slot = (y % 3) * width, start = y * width * 4;
      for (let x = 0; x < width; x++) {
        const i = start + x * 4;
        rowBuffer[slot + x] = data[i + 3] === 0 ? NaN : luma(data, i, lut);
      }
    };
    loadRow(0);
    for (let y = 0; y < height; y++) {
      if (y % rows === 0) checkpoint(shouldCancel, im);
      if (y + 1 < height) loadRow(y + 1);
      const center = (y % 3) * width, top = (Math.max(0, y - 1) % 3) * width, bottom = (Math.min(height - 1, y + 1) % 3) * width;
      for (let x = 0; x < width; x++) {
        const j = y * width + x, i = j * 4, red = data[i], green = data[i + 1], blue = data[i + 2], alpha = data[i + 3];
        output[i] = red; output[i + 1] = green; output[i + 2] = blue; output[i + 3] = alpha;
        if (alpha === 0) continue;
        const originalY = rowBuffer[center + x], originalCode = code(originalY);
        const base = weights === null ? blurred[j] : blurred[j] / Math.max(weights[j], 1e-20);
        const detail = originalCode - base, magnitude = Math.abs(detail), excess = magnitude - r.threshold;
        if (excess <= 0 || magnitude < 1e-5 || originalY <= 0) continue;
        // C1 soft threshold, then a smooth 12-code asymptotic detail cap.
        // Threshold zero is ordinary detail, not an implicit denoiser.
        const softened = excess * excess / (magnitude + r.threshold);
        const deltaCode = Math.sign(detail) * (r.amount / 100) * LIMITS.deltaCodes * softened / (LIMITS.deltaCodes + softened);
        const desired = decode(clamp((originalCode + deltaCode) / 255, 0, 1)) - originalY;
        let low = originalY, high = originalY;
        for (let nx = Math.max(0, x - 1), end = Math.min(width - 1, x + 1); nx <= end; nx++) {
          const a = rowBuffer[top + nx], b = rowBuffer[center + nx], c = rowBuffer[bottom + nx];
          // NaN marks zero coverage; comparisons deliberately ignore it.
          if (a < low) low = a; if (a > high) high = a;
          if (b < low) low = b; if (b > high) high = b;
          if (c < low) low = c; if (c > high) high = c;
        }
        const range = desired > 0 ? high - originalY : originalY - low;
        if (range <= 0 || desired === 0) continue;
        // A soft limiter never creates a new 3x3 luminance extremum. Already
        // crisp two-tone steps therefore do not grow black/white halos.
        let delta = desired / (1 + Math.abs(desired) / range);
        const lr = lut[red], lg = lut[green], lb = lut[blue], maximum = Math.max(lr, lg, lb);
        if (delta > 0) {
          const gamutRoom = originalY * (1 / maximum - 1);
          if (gamutRoom <= 0) continue;
          delta /= 1 + delta / gamutRoom;
        }
        const gain = Math.max(0, (originalY + delta) / originalY);
        // One common linear-light gain, never independent channel detail or
        // a white component. Gamut limiting sacrifices the requested lift.
        output[i] = encode(lr * gain); output[i + 1] = encode(lg * gain); output[i + 2] = encode(lb * gain);
      }
    }
    checkpoint(shouldCancel, im);
    return { width, height, data: output };
  }

  return Object.freeze({ LIMITS, defaults, validate, isActive, plan, apply });
});
