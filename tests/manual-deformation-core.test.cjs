'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const M = require('../app/src/main/assets/manual-tools.js');
const Legacy = require('./fixtures/manual-tools-legacy-v29.cjs');
const C = { sourceRevision: 'synthetic:manual-deformation:v2' };
const NEW = ['bloat', 'pucker', 'twist-cw', 'twist-ccw'];
const p = (x, y) => ({ x, y });
const cmd = (kind = 'bloat', o = {}) => ({ kind, sourceRevision: C.sourceRevision, radius: .4, strength: 1, points: [p(.5, .5)], selection: null, ...o });
const selection = (o = {}) => ({ version: 1, sourceRevision: C.sourceRevision, base: 'none', inverted: false, feather: 0, commands: [], ...o });
const half = (o = {}) => selection({ commands: [{ kind: 'lasso', mode: 'add', points: [p(0, 0), p(.5, 0), p(.5, 1), p(0, 1)] }], ...o });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function picture(w = 161, h = 161, mode = 'ramps') {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, cx = (w - 1) / 2, cy = (h - 1) / 2;
    let rgb = [Math.round(x * 255 / Math.max(1, w - 1)), Math.round(y * 255 / Math.max(1, h - 1)), 100];
    if (mode === 'grid') rgb = x % 16 < 2 || y % 16 < 2 ? [30, 72, 92] : [238, 246, 242];
    if (mode === 'circle') rgb = Math.hypot(x - cx, y - cy) <= Math.min(w, h) * .14 ? [245, 245, 245] : [18, 29, 40];
    if (mode === 'marker') rgb = Math.hypot(x - cx - Math.min(w, h) * .15, y - cy) <= Math.min(w, h) * .025 ? [250, 20, 20] : [10, 10, 10];
    data.set([...rgb, 255], i);
  }
  return { width: w, height: h, data };
}
const pixel = (im, x, y) => Array.from(im.data.slice((y * im.width + x) * 4, (y * im.width + x) * 4 + 4));
function redCentroid(im) {
  let sx = 0, sy = 0, total = 0;
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
    const i = (y * im.width + x) * 4, weight = Math.max(0, im.data[i] - im.data[i + 1]);
    sx += weight * x; sy += weight * y; total += weight;
  }
  return { x: sx / total, y: sy / total, total };
}
function whiteArea(im) {
  let n = 0; for (let i = 0; i < im.data.length; i += 4) n += im.data[i] > 128; return n;
}
function densePath(vertices, count = 63) {
  const out = [];
  for (let s = 1; s < vertices.length; s++) {
    const a = vertices[s - 1], b = vertices[s]; out.push(a);
    for (let i = 1; i < count; i++) out.push(p(a.x + (b.x - a.x) * i / count, a.y + (b.y - a.y) * i / count));
  }
  out.push(vertices[vertices.length - 1]); return out;
}

test('immutable versioned capabilities and metadata-only plan match render diagnostics', () => {
  assert.ok(Object.isFrozen(M.CAPABILITIES)); assert.ok(Object.isFrozen(M.CAPABILITIES.kinds));
  assert.equal(M.CAPABILITIES.version, 2);
  assert.deepEqual(M.CAPABILITIES.kinds, ['push', 'restore', ...NEW]);
  assert.throws(() => { M.CAPABILITIES.kinds.push('unknown'); }, TypeError);
  const im = picture(73, 61), commands = NEW.map(kind => cmd(kind, { strength: .25, selection: half({ feather: .02 }) }));
  const plan = M.planLiquify(im.width, im.height, commands, C), rendered = M.liquify(im, commands, C);
  assert.ok(Object.isFrozen(plan));
  assert.deepEqual(Object.keys(plan), ['width', 'height', 'pixels', 'workUnits', 'maxWorkingBytes', 'totalSteps']);
  assert.equal(plan.pixels, im.width * im.height);
  assert.equal(plan.workUnits, rendered.diagnostics.estimatedWork);
  assert.equal(plan.maxWorkingBytes, rendered.diagnostics.estimatedMemoryBytes);
  assert.equal(plan.totalSteps, rendered.diagnostics.totalSteps);
});

