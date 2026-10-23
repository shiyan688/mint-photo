'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const core = require('../app/src/main/assets/collage-layout.js');
const script = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/collage-layout.js'), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const recipe = (count = 2, values = {}) => Object.assign(copy(core.defaults(count)), values);
const sizes = count => Array.from({ length: count }, () => ({ width: 600, height: 400 }));
const invalid = fn => assert.throws(fn, error => error instanceof TypeError && error.code === 'COLLAGE_LAYOUT_INVALID');
const limited = fn => assert.throws(fn, error => error instanceof RangeError && error.code === 'COLLAGE_LAYOUT_LIMIT');
const close = (actual, expected, message = '') => assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)),
  message + ': ' + actual + ' != ' + expected);

function frozenTree(value) {
  assert.ok(Object.isFrozen(value));
  for (const field of Object.values(value)) if (field && typeof field === 'object') frozenTree(field);
}

function without(value, field) {
  const result = copy(value); delete result[field]; return result;
}

function assertRect(rect, outer, integer = false) {
  for (const value of Object.values(rect)) assert.ok(Number.isFinite(value));
  assert.ok(rect.width > 0 && rect.height > 0);
  assert.ok(rect.x >= outer.x - 1e-9 && rect.y >= outer.y - 1e-9);
  assert.ok(rect.x + rect.width <= outer.x + outer.width + 1e-9);
  assert.ok(rect.y + rect.height <= outer.y + outer.height + 1e-9);
  if (integer) for (const value of Object.values(rect)) assert.ok(Number.isInteger(value));
}

function invariants(p, sources, r) {
  const output = { x: 0, y: 0, ...p.outputSize };
  assert.equal(p.cells.length, sources.length);
  assert.ok(p.outputSize.width <= r.width && p.outputSize.height <= r.height);
  assert.equal(p.gutterPixels, Math.round(Math.min(p.outputSize.width, p.outputSize.height) * r.gutter));
  for (let i = 0; i < p.cells.length; i++) {
    const { cellRect: box, sourceRect: s, destinationRect: d } = p.cells[i];
    assertRect(box, output, true);
    assertRect(d, box);
    assertRect(s, { x: 0, y: 0, ...sources[i] });
    close(s.width * d.height, s.height * d.width, 'No source stretching');
    assert.ok(box.x >= p.gutterPixels && box.y >= p.gutterPixels);
    assert.ok(box.x + box.width <= p.outputSize.width - p.gutterPixels);
    assert.ok(box.y + box.height <= p.outputSize.height - p.gutterPixels);
    if (r.cells[i].fit === 'fit') {
      assert.deepEqual(s, { x: 0, y: 0, ...sources[i] });
      close(d.x + d.width / 2, box.x + box.width / 2, 'Fit centered horizontally');
      close(d.y + d.height / 2, box.y + box.height / 2, 'Fit centered vertically');
    } else {
      assert.deepEqual(d, box);
      close(s.x, (sources[i].width - s.width) * r.cells[i].x, 'Fill horizontal focus');
      close(s.y, (sources[i].height - s.height) * r.cells[i].y, 'Fill vertical focus');
    }
    assert.equal(core.hitTest(p, { x: (box.x + box.width / 2) / output.width,
      y: (box.y + box.height / 2) / output.height }), i);
    for (let j = 0; j < i; j++) {
      const other = p.cells[j].cellRect;
      assert.ok(box.x >= other.x + other.width || other.x >= box.x + box.width ||
        box.y >= other.y + other.height || other.y >= box.y + box.height, 'Cells may not overlap');
    }
  }
  assert.equal(p.estimates.sourcePixels, sources.reduce((sum, source) => sum + source.width * source.height, 0));
  assert.equal(p.estimates.outputPixels, output.width * output.height);
  assert.equal(p.estimates.authoredPixels, r.width * r.height);
  assert.ok(p.estimates.cellPixels <= p.estimates.outputPixels);
  assert.ok(p.estimates.extraBytes >= p.estimates.residentRgbaBytes);
  frozenTree(p);
}

test('UMD exports identical API shape to CommonJS, AMD and browser global without DOM', () => {
  const global = vm.createContext({});
  vm.runInContext(script, global);
  assert.deepEqual(Object.keys(global.MintCollageLayout), Object.keys(core));
  assert.ok(Object.isFrozen(global.MintCollageLayout));
  let amd;
  const define = (dependencies, factory) => { assert.deepEqual(Array.from(dependencies), []); amd = factory(); };
  define.amd = {};
  vm.runInNewContext(script, { define });
  assert.deepEqual(Object.keys(amd), Object.keys(core));
  assert.deepEqual(copy(amd.defaults()), copy(core.defaults()));
});

