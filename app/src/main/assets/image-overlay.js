/* MintImageOverlay v1. Pure, bounded RGBA image-overlay compositor. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (typeof define === 'function' && define.amd) define([], function () { return api; });
  else root.MintImageOverlay = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LIMITS = Object.freeze({ maxPixels: 8000000, maxEdge: 4096,
    maxAssetPixels: 1048576, maxAssetEdge: 1024, maxAssetBytes: 4194304,
    maxAssetBase64Chars: 5592408, minSize: 0.02, maxSize: 2,
    edgeSamplesPerAxis: 4, maxMipTexelsPerPixel: 2, maxWorkUnits: 100000000,
    maxExtraBytes: 64 * 1024 * 1024, cancelIntervalPixels: 16384 });
  const RECIPE_KEYS = ['version', 'x', 'y', 'size', 'rotation', 'opacity', 'flipX', 'flipY'];
  const ASSET_KEYS = ['version', 'width', 'height', 'data'];
  const IMAGE_KEYS = ['width', 'height', 'data'];
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const own = Function.call.bind(Object.prototype.hasOwnProperty);
  const typedProto = Object.getPrototypeOf(Uint8Array.prototype);
  const typedLength = Object.getOwnPropertyDescriptor(typedProto, 'length').get;
  const typedBuffer = Object.getOwnPropertyDescriptor(typedProto, 'buffer').get;
  const typedOffset = Object.getOwnPropertyDescriptor(typedProto, 'byteOffset').get;
  const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
  const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable');
  const typedSet = Uint8ClampedArray.prototype.set;
  const ALLOWANCE_BYTES = 2 * 1024 * 1024;

  function fail(message, kind) {
    const error = kind === 'LIMIT' ? new RangeError(message) : new TypeError(message);
    error.code = 'IMAGE_OVERLAY_' + (kind || 'INVALID');
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
      if (!descriptor || !descriptor.enumerable || !own(descriptor, 'value')) {
        fail(label + ' contains a hidden or accessor field');
      }
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
  function dimensions(width, height, isAsset) {
    const edge = isAsset ? LIMITS.maxAssetEdge : LIMITS.maxEdge;
    const pixels = isAsset ? LIMITS.maxAssetPixels : LIMITS.maxPixels;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
        width > edge || height > edge || width * height > pixels) {
      fail((isAsset ? 'Asset' : 'Image') + ' dimensions exceed the integer edge or pixel budget', 'LIMIT');
    }
  }
  function defaults() {
    return Object.freeze({ version: 1, x: 0.5, y: 0.5, size: 0.5,
      rotation: 0, opacity: 1, flipX: false, flipY: false });
  }
  function validate(value) {
    const input = record(value, RECIPE_KEYS, RECIPE_KEYS, 'Overlay recipe');
    if (input.version !== 1) fail('Unsupported overlay recipe version');
    if (typeof input.flipX !== 'boolean' || typeof input.flipY !== 'boolean') fail('Overlay flips must be booleans');
    return Object.freeze({ version: 1,
      x: finite(input.x, 0, 1, 'Center x'), y: finite(input.y, 0, 1, 'Center y'),
      size: finite(input.size, LIMITS.minSize, LIMITS.maxSize, 'Overlay size'),
      rotation: finite(input.rotation, -180, 180, 'Overlay rotation'),
      opacity: finite(input.opacity, 0, 1, 'Overlay opacity'), flipX: input.flipX, flipY: input.flipY });
  }
  function options(value) {
    const result = record(value === undefined ? {} : value, ['shouldCancel'], [], 'Options');
    if (own(result, 'shouldCancel') && typeof result.shouldCancel !== 'function') fail('shouldCancel must be a function');
    return own(result, 'shouldCancel') ? result.shouldCancel : null;
  }
  function check(cancel) {
    if (cancel && cancel()) {
      const error = new Error('Image overlay cancelled');
      error.name = 'AbortError'; error.code = 'IMAGE_OVERLAY_CANCELLED'; throw error;
    }
  }
  function source(value, isAsset) {
    const image = record(value, IMAGE_KEYS, IMAGE_KEYS, isAsset ? 'Asset image' : 'Target image');
    dimensions(image.width, image.height, isAsset);
    const data = image.data, prototype = data && Object.getPrototypeOf(data);
    if (prototype !== Uint8Array.prototype && prototype !== Uint8ClampedArray.prototype) fail('RGBA data must be a local native Uint8Array or Uint8ClampedArray');
    let length, buffer, offset;
    try {
      length = typedLength.call(data); buffer = typedBuffer.call(data); offset = typedOffset.call(data);
      bufferLength.call(buffer);
    } catch (_) { fail('RGBA data must have a non-shared, attached ArrayBuffer'); }
    if (Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype || (resizable && resizable.get.call(buffer))) {
      fail('Shared, resizable or subclassed buffers are unsupported');
    }
    if (length !== image.width * image.height * 4) fail('RGBA length does not match dimensions');
    // A detached zero-length view already fails the positive dimension length check.
    return { width: image.width, height: image.height, data, buffer, offset, length };
  }
  function sextet(code) {
    if (code >= 65 && code <= 90) return code - 65;
    if (code >= 97 && code <= 122) return code - 71;
    if (code >= 48 && code <= 57) return code + 4;
    if (code === 43) return 62;
    if (code === 47) return 63;
    return -1;
  }
  function assetRecord(value) {
    const input = record(value, ASSET_KEYS, ASSET_KEYS, 'Overlay asset');
    if (input.version !== 1) fail('Unsupported overlay asset version');
    dimensions(input.width, input.height, true);
    if (typeof input.data !== 'string') fail('Asset data must be a canonical base64 RGBA8 string');
    const bytes = input.width * input.height * 4, expected = Math.ceil(bytes / 3) * 4;
    if (input.data.length !== expected || expected > LIMITS.maxAssetBase64Chars) fail('Asset base64 length does not match dimensions');
    return { version: 1, width: input.width, height: input.height, data: input.data };
  }
  function canonicalBase64(asset, cancel) {
    const text = asset.data, bytes = asset.width * asset.height * 4;
    const remainder = bytes % 3, padding = remainder ? 3 - remainder : 0;
    const end = text.length - padding;
    // Bounded scalar scan: no backtracking regex, atob, URI, filename or file decoder.
    for (let i = 0; i < end; i++) {
      if (sextet(text.charCodeAt(i)) < 0) fail('Asset data contains non-canonical base64');
      if ((i & 65535) === 65535) check(cancel);
    }
    for (let i = end; i < text.length; i++) if (text.charCodeAt(i) !== 61) fail('Asset base64 padding is invalid');
    if ((remainder === 1 && (sextet(text.charCodeAt(end - 1)) & 15) !== 0) ||
        (remainder === 2 && (sextet(text.charCodeAt(end - 1)) & 3) !== 0)) fail('Asset base64 pad bits are nonzero');
    check(cancel);
    return asset;
  }
  function validateAsset(value) { return Object.freeze(canonicalBase64(assetRecord(value), null)); }
  function encodeAsset(value) {
    const image = source(value, true), encodedLength = Math.ceil(image.length / 3) * 4;
    // Includes output string and transient chunk storage, excluding caller's pixels.
    if (ALLOWANCE_BYTES + encodedLength * 4 > LIMITS.maxExtraBytes) fail('Asset encoding exceeds its extra-buffer budget', 'LIMIT');
    const data = image.data, chunks = [], chars = new Array(8192);
    let used = 0;
    for (let i = 0; i < image.length; i += 3) {
      const a = data[i], b = i + 1 < image.length ? data[i + 1] : 0, c = i + 2 < image.length ? data[i + 2] : 0;
      chars[used++] = ALPHABET[a >>> 2];
      chars[used++] = ALPHABET[((a & 3) << 4) | (b >>> 4)];
      chars[used++] = i + 1 < image.length ? ALPHABET[((b & 15) << 2) | (c >>> 6)] : '=';
      chars[used++] = i + 2 < image.length ? ALPHABET[c & 63] : '=';
      if (used === chars.length) { chunks.push(chars.join('')); used = 0; }
    }
    if (used) { chars.length = used; chunks.push(chars.join('')); }
    return Object.freeze({ version: 1, width: image.width, height: image.height, data: chunks.join('') });
  }
  function decodeValidated(asset, cancel) {
    const length = asset.width * asset.height * 4;
    const data = new Uint8ClampedArray(length), text = asset.data;
    let pos = 0, hasAlpha = false;
    for (let i = 0; i < text.length; i += 4) {
      const a = sextet(text.charCodeAt(i)), b = sextet(text.charCodeAt(i + 1));
      const c = text.charCodeAt(i + 2) === 61 ? 0 : sextet(text.charCodeAt(i + 2));
      const d = text.charCodeAt(i + 3) === 61 ? 0 : sextet(text.charCodeAt(i + 3));
      data[pos++] = (a << 2) | (b >>> 4);
      if (pos < length) data[pos++] = ((b & 15) << 4) | (c >>> 2);
      if (pos < length) data[pos++] = ((c & 3) << 6) | d;
      if ((i & 65535) === 65532) check(cancel);
    }
    for (let i = 3; i < length; i += 4) {
      if (data[i]) hasAlpha = true;
      if ((i & 65535) === 65535) check(cancel);
    }
    check(cancel);
    return { data, hasAlpha };
  }
  function decodeAsset(value) {
    const asset = validateAsset(value);
    if (ALLOWANCE_BYTES + asset.width * asset.height * 4 > LIMITS.maxExtraBytes) fail('Asset decoding exceeds its extra-buffer budget', 'LIMIT');
    const decoded = decodeValidated(asset, null);
    return { width: asset.width, height: asset.height, data: decoded.data };
  }
  function trig(degrees) {
    // Exact cardinal angles avoid artificial edge fuzz and one-pixel leakage.
    if (degrees === 0) return [1, 0];
    if (degrees === 90) return [0, 1];
    if (degrees === -90) return [0, -1];
    if (degrees === 180 || degrees === -180) return [-1, 0];
    const radians = degrees * Math.PI / 180;
    return [Math.cos(radians), Math.sin(radians)];
  }
  // Return the inclusive interval of destination pixel centers inside a rotated
  // rectangle on one row. Two half-plane pairs intersect one horizontal line.
  // Closed bounds deliberately overinclude measure-zero boundary points.
  function rowRange(y, hw, hh, p, out) {
    if (hw < 0 || hh < 0) { out[0] = 0; out[1] = -1; return; }
    const dy = y + 0.5 - p.centerY, c = p.cos, s = p.sin;
    let lo = -Infinity, hi = Infinity;
    if (c === 0) {
      if (Math.abs(s * dy) > hw) { out[0] = 0; out[1] = -1; return; }
    } else {
      const a = (-hw - s * dy) / c, b = (hw - s * dy) / c;
      lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
    }
    if (s === 0) {
      if (Math.abs(c * dy) > hh) { out[0] = 0; out[1] = -1; return; }
    } else {
      const a = (-hh - c * dy) / -s, b = (hh - c * dy) / -s;
      lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
    }
    out[0] = Math.max(p.bounds.x, Math.ceil(p.centerX + lo - 0.5));
    out[1] = Math.min(p.bounds.x + p.bounds.width - 1, Math.floor(p.centerX + hi - 0.5));
  }
  function prepare(width, height, asset, recipe, cancel) {
    dimensions(width, height, false);
    const t = trig(recipe.rotation), drawLong = Math.min(width, height) * recipe.size;
    const scale = drawLong / Math.max(asset.width, asset.height);
    const drawWidth = asset.width * scale, drawHeight = asset.height * scale;
    const centerX = recipe.x * width, centerY = recipe.y * height, cos = t[0], sin = t[1];
    const extentX = (Math.abs(cos) * drawWidth + Math.abs(sin) * drawHeight) * 0.5;
    const extentY = (Math.abs(sin) * drawWidth + Math.abs(cos) * drawHeight) * 0.5;
    const x = Math.max(0, Math.min(width, Math.floor(centerX - extentX)));
    const y = Math.max(0, Math.min(height, Math.floor(centerY - extentY)));
    const right = Math.max(x, Math.min(width, Math.ceil(centerX + extentX)));
    const bottom = Math.max(y, Math.min(height, Math.ceil(centerY + extentY)));
    const bounds = Object.freeze({ x, y, width: right - x, height: bottom - y });
    const p = { width, height, assetWidth: asset.width, assetHeight: asset.height,
      centerX, centerY, drawWidth, drawHeight, scale, cos, sin, bounds };
    const hw = drawWidth * 0.5, hh = drawHeight * 0.5, hs = (Math.abs(cos) + Math.abs(sin)) * 0.5;
    const outer = [0, -1], inner = [0, -1];
    let candidatePixels = 0, interiorPixels = 0;
    const active = recipe.opacity > 0 && bounds.width > 0 && bounds.height > 0;
    if (active) for (let row = y; row < bottom; row++) {
      rowRange(row, hw + hs, hh + hs, p, outer);
      rowRange(row, hw - hs, hh - hs, p, inner);
      const candidates = Math.max(0, outer[1] - outer[0] + 1);
      const interiors = Math.max(0, Math.min(outer[1], inner[1]) - Math.max(outer[0], inner[0]) + 1);
      candidatePixels += candidates; interiorPixels += interiors;
      if ((row & 63) === 63) check(cancel);
    }
    const boundaryPixels = candidatePixels - interiorPixels;
    const samples = interiorPixels + boundaryPixels * LIMITS.edgeSamplesPerAxis * LIMITS.edgeSamplesPerAxis;
    const bytes = asset.width * asset.height * 4;
    let mipWidth = asset.width, mipHeight = asset.height, mipPixels = 0;
    const mipSizes = [];
    if (active) while ((mipWidth > 1 && mipWidth / drawWidth > LIMITS.maxMipTexelsPerPixel) ||
        (mipHeight > 1 && mipHeight / drawHeight > LIMITS.maxMipTexelsPerPixel)) {
      mipWidth = Math.max(1, Math.ceil(mipWidth / 2));
      mipHeight = Math.max(1, Math.ceil(mipHeight / 2));
      mipPixels += mipWidth * mipHeight;
      mipSizes.push(Object.freeze({ width: mipWidth, height: mipHeight }));
    }
    Object.freeze(mipSizes);
    // Units bound base64 chars, decoded byte writes, alpha visits, pixel copies,
    // candidate pixels, bilinear taps and row geometry; not CPU instructions.
    const workUnits = asset.data.length + (active ? bytes + bytes / 4 + width * height +
      candidatePixels + 4 * samples + mipPixels * 13 + bounds.height * 8 : 0);
    const extraBytes = ALLOWANCE_BYTES + (active ? bytes + width * height * 4 + mipPixels * 4 * 8 : 0);
    if (workUnits > LIMITS.maxWorkUnits) fail('Overlay exceeds its work budget', 'LIMIT');
    if (extraBytes > LIMITS.maxExtraBytes) fail('Overlay exceeds its extra-buffer budget', 'LIMIT');
    check(cancel);
    return Object.freeze(Object.assign(p, { active, candidatePixels, interiorPixels, boundaryPixels, samples, mipLevels: mipSizes.length, mipWidth, mipHeight, mipPixels, mipSizes, workUnits, extraBytes }));
  }
  function layout(width, height, assetValue, recipeValue) {
    const recipe = validate(recipeValue), asset = assetRecord(assetValue);
    const plan = prepare(width, height, asset, recipe, null);
    canonicalBase64(asset, null);
    return plan;
  }
  function copySource(image, out, cancel) {
    const chunk = LIMITS.cancelIntervalPixels * 4;
    for (let offset = 0; offset < image.length; offset += chunk) {
      check(cancel);
      typedSet.call(out, new Uint8Array(image.buffer, image.offset + offset, Math.min(chunk, image.length - offset)), offset);
    }
    check(cancel);
  }
  function makeMips(decoded, asset, p, cancel) {
    let current = { width: asset.width, height: asset.height, data: decoded.data, premultiplied: false };
    let visits = 0;
    for (const size of p.mipSizes) {
      check(cancel);
      const out = new Float64Array(size.width * size.height * 4);
      const spanX = current.width / size.width, spanY = current.height / size.height;
      for (let y = 0; y < size.height; y++) {
        check(cancel);
        const top = y * spanY, bottom = (y + 1) * spanY;
        const firstY = Math.floor(top), lastY = Math.min(current.height - 1, Math.ceil(bottom) - 1);
        for (let x = 0; x < size.width; x++) {
          const left = x * spanX, right = (x + 1) * spanX;
          const firstX = Math.floor(left), lastX = Math.min(current.width - 1, Math.ceil(right) - 1);
          const target = (y * size.width + x) * 4;
          for (let sy = firstY; sy <= lastY; sy++) for (let sx = firstX; sx <= lastX; sx++) {
            const weight = (Math.min(right, sx + 1) - Math.max(left, sx)) *
              (Math.min(bottom, sy + 1) - Math.max(top, sy)) / (spanX * spanY);
            const source = (sy * current.width + sx) * 4, a = current.data[source + 3];
            const colorWeight = current.premultiplied ? weight : a * weight;
            out[target] += current.data[source] * colorWeight;
            out[target + 1] += current.data[source + 1] * colorWeight;
            out[target + 2] += current.data[source + 2] * colorWeight;
            out[target + 3] += a * weight;
          }
          if (++visits === LIMITS.cancelIntervalPixels) { check(cancel); visits = 0; }
        }
      }
      current = { width: size.width, height: size.height, data: out, premultiplied: true };
    }
    check(cancel);
    return current;
  }
  function sample(data, width, height, premultiplied, sx, sy, weight, result) {
    // Clamp within the geometric footprint to edge texel centers. Transparent
    // out-of-footprint coverage is handled by destination edge samples, not an
    // extra bilinear transparent border that would blur aligned opaque edges.
    sx = Math.max(0, Math.min(width - 1, sx)); sy = Math.max(0, Math.min(height - 1, sy));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
    const fx = sx - x0, fy = sy - y0;
    const i0 = (y0 * width + x0) * 4, i1 = (y0 * width + x1) * 4;
    const i2 = (y1 * width + x0) * 4, i3 = (y1 * width + x1) * 4;
    const a0 = data[i0 + 3], a1 = data[i1 + 3], a2 = data[i2 + 3], a3 = data[i3 + 3];
    // Difference-form lerp exactly preserves a constant filtered field, avoiding
    // half-byte checker means flickering by one code value from weight-sum drift.
    for (let channel = 0; channel < 3; channel++) {
      const v0 = data[i0 + channel] * (premultiplied ? 1 : a0);
      const v1 = data[i1 + channel] * (premultiplied ? 1 : a1);
      const v2 = data[i2 + channel] * (premultiplied ? 1 : a2);
      const v3 = data[i3 + channel] * (premultiplied ? 1 : a3);
      const top = v0 + (v1 - v0) * fx, bottom = v2 + (v3 - v2) * fx;
      result[channel] += (top + (bottom - top) * fy) * weight;
    }
    const topA = a0 + (a1 - a0) * fx, bottomA = a2 + (a3 - a2) * fx;
    result[3] += (topA + (bottomA - topA) * fy) * weight;
  }
  function apply(imageValue, assetValue, recipeValue, optionsValue) {
    const cancel = options(optionsValue);
    check(cancel);
    const image = source(imageValue, false), recipe = validate(recipeValue), asset = assetRecord(assetValue);
    const p = prepare(image.width, image.height, asset, recipe, cancel);
    canonicalBase64(asset, cancel);
    if (!p.active) { check(cancel); return imageValue; }
    check(cancel);
    const decoded = decodeValidated(asset, cancel);
    if (!decoded.hasAlpha) { check(cancel); return imageValue; }
    check(cancel);
    const filtered = makeMips(decoded, asset, p, cancel);
    const out = new Uint8ClampedArray(image.length);
    copySource(image, out, cancel);
    const hw = p.drawWidth * 0.5, hh = p.drawHeight * 0.5;
    const hs = (Math.abs(p.cos) + Math.abs(p.sin)) * 0.5;
    const outer = [0, -1], inner = [0, -1], accum = [0, 0, 0, 0];
    const n = LIMITS.edgeSamplesPerAxis, inverseN = 1 / n, edgeWeight = 1 / (n * n);
    const aw = filtered.width, ah = filtered.height, flipX = recipe.flipX, flipY = recipe.flipY;
    let visits = 0, changed = false;
    for (let y = p.bounds.y, end = y + p.bounds.height; y < end; y++) {
      check(cancel);
      rowRange(y, hw + hs, hh + hs, p, outer);
      rowRange(y, hw - hs, hh - hs, p, inner);
      for (let x = outer[0]; x <= outer[1]; x++) {
        accum[0] = 0; accum[1] = 0; accum[2] = 0; accum[3] = 0;
        if (x >= inner[0] && x <= inner[1]) {
          const dx = x + 0.5 - p.centerX, dy = y + 0.5 - p.centerY;
          const u = p.cos * dx + p.sin * dy, v = -p.sin * dx + p.cos * dy;
          const sx = (u + hw) / p.drawWidth * aw - 0.5, sy = (v + hh) / p.drawHeight * ah - 0.5;
          sample(filtered.data, aw, ah, filtered.premultiplied, flipX ? aw - 1 - sx : sx, flipY ? ah - 1 - sy : sy, 1, accum);
        } else {
          for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
            const dx = x + (k + 0.5) * inverseN - p.centerX, dy = y + (j + 0.5) * inverseN - p.centerY;
            const u = p.cos * dx + p.sin * dy, v = -p.sin * dx + p.cos * dy;
            if (u < -hw || u >= hw || v < -hh || v >= hh) continue;
            const sx = (u + hw) / p.drawWidth * aw - 0.5, sy = (v + hh) / p.drawHeight * ah - 0.5;
            sample(filtered.data, aw, ah, filtered.premultiplied, flipX ? aw - 1 - sx : sx, flipY ? ah - 1 - sy : sy, edgeWeight, accum);
          }
        }
        const sa = accum[3] * recipe.opacity;
        if (sa > 0) {
          const i = (y * image.width + x) * 4, da = image.data[i + 3], inverse = 1 - sa / 255;
          const oa = sa + da * inverse;
          const red = Math.round((accum[0] * recipe.opacity + image.data[i] * da * inverse) / oa);
          const green = Math.round((accum[1] * recipe.opacity + image.data[i + 1] * da * inverse) / oa);
          const blue = Math.round((accum[2] * recipe.opacity + image.data[i + 2] * da * inverse) / oa);
          const alpha = Math.round(oa);
          // Do not erase hidden RGB when quantized source coverage contributes
          // no representable output alpha to a transparent destination.
          if (alpha > 0) {
            out[i] = red; out[i + 1] = green; out[i + 2] = blue; out[i + 3] = alpha;
            if (out[i] !== image.data[i] || out[i + 1] !== image.data[i + 1] ||
                out[i + 2] !== image.data[i + 2] || out[i + 3] !== image.data[i + 3]) changed = true;
          }
        }
        if (++visits === LIMITS.cancelIntervalPixels) { check(cancel); visits = 0; }
      }
    }
    check(cancel);
    return changed ? { width: image.width, height: image.height, data: out } : imageValue;
  }

  return Object.freeze({ LIMITS, defaults, validate, validateAsset, encodeAsset, decodeAsset, layout, apply });
});
