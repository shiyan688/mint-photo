'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../app/src/main/assets/mask-refine.js');
const source = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/mask-refine.js'), 'utf8');
const clone = r => JSON.parse(JSON.stringify(r));
const makeBase = (width, height, f = () => 0) => ({ width, height, data: Buffer.from(Array.from({ length: width * height }, (_, i) => f(i % width, Math.floor(i / width)))).toString('base64') });
const recipe = (base = makeBase(1, 1), fields = {}) => ({ ...core.defaults('source:original-1', base), ...fields });
const stroke = (points = [{ x: .5, y: .5 }], fields = {}) => ({ mode: 'keep', radius: .1, hardness: .5, strength: 1, points, ...fields });
const render = (r, width = 101, height = 101, options) => core.rasterize({ width, height }, r, options);
const maxDiff = (a, b) => a.reduce((d, v, i) => Math.max(d, Math.abs(v - b[i])), 0);
const aborts = f => assert.throws(f, e => e.name === 'AbortError' && e.code === 'ABORT_ERR');
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// Deliberately slow all-pixels/all-segments reference, with no production planner,
// scanline capsule bounds, monotone deque, or running-sum filtering.
function reference(width, height, r) {
  const bytes = Buffer.from(r.base.data, 'base64'), bw = r.base.width, bh = r.base.height;
  let field = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const xx = (x + .5) / width * bw - .5, yy = (y + .5) / height * bh - .5;
    const ix = Math.floor(xx), iy = Math.floor(yy), fx = xx - ix, fy = yy - iy;
    let sum = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) sum += bytes[clamp(iy + dy, 0, bh - 1) * bw + clamp(ix + dx, 0, bw - 1)] / 255 * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
    field[y * width + x] = sum;
  }
  for (const s of r.strokes) {
    const radius = s.radius * Math.min(width, height), hard = radius * s.hardness;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let best = 0;
      for (let i = 0; i < Math.max(1, s.points.length - 1); i++) {
        const a = s.points[i], b = s.points[Math.min(i + 1, s.points.length - 1)], ax = a.x * width, ay = a.y * height;
        const vx = b.x * width - ax, vy = b.y * height - ay;
        const t = vx || vy ? clamp(((x + .5 - ax) * vx + (y + .5 - ay) * vy) / (vx * vx + vy * vy), 0, 1) : 0;
        const d = Math.sqrt((x + .5 - ax - vx * t) ** 2 + (y + .5 - ay - vy * t) ** 2);
        if (d > radius) continue;
        const q = d <= hard ? 1 : (radius - d) / (radius - hard);
        best = Math.max(best, Math.fround(q * q * (3 - 2 * q)));
      }
      const i = y * width + x, coverage = best * s.strength;
      field[i] = s.mode === 'keep' ? field[i] + (1 - field[i]) * coverage : field[i] * (1 - coverage);
    }
  }
  const shifted = Math.abs(r.edgeShift) * Math.min(width, height);
  if (shifted) for (const axis of [0, 1]) {
    const n = Math.floor(shifted), f = shifted - n, next = new Float32Array(field.length);
    const at = (x, y, k) => field[clamp(y + (axis ? k : 0), 0, height - 1) * width + clamp(x + (axis ? 0 : k), 0, width - 1)];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const values = [];
      for (let k = -n; k <= n; k++) values.push(at(x, y, k));
      for (const sign of [-1, 1]) values.push(at(x, y, sign * n) * (1 - f) + at(x, y, sign * (n + 1)) * f);
      next[y * width + x] = r.edgeShift > 0 ? Math.max(...values) : Math.min(...values);
    }
    field = next;
  }
  const radius = r.feather * Math.min(width, height);
  if (radius) for (const axis of [0, 1]) {
    const n = Math.floor(radius), f = radius - n, next = new Float32Array(field.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -n - 1; k <= n + 1; k++) sum += field[clamp(y + (axis ? k : 0), 0, height - 1) * width + clamp(x + (axis ? 0 : k), 0, width - 1)] * (Math.abs(k) === n + 1 ? f : 1);
      next[y * width + x] = sum / (2 * n + 1 + 2 * f);
    }
    field = next;
  }
  return field;
}

