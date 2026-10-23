'use strict';
// Controlled DOM and asynchronous importer exercise the shipped UI's lifecycle.
// Pixel replay and native browser rendering are covered by the integration suite.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assets = path.join(__dirname, '../app/src/main/assets');
const plain = value => JSON.parse(JSON.stringify(value));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function harness() {
  const nodes = {}, events = {}, docEvents = {}, imports = [], previews = [], notices = [], outlines = [], assessmentOps = [];
  let draft = null, source = canvas(600, 400), revision = '1/1', renders = 0, budget = { original: { allowed: true }, working: { allowed: true } };
  function canvas(width, height) { return { width, height, getContext: () => ({}) }; }
  function node(id) {
    const n = { id, value: '', hidden: false, disabled: false, textContent: '', isConnected: true, files: [], attributes: {},
      setAttribute(k, v) { this.attributes[k] = v; }, click() { if (!this.disabled && this.onclick) return this.onclick({ target: this }); } };
    nodes[id] = n; return n;
  }
  const panel = node('toolPanel'); node('editLabel'); panel.querySelector = s => nodes[s.slice(1)] || null;
  Object.defineProperty(panel, 'innerHTML', { set(value) { panel.markup = value; for (const m of value.matchAll(/\bid="([^"]+)"/g)) node(m[1]); } });
  const env = { console, Uint8Array, Uint8ClampedArray, ArrayBuffer, Float64Array, Float32Array,
    document: { getElementById: id => nodes[id] || null, createElement: () => canvas(1, 1), addEventListener: (k, f) => docEvents[k] = f, removeEventListener: (k, f) => { if (docEvents[k] === f) delete docEvents[k]; } },
    addEventListener: (k, f) => events[k] = f, removeEventListener: (k, f) => { if (events[k] === f) delete events[k]; } };
  vm.createContext(env);
  for (const filename of ['image-overlay.js', 'collage-layout.js', 'collage-operation.js']) {
    const actual = path.join(assets, filename);
    vm.runInContext(fs.readFileSync(actual, 'utf8'), env, { filename });
  }
  const actualOperation = env.MintCollageOperation;
  env.MintCollageOperation = Object.freeze({ ...actualOperation, applyCanvas(input, op, create, options) {
    const checked = actualOperation.validate(op), output = create(Math.min(900, checked.recipe.width), Math.min(900, checked.recipe.height));
    previews.push({ input, op: checked, options, output }); return output;
  } });
  env.MintImageImport = { importFile(file, options) { const job = deferred(); imports.push({ file, options, ...job }); return job.promise; } };
  vm.runInContext(fs.readFileSync(path.join(assets, 'collage-ui.js'), 'utf8'), env, { filename: 'collage-ui.js' });
  const adapter = { panel, getDraft: () => draft, setDraft: d => draft = d, getCanvas: () => source, revision: () => revision,
    render: () => renders++, toast: m => notices.push(m), hint() {}, createCanvas: canvas, confirm: (_a, _b, go) => go(),
    assess: op => { assessmentOps.push(op); return budget; } };
  const ui = env.CollageUI; ui.setup(adapter);
  function asset(color = 255) { env.__color = color; return vm.runInContext('MintImageOverlay.encodeAsset({width:2,height:1,data:new Uint8ClampedArray([__color,0,0,255,0,__color,0,255])})', env); }
  return { env, ui, adapter, panel, nodes, imports, previews, notices, outlines, assessmentOps, asset,
    get draft() { return draft; }, get source() { return source; }, get renders() { return renders; },
    revision(value) { revision = value; }, setSource(value) { source = value; }, budget(value) { budget = value; },
    click(id) { return nodes['co-' + id].click(); }, change(id, value) { const e = nodes['co-' + id]; e.value = String(value); return e.onchange({ target: e }); },
    input(id, value) { const e = nodes['co-' + id]; e.value = String(value); return e.oninput({ target: e }); }, emit(name) { if (events[name]) events[name](); },
    resolve(index = imports.length - 1, color = 255) { imports[index].resolve({ asset: asset(color), resized: true }); },
    async add(index = 1, color = 255) { const p = ui.importFile({ name: 'not-persisted.png' }, index); this.resolve(imports.length - 1, color); return await p; },
    overlay() { ui.overlay({ save() {}, restore() {}, setLineDash() {}, strokeRect(...a) { outlines.push(a); } }, 900, 900, draft); }
  };
}

test('initial incomplete collage is neutral, unavailable to Apply, and explicitly keeps current work as first cell', () => {
  const h = harness(); assert.equal(h.draft.type, 'collage'); assert.deepEqual(plain(h.draft.assets), [null]);
  assert.equal(h.ui.changed(h.draft), false); assert.equal(h.ui.canApply(h.draft), false);
  assert.match(h.panel.markup, /当前作品作为第一格/); assert.match(h.panel.markup, /不新建项目、不替换主照片原件/);
  assert.match(h.nodes['co-dimensions'].textContent, /1600 × 1600/); assert.equal(h.assessmentOps.length, 0);
});
test('incomplete preview uses only ephemeral placeholders and returns a fresh canvas each time', () => {
  const h = harness(), one = h.ui.preview(h.draft), two = h.ui.preview(h.draft);
  assert.notEqual(one, two); assert.notEqual(one, h.source); assert.equal(h.previews[0].op.assets[0].data, 'AAAAAA==');
  assert.equal(h.previews[0].options.maxSide, 900); assert.deepEqual(plain(h.draft.assets), [null]);
  assert.equal(h.ui.changed(h.draft), false); assert.equal(h.assessmentOps.length, 0);
});
test('import is local, cancellable without global busy, and late completion cannot replace a slot', async () => {
  const h = harness(), p = h.ui.importFile({ name: 'private-path.png' });
  assert.equal(h.ui.isLoading(), true); assert.equal(h.nodes['co-cancel-import'].hidden, false); assert.equal(h.nodes['co-cancel-import'].disabled, false);
  assert.equal(h.nodes['co-count'].disabled, true); assert.equal(h.ui.canApply(h.draft), false);
  assert.equal(h.imports[0].options.core, h.env.MintImageOverlay);
  h.click('cancel-import'); assert.equal(h.ui.isLoading(), false); assert.equal(h.imports[0].options.shouldCancel(), true);
  h.resolve(); assert.equal(await p, false); assert.deepEqual(plain(h.draft.assets), [null]); assert.equal(h.ui.changed(h.draft), false);
});
test('real embedded secondary asset completes operation and reports actual embedded dimensions', async () => {
  const h = harness(); assert.equal(await h.add(), true); assert.equal(h.ui.changed(h.draft), true); assert.equal(h.ui.canApply(h.draft), true);
  assert.deepEqual(Object.keys(h.draft).sort(), ['assets', 'recipe', 'type']); assert.deepEqual(Object.keys(h.draft.assets[0]).sort(), ['data', 'height', 'version', 'width']);
  assert.match(h.nodes['co-assets'].textContent, /2 × 1 RGBA8/); assert(!JSON.stringify(h.draft).includes('not-persisted'));
});
test('count shrink and expand restore inactive cells and assets without applying hidden slots', async () => {
  const h = harness(); h.change('count', 4); await h.add(1, 80); await h.add(2, 120); await h.add(3, 180);
  h.click('cell-3'); h.input('x', 73); h.change('fit', 'fit'); const saved = plain(h.draft.assets[2]);
  h.change('count', 2); assert.equal(h.draft.assets.length, 1); assert.equal(h.ui.canApply(h.draft), true);
  assert.equal(h.assessmentOps.at(-1).assets.length, 1); h.change('count', 4);
  assert.deepEqual(plain(h.draft.assets[2]), saved); assert.equal(h.draft.recipe.cells[3].x, .73); assert.equal(h.draft.recipe.cells[3].fit, 'fit');
});
test('controls are unsaved even before imports, are cell-local, and reset does not discard a picture', async () => {
  const h = harness(); h.input('gutter', 5); assert.equal(h.ui.changed(h.draft), true); assert.equal(h.ui.canApply(h.draft), false);
  await h.add(); h.input('x', 20); h.change('y-number', 82); const image = h.draft.assets[0];
  assert.equal(h.draft.recipe.cells[1].x, .2); assert.equal(h.draft.recipe.cells[1].y, .82); assert.equal(h.draft.recipe.cells[0].x, .5);
  h.click('reset'); assert.deepEqual(plain(h.draft.recipe.cells[1]), { fit: 'fill', x: .5, y: .5 }); assert.equal(h.draft.assets[0], image);
});
test('first current-work cell cannot import and fit centers with disabled crop focus controls', async () => {
  const h = harness(); h.click('cell-0'); assert.equal(h.nodes['co-pick'].disabled, true); assert.equal(await h.ui.importFile({}), false);
  h.change('fit', 'fit'); assert.equal(h.nodes['co-x'].disabled, true); assert.equal(h.nodes['co-y-number'].disabled, true);
  assert.match(h.nodes['co-fit-note'].textContent, /居中/); assert.match(h.nodes['co-fit-note'].textContent, /仅在填满裁切/);
  assert.equal(h.ui.changed(h.draft), true);
});
test('both failed export modes block Apply without silently lowering explicit output resolution', async () => {
  const h = harness(); await h.add(); h.budget({ original: { allowed: false, error: '原尺寸资源超限' }, working: { allowed: false, error: '工作尺寸资源超限' } });
  h.change('width', 2000); assert.equal(h.draft.recipe.width, 2000); assert.equal(h.ui.canApply(h.draft), false);
  assert.match(h.nodes['co-budget'].textContent, /两种方式均不可用/);
  h.budget({ original: { allowed: false }, working: { allowed: true } }); assert.equal(h.ui.canApply(h.draft), true);
});
test('invalid or noninteger dimensions roll back, blank focus is not silently treated as zero', () => {
  const h = harness(), before = plain(h.draft.recipe); h.change('width', 99999); assert.deepEqual(plain(h.draft.recipe), before);
  h.change('width', 333.5); assert.deepEqual(plain(h.draft.recipe), before); h.change('x-number', ''); assert.deepEqual(plain(h.draft.recipe), before);
  h.change('height', 4096); assert.equal(h.draft.recipe.height, 4096); h.change('width', 4096); assert.equal(h.draft.recipe.width, 1600);
});
test('stale asynchronous result after release, source identity, revision, or source dimensions cannot revive', async () => {
  for (const stale of ['release', 'identity', 'revision', 'size']) {
    const h = harness(), d = h.draft, p = h.ui.importFile({});
    if (stale === 'release') h.ui.release(); else if (stale === 'identity') h.setSource({ width: 600, height: 400, getContext() {} });
    else if (stale === 'revision') h.revision('1/2'); else h.adapter.getCanvas().width = 601;
    assert.equal(h.imports[0].options.shouldCancel(), true); h.resolve(); assert.equal(await p, false); assert.deepEqual(plain(d.assets), [null]);
  }
});
test('failed main-photo import may rebind only original draft, canvas and dimensions, while pending image cannot revive', async () => {
  const h = harness(); h.input('x', 75); const p = h.ui.importFile({}); h.revision('1/2'); h.ui.sourceImportStarted();
  assert.equal(h.ui.isLoading(), false); h.resolve(); assert.equal(await p, false); h.ui.sourceImportFinished();
  assert.equal(h.draft.recipe.cells[1].x, .75); assert.equal(await h.add(), true);
  const g = harness(); g.revision('1/2'); g.ui.sourceImportStarted(); g.adapter.getCanvas().width++; g.ui.sourceImportFinished();
  assert.equal(await g.ui.importFile({}), false); assert.equal(g.ui.canApply(g.draft), false);
});
test('old handlers and file-dialog callbacks are inert after a new session or main import', async () => {
  const h = harness(), oldWidth = h.nodes['co-width'].onchange; h.click('pick'); const oldFile = h.nodes['co-file'].onchange;
  h.ui.release(); h.ui.setup(h.adapter); oldWidth({ target: { value: '333' } }); oldFile({ target: { value: '', files: [{}] } });
  assert.equal(h.draft.recipe.width, 1600); assert.equal(h.imports.length, 0);
  h.click('pick'); const sameFile = h.nodes['co-file'].onchange; h.revision('1/2'); h.ui.sourceImportStarted(); h.ui.sourceImportFinished();
  sameFile({ target: { value: '', files: [{}] } }); assert.equal(h.imports.length, 0);
});
test('picker may blur before file selection without losing its session, but in-progress imports cancel on blur', async () => {
  const h = harness(); h.click('pick'); h.emit('blur'); const file = h.nodes['co-file']; file.files = [{}]; const p = file.onchange({ target: file });
  assert.equal(h.imports.length, 1); h.emit('blur'); assert.equal(h.ui.isLoading(), false); h.resolve(); assert.equal(await p, false);
});
test('tap selection commits only on matching normal release; cancel, move, second gesture and blur cannot mutate the recipe', () => {
  const h = harness(), d = h.draft, before = plain(d.recipe); assert.match(h.nodes['co-selected'].textContent, /第2格/);
  let p = h.ui.start(d, { x: .2, y: .5 }); h.ui.finish(d, { x: .2, y: .5 }, p, true); assert.match(h.nodes['co-selected'].textContent, /第2格/);
  p = h.ui.start(d, { x: .2, y: .5 }); h.ui.move(d, { x: .4, y: .5 }, p); h.ui.finish(d, { x: .4, y: .5 }, p, false); assert.match(h.nodes['co-selected'].textContent, /第2格/);
  p = h.ui.start(d, { x: .2, y: .5 }); h.emit('blur'); h.ui.finish(d, { x: .2, y: .5 }, p, false); assert.match(h.nodes['co-selected'].textContent, /第2格/);
  p = h.ui.start(d, { x: .2, y: .5 }); h.ui.start(d, { x: .8, y: .5 }); h.ui.finish(d, { x: .2, y: .5 }, p, false); assert.match(h.nodes['co-selected'].textContent, /第2格/);
  p = h.ui.start(d, { x: .2, y: .5 }); assert.equal(h.ui.finish(d, { x: .2, y: .5 }, p, false), true); assert.match(h.nodes['co-selected'].textContent, /第1格/);
  assert.deepEqual(plain(d.recipe), before); h.overlay(); assert.equal(h.outlines.length, 1); assert(h.outlines[0][2] > 0);
});
test('import failure preserves the prior selected asset and never accepts an invalid returned asset', async () => {
  const h = harness(); await h.add(); const old = h.draft.assets[0], p = h.ui.importFile({}); h.imports.at(-1).reject(Error('无法解码这张图片')); assert.equal(await p, false);
  assert.equal(h.draft.assets[0], old); assert.equal(h.ui.isLoading(), false);
  const next = h.ui.importFile({}); h.imports.at(-1).resolve({ asset: { version: 1, width: 9000, height: 1, data: '' } }); assert.equal(await next, false); assert.equal(h.draft.assets[0], old);
});

test('cancel then restart import cannot let an older completion dismiss the new status or write its pixels', async () => {
  const h = harness(), old = h.ui.importFile({ old: true }); h.ui.cancelImport(); const next = h.ui.importFile({ next: true });
  h.resolve(0, 20); assert.equal(await old, false); assert.equal(h.ui.isLoading(), true); assert.deepEqual(plain(h.draft.assets), [null]);
  h.resolve(1, 230); assert.equal(await next, true); assert.equal(h.ui.isLoading(), false); assert.equal(h.draft.assets[0].data, h.asset(230).data);
});
test('a second pointer starting in a gutter invalidates the first pending selection', () => {
  const h = harness(), p = h.ui.start(h.draft, { x: .2, y: .5 });
  assert.equal(h.ui.start(h.draft, { x: 0, y: 0 }), null);
  assert.equal(h.ui.finish(h.draft, { x: .2, y: .5 }, p, false), false); assert.match(h.nodes['co-selected'].textContent, /第2格/);
});
test('missing module or invalid budget response fails closed rather than reporting applicable output', async () => {
  const h = harness(); await h.add(); h.budget({ original: { allowed: true } }); assert.equal(h.ui.canApply(h.draft), false);
  h.change('width', 1700); assert.match(h.nodes['co-budget'].textContent, /已阻止应用/);
  h.env.MintCollageOperation = null; assert.equal(h.ui.setup(h.adapter), null); assert.equal(h.draft, null); assert.match(h.panel.textContent, /核心未加载/);
});
