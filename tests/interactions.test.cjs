'use strict';
// Runs shipped state/geometry/event-handler code with tiny DOM and decode stubs.
// These are regression unit tests, NOT browser, Canvas-rendering, or device QA.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const sourceText = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/editor.js'), 'utf8');
const ProjectCore = require('../app/src/main/assets/project-core.js');
const checks = [];
function photo(name, size = 10) { const blob = new Blob(['test original'], { type: 'image/png' }); Object.defineProperty(blob, 'name', { value: name }); if (size !== 10) Object.defineProperty(blob, 'size', { value: size }); return blob; }
function section(start, end) {
  const a = sourceText.indexOf(start), b = sourceText.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `Missing source section: ${start}`);
  return sourceText.slice(a, b);
}
function context(values = {}) {
  const env = Object.assign({ console, viewport: null, historyUI: null, projectConfirmation: null, projectLibraryController: null, projectLibraryUI: null }, values);
  if (!env.window) env.window = env;
  vm.createContext(env);
  return env;
}
function run(env, start, end) { vm.runInContext(section(start, end), env); }
function test(name, fn) { fn(); checks.push(name); console.log('PASS', name); }
async function asyncTest(name, fn) { await fn(); checks.push(name); console.log('PASS', name); }
function geometry() {
  const listeners = {};
  const overlay = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 947, height: 1200 }),
    setPointerCapture() {},
    addEventListener: (event, handler) => { listeners[event] = e => handler({ type: event, ...e }); }
  };
  const env = context({
    source: { width: 1500, height: 1900 }, committed: { width: 947, height: 1200 },
    ops: [], draft: { type: 'crop', x: 0, y: 0, w: 1, h: 1, ratio: 0 },
    pointer: null, painting: false, currentStroke: null, comparing: false,
    clone: value => JSON.parse(JSON.stringify(value)),
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    scheduleRender() {}, $: () => overlay
  });
  run(env, 'function operationSize(', 'function pixelEffect(');
  run(env, 'function setCropRatio(', 'async function decodeBlob(');
  return { env, listeners };
}
function event(x, y, id = 1) {
  return { clientX: x * 947, clientY: y * 1200, pointerId: id, preventDefault() {} };
}
function cropSize(env) { const size = env.outputSize(); return env.operationSize(size.w, size.h, env.draft); }
test('small crop exact top-right picks nearest corner, not first hit',()=>{const {env,listeners}=geometry();env.$().getBoundingClientRect=()=>({left:0,top:0,width:400,height:600});env.draft={type:'crop',x:.2,y:.2,w:.05,h:.05,ratio:0};listeners.pointerdown({clientX:100,clientY:120,pointerId:1,preventDefault(){}});assert.equal(env.pointer.mode,'tr');});
test('narrow aspect crop at boundary cannot expand beyond available width',()=>{const {env,listeners}=geometry();env.source={width:3000,height:300};env.setCropRatio(9/16);env.draft.x=0;env.draft.y=0;env.pointer={id:1,mode:'bl',start:{x:0,y:env.draft.h},original:JSON.parse(JSON.stringify(env.draft))};listeners.pointermove(event(0,1));assert(env.draft.x>=0&&env.draft.y>=0&&env.draft.x+env.draft.w<=1&&env.draft.y+env.draft.h<=1);assert(Math.abs(env.draft.w*3000/(env.draft.h*300)-9/16)<1e-9);});
test('full frame can become a small crop then move by its center',()=>{const {env,listeners}=geometry();env.$().getBoundingClientRect=()=>({left:0,top:0,width:400,height:600});const ev=(x,y)=>({clientX:x*400,clientY:y*600,pointerId:1,preventDefault(){}});listeners.pointerdown(ev(0,0));listeners.pointermove(ev(.95,.95));listeners.pointerup(ev(.95,.95));const old=JSON.parse(JSON.stringify(env.draft));listeners.pointerdown(ev(.975,.975));assert.equal(env.pointer.mode,'move');listeners.pointermove(ev(.5,.5));listeners.pointerup(ev(.5,.5));assert.equal(env.draft.w,old.w);assert.equal(env.draft.h,old.h);assert(env.draft.x<old.x&&env.draft.y<old.y);});
test('outside crop swipe does not move or resize the frame',()=>{const {env,listeners}=geometry();env.draft={type:'crop',x:.2,y:.2,w:.2,h:.2,ratio:0};const old=JSON.stringify(env.draft);listeners.pointerdown(event(.9,.9));assert.equal(env.pointer.mode,'none');listeners.pointermove(event(.7,.6));listeners.pointerup(event(.7,.6));assert.equal(JSON.stringify(env.draft),old);});
test('1:1 crop uses full-resolution aspect, not rounded preview aspect', () => {
  const { env } = geometry();
  env.setCropRatio(1);
  assert.deepEqual(JSON.parse(JSON.stringify(cropSize(env))), { w: 1320, h: 1320 });
});
test('all preset crops keep the requested full-resolution ratio within pixel rounding', () => {
  const { env } = geometry();
  for (const ratio of [1, 4 / 3, 3 / 4, 16 / 9, 9 / 16]) {
    env.setCropRatio(ratio);
    const size = cropSize(env);
    assert(Math.abs(size.w - size.h * ratio) <= 1.5);
    assert(env.draft.x >= 0 && env.draft.y >= 0 && env.draft.x + env.draft.w <= 1 && env.draft.y + env.draft.h <= 1);
  }
});
test('preset crop accounts for previously applied rotate and crop operations', () => {
  const { env } = geometry();
  env.ops = [{ type: 'rotate' }, { type: 'crop', x: 0, y: 0, w: .73, h: .91 }];
  env.setCropRatio(1);
  const size = cropSize(env);
  assert.equal(size.w, size.h);
});
test('ratio-locked corner drag also uses full-resolution aspect', () => {
  const { env, listeners } = geometry();
  env.setCropRatio(1);
  listeners.pointerdown(event(env.draft.x + env.draft.w, env.draft.y + env.draft.h));
  listeners.pointermove(event(.72, .8));
  listeners.pointerup(event(.72, .8));
  const size = cropSize(env);
  assert.equal(size.w, size.h);
  assert.equal(env.pointer, null);
});
test('free crop dragging remains bounded by the image', () => {
  const { env, listeners } = geometry();
  env.draft = { type: 'crop', x: .2, y: .2, w: .6, h: .6, ratio: 0 };
  listeners.pointerdown(event(.5, .5));
  listeners.pointermove(event(1, 1));
  assert.equal(env.draft.x, .4); assert.equal(env.draft.y, .4);
});
test('lost pointer capture cancels a stroke and permits the next stroke', () => {
  const { env, listeners } = geometry();
  env.draft = { type: 'draw', lines: [], color: '#ffffff', width: .01 };
  listeners.pointerdown(event(.2, .2)); listeners.pointermove(event(.3, .3));
  assert.equal(env.painting, true);
  listeners.lostpointercapture(event(.3, .3));
  assert.equal(env.pointer, null); assert.equal(env.painting, false); assert.equal(env.currentStroke, null);
  listeners.pointerdown(event(.5, .5, 2)); listeners.pointerup(event(.5, .5, 2));
  assert.equal(env.draft.lines.length, 1);
});
test('an unrelated pointer cannot end the active stroke', () => {
  const { env, listeners } = geometry();
  env.draft = { type: 'draw', lines: [], color: '#ffffff', width: .01 };
  listeners.pointerdown(event(.2, .2)); listeners.pointerup(event(.2, .2, 2));
  assert.equal(env.pointer.id, 1); assert.equal(env.painting, true);
});
test('switching tools clears the previous editing pointer', () => {
  const elements = {};
  const env = context({
    pointer: { id: 1 }, painting: true, currentStroke: [{ x: .1, y: .2 }],
    source: null, draft: { type: 'draw' },
    document: { querySelectorAll: () => [] },
    $: id => elements[id] || (elements[id] = {})
  });
  run(env, 'function showTool(', 'function commitTransform(');
  env.showTool('text');
  assert.equal(env.pointer, null); assert.equal(env.painting, false); assert.equal(env.currentStroke, null);
  assert.equal(env.activeTool, 'text');
});
test('native Back dismisses only the top modal before cancelling the draft', () => {
  const elements = Object.fromEntries(['confirmDialog', 'exportDialog', 'draftDialog', 'historyDialog', 'projectLibraryDialog'].map(id => [id, {
    open: false, close() { this.open = false; }
  }]));
  let cancelled = 0;
  const env = context({
    $: id => elements[id], window: {}, exportPending: false, isDraftChanged: () => true,
    resetDraft: () => { cancelled++; }, toast() {}
  });
  run(env, 'window.requestClose=', "window.addEventListener('resize',");
  elements.confirmDialog.open = true;
  assert.equal(env.window.requestClose(), true); assert.equal(cancelled, 0);
  assert.equal(elements.confirmDialog.open, false);
  assert.equal(env.window.requestClose(), true); assert.equal(cancelled, 1);
});
function keyboard() {
  const elements = Object.fromEntries(['confirmDialog', 'exportDialog', 'draftDialog', 'historyDialog', 'projectLibraryDialog'].map(id => [id, { open: false }]));
  const counts = { undo: 0, redo: 0, reset: 0 };
  elements.undoBtn = { click: () => { counts.undo++; } };
  elements.redoBtn = { click: () => { counts.redo++; } };
  let handler;
  const env = context({
    $: id => elements[id], window: { addEventListener: (_, fn) => { handler = fn; } },
    isDraftChanged: () => true, resetDraft: () => { counts.reset++; }
  });
  run(env, "window.addEventListener('keydown',", 'function db(');
  return { elements, counts, key: (key, extra = {}) => handler({ key, target: { matches: () => false }, preventDefault() {}, ...extra }) };
}
test('Escape in any modal preserves the underlying unapplied draft', () => {
  const { elements, counts, key } = keyboard();
  for (const id of ['confirmDialog', 'exportDialog', 'draftDialog', 'historyDialog', 'projectLibraryDialog']) {
    elements[id].open = true; key('Escape'); elements[id].open = false;
  }
  assert.equal(counts.reset, 0);
});
test('history shortcuts do not act through a modal', () => {
  const { elements, counts, key } = keyboard();
  elements.confirmDialog.open = true;
  key('z', { ctrlKey: true }); key('Z', { metaKey: true, shiftKey: true });
  assert.equal(counts.undo, 0); assert.equal(counts.redo, 0);
});
test('Escape and undo/redo still work outside modals', () => {
  const { counts, key } = keyboard();
  key('Escape'); key('z', { ctrlKey: true }); key('Z', { metaKey: true, shiftKey: true });
  assert.deepEqual(counts, { undo: 1, redo: 1, reset: 1 });
});
test('input-owned or already handled keyboard events are not intercepted', () => {
  const { counts, key } = keyboard();
  key('Escape', { defaultPrevented: true });
  key('z', { ctrlKey: true, target: { matches: () => true } });
  assert.deepEqual(counts, { undo: 0, redo: 0, reset: 0 });
});
test('rotate/flip requires confirmation before discarding a crop preview', () => {
  const committed = []; let yes;
  const env = context({ isDraftChanged: () => true, commit: op => committed.push(op), confirmAction: (_, __, fn) => { yes = fn; } });
  env.window=env;vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/src/main/assets/geometry.js'),'utf8'),env);run(env,'function operationSize(','function pixelEffect(');
  run(env, 'function commitTransform(', 'function hint(');
  env.commitTransform({ type: 'rotate' }); assert.equal(committed.length, 0); assert.equal(typeof yes, 'function');
  yes(); assert.equal(committed[0].type, 'geometry');assert.equal(committed[0].recipe.quarterTurns,1);
});
test('rotate/flip without a changed preview commits directly', () => {
  const committed = [];
  const env = context({ isDraftChanged: () => false, commit: op => committed.push(op), confirmAction: () => { throw Error('Unexpected confirmation'); } });
  env.window=env;vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/src/main/assets/geometry.js'),'utf8'),env);run(env,'function operationSize(','function pixelEffect(');
  run(env, 'function commitTransform(', 'function hint(');
  env.commitTransform({ type: 'flip', axis: 'x' }); assert.equal(committed[0].type,'geometry');assert.equal(committed[0].recipe.flipX,true);
});
function imports() {
  const notices = [], busyStates = [];
  const env = context({
    importVersion: 0, projectRevision: 0, sourceAsset: null, committed: null, source: null, sourceBlob: null, imageName: '', ops: [], redo: [], hasSaved: true, draft: null, activeTool: 'filters', window: { ProjectCore },
    toast: value => notices.push(value), busy: value => busyStates.push(value),
    renderCommitted() {}, showTool() {}, saveDraftSoon() {}, updateControls() {}, scheduleRender() {},
    decodeBlob: async file => ({ name: file.name, width: 200, height: 100 }),
    canvasBlob: async canvas => ({ name: canvas.name })
  });
  run(env, 'function touchProject(', 'function isDraftChanged(');
  run(env, 'function beginSourceImport(', 'function requestImport(');
  return { env, notices, busyStates };
}
(async () => {
  await asyncTest('import retains the exact original Blob and never substitutes a canvas encoding', async () => {
    const { env } = imports(); const file = photo('original.png');
    env.canvasBlob = () => { throw Error('Original import must not re-encode'); };
    await env.loadPhoto(file);
    assert.equal(env.sourceBlob, file); assert.equal(env.sourceAsset.blob, file);
    assert.equal(await env.sourceBlob.text(), await file.text());
  });
  await asyncTest('a stale decode completion cannot overwrite a newer import', async () => {
    const { env } = imports(); let releaseOld;
    env.decodeBlob = file => file.name === 'old.png' ? new Promise(resolve => { releaseOld = resolve; }) : Promise.resolve({ name: file.name, width: 200, height: 100 });
    const old = env.loadPhoto(photo('old.png', 10));
    await env.loadPhoto(photo('new.png', 10));
    releaseOld({ name: 'old.png', width: 200, height: 100 }); await old;
    assert.equal(env.source.name, 'new.png');
  });
  await asyncTest('oversized or missing input does not cancel an in-flight import', async () => {
    const { env } = imports(); let release;
    env.decodeBlob = () => new Promise(resolve => { release = resolve; });
    const pending = env.loadPhoto(photo('valid.png', 10));
    await env.loadPhoto(photo('too-big.png', 41 * 1024 * 1024)); await env.loadPhoto(null);
    release({ name: 'valid.png', width: 200, height: 100 }); await pending;
    assert.equal(env.source.name, 'valid.png'); assert.equal(env.importVersion, 1);
  });
  await asyncTest('a stale import failure does not obscure the newer import result', async () => {
    const { env, notices } = imports(); let rejectOld;
    env.decodeBlob = file => file.name === 'old.png' ? new Promise((_, reject) => { rejectOld = reject; }) : Promise.resolve({ name: file.name, width: 200, height: 100 });
    const old = env.loadPhoto(photo('old.png', 10));
    await env.loadPhoto(photo('new.png', 10));
    rejectOld(new Error('stale decode failed')); await old;
    assert(!notices.includes('stale decode failed')); assert.equal(env.source.name, 'new.png');
  });
  await asyncTest('current import failure preserves the prior image and clears busy state', async () => {
    const { env, notices, busyStates } = imports();
    env.source = { name: 'prior.png' }; env.ops = [{ type: 'rotate' }];
    env.decodeBlob = async () => { throw new Error('bad image'); };
    await env.loadPhoto(photo('broken.png', 10));
    assert.equal(env.source.name, 'prior.png'); assert.equal(env.ops.length, 1);
    assert.equal(notices.at(-1), 'bad image'); assert.equal(busyStates.at(-1), false);
  });
  console.log(`ALL ${checks.length} STATE/INTERACTION UNIT CHECKS PASSED`);
  fs.writeFileSync(path.join(__dirname, '../interaction-test-results.json'), JSON.stringify({
    passed: checks.length, checks,
    limits: 'Actual shipped function and event-handler code with DOM/decode stubs. No real browser, Canvas rendering, or Android device execution.',
    date: new Date().toISOString()
  }, null, 2));
})().catch(error => { console.error(error); process.exit(1); });
