/* Replayable continuous confidence-mask edits, not learned hair/detail recovery.
 * Coordinates use normalized image PIXEL EDGES; brush radii use the SHORT EDGE.
 * This module never reads or composites an RGB/RGBA image. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MintMaskRefine = api;
})(typeof globalThis === 'object' ? globalThis : null, function () {
  'use strict';

  const LIMITS = Object.freeze({ pixels: 8388608, edge: 4096, basePixels: 262144, baseEdge: 1024, strokes: 128, points: 4096, strokePoints: 2048, workingBytes: 167772160, workUnits: 256000000 });
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  function check(ok, message) { if (!ok) throw new TypeError(message); }
  function record(value, required, label, optional = []) {
    check(value !== null && typeof value === 'object' && !Array.isArray(value), `Invalid ${label}`);
    const proto = Object.getPrototypeOf(value);
    check(proto === Object.prototype || proto === null, `Invalid ${label} prototype`);
    const keys = Reflect.ownKeys(value), out = Object.create(null);
    check(keys.length >= required.length && keys.length <= required.length + optional.length, `Invalid ${label} fields`);
    for (const key of keys) {
      const d = Object.getOwnPropertyDescriptor(value, key);
      check(typeof key === 'string' && (required.includes(key) || optional.includes(key)) && d && d.enumerable && own(d, 'value'), `Invalid ${label} field`);
      out[key] = d.value;
    }
    for (const key of required) check(own(out, key), `Missing ${label} field: ${key}`);
    return out;
  }
  function array(value, low, high, label) {
    check(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, `Invalid ${label} array`);
    const length = Object.getOwnPropertyDescriptor(value, 'length');
    check(length && own(length, 'value') && Number.isSafeInteger(length.value) && length.value >= low && length.value <= high, `Invalid ${label} length`);
    const n = length.value;
    check(Reflect.ownKeys(value).length === n + 1, `Invalid ${label} fields`);
    const out = [];
    for (let i = 0; i < n; i++) {
      const d = Object.getOwnPropertyDescriptor(value, String(i));
      check(d && d.enumerable && own(d, 'value'), `Invalid ${label} item`);
      out.push(d.value);
    }
    return out;
  }
  function number(v, low, high, label) {
    check(typeof v === 'number' && Number.isFinite(v) && v >= low && v <= high, `Invalid ${label}`);
    return v === 0 ? 0 : v;
  }
  function revision(v) {
    check(typeof v === 'string' && v.length >= 1 && v.length <= 160, 'Invalid sourceRevision');
    return v;
  }
  function dimensions(value, label, edge, pixels) {
    const s = record(value, ['width', 'height'], label);
    check(Number.isSafeInteger(s.width) && Number.isSafeInteger(s.height) && s.width >= 1 && s.height >= 1 && s.width <= edge && s.height <= edge && s.width * s.height <= pixels, `Invalid ${label} dimensions`);
    return { width: s.width, height: s.height };
  }
  function base(value) {
    const b = record(value, ['width', 'height', 'data'], 'mask base');
    const size = dimensions({ width: b.width, height: b.height }, 'mask base', LIMITS.baseEdge, LIMITS.basePixels);
    const count = size.width * size.height, text = b.data;
    check(typeof text === 'string' && text.length === 4 * Math.ceil(count / 3), 'Invalid base Base64 length');
    const pad = (3 - count % 3) % 3, body = text.length - pad;
    // No host decoder, whitespace, alternate alphabet, ignored suffix, or nonzero pad bits.
    for (let i = 0; i < body; i++) check(ALPHABET.indexOf(text[i]) >= 0, 'Invalid canonical base Base64');
    for (let i = body; i < text.length; i++) check(text[i] === '=', 'Invalid canonical base Base64 padding');
    if (pad) check((ALPHABET.indexOf(text[body - 1]) & (pad === 2 ? 15 : 3)) === 0, 'Invalid canonical base Base64 pad bits');
    return { width: size.width, height: size.height, data: text };
  }
  function simplify(points) {
    const out = [];
    for (const p of points) {
      if (out.length && p.x === out[out.length - 1].x && p.y === out[out.length - 1].y) continue;
      while (out.length >= 2) {
        const a = out[out.length - 2], b = out[out.length - 1];
        const ux = b.x - a.x, uy = b.y - a.y, vx = p.x - b.x, vy = p.y - b.y;
        // Roundoff-only tolerance in normalized coordinates, never a pixel-sized simplifier.
        if (ux * vx + uy * vy < 0 || Math.abs(ux * vy - uy * vx) > 1e-12 * (Math.hypot(ux, uy) + Math.hypot(vx, vy))) break;
        out.pop();
      }
      out.push(p);
    }
    return out;
  }
  function validate(recipe, options) {
    const opt = options === undefined ? Object.create(null) : record(options, [], 'mask validation options', ['sourceRevision']);
    if (own(opt, 'sourceRevision')) revision(opt.sourceRevision);
    const r = record(recipe, ['version', 'sourceRevision', 'base', 'strokes', 'edgeShift', 'feather'], 'mask refinement recipe');
    check(r.version === 1, 'Unsupported mask refinement recipe version');
    const sourceRevision = revision(r.sourceRevision);
    check(!own(opt, 'sourceRevision') || opt.sourceRevision === sourceRevision, 'Mask sourceRevision mismatch');
    const canonicalBase = base(r.base), rawStrokes = array(r.strokes, 0, LIMITS.strokes, 'mask strokes');
    let pointCount = 0;
    const strokes = rawStrokes.map(value => {
      const s = record(value, ['mode', 'radius', 'hardness', 'strength', 'points'], 'mask stroke');
      check(s.mode === 'keep' || s.mode === 'erase', 'Invalid mask stroke mode');
      const rawPoints = array(s.points, 1, LIMITS.strokePoints, 'mask stroke points');
      pointCount += rawPoints.length;
      check(pointCount <= LIMITS.points, 'Mask total point budget exceeded');
      const points = rawPoints.map(value => { const p = record(value, ['x', 'y'], 'mask point'); return { x: number(p.x, 0, 1, 'mask x'), y: number(p.y, 0, 1, 'mask y') }; });
      return { mode: s.mode, radius: number(s.radius, .0005, .25, 'mask radius'), hardness: number(s.hardness, 0, 1, 'mask hardness'), strength: number(s.strength, 0, 1, 'mask strength'), points: simplify(points) };
    });
    return { version: 1, sourceRevision, base: canonicalBase, strokes, edgeShift: number(r.edgeShift, -.02, .02, 'mask edgeShift'), feather: number(r.feather, 0, .02, 'mask feather') };
  }
  function defaults(sourceRevision, baseMask) {
    return validate({ version: 1, sourceRevision, base: baseMask === undefined ? { width: 1, height: 1, data: 'AA==' } : baseMask, strokes: [], edgeShift: 0, feather: 0 });
  }
  function options(value) {
    const o = value === undefined ? Object.create(null) : record(value, [], 'mask raster options', ['shouldCancel']);
    check(!own(o, 'shouldCancel') || typeof o.shouldCancel === 'function', 'Invalid cancellation callback');
    return o;
  }
  function checkpoint(shouldCancel) {
    if (shouldCancel && shouldCancel()) { const e = new Error('Mask refinement cancelled'); e.name = 'AbortError'; e.code = 'ABORT_ERR'; throw e; }
  }
  function segment(a, b, width, height, radius) {
    const ax = a.x * width, ay = a.y * height, bx = b.x * width, by = b.y * height;
    const dx = bx - ax, dy = by - ay;
    return { ax, ay, bx, by, dx, dy, length2: dx * dx + dy * dy, radius,
      y0: Math.max(0, Math.ceil(Math.min(ay, by) - radius - .5)), y1: Math.min(height - 1, Math.floor(Math.max(ay, by) + radius - .5)) };
  }
  function rowBounds(s, y, width) {
    let left = s.ax, right = s.bx;
    if (s.dy !== 0) {
      const a = (y + .5 - s.radius - s.ay) / s.dy, b = (y + .5 + s.radius - s.ay) / s.dy;
      const t0 = clamp(Math.min(a, b), 0, 1), t1 = clamp(Math.max(a, b), 0, 1);
      left = s.ax + s.dx * t0; right = s.ax + s.dx * t1;
    }
    return { x0: Math.max(0, Math.ceil(Math.min(left, right) - s.radius - .5)), x1: Math.min(width - 1, Math.floor(Math.max(left, right) + s.radius - .5)) };
  }
  function planning(size, r, shouldCancel) {
    const { width, height } = size, pixels = width * height, short = Math.min(width, height);
    const activeStrokes = [], edgeRadius = Math.abs(r.edgeShift) * short, featherRadius = r.feather * short;
    let segmentCount = 0, segmentRows = 0, coverageVisits = 0, strokeBoxPixels = 0;
    // Weighted, conservative pixel-loop scheduling units, not machine instructions.
    let workUnits = 6 * pixels + r.base.width * r.base.height;
    const reserve = units => { workUnits += units; check(Number.isSafeInteger(workUnits) && workUnits <= LIMITS.workUnits, 'Mask refinement work budget exceeded'); };
    reserve(0);
    for (const s of r.strokes) {
      checkpoint(shouldCancel);
      if (s.strength === 0) continue;
      const radius = s.radius * short, segments = [], points = s.points;
      let x0 = width, y0 = height, x1 = -1, y1 = -1;
      const n = Math.max(1, points.length - 1);
      for (let i = 0; i < n; i++) {
        const g = segment(points[i], points[Math.min(points.length - 1, i + 1)], width, height, radius);
        segments.push(g); segmentCount++; reserve(4);
        for (let y = g.y0; y <= g.y1; y++) {
          if ((segmentRows & 63) === 0) checkpoint(shouldCancel);
          const b = rowBounds(g, y, width), count = Math.max(0, b.x1 - b.x0 + 1);
          segmentRows++; coverageVisits += count; reserve(4 + 12 * count);
          if (count) { x0 = Math.min(x0, b.x0); x1 = Math.max(x1, b.x1); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        }
      }
      const boxPixels = Math.max(0, x1 - x0 + 1) * Math.max(0, y1 - y0 + 1);
      strokeBoxPixels += boxPixels; reserve(4 * boxPixels);
      activeStrokes.push({ mode: s.mode, hardness: s.hardness, strength: s.strength, radius, segments, x0, y0, x1, y1 });
    }
    // Two monotone-deque extrema passes: each pixel enqueued/dequeued at most once.
    if (edgeRadius > 0) reserve(10 * pixels);
    const featherInitialization = featherRadius > 0 ? (width + height) * (2 * Math.floor(featherRadius) + 1) : 0;
    if (featherRadius > 0) reserve(6 * pixels + featherInitialization);
    const scratch = activeStrokes.length > 0 || edgeRadius > 0 || featherRadius > 0;
    const outputBytes = 4 * pixels, scratchBytes = scratch ? 4 * pixels : 0, baseBytes = r.base.width * r.base.height;
    const queueBytes = edgeRadius > 0 ? 4 * Math.max(width, height) : 0;
    const maxWorkingBytes = outputBytes + scratchBytes + baseBytes + queueBytes;
    check(maxWorkingBytes <= LIMITS.workingBytes, 'Mask refinement memory budget exceeded');
    const publicPlan = { width, height, pixels, active: scratch, shortEdge: short, edgeRadius, featherRadius, activeStrokes: activeStrokes.length,
      segmentCount, dabCount: 0, segmentRows, coverageVisits, strokeBoxPixels, workUnits, outputBytes, scratchBytes, baseBytes, queueBytes, maxWorkingBytes };
    return { publicPlan, activeStrokes };
  }
  function plan(size, recipe) { return planning(dimensions(size, 'mask output', LIMITS.edge, LIMITS.pixels), validate(recipe)).publicPlan; }
  function decodeBase(text, count, shouldCancel) {
    const out = new Uint8Array(count);
    for (let i = 0, j = 0; i < text.length; i += 4) {
      if ((i & 16383) === 0) checkpoint(shouldCancel);
      const a = ALPHABET.indexOf(text[i]), b = ALPHABET.indexOf(text[i + 1]);
      const c = text[i + 2] === '=' ? 0 : ALPHABET.indexOf(text[i + 2]), d = text[i + 3] === '=' ? 0 : ALPHABET.indexOf(text[i + 3]);
      out[j++] = (a << 2) | (b >> 4);
      if (j < count) out[j++] = ((b & 15) << 4) | (c >> 2);
      if (j < count) out[j++] = ((c & 3) << 6) | d;
    }
    return out;
  }
  function baseField(field, bytes, width, height, base, shouldCancel) {
    const bw = base.width, bh = base.height;
    for (let y = 0; y < height; y++) {
      checkpoint(shouldCancel);
      const sy = (y + .5) * bh / height - .5, iy = Math.floor(sy), fy = sy - iy;
      const y0 = clamp(iy, 0, bh - 1) * bw, y1 = clamp(iy + 1, 0, bh - 1) * bw;
      for (let x = 0; x < width; x++) {
        const sx = (x + .5) * bw / width - .5, ix = Math.floor(sx), fx = sx - ix;
        const x0 = clamp(ix, 0, bw - 1), x1 = clamp(ix + 1, 0, bw - 1);
        const a = bytes[y0 + x0] + (bytes[y0 + x1] - bytes[y0 + x0]) * fx;
        const b = bytes[y1 + x0] + (bytes[y1 + x1] - bytes[y1 + x0]) * fx;
        field[y * width + x] = (a + (b - a) * fy) / 255;
      }
    }
  }
  function stroke(field, coverage, s, width, shouldCancel, diagnostics) {
    if (s.x1 < s.x0 || s.y1 < s.y0) return;
    for (let y = s.y0; y <= s.y1; y++) { checkpoint(shouldCancel); coverage.fill(0, y * width + s.x0, y * width + s.x1 + 1); diagnostics.clearVisits += s.x1 - s.x0 + 1; }
    for (const g of s.segments) {
      diagnostics.segmentVisits++;
      checkpoint(shouldCancel);
      for (let y = g.y0; y <= g.y1; y++) {
        checkpoint(shouldCancel);
        diagnostics.segmentRowVisits++;
        const b = rowBounds(g, y, width), py = y + .5;
        for (let x = b.x0; x <= b.x1; x++) {
          diagnostics.coverageVisits++;
          const px = x + .5, t = g.length2 === 0 ? 0 : clamp(((px - g.ax) * g.dx + (py - g.ay) * g.dy) / g.length2, 0, 1);
          const distance = Math.hypot(px - (g.ax + g.dx * t), py - (g.ay + g.dy * t));
          if (distance > s.radius) continue;
          const hard = s.radius * s.hardness;
          let v = 1;
          if (distance > hard) { const q = (s.radius - distance) / (s.radius - hard); v = q * q * (3 - 2 * q); }
          const j = y * width + x;
          if (v > coverage[j]) coverage[j] = v;
        }
      }
    }
    for (let y = s.y0; y <= s.y1; y++) {
      checkpoint(shouldCancel);
      for (let j = y * width + s.x0, end = y * width + s.x1; j <= end; j++) {
        const a = coverage[j] * s.strength;
        // Explicitly skip zero coverage so the baseline stays bit-exact.
        if (a > 0) field[j] = s.mode === 'keep' ? field[j] + (1 - field[j]) * a : field[j] * (1 - a);
        diagnostics.blendVisits++;
      }
    }
  }
  function extrema(source, target, width, height, radius, expand, vertical, queue, shouldCancel, diagnostics) {
    const n = Math.floor(radius), f = radius - n;
    const lines = vertical ? width : height, length = vertical ? height : width, stride = vertical ? width : 1;
    for (let line = 0; line < lines; line++) {
      checkpoint(shouldCancel);
      const start = vertical ? line : line * width;
      let head = 0, tail = 0, added = -1;
      for (let x = 0; x < length; x++) {
        const lo = Math.max(0, x - n), hi = Math.min(length - 1, x + n);
        while (head < tail && queue[head] < lo) { head++; diagnostics.queueVisits++; }
        while (added < hi) {
          added++; const value = source[start + added * stride];
          while (head < tail && (expand ? source[start + queue[tail - 1] * stride] <= value : source[start + queue[tail - 1] * stride] >= value)) { tail--; diagnostics.queueVisits++; }
          queue[tail++] = added; diagnostics.queueVisits++;
        }
        let value = source[start + queue[head] * stride];
        if (f > 0) {
          const l0 = source[start + Math.max(0, x - n) * stride], l1 = source[start + Math.max(0, x - n - 1) * stride];
          const r0 = source[start + Math.min(length - 1, x + n) * stride], r1 = source[start + Math.min(length - 1, x + n + 1) * stride];
          const left = l0 + (l1 - l0) * f, right = r0 + (r1 - r0) * f;
          value = expand ? Math.max(value, left, right) : Math.min(value, left, right);
        }
        target[start + x * stride] = value; diagnostics.morphologyVisits++;
      }
    }
  }
  function feather(source, target, width, height, radius, vertical, shouldCancel, diagnostics) {
    const n = Math.floor(radius), f = radius - n, scale = 1 / (2 * n + 1 + 2 * f);
    const lines = vertical ? width : height, length = vertical ? height : width, stride = vertical ? width : 1;
    for (let line = 0; line < lines; line++) {
      checkpoint(shouldCancel);
      const start = vertical ? line : line * width;
      let sum = 0;
      for (let k = -n; k <= n; k++) { sum += source[start + clamp(k, 0, length - 1) * stride]; diagnostics.featherInitialization++; }
      for (let x = 0; x < length; x++) {
        const right = source[start + Math.min(length - 1, x + n + 1) * stride];
        const left = source[start + Math.max(0, x - n - 1) * stride];
        target[start + x * stride] = clamp((sum + f * (left + right)) * scale, 0, 1);
        sum += right - source[start + Math.max(0, x - n) * stride];
        diagnostics.featherVisits++;
      }
    }
  }
  function rasterize(size, recipe, rasterOptions) {
    const s = dimensions(size, 'mask output', LIMITS.edge, LIMITS.pixels), r = validate(recipe), opt = options(rasterOptions), shouldCancel = opt.shouldCancel;
    checkpoint(shouldCancel);
    // Complete validation, canonicalization and cumulative planning BEFORE buffer allocations.
    const planned = planning(s, r, shouldCancel), p = planned.publicPlan;
    checkpoint(shouldCancel); const bytes = decodeBase(r.base.data, p.baseBytes, shouldCancel);
    checkpoint(shouldCancel); const data = new Float32Array(p.pixels);
    checkpoint(shouldCancel); const scratch = p.scratchBytes ? new Float32Array(p.pixels) : null;
    checkpoint(shouldCancel); const queue = p.queueBytes ? new Int32Array(Math.max(s.width, s.height)) : null;
    const diagnostics = { ...p, baseVisits: p.pixels, coverageVisits: 0, clearVisits: 0, blendVisits: 0, segmentVisits: 0, segmentRowVisits: 0, morphologyVisits: 0, queueVisits: 0, featherVisits: 0, featherInitialization: 0 };
    baseField(data, bytes, s.width, s.height, r.base, shouldCancel);
    for (const st of planned.activeStrokes) stroke(data, scratch, st, s.width, shouldCancel, diagnostics);
    if (p.edgeRadius > 0) {
      extrema(data, scratch, s.width, s.height, p.edgeRadius, r.edgeShift > 0, false, queue, shouldCancel, diagnostics);
      extrema(scratch, data, s.width, s.height, p.edgeRadius, r.edgeShift > 0, true, queue, shouldCancel, diagnostics);
    }
    if (p.featherRadius > 0) {
      feather(data, scratch, s.width, s.height, p.featherRadius, false, shouldCancel, diagnostics);
      feather(scratch, data, s.width, s.height, p.featherRadius, true, shouldCancel, diagnostics);
    }
    diagnostics.actualWorkUnits = 6 * diagnostics.baseVisits + p.baseBytes + 4 * diagnostics.segmentVisits + 4 * diagnostics.segmentRowVisits + 12 * diagnostics.coverageVisits + 2 * (diagnostics.clearVisits + diagnostics.blendVisits) + 2 * diagnostics.morphologyVisits + diagnostics.queueVisits + 3 * diagnostics.featherVisits + diagnostics.featherInitialization;
    check(diagnostics.actualWorkUnits <= p.workUnits, 'Mask refinement work accounting mismatch');
    checkpoint(shouldCancel);
    return { width: s.width, height: s.height, data, diagnostics };
  }
  return Object.freeze({ LIMITS, defaults, validate, plan, rasterize });
});