test('planner never allocates RGBA or typed field arrays, including near the pixel limit', () => {
  const sandbox = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/src/main/assets/manual-tools.js'), 'utf8'), sandbox);
  vm.runInContext(`
    const forbidden = function () { throw new Error('Unexpected typed pixel allocation'); };
    Uint8Array = Uint8ClampedArray = Float32Array = Float64Array = forbidden;
    globalThis.result = MintManualTools.planLiquify(4096, 4096, [{kind:'bloat',sourceRevision:'plan',radius:.01,strength:1,points:[{x:.5,y:.5}],selection:null}], {sourceRevision:'plan'});
  `, sandbox);
  assert.equal(sandbox.result.pixels, 16777216);
  assert.ok(sandbox.result.maxWorkingBytes < M.LIMITS.memoryBytes);
  assert.ok(sandbox.result.workUnits < M.LIMITS.work);
});

test('strict commands reject aliases, extra state, accessors, bad revisions and malformed points', () => {
  for (const kind of NEW) {
    assert.equal(M.validateLiquifyCommands([cmd(kind)], C)[0].kind, kind);
    for (const change of [{ kind: 'twirl' }, { radius: NaN }, { strength: -1 }, { strength: 1.01 }, { points: [] }, { points: [p(1.1, .5)] }, { sourceRevision: 'stale' }, { selection: selection({ sourceRevision: 'stale' }) }, { unexpected: 1 }]) {
      assert.throws(() => M.planLiquify(31, 31, [cmd(kind, change)], C));
    }
    const accessor = cmd(kind); let called = false;
    Object.defineProperty(accessor, 'strength', { enumerable: true, get() { called = true; return 1; } });
    assert.throws(() => M.validateLiquifyCommands([accessor], C)); assert.equal(called, false);
  }
  assert.throws(() => M.planLiquify(31, 31, [cmd()], {}));
  const original = cmd('bloat', { selection: half() }), normalized = M.validateLiquifyCommands([original], C);
  original.points[0].x = 0; original.selection.commands[0].points[0].x = .4;
  assert.equal(normalized[0].points[0].x, .5); assert.equal(normalized[0].selection.commands[0].points[0].x, 0);
});

test('frozen legacy implementation retains exact SHA and byte-exact seeded push/restore replay', () => {
  assert.equal(hash(fs.readFileSync(path.join(__dirname, 'fixtures/manual-tools-legacy-v29.cjs'))), 'd28e4cef2a7f589a667e89b691bad72d31f0907d40ed47fe897f564d3dd12762');
  let seed = 0x39a5c172;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let trial = 0; trial < 48; trial++) {
    const w = 11 + Math.floor(random() * 47), h = 11 + Math.floor(random() * 39), im = picture(w, h);
    for (let i = 0; i < im.data.length; i++) im.data[i] = Math.floor(random() * 256);
    const commands = Array.from({ length: 1 + trial % 6 }, (_, j) => cmd(j % 3 === 2 ? 'restore' : 'push', {
      radius: .025 + random() * .45, strength: trial % 13 ? random() : 0,
      points: Array.from({ length: 1 + (trial + j) % 4 }, () => p(random(), random())),
      selection: j % 3 === 0 ? null : half({ feather: j % 2 ? .025 : 0, inverted: trial % 2 === 1 })
    }));
    assert.deepEqual(M.liquify(im, commands, C), Legacy.liquify(im, commands, C), `legacy seeded trial ${trial}`);
  }
});

