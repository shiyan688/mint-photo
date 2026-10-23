/* MintStraighten 1.0.0. Pure RGBA8 rotation; no DOM, canvas, dependencies, or I/O. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MintStraighten = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const LIMITS = Object.freeze({ maxEdge: 16384, maxPixels: 64 * 1024 * 1024,
    maxBytes: 512 * 1024 * 1024, maxBilinearTaps: 256 * 1024 * 1024,
    cancelIntervalPixels: 1024 });
  const own = Function.call.bind(Object.prototype.hasOwnProperty);
  const typedProto = Object.getPrototypeOf(Uint8Array.prototype);
  const typedLength = Object.getOwnPropertyDescriptor(typedProto, 'length').get;
  const typedBuffer = Object.getOwnPropertyDescriptor(typedProto, 'buffer').get;
  const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
  const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable');
  const issuedPlans = new WeakSet();
  // Exact decode for every possible 8-bit sRGB input, not an interpolated LUT.
  const linear = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    linear[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  function fail(message, kind) {
    const error = kind === 'LIMIT' ? new RangeError(message) : new TypeError(message);
    error.code = 'STRAIGHTEN_' + (kind || 'INVALID');
    throw error;
  }
  function record(value, keys, required, label) {
    if (!value || typeof value !== 'object') fail(label + ' must be a plain data record');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(label + ' has an unsafe prototype');
    const names = Reflect.ownKeys(value);
    if (names.length > keys.length) fail(label + ' has unsupported fields');
    const snapshot = Object.create(null);
    for (const key of names) {
      if (typeof key !== 'string' || !keys.includes(key)) fail(label + ' has unsupported fields');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !own(descriptor, 'value')) fail(label + ' has an accessor or hidden field');
      snapshot[key] = descriptor.value;
    }
    for (const key of required) if (!own(snapshot, key)) fail(label + ' is missing ' + key);
    return snapshot;
  }
  function finite(value, min, max, label) {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(label + ' must be finite');
    if (value < min || value > max) fail(label + ' is out of range', 'LIMIT');
    return value === 0 ? 0 : value;
  }
  function defaults() { return Object.freeze({ version: 1, angle: 0, mode: 'expand' }); }
  function validate(value) {
    if (value == null) return defaults();
    const r = record(value, ['version', 'angle', 'mode'], ['version', 'angle', 'mode'], 'Straighten recipe');
    if (r.version !== 1) fail('Unsupported straighten version');
    if (r.mode !== 'expand' && r.mode !== 'crop') fail('Straighten mode must be expand or crop');
    return Object.freeze({ version: 1, angle: finite(r.angle, -180, 180, 'Angle'), mode: r.mode });
  }
  function isActive(value) { return validate(value).angle !== 0; }
  function dimensions(width, height, label) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
        width > LIMITS.maxEdge || height > LIMITS.maxEdge || width * height > LIMITS.maxPixels) {
      fail(label + ' exceeds integer edge or pixel limits', 'LIMIT');
    }
  }
  function tolerance(width, height) { return 64 * Number.EPSILON * Math.max(1, width, height); }
  function cropExtents(width, height, cos, sin) {
    const W = width - 1, H = height - 1, c = Math.abs(cos), s = Math.abs(sin);
    // A truly oblique line has no non-degenerate axis-aligned inscribed rectangle.
    if (!W || !H) return { x: 0, y: 0, integerWidth: 1, integerHeight: 1 };
    // Defensive axis limits (a nonzero residual that underflows is rejected).
    if (s === 0) return { x: W / c, y: H / c, integerWidth: Math.floor(W / c) + 1, integerHeight: Math.floor(H / c) + 1 };
    if (c === 0) return { x: H / s, y: W / s, integerWidth: Math.floor(H / s) + 1, integerHeight: Math.floor(W / s) + 1 };
    let bestX = 0, bestY = 0, bestArea = -1, bestWidth = 1, bestHeight = 1;
    const eps = tolerance(width, height);
    function candidate(x, y, split) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return;
      const a = c * x + s * y, b = s * x + c * y;
      if (a > W + eps || b > H + eps) return;
      // Correct only roundoff in an otherwise feasible candidate. This is not a
      // sampling clamp; every final raster corner is independently checked below.
      const scale = Math.min(1, a ? W / a : 1, b ? H / b : 1);
      x *= scale; y *= scale;
      const area = x * y;
      if (area > bestArea) {
        bestX = x; bestY = y; bestArea = area;
        // Preserve a real sub-ULP contraction at an integer boundary. Adding
        // it to the large base before flooring would silently erase that crop.
        bestWidth = split ? split.bx + Math.floor(split.dx * scale + split.bx * (scale - 1)) + 1 : Math.floor(x) + 1;
        bestHeight = split ? split.by + Math.floor(split.dy * scale + split.by * (scale - 1)) + 1 : Math.floor(y) + 1;
      }
    }
    // Product stationary points on each possible active linear constraint.
    candidate(W / (2 * c), W / (2 * s));
    candidate(H / (2 * s), H / (2 * c));
    // Stable symmetric intersection. At 45 degrees the parallel constraints'
    // stricter peak already wins; never divide by an approximately zero det.
    const plus = c + s, minus = c - s;
    if (minus !== 0) {
      const sum = (W + H) / plus, difference = (W - H) / minus;
      if (Number.isFinite(difference) && Math.abs(difference) <= sum + eps) {
        if (Math.abs(minus) < 0.25) candidate((sum + difference) / 2, (sum - difference) / 2);
        else {
          const a = Math.max(c, s), b = Math.min(c, s), det = (a - b) * (a + b);
          const bx = c >= s ? W : H, by = c >= s ? H : W;
          // Since a-1 = -b*b/(1+a), express intersection relative to the
          // integer quarter-turn spans without subtracting near-equal values.
          const k = 2 - 1 / (1 + a);
          const dx = b * (b * k * bx - by) / det, dy = b * (b * k * by - bx) / det;
          candidate(bx + dx, by + dy, { bx, by, dx, dy });
        }
      }
    }
    if (bestArea < 0) fail('Cannot construct a finite crop rectangle');
    return { x: bestX, y: bestY, integerWidth: Math.max(1, bestWidth), integerHeight: Math.max(1, bestHeight) };
  }
  function inverse(p, x, y) {
    const dx = x - p.outputCenter.x, dy = y - p.outputCenter.y;
    return { x: p.cos * dx + p.sin * dy + p.sourceCenter.x,
      y: -p.sin * dx + p.cos * dy + p.sourceCenter.y };
  }
  function verifyCrop(p) {
    const w = p.outputSize.width - 1, h = p.outputSize.height - 1;
    const sw = p.sourceSize.width - 1, sh = p.sourceSize.height - 1;
    const eps = p.geometryTolerance;
    for (const x of [0, w]) for (const y of [0, h]) {
      const q = inverse(p, x, y);
      if (q.x < -eps || q.x > sw + eps || q.y < -eps || q.y > sh + eps) {
        fail('Crop raster escapes source pixel-center bounds');
      }
    }
  }
  function plan(width, height, value) {
    dimensions(width, height, 'Source');
    const recipe = validate(value), angle = recipe.angle;
    const quarterTurns = angle % 90 === 0 ? ((angle / 90) % 4 + 4) % 4 : null;
    let cos, sin;
    if (quarterTurns !== null) {
      cos = [1, 0, -1, 0][quarterTurns]; sin = [0, 1, 0, -1][quarterTurns];
    } else {
      // Range-reduce in degrees first: a neighbor of 90 degrees must not round
      // to the same radian value as exactly 90 before the trig evaluation.
      const quadrant = Math.round(angle / 90), residual = angle - quadrant * 90;
      const radians = residual * (Math.PI / 180);
      if (radians === 0) fail('Nonzero angle underflows the supported radian range', 'LIMIT');
      const c = Math.cos(radians), s = Math.sin(radians), q = ((quadrant % 4) + 4) % 4;
      if (q === 0) { cos = c; sin = s; }
      else if (q === 1) { cos = -s; sin = c; }
      else if (q === 2) { cos = -c; sin = -s; }
      else { cos = s; sin = -c; }
    }
    let ow, oh, extents = null;
    if (quarterTurns !== null) {
      ow = quarterTurns % 2 ? height : width; oh = quarterTurns % 2 ? width : height;
    } else if (recipe.mode === 'expand') {
      const c = Math.abs(cos), s = Math.abs(sin), a = Math.max(c, s), b = Math.min(c, s);
      const baseW = c >= s ? width : height, baseH = c >= s ? height : width;
      // 1-a = b*b/(1+a). Ceil the small signed expansion before adding
      // the integer base, or a near-axis positive sub-ULP extent disappears.
      ow = baseW + Math.ceil(b * (baseH - b * baseW / (1 + a)));
      oh = baseH + Math.ceil(b * (baseW - b * baseH / (1 + a)));
    } else {
      extents = cropExtents(width, height, cos, sin);
      ow = extents.integerWidth; oh = extents.integerHeight;
    }
    dimensions(ow, oh, 'Output');
    const sourceBytes = width * height * 4, outputBytes = angle === 0 ? 0 : ow * oh * 4;
    const totalBytes = sourceBytes + outputBytes;
    const bilinearTaps = quarterTurns === null ? ow * oh * 4 : 0;
    if (totalBytes > LIMITS.maxBytes || bilinearTaps > LIMITS.maxBilinearTaps) {
      fail('Straighten memory or sampling budget exceeded', 'LIMIT');
    }
    const p = { version: 1, recipe, sourceSize: Object.freeze({ width, height }),
      outputSize: Object.freeze({ width: ow, height: oh }), quarterTurns,
      isQuarterTurn: quarterTurns !== null, cos, sin,
      sourceCenter: Object.freeze({ x: (width - 1) / 2, y: (height - 1) / 2 }),
      outputCenter: Object.freeze({ x: (ow - 1) / 2, y: (oh - 1) / 2 }),
      cropCenterExtents: extents ? Object.freeze(extents) : null,
      geometryTolerance: tolerance(width, height),
      estimates: Object.freeze({ sourcePixels: width * height, outputPixels: ow * oh,
        sourceBytes, outputBytes, extraBytes: outputBytes + linear.byteLength,
        totalRgbaBytes: totalBytes, bilinearTaps,
        workUnits: angle === 0 ? 0 : quarterTurns === null ? bilinearTaps : ow * oh }) };
    if (recipe.mode === 'crop') verifyCrop(p);
    Object.freeze(p); issuedPlans.add(p); return p;
  }
  function options(value) {
    const o = record(value == null ? {} : value, ['shouldCancel'], [], 'Straighten options');
    if (own(o, 'shouldCancel') && typeof o.shouldCancel !== 'function') fail('shouldCancel must be a function');
    return own(o, 'shouldCancel') ? o.shouldCancel : null;
  }
  function source(value) {
    const im = record(value, ['width', 'height', 'data'], ['width', 'height', 'data'], 'Image');
    dimensions(im.width, im.height, 'Source');
    const d = im.data, proto = d && Object.getPrototypeOf(d);
    if (proto !== Uint8Array.prototype && proto !== Uint8ClampedArray.prototype) {
      fail('RGBA data must be a same-realm native Uint8Array or Uint8ClampedArray');
    }
    let length, buffer, bytes;
    try { length = typedLength.call(d); buffer = typedBuffer.call(d); bytes = bufferLength.call(buffer); }
    catch (_) { fail('RGBA data requires an attached, non-shared ArrayBuffer'); }
    if (Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype || (resizable && resizable.get.call(buffer))) {
      fail('Resizable or subclassed buffers are unsupported');
    }
    if (length !== im.width * im.height * 4) fail('RGBA data length must match dimensions exactly');
    return { width: im.width, height: im.height, data: d, length, retainedBytes: bytes };
  }
  function check(cancel, im) {
    if (cancel && cancel()) {
      const error = new Error('Straighten operation cancelled');
      error.name = 'AbortError'; error.code = 'STRAIGHTEN_CANCELLED'; throw error;
    }
    if (im && typedLength.call(im.data) !== im.length) fail('Source was detached during operation');
  }
  function encode(v) {
    return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  }
  function apply(value, recipe, opts) {
    // All records, view metadata, geometry, limits and actual retained buffer size
    // are checked before calling user code or allocating an output pixel buffer.
    const cancel = options(opts), im = source(value), p = plan(im.width, im.height, recipe);
    if (im.retainedBytes + p.estimates.outputBytes > LIMITS.maxBytes) fail('Retained source and output exceed memory budget', 'LIMIT');
    check(cancel, im);
    if (p.recipe.angle === 0) return value;
    const w = p.outputSize.width, h = p.outputSize.height, out = new Uint8ClampedArray(w * h * 4), data = im.data;
    if (p.quarterTurns !== null) {
      for (let y = 0; y < h; y++) {
        check(cancel, im);
        for (let x = 0; x < w; x++) {
          if (x && x % LIMITS.cancelIntervalPixels === 0) check(cancel, im);
          let sx, sy;
          if (p.quarterTurns === 1) { sx = y; sy = im.height - 1 - x; }
          else if (p.quarterTurns === 2) { sx = im.width - 1 - x; sy = im.height - 1 - y; }
          else { sx = im.width - 1 - y; sy = x; }
          const a = (sy * im.width + sx) * 4, b = (y * w + x) * 4;
          out[b] = data[a]; out[b + 1] = data[a + 1]; out[b + 2] = data[a + 2]; out[b + 3] = data[a + 3];
        }
      }
    } else {
      for (let y = 0; y < h; y++) {
        check(cancel, im);
        const dy = y - p.outputCenter.y;
        for (let x = 0; x < w; x++) {
          if (x && x % LIMITS.cancelIntervalPixels === 0) check(cancel, im);
          const dx = x - p.outputCenter.x;
          const sx = p.cos * dx + p.sin * dy + p.sourceCenter.x;
          const sy = -p.sin * dx + p.cos * dy + p.sourceCenter.y;
          const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
          let alpha = 0, red = 0, green = 0, blue = 0;
          for (let by = 0; by < 2; by++) {
            const yy = iy + by;
            if (yy < 0 || yy >= im.height) continue;
            const wy = by ? fy : 1 - fy;
            for (let bx = 0; bx < 2; bx++) {
              const xx = ix + bx;
              if (xx < 0 || xx >= im.width) continue;
              const weight = wy * (bx ? fx : 1 - fx), a = (yy * im.width + xx) * 4;
              const weightedAlpha = weight * data[a + 3];
              if (!weightedAlpha) continue; // Transparent hidden RGB is irrelevant.
              alpha += weightedAlpha;
              red += weightedAlpha * linear[data[a]];
              green += weightedAlpha * linear[data[a + 1]];
              blue += weightedAlpha * linear[data[a + 2]];
            }
          }
          const b = (y * w + x) * 4, a = Math.round(alpha);
          // Zero-quantized-alpha output remains transparent black, not hidden RGB.
          if (a) { out[b] = encode(red / alpha); out[b + 1] = encode(green / alpha); out[b + 2] = encode(blue / alpha); out[b + 3] = a; }
        }
      }
    }
    check(cancel, im);
    return { width: w, height: h, data: out };
  }
  function mapEdgePoint(p, value, direction) {
    if (!issuedPlans.has(p)) fail('mapEdgePoint requires a plan issued by this module');
    const v = record(value, ['x', 'y'], ['x', 'y'], 'Point');
    const x = finite(v.x, -2 * LIMITS.maxEdge, 2 * LIMITS.maxEdge, 'Point x');
    const y = finite(v.y, -2 * LIMITS.maxEdge, 2 * LIMITS.maxEdge, 'Point y');
    if (direction === undefined) direction = 'forward';
    if (direction === 'forward') {
      const dx = x - p.sourceSize.width / 2, dy = y - p.sourceSize.height / 2;
      return { x: p.cos * dx - p.sin * dy + p.outputSize.width / 2,
        y: p.sin * dx + p.cos * dy + p.outputSize.height / 2 };
    }
    if (direction === 'inverse') {
      const dx = x - p.outputSize.width / 2, dy = y - p.outputSize.height / 2;
      return { x: p.cos * dx + p.sin * dy + p.sourceSize.width / 2,
        y: -p.sin * dx + p.cos * dy + p.sourceSize.height / 2 };
    }
    fail('Point direction must be forward or inverse');
  }
  return Object.freeze({ version: '1.0.0', LIMITS, defaults, validate, isActive, plan, apply, mapEdgePoint });
});
