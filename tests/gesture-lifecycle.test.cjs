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
const test = require('node:test');
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
  const busy = [], notices = [], requests = [], renders = [], confirmations = [], windowListeners = {};
  let timerId = 0;
  function element(tag = 'div', attrs = {}, isPanel = false) {
    const classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
    const el = {
      tagName: tag.toUpperCase(), dataset: {}, style: {}, hidden: 'hidden' in attrs,
      value: attrs.value || '', checked: 'checked' in attrs, open: false, textContent: '',
      disabled: 'disabled' in attrs, listeners: {}, children: new Set(),
      classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle(x, yes) { if (yes ?? !classes.has(x)) classes.add(x); else classes.delete(x); } },
      setAttribute(k, v) { this[k] = v; },
      addEventListener(k, fn) { this.listeners[k] = fn; }, setPointerCapture() {}, getBoundingClientRect() { return {left:0,top:0,width:400,height:600}; },
      showModal() { this.open = true; }, close() { this.open = false; },
      click() { assert(!this.disabled, `Clicked disabled ${this.id}`); return this.onclick?.({ target: this }); }
    };
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
  const env = { viewport: null, historyUI: null, projectConfirmation: null, projectLibraryController: null, projectLibraryUI: null,
    document, console, Uint8Array, Uint8ClampedArray, ArrayBuffer, Set,
    btoa: value => Buffer.from(value, 'binary').toString('base64'), atob: value => Buffer.from(value, 'base64').toString('binary'),
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id),
    source: fakeCanvas(), committed: fakeCanvas(), sourceBlob: photo('initial.png', 400, 600), sourceAsset: null, projectRevision: 0, draft: null, ops: [], redo: [], hasSaved: true,
    comparing: false, exportPending: false, activeTool: 'portrait', pointer: null, painting: false, currentStroke: null, MAX_OPS: 60,
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
  env.ProjectCore = ProjectCore; env.addEventListener = (type, fn) => { windowListeners[type] = fn; }; env.window = env;
  if (native) env.window.Android = { analyzePortrait: (data, id, kind) => requests.push({ data, id, kind, width:env.committed.width, height:env.committed.height }) };
  vm.createContext(env);for(const name of ['mask-refine.js','background-refine-operation.js','background-refine-ui.js','portrait-engine.js','portrait-people.js','portrait-people-operation.js','face-detection.js','portrait-people-ui.js'])vm.runInContext(fs.readFileSync(path.join(assets,name),'utf8'),env,{filename:name});if(manual){for(const name of ['manual-tools.js','selection-edit.js','repair-brush-core.js','manual-retouch-ui.js'])vm.runInContext(fs.readFileSync(path.join(assets,name),'utf8'),env,{filename:name});}vm.runInContext(uiSource, env);
  for (const [start, end] of [
    ['function operationSize(', 'function pixelEffect('],
    ['function touchProject(', 'function isDraftChanged('],
    ['function isDraftChanged(', 'function renderCommitted('],
    ['function updateControls(', 'function commit('],
    ['function commit(', 'function swatches('],
    ['function swatches(', 'function commitTransform('],
    ['function replaceHistory(', 'function setComparing('],
    ['window.requestClose=', "window.addEventListener('resize',"],
    ['async function loadPhoto(', 'function requestImport(']
  ]) vm.runInContext(section(start, end), env);
  const ui = env.window.PortraitUI;
  ui.init({ revision:()=>env.projectRevision,getDraft: () => env.draft, setDraft: d => { env.draft = d; }, getCanvas: () => env.committed,
    size: () => env.outputSize(), cancelPointer:()=>env.cancelActivePointer(), render: env.scheduleRender, toast: env.toast, busy: env.busy, confirm: env.confirmAction, hint: env.hint });
  vm.runInContext(section('function setCropRatio(', 'async function decodeBlob('), env);
  vm.runInContext(section('function setComparing(', 'function exportPlan('), env);
  vm.runInContext(section("window.addEventListener('keydown',", 'function db('), env);
  const h = { env, ui, $, document, windowListeners, requests, busy, notices, timers, confirmations, renders,
    setup: tool => env.showTool(tool),
    click(id) { const el = $(id); assert(el, `Missing control #${id}`); return el.click(); },
    slider(key, value) { const el = $('p-' + key); assert(el, `Missing slider ${key}`); el.value = '' + value; el.oninput({ target: el }); },
    result(result, index = requests.length - 1) { env.window.onPortraitAnalysis(requests[index].id, JSON.stringify(result)); },
    stroke(points, cancelled = false) { const d = env.draft, q = ui.start(d, points[0]); for (const p of points.slice(1)) ui.move(d, p, q); ui.finish(d, points.at(-1), q, cancelled); return q; },
  };
  return h;
}