test('defaults and public limit snapshots are exact, frozen and independent', () => {
  assert.deepEqual(core.defaults(), { version: 1, width: 1600, height: 1600, layout: 'grid', gutter: 0.02,
    background: { color: '#ffffff', opacity: 1 }, cells: [{ fit: 'fill', x: 0.5, y: 0.5 }, { fit: 'fill', x: 0.5, y: 0.5 }] });
  assert.deepEqual(core.LIMITS, { minCells: 2, maxCells: 4, minOutputEdge: 256, maxOutputEdge: 4096,
    maxOutputPixels: 8000000, maxPrimaryEdge: 4096, maxPrimaryPixels: 8000000, maxSecondaryEdge: 1024,
    maxSecondaryPixels: 1048576, maxGutter: 0.1, minPreviewEdge: 1, maxPreviewEdge: 4096,
    planningAllowanceBytes: 65536, estimatedFilterTaps: 16 });
  frozenTree(core.LIMITS);
  for (const count of [2, 3, 4]) {
    const a = core.defaults(count), b = core.defaults(count);
    frozenTree(a);
    assert.equal(a.cells.length, count);
    assert.notEqual(a, b); assert.notEqual(a.background, b.background); assert.notEqual(a.cells, b.cells);
    assert.notEqual(a.cells[0], b.cells[0]); assert.notEqual(a.cells[0], a.cells[1]);
  }
  assert.deepEqual(core.defaults(undefined), core.defaults());
  for (const value of [0, 1, 5, 2.5]) limited(() => core.defaults(value));
  for (const value of [null, '2', NaN, Infinity, {}, 2n]) invalid(() => core.defaults(value));
});

test('validation copies and freezes every recipe node without changing input', () => {
  const value = recipe(3); value.background.color = '#AbCdEf'; value.cells[0].x = -0;
  const before = copy(value), result = core.validate(value), again = core.validate(result);
  assert.deepEqual(copy(value), before);
  assert.equal(result.background.color, '#abcdef');
  assert.equal(Object.is(result.cells[0].x, -0), false);
  assert.notEqual(result, value); assert.notEqual(result, again);
  assert.notEqual(result.background, value.background); assert.notEqual(result.cells[0], value.cells[0]);
  assert.notEqual(result.cells[0], again.cells[0]); frozenTree(result); frozenTree(again);
  value.width = 300; value.background.opacity = 0; value.cells[0].x = 0;
  assert.equal(result.width, 1600); assert.equal(result.background.opacity, 1); assert.equal(result.cells[0].x, 0);
  assert.throws(() => { result.cells[0].x = 1; }, TypeError);
  assert.throws(() => { core.LIMITS.maxOutputPixels = Infinity; }, TypeError);
});

test('null-prototype own-data records are accepted at every record boundary', () => {
  const r = recipe(2);
  r.background = Object.assign(Object.create(null), r.background);
  r.cells = r.cells.map(c => Object.assign(Object.create(null), c));
  const s = sizes(2).map(v => Object.assign(Object.create(null), v));
  const p = core.plan(s, Object.assign(Object.create(null), r), Object.assign(Object.create(null), { maxSide: 200 }));
  assert.equal(p.outputSize.width, 200);
  assert.equal(core.hitTest(p, Object.assign(Object.create(null), { x: 0.25, y: 0.5 })), 0);
});

test('recipe and nested fields are mandatory, exact, enumerable and own data', () => {
  const r = recipe();
  for (const key of Object.keys(r)) invalid(() => core.validate(without(r, key)));
  for (const key of Object.keys(r.background)) {
    const value = recipe(); delete value.background[key]; invalid(() => core.validate(value));
  }
  for (const key of Object.keys(r.cells[0])) {
    const value = recipe(); delete value.cells[0][key]; invalid(() => core.validate(value));
  }
  for (const modify of [
    value => { value.extra = 1; }, value => { value.background.extra = 1; }, value => { value.cells[0].extra = 1; },
    value => { value[Symbol('unknown')] = 1; }, value => { value.background[Symbol('unknown')] = 1; },
    value => { Object.defineProperty(value, 'width', { enumerable: false, value: 1600 }); },
    value => { Object.defineProperty(value.cells[0], 'x', { enumerable: false, value: 0.5 }); },
    value => { Object.defineProperty(value.background, 'opacity', { enumerable: false, value: 1 }); }
  ]) { const value = recipe(); modify(value); invalid(() => core.validate(value)); }
  for (const value of [undefined, null, [], () => {}, new Date(), new Number(1)]) invalid(() => core.validate(value));
});

