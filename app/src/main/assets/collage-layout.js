/* MintCollageLayout v1. Bounded, dependency-free geometry; no pixel allocation. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (typeof define === 'function' && define.amd) define([], function () { return api; });
  else root.MintCollageLayout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LIMITS = Object.freeze({
    minCells: 2, maxCells: 4, minOutputEdge: 256, maxOutputEdge: 4096,
    maxOutputPixels: 8000000, maxPrimaryEdge: 4096, maxPrimaryPixels: 8000000,
    maxSecondaryEdge: 1024, maxSecondaryPixels: 1048576,
    maxGutter: 0.1, minPreviewEdge: 1, maxPreviewEdge: 4096,
    planningAllowanceBytes: 65536, estimatedFilterTaps: 16
  });
  const own = Function.call.bind(Object.prototype.hasOwnProperty);
  const RECIPE_KEYS = ['version', 'width', 'height', 'layout', 'gutter', 'background', 'cells'];
  const SIZE_KEYS = ['width', 'height'];
  const CELL_KEYS = ['fit', 'x', 'y'];
  const plans = new WeakSet();

  function fail(message, range) {
    const error = range ? new RangeError(message) : new TypeError(message);
    error.code = range ? 'COLLAGE_LAYOUT_LIMIT' : 'COLLAGE_LAYOUT_INVALID';
    throw error;
  }

  // Descriptor reads reject ordinary getters without invoking them. Transparent
  // Proxy reflection traps and modified JS intrinsics are outside this contract.
  function record(value, allowed, required, label) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      fail(label + ' must be a plain data record');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(label + ' has an unsafe prototype');
    const keys = Reflect.ownKeys(value);
    if (keys.length > allowed.length) fail(label + ' has unexpected fields');
    const result = Object.create(null);
    for (const key of keys) {
      if (typeof key !== 'string' || allowed.indexOf(key) < 0) fail(label + ' has an unexpected field');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !own(descriptor, 'value')) {
        fail(label + ' must contain only enumerable own data fields');
      }
      result[key] = descriptor.value;
    }
    for (const key of required) if (!own(result, key)) fail(label + ' is missing ' + key);
    return result;
  }

  function array(value, label) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      fail(label + ' must be a local ordinary dense array');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (!descriptor || !own(descriptor, 'value')) fail(label + ' has an invalid length');
    const length = integer(descriptor.value, LIMITS.minCells, LIMITS.maxCells, label + ' length');
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1) fail(label + ' must be dense and have no extra fields');
    const result = [];
    for (let i = 0; i < length; i++) {
      const entry = Object.getOwnPropertyDescriptor(value, String(i));
      if (!entry || !entry.enumerable || !own(entry, 'value')) fail(label + ' contains a hole or accessor');
      result.push(entry.value);
    }
    return result;
  }

  function finite(value, min, max, label) {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(label + ' must be a finite primitive number');
    if (value < min || value > max) fail(label + ' is outside its permitted range', true);
    return value === 0 ? 0 : value;
  }

  function integer(value, min, max, label) {
    finite(value, min, max, label);
    if (!Number.isSafeInteger(value)) fail(label + ' must be an integer', true);
    return value === 0 ? 0 : value;
  }

  function dimensions(width, height, min, edge, pixels, label) {
    integer(width, min, edge, label + ' width');
    integer(height, min, edge, label + ' height');
    if (width * height > pixels) fail(label + ' exceeds its pixel budget', true);
    return Object.freeze({ width: width, height: height });
  }

  function defaults(count) {
    if (count === undefined) count = 2;
    integer(count, LIMITS.minCells, LIMITS.maxCells, 'Cell count');
    const cells = [];
    for (let i = 0; i < count; i++) cells.push(Object.freeze({ fit: 'fill', x: 0.5, y: 0.5 }));
    return Object.freeze({ version: 1, width: 1600, height: 1600, layout: 'grid', gutter: 0.02,
      background: Object.freeze({ color: '#ffffff', opacity: 1 }), cells: Object.freeze(cells) });
  }

  function validate(value) {
    const input = record(value, RECIPE_KEYS, RECIPE_KEYS, 'Collage recipe');
    if (input.version !== 1) fail('Unsupported collage recipe version');
    dimensions(input.width, input.height, LIMITS.minOutputEdge, LIMITS.maxOutputEdge,
      LIMITS.maxOutputPixels, 'Authored output');
    if (input.layout !== 'horizontal' && input.layout !== 'vertical' && input.layout !== 'grid') {
      fail('Unsupported collage layout');
    }
    const gutter = finite(input.gutter, 0, LIMITS.maxGutter, 'Gutter');
    const background = record(input.background, ['color', 'opacity'], ['color', 'opacity'], 'Background');
    if (typeof background.color !== 'string' || background.color.length !== 7 || !/^#[0-9a-fA-F]{6}$/.test(background.color)) {
      fail('Background color must contain exactly six hexadecimal RGB digits');
    }
    const opacity = finite(background.opacity, 0, 1, 'Background opacity');
    const cells = array(input.cells, 'Cells').map(function (value, i) {
      const cell = record(value, CELL_KEYS, CELL_KEYS, 'Cell ' + i);
      if (cell.fit !== 'fit' && cell.fit !== 'fill') fail('Cell ' + i + ' fit must be fit or fill');
      return Object.freeze({ fit: cell.fit, x: finite(cell.x, 0, 1, 'Cell ' + i + ' x'),
        y: finite(cell.y, 0, 1, 'Cell ' + i + ' y') });
    });
    return Object.freeze({ version: 1, width: input.width, height: input.height, layout: input.layout,
      gutter: gutter, background: Object.freeze({ color: background.color.toLowerCase(), opacity: opacity }),
      cells: Object.freeze(cells) });
  }

  function sourceSizes(value, count) {
    const values = array(value, 'Source sizes');
    if (values.length !== count) fail('Source count must match the cell count');
    return values.map(function (value, i) {
      const size = record(value, SIZE_KEYS, SIZE_KEYS, 'Source ' + i);
      return dimensions(size.width, size.height, 1,
        i === 0 ? LIMITS.maxPrimaryEdge : LIMITS.maxSecondaryEdge,
        i === 0 ? LIMITS.maxPrimaryPixels : LIMITS.maxSecondaryPixels, 'Source ' + i);
    });
  }

  function previewOptions(value) {
    const input = record(value === undefined ? {} : value, ['maxSide'], [], 'Plan options');
    return own(input, 'maxSide') ? integer(input.maxSide, LIMITS.minPreviewEdge,
      LIMITS.maxPreviewEdge, 'Preview maxSide') : null;
  }

  function rectangle(x, y, width, height) {
    return Object.freeze({ x: x === 0 ? 0 : x, y: y === 0 ? 0 : y, width: width, height: height });
  }

  // All pixels in an integer split are assigned, left/top first on a remainder.
  function split(total, count) {
    if (!Number.isSafeInteger(total) || total < count) fail('Output is too small for nonempty collage cells', true);
    const quotient = Math.floor(total / count), remainder = total % count, result = [];
    for (let i = 0; i < count; i++) result.push(quotient + (i < remainder ? 1 : 0));
    return result;
  }

  function grid(width, height, gutter, count, layout) {
    const contentWidth = width - 2 * gutter, contentHeight = height - 2 * gutter;
    if (contentWidth < 1 || contentHeight < 1) fail('Outer gutter leaves no cell area', true);
    const result = [];
    if (layout === 'horizontal' || layout === 'vertical') {
      const horizontal = layout === 'horizontal';
      const sizes = split((horizontal ? contentWidth : contentHeight) - (count - 1) * gutter, count);
      let start = gutter;
      for (const size of sizes) {
        result.push(horizontal ? rectangle(start, gutter, size, contentHeight) :
          rectangle(gutter, start, contentWidth, size));
        start += size + gutter;
      }
      return result;
    }
    const widths = split(contentWidth - gutter, 2);
    const right = 2 * gutter + widths[0];
    if (count === 2) {
      return [rectangle(gutter, gutter, widths[0], contentHeight),
        rectangle(right, gutter, widths[1], contentHeight)];
    }
    const heights = split(contentHeight - gutter, 2);
    const bottom = 2 * gutter + heights[0];
    if (count === 3) {
      return [rectangle(gutter, gutter, widths[0], contentHeight),
        rectangle(right, gutter, widths[1], heights[0]), rectangle(right, bottom, widths[1], heights[1])];
    }
    return [rectangle(gutter, gutter, widths[0], heights[0]),
      rectangle(right, gutter, widths[1], heights[0]),
      rectangle(gutter, bottom, widths[0], heights[1]), rectangle(right, bottom, widths[1], heights[1])];
  }

  function fitCell(source, box, recipe) {
    let sourceRect, destinationRect;
    // Integer cross products avoid an avoidable aspect-ratio rounding decision.
    const sourceIsWider = source.width * box.height > source.height * box.width;
    if (recipe.fit === 'fill') {
      let width = source.width, height = source.height;
      if (sourceIsWider) width = source.height * box.width / box.height;
      else height = source.width * box.height / box.width;
      sourceRect = rectangle((source.width - width) * recipe.x, (source.height - height) * recipe.y, width, height);
      destinationRect = rectangle(box.x, box.y, box.width, box.height);
    } else {
      let width = box.width, height = box.height;
      if (sourceIsWider) height = box.width * source.height / source.width;
      else width = box.height * source.width / source.height;
      sourceRect = rectangle(0, 0, source.width, source.height);
      // Fit is always centered; focus is validated but intentionally unused.
      destinationRect = rectangle(box.x + (box.width - width) / 2, box.y + (box.height - height) / 2, width, height);
    }
    return Object.freeze({ sourceRect: sourceRect, destinationRect: destinationRect,
      cellRect: rectangle(box.x, box.y, box.width, box.height) });
  }

  function estimates(sizes, recipe, output, boxes) {
    let sourcePixels = 0, cellPixels = 0;
    for (const size of sizes) sourcePixels += size.width * size.height;
    for (const box of boxes) cellPixels += box.width * box.height;
    const authoredPixels = recipe.width * recipe.height, outputPixels = output.width * output.height;
    return Object.freeze({ authoredPixels: authoredPixels, authoredOutputBytes: authoredPixels * 4,
      outputPixels: outputPixels, sourcePixels: sourcePixels, cellPixels: cellPixels,
      sourceBytes: sourcePixels * 4, outputBytes: outputPixels * 4,
      residentRgbaBytes: 4 * (sourcePixels + outputPixels),
      extraBytes: LIMITS.planningAllowanceBytes + 4 * (2 * sourcePixels + 3 * outputPixels),
      workPixels: sourcePixels + outputPixels + LIMITS.estimatedFilterTaps * cellPixels });
  }

  function plan(sizesValue, recipeValue, optionsValue) {
    // Never let a small preview bypass the full authored output/source limits.
    const recipe = validate(recipeValue);
    const sizes = sourceSizes(sizesValue, recipe.cells.length);
    const maxSide = previewOptions(optionsValue);
    let width = recipe.width, height = recipe.height;
    if (maxSide !== null && maxSide < Math.max(width, height)) {
      const scale = maxSide / Math.max(width, height);
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }
    const output = Object.freeze({ width: width, height: height });
    const gutter = Math.round(Math.min(width, height) * recipe.gutter);
    const boxes = grid(width, height, gutter, recipe.cells.length, recipe.layout);
    const cells = boxes.map(function (box, i) { return fitCell(sizes[i], box, recipe.cells[i]); });
    const result = Object.freeze({ outputSize: output, gutterPixels: gutter, cells: Object.freeze(cells),
      estimates: estimates(sizes, recipe, output, boxes) });
    plans.add(result);
    return result;
  }

  function hitTest(value, pointValue) {
    if (!value || typeof value !== 'object' || !plans.has(value)) fail('Hit test requires a plan from this module instance');
    const point = record(pointValue, ['x', 'y'], ['x', 'y'], 'Hit test point');
    // Outside finite points are valid queries, not clamped to the nearest cell.
    const x = finite(point.x, -Number.MAX_VALUE, Number.MAX_VALUE, 'Point x');
    const y = finite(point.y, -Number.MAX_VALUE, Number.MAX_VALUE, 'Point y');
    if (x < 0 || x >= 1 || y < 0 || y >= 1) return null;
    const width = value.outputSize.width, height = value.outputSize.height;
    for (let i = 0; i < value.cells.length; i++) {
      const box = value.cells[i].cellRect;
      // Compare in the public normalized coordinate space. Multiplying a point
      // such as 85/261 back into pixels can round just below its inclusive edge.
      if (x >= box.x / width && x < (box.x + box.width) / width &&
          y >= box.y / height && y < (box.y + box.height) / height) return i;
    }
    return null;
  }

  return Object.freeze({ LIMITS: LIMITS, defaults: defaults, validate: validate, plan: plan, hitTest: hitTest });
});
