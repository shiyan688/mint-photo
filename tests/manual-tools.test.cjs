'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../app/src/main/assets/manual-tools.js');
const C = { sourceRevision: 'synthetic:original:v1' };
const point = (x, y) => ({ x, y });
const brush = (o = {}) => ({ kind: 'brush', mode: 'add', radius: 0.2, points: [point(0.5, 0.5)], ...o });
const lasso = (o = {}) => ({ kind: 'lasso', mode: 'add', points: [point(.2, .2), point(.8, .2), point(.8, .8), point(.2, .8)], ...o });
const selection = (o = {}) => ({ version: 1, sourceRevision: C.sourceRevision, base: 'none', inverted: false, feather: 0, commands: [], ...o });
const command = (o = {}) => ({ kind: 'push', sourceRevision: C.sourceRevision, radius: .2, strength: .6, points: [point(.44, .5), point(.54, .5)], selection: null, ...o });
function picture(w = 65, h = 65) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    data.set([Math.round(x * 255 / Math.max(1, w - 1)), Math.round(y * 255 / Math.max(1, h - 1)), ((x >> 2) + (y >> 2)) % 2 ? 210 : 40, 255], i);
  }
  return { width: w, height: h, data };
}
function difference(a, b) { let pixels = 0, max = 0, sum = 0; for (let i = 0; i < a.length; i += 4) { let changed = false; for (let k = 0; k < 3; k++) { const d = Math.abs(a[i + k] - b[i + k]); max = Math.max(max, d); sum += d; changed ||= d !== 0; } pixels += changed; } return { pixels, max, mean: sum / (a.length * .75) }; }