test('own and inherited record getters never run, including optional preview maxSide', () => {
  let calls = 0;
  const getter = () => { calls++; throw new Error('Getter executed'); };
  const ownGetter = (object, key) => { Object.defineProperty(object, key, { enumerable: true, configurable: true, get: getter }); return object; };
  for (const key of ['version', 'width', 'layout', 'background', 'cells']) invalid(() => core.validate(ownGetter(recipe(), key)));
  for (const location of ['background', 'cell']) {
    const r = recipe(); ownGetter(location === 'background' ? r.background : r.cells[0], location === 'background' ? 'opacity' : 'x');
    invalid(() => core.validate(r));
  }
  const inherited = Object.create(Object.defineProperty({}, 'maxSide', { get: getter }));
  invalid(() => core.plan(sizes(2), recipe(), inherited));
  invalid(() => core.plan(sizes(2), recipe(), ownGetter({}, 'maxSide')));
  const p = core.plan(sizes(2), recipe());
  invalid(() => core.hitTest(p, ownGetter({ x: 0.5, y: 0.5 }, 'x')));
  const inheritedPoint = Object.create(Object.defineProperty({}, 'x', { get: getter })); inheritedPoint.y = 0.5;
  invalid(() => core.hitTest(p, inheritedPoint));
  const inheritedRecipe = Object.create(Object.defineProperty({}, 'width', { get: getter }));
  Object.assign(inheritedRecipe, without(recipe(), 'width')); invalid(() => core.validate(inheritedRecipe));
  const source = sizes(2); ownGetter(source[1], 'height'); invalid(() => core.plan(source, recipe()));
  // An optional property on Object.prototype is neither read nor used as a default.
  Object.defineProperty(Object.prototype, 'maxSide', { configurable: true, get: getter });
  try { assert.equal(core.plan(sizes(2), recipe(), {}).outputSize.width, 1600); }
  finally { delete Object.prototype.maxSide; }
  assert.equal(calls, 0);
});

test('custom prototypes, classes and foreign-realm records/arrays are rejected', () => {
  class Recipe {}
  invalid(() => core.validate(Object.assign(new Recipe(), recipe())));
  invalid(() => core.validate(Object.assign(Object.create({}), recipe())));
  const r = recipe(); r.background = Object.assign(Object.create({}), r.background); invalid(() => core.validate(r));
  const r2 = recipe(); r2.cells[0] = Object.assign(Object.create({}), r2.cells[0]); invalid(() => core.validate(r2));
  invalid(() => core.validate(vm.runInNewContext('(' + JSON.stringify(recipe()) + ')')));
  const foreignCells = recipe(); foreignCells.cells = vm.runInNewContext('(' + JSON.stringify(foreignCells.cells) + ')');
  invalid(() => core.validate(foreignCells));
});

test('dense arrays cannot contain holes, getters, symbols, extras or custom prototypes', () => {
  let calls = 0;
  for (const modify of [
    arr => { delete arr[0]; }, arr => { arr.extra = true; }, arr => { arr[Symbol('extra')] = true; },
    arr => { Object.defineProperty(arr, '0', { enumerable: true, get() { calls++; return {}; } }); },
    arr => { Object.defineProperty(arr, '0', { enumerable: false, value: arr[0] }); },
    arr => { Object.setPrototypeOf(arr, Object.create(Array.prototype)); }
  ]) {
    const r = recipe(); modify(r.cells); invalid(() => core.validate(r));
    const s = sizes(2); modify(s); invalid(() => core.plan(s, recipe()));
  }
  assert.equal(calls, 0);
  for (const count of [0, 1, 5]) {
    const r = recipe(); r.cells = Array.from({ length: count }, () => ({ fit: 'fill', x: 0.5, y: 0.5 }));
    limited(() => core.validate(r)); limited(() => core.plan(sizes(count), recipe()));
  }
  const r = recipe(); r.cells = { 0: r.cells[0], 1: r.cells[1], length: 2 }; invalid(() => core.validate(r));
  invalid(() => core.plan({ 0: sizes(2)[0], 1: sizes(2)[1], length: 2 }, recipe()));
});

