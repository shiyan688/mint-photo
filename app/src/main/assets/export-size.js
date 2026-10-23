/* MintExportSize: pure final-output downsize planning, without image allocation.
 * Run ProjectCore.planExport first, then pass its post-edit output dimensions.
 * This never relaxes source/intermediate budgets or selects a source basis.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (typeof define === 'function' && define.amd) define([], function () { return api; });
  else root.MintExportSize = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LIMITS = Object.freeze({
    maxEdge: 4096,
    maxPixels: 8000000,
    bytesPerPixel: 4,
    maxPairBytes: 64 * 1024 * 1024
  });
  const RECIPE_KEYS = Object.freeze(['version', 'mode', 'longEdge']);
  const own = Function.call.bind(Object.prototype.hasOwnProperty);

  // Read own data descriptors, never recipe properties or their accessors.
  // A custom prototype, missing own key, extra symbol, or hidden key is invalid.
  function record(value) {
    if (value === null || typeof value !== 'object') {
      throw new TypeError('Export size recipe must be a plain data record');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Export size recipe must not have a custom prototype');
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== RECIPE_KEYS.length) {
      throw new TypeError('Export size recipe must contain only version, mode and longEdge');
    }
    const copy = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !RECIPE_KEYS.includes(key) || !descriptor ||
          !descriptor.enumerable || !own(descriptor, 'value')) {
        throw new TypeError('Export size recipe fields must be supported own enumerable data properties');
      }
      copy[key] = descriptor.value;
    }
    for (const key of RECIPE_KEYS) {
      if (!own(copy, key)) throw new TypeError('Export size recipe is missing ' + key);
    }
    return copy;
  }

  function integer(value, label) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > LIMITS.maxEdge) {
      throw new RangeError(label + ' must be an integer from 1 to ' + LIMITS.maxEdge);
    }
    return value;
  }

  function dimensions(width, height, label) {
    integer(width, label + ' width');
    integer(height, label + ' height');
    if (width * height > LIMITS.maxPixels) {
      throw new RangeError(label + ' exceeds the 8,000,000 pixel export budget');
    }
  }

  function defaults() {
    return { version: 1, mode: 'unchanged', longEdge: null };
  }

  function validate(recipe) {
    const r = record(recipe);
    if (r.version !== 1) throw new RangeError('Unsupported export size recipe version');
    if (r.mode !== 'unchanged' && r.mode !== 'long-edge') {
      throw new TypeError('Export size mode must be unchanged or long-edge');
    }
    if (r.mode === 'unchanged') {
      if (r.longEdge !== null) throw new TypeError('Unchanged export size requires longEdge: null');
    } else {
      integer(r.longEdge, 'Requested long edge');
    }
    return { version: 1, mode: r.mode, longEdge: r.longEdge };
  }

  function allocation(inputWidth, inputHeight, outputWidth, outputHeight, resized) {
    const inputBytes = inputWidth * inputHeight * LIMITS.bytesPerPixel;
    const outputBytes = outputWidth * outputHeight * LIMITS.bytesPerPixel;
    // Always check the conservative two-buffer bound, even for identity. The
    // renderer may reuse input for identity, which is reflected in extraBytes.
    const pairBytes = inputBytes + outputBytes;
    if (pairBytes > LIMITS.maxPairBytes) {
      throw new RangeError('Final resize input plus output exceeds the 64 MiB RGBA8 pair budget');
    }
    const extraBytes = resized ? outputBytes : 0;
    return {
      bytesPerPixel: LIMITS.bytesPerPixel,
      inputBytes,
      outputBytes,
      extraBytes,
      peakBytes: inputBytes + extraBytes,
      pairBytes,
      maxPairBytes: LIMITS.maxPairBytes
    };
  }

  function plan(inputWidth, inputHeight, recipe) {
    // Validate the full processed input first. A tiny final request cannot
    // make an over-budget source/intermediate canvas safe or admissible.
    dimensions(inputWidth, inputHeight, 'Input');
    const r = validate(recipe);
    const inputEdge = Math.max(inputWidth, inputHeight);
    const requestedEdge = r.longEdge;
    if (r.mode === 'long-edge' && requestedEdge > inputEdge) {
      throw new RangeError('Upscaling is not allowed: requested long edge ' + requestedEdge +
        ' exceeds the processed input long edge ' + inputEdge);
    }
    const resized = r.mode === 'long-edge' && requestedEdge < inputEdge;
    let width = inputWidth, height = inputHeight;
    if (resized) {
      const inputShort = Math.min(inputWidth, inputHeight);
      // All operands are small exact integers. This implements positive
      // half-up rounding without a floating-point near-half ambiguity.
      const shortEdge = Math.max(1, Math.floor((2 * inputShort * requestedEdge + inputEdge) / (2 * inputEdge)));
      if (inputWidth >= inputHeight) { width = requestedEdge; height = shortEdge; }
      else { width = shortEdge; height = requestedEdge; }
    }
    dimensions(width, height, 'Output');
    return {
      recipe: r,
      input: { width: inputWidth, height: inputHeight },
      output: { width, height },
      resized,
      requestedEdge,
      // Nominal long-edge ratio; the short edge is separately quantized.
      scale: resized ? requestedEdge / inputEdge : 1,
      allocation: allocation(inputWidth, inputHeight, width, height, resized)
    };
  }

  return Object.freeze({ LIMITS, defaults, validate, plan });
});