test('new brushes preserve empty/zero/transparent inputs and source alpha policy', () => {
  const im = picture(63, 49), before = im.data.slice();
  assert.deepEqual(M.liquify(im, [], C).data, before);
  for (const kind of NEW) {
    assert.deepEqual(M.liquify(im, [cmd(kind, { strength: 0 })], C).data, before);
    assert.deepEqual(M.liquify(im, [cmd(kind, { selection: selection() })], C).data, before);
  }
  for (let i = 0; i < im.data.length; i += 4) im.data[i + 3] = i % 28 ? (i % 254) + 1 : 0;
  const translucent = im.data.slice();
  for (const kind of NEW) {
    const out = M.liquify(im, [cmd(kind)], C);
    for (let i = 0; i < im.data.length; i += 4) {
      assert.equal(out.data[i + 3], translucent[i + 3]);
      if (translucent[i + 3] === 0) assert.deepEqual(out.data.slice(i, i + 4), translucent.slice(i, i + 4));
    }
    assert.deepEqual(im.data, translucent);
  }
  for (const [w, h] of [[1, 1], [1, 53], [53, 1]]) for (const kind of NEW) {
    const out = M.liquify(picture(w, h), [cmd(kind, { points: [p(0, 0), p(1, 1)] })], C);
    assert.ok(out.diagnostics.maxEdgeGradient < .45); assert.ok(out.diagnostics.minJacobianLowerBound > 0);
  }
});

test('single taps visibly expand/shrink a circle and use the correct inverse-map radial direction', () => {
  const im = picture(), bloat = M.liquify(im, [cmd('bloat')], C), pucker = M.liquify(im, [cmd('pucker')], C);
  assert.ok(pixel(bloat, 105, 80)[0] < pixel(im, 105, 80)[0] - 4);
  assert.ok(pixel(pucker, 105, 80)[0] > pixel(im, 105, 80)[0] + 4);
  assert.ok(pixel(bloat, 55, 80)[0] > pixel(im, 55, 80)[0]);
  assert.ok(pixel(pucker, 55, 80)[0] < pixel(im, 55, 80)[0]);
  for (const out of [bloat, pucker]) { assert.equal(out.diagnostics.totalSteps, 1); assert.ok(out.diagnostics.changedPixels > 500); assert.deepEqual(pixel(out, 80, 80), pixel(im, 80, 80)); }
  const circle = picture(161, 161, 'circle'), count = whiteArea(circle);
  assert.ok(whiteArea(M.liquify(circle, [cmd('bloat')], C)) > count * 1.3);
  assert.ok(whiteArea(M.liquify(circle, [cmd('pucker')], C)) < count * .8);
});

test('asymmetric east marker moves down for clockwise and up for counterclockwise', () => {
  const im = picture(161, 161, 'marker'), initial = redCentroid(im);
  const cw = M.liquify(im, [cmd('twist-cw')], C), ccw = M.liquify(im, [cmd('twist-ccw')], C);
  const a = redCentroid(cw), b = redCentroid(ccw);
  assert.ok(a.y > initial.y + 3, JSON.stringify(a)); assert.ok(b.y < initial.y - 3, JSON.stringify(b));
  assert.ok(a.x > 90 && b.x > 90); assert.notDeepEqual(cw.data, ccw.data);
  const ramps = picture(), inverseCw = M.liquify(ramps, [cmd('twist-cw')], C);
  assert.ok(pixel(inverseCw, 105, 80)[1] < pixel(ramps, 105, 80)[1]);
});

test('whole-polyline event density, repeated stationary events and corners replay identically', () => {
  const im = picture(129, 97);
  const paths = [[p(.2, .5), p(.8, .5)], [p(.25, .2), p(.75, .8)], [p(.2, .25), p(.55, .7), p(.8, .35)], [p(.2, .5), p(.8, .5), p(.2, .5)]];
  for (const kind of NEW) {
    const once = M.liquify(im, [cmd(kind, { points: [p(.43, .51)] })], C);
    const held = M.liquify(im, [cmd(kind, { points: Array.from({ length: 200 }, () => p(.43, .51)) })], C);
    assert.deepEqual(once, held, `${kind}: stationary pointer events`);
    for (const points of paths) {
      const a = M.liquify(im, [cmd(kind, { radius: .16, strength: .6, points })], C);
      const b = M.liquify(im, [cmd(kind, { radius: .16, strength: .6, points: densePath(points) })], C);
      assert.deepEqual(a, b, `${kind}: subdivided path`);
    }
  }
});

