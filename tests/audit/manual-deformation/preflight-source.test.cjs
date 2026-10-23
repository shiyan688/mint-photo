'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../../app/src/main/assets/manual-tools.js');
const P = require('../../../app/src/main/assets/project-core.js');
const revision = 'independent-audit', context = { sourceRevision: revision };
const command = extra => ({ kind: 'push', sourceRevision: revision, radius: .3, strength: 1,
  points: [{ x: .6, y: .5 }, { x: .4, y: .5 }], selection: null, ...extra });
function picture(w = 101, h = 65) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    data.set([x * 2, y * 3, ((x >> 2) ^ (y >> 2)) & 1 ? 255 : 0, 255], (y * w + x) * 4);
  return { width: w, height: h, data };
}
const half = { version: 1, sourceRevision: revision, base: 'none', inverted: false, feather: 0,
  commands: [{ kind: 'lasso', mode: 'add', points: [{ x: 0, y: 0 }, { x: .5, y: 0 }, { x: .5, y: 1 }, { x: 0, y: 1 }] }] };

test('manual original-size export preflight rejects a recipe the renderer cannot afford', () => {
  const source = { blob: new Blob(['x'], { type: 'image/png' }), name: 'x.png', mime: 'image/png', width: 3000, height: 2400, origin: 'original' };
  const operation = { type: 'manual', sourceRevision: revision, selection: null, repair: [],
    liquify: Array.from({ length: 20 }, () => command({ radius: .5, points: [{ x: .1, y: .5 }, { x: .9, y: .5 }] })) };
  assert.throws(() => M.liquify({ width: 3000, height: 2400, data: new Uint8ClampedArray(3000 * 2400 * 4) }, operation.liquify, context), { code: 'MANUAL_WORK_LIMIT' });
  assert.throws(() => P.planExport(source, [operation], 'original'), 'Preflight must not label an unaffordable render as exportable');
});

test('small valid manual recipe remains exportable at both declared resolutions', () => {
  const source = { blob: new Blob(['x'], { type: 'image/png' }), name: 'x.png', mime: 'image/png', width: 101, height: 65, origin: 'original' };
  const operation = { type: 'manual', sourceRevision: revision, selection: null, repair: [], liquify: [command()] };
  for (const mode of ['original', 'working']) assert.deepEqual(P.planExport(source, [operation], mode).output, { width: 101, height: 65 });
});

test('host buffer ceiling rejects original resolution without silently reducing it', () => {
  const source = { blob: new Blob(['x'], { type: 'image/png' }), name: 'x.png', mime: 'image/png', width: 2800, height: 2800, origin: 'original' };
  const operation = { type: 'manual', sourceRevision: revision, selection: null, repair: [],
    liquify: [command({ kind: 'bloat', radius: .002, points: [{ x: .5, y: .5 }] })] };
  const before = JSON.stringify({ width: source.width, height: source.height, operation });
  assert.doesNotThrow(() => M.planLiquify(2800, 2800, operation.liquify, context), 'Core-only buffers fit; the stricter Android host budget is separate');
  assert.throws(() => P.planExport(source, [operation], 'original'), /256MiB/);
  assert.deepEqual(P.planExport(source, [operation], 'working').output, { width: 2560, height: 2560 });
  assert.equal(JSON.stringify({ width: source.width, height: source.height, operation }), before);
});

test('manual buffer preflight follows actual operation order, not just final output dimensions', () => {
  const source = { blob: new Blob(['x'], { type: 'image/png' }), name: 'x.png', mime: 'image/png', width: 2800, height: 2800, origin: 'original' };
  const operation = { type: 'manual', sourceRevision: revision, selection: null, repair: [],
    liquify: [command({ kind: 'bloat', radius: .002, points: [{ x: .5, y: .5 }] })] };
  const crop = { type: 'crop', x: 0, y: 0, w: .5, h: .5 };
  assert.throws(() => P.planExport(source, [operation, crop], 'original'), /256MiB/);
  assert.deepEqual(P.planExport(source, [crop, operation], 'original').output, { width: 1400, height: 1400 });
});

test('individually affordable manual operations cannot bypass the aggregate work budget', () => {
  const source = { blob: new Blob(['x'], { type: 'image/png' }), name: 'x.png', mime: 'image/png', width: 1024, height: 1024, origin: 'original' };
  const operation = { type: 'manual', sourceRevision: revision, selection: null, repair: [],
    liquify: [command({ kind: 'bloat', radius: .3, points: [{ x: .5, y: .5 }] })] };
  const job = M.planLiquify(1024, 1024, operation.liquify, context);
  const count = Math.floor(800000000 / job.workUnits) + 1;
  assert(count <= 60 && count > 1); assert.doesNotThrow(() => P.planExport(source, [operation], 'original'));
  assert.throws(() => P.planExport(source, Array.from({ length: count }, () => operation), 'original'), /全部液化计算/);
});

test('selection protects excluded destinations but deliberately is not source-donor isolation', () => {
  const a = picture(), b = picture(), c = command({ selection: half });
  for (let y = 0; y < b.height; y++) for (let x = 51; x < b.width; x++) b.data[(y * b.width + x) * 4] = 255;
  const A = M.liquify(a, [c], context), B = M.liquify(b, [c], context);
  let affectedInside = 0;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const i = (y * a.width + x) * 4;
    if (x > 50) assert.deepEqual(A.data.slice(i, i + 4), a.data.slice(i, i + 4));
    else if (A.data[i] !== B.data[i]) affectedInside++;
  }
  assert.equal(affectedInside, 35, 'Document this legacy footprint, not a neighboring-person protection claim');
});

test('translucent core keeps exact alpha, transparent hidden RGB and immutable input', () => {
  const im = picture();
  for (let i = 0; i < im.width * im.height; i++) {
    im.data[i * 4 + 3] = i % 7 === 0 ? 0 : i % 253 + 1;
    if (!im.data[i * 4 + 3]) im.data.set([255, 0, 255, 0], i * 4);
  }
  const before = im.data.slice(), out = M.liquify(im, [command()], context);
  assert.deepEqual(im.data, before); assert(out.diagnostics.changedPixels > 0);
  for (let i = 0; i < im.width * im.height; i++) {
    assert.equal(out.data[i * 4 + 3], before[i * 4 + 3]);
    if (before[i * 4 + 3] === 0) assert.deepEqual(out.data.slice(i * 4, i * 4 + 4), before.slice(i * 4, i * 4 + 4));
  }
});
