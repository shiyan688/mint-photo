'use strict';
// Runs the complete shipped ProjectCore/editor scripts and their real event handlers.
// Test probes expose state only. DOM, Canvas, Image decode, IndexedDB, timers, and
// native saves are controlled fakes: these are NOT browser pixels/device QA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {assets} = require('./source-paths.cjs');
const editor = fs.readFileSync(path.join(assets, 'editor.js'), 'utf8');
const core = fs.readFileSync(path.join(assets, 'project-core.js'), 'utf8');
const html = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(setImmediate);
const MiB = 1024 * 1024;
function harness() {
  const ids = new Map(), nodes = [], timers = new Map(), urls = new Map(), descriptors = new WeakMap();
  const decodes = [], encodes = [], native = [], writes = [], pendingEncodes = [];
  let counter = 0, imageCounter = 0, urlCounter = 0, record, failDraw = null;
  const settings = { deferEncode: false, encodeType: null, encodeSize: null, encodeFail: false, readFail: false, storageFail: false, demoDescriptor: { width: 512, height: 512 } };
  const classes = () => ({ add() {}, remove() {}, toggle() {}, contains() { return false; } });
  function element(tag, attrs = {}) {
    const e = { tagName: tag.toUpperCase(), dataset: {}, style: {}, classList: classes(), listeners: {}, value: attrs.value || '', disabled: false, hidden: false, open: false, textContent: '', innerHTML: '',
      children: [], attributes: {}, appendChild(child) { this.children.push(child); child.parentNode=this; return child; }, removeChild(child) { const index=this.children.indexOf(child); if(index<0)throw Error("not a child");this.children.splice(index,1);child.parentNode=null;return child; }, get firstChild() { return this.children[0]||null; }, replaceChildren(...items) { while(this.firstChild)this.removeChild(this.firstChild);for(const child of items)this.appendChild(child); }, addEventListener(name, fn) { this.listeners[name] = fn; }, removeEventListener(name,fn) { if(this.listeners[name]===fn)delete this.listeners[name]; }, setAttribute(key,value) { this.attributes[key]=String(value); }, removeAttribute(key) { delete this.attributes[key]; },
      showModal() { this.open = true; }, close() { this.open = false; },
      click() { const event={target:this,preventDefault(){}};return this.onclick?this.onclick(event):this.listeners.click?.(event); }, remove() {},
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
  const document = { getElementById: id => ids.get(id) || null, body: { appendChild() {} },
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
      put(value) { writes.push(value); if (!settings.storageFail) record = structuredClone(value); queueMicrotask(() => { if (settings.storageFail) { tx.error = Error('quota'); tx.onerror?.(); } else tx.oncomplete?.(); }); },
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
  env.window = env; env.addEventListener = () => {};
  env.Android = { saveImage: (data, name, mime) => native.push({ data, name, mime }) };
  vm.createContext(env); vm.runInContext(core, env, { filename: 'project-core.js' });
  for(const name of ['image-overlay.js','image-overlay-operation.js','image-import.js','image-overlay-ui.js','redact-core.js','redact-operation.js','redact-ui.js','export-size.js','export-resize.js','history-ui.js'])vm.runInContext(fs.readFileSync(path.join(assets,name),'utf8'),env,{filename:name});
  const probe = `\nwindow.__probe = { get state() { return {source,sourceBlob,sourceAsset,committed,ops,redo,draft,hasSaved,projectRevision,exportPending,exportRevision,importVersion}; }, commit, setTool, saveDraftSoon, setDraftRecord(value){draftRecord=value;}, setExportMode(value){exportResolution=value;}, setFormat(value){exportFormat=value;}, setDraft(value){draft=value;} };\n`;
  assert(/\}\)\(\);\s*$/.test(editor), 'Unexpected editor wrapper');
  vm.runInContext(editor.replace(/\}\)\(\);\s*$/, probe + '})();'), env, { filename: 'editor.js' });
  const h = { env, settings, decodes, encodes, native, writes, timers, pendingEncodes,
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
// Extraction sentinel only. Executed through base-editor-harness.cjs.
