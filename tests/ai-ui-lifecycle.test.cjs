'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../app/src/main/assets/ai-edit-core.js');
const code = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/ai-ui.js'), 'utf8');
const PNG = 'data:image/png;base64,AAAA';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function settle() {
  // Runs the explicit pre-compute yield and microtasks, without waiting on any
  // mocked encode/network operation. Those settle only when a test releases them.
  for (let i = 0; i < 3; i++) await new Promise(resolve => setTimeout(resolve, 0));
}

function harness({ width = 100, height = 80, capture } = {}) {
  const nodes = new Map(), encodes = [], readers = [], captures = [], prepared = [], merged = [], sends = [];
  const frames = new Map(), revoked = [];
  let frameId = 0, legacyCaptures = 0, imageDecodes = 0;
  function canvas(w = 300, h = 150) {
    const c = element('canvas'); c.width = w; c.height = h; c.draws = [];
    const ctx = { clearRect() {}, drawImage(...args) { c.draws.push(args); }, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {} };
    c.getContext = () => ctx;
    c.toDataURL = () => { throw Error('synchronous PNG encoding must not be used'); };
    c.toBlob = (callback, type) => { encodes.push({ canvas: c, callback, type }); };
    c.getBoundingClientRect = () => ({ left: 0, top: 0, width: c.width, height: c.height });
    c.setPointerCapture = () => {};
    return c;
  }
  function element(tag) {
    const listeners = new Map();
    const e = { tagName: tag.toUpperCase(), value: '', textContent: '', disabled: false, hidden: false, checked: false, open: false,
      setAttribute(name, value) { this[name] = value; },
      removeAttribute(name) { delete this[name]; },
      appendChild(child) { if (child.id) nodes.set(child.id, child); },
      addEventListener(type, fn) { listeners.set(type, fn); },
      showModal() { this.open = true; }, close() { this.open = false; },
      cancel() { listeners.get('cancel')?.({}); this.open = false; },
      decode() { return Promise.resolve(); }
    };
    Object.defineProperty(e, 'innerHTML', { set(html) {
      for (const match of html.matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
        const [, kind, attrs, id] = match, child = kind === 'canvas' ? canvas() : element(kind);
        child.id = id; child.value = attrs.match(/\bvalue="([^"]*)"/)?.[1] || '';
        child.hidden = /\bhidden\b/.test(attrs); nodes.set(id, child);
      }
      nodes.get('aiMode').value = 'erase';
    } });
    return e;
  }
  nodes.set('aiBtn', element('button'));
  const doc = { body: element('body'), getElementById: id => nodes.get(id), createElement: tag => tag === 'canvas' ? canvas() : element(tag) };
  class TestURL extends URL {
    static createObjectURL() { return 'blob:mock-ai-result'; }
    static revokeObjectURL(url) { revoked.push(url); }
  }
  class TestFileReader {
    readAsDataURL(blob) { readers.push({ reader: this, blob }); }
  }
  class TestImage {
    constructor() { this.naturalWidth = width; this.naturalHeight = height; }
    decode() { imageDecodes++; return Promise.resolve(); }
  }
  const host = {
    isBusy: () => false, revision: () => 'revision-1',
    captureCanvas() {
      const c = canvas(width, height); captures.push(c);
      return capture ? capture(c, captures.length) : c;
    },
    capture() { legacyCaptures++; return Promise.resolve(PNG); },
    open: async () => true
  };
  const root = {
    document: doc, URL: TestURL, Image: TestImage, FileReader: TestFileReader,
    File: class { constructor(parts, name, options) { Object.assign(this, { parts, name, ...options }); } },
    AbortController, setTimeout, clearTimeout,
    requestAnimationFrame(fn) { const id = ++frameId; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    MintAiEdit: {
      plan: core.plan,
      prepare(source, options, create) {
        const p = { ...core.plan(source.width, source.height, options) };
        for (const key of ['image', 'mask', 'selection']) p[key] = create(p.width, p.height);
        prepared.push(p); return p;
      },
      composite(p, image, create) { const c = create(p.width, p.height); merged.push(c); return c; },
      release: core.release
    },
    MintAiTransport: { send(data, signal) { const result = deferred(); sends.push({ data, signal, ...result }); return result.promise; } }
  };
  root.window = root;
  vm.runInNewContext(code, root, { filename: 'ai-ui.js' }); root.MintAiUI.init(host);
  const $ = id => { const found = nodes.get(id); assert.ok(found, 'missing mock element ' + id); return found; };
  return {
    $, api: root.MintAiUI, host, captures, prepared, merged, encodes, readers, sends, revoked,
    get legacyCaptures() { return legacyCaptures; }, get imageDecodes() { return imageDecodes; },
    open: () => $('aiBtn').onclick(), close: () => $('aiClose').onclick(),
    cancel: () => $('aiDialog').cancel(), send: () => $('aiSend').onclick(),
    flushFrames() { const current = [...frames.values()]; frames.clear(); for (const fn of current) fn(); },
    configure(mode = 'edit') {
      $('aiMode').value = mode; $('aiEndpoint').value = 'https://example.invalid/v1/images/edits';
      $('aiModel').value = 'mock-model'; $('aiKey').value = 'mock-only-key';
      $('aiPrompt').value = 'change the background'; $('aiConsent').checked = true;
    },
    async finishBlob(index, blob = { size: 4 }) {
      assert.ok(encodes[index], 'missing pending encode ' + index); encodes[index].callback(blob); await settle();
    },
    async finishRead(index) {
      assert.ok(readers[index], 'missing pending FileReader ' + index);
      const r = readers[index].reader; r.result = PNG; r.onload(); await settle();
    },
    async finishPng(index) { const nextReader = readers.length; await this.finishBlob(index); await this.finishRead(nextReader); }
  };
}
function released(c) { assert.deepEqual([c.width, c.height], [1, 1]); }
function releasedPrepared(p) { for (const key of ['image', 'mask', 'selection']) released(p[key]); }