// These run production event handlers and production portrait/manual code with
// synthetic pixels and a controlled DOM. They do not claim handset coverage.
function gesture(h,type,x=.5,y=.5,id=1){h.$('overlayCanvas').listeners[type]({type,clientX:x*400,clientY:y*600,pointerId:id,preventDefault(){}});}
function startPush(h){h.setup('retouch');h.click('manualPush');gesture(h,'pointerdown',.6,.5);gesture(h,'pointermove',.62,.5);}
function startMask(h){h.setup('background');h.click('manualMask');const before=plain(h.env.draft);gesture(h,'pointerdown',.5,.5);gesture(h,'pointermove',.53,.5);assert.notDeepEqual(plain(h.env.draft.recipe),before.recipe);return before;}
test('normal manual pointerup commits one push; duplicate lost capture cannot add another',()=>{const h=harness();startPush(h);gesture(h,'pointerup',.62,.5);assert.equal(h.env.draft.liquify.length,1);gesture(h,'lostpointercapture',0,0);assert.equal(h.env.draft.liquify.length,1);assert.equal(h.env.pointer,null);});
test('pointercancel rejects an unfinished manual push',()=>{const h=harness();startPush(h);gesture(h,'pointercancel',.62,.5);assert.equal(h.env.draft.liquify.length,0);assert.equal(h.env.pointer,null);});
test('lost capture cancels an unfinished manual push rather than committing it',()=>{const h=harness();startPush(h);gesture(h,'lostpointercapture',.62,.5);assert.equal(h.env.draft.liquify.length,0);assert.equal(h.env.pointer,null);});
test('lost capture restores background pixels and validity before interrupted stroke',()=>{const h=harness(),before=startMask(h);gesture(h,'lostpointercapture',.53,.5);assert.deepEqual(plain(h.env.draft),before);assert.equal(h.$('undoMask').disabled,true);});
test('window blur rolls back background gesture and clears all active pointer state',()=>{const h=harness(),before=startMask(h);h.windowListeners.blur({type:'blur'});assert.deepEqual(plain(h.env.draft),before);assert.equal(h.env.pointer,null);assert.equal(h.env.painting,false);assert.equal(h.env.currentStroke,null);assert.equal(h.$('undoMask').disabled,true);});
test('pointercancel restores unapplied crop to its pre-gesture state',()=>{const h=harness();h.setup('crop');h.env.draft={type:'crop',x:.2,y:.2,w:.6,h:.6,ratio:0};const before=plain(h.env.draft);gesture(h,'pointerdown',.5,.5);gesture(h,'pointermove',.6,.6);assert.notDeepEqual(plain(h.env.draft),before);gesture(h,'pointercancel',.6,.6);assert.deepEqual(plain(h.env.draft),before);});
test('lost capture discards a legacy doodle stroke without discarding previous ones',()=>{const h=harness();h.env.draft={type:'draw',lines:[[{x:.1,y:.1}]],width:.012,color:'#ffffff'};const before=plain(h.env.draft);gesture(h,'pointerdown',.5,.5);gesture(h,'pointermove',.6,.6);gesture(h,'lostpointercapture',0,0);assert.deepEqual(plain(h.env.draft),before);assert.equal(h.env.currentStroke,null);});
test('window blur restores a legacy text drag to its pre-gesture position',()=>{const h=harness();h.env.draft={type:'text',x:.5,y:.5,size:.09,color:'#ffffff',shadow:true};h.env.draft.text='test';const before=plain(h.env.draft);gesture(h,'pointerdown',.5,.5);gesture(h,'pointermove',.7,.7);h.windowListeners.blur({type:'blur'});assert.deepEqual(plain(h.env.draft),before);});
test('changing tools during a gesture cannot route its pointerup to the new draft',()=>{const h=harness();startPush(h);const old=h.env.draft;h.env.showTool('crop');const next=plain(h.env.draft);gesture(h,'pointerup',.62,.5);assert.deepEqual(plain(h.env.draft),next);assert.equal(old.liquify.length,0);assert.equal(h.env.pointer,null);});

