'use strict';
// Runs the complete shipped ProjectCore/editor scripts and their real event handlers.
// Test probes expose state only. DOM, Canvas, Image decode, IndexedDB, timers, and
// native saves are controlled fakes: these are NOT browser pixels/device QA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assets = path.join(__dirname, '../app/src/main/assets');
const editor = fs.readFileSync(path.join(assets, 'editor.js'), 'utf8');
const core = fs.readFileSync(path.join(assets, 'project-core.js'), 'utf8');
const html = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(setImmediate);
const MiB = 1024 * 1024;
function harness() {
  const ids = new Map(), nodes = [], timers = new Map(), urls = new Map(), descriptors = new WeakMap();
  const decodes = [], encodes = [], native = [], writes = [], pendingEncodes = [], pendingStorage = [], windowListeners = {}, documentListeners = {};
  let counter = 0, imageCounter = 0, urlCounter = 0, record, failDraw = null;
  const settings = { deferEncode: false, encodeType: null, encodeSize: null, encodeFail: false, readFail: false, storageFail: false, deferStorage: false, demoDescriptor: { width: 512, height: 512 } };
  const classes = () => ({ add() {}, remove() {}, toggle() {}, contains() { return false; } });
  function element(tag, attrs = {}) {
    const e = { tagName: tag.toUpperCase(), dataset: {}, style: {}, classList: classes(), listeners: {}, value: attrs.value || '', disabled: false, hidden: false, open: false, textContent: '', innerHTML: '',
      addEventListener(name, fn) { this.listeners[name] = fn; }, setAttribute() {},
      showModal() { this.open = true; }, close() { this.open = false; },
      click() { return this.onclick?.({ target: this }); }, remove() {},
      setPointerCapture() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 800 }; },
      querySelector(selector) { return this.options?.[selector] || null; }
    };
    Object.assign(e, attrs);
    for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) e.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    if (attrs.id) ids.set(attrs.id, e);
    nodes.push(e); return e;
  }
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)) {
    const attrs = {};
    for (const a of match[2].matchAll(/([a-zA-Z][\w:-]*)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? '';
    element(match[1], attrs);
  }
  function fakeCanvas(width = 1, height = 1) {
    const c = { width, height, draws: [], toDataURL: () => 'data:image/jpeg;base64,dGVzdA==', toBlob(callback, type, quality) {
      const request = { width: c.width, height: c.height, type, quality }; encodes.push(request);
      const finish = () => {
        if (settings.encodeFail) { callback(null); return; }
        const blob = new Blob(['controlled encoder output'], { type: settings.encodeType || type });
        if (settings.encodeSize !== null) Object.defineProperty(blob, 'size', { value: settings.encodeSize });
        descriptors.set(blob, { width: request.width, height: request.height }); request.blob = blob; callback(blob);
      };
      if (settings.deferEncode) pendingEncodes.push(finish); else queueMicrotask(finish);
    }};
    const ctx = { drawImage(...args) { if (failDraw?.(c, args[0])) throw Error('synthetic allocation failure'); c.draws.push(args); },
      save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, fillRect() {}, clearRect() {}, strokeRect() {},
      beginPath() {}, arc() {}, ellipse() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, setLineDash() {}, fillText() {}, bezierCurveTo() {},
      createLinearGradient() { return { addColorStop() {} }; },
      getImageData() { return { width: c.width, height: c.height, data: new Uint8ClampedArray(c.width * c.height * 4) }; },
      putImageData() {}
    };
    c.getContext = () => ctx; return c;
  }
  const document = { visibilityState: 'visible', addEventListener(type,fn){documentListeners[type]=fn;}, getElementById: id => ids.get(id) || null, body: { appendChild() {} },
    createElement: tag => tag === 'canvas' ? fakeCanvas() : element(tag),
    querySelectorAll(selector) {
      const match = selector.match(/^\[data-([\w-]+)\]$/);
      if (match) return nodes.filter(e => match[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()) in e.dataset);
      if (selector.startsWith('.')) return nodes.filter(e => (e.class || '').split(/\s+/).includes(selector.slice(1)));
      return [];
    }
  };
  ids.get('exportResolution').options = { '[value="original"]': { disabled: false } };
  ids.get('quality').value = '94'; ids.get('exportSize').value='unchanged';
  for (const id of ['previewCanvas', 'overlayCanvas']) Object.assign(ids.get(id), fakeCanvas());
  class FakeImage {
    set src(url) {
      this.url = url;
      if (!url) return;
      const blob = urls.get(url), d = url === 'demo/astronaut.png' ? settings.demoDescriptor : descriptors.get(blob);
      assert(d, `No controlled decoder registered for ${url}`);
      const request = { id: ++imageCounter, image: this, blob, descriptor: d }; decodes.push(request);
      const finish = () => { this.naturalWidth = d.width; this.naturalHeight = d.height; if (d.fail) this.onerror?.(); else this.onload?.(); };
      request.finish = finish;
      if (!d.defer) queueMicrotask(finish);
    }
    get src() { return this.url; }
  }
  const database = { createObjectStore() {}, transaction() {
    const tx = { objectStore() { return {
      get() { const request = {}; queueMicrotask(() => { request.result = record; request.onsuccess?.(); }); return request; },
      put(value) { writes.push(value); const snapshot=structuredClone(value), fail=settings.storageFail;
        const finish=()=>{if(fail){tx.error=Error('quota');tx.onerror?.();}else{record=snapshot;tx.oncomplete?.();}};
        if(settings.deferStorage)pendingStorage.push({value:snapshot,finish});else queueMicrotask(finish); },
      delete() { record = undefined; queueMicrotask(() => tx.oncomplete?.()); }
    }; }}; return tx;
  }};
  const indexedDB = { open() { const request = {}; queueMicrotask(() => { request.result = database; request.onsuccess?.(); }); return request; } };
  class FakeFile extends Blob { constructor(parts, name, options) { super(parts, options); Object.defineProperty(this, 'name', { value: name }); descriptors.set(this, descriptors.get(parts[0]) || { width: 1500, height: 1900 }); } }
  const env = { console, Blob, File: FakeFile, URLSearchParams, Uint8Array, Uint8ClampedArray, Image: FakeImage, document, indexedDB, location: { search: '?test' },
    URL: { createObjectURL(blob) { const u = 'blob:controlled-' + ++urlCounter; urls.set(u, blob); return u; }, revokeObjectURL: url => urls.delete(url) },
    setTimeout(fn, delay) { const id = ++counter; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id),
    requestAnimationFrame() { return ++counter; }, matchMedia: () => ({ matches: false }),
    FileReader: class { readAsDataURL(blob) { queueMicrotask(async () => { if (settings.readFail) { this.onerror?.(); return; } this.result = 'data:' + blob.type + ';base64,' + Buffer.from(await blob.arrayBuffer()).toString('base64'); this.onload?.(); }); } }
  };
  env.window = env; env.addEventListener = (type,fn) => {windowListeners[type]=fn;};
  env.Android = { saveImage: (data, name, mime) => native.push({ data, name, mime }) };
  vm.createContext(env); vm.runInContext(core, env, { filename: 'project-core.js' });
  for(const name of ['straighten.js','straighten-operation.js','straighten-ui.js','light-balance.js','light-balance-operation.js','light-balance-ui.js','image-overlay.js','image-overlay-operation.js','image-import.js','image-overlay-ui.js','collage-layout.js','collage-operation.js','collage-ui.js','redact-core.js','redact-operation.js','redact-ui.js','export-size.js','export-resize.js'])vm.runInContext(fs.readFileSync(path.join(assets,name),'utf8'),env,{filename:name});
  const probe = `\nwindow.__probe = { get state() { return {source,sourceBlob,sourceAsset,committed,ops,redo,draft,hasSaved,projectRevision,exportPending,exportRevision,importVersion,savedDraftRevision,draftWrite,closeDraftSave,closeDraftFailureRevision}; }, commit, setTool, saveDraftSoon, saveDraftNow, setDraftRecord(value){draftRecord=value;}, setExportMode(value){exportResolution=value;}, setFormat(value){exportFormat=value;}, setDraft(value){draft=value;} };\n`;
  assert(/\}\)\(\);\s*$/.test(editor), 'Unexpected editor wrapper');
  vm.runInContext(editor.replace(/\}\)\(\);\s*$/, probe + '})();'), env, { filename: 'editor.js' });
  const h = { env, settings, decodes, encodes, native, writes, timers, pendingEncodes, pendingStorage, windowListeners, documentListeners,
    get state() { return env.__probe.state; }, get record() { return record; }, get liveUrls() { return urls.size; },
    $(id) { const node = ids.get(id); assert(node, `Missing #${id}`); return node; },
    file(name = 'photo.jpg', width = 4000, height = 1800, options = {}) {
      const file = new Blob([options.bytes || 'exact original bytes: ' + name], { type: options.type || 'image/jpeg' });
      Object.defineProperty(file, 'name', { value: name }); descriptors.set(file, { width, height, ...options }); return file;
    },
    describe(file, width, height, options = {}) { descriptors.set(file, { width, height, ...options }); },
    releaseDecode(file) { const request = decodes.find(x => x.blob === file && !x.released); assert(request, 'No pending decode'); request.released = true; request.finish(); },
    setFailDraw(fn) { failDraw = fn; },
    async flush(delay) { const work = [...timers].filter(([, t]) => t.delay === delay); for (const [id, t] of work) { timers.delete(id); await t.fn(); } await tick(); },
    async load(file) { await env.EditorTest.loadPhoto(file); await tick(); },
    async save() { const promise = ids.get('saveBtn').click(); await h.flush(60); await promise; await tick(); },
    commit(op) { return env.__probe.commit(op); },
    nativeResult(ok, message) { env.onNativeExportResult(ok, message); },
    async restore(value) { env.__probe.setDraftRecord(value); await ids.get('restoreDraft').click(); await tick(); }
  };
  return h;
}