test('UMD publishes exactly the browser and CommonJS shared API', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/src/main/assets/manual-tools.js'), 'utf8'), context);
  assert.equal(typeof context.MintManualTools.liquify, 'function');
  assert.equal(typeof context.MintManualTools.rasterizeSelection, 'function');
  assert.ok(Object.isFrozen(M));
});
test('null selection is unrestricted, while explicit none/all/empty invert are real masks', () => {
  assert.equal(M.rasterizeSelection(17, 11, null, C), null);
  for (const [s, expected] of [[selection(), 0], [selection({ base: 'all' }), 1], [selection({ inverted: true }), 1], [selection({ base: 'all', inverted: true }), 0]]) {
    const m = M.rasterizeSelection(17, 11, s, C);
    assert.ok(m instanceof Float32Array); assert.equal(m.length, 187); assert.ok(m.every(v => v === expected));
  }
});
test('circle boundary and curved multi-segment brush coverage are finite and exact', () => {
  const w = 101, radius = 10 / w;
  const m = M.rasterizeSelection(w, w, selection({ commands: [brush({ radius })] }), C);
  assert.equal(m[50 * w + 60], 1); assert.equal(m[50 * w + 61], 0); assert.equal(m[60 * w + 50], 1);
  assert.equal(m[58 * w + 58], 0); assert.equal(m[57 * w + 57], 1);
  const curve = M.rasterizeSelection(w, w, selection({ commands: [brush({ radius: .02, points: [point(.2, .2), point(.5, .8), point(.8, .2)] })] }), C);
  assert.equal(curve[50 * w + 35], 1); assert.equal(curve[50 * w + 65], 1); assert.equal(curve[50 * w + 50], 0);
});
test('lasso includes horizontal/sloping/bottom boundaries and uses even-odd fill', () => {
  const w = 101, square = M.rasterizeSelection(w, w, selection({ commands: [lasso()] }), C);
  for (const [x, y] of [[20, 20], [80, 20], [80, 80], [20, 80], [50, 50]]) assert.equal(square[y * w + x], 1);
  assert.equal(square[50 * w + 19], 0);
  const triangle = M.rasterizeSelection(w, w, selection({ commands: [lasso({ points: [point(.1, .1), point(.9, .9), point(.1, .9)] })] }), C);
  assert.equal(triangle[50 * w + 50], 1); assert.equal(triangle[50 * w + 51], 0);
  const bow = M.rasterizeSelection(w, w, selection({ commands: [lasso({ points: [point(.1, .1), point(.9, .9), point(.1, .9), point(.9, .1)] })] }), C);
  assert.equal(bow[25 * w + 50], 1); assert.equal(bow[50 * w + 20], 0);
});
test('degenerate and fully collinear lassos reject while a self-intersecting bowtie remains valid', () => {
  for (const points of [[point(.5, .5), point(.5, .5), point(.5, .5)], [point(.1, .1), point(.5, .5), point(.9, .9)]])
    assert.throws(() => M.validateSelection(selection({ commands: [lasso({ points })] }), C), /Degenerate lasso/);
  assert.doesNotThrow(() => M.validateSelection(selection({ commands: [lasso({ points: [point(.1, .1), point(.9, .9), point(.1, .9), point(.9, .1)] })] }), C));
});
test('ordered add/subtract precedes feather and inversion, with no per-stroke feather', () => {
  const a = brush({ radius: .3 }), b = brush({ mode: 'subtract', radius: .1 });
  const s = selection({ commands: [a, b], feather: .04 }), m = M.rasterizeSelection(101, 101, s, C);
  assert.equal(m[50 * 101 + 50], 0); assert.equal(m[50 * 101 + 70], 1);
  assert.ok(m[50 * 101 + 60] > 0 && m[50 * 101 + 60] < 1);
  const inverted = M.rasterizeSelection(101, 101, { ...s, inverted: true }, C);
  for (let i = 0; i < m.length; i++) assert.ok(Math.abs(m[i] + inverted[i] - 1) < 6e-8);
  const reverse = M.rasterizeSelection(101, 101, selection({ commands: [b, a] }), C);
  assert.equal(reverse[50 * 101 + 50], 1);
  const twice = M.rasterizeSelection(101, 101, { ...s, inverted: !(!s.inverted) }, C);
  assert.deepEqual(twice, m);
});
test('feather is monotone across a straight edge, bounded, compact and keeps uniform endpoints', () => {
  const s = selection({ feather: .05, commands: [lasso({ points: [point(0, 0), point(.5, 0), point(.5, 1), point(0, 1)] })] });
  const m = M.rasterizeSelection(101, 101, s, C);
  let last = 1; for (let x = 0; x < 101; x++) { const v = m[50 * 101 + x]; assert.ok(v >= 0 && v <= 1 && v <= last); last = v; }
  assert.equal(m[50 * 101 + 40], 1); assert.equal(m[50 * 101 + 60], 0);
  for (const base of ['none', 'all']) assert.ok(M.rasterizeSelection(1, 7, selection({ base, feather: .1 }), C).every(v => v === (base === 'all' ? 1 : 0)));
});
test('validators deep-copy selection snapshots and strictly bind all revisions', () => {
  const s = selection({ commands: [brush()] }), cmd = command({ selection: s });
  const saved = M.validateLiquifyCommands([cmd], C);
  s.commands[0].points[0].x = 0;
  assert.equal(saved[0].selection.commands[0].points[0].x, .5);
  assert.notEqual(saved[0], cmd); assert.notEqual(saved[0].points, cmd.points);
  assert.throws(() => M.validateSelection(selection(), {}), /source revision/);
  assert.throws(() => M.validateSelection(selection(), { sourceRevision: 'different' }), /another source revision/);
  assert.throws(() => M.validateLiquifyCommands([command({ sourceRevision: 'other' })], C), /another source revision/);
  assert.throws(() => M.validateLiquifyCommands([command({ selection: selection({ sourceRevision: 'other' }) })], C), /another source revision/);
  assert.throws(() => M.validateSelection(selection({ sourceRevision: 1 }), C), /source revision/);
});
test('strict own fields reject unknown, missing, inherited, accessor, sparse and nonfinite input without invoking getters', () => {
  const bad = [undefined, {}, selection({ version: 2 }), selection({ base: 'everything' }), selection({ inverted: 1 }), selection({ feather: NaN }), selection({ feather: .11 }), selection({ unexpected: true }), selection({ commands: [brush({ radius: 0 })] }), selection({ commands: [lasso({ points: [point(.1, .1), point(.2, .2)] })] }), selection({ commands: [brush({ points: [point(Infinity, .5)] })] }), selection({ commands: [brush({ points: [point(-.01, .5)] })] })];
  for (const s of bad) assert.throws(() => M.validateSelection(s, C));
  const inherited = Object.create(selection()); assert.throws(() => M.validateSelection(inherited, C));
  const sparse = Array(1); assert.throws(() => M.validateSelection(selection({ commands: sparse }), C));
  let invoked = false;
  for (const field of ['version', 'sourceRevision', 'commands']) {
    const s = selection(); Object.defineProperty(s, field, { enumerable: true, get() { invoked = true; return 1; } });
    assert.throws(() => M.validateSelection(s, C));
  }
  const c = brush(); Object.defineProperty(c, 'kind', { enumerable: true, get() { invoked = true; return 'brush'; } });
  assert.throws(() => M.validateSelection(selection({ commands: [c] }), C));
  const ps = [point(.5, .5)]; Object.defineProperty(ps, 0, { enumerable: true, get() { invoked = true; return point(.5, .5); } });
  assert.throws(() => M.validateSelection(selection({ commands: [brush({ points: ps })] }), C));
  assert.equal(invoked, false);
});
test('limits reject command, point, nested snapshot, geometry and estimated work bombs before pixel arrays', () => {
  assert.throws(() => M.validateSelection(selection({ commands: Array(129).fill(brush()) }), C), /count/);
  assert.throws(() => M.validateSelection(selection({ commands: [brush({ points: Array(4096).fill(point(.5, .5)) }), brush()] }), C), /total points/);
  assert.throws(() => M.validateLiquifyCommands(Array(129).fill(command()), C), /count/);
  assert.throws(() => M.validateLiquifyCommands(Array(5).fill(command({ selection: selection({ commands: [brush({ points: Array(4096).fill(point(.5, .5)) })] }) })), C), /snapshot/);
  assert.throws(() => M.rasterizeSelection(16385, 1, null, C), /dimensions/);
  assert.throws(() => M.rasterizeSelection(4097, 4097, selection(), C), /dimensions/);
  assert.throws(() => M.rasterizeSelection(4096, 4096, selection({ commands: Array(128).fill(brush({ radius: .5 })) }), C), { code: 'MANUAL_WORK_LIMIT' });
  const tiny = picture(65, 65), path = Array.from({ length: 100 }, (_, i) => point(i % 2, .5));
  assert.throws(() => M.liquify(tiny, [command({ radius: .002, points: path })], C), { code: 'MANUAL_WORK_LIMIT' });
});
test('zero strength, empty path motion, empty selection, empty commands and restore-only are byte identity', () => {
  const im = picture();
  for (const cs of [[], [command({ strength: 0 })], [command({ points: [point(.5, .5)] })], [command({ points: [point(.5, .5), point(.5, .5)] })], [command({ selection: selection() })], [command({ kind: 'restore' })]]) assert.deepEqual(M.liquify(im, cs, C).data, im.data);
});
test('push changes visible selected pixels, samples immutable input, keeps exact alpha and zero-mask RGBA', () => {
  const im = picture(97, 81), s = selection({ feather: .025, commands: [brush({ radius: .25 })] });
  for (let i = 0; i < im.data.length; i += 4) im.data[i + 3] = i % 28 === 0 ? 0 : i % 31 + 220;
  const before = im.data.slice(), mask = M.rasterizeSelection(im.width, im.height, s, C);
  const out = M.liquify(im, [command({ selection: s })], C);
  assert.deepEqual(im.data, before); assert.ok(out.diagnostics.changedPixels > 100);
  for (let i = 0; i < mask.length; i++) {
    assert.equal(out.data[i * 4 + 3], im.data[i * 4 + 3]);
    if (mask[i] === 0 || im.data[i * 4 + 3] === 0) assert.deepEqual(out.data.slice(i * 4, i * 4 + 4), im.data.slice(i * 4, i * 4 + 4));
  }
  assert.deepEqual(M.liquify(im, [command({ selection: s })], C), out);
});
test('whole-path arc-length sampling makes sparse and dense same-path pointer streams equivalent', () => {
  const im = picture(256, 192), sparse = [point(.3, .5), point(.7, .5)];
  const dense = Array.from({ length: 101 }, (_, i) => point(.3 + .4 * i / 100, .5));
  const a = M.liquify(im, [command({ radius: .18, strength: .8, points: sparse })], C);
  const b = M.liquify(im, [command({ radius: .18, strength: .8, points: dense })], C);
  assert.deepEqual(a.data, b.data);
  assert.equal(a.diagnostics.totalSteps, b.diagnostics.totalSteps);
  assert.equal(a.diagnostics.estimatedWork, b.diagnostics.estimatedWork);
  const corner = [point(.3, .3), point(.5, .6), point(.7, .3)];
  const cornerDense = [];
  for (let s = 0; s < 2; s++) for (let i = 0; i < 50; i++) cornerDense.push(point(corner[s].x + (corner[s + 1].x - corner[s].x) * i / 50, corner[s].y + (corner[s + 1].y - corner[s].y) * i / 50));
  cornerDense.push(corner[2]);
  const ca = M.liquify(im, [command({ points: corner })], C), cb = M.liquify(im, [command({ points: cornerDense })], C);
  assert.deepEqual(ca.data, cb.data); assert.equal(ca.diagnostics.totalSteps, cb.diagnostics.totalSteps);
});
test('saved selection snapshots do not follow later current selection edits', () => {
  const s = selection({ commands: [brush()] }), commands = M.validateLiquifyCommands([command({ selection: s })], C);
  const im = picture(), first = M.liquify(im, commands, C);
  s.base = 'all'; s.commands.length = 0; s.inverted = true;
  assert.deepEqual(M.liquify(im, commands, C), first);
});
test('a full-strength restore covering displacement support returns exact source, not resampled blur', () => {
  const im = picture(101, 101), push = command({ radius: .07, points: [point(.48, .5), point(.52, .5)] });
  const moved = M.liquify(im, [push], C); assert.ok(moved.diagnostics.changedPixels > 10);
  const restored = M.liquify(im, [push, command({ kind: 'restore', radius: .35, strength: 1, points: [point(.5, .5)] })], C);
  assert.deepEqual(restored.data, im.data); assert.equal(restored.diagnostics.maxDisplacement, 0);
  const partial = M.liquify(im, [push, command({ kind: 'restore', radius: .35, strength: .5, points: [point(.5, .5)] })], C);
  assert.ok(partial.diagnostics.maxDisplacement > 0 && partial.diagnostics.maxDisplacement < moved.diagnostics.maxDisplacement);
});
test('aggressive crossing paths and restore retain a positive bilinear inverse-map Jacobian bound', () => {
  const im = picture(81, 65), cs = [];
  for (let i = 0; i < 40; i++) cs.push(command({ radius: .2, strength: 1,
    points: i % 2 ? [point(.6, .35), point(.35, .65)] : [point(.35, .35), point(.65, .65)],
    ...(i % 7 === 6 ? { kind: 'restore', points: [point(.5, .5)] } : {}) }));
  const out = M.liquify(im, cs, C);
  assert.ok(out.diagnostics.limitedSteps > 0); assert.ok(out.diagnostics.maxEdgeGradient < .45);
  assert.ok(out.diagnostics.minJacobianLowerBound > .13);
  assert.ok(out.diagnostics.changedPixels > 0);
});
test('hard selection edges, corners and narrow images do not fold or modify excluded pixels', () => {
  const s = selection({ commands: [lasso({ points: [point(0, 0), point(.5, 0), point(.5, 1), point(0, 1)] })] });
  const im = picture(65, 41), cs = [command({ radius: .5, strength: 1, points: [point(.45, .5), point(.85, .2)], selection: s })], out = M.liquify(im, cs, C);
  assert.ok(out.diagnostics.maxEdgeGradient < .45);
  for (let y = 0; y < im.height; y++) for (let x = 33; x < im.width; x++) assert.deepEqual(out.data.slice((y * im.width + x) * 4, (y * im.width + x) * 4 + 4), im.data.slice((y * im.width + x) * 4, (y * im.width + x) * 4 + 4));
  for (const [w, h] of [[1, 1], [1, 65], [65, 1]]) { const thin = picture(w, h); assert.doesNotThrow(() => M.liquify(thin, [command({ points: [point(0, 0), point(1, 1)] })], C)); }
});
test('cancellation before allocation and during work never mutates the source', () => {
  const im = picture(129, 129), before = im.data.slice();
  assert.throws(() => M.rasterizeSelection(129, 129, selection(), { ...C, shouldCancel: () => true }), { name: 'AbortError', code: 'MANUAL_CANCELLED' });
  let calls = 0; assert.throws(() => M.liquify(im, [command()], { ...C, shouldCancel: () => ++calls > 8 }), { name: 'AbortError' });
  assert.deepEqual(im.data, before);
});
test('normalized original-coordinate replay uses freshly rasterized high resolution, not resized preview', () => {
  const s = selection({ feather: .02, commands: [brush({ radius: .22 })] });
  const small = M.rasterizeSelection(101, 81, s, C), big = M.rasterizeSelection(201, 161, s, C);
  let error = 0; for (let y = 0; y < 81; y++) for (let x = 0; x < 101; x++) error = Math.max(error, Math.abs(small[y * 101 + x] - big[y * 2 * 201 + x * 2]));
  assert.ok(error < .3, `raster quantization difference ${error}`);
  const a = picture(101, 81), b = picture(201, 161);
  // Smooth coordinate ramps isolate geometry from high-frequency interpolation.
  for (let i = 2; i < a.data.length; i += 4) a.data[i] = 100;
  for (let i = 2; i < b.data.length; i += 4) b.data[i] = 100;
  const ao = M.liquify(a, [command({ strength: .2, selection: s })], C), bo = M.liquify(b, [command({ strength: .2, selection: s })], C);
  let sum = 0, max = 0; for (let y = 0; y < 81; y++) for (let x = 0; x < 101; x++) for (let c = 0; c < 3; c++) { const d = Math.abs(ao.data[(y * 101 + x) * 4 + c] - bo.data[(y * 2 * 201 + x * 2) * 4 + c]); sum += d; max = Math.max(max, d); }
  assert.ok(max <= 3); assert.ok(sum / (101 * 81 * 3) < .2);
});
test('single final immutable-input sample matches the accumulated uniform interior displacement', () => {
  const im = picture(101, 101), cs = [command({ radius: .4, strength: .1, points: [point(.48, .5), point(.52, .5)] }), command({ radius: .4, strength: .1, points: [point(.48, .5), point(.52, .5)] })];
  const out = M.liquify(im, cs, C), i = (50 * 101 + 50) * 4;
  // Center is inside both flat kernels: inverse x=50-0.4-0.4=49.2.
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(out.data[i + c] - (im.data[i - 4 + c] * .8 + im.data[i + c] * .2)) <= .5);
});