test('background alpha is explicit, strict and preserved even at zero opacity', () => {
  for (const opacity of [0, 0.125, 0.5, 1]) assert.equal(core.validate(recipe(2, { background: { color: '#a0B1c2', opacity } })).background.opacity, opacity);
  for (const color of ['#fff', '#ffffffff', '#ffffff\n', '#ffffff\r', 'red', 'transparent', '#gg0000', '', 0, null, new String('#ffffff')]) {
    invalid(() => core.validate(recipe(2, { background: { color, opacity: 0 } })));
  }
  for (const opacity of [-0.001, 1.001]) limited(() => core.validate(recipe(2, { background: { color: '#ffffff', opacity } })));
  for (const opacity of [undefined, null, '1', NaN, Infinity]) invalid(() => core.validate(recipe(2, { background: { color: '#ffffff', opacity } })));
  const r = recipe(2, { background: { color: '#ffffff', opacity: 0 } }); r.cells[0].x = NaN;
  invalid(() => core.validate(r));
});

test('invalid schema enums and finite primitive constraints are never coerced', () => {
  for (const version of [0, 2, '1', NaN, null]) invalid(() => core.validate(recipe(2, { version })));
  for (const layout of ['rows', 'GRID', null, {}, ['grid']]) invalid(() => core.validate(recipe(2, { layout })));
  for (const fit of ['contain', 'cover', null, true]) { const r = recipe(); r.cells[0].fit = fit; invalid(() => core.validate(r)); }
  for (const field of ['width', 'height', 'gutter']) {
    for (const value of [NaN, Infinity, -Infinity, null, '256', new Number(256)]) invalid(() => core.validate(recipe(2, { [field]: value })));
  }
  for (const field of ['x', 'y']) {
    for (const value of [NaN, Infinity, null, '0.5']) { const r = recipe(); r.cells[0][field] = value; invalid(() => core.validate(r)); }
    for (const value of [-0.001, 1.001]) { const r = recipe(); r.cells[0][field] = value; limited(() => core.validate(r)); }
  }
  for (const gutter of [-0.001, 0.10001]) limited(() => core.validate(recipe(2, { gutter })));
});

test('full authored edge/pixel budgets are enforced before preview planning', () => {
  for (const width of [255, 4097, 256.5]) limited(() => core.validate(recipe(2, { width })));
  for (const height of [255, 4097, 256.5]) limited(() => core.validate(recipe(2, { height })));
  limited(() => core.plan(sizes(2), recipe(2, { width: 4096, height: 4096 }), { maxSide: 64 }));
  limited(() => core.plan(sizes(2), recipe(2, { width: 4000, height: 2001 }), { maxSide: 64 }));
  // An invalid authored size wins even if all later arguments are hostile.
  let calls = 0;
  const options = Object.defineProperty({}, 'maxSide', { enumerable: true, get() { calls++; return 10; } });
  limited(() => core.plan(null, recipe(2, { width: 4096, height: 4096 }), options));
  assert.equal(calls, 0);
  const exact = core.plan(sizes(2), recipe(2, { width: 4000, height: 2000 }));
  assert.equal(exact.estimates.outputPixels, 8000000);
  assert.equal(exact.estimates.outputBytes, 32000000);
  assert.deepEqual(core.plan(sizes(2), recipe(2, { width: 4096, height: 1953 })).outputSize, { width: 4096, height: 1953 });
});

test('source records enforce first 8MP/4096 and secondary 1MP/1024 limits', () => {
  const accepted = [{ width: 4000, height: 2000 }, { width: 1024, height: 1024 }, { width: 1024, height: 1 }, { width: 1, height: 1024 }];
  const p = core.plan(accepted, recipe(4)); assert.equal(p.estimates.sourcePixels, 8000000 + 1048576 + 2048);
  for (const bad of [{ width: 4096, height: 4096 }, { width: 4097, height: 1 }, { width: 4000, height: 2001 }, { width: 0, height: 1 }, { width: 1.5, height: 1 }]) {
    limited(() => core.plan([bad, { width: 1, height: 1 }], recipe(), { maxSide: 64 }));
  }
  for (const bad of [{ width: 1025, height: 1 }, { width: 1, height: 1025 }, { width: 1024, height: 1025 }]) {
    limited(() => core.plan([{ width: 1, height: 1 }, bad], recipe()));
  }
  for (const bad of [{ width: NaN, height: 1 }, { width: 1, height: '1' }, { width: 1 }, { width: 1, height: 1, uri: 'x' }, null]) {
    invalid(() => core.plan([{ width: 1, height: 1 }, bad], recipe()));
  }
  invalid(() => core.plan(sizes(3), recipe(2)));
  invalid(() => core.plan(sizes(2), recipe(3)));
  const s = sizes(2); Object.defineProperty(s[1], 'width', { value: 600, enumerable: false }); invalid(() => core.plan(s, recipe()));
});

