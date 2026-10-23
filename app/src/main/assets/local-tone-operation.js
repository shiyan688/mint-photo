/* Strict, source-bound mobile history adapter for the unchanged desktop math.
 * Selection recipes are version 1 snapshots, never references to the live mask.
 * Cancellation is synchronous and checked at layer boundaries, not mid-pixel-loop.
 */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MintLocalToneOperation = api;
})(typeof globalThis === 'object' ? globalThis : this, function (root) {
  'use strict';
  const LIMITS = Object.freeze({ layers: 8, pixels: 16777216, edge: 16384,
    selectionCommands: 128, selectionPoints: 4096 });
  const ADJUSTMENTS = ['exposure', 'contrast', 'saturation', 'temperature'];
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  function check(ok, message, code = 'LOCAL_TONE_INVALID') {
    if (!ok) { const error = new TypeError(message); error.code = code; throw error; }
  }
  function dependency(name, file, methods) {
    let value;
    if (typeof module === 'object' && module.exports) value = require('./' + file + '.js');
    else value = root[name];
    check(value && methods.every(key => typeof value[key] === 'function'),
      'Local adjustment dependency is unavailable: ' + name, 'LOCAL_TONE_MODULE_UNAVAILABLE');
    return value;
  }
  // Descriptor values are copied before reading any user-controlled property.
  // In particular the shared desktop validator must never see an unchecked mask.kind.
  function record(value, keys, label, required = keys) {
    check(value !== null && typeof value === 'object' && !Array.isArray(value), 'Invalid ' + label);
    const proto = Object.getPrototypeOf(value);
    check(proto === Object.prototype || proto === null, 'Invalid ' + label + ' prototype');
    const result = Object.create(null), names = Reflect.ownKeys(value);
    check(names.length <= keys.length, 'Unexpected ' + label + ' fields');
    for (const key of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      check(typeof key === 'string' && keys.includes(key) && descriptor && descriptor.enumerable &&
        own(descriptor, 'value'), 'Unexpected or accessor ' + label + ' field');
      result[key] = descriptor.value;
    }
    for (const key of required) check(own(result, key), 'Missing ' + label + ' field');
    return result;
  }
  function array(value, max, label) {
    check(Array.isArray(value), 'Invalid ' + label);
    const proto = Object.getPrototypeOf(value);
    check(proto === Array.prototype || proto === null, 'Invalid ' + label + ' prototype');
    const length = Object.getOwnPropertyDescriptor(value, 'length');
    check(length && own(length, 'value') && Number.isSafeInteger(length.value) &&
      length.value >= 0 && length.value <= max, 'Invalid ' + label + ' count');
    check(Reflect.ownKeys(value).length === length.value + 1, 'Unexpected or sparse ' + label + ' fields');
    const result = [];
    for (let i = 0; i < length.value; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      check(descriptor && descriptor.enumerable && own(descriptor, 'value'), 'Invalid or accessor ' + label + ' item');
      result.push(descriptor.value);
    }
    return result;
  }
  function revision(value) {
    check(typeof value === 'string' && value.length > 0 && value.length <= 160 &&
      !/[\u0000-\u001f\u007f]/.test(value), 'Invalid local adjustment source revision');
    return value;
  }
  function discriminant(value, label) {
    check(value !== null && typeof value === 'object' && !Array.isArray(value), 'Invalid ' + label);
    const descriptor = Object.getOwnPropertyDescriptor(value, 'kind');
    check(descriptor && descriptor.enumerable && own(descriptor, 'value'), 'Missing or accessor ' + label + ' kind');
    return descriptor.value;
  }
  function selectionSnapshot(value, counters) {
    // Explicit null is not a local-layer selection: it would mean unrestricted.
    const result = record(value, ['version', 'sourceRevision', 'base', 'inverted', 'feather', 'commands'], 'selection');
    const commands = array(result.commands, LIMITS.selectionCommands, 'selection commands');
    counters.commands += commands.length;
    check(counters.commands <= LIMITS.selectionCommands, 'Too many aggregate selection commands');
    result.commands = commands.map(command => {
      const kind = discriminant(command, 'selection command');
      check(kind === 'brush' || kind === 'lasso', 'Unknown selection command kind');
      const out = record(command, kind === 'brush' ? ['kind', 'mode', 'radius', 'points'] :
        ['kind', 'mode', 'points'], 'selection command');
      const points = array(out.points, LIMITS.selectionPoints, 'selection points');
      counters.points += points.length;
      check(counters.points <= LIMITS.selectionPoints, 'Too many aggregate selection points');
      out.points = points.map(point => record(point, ['x', 'y'], 'selection point'));
      return out;
    });
    return result;
  }
  function maskSnapshot(value, counters) {
    const kind = discriminant(value, 'local mask');
    if (kind === 'radial') return record(value, ['kind', 'cx', 'cy', 'rx', 'ry', 'feather'], 'radial mask');
    if (kind === 'linear') return record(value, ['kind', 'x0', 'y0', 'x1', 'y1', 'reverse'], 'linear mask');
    check(kind === 'selection', 'Unknown local mask kind');
    const result = record(value, ['kind', 'selection'], 'selection mask');
    result.selection = selectionSnapshot(result.selection, counters);
    return result;
  }
  function safeSharedPrototype() {
    // The unchanged shared validators construct a few dictionaries with {}.
    // Reject polluted assignment targets rather than invoking a global setter.
    for (const key of [...ADJUSTMENTS, 'radius', 'points'])
      check(!Object.getOwnPropertyDescriptor(Object.prototype, key), 'Unsafe shared local adjustment prototype');
  }
  function validate(operation) {
    const op = record(operation, ['type', 'sourceRevision', 'layers'], 'local tone operation');
    check(op.type === 'local-tone', 'Invalid local tone operation type');
    const sourceRevision = revision(op.sourceRevision), counters = { commands: 0, points: 0 };
    const layers = array(op.layers, LIMITS.layers, 'local layers').map(value => {
      const layer = record(value, ['id', 'name', 'enabled', 'opacity', 'sourceRevision', 'adjustments', 'mask'], 'local layer');
      layer.adjustments = record(layer.adjustments, ADJUSTMENTS, 'local adjustments');
      layer.mask = maskSnapshot(layer.mask, counters);
      return layer;
    });
    const local = dependency('MintLocalAdjustments', 'local-adjustments', ['validateLayers', 'apply']);
    if (layers.some(layer => layer.mask.kind === 'selection'))
      dependency('MintManualTools', 'manual-tools', ['validateSelection', 'rasterizeSelection']);
    // All records/arrays are now fresh own data. Reuse shared semantics and math.
    safeSharedPrototype();
    return { type: 'local-tone', sourceRevision,
      layers: local.validateLayers(layers, { sourceRevision }) };
  }
  function changed(operation) {
    // This is history/metadata change, NOT a promise of nonzero pixel effect.
    // Keep deliberately created neutral, disabled, or empty-mask layers editable.
    return validate(operation).layers.length > 0;
  }
  function imageSnapshot(value) {
    const image = record(value, ['width', 'height', 'data'], 'local adjustment image');
    const { width, height, data } = image;
    check(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 &&
      width <= LIMITS.edge && height <= LIMITS.edge && width * height <= LIMITS.pixels,
    'Invalid or oversized local adjustment image dimensions');
    check(ArrayBuffer.isView(data), 'Invalid RGBA image data');
    const proto = Object.getPrototypeOf(data);
    check(proto === Uint8Array.prototype || proto === Uint8ClampedArray.prototype, 'Invalid RGBA image data prototype');
    // Native getters avoid own length/buffer/iterator accessors on a typed array.
    const typed = Object.getPrototypeOf(Uint8Array.prototype);
    const get = key => Object.getOwnPropertyDescriptor(typed, key).get.call(data);
    const buffer = get('buffer');
    check(buffer instanceof ArrayBuffer, 'Shared RGBA image storage is not supported');
    const bytes = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get.call(buffer);
    check(bytes > 0, 'Detached or empty RGBA image storage');
    const length = get('length');
    check(length === width * height * 4, 'Invalid RGBA image data length');
    const Constructor = proto === Uint8ClampedArray.prototype ? Uint8ClampedArray : Uint8Array;
    return { width, height, data: new Constructor(buffer, get('byteOffset'), length) };
  }
  function cancellation(options, sourceRevision) {
    const normalized = record(options, ['sourceRevision', 'shouldCancel'], 'local adjustment options', []);
    if (own(normalized, 'sourceRevision'))
      check(revision(normalized.sourceRevision) === sourceRevision, 'Local adjustment belongs to another source revision');
    if (own(normalized, 'shouldCancel'))
      check(typeof normalized.shouldCancel === 'function', 'Invalid local adjustment cancellation callback');
    const callback = own(normalized, 'shouldCancel') ? normalized.shouldCancel : null;
    return () => {
      if (callback && callback()) {
        const error = new Error('Local adjustment rendering cancelled');
        error.name = 'AbortError'; error.code = 'LOCAL_TONE_CANCELLED'; throw error;
      }
    };
  }
  function hasPixelEffect(layer) {
    if (!layer.enabled || layer.opacity === 0 || !ADJUSTMENTS.some(key => layer.adjustments[key] !== 0)) return false;
    if (layer.mask.kind === 'selection') {
      const s = layer.mask.selection;
      if (s.commands.length === 0 && ((s.base === 'none' && !s.inverted) || (s.base === 'all' && s.inverted))) return false;
    }
    // Complex recipes that rasterize empty are handled exactly by shared apply.
    return true;
  }
  function apply(image, operation, options = {}) {
    let out = imageSnapshot(image);
    const op = validate(operation), cancelled = cancellation(options, op.sourceRevision);
    const local = dependency('MintLocalAdjustments', 'local-adjustments', ['validateLayers', 'apply']);
    const context = { sourceRevision: op.sourceRevision };
    cancelled();
    for (const layer of op.layers) {
      if (hasPixelEffect(layer)) { safeSharedPrototype(); out = local.apply(out, [layer], context); }
      // No partial result escapes if cancellation or a later layer fails.
      cancelled();
    }
    cancelled();
    return out;
  }
  return Object.freeze({ LIMITS, validate, changed, apply });
});
