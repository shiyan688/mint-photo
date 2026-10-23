/* MintPerspective 1.0.0. Pure four-corner RGBA8 rectification. No DOM or I/O.
 * perspective.js and perspective.cjs are intentionally byte-identical. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MintPerspective = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const LIMITS = Object.freeze({ maxEdge: 16384, maxPixels: 64 * 1024 * 1024,
    maxBytes: 512 * 1024 * 1024, maxWorkUnits: 256 * 1024 * 1024 });
  const GEOMETRY = Object.freeze({ minEdge: 1e-6, minCross: 1e-10, minSine: 1e-6,
    minArea: 1e-8, minDenominatorRatio: 1e-6, maxMatrixCondition: 1e8,
    maxJacobianConditionBound: 1e12, roundoff: 256 * Number.EPSILON });
  const own = Function.call.bind(Object.prototype.hasOwnProperty);
  const typedProto = Object.getPrototypeOf(Uint8Array.prototype);
  const typedLength = Object.getOwnPropertyDescriptor(typedProto, 'length').get;
  const typedBuffer = Object.getOwnPropertyDescriptor(typedProto, 'buffer').get;
  const typedTag = Object.getOwnPropertyDescriptor(typedProto, Symbol.toStringTag).get;
  const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
  const resizableDescriptor = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable');
  const bufferResizable = resizableDescriptor && resizableDescriptor.get;
  const issuedPlans = new WeakSet();
  const linear = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    linear[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  function fail(message, kind) {
    const error = kind === 'LIMIT' || kind === 'GEOMETRY' ? new RangeError(message) : new TypeError(message);
    error.code = 'PERSPECTIVE_' + (kind || 'INVALID');
    throw error;
  }
  function record(value, required, optional, label) {
    if (!value || typeof value !== 'object') fail(label + ' must be a plain own-data record');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(label + ' has an unsafe prototype');
    const keys = Reflect.ownKeys(value), allowed = required.concat(optional);
    if (keys.length > allowed.length) fail(label + ' has unsupported fields');
    const snapshot = Object.create(null);
    for (const key of keys) {
      if (typeof key !== 'string' || !allowed.includes(key)) fail(label + ' has unsupported fields or symbols');
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d || !d.enumerable || !own(d, 'value')) fail(label + ' has an accessor or hidden field');
      snapshot[key] = d.value;
    }
    for (const key of required) if (!own(snapshot, key)) fail(label + ' is missing ' + key);
    return snapshot;
  }
  function quadArray(value) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail('quad must be an ordinary dense array');
    const length = Object.getOwnPropertyDescriptor(value, 'length');
    if (!length || length.value !== 4) fail('quad must contain exactly four points');
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 5) fail('quad must contain only four dense entries');
    const result = [];
    for (let i = 0; i < 4; i++) {
      const d = Object.getOwnPropertyDescriptor(value, String(i));
      if (!d || !d.enumerable || !own(d, 'value')) fail('quad cannot have holes, accessors or hidden entries');
      const p = record(d.value, ['x', 'y'], [], 'quad point');
      result.push(Object.freeze({ x: finite(p.x, 0, 1, 'Point x'), y: finite(p.y, 0, 1, 'Point y') }));
    }
    return Object.freeze(result);
  }
  function finite(value, min, max, label) {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(label + ' must be finite');
    if (value < min || value > max) fail(label + ' is out of range', 'LIMIT');
    return value === 0 ? 0 : value;
  }
  function integer(value, min, max, label) {
    finite(value, min, max, label);
    if (!Number.isSafeInteger(value)) fail(label + ' must be an integer', 'LIMIT');
    return value;
  }
  function defaults() {
    return Object.freeze({ version: 1,
      quad: Object.freeze([Object.freeze({ x: 0, y: 0 }), Object.freeze({ x: 1, y: 0 }),
        Object.freeze({ x: 1, y: 1 }), Object.freeze({ x: 0, y: 1 })]),
      outputFraction: Object.freeze({ width: 1, height: 1 }) });
  }
  function convex(q) {
    let area2 = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
      const ex = b.x - a.x, ey = b.y - a.y, fx = c.x - b.x, fy = c.y - b.y;
      const edge = Math.hypot(ex, ey), next = Math.hypot(fx, fy), cross = ex * fy - ey * fx;
      if (!(edge >= GEOMETRY.minEdge && cross > GEOMETRY.minCross && cross / (edge * next) >= GEOMETRY.minSine)) {
        fail('quad must have non-negligible edges and strict positive convex winding', 'GEOMETRY');
      }
      // Triangulate relative to q[0], avoiding cancellation in shoelace sums.
      if (i === 1 || i === 2) area2 += (a.x - q[0].x) * (b.y - q[0].y) - (a.y - q[0].y) * (b.x - q[0].x);
    }
    if (!(area2 / 2 >= GEOMETRY.minArea)) fail('quad area is too small', 'GEOMETRY');
    return area2 / 2;
  }
  function determinant(m) {
    return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  }
  function inverse(m, det) {
    return [m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
      m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
      m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]].map(v => v / det);
  }
  function norm(m) { return Math.max(Math.abs(m[0]) + Math.abs(m[1]) + Math.abs(m[2]),
    Math.abs(m[3]) + Math.abs(m[4]) + Math.abs(m[5]), Math.abs(m[6]) + Math.abs(m[7]) + Math.abs(m[8])); }
  function project(m, x, y) {
    const den = m[6] * x + m[7] * y + m[8];
    return { x: (m[0] * x + m[1] * y + m[2]) / den, y: (m[3] * x + m[4] * y + m[5]) / den };
  }
  function homography(q) {
    const area = convex(q), a = q[0], b = q[1], c = q[2], d = q[3];
    const dx1 = b.x - c.x, dx2 = d.x - c.x, dx3 = (a.x - b.x) + (c.x - d.x);
    const dy1 = b.y - c.y, dy2 = d.y - c.y, dy3 = (a.y - b.y) + (c.y - d.y);
    let g = 0, h = 0;
    if (dx3 !== 0 || dy3 !== 0) {
      const den = dx1 * dy2 - dx2 * dy1;
      g = (dx3 * dy2 - dx2 * dy3) / den;
      h = (dx1 * dy3 - dx3 * dy1) / den;
    }
    const m = [b.x - a.x + g * b.x, d.x - a.x + h * d.x, a.x,
      b.y - a.y + g * b.y, d.y - a.y + h * d.y, a.y, g, h, 1];
    const det = determinant(m), denominators = [1, 1 + g, 1 + g + h, 1 + h];
    const minDen = Math.min(...denominators), maxDen = Math.max(...denominators);
    // The denominator is affine, so its extrema over the complete unit square
    // occur at corners. A strict positive lower bound excludes poles everywhere.
    if (!m.every(Number.isFinite) || !Number.isFinite(det) || !(det > 0) ||
        !(minDen > 0 && minDen / maxDen >= GEOMETRY.minDenominatorRatio)) {
      fail('Homography has a singular, folded or poorly separated denominator', 'GEOMETRY');
    }
    const inv = inverse(m, det), condition = norm(m) * norm(inv);
    if (!inv.every(Number.isFinite) || !(condition <= GEOMETRY.maxMatrixCondition)) fail('Homography is ill-conditioned', 'GEOMETRY');
    // Each derivative numerator is affine in one variable. Its absolute maximum
    // is at an endpoint; divide by the global denominator lower bound squared.
    const numerators = [Math.max(Math.abs(m[0] - g * m[2]), Math.abs(m[0] - g * m[2] + m[0] * h - g * m[1])),
      Math.max(Math.abs(m[1] - h * m[2]), Math.abs(m[1] - h * m[2] + m[1] * g - h * m[0])),
      Math.max(Math.abs(m[3] - g * m[5]), Math.abs(m[3] - g * m[5] + m[3] * h - g * m[4])),
      Math.max(Math.abs(m[4] - h * m[5]), Math.abs(m[4] - h * m[5] + m[4] * g - h * m[3]))];
    const derivativeBounds = numerators.map(v => v / (minDen * minDen));
    const minJacobian = det / (maxDen * maxDen * maxDen), maxJacobian = det / (minDen * minDen * minDen);
    const jacobianConditionBound = derivativeBounds.reduce((s, v) => s + v * v, 0) / minJacobian;
    if (!derivativeBounds.every(Number.isFinite) || !Number.isFinite(maxJacobian) || !(minJacobian > 0) ||
        !(jacobianConditionBound <= GEOMETRY.maxJacobianConditionBound)) fail('Homography Jacobian is ill-conditioned', 'GEOMETRY');
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]], eps = GEOMETRY.roundoff * Math.max(1, condition);
    // Independently verify both correspondence directions before issuing a plan.
    for (let i = 0; i < 4; i++) {
      const p = project(m, corners[i][0], corners[i][1]), r = project(inv, q[i].x, q[i].y);
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(r.x) || !Number.isFinite(r.y) ||
          Math.max(Math.abs(p.x - q[i].x), Math.abs(p.y - q[i].y), Math.abs(r.x - corners[i][0]), Math.abs(r.y - corners[i][1])) > eps) {
        fail('Homography corner reprojection is unstable', 'GEOMETRY');
      }
    }
    return { matrix: Object.freeze(m), inverse: Object.freeze(inv), geometry: Object.freeze({ area, minDenominator: minDen,
      maxDenominator: maxDen, matrixCondition: condition, minJacobian, maxJacobian, jacobianConditionBound }) };
  }
  function validate(value) {
    if (value === undefined || value === null) return defaults();
    const r = record(value, ['version', 'quad', 'outputFraction'], [], 'Perspective recipe');
    if (r.version !== 1) fail('Unsupported perspective version');
    const q = quadArray(r.quad), f = record(r.outputFraction, ['width', 'height'], [], 'outputFraction');
    const width = finite(f.width, 0, 1, 'outputFraction.width'), height = finite(f.height, 0, 1, 'outputFraction.height');
    if (!(width > 0 && height > 0)) fail('Output fractions must be greater than zero', 'LIMIT');
    homography(q);
    return Object.freeze({ version: 1, quad: q, outputFraction: Object.freeze({ width, height }) });
  }
  function neutral(r) {
    return r.outputFraction.width === 1 && r.outputFraction.height === 1 &&
      r.quad.every((p, i) => p.x === [0, 1, 1, 0][i] && p.y === [0, 0, 1, 1][i]);
  }
  function isActive(value) { return !neutral(validate(value)); }
  function options(value) {
    const o = record(value == null ? {} : value, [], ['maxSide', 'shouldCancel', 'limits'], 'Perspective options');
    const limits = { ...LIMITS };
    if (own(o, 'limits')) {
      const v = record(o.limits, [], Object.keys(LIMITS), 'limits');
      for (const k of Object.keys(v)) limits[k] = integer(v[k], 1, LIMITS[k], 'limits.' + k);
    }
    if (own(o, 'maxSide')) integer(o.maxSide, 1, LIMITS.maxEdge, 'maxSide');
    if (own(o, 'shouldCancel') && typeof o.shouldCancel !== 'function') fail('shouldCancel must be a function');
    return { maxSide: own(o, 'maxSide') ? o.maxSide : LIMITS.maxEdge,
      shouldCancel: own(o, 'shouldCancel') ? o.shouldCancel : null, limits: Object.freeze(limits) };
  }
  function dimensions(width, height, limits, label) {
    integer(width, 1, limits.maxEdge, label + ' width'); integer(height, 1, limits.maxEdge, label + ' height');
    if (width * height > limits.maxPixels) fail(label + ' exceeds the pixel budget', 'LIMIT');
  }
  function exactCrop(q, width, height, ow, oh) {
    if (q[0].x !== q[3].x || q[1].x !== q[2].x || q[0].y !== q[1].y || q[3].y !== q[2].y) return null;
    const left = q[0].x * width, top = q[0].y * height, right = q[1].x * width, bottom = q[3].y * height;
    if (![left, top, right, bottom].every(Number.isSafeInteger) || right - left !== ow || bottom - top !== oh) return null;
    return Object.freeze({ x: left, y: top, width: ow, height: oh });
  }
  function preparePlan(width, height, value, o) {
    dimensions(width, height, o.limits, 'Source');
    const recipe = validate(value), h = homography(recipe.quad);
    const dw = Math.max(1, Math.round(width * recipe.outputFraction.width));
    const dh = Math.max(1, Math.round(height * recipe.outputFraction.height));
    dimensions(dw, dh, o.limits, 'Declared output');
    const scale = Math.min(1, o.maxSide / Math.max(dw, dh));
    const ow = Math.max(1, Math.round(dw * scale)), oh = Math.max(1, Math.round(dh * scale));
    dimensions(ow, oh, o.limits, 'Rendered output');
    const identity = neutral(recipe) && ow === width && oh === height;
    const copyRect = identity ? null : exactCrop(recipe.quad, width, height, ow, oh);
    const kind = identity ? 'identity' : copyRect ? 'copy' : 'resample';
    const sourcePixels = width * height, declaredOutputPixels = dw * dh, outputPixels = ow * oh;
    const sourceBytes = sourcePixels * 4, outputBytes = identity ? 0 : outputPixels * 4;
    const workUnits = identity ? 0 : outputPixels * (copyRect ? 1 : 4), totalRgbaBytes = sourceBytes + outputBytes;
    if (totalRgbaBytes > o.limits.maxBytes || workUnits > o.limits.maxWorkUnits) fail('Perspective memory or work budget exceeded', 'LIMIT');
    const p = Object.freeze({ version: 1, recipe, sourceSize: Object.freeze({ width, height }),
      outputSize: Object.freeze({ width: dw, height: dh }), renderedSize: Object.freeze({ width: ow, height: oh }),
      workUnits, estimatedBytes: totalRgbaBytes,
      renderScale: Object.freeze({ x: ow / dw, y: oh / dh }), kind, copyRect,
      outputToSourceMatrixNormalized: h.matrix, sourceToOutputMatrixNormalized: h.inverse, geometry: h.geometry, limits: o.limits,
      estimates: Object.freeze({ sourcePixels, declaredOutputPixels, outputPixels, sourceBytes, outputBytes,
        totalRgbaBytes, extraBytes: outputBytes + linear.byteLength, staticTableBytes: linear.byteLength,
        workUnits, bilinearTaps: kind === 'resample' ? 4 * outputPixels : 0 }) });
    issuedPlans.add(p); return p;
  }
  function plan(width, height, value, opts) { return preparePlan(width, height, value, options(opts)); }
  function source(value, limits) {
    const im = record(value, ['width', 'height', 'data'], [], 'Image');
    dimensions(im.width, im.height, limits, 'Source');
    const d = im.data;
    if (!ArrayBuffer.isView(d) || (Object.getPrototypeOf(d) !== Uint8Array.prototype && Object.getPrototypeOf(d) !== Uint8ClampedArray.prototype)) {
      fail('RGBA data must be a same-realm native byte typed array');
    }
    for (const k of ['length', 'buffer', 'byteLength', 'byteOffset']) if (own(d, k)) fail('Typed-array metadata cannot be overridden');
    if (Object.getOwnPropertySymbols(d).length) fail('Typed-array symbols cannot be overridden');
    let length, buffer, bytes, tag, resizable;
    try {
      tag = typedTag.call(d); length = typedLength.call(d); buffer = typedBuffer.call(d);
      bytes = bufferLength.call(buffer); resizable = bufferResizable ? bufferResizable.call(buffer) : false;
    } catch (_) { fail('RGBA data requires genuine attached non-shared ArrayBuffer backing'); }
    if ((tag !== 'Uint8Array' && tag !== 'Uint8ClampedArray') || Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype || resizable) {
      fail('Foreign, shared, resizable, subclassed or non-byte backing is unsupported');
    }
    if (length !== im.width * im.height * 4) fail('RGBA data must contain exactly width * height * 4 bytes');
    return { width: im.width, height: im.height, data: d, length, retainedBytes: bytes };
  }
  function check(cancel, im) {
    if (cancel && cancel()) {
      const error = new Error('Perspective operation cancelled'); error.name = 'AbortError'; error.code = 'PERSPECTIVE_CANCELLED'; throw error;
    }
    if (typedLength.call(im.data) !== im.length) fail('Source was detached during operation');
  }
  function encode(v) { return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); }
  function apply(value, recipe, opts) {
    const o = options(opts), im = source(value, o.limits), p = preparePlan(im.width, im.height, recipe, o);
    // Count the complete backing buffer, including unused retained subview bytes.
    if (im.retainedBytes + p.estimates.outputBytes > o.limits.maxBytes) fail('Retained source and output exceed the memory budget', 'LIMIT');
    check(o.shouldCancel, im);
    if (p.kind === 'identity') return value;
    const w = p.renderedSize.width, h = p.renderedSize.height, out = new Uint8ClampedArray(w * h * 4), data = im.data;
    const m = p.outputToSourceMatrixNormalized;
    for (let y = 0; y < h; y++) {
      check(o.shouldCancel, im);
      const v = (y + 0.5) / h;
      for (let x = 0; x < w; x++) {
        if (x && x % 1024 === 0) check(o.shouldCancel, im);
        const target = (y * w + x) * 4;
        if (p.kind === 'copy') {
          const from = ((y + p.copyRect.y) * im.width + x + p.copyRect.x) * 4;
          out[target] = data[from]; out[target + 1] = data[from + 1]; out[target + 2] = data[from + 2]; out[target + 3] = data[from + 3];
          continue;
        }
        const u = (x + 0.5) / w, den = m[6] * u + m[7] * v + 1;
        const nx = (m[0] * u + m[1] * v + m[2]) / den;
        const ny = (m[3] * u + m[4] * v + m[5]) / den;
        if (!Number.isFinite(nx) || !Number.isFinite(ny) || nx < -GEOMETRY.roundoff || ny < -GEOMETRY.roundoff ||
            nx > 1 + GEOMETRY.roundoff || ny > 1 + GEOMETRY.roundoff) fail('Mapped raster escapes the source domain', 'GEOMETRY');
        // Pixel EDGE -> pixel CENTER. Repeat the outer source pixel only where
        // its half-pixel support legitimately reaches the source image edge.
        const sx = Math.max(0, Math.min(im.width - 1, nx * im.width - 0.5));
        const sy = Math.max(0, Math.min(im.height - 1, ny * im.height - 0.5));
        const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
        let alpha = 0, red = 0, green = 0, blue = 0;
        for (let by = 0; by < 2; by++) {
          const yy = Math.min(im.height - 1, iy + by), wy = by ? fy : 1 - fy;
          for (let bx = 0; bx < 2; bx++) {
            const xx = Math.min(im.width - 1, ix + bx), weight = wy * (bx ? fx : 1 - fx);
            const from = (yy * im.width + xx) * 4, a = weight * data[from + 3];
            if (!a) continue;
            alpha += a; red += a * linear[data[from]]; green += a * linear[data[from + 1]]; blue += a * linear[data[from + 2]];
          }
        }
        const a = Math.round(alpha);
        if (a) { out[target] = encode(red / alpha); out[target + 1] = encode(green / alpha); out[target + 2] = encode(blue / alpha); out[target + 3] = a; }
      }
    }
    check(o.shouldCancel, im);
    return { width: w, height: h, data: out };
  }
  function mapEdgePoint(p, value, direction) {
    if (!issuedPlans.has(p) || (direction !== 'sourceToOutput' && direction !== 'outputToSource')) return null;
    let v;
    try { v = record(value, ['x', 'y'], [], 'Point'); } catch (_) { return null; }
    if (typeof v.x !== 'number' || typeof v.y !== 'number' || !Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
    const forward = direction === 'sourceToOutput', from = forward ? p.sourceSize : p.renderedSize, to = forward ? p.renderedSize : p.sourceSize;
    if (v.x < 0 || v.y < 0 || v.x > from.width || v.y > from.height) return null;
    const nx = v.x / from.width, ny = v.y / from.height;
    if (forward) {
      // Membership is checked in SOURCE space before inversion. Inverse-matrix
      // conditioning must never inflate the accepted source region. Only a fixed
      // 256-epsilon normalized perpendicular-distance allowance covers roundoff
      // on mathematically on-edge points returned by the opposite mapping.
      for (let i = 0; i < 4; i++) {
        const a = p.recipe.quad[i], b = p.recipe.quad[(i + 1) % 4];
        const ex = b.x - a.x, ey = b.y - a.y;
        if ((ex * (ny - a.y) - ey * (nx - a.x)) / Math.hypot(ex, ey) < -GEOMETRY.roundoff) return null;
      }
    }
    const q = project(forward ? p.sourceToOutputMatrixNormalized : p.outputToSourceMatrixNormalized, nx, ny);
    const eps = GEOMETRY.roundoff * Math.max(1, p.geometry.matrixCondition);
    if (!Number.isFinite(q.x) || !Number.isFinite(q.y) || q.x < -eps || q.y < -eps || q.x > 1 + eps || q.y > 1 + eps) return null;
    return { x: Math.max(0, Math.min(1, q.x)) * to.width, y: Math.max(0, Math.min(1, q.y)) * to.height };
  }
  return Object.freeze({ version: '1.0.0', LIMITS, GEOMETRY, defaults, validate, isActive, plan, apply, mapEdgePoint });
});
