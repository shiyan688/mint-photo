/* Bounded Canvas text overlay, version 1. No fonts, network, or external assets.
 * Recipe coordinates are normalized to the image: x/y are the center anchor,
 * size is relative to the shorter edge, and boxWidth is relative to image width.
 * Positive rotation is clockwise in Canvas image coordinates. Alignment moves
 * lines inside the centered box, never the anchor. Generic system fonts can vary
 * across operating systems; cross-OS pixel equality is deliberately not promised.
 *
 * layout(ctx,w,h,recipe) measures/wraps at canonical min-edge 1024, THEN scales
 * all geometry to image pixels. Same-aspect preview/export use identical breaks.
 * It returns {width,height,fontSize,lineHeight,boxWidth,anchor,rotation,radians,
 * font,lines,boxBounds,bounds,corners,shadow}. Each line is {text,width,x,y}; x/y
 * are local, unrotated left/alphabetic-baseline coordinates relative to anchor.
 * boxBounds is the centered logical line box. bounds unions it with measured
 * ink, outline, and a bounded UI shadow margin (2 * blur); corners is that bounds
 * rectangle transformed clockwise to image pixels, ordered TL,TR,BR,BL.
 * Render uses source-over, a round outline behind the fill, and a fixed shadow:
 * rgba(0,0,0,.55), blur .08*fontSize, offset (.04,.06)*fontSize. Canvas shadow
 * units are output pixels. Text may extend beyond the box if one grapheme is
 * wider than it; text is not clipped to the box. Canvas clips to the image.
 *
 * validate returns a fresh ordinary data snapshot. Only plain/null-prototype,
 * own enumerable data records are accepted. Text rejects malformed surrogates
 * and C0/C1 controls except LF; explicit LF and graphemes are preserved. Existing
 * Intl.Segmenter is used when available, with a combining/ZWJ/emoji fallback.
 * Empty text or opacity 0 makes no draw calls. All validation, measurement and
 * wrap limits are checked before the first draw. Runtime Canvas failures can
 * still leave a partial drawing: callers MUST render onto a disposable copy and
 * publish it only on success. Context state is restored even when rendering fails.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MintTextOverlay = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const LIMITS = Object.freeze({ text: 500, explicitLines: 12, wrappedLines: 128,
    edge: 16384, pixels: 67108864, canonicalMinEdge: 1024 });
  const FIELDS = ['version', 'text', 'x', 'y', 'size', 'boxWidth', 'rotation', 'align',
    'fontFamily', 'bold', 'italic', 'lineHeight', 'color', 'opacity', 'outlineWidth', 'outlineColor', 'shadow'];
  const FONTS = Object.freeze({ sans: 'sans-serif', serif: 'serif', mono: 'monospace' });
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  function check(ok, message) {
    if (!ok) { const error = new TypeError(message); error.code = 'TEXT_OVERLAY_INVALID'; throw error; }
  }
  function record(value) {
    check(value !== null && typeof value === 'object' && !Array.isArray(value), 'Text recipe must be plain data');
    const proto = Object.getPrototypeOf(value);
    check(proto === Object.prototype || proto === null, 'Invalid text recipe prototype');
    const keys = Reflect.ownKeys(value), out = Object.create(null);
    check(keys.length === FIELDS.length, 'Missing or unexpected text recipe fields');
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      check(typeof key === 'string' && FIELDS.includes(key) && descriptor && descriptor.enumerable &&
        own(descriptor, 'value'), 'Unexpected, hidden, or accessor text recipe field');
      out[key] = descriptor.value;
    }
    for (const key of FIELDS) check(own(out, key), 'Missing text recipe field: ' + key);
    return out;
  }
  function number(value, min, max, label) {
    check(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max,
      'Text ' + label + ' is out of range');
    return value === 0 ? 0 : value;
  }
  function boolean(value, label) { check(typeof value === 'boolean', 'Text ' + label + ' must be boolean'); return value; }
  function choice(value, options, label) { check(options.includes(value), 'Invalid text ' + label); return value; }
  function color(value, label) { check(typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value), 'Invalid text ' + label); return value; }
  function text(value) {
    check(typeof value === 'string', 'Text must be a string');
    // A UTF-16 budget bounds validation even for hostile, very large input.
    check(value.length <= LIMITS.text * 2, 'Text code point limit exceeded');
    let points = 0, lines = 1;
    for (let i = 0; i < value.length; i++) {
      const unit = value.charCodeAt(i);
      check(unit === 10 || (unit >= 32 && (unit < 127 || unit > 159)), 'Text contains a control character');
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(++i);
        check(next >= 0xdc00 && next <= 0xdfff, 'Text contains invalid Unicode');
      } else check(unit < 0xdc00 || unit > 0xdfff, 'Text contains invalid Unicode');
      if (unit === 10) lines++;
      check(++points <= LIMITS.text, 'Text code point limit exceeded');
    }
    check(lines <= LIMITS.explicitLines, 'Text explicit line limit exceeded');
    return value;
  }
  function defaults() {
    return { version: 1, text: '', x: .5, y: .5, size: .08, boxWidth: .9, rotation: 0,
      align: 'center', fontFamily: 'sans', bold: true, italic: false, lineHeight: 1.25,
      color: '#ffffff', opacity: 1, outlineWidth: 0, outlineColor: '#000000', shadow: false };
  }
  function validate(value) {
    const r = record(value);
    check(r.version === 1, 'Unsupported text recipe version');
    return { version: 1, text: text(r.text), x: number(r.x, 0, 1, 'x'), y: number(r.y, 0, 1, 'y'),
      size: number(r.size, .01, .5, 'size'), boxWidth: number(r.boxWidth, .05, 1, 'boxWidth'),
      rotation: number(r.rotation, -180, 180, 'rotation'), align: choice(r.align, ['left', 'center', 'right'], 'alignment'),
      fontFamily: choice(r.fontFamily, ['sans', 'serif', 'mono'], 'font family'), bold: boolean(r.bold, 'bold'),
      italic: boolean(r.italic, 'italic'), lineHeight: number(r.lineHeight, 1, 2.5, 'lineHeight'),
      color: color(r.color, 'color'), opacity: number(r.opacity, 0, 1, 'opacity'),
      outlineWidth: number(r.outlineWidth, 0, .15, 'outlineWidth'), outlineColor: color(r.outlineColor, 'outline color'),
      shadow: boolean(r.shadow, 'shadow') };
  }
  function isActive(value) { const r = validate(value); return r.text.length > 0 && r.opacity > 0; }
  function dimensions(width, height) {
    check(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 &&
      width <= LIMITS.edge && height <= LIMITS.edge && width * height <= LIMITS.pixels,
    'Invalid or oversized text overlay dimensions');
  }
  let segmenter;
  let mark;
  try { mark = new RegExp('\\p{Mark}', 'u'); } catch (_) { mark = /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/; }
  function graphemes(value) {
    if (typeof Intl === 'object' && typeof Intl.Segmenter === 'function') {
      if (!segmenter) segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      return Array.from(segmenter.segment(value), part => part.segment);
    }
    const result = [];
    let regional = 0, join = false;
    for (const char of Array.from(value)) {
      const point = char.codePointAt(0), isRegional = point >= 0x1f1e6 && point <= 0x1f1ff;
      const extend = mark.test(char) || (point >= 0xfe00 && point <= 0xfe0f) ||
        (point >= 0xe0100 && point <= 0xe01ef) || (point >= 0x1f3fb && point <= 0x1f3ff) ||
        (point >= 0xe0020 && point <= 0xe007f);
      if (result.length && (extend || point === 0x200d || join || (isRegional && regional % 2 === 1)))
        result[result.length - 1] += char;
      else result.push(char);
      join = point === 0x200d;
      regional = isRegional ? regional + 1 : 0;
    }
    return result;
  }
  function font(recipe, size) {
    return (recipe.italic ? 'italic ' : 'normal ') + (recipe.bold ? '700 ' : '400 ') + size + 'px ' + FONTS[recipe.fontFamily];
  }
  function textState(ctx, value) {
    ctx.font = value; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    if ('direction' in ctx) ctx.direction = 'ltr';
    if ('fontKerning' in ctx) ctx.fontKerning = 'normal';
    if ('fontStretch' in ctx) ctx.fontStretch = 'normal';
    if ('fontVariantCaps' in ctx) ctx.fontVariantCaps = 'normal';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    if ('wordSpacing' in ctx) ctx.wordSpacing = '0px';
  }
  function context(ctx, drawing) {
    const required = ['save', 'restore', 'measureText'];
    if (drawing) required.push('setTransform', 'translate', 'rotate', 'fillText', 'strokeText');
    check(ctx && required.every(name => typeof ctx[name] === 'function'), 'A Canvas 2D context is required');
  }
  function bounds(left, top, right, bottom) {
    return { x: left, y: top, width: right - left, height: bottom - top, left, top, right, bottom };
  }
  function layoutRecipe(ctx, width, height, r) {
    dimensions(width, height); context(ctx, false);
    const scale = Math.min(width, height) / LIMITS.canonicalMinEdge;
    const size = r.size * LIMITS.canonicalMinEdge, boxWidth = r.boxWidth * (width / scale);
    const lineHeight = size * r.lineHeight, wrapped = [], cache = new Map();
    const measure = value => {
      if (cache.has(value)) return cache.get(value);
      const metrics = ctx.measureText(value);
      check(metrics && typeof metrics.width === 'number' && Number.isFinite(metrics.width) && metrics.width >= 0,
        'Invalid Canvas text metrics');
      // Browser differences in optional ink metrics must not make layout unusable.
      const fallback = (field, replacement) => typeof metrics[field] === 'number' && Number.isFinite(metrics[field]) ? metrics[field] : replacement;
      const result = { width: metrics.width, left: fallback('actualBoundingBoxLeft', 0),
        right: fallback('actualBoundingBoxRight', metrics.width), ascent: fallback('actualBoundingBoxAscent', size * .8),
        descent: fallback('actualBoundingBoxDescent', size * .2) };
      cache.set(value, result); return result;
    };
    function push(value) {
      check(wrapped.length < LIMITS.wrappedLines, 'Text wrapped line limit exceeded');
      wrapped.push(value);
    }
    ctx.save();
    try {
      textState(ctx, font(r, size));
      // Greedy, word-friendly wrapping. Whitespace is preserved rather than
      // silently removed, and a single oversized grapheme remains indivisible.
      if (r.text.length) for (const paragraph of r.text.split('\n')) {
        if (!paragraph.length) { push(''); continue; }
        const parts = graphemes(paragraph);
        let start = 0;
        while (start < parts.length) {
          let end = start, lastBreak = -1, candidate = '';
          while (end < parts.length) {
            const next = candidate + parts[end];
            if (measure(next).width > boxWidth && end > start) break;
            candidate = next; end++;
            if (/\s$/u.test(parts[end - 1])) lastBreak = end;
            if (measure(candidate).width > boxWidth) break;
          }
          if (end < parts.length && lastBreak > start) end = lastBreak;
          push(parts.slice(start, end).join('')); start = end;
        }
      }
      const ref = measure('Mg'), ascent = Math.max(0, ref.ascent), descent = Math.max(0, ref.descent);
      const heightOfBox = wrapped.length * lineHeight, left = -boxWidth / 2, top = -heightOfBox / 2;
      const lines = [];
      let minX = left, minY = top, maxX = -left, maxY = -top;
      for (let i = 0; i < wrapped.length; i++) {
        const m = measure(wrapped[i]), x = r.align === 'left' ? left : r.align === 'right' ? -left - m.width : -m.width / 2;
        const y = top + (lineHeight - ascent - descent) / 2 + ascent + i * lineHeight;
        lines.push({ text: wrapped[i], width: m.width * scale, x: x * scale, y: y * scale });
        if (wrapped[i].length) {
          minX = Math.min(minX, x - m.left); maxX = Math.max(maxX, x + m.right);
          minY = Math.min(minY, y - m.ascent); maxY = Math.max(maxY, y + m.descent);
        }
      }
      const stroke = size * r.outlineWidth / 2;
      minX -= stroke; minY -= stroke; maxX += stroke; maxY += stroke;
      const shadow = { blur: r.shadow ? size * scale * .08 : 0,
        offsetX: r.shadow ? size * scale * .04 : 0, offsetY: r.shadow ? size * scale * .06 : 0,
        color: r.shadow ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0)' };
      if (r.shadow) {
        minX += Math.min(0, size * (.04 - .16)); minY += Math.min(0, size * (.06 - .16));
        maxX += Math.max(0, size * (.04 + .16)); maxY += Math.max(0, size * (.06 + .16));
      }
      const local = bounds(minX * scale, minY * scale, maxX * scale, maxY * scale);
      const anchor = { x: r.x * width, y: r.y * height }, radians = r.rotation * Math.PI / 180;
      const cosine = Math.cos(radians), sine = Math.sin(radians);
      const corners = [[local.left, local.top], [local.right, local.top], [local.right, local.bottom], [local.left, local.bottom]]
        .map(([x, y]) => ({ x: anchor.x + x * cosine - y * sine, y: anchor.y + x * sine + y * cosine }));
      return { width, height, fontSize: size * scale, lineHeight: lineHeight * scale, boxWidth: boxWidth * scale,
        anchor, rotation: r.rotation, radians, font: font(r, size * scale), lines,
        boxBounds: bounds(left * scale, top * scale, -left * scale, -top * scale), bounds: local, corners, shadow };
    } finally { ctx.restore(); }
  }
  function layout(ctx, width, height, recipe) { return layoutRecipe(ctx, width, height, validate(recipe)); }
  function render(ctx, width, height, recipe) {
    const r = validate(recipe);
    context(ctx, true);
    const plan = layoutRecipe(ctx, width, height, r);
    if (!r.text.length || r.opacity === 0) return plan;
    ctx.save();
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.translate(plan.anchor.x, plan.anchor.y); ctx.rotate(plan.radians);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = r.opacity;
      if ('filter' in ctx) ctx.filter = 'none';
      textState(ctx, plan.font); ctx.fillStyle = r.color; ctx.strokeStyle = r.outlineColor;
      ctx.lineWidth = Math.max(Number.MIN_VALUE, plan.fontSize * r.outlineWidth); ctx.lineJoin = 'round';
      ctx.shadowColor = plan.shadow.color; ctx.shadowBlur = plan.shadow.blur;
      ctx.shadowOffsetX = plan.shadow.offsetX; ctx.shadowOffsetY = plan.shadow.offsetY;
      for (const line of plan.lines) {
        if (!line.text.length) continue;
        if (r.outlineWidth > 0) ctx.strokeText(line.text, line.x, line.y);
        ctx.fillText(line.text, line.x, line.y);
      }
      return plan;
    } finally { ctx.restore(); }
  }
  return Object.freeze({ LIMITS, defaults, validate, isActive, layout, render });
});
