'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const P = require('../app/src/main/assets/perspective.js');
const clone = v => JSON.parse(JSON.stringify(v));
const full = () => clone(P.defaults());
const recipe = (quad, width = 1, height = 1) => ({ version: 1, quad, outputFraction: { width, height } });
const rect = (l, t, r, b, w = 1, h = 1) => recipe([{ x: l, y: t }, { x: r, y: t }, { x: r, y: b }, { x: l, y: b }], w, h);
const skew = () => recipe([{ x: .08, y: .12 }, { x: .93, y: .04 }, { x: .84, y: .92 }, { x: .17, y: .87 }], .8, .7);
const invalid = fn => assert.throws(fn, e => e.code === 'PERSPECTIVE_INVALID');
const limit = fn => assert.throws(fn, e => e.code === 'PERSPECTIVE_LIMIT');
const geometry = fn => assert.throws(fn, e => e.code === 'PERSPECTIVE_GEOMETRY');
const abort = fn => assert.throws(fn, e => e.name === 'AbortError' && e.code === 'PERSPECTIVE_CANCELLED');
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b} within ${e}`);
let state = 0x735a2051;
function random() { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; }
function image(width, height, fn) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const pixel = fn ? fn(x, y) : [random() * 256, random() * 256, random() * 256, random() * 256];
    for (let c = 0; c < 4; c++) data[(y * width + x) * 4 + c] = pixel[c];
  }
  return { width, height, data };
}
// Independent 8x8 partial-pivot Gaussian solve. No production matrices or maps.
function solveHomography(q) {
  const A = [];
  [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], i) => {
    const { x, y } = q[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
  });
  for (let c = 0; c < 8; c++) {
    let pivot = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[pivot][c])) pivot = r;
    [A[c], A[pivot]] = [A[pivot], A[c]];
    const d = A[c][c]; assert.ok(Math.abs(d) > 1e-14);
    for (let k = c; k <= 8; k++) A[c][k] /= d;
    for (let r = 0; r < 8; r++) if (r !== c) {
      const f = A[r][c];
      for (let k = c; k <= 8; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map(r => r[8]).concat(1);
}
function project(m, x, y) { const d = m[6] * x + m[7] * y + 1; return { x: (m[0] * x + m[1] * y + m[2]) / d, y: (m[3] * x + m[4] * y + m[5]) / d }; }
function reference(im, r, ow, oh) {
  const m = solveHomography(r.quad), out = new Uint8ClampedArray(4 * ow * oh);
  const decode = c => c / 255 <= .04045 ? c / 255 / 12.92 : Math.pow((c / 255 + .055) / 1.055, 2.4);
  const encode = c => Math.round(255 * (c <= .0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - .055));
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const p = project(m, (x + .5) / ow, (y + .5) / oh);
    const sx = Math.max(0, Math.min(im.width - 1, p.x * im.width - .5));
    const sy = Math.max(0, Math.min(im.height - 1, p.y * im.height - .5));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), dx = sx - x0, dy = sy - y0;
    const taps = [[x0, y0, (1 - dx) * (1 - dy)], [Math.min(x0 + 1, im.width - 1), y0, dx * (1 - dy)],
      [x0, Math.min(y0 + 1, im.height - 1), (1 - dx) * dy], [Math.min(x0 + 1, im.width - 1), Math.min(y0 + 1, im.height - 1), dx * dy]];
    const sum = [0, 0, 0, 0];
    for (const [xx, yy, weight] of taps) {
      const a = (yy * im.width + xx) * 4, wa = weight * im.data[a + 3] / 255;
      sum[3] += wa;
      for (let c = 0; c < 3; c++) sum[c] += wa * decode(im.data[a + c]);
    }
    const k = 4 * (y * ow + x), a = Math.round(sum[3] * 255);
    if (a) { out[k + 3] = a; for (let c = 0; c < 3; c++) out[k + c] = encode(sum[c] / sum[3]); }
  }
  return out;
}
// Independent mip oracle: a recursive scalar basis defines each level kernel;
// each coarse RGBA cell then integrates ORIGINAL pixels with those weights, never production levels.
// Numerical differentiation of the separately Gaussian-solved map sets the LOD.
function referenceFiltered(im, r, ow, oh) {
  const m = solveHomography(r.quad), levels = [], out = new Uint8ClampedArray(ow * oh * 4);
  const decode = c => c / 255 <= .04045 ? c / 255 / 12.92 : Math.pow((c / 255 + .055) / 1.055, 2.4);
  const encode = c => Math.round(255 * (c <= .0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - .055));
  const cache = new Map();
  function weights(size, level, index) {
    const key = [size, level, index].join(','); if (cache.has(key)) return cache.get(key);
    if (!level) return new Map([[index, 1]]);
    const previousSize = Math.ceil(size / 2 ** (level - 1)), out = new Map();
    for (const child of [2 * index, Math.min(previousSize - 1, 2 * index + 1)]) {
      for (const [source, weight] of weights(size, level - 1, child)) out.set(source, (out.get(source) || 0) + weight / 2);
    }
    cache.set(key, out); return out;
  }
  for (let level = 0; ; level++) {
    const scale = 2 ** level, width = Math.ceil(im.width / scale), height = Math.ceil(im.height / scale), data = new Float64Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const sum = [0, 0, 0, 0];
      for (const [yy, wy] of weights(im.height, level, y)) for (const [xx, wx] of weights(im.width, level, x)) {
        const at = (yy * im.width + xx) * 4, a = im.data[at + 3], weight = wx * wy;
        for (let c = 0; c < 3; c++) sum[c] += weight * a * decode(im.data[at + c]); sum[3] += weight * a;
      }
      for (let c = 0; c < 4; c++) data[(y * width + x) * 4 + c] = sum[c];
    }
    levels.push({ width, height, data, scale }); if (width === 1 && height === 1) break;
  }
  function sample(index, x, y) {
    const l = levels[index], sx = Math.max(0, Math.min(l.width - 1, x / l.scale - .5)), sy = Math.max(0, Math.min(l.height - 1, y / l.scale - .5));
    const sum = [0, 0, 0, 0], ix = Math.floor(sx), iy = Math.floor(sy);
    for (const [xx, wx] of [[ix, 1 - (sx - ix)], [Math.min(ix + 1, l.width - 1), sx - ix]])
      for (const [yy, wy] of [[iy, 1 - (sy - iy)], [Math.min(iy + 1, l.height - 1), sy - iy]])
        for (let c = 0; c < 4; c++) sum[c] += l.data[(yy * l.width + xx) * 4 + c] * wx * wy;
    return sum;
  }
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const u = (x + .5) / ow, v = (y + .5) / oh, p = project(m, u, v), e = 1e-5;
    const a = project(m, u + e, v), b = project(m, u - e, v), c = project(m, u, v + e), d = project(m, u, v - e);
    const j = [(a.x - b.x) / (2 * e) * im.width / ow, (c.x - d.x) / (2 * e) * im.width / oh,
      (a.y - b.y) / (2 * e) * im.height / ow, (c.y - d.y) / (2 * e) * im.height / oh];
    const tr = j.reduce((s, v) => s + v * v, 0), det = j[0] * j[3] - j[1] * j[2];
    const maxEig = (tr + Math.sqrt(Math.max(0, tr * tr - 4 * det * det))) / 2;
    const major = Math.sqrt(maxEig), minor = Math.abs(det) / major, base = Math.max(1, minor, major / 16);
    const count = Math.max(1, Math.min(16, Math.ceil(major / base - 1e-9)));
    const theta = .5 * Math.atan2(2 * (j[0] * j[2] + j[1] * j[3]), j[0] * j[0] + j[1] * j[1] - j[2] * j[2] - j[3] * j[3]);
    const lod = Math.min(levels.length - 1, Math.max(0, Math.log2(base))), low = Math.floor(lod), t = lod - low;
    const sum = [0, 0, 0, 0];
    for (let i = 0; i < count; i++) {
      const offset = count === 1 ? 0 : (i / (count - 1) - .5) * Math.max(0, major - base);
      const x = p.x * im.width + Math.cos(theta) * offset, y = p.y * im.height + Math.sin(theta) * offset;
      const s = sample(low, x, y), higher = t ? sample(low + 1, x, y) : s;
      for (let c = 0; c < 4; c++) sum[c] += (s[c] * (1 - t) + higher[c] * t) / count;
    }
    const at = (y * ow + x) * 4;
    if (Math.round(sum[3])) { for (let c = 0; c < 3; c++) out[at + c] = encode(sum[c] / sum[3]); out[at + 3] = Math.round(sum[3]); }
  }
  return out;
}
function bytesNear(a, b) { assert.equal(a.length, b.length); for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) <= 1, `byte ${i}: ${a[i]} vs ${b[i]}`); }
function randomQuad() { return [{ x: .02 + .25 * random(), y: .02 + .25 * random() }, { x: .73 + .25 * random(), y: .02 + .25 * random() },
  { x: .73 + .25 * random(), y: .73 + .25 * random() }, { x: .02 + .25 * random(), y: .73 + .25 * random() }]; }

test('shipped UMD supports browser and CommonJS exports', () => {
  const js = fs.readFileSync(require.resolve('../app/src/main/assets/perspective.js'));
  const sandbox = {}; vm.runInNewContext(js.toString(), sandbox);
  assert.equal(sandbox.MintPerspective.version, P.version);
  assert.equal(sandbox.MintPerspective.defaults().quad.length, 4);
});
test('defaults, null defaults, isActive, deep immutable detached snapshots', () => {
  assert.deepEqual(P.validate(null), P.defaults()); assert.deepEqual(P.validate(), P.defaults());
  assert.equal(P.isActive(null), false); assert.equal(P.isActive(skew()), true);
  const r = skew(), v = P.validate(r), p = P.plan(100, 200, r);
  r.quad[0].x = .5; r.outputFraction.width = .1;
  assert.equal(v.quad[0].x, .08); assert.equal(p.recipe.outputFraction.width, .8);
  for (const x of [v, v.quad, ...v.quad, v.outputFraction, p, p.sourceSize, p.outputSize, p.renderedSize,
    p.geometry, p.limits, p.estimates, p.mipLevels, ...p.mipLevels, p.sampling, p.outputToSourceMatrixNormalized, p.sourceToOutputMatrixNormalized]) assert.ok(Object.isFrozen(x));
  const n = Object.assign(Object.create(null), full());
  n.outputFraction = Object.assign(Object.create(null), n.outputFraction);
  n.quad = n.quad.map(q => Object.assign(Object.create(null), q));
  assert.equal(P.isActive(n), false);
});
test('identity exhaustive asymmetric sizes 1..19 by 1..17 and every byte including hidden RGB', () => {
  for (let w = 1; w <= 19; w++) for (let h = 1; h <= 17; h++) {
    const im = image(w, h, (x, y) => [(x * 31 + y * 47) % 256, x * y % 256, 255, (x + y) % 3 ? 0 : 255]);
    const before = Buffer.from(im.data), output = P.apply(im, null);
    assert.equal(output, im); assert.equal(output.data, im.data); assert.deepEqual(Buffer.from(im.data), before);
  }
  for (let byte = 0; byte < 256; byte++) { const im = image(1, 1, () => [byte, 255 - byte, byte, 0]); assert.equal(P.apply(im, full()), im); }
});
test('exact integer crops exhaustively copy all rectangles on power-of-two image grids', () => {
  let cases = 0;
  for (const w of [1, 2, 4, 8]) for (const h of [1, 2, 4, 8]) {
    const im = image(w, h);
    for (let l = 0; l < w; l++) for (let r = l + 1; r <= w; r++) for (let t = 0; t < h; t++) for (let b = t + 1; b <= h; b++) {
      const rec = rect(l / w, t / h, r / w, b / h, (r - l) / w, (b - t) / h);
      const p = P.plan(w, h, rec), out = P.apply(im, rec);
      assert.equal(p.kind, l === 0 && t === 0 && r === w && b === h ? 'identity' : 'copy');
      assert.equal(out.width, r - l); assert.equal(out.height, b - t);
      for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) for (let c = 0; c < 4; c++) {
        assert.equal(out.data[(y * out.width + x) * 4 + c], im.data[((y + t) * w + x + l) * 4 + c]);
      }
      cases++;
    }
  }
  assert.equal(cases, 2500);
});
test('exact crop retains hidden RGB and noninteger crop does not falsely enter copy path', () => {
  const im = image(4, 4, (x, y) => [x * 50, y * 50, 231, 0]);
  const r = rect(.25, .25, .75, .75, .5, .5), p = P.plan(4, 4, r), out = P.apply(im, r);
  assert.equal(p.kind, 'copy'); assert.deepEqual([...out.data.slice(0, 4)], [50, 50, 231, 0]);
  assert.equal(P.plan(4, 4, rect(.24, .25, .74, .75, .5, .5)).kind, 'resample');
});
test('rounding fractions, 1px targets, declared/rendered split and no upsize', () => {
  const r = full(); r.outputFraction = { width: .5, height: .2 };
  let p = P.plan(9, 11, r); assert.deepEqual(p.outputSize, { width: 5, height: 2 });
  p = P.plan(9, 11, r, { maxSide: 3 }); assert.deepEqual(p.outputSize, { width: 5, height: 2 }); assert.deepEqual(p.renderedSize, { width: 3, height: 1 });
  assert.deepEqual(P.plan(9, 11, r, { maxSide: 100 }).renderedSize, { width: 5, height: 2 });
  r.outputFraction = { width: Number.MIN_VALUE, height: Number.MIN_VALUE };
  assert.deepEqual(P.plan(100, 50, r).outputSize, { width: 1, height: 1 });
  assert.equal(P.apply(image(9, 11), r).data.length, 4);
});
test('neutral downsample direct rendering and output mapping uses rendered dimensions', () => {
  const im = image(31, 19), p = P.plan(31, 19, null, { maxSide: 7 }), out = P.apply(im, null, { maxSide: 7 });
  assert.deepEqual(p.outputSize, { width: 31, height: 19 }); assert.deepEqual(p.renderedSize, { width: 7, height: 4 });
  assert.equal(out.width, 7); assert.equal(out.height, 4); assert.equal(p.estimates.outputBytes, 112);
  assert.deepEqual(P.mapEdgePoint(p, { x: 7, y: 4 }, 'outputToSource'), { x: 31, y: 19 });
  assert.deepEqual(P.mapEdgePoint(p, { x: 31, y: 19 }, 'sourceToOutput'), { x: 7, y: 4 });
  bytesNear(out.data, referenceFiltered(im, full(), 7, 4));
});
test('corners and independently solved homography grid for 2500 random convex quads', () => {
  for (let i = 0; i < 2500; i++) {
    const q = randomQuad(), r = recipe(q, .1 + .9 * random(), .1 + .9 * random());
    const w = 1 + Math.floor(1200 * random()), h = 1 + Math.floor(1200 * random());
    const p = P.plan(w, h, r, { maxSide: 117 }), m = solveHomography(q), ow = p.renderedSize.width, oh = p.renderedSize.height;
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1], [.5, .5], [.1, .9], [.95, .4], [.37, .29]];
    for (let j = 0; j < uv.length; j++) {
      const [u, v] = uv[j], a = P.mapEdgePoint(p, { x: u * ow, y: v * oh }, 'outputToSource'), b = project(m, u, v);
      assert.ok(a); near(a.x, b.x * w, 1e-8); near(a.y, b.y * h, 1e-8);
      const back = P.mapEdgePoint(p, a, 'sourceToOutput'); assert.ok(back); near(back.x, u * ow, 1e-8); near(back.y, v * oh, 1e-8);
    }
    assert.ok(p.geometry.minJacobian > 0); assert.ok(p.geometry.maxJacobian >= p.geometry.minJacobian);
  }
});
test('250 independent RGBA random-alpha oracle images, including preview output', () => {
  for (let i = 0; i < 250; i++) {
    const w = 1 + Math.floor(random() * 19), h = 1 + Math.floor(random() * 17), im = image(w, h), before = im.data.slice();
    const r = recipe(randomQuad(), .1 + .9 * random(), .1 + .9 * random()), opt = { maxSide: 1 + Math.floor(random() * 17) };
    const p = P.plan(w, h, r, opt), out = P.apply(im, r, opt);
    bytesNear(out.data, referenceFiltered(im, r, p.renderedSize.width, p.renderedSize.height)); assert.deepEqual(im.data, before);
  }
});
test('stripes, checkerboard, nonlinear gradients and edge samples match independent oracle', () => {
  const patterns = [(x, y) => [x % 2 ? 255 : 0, 0, 0, 255], (x, y) => [(x + y) % 2 ? 255 : 0, 0, 255, 255],
    (x, y) => [x * x % 256, y * y % 256, x * y % 256, (x * y) % 3 ? 255 : 0]];
  for (const fn of patterns) for (const r of [skew(), full(), rect(0, .07, 1, 1, .3, .5)]) {
    const im = image(29, 21, fn), out = P.apply(im, r, { maxSide: 19 });
    bytesNear(out.data, referenceFiltered(im, r, out.width, out.height));
  }
});
test('linear-light black/white midpoint is 188, not gamma-space 128', () => {
  const im = image(2, 1, x => [x * 255, x * 255, x * 255, 255]);
  assert.deepEqual([...P.apply(im, rect(0, 0, 1, 1, .5, 1)).data], [188, 188, 188, 255]);
});
test('premultiplied alpha prevents hidden-color halos, rounds alpha, and zeroes hidden RGB', () => {
  let im = image(2, 1, x => x ? [255, 0, 0, 0] : [0, 255, 0, 255]);
  assert.deepEqual([...P.apply(im, rect(0, 0, 1, 1, .5, 1)).data], [0, 255, 0, 128]);
  im = image(2, 1, x => [255, x * 255, 199, 0]);
  assert.deepEqual([...P.apply(im, rect(0, 0, 1, 1, .5, 1)).data], [0, 0, 0, 0]);
  im = image(2, 1, x => x ? [50, 100, 255, 1] : [255, 0, 0, 0]);
  const r = rect(0, 0, .6, 1, .5, 1); assert.deepEqual([...P.apply(im, r).data], [0, 0, 0, 0]);
});
test('all source color and alpha bytes at centered bilinear sampling', () => {
  for (let c = 0; c < 256; c++) {
    const im = image(2, 2, (x, y) => [c, 255 - c, c, x + y ? c : 255 - c]);
    const r = rect(0, 0, 1, 1, .5, .5), out = P.apply(im, r);
    bytesNear(out.data, reference(im, r, 1, 1));
  }
});
test('opaque outer-image boundary support never adds artificial transparency', () => {
  for (const [w, h] of [[1, 1], [1, 21], [21, 1], [21, 21]]) {
    const im = image(w, h, () => [35, 151, 234, 255]);
    for (const r of [rect(0, 0, .75, .75), rect(.25, .25, 1, 1), skew()]) {
      const out = P.apply(im, r);
      for (let i = 0; i < out.data.length; i += 4) assert.deepEqual([...out.data.slice(i, i + 4)], [35, 151, 234, 255]);
    }
  }
});
test('quad correspondence permits rotations with positive winding, never silently reorders', () => {
  const base = full().quad, im = image(9, 7);
  for (let turn = 1; turn < 4; turn++) {
    const r = recipe(base.slice(turn).concat(base.slice(0, turn))), out = P.apply(im, r);
    bytesNear(out.data, referenceFiltered(im, r, 9, 7));
    const p = P.plan(9, 7, r); assert.deepEqual(P.mapEdgePoint(p, { x: 0, y: 0 }, 'outputToSource'), { x: r.quad[0].x * 9, y: r.quad[0].y * 7 });
  }
});
test('reject reversed winding, self-crossing, concave, collapsed, nearly collinear and near-pole quads', () => {
  const q = full().quad;
  for (const points of [[q[0], q[3], q[2], q[1]], [q[0], q[2], q[1], q[3]],
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: .2, y: .2 }, { x: 0, y: 1 }],
    [q[0], q[0], q[2], q[3]], [{ x: 0, y: .5 }, { x: 1, y: .5 }, { x: 1, y: .50000000001 }, { x: 0, y: .50000000001 }],
    [{ x: .5, y: 0 }, { x: .500001, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]]) geometry(() => P.validate(recipe(points)));
  geometry(() => P.validate(rect(.1, .1, .100001, .100001)));
});
test('all finite coordinate/fraction range failures and wrong version/types are rejected', () => {
  for (const value of [NaN, Infinity, -Infinity, '0.5', null, undefined, {}, 1n]) {
    const r = full(); r.quad[1].x = value; invalid(() => P.validate(r));
  }
  for (const value of [-Number.MIN_VALUE, 1 + Number.EPSILON]) { const r = full(); r.quad[1].x = value; limit(() => P.validate(r)); }
  for (const value of [0, -1, 1.0001]) { const r = full(); r.outputFraction.width = value; limit(() => P.validate(r)); }
  for (const value of [NaN, Infinity, null, '1']) { const r = full(); r.outputFraction.height = value; invalid(() => P.validate(r)); }
  for (const version of [0, 2, '1', null]) { const r = full(); r.version = version; invalid(() => P.validate(r)); }
  for (const value of [false, 1, [], '']) invalid(() => P.validate(value));
});
test('strict record fields, symbols, accessors, inherited fields and hidden fields never execute getters', () => {
  let gets = 0;
  const makeGetter = (target, key) => Object.defineProperty(target, key, { enumerable: true, get() { gets++; throw new Error('must not run'); } });
  const cases = [];
  for (const key of ['version', 'quad', 'outputFraction']) { const r = full(); cases.push(makeGetter(r, key)); const m = full(); delete m[key]; cases.push(m); }
  let r = full(); makeGetter(r.quad[0], 'x'); cases.push(r);
  r = full(); makeGetter(r.outputFraction, 'width'); cases.push(r);
  r = full(); r.extra = true; cases.push(r);
  r = full(); r[Symbol('extra')] = 1; cases.push(r);
  r = full(); Object.defineProperty(r, 'version', { value: 1, enumerable: false }); cases.push(r);
  r = full(); r.quad[0] = Object.create({ x: 0, y: 0 }); cases.push(r);
  cases.push(Object.assign(Object.create({ inherited: 1 }), full()));
  for (const value of cases) invalid(() => P.validate(value));
  invalid(() => P.apply(makeGetter({ width: 1, height: 1, data: new Uint8Array(4) }, 'data'), null));
  invalid(() => P.plan(1, 1, null, makeGetter({}, 'shouldCancel')));
  invalid(() => P.plan(1, 1, null, Object.create({ get shouldCancel() { gets++; } })));
  invalid(() => P.plan(1, 1, null, { limits: makeGetter({}, 'maxPixels') }));
  assert.equal(gets, 0);
});
test('quad array strict dense entries and native array requirements', () => {
  const mutations = [q => delete q[1], q => q.push(q[0]), q => q.pop(), q => { q.extra = 1; }, q => { q[Symbol('extra')] = 1; },
    q => Object.defineProperty(q, '1', { get() { throw new Error('unsafe'); }, enumerable: true }),
    q => Object.defineProperty(q, '1', { value: q[1], enumerable: false }), q => Object.setPrototypeOf(q, null)];
  for (const mutate of mutations) { const r = full(); mutate(r.quad); invalid(() => P.validate(r)); }
  const r = full(); r.quad = { 0: r.quad[0], 1: r.quad[1], 2: r.quad[2], 3: r.quad[3], length: 4 }; invalid(() => P.validate(r));
});
test('dimensions and source pixel limits checked even with maxSide 1', () => {
  for (const [w, h] of [[0, 1], [-1, 1], [1.5, 1], [16385, 1], [8193, 8193], [Number.MAX_SAFE_INTEGER, 1]]) limit(() => P.plan(w, h, null, { maxSide: 1 }));
  for (const [w, h] of [[NaN, 1], [1, Infinity], ['2', 2]]) invalid(() => P.plan(w, h));
  assert.deepEqual(P.plan(16384, 1, null).outputSize, { width: 16384, height: 1 });
  assert.deepEqual(P.plan(1, 16384, null).outputSize, { width: 1, height: 16384 });
  limit(() => P.plan(8192, 8192, skew(), { maxSide: 1 })); // Full Float32 mips plus source exceed512MiB.
  const p = P.plan(8192, 4096, skew(), { maxSide: 1 }); assert.equal(p.renderedSize.width, 1); assert.equal(p.estimates.outputBytes, 4);
});
test('thin sources, huge planning-only sizes and subpixel rectangles are finite', () => {
  for (const [w, h] of [[16384, 1], [1, 16384], [8192, 4096], [4096, 8192]]) {
    const p = P.plan(w, h, skew(), { maxSide: 7 });
    assert.ok(p.outputToSourceMatrixNormalized.every(Number.isFinite));
    const x = P.mapEdgePoint(p, { x: .5, y: .5 }, 'outputToSource'); assert.ok(x); assert.ok(Number.isFinite(x.x + x.y));
  }
  for (const [w, h] of [[1, 100], [100, 1]]) {
    const im = image(w, h), r = skew(), out = P.apply(im, r); bytesNear(out.data, referenceFiltered(im, r, out.width, out.height));
  }
});
test('lower-only phone caps and source/render/work/memory exact boundary preflight', () => {
  const limits = { maxEdge: 4096, maxPixels: 8000000, maxBytes: 128 * 1024 * 1024, maxWorkUnits: 128000000 };
  assert.equal(P.plan(4000, 2000, skew(), { maxSide: 900, limits }).renderedSize.width, 900);
  limit(() => P.plan(4097, 1, null, { maxSide: 1, limits }));
  limit(() => P.plan(4000, 2001, null, { maxSide: 1, limits }));
  const p = P.plan(20, 10, skew());
  assert.equal(p.workUnits, p.estimates.workUnits); assert.equal(p.estimatedBytes, p.estimates.totalRgbaBytes + p.mipBytes);
  P.plan(20, 10, skew(), { limits: { maxBytes: p.estimatedBytes, maxWorkUnits: p.workUnits } });
  limit(() => P.plan(20, 10, skew(), { limits: { maxBytes: p.estimatedBytes - 1 } }));
  limit(() => P.plan(20, 10, skew(), { limits: { maxWorkUnits: p.workUnits - 1 } }));
  for (const k of Object.keys(P.LIMITS)) limit(() => P.plan(1, 1, null, { limits: { [k]: P.LIMITS[k] + 1 } }));
});
test('invalid options cannot quietly relax caps or inherit cancellation', () => {
  for (const value of [0, 1.5, 16385]) limit(() => P.plan(1, 1, null, { maxSide: value }));
  for (const value of [NaN, '1', null]) invalid(() => P.plan(1, 1, null, { maxSide: value }));
  for (const value of [{ other: 1 }, { shouldCancel: false }, { limits: null }, { limits: { unknown: 1 } }]) invalid(() => P.plan(1, 1, null, value));
  let calls = 0; P.plan(10, 10, null, { shouldCancel() { calls++; return true; } }); assert.equal(calls, 0, 'planning validates but never invokes callbacks');
});
test('typed-array native metadata, byte brand, same realm and exact lengths', () => {
  for (const data of [[], new Uint8Array(3), new Uint8Array(5), new Uint16Array(4), new Float32Array(4), new DataView(new ArrayBuffer(4)), Buffer.alloc(4), new (class extends Uint8Array {})(4)]) {
    invalid(() => P.apply({ width: 1, height: 1, data }));
  }
  const spoof = new Float32Array(4); Object.setPrototypeOf(spoof, Uint8Array.prototype); invalid(() => P.apply({ width: 1, height: 1, data: spoof }));
  const fake = Object.create(Uint8Array.prototype); invalid(() => P.apply({ width: 1, height: 1, data: fake }));
  const foreign = vm.runInNewContext('new Uint8Array(4)'); invalid(() => P.apply({ width: 1, height: 1, data: foreign }));
  for (const type of [Uint8Array, Uint8ClampedArray]) { const im = { width: 1, height: 1, data: new type([4, 5, 6, 0]) }; assert.equal(P.apply(im), im); }
});
test('typed metadata getters/symbols rejected without invocation; backing shadows cannot bypass native checks', () => {
  let gets = 0;
  for (const key of ['length', 'buffer', 'byteLength', 'byteOffset']) {
    const data = new Uint8Array(4); Object.defineProperty(data, key, { get() { gets++; return 4; } }); invalid(() => P.apply({ width: 1, height: 1, data }));
  }
  const data = new Uint8Array(4); Object.defineProperty(data, Symbol.toStringTag, { get() { gets++; return 'Uint8Array'; } });
  invalid(() => P.apply({ width: 1, height: 1, data }));
  const buffer = new ArrayBuffer(4); Object.defineProperty(buffer, 'byteLength', { get() { gets++; throw new Error('must not run'); } });
  const clean = { width: 1, height: 1, data: new Uint8Array(buffer) }; assert.equal(P.apply(clean), clean);
  assert.equal(gets, 0);
});
test('reject SharedArrayBuffer even when its prototype is spoofed as ArrayBuffer', { skip: typeof SharedArrayBuffer !== 'function' }, () => {
  for (const spoof of [false, true]) {
    const buffer = new SharedArrayBuffer(4), data = new Uint8Array(buffer);
    if (spoof) Object.setPrototypeOf(buffer, ArrayBuffer.prototype);
    invalid(() => P.apply({ width: 1, height: 1, data }));
  }
});
test('reject resizable backing including shadowed false resizable property', { skip: !Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable') }, () => {
  for (const shadow of [false, true]) {
    const buffer = new ArrayBuffer(4, { maxByteLength: 8 }), data = new Uint8Array(buffer, 0, 4);
    if (shadow) Object.defineProperty(buffer, 'resizable', { get() { throw new Error('must not run'); } });
    invalid(() => P.apply({ width: 1, height: 1, data }));
  }
  const buffer = new (class extends ArrayBuffer {})(4); invalid(() => P.apply({ width: 1, height: 1, data: new Uint8Array(buffer) }));
});
test('reject detached buffers and detect callback-time detachment', () => {
  let data = new Uint8Array(4); structuredClone(data.buffer, { transfer: [data.buffer] }); invalid(() => P.apply({ width: 1, height: 1, data }));
  data = new Uint8Array(4 * 5 * 5);
  invalid(() => P.apply({ width: 5, height: 5, data }, skew(), { shouldCancel() { structuredClone(data.buffer, { transfer: [data.buffer] }); return false; } }));
  data = new Uint8Array(4 * 5 * 5); let n = 0;
  invalid(() => P.apply({ width: 5, height: 5, data }, skew(), { shouldCancel() { if (++n === 3) structuredClone(data.buffer, { transfer: [data.buffer] }); return false; } }));
});
test('fixed subviews accepted, full backing retained bytes charged before callbacks', () => {
  const buffer = new ArrayBuffer(100), data = new Uint8Array(buffer, 16, 4), im = { width: 1, height: 1, data };
  data.set([41, 55, 60, 0]); assert.equal(P.apply(im), im);
  let calls = 0; limit(() => P.apply(im, null, { limits: { maxBytes: 99 }, shouldCancel() { calls++; } })); assert.equal(calls, 0);
  assert.equal(P.apply(im, null, { limits: { maxBytes: 100 } }), im);
});
test('cancellation before allocation, during row, mid-row, final check; input never mutated', () => {
  const im = image(3000, 4), before = im.data.slice(), r = full(); r.outputFraction.height = .5;
  for (const stop of [1, 2, 3, 4, 5, 6, 7, 8]) {
    let calls = 0, result = 'not-returned';
    abort(() => { result = P.apply(im, r, { shouldCancel() { return ++calls === stop; } }); });
    assert.equal(result, 'not-returned'); assert.deepEqual(im.data, before);
  }
  let calls = 0; abort(() => P.apply(image(1, 1), null, { shouldCancel() { calls++; return true; } })); assert.equal(calls, 1);
  const copy = image(8, 8), copyBefore = copy.data.slice(); let checks = 0;
  abort(() => P.apply(copy, rect(.25, .25, .75, .75, .5, .5), { shouldCancel() { return ++checks === 4; } })); assert.deepEqual(copy.data, copyBefore);
});
test('all strict/resource validation precedes cancellation callback; callback exceptions propagate', () => {
  let n = 0; const opts = { shouldCancel() { n++; return true; }, limits: { maxPixels: 1 } };
  limit(() => P.apply(image(2, 2), null, opts)); assert.equal(n, 0);
  const r = full(); r.quad[0].x = NaN; invalid(() => P.apply(image(1, 1), r, { shouldCancel() { n++; } })); assert.equal(n, 0);
  const error = new Error('callback'); assert.throws(() => P.apply(image(1, 1), null, { shouldCancel() { throw error; } }), e => e === error);
});
test('mapping requires issued immutable plans, explicit directions and strict points; outside returns null', () => {
  const p = P.plan(100, 100, rect(.25, .25, .75, .75));
  for (const forged of [{}, clone(p), null, 4]) assert.equal(P.mapEdgePoint(forged, { x: 1, y: 1 }, 'sourceToOutput'), null);
  for (const direction of [undefined, 'forward', 'inverse', 'bad']) assert.equal(P.mapEdgePoint(p, { x: 50, y: 50 }, direction), null);
  for (const point of [{ x: 0, y: 0 }, { x: 24, y: 50 }, { x: 76, y: 50 }, { x: -1, y: 0 }, { x: 101, y: 0 }, { x: NaN, y: 0 }, { x: 50 },
    { x: '50', y: 50 }, Object.create({ x: 50, y: 50 }), { x: 50, y: 50, extra: 1 }]) assert.equal(P.mapEdgePoint(p, point, 'sourceToOutput'), null);
  let gets = 0; assert.equal(P.mapEdgePoint(p, { get x() { gets++; return 50; }, y: 50 }, 'sourceToOutput'), null); assert.equal(gets, 0);
  for (const point of [{ x: -1, y: 50 }, { x: 101, y: 50 }]) assert.equal(P.mapEdgePoint(p, point, 'outputToSource'), null);
  assert.deepEqual(P.mapEdgePoint(p, { x: 50, y: 50 }, 'sourceToOutput'), { x: 50, y: 50 });
  assert.deepEqual(P.mapEdgePoint(p, { x: 0, y: 0 }, 'outputToSource'), { x: 25, y: 25 });
});
test('no full-image intermediate allocation when maxSide is small', () => {
  const allocations = [], native = Uint8ClampedArray;
  const Spy = new Proxy(native, { construct(target, args) { allocations.push(args[0]); return Reflect.construct(target, args); } });
  const code = fs.readFileSync(require.resolve('../app/src/main/assets/perspective.js'), 'utf8');
  const sandbox = { Uint8Array, Uint8ClampedArray: Spy, ArrayBuffer, Object, Reflect, Number, Math, WeakSet, Float64Array, Error, TypeError, RangeError, Symbol };
  vm.runInNewContext(code, sandbox);
  const im = image(2048, 1024), out = sandbox.MintPerspective.apply(im, null, { maxSide: 16 });
  assert.equal(out.data.length, 16 * 8 * 4); assert.deepEqual(allocations, [16 * 8 * 4]);
  allocations.length = 0; let calls = 0;
  abort(() => sandbox.MintPerspective.apply(im, null, { maxSide: 16, shouldCancel() { calls++; return true; } }));
  assert.deepEqual(allocations, []); assert.equal(calls, 1);
});

test('source-quad membership is not widened by a thin quad inverse condition number', () => {
  const p = P.plan(16384, 1000, rect(.4, .4, .40001, .6));
  assert.ok(p.geometry.matrixCondition > 10000);
  for (const x of [.4 - 1e-13, .4 - 1e-10, .40001 + 1e-10, .40001 + 1e-13]) {
    assert.equal(P.mapEdgePoint(p, { x: x * 16384, y: 500 }, 'sourceToOutput'), null);
  }
  for (const y of [.4 - 1e-13, .6 + 1e-13]) assert.equal(P.mapEdgePoint(p, { x: .400005 * 16384, y: y * 1000 }, 'sourceToOutput'), null);
});

test('severe checker minification suppresses aliasing in linear light', () => {
  const im = image(256, 256, (x, y) => [(x + y) % 2 * 255, (x + y) % 2 * 255, (x + y) % 2 * 255, 255]);
  const out = P.apply(im, rect(0, 0, 1, 1, 17 / 256, 17 / 256));
  for (let i = 0; i < out.data.length; i += 4) assert.deepEqual([...out.data.slice(i, i + 4)], [188, 188, 188, 255]);
});
test('bounded anisotropy preserves an unminified axis and signals ratios exceeding16', () => {
  for (const factor of [8, 16]) for (const transpose of [false, true]) {
    const w = transpose ? 64 : 256, h = transpose ? 256 : 64;
    const im = image(w, h, (x, y) => { const a = (transpose ? y : x) % 2 * 255; return [a, a, a, 255]; });
    const r = rect(0, 0, 1, 1, transpose ? 1 / factor : 1, transpose ? 1 : 1 / factor);
    const p = P.plan(w, h, r), out = P.apply(im, r);
    assert.equal(p.mipBytes, 0); assert.equal(p.sampling.sampleCountBound, factor); assert.equal(p.sampling.tapsPerSample, 4);
    for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) assert.equal(out.data[(y * out.width + x) * 4], (transpose ? y : x) % 2 * 255);
  }
  const p = P.plan(256, 256, rect(0, 0, 1, 1, 1, 1 / 64));
  assert.equal(p.sampling.sampleCountBound, 16); assert.equal(p.sampling.maySoftenMinorAxis, true); assert.equal(p.sampling.baseFootprintBound, 4);
});
test('near-unity transform avoids artificial anisotropic blur jump; magnification remains bilinear', () => {
  const im = image(128, 73, (x, y) => [x % 2 * 255, y % 2 * 255, (x + y) % 2 * 255, 255]);
  const r = rect(0, 0, 1, 1, 127 / 128, 1), out = P.apply(im, r), baseline = reference(im, r, out.width, out.height);
  let sum = 0, max = 0;
  for (let i = 0; i < out.data.length; i++) { const e = Math.abs(out.data[i] - baseline[i]); sum += e; max = Math.max(max, e); }
  assert.ok(sum / out.data.length < 1); assert.ok(max <= 3);
  const zoom = rect(.2, .2, .8, .8), p = P.plan(128, 73, zoom), z = P.apply(im, zoom);
  assert.equal(p.mipBytes, 0); assert.equal(p.sampling.sampleCountBound, 1); bytesNear(z.data, reference(im, zoom, z.width, z.height));
});
test('mip levels and work/memory accounting are exact, lower-only, and checked preallocation', () => {
  const p = P.plan(256, 256, null, { maxSide: 17 });
  assert.deepEqual(p.mipLevels.map(v => [v.width, v.height]), [[128, 128], [64, 64], [32, 32], [16, 16]]);
  assert.equal(p.mipBytes, (128 ** 2 + 64 ** 2 + 32 ** 2 + 16 ** 2) * 16);
  assert.equal(p.estimates.mipWorkUnits, p.mipBytes / 4);
  assert.equal(p.workUnits, p.estimates.mipWorkUnits + 17 * 17 * 8);
  assert.equal(p.estimatedBytes, 256 * 256 * 4 + 17 * 17 * 4 + p.mipBytes);
  const im = image(256, 256); let calls = 0;
  limit(() => P.apply(im, null, { maxSide: 17, limits: { maxBytes: p.estimatedBytes - 1 }, shouldCancel() { calls++; } }));
  limit(() => P.apply(im, null, { maxSide: 17, limits: { maxWorkUnits: p.workUnits - 1 }, shouldCancel() { calls++; } }));
  assert.equal(calls, 0);
  P.apply(im, null, { maxSide: 17, limits: { maxBytes: p.estimatedBytes, maxWorkUnits: p.workUnits } });
  const odd = P.plan(31, 19, null, { maxSide: 4 });
  assert.deepEqual(odd.mipLevels.map(v => [v.width, v.height, v.scale]), [[16, 10, 2], [8, 5, 4], [4, 3, 8]]);
});
test('mip construction and final anisotropic rendering cancellation remain atomic', () => {
  const im = image(65, 37), before = im.data.slice(), options = { maxSide: 7 };
  let total = 0; P.apply(im, null, { ...options, shouldCancel() { total++; return false; } });
  assert.ok(total > 30);
  for (const stop of [1, 2, 3, 7, 15, 25, total - 1, total]) {
    let calls = 0, result = null;
    abort(() => { result = P.apply(im, null, { ...options, shouldCancel() { return ++calls === stop; } }); });
    assert.equal(result, null); assert.deepEqual(im.data, before);
  }
});
test('prefiltered transparent hidden RGB is invariant under minification and anisotropy', () => {
  const a = image(63, 35, (x, y) => (x + y) % 3 ? [255, 77, 12, 180] : [255, 0, 255, 0]);
  const b = { width: a.width, height: a.height, data: a.data.slice() };
  for (let i = 0; i < b.data.length; i += 4) if (!b.data[i + 3]) { b.data[i] = 0; b.data[i + 1] = 255; b.data[i + 2] = 0; }
  for (const r of [rect(0, 0, 1, 1, .12, .12), rect(0, 0, 1, 1, 1, .07), skew()]) {
    const x = P.apply(a, r), y = P.apply(b, r); assert.deepEqual(x.data, y.data);
    for (let i = 0; i < x.data.length; i += 4) if (!x.data[i + 3]) assert.deepEqual([...x.data.slice(i, i + 3)], [0, 0, 0]);
  }
});
