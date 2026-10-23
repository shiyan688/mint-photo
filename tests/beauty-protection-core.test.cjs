'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const people = require('../app/src/main/assets/portrait-people.js');
const maskRefine = require('../app/src/main/assets/mask-refine.js');
const moduleApi = require('../app/src/main/assets/beauty-protection.js');
const core = moduleApi.createCore({people, maskRefine});
const asset = name => path.join(__dirname, '../app/src/main/assets', name);
const copy = value => JSON.parse(JSON.stringify(value));
const hash = name => crypto.createHash('sha256').update(fs.readFileSync(asset(name))).digest('hex');
const error = (fn, code) => assert.throws(fn, value => value.code === code);
const abort = fn => assert.throws(fn, value => value.name === 'AbortError' && value.code === 'ABORT_ERR');
function batch(count = 2, topology = 'MediaPipe478') {
  return people.createBatch({sourceRevision:'source-A', batchId:'batch-A', detector:{...people.DEFAULT_DETECTOR, topology}, detectionSize:{width:201, height:101},
    landmarks:Array.from({length:count}, (_, face) => Array.from({length:topology === 'MediaPipe478' ? 478 : 468}, (_, i) => ({x:(face + 1) / (count + 1) + .06 * Math.cos(i), y:.5 + .14 * Math.sin(i), ...(i % 3 ? {z:(i % 13) / 100} : {})})))});
}
function stroke(fields = {}) { return {mode:'erase', radius:.1, hardness:.6, strength:1, points:[{x:.5, y:.5}], ...fields}; }
function recipe(b = batch(1), s = stroke()) { return core.withFaceStroke(null, b, b.faces[0].id, s); }
function field(width = 101, height = 101, alpha = false) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) { data[4 * i] = (17 + i * 3) % 190; data[4 * i + 1] = (67 + i * 7) % 180; data[4 * i + 2] = (93 + i * 11) % 160; data[4 * i + 3] = alpha ? [0, 1, 128, 254, 255][i % 5] : 255; }
  return {width, height, data};
}
function result(source, regions) {
  const data = source.data.slice();
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const i = (y * source.width + x) * 4;
    if (!data[i + 3] || (regions && !regions.some(r => r.writeBounds && x >= r.writeBounds.minX && x <= r.writeBounds.maxX && y >= r.writeBounds.minY && y <= r.writeBounds.maxY))) continue;
    data[i] = 240; data[i + 1] = 220; data[i + 2] = 210;
  }
  return {...source, data};
}
function whole(width, height) { return [{faceId:'face-1', writeBounds:{minX:0, minY:0, maxX:width - 1, maxY:height - 1}}]; }
function twoRegions() { return [{faceId:'face-1', writeBounds:{minX:15, minY:5, maxX:85, maxY:95}}, {faceId:'face-2', writeBounds:{minX:115, minY:5, maxX:185, maxY:95}}]; }
function mask(r, b, width = 101, height = 101, faceId = 'face-1') { return core.rasterizeFace({width, height}, r, b, faceId).data; }

// Independent slow all-pixel/all-segment coverage and fractional separable box
// reference. It does not call production mask planning/rasterization.
function reference(width, height, entry) {
  let data = new Float32Array(width * height); data.fill(1);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  for (const s of entry.strokes) {
    const radius = s.radius * Math.min(width, height), hard = radius * s.hardness;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let coverage = 0;
      for (let p = 0; p < Math.max(1, s.points.length - 1); p++) {
        const a = s.points[p], b = s.points[Math.min(p + 1, s.points.length - 1)], ax = a.x * width, ay = a.y * height, dx = b.x * width - ax, dy = b.y * height - ay;
        const t = dx || dy ? clamp(((x + .5 - ax) * dx + (y + .5 - ay) * dy) / (dx * dx + dy * dy), 0, 1) : 0;
        const d = Math.hypot(x + .5 - ax - t * dx, y + .5 - ay - t * dy);
        if (d > radius) continue;
        const q = d <= hard ? 1 : (radius - d) / (radius - hard);
        coverage = Math.max(coverage, Math.fround(q * q * (3 - 2 * q)));
      }
      const i = y * width + x, a = coverage * s.strength;
      if (a > 0) data[i] = s.mode === 'erase' ? data[i] * (1 - a) : data[i] + (1 - data[i]) * a;
    }
  }
  const radius = entry.feather * Math.min(width, height), n = Math.floor(radius), f = radius - n;
  for (const vertical of [false, true]) {
    const next = new Float32Array(data.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -n - 1; k <= n + 1; k++) sum += data[clamp(y + (vertical ? k : 0), 0, height - 1) * width + clamp(x + (vertical ? 0 : k), 0, width - 1)] * (Math.abs(k) === n + 1 ? f : 1);
      next[y * width + x] = sum / (2 * n + 1 + 2 * f);
    }
    data = next;
  }
  return data;
}