function faceReply(h,count=2){const request=h.requests.at(-1);return{ok:true,faceLimit:5,detector:plain(h.env.MintPortraitPeople.DEFAULT_DETECTOR),detectionSize:{width:request.width,height:request.height},faces:Array.from({length:count},()=>({landmarks:Array.from({length:478},()=>({x:.5,y:.5,z:0}))}))};}
test('generic face chooser arrival rolls back an unfinished mask stroke before capturing draft state',()=>{const h=harness({native:true});h.setup('background');h.click('manualMask');const before=plain(h.env.draft);let picked=0;h.ui.detectFace(()=>picked++);gesture(h,'pointerdown',.5,.5);gesture(h,'pointermove',.54,.5);assert.notDeepEqual(plain(h.env.draft),before);h.result(faceReply(h));assert.equal(h.env.pointer,null);assert.deepEqual(plain(h.env.draft),before);assert(h.env.PortraitPeopleUI.selectionActive());assert.equal(picked,0);h.click('choose-face-2');assert.equal(picked,1);assert.deepEqual(plain(h.env.draft),before);});
test('generic face chooser blocks underlying ID-photo drag until selected or canceled',()=>{const h=harness({native:true});h.setup('idphoto');h.document.querySelectorAll('[data-id-size]')[0].click();const before=plain(h.env.draft);h.click('detectPortrait');h.result(faceReply(h));assert(h.env.PortraitPeopleUI.selectionActive());gesture(h,'pointerdown',.5,.5);gesture(h,'pointermove',.6,.6);gesture(h,'pointerup',.6,.6);assert.deepEqual(plain(h.env.draft),before);assert.equal(h.env.pointer,null);h.click('cancelFaceSelection');assert.deepEqual(plain(h.env.draft),before);});

test('Escape dismisses generic face choice without resetting existing ID-photo crop',()=>{const h=harness({native:true});h.setup('idphoto');h.document.querySelectorAll('[data-id-size]')[0].click();const before=plain(h.env.draft);h.click('detectPortrait');h.result(faceReply(h));assert(h.env.PortraitPeopleUI.selectionActive());let prevented=false;h.windowListeners.keydown({key:'Escape',target:{matches:()=>false},preventDefault(){prevented=true;}});assert(prevented);assert.equal(h.env.PortraitPeopleUI.selectionActive(),false);assert.deepEqual(plain(h.env.draft),before);});
test('generic face chooser prevents accidental manual repair when tapping the numbered overlay',()=>{const h=harness({native:true});h.setup('retouch');h.click('manualClone');h.click('sampleSource');gesture(h,'pointerdown',.15,.4);gesture(h,'pointerup',.15,.4);h.click('autoSource');h.result(faceReply(h));assert(h.env.PortraitPeopleUI.selectionActive());const before=plain(h.env.draft);gesture(h,'pointerdown',.5,.5);gesture(h,'pointerup',.5,.5);assert.equal(h.env.draft.repair.length,0);h.click('cancelFaceSelection');assert.deepEqual(plain(h.env.draft),before);});
