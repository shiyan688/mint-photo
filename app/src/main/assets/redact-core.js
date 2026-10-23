/* MintRedact v1. Pure, bounded RGBA mosaic / opaque-cover rasterizer. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (typeof define === 'function' && define.amd) define([], function () { return api; });
  else root.MintRedact = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LIMITS = Object.freeze({ maxStrokes: 64, maxTotalPoints: 4096,
    maxPixels: 8000000, maxEdge: 4096, minRadius: 0.002, maxRadius: 0.5,
    minBlockSize: 0.01, maxBlockSize: 0.25, maxExtraBytes: 128 * 1024 * 1024,
    maxWorkPixels: 64000000, cancelIntervalPixels: 16384 });
  const RECIPE_KEYS = ['version', 'mode', 'blockSize', 'color', 'strokes'];
  const own = Function.call.bind(Object.prototype.hasOwnProperty);
  const typedProto = Object.getPrototypeOf(Uint8Array.prototype);
  const typedLength = Object.getOwnPropertyDescriptor(typedProto, 'length').get;
  const typedBuffer = Object.getOwnPropertyDescriptor(typedProto, 'buffer').get;
  const typedOffset = Object.getOwnPropertyDescriptor(typedProto, 'byteOffset').get;
  const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
  const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable');
  const typedSet = Uint8ClampedArray.prototype.set;

  function fail(message, kind) {
    const error = kind === 'LIMIT' ? new RangeError(message) : new TypeError(message);
    error.code = 'REDACT_' + (kind || 'INVALID');
    throw error;
  }
  function record(value, keys, required, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + ' must be a plain data record');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(label + ' has an unsafe prototype');
    const names = Reflect.ownKeys(value), out = Object.create(null);
    if (names.length > keys.length) fail(label + ' contains unexpected fields');
    for (const key of names) {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || keys.indexOf(key) < 0 || !d || !d.enumerable || !own(d, 'value')) {
        fail(label + ' contains an unexpected, hidden, or accessor field');
      }
      out[key] = d.value;
    }
    for (const key of required) if (!own(out, key)) fail(label + ' is missing ' + key);
    return out;
  }
  function array(value, maximum, label) {
    if (!Array.isArray(value)) fail(label + ' must be an array');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Array.prototype && prototype !== null) fail(label + ' has an unsafe prototype');
    const d = Object.getOwnPropertyDescriptor(value, 'length');
    if (!d || !own(d, 'value') || !Number.isSafeInteger(d.value) || d.value < 0) fail(label + ' has an invalid length');
    const length = d.value;
    if (length > maximum) fail(label + ' exceeds the point/stroke budget', 'LIMIT');
    const names = Reflect.ownKeys(value);
    if (names.length !== length + 1) fail(label + ' must be dense with no extra fields');
    const out = new Array(length);
    for (const key of names) {
      if (key === 'length') continue;
      const item = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length ||
          String(Number(key)) !== key || !item || !item.enumerable || !own(item, 'value')) {
        fail(label + ' contains a missing, hidden, or accessor item');
      }
      out[Number(key)] = item.value;
    }
    return out;
  }
  function finite(value, min, max, label) {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(label + ' must be a finite number');
    if (value < min || value > max) fail(label + ' is out of range', 'LIMIT');
    return value === 0 ? 0 : value;
  }
  function defaults() {
    return Object.freeze({ version: 1, mode: 'mosaic', blockSize: 0.04,
      color: '#173e31', strokes: Object.freeze([]) });
  }
  function validate(value) {
    const input = record(value, RECIPE_KEYS, RECIPE_KEYS, 'Redaction recipe');
    if (input.version !== 1) fail('Unsupported redaction recipe version');
    if (input.mode !== 'mosaic' && input.mode !== 'cover') fail('Redaction mode must be mosaic or cover');
    const blockSize = finite(input.blockSize, LIMITS.minBlockSize, LIMITS.maxBlockSize, 'Block size');
    if (typeof input.color !== 'string' || input.color.length !== 7 || !/^#[0-9a-fA-F]{6}$/.test(input.color)) fail('Color must be #rrggbb');
    const inputStrokes = array(input.strokes, LIMITS.maxStrokes, 'Strokes');
    let totalPoints = 0;
    const strokes = inputStrokes.map(function (item) {
      const stroke = record(item, ['radius', 'points'], ['radius', 'points'], 'Stroke');
      const radius = finite(stroke.radius, LIMITS.minRadius, LIMITS.maxRadius, 'Stroke radius');
      const inputPoints = array(stroke.points, LIMITS.maxTotalPoints - totalPoints, 'Stroke points');
      if (!inputPoints.length) fail('Every stroke needs at least one point');
      totalPoints += inputPoints.length;
      const points = inputPoints.map(function (item) {
        const point = record(item, ['x', 'y'], ['x', 'y'], 'Point');
        return Object.freeze({ x: finite(point.x, 0, 1, 'Point x'), y: finite(point.y, 0, 1, 'Point y') });
      });
      return Object.freeze({ radius, points: Object.freeze(points) });
    });
    return Object.freeze({ version: 1, mode: input.mode, blockSize, color: input.color.toLowerCase(), strokes: Object.freeze(strokes) });
  }
  function isActive(recipe) { return validate(recipe).strokes.length !== 0; }
  function dimensions(width, height) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
        width > LIMITS.maxEdge || height > LIMITS.maxEdge || width * height > LIMITS.maxPixels) {
      fail('Image dimensions exceed the integer edge or pixel budget', 'LIMIT');
    }
  }
  function prepare(width, height, recipe) {
    dimensions(width, height);
    let totalPoints = 0, segmentCount = 0;
    for (const stroke of recipe.strokes) {
      totalPoints += stroke.points.length;
      segmentCount += Math.max(1, stroke.points.length - 1);
    }
    const active = segmentCount > 0, pixels = width * height;
    const blockEdge = Math.max(1, Math.round(Math.min(width, height) * recipe.blockSize));
    const gridColumns = Math.ceil(width / blockEdge), gridRows = Math.ceil(height / blockEdge);
    const gridCells = gridColumns * gridRows;
    const segmentRows = active ? height * segmentCount : 0;
    const mosaic = recipe.mode === 'mosaic';
    // Units are bounded visits, not wall-clock instructions: copy pixels,
    // mask scan pixels, mosaic sample pixels, and row/segment tests.
    const workPixels = active ? pixels * (mosaic ? 3 : 2) + segmentRows : 0;
    // Conservative accounted buffers + recipe/JS-object allowance. A neutral
    // operation has no RGBA allocation, but validation still makes a snapshot.
    const extraBytes = 2 * 1024 * 1024 + totalPoints * 256 + recipe.strokes.length * 256 +
      (active ? pixels * 4 + (width + 1) * 4 + segmentCount * 20 * 8 + (mosaic ? gridCells * 3 : 0) : 0);
    if (workPixels > LIMITS.maxWorkPixels) fail('Redaction exceeds its work budget', 'LIMIT');
    if (extraBytes > LIMITS.maxExtraBytes) fail('Redaction exceeds its extra-buffer budget', 'LIMIT');
    return Object.freeze({ width, height, pixels, active, mode: recipe.mode, blockEdge,
      gridColumns, gridRows, gridCells, strokeCount: recipe.strokes.length, totalPoints,
      segmentCount, segmentRows, workPixels, extraBytes });
  }
  function plan(width, height, recipe) { return prepare(width, height, validate(recipe)); }
  function options(value) {
    const result = record(value === undefined ? {} : value, ['shouldCancel'], [], 'Options');
    if (own(result, 'shouldCancel') && typeof result.shouldCancel !== 'function') fail('shouldCancel must be a function');
    return own(result, 'shouldCancel') ? result.shouldCancel : null;
  }
  function check(cancel) {
    if (cancel && cancel()) {
      const error = new Error('Redaction cancelled');
      error.name = 'AbortError'; error.code = 'REDACT_CANCELLED'; throw error;
    }
  }
  function source(value) {
    const image = record(value, ['width', 'height', 'data'], ['width', 'height', 'data'], 'Source image');
    dimensions(image.width, image.height);
    const data = image.data, prototype = data && Object.getPrototypeOf(data);
    if (prototype !== Uint8Array.prototype && prototype !== Uint8ClampedArray.prototype) fail('Source data must be a native Uint8Array or Uint8ClampedArray');
    let length, buffer;
    try { length = typedLength.call(data); buffer = typedBuffer.call(data); bufferLength.call(buffer); }
    catch (_) { fail('Source data must have a non-shared, attached ArrayBuffer'); }
    if (Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype || (resizable && resizable.get.call(buffer))) fail('Shared, resizable or subclassed buffers are unsupported');
    if (length !== image.width * image.height * 4) fail('Source RGBA length does not match dimensions');
    return image;
  }
  function segments(width, height, recipe, count) {
    const result = new Float64Array(count * 20), shortEdge = Math.min(width, height);
    let offset = 0;
    for (const stroke of recipe.strokes) {
      for (let i = 0, end = Math.max(1, stroke.points.length - 1); i < end; i++) {
        const a = stroke.points[i], b = stroke.points[Math.min(i + 1, stroke.points.length - 1)];
        const ax = a.x * (width - 1), ay = a.y * (height - 1);
        const bx = b.x * (width - 1), by = b.y * (height - 1), dx = bx - ax, dy = by - ay;
        const nominalRadius = stroke.radius * shortEdge;
        // A fixed, hard numerical fence makes collinear subdivision stable.
        // Its maximum radial expansion at supported limits is < 2e-11 px.
        const radius2 = nominalRadius * nominalRadius + 64 * Number.EPSILON * Math.max(1, nominalRadius * nominalRadius);
        const radius = Math.sqrt(radius2);
        result[offset] = ax; result[offset + 1] = ay; result[offset + 2] = bx; result[offset + 3] = by;
        result[offset + 4] = dx; result[offset + 5] = dy; result[offset + 6] = dx * dx + dy * dy;
        result[offset + 7] = Math.sqrt(result[offset + 6]); result[offset + 8] = radius;
        result[offset + 9] = radius2;
        result[offset + 10] = Math.max(0, Math.ceil(Math.min(ay, by) - radius - 1e-7));
        result[offset + 11] = Math.min(height - 1, Math.floor(Math.max(ay, by) + radius + 1e-7));
        const length = result[offset + 7];
        const nx = length ? -dy / length * radius : 0, ny = length ? dx / length * radius : 0;
        result[offset + 12] = ax + nx; result[offset + 13] = ay + ny;
        result[offset + 14] = bx + nx; result[offset + 15] = by + ny;
        result[offset + 16] = bx - nx; result[offset + 17] = by - ny;
        result[offset + 18] = ax - nx; result[offset + 19] = ay - ny;
        offset += 20;
      }
    }
    return result;
  }
  function inside(x, y, s, o) {
    const ax = s[o], ay = s[o + 1], dx = s[o + 4], dy = s[o + 5], length2 = s[o + 6];
    let t = length2 ? ((x - ax) * dx + (y - ay) * dy) / length2 : 0;
    t = Math.max(0, Math.min(1, t));
    const ex = x - (ax + t * dx), ey = y - (ay + t * dy);
    return ex * ex + ey * ey <= s[o + 9];
  }
  function addInterval(row, width, y, s, o) {
    if (y < s[o + 10] || y > s[o + 11]) return;
    const ax = s[o], ay = s[o + 1], bx = s[o + 2], by = s[o + 3];
    const length2 = s[o + 6], radius2 = s[o + 9];
    let left = Infinity, right = -Infinity;
    // Capsule = endpoint discs union a perpendicular rectangle. The
    // cross-section is convex, hence one closed interval.
    let d = y - ay, extent2 = radius2 - d * d;
    if (extent2 >= 0) {
      const extent = Math.sqrt(Math.max(0, extent2));
      left = ax - extent; right = ax + extent;
    }
    d = y - by; extent2 = radius2 - d * d;
    if (extent2 >= 0) {
      const extent = Math.sqrt(Math.max(0, extent2));
      left = Math.min(left, bx - extent); right = Math.max(right, bx + extent);
    }
    if (length2) {
      // Intersect each bounded rectangle edge instead of dividing by the
      // segment slope: near-horizontal subnormal slopes must not overflow.
      for (let j = 0; j < 4; j++) {
        const a = o + 12 + j * 2, b = o + 12 + ((j + 1) % 4) * 2;
        const y0 = s[a + 1], y1 = s[b + 1];
        if (y < Math.min(y0, y1) || y > Math.max(y0, y1)) continue;
        if (y0 === y1) {
          left = Math.min(left, s[a], s[b]); right = Math.max(right, s[a], s[b]);
        } else {
          const t = Math.max(0, Math.min(1, (y - y0) / (y1 - y0)));
          const x = s[a] + (s[b] - s[a]) * t;
          left = Math.min(left, x); right = Math.max(right, x);
        }
      }
    }
    if (left === Infinity) return;
    let first = Math.max(0, Math.ceil(left - 1e-7)), last = Math.min(width - 1, Math.floor(right + 1e-7));
    // Reject conservative roundoff candidates; no antialias/opacity exists.
    if (first <= last && !inside(first, y, s, o)) first++;
    if (last >= first && !inside(last, y, s, o)) last--;
    if (first <= last) { row[first]++; row[last + 1]--; }
  }
  function mosaicColors(image, p, cancel) {
    const colors = new Uint8Array(p.gridCells * 3), data = image.data;
    let visits = 0;
    for (let cy = 0; cy < p.gridRows; cy++) {
      const y0 = cy * p.blockEdge, y1 = Math.min(p.height, y0 + p.blockEdge);
      for (let cx = 0; cx < p.gridColumns; cx++) {
        const x0 = cx * p.blockEdge, x1 = Math.min(p.width, x0 + p.blockEdge);
        let red = 0, green = 0, blue = 0, alpha = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const i = (y * p.width + x) * 4, a = data[i + 3];
          red += data[i] * a; green += data[i + 1] * a; blue += data[i + 2] * a; alpha += a;
          if (++visits === LIMITS.cancelIntervalPixels) { check(cancel); visits = 0; }
        }
        if (alpha) {
          const i = (cy * p.gridColumns + cx) * 3;
          colors[i] = Math.round(red / alpha); colors[i + 1] = Math.round(green / alpha); colors[i + 2] = Math.round(blue / alpha);
        }
      }
    }
    check(cancel);
    return colors;
  }
  function apply(value, inputRecipe, inputOptions) {
    const recipe = validate(inputRecipe), cancel = options(inputOptions), image = source(value);
    const p = prepare(image.width, image.height, recipe);
    check(cancel);
    if (!p.active) return value;
    const output = new Uint8ClampedArray(p.pixels * 4);
    // Chunk the immutable-source copy for cooperative cancellation too.
    const chunk = LIMITS.cancelIntervalPixels * 4;
    for (let i = 0; i < output.length; i += chunk) {
      check(cancel);
      const length = Math.min(chunk, output.length - i);
      const view = new Uint8Array(typedBuffer.call(image.data), typedOffset.call(image.data) + i, length);
      typedSet.call(output, view, i);
    }
    check(cancel);
    const s = segments(p.width, p.height, recipe, p.segmentCount);
    const row = new Int32Array(p.width + 1);
    const colors = recipe.mode === 'mosaic' ? mosaicColors(image, p, cancel) : null;
    const red = parseInt(recipe.color.slice(1, 3), 16), green = parseInt(recipe.color.slice(3, 5), 16), blue = parseInt(recipe.color.slice(5, 7), 16);
    for (let y = 0; y < p.height; y++) {
      check(cancel); row.fill(0);
      for (let o = 0; o < s.length; o += 20) {
        if (o % (256 * 20) === 0) check(cancel);
        addInterval(row, p.width, y, s, o);
      }
      let covered = 0;
      for (let x = 0; x < p.width; x++) {
        covered += row[x];
        if (!covered) continue;
        const i = (y * p.width + x) * 4;
        if (colors) {
          if (image.data[i + 3] === 0) continue; // Preserve hidden RGB exactly.
          const j = (Math.floor(y / p.blockEdge) * p.gridColumns + Math.floor(x / p.blockEdge)) * 3;
          output[i] = colors[j]; output[i + 1] = colors[j + 1]; output[i + 2] = colors[j + 2];
        } else {
          output[i] = red; output[i + 1] = green; output[i + 2] = blue; output[i + 3] = 255;
        }
      }
    }
    check(cancel);
    return { width: p.width, height: p.height, data: output };
  }
  return Object.freeze({ LIMITS, defaults, validate, isActive, plan, apply });
});