test('new injected UMD API works in Node/browser; both frozen dependencies remain byte exact', () => {
  assert.ok(Object.isFrozen(moduleApi)); assert.ok(Object.isFrozen(core)); assert.ok(Object.isFrozen(core.limits));
  assert.equal(hash('portrait-people.js'), '0de2c158f3a23c6e4de8326e7474ad809e02d41ccc2931a5ccfba76505a02b3a');
  assert.equal(hash('mask-refine.js'), '1f87ce10085e42cf8e67309ac49dd6f608d40ecb32258ab8a76ed67b6bc4baa2');
  const sandbox = vm.createContext({});
  for (const name of ['portrait-people.js', 'mask-refine.js', 'beauty-protection.js']) vm.runInContext(fs.readFileSync(asset(name), 'utf8'), sandbox);
  assert.equal(vm.runInContext(`MintBeautyProtection.createCore({people:MintPortraitPeople,maskRefine:MintMaskRefine}).version`, sandbox), 1);
});
test('default recipe is portable, detached and sparse; null validates as explicit absence', () => {
  const b = batch(), a = core.defaults(b), second = core.defaults(b);
  assert.deepEqual(a, {version:1, sourceRevision:b.sourceRevision, batchId:b.batchId, detector:b.detector, detectionSize:b.detectionSize, faceOrder:['face-1', 'face-2'], faces:[]});
  assert.notEqual(a.detector, b.detector); assert.notEqual(a.faces, second.faces);
  assert.equal(core.validate(null, b), null); assert.equal(core.validate(undefined, b), null);
  assert.deepEqual(core.validate(copy(a), b), a); assert.equal(core.hasInstructions(a, b), false);
  assert.deepEqual(core.defaults(batch(0)).faces, []);
});
test('helpers copy input, bind exact edited mesh and keep face entries in detection order', () => {
  const b = batch(), r = core.withFaceStroke(null, b, 'face-2', stroke()), a = copy(r);
  const two = core.withFaceStroke(r, b, 'face-1', stroke({strength:.4}));
  assert.deepEqual(r, a); assert.deepEqual(two.faces.map(f => f.faceId), ['face-1', 'face-2']);
  assert.deepEqual(two.faces[1].landmarks, b.faces[1].landmarks); assert.notEqual(two.faces[1].landmarks, b.faces[1].landmarks);
  assert.equal(two.faces[0].feather, .002); assert.equal(core.hasInstructions(two, b), true);
  assert.deepEqual(core.clearFace(two, b, 'face-1'), r);
  assert.equal(core.withFaceFeather(two, b, 'face-1', .006).faces[0].feather, .006);
  assert.equal(two.faces[0].feather, .002); assert.deepEqual(core.withFaceFeather(null, b, 'face-1', .006), core.defaults(b));
  for (const fn of [() => core.clearFace(r, b, 'face-5'), () => core.withFaceStroke(r, b, 'face-5', stroke()), () => core.withFaceFeather(r, b, 'face-5', .002)]) error(fn, 'FACE_ID');
});
test('source, batch, detector, detection dimensions and order bind without locking beauty controls', () => {
  const b = batch(), r = recipe(b), changed = copy(b); changed.faces[0].beauty.brighten = 80;
  assert.deepEqual(core.validate(r, changed), r);
  for (const [mutate, code] of [[b => b.sourceRevision = 'other', 'SOURCE_MISMATCH'], [b => b.batchId = 'new', 'BATCH_MISMATCH'], [b => b.detector.id = 'other', 'MODEL_MISMATCH'], [b => b.detector.modelSha256 = '0'.repeat(64), 'MODEL_MISMATCH'], [b => b.detectionSize.width++, 'DETECTION_SIZE_MISMATCH'], [b => b.faces.reverse(), 'FACE_ORDER_MISMATCH']]) {
    const next = copy(b); mutate(next); error(() => core.validate(r, next), code);
  }
  const long = batch(1); long.sourceRevision = 'a'.repeat(256); assert.equal(mask(recipe(long), long).length, 10201);
});
test('edited geometry rejects changed x/y/z and z presence, including same-ID reassignment', () => {
  const b = batch(), r = recipe(b);
  for (const mutate of [b => b.faces[0].landmarks[1].x += 1e-9, b => b.faces[0].landmarks[1].y += 1e-9, b => b.faces[0].landmarks[1].z += 1e-9, b => delete b.faces[0].landmarks[1].z, b => b.faces[0].landmarks[0].z = 0, b => b.faces[0].landmarks = copy(b.faces[1].landmarks)]) {
    const next = copy(b); mutate(next); error(() => core.validate(r, next), 'GEOMETRY_MISMATCH');
  }
  const smaller = batch(1, 'MediaPipe468'); assert.equal(recipe(smaller).faces[0].landmarks.length, 468);
});
test('null, defaults, zero strength and keep-only recipes copy the candidate byte exactly', () => {
  const b = batch(1), source = field(83, 67, true), candidate = result(source), before = source.data.slice(), after = candidate.data.slice();
  for (const r of [null, undefined, core.defaults(b), recipe(b, stroke({strength:0})), recipe(b, stroke({mode:'keep'}))]) {
    assert.equal(core.hasInstructions(r, b), false);
    const out = core.apply(source, candidate, r, b);
    assert.deepEqual(out.data, candidate.data); assert.notEqual(out.data, candidate.data); assert.notEqual(out.data, source.data);
    assert.equal(core.plan(83, 67, r, b).resources.activeMasks, 0);
  }
  assert.deepEqual(source.data, before); assert.deepEqual(candidate.data, after);
});
test('zero beauty candidate stays exactly source regardless of protection', () => {
  const b = batch(1), source = field(101, 101, true), r = recipe(b);
  assert.deepEqual(core.apply(source, source, r, b, {regions:whole(101, 101)}).data, source.data);
});
test('full-resolution continuous field matches independent coverage and fractional feather reference', () => {
  const b = batch(1);
  let r = recipe(b, stroke({points:[{x:.1,y:.17}, {x:.78,y:.73}, {x:.42,y:.84}], radius:.07, strength:.67, hardness:.17}));
  r = core.withFaceStroke(r, b, 'face-1', stroke({mode:'keep', points:[{x:.45,y:.5}, {x:.8,y:.1}], radius:.1, strength:.41}), .008);
  for (const [w, h] of [[41, 27], [17, 39], [301, 137]]) {
    const actual = mask(r, b, w, h), expected = reference(w, h, r.faces[0]);
    assert.ok(actual.every((v, i) => Number.isFinite(v) && v >= 0 && v <= 1 && Math.abs(v - expected[i]) < 2e-7));
    assert.ok(new Set(actual).size > 20);
  }
});
test('explicit zero and one weights are exact source and candidate; soft weights stay between them', () => {
  const b = batch(1), r = recipe(b), source = field(), candidate = result(source), out = core.apply(source, candidate, r, b, {regions:whole(101, 101)}), weights = mask(r, b);
  assert.equal(weights[5100], 0); assert.equal(weights[0], 1);
  assert.deepEqual(out.data.slice(5100 * 4, 5100 * 4 + 4), source.data.slice(5100 * 4, 5100 * 4 + 4));
  assert.deepEqual(out.data.slice(0, 4), candidate.data.slice(0, 4));
  let soft = 0;
  for (let j = 0; j < weights.length; j++) for (let c = 0; c < 3; c++) {
    const i = j * 4 + c, w = weights[j];
    if (w === 0) assert.equal(out.data[i], source.data[i]);
    else if (w === 1) assert.equal(out.data[i], candidate.data[i]);
    else { soft++; assert.equal(out.data[i], new Uint8ClampedArray([source.data[i] + (candidate.data[i] - source.data[i]) * w])[0]); }
  }
  assert.ok(soft > 0);
});
test('a protection stroke crossing another active face cannot attenuate the other face', () => {
  const b = batch(), regions = twoRegions(), source = field(201, 101), candidate = result(source, regions);
  const r = recipe(b, stroke({radius:.15, hardness:.8, points:[{x:.05,y:.5}, {x:.95,y:.5}]}));
  const before = source.data.slice(), candidateBefore = candidate.data.slice(), out = core.apply(source, candidate, r, b, {regions});
  assert.equal(mask(r, b, 201, 101)[50 * 201 + 150], 0, 'mask really crosses the other face');
  assert.equal(out.data[(50 * 201 + 50) * 4], source.data[(50 * 201 + 50) * 4]);
  for (let y = 0; y < 101; y++) for (let x = 86; x < 201; x++) for (let c = 0; c < 4; c++) assert.equal(out.data[(y * 201 + x) * 4 + c], candidate.data[(y * 201 + x) * 4 + c]);
  assert.deepEqual(source.data, before); assert.deepEqual(candidate.data, candidateBefore);
  const both = core.withFaceStroke(r, b, 'face-2', stroke({radius:.15, points:[{x:.75,y:.5}]}));
  const two = core.apply(source, candidate, both, b, {regions});
  assert.equal(two.data[(50 * 201 + 150) * 4], source.data[(50 * 201 + 150) * 4]);
  assert.deepEqual(two.data.slice(0, 101 * 4), out.data.slice(0, 101 * 4));
});
test('no source delta means no new effect or face-outline edge, even outside the edited face', () => {
  const b = batch(), regions = twoRegions(), source = field(201, 101), candidate = result(source, regions), r = recipe(b, stroke({points:[{x:0,y:0}, {x:1,y:1}]}));
  const out = core.apply(source, candidate, r, b, {regions});
  for (let i = 0; i < source.data.length; i++) if (source.data[i] === candidate.data[i]) assert.equal(out.data[i], source.data[i]);
});
test('inactive/null regions retain complete candidate and never apply another person mask', () => {
  const b = batch(), regions = [{faceId:'face-1', writeBounds:null}, twoRegions()[1]], source = field(201, 101), candidate = result(source, regions), r = recipe(b);
  assert.deepEqual(core.apply(source, candidate, r, b, {regions}).data, candidate.data);
});
test('erase then keep restores beauty locally without erasing independent protection elsewhere', () => {
  const b = batch(1), erase = recipe(b, stroke({radius:.15, hardness:.8, points:[{x:.2,y:.5}, {x:.8,y:.5}]}));
  const restored = core.withFaceStroke(erase, b, 'face-1', stroke({mode:'keep', radius:.1, hardness:.8, points:[{x:.5,y:.5}]}));
  const weights = mask(restored, b);
  assert.equal(weights[5100], 1); assert.equal(weights[50 * 101 + 20], 0);
});
test('dense/duplicate pointer events do not accumulate stroke opacity; path reversal stays bounded', () => {
  const b = batch(1), points = [{x:.1,y:.2}, {x:.9,y:.8}], sparse = recipe(b, stroke({points, strength:.37}));
  const dense = recipe(b, stroke({points:Array.from({length:100}, (_, i) => ({x:.1 + .8 * i / 99, y:.2 + .6 * i / 99})), strength:.37}));
  assert.deepEqual(mask(dense, b), mask(sparse, b));
  const repeated = recipe(b, stroke({points:Array.from({length:100}, () => ({x:.5,y:.5})), strength:.37}));
  assert.deepEqual(mask(repeated, b), mask(recipe(b, stroke({strength:.37})), b));
  const reverse = recipe(b, stroke({points:[...points, points[0]], strength:.37}));
  assert.deepEqual(mask(reverse, b), mask(sparse, b));
});
test('normalized pixel edges and short-edge radius work without a coarse work-grid mask', () => {
  const b = batch(1), r = recipe(b, stroke({radius:.002, hardness:.8, points:[{x:0,y:0}, {x:1,y:1}]}));
  const weights = mask(r, b, 1001, 1001);
  for (let i = 2; i < 999; i++) assert.ok(weights[i * 1001 + i] < .5, 'continuous diagonal must have no dab gaps');
  const p = core.plan(1001, 1001, r, b); assert.equal(p.faces[0].mask.width, 1001); assert.equal(p.faces[0].mask.height, 1001); assert.equal(p.faces[0].mask.dabCount, 0);
  const wide = recipe(b, stroke({radius:.1, points:[{x:.5,y:.5}]}));
  const a = mask(wide, b, 501, 101); assert.equal(a[50 * 501 + 250], 0); assert.equal(a[50 * 501 + 280], 1);
});
test('source alpha and transparent hidden RGB remain exact under all soft mask weights', () => {
  const b = batch(1), source = field(101, 101, true), candidate = result(source), out = core.apply(source, candidate, recipe(b), b, {regions:whole(101, 101)});
  for (let i = 0; i < source.data.length; i += 4) {
    assert.equal(out.data[i + 3], source.data[i + 3]);
    if (!source.data[i + 3]) assert.deepEqual(out.data.slice(i, i + 4), source.data.slice(i, i + 4));
  }
});
test('invalid alpha/hidden RGB and write-domain escapes reject atomically even for null protection', () => {
  const b = batch(1), source = field(31, 23, true), before = source.data.slice();
  for (const mutate of [out => out.data[3] = 10, out => out.data[0] ^= 1]) for (const r of [null, recipe(b)]) {
    const out = result(source); mutate(out); const snapshot = out.data.slice();
    error(() => core.apply(source, out, r, b, {regions:whole(31, 23)}), 'ALPHA_CHANGED'); assert.deepEqual(out.data, snapshot);
  }
  const candidate = result(source), regions = [{faceId:'face-1', writeBounds:{minX:5,minY:5,maxX:10,maxY:10}}];
  error(() => core.apply(source, candidate, null, b, {regions}), 'SUPPORT_ESCAPE'); assert.deepEqual(source.data, before);
});
test('whole batch integer inclusive regions are mandatory for edited protection and disjoint', () => {
  const b = batch(), source = field(201, 101), regions = twoRegions(), candidate = result(source, regions), r = recipe(b);
  error(() => core.apply(source, candidate, r, b), 'MISSING_REGIONS');
  for (const mutate of [a => a.pop(), a => a.push(a[0]), a => a[1].faceId = 'face-1', a => a[0].faceId = 'face-5', a => a[0].writeBounds.minX = -.1, a => a[0].writeBounds.maxX = 201, a => a[0].writeBounds.minY = .5, a => a[0].writeBounds.maxY = 4, a => a[0].writeBounds.extra = 1, a => a[1].writeBounds.minX = 85]) {
    const bad = copy(regions); mutate(bad); assert.throws(() => core.apply(source, candidate, r, b, {regions:bad}));
  }
  const reversed = regions.slice().reverse(); assert.deepEqual(core.apply(source, candidate, r, b, {regions:reversed}).data, core.apply(source, candidate, r, b, {regions}).data);
});
test('accessors at every input level reject without execution; inherited/symbol/hidden fields reject', () => {
  let reads = 0; const b = batch(1);
  for (const [where, key] of [['root','sourceRevision'], ['detector','id'], ['size','width'], ['face','faceId'], ['landmark','x'], ['stroke','strength'], ['point','x'], ['array','0']]) {
    const r = recipe(b), object = {root:r, detector:r.detector, size:r.detectionSize, face:r.faces[0], landmark:r.faces[0].landmarks[0], stroke:r.faces[0].strokes[0], point:r.faces[0].strokes[0].points[0], array:r.faces}[where];
    Object.defineProperty(object, key, {enumerable:true, configurable:true, get() { reads++; throw Error('getter ran'); }}); assert.throws(() => core.validate(r, b));
  }
  const r = recipe(b); Object.defineProperty(r, 'version', {enumerable:false}); error(() => core.validate(r, b), 'INVALID_RECORD');
  const inherited = Object.create(recipe(b)); error(() => core.validate(inherited, b), 'INVALID_RECORD');
  const symbol = recipe(b); symbol[Symbol('x')] = 1; error(() => core.validate(symbol, b), 'UNKNOWN_FIELD');
  const source = field(3, 3), candidate = result(source), options = {}; Object.defineProperty(options, 'shouldCancel', {enumerable:true, get() { reads++; }}); error(() => core.apply(source, candidate, null, b, options), 'ACCESSOR');
  assert.equal(reads, 0);
});
test('strict finite/schema/prototype/array validation rejects malformed recipes and forbidden metadata', () => {
  const b = batch(1);
  const mutations = [r => r.version = 2, r => r.extra = true, r => r.uri = 'image://private', r => r.faces[0].base = 'pixels', r => r.faces[0].edgeShift = .01, r => r.faces[0].feather = 0, r => r.faces[0].feather = .01001, r => r.faces[0].feather = NaN, r => r.faces[0].strokes = [], r => r.faces[0].strokes[0].mode = 'paint', r => r.faces[0].strokes[0].radius = .00199, r => r.faces[0].strokes[0].radius = .15001, r => r.faces[0].strokes[0].hardness = .80001, r => r.faces[0].strokes[0].strength = Infinity, r => r.faces[0].strokes[0].strength = -1, r => r.faces[0].strokes[0].points[0].x = NaN, r => r.faces[0].strokes[0].points[0].y = 1.001, r => delete r.faces[0].strokes[0].points[0], r => r.faces[0].strokes[0].points.foo = 1, r => r.faces[0].strokes[0].points[Symbol('x')] = 0, r => Object.setPrototypeOf(r.faces, null), r => r.faceOrder.push('face-2'), r => r.faces.push(copy(r.faces[0]))];
  for (const mutate of mutations) { const r = recipe(b); mutate(r); assert.throws(() => core.validate(r, b)); }
  const r = recipe(b); r.faces[0] = Object.assign(Object.create(null), r.faces[0]); assert.equal(core.validate(r, b).faces.length, 1);
});
test('32 strokes per face, 2048 per stroke and 4096 aggregate raw points are enforced before simplification', () => {
  const b = batch(), r = recipe(b), s = r.faces[0].strokes[0];
  r.faces[0].strokes = Array.from({length:32}, () => copy(s)); assert.equal(core.validate(r, b).faces[0].strokes.length, 32);
  r.faces[0].strokes.push(copy(s)); error(() => core.validate(r, b), 'LIMIT');
  const full = recipe(b); full.faces[0].strokes[0].points = Array.from({length:2049}, () => ({x:.5,y:.5})); error(() => core.validate(full, b), 'LIMIT');
  const two = core.withFaceStroke(recipe(b), b, 'face-2', stroke());
  for (const f of two.faces) f.strokes[0].points = Array.from({length:2048}, () => ({x:.5,y:.5}));
  assert.equal(core.validate(two, b).faces[0].strokes[0].points.length, 1);
  two.faces[0].strokes.push(stroke()); error(() => core.validate(two, b), 'POINT_BUDGET');
});
test('plan counts every full-resolution mask and scratch plus detached output before any raster allocation', () => {
  const b = batch(), r = core.withFaceStroke(recipe(b), b, 'face-2', stroke()), p = core.plan(201, 101, r, b), n = 201 * 101;
  assert.equal(p.resources.activeMasks, 2); assert.equal(p.resources.retainedOutputBytes, 4 * n);
  assert.equal(p.resources.maskWorkingBytes, 2 * (8 * n + 1));
  assert.equal(p.resources.estimatedPeakExtraBytes, 4 * n + 2 * (8 * n + 1));
  assert.equal(p.resources.cumulativeTypedArrayBytes, p.resources.estimatedPeakExtraBytes); assert.ok(Object.isFrozen(p.faces[0].mask));
  assert.equal(p.resources.maskRasterWorkUnits, p.faces.reduce((sum, f) => sum + f.mask.workUnits, 0));
  assert.equal(p.resources.estimatedWorkUnits, ['candidateValidationWorkUnits','outputCopyWorkUnits','maskWeightValidationWorkUnits','mergeWorkUnits','schemaWorkUnits','maskPlanningWorkUnits','maskRasterWorkUnits'].reduce((sum,key) => sum + p.resources[key], 0));
  assert.equal(p.resources.mergeWorkUnits, 4*n, 'disjoint face domains share one aggregate pixel bound');
  let rasterCalls = 0; const spy = {...maskRefine, rasterize() { rasterCalls++; throw Error('allocation forbidden'); }};
  const source = field(201, 101), candidate = result(source, twoRegions());
  for (const [limits, code] of [[{maxExtraBytes:p.resources.estimatedPeakExtraBytes - 1}, 'MEMORY_BUDGET'], [{maxWorkUnits:p.resources.estimatedWorkUnits - 1}, 'WORK_BUDGET']]) {
    const limited = moduleApi.createCore({people, maskRefine:spy, limits});
    error(() => limited.apply(source, candidate, r, b, {regions:twoRegions()}), code);
  }
  assert.equal(rasterCalls, 0);
  const exact = moduleApi.createCore({people, maskRefine, limits:{maxExtraBytes:p.resources.estimatedPeakExtraBytes,maxWorkUnits:p.resources.estimatedWorkUnits}});
  assert.equal(exact.apply(source, candidate, r, b, {regions:twoRegions()}).data.length, 4 * n);
});
test('dimension and global work/memory limits refuse giant render plans without images', () => {
  const b = batch(1), r = recipe(b);
  for (const [w,h] of [[0,1], [1,Infinity], [4097,1], [4096,4096], [1.5,10]]) assert.throws(() => core.plan(w,h,r,b));
  error(() => moduleApi.createCore({people,maskRefine,limits:{maxPixels:8388609}}), 'RANGE');
  error(() => moduleApi.createCore({people,maskRefine,limits:{maxExtraBytes:0}}), 'RANGE');
  const heavy = core.withFaceStroke(r,b,'face-1',stroke({radius:.15,points:[{x:0,y:0},{x:1,y:1}]}));
  assert.throws(() => core.plan(4096, 2048, heavy, b), /work budget/i);
});
test('image validation rejects nonnative/shared/resizable/spoofed/mis-sized byte arrays without slot getters', () => {
  const b = batch(1), source = field(2, 2), candidate = result(source); let reads = 0;
  for (const data of [new Uint8Array(15), new Float32Array(16), Array.from(source.data)]) error(() => core.apply({...source,data}, candidate, null, b), 'IMAGE_DATA');
  const guarded = source.data.slice(); Object.defineProperty(guarded, 'buffer', {get() { reads++; return new ArrayBuffer(16); }}); error(() => core.apply({...source,data:guarded}, candidate, null, b), 'IMAGE_DATA');
  const buffer = source.data.buffer;
  for (const key of ['resizable','byteLength','maxByteLength']) Object.defineProperty(buffer,key,{configurable:true,get(){reads++;throw Error('getter ran');}});
  assert.deepEqual(core.apply(source, candidate, null, b).data, candidate.data);
  if (typeof SharedArrayBuffer === 'function') {
    const backing = new SharedArrayBuffer(16), data = new Uint8Array(backing); error(() => core.apply({...source,data}, candidate, null, b), 'IMAGE_DATA');
    Object.setPrototypeOf(backing, ArrayBuffer.prototype); error(() => core.apply({...source,data}, candidate, null, b), 'IMAGE_DATA');
  }
  const descriptor = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable');
  if (descriptor) { const backing = new ArrayBuffer(16,{maxByteLength:32}), data = new Uint8Array(backing); Object.defineProperty(backing,'resizable',{value:false}); error(() => core.apply({...source,data}, candidate, null, b), 'IMAGE_DATA'); }
  assert.equal(reads,0);
});
test('invalid returned mask weights reject atomically instead of clamping or applying partial pixels', () => {
  const b = batch(1), source = field(31, 23), candidate = result(source), r = recipe(b), a = source.data.slice(), z = candidate.data.slice();
  for (const value of [NaN, Infinity, -.1, 1.1]) {
    const fake = {...maskRefine, rasterize(size) { const data = new Float32Array(size.width * size.height); data.fill(1); data[0] = value; return {...size,data}; }};
    const c = moduleApi.createCore({people,maskRefine:fake}); error(() => c.apply(source,candidate,r,b,{regions:whole(31,23)}), 'MASK_OUTPUT');
  }
  assert.deepEqual(source.data,a); assert.deepEqual(candidate.data,z);
});
test('cancellation before planning, candidate checks, mask replay and merge publishes no partial pixels', () => {
  const b = batch(), r = core.withFaceStroke(recipe(b),b,'face-2',stroke()), source = field(201,101,true), candidate = result(source,twoRegions()), before=source.data.slice(), after=candidate.data.slice();
  let count = 0; core.apply(source,candidate,r,b,{regions:twoRegions(),shouldCancel:()=>{count++;return false;}}); assert.ok(count > 500);
  for (const at of [1,2,5,30,110,200,Math.floor(count/2),count-1,count]) {
    let calls=0, completed=false;
    abort(()=>{core.apply(source,candidate,r,b,{regions:twoRegions(),shouldCancel:()=>++calls>=at});completed=true;});
    assert.equal(completed,false); assert.deepEqual(source.data,before); assert.deepEqual(candidate.data,after);
  }
  abort(()=>core.rasterizeFace({width:201,height:101},r,b,'face-1',{shouldCancel:()=>true}));
});
