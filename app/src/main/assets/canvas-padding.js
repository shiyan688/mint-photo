/* MintCanvasPadding: deterministic, non-resampling RGBA8 canvas expansion. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (typeof define === 'function' && define.amd) define([], function () { return api; });
  else root.MintCanvasPadding = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LIMITS = Object.freeze({ maxPixels: 67108864, maxEdge: 16384 });
  const MAX_METADATA_EDGE = 1000000;
  const RECIPE_KEYS = ['version', 'top', 'right', 'bottom', 'left', 'color', 'opacity'];
  const OPTION_KEYS = ['maxPixels', 'maxEdge', 'shouldCancel'];
  const ByteArray = Uint8Array;
  const ClampedArray = Uint8ClampedArray;
  const typedPrototype = Object.getPrototypeOf(ByteArray.prototype);
  const tagOf = Object.getOwnPropertyDescriptor(typedPrototype, Symbol.toStringTag).get;
  const bufferOf = Object.getOwnPropertyDescriptor(typedPrototype, 'buffer').get;
  const bytesOf = Object.getOwnPropertyDescriptor(typedPrototype, 'byteLength').get;
  const offsetOf = Object.getOwnPropertyDescriptor(typedPrototype, 'byteOffset').get;
  const bufferBytesOf = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
  const setBytes = typedPrototype.set;
  const isView = ArrayBuffer.isView;
  const hasOwn = Function.call.bind(Object.prototype.hasOwnProperty);

  // Snapshot descriptors, not value[key]. Accessors are rejected without invoking them.
  function record(value, allowed, required, label) {
    if (value === null || typeof value !== 'object') throw new TypeError(label + ' must be a plain data record');
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new TypeError(label + ' must be a plain data record');
    const result = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !allowed.includes(key) || !descriptor ||
          !descriptor.enumerable || !hasOwn(descriptor, 'value')) {
        throw new TypeError(label + ' contains an unsupported field');
      }
      result[key] = descriptor.value;
    }
    for (const key of required) {
      if (!hasOwn(result, key)) throw new TypeError(label + ' is missing ' + key);
    }
    return result;
  }

  function finiteRange(value, minimum, maximum, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
      throw new RangeError(label + ' is out of range');
    }
    return value === 0 ? 0 : value;
  }

  function integerLimit(value, maximum, label) {
    finiteRange(value, 1, maximum, label);
    if (!Number.isInteger(value)) throw new RangeError(label + ' must be an integer');
    return value;
  }

  function defaults() {
    return { version: 1, top: 0, right: 0, bottom: 0, left: 0, color: '#ffffff', opacity: 1 };
  }

  function validate(value) {
    const r = record(value, RECIPE_KEYS, RECIPE_KEYS, 'padding recipe');
    if (r.version !== 1) throw new RangeError('Unsupported padding recipe version');
    const top = finiteRange(r.top, 0, 0.5, 'top');
    const right = finiteRange(r.right, 0, 0.5, 'right');
    const bottom = finiteRange(r.bottom, 0, 0.5, 'bottom');
    const left = finiteRange(r.left, 0, 0.5, 'left');
    if (typeof r.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(r.color)) {
      throw new TypeError('color must be a six-digit #rrggbb string');
    }
    return {
      version: 1, top, right, bottom, left,
      color: r.color.toLowerCase(),
      opacity: finiteRange(r.opacity, 0, 1, 'opacity')
    };
  }

  function options(value) {
    const o = record(value === undefined ? {} : value, OPTION_KEYS, [], 'padding options');
    const maxPixels = hasOwn(o, 'maxPixels') ? integerLimit(o.maxPixels, LIMITS.maxPixels, 'maxPixels') : LIMITS.maxPixels;
    const maxEdge = hasOwn(o, 'maxEdge') ? integerLimit(o.maxEdge, LIMITS.maxEdge, 'maxEdge') : LIMITS.maxEdge;
    if (hasOwn(o, 'shouldCancel') && typeof o.shouldCancel !== 'function') {
      throw new TypeError('shouldCancel must be a function');
    }
    return { maxPixels, maxEdge, shouldCancel: hasOwn(o, 'shouldCancel') ? o.shouldCancel : null };
  }

  function dimensions(width, height, opt, label) {
    integerLimit(width, opt.maxEdge, label + ' width');
    integerLimit(height, opt.maxEdge, label + ' height');
    if (width * height > opt.maxPixels) throw new RangeError(label + ' pixel budget exceeded');
  }

  function metadataDimensions(width, height, label) {
    integerLimit(width, MAX_METADATA_EDGE, label + ' width');
    integerLimit(height, MAX_METADATA_EDGE, label + ' height');
    if (!Number.isSafeInteger(width * height)) throw new RangeError(label + ' pixel product is unsafe');
  }

  function makeMeasure(width, height, r) {
    metadataDimensions(width, height, 'metadata input');
    const edge = Math.min(width, height);
    const padding = {
      top: Math.round(edge * r.top), right: Math.round(edge * r.right),
      bottom: Math.round(edge * r.bottom), left: Math.round(edge * r.left)
    };
    const outputWidth = width + padding.left + padding.right;
    const outputHeight = height + padding.top + padding.bottom;
    metadataDimensions(outputWidth, outputHeight, 'metadata output');
    return {
      inputSize: { width, height },
      outputSize: { width: outputWidth, height: outputHeight },
      padding
    };
  }

  function measure(width, height, recipe) {
    return makeMeasure(width, height, validate(recipe));
  }

  function makePlan(width, height, r, opt) {
    const result = makeMeasure(width, height, r);
    dimensions(width, height, opt, 'input');
    dimensions(result.outputSize.width, result.outputSize.height, opt, 'output');
    return result;
  }

  function cancelled(opt) {
    const check = opt.shouldCancel;
    if (check && check()) {
      const error = new Error('Canvas padding operation cancelled');
      error.name = 'AbortError';
      throw error;
    }
  }

  function plan(width, height, recipe, opts) {
    const opt = options(opts);
    const result = makePlan(width, height, validate(recipe), opt);
    cancelled(opt);
    return result;
  }

  function image(value, opt) {
    const im = record(value, ['width', 'height', 'data'], ['width', 'height', 'data'], 'image');
    dimensions(im.width, im.height, opt, 'input');
    const expected = im.width * im.height * 4;
    let buffer, offset;
    try {
      // Intrinsics ignore attacker-supplied .buffer/.length/.constructor getters.
      const tag = tagOf.call(im.data);
      if (!isView(im.data) || (tag !== 'Uint8Array' && tag !== 'Uint8ClampedArray')) throw new TypeError();
      buffer = bufferOf.call(im.data);
      offset = offsetOf.call(im.data);
      if (bytesOf.call(im.data) !== expected) throw new TypeError();
      // The ArrayBuffer getter rejects SharedArrayBuffer, including cross-realm buffers.
      if (bufferBytesOf.call(buffer) < offset + expected) throw new TypeError();
      // A fresh, fixed-length byte view avoids user overrides/species during copying.
      const source = new ByteArray(buffer, offset, expected);
      return { width: im.width, height: im.height, source, expected };
    } catch (_) {
      throw new TypeError('Image requires exact, attached, non-shared Uint8Array or Uint8ClampedArray RGBA8 data');
    }
  }

  function poll(opt, im) {
    cancelled(opt);
    // A cancellation callback may detach or resize a buffer. Never return partial data.
    if (bytesOf.call(im.source) !== im.expected) throw new TypeError('Source RGBA8 buffer became unavailable');
  }

  function fillSpan(out, begin, end, red, green, blue, alpha) {
    for (let i = begin; i < end; i += 4) {
      out[i] = red; out[i + 1] = green; out[i + 2] = blue; out[i + 3] = alpha;
    }
  }

  function apply(value, recipe, opts) {
    const opt = options(opts);
    const r = validate(recipe);
    const im = image(value, opt);
    const p = makePlan(im.width, im.height, r, opt);
    const width = p.outputSize.width, height = p.outputSize.height;
    const padding = p.padding, inputRowBytes = im.width * 4, outputRowBytes = width * 4;
    const alpha = Math.round(r.opacity * 255);
    const red = parseInt(r.color.slice(1, 3), 16), green = parseInt(r.color.slice(3, 5), 16), blue = parseInt(r.color.slice(5, 7), 16);
    poll(opt, im); // All size/type checks and the first cancellation check precede allocation.
    const out = new ClampedArray(width * height * 4);
    const buffer = bufferOf.call(im.source), sourceOffset = offsetOf.call(im.source);
    for (let y = 0; y < height; y++) {
      if (y > 0 && y % 16 === 0) poll(opt, im);
      const rowStart = y * outputRowBytes, rowEnd = rowStart + outputRowBytes;
      const sourceY = y - padding.top;
      if (sourceY < 0 || sourceY >= im.height) {
        if (alpha !== 0) fillSpan(out, rowStart, rowEnd, red, green, blue, alpha);
      } else {
        const copyStart = rowStart + padding.left * 4;
        if (alpha !== 0) {
          fillSpan(out, rowStart, copyStart, red, green, blue, alpha);
          fillSpan(out, copyStart + inputRowBytes, rowEnd, red, green, blue, alpha);
        }
        const sourceRow = new ByteArray(buffer, sourceOffset + sourceY * inputRowBytes, inputRowBytes);
        setBytes.call(out, sourceRow, copyStart);
      }
    }
    poll(opt, im);
    return { width, height, data: out };
  }

  return Object.freeze({ version: '1.0.0', LIMITS, defaults, validate, measure, plan, apply });
});