test('subpixel click jitter tends continuously to one tap rather than doubling its dose', () => {
  const im = picture(257, 257);
  for (const kind of NEW) {
    const tap = M.liquify(im, [cmd(kind, { radius: .3, strength: .2 })], C);
    const jitter = M.liquify(im, [cmd(kind, { radius: .3, strength: .2, points: [p(.5, .5), p(.500002, .5)] })], C);
    assert.ok(Math.abs(jitter.diagnostics.maxDisplacement / tap.diagnostics.maxDisplacement - 1) < .0001);
    let maxDifference = 0;
    for (let i = 0; i < im.data.length; i++) maxDifference = Math.max(maxDifference, Math.abs(tap.data[i] - jitter.data[i]));
    assert.ok(maxDifference <= 1);
  }
});

test('destination selection protects zero-weight RGBA and snapshots remain source-bound', () => {
  const im = picture(93, 79);
  for (const s of [half(), half({ feather: .035 }), half({ inverted: true })]) {
    const mask = M.rasterizeSelection(im.width, im.height, s, C);
    for (const kind of NEW) {
      const current = JSON.parse(JSON.stringify(s));
      const commands = M.validateLiquifyCommands([cmd(kind, { selection: current })], C), out = M.liquify(im, commands, C);
      assert.ok(out.diagnostics.changedPixels > 0);
      for (let i = 0; i < mask.length; i++) if (mask[i] === 0) assert.deepEqual(out.data.slice(i * 4, i * 4 + 4), im.data.slice(i * 4, i * 4 + 4));
      const copy = JSON.parse(JSON.stringify(commands));
      current.base = current.base === 'none' ? 'all' : 'none';
      current.commands.length = 0;
      assert.deepEqual(M.liquify(im, commands, C), M.liquify(im, copy, C));
    }
  }
});

test('full restore erases new deformation exactly instead of inverse-resampling already changed pixels', () => {
  const im = picture(101, 101, 'grid');
  for (const kind of NEW) {
    const c = cmd(kind, { radius: .08 }), moved = M.liquify(im, [c], C);
    assert.ok(moved.diagnostics.changedPixels > 0);
    const restored = M.liquify(im, [c, cmd('restore', { radius: .4 })], C);
    assert.deepEqual(restored.data, im.data); assert.equal(restored.diagnostics.maxDisplacement, 0);
  }
});

test('mixed aggressive paths, hard boundaries and corners retain a positive common no-fold bound', () => {
  const im = picture(71, 57), commands = [];
  for (let i = 0; i < 36; i++) commands.push(cmd([...NEW, 'push', 'restore'][i % 6], {
    radius: i % 5 === 0 ? .5 : .16, strength: 1,
    points: i % 3 ? [p(.3, .25), p(.7, .75)] : [p(0, 0), p(1, 1)],
    selection: i % 2 ? half() : null
  }));
  const out = M.liquify(im, commands, C);
  assert.ok(out.diagnostics.limitedSteps > 0); assert.ok(out.diagnostics.maxEdgeGradient < .45);
  assert.ok(out.diagnostics.minJacobianLowerBound > .13); assert.ok(out.diagnostics.changedPixels > 0);
});

test('cancellation before and during new brush work does not mutate the input', () => {
  const im = picture(129, 129), before = im.data.slice();
  for (const kind of NEW) {
    assert.throws(() => M.liquify(im, [cmd(kind)], { ...C, shouldCancel: () => true }), { code: 'MANUAL_CANCELLED' });
    let calls = 0;
    assert.throws(() => M.liquify(im, [cmd(kind)], { ...C, shouldCancel: () => ++calls > 8 }), { name: 'AbortError' });
    assert.deepEqual(im.data, before);
  }
  assert.throws(() => M.planLiquify(4096, 4096, [cmd()], { ...C, shouldCancel: () => true }), { code: 'MANUAL_CANCELLED' });
});