test('preview options are exact optional own integer fields; downscale only', () => {
  const r = recipe(2, { width: 1601, height: 901, gutter: 0 });
  assert.deepEqual(core.plan(sizes(2), r).outputSize, { width: 1601, height: 901 });
  assert.deepEqual(core.plan(sizes(2), r, {}).outputSize, { width: 1601, height: 901 });
  assert.deepEqual(core.plan(sizes(2), r, { maxSide: 4096 }).outputSize, { width: 1601, height: 901 });
  assert.deepEqual(core.plan(sizes(2), r, { maxSide: 500 }).outputSize, { width: 500, height: 281 });
  for (const maxSide of [0, 4097, 1.5]) limited(() => core.plan(sizes(2), r, { maxSide }));
  for (const maxSide of [undefined, null, '500', NaN, Infinity]) invalid(() => core.plan(sizes(2), r, { maxSide }));
  for (const value of [null, [], false, { extra: 1 }, { maxSide: 500, extra: 1 }, { [Symbol('maxSide')]: 500 }]) {
    invalid(() => core.plan(sizes(2), r, value));
  }
  invalid(() => core.plan(sizes(2), r, Object.defineProperty({}, 'maxSide', { enumerable: false, value: 500 })));
});

test('horizontal/vertical splits assign every odd remaining pixel with exact outer and inner gutters', () => {
  for (const count of [2, 3, 4]) {
    for (const layout of ['horizontal', 'vertical']) {
      const r = recipe(count, { width: 513, height: 509, gutter: 0.02, layout });
      const p = core.plan(sizes(count), r); invariants(p, sizes(count), r);
      const horizontal = layout === 'horizontal', dimension = horizontal ? 'width' : 'height', axis = horizontal ? 'x' : 'y';
      const sum = p.cells.reduce((sum, c) => sum + c.cellRect[dimension], 0);
      assert.equal(sum + (count + 1) * p.gutterPixels, p.outputSize[dimension]);
      assert.equal(p.cells[0].cellRect[axis], p.gutterPixels);
      for (let i = 1; i < count; i++) assert.equal(p.cells[i].cellRect[axis],
        p.cells[i - 1].cellRect[axis] + p.cells[i - 1].cellRect[dimension] + p.gutterPixels);
      assert.ok(p.cells[0].cellRect[dimension] - p.cells[count - 1].cellRect[dimension] <= 1);
    }
  }
});

test('two-cell grid is two columns, four-cell grid is row-major 2x2', () => {
  const r = recipe(2, { width: 513, height: 509, gutter: 0 });
  assert.deepEqual(core.plan(sizes(2), r).cells.map(c => c.cellRect), [
    { x: 0, y: 0, width: 257, height: 509 }, { x: 257, y: 0, width: 256, height: 509 }
  ]);
  const r4 = recipe(4, { width: 513, height: 509, gutter: 0 });
  assert.deepEqual(core.plan(sizes(4), r4).cells.map(c => c.cellRect), [
    { x: 0, y: 0, width: 257, height: 255 }, { x: 257, y: 0, width: 256, height: 255 },
    { x: 0, y: 255, width: 257, height: 254 }, { x: 257, y: 255, width: 256, height: 254 }
  ]);
});