test('AI opening takes ownership of captureCanvas without PNG encoding or decoding', async () => {
  const h = harness(); await h.open();
  assert.equal(h.captures.length, 1); assert.equal(h.legacyCaptures, 0);
  assert.equal(h.encodes.length, 0); assert.equal(h.imageDecodes, 0);
  assert.equal(h.$('aiCanvas').draws[0][0], h.captures[0]);
  assert.equal(h.$('aiSend').disabled, false);
  assert.equal(h.close(), true); released(h.captures[0]);
});

test('closing before the opening yield avoids capturing the photograph', async () => {
  const h = harness(), opening = h.open(); h.cancel(); await opening;
  assert.equal(h.captures.length, 0); assert.equal(h.$('aiDialog').open, false);
});

test('cancelled capture is released when it arrives, without changing the next opening', async () => {
  const old = deferred();
  const h = harness({ capture: (c, count) => count === 1 ? old.promise : c });
  const opening = h.open(); await settle(); assert.equal(h.captures.length, 1);
  h.cancel(); await h.open();
  h.$('aiKey').value = 'new-key'; h.$('aiConsent').checked = true;
  const status = h.$('aiStatus').textContent;
  old.resolve(h.captures[0]); await opening;
  released(h.captures[0]); assert.deepEqual([h.captures[1].width, h.captures[1].height], [100, 80]);
  assert.equal(h.$('aiStatus').textContent, status); assert.equal(h.$('aiKey').value, 'new-key');
  assert.equal(h.$('aiConsent').checked, true); assert.equal(h.$('aiSend').disabled, false); h.close();
});

test('normal request waits for asynchronous PNG then shows a result and releases request buffers', async () => {
  const h = harness(); await h.open(); h.configure(); const sending = h.send(); await settle();
  assert.equal(h.api.isBusy(), true); assert.equal(h.$('aiSettings').disabled, true);
  assert.equal(h.$('aiKey').value, ''); assert.equal(h.sends.length, 0); assert.equal(h.encodes.length, 1);
  await h.finishBlob(0); assert.equal(h.sends.length, 0);
  await h.finishRead(0); assert.equal(h.sends.length, 1);
  assert.equal(h.sends[0].data.image, PNG); assert.equal(h.sends[0].data.key, 'mock-only-key');
  assert.equal(h.sends[0].signal.aborted, false);
  h.sends[0].resolve({ image: PNG }); await settle(); assert.equal(h.merged.length, 1);
  await h.finishBlob(1); await sending;
  assert.equal(h.$('aiResultSection').hidden, false); assert.equal(h.$('aiAccept').hidden, false);
  assert.equal(h.api.isBusy(), false); assert.equal(h.$('aiSettings').disabled, false);
  assert.equal(h.$('aiConsent').checked, false); releasedPrepared(h.prepared[0]); released(h.merged[0]);
  assert.deepEqual([h.captures[0].width, h.captures[0].height], [100, 80]);
  h.close(); assert.deepEqual(h.revoked, ['blob:mock-ai-result']);
});

