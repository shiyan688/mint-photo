'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../../../app/src/main/assets/manual-tools.js');
const kinds = ['bloat', 'pucker', 'twist-cw', 'twist-ccw'];
const revision = 'independent-new-modes', context = { sourceRevision: revision };
const cmd = (kind, extra = {}) => ({ kind, sourceRevision: revision, radius: .3, strength: .6,
  points: [{ x: .5, y: .5 }], selection: null, ...extra });
const selection = extra => ({ version: 1, sourceRevision: revision, base: 'none', inverted: false,
  feather: 0, commands: [], ...extra });
function image(w = 257, h = 257, circle = false) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (circle) { const v = Math.hypot(x - (w - 1) / 2, y - (h - 1) / 2) < 14 ? 255 : 0; data.set([v, v, v, 255], i); }
    else data.set([Math.min(x, 255), Math.min(y, 255), ((x >> 3) ^ (y >> 3)) & 1 ? 240 : 20, 255], i);
  }
  return { width: w, height: h, data };
}
const pixel = (im, x, y) => im.data.slice((y * im.width + x) * 4, (y * im.width + x) * 4 + 4);

test('capabilities and allocation-free plan advertise only the reviewed explicit modes', () => {
  assert(Object.isFrozen(M.CAPABILITIES)); assert(Object.isFrozen(M.CAPABILITIES.kinds));
  assert.equal(M.CAPABILITIES.version, 2);
  assert.deepEqual(M.CAPABILITIES.kinds, ['push', 'restore', ...kinds]);
  for (const kind of kinds) {
    const plan = M.planLiquify(257, 257, [cmd(kind)], context);
    assert(Object.isFrozen(plan)); assert.equal(plan.width, 257); assert.equal(plan.height, 257);
    assert.equal(plan.pixels, 257 * 257); assert.equal(plan.totalSteps, 1);
    assert(plan.workUnits > 0 && plan.maxWorkingBytes > 0);
    assert.throws(() => M.planLiquify(257, 257, [cmd(kind, { arbitrary: true })], context));
  }
  assert.throws(() => M.validateLiquifyCommands([cmd('automatic-face')], context));
});

test('radial and twist direction agrees with inverse mapping in screen y-down coordinates', () => {
  const im = image(), x = 148, y = 128;
  for (const kind of kinds) {
    const out = M.liquify(im, [cmd(kind)], context), actual = pixel(out, x, y);
    assert.deepEqual(pixel(out, 128, 128), pixel(im, 128, 128), 'exact center must not move');
    assert.deepEqual(pixel(out, 10, 10), pixel(im, 10, 10), 'compact support must not change distant pixels');
    if (kind === 'bloat') assert(actual[0] < im.data[(y * 257 + x) * 4]);
    if (kind === 'pucker') assert(actual[0] > im.data[(y * 257 + x) * 4]);
    if (kind === 'twist-cw') assert(actual[1] < y, 'visible clockwise means sampling counterclockwise');
    if (kind === 'twist-ccw') assert(actual[1] > y, 'visible counterclockwise means sampling clockwise');
  }
});

test('bloat expands a real synthetic circle and pucker contracts it', () => {
  const im = image(257, 257, true);
  const area = bytes => { let n = 0; for (let i = 0; i < bytes.length; i += 4) n += bytes[i] >= 128; return n; };
  const original = area(im.data);
  assert(area(M.liquify(im, [cmd('bloat')], context).data) > original);
  assert(area(M.liquify(im, [cmd('pucker')], context).data) < original);
});

test('duplicate stationary events and collinear pointer density do not change new-mode pixels', () => {
  const im = image(129, 97), sparse = [{ x: .3, y: .5 }, { x: .7, y: .5 }];
  const dense = Array.from({ length: 101 }, (_, i) => ({ x: .3 + .4 * i / 100, y: .5 }));
  for (const kind of kinds) {
    const tap = M.liquify(im, [cmd(kind)], context);
    const repeat = M.liquify(im, [cmd(kind, { points: Array.from({ length: 100 }, () => ({ x: .5, y: .5 })) })], context);
    assert.deepEqual(repeat.data, tap.data); assert.equal(repeat.diagnostics.totalSteps, tap.diagnostics.totalSteps);
    const a = M.liquify(im, [cmd(kind, { points: sparse })], context), b = M.liquify(im, [cmd(kind, { points: dense })], context);
    assert.deepEqual(a.data, b.data); assert.equal(a.diagnostics.totalSteps, b.diagnostics.totalSteps);
  }
});