test('three-cell grid has full-height left cell and two stacked right cells without a blank fourth slot', () => {
  const r = recipe(3, { width: 513, height: 509, gutter: 0 });
  const p = core.plan(sizes(3), r);
  assert.deepEqual(p.cells.map(c => c.cellRect), [
    { x: 0, y: 0, width: 257, height: 509 }, { x: 257, y: 0, width: 256, height: 255 },
    { x: 257, y: 255, width: 256, height: 254 }
  ]);
  assert.equal(p.estimates.cellPixels, 513 * 509);
  assert.equal(core.hitTest(p, { x: 0.25, y: 0.9 }), 0);
  assert.equal(core.hitTest(p, { x: 0.75, y: 0.9 }), 2);
  const guttered = core.plan(sizes(3), recipe(3, { width: 513, height: 509, gutter: 0.02 }));
  const [left, top, bottom] = guttered.cells.map(c => c.cellRect), g = guttered.gutterPixels;
  assert.equal(left.height + 2 * g, 509);
  assert.equal(top.height + bottom.height + 3 * g, 509);
  assert.equal(left.width + top.width + 3 * g, 513);
  assert.equal(bottom.width, top.width); assert.equal(bottom.x, top.x);
});

test('fill uses continuous pixel-edge source crops and exact neutral focus', () => {
  const s = [{ width: 1200, height: 400 }, { width: 200, height: 800 }];
  const r = recipe(2, { width: 800, height: 800, gutter: 0 });
  const p = core.plan(s, r);
  assert.deepEqual(p.cells[0].sourceRect, { x: 500, y: 0, width: 200, height: 400 });
  assert.deepEqual(p.cells[1].sourceRect, { x: 0, y: 200, width: 200, height: 400 });
  assert.deepEqual(p.cells[0].destinationRect, { x: 0, y: 0, width: 400, height: 800 });
  for (const focus of [0, 0.25, 0.5, 0.75, 1]) {
    for (const cell of r.cells) cell.x = cell.y = focus;
    const q = core.plan(s, r);
    assert.equal(q.cells[0].sourceRect.x, 1000 * focus);
    assert.equal(q.cells[1].sourceRect.y, 400 * focus);
    invariants(q, s, r);
  }
  const fraction = core.plan([{ width: 1000, height: 333 }, { width: 333, height: 1000 }],
    recipe(2, { width: 801, height: 799, gutter: 0 }));
  assert.ok(!Number.isInteger(fraction.cells[0].sourceRect.width));
});

test('fit shows full source in centered aspect-preserving letterbox regardless of focus', () => {
  const s = [{ width: 1200, height: 400 }, { width: 200, height: 800 }];
  const r = recipe(2, { width: 800, height: 800, gutter: 0 });
  r.cells[0] = { fit: 'fit', x: 0, y: 1 }; r.cells[1] = { fit: 'fit', x: 1, y: 0 };
  const p = core.plan(s, r);
  assert.deepEqual(p.cells[0].sourceRect, { x: 0, y: 0, width: 1200, height: 400 });
  close(p.cells[0].destinationRect.height, 400 / 3);
  close(p.cells[0].destinationRect.y, (800 - 400 / 3) / 2);
  assert.deepEqual(p.cells[1].destinationRect, { x: 500, y: 0, width: 200, height: 800 });
  invariants(p, s, r);
  const changed = copy(r); for (const c of changed.cells) c.x = c.y = 0.5;
  assert.deepEqual(core.plan(s, changed), p);
  // A letterboxed part of a cell still selects that cell, not just image pixels.
  assert.equal(core.hitTest(p, { x: 0.25, y: 0.01 }), 0);
});

test('exact source/cell aspect produces no crop and no letterbox for either fit mode', () => {
  const s = [{ width: 400, height: 800 }, { width: 200, height: 400 }];
  for (const fit of ['fit', 'fill']) {
    const r = recipe(2, { width: 800, height: 800, gutter: 0 }); for (const c of r.cells) c.fit = fit;
    const p = core.plan(s, r);
    for (let i = 0; i < 2; i++) {
      assert.deepEqual(p.cells[i].sourceRect, { x: 0, y: 0, ...s[i] });
      assert.deepEqual(p.cells[i].destinationRect, p.cells[i].cellRect);
    }
  }
});

