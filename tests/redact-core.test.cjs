'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../app/src/main/assets/redact-core.js');
function recipe(overrides = {}) { return { version: 1, mode: 'cover', blockSize: .04, color: '#123456', strokes: [], ...overrides }; }
function stroke(points = [{ x: .5, y: .5 }], radius = .1) { return { radius, points }; }
function image(width, height, array) {
  const data = array ? new Uint8ClampedArray(array) : Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => (i * 97 + 17) % 256);
  return { width, height, data };
}
function reference(input, r) {
  const { width: w, height: h, data } = input, out = new Uint8ClampedArray(data);
  const edge = Math.max(1, Math.round(Math.min(w, h) * r.blockSize));
  const colors = new Map();
  const rgb = [1, 3, 5].map(i => parseInt(r.color.slice(i, i + 2), 16));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let covered = false;
    for (const s of r.strokes) {
      const radius = s.radius * Math.min(w, h);
      const tolerance = 64 * Number.EPSILON * Math.max(1, radius * radius);
      for (let j = 0; j < Math.max(1, s.points.length - 1); j++) {
        const a = s.points[j], b = s.points[Math.min(j + 1, s.points.length - 1)];
        const ax = a.x * (w - 1), ay = a.y * (h - 1), bx = b.x * (w - 1), by = b.y * (h - 1);
        const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
        const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
        const d2 = (x - ax - dx * t) ** 2 + (y - ay - dy * t) ** 2;
        if (d2 <= radius * radius + tolerance) covered = true;
      }
    }
    if (!covered) continue;
    const i = (y * w + x) * 4;
    if (r.mode === 'cover') out.set([...rgb, 255], i);
    else if (data[i + 3]) {
      const x0 = Math.floor(x / edge) * edge, y0 = Math.floor(y / edge) * edge, key = x0 + ',' + y0;
      if (!colors.has(key)) {
        const sums = [0, 0, 0]; let alpha = 0;
        for (let sy = y0; sy < Math.min(h, y0 + edge); sy++) for (let sx = x0; sx < Math.min(w, x0 + edge); sx++) {
          const k = (sy * w + sx) * 4, a = data[k + 3]; alpha += a;
          for (let c = 0; c < 3; c++) sums[c] += data[k + c] * a;
        }
        colors.set(key, sums.map(v => Math.round(v / alpha)));
      }
      out.set(colors.get(key), i);
    }
  }
  return out;
}
let seed = 0x98ad2613;
function random() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; }