test('imperceptible tap jitter does not double the four new deformation strengths', () => {
  const im = image();
  for (const kind of kinds) {
    const tap = M.liquify(im, [cmd(kind, { strength: .2 })], context);
    const jitter = M.liquify(im, [cmd(kind, { strength: .2, points: [{ x: .5, y: .5 }, { x: .500002, y: .5 }] })], context);
    assert(jitter.diagnostics.maxDisplacement <= tap.diagnostics.maxDisplacement * 1.01,
      `${kind}: ${tap.diagnostics.maxDisplacement} px tap became ${jitter.diagnostics.maxDisplacement} px after 0.000002 normalized motion`);
  }
});

test('new-mode preflight allocates no typed pixel arrays and matches rendering estimates', () => {
  const source = fs.readFileSync(require.resolve('../../../app/src/main/assets/manual-tools.js'), 'utf8');
  let attemptedArrays = 0;
  function ForbiddenPixelArray() { attemptedArrays++; throw Error('Preflight allocated a typed pixel array'); }
  const env = { Uint8Array: ForbiddenPixelArray, Uint8ClampedArray: ForbiddenPixelArray, Float32Array: ForbiddenPixelArray, Float64Array: ForbiddenPixelArray };
  vm.createContext(env); vm.runInContext(source, env);
  for (const kind of kinds) {
    const commands = [cmd(kind, { points: [{ x: .3, y: .5 }, { x: .7, y: .5 }], selection: selection({ base: 'all', feather: .02 }) })];
    env.__commands = JSON.stringify(commands); env.__context = JSON.stringify(context);
    vm.runInContext('globalThis.__plan = MintManualTools.planLiquify(129, 97, JSON.parse(__commands), JSON.parse(__context));', env);
    const out = M.liquify(image(129, 97), commands, context);
    assert.equal(env.__plan.workUnits, out.diagnostics.estimatedWork);
    assert.equal(env.__plan.maxWorkingBytes, out.diagnostics.estimatedMemoryBytes);
    assert.equal(env.__plan.totalSteps, out.diagnostics.totalSteps);
  }
  assert.equal(attemptedArrays, 0);
});

test('every new mode honors exact empty selection, zero strength and protected destinations', () => {
  const im = image(129, 97), half = selection({ commands: [{ kind: 'lasso', mode: 'add', points: [{ x: 0, y: 0 }, { x: .5, y: 0 }, { x: .5, y: 1 }, { x: 0, y: 1 }] }] });
  for (const kind of kinds) {
    assert.deepEqual(M.liquify(im, [cmd(kind, { strength: 0 })], context).data, im.data);
    assert.deepEqual(M.liquify(im, [cmd(kind, { selection: selection() })], context).data, im.data);
    assert.deepEqual(M.liquify(im, [cmd(kind, { selection: selection({ base: 'all' }) })], context).data, M.liquify(im, [cmd(kind)], context).data);
    const out = M.liquify(im, [cmd(kind, { selection: half })], context);
    for (let y = 0; y < im.height; y++) for (let x = 65; x < im.width; x++) assert.deepEqual(pixel(out, x, y), pixel(im, x, y));
  }
});

test('new-mode cancellation never changes input and full support restore returns original bytes', () => {
  const im = image(129, 97), before = im.data.slice();
  for (const kind of kinds) {
    let checks = 0;
    assert.throws(() => M.liquify(im, [cmd(kind)], { ...context, shouldCancel: () => ++checks > 5 }), { name: 'AbortError' });
    assert.deepEqual(im.data, before);
    const move = cmd(kind, { radius: .08 }), restore = cmd('restore', { radius: .5, strength: 1 });
    const changed = M.liquify(im, [move], context); assert(changed.diagnostics.changedPixels > 0);
    assert.deepEqual(M.liquify(im, [move, restore], context).data, before);
  }
});

