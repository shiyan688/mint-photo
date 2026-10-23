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
  const MAX_ANISOTROPY_SAMPLES = 16;
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
    return { matrix: Object.freeze(m), inverse: Object.freeze(inv), derivativeBounds, geometry: Object.freeze({ area, minDenominator: minDen,
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
    const db = h.derivativeBounds;
    const maxFootprintBound = kind === 'resample' ? maxSingular(db[0] * width / ow, db[1] * width / oh,
      db[2] * height / ow, db[3] * height / oh) : 1;
    if (!Number.isFinite(maxFootprintBound)) fail('Nonfinite sampling footprint', 'GEOMETRY');
    const pixelJacobianScale = width * height / (ow * oh);
    const minPixelJacobian = h.geometry.minJacobian * pixelJacobianScale;
    const derivativePixelBounds = [db[0] * width / ow, db[1] * width / oh, db[2] * height / ow, db[3] * height / oh];
    // sigma_min <= every row/column norm and sqrt(det J). The absolute
    // derivative bound matrix bounds each of these throughout the whole square.
    const minorFootprintBound = kind !== 'resample' ? 1 : Math.min(Math.sqrt(h.geometry.maxJacobian * pixelJacobianScale),
      Math.hypot(derivativePixelBounds[0], derivativePixelBounds[1]), Math.hypot(derivativePixelBounds[2], derivativePixelBounds[3]),
      Math.hypot(derivativePixelBounds[0], derivativePixelBounds[2]), Math.hypot(derivativePixelBounds[1], derivativePixelBounds[3]));
    const baseFootprintBound = Math.max(1, minorFootprintBound, maxFootprintBound / MAX_ANISOTROPY_SAMPLES);
    const anisotropyBound = maxFootprintBound * maxFootprintBound / minPixelJacobian;
    const sampleCountBound = kind !== 'resample' ? 1 : boundedSamples(Math.min(maxFootprintBound, anisotropyBound));
    const targetLevel = baseFootprintBound <= 1 + GEOMETRY.roundoff ? 0 : Math.max(0, Math.ceil(Math.log2(baseFootprintBound)));
    const mipLevels = []; let mw = width, mh = height, mipBytes = 0, mipPixels = 0;
    for (let level = 1; level <= targetLevel && (mw > 1 || mh > 1); level++) {
      mw = Math.ceil(mw / 2); mh = Math.ceil(mh / 2);
      const pixels = mw * mh, bytes = pixels * 16;
      mipPixels += pixels; mipBytes += bytes;
      mipLevels.push(Object.freeze({ level, width: mw, height: mh, scale: Math.pow(2, level), pixels, bytes }));
    }
    const tapsPerSample = mipLevels.length ? 8 : 4;
    const sampleTaps = kind !== 'resample' ? 0 : tapsPerSample * sampleCountBound;
    const mipWorkUnits = mipPixels * 4, sampleWorkUnits = identity ? 0 : outputPixels * (copyRect ? 1 : sampleTaps);
    const workUnits = mipWorkUnits + sampleWorkUnits, totalRgbaBytes = sourceBytes + outputBytes;
    const estimatedBytes = totalRgbaBytes + mipBytes;
    if (estimatedBytes > o.limits.maxBytes || workUnits > o.limits.maxWorkUnits) fail('Perspective memory or work budget exceeded', 'LIMIT');
    const p = Object.freeze({ version: 1, recipe, sourceSize: Object.freeze({ width, height }),
      outputSize: Object.freeze({ width: dw, height: dh }), renderedSize: Object.freeze({ width: ow, height: oh }),
      workUnits, estimatedBytes, mipBytes, mipLevels: Object.freeze(mipLevels),
      sampling: Object.freeze({ filter: 'linear-premultiplied-anisotropic-mipmap', maxSamples: MAX_ANISOTROPY_SAMPLES,
        sampleCountBound, tapsPerSample, majorFootprintBound: maxFootprintBound, minorFootprintBound, baseFootprintBound, anisotropyBound, maySoftenMinorAxis: anisotropyBound > MAX_ANISOTROPY_SAMPLES && maxFootprintBound > MAX_ANISOTROPY_SAMPLES }),
      renderScale: Object.freeze({ x: ow / dw, y: oh / dh }), kind, copyRect,
      outputToSourceMatrixNormalized: h.matrix, sourceToOutputMatrixNormalized: h.inverse, geometry: h.geometry, limits: o.limits,
      estimates: Object.freeze({ sourcePixels, declaredOutputPixels, outputPixels, sourceBytes, outputBytes,
        totalRgbaBytes, mipBytes, mipPixels, totalBytes: estimatedBytes, extraBytes: outputBytes + mipBytes + linear.byteLength,
        staticTableBytes: linear.byteLength, workUnits, mipWorkUnits, sampleWorkUnits,
        maxFootprintBound, sampleCountBound, tapsPerSample, bilinearTaps: kind === 'resample' ? sampleTaps * outputPixels : 0 }) });
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
  // Largest singular value of the inverse-map pixel-space Jacobian. Using
  // it with the determinant supplies a stable singular-value pair; the plan
  // uses a rigorous elementwise derivative upper-bound matrix.
  function maxSingular(a, b, c, d) {
    const aa = a * a + c * c, bb = b * b + d * d, ab = a * b + c * d;
    return Math.sqrt((aa + bb + Math.hypot(aa - bb, 2 * ab)) / 2);
  }
  function boundedSamples(ratio) {
    return Math.max(1, Math.min(MAX_ANISOTROPY_SAMPLES, Math.ceil(ratio - GEOMETRY.roundoff * Math.max(1, ratio))));
  }
  function buildMips(im, p, cancel) {
    const levels = [{ width: im.width, height: im.height, scale: 1, data: im.data, premultiplied: false }];
    for (const descriptor of p.mipLevels) {
      check(cancel, im);
      const previous = levels[levels.length - 1], data = new Float32Array(descriptor.pixels * 4);
      const width = descriptor.width, height = descriptor.height;
      for (let y = 0; y < height; y++) {
        check(cancel, im);
        for (let x = 0; x < width; x++) {
          if (x && x % 1024 === 0) check(cancel, im);
          const to = (y * width + x) * 4;
          let r = 0, g = 0, b = 0, a = 0;
          for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
            const xx = Math.min(previous.width - 1, 2 * x + bx), yy = Math.min(previous.height - 1, 2 * y + by);
            const at = (yy * previous.width + xx) * 4, alpha = previous.data[at + 3];
            a += alpha;
            if (previous.premultiplied) { r += previous.data[at]; g += previous.data[at + 1]; b += previous.data[at + 2]; }
            else if (alpha) { r += alpha * linear[previous.data[at]]; g += alpha * linear[previous.data[at + 1]]; b += alpha * linear[previous.data[at + 2]]; }
          }
          data[to] = r / 4; data[to + 1] = g / 4; data[to + 2] = b / 4; data[to + 3] = a / 4;
        }
      }
      levels.push({ width, height, scale: descriptor.scale, data, premultiplied: true });
      check(cancel, im);
    }
    return levels;
  }
  function accumulate(level, sourceX, sourceY, blend, sum) {
    // Each level has a fixed 2^level source-edge scale, even for odd dimensions.
    // Repeating the last source cell extends its legitimate boundary support;
    // renormalizing odd mip widths would instead introduce a spatial drift.
    const sx = Math.max(0, Math.min(level.width - 1, sourceX / level.scale - 0.5));
    const sy = Math.max(0, Math.min(level.height - 1, sourceY / level.scale - 0.5));
    const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy, data = level.data;
    for (let by = 0; by < 2; by++) {
      const yy = Math.min(level.height - 1, iy + by), wy = (by ? fy : 1 - fy) * blend;
      for (let bx = 0; bx < 2; bx++) {
        const xx = Math.min(level.width - 1, ix + bx), weight = wy * (bx ? fx : 1 - fx);
        const from = (yy * level.width + xx) * 4, alpha = data[from + 3];
        if (!weight || !alpha) continue;
        const a = weight * alpha; sum[3] += a;
        if (level.premultiplied) { sum[0] += weight * data[from]; sum[1] += weight * data[from + 1]; sum[2] += weight * data[from + 2]; }
        else { sum[0] += a * linear[data[from]]; sum[1] += a * linear[data[from + 1]]; sum[2] += a * linear[data[from + 2]]; }
      }
    }
  }
  function apply(value, recipe, opts) {
    const o = options(opts), im = source(value, o.limits), p = preparePlan(im.width, im.height, recipe, o);
    // Count all retained Float32 mip levels as well as the complete source
    // backing store. Every numeric/resource check precedes allocation/callbacks.
    if (im.retainedBytes + p.estimates.outputBytes + p.mipBytes > o.limits.maxBytes) fail('Retained source, mip pyramid and output exceed the memory budget', 'LIMIT');
    check(o.shouldCancel, im);
    if (p.kind === 'identity') return value;
    const levels = buildMips(im, p, o.shouldCancel), lastLevel = levels.length - 1;
    check(o.shouldCancel, im);
    const w = p.renderedSize.width, h = p.renderedSize.height, out = new Uint8ClampedArray(w * h * 4), data = im.data;
    const m = p.outputToSourceMatrixNormalized, sum = [0, 0, 0, 0];
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
        const j00 = (m[0] - m[6] * nx) / den * im.width / w;
        const j01 = (m[1] - m[7] * nx) / den * im.width / h;
        const j10 = (m[3] - m[6] * ny) / den * im.height / w;
        const j11 = (m[4] - m[7] * ny) / den * im.height / h;
        const major = maxSingular(j00, j01, j10, j11);
        const minor = (j00 * j11 - j01 * j10) / major;
        if (!Number.isFinite(major) || !Number.isFinite(minor) || !(major > 0 && minor > 0)) fail('Nonfinite raster footprint', 'GEOMETRY');
        // Capped anisotropy: preserve the minor axis when possible; only ratios
        // above 16 increase the base LOD and intentionally soften that axis.
        const base = Math.max(1, minor, major / MAX_ANISOTROPY_SAMPLES);
        const count = boundedSamples(major / base);
        if (count > p.sampling.sampleCountBound) fail('Raster work escaped the certified sampling bound', 'GEOMETRY');
        const lod = base > 1 + GEOMETRY.roundoff ? Math.min(lastLevel, Math.log2(base)) : 0;
        const low = Math.floor(lod), blend = lod - low, sourceX = nx * im.width, sourceY = ny * im.height;
        let directionX = 0, directionY = 0;
        if (count > 1) {
          // Principal eigenvector of J*J^T is the major SOURCE-space direction.
          const xx = j00 * j00 + j01 * j01, yy = j10 * j10 + j11 * j11, xy = j00 * j10 + j01 * j11;
          if (xx >= yy) { directionX = major * major - yy; directionY = xy; }
          else { directionX = xy; directionY = major * major - xx; }
          const length = Math.hypot(directionX, directionY);
          directionX /= length; directionY /= length;
        }
        const span = Math.max(0, major - base);
        sum[0] = sum[1] = sum[2] = sum[3] = 0;
        for (let sample = 0; sample < count; sample++) {
          // The base filter already spans `base`; distribute the remaining
          // major extent. This avoids an artificial jump in blur near unity.
          const offset = count === 1 ? 0 : (sample / (count - 1) - 0.5) * span;
          const sx = sourceX + directionX * offset, sy = sourceY + directionY * offset;
          accumulate(levels[low], sx, sy, (1 - blend) / count, sum);
          if (blend) accumulate(levels[low + 1], sx, sy, blend / count, sum);
        }
        const a = Math.round(sum[3]);
        if (a) { out[target] = encode(sum[0] / sum[3]); out[target + 1] = encode(sum[1] / sum[3]); out[target + 2] = encode(sum[2] / sum[3]); out[target + 3] = a; }
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