test('impossible tiny preview cells fail safely, while the smallest possible layouts remain valid', () => {
  for (const count of [2, 3, 4]) for (const layout of ['horizontal', 'vertical', 'grid']) {
    limited(() => core.plan(sizes(count), recipe(count, { layout }), { maxSide: 1 }));
  }
  const r = recipe(4, { gutter: 0, layout: 'grid' });
  const p = core.plan(sizes(4), r, { maxSide: 2 });
  assert.deepEqual(p.outputSize, { width: 2, height: 2 });
  for (const cell of p.cells) assert.equal(cell.cellRect.width * cell.cellRect.height, 1);
  limited(() => core.plan(sizes(4), recipe(4, { gutter: 0, layout: 'horizontal' }), { maxSide: 3 }));
  const strip = core.plan(sizes(2), recipe(2, { width: 4096, height: 256, gutter: 0 }), { maxSide: 2 });
  assert.deepEqual(strip.outputSize, { width: 2, height: 1 });
  // Rounded gutters can make an otherwise sufficient 4px strip impossible.
  limited(() => core.plan(sizes(4), recipe(4, { gutter: 0.1, layout: 'horizontal' }), { maxSide: 5 }));
});

test('hit tests are half-open, index-valued, strict and null in gutters/outside', () => {
  const p = core.plan(sizes(2), recipe(2, { width: 800, height: 800, gutter: 0.1 }));
  assert.equal(core.hitTest(p, { x: 0, y: 0.5 }), null);
  assert.equal(core.hitTest(p, { x: 0.5, y: 0.5 }), null);
  assert.equal(core.hitTest(p, { x: 0.1, y: 0.1 }), 0);
  assert.equal(core.hitTest(p, { x: 0.45, y: 0.5 }), null);
  assert.equal(core.hitTest(p, { x: 0.55, y: 0.5 }), 1);
  assert.equal(core.hitTest(p, { x: 0.9, y: 0.5 }), null);
  for (const point of [{ x: 1, y: 0.5 }, { x: -1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0.5, y: -1 }, { x: Number.MAX_VALUE, y: 0 }]) {
    assert.equal(core.hitTest(p, point), null);
  }
  const noGutter = core.plan(sizes(2), recipe(2, { width: 800, height: 800, gutter: 0 }));
  assert.equal(core.hitTest(noGutter, { x: 0.5, y: 0.5 }), 1);
  for (const point of [null, [], {}, { x: 0.5 }, { x: 0.5, y: 0.5, z: 0 }, { x: '0.5', y: 0.5 }, { x: NaN, y: 0.5 }, { x: 0.5, y: Infinity }]) {
    invalid(() => core.hitTest(p, point));
  }
  invalid(() => core.hitTest(copy(p), { x: 0.5, y: 0.5 }));
  invalid(() => core.hitTest(null, { x: 0.5, y: 0.5 }));
  let calls = 0;
  invalid(() => core.hitTest(Object.defineProperty({}, 'cells', { get() { calls++; return []; } }), { x: 0.5, y: 0.5 }));
  assert.equal(calls, 0);
});

test('plans are independent snapshots with exact accounting and no source mutation', () => {
  const r = recipe(3), s = sizes(3), before = copy({ r, s });
  const p = core.plan(s, r), q = core.plan(s, r);
  assert.deepEqual({ r, s }, before); assert.deepEqual(p, q);
  assert.notEqual(p, q); assert.notEqual(p.cells, q.cells); assert.notEqual(p.outputSize, q.outputSize);
  assert.notEqual(p.estimates, q.estimates);
  for (let i = 0; i < 3; i++) {
    assert.notEqual(p.cells[i], q.cells[i]);
    for (const key of ['sourceRect', 'destinationRect', 'cellRect']) assert.notEqual(p.cells[i][key], q.cells[i][key]);
    assert.notEqual(p.cells[i].destinationRect, p.cells[i].cellRect);
  }
  const e = p.estimates;
  assert.equal(e.extraBytes, 65536 + 2 * e.sourceBytes + 3 * e.outputBytes);
  assert.equal(e.workPixels, e.sourcePixels + e.outputPixels + 16 * e.cellPixels);
  r.width = 256; r.cells[0].x = 0; s[0].width = 1;
  assert.deepEqual(p, q); frozenTree(p);
});