const test=require('node:test');
async function ready(){const h=harness();await h.load(h.file());await h.flush(350);assert.equal(h.record.ops.length,0);assert.equal(h.state.savedDraftRevision,h.state.projectRevision);return h;}
async function settleStorage(h,index=0){const tx=h.pendingStorage.splice(index,1)[0];assert(tx,'Missing pending storage transaction');tx.finish();await tick();}
test('immediate commit then Back waits for current original/history transaction; next Back may exit',async()=>{const h=await ready();h.settings.deferStorage=true;h.commit({type:'rotate'});const rev=h.state.projectRevision;assert.equal(h.record.ops.length,0);assert.equal(h.env.requestClose(),true);await tick();assert.equal(h.pendingStorage.length,1);assert.equal(h.record.ops.length,0);assert.equal(h.env.requestClose(),true);assert.notEqual(h.state.savedDraftRevision,rev);await settleStorage(h);assert.equal(h.record.source.blob.size,h.state.sourceBlob.size);assert.deepEqual(plain(h.record.ops),[{type:'rotate'}]);assert.equal(h.state.savedDraftRevision,rev);assert.match(h.$('toast').textContent,/草稿已保存/);assert.equal(h.env.requestClose(),false);});
test('same-revision immediate, Back, pagehide and hidden flushes coalesce while transaction pending',async()=>{const h=await ready();h.settings.deferStorage=true;h.commit({type:'rotate'});const count=h.writes.length,p=h.env.__probe.saveDraftNow();const task=h.state.draftWrite,p2=h.env.__probe.saveDraftNow();assert.equal(h.state.draftWrite,task);assert.equal(h.env.requestClose(),true);h.windowListeners.pagehide({type:'pagehide'});h.env.document.visibilityState='hidden';h.documentListeners.visibilitychange({type:'visibilitychange'});await tick();assert.equal(h.writes.length,count+1);assert.equal(h.pendingStorage.length,1);await settleStorage(h);await Promise.all([p,p2]);assert.equal(h.env.requestClose(),false);});
test('storage failure is not saved success and a second Back reaches native exit confirmation',async()=>{const h=await ready(),saved=h.state.savedDraftRevision;h.settings.storageFail=true;h.commit({type:'rotate'});assert.equal(h.env.requestClose(),true);await tick();assert.equal(h.state.savedDraftRevision,saved);assert.equal(h.record.ops.length,0);assert.equal(h.state.closeDraftFailureRevision,h.state.projectRevision);assert.match(h.$('toast').textContent,/保存失败/);assert.equal(h.env.requestClose(),false);assert.equal(h.state.closeDraftSave,null);});
test('a later edit retries after an earlier save failure and successful save clears failure state',async()=>{const h=await ready();h.settings.storageFail=true;h.commit({type:'rotate'});h.env.requestClose();await tick();assert.equal(h.env.requestClose(),false);h.settings.storageFail=false;h.commit({type:'flip',axis:'x'});assert.equal(h.env.requestClose(),true);await tick();assert.equal(h.record.ops.length,2);assert.equal(h.state.closeDraftFailureRevision,-1);assert.equal(h.env.requestClose(),false);});
test('older completion never marks a later revision saved or clears its active write',async()=>{const h=await ready();h.settings.deferStorage=true;h.commit({type:'rotate'});const oldRevision=h.state.projectRevision,old=h.env.__probe.saveDraftNow();await tick();h.commit({type:'flip',axis:'x'});const revision=h.state.projectRevision,current=h.env.__probe.saveDraftNow();await tick();assert.equal(h.pendingStorage.length,2);const newestTask=h.state.draftWrite;await settleStorage(h);await old;assert.equal(h.state.savedDraftRevision,oldRevision);assert.notEqual(h.state.savedDraftRevision,revision);assert.equal(h.state.draftWrite,newestTask);assert.equal(h.env.requestClose(),true);await tick();assert.equal(h.pendingStorage.length,1,'Back joins existing latest write');await settleStorage(h);await current;assert.equal(h.state.savedDraftRevision,revision);assert.equal(h.record.ops.length,2);assert.equal(h.env.requestClose(),false);});
test('an edit made during close-saving requires its own save before exit',async()=>{const h=await ready();h.settings.deferStorage=true;h.commit({type:'rotate'});assert.equal(h.env.requestClose(),true);await tick();h.commit({type:'flip',axis:'y'});const newest=h.state.projectRevision;await settleStorage(h);assert.notEqual(h.state.savedDraftRevision,newest);assert.match(h.$('toast').textContent,/又有变化/);assert.equal(h.env.requestClose(),true);await tick();assert.equal(h.pendingStorage.length,1);await settleStorage(h);assert.equal(h.record.ops.length,2);assert.equal(h.env.requestClose(),false);});
test('pagehide flushes committed changes without waiting for 350 ms debounce',async()=>{const h=await ready();h.commit({type:'rotate'});assert.equal(h.record.ops.length,0);h.windowListeners.pagehide({type:'pagehide'});await tick();assert.equal(h.record.ops.length,1);assert.equal([...h.timers.values()].filter(t=>t.delay===350).length,0);assert.equal(h.state.savedDraftRevision,h.state.projectRevision);});
test('visibility flushes only when hidden and does not wait for debounce',async()=>{const h=await ready();h.commit({type:'rotate'});const writes=h.writes.length;h.documentListeners.visibilitychange({type:'visibilitychange'});await tick();assert.equal(h.writes.length,writes);assert.equal(h.record.ops.length,0);h.env.document.visibilityState='hidden';h.documentListeners.visibilitychange({type:'visibilitychange'});await tick();assert.equal(h.record.ops.length,1);assert.equal([...h.timers.values()].filter(t=>t.delay===350).length,0);});
test('background flush cancels unfinished drawing and persists only committed history',async()=>{const h=await ready();h.commit({type:'rotate'});h.env.__probe.setDraft({type:'draw',lines:[],width:.01,color:'#ffffff'});const e=(type,x,y)=>({type,pointerId:1,clientX:x*600,clientY:y*800,preventDefault(){}});h.$('overlayCanvas').listeners.pointerdown(e('pointerdown',.3,.3));h.$('overlayCanvas').listeners.pointermove(e('pointermove',.4,.4));assert.equal(h.state.draft.lines.length,1);h.windowListeners.pagehide({type:'pagehide'});await tick();assert.equal(h.state.draft.lines.length,0);assert.deepEqual(plain(h.record.ops),[{type:'rotate'}]);});
test('background failure warns, retains original and history, and permits a later successful retry',async()=>{const h=await ready(),blob=h.state.sourceBlob;h.settings.storageFail=true;h.commit({type:'rotate'});h.windowListeners.pagehide({type:'pagehide'});await tick();assert.match(h.$('toast').textContent,/保存失败/);assert.equal(h.state.sourceBlob,blob);assert.equal(h.state.ops.length,1);assert.equal(h.record.ops.length,0);h.settings.storageFail=false;h.windowListeners.pagehide({type:'pagehide'});await tick();assert.equal(h.record.ops.length,1);assert.equal(h.state.savedDraftRevision,h.state.projectRevision);});