test('dependency-free frozen UMD API works in Node and a browser realm', () => {
  assert.equal(globalThis.MintMaskRefine, core); assert.ok(Object.isFrozen(core)); assert.ok(Object.isFrozen(core.LIMITS));
  const c = vm.createContext({}); vm.runInContext(source, c);
  assert.equal(vm.runInContext('MintMaskRefine.rasterize({width:2,height:3},MintMaskRefine.defaults("s")).data.length', c), 6);
});
test('defaults and validate produce independent, portable, canonical snapshots', () => {
  const a = core.defaults('s'), b = core.defaults('s');
  assert.deepEqual(a, { version: 1, sourceRevision: 's', base: { width: 1, height: 1, data: 'AA==' }, strokes: [], edgeShift: 0, feather: 0 });
  assert.notEqual(a.base, b.base); assert.notEqual(a.strokes, b.strokes);
  const original = recipe(makeBase(2, 2, (x, y) => x * 80 + y * 20), { strokes: [stroke()] });
  const copy = core.validate(original); original.strokes[0].points[0].x = 0; original.base.data = 'AAAAAA==';
  assert.equal(copy.strokes[0].points[0].x, .5); assert.notEqual(copy.base.data, original.base.data);
  assert.deepEqual(core.validate(clone(copy)), copy);
  const nullRecord = o => Object.assign(Object.create(null), o);
  const nulls = nullRecord(copy); nulls.base = nullRecord(copy.base); nulls.strokes = copy.strokes.map(s => nullRecord({ ...s, points: s.points.map(nullRecord) }));
  assert.deepEqual(core.validate(nulls, nullRecord({ sourceRevision: copy.sourceRevision })), copy);
  assert.equal(core.validate(recipe(undefined, { edgeShift: -0 })).edgeShift, 0);
});
test('sourceRevision matching is explicit and does not mutate or substitute the stage revision', () => {
  const r = recipe(); assert.equal(core.validate(r, { sourceRevision: r.sourceRevision }).sourceRevision, r.sourceRevision);
  assert.throws(() => core.validate(r, { sourceRevision: 'new-source' }), /sourceRevision mismatch/);
  for (const sourceRevision of ['', 's'.repeat(161), null, 2]) assert.throws(() => core.validate({ ...r, sourceRevision }), /sourceRevision/);
  assert.equal(core.validate({ ...r, sourceRevision: 's'.repeat(160) }).sourceRevision.length, 160);
  assert.throws(() => core.validate(r, { sourceRevision: undefined }), /sourceRevision/);
});
test('neutral rendering preserves all 256 base confidence codes exactly in Float32', () => {
  const r = recipe(makeBase(256, 1, x => x)), before = clone(r), out = render(r, 256, 1);
  assert.deepEqual(out.data, Float32Array.from({ length: 256 }, (_, x) => x / 255));
  assert.deepEqual(r, before); assert.equal(out.diagnostics.active, false); assert.equal(out.diagnostics.scratchBytes, 0);
  out.data.fill(1); assert.deepEqual(r, before); assert.equal(render(r, 256, 1).data[0], 0);
});
test('coarse base uses pixel-center bilinear continuous confidence, never a threshold', () => {
  const r = recipe(makeBase(2, 2, (x, y) => [0, 80, 160, 255][y * 2 + x])), out = render(r, 13, 9);
  assert.ok(maxDiff(out.data, reference(13, 9, r)) <= 1e-7);
  assert.ok(new Set(out.data).size > 20); assert.equal(out.data[0], 0); assert.equal(out.data.at(-1), 1);
  assert.equal(render(recipe(makeBase(1, 1, () => 127)), 13, 9).data[40], Math.fround(127 / 255));
});
test('keep and erase operate in the entire transparent domain and preserve soft alpha', () => {
  const empty = recipe(makeBase(1, 1), { strokes: [stroke(undefined, { strength: .4 })] });
  assert.equal(render(empty).data[50 * 101 + 50], Math.fround(.4));
  const soft = recipe(makeBase(1, 1, () => 128), { strokes: [stroke(undefined, { strength: .25 })] });
  const a = render(soft).data[5100], base = Math.fround(128 / 255);
  assert.equal(a, Math.fround(base + (1 - base) * .25));
  soft.strokes[0].mode = 'erase'; assert.equal(render(soft).data[5100], Math.fround(base * .75));
});
test('zero-strength strokes and zero adjustments are exact no-ops, even with a huge path', () => {
  const b = makeBase(23, 17, (x, y) => (x * 37 + y * 83) % 256), r = recipe(b);
  const zero = { ...r, strokes: [stroke([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], { strength: 0, radius: .25 })] };
  assert.deepEqual(render(zero, 87, 61).data, render(r, 87, 61).data);
  const p = core.plan({ width: 4096, height: 2048 }, zero); assert.equal(p.activeStrokes, 0); assert.equal(p.coverageVisits, 0); assert.equal(p.scratchBytes, 0);
});
test('each stroke has maximal coverage, not density-dependent repeated opacity', () => {
  const point = { x: .5, y: .5 };
  const one = recipe(undefined, { strokes: [stroke([point], { strength: .3 })] });
  const repeated = recipe(undefined, { strokes: [stroke(Array.from({ length: 100 }, () => ({ ...point })), { strength: .3 })] });
  assert.deepEqual(render(one).data, render(repeated).data);
  const crossed = recipe(undefined, { strokes: [stroke([{ x: .1, y: .5 }, { x: .9, y: .5 }, { x: .1, y: .5 }], { strength: .3 })] });
  assert.equal(render(crossed).data[5100], Math.fround(.3));
  const twice = { ...one, strokes: [...one.strokes, ...one.strokes] }; assert.equal(render(twice).data[5100], Math.fround(Math.fround(.3) + (1 - Math.fround(.3)) * .3));
});
test('duplicate and collinear events canonicalize to the same path and same budget', () => {
  const start = { x: .013, y: .027 }, end = { x: .973, y: .911 };
  const sparse = recipe(undefined, { strokes: [stroke([start, end], { radius: .013, strength: .61 })] });
  const dense = clone(sparse); dense.strokes[0].points = Array.from({ length: 2048 }, (_, i) => ({ x: start.x + (end.x - start.x) * i / 2047, y: start.y + (end.y - start.y) * i / 2047 }));
  dense.strokes[0].points[0] = start; dense.strokes[0].points[2047] = end;
  assert.deepEqual(core.validate(dense), sparse);
  assert.deepEqual(core.plan({ width: 701, height: 431 }, dense), core.plan({ width: 701, height: 431 }, sparse));
  assert.deepEqual(render(dense, 701, 431).data, render(sparse, 701, 431).data);
  assert.deepEqual(core.validate(core.validate(dense)), core.validate(dense));
});
test('bends and path reversals are preserved while same piecewise path stays event-invariant', () => {
  const sparse = recipe(undefined, { strokes: [stroke([{ x: .1, y: .1 }, { x: .8, y: .2 }, { x: .2, y: .9 }, { x: .8, y: .2 }])] });
  const dense = clone(sparse), p = sparse.strokes[0].points; dense.strokes[0].points = [];
  for (let i = 0; i < p.length - 1; i++) for (let k = 0; k < 20; k++) dense.strokes[0].points.push({ x: p[i].x + (p[i + 1].x - p[i].x) * k / 20, y: p[i].y + (p[i + 1].y - p[i].y) * k / 20 });
  dense.strokes[0].points.push(p.at(-1)); assert.deepEqual(core.validate(dense), sparse);
  assert.deepEqual(render(dense, 111, 83).data, render(sparse, 111, 83).data);
});
test('continuous capsule geometry leaves no dab gaps on the minimum-radius diagonal', () => {
  const r = recipe(undefined, { strokes: [stroke([{ x: 0, y: 0 }, { x: 1, y: 1 }], { radius: .0005, hardness: 1 })] });
  const out = render(r, 1001, 1001);
  for (let i = 0; i < 1001; i++) assert.equal(out.data[i * 1001 + i], 1);
  assert.equal(out.diagnostics.dabCount, 0); assert.equal(out.diagnostics.segmentCount, 1);
  assert.ok(out.diagnostics.coverageVisits < 5000);
});
test('edge-coordinate centers, short-edge radius, no minimum pixel radius, and canvas borders are exact', () => {
  const r = recipe(undefined, { strokes: [stroke([{ x: .5, y: .5 }], { radius: .0005, hardness: 1 })] });
  assert.ok(render(r, 100, 100).data.every(v => v === 0));
  assert.equal(render(r, 101, 101).data[5100], 1);
  const corner = recipe(undefined, { strokes: [stroke([{ x: 0, y: 0 }], { radius: .1, hardness: 1 })] });
  const out = render(corner, 200, 100); assert.equal(out.data[0], 1); assert.equal(out.data[9], 1); assert.equal(out.data[10], 0); assert.equal(out.data[10 * 200], 0);
});
test('stroke ordering is explicit and can restore or remove previously edited confidence', () => {
  const keep = stroke(undefined, { hardness: 1 }), erase = { ...keep, mode: 'erase' };
  assert.equal(render(recipe(undefined, { strokes: [keep, erase] })).data[5100], 0);
  assert.equal(render(recipe(undefined, { strokes: [erase, keep] })).data[5100], 1);
});
test('capsules, smooth hardness, and the ordered full pipeline match the independent reference', () => {
  const b = makeBase(17, 13, (x, y) => (x * 37 + y * 71) % 256);
  for (const edgeShift of [-.02, -.005, 0, .005, .02]) for (const hardness of [0, .37, 1]) {
    const r = recipe(b, { strokes: [stroke([{ x: 0, y: .2 }, { x: .72, y: .83 }, { x: .91, y: .07 }], { radius: .043, hardness, strength: .63 }), stroke([{ x: .3, y: .2 }, { x: .35, y: .8 }], { mode: 'erase', radius: .13, hardness: .8, strength: .4 })], edgeShift, feather: .019 });
    const actual = render(r, 101, 79); assert.ok(maxDiff(actual.data, reference(101, 79, r)) <= 1e-7);
    assert.ok(actual.data.every(v => v >= 0 && v <= 1)); assert.ok(actual.diagnostics.actualWorkUnits <= actual.diagnostics.workUnits);
  }
});
test('positive edge shift expands, negative shrinks, and fractional shift is continuous', () => {
  const b = makeBase(100, 100, x => x < 50 ? 255 : 0), neutral = render(recipe(b), 100, 100).data;
  const plus = render(recipe(b, { edgeShift: .005 }), 100, 100).data, minus = render(recipe(b, { edgeShift: -.005 }), 100, 100).data;
  assert.equal(plus[50], .5); assert.equal(minus[49], .5);
  for (let i = 0; i < neutral.length; i++) { assert.ok(plus[i] >= neutral[i]); assert.ok(minus[i] <= neutral[i]); }
  const a = render(recipe(b, { edgeShift: .00999999 }), 100, 100).data, c = render(recipe(b, { edgeShift: .01000001 }), 100, 100).data;
  assert.ok(maxDiff(a, c) < 2.1e-6);
});
test('feather is symmetric, affects both sides, and never clips back to the initial foreground', () => {
  const impulse = makeBase(101, 101, (x, y) => x === 50 && y === 50 ? 255 : 0), r = recipe(impulse, { feather: .02 });
  const a = render(r).data;
  assert.ok(a[5100] > 0 && a[5100] < 1); assert.ok(a[5101] > 0); assert.equal(a[5101], a[5099]); assert.equal(a[5101], a[5201]);
  let total = 0; for (const v of a) total += v; assert.ok(Math.abs(total - 1) < 1e-7);
  const grown = render(recipe(impulse, { edgeShift: .02 })).data; assert.ok(grown[5101] > 0);
});
test('uniform confidence survives both border-clamped filters and narrow dimensions', () => {
  for (const [width, height] of [[1, 1], [1, 31], [31, 1], [2, 2], [101, 79]]) for (const value of [0, 1, 127, 255]) for (const edgeShift of [-.02, .02]) {
    const out = render(recipe(makeBase(1, 1, () => value), { edgeShift, feather: .02 }), width, height);
    assert.ok(out.data.every(v => v === Math.fround(value / 255)));
  }
});
test('rasterization is deterministic, independent of input mutation after snapshot, and cancellable', () => {
  const r = recipe(makeBase(7, 3, (x, y) => x * 20 + y * 10), { strokes: [stroke()], edgeShift: .01, feather: .02 });
  const before = clone(r), expected = render(r, 151, 101).data;
  assert.deepEqual(render(r, 151, 101).data, expected); assert.deepEqual(r, before);
  for (const stop of [1, 2, 5, 20, 80, 170, 300, 450]) { let calls = 0; aborts(() => render(r, 151, 101, { shouldCancel: () => ++calls === stop })); assert.deepEqual(r, before); }
  let mutated = false;
  const result = render(r, 151, 101, { shouldCancel: () => { if (!mutated) { r.base.data = makeBase(7, 3, () => 0).data; r.strokes[0].points[0].x = 0; r.strokes.length = 0; mutated = true; } return false; } });
  assert.deepEqual(result.data, expected);
});
test('maximum output planning and cumulative loops fit stated memory/work ceilings', () => {
  const r = recipe(makeBase(512, 512, () => 127), { edgeShift: .02, feather: .02 });
  const p = core.plan({ width: 4096, height: 2048 }, r);
  assert.equal(p.pixels, 8388608); assert.ok(p.maxWorkingBytes <= 160 * 1024 * 1024); assert.ok(p.workUnits <= 256000000); assert.equal(p.maxWorkingBytes, p.outputBytes + p.scratchBytes + p.baseBytes + p.queueBytes);
  const small = render(r, 121, 99).diagnostics; assert.equal(small.morphologyVisits, 2 * 121 * 99); assert.equal(small.featherVisits, 2 * 121 * 99); assert.ok(small.queueVisits <= 4 * 121 * 99); assert.ok(small.actualWorkUnits <= small.workUnits);
  const busy = recipe(undefined, { strokes: Array.from({ length: 128 }, () => stroke([{ x: 0, y: 0 }, { x: 1, y: 1 }], { radius: .25 })) });
  assert.throws(() => core.plan({ width: 4096, height: 2048 }, busy), /work budget/);
});
test('budget rejection and pure planning allocate no typed buffers', () => {
  const c = vm.createContext({}); vm.runInContext(source, c);
  const result = vm.runInContext(`(() => {
    let allocations = 0;
    for (const name of ['Uint8Array','Float32Array','Int32Array']) globalThis[name] = new Proxy(globalThis[name], { construct(t,args) { allocations++; return Reflect.construct(t,args); } });
    const r = MintMaskRefine.defaults('s'); r.edgeShift = .02; r.feather = .02;
    const p = MintMaskRefine.plan({width:4096,height:2048},r);
    r.strokes = Array.from({length:128},()=>({mode:'keep',radius:.25,hardness:1,strength:1,points:[{x:0,y:0},{x:1,y:1}]}));
    let rejected = false; try { MintMaskRefine.rasterize({width:4096,height:2048},r); } catch(e) { rejected = /work budget/.test(e.message); }
    return {allocations,rejected,bytes:p.maxWorkingBytes};
  })()`, c);
  assert.equal(result.allocations, 0); assert.equal(result.rejected, true); assert.ok(result.bytes <= 160 * 1024 * 1024);
});
test('dimensions, version, finite ranges, and original command counts are strict', () => {
  const r = recipe();
  for (const size of [{ width: 0, height: 1 }, { width: 1.1, height: 1 }, { width: 4097, height: 1 }, { width: 4096, height: 2049 }, { width: Infinity, height: 1 }, { width: 1, height: 1, data: [] }]) assert.throws(() => core.plan(size, r));
  for (const value of [null, {}, { ...r, version: 2 }, { ...r, edgeShift: NaN }, { ...r, edgeShift: .020001 }, { ...r, feather: -.001 }, { ...r, feather: Infinity }, { ...r, extra: 0 }]) assert.throws(() => core.validate(value));
  for (const bad of [{ radius: .00049 }, { radius: .251 }, { hardness: -1 }, { strength: 1.1 }, { mode: 'restore' }, { points: [] }, { points: [{ x: 1.1, y: 0 }] }, { points: [{ x: 0, y: NaN }] }]) assert.throws(() => core.validate({ ...r, strokes: [stroke(undefined, bad)] }));
  assert.throws(() => core.validate({ ...r, strokes: Array.from({ length: 129 }, () => stroke()) }), /length/);
  const points = Array.from({ length: 2048 }, () => ({ x: .5, y: .5 }));
  assert.throws(() => core.validate({ ...r, strokes: [stroke([...points, points[0]])] }), /length/);
  assert.throws(() => core.validate({ ...r, strokes: [stroke(points), stroke(points), stroke()] }), /total point/);
  assert.equal(core.validate({ ...r, strokes: [stroke(points), stroke(points)] }).strokes.length, 2);
});
test('only strict canonical byte Base64 is accepted; malformed encodings and oversized bases fail', () => {
  for (const [width, height, data] of [[1, 1, 'AB=='], [1, 1, 'AA='], [1, 1, 'AA==\n'], [1, 1, '_A=='], [2, 1, 'AAF='], [1, 1, 'AAAA'], [1, 1, new Uint8Array([0])], [1025, 1, 'AA=='], [1024, 257, 'AA==']]) assert.throws(() => core.defaults('s', { width, height, data }), /base|Base64/);
  for (let n = 1; n < 10; n++) { const b = makeBase(n, 1, x => x * 17); assert.deepEqual(core.defaults('s', b).base, b); }
});
test('getters, symbols, nonenumerable fields, sparse arrays and unsafe prototypes are rejected without reads', () => {
  let reads = 0; const getter = (object, key) => Object.defineProperty(object, key, { enumerable: true, configurable: true, get() { reads++; throw new Error('Getter ran'); } });
  const r = recipe(undefined, { strokes: [stroke()] });
  for (const build of [
    () => getter(clone(r), 'base'),
    () => { const a = clone(r); getter(a.base, 'data'); return a; },
    () => { const a = clone(r); getter(a.strokes[0], 'radius'); return a; },
    () => { const a = clone(r); getter(a.strokes[0].points[0], 'x'); return a; },
    () => { const a = clone(r); getter(a.strokes, '0'); return a; },
    () => { const a = clone(r); getter(a.strokes[0].points, '0'); return a; }
  ]) assert.throws(() => core.validate(build()), /Invalid/);
  assert.throws(() => core.validate(r, getter({}, 'sourceRevision')), /Invalid/);
  assert.throws(() => core.rasterize({ width: 2, height: 2 }, r, getter({}, 'shouldCancel')), /Invalid/);
  assert.throws(() => core.plan(getter({ width: 2, height: 2 }, 'width'), r), /Invalid/); assert.equal(reads, 0);
  for (const value of [Object.assign(Object.create({}), r), { ...r, [Symbol('x')]: 1 }, Object.defineProperty(clone(r), 'feather', { value: 0, enumerable: false }), { ...r, strokes: new Array(1) }, { ...r, strokes: Object.assign([stroke()], { extra: 1 }) }]) assert.throws(() => core.validate(value));
  class CustomArray extends Array {} assert.throws(() => core.validate({ ...r, strokes: new CustomArray(stroke()) }));
  const symbolArray = [stroke()]; symbolArray[Symbol('x')] = 1; assert.throws(() => core.validate({ ...r, strokes: symbolArray }));
});
test('optional fields are never inherited and source objects never execute conversion hooks', () => {
  let reads = 0;
  Object.defineProperty(Object.prototype, 'shouldCancel', { configurable: true, get() { reads++; throw new Error('inherited'); } });
  Object.defineProperty(Object.prototype, 'sourceRevision', { configurable: true, get() { reads++; throw new Error('inherited'); } });
  try {
    const r = JSON.parse('{"version":1,"sourceRevision":"s","base":{"width":1,"height":1,"data":"AA=="},"strokes":[],"edgeShift":0,"feather":0}');
    assert.equal(core.validate(r, {}).sourceRevision, 's'); assert.equal(core.rasterize({ width: 1, height: 1 }, r, {}).data[0], 0); assert.equal(reads, 0);
  } finally { delete Object.prototype.shouldCancel; delete Object.prototype.sourceRevision; }
  const evil = { toString() { reads++; return 's'; } }; assert.throws(() => core.defaults(evil)); assert.equal(reads, 0);
});
test('seeded arbitrary and nearly axis-aligned paths agree with full-image distance evaluation', () => {
  let seed = 0x07b02f19; const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let trial = 0; trial < 80; trial++) {
    const width = 13 + Math.floor(rand() * 55), height = 11 + Math.floor(rand() * 51);
    const points = Array.from({ length: 2 + trial % 6 }, () => ({ x: rand(), y: rand() }));
    if (trial % 4 === 0) points[1].y = points[0].y + 1e-13;
    if (trial % 4 === 1) points[1].x = points[0].x + 1e-13;
    if (trial % 4 === 2) points[1] = { ...points[0] };
    const r = recipe(makeBase(7, 5, () => Math.floor(rand() * 256)), { strokes: [stroke(points, { mode: trial % 2 ? 'keep' : 'erase', radius: trial % 3 ? .0005 + rand() * .2495 : .0005, hardness: rand(), strength: rand() })], edgeShift: (rand() - .5) * .04, feather: rand() * .02 });
    const result = render(r, width, height);
    assert.ok(maxDiff(result.data, reference(width, height, r)) <= 1.2e-7, `trial ${trial}`);
    assert.ok(result.diagnostics.actualWorkUnits <= result.diagnostics.workUnits);
    assert.equal(result.diagnostics.coverageVisits, core.plan({ width, height }, r).coverageVisits);
  }
});
test('malformed render options and inherited-record prototypes never invoke callbacks', () => {
  let calls = 0; const r = recipe(), inherited = Object.create({ shouldCancel: () => { calls++; return true; } });
  for (const opt of [null, inherited, { shouldCancel: 1 }, { shouldCancel: undefined }, { extra: 1 }, { [Symbol('x')]: 1 }]) assert.throws(() => render(r, 2, 2, opt));
  assert.equal(calls, 0);
  const snapshot = clone(r); aborts(() => render(r, 2, 2, { shouldCancel: () => true })); assert.deepEqual(r, snapshot);
});