test('UMD CommonJS, global and AMD exports contain only the public API', () => {
  const code = fs.readFileSync(require.resolve('../app/src/main/assets/redact-core.js'), 'utf8');
  const context = {}; vm.runInNewContext(code, context); assert.equal(typeof context.MintRedact.apply, 'function');
  let amd; const define = (_, fn) => { amd = fn(); }; define.amd = true;
  vm.runInNewContext(code, { define }); assert.equal(typeof amd.apply, 'function');
  assert.deepEqual(Object.keys(core).sort(), ['LIMITS', 'apply', 'defaults', 'isActive', 'plan', 'validate'].sort());
  assert.ok(Object.isFrozen(core) && Object.isFrozen(core.LIMITS));
});
test('defaults are independent, complete, frozen, and strictly valid', () => {
  const a = core.defaults(), b = core.defaults();
  assert.notEqual(a, b); assert.notEqual(a.strokes, b.strokes);
  assert.deepEqual(a, { version: 1, mode: 'mosaic', blockSize: .04, color: '#173e31', strokes: [] });
  assert.deepEqual(core.validate(a), a); assert.equal(core.isActive(a), false);
});
test('canonical deep snapshot is frozen, independent and normalizes color/-0', () => {
  const r = recipe({ color: '#AABBCC', strokes: [stroke([{ x: -0, y: .5 }])] });
  const v = core.validate(r); r.color = '#000000'; r.strokes[0].points[0].y = 1;
  assert.equal(v.color, '#aabbcc'); assert.equal(v.strokes[0].points[0].y, .5); assert.equal(Object.is(v.strokes[0].points[0].x, -0), false);
  for (const o of [v, v.strokes, v.strokes[0], v.strokes[0].points, v.strokes[0].points[0]]) assert.ok(Object.isFrozen(o));
  assert.equal(core.isActive(v), true);
});
test('null-prototype own records and arrays are accepted and canonicalized', () => {
  const r = Object.assign(Object.create(null), recipe({ strokes: [stroke()] }));
  Object.setPrototypeOf(r.strokes, null); Object.setPrototypeOf(r.strokes[0], null);
  Object.setPrototypeOf(r.strokes[0].points, null); Object.setPrototypeOf(r.strokes[0].points[0], null);
  assert.equal(core.validate(r).strokes.length, 1);
});
test('strict exact recipe records reject omissions, extras, symbols, prototypes and accessors without invoking accessors', () => {
  for (const value of [null, undefined, [], 1, '', new Date(), Object.create(recipe())]) assert.throws(() => core.validate(value));
  for (const key of Object.keys(recipe())) { const r = recipe(); delete r[key]; assert.throws(() => core.validate(r)); }
  for (const key of ['extra', '__proto__', Symbol('evil')]) {
    const r = recipe(); Object.defineProperty(r, key, { value: 1, enumerable: true }); assert.throws(() => core.validate(r));
  }
  let invoked = 0;
  for (const key of Object.keys(recipe())) {
    const r = recipe(); Object.defineProperty(r, key, { get() { invoked++; throw Error('getter'); }, enumerable: true });
    assert.throws(() => core.validate(r), { code: 'REDACT_INVALID' });
  }
  const hidden = recipe(); Object.defineProperty(hidden, 'color', { value: '#000000' });
  // Redefining an existing enumerable property preserves its attribute. Force hidden.
  Object.defineProperty(hidden, 'color', { enumerable: false }); assert.throws(() => core.validate(hidden));
  assert.equal(invoked, 0);
});
test('strict stroke/point records and dense arrays reject inherited, extra and accessor data', () => {
  const invalid = [
    { radius: .1, points: [] }, { radius: .1, points: [,,] }, { radius: .1, points: [{ x: .5 }] },
    { radius: .1, points: [{ x: .5, y: .5, z: 0 }] }, { radius: .1, points: [{ x: .5, y: .5 }], opacity: 1 },
    Object.create({ radius: .1, points: [{ x: .5, y: .5 }] }),
  ];
  for (const s of invalid) assert.throws(() => core.validate(recipe({ strokes: [s] })));
  let called = 0;
  for (const target of ['array', 'stroke', 'point']) {
    const s = stroke(), r = recipe({ strokes: [s] });
    const o = target === 'array' ? s.points : target === 'stroke' ? s : s.points[0];
    const key = target === 'array' ? '0' : target === 'stroke' ? 'radius' : 'x';
    Object.defineProperty(o, key, { get() { called++; }, enumerable: true }); assert.throws(() => core.validate(r));
  }
  for (const list of [recipe().strokes, stroke().points]) { list.extra = true; assert.throws(() => core.validate(recipe({ strokes: list }))); }
  const symbol = [stroke()]; symbol[Symbol()] = 1; assert.throws(() => core.validate(recipe({ strokes: symbol })));
  assert.equal(called, 0);
});
test('numbers and enum boundaries are strict and bounded, never clamped', () => {
  for (const value of [NaN, Infinity, -Infinity, '.1', null, true, {}, new Number(.1)]) {
    assert.throws(() => core.validate(recipe({ blockSize: value })));
    assert.throws(() => core.validate(recipe({ strokes: [stroke(undefined, value)] })));
    assert.throws(() => core.validate(recipe({ strokes: [stroke([{ x: value, y: 0 }])] })));
  }
  for (const blockSize of [.0099, .2501]) assert.throws(() => core.validate(recipe({ blockSize })), { code: 'REDACT_LIMIT' });
  for (const radius of [.00199, .50001]) assert.throws(() => core.validate(recipe({ strokes: [stroke(undefined, radius)] })));
  for (const x of [-.0001, 1.0001]) assert.throws(() => core.validate(recipe({ strokes: [stroke([{ x, y: 0 }])] })));
  for (const color of ['red', '#fff', '#12345678', '#12345g', '#123456\n']) assert.throws(() => core.validate(recipe({ color })));
  for (const mode of ['paint', 'MOSAIC', null]) assert.throws(() => core.validate(recipe({ mode })));
  for (const version of [0, 2, '1']) assert.throws(() => core.validate(recipe({ version })));
  for (const radius of [.002, .5]) for (const blockSize of [.01, .25]) assert.doesNotThrow(() => core.validate(recipe({ blockSize, strokes: [stroke(undefined, radius)] })));
});
test('stroke and total-point budgets reject before oversized traversal', () => {
  assert.doesNotThrow(() => core.validate(recipe({ strokes: Array.from({ length: 64 }, () => stroke(Array.from({ length: 64 }, () => ({ x: 0, y: 0 })))) })));
  assert.throws(() => core.validate(recipe({ strokes: Array.from({ length: 65 }, () => stroke()) })), { code: 'REDACT_LIMIT' });
  assert.throws(() => core.validate(recipe({ strokes: [stroke(Array.from({ length: 4097 }, () => ({ x: 0, y: 0 })))] })), { code: 'REDACT_LIMIT' });
  assert.throws(() => core.validate(recipe({ strokes: Array.from({ length: 64 }, () => stroke(Array.from({ length: 65 }, () => ({ x: 0, y: 0 })))) })), { code: 'REDACT_LIMIT' });
});
test('dimension and source validation reject silent coercion, shared/resizable buffers and accessors', () => {
  const r = recipe();
  for (const [width, height] of [[0, 1], [1, 0], [1.5, 2], ['2', 2], [Infinity, 1], [4097, 1], [4096, 1954]]) assert.throws(() => core.plan(width, height, r));
  for (const data of [[], new Float32Array(4), new Uint16Array(4), Buffer.alloc(4), new DataView(new ArrayBuffer(4)), new Uint8Array(3)]) assert.throws(() => core.apply({ width: 1, height: 1, data }, r));
  if (typeof SharedArrayBuffer !== 'undefined') assert.throws(() => core.apply({ width: 1, height: 1, data: new Uint8Array(new SharedArrayBuffer(4)) }, r));
  if ('resizable' in ArrayBuffer.prototype) assert.throws(() => core.apply({ width: 1, height: 1, data: new Uint8Array(new ArrayBuffer(4, { maxByteLength: 8 })) }, r));
  let invoked = 0; const source = { width: 1, height: 1, get data() { invoked++; } };
  assert.throws(() => core.apply(source, r)); assert.equal(invoked, 0);
  const s = image(1, 1); s.extra = 1; assert.throws(() => core.apply(s, r));
});
test('neutral identity is exact object and buffer identity, yet still validates and checks cancel', () => {
  const s = image(3, 2), before = s.data.slice();
  assert.equal(core.apply(s, core.defaults()), s); assert.equal(core.apply(s, recipe()).data, s.data); assert.deepEqual(s.data, before);
  assert.equal(core.plan(3, 2, recipe()).workPixels, 0); assert.equal(core.plan(3, 2, recipe()).active, false);
  assert.throws(() => core.apply(s, recipe(), { shouldCancel: () => true }), { name: 'AbortError', code: 'REDACT_CANCELLED' });
});
test('cover draws exact opaque RGB over transparent source and preserves all outside bytes', () => {
  const s = image(5, 5), before = s.data.slice(); s.data.fill(0); s.data[0] = 87; s.data[1] = 29;
  const r = recipe({ strokes: [stroke([{ x: 0, y: 0 }], .2)] });
  const input = s.data.slice(), out = core.apply(s, r);
  assert.notEqual(out, s); assert.notEqual(out.data.buffer, s.data.buffer); assert.deepEqual(out.data, reference(s, r));
  for (const [x, y] of [[0, 0], [1, 0], [0, 1]]) assert.deepEqual(Array.from(out.data.slice((y * 5 + x) * 4, (y * 5 + x) * 4 + 4)), [18, 52, 86, 255]);
  assert.deepEqual(out.data.slice((1 * 5 + 1) * 4, (1 * 5 + 1) * 4 + 4), input.slice((1 * 5 + 1) * 4, (1 * 5 + 1) * 4 + 4));
  assert.deepEqual(s.data, input); assert.notDeepEqual(before, input);
});
test('hard capsules are continuous with round caps, no square or soft boundary', () => {
  const s = { width: 9, height: 9, data: new Uint8ClampedArray(9 * 9 * 4) };
  const r = recipe({ strokes: [stroke([{ x: .25, y: .5 }, { x: .75, y: .5 }], 1 / 9)] });
  const out = core.apply(s, r); const rows = [];
  for (let y = 0; y < 9; y++) { let row = ''; for (let x = 0; x < 9; x++) row += out.data[(y * 9 + x) * 4 + 3] ? '#' : '.'; rows.push(row); }
  assert.deepEqual(rows, ['.........', '.........', '.........', '..#####..', '.#######.', '..#####..', '.........', '.........', '.........']);
});
test('mosaic uses full origin-anchored cells, alpha weighting and source alpha/hidden-RGB preservation', () => {
  const s = image(8, 8); s.data.fill(0);
  s.data.set([100, 0, 0, 255], 0); s.data.set([0, 100, 0, 128], 4);
  s.data.set([0, 0, 100, 0], 8 * 4); s.data.set([100, 100, 100, 64], 9 * 4);
  const r = recipe({ mode: 'mosaic', blockSize: .25, strokes: [stroke([{ x: 0, y: 0 }], .002)] });
  const out = core.apply(s, r);
  assert.deepEqual(Array.from(out.data.slice(0, 4)), [71, 43, 14, 255]);
  assert.deepEqual(out.data.slice(4), s.data.slice(4)); // Only mask's origin pixel changed, but whole cell informed average.
  const all = core.apply(s, { ...r, strokes: [stroke([{ x: 0, y: .5 }, { x: 1, y: .5 }], .5)] });
  assert.deepEqual(Array.from(all.data.slice(4, 8)), [71, 43, 14, 128]);
  assert.deepEqual(Array.from(all.data.slice(8 * 4, 8 * 4 + 4)), [0, 0, 100, 0]);
  assert.deepEqual(Array.from(all.data.slice(9 * 4, 9 * 4 + 4)), [71, 43, 14, 64]);
  assert.deepEqual(all.data, reference(s, { ...r, strokes: [stroke([{ x: 0, y: .5 }, { x: 1, y: .5 }], .5)] }));
});
test('mosaic cell size one is identity bytes even with coverage and partial edge cells match source reference', () => {
  for (const [w, h] of [[1, 1], [1, 17], [19, 1], [7, 7], [10, 11], [21, 13]]) {
    const s = image(w, h); const r = recipe({ mode: 'mosaic', blockSize: .25, strokes: [stroke([{ x: 0, y: 0 }, { x: 1, y: 1 }], .5)] });
    assert.deepEqual(core.apply(s, r).data, reference(s, r));
    const unit = { ...r, blockSize: .01 }; assert.deepEqual(core.apply(s, unit).data, s.data);
  }
});
test('overlap, stroke ordering, duplicate points and reversals never compound or feed processed pixels back', () => {
  const s = image(53, 31);
  for (const mode of ['cover', 'mosaic']) {
    const a = stroke([{ x: .1, y: .2 }, { x: .9, y: .8 }], .2), b = stroke([{ x: .2, y: .9 }, { x: .8, y: .1 }], .08);
    const r = recipe({ mode, blockSize: .12, strokes: [a, b] });
    const expected = core.apply(s, r).data;
    assert.deepEqual(core.apply(s, { ...r, strokes: [b, a, a, b] }).data, expected);
    assert.deepEqual(core.apply(s, { ...r, strokes: [{ ...a, points: [a.points[0], a.points[0], a.points[1]] }, { ...b, points: [...b.points].reverse() }] }).data, expected);
  }
});
test('collinear event density is invariant for horizontal, vertical, diagonal, reverse and tiny-slope gestures', () => {
  const s = image(127, 97);
  for (const [a, b] of [[{ x: 0, y: .5 }, { x: 1, y: .5 }], [{ x: .5, y: 0 }, { x: .5, y: 1 }], [{ x: .02, y: .03 }, { x: .98, y: .97 }], [{ x: .1, y: .499999999999 }, { x: .9, y: .500000000001 }]]) {
    for (const mode of ['cover', 'mosaic']) for (const radius of [.002, .03, .5]) {
      const r = recipe({ mode, blockSize: .25, strokes: [stroke([a, b], radius)] });
      const baseline = core.apply(s, r).data;
      for (const count of [3, 17, 129, 4096]) {
        const points = Array.from({ length: count }, (_, i) => ({ x: a.x + (b.x - a.x) * i / (count - 1), y: a.y + (b.y - a.y) * i / (count - 1) }));
        assert.deepEqual(core.apply(s, { ...r, strokes: [stroke(points, radius)] }).data, baseline, `count=${count} mode=${mode} radius=${radius}`);
      }
    }
  }
});
test('randomized capsule raster and mosaic match independent pixel-distance reference', () => {
  for (let n = 0; n < 320; n++) {
    const w = 1 + Math.floor(random() * 45), h = 1 + Math.floor(random() * 45), s = image(w, h);
    const strokes = Array.from({ length: 1 + Math.floor(random() * 4) }, () => stroke(Array.from({ length: 1 + Math.floor(random() * 5) }, () => ({ x: random(), y: random() })), .002 + random() * .498));
    const r = recipe({ mode: n % 2 ? 'cover' : 'mosaic', blockSize: .01 + random() * .24, strokes });
    assert.deepEqual(core.apply(s, r).data, reference(s, r), `random case ${n} ${w}x${h}`);
  }
});
test('one-pixel edges and exact canvas corners clip correctly', () => {
  for (const [w, h] of [[1, 1], [1, 64], [64, 1], [8, 8]]) for (const x of [0, 1]) for (const y of [0, 1]) {
    const s = image(w, h), r = recipe({ strokes: [stroke([{ x, y }], .5)] }); assert.deepEqual(core.apply(s, r).data, reference(s, r));
  }
});
test('subnormal and near-axis slopes remain finite and correctly cover the entire capsule body', () => {
  const s = image(95, 65);
  for (const tiny of [Number.MIN_VALUE, 1e-320, 1e-200, 1e-16, 1e-12]) {
    for (const points of [
      [{ x: 0, y: 0 }, { x: 1, y: tiny }], [{ x: 0, y: 0 }, { x: tiny, y: 1 }],
      [{ x: 1, y: tiny }, { x: 0, y: 0 }], [{ x: tiny, y: 1 }, { x: 0, y: 0 }],
      [{ x: 0, y: tiny }, { x: tiny, y: 0 }],
    ]) {
      const r = recipe({ strokes: [stroke(points, .25)] });
      assert.deepEqual(core.apply(s, r).data, reference(s, r), `tiny=${tiny}`);
    }
  }
});
test('near-tangent rows never turn into falsely covered horizontal or vertical strips', () => {
  const s = image(50, 50);
  for (const delta of [-1e-6, -1e-8, -1e-10, 0, 1e-10, 1e-8, 1e-6]) {
    const coordinate = (20 + delta) / 49;
    for (const points of [[{ x: .1, y: coordinate }, { x: .9, y: coordinate }], [{ x: coordinate, y: .1 }, { x: coordinate, y: .9 }]]) {
      const r = recipe({ strokes: [stroke(points, .1)] });
      assert.deepEqual(core.apply(s, r).data, reference(s, r), `delta=${delta}`);
    }
  }
});
test('subarray offsets and own shadow getters cannot redirect typed data', () => {
  const storage = new Uint8Array(48); for (let i = 0; i < storage.length; i++) storage[i] = i;
  const data = storage.subarray(8, 40), s = { width: 4, height: 2, data }, before = storage.slice();
  let called = 0; for (const key of ['byteOffset', 'buffer', 'length']) Object.defineProperty(data, key, { get() { called++; throw Error('evil'); } });
  const r = recipe({ strokes: [stroke([{ x: 0, y: 0 }])] });
  const out = core.apply(s, r); assert.equal(out.data.length, 32); assert.equal(called, 0); assert.deepEqual(storage, before);
});
test('options are strict and cancellation at early/mid/final checkpoints never mutates source', () => {
  const s = image(220, 210), before = s.data.slice();
  const r = recipe({ mode: 'mosaic', blockSize: .25, strokes: [stroke([{ x: 0, y: 0 }, { x: 1, y: 1 }], .5)] });
  for (const value of [null, true, { other: 1 }, { shouldCancel: true }, Object.create({ shouldCancel() {} })]) assert.throws(() => core.apply(s, r, value));
  let invoked = 0; const access = {}; Object.defineProperty(access, 'shouldCancel', { get() { invoked++; }, enumerable: true });
  assert.throws(() => core.apply(s, r, access)); assert.equal(invoked, 0);
  let total = 0; core.apply(s, r, { shouldCancel() { total++; return false; } });
  for (const cancelAt of [1, 2, 4, 8, 12, 50, total]) {
    let calls = 0; assert.throws(() => core.apply(s, r, { shouldCancel() { return ++calls === cancelAt; } }), { name: 'AbortError', code: 'REDACT_CANCELLED' });
    assert.deepEqual(s.data, before);
  }
  const thrown = Error('external hook failure'); assert.throws(() => core.apply(s, r, { shouldCancel() { throw thrown; } }), e => e === thrown);
  assert.deepEqual(s.data, before);
});
test('invalid inputs and dimension errors fail before cancellation or pixel work', () => {
  let calls = 0; const shouldCancel = () => { calls++; return false; };
  assert.throws(() => core.apply(image(2, 2), { ...recipe(), mode: 'wrong' }, { shouldCancel }));
  assert.throws(() => core.apply({ width: 4096, height: 4096, data: new Uint8Array(0) }, recipe(), { shouldCancel }));
  assert.equal(calls, 0);
});
test('plan is pure, dimension-aware, consistent, frozen, and supports every legal maximum', () => {
  const r = recipe({ mode: 'mosaic', blockSize: .01, strokes: Array.from({ length: 64 }, () => stroke(Array.from({ length: 64 }, () => ({ x: .5, y: .5 })), .5)) });
  const before = JSON.stringify(r); const p = core.plan(1953, 4096, r);
  assert.equal(p.pixels, 7999488); assert.equal(p.segmentCount, 4032); assert.equal(p.workPixels, p.pixels * 3 + p.height * p.segmentCount);
  assert.ok(p.extraBytes < 128 * 1024 * 1024); assert.ok(p.workPixels < 64000000); assert.ok(Object.isFrozen(p)); assert.equal(JSON.stringify(r), before);
  for (const [w, h] of [[4096, 149], [149, 4096], [4096, 1], [1, 4096], [2828, 2828]]) {
    const p = core.plan(w, h, r); assert.ok(p.extraBytes < core.LIMITS.maxExtraBytes); assert.ok(p.workPixels < core.LIMITS.maxWorkPixels);
  }
});
test('actual full 8MP-cover allocation and cancellation after allocation remain within contract', () => {
  const s = { width: 4000, height: 2000, data: new Uint8Array(32000000) };
  const r = recipe({ strokes: [stroke([{ x: 0, y: 0 }], .002)] });
  const out = core.apply(s, r); assert.equal(out.data.length, 32000000); assert.deepEqual(Array.from(out.data.slice(0, 4)), [18, 52, 86, 255]);
  assert.equal(s.data[3], 0); assert.equal(out.data.at(-1), 0);
  let calls = 0; assert.throws(() => core.apply(s, r, { shouldCancel: () => ++calls === 6 }), { code: 'REDACT_CANCELLED' });
  assert.equal(s.data.reduce((a, b) => a + b, 0), 0);
});
