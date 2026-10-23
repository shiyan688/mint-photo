/* MintPaintLayer v1: bounded, photo-independent transparent Canvas paint layers. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (typeof define === 'function' && define.amd) define([], function () { return api; });
  else root.MintPaintLayer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LIMITS = Object.freeze({ maxStrokes: 128, maxPointsPerStroke: 1024,
    maxTotalPoints: 8192, maxPixels: 8000000, maxEdge: 4096,
    minWidth: 0.002, maxWidth: 0.12, maxTilePixels: 1000000,
    maxEraseWorkPixels: 32000000 });
  const RECIPE_KEYS = ['version', 'strokes'];
  const STROKE_KEYS = ['mode', 'color', 'width', 'opacity', 'points'];
  const POINT_KEYS = ['x', 'y'];
  const OPTION_KEYS = ['createCanvas', 'shouldCancel'];
  const own = Function.call.bind(Object.prototype.hasOwnProperty);
  // Weak references enforce the factory's single-owner contract without retaining layers.
  const issued = new WeakSet();

  function invalid(message) {
    const error = new TypeError(message);
    error.code = 'PAINT_LAYER_INVALID';
    throw error;
  }
  function limit(message) {
    const error = new RangeError(message);
    error.code = 'PAINT_LAYER_LIMIT';
    throw error;
  }
  function canvasError(message) {
    const error = new TypeError(message);
    error.code = 'PAINT_LAYER_CANVAS';
    throw error;
  }

  // Never read recipe properties through ordinary property access. Accessor
  // descriptors are rejected without executing the getter or setter.
  function record(value, keys, required, label) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(label + ' must be a plain data record');
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) invalid(label + ' has an unsafe prototype');
    const names = Reflect.ownKeys(value), out = Object.create(null);
    if (names.length > keys.length) invalid(label + ' contains unexpected fields');
    for (const key of names) {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !keys.includes(key) || !d || !d.enumerable || !own(d, 'value')) {
        invalid(label + ' contains an unexpected, hidden, or accessor field');
      }
      out[key] = d.value;
    }
    for (const key of required) if (!own(out, key)) invalid(label + ' is missing ' + key);
    return out;
  }

  function denseArray(value, maximum, label) {
    if (!Array.isArray(value)) invalid(label + ' must be an array');
    const proto = Object.getPrototypeOf(value);
    if (proto !== Array.prototype && proto !== null) invalid(label + ' has an unsafe prototype');
    const length = Object.getOwnPropertyDescriptor(value, 'length');
    if (!length || !own(length, 'value') || !Number.isSafeInteger(length.value) || length.value < 0) invalid(label + ' has an invalid length');
    if (length.value > maximum) limit(label + ' exceeds its item budget');
    const count = length.value, names = Reflect.ownKeys(value);
    if (names.length !== count + 1) invalid(label + ' must be dense with no extra fields');
    const out = new Array(count);
    for (const key of names) {
      if (key === 'length') continue;
      if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)) invalid(label + ' contains an unexpected field');
      const index = Number(key), d = Object.getOwnPropertyDescriptor(value, key);
      if (!Number.isSafeInteger(index) || index >= count || String(index) !== key ||
          !d || !d.enumerable || !own(d, 'value')) invalid(label + ' contains a missing, hidden, or accessor item');
      out[index] = d.value;
    }
    return out;
  }

  function number(value, minimum, maximum, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) limit(label + ' is out of range');
    return value === 0 ? 0 : value; // Canonicalize negative zero.
  }

  function defaults() {
    return Object.freeze({ version: 1, strokes: Object.freeze([]) });
  }

  function validate(value) {
    if (value === null || value === undefined) return defaults();
    const recipe = record(value, RECIPE_KEYS, RECIPE_KEYS, 'Paint recipe');
    if (recipe.version !== 1) invalid('Unsupported paint recipe version');
    const input = denseArray(recipe.strokes, LIMITS.maxStrokes, 'Paint strokes');
    let totalPoints = 0;
    const strokes = input.map(function (value) {
      const stroke = record(value, STROKE_KEYS, STROKE_KEYS, 'Paint stroke');
      if (stroke.mode !== 'paint' && stroke.mode !== 'erase') invalid('Paint mode must be paint or erase');
      if (typeof stroke.color !== 'string' || stroke.color.length !== 7 || !/^#[0-9a-fA-F]{6}$/.test(stroke.color)) invalid('Paint color must be #rrggbb');
      const width = number(stroke.width, LIMITS.minWidth, LIMITS.maxWidth, 'Paint width');
      const opacity = number(stroke.opacity, 0, 1, 'Paint opacity');
      const inputPoints = denseArray(stroke.points, LIMITS.maxPointsPerStroke, 'Paint points');
      if (inputPoints.length === 0) invalid('Every paint stroke needs at least one point');
      totalPoints += inputPoints.length;
      if (totalPoints > LIMITS.maxTotalPoints) limit('Paint recipe exceeds its total point budget');
      const points = inputPoints.map(function (value) {
        const p = record(value, POINT_KEYS, POINT_KEYS, 'Paint point');
        return Object.freeze({ x: number(p.x, 0, 1, 'Paint point x'), y: number(p.y, 0, 1, 'Paint point y') });
      });
      return Object.freeze({ mode: stroke.mode, color: stroke.color.toLowerCase(), width, opacity, points: Object.freeze(points) });
    });
    return Object.freeze({ version: 1, strokes: Object.freeze(strokes) });
  }

  function hasPaint(recipe) {
    return validate(recipe).strokes.some(function (stroke) { return stroke.mode === 'paint' && stroke.opacity > 0; });
  }

  function options(value) {
    const out = record(value === undefined ? {} : value, OPTION_KEYS, [], 'Paint options');
    for (const key of OPTION_KEYS) if (own(out, key) && typeof out[key] !== 'function') invalid(key + ' must be a function');
    return { createCanvas: own(out, 'createCanvas') ? out.createCanvas : defaultCanvas,
      shouldCancel: own(out, 'shouldCancel') ? out.shouldCancel : null };
  }

  function dimensions(width, height) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
        width > LIMITS.maxEdge || height > LIMITS.maxEdge || width * height > LIMITS.maxPixels) {
      limit('Paint layer dimensions exceed the integer edge or pixel budget');
    }
  }

  function prepare(width, height, snapshot) {
    let totalPoints = 0, eraseWorkPixels = 0, eraseTileCount = 0, maxTilePixels = 0;
    const tileEdge = Math.floor(Math.sqrt(LIMITS.maxTilePixels));
    const tileWidth = Math.min(width, tileEdge), tileHeight = Math.min(height, tileEdge);
    const bounds = snapshot.strokes.map(function (stroke) {
      totalPoints += stroke.points.length;
      if (stroke.mode !== 'erase' || stroke.opacity === 0) return null;
      let minX = width, minY = height, maxX = 0, maxY = 0;
      for (const point of stroke.points) {
        const x = point.x * (width - 1), y = point.y * (height - 1);
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
      // Round caps/joins extend at most radius; two extra pixels conservatively
      // include antialias coverage. Right/bottom are exclusive pixel edges.
      const margin = stroke.width * Math.min(width, height) / 2 + 2;
      const left = Math.max(0, Math.floor(minX - margin));
      const top = Math.max(0, Math.floor(minY - margin));
      const right = Math.min(width, Math.ceil(maxX + margin));
      const bottom = Math.min(height, Math.ceil(maxY + margin));
      const w = right - left, h = bottom - top;
      eraseWorkPixels += w * h;
      if (eraseWorkPixels > LIMITS.maxEraseWorkPixels) limit('Paint erasure exceeds its cumulative pixel-work budget');
      eraseTileCount += Math.ceil(w / tileWidth) * Math.ceil(h / tileHeight);
      maxTilePixels = tileWidth * tileHeight;
      return { left, top, width: w, height: h, tileWidth, tileHeight };
    });
    return { bounds, tileWidth, tileHeight, metadata: Object.freeze({ width, height, pixels: width * height,
      strokeCount: snapshot.strokes.length, totalPoints, eraseWorkPixels,
      eraseTileCount, maxTilePixels }) };
  }

  function plan(width, height, recipe) {
    dimensions(width, height);
    return prepare(width, height, validate(recipe)).metadata;
  }

  function cancelled(opt) {
    const check = opt.shouldCancel;
    if (check && check()) {
      const error = new Error('Paint layer rendering cancelled');
      error.name = 'AbortError';
      error.code = 'PAINT_LAYER_CANCELLED';
      throw error;
    }
  }

  function dispose(canvas) {
    if (!canvas) return;
    // Try both, even if a platform throws on one setter. Never mask the cause.
    try { canvas.width = 0; } catch (_) {}
    try { canvas.height = 0; } catch (_) {}
    // Some native Canvas shims replace zero by their 350x150 defaults. A 1x1
    // fallback releases the large backing store without promising native GC.
    try { if (canvas.width !== 0) canvas.width = 1; } catch (_) {}
    try { if (canvas.height !== 0) canvas.height = 1; } catch (_) {}
  }

  function defaultCanvas(width, height) {
    let canvas;
    try {
      if (typeof document !== 'undefined' && document && typeof document.createElement === 'function') {
        canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
      } else if (typeof OffscreenCanvas === 'function') {
        canvas = new OffscreenCanvas(width, height);
      } else canvasError('No Canvas factory available; pass createCanvas(width, height)');
      return canvas;
    } catch (error) { dispose(canvas); throw error; }
  }

  function context(canvas, width, height) {
    if (!canvas || (typeof canvas !== 'object' && typeof canvas !== 'function') ||
        canvas.width !== width || canvas.height !== height || typeof canvas.getContext !== 'function') {
      canvasError('createCanvas must return a fresh canvas with the requested dimensions');
    }
    const ctx = canvas.getContext('2d');
    const required = ['save', 'restore', 'setTransform', 'clearRect', 'setLineDash', 'beginPath', 'moveTo', 'lineTo', 'arc', 'fill', 'stroke', 'getImageData', 'putImageData'];
    if (!ctx || !required.every(function (key) { return typeof ctx[key] === 'function'; })) canvasError('Canvas 2D drawing context is unavailable or incomplete');
    return ctx;
  }

  function allocate(width, height, opt) {
    let canvas, owned = false;
    try {
      canvas = opt.createCanvas(width, height);
      if (!canvas || (typeof canvas !== 'object' && typeof canvas !== 'function')) canvasError('Canvas factory did not return a canvas');
      if (issued.has(canvas)) canvasError('Canvas factory must return a new, unshared canvas for every render');
      issued.add(canvas); owned = true;
      return { canvas, ctx: context(canvas, width, height) };
    } catch (error) {
      if (owned) dispose(canvas);
      throw error;
    }
  }

  function neutral(ctx, width, height) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    if ('filter' in ctx) ctx.filter = 'none';
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.clearRect(0, 0, width, height);
  }

  function drawStroke(ctx, width, height, stroke, mask) {
    if (stroke.opacity === 0) return;
    const points = stroke.points, first = points[0];
    const px = function (p) { return p.x * (width - 1); };
    const py = function (p) { return p.y * (height - 1); };
    const firstX = px(first), firstY = py(first);
    const diameter = stroke.width * Math.min(width, height);
    const dot = points.every(function (p) { return px(p) === firstX && py(p) === firstY; });
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = mask ? 1 : stroke.opacity;
    ctx.lineWidth = diameter;
    ctx.strokeStyle = mask ? '#000000' : stroke.color;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    if (dot) {
      ctx.arc(firstX, firstY, diameter / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.moveTo(firstX, firstY);
      for (let i = 1; i < points.length; i++) ctx.lineTo(px(points[i]), py(points[i]));
      // One native draw for the entire gesture, not a series of alpha stamps.
      ctx.stroke();
    }
  }

  function imageData(ctx, x, y, width, height) {
    const image = ctx.getImageData(x, y, width, height);
    if (!image || image.width !== width || image.height !== height || !image.data ||
        !ArrayBuffer.isView(image.data) || image.data.BYTES_PER_ELEMENT !== 1 ||
        image.data.length !== width * height * 4) canvasError('Canvas returned invalid RGBA8 ImageData');
    return image;
  }

  function eraseStroke(ctx, width, height, stroke, bounds, opt, allocated) {
    if (!bounds) return;
    for (let offset = 0; offset < bounds.height; offset += bounds.tileHeight) {
      for (let column = 0; column < bounds.width; column += bounds.tileWidth) {
        cancelled(opt);
        const tileWidth = Math.min(bounds.tileWidth, bounds.width - column);
        const tileHeight = Math.min(bounds.tileHeight, bounds.height - offset);
        const left = bounds.left + column, top = bounds.top + offset;
        const mask = allocated.ctx;
        mask.save();
        try {
          // Keep the viewport dimensions constant, even for the last short
          // tile. Only the active region is read/written. One mask is reused.
          neutral(mask, bounds.tileWidth, bounds.tileHeight);
          // Every tile draws the identical complete path once at an integer
          // translation. It is not a chain of overlapping alpha stamps.
          mask.setTransform(1, 0, 0, 1, -left, -top);
          drawStroke(mask, width, height, stroke, true);
        } finally { mask.restore(); }
        cancelled(opt);
        const coverage = imageData(mask, 0, 0, tileWidth, tileHeight);
        const destination = imageData(ctx, left, top, tileWidth, tileHeight);
        const data = destination.data, alpha = coverage.data;
        for (let index = 3; index < data.length; index += 4) {
          const next = Math.round(data[index] * (1 - stroke.opacity * alpha[index] / 255));
          data[index] = next;
          if (next === 0) data[index - 3] = data[index - 2] = data[index - 1] = 0;
        }
        cancelled(opt);
        // putImageData ignores transforms/compositing/globalAlpha, so alpha is
        // applied exactly once, including on backends with destination-out bugs.
        ctx.putImageData(destination, left, top);
      }
    }
  }

  function renderLayer(width, height, recipe, opts) {
    // All untrusted recipe validation and budgets precede any allocation.
    dimensions(width, height);
    const snapshot = validate(recipe), opt = options(opts);
    const prepared = prepare(width, height, snapshot);
    cancelled(opt);
    let canvas, mask;
    try {
      const allocated = allocate(width, height, opt);
      canvas = allocated.canvas;
      const ctx = allocated.ctx;
      ctx.save();
      try {
        neutral(ctx, width, height);
        for (let index = 0; index < snapshot.strokes.length; index++) {
          cancelled(opt);
          const stroke = snapshot.strokes[index];
          if (stroke.mode === 'erase') {
            if (prepared.bounds[index]) {
              if (!mask) mask = allocate(prepared.tileWidth, prepared.tileHeight, opt);
              eraseStroke(ctx, width, height, stroke, prepared.bounds[index], opt, mask);
            }
          } else drawStroke(ctx, width, height, stroke, false);
        }
      } finally { ctx.restore(); }
      // No partially completed or stale result becomes caller-owned.
      cancelled(opt);
      if (canvas.width !== width || canvas.height !== height) canvasError('Canvas dimensions changed during rendering');
      return canvas;
    } catch (error) {
      dispose(canvas);
      throw error;
    } finally { if (mask) dispose(mask.canvas); }
  }

  return Object.freeze({ version: 1, LIMITS, defaults, validate, hasPaint, plan, renderLayer });
});
