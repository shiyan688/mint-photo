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
  const decodes = [], encodes = [], native = [], writes = [], pendingEncodes = [];
  let counter = 0, imageCounter = 0, urlCounter = 0, record, failDraw = null;
  const settings = { deferEncode: false, encodeType: null, encodeSize: null, encodeFail: false, readFail: false, storageFail: false, demoDescriptor: { width: 512, height: 512 } };
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
      createImageData(w,h) { return {width:w,height:h,data:new Uint8ClampedArray(w*h*4)}; },
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
  const env = { console, Blob, File: FakeFile, URLSearchParams, Uint8Array, Uint8ClampedArray, ArrayBuffer, Image: FakeImage, document, indexedDB, location: { search: '?test' },
    URL: { createObjectURL(blob) { const u = 'blob:controlled-' + ++urlCounter; urls.set(u, blob); return u; }, revokeObjectURL: url => urls.delete(url) },
    setTimeout(fn, delay) { const id = ++counter; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id),
    requestAnimationFrame() { return ++counter; }, matchMedia: () => ({ matches: false }),
    FileReader: class { readAsDataURL(blob) { queueMicrotask(async () => { if (settings.readFail) { this.onerror?.(); return; } this.result = 'data:' + blob.type + ';base64,' + Buffer.from(await blob.arrayBuffer()).toString('base64'); this.onload?.(); }); } }
  };
  env.window = env; env.addEventListener = () => {};
  env.Android = { saveImage: (data, name, mime) => native.push({ data, name, mime }) };
  vm.createContext(env); vm.runInContext(fs.readFileSync(path.join(assets,'geometry.js'),'utf8'),env); vm.runInContext(core, env, { filename: 'project-core.js' });
  for(const name of ['straighten.js','straighten-operation.js','straighten-ui.js','light-balance.js','light-balance-operation.js','light-balance-ui.js','image-overlay.js','photo-background.js','image-overlay-operation.js','image-import.js','image-overlay-ui.js','collage-layout.js','collage-operation.js','collage-ui.js','redact-core.js','redact-operation.js','redact-ui.js','export-size.js','export-resize.js'])vm.runInContext(fs.readFileSync(path.join(assets,name),'utf8'),env,{filename:name});
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
const passed = [], failed = [];
async function test(name, fn) { try { await fn(); passed.push(name); console.log('PASS', name); } catch (error) { failed.push({ name, error: error.stack }); console.error('FAIL', name, '\n', error.stack); } }
(async () => {
  await test('import retains the exact original Blob bytes and metadata, separate from working and preview canvases', async () => {
    const h = harness(), file = h.file(); await h.load(file);
    assert.equal(h.state.sourceBlob, file); assert.equal(h.state.sourceAsset.blob, file);
    assert.equal(await h.state.sourceBlob.text(), await file.text());
    assert.deepEqual([h.state.sourceAsset.width, h.state.sourceAsset.height], [4000, 1800]);
    assert.deepEqual([h.state.source.width, h.state.source.height], [2560, 1152]);
    assert.deepEqual([h.state.committed.width, h.state.committed.height], [900, 405]);
    assert.equal(h.encodes.length, 0, 'Import must never PNG-encode and substitute a canvas');
    assert.equal(h.liveUrls, 0, 'Decoder URL must be revoked');
  });
  await test('stale decode completion cannot replace a newer import or its original Blob', async () => {
    const h = harness(), old = h.file('old.jpg', 3000, 2000, { defer: true }), next = h.file('next.jpg', 2400, 1600);
    const pending = h.load(old); await h.load(next); const revision = h.state.projectRevision;
    h.releaseDecode(old); await pending;
    assert.equal(h.state.sourceBlob, next); assert.equal(h.state.projectRevision, revision); assert.equal(h.$('busy').hidden, true);
  });
  await test('stale decode error cannot obscure a successful newer import', async () => {
    const h = harness(), old = h.file('old.jpg', 200, 100, { defer: true, fail: true }), next = h.file('next.jpg', 900, 600);
    const pending = h.load(old); await h.load(next); const notice = h.$('toast').textContent;
    h.releaseDecode(old); await pending; assert.equal(h.$('toast').textContent, notice); assert.equal(h.state.sourceBlob, next);
  });
  await test('failed import leaves old source, history, redo, dimensions and revision intact', async () => {
    const h = harness(), prior = h.file(); await h.load(prior); h.commit({ type: 'rotate' }); h.$('undoBtn').click(); const before = h.state;
    await h.load(h.file('broken.jpg', 50, 50, { fail: true }));
    assert.equal(h.state.sourceBlob, prior); assert.equal(h.state.source, before.source); assert.deepEqual(plain(h.state.ops), plain(before.ops)); assert.deepEqual(plain(h.state.redo), plain(before.redo));
    assert.equal(h.state.projectRevision, before.projectRevision); assert.equal(h.$('busy').hidden, true);
  });
  await test('failed preview allocation rolls back import atomically', async () => {
    const h = harness(), prior = h.file(); await h.load(prior); h.commit({ type: 'rotate' }); const before = h.state;
    h.setFailDraw((canvas, input) => input && input.width === 2000 && canvas.width === 900);
    await h.load(h.file('new.jpg', 2000, 1000));
    assert.equal(h.state.sourceBlob, prior); assert.equal(h.state.source, before.source); assert.equal(h.state.committed, before.committed); assert.deepEqual(plain(h.state.ops), plain(before.ops)); assert.equal(h.state.projectRevision, before.projectRevision);
  });
  await test('failed edit render keeps committed history, redo, draft and revision', async () => {
    const h = harness(); await h.load(h.file()); h.commit({ type: 'rotate' }); h.$('undoBtn').click(); h.env.__probe.setDraft({ type: 'filter', id: 'warm' }); const before = h.state;
    h.setFailDraw(() => true); assert.equal(h.commit({ type: 'rotate' }), false);
    assert.equal(h.state.ops, before.ops); assert.equal(h.state.redo, before.redo); assert.equal(h.state.draft, before.draft); assert.equal(h.state.committed, before.committed); assert.equal(h.state.projectRevision, before.projectRevision);
  });
  await test('v2 draft persists exact original, metadata and both history stacks, and restores them', async () => {
    const h = harness(), file = h.file(); await h.load(file); h.commit({ type: 'rotate' }); h.commit({ type: 'flip', axis: 'x' }); h.$('undoBtn').click(); await h.flush(350);
    const stored = h.record; assert.equal(stored.version, 2); assert.equal(await stored.source.blob.text(), await file.text()); assert.equal(stored.source.width, 4000); assert.deepEqual(plain(stored.ops), [{ type: 'rotate' }]); assert.deepEqual(plain(stored.redo), [{ type: 'flip', axis: 'x' }]);
    h.describe(stored.source.blob, 4000, 1800); await h.load(h.file('replace.jpg', 800, 600)); await h.restore(stored);
    assert.equal(h.state.sourceBlob, stored.source.blob); assert.deepEqual(plain(h.state.ops), stored.ops); assert.deepEqual(plain(h.state.redo), stored.redo); assert.deepEqual(plain(h.env.EditorTest.state.size), { w: 1800, h: 4000 });
  });
  await test('draft persistence snapshots arrays so later edits cannot mutate an in-flight stored record', async () => {
    const h = harness(); await h.load(h.file()); h.commit({ type: 'rotate' }); await h.flush(350); const stored = h.writes.at(-1); h.commit({ type: 'flip', axis: 'y' }); assert.deepEqual(plain(stored.ops), [{ type: 'rotate' }]); assert.equal(stored.source.blob, h.state.sourceBlob);
  });
  await test('stale restore cannot replace a newer import', async () => {
    const h = harness(), old = h.file('saved.jpg', 2000, 1000, { defer: true }), next = h.file('new.jpg', 600, 400);
    const record = h.env.ProjectCore.draftRecord(h.env.ProjectCore.makeProject({ blob: old, width: 2000, height: 1000, name: 'saved.jpg', origin: 'original' }, [{ type: 'rotate' }]));
    const pending = h.restore(record); await h.load(next); h.releaseDecode(old); await pending; assert.equal(h.state.sourceBlob, next); assert.equal(h.state.ops.length, 0);
  });
  await test('stale import cannot replace a newer restore', async () => {
    const h = harness(), old = h.file('old.jpg', 1500, 1000, { defer: true }), saved = h.file('saved.jpg', 1800, 1200);
    const record = h.env.ProjectCore.draftRecord(h.env.ProjectCore.makeProject({ blob: saved, width: 1800, height: 1200, name: 'saved.jpg', origin: 'original' }));
    const pending = h.load(old); await h.restore(record); h.releaseDecode(old); await pending; assert.equal(h.state.sourceBlob, saved);
  });
  await test('restore rejects mismatched decoded orientation/dimensions without replacing current project', async () => {
    const h = harness(), prior = h.file(); await h.load(prior); const saved = h.file('mismatch.jpg', 1000, 2000), record = h.env.ProjectCore.makeProject({ blob: saved, width: 2000, height: 1000, origin: 'original' });
    await h.restore(record); assert.equal(h.state.sourceBlob, prior); assert.match(h.$('toast').textContent, /尺寸|方向/);
  });
  await test('legacy draft uses decoded working dimensions and never claims original-resolution recovery', async () => {
    const h = harness(), file = h.file('legacy.png', 1800, 1200, { type: 'image/png' }); await h.restore({ version: 1, blob: file, name: 'legacy.png', ops: [{ type: 'rotate' }] });
    assert.equal(h.state.sourceAsset.origin, 'legacy-working-copy'); assert.equal(h.state.sourceAsset.width, 1800); assert.match(h.$('toast').textContent, /无法补回/); h.$('exportBtn').click(); assert.equal(h.$('exportResolution').value, 'choose'); assert.equal(h.$('saveBtn').disabled, true); assert.equal(h.$('exportResolution').options['[value="original"]'].disabled, true); h.$('exportResolution').value = 'working'; h.$('exportResolution').onchange({ target: h.$('exportResolution') }); assert.equal(h.$('saveBtn').disabled, false);
  });
  await test('unknown future draft fails without replacing or rewriting the prior project', async () => {
    const h = harness(), prior = h.file(); await h.load(prior); const before = h.state.projectRevision, writes = h.writes.length, decodes = h.decodes.length;
    await h.restore({ version: 999, blob: h.file('future.jpg', 500, 400), ops: [] }); assert.equal(h.state.sourceBlob, prior); assert.equal(h.state.projectRevision, before); assert.equal(h.writes.length, writes); assert.equal(h.decodes.length, decodes); assert.match(h.$('toast').textContent, /更新版本/);
  });
  await test('original export rejects over-budget input before full decode or encode even after tiny crop', async () => {
    const h = harness(); await h.load(h.file('large.jpg', 8000, 6000)); h.commit({ type: 'crop', x: 0, y: 0, w: .01, h: .01 }); h.env.__probe.setExportMode('original'); const before = h.decodes.length; await h.save();
    assert.equal(h.decodes.length, before); assert.equal(h.encodes.length, 0); assert.equal(h.native.length, 0); assert.equal(h.state.exportPending, false); assert.match(h.$('toast').textContent, /800|4096/);
  });
  await test('original export replays on full decoded pixels with actual rotate/crop output dimensions', async () => {
    const h = harness(), file = h.file(); await h.load(file); h.commit({ type: 'rotate' }); h.commit({ type: 'crop', x: .1, y: .1, w: .5, h: .5 }); h.env.__probe.setFormat('image/png'); h.$('exportBtn').click();
    assert.equal(h.$('exportResolution').value, 'original'); assert.match(h.$('exportDetails').textContent, /900 × 2000/); await h.save();
    assert.equal(h.decodes.length, 2); assert.equal(h.decodes.at(-1).blob, file); assert.deepEqual([h.encodes.at(-1).width, h.encodes.at(-1).height], [900, 2000]); assert.equal(h.native[0].mime, 'image/png'); assert.match(h.native[0].name, /\.png$/); assert.equal(h.state.exportPending, true); h.nativeResult(true); assert.equal(h.state.hasSaved, true);
  });
  await test('working export uses retained working canvas, no second decode, and honest rounded dimensions', async () => {
    const h = harness(); await h.load(h.file('large.jpg', 8000, 6000)); h.commit({ type: 'rotate' }); h.commit({ type: 'crop', x: .1, y: .1, w: .5, h: .5 }); h.$('exportBtn').click(); assert.equal(h.$('exportResolution').value, 'choose'); assert.equal(h.$('saveBtn').disabled, true); assert.match(h.$('exportDetails').textContent, /8000 × 6000/); assert.match(h.$('exportDetails').textContent, /960 × 1280/); h.$('exportResolution').value = 'working'; h.$('exportResolution').onchange({ target: h.$('exportResolution') }); assert.equal(h.$('saveBtn').disabled, false); await h.save();
    assert.equal(h.decodes.length, 1); assert.deepEqual([h.encodes.at(-1).width, h.encodes.at(-1).height], [960, 1280]); assert.equal(h.native[0].mime, 'image/jpeg'); assert.deepEqual([h.state.source.width, h.state.source.height], [2560, 1920]);
  });
  await test('user resolution selection changes planned and actual exported dimensions', async () => {
    const h = harness(); await h.load(h.file()); h.$('exportBtn').click(); h.$('exportResolution').value = 'working'; h.$('exportResolution').onchange({ target: h.$('exportResolution') }); assert.match(h.$('exportDetails').textContent, /2560 × 1152/); await h.save(); assert.deepEqual([h.encodes.at(-1).width, h.encodes.at(-1).height], [2560, 1152]); assert.equal(h.decodes.length, 1);
  });
  await test('delayed export decode cannot save a newer project revision', async () => {
    const h = harness(), file = h.file(); await h.load(file); h.describe(file, 4000, 1800, { defer: true }); h.commit({ type: 'rotate' });
    const pending = h.$('saveBtn').click(); await h.flush(60); h.commit({ type: 'flip', axis: 'x' }); h.decodes.at(-1).finish(); await pending;
    assert.equal(h.native.length, 0); assert.equal(h.encodes.length, 0); assert.equal(h.state.hasSaved, false); assert.equal(h.state.exportPending, false); assert.match(h.$('toast').textContent, /编辑已变化/);
  });
  await test('delayed encoder cannot save a newer revision and retains immutable old export geometry', async () => {
    const h = harness(); await h.load(h.file()); h.commit({ type: 'rotate' }); h.settings.deferEncode = true;
    const pending = h.$('saveBtn').click(); await h.flush(60); assert.equal(h.pendingEncodes.length, 1); h.commit({ type: 'crop', x: 0, y: 0, w: .5, h: .5 }); h.pendingEncodes.shift()(); await pending;
    assert.deepEqual([h.encodes[0].width, h.encodes[0].height], [1800, 4000]); assert.equal(h.native.length, 0); assert.equal(h.state.exportPending, false); assert.equal(h.state.hasSaved, false);
  });
  await test('delayed native success does not mark subsequent edits saved', async () => {
    const h = harness(); await h.load(h.file()); h.commit({ type: 'rotate' }); await h.save(); assert.equal(h.state.exportPending, true); h.commit({ type: 'flip', axis: 'y' }); const revision = h.state.projectRevision; h.nativeResult(true, 'older save complete'); assert.equal(h.state.hasSaved, false); assert.equal(h.state.projectRevision, revision); assert.equal(h.state.exportPending, false);
  });
  await test('cancelled native save and a repeat save clear pending/busy state and preserve the project', async () => {
    const h = harness(), file = h.file(); await h.load(file); h.commit({ type: 'rotate' }); await h.save(); await h.save(); assert.equal(h.native.length, 1, 'Repeated click while pending must not duplicate saves'); h.nativeResult(false, '已取消保存'); assert.equal(h.state.exportPending, false); assert.equal(h.$('saveBtn').disabled, false); assert.equal(h.$('busy').hidden, true); assert.equal(h.state.sourceBlob, file); assert.equal(h.state.hasSaved, false);
    await h.save(); assert.equal(h.native.length, 2); h.nativeResult(true); assert.equal(h.state.hasSaved, true); assert.equal(h.state.exportPending, false);
  });
  for (const [label, setting, expected] of [['encoder failure', { encodeFail: true }, /图片生成失败/], ['wrong PNG MIME', { encodeType: 'image/jpeg' }, /不支持所选导出格式/], ['48MB limit', { encodeSize: 48 * MiB + 1 }, /48MB/], ['FileReader failure', { readFail: true }, /无法读取导出图片/]]) {
    await test(label + ' fails cleanly and allows retry without losing original/history', async () => {
      const h = harness(), file = h.file(); await h.load(file); h.commit({ type: 'rotate' }); h.env.__probe.setFormat('image/png'); Object.assign(h.settings, setting); await h.save(); assert.equal(h.native.length, 0); assert.equal(h.state.sourceBlob, file); assert.equal(h.state.ops.length, 1); assert.equal(h.state.exportPending, false); assert.equal(h.$('busy').hidden, true); assert.equal(h.$('saveBtn').disabled, false); assert.match(h.$('toast').textContent, expected);
      Object.assign(h.settings, { encodeFail: false, encodeType: null, encodeSize: null, readFail: false }); await h.save(); assert.equal(h.native.length, 1); h.nativeResult(true);
    });
  }
  await test('exactly 48MB is allowed and completed same-revision save marks only that revision saved', async () => {
    const h = harness(); await h.load(h.file()); h.commit({ type: 'rotate' }); h.settings.encodeSize = 48 * MiB; await h.save(); assert.equal(h.native.length, 1); assert.equal(h.state.hasSaved, false); h.nativeResult(true); assert.equal(h.state.hasSaved, true); h.nativeResult(false, 'spurious callback'); assert.equal(h.state.hasSaved, true);
  });
  await test('decoder-reported oriented dimensions remain distinct from file bytes and subsequent recipe rotation', async () => {
    // The decoder is controlled, so this checks orientation propagation only,
    // not real-browser EXIF interpretation or an actual EXIF pixel fixture.
    const h = harness(), file = h.file('oriented.jpg', 1800, 4000, { bytes: 'untouched camera bytes' }); await h.load(file); assert.deepEqual([h.state.sourceAsset.width, h.state.sourceAsset.height], [1800, 4000]); assert.deepEqual([h.state.source.width, h.state.source.height], [1152, 2560]); h.commit({ type: 'rotate' }); h.commit({ type: 'crop', x: 0, y: 0, w: .5, h: .5 }); await h.save(); assert.equal(await h.state.sourceBlob.text(), 'untouched camera bytes'); assert.deepEqual([h.encodes[0].width, h.encodes[0].height], [2000, 900]);
  });
  await test('history render failures preserve history stacks, draft, preview and revision', async () => {
    for (const button of ['undoBtn', 'redoBtn']) {
      const h = harness(); await h.load(h.file()); h.commit({ type: 'rotate' }); if (button === 'redoBtn') h.$('undoBtn').click(); h.env.__probe.setDraft({ type: 'filter', id: 'warm' }); const before = h.state, ops = plain(before.ops), redo = plain(before.redo);
      h.setFailDraw(() => true); assert.doesNotThrow(() => h.$(button).click()); assert.deepEqual(plain(h.state.ops), ops); assert.deepEqual(plain(h.state.redo), redo); assert.equal(h.state.draft, before.draft); assert.equal(h.state.committed, before.committed); assert.equal(h.state.projectRevision, before.projectRevision);
    }
  });
  await test('Reset allocation failure rolls back history and a retry restores the same original Blob', async () => {
    const h = harness(), file = h.file(); await h.load(file); h.commit({ type: 'rotate' }); h.commit({ type: 'flip', axis: 'x' }); h.$('undoBtn').click(); h.env.__probe.setDraft({ type: 'filter', id: 'warm' }); const before = h.state, ops = plain(before.ops), redo = plain(before.redo);
    h.$('resetBtn').click(); assert.equal(h.$('confirmDialog').open, true); h.setFailDraw(() => true); assert.doesNotThrow(() => h.$('confirmYes').click()); assert.equal(h.state.sourceBlob, file); assert.deepEqual(plain(h.state.ops), ops); assert.deepEqual(plain(h.state.redo), redo); assert.equal(h.state.draft, before.draft); assert.equal(h.state.committed, before.committed); assert.equal(h.state.hasSaved, before.hasSaved); assert.equal(h.state.projectRevision, before.projectRevision);
    h.setFailDraw(null); h.$('resetBtn').click(); h.$('confirmYes').click(); assert.equal(h.state.sourceBlob, file); assert.equal(h.state.ops.length, 0); assert.equal(h.state.redo.length, 0); assert.equal(h.state.hasSaved, true); assert.equal(h.state.projectRevision, before.projectRevision + 1);
  });
  await test('scenic demo encoding cannot replace a newer user import', async () => {
    const h = harness(); h.settings.deferEncode = true; const pending = h.$('demoBtn').click(); assert.equal(h.pendingEncodes.length, 1); const next = h.file('selected.jpg', 1200, 800); await h.load(next); const notice = h.$('toast').textContent; h.pendingEncodes.shift()(); await pending; assert.equal(h.state.sourceBlob, next); assert.equal(h.$('toast').textContent, notice); assert.equal(h.$('busy').hidden, true);
  });
  await test('portrait demo decode completion cannot hide or replace a newer in-flight import', async () => {
    const h = harness(); h.settings.demoDescriptor.defer = true; const pendingDemo = h.$('portraitDemoBtn').click(); const demoRequest = h.decodes[0]; const next = h.file('selected.jpg', 1200, 800, { defer: true }); const pendingPhoto = h.load(next); demoRequest.finish(); await pendingDemo; assert.equal(h.$('busy').hidden, false); assert.equal(h.state.source, null); assert.equal(h.encodes.length, 0); h.releaseDecode(next); await pendingPhoto; assert.equal(h.state.sourceBlob, next);
  });
  await test('portrait demo encoding cannot replace a newer user import', async () => {
    const h = harness(); h.settings.deferEncode = true; const pending = h.$('portraitDemoBtn').click(); await tick(); assert.equal(h.pendingEncodes.length, 1); const next = h.file('selected.jpg', 1200, 800); await h.load(next); h.pendingEncodes.shift()(); await pending; assert.equal(h.state.sourceBlob, next); assert.equal(h.$('busy').hidden, true);
  });
  await test('both unopposed demos still install their correctly sized original generated Blob', async () => {
    for (const [button, width, height] of [['demoBtn', 1500, 1900], ['portraitDemoBtn', 512, 512]]) { const h = harness(); await h.$(button).click(); assert.equal(h.state.sourceAsset.width, width); assert.equal(h.state.sourceAsset.height, height); assert.equal(h.state.sourceAsset.mime, 'image/png'); assert.equal(h.state.sourceAsset.origin, 'original'); assert.equal(h.$('busy').hidden, true); }
  });
  await test('full-resolution decode mismatch fails cleanly before encoding and permits retry', async () => {
    const h = harness(), file = h.file(); await h.load(file); h.commit({ type: 'rotate' }); h.describe(file, 3999, 1800); await h.save(); assert.equal(h.encodes.length, 0); assert.equal(h.state.exportPending, false); assert.match(h.$('toast').textContent, /方向或尺寸/); h.describe(file, 4000, 1800); await h.save(); assert.equal(h.native.length, 1);
  });
  await test('native bridge exception clears export state and preserves original for retry', async () => {
    const h = harness(), file = h.file(); await h.load(file); h.commit({ type: 'rotate' }); const saveImage = h.env.Android.saveImage; h.env.Android.saveImage = () => { throw Error('bridge unavailable'); }; await h.save(); assert.equal(h.state.exportPending, false); assert.equal(h.state.sourceBlob, file); assert.equal(h.state.ops.length, 1); assert.match(h.$('toast').textContent, /bridge unavailable/); h.env.Android.saveImage = saveImage; await h.save(); assert.equal(h.native.length, 1);
  });
  await test('draft storage failure warns without discarding original bytes or history', async () => {
    const h = harness(), file = h.file(); await h.load(file); h.commit({ type: 'rotate' }); h.settings.storageFail = true; await h.flush(350); assert.equal(h.state.sourceBlob, file); assert.equal(h.state.ops.length, 1); assert.match(h.$('toast').textContent, /草稿保存失败/);
  });
  await test('new geometry history survives draft restore and original/working export without replacing source',async()=>{const G=require('../app/src/main/assets/geometry.js'),h=harness(),file=h.file();await h.load(file);const op={type:'geometry',recipe:{...G.defaults(),crop:{x:.2,y:.1,w:.5,h:.8},quarterTurns:1,flipX:true}};assert.equal(h.commit(op),true);await h.flush(350);assert.deepEqual(await h.record.source.blob.arrayBuffer(),await file.arrayBuffer());assert.equal(h.state.sourceBlob,file);assert.equal(h.record.ops[0].type,'geometry');const saved=plain(h.state.ops);h.$('undoBtn').click();assert.equal(h.state.ops.length,0);h.$('redoBtn').click();assert.deepEqual(plain(h.state.ops),saved);h.env.__probe.setExportMode('original');await h.save();assert.deepEqual([h.encodes.at(-1).width,h.encodes.at(-1).height],[1440,2000]);h.env.onNativeExportResult(true,'saved');h.env.__probe.setExportMode('working');await h.save();assert.deepEqual([h.encodes.at(-1).width,h.encodes.at(-1).height],[922,1280]);h.env.onNativeExportResult(true,'saved');const next=harness();next.describe(h.record.source.blob,4000,1800);next.env.__incoming=h.record;vm.runInContext('__incoming.ops=JSON.parse(JSON.stringify(__incoming.ops));__incoming.redo=JSON.parse(JSON.stringify(__incoming.redo));',next.env);/* Browser IDB deserializes recipes into the receiving realm. */await next.restore(next.env.__incoming);assert.deepEqual(await next.state.sourceBlob.arrayBuffer(),await file.arrayBuffer());assert.deepEqual(plain(next.state.ops),saved);});
  console.log(`\nPROJECT WORKFLOW: ${passed.length} passed; ${failed.length} failed.`);
  console.log('LIMIT: Real shipped JS handlers with controlled DOM/Canvas/decoder/storage/native stubs; no browser pixels, EXIF decoder verification, Android runtime, signing or installation.');
  fs.writeFileSync(path.join(__dirname, '../project-workflow-test-results.json'), JSON.stringify({ passed: passed.length, failed: failed.length, checks: passed, failures: failed, date: new Date().toISOString(), limits: 'Shipped scripts with controlled test doubles. Not real browser pixels or device execution.' }, null, 2));
  if (failed.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
