/* Classical, source-bound selection and manual liquify. No model or network use.
 * UMD: the same implementation is replayed at preview and original resolution. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MintManualTools = api;
})(typeof globalThis === 'object' ? globalThis : null, function () {
  'use strict';
  const LIMITS = Object.freeze({
    pixels: 16777216, edge: 16384, selectionCommands: 128, selectionPoints: 4096,
    liquifyCommands: 128, liquifyPoints: 4096, snapshotCommands: 1024,
    snapshotPoints: 16384, dabs: 8192, work: 800000000, memoryBytes: 536870912,
    maxEdgeDisplacement: 0.45
  });
  // The extra margin covers Float32 storage error even on the largest geometry.
  const EDGE_TARGET = 0.44;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function fail(message, code = 'MANUAL_INVALID') {
    const e = new TypeError(message); e.code = code; throw e;
  }
  function check(ok, message, code) { if (!ok) fail(message, code); }
  function object(value, keys, label) {
    check(value && typeof value === 'object' && !Array.isArray(value), `Invalid ${label}`);
    const proto = Object.getPrototypeOf(value);
    check(proto === Object.prototype || proto === null, `Invalid ${label} prototype`);
    const own = Reflect.ownKeys(value);
    check(own.length === keys.length, `Unexpected or missing ${label} fields`);
    for (const k of own) {
      const d = Object.getOwnPropertyDescriptor(value, k);
      check(typeof k === 'string' && keys.includes(k) && d.enumerable && 'value' in d,
        `Unexpected or accessor ${label} field`);
    }
    for (const k of keys) check(Object.hasOwn(value, k), `Missing ${label} field`);
    return value;
  }
  function array(value, min, max, label) {
    check(Array.isArray(value) && value.length >= min && value.length <= max, `Invalid ${label} count`);
    const keys = Reflect.ownKeys(value);
    check(keys.length === value.length + 1, `Unexpected or sparse ${label} fields`);
    for (let i = 0; i < value.length; i++) {
      const d = Object.getOwnPropertyDescriptor(value, String(i));
      check(d && d.enumerable && 'value' in d, `Invalid or accessor ${label} item`);
    }
    return value;
  }
  function number(v, lo, hi, label) {
    check(typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi, `Invalid ${label}`);
    return v;
  }
  function revision(v) {
    check(typeof v === 'string' && v.length > 0 && v.length <= 160 && !/[\u0000-\u001f\u007f]/.test(v),
      'Invalid source revision');
    return v;
  }
  function contextRevision(context) {
    const d = context && Object.getOwnPropertyDescriptor(context, 'sourceRevision');
    check(d && 'value' in d, 'Manual tools require immutable source revision');
    return revision(d.value);
  }
  function kind(value) {
    const d = value && typeof value === 'object' && Object.getOwnPropertyDescriptor(value, 'kind');
    check(d && 'value' in d, 'Missing or accessor command kind');
    return d.value;
  }
  function points(value, min, counters, key) {
    array(value, min, LIMITS.selectionPoints, 'points');
    counters[key] += value.length;
    const limit = key === 'selection' ? LIMITS.selectionPoints : LIMITS.liquifyPoints;
    check(counters[key] <= limit, 'Too many total points');
    return value.map(p => {
      object(p, ['x', 'y'], 'point');
      return { x: number(p.x, 0, 1, 'point x'), y: number(p.y, 0, 1, 'point y') };
    });
  }
  function selection(recipe, sourceRevision) {
    if (recipe === null) return null;
    object(recipe, ['version', 'sourceRevision', 'base', 'inverted', 'feather', 'commands'], 'selection');
    check(recipe.version === 1, 'Unsupported selection version');
    check(revision(recipe.sourceRevision) === sourceRevision, 'Selection belongs to another source revision');
    check(recipe.base === 'none' || recipe.base === 'all', 'Invalid selection base');
    check(typeof recipe.inverted === 'boolean', 'Invalid selection inversion');
    const feather = number(recipe.feather, 0, 0.1, 'selection feather');
    array(recipe.commands, 0, LIMITS.selectionCommands, 'selection commands');
    const counters = { selection: 0 };
    const commands = recipe.commands.map(c => {
      const k = kind(c);
      check(k === 'brush' || k === 'lasso', 'Unknown selection command');
      object(c, k === 'brush' ? ['kind', 'mode', 'radius', 'points'] : ['kind', 'mode', 'points'], 'selection command');
      check(c.mode === 'add' || c.mode === 'subtract', 'Invalid selection mode');
      const out = { kind: k, mode: c.mode };
      if (k === 'brush') out.radius = number(c.radius, 0.002, 0.5, 'brush radius');
      out.points = points(c.points, k === 'lasso' ? 3 : 1, counters, 'selection');
      if (k === 'lasso') {
        const a = out.points[0], b = out.points.find(p => p.x !== a.x || p.y !== a.y);
        check(b && out.points.some(p => Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) > 1e-12),
          'Degenerate lasso requires three noncollinear points');
      }
      return out;
    });
    return { version: 1, sourceRevision, base: recipe.base, inverted: recipe.inverted, feather, commands };
  }
  function validateSelection(recipe, context) {
    if (recipe === null) return null;
    return selection(recipe, contextRevision(context));
  }
  function validateLiquifyCommands(commands, context) {
    const sourceRevision = contextRevision(context);
    array(commands, 0, LIMITS.liquifyCommands, 'liquify commands');
    const counters = { liquify: 0 }; let snapshotPoints = 0, snapshotCommands = 0;
    return commands.map(c => {
      const k = kind(c);
      check(k === 'push' || k === 'restore', 'Unknown liquify command');
      object(c, ['kind', 'sourceRevision', 'radius', 'strength', 'points', 'selection'], 'liquify command');
      check(revision(c.sourceRevision) === sourceRevision, 'Liquify belongs to another source revision');
      const snapshot = selection(c.selection, sourceRevision);
      if (snapshot) {
        snapshotCommands += snapshot.commands.length;
        for (const s of snapshot.commands) snapshotPoints += s.points.length;
      }
      check(snapshotCommands <= LIMITS.snapshotCommands && snapshotPoints <= LIMITS.snapshotPoints,
        'Too many selection snapshot commands or points');
      return { kind: k, sourceRevision, radius: number(c.radius, 0.002, 0.5, 'liquify radius'),
        strength: number(c.strength, 0, 1, 'liquify strength'),
        points: points(c.points, 1, counters, 'liquify'), selection: snapshot };
    });
  }
  function dimensions(width, height) {
    check(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 &&
      width <= LIMITS.edge && height <= LIMITS.edge && width * height <= LIMITS.pixels,
    'Invalid or oversized manual-tool dimensions');
    return width * height;
  }
  function cancellation(context) {
    const d = context && Object.getOwnPropertyDescriptor(context, 'shouldCancel');
    if (d) check('value' in d && typeof d.value === 'function', 'Invalid cancellation callback');
    return () => {
      if (d && d.value()) {
        const e = new Error('Manual-tool rendering cancelled'); e.name = 'AbortError'; e.code = 'MANUAL_CANCELLED'; throw e;
      }
    };
  }
  function ceiling(work, bytes) {
    check(work <= LIMITS.work, 'Manual-tool work budget exceeded', 'MANUAL_WORK_LIMIT');
    check(bytes <= LIMITS.memoryBytes, 'Manual-tool memory budget exceeded', 'MANUAL_MEMORY_LIMIT');
  }
  function rect(ax, ay, bx, by, radius, w, h, extra = 0) {
    return { x0: Math.max(0, Math.ceil(Math.min(ax, bx) - radius) - extra),
      y0: Math.max(0, Math.ceil(Math.min(ay, by) - radius) - extra),
      x1: Math.min(w - 1, Math.floor(Math.max(ax, bx) + radius) + extra),
      y1: Math.min(h - 1, Math.floor(Math.max(ay, by) + radius) + extra) };
  }
  const area = b => Math.max(0, b.x1 - b.x0 + 1) * Math.max(0, b.y1 - b.y0 + 1);
  function xy(p, w, h) { return { x: p.x * (w - 1), y: p.y * (h - 1) }; }
  function segmentDistanceSquared(x, y, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, denom = dx * dx + dy * dy;
    const t = denom ? clamp(((x - a.x) * dx + (y - a.y) * dy) / denom, 0, 1) : 0;
    const px = x - a.x - t * dx, py = y - a.y - t * dy;
    return px * px + py * py;
  }
  function selectionCost(w, h, recipe) {
    if (!recipe) return 0;
    let work = w * h * (recipe.feather > 0 ? 18 : 2);
    for (const c of recipe.commands) {
      const p = c.points.map(v => xy(v, w, h));
      if (c.kind === 'brush') {
        const r = c.radius * Math.min(w, h);
        for (let i = 0; i < Math.max(1, p.length - 1); i++) work += area(rect(p[i].x, p[i].y,
          p[Math.min(i + 1, p.length - 1)].x, p[Math.min(i + 1, p.length - 1)].y, r, w, h)) * 4;
      } else {
        const b = polygonBounds(p, w, h);
        work += (b.y1 - b.y0 + 1) * (p.length * (6 + Math.ceil(Math.log2(p.length))) + b.x1 - b.x0 + 1);
      }
    }
    return work;
  }
  function polygonBounds(p, w, h) {
    let minX = w, minY = h, maxX = 0, maxY = 0;
    for (const v of p) { minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); }
    return rect(minX, minY, maxX, maxY, 0, w, h);
  }
  function paintCapsule(mask, w, h, a, b, r, value, cancelled) {
    const box = rect(a.x, a.y, b.x, b.y, r, w, h), r2 = r * r;
    for (let y = box.y0; y <= box.y1; y++) {
      if ((y & 31) === 0) cancelled();
      for (let x = box.x0; x <= box.x1; x++) {
        if (segmentDistanceSquared(x, y, a, b) <= r2 + 1e-10) mask[y * w + x] = value;
      }
    }
  }
  function paintPolygon(mask, w, h, p, value, cancelled) {
    const box = polygonBounds(p, w, h), crossings = [];
    for (let y = box.y0; y <= box.y1; y++) {
      if ((y & 31) === 0) cancelled();
      crossings.length = 0;
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) crossings.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
        // A boundary is selected, including horizontal and bottom polygon edges.
        if (a.y === b.y && Math.abs(y - a.y) < 1e-10) {
          for (let x = Math.max(0, Math.ceil(Math.min(a.x, b.x) - 1e-10)); x <= Math.min(w - 1, Math.floor(Math.max(a.x, b.x) + 1e-10)); x++) mask[y * w + x] = value;
        } else if (y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y)) {
          const x = a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y), nearest = Math.round(x);
          if (Math.abs(x - nearest) < 1e-9 && nearest >= 0 && nearest < w) mask[y * w + nearest] = value;
        }
      }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const end = Math.min(w - 1, Math.floor(crossings[i + 1] + 1e-10));
        for (let x = Math.max(0, Math.ceil(crossings[i] - 1e-10)); x <= end; x++) mask[y * w + x] = value;
      }
    }
  }
  function feather(mask, scratch, w, h, radius, cancelled) {
    if (radius === 0) return;
    const whole = Math.floor(radius), fraction = radius - whole, norm = 1 + 2 * radius;
    const prefix = new Float64Array(Math.max(w, h) + 1);
    function pass(input, output, lines, length, stride, lineStride) {
      for (let line = 0; line < lines; line++) {
        if ((line & 31) === 0) cancelled();
        const base = line * lineStride; prefix[0] = 0;
        for (let i = 0; i < length; i++) prefix[i + 1] = prefix[i] + input[base + i * stride];
        const first = input[base], last = input[base + (length - 1) * stride];
        for (let i = 0; i < length; i++) {
          const lo = i - whole, hi = i + whole;
          let sum = prefix[Math.min(length, hi + 1)] - prefix[Math.max(0, lo)] + Math.max(0, -lo) * first + Math.max(0, hi - length + 1) * last;
          if (fraction) sum += fraction * (input[base + clamp(lo - 1, 0, length - 1) * stride] + input[base + clamp(hi + 1, 0, length - 1) * stride]);
          output[base + i * stride] = clamp(sum / norm, 0, 1);
        }
      }
    }
    pass(mask, scratch, h, w, 1, w); pass(scratch, mask, w, h, w, 1);
  }
  function rasterize(w, h, recipe, mask, scratch, cancelled) {
    mask.fill(recipe.base === 'all' ? 1 : 0);
    for (const c of recipe.commands) {
      cancelled();
      const p = c.points.map(v => xy(v, w, h)), value = c.mode === 'add' ? 1 : 0;
      if (c.kind === 'brush') {
        const r = c.radius * Math.min(w, h);
        for (let i = 0; i < Math.max(1, p.length - 1); i++) paintCapsule(mask, w, h, p[i], p[Math.min(i + 1, p.length - 1)], r, value, cancelled);
      } else paintPolygon(mask, w, h, p, value, cancelled);
    }
    feather(mask, scratch, w, h, recipe.feather * Math.min(w, h), cancelled);
    if (recipe.inverted) for (let i = 0; i < mask.length; i++) mask[i] = 1 - mask[i];
    return mask;
  }
  function rasterizeSelection(width, height, recipe, context) {
    const n = dimensions(width, height), normalized = validateSelection(recipe, context), cancelled = cancellation(context);
    cancelled(); if (normalized === null) return null;
    ceiling(selectionCost(width, height, normalized), n * (normalized.feather > 0 ? 8 : 4) + (Math.max(width, height) + 1) * 8);
    const mask = new Float32Array(n), scratch = normalized.feather > 0 ? new Float32Array(n) : null;
    return rasterize(width, height, normalized, mask, scratch, cancelled);
  }
  // A C1 compact kernel with a flat central half-radius. Restore strength 1 can
  // therefore exactly erase displacement covered by that plateau.
  function kernel(distanceSquared, radius) {
    if (distanceSquared >= radius * radius) return 0;
    if (distanceSquared <= radius * radius * 0.25) return 1;
    const t = 2 * Math.sqrt(distanceSquared) / radius - 1;
    return 1 - t * t * (3 - 2 * t);
  }
  function plan(w, h, commands) {
    let work = w * h * 14, totalDabs = 0;
    const plans = commands.map(c => {
      const r = c.radius * Math.min(w, h), p = c.points.map(v => xy(v, w, h)), dabs = [];
      if (c.strength === 0) return { c, r, p, dabs };
      work += selectionCost(w, h, c.selection);
      if (c.kind === 'push') {
        // Resample the entire polyline at fixed arc-length intervals. Starting
        // a fresh dab grid at each pointer event would make dense event streams
        // both stronger and needlessly more expensive than sparse ones.
        const segments = []; let length = 0;
        for (let i = 1; i < p.length; i++) {
          const segmentLength = Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
          if (segmentLength > 0) {
            segments.push({ a: p[i - 1], z: p[i], start: length, length: segmentLength });
            length += segmentLength;
          }
        }
        const steps = length > 0 ? Math.max(1, Math.ceil(length / (r * 0.35) - 1e-10)) : 0;
        check(totalDabs + steps <= LIMITS.dabs, 'Liquify dab budget exceeded', 'MANUAL_WORK_LIMIT');
        let segmentIndex = 0;
        function at(distance) {
          while (segmentIndex + 1 < segments.length && distance > segments[segmentIndex].start + segments[segmentIndex].length) segmentIndex++;
          const segment = segments[segmentIndex], t = clamp((distance - segment.start) / segment.length, 0, 1);
          return { x: segment.a.x + (segment.z.x - segment.a.x) * t, y: segment.a.y + (segment.z.y - segment.a.y) * t };
        }
        let from = steps ? at(0) : null;
        for (let s = 0; s < steps; s++) {
          const center = at(length * (s + 0.5) / steps), to = at(length * (s + 1) / steps), x = center.x, y = center.y;
          const b = rect(x, y, x, y, r, w, h);
          dabs.push({ x, y, dx: -(to.x - from.x) * c.strength, dy: -(to.y - from.y) * c.strength, b });
          work += area(rect(x, y, x, y, r, w, h, 1)) * 34;
          from = to;
        }
        totalDabs += steps;
      } else {
        let minX = w, minY = h, maxX = 0, maxY = 0;
        for (const v of p) { minX = Math.min(minX, v.x); minY = Math.min(minY, v.y); maxX = Math.max(maxX, v.x); maxY = Math.max(maxY, v.y); }
        const whole = rect(minX, minY, maxX, maxY, r, w, h);
        work += area(rect(whole.x0, whole.y0, whole.x1, whole.y1, 0, w, h, 1)) * 34;
        for (let i = 0; i < Math.max(1, p.length - 1); i++) work += area(rect(p[i].x, p[i].y,
          p[Math.min(i + 1, p.length - 1)].x, p[Math.min(i + 1, p.length - 1)].y, r, w, h)) * 5;
        dabs.push({ b: whole }); totalDabs++;
        check(totalDabs <= LIMITS.dabs, 'Liquify dab budget exceeded', 'MANUAL_WORK_LIMIT');
      }
      return { c, r, p, dabs };
    });
    const feathered = commands.some(c => c.selection && c.selection.feather > 0);
    const selected = commands.some(c => c.selection !== null);
    // Includes caller-owned input RGBA, output, two displacement fields, weights,
    // one reusable selection mask, optional blur scratch, and the blur line prefix.
    const bytes = w * h * (20 + (selected ? 4 : 0) + (feathered ? 4 : 0)) + (Math.max(w, h) + 1) * 8 + 2097152;
    ceiling(work, bytes);
    return { plans, work, bytes, totalDabs, feathered, selected };
  }
  function edgeScale(ax, ay, bx, by) {
    const a = bx * bx + by * by;
    if (a === 0 || (ax + bx) ** 2 + (ay + by) ** 2 <= EDGE_TARGET ** 2) return 1;
    const b = 2 * (ax * bx + ay * by), c = ax * ax + ay * ay - EDGE_TARGET ** 2;
    if (c > 0) return 0; // Fail closed if Float32 error consumed the margin.
    const disc = Math.sqrt(Math.max(0, b * b - 4 * a * c));
    const root = b > 0 ? (-2 * c) / (b + disc) : (-b + disc) / (2 * a);
    return clamp(root * 0.99999, 0, 1);
  }
  function liquify(image, commands, context) {
    check(image && typeof image === 'object', 'Invalid RGBA image');
    const w = image.width, h = image.height, n = dimensions(w, h);
    check((image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray) && image.data.length === n * 4, 'Invalid RGBA image data');
    const canonical = validateLiquifyCommands(commands, context), cancelled = cancellation(context);
    cancelled();
    const prepared = plan(w, h, canonical), source = image.data;
    const output = new Uint8ClampedArray(source);
    const diagnostics = { totalSteps: prepared.totalDabs, limitedSteps: 0, skippedSteps: 0,
      maxEdgeGradient: 0, minJacobianLowerBound: 1, maxDisplacement: 0, changedPixels: 0,
      estimatedWork: prepared.work, estimatedMemoryBytes: prepared.bytes };
    if (!prepared.totalDabs) return { width: w, height: h, data: output, diagnostics };
    const dx = new Float32Array(n), dy = new Float32Array(n), weights = new Float32Array(n);
    const mask = prepared.selected ? new Float32Array(n) : null;
    const scratch = prepared.feathered ? new Float32Array(n) : null;
    let activeBox = null;
    for (const item of prepared.plans) {
      const { c, r, p, dabs } = item;
      cancelled(); if (!dabs.length) continue;
      const selected = c.selection === null ? null : rasterize(w, h, c.selection, mask, scratch, cancelled);
      for (const dab of dabs) {
        cancelled(); const b = dab.b;
        const expanded = rect(b.x0, b.y0, b.x1, b.y1, 0, w, h, 1);
        // Clear this ROI and its edge-check halo so no previous brush leaks in.
        for (let y = expanded.y0; y <= expanded.y1; y++) weights.fill(0, y * w + expanded.x0, y * w + expanded.x1 + 1);
        if (c.kind === 'push') {
          for (let y = b.y0; y <= b.y1; y++) {
            if ((y & 31) === 0) cancelled();
            for (let x = b.x0; x <= b.x1; x++) {
              const i = y * w + x;
              weights[i] = kernel((x - dab.x) ** 2 + (y - dab.y) ** 2, r) * (selected ? selected[i] : 1);
            }
          }
        } else {
          for (let s = 0; s < Math.max(1, p.length - 1); s++) {
            const a = p[s], z = p[Math.min(s + 1, p.length - 1)], box = rect(a.x, a.y, z.x, z.y, r, w, h);
            for (let y = box.y0; y <= box.y1; y++) {
              if ((y & 31) === 0) cancelled();
              for (let x = box.x0; x <= box.x1; x++) {
                const i = y * w + x, weight = kernel(segmentDistanceSquared(x, y, a, z), r) * c.strength * (selected ? selected[i] : 1);
                if (weight > weights[i]) weights[i] = weight;
              }
            }
          }
        }
        // Proposed inverse-map increments. Clipping maps to the source rectangle
        // before the common scale; the later edge proof still covers this clip.
        function vx(i, x) { return c.kind === 'restore' ? -dx[i] * weights[i] : clamp(dx[i] + dab.dx * weights[i], -x, w - 1 - x) - dx[i]; }
        function vy(i, y) { return c.kind === 'restore' ? -dy[i] * weights[i] : clamp(dy[i] + dab.dy * weights[i], -y, h - 1 - y) - dy[i]; }
        let scale = 1;
        for (let y = expanded.y0; y <= expanded.y1; y++) {
          if ((y & 31) === 0) cancelled();
          for (let x = expanded.x0; x <= expanded.x1; x++) {
            const i = y * w + x, ux = vx(i, x), uy = vy(i, y);
            if (x < expanded.x1) scale = Math.min(scale, edgeScale(dx[i + 1] - dx[i], dy[i + 1] - dy[i], vx(i + 1, x + 1) - ux, vy(i + 1, y) - uy));
            if (y < expanded.y1) scale = Math.min(scale, edgeScale(dx[i + w] - dx[i], dy[i + w] - dy[i], vx(i + w, x) - ux, vy(i + w, y + 1) - uy));
          }
        }
        if (scale < 1) diagnostics.limitedSteps++;
        if (scale < 1e-8) { diagnostics.skippedSteps++; continue; }
        for (let y = b.y0; y <= b.y1; y++) {
          if ((y & 31) === 0) cancelled();
          for (let x = b.x0; x <= b.x1; x++) {
            const i = y * w + x;
            // Read both increments before updating either field component.
            const ux = vx(i, x), uy = vy(i, y);
            dx[i] += ux * scale; dy[i] += uy * scale;
          }
        }
        activeBox = activeBox ? { x0: Math.min(activeBox.x0, expanded.x0), y0: Math.min(activeBox.y0, expanded.y0),
          x1: Math.max(activeBox.x1, expanded.x1), y1: Math.max(activeBox.y1, expanded.y1) } : expanded;
      }
    }
    if (activeBox) for (let y = activeBox.y0; y <= activeBox.y1; y++) {
      if ((y & 15) === 0) cancelled();
      for (let x = activeBox.x0; x <= activeBox.x1; x++) {
        const j = y * w + x, i = j * 4;
        if (x < w - 1) diagnostics.maxEdgeGradient = Math.max(diagnostics.maxEdgeGradient, Math.hypot(dx[j + 1] - dx[j], dy[j + 1] - dy[j]));
        if (y < h - 1) diagnostics.maxEdgeGradient = Math.max(diagnostics.maxEdgeGradient, Math.hypot(dx[j + w] - dx[j], dy[j + w] - dy[j]));
        diagnostics.maxDisplacement = Math.max(diagnostics.maxDisplacement, Math.hypot(dx[j], dy[j]));
        if ((dx[j] === 0 && dy[j] === 0) || source[i + 3] === 0) continue;
        const sx = clamp(x + dx[j], 0, w - 1), sy = clamp(y + dy[j], 0, h - 1);
        const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = sx - x0, fy = sy - y0;
        const ia = (y0 * w + x0) * 4, ib = (y0 * w + x1) * 4, ic = (y1 * w + x0) * 4, id = (y1 * w + x1) * 4;
        // Premultiplied interpolation avoids colors bleeding from transparent
        // neighbors. Destination alpha is deliberately never warped.
        const wa = (1 - fx) * (1 - fy) * source[ia + 3], wb = fx * (1 - fy) * source[ib + 3], wc = (1 - fx) * fy * source[ic + 3], wd = fx * fy * source[id + 3], alpha = wa + wb + wc + wd;
        if (alpha > 0) for (let c = 0; c < 3; c++) output[i + c] = (wa * source[ia + c] + wb * source[ib + c] + wc * source[ic + c] + wd * source[id + c]) / alpha;
        if (output[i] !== source[i] || output[i + 1] !== source[i + 1] || output[i + 2] !== source[i + 2]) diagnostics.changedPixels++;
      }
    }
    check(diagnostics.maxEdgeGradient < LIMITS.maxEdgeDisplacement, 'Liquify geometry safety check failed', 'MANUAL_GEOMETRY');
    diagnostics.minJacobianLowerBound = (1 - Math.SQRT2 * diagnostics.maxEdgeGradient) ** 2;
    cancelled(); return { width: w, height: h, data: output, diagnostics };
  }
  return Object.freeze({ LIMITS, validateSelection, rasterizeSelection, validateLiquifyCommands, liquify });
});