// Optional reproducible public/synthetic pixel evidence, never private photos.
// MANUAL_TOOLS_EVIDENCE_DIR=/tmp/manual-evidence node --test tests/manual-tools.test.cjs
if (process.env.MANUAL_TOOLS_EVIDENCE_DIR) test('write deterministic synthetic mask, push and restore pixel evidence', async () => {
  const sharp = require('sharp'), crypto = require('node:crypto');
  const dir = path.resolve(process.env.MANUAL_TOOLS_EVIDENCE_DIR); fs.mkdirSync(dir, { recursive: true });
  const im = picture(257, 193), s = selection({ feather: .025, commands: [brush({ radius: .26 }), brush({ mode: 'subtract', radius: .06, points: [point(.4, .5)] })] });
  const cs = [command({ radius: .15, strength: .8, points: [point(.47, .45), point(.54, .49)], selection: s })];
  const moved = M.liquify(im, cs, C), restored = M.liquify(im, [...cs, command({ kind: 'restore', radius: .5, strength: 1, points: [point(.5, .5)] })], C);
  assert.deepEqual(restored.data, im.data);
  const mask = M.rasterizeSelection(im.width, im.height, s, C), maskPixels = new Uint8ClampedArray(im.data.length);
  for (let i = 0; i < mask.length; i++) maskPixels.set([mask[i] * 255, mask[i] * 255, mask[i] * 255, 255], i * 4);
  const images = { original: im.data, selection: maskPixels, pushed: moved.data, restored: restored.data };
  for (const [name, data] of Object.entries(images)) await sharp(data, { raw: { width: im.width, height: im.height, channels: 4 } }).png().toFile(path.join(dir, `${name}.png`));
  const report = { fixture: 'Generated coordinate ramps and checkerboard; no personal or downloaded images.', size: [im.width, im.height], sourceRevision: C.sourceRevision,
    pushed: { ...moved.diagnostics, difference: difference(im.data, moved.data) }, restored: { ...restored.diagnostics, difference: difference(im.data, restored.data) },
    hashes: Object.fromEntries(Object.entries(images).map(([name, data]) => [name, crypto.createHash('sha256').update(data).digest('hex')])) };
  fs.writeFileSync(path.join(dir, 'pixel-evidence.json'), JSON.stringify(report, null, 2) + '\n');
});
