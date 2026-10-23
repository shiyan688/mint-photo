'use strict';
// Pure persistence/geometry/safety tests. These do not claim Android decode or UI QA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../app/src/main/assets/project-core.js');
const tests = [];
const test = (name, run) => tests.push({ name, run });
const bytes = new Uint8Array([0, 255, 137, 80, 78, 71, 17, 2, 0, 99]);
const blob = new Blob([bytes], { type: 'image/png' });
const source = (width = 3000, height = 2000) => ({ blob, name: '  原始照片.png  ', width, height, mime: 'IMAGE/PNG' });
const crop = (w = 0.5, h = 0.5) => ({ type: 'crop', x: 0.1, y: 0.1, w, h, ratio: 0 });
const id = (outW = 295, outH = 413) => ({ type: 'idphoto', x: 0, y: 0, w: 0.8, h: 0.8, outW, outH, selected: true });
const mesh = () => Array.from({ length: 478 }, (_, i) => ({ x: 0.3 + i / 2000, y: 0.2 + i / 3000, z: -0.1 }));
const background = (mask = { width: 2, height: 2, data: 'AP9/gA==' }) => ({ type: 'background', mask, mode: 'color', color: '#dcebf1', blur: 18, feather: 2, valid: true, brush: 0.06 });
const reject = (fn, expression = /[\u3400-\u9fff]/u) => assert.throws(fn, expression);