test('cancelling during the request yield avoids allocation and immediately unlocks reopening', async () => {
  const h = harness(); await h.open(); h.configure(); const sending = h.send(); h.cancel();
  assert.equal(h.api.isBusy(), false); assert.equal(h.$('aiSettings').disabled, false);
  await h.open(); await sending;
  assert.equal(h.prepared.length, 0); assert.equal(h.sends.length, 0);
  assert.equal(h.$('aiDialog').open, true); assert.equal(h.$('aiSend').disabled, false); h.close();
});

test('late image PNG after closing cannot upload or clear inputs in a new opening', async () => {
  const h = harness(); await h.open(); h.configure(); const sending = h.send(); await settle();
  h.close(); assert.equal(h.api.isBusy(), false); await h.open();
  h.$('aiKey').value = 'new-key'; h.$('aiConsent').checked = true;
  const status = h.$('aiStatus').textContent;
  await h.finishPng(0); await sending;
  assert.equal(h.sends.length, 0); releasedPrepared(h.prepared[0]);
  assert.equal(h.$('aiKey').value, 'new-key'); assert.equal(h.$('aiConsent').checked, true);
  assert.equal(h.$('aiStatus').textContent, status); assert.equal(h.$('aiSettings').disabled, false);
  assert.equal(h.$('aiSend').disabled, false); h.close();
});

test('late FileReader after cancel cannot upload', async () => {
  const h = harness(); await h.open(); h.configure(); const sending = h.send(); await settle();
  await h.finishBlob(0); assert.equal(h.readers.length, 1); h.cancel();
  await h.finishRead(0); await sending;
  assert.equal(h.sends.length, 0); releasedPrepared(h.prepared[0]); assert.equal(h.api.isBusy(), false);
});

test('late mask PNG after cancel cannot upload the already encoded photograph', async () => {
  const h = harness(); await h.open(); h.configure('outpaint'); const sending = h.send(); await settle();
  await h.finishPng(0); assert.equal(h.encodes.length, 2); assert.equal(h.sends.length, 0);
  h.cancel(); await h.finishPng(1); await sending;
  assert.equal(h.sends.length, 0); releasedPrepared(h.prepared[0]);
});

test('old request completion cannot unlock or revoke consent for a newer pending request', async () => {
  const h = harness(); await h.open(); h.configure(); const old = h.send(); await settle();
  h.close(); await h.open(); h.configure(); const current = h.send(); await settle();
  assert.equal(h.prepared.length, 2); assert.equal(h.encodes.length, 2);
  await h.finishPng(0); await old;
  assert.equal(h.api.isBusy(), true); assert.equal(h.$('aiSettings').disabled, true);
  assert.equal(h.$('aiSend').disabled, true); assert.equal(h.$('aiConsent').checked, true);
  assert.equal(h.sends.length, 0); releasedPrepared(h.prepared[0]);
  assert.deepEqual([h.prepared[1].image.width, h.prepared[1].image.height], [100, 80]);
  h.close(); await h.finishPng(1); await current; releasedPrepared(h.prepared[1]);
});

test('cancel aborts a dispatched request and a late response cannot create a result', async () => {
  const h = harness(); await h.open(); h.configure(); const sending = h.send(); await settle();
  await h.finishPng(0); assert.equal(h.sends.length, 1); h.close();
  assert.equal(h.sends[0].signal.aborted, true);
  h.sends[0].resolve({ image: PNG }); await sending;
  assert.equal(h.merged.length, 0); assert.equal(h.$('aiResultSection').hidden, true);
  releasedPrepared(h.prepared[0]);
});

test('PNG encode failure does not send and releases the three prepared buffers', async () => {
  const h = harness(); await h.open(); h.configure(); const sending = h.send(); await settle();
  await h.finishBlob(0, null); await sending;
  assert.equal(h.sends.length, 0); assert.match(h.$('aiStatus').textContent, /编码失败/);
  assert.equal(h.api.isBusy(), false); assert.equal(h.$('aiSend').disabled, false);
  releasedPrepared(h.prepared[0]); h.close();
});

test('oversized expansion disables sending and returning inside the budget re-enables it', async () => {
  const h = harness({ width: 2560, height: 2560 }); await h.open();
  h.$('aiMode').value = 'outpaint'; h.$('aiMode').onchange(); h.flushFrames();
  assert.equal(h.$('aiSend').disabled, true); assert.match(h.$('aiStatus').textContent, /尺寸|像素|800|4096/);
  for (const side of ['left', 'right', 'top', 'bottom']) h.$('aiPad-' + side).value = side === 'left' ? '10' : '0';
  h.$('aiPad-left').oninput(); h.flushFrames();
  assert.equal(h.$('aiSend').disabled, false); assert.match(h.$('aiStatus').textContent, /2816 × 2560/);
  assert.equal(h.$('aiConsent').checked, false); h.close();
});
