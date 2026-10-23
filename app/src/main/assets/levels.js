/* Conventional Levels for 8-bit, gamma-encoded sRGB RGBA pixels.
 * Display-referred and dependency-free; not a RAW/HDR recovery algorithm.
 * Keep this file byte-identical in desktop, mobile, preview and export paths. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MintLevels = api;
})(typeof globalThis === 'object' ? globalThis : null, function () {
  'use strict';

  const LIMITS = Object.freeze({ pixels: 64000000, edge: 16384, chunkPixels: 65536, chunkRows: 32 });
  const CHANNELS = Object.freeze(['rgb', 'red', 'green', 'blue']);
  const FIELDS = Object.freeze(['inputBlack', 'inputWhite', 'gamma', 'outputBlack', 'outputWhite']);
  const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
  const typedGet = Object.fromEntries(['length', 'buffer', 'byteLength', 'byteOffset'].map(key => [key, Object.getOwnPropertyDescriptor(typedPrototype, key).get]));
  const bufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
  const bufferResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable');
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

  function check(condition, message) {
    if (!condition) throw new TypeError(message);
  }
  // Inspect descriptors, never property getters. Only plain own data records
  // are accepted; null-prototype records are also suitable for JSON data.
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
  function number(value, low, high, label, integer = false) {
    check(typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high && (!integer || Number.isInteger(value)), `Invalid ${label}`);
    return value;
  }
  function defaultChannel() {
    return { inputBlack: 0, inputWhite: 255, gamma: 1, outputBlack: 0, outputWhite: 255 };
  }
  function defaults() {
    return { version: 1, strength: 1, channels: { rgb: defaultChannel(), red: defaultChannel(), green: defaultChannel(), blue: defaultChannel() } };
  }
  function validate(recipe) {
    if (recipe === null) return null;
    const r = record(recipe, ['version', 'strength', 'channels'], 'Levels recipe');
    check(r.version === 1, 'Unsupported Levels recipe version');
    const strength = number(r.strength, 0, 1, 'Levels strength');
    const source = record(r.channels, CHANNELS, 'Levels channels'), channels = {};
    for (const key of CHANNELS) {
      const c = record(source[key], FIELDS, `${key} Levels channel`);
      const channel = {
        inputBlack: number(c.inputBlack, 0, 255, 'input black', true),
        inputWhite: number(c.inputWhite, 0, 255, 'input white', true),
        gamma: number(c.gamma, .1, 10, 'gamma'),
        outputBlack: number(c.outputBlack, 0, 255, 'output black', true),
        outputWhite: number(c.outputWhite, 0, 255, 'output white', true)
      };
      check(channel.inputBlack < channel.inputWhite, 'Levels input black must be less than input white');
      check(channel.outputBlack <= channel.outputWhite, 'Levels output black must not exceed output white');
      // Define an own data property without dispatching an inherited setter.
      Object.defineProperty(channels, key, { __proto__: null, value: channel, enumerable: true, writable: true, configurable: true });
    }
    return { version: 1, strength, channels };
  }
  function identityChannel(c) {
    return c.inputBlack === 0 && c.inputWhite === 255 && c.gamma === 1 && c.outputBlack === 0 && c.outputWhite === 255;
  }
  function active(r) {
    return r !== null && r.strength > 0 && CHANNELS.some(key => !identityChannel(r.channels[key]));
  }
  function isActive(recipe) { return active(validate(recipe)); }

  function validateImage(image) {
    const im = record(image, ['width', 'height', 'data'], 'Levels image');
    const { width, height, data } = im;
    check(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width >= 1 && height >= 1 && width <= LIMITS.edge && height <= LIMITS.edge && width * height <= LIMITS.pixels, 'Invalid image dimensions (maximum 64 MP and 16384 per edge)');
    check(data !== null && typeof data === 'object' && ArrayBuffer.isView(data), 'Expected an RGBA8 typed array');
    const proto = Object.getPrototypeOf(data);
    check(proto === Uint8Array.prototype || proto === Uint8ClampedArray.prototype, 'Expected a native Uint8Array or Uint8ClampedArray');
    // Intrinsic getters bypass shadowed properties and require genuine typed
    // storage. No user-supplied typed-array method is dispatched.
    const length = typedGet.length.call(data), buffer = typedGet.buffer.call(data);
    const byteLength = typedGet.byteLength.call(data), byteOffset = typedGet.byteOffset.call(data);
    // This intrinsic rejects SharedArrayBuffer, including cross-realm storage.
    const backingLength = bufferByteLength.call(buffer);
    check(length === width * height * 4 && byteLength === length && backingLength > 0 && byteOffset + length <= backingLength, 'Invalid RGBA8 buffer or length');
    check(!bufferResizable || !bufferResizable.get.call(buffer), 'Resizable RGBA8 buffers are unsupported');
    return { width, height, data, length, buffer, backingLength, byteOffset };
  }
  function validateOptions(value) {
    const opt = value === undefined ? Object.create(null) : record(value, [], 'Levels options', ['shouldCancel']);
    check(opt.shouldCancel === undefined || typeof opt.shouldCancel === 'function', 'Invalid cancellation callback');
    return opt;
  }
  function cancelIfNeeded(shouldCancel) {
    if (shouldCancel && shouldCancel()) {
      const error = new Error('Levels rendering cancelled');
      error.name = 'AbortError';
      error.code = 'ABORT_ERR';
      throw error;
    }
  }
  function checkpoint(shouldCancel, image) {
    cancelIfNeeded(shouldCancel);
    // A callback may transfer/detach the input. Never publish a partial or
    // silently zero-filled result if its storage changed after validation.
    check(typedGet.length.call(image.data) === image.length && typedGet.byteOffset.call(image.data) === image.byteOffset && bufferByteLength.call(image.buffer) === image.backingLength, 'RGBA8 buffer changed during rendering');
  }

  function mapChannel(value, channel) {
    if (identityChannel(channel)) return value;
    const normalized = clamp((value - channel.inputBlack) / (channel.inputWhite - channel.inputBlack), 0, 1);
    return channel.outputBlack + Math.pow(normalized, 1 / channel.gamma) * (channel.outputWhite - channel.outputBlack);
  }
  function makeLuts(r) {
    const luts = { red: new Uint8Array(256), green: new Uint8Array(256), blue: new Uint8Array(256) };
    const useLevels = active(r);
    for (const key of CHANNELS.slice(1)) {
      const table = luts[key];
      for (let value = 0; value < 256; value++) {
        if (!useLevels) { table[value] = value; continue; }
        // Keep full Number precision through BOTH maps. Blend ONCE with the
        // original code value, then round ONCE, explicitly half-up (not the
        // ties-to-even conversion that Uint8ClampedArray would perform).
        const master = mapChannel(value, r.channels.rgb);
        const mapped = mapChannel(master, r.channels[key]);
        table[value] = Math.round(value + (mapped - value) * r.strength);
      }
    }
    return luts;
  }
  function buildLuts(recipe) { return makeLuts(validate(recipe)); }

  function apply(image, recipe, applyOptions) {
    const im = validateImage(image), r = validate(recipe), opt = validateOptions(applyOptions);
    const shouldCancel = opt.shouldCancel;
    checkpoint(shouldCancel, im); // Before even the small LUT allocation.
    if (!active(r)) return image;
    const luts = makeLuts(r);
    checkpoint(shouldCancel, im); // Before allocating the image-sized output.
    const { width, height, data, length } = im, output = new Uint8ClampedArray(length);
    const rows = Math.max(1, Math.min(LIMITS.chunkRows, Math.floor(LIMITS.chunkPixels / width)));
    for (let y = 0; y < height; y += rows) {
      checkpoint(shouldCancel, im);
      const start = y * width * 4, end = Math.min(height, y + rows) * width * 4;
      for (let i = start; i < end; i += 4) {
        const red = data[i], green = data[i + 1], blue = data[i + 2], alpha = data[i + 3];
        output[i] = alpha === 0 ? red : luts.red[red];
        output[i + 1] = alpha === 0 ? green : luts.green[green];
        output[i + 2] = alpha === 0 ? blue : luts.blue[blue];
        output[i + 3] = alpha;
      }
    }
    checkpoint(shouldCancel, im);
    return { width, height, data: output };
  }

  return Object.freeze({ LIMITS, CHANNELS, defaults, validate, isActive, buildLuts, apply });
});