test('CommonJS and browser UMD expose the same five functions without DOM access', () => {
  const env = { Blob, Uint8Array, Uint8ClampedArray };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/src/main/assets/project-core.js'), 'utf8'), env);
  assert.deepEqual(Object.keys(env.ProjectCore).sort(), Object.keys(Core).sort());
  assert.equal(env.ProjectCore.makeProject(source()).source.blob, blob);
});
test('make/save/restore preserve original Blob object identity, bytes, MIME and oriented dimensions', async () => {
  const project = Core.makeProject(source(2000, 3000), [crop()], [{ type: 'rotate' }]);
  assert.equal(project.version, 2);
  assert.equal(project.source.name, '原始照片.png');
  assert.equal(project.source.mime, 'image/png');
  assert.equal(project.source.origin, 'original');
  const record = Core.draftRecord(project), restored = Core.restoreProject(record);
  for (const value of [project, record, restored]) {
    assert.equal(value.source.blob, blob);
    assert.deepEqual(new Uint8Array(await value.source.blob.arrayBuffer()), bytes);
    assert.equal(value.source.width, 2000); assert.equal(value.source.height, 3000);
  }
  assert.deepEqual(restored, project);
});
test('structured-clone storage roundtrip preserves original bytes, not a recompressed preview', async () => {
  const saved = structuredClone(Core.draftRecord(Core.makeProject(source())));
  const restored = Core.restoreProject(saved);
  assert.equal(restored.source.blob, saved.source.blob);
  assert.deepEqual(new Uint8Array(await restored.source.blob.arrayBuffer()), bytes);
});
test('ops and redo have independent deep copies at each API boundary', () => {
  const inputOps = [{ type: 'draw', width: 0.012, color: '#ffffff', lines: [[{ x: 0.2, y: 0.3 }]] }];
  const inputRedo = [{ type: 'warp', radius: 0.12, strength: 0.5, strokes: [{ from: { x: 0.4, y: 0.5 }, to: { x: 0.45, y: 0.55 }, radius: 0.12, strength: 0.5 }] }];
  const project = Core.makeProject(source(), inputOps, inputRedo);
  inputOps[0].lines[0][0].x = 0.9; inputRedo[0].strokes[0].to.y = 0.9;
  assert.equal(project.ops[0].lines[0][0].x, 0.2); assert.equal(project.redo[0].strokes[0].to.y, 0.55);
  const saved = Core.draftRecord(project), restored = Core.restoreProject(saved);
  project.ops[0].lines[0][0].x = 0.8; saved.redo[0].strokes[0].from.x = 0.8;
  assert.equal(saved.ops[0].lines[0][0].x, 0.2); assert.equal(restored.redo[0].strokes[0].from.x, 0.4);
  restored.ops[0].lines[0][0].x = 0.7; assert.equal(saved.ops[0].lines[0][0].x, 0.2);
});
test('all current general editing and portrait operation shapes validate and roundtrip', () => {
  const ops = [
    { type: 'rotate' }, { type: 'flip', axis: 'x' }, crop(), id(), { type: 'filter', id: 'mint' },
    { type: 'adjust', values: { brightness: -100, contrast: 100, saturation: 0, warmth: 10 } },
    { type: 'text', text: '薄荷\n人像', x: 0.5, y: 0.5, size: 0.09, color: '#ffffff', shadow: true },
    { type: 'sticker', text: '♡', x: 0.5, y: 0.5, size: 0.19, color: '#e8b1a0', shadow: false },
    { type: 'draw', width: 0.012, color: '#ffffff', lines: [[{ x: 0, y: 1 }, { x: 1, y: 0 }]] },
    { type: 'beauty', values: { smooth: 25, brighten: 8, warmth: 0 }, landmarks: mesh(), region: null },
    { type: 'beauty', values: { smooth: 100, brighten: 60, warmth: -40 }, landmarks: null, region: { x: 0.5, y: 0.45, r: 0.2 } },
    { type: 'reshape', values: { slim: 20, eyes: 15, nose: -20, jaw: 30 }, landmarks: mesh() },
    { type: 'heal', radius: 0.02, strength: 0.8, spots: [{ x: 0.4, y: 0.5, r: 0.02 }] },
    { type: 'warp', radius: 0.12, strength: 0.5, strokes: [{ from: { x: 0.4, y: 0.5 }, to: { x: 0.45, y: 0.55 }, radius: 0.12, strength: 0.5 }] },
    background()
  ];
  assert.deepEqual(Core.restoreProject(Core.draftRecord(Core.makeProject(source(), ops))).ops, ops);
  assert.deepEqual(Core.outputSize(source(), ops), { width: 295, height: 413 });
});
test('version 1 migration uses decoded working-copy dimensions and never fabricates an original', () => {
  const old = { version: 1, blob, name: '旧照片', ops: [crop()], when: 42 };
  const project = Core.restoreProject(old, { width: 2560, height: 1707 });
  assert.equal(project.source.origin, 'legacy-working-copy'); assert.equal(project.source.blob, blob);
  assert.deepEqual(Core.outputSize(project.source, project.ops), { width: 1280, height: 854 });
  assert.deepEqual(project.redo, []); assert.equal(old.version, 1);
  assert.equal(Core.restoreProject(Core.draftRecord(project)).source.origin, 'legacy-working-copy');
  reject(() => Core.planExport(project.source, project.ops, 'original'), /旧版草稿/);
  assert.match(Core.planExport(project.source, project.ops, 'working').warning, /不可恢复/);
  reject(() => Core.restoreProject(old), /解码/);
});
test('version 2 never substitutes fallback working dimensions for saved original dimensions', () => {
  const saved = Core.draftRecord(Core.makeProject(source(4000, 2000)));
  const result = Core.restoreProject(saved, { width: 2560, height: 1280 });
  assert.equal(result.source.width, 4000); assert.equal(result.source.height, 2000);
});
test('missing, empty, or fake original Blobs reject instead of making false original claims', () => {
  for (const missing of [undefined, null, {}, { size: 12, type: 'image/png' }, new Blob([])]) {
    reject(() => Core.makeProject({ ...source(), blob: missing }), /文件/);
    reject(() => Core.planExport({ ...source(), blob: missing }, [], 'original'), /原始照片/);
    reject(() => Core.restoreProject({ version: 1, blob: missing }, { width: 10, height: 20 }), /文件/);
  }
  const saved = Core.draftRecord(Core.makeProject(source())); delete saved.source.blob;
  reject(() => Core.restoreProject(saved), /文件/);
});
test('source metadata reject nonfinite, fractional, zero, oversized numeric dimensions and wrong MIME', () => {
  for (const width of [0, -1, NaN, Infinity, 1.5, '100', 1000001]) reject(() => Core.makeProject({ ...source(), width }));
  for (const height of [null, undefined, -Infinity]) reject(() => Core.makeProject({ ...source(), height }));
  reject(() => Core.makeProject({ ...source(), mime: 'text/html' }));
  reject(() => Core.makeProject({ ...source(), name: 'bad\u0000name' }));
  reject(() => Core.makeProject({ ...source(), origin: 'restored-original' }));
  assert.equal(Core.makeProject({ ...source(), name: ' ' }).source.name, '照片');
  assert.equal(Core.makeProject({ blob: new Blob(['bytes']), width: 10, height: 20 }).source.mime, 'application/octet-stream');
});
test('future, missing-version, malformed, and incomplete records fail explicitly', () => {
  for (const record of [null, [], {}, { version: 0 }, { version: '2' }, { version: 1.5 }]) reject(() => Core.restoreProject(record));
  reject(() => Core.restoreProject({ version: 3 }), /更新版本/);
  const base = Core.draftRecord(Core.makeProject(source()));
  for (const key of ['source', 'ops', 'redo']) { const bad = { ...base }; delete bad[key]; reject(() => Core.restoreProject(bad)); }
  const bad = structuredClone(base); delete bad.source.origin; reject(() => Core.restoreProject(bad), /来源标记/);
  reject(() => Core.restoreProject({ ...base, ops: null })); reject(() => Core.restoreProject({ ...base, redo: {} }));
});
test('source import caps also protect restores and planners, independently of export budgets', () => {
  const maxBytes = 40 * 1024 * 1024;
  const largeBlob = new Blob([new Uint8Array(maxBytes + 1)], { type: 'image/png' });
  reject(() => Core.makeProject({ ...source(), blob: largeBlob }), /40 MiB/);
  reject(() => Core.restoreProject({ version: 1, blob: largeBlob }, { width: 10, height: 20 }), /40 MiB/);
  reject(() => Core.planExport({ ...source(), blob: largeBlob }, [], 'working'), /40 MiB/);
  assert.equal(Core.makeProject({ ...source(), blob: largeBlob.slice(0, maxBytes) }).source.blob.size, maxBytes);
  assert.equal(Core.makeProject(source(10000, 8000)).source.width, 10000);
  reject(() => Core.makeProject(source(10000, 8001)), /8000 万/);
  reject(() => Core.restoreProject({ version: 1, blob }, { width: 10000, height: 8001 }), /8000 万/);
  reject(() => Core.planExport(source(10000, 8001), [], 'working'), /8000 万/);
  const saved = Core.draftRecord(Core.makeProject(source())); saved.source.height = 100000;
  reject(() => Core.restoreProject(saved), /8000 万/);
});
test('crop then rotate and rotate then crop compute different correctly rounded sizes', () => {
  assert.deepEqual(Core.outputSize(source(3001, 2001), [crop(0.5, 0.25), { type: 'rotate' }]), { width: 500, height: 1501 });
  assert.deepEqual(Core.outputSize(source(3001, 2001), [{ type: 'rotate' }, crop(0.5, 0.25)]), { width: 1001, height: 750 });
  assert.deepEqual(Core.outputSize(source(1, 1), [crop(0.01, 0.01)]), { width: 1, height: 1 });
});
test('original planning retains exact oriented source and tracks every intermediate size', () => {
  const plan = Core.planExport(source(3000, 2000), [crop(), { type: 'rotate' }, id(), { type: 'rotate' }], 'original');
  assert.deepEqual(plan.input, { width: 3000, height: 2000 });
  assert.deepEqual(plan.steps, [{ width: 1500, height: 1000 }, { width: 1000, height: 1500 }, { width: 295, height: 413 }, { width: 413, height: 295 }]);
  assert.deepEqual(plan.output, { width: 413, height: 295 }); assert.equal(plan.scale, 1); assert.equal(plan.usesOriginal, true);
});
test('working mode caps starting long edge at 2560 without mutating original source or ops', () => {
  const metadata = source(6000, 4000), operations = [crop(), { type: 'rotate' }];
  const plan = Core.planExport(metadata, operations, 'working');
  assert.deepEqual(plan.input, { width: 2560, height: 1707 }); assert.equal(plan.scale, 2560 / 6000);
  assert.deepEqual(plan.output, { width: 854, height: 1280 }); assert.equal(plan.usesOriginal, false);
  assert.equal(metadata.width, 6000); assert.equal(metadata.blob, blob); assert.equal(operations[0].w, 0.5);
  assert.deepEqual(Core.planExport(source(500, 300), [], 'working').input, { width: 500, height: 300 });
});
test('ID-photo fixed dimensions survive working downscale and later rotate/crop in order', () => {
  for (const mode of ['working', 'original']) {
    assert.deepEqual(Core.planExport(source(), [id()], mode).output, { width: 295, height: 413 });
    assert.deepEqual(Core.planExport(source(), [id(413, 579), { type: 'rotate' }, crop()], mode).output, { width: 290, height: 207 });
  }
  assert.deepEqual(Core.planExport(source(10000, 8000), [id()], 'working').output, { width: 295, height: 413 });
  assert.deepEqual(Core.planExport(source(), [id(3000, 1000)], 'working').output, { width: 3000, height: 1000 });
});
test('exact 8M/4096 budgets pass but original overbudget always fails before any decode', () => {
  assert.deepEqual(Core.planExport(source(4000, 2000), [], 'original').output, { width: 4000, height: 2000 });
  assert.deepEqual(Core.planExport(source(4096, 1), [], 'original').output, { width: 4096, height: 1 });
  for (const metadata of [source(4000, 2001), source(4097, 1), source(10000, 8000)]) {
    for (const ops of [[], [crop(0.01, 0.01)], [id()]]) reject(() => Core.planExport(metadata, ops, 'original'), /原始照片.*未自动缩小/);
  }
});
test('intermediate budget cannot be bypassed with a later crop or smaller ID-photo output', () => {
  for (const mode of ['original', 'working']) {
    for (const oversize of [id(4000, 2001), id(4097, 1), id(1000000, 1000000)]) {
      reject(() => Core.planExport(source(), [oversize, crop(0.01, 0.01), id()], mode), /第 1 步中间图像/);
    }
  }
  reject(() => Core.planExport(source(), [], 'silent-auto'), /模式/);
});
test('60-step total history limit includes redo and sparse arrays are rejected', () => {
  assert.equal(Core.makeProject(source(), Array.from({ length: 30 }, () => ({ type: 'rotate' })), Array.from({ length: 30 }, () => ({ type: 'rotate' }))).ops.length, 30);
  reject(() => Core.makeProject(source(), Array.from({ length: 61 }, () => ({ type: 'rotate' }))));
  reject(() => Core.makeProject(source(), Array.from({ length: 60 }, () => ({ type: 'rotate' })), [{ type: 'rotate' }]), /合计/);
  reject(() => Core.makeProject(source(), Array(1)), /缺失项/);
  reject(() => Core.outputSize(source(), Array.from({ length: 61 }, () => ({ type: 'rotate' }))));
});
test('unsupported types, unknown fields, nonfinite values and malformed operations are never silently skipped', () => {
  const broken = [null, [], {}, { type: 'future-ai' }, { type: 'rotate', degrees: 45 }, { type: 'flip', axis: 'z' }, { type: 'filter', id: 'future' },
    { ...crop(), x: Infinity }, { ...crop(), y: NaN }, { ...crop(), w: 0 }, { ...crop(), x: 0.8 },
    { type: 'adjust', values: { brightness: NaN } }, { type: 'adjust', values: { saturation: 101 } },
    { type: 'adjust', values: { exposure: 2 } }, { ...id(), outH: 413.5 },
    { type: 'text', text: 'x', x: 0.5, y: 0.5, size: 0.1, color: 'red' },
    { type: 'heal', strength: 0.8, spots: [{ x: -1, y: 0.3, r: 0.02 }] }];
  for (const op of broken) for (const fn of [() => Core.makeProject(source(), [op]), () => Core.outputSize(source(), [op]), () => Core.planExport(source(), [op], 'working')]) reject(fn);
});
test('mask dimensions and actual bytes/base64 length are bounded before allocation or decoding', () => {
  const full = { width: 512, height: 512, data: Buffer.alloc(262144, 255).toString('base64') };
  assert.equal(Core.makeProject(source(), [background(full)]).ops[0].mask.data, full.data);
  const corrupt = [
    { width: 513, height: 512, data: '' }, { width: 4097, height: 1, data: '' }, { width: 0, height: 2, data: '' },
    { width: 2, height: 2, data: 'AA==' }, { width: 2, height: 2, data: '!!!!====' },
    { width: 2, height: 2, data: [0, 255, 128] }, { width: 2, height: 2, data: [0, 256, 128, 0] },
    { width: 2, height: 2, data: [0, NaN, 128, 0] }, { width: 2, height: 2, data: Array(4) },
    { width: 2, height: 2, data: 'AP9/gA==', maxValue: 1 }
  ];
  for (const value of corrupt) reject(() => Core.makeProject(source(), [background(value)]));
  reject(() => Core.makeProject(source(), [background(null)]), /蒙版/);
});
test('array and typed-array mask data are cloned into portable byte arrays', () => {
  for (const data of [[0, 255, 127, 128], new Uint8Array([0, 255, 127, 128]), new Uint8ClampedArray([0, 255, 127, 128])]) {
    const project = Core.makeProject(source(), [background({ width: 2, height: 2, data })]);
    assert.deepEqual(project.ops[0].mask.data, [0, 255, 127, 128]); data[0] = 255;
    assert.equal(project.ops[0].mask.data[0], 0);
    const saved = Core.draftRecord(project); project.ops[0].mask.data[1] = 0; assert.equal(saved.ops[0].mask.data[1], 255);
  }
});
test('landmark meshes are bounded and copied, with finite off-frame detector coordinates retained', () => {
  const landmarks = mesh(); landmarks[0].x = -0.01;
  const op = { type: 'reshape', values: { slim: 20 }, landmarks };
  const result = Core.makeProject(source(), [op]); assert.equal(result.ops[0].landmarks[0].x, -0.01);
  landmarks[0].x = 0.5; assert.equal(result.ops[0].landmarks[0].x, -0.01);
  for (const bad of [[], mesh().slice(1), Array(478), mesh().map((p, i) => i ? p : { x: Infinity, y: 0.5 })]) reject(() => Core.makeProject(source(), [{ ...op, landmarks: bad }]));
  reject(() => Core.makeProject(source(), [{ ...op, landmarks: mesh().map((p, i) => i ? p : { x: 0.5, y: 0.5, z: NaN }) }]));
});
test('localized tools and drawing cannot exceed their bounded work sizes', () => {
  reject(() => Core.makeProject(source(), [{ type: 'heal', strength: 0.8, spots: Array.from({ length: 65 }, () => ({ x: 0.5, y: 0.5, r: 0.02 })) }]));
  reject(() => Core.makeProject(source(), [{ type: 'warp', strokes: Array.from({ length: 21 }, () => ({ from: { x: 0.4, y: 0.5 }, to: { x: 0.5, y: 0.5 }, radius: 0.1, strength: 0.5 })) }]));
  reject(() => Core.makeProject(source(), [{ type: 'draw', color: '#ffffff', width: 0.012, lines: [Array.from({ length: 16385 }, () => ({ x: 0.5, y: 0.5 }))] }]), /16384/);
  reject(() => Core.makeProject(source(), [{ type: 'draw', color: '#ffffff', width: 0.012, lines: [[]] }]));
});
test('validation does not mutate frozen source, frozen operations, or deeply frozen history', () => {
  const ops = Object.freeze([Object.freeze({ type: 'adjust', values: Object.freeze({ brightness: 10 }) })]);
  const input = Object.freeze(source()); const project = Core.makeProject(input, ops);
  assert.equal(Core.planExport(input, ops, 'original').output.width, 3000);
  assert.equal(Core.draftRecord(Object.freeze(project)).source.blob, blob);
});