test('new modes preserve all alpha and hidden transparent RGB on core-only translucent inputs', () => {
  const im = image(129, 97);
  for (let i = 0; i < im.width * im.height; i++) im.data[i * 4 + 3] = i % 7 ? i % 254 + 1 : 0;
  const before = im.data.slice();
  for (const kind of kinds) {
    const out = M.liquify(im, [cmd(kind)], context);
    for (let i = 0; i < im.width * im.height; i++) {
      assert.equal(out.data[i * 4 + 3], before[i * 4 + 3]);
      if (!before[i * 4 + 3]) assert.deepEqual(out.data.slice(i * 4, i * 4 + 4), before.slice(i * 4, i * 4 + 4));
    }
    assert.deepEqual(im.data, before);
  }
});

test('independent field probe checks all cells, domain bounds and mixed-mode no-fold geometry', t => {
  let source = fs.readFileSync(require.resolve('../../../app/src/main/assets/manual-tools.js'), 'utf8');
  const declaration = 'const dx = new Float32Array(n), dy = new Float32Array(n), weights = new Float32Array(n);';
  assert.equal(source.split(declaration).length, 2, 'Update only the test probe if field-storage syntax changes');
  source = source.replace(declaration, declaration + ' globalThis.__auditField = { dx, dy };');
  const env = { Uint8Array, Uint8ClampedArray, Float32Array, Float64Array }; vm.createContext(env); vm.runInContext(source, env);
  const im = image(101, 65), commands = [];
  for (let i = 0; i < 36; i++) commands.push(cmd([...kinds, 'push', 'restore'][i % 6], { radius: .22, strength: 1,
    points: i % 6 === 5 ? [{ x: .5, y: .5 }] : [{ x: .35, y: .35 }, { x: .6, y: .65 }],
    selection: i % 3 ? null : selection({ commands: [{ kind: 'lasso', mode: 'add', points: [{ x: 0, y: 0 }, { x: .55, y: 0 }, { x: .55, y: 1 }, { x: 0, y: 1 }] }] }) }));
  env.__image = im; env.__commands = JSON.stringify(commands); env.__context = JSON.stringify(context);
  vm.runInContext('globalThis.__result = MintManualTools.liquify(__image, JSON.parse(__commands), JSON.parse(__context));', env);
  const { dx: D, dy: E } = env.__auditField, w = im.width, h = im.height;
  let minDeterminant = Infinity, maxEdge = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    assert(x + D[i] >= -1e-5 && x + D[i] <= w - 1 + 1e-5);
    assert(y + E[i] >= -1e-5 && y + E[i] <= h - 1 + 1e-5);
    if (x + 1 < w) maxEdge = Math.max(maxEdge, Math.hypot(D[i + 1] - D[i], E[i + 1] - E[i]));
    if (y + 1 < h) maxEdge = Math.max(maxEdge, Math.hypot(D[i + w] - D[i], E[i + w] - E[i]));
    if (x + 1 < w && y + 1 < h) for (const v of [0, .5, 1]) for (const u of [0, .5, 1]) {
      const ax = (1 - v) * (D[i + 1] - D[i]) + v * (D[i + w + 1] - D[i + w]);
      const ay = (1 - u) * (D[i + w] - D[i]) + u * (D[i + w + 1] - D[i + 1]);
      const bx = (1 - v) * (E[i + 1] - E[i]) + v * (E[i + w + 1] - E[i + w]);
      const by = (1 - u) * (E[i + w] - E[i]) + u * (E[i + w + 1] - E[i + 1]);
      minDeterminant = Math.min(minDeterminant, (1 + ax) * (1 + by) - ay * bx);
    }
  }
  assert(maxEdge < .45); assert(minDeterminant > 0);
  assert(minDeterminant + 1e-6 >= env.__result.diagnostics.minJacobianLowerBound);
  assert.equal(Math.abs(maxEdge - env.__result.diagnostics.maxEdgeGradient) < 1e-9, true);
  t.diagnostic(JSON.stringify({ fixture: '36 mixed new/legacy strokes with hard selection',
    jacobianSamples: (w - 1) * (h - 1) * 9, maxNeighborGradient: maxEdge,
    minimumSampledJacobian: minDeterminant, reportedLowerBound: env.__result.diagnostics.minJacobianLowerBound,
    outOfBoundsNodes: 0, limitedSteps: env.__result.diagnostics.limitedSteps, skippedSteps: env.__result.diagnostics.skippedSteps }));
});
