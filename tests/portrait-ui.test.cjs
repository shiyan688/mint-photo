'use strict';
// Independent production-code state tests, not a browser/Canvas/model simulation.
// The shipped UI and editor commit/history handlers run unchanged in a tiny DOM.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assets = path.join(__dirname, '../app/src/main/assets');
const uiSource = fs.readFileSync(path.join(assets, 'portrait-ui.js'), 'utf8');
const editorSource = fs.readFileSync(path.join(assets, 'editor.js'), 'utf8');
const html = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');
const ProjectCore = require('../app/src/main/assets/project-core.js');
const checks = [], failures = [];
function photo(name, width = 500, height = 800) { const blob = new Blob(['original test image'], { type: 'image/png' }); Object.assign(blob, { name, width, height }); return blob; }
const plain = value => JSON.parse(JSON.stringify(value));
function section(start, end) {
  const a = editorSource.indexOf(start), b = editorSource.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `Missing shipped source section: ${start}`);
  return editorSource.slice(a, b);
}
function fakeCanvas(width = 400, height = 600) {
  const calls = [];
  const c = { width, height, calls, toDataURL: () => 'data:image/jpeg;base64,c3ludGhldGlj' };
  const ctx = {
    drawImage(...args) { calls.push(args); },
    getImageData: () => { const data=new Uint8ClampedArray(c.width*c.height*4);for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)data.set([100+x%41,110+y%37,90+(x+y)%31,255],(y*c.width+x)*4);return {width:c.width,height:c.height,data}; },
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {}, save() {}, restore() {}, fillRect() {}, clearRect() {}, strokeRect() {},
    beginPath() {}, arc() {}, ellipse() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, setLineDash() {}
  };
  c.getContext = () => ctx;
  return c;
}
function harness({ native = false, manual = true } = {}) {
  const ids = new Map(), nodes = new Set(), timers = new Map();
  const busy = [], notices = [], requests = [], renders = [], confirmations = [];
  let timerId = 0;
  function element(tag = 'div', attrs = {}, isPanel = false) {
    const classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
    const el = {
      tagName: tag.toUpperCase(), dataset: {}, style: {}, hidden: 'hidden' in attrs,
      value: attrs.value || '', checked: 'checked' in attrs, open: false, textContent: '',
      disabled: 'disabled' in attrs, listeners: {}, children: new Set(),
      classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle(x, yes) { if (yes ?? !classes.has(x)) classes.add(x); else classes.delete(x); } },
      setAttribute(k, v) { this[k] = v; },
      addEventListener(k, fn) { this.listeners[k] = fn; },
      showModal() { this.open = true; }, close() { this.open = false; },
      click() { assert(!this.disabled, `Clicked disabled ${this.id}`); return this.onclick?.({ target: this }); }
    };
    if(tag==='canvas')Object.assign(el,fakeCanvas(+attrs.width||256,+attrs.height||96));
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'id') { el.id = v; ids.set(v, el); }
      if (k.startsWith('data-')) el.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    }
    Object.defineProperty(el, 'innerHTML', { set(value) {
      this.markup = value;
      for (const child of this.children) remove(child);
      this.children.clear(); parse(value, this);
    }, get() { return this.markup || ''; } });
    nodes.add(el); return el;
  }
  function remove(el) { for (const child of el.children) remove(child); nodes.delete(el); if (el.id && ids.get(el.id) === el) ids.delete(el.id); }
  function parse(markup, parent = null) {
    for (const match of markup.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)) {
      const attrs = {};
      for (const a of match[2].matchAll(/([a-zA-Z][\w:-]*)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? '';
      const el = element(match[1], attrs); if (parent) parent.children.add(el);
    }
  }
  parse(html);
  const $ = id => ids.get(id) || null;
  const document = {
    getElementById: $,
    createElement: name => name === 'canvas' ? fakeCanvas(1, 1) : element(name),
    querySelectorAll(selector) {
      const data = selector.match(/^\[data-([\w-]+)(?:="([^"]+)")?\]$/);
      if (data) { const k = data[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()); return [...nodes].filter(n => k in n.dataset && (data[2] === undefined || n.dataset[k] === data[2])); }
      if (selector[0] === '.') return [...nodes].filter(n => n.classList.contains(selector.slice(1)));
      throw Error(`Unsupported test selector ${selector}`);
    }
  };
  const env = { crypto: require('node:crypto').webcrypto, viewport: null, historyUI: null, projectConfirmation: null, projectLibraryController: null, projectLibraryUI: null,
    document, console, Uint8Array, Uint8ClampedArray, ArrayBuffer, Blob, Set,
    btoa: value => Buffer.from(value, 'binary').toString('base64'), atob: value => Buffer.from(value, 'base64').toString('binary'),
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id),
    source: fakeCanvas(), committed: fakeCanvas(), sourceBlob: photo('initial.png', 400, 600), sourceAsset: null, projectRevision: 0, draft: null, ops: [], redo: [], hasSaved: true,
    exportPending: false, activeTool: 'portrait', pointer: null, painting: false, currentStroke: null, MAX_OPS: 60,
    FILTERS: [{ id: 'original', name: '原色', css: 'none' }, { id: 'mono', name: '黑白', css: 'grayscale(1)' }],
    COLORS: ['#ffffff'], STICKERS: ['✦'], thumbUrl: '', imageName: '', importVersion: 0,
    $, clone: plain, clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    scheduleRender: () => renders.push(true), saveDraftSoon() {}, toast: text => notices.push(text),
    busy: (value, text) => busy.push({ value, text }), hint() {},
    confirmAction(title, text, yes) { confirmations.push({ title, text, yes }); $('confirmDialog').showModal(); $('confirmYes').onclick = () => { $('confirmDialog').close(); yes(); }; $('confirmNo').onclick = () => $('confirmDialog').close(); },
    renderCommitted() { const size = env.outputSize(); env.committed = fakeCanvas(size.w, size.h); env.updateControls(); },
    decodeBlob: async file => fakeCanvas(file.width || 500, file.height || 800),
    canvasBlob: async () => ({ size: 123 }),
  };
  env.sourceAsset = { blob: env.sourceBlob, name: 'initial.png', mime: 'image/png', width: 400, height: 600, origin: 'original' };
  env.ProjectCore = ProjectCore; env.addEventListener = () => {}; env.window = env;
  if (native) env.window.Android = { analyzePortrait: (data, id, kind) => requests.push({ data, id, kind, width: env.committed.width, height: env.committed.height }) };
  vm.createContext(env);
  for (const name of ['mask-refine.js','background-refine-operation.js','background-refine-ui.js','portrait-engine.js','portrait-people.js','portrait-people-operation.js','face-detection.js','portrait-people-ui.js']) vm.runInContext(fs.readFileSync(path.join(assets,name),'utf8'),env,{filename:name});
  if(manual){for(const name of ['manual-tools.js','selection-edit.js','repair-brush-core.js','manual-retouch-ui.js'])vm.runInContext(fs.readFileSync(path.join(assets,name),'utf8'),env,{filename:name});}
  vm.runInContext(uiSource, env, {filename:'portrait-ui.js'});
  for(const name of ['advanced-tone.js','levels.js','levels-ui.js','geometry.js','project-core.js','advanced-tone-ui.js'])vm.runInContext(fs.readFileSync(path.join(assets,name),'utf8'),env,{filename:name});
  vm.runInContext('clone=value=>JSON.parse(JSON.stringify(value))',env);
  for (const [start, end] of [
    ['function operationSize(', 'function pixelEffect('],
    ['function applyOperation(', 'function renderPipeline('],
    ['function touchProject(', 'function isDraftChanged('],
    ['function isDraftChanged(', 'function renderCommitted('],
    ['function updateControls(', 'function commit('],
    ['function commit(', 'function swatches('],
    ['function showTool(', 'function commitTransform('],
    ['function commitTransform(', 'function hint('],
    ['function replaceHistory(', 'function setComparing('],
    ['window.requestClose=', "window.addEventListener('resize',"],
    ['function beginSourceImport(', 'function requestImport(']
  ]) vm.runInContext(section(start, end), env);
  const ui = env.window.PortraitUI;
  ui.init({ revision:()=>env.projectRevision,getDraft: () => env.draft, setDraft: d => { env.draft = d; }, getCanvas: () => env.committed,
    size: () => env.outputSize(), render: env.scheduleRender, toast: env.toast, busy: env.busy, confirm: env.confirmAction, hint: env.hint });
  const h = { env, ui, $, document, requests, busy, notices, timers, confirmations, renders,
    setup: tool => env.showTool(tool),
    click(id) { const el = $(id); assert(el, `Missing control #${id}`); return el.click(); },
    slider(key, value) { const el = $('p-' + key); assert(el, `Missing slider ${key}`); el.value = '' + value; el.oninput({ target: el }); },
    result(result, index = requests.length - 1) { env.window.onPortraitAnalysis(requests[index].id, JSON.stringify(result)); },
    faceResult(meshes = [landmarks()], index = requests.length - 1) { const r=requests[index]; return {ok:true,faceLimit:5,detector:plain(env.MintPortraitPeople.DEFAULT_DETECTOR),detectionSize:{width:r.width,height:r.height},faces:meshes.map(landmarks=>({landmarks}))}; },
    stroke(points, cancelled = false) { const d = env.draft, q = ui.start(d, points[0]); for (const p of points.slice(1)) ui.move(d, p, q); ui.finish(d, points.at(-1), q, cancelled); return q; },
  };
  return h;
}
function manualSample(h){h.click('manualClone');h.click('sampleSource');h.stroke([{x:.15,y:.4}]);}
function landmarks() { const lm = Array.from({ length: 478 }, () => ({ x: .5, y: .5, z: 0 })); lm[10].y = .22; lm[152].y = .65; return lm; }
function mask(width = 8, height = 8) { return { width, height, data: Buffer.alloc(width * height, 255).toString('base64') }; }
async function test(name, fn) { try { await fn(); checks.push(name); console.log('PASS', name); } catch (error) { failures.push({ name, error: error.message }); console.error('FAIL', name, '\n ', error.message); } }
(async () => {
  await test('all five portrait tools create neutral unapplied drafts', () => { const h = harness(); for (const tool of ['portrait', 'reshape', 'retouch', 'background', 'idphoto']) { h.setup(tool); assert.equal(h.env.isDraftChanged(), false); assert.equal(h.env.applyDraft(), false); assert.equal(h.env.ops.length, 0); } });
  await test('browser without native model bridge does not invent automatic detection', () => { const h = harness(); h.setup('portrait'); h.click('detectPortrait'); assert.equal(h.env.draft.batch.faces.length, 0); assert.equal(h.env.isDraftChanged(), false); assert.match(h.$('portraitStatus').textContent, /安卓|手动/); assert.equal(h.requests.length, 0); });
  await test('beauty sliders without a selected face or manual region do not commit', () => { const h = harness(); h.setup('portrait'); h.slider('smooth', 35); assert.equal(h.env.applyDraft(), false); assert.equal(h.env.ops.length, 0); });
  await test('manual beauty commits only on Apply and deep-copies operation values', () => { const h = harness(); h.setup('portrait'); h.click('manualSkin'); h.slider('smooth', 35); const old = h.env.draft; assert.equal(h.env.ops.length, 0); h.click('applyBtn'); assert.equal(h.env.ops.length, 1); assert.equal(h.env.ops[0].type, 'beauty'); assert.equal(h.env.ops[0].values.smooth, 35); old.values.smooth = 99; assert.equal(h.env.ops[0].values.smooth, 35); assert.equal(h.env.isDraftChanged(), false); });
  await test('manual skin parameter selection preserves original inputs, circle and values without rendering',()=>{
   const h=harness();h.setup('portrait');h.click('manualSkin');const original=h.$('p-smooth'),before=plain(h.env.draft),renders=h.renders.length;
   assert.equal(h.$('legacy-smooth-row').hidden,false);assert.equal(h.$('legacy-brighten-row').hidden,true);assert.equal(h.$('legacy-warmth-row').hidden,true);
   h.click('legacy-warmth-option');assert.equal(h.$('legacy-warmth-row').hidden,false);assert.equal(h.$('legacy-smooth-row').hidden,true);assert.equal(h.$('legacy-warmth-option')['aria-pressed'],'true');
   assert.equal(h.renders.length,renders);assert.deepEqual(plain(h.env.draft),before);assert.equal(h.$('p-smooth'),original);
   h.slider('warmth',-24);h.click('legacy-smooth-option');h.slider('smooth',29);h.click('legacy-warmth-option');assert.equal(h.$('p-warmth').value,'-24');assert.equal(h.$('pv-smooth').textContent,'29');assert.deepEqual(plain(h.env.draft.region),before.region);
   for(const key of ['underEye','redness','lip','blush'])assert(h.$('p-'+key).disabled);h.click('resetPortrait');for(const key of ['smooth','brighten','warmth'])assert.equal(+h.$('p-'+key).value,0);assert.equal(h.$('legacy-warmth-row').hidden,false);
   const retained=h.$('legacy-brighten-option').onclick;h.setup('portrait');retained();assert.equal(h.env.draft.type,'portrait-people');assert.equal(h.$('portrait-smooth-row').hidden,false);
  });
  await test('manual skin puts editable parameters before optional presets and keeps its live warning visible',()=>{
   const h=harness();h.setup('portrait');h.click('manualSkin');const markup=h.$('toolPanel').innerHTML,stack=[],ids=new Map(),voids=new Set(['input','br','hr','img']);
   // Check real generated nesting; the state harness deliberately flattens DOM nodes.
   for(const match of markup.matchAll(/<(\/?)([a-z][a-z0-9]*)\b([^>]*)>/gi)){
    const tag=match[2];if(match[1]){assert.equal(stack.at(-1).tag,tag);stack.pop();continue;}
    const attrs={};for(const attr of match[3].matchAll(/([a-zA-Z][\w:-]*)(?:="([^"]*)")?/g))attrs[attr[1]]=attr[2]??'';
    const node={tag,attrs,parents:stack.slice()};if(attrs.id){assert(!ids.has(attrs.id));ids.set(attrs.id,node);}if(!voids.has(tag))stack.push(node);
   }
   assert.equal(stack.length,0);for(const key of ['manualSkin','resetPortrait','portraitStatus','p-smooth','p-brighten','p-warmth'])assert(!ids.get(key).parents.some(p=>p.tag==='details'),key+' immediately available');
   const order=['manualSkin','portraitStatus','p-smooth','p-warmth','skinRadiusRow','legacyPresetDetails','legacyPortraitHelpDetails'].map(id=>markup.indexOf('id="'+id+'"'));assert(order.every((position,i)=>position>=0&&(i===0||position>order[i-1])));
   for(const key of ['naturalPreset','beautyPreset'])assert(ids.get(key).parents.some(p=>p.attrs.id==='legacyPresetDetails'));
   assert(h.$('legacyPresetDetails').hidden,'manual mode does not show an empty preset drawer');assert(!('open'in ids.get('legacyPortraitHelpDetails').attrs));
   assert.equal(ids.get('portraitStatus').attrs.role,'status');assert.equal(ids.get('portraitStatus').attrs['aria-live'],'polite');assert.match(h.$('portraitStatus').textContent,/手动圆形修肤.*眼下与妆色已停用/);
  });
  await test('production Undo/Redo restores exact committed portrait operations', () => { const h = harness(); h.setup('portrait'); h.click('manualSkin'); h.slider('brighten', 12); h.click('applyBtn'); const saved = plain(h.env.ops); h.click('undoBtn'); assert.equal(h.env.ops.length, 0); assert.deepEqual(plain(h.env.redo), saved); h.click('redoBtn'); assert.deepEqual(plain(h.env.ops), saved); assert.equal(h.env.redo.length, 0); });
  await test('new committed portrait operation clears redo history', () => { const h = harness(); h.setup('portrait'); h.click('manualSkin'); h.slider('smooth', 20); h.click('applyBtn'); h.click('undoBtn'); h.setup('retouch'); manualSample(h); h.stroke([{ x: .5, y: .5 }]); h.click('applyBtn'); assert.equal(h.env.ops[0].type, 'manual'); assert.equal(h.env.redo.length, 0); });
  await test('Cancel and native Back discard drafts without changing committed history', () => { const h = harness(); h.setup('retouch'); manualSample(h); h.stroke([{ x: .3, y: .4 }]); h.click('applyBtn'); const saved = plain(h.env.ops); manualSample(h); h.stroke([{ x: .6, y: .7 }]); h.click('cancelBtn'); assert.deepEqual(plain(h.env.ops), saved); assert.equal(h.env.isDraftChanged(), false); manualSample(h); h.stroke([{ x: .2, y: .3 }]); assert.equal(h.env.window.requestClose(), true); assert.deepEqual(plain(h.env.ops), saved); assert.equal(h.env.isDraftChanged(), false); });
  await test('tool-switch confirmation preserves draft when declined', () => { const h = harness(); h.setup('retouch'); manualSample(h); h.stroke([{ x: .3, y: .4 }]); const before = plain(h.env.draft); h.env.setTool('background'); assert.equal(h.$('confirmDialog').open, true); h.click('confirmNo'); assert.deepEqual(plain(h.env.draft), before); h.env.setTool('background'); h.click('confirmYes'); assert.equal(h.env.draft.type, 'background-refine'); assert.equal(h.env.ops.length, 0); });
  await test('retouch texture clone stores normalized paths and clear removes the draft',()=>{const h=harness();h.setup('retouch');manualSample(h);h.stroke([{x:.3,y:.4},{x:.32,y:.42},{x:.34,y:.44}]);assert.equal(h.env.draft.repair.length,1);assert(h.env.draft.repair[0].points.length>=3);h.click('clearLocal');assert.equal(h.env.draft.repair.length,0);assert.equal(h.env.isDraftChanged(),false);assert.equal(h.env.ops.length,0);});
  await test('liquify ignores taps/cancelled gestures and clear removes completed strokes', () => { const h = harness(); h.setup('retouch'); h.click('manualPush'); h.stroke([{ x: .3, y: .4 }]); assert.equal(h.env.draft.liquify.length, 0); h.stroke([{ x: .3, y: .4 }, { x: .4, y: .5 }], true); assert.equal(h.env.draft.liquify.length, 0); h.stroke([{ x: .3, y: .4 }, { x: .4, y: .5 }]); assert.equal(h.env.draft.liquify.length, 1); h.click('clearLocal'); assert.equal(h.env.draft.liquify.length, 0); assert.equal(h.env.isDraftChanged(), false); });
  await test('manual mask keep and erase change actual output-resolution confidence', () => { const h = harness(); h.setup('background'); h.click('manualMask'); h.slider('maskBrush', 15); h.stroke([{ x: .5, y: .5 }]); let bytes = vm.runInContext('MintMaskRefine.rasterize({width:256,height:256},draft.recipe).data',h.env); const before = bytes.reduce((a, b) => a + b, 0); assert(before > 0); h.click('eraseMask'); h.stroke([{ x: .5, y: .5 }]); bytes = vm.runInContext('MintMaskRefine.rasterize({width:256,height:256},draft.recipe).data',h.env); assert(bytes.reduce((a, b) => a + b, 0) < before); });
  await test('erasing an empty manual mask remains a no-op and cannot commit', () => { const h = harness(); h.setup('background'); h.click('manualMask'); h.click('eraseMask'); h.stroke([{ x: .5, y: .5 }]); assert.equal(h.env.isDraftChanged(), false); assert.equal(h.env.applyDraft(), false); });
  await test('clear mask resets all serialized foreground bytes and validity', () => { const h = harness(); h.setup('background'); h.click('manualMask'); h.stroke([{ x: .5, y: .5 }]); h.click('manualMask'); h.click('confirmYes'); assert.equal(h.env.draft.ready, false); assert.equal(h.env.isDraftChanged(), false); if (h.env.draft.mask) assert(vm.runInContext('MintMaskRefine.rasterize({width:256,height:256},draft.recipe).data',h.env).every(n => n === 0)); });
  await test('background Apply preserves vector recipe and confidence base for history replay', () => { const h = harness(); h.setup('background'); h.click('manualMask'); h.stroke([{ x: .5, y: .5 }]); const saved = plain(h.env.draft.recipe); h.click('applyBtn'); assert.equal(h.env.ops[0].type, 'background-refine'); assert.deepEqual(plain(h.env.ops[0].recipe), saved); h.click('undoBtn'); h.click('redoBtn'); assert.deepEqual(plain(h.env.ops[0].recipe), saved); });
  await test('offline face callback alone creates no edit; nonzero reshape applies', () => { const h = harness({ native: true }); h.setup('reshape'); h.click('detectPortrait'); assert.equal(h.requests[0].kind, 'face'); h.result(h.faceResult()); assert.equal(h.env.isDraftChanged(), false); h.slider('eyes', 12); h.click('applyBtn'); assert.equal(h.env.ops[0].type, 'portrait-people'); assert.equal(h.env.ops[0].phase, 'reshape'); assert.equal(h.env.ops[0].batch.faces[0].landmarks.length, 478); });
  await test('native person result validates and caches its serialized mask', () => { const h = harness({ native: true }); h.setup('background'); h.click('detectPortrait'); assert.equal(h.requests[0].kind, 'person'); h.result({ ok: true, mask: mask() }); assert.equal(h.env.isDraftChanged(), true); assert.deepEqual(plain(h.env.draft.recipe.base), mask()); });
  await test('invalid mask and missing face result leave drafts unapplied', () => { const h = harness({ native: true }); h.setup('background'); h.click('detectPortrait'); h.result({ ok: true, mask: { ...mask(), data: '' } }); assert.equal(h.env.draft.ready, false); assert.equal(h.env.isDraftChanged(), false); h.setup('reshape'); h.click('detectPortrait'); h.result({ ok: true, landmarks: [] }); assert.equal(h.env.draft.batch.faces.length, 0); assert.equal(h.busy.at(-1).value, false); });
  for (const tool of ['portrait', 'background']) {
    await test(`${tool} stale callback after Cancel cannot mutate the replacement draft`, () => { const h = harness({ native: true }); h.setup(tool); h.click('detectPortrait'); h.click('cancelBtn'); const current = plain(h.env.draft); h.result(tool === 'portrait' ? h.faceResult() : { ok: true, mask: mask() }); assert.deepEqual(plain(h.env.draft), current); assert.equal(h.env.ops.length, 0); });
    await test(`${tool} manual choice supersedes pending automatic result`, () => { const h = harness({ native: true }); h.setup(tool); h.click('detectPortrait'); h.click(tool === 'portrait' ? 'manualSkin' : 'manualMask'); h.stroke([{ x: .3, y: .4 }]); const before = plain(h.env.draft); h.result(tool === 'portrait' ? h.faceResult() : { ok: true, mask: mask() }); assert.deepEqual(plain(h.env.draft), before); });
  }
  await test('switching tools cancels old analysis and allows a new request', () => { const h = harness({ native: true }); h.setup('portrait'); h.click('detectPortrait'); h.setup('background'); h.click('detectPortrait'); assert.equal(h.requests.length, 2); h.result(h.faceResult(), 0); assert.equal(h.env.draft.ready, false); h.result({ ok: true, mask: mask() }, 1); assert.equal(h.env.draft.ready, true); });
  await test('pending native Back is handled without exiting the editor', () => { const h = harness({ native: true }); h.setup('portrait'); h.click('detectPortrait'); assert.equal(h.env.window.requestClose(), true); assert.equal(h.busy.at(-1).value, false); h.result(h.faceResult()); assert.equal(h.env.draft.batch.faces.length, 0); });
  await test('late callback after timeout cannot change the current draft', () => { const h = harness({ native: true }); h.setup('portrait'); h.click('detectPortrait'); const timeout = [...h.timers.values()].find(t => t.delay === 45000); assert(timeout); timeout.fn(); h.result(h.faceResult()); assert.equal(h.env.draft.batch.faces.length, 0); assert.equal(h.busy.at(-1).value, false); });
  await test('new request after timeout is not fulfilled by the older callback', () => { const h = harness({ native: true }); h.setup('portrait'); h.click('detectPortrait'); [...h.timers.values()].find(t => t.delay === 45000).fn(); h.click('detectPortrait'); assert.equal(h.requests.length, 2); h.result(h.faceResult(), 0); assert.equal(h.env.draft.batch.faces.length, 0); h.result(h.faceResult(), 1); assert.equal(h.env.draft.batch.faces[0].landmarks.length, 478); });
  await test('successful new photo import invalidates old face callback', async () => { const h = harness({ native: true }); h.setup('portrait'); h.click('detectPortrait'); await h.env.loadPhoto(photo('synthetic.png', 300, 700)); h.result(h.faceResult()); assert.equal(h.env.draft.batch.faces.length, 0); assert.deepEqual(plain(h.env.outputSize()), { w: 300, h: 700 }); });
  await test('history undo invalidates an old mask callback', () => { const h = harness({ native: true }); h.setup('portrait'); h.click('manualSkin'); h.slider('smooth', 20); h.click('applyBtn'); h.setup('background'); h.click('detectPortrait'); h.click('undoBtn'); h.result({ ok: true, mask: mask() }); assert.equal(h.env.draft.ready, false); assert.equal(h.env.ops.length, 0); });
  await test('each ID-photo preset commits exact output dimensions and bounded crop', () => { for (const [w, height] of [[295, 413], [413, 579], [390, 567]]) { const h = harness(); h.env.ops = [{ type: 'rotate' }, { type: 'crop', x: 0, y: 0, w: .8, h: .7 }]; h.setup('idphoto'); const button = h.document.querySelectorAll('[data-id-size]').find(x => x.dataset.idSize === `${w},${height}`); button.click(); const d = h.env.draft, size = h.env.outputSize(); assert(Math.abs(d.w * size.w / (d.h * size.h) - w / height) < 1e-9); h.stroke([{ x: .5, y: .5 }, { x: 1, y: 1 }]); assert(d.x >= 0 && d.y >= 0 && d.x + d.w <= 1.000001 && d.y + d.h <= 1.000001); const out = h.ui.apply(fakeCanvas(900, 500), d); assert.equal(out.width, w); assert.equal(out.height, height); assert.equal(out.calls[0][7], w); assert.equal(out.calls[0][8], height); h.click('applyBtn'); assert.deepEqual(plain(h.env.outputSize()), { w, h: height }); h.click('undoBtn'); assert.notDeepEqual(plain(h.env.outputSize()), { w, h: height }); h.click('redoBtn'); assert.deepEqual(plain(h.env.outputSize()), { w, h: height }); } });
  await test('ID-photo dragging before selecting a preset cannot enable a stretched full-frame export', () => { const h = harness(); h.setup('idphoto'); h.stroke([{ x: .4, y: .4 }, { x: .5, y: .5 }]); const d = h.env.draft, size = h.env.outputSize(); if (h.env.isDraftChanged()) assert(Math.abs(d.w * size.w / (d.h * size.h) - d.outW / d.outH) < 1e-9, 'An active ID crop must match the selected output ratio'); });
  await test('mask stroke undo restores prior mask bytes and unchanged validity', () => { const h = harness(); h.setup('background'); h.click('manualMask'); const before = plain(h.env.draft.recipe); h.stroke([{ x: .4, y: .4 }, { x: .6, y: .6 }]); assert.equal(h.env.draft.ready, true); h.click('undoMask'); assert.deepEqual(plain(h.env.draft.recipe), before); assert.equal(h.env.draft.ready, false); assert.equal(h.env.isDraftChanged(), false); assert.equal(h.$('undoMask').disabled, true); });
  await test('liquify local Undo removes only the last stroke and never committed edits', () => { const h = harness(); h.setup('retouch'); h.click('manualPush'); h.stroke([{ x: .3, y: .4 }, { x: .4, y: .5 }]); const first = plain(h.env.draft.liquify); h.stroke([{ x: .6, y: .4 }, { x: .7, y: .5 }]); h.click('undoLocal'); assert.deepEqual(plain(h.env.draft.liquify), first); assert.equal(h.env.ops.length, 0); });
  await test('repair batch limit prevents runaway gesture accumulation',()=>{const h=harness();h.setup('retouch');manualSample(h);for(let i=0;i<100;i++)h.stroke([{x:.3+(i%10)/100,y:.4}]);assert(h.env.draft.repair.length>0);assert(h.env.draft.repair.length<=20);});
  await test('liquify Apply stores an immutable stroke and supports production Undo/Redo', () => { const h = harness(); h.setup('retouch'); h.click('manualPush'); h.stroke([{ x: .3, y: .4 }, { x: .45, y: .5 }]); const draft = h.env.draft; h.click('applyBtn'); const saved = plain(h.env.ops); assert.equal(saved[0].type, 'manual'); assert.equal(saved[0].liquify.length, 1); draft.liquify[0].points[1].x = .99; assert.deepEqual(plain(h.env.ops), saved); h.click('undoBtn'); assert.equal(h.env.ops.length, 0); h.click('redoBtn'); assert.deepEqual(plain(h.env.ops), saved); });
  await test('stale native errors after tool switch cannot obscure the current tool', () => { const h = harness({ native: true }); h.setup('portrait'); h.click('detectPortrait'); h.setup('background'); const before = h.$('portraitStatus').textContent; h.result({ ok: false, error: 'OLD FACE ERROR' }); assert.equal(h.$('portraitStatus').textContent, before); assert(!h.notices.includes('OLD FACE ERROR')); });
  await test('native invocation exception exits busy state and permits retry', () => { const h = harness({ native: true }); h.setup('portrait'); h.env.window.Android.analyzePortrait = () => { throw Error('test native failure'); }; h.click('detectPortrait'); assert.equal(h.busy.at(-1).value, false); assert.equal(h.timers.size, 0); h.env.window.Android.analyzePortrait = (data, id, kind) => h.requests.push({ data, id, kind, width:h.env.committed.width, height:h.env.committed.height }); h.click('detectPortrait'); assert.equal(h.requests.length, 1); });
  await test('new image selection cancels native analysis before asynchronous decode finishes', async () => { const h = harness({ native: true }); h.setup('portrait'); h.click('detectPortrait'); let release; h.env.decodeBlob = () => new Promise(resolve => { release = resolve; }); const pending = h.env.loadPhoto(photo('next.png')); h.result(h.faceResult()); assert.equal(h.env.draft.batch.faces.length, 0); release(fakeCanvas(300, 400)); await pending; assert.deepEqual(plain(h.env.outputSize()), { w: 300, h: 400 }); });
  await test('the 60-operation limit preserves an unapplied portrait draft', () => { const h = harness(); h.setup('retouch'); manualSample(h); h.env.ops = Array.from({ length: 60 }, () => ({ type: 'rotate' })); h.stroke([{ x: .3, y: .4 }]); const before = plain(h.env.draft); assert.equal(h.env.applyDraft(), false); assert.equal(h.env.ops.length, 60); assert.deepEqual(plain(h.env.draft), before); });
  await test('new face controls are disabled until detection, and manual circle clears them',()=>{const h=harness({native:true});h.setup('portrait');for(const k of ['underEye','redness','lip','blush'])assert(h.$('p-'+k).disabled);h.click('detectPortrait');h.result(h.faceResult());for(const k of ['underEye','redness','lip','blush']){assert(!h.$('p-'+k).disabled);h.slider(k,100);}h.click('manualSkin');assert(h.$('confirmDialog').open);h.click('confirmYes');for(const k of ['underEye','redness','lip','blush']){assert.equal(h.env.draft.values[k],0);assert(h.$('p-'+k).disabled);}assert.equal(h.env.isDraftChanged(),false);});
  await test('every new control and palette commits/replays without losing original source',()=>{const h=harness({native:true});const blob=h.env.sourceBlob;h.setup('portrait');h.click('detectPortrait');h.result(h.faceResult());for(const k of ['underEye','redness','lip','blush','brighten'])h.slider(k,100);h.click('paletteRose');h.click('applyBtn');const ops=plain(h.env.ops);assert.equal(ops[0].type,'portrait-people');assert.equal(ops[0].batch.faces[0].beauty.palette,'rose');assert.equal(ops[0].batch.faces[0].beauty.brighten,100);h.click('undoBtn');h.click('redoBtn');assert.deepEqual(plain(h.env.ops),ops);assert.equal(h.env.sourceBlob,blob);});
  await test('style presets never change geometry or blanket-whiten, and reset is exact',()=>{const h=harness({native:true});h.setup('portrait');assert(h.$('beautyPreset').disabled);h.click('detectPortrait');assert.equal(h.requests.length,1);assert.equal(h.env.isDraftChanged(),false);h.result(h.faceResult());h.click('beautyPreset');const face=h.env.draft.batch.faces[0];assert.equal(face.beauty.brighten,0);assert.equal(face.beauty.palette,'peach');assert(face.beauty.lip>0);assert(Object.values(face.reshape).every(x=>x===0));assert.equal(h.env.ops.length,0);h.click('resetPortrait');assert.equal(h.env.isDraftChanged(),false);assert.deepEqual(plain(h.env.draft.batch.faces[0].beauty),plain(h.env.MintPortraitPeople.defaultsBeauty()));});
  await test('late recognition cannot enable presets or populate a replacement draft',()=>{const h=harness({native:true});h.setup('portrait');assert(h.$('naturalPreset').disabled);h.click('detectPortrait');h.click('cancelBtn');h.result(h.faceResult());assert.equal(h.env.draft.batch.faces.length,0);assert(h.$('naturalPreset').disabled);assert.equal(h.env.isDraftChanged(),false);});
  await test('missing manual dependency fails closed instead of old blur fallback',()=>{const h=harness({manual:false});h.setup('retouch');assert.equal(h.env.draft,null);assert(h.notices.at(-1).includes('核心未加载'));assert.equal(h.env.ops.length,0);});
  await test('committed liquify invalidates prior face cache before automatic manual sampling',()=>{const h=harness({native:true});h.setup('portrait');h.click('detectPortrait');h.result(h.faceResult());assert.equal(h.requests.length,1);const old=h.env.committed;h.setup('retouch');h.click('manualPush');h.stroke([{x:.4,y:.4},{x:.42,y:.4}]);h.click('applyBtn');assert.notEqual(h.env.committed,old);h.click('autoSource');assert.equal(h.requests.length,2);h.click('cancelBtn');h.result(h.faceResult());assert.equal(h.env.draft.repair.length,0);});
  await test('committed liquify requires a newly generated background mask, not cached old mask',()=>{const h=harness({native:true});h.setup('background');h.click('detectPortrait');h.result({ok:true,mask:mask()});h.click('cancelBtn');h.setup('retouch');h.click('manualPush');h.stroke([{x:.4,y:.4},{x:.42,y:.4}]);h.click('applyBtn');h.setup('background');h.click('detectPortrait');assert.equal(h.requests.length,2);assert.equal(h.env.draft.ready,false);});
  await test('advanced tone real controls commit with source preserved and exact Undo/Redo',()=>{const h=harness();h.setup('advanced-tone');assert.equal(h.env.isDraftChanged(),false);const blob=h.env.sourceBlob,e=h.$('toneHsl-hue');e.value='20';e.oninput({target:e});assert.equal(h.env.isDraftChanged(),true);h.click('applyBtn');assert.equal(h.env.ops.length,1);assert.equal(h.env.ops[0].type,'advanced-tone');assert.equal(h.env.ops[0].recipe.hsl[0].hue,20);const saved=plain(h.env.ops);h.click('undoBtn');assert.equal(h.env.ops.length,0);h.click('redoBtn');assert.deepEqual(plain(h.env.ops),saved);assert.equal(h.env.sourceBlob,blob);});
  await test('advanced tone Cancel and leaving the tool do not retain unapplied settings',()=>{const h=harness();h.setup('advanced-tone');const e=h.$('toneNode-2');e.value='60';e.oninput({target:e});h.click('cancelBtn');assert.equal(h.env.isDraftChanged(),false);h.setup('retouch');assert.equal(h.env.draft.type,'manual');h.setup('advanced-tone');assert.equal(h.env.isDraftChanged(),false);assert.equal(h.env.ops.length,0);});
  await test('saved tone operation routes through production renderer after tool release',()=>{const h=harness();h.setup('advanced-tone');const e=h.$('toneHsl-hue');e.value='20';e.oninput({target:e});h.click('applyBtn');const op=h.env.ops[0];h.setup('crop');const c=fakeCanvas(128,128);assert.equal(h.env.applyOperation(c,op),c);assert.equal(c.width,128);});
  await test('crop Apply writes integer geometry and leaves original Blob unchanged',()=>{const h=harness();h.setup('crop');const b=h.env.sourceBlob;h.env.draft.x=.1;h.env.draft.y=.2;h.env.draft.w=.5;h.env.draft.h=.5;h.click('applyBtn');assert.equal(h.env.ops[0].type,'geometry');assert.deepEqual(plain(h.env.outputSize()),{w:200,h:300});assert.equal(h.env.sourceBlob,b);});
  await test('rotate/flip confirmation preserves pending crop until user approves',()=>{const h=harness();h.setup('crop');h.env.draft.w=.5;const old=plain(h.env.draft);h.click('rotateBtn');assert.deepEqual(plain(h.env.draft),old);assert.equal(h.env.ops.length,0);h.confirmations.at(-1).yes();assert.equal(h.env.ops[0].type,'geometry');assert.equal(h.env.ops[0].recipe.quarterTurns,1);assert.deepEqual(plain(h.env.outputSize()),{w:600,h:400});h.click('flipX');assert.equal(h.env.ops[1].recipe.flipX,true);});
  await test('strict new bridge rejects legacy first-face, wrong detector and mismatched preview dimensions',()=>{for(const corrupt of [r=>({ok:true,landmarks:r.faces[0].landmarks}),r=>({...r,detector:{...r.detector,modelSha256:'0'.repeat(64)}}),r=>({...r,detectionSize:{width:r.detectionSize.width+1,height:r.detectionSize.height}})]){const h=harness({native:true});h.setup('portrait');h.click('detectPortrait');h.result(corrupt(h.faceResult()));assert.equal(h.env.draft.batch.faces.length,0);assert.equal(h.env.isDraftChanged(),false);assert.equal(h.busy.at(-1).value,false);assert(h.notices.length);}});
  await test('two-face native detection requires an explicit number and commits independent complete snapshots',()=>{const h=harness({native:true});h.setup('portrait');h.click('detectPortrait');h.result(h.faceResult([landmarks(),landmarks()]));assert.equal(h.env.draft.batch.faces.length,2);assert(h.$('p-smooth').disabled);assert.equal(h.env.isDraftChanged(),false);h.click('person-face-2');h.slider('smooth',21);h.click('person-face-1');h.slider('brighten',12);h.click('person-face-2');assert.equal(h.$('p-smooth').value,'21');assert.equal(h.$('p-brighten').value,'0');const old=h.env.draft;h.click('applyBtn');assert.equal(h.env.ops.length,1);assert.equal(h.env.ops[0].type,'portrait-people');assert.equal(h.env.ops[0].batch.faces.length,2);assert.equal(h.env.ops[0].batch.faces[0].beauty.brighten,12);assert.equal(h.env.ops[0].batch.faces[1].beauty.smooth,21);const saved=plain(h.env.ops);old.batch.faces[1].beauty.smooth=99;assert.deepEqual(plain(h.env.ops),saved);h.click('undoBtn');h.click('redoBtn');assert.deepEqual(plain(h.env.ops),saved);});
  await test('all five native faces are retained with no automatic first-face selection',()=>{const h=harness({native:true});h.setup('reshape');h.click('detectPortrait');h.result(h.faceResult(Array.from({length:5},landmarks)));assert.equal(h.env.draft.batch.faces.length,5);assert(h.$('p-slim').disabled);for(let i=1;i<=5;i++)assert(h.$('person-face-'+i));h.click('person-face-5');h.slider('eyes',10);for(let i=0;i<4;i++)assert.equal(h.env.draft.batch.faces[i].reshape.eyes,0);assert.equal(h.env.draft.batch.faces[4].reshape.eyes,10);});
  await test('repeated detect clicks during one native job do not strand its valid result',()=>{const h=harness({native:true});h.setup('portrait');h.click('detectPortrait');h.click('detectPortrait');assert.equal(h.requests.length,1);h.result(h.faceResult());assert.equal(h.env.draft.batch.faces.length,1);assert(!h.$('p-smooth').disabled);});
  await test('real bridge redetection creates new batch and resets only after explicit confirmation',()=>{const h=harness({native:true});h.setup('portrait');h.click('detectPortrait');h.result(h.faceResult([landmarks(),landmarks()]));h.click('person-face-2');h.slider('smooth',20);const old=h.env.draft.batch.batchId,before=plain(h.env.draft);h.click('detectPortrait');assert.equal(h.requests.length,2);h.result(h.faceResult([landmarks(),landmarks()]));assert(h.$('confirmDialog').open);h.click('confirmNo');assert.deepEqual(plain(h.env.draft),before);h.click('detectPortrait');assert.equal(h.requests.length,3);h.result(h.faceResult([landmarks(),landmarks()]));h.click('confirmYes');assert.notEqual(h.env.draft.batch.batchId,old);assert.equal(h.env.isDraftChanged(),false);assert(h.$('p-smooth').disabled);});
  await test('cached group geometry still requires explicit choice for ID-photo framing',()=>{const h=harness({native:true});h.setup('portrait');h.click('detectPortrait');h.result(h.faceResult([landmarks(),landmarks()]));h.setup('idphoto');const before=plain(h.env.draft);h.click('detectPortrait');assert.equal(h.requests.length,1);assert(h.env.PortraitPeopleUI.selectionActive());assert.deepEqual(plain(h.env.draft),before);assert.equal(h.env.applyDraft(),false);h.click('choose-face-2');assert.equal(h.env.draft.selected,true);assert.equal(h.env.PortraitPeopleUI.selectionActive(),false);assert.equal(h.env.ops.length,0);});
  await test('native Back cancels a pending multi-face picker without discarding existing ID-photo framing',()=>{const h=harness({native:true});h.setup('idphoto');h.document.querySelectorAll('[data-id-size]')[0].click();const before=plain(h.env.draft);h.click('detectPortrait');h.result(h.faceResult([landmarks(),landmarks()]));assert(h.env.PortraitPeopleUI.selectionActive());assert.equal(h.env.window.requestClose(),true);assert.equal(h.env.PortraitPeopleUI.selectionActive(),false);assert.deepEqual(plain(h.env.draft),before);assert.equal(h.$('faceSelectionPanel').hidden,true);});
  await test('manual fallback cancellation keeps every per-face parameter and no legacy draft is created',()=>{const h=harness({native:true});h.setup('portrait');h.click('detectPortrait');h.result(h.faceResult());h.slider('smooth',23);const before=plain(h.env.draft);h.click('manualSkin');assert(h.$('confirmDialog').open);h.click('confirmNo');assert.deepEqual(plain(h.env.draft),before);assert.equal(h.env.draft.type,'portrait-people');});
  await test('legacy saved single-face beauty and reshape operations still replay through production renderer',()=>{const h=harness();h.env.__legacy=JSON.stringify([{type:'beauty',values:{smooth:0,brighten:2,warmth:0,underEye:0,redness:0,lip:0,blush:0},palette:'natural',landmarks:landmarks().slice(0,468),region:null},{type:'reshape',values:{slim:0,eyes:2,nose:0,jaw:0},landmarks:landmarks().slice(0,468)}]);const operations=vm.runInContext('JSON.parse(__legacy)',h.env);for(const operation of operations){const c=fakeCanvas(64,64);assert.equal(h.env.applyOperation(c,operation),c);}assert.equal(h.env.ops.length,0);});
  console.log(`\nPORTRAIT UI STATE TESTS: ${checks.length} passed; ${failures.length} failed.`);
  console.log('LIMIT: Production JavaScript with DOM/Canvas/native bridge stubs. No real browser rendering, Android inference, visual-quality judgement, or device execution.');
  if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