test('new geometry uses deterministic integer planning, independent recipe snapshots and original Blob',()=>{const G=require('../app/src/main/assets/geometry.js'),r=G.defaults();r.crop={x:.11,y:.2,w:.52,h:.5};r.quarterTurns=1;r.flipX=true;const input=source(101,81),ops=[{type:'geometry',recipe:r},{type:'flip',axis:'x'}];const project=Core.makeProject(input,ops),record=Core.draftRecord(project),restored=Core.restoreProject(record);assert.deepEqual(Core.outputSize(input,ops),{width:41,height:53});assert.deepEqual(restored.ops,project.ops);assert.equal(restored.source.blob,blob);r.crop.w=.1;assert.equal(project.ops[0].recipe.crop.w,.52);});
test('new geometry missing or accessor recipe fails instead of silently becoming identity',()=>{reject(()=>Core.makeProject(source(),[{type:'geometry'}]));let reads=0;const op={type:'geometry'};Object.defineProperty(op,'recipe',{enumerable:true,get(){reads++;return null;}});reject(()=>Core.makeProject(source(),[op]));assert.equal(reads,0);});
test('new geometry refuses malformed commands and absent browser core rather than dropping edits',()=>{for(const recipe of [{version:1},{version:2}, {version:1,crop:{x:0,y:0,w:1,h:1},quarterTurns:4,flipX:false,flipY:false}])assert.throws(()=>Core.makeProject(source(),[{type:'geometry',recipe}]));const env=vm.createContext({Blob,Uint8Array,Uint8ClampedArray});vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/src/main/assets/project-core.js'),'utf8'),env);assert.throws(()=>env.ProjectCore.makeProject(source(),[{type:'geometry',recipe:null}]),/构图核心缺失/);});

(async () => {
  let passed = 0;
  for (const { name, run } of tests) {
    try { await run(); passed++; console.log('PASS', name); }
    catch (error) { console.error('FAIL', name); console.error(error); process.exitCode = 1; }
  }
  console.log(`${passed}/${tests.length} project-core checks passed (pure logic only)`);
})();