test('exact normalized odd-dimension boundaries cannot round into a gutter or previous cell', () => {
  const repro = core.plan(sizes(4), recipe(4, { width: 261, height: 256, gutter: 0.1, layout: 'horizontal' }));
  assert.equal(repro.cells[1].cellRect.x, 85);
  assert.equal(core.hitTest(repro, { x: 85 / 261, y: 0.5 }), 1);
  for (let width = 256; width <= 401; width++) {
    for (const count of [2, 3, 4]) for (const layout of ['horizontal', 'vertical', 'grid']) for (const gutter of [0, 0.1]) {
      const p = core.plan(sizes(count), recipe(count, { width, height: 657 - width, layout, gutter }));
      const w = p.outputSize.width, h = p.outputSize.height;
      for (let i = 0; i < count; i++) {
        const box = p.cells[i].cellRect, centerX = (box.x + box.width / 2) / w, centerY = (box.y + box.height / 2) / h;
        assert.equal(core.hitTest(p, { x: box.x / w, y: centerY }), i, 'Inclusive left edge');
        assert.equal(core.hitTest(p, { x: centerX, y: box.y / h }), i, 'Inclusive top edge');
        assert.equal(core.hitTest(p, { x: box.x / w, y: box.y / h }), i, 'Inclusive top-left corner');
        assert.notEqual(core.hitTest(p, { x: (box.x + box.width) / w, y: centerY }), i, 'Exclusive right edge');
        assert.notEqual(core.hitTest(p, { x: centerX, y: (box.y + box.height) / h }), i, 'Exclusive bottom edge');
      }
      if (gutter === 0 && layout === 'horizontal') for (let i = 1; i < count; i++) {
        assert.equal(core.hitTest(p, { x: p.cells[i].cellRect.x / w, y: 0.5 }), i, 'Shared horizontal edge selects next cell');
      }
      if (gutter === 0 && layout === 'vertical') for (let i = 1; i < count; i++) {
        assert.equal(core.hitTest(p, { x: 0.5, y: p.cells[i].cellRect.y / h }), i, 'Shared vertical edge selects next cell');
      }
    }
  }
});

test('maximum bounded plan succeeds without typed pixels, Canvas, DOM or ArrayBuffer allocation', () => {
  const sandbox = vm.createContext({}); vm.runInContext(script, sandbox);
  const result = vm.runInContext(`
    for (const key of ['ArrayBuffer', 'Uint8Array', 'Uint8ClampedArray', 'Float64Array', 'OffscreenCanvas', 'ImageData']) {
      globalThis[key] = function () { throw new Error('Unexpected pixel/native allocation: ' + key); };
    }
    Object.defineProperty(globalThis, 'document', { get() { throw new Error('Unexpected DOM access'); } });
    const r = JSON.parse(JSON.stringify(MintCollageLayout.defaults(4)));
    r.width = 4000; r.height = 2000;
    MintCollageLayout.plan([{width:4000,height:2000}, {width:1024,height:1024},
      {width:1024,height:1024}, {width:1024,height:1024}], r);
  `, sandbox);
  assert.equal(result.estimates.authoredPixels, 8000000);
  assert.equal(result.estimates.sourcePixels, 11145728);
  assert.ok(result.estimates.extraBytes < 186000000);
});

test('3,000 seeded random layouts preserve bounds, aspect, focus, cell coverage and immutable snapshots', () => {
  let seed = 0x6d696e74;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const randomInt = (min, max) => min + Math.floor(random() * (max - min + 1));
  for (let iteration = 0; iteration < 3000; iteration++) {
    const count = randomInt(2, 4), width = randomInt(256, 2800), height = randomInt(256, 2800);
    const r = recipe(count, { width, height, layout: ['horizontal', 'vertical', 'grid'][randomInt(0, 2)], gutter: random() * 0.1,
      background: { color: '#123456', opacity: random() } });
    for (const c of r.cells) { c.fit = random() < 0.5 ? 'fit' : 'fill'; c.x = random(); c.y = random(); }
    const s = Array.from({ length: count }, (_, i) => ({ width: randomInt(1, i ? 1024 : 2800), height: randomInt(1, i ? 1024 : 2800) }));
    const p = core.plan(s, r, { maxSide: randomInt(64, 4096) });
    invariants(p, s, r);
    const g = p.gutterPixels, w = p.outputSize.width, h = p.outputSize.height;
    const expectedCells = r.layout === 'horizontal' ? (w - (count + 1) * g) * (h - 2 * g) :
      r.layout === 'vertical' ? (w - 2 * g) * (h - (count + 1) * g) :
      count === 2 ? (w - 3 * g) * (h - 2 * g) :
      count === 4 ? (w - 3 * g) * (h - 3 * g) :
      p.cells[0].cellRect.width * (h - 2 * g) + p.cells[1].cellRect.width * (h - 3 * g);
    assert.equal(p.estimates.cellPixels, expectedCells, 'No omitted content area or blank cell');
  }
});