test('metadata preflight enforces geometry, cumulative work and dab guards before allocations', () => {
  for (const [w, h] of [[0, 1], [16385, 1], [4097, 4097], [1.5, 2]]) assert.throws(() => M.planLiquify(w, h, [], C));
  const zigzag = Array.from({ length: 100 }, (_, i) => p(i % 2, .5));
  assert.throws(() => M.planLiquify(65, 65, [cmd('bloat', { radius: .002, points: zigzag })], C), { code: 'MANUAL_WORK_LIMIT' });
  assert.throws(() => M.planLiquify(4096, 4096, [cmd('twist-cw', { radius: .5 })], C), { code: 'MANUAL_WORK_LIMIT' });
  assert.throws(() => M.planLiquify(1600, 1600, Array.from({ length: 64 }, () => cmd('pucker', { radius: .12 })), C), { code: 'MANUAL_WORK_LIMIT' });
  assert.throws(() => M.planLiquify(64, 64, Array.from({ length: 129 }, () => cmd()), C));
});

// Optional dependency-free synthetic PNG evidence. No private or model images.
// MANUAL_DEFORMATION_EVIDENCE_DIR=/tmp/manual-deformation-evidence node --test tests/manual-deformation-core.test.cjs
function png(im) {
  const crc32 = data => { let crc = -1; for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ -1) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type), b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length, 0); t.copy(b, 4); data.copy(b, 8); b.writeUInt32BE(crc32(Buffer.concat([t, data])), b.length - 4); return b; };
  const header = Buffer.alloc(13); header.writeUInt32BE(im.width, 0); header.writeUInt32BE(im.height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc((im.width * 4 + 1) * im.height);
  for (let y = 0; y < im.height; y++) Buffer.from(im.data.buffer, im.data.byteOffset + y * im.width * 4, im.width * 4).copy(rows, y * (im.width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
if (process.env.MANUAL_DEFORMATION_EVIDENCE_DIR) test('write synthetic grid, circle, direction and resource evidence', () => {
  const dir = path.resolve(process.env.MANUAL_DEFORMATION_EVIDENCE_DIR); fs.mkdirSync(dir, { recursive: true });
  const report = { fixture: 'Generated grid, filled circle and asymmetric east marker; no user or downloaded images.', coreSha256: hash(fs.readFileSync(path.join(__dirname, '../app/src/main/assets/manual-tools.js'))), size: [257, 257], effects: {}, resources: {} };
  for (const mode of ['grid', 'circle', 'marker']) {
    const im = picture(257, 257, mode); fs.writeFileSync(path.join(dir, `${mode}-original.png`), png(im));
    report.effects[mode] = { original: { rgbaSha256: hash(im.data), ...(mode === 'marker' ? { centroid: redCentroid(im) } : mode === 'circle' ? { whiteArea: whiteArea(im) } : {}) } };
    for (const kind of NEW) {
      const out = M.liquify(im, [cmd(kind)], C); fs.writeFileSync(path.join(dir, `${mode}-${kind}.png`), png(out));
      report.effects[mode][kind] = { rgbaSha256: hash(out.data), diagnostics: out.diagnostics, ...(mode === 'marker' ? { centroid: redCentroid(out) } : mode === 'circle' ? { whiteArea: whiteArea(out) } : {}) };
    }
  }
  for (const [w, h] of [[1080, 1080], [2048, 1536], [4096, 4096]]) {
    try { report.resources[`${w}x${h}`] = M.planLiquify(w, h, [cmd('bloat', { radius: .1, strength: .6 })], C); }
    catch (error) { report.resources[`${w}x${h}`] = { rejected: error.code, message: error.message }; }
  }
  fs.writeFileSync(path.join(dir, 'manual-deformation-evidence.json'), JSON.stringify(report, null, 2) + '\n');
});
