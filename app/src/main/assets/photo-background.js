/* MintPhotoBackground v1. Pure, bounded linear-light background replacement. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./image-overlay.js'));
  else if (typeof define === 'function' && define.amd) define(['./image-overlay'], factory);
  else root.MintPhotoBackground = factory(root.MintImageOverlay);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (overlay) {
  'use strict';

  if (!overlay || typeof overlay.validateAsset !== 'function' || typeof overlay.decodeAsset !== 'function') {
    throw new Error('MintPhotoBackground requires MintImageOverlay');
  }
  const LIMITS = Object.freeze({ maxPixels: 8000000, maxEdge: 4096,
    maxAssetPixels: 1048576, maxAssetEdge: 1024,
    maxExtraBytes: 64 * 1024 * 1024, maxWorkUnits: 100000000,
    maxMipTexelsPerPixel: 2, cancelIntervalPixels: 16384 });
  const RECIPE_KEYS = ['version', 'fit', 'x', 'y', 'backdrop'];
  const ASSET_KEYS = ['version', 'width', 'height', 'data'];
  const IMAGE_KEYS = ['width', 'height', 'data'];
  const own = Function.call.bind(Object.prototype.hasOwnProperty);
  const typedProto = Object.getPrototypeOf(Uint8Array.prototype);
  const typedLength = Object.getOwnPropertyDescriptor(typedProto, 'length').get;
  const typedBuffer = Object.getOwnPropertyDescriptor(typedProto, 'buffer').get;
  const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
  const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable');
  const ALLOWANCE_BYTES = 2 * 1024 * 1024;
  const LINEAR = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function fail(message, kind) {
    const error = kind === 'LIMIT' ? new RangeError(message) : new TypeError(message);
    error.code = 'PHOTO_BACKGROUND_' + (kind || 'INVALID');
    throw error;
  }
  function record(value, keys, required, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + ' must be a plain data record');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(label + ' has an unsafe prototype');
    const names = Reflect.ownKeys(value), out = Object.create(null);
    if (names.length > keys.length) fail(label + ' contains unexpected fields');
    for (const key of names) {
      if (typeof key !== 'string' || keys.indexOf(key) < 0) fail(label + ' contains an unexpected field');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !own(descriptor, 'value')) fail(label + ' contains a hidden or accessor field');
      out[key] = descriptor.value;
    }
    for (const key of required) if (!own(out, key)) fail(label + ' is missing ' + key);
    return out;
  }
  function finite(value, min, max, label) {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(label + ' must be a finite number');
    if (value < min || value > max) fail(label + ' is out of range', 'LIMIT');
    return value === 0 ? 0 : value;
  }
  function dimensions(width, height, asset) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
        width > (asset ? LIMITS.maxAssetEdge : LIMITS.maxEdge) ||
        height > (asset ? LIMITS.maxAssetEdge : LIMITS.maxEdge) ||
        width * height > (asset ? LIMITS.maxAssetPixels : LIMITS.maxPixels)) {
      fail((asset ? 'Asset' : 'Target') + ' dimensions exceed the integer edge or pixel budget', 'LIMIT');
    }
  }
  function defaults() { return Object.freeze({ version: 1, fit: 'fill', x: 0.5, y: 0.5, backdrop: null }); }
  function validate(value) {
    const r = record(value, RECIPE_KEYS, RECIPE_KEYS, 'Photo-background recipe');
    if (r.version !== 1) fail('Unsupported photo-background recipe version');
    if (r.fit !== 'fill' && r.fit !== 'fit') fail('Background fit must be fill or fit');
    if (r.backdrop !== null && (typeof r.backdrop !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(r.backdrop))) {
      fail('Backdrop must be null or a six-digit hex color');
    }
    return Object.freeze({ version: 1, fit: r.fit,
      x: finite(r.x, 0, 1, 'Background alignment x'), y: finite(r.y, 0, 1, 'Background alignment y'),
      backdrop: r.backdrop === null ? null : r.backdrop.toLowerCase() });
  }
  function options(value) {
    const r = record(value === undefined ? {} : value, ['shouldCancel'], [], 'Options');
    if (own(r, 'shouldCancel') && typeof r.shouldCancel !== 'function') fail('shouldCancel must be a function');
    return own(r, 'shouldCancel') ? r.shouldCancel : null;
  }
  function check(cancel) {
    if (cancel && cancel()) {
      const error = new Error('Photo background cancelled');
      error.name = 'AbortError'; error.code = 'PHOTO_BACKGROUND_CANCELLED'; throw error;
    }
  }
  function view(data, floatMask, expected) {
    const prototype = data && Object.getPrototypeOf(data);
    if (floatMask ? prototype !== Float32Array.prototype :
        prototype !== Uint8Array.prototype && prototype !== Uint8ClampedArray.prototype) {
      fail(floatMask ? 'Mask data must be a local native Float32Array' : 'RGBA data must be a local native Uint8Array or Uint8ClampedArray');
    }
    let length, buffer;
    try {
      length = typedLength.call(data); buffer = typedBuffer.call(data); bufferLength.call(buffer);
    } catch (_) { fail('Pixel data must have a non-shared, attached ArrayBuffer'); }
    if (Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype || (resizable && resizable.get.call(buffer))) {
      fail('Shared, resizable or subclassed buffers are unsupported');
    }
    if (length !== expected) fail('Pixel data length does not match dimensions');
    return data;
  }
  function imageRecord(value, floatMask) {
    const r = record(value, IMAGE_KEYS, IMAGE_KEYS, floatMask ? 'Confidence mask' : 'Target image');
    dimensions(r.width, r.height, false);
    return { width: r.width, height: r.height, data: view(r.data, floatMask, r.width * r.height * (floatMask ? 1 : 4)) };
  }
  // This metadata-only preflight never decodes or allocates a pixel buffer.
  // Canonical bytes are always checked with the frozen shared asset validator.
  function assetRecord(value) {
    const r = record(value, ASSET_KEYS, ASSET_KEYS, 'Background asset');
    if (r.version !== 1) fail('Unsupported background asset version');
    dimensions(r.width, r.height, true);
    if (typeof r.data !== 'string' || r.data.length !== Math.ceil(r.width * r.height * 4 / 3) * 4) {
      fail('Background asset must contain dimension-matched canonical base64 RGBA8');
    }
    return { version: 1, width: r.width, height: r.height, data: r.data };
  }
  function sharedAsset(method, value) {
    try { return overlay[method](value); }
    catch (error) {
      if (error && (error.code === 'IMAGE_OVERLAY_INVALID' || error.code === 'IMAGE_OVERLAY_LIMIT')) {
        fail(error.message, error.code === 'IMAGE_OVERLAY_LIMIT' ? 'LIMIT' : 'INVALID');
      }
      throw error;
    }
  }
  function prepare(width, height, asset, recipe) {
    dimensions(width, height, false);
    const scale = (recipe.fit === 'fill' ? Math.max : Math.min)(width / asset.width, height / asset.height);
    const drawWidth = asset.width * scale, drawHeight = asset.height * scale;
    const left = (width - drawWidth) * recipe.x, top = (height - drawHeight) * recipe.y;
    const x = Math.max(0, Math.min(width, Math.floor(left)));
    const y = Math.max(0, Math.min(height, Math.floor(top)));
    const right = Math.max(x, Math.min(width, Math.ceil(left + drawWidth)));
    const bottom = Math.max(y, Math.min(height, Math.ceil(top + drawHeight)));
    const bounds = Object.freeze({ x, y, width: right - x, height: bottom - y });
    const targetPixels = width * height, assetPixels = asset.width * asset.height;
    const mipSizes = [];
    let mipWidth = asset.width, mipHeight = asset.height, mipPixels = 0;
    while ((mipWidth > 1 && mipWidth / drawWidth > LIMITS.maxMipTexelsPerPixel) ||
        (mipHeight > 1 && mipHeight / drawHeight > LIMITS.maxMipTexelsPerPixel)) {
      mipWidth = Math.max(1, Math.ceil(mipWidth / 2)); mipHeight = Math.max(1, Math.ceil(mipHeight / 2));
      mipPixels += mipWidth * mipHeight;
      mipSizes.push(Object.freeze({ width: mipWidth, height: mipHeight }));
    }
    Object.freeze(mipSizes);
    const decodedBytes = assetPixels * 4, baseLinearBytes = assetPixels * 16;
    const mipBytes = mipPixels * 16, outputBytes = targetPixels * 4;
    // Reserve all mip buffers together even though only two are logically live:
    // immediate garbage collection is neither assumed nor required.
    const extraBytes = ALLOWANCE_BYTES + decodedBytes + baseLinearBytes + mipBytes + outputBytes;
    const maxSampleTaps = scale < 1 ? 16 : 4, candidatePixels = bounds.width * bounds.height;
    // Units: each base64 character (two validations), decoded byte, decoder alpha
    // visit, mask visit, linear conversion, mip tap/output, output pixel and tap.
    // Mips use at most 9 taps. Sampling reserves 16 rather than the ideal
    // 9 taps to cover floating-point footprint endpoints on texel boundaries.
    const workUnits = asset.data.length * 2 + decodedBytes + assetPixels * 2 + targetPixels * 2 +
      mipPixels * 10 + candidatePixels * maxSampleTaps + height * 4 + 8192;
    if (extraBytes > LIMITS.maxExtraBytes) fail('Photo background exceeds its extra-buffer budget', 'LIMIT');
    if (workUnits > LIMITS.maxWorkUnits) fail('Photo background exceeds its work budget', 'LIMIT');
    return Object.freeze({ width, height, targetPixels, assetPixels, assetWidth: asset.width, assetHeight: asset.height,
      scale, drawWidth, drawHeight, left, top, bounds, candidatePixels, maxSampleTaps,
      mipLevels: mipSizes.length, mipWidth, mipHeight, mipPixels, mipSizes,
      decodedBytes, baseLinearBytes, mipBytes, outputBytes, allowanceBytes: ALLOWANCE_BYTES, extraBytes, workUnits });
  }
  function plan(width, height, assetValue, recipeValue) {
    const recipe = validate(recipeValue), asset = assetRecord(assetValue);
    const p = prepare(width, height, asset, recipe);
    sharedAsset('validateAsset', asset);
    return p;
  }
  function makeMips(decoded, asset, p, cancel) {
    check(cancel);
    let current = { width: asset.width, height: asset.height, data: new Float32Array(asset.width * asset.height * 4) };
    for (let pixel = 0, count = asset.width * asset.height; pixel < count; pixel++) {
      if (pixel % LIMITS.cancelIntervalPixels === 0) check(cancel);
      const i = pixel * 4, a = decoded.data[i + 3] / 255;
      if (a > 0) {
        current.data[i] = LINEAR[decoded.data[i]] * a;
        current.data[i + 1] = LINEAR[decoded.data[i + 1]] * a;
        current.data[i + 2] = LINEAR[decoded.data[i + 2]] * a;
        current.data[i + 3] = a;
      }
    }
    for (const size of p.mipSizes) {
      check(cancel);
      const data = new Float32Array(size.width * size.height * 4);
      const spanX = current.width / size.width, spanY = current.height / size.height;
      const accum = [0, 0, 0, 0];
      for (let y = 0; y < size.height; y++) {
        check(cancel);
        for (let x = 0; x < size.width; x++) {
          area(current, x * spanX, y * spanY, (x + 1) * spanX, (y + 1) * spanY, accum);
          const i = (y * size.width + x) * 4;
          data[i] = accum[0]; data[i + 1] = accum[1]; data[i + 2] = accum[2]; data[i + 3] = accum[3];
        }
      }
      current = { width: size.width, height: size.height, data };
    }
    check(cancel);
    return current;
  }
  // Integrate a piecewise-constant texel field over a clipped rectangular
  // footprint. Mip planning limits this to at most 3 x 3 texels per call.
  function area(level, left, top, right, bottom, out) {
    left = Math.max(0, Math.min(level.width, left)); right = Math.max(left, Math.min(level.width, right));
    top = Math.max(0, Math.min(level.height, top)); bottom = Math.max(top, Math.min(level.height, bottom));
    out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0;
    const total = (right - left) * (bottom - top);
    if (!(total > 0)) return;
    const x0 = Math.floor(left), y0 = Math.floor(top);
    const x1 = Math.min(level.width - 1, Math.ceil(right) - 1), y1 = Math.min(level.height - 1, Math.ceil(bottom) - 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const w = (Math.min(right, x + 1) - Math.max(left, x)) * (Math.min(bottom, y + 1) - Math.max(top, y)) / total;
      const i = (y * level.width + x) * 4;
      out[0] += level.data[i] * w; out[1] += level.data[i + 1] * w;
      out[2] += level.data[i + 2] * w; out[3] += level.data[i + 3] * w;
    }
  }
  function bilinear(level, sx, sy, out) {
    sx = Math.max(0, Math.min(level.width - 1, sx)); sy = Math.max(0, Math.min(level.height - 1, sy));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(level.width - 1, x0 + 1), y1 = Math.min(level.height - 1, y0 + 1);
    const fx = sx - x0, fy = sy - y0, data = level.data;
    const a = (y0 * level.width + x0) * 4, b = (y0 * level.width + x1) * 4;
    const c = (y1 * level.width + x0) * 4, d = (y1 * level.width + x1) * 4;
    for (let channel = 0; channel < 4; channel++) {
      const top = data[a + channel] + (data[b + channel] - data[a + channel]) * fx;
      const bottom = data[c + channel] + (data[d + channel] - data[c + channel]) * fx;
      out[channel] = top + (bottom - top) * fy;
    }
  }
  function background(level, p, x, y, out) {
    const left = Math.max(x, p.left), top = Math.max(y, p.top);
    const right = Math.min(x + 1, p.left + p.drawWidth), bottom = Math.min(y + 1, p.top + p.drawHeight);
    if (right <= left || bottom <= top) { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0; return; }
    const coverage = Math.min(1, (right - left) * (bottom - top));
    if (p.scale < 1) {
      area(level, (left - p.left) / p.drawWidth * level.width, (top - p.top) / p.drawHeight * level.height,
        (right - p.left) / p.drawWidth * level.width, (bottom - p.top) / p.drawHeight * level.height, out);
    } else {
      bilinear(level, ((left + right) * 0.5 - p.left) / p.drawWidth * level.width - 0.5,
        ((top + bottom) * 0.5 - p.top) / p.drawHeight * level.height - 0.5, out);
    }
    out[0] *= coverage; out[1] *= coverage; out[2] *= coverage;
    out[3] = Math.max(0, Math.min(1, out[3] * coverage));
  }
  function srgb(value) {
    value = Math.max(0, Math.min(1, value));
    return Math.round(255 * (value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055));
  }
  function apply(imageValue, maskValue, assetValue, recipeValue, optionsValue) {
    const cancel = options(optionsValue);
    check(cancel);
    const image = imageRecord(imageValue, false), mask = imageRecord(maskValue, true);
    if (mask.width !== image.width || mask.height !== image.height) fail('Confidence mask dimensions must match target exactly');
    const recipe = validate(recipeValue), asset = assetRecord(assetValue);
    const p = prepare(image.width, image.height, asset, recipe);
    let allOpaqueForeground = true;
    for (let pixel = 0; pixel < p.targetPixels; pixel++) {
      if (pixel % LIMITS.cancelIntervalPixels === 0) check(cancel);
      const m = mask.data[pixel];
      if (!Number.isFinite(m) || m < 0 || m > 1) fail('Mask confidence must be finite and in [0, 1]');
      if (m !== 1 || image.data[pixel * 4 + 3] !== 255) allOpaqueForeground = false;
    }
    check(cancel);
    const validated = sharedAsset('validateAsset', asset);
    check(cancel);
    if (allOpaqueForeground) return imageValue;
    // Reuse the frozen canonical decoder. Its bounded <= 4 MiB decode is atomic
    // to this API; no cancellation is promised inside that shared helper.
    const decoded = sharedAsset('decodeAsset', validated);
    check(cancel);
    const level = makeMips(decoded, asset, p, cancel);
    check(cancel);
    const out = new Uint8ClampedArray(p.outputBytes), accum = [0, 0, 0, 0];
    const backdrop = recipe.backdrop === null ? null : [LINEAR[parseInt(recipe.backdrop.slice(1, 3), 16)],
      LINEAR[parseInt(recipe.backdrop.slice(3, 5), 16)], LINEAR[parseInt(recipe.backdrop.slice(5, 7), 16)]];
    let changed = false;
    for (let y = 0, pixel = 0; y < image.height; y++) {
      check(cancel);
      for (let x = 0; x < image.width; x++, pixel++) {
        if (pixel % LIMITS.cancelIntervalPixels === 0) check(cancel);
        const i = pixel * 4, a = image.data[i + 3] / 255 * mask.data[pixel];
        if (a === 1) {
          // Identity branch: no transfer-function roundtrip of untouched skin,
          // hair, labels, or any other fully selected opaque foreground pixel.
          out[i] = image.data[i]; out[i + 1] = image.data[i + 1]; out[i + 2] = image.data[i + 2]; out[i + 3] = 255;
        } else {
          background(level, p, x, y, accum);
          let ba = accum[3];
          if (backdrop !== null) {
            const inverse = 1 - ba;
            accum[0] += backdrop[0] * inverse; accum[1] += backdrop[1] * inverse; accum[2] += backdrop[2] * inverse;
            ba = 1;
          }
          const oa = a + ba * (1 - a), alpha = Math.round(oa * 255);
          if (alpha > 0) {
            if (ba === 0 && a > 0) {
              // A transparent background changes only the mask-scaled alpha.
              out[i] = image.data[i]; out[i + 1] = image.data[i + 1]; out[i + 2] = image.data[i + 2];
            } else {
              for (let channel = 0; channel < 3; channel++) {
                out[i + channel] = srgb((LINEAR[image.data[i + channel]] * a + accum[channel] * (1 - a)) / oa);
              }
            }
            out[i + 3] = alpha;
          }
          // Quantized-transparent outputs remain canonical transparent black.
        }
        if (out[i] !== image.data[i] || out[i + 1] !== image.data[i + 1] ||
            out[i + 2] !== image.data[i + 2] || out[i + 3] !== image.data[i + 3]) changed = true;
      }
    }
    check(cancel);
    return changed ? { width: image.width, height: image.height, data: out } : imageValue;
  }

  return Object.freeze({ LIMITS, defaults, validate, plan, apply });
});
