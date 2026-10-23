'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const modulePath = path.resolve(__dirname, '../app/src/main/assets/project-library-ui.js');
const UI = require(modulePath);
const IDS = ['projectLibraryBtn', 'projectLibraryDialog', 'projectLibraryStatus', 'projectLibraryName',
  'projectLibrarySave', 'projectLibrarySaveCopy', 'projectLibraryNew', 'projectLibraryRefresh',
  'projectLibraryClose', 'projectLibraryList', 'projectLibraryTrashList'];
class Node {
  constructor(tag, id = '') { this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.parentNode = null; this.attributes = {}; this.listeners = new Map(); this.disabled = false; this.open = false; this.value = ''; this._text = ''; this.modalCalls = 0; }
  set innerHTML(_) { throw Error('Project library must never interpolate HTML'); }
  get firstChild() { return this.children[0] || null; }
  set textContent(value) { this._text = String(value); for (const child of this.children) child.parentNode = null; this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  appendChild(node) { if (node.parentNode) node.parentNode.removeChild(node); node.parentNode = this; this.children.push(node); return node; }
  removeChild(node) { const i = this.children.indexOf(node); assert.notEqual(i, -1); this.children.splice(i, 1); node.parentNode = null; return node; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(handler); }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  handlers(type) { return [...(this.listeners.get(type) || [])]; }
  emit(type, extra = {}) { const event = { type, target: this, currentTarget: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra }; for (const handler of this.handlers(type)) handler(event); return event; }
  click() { if (!this.disabled) this.emit('click'); }
  showModal() { assert(!this.open); this.open = true; this.modalCalls++; }
  close() { this.open = false; this.emit('close'); }
}
const id = n => 'project-' + n.toString(16).padStart(32, '0');
const entry = (n, changes = {}) => ({ id: id(n), name: '照片 ' + n, revision: 1, updatedAt: 1770000000000, bytes: 500000, ...changes });
const state = (changes = {}) => ({ loaded: true, currentId: null, currentName: '正在编辑的照片', dirty: true, previewDirty: false, busy: false, ...changes });
const listing = (entries = [entry(1)], trash = []) => ({ entries, trash, usage: { count: entries.length + trash.length, maxCount: 24, bytes: [...entries, ...trash].reduce((n, e) => n + e.bytes, 0), maxBytes: 201326592 }, storageEstimate: { usage: 9, quota: 12 } });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function walk(node) { return node.children.flatMap(child => [child, ...walk(child)]); }
function harness(options = {}) {
  const nodes = new Map(), created = [], calls = [], readCalls = [];
  for (const name of IDS) if (options.omit !== name) nodes.set(name, new Node(name === 'projectLibraryDialog' ? 'dialog' : name.includes('List') ? 'ul' : name === 'projectLibraryName' ? 'input' : name === 'projectLibraryStatus' ? 'p' : 'button', name));
  const document = { getElementById: name => nodes.get(name) || null, createElement(tag) { const n = new Node(tag); created.push(n); return n; } };
  let s = options.state === undefined ? state() : options.state, data = options.data || listing(), h;
  const host = { document, getState() { if (options.throwState) throw Error('private secret'); return s; }, refresh() { readCalls.push(1); return options.read ? options.read(h) : data; } };
  for (const name of ['onSave', 'onOpen', 'onNew', 'onCopy', 'onTrash', 'onRestore', 'onPurge', 'onEmptyTrash']) host[name] = (...args) => { calls.push([name, ...args]); return options[name] ? options[name](...args, h) : true; };
  host.onClose = () => options.onClose?.(h);
  for (const name of options.missingCallbacks || []) delete host[name];
  const api = UI.create(host);
  h = { api, host, nodes, created, calls, readCalls, document, node: name => nodes.get(name), status: () => nodes.get('projectLibraryStatus')?.textContent,
    setState(next) { s = next; }, get state() { return s; }, setData(next) { data = next; },
    cards(trash = false) { return nodes.get(trash ? 'projectLibraryTrashList' : 'projectLibraryList').children.filter(node => node.className === 'project-library-card'); },
    button(label, i = 0, trash = false) { return walk(h.cards(trash)[i]).find(node => node.tagName === 'BUTTON' && node.textContent === label); },
    input(i = 0) { return walk(h.cards()[i]).find(node => node.tagName === 'INPUT'); },
    async open() { assert.equal(await api.open(), true); return h; } };
  return h;
}

test('UMD has no dependencies and exposes the agreed five methods', () => {
  const sandbox = {}; vm.runInNewContext(fs.readFileSync(modulePath, 'utf8'), sandbox);
  assert.equal(typeof sandbox.MintProjectLibraryUI.create, 'function');
  assert.deepEqual(Object.keys(UI.create({})), ['open', 'close', 'refresh', 'sync', 'release']);
});
test('required nodes fail closed rather than leaving partial actions enabled', async () => {
  for (const omit of IDS) { const h = harness({ omit }); assert.equal(await h.api.open(), false); assert.equal(await h.api.refresh(), false); assert.equal(h.api.sync(), false); assert.doesNotThrow(() => h.api.release()); for (const name of ['projectLibrarySave', 'projectLibrarySaveCopy', 'projectLibraryBtn']) if (h.node(name)) assert(h.node(name).disabled); }
});
test('unloaded editor can browse, open and restore projects but cannot save a nonexistent photo', async () => {
  const h = await harness({ state: state({ loaded: false, currentName: '', dirty: false }), data: listing([entry(1)], [entry(2)]) }).open();
  assert(h.node('projectLibrarySave').disabled); assert(h.node('projectLibrarySaveCopy').disabled); assert(h.node('projectLibraryName').disabled);
  assert(!h.button('打开项目').disabled); assert(!h.button('恢复项目', 0, true).disabled); assert(!h.node('projectLibraryNew').disabled);
  assert.match(h.status(), /尚未选择照片/); assert.match(h.status(), /保存项目不等于导出图片/); assert.match(h.status(), /清除应用数据会丢失全部项目/);
  assert.match(h.status(), /独立副本占用容量/); assert.match(h.status(), /不会自动清理/); assert.match(h.status(), /2 \/ 24 项（含回收站）/);
});
test('saved, dirty and uncommitted preview status are separate from image export', async () => {
  const h = await harness({ state: state({ currentId: id(1), currentName: '日落', dirty: false }) }).open();
  assert.match(h.status(), /当前项目「日落」：已保存到本机/); assert(h.cards()[0].textContent.includes('当前项目'));
  h.setState(state({ currentId: id(1), currentName: '日落', dirty: true, previewDirty: true })); h.api.sync();
  assert.match(h.status(), /有未保存修改/); assert.match(h.status(), /有未应用预览：不会写入项目，请先应用再保存/);
  assert.equal(h.node('projectLibrarySave').disabled, false, 'host may confirm saving only committed edits');
});
test('save, save independent current copy, and duplicate stored snapshot dispatch distinct contracts', async () => {
  const h = await harness().open();
  h.node('projectLibraryName').value = ' 新项目 '; h.node('projectLibraryName').emit('input');
  h.node('projectLibrarySave').click(); await tick();
  h.node('projectLibrarySaveCopy').click(); await tick();
  h.input().value = ' 旧版本副本 '; h.input().emit('input'); h.button('复制已存版本').click(); await tick();
  assert.deepEqual(h.calls, [['onSave', '新项目', { asCopy: false }], ['onSave', '新项目', { asCopy: true }], ['onCopy', id(1), '旧版本副本']]);
  assert.match(h.cards()[0].textContent, /不包含当前未保存修改或预览/);
});
test('saved entries are text nodes, including HTML-looking names and prototype keys', async () => {
  const name = '<img src=x onerror=alert(1)>', source = listing([entry(1, { name }), entry(2, { name: '__proto__' })]);
  const before = JSON.stringify(source); source.entries.forEach(Object.freeze); Object.freeze(source.entries); Object.freeze(source.usage); Object.freeze(source);
  const h = await harness({ data: source, state: state({ currentName: name, currentId: id(1) }) }).open();
  assert(h.cards()[0].textContent.includes(name)); assert(h.status().includes(name)); assert.equal(h.input().value, name + ' 副本');
  assert(h.created.every(n => ['LI', 'STRONG', 'SPAN', 'P', 'DIV', 'BUTTON', 'LABEL', 'INPUT'].includes(n.tagName)));
  assert.equal(JSON.stringify(source), before); assert.equal(h.button('打开项目').getAttribute('aria-label'), '打开项目：' + name);
});
test('80-codepoint names retain complete surrogate pairs and normalize before dispatch', async () => {
  const h = await harness({ data: listing([entry(1, { name: '😀'.repeat(80) })]) }).open();
  assert.equal(Array.from(h.input().value).length, 80); assert(h.input().value.endsWith(' 副本'));
  h.node('projectLibraryName').value = '  cafe\u0301  '; h.node('projectLibraryName').emit('input'); h.node('projectLibrarySave').click(); await tick();
  assert.equal(h.calls[0][1], 'café'); assert.equal(h.node('projectLibraryName').maxLength, 160);
});
test('invalid empty, oversized and control-character names cannot invoke host', async () => {
  const h = await harness().open();
  for (const name of ['', '   ', '😀'.repeat(81), 'a\nname', 'a\u202ename']) {
    h.node('projectLibraryName').value = name; h.node('projectLibraryName').emit('input'); h.node('projectLibrarySave').emit('click'); h.node('projectLibrarySaveCopy').emit('click');
    assert(h.node('projectLibrarySave').disabled); assert.equal(h.node('projectLibraryName').getAttribute('aria-invalid'), 'true');
    h.input().value = name; h.input().emit('input'); h.button('复制已存版本').emit('click'); assert(h.button('复制已存版本').disabled);
  }
  assert.deepEqual(h.calls, []);
});
test('line separators and lone surrogates block current saves and stored-copy dispatch', async () => {
  const h = await harness().open();
  for (const name of ['a\u2028b', 'a\u2029b', '\ud800', '\udfff', 'a\ud800b', 'a\udfffb', '\udc00\ud800']) {
    h.node('projectLibraryName').value = name; h.node('projectLibraryName').emit('input');
    h.node('projectLibrarySave').emit('click'); h.node('projectLibrarySaveCopy').emit('click');
    h.input().value = name; h.input().emit('input'); h.button('复制已存版本').emit('click');
    assert(h.node('projectLibrarySave').disabled); assert(h.node('projectLibrarySaveCopy').disabled); assert(h.button('复制已存版本').disabled);
    assert.equal(h.node('projectLibraryName').getAttribute('aria-invalid'), 'true'); assert.equal(h.input().getAttribute('aria-invalid'), 'true');
  }
  assert.deepEqual(h.calls, []);
});
test('UI name normalization matches storage across UTF-8, NFC, trim and raw input boundaries', async () => {
  const { normalizeName } = require('../app/src/main/assets/project-library.js');
  const values = ['😀'.repeat(80), '😀'.repeat(81), '界'.repeat(80), 'é'.repeat(80), 'e\u0301'.repeat(80), ' \u2028照片\u2029 ',
    ' '.repeat(1023) + 'a', ' '.repeat(1024) + 'a', 'a\u0000b', 'a\u0085b', 'a\u061cb', 'a\u200eb', 'a\u202ab', 'a\u2066b'];
  const h = await harness().open();
  for (const value of values) {
    let expected = null; try { expected = normalizeName(value); } catch (error) { assert.equal(error.code, 'INVALID_NAME'); }
    h.node('projectLibraryName').value = value; h.node('projectLibraryName').emit('input');
    assert.equal(h.node('projectLibrarySave').disabled, expected === null, JSON.stringify(value));
    const before = h.calls.length; h.node('projectLibrarySave').emit('click'); await tick();
    if (expected === null) assert.equal(h.calls.length, before);
    else { assert.equal(h.calls.length, before + 1); assert.equal(h.calls.at(-1)[1], expected); assert(Buffer.byteLength(expected, 'utf8') <= 320); }
  }
});
test('repeated open and sync keep exactly one binding and preserve user-typed names', async () => {
  const h = await harness().open(); h.node('projectLibraryName').value = '未提交名称'; h.input().value = '独立名称';
  for (let i = 0; i < 30; i++) { await h.api.open(); h.api.sync(); }
  assert.equal(h.readCalls.length, 1); assert.equal(h.node('projectLibraryDialog').modalCalls, 1);
  assert.equal(h.node('projectLibraryBtn').handlers('click').length, 1); assert.equal(h.button('打开项目').handlers('click').length, 1);
  assert.equal(h.node('projectLibraryName').value, '未提交名称'); assert.equal(h.input().value, '独立名称');
  h.button('打开项目').click(); await tick(); assert.deepEqual(h.calls, [['onOpen', id(1)]]);
});
test('host busy changes are checked again at click time, including queued synthetic clicks', async () => {
  const h = await harness({ data: listing([entry(1)], [entry(2)]) }).open(); const old = h.button('打开项目').handlers('click')[0];
  h.setState(state({ busy: true })); old();
  for (const name of ['projectLibrarySave', 'projectLibrarySaveCopy', 'projectLibraryNew', 'projectLibraryRefresh']) { h.node(name).emit('click'); assert(h.node(name).disabled); }
  assert(h.button('恢复项目', 0, true).disabled); assert(h.input().disabled); assert(!h.node('projectLibraryClose').disabled);
  assert.deepEqual(h.calls, []); assert.equal(h.readCalls.length, 1);
  h.node('projectLibraryClose').click(); assert(!h.node('projectLibraryDialog').open);
});
test('every mutation stays disabled throughout a pending host confirmation or write', async () => {
  const pending = deferred(), h = await harness({ onSave: () => pending.promise, data: listing([entry(1)], [entry(2)]) }).open();
  h.node('projectLibrarySave').click();
  for (let i = 0; i < 10; i++) { h.node('projectLibrarySave').emit('click'); h.button('打开项目').emit('click'); h.button('复制已存版本').emit('click'); h.node('projectLibraryNew').emit('click'); }
  assert.equal(h.calls.length, 1); assert(h.node('projectLibraryName').disabled); assert(h.node('projectLibraryRefresh').disabled);
  assert(h.button('恢复项目', 0, true).disabled); assert.match(h.status(), /关闭面板不会取消已开始的存储操作/);
  pending.resolve(false); await tick(); assert.match(h.status(), /已取消/); assert(!h.node('projectLibrarySave').disabled); assert.equal(h.readCalls.length, 1);
});
test('false and explicit cancelled results do not claim success or read again', async () => {
  for (const result of [false, { cancelled: true }]) {
    const h = await harness({ onTrash: () => result }).open(); h.button('移入回收站').click(); await tick();
    assert.match(h.status(), /已取消本次操作/); assert(!h.status().includes('项目已移入')); assert.equal(h.readCalls.length, 1); assert.equal(h.cards().length, 1);
  }
});
test('pending refresh cannot dispatch actions and repeated refresh coalesces', async () => {
  const pending = deferred(), h = harness({ read: () => pending.promise }), opened = h.api.open();
  const extra = h.api.refresh(); h.node('projectLibraryRefresh').emit('click'); h.node('projectLibrarySave').emit('click'); h.node('projectLibraryNew').emit('click');
  assert.equal(h.readCalls.length, 1); assert(h.node('projectLibrarySave').disabled); assert.match(h.status(), /正在读取/); assert.deepEqual(h.calls, []);
  pending.resolve(listing()); assert.equal(await extra, true); assert.equal(await opened, true); assert(!h.node('projectLibrarySave').disabled);
});
test('close and reopen discard an older late refresh even when it finishes last', async () => {
  const first = deferred(), second = deferred(), h = harness({ read: h => h.readCalls.length === 1 ? first.promise : second.promise });
  const oldOpen = h.api.open(); h.api.close(); const nextOpen = h.api.open(); second.resolve(listing([entry(2, { name: '新的列表' })])); await nextOpen;
  first.resolve(listing([entry(1, { name: '过期列表' })])); assert.equal(await oldOpen, false);
  assert.match(h.node('projectLibraryList').textContent, /新的列表/); assert(!h.node('projectLibraryList').textContent.includes('过期列表'));
});
test('a closed pending operation never writes success into a newer dialog opening', async () => {
  const pending = deferred(), h = await harness({ onSave: () => pending.promise }).open();
  h.node('projectLibrarySave').click(); h.api.close(); await h.api.open(); assert(h.node('projectLibrarySave').disabled);
  h.setData(listing([entry(2, { name: '实际存储结果' })])); pending.resolve(true); await tick();
  assert.match(h.node('projectLibraryList').textContent, /实际存储结果/); assert(!h.status().includes('项目已保存到本机。'));
  assert(!h.node('projectLibrarySave').disabled); assert.equal(h.calls.length, 1);
});
test('onOpen host may close synchronously and old completion cannot reopen the dialog', async () => {
  const h = await harness({ onOpen: (target, h) => { h.api.close(); return true; } }).open(); h.button('打开项目').click(); await tick();
  assert(!h.node('projectLibraryDialog').open); assert.equal(h.node('projectLibraryBtn').getAttribute('aria-expanded'), 'false');
  assert(!h.status().includes('已打开所选项目')); assert.equal(h.readCalls.length, 1);
});
test('refresh errors preserve prior cards, visibly mark stale and require reread before mutation', async () => {
  let fail = false; const h = await harness({ read: () => { if (fail) throw Object.assign(Error('private file secret'), { code: 'STORAGE_BLOCKED' }); return listing([entry(1, { name: '保留的照片' })]); } }).open();
  fail = true; assert.equal(await h.api.refresh(), false); assert.match(h.node('projectLibraryList').textContent, /保留的照片/);
  assert.match(h.status(), /保留上次列表（可能已过期）/); assert.match(h.status(), /其他页面占用/); assert(!h.status().includes('private'));
  assert(h.button('打开项目').disabled); assert(h.button('移入回收站').disabled); assert(h.node('projectLibrarySave').disabled);
  assert(!h.node('projectLibraryRefresh').disabled); fail = false; assert.equal(await h.api.refresh(), true); assert(!h.button('打开项目').disabled); assert(!h.status().includes('读取失败'));
});
test('first read error never represents an unavailable database as an empty library', async () => {
  const h = await harness({ read: () => Promise.reject(Object.assign(Error('secret'), { code: 'STORAGE_UNAVAILABLE' })) }).open();
  assert.match(h.status(), /尚未获得可信列表/); assert.match(h.node('projectLibraryList').textContent, /尚未读取/);
  assert(!h.node('projectLibraryList').textContent.includes('还没有本机项目')); assert(h.node('projectLibrarySave').disabled);
});
test('malformed and duplicate metadata fail closed without erasing the last known list', async () => {
  const h = await harness().open();
  for (const invalid of [null, {}, listing([entry(1), entry(1)]), listing([entry(1, { revision: 0 })]), listing([entry(1, { bytes: -1 })]), listing([entry(1, { id: 'wrong-id' })]), listing([entry(1, { updatedAt: NaN })]), listing([entry(1, { name: '' })]), { ...listing(), usage: { ...listing().usage, count: 0 } }]) {
    h.host.refresh = () => invalid; assert.equal(await h.api.refresh(), false); assert.equal(h.cards().length, 1); assert.match(h.status(), /保留上次列表/); assert(h.button('打开项目').disabled);
  }
});
test('rejected and synchronously throwing mutations do not claim completion or expose exception text', async () => {
  for (const action of [() => { throw Error('/private/secret/file'); }, () => Promise.reject(Object.assign(Error('token'), { code: 'REVISION_CONFLICT' }))]) {
    const h = await harness({ onSave: action }).open(); h.node('projectLibrarySave').click(); await tick();
    assert(!h.status().includes('/private')); assert(!h.status().includes('token')); assert(!h.status().includes('项目已保存到本机。'));
    assert.match(h.status(), /请重读本机/); assert(h.node('projectLibrarySave').disabled); assert(!h.node('projectLibraryRefresh').disabled); assert.equal(h.cards().length, 1);
    await h.api.refresh(); assert(!h.node('projectLibrarySave').disabled);
  }
});
test('completed save plus failed reread reports both facts without dropping prior cards', async () => {
  const h = await harness().open(); h.host.refresh = () => Promise.reject({ code: 'STORAGE_UNAVAILABLE' }); h.node('projectLibrarySave').click(); await tick();
  assert.match(h.status(), /项目已保存到本机/); assert.match(h.status(), /读取失败/); assert.equal(h.cards().length, 1); assert(h.node('projectLibrarySave').disabled);
});
test('all storage error codes map to user explanations without raw private content', async () => {
  for (const code of ['INVALID_NAME','INVALID_ID','INVALID_REVISION','INVALID_RECORD','RECORD_TOO_LARGE','COLLECTION_FULL','COLLECTION_TOO_LARGE','NOT_FOUND','REVISION_CONFLICT','TRASHED','NOT_TRASHED','ID_COLLISION','CORRUPT_STORAGE','STORAGE_UNAVAILABLE','STORAGE_BLOCKED','STORAGE_ABORTED','STORAGE_QUOTA','USE_ARCHIVE','constructor','unknown']) {
    const h = await harness({ onSave: () => Promise.reject({ code, message: 'private-secret' }) }).open(); h.node('projectLibrarySave').click(); await tick(); assert(!h.status().includes('private-secret')); assert.match(h.status(), /重读本机/); assert(h.node('projectLibrarySave').disabled);
  }
});
test('full library includes trash; updates and restores remain possible but copies/new records do not', async () => {
  const entries = Array.from({ length: 23 }, (_, i) => entry(i + 1));
  const h = await harness({ state: state({ currentId: id(1) }), data: listing(entries, [entry(24)]) }).open();
  assert(!h.node('projectLibrarySave').disabled); assert(h.node('projectLibrarySaveCopy').disabled); assert(h.button('复制已存版本').disabled);
  assert(!h.button('恢复项目', 0, true).disabled); assert(!h.button('移入回收站').disabled); assert(!h.node('projectLibraryNew').disabled);
  assert.match(h.status(), /24 \/ 24 项（含回收站）/); h.setState(state()); h.api.sync(); assert(h.node('projectLibrarySave').disabled);
  assert(walk(h.node('projectLibraryTrashList')).filter(n => n.tagName === 'BUTTON').every(n => ['恢复项目','永久删除','清空回收站'].includes(n.textContent)));
});
test('a rebuilt, detached or closed row and retained old callbacks cannot mutate anything', async () => {
  for (const change of ['refresh', 'detach', 'close', 'replace']) {
    const h = await harness().open(), button = h.button('打开项目'), handler = button.handlers('click')[0];
    if (change === 'refresh') await h.api.refresh();
    if (change === 'detach') h.node('projectLibraryList').removeChild(h.cards()[0]);
    if (change === 'close') h.api.close();
    if (change === 'replace') h.nodes.set('projectLibraryDialog', new Node('dialog', 'projectLibraryDialog'));
    handler(); button.emit('click'); assert.deepEqual(h.calls, []);
  }
});
test('native cancel and close invalidate immediately, notify once, and permit reopening', async () => {
  for (const native of ['cancel', 'close']) {
    let notifications = 0; const h = await harness({ onClose: () => notifications++ }).open(), handler = h.button('打开项目').handlers('click')[0];
    if (native === 'cancel') assert(h.node('projectLibraryDialog').emit('cancel').defaultPrevented); else h.node('projectLibraryDialog').close();
    handler(); assert.deepEqual(h.calls, []); assert.equal(notifications, 1); assert(!h.node('projectLibraryDialog').open);
    await h.api.open(); h.node('projectLibraryDialog').emit('close'); assert(h.node('projectLibraryDialog').open, 'queued native close from old opening cannot close newer view');
    assert.equal(notifications, 1); assert.equal(h.node('projectLibraryBtn').handlers('click').length, 1);
  }
});
test('release preserves unrelated listeners and makes retained handlers and late reads inert', async () => {
  const h = await harness().open(), pending = deferred(), old = h.button('打开项目').handlers('click')[0]; let foreign = 0;
  h.node('projectLibraryBtn').addEventListener('click', () => foreign++); h.host.refresh = () => pending.promise; const reading = h.api.refresh();
  h.api.release(); h.api.release(); old(); pending.resolve(listing([entry(2)])); assert.equal(await reading, false);
  assert.deepEqual(h.calls, []); assert.equal(await h.api.open(), false); assert.equal(await h.api.refresh(), false); assert.equal(h.api.sync(), false); assert.equal(h.api.close(), false);
  assert.equal(h.node('projectLibraryBtn').handlers('click').length, 1); h.node('projectLibraryBtn').emit('click'); assert.equal(foreign, 1);
  assert(!h.node('projectLibraryDialog').open); assert(h.node('projectLibrarySave').disabled); assert(!h.node('projectLibraryList').textContent.includes('照片 2'));
});
test('missing callbacks and unavailable state disable only safe routes without crashing', async () => {
  const h = await harness({ missingCallbacks: ['onSave', 'onOpen', 'onCopy', 'onTrash', 'onRestore', 'onNew'], data: listing([entry(1)], [entry(2)]) }).open();
  for (const name of ['projectLibrarySave', 'projectLibrarySaveCopy', 'projectLibraryNew']) assert(h.node(name).disabled);
  assert(walk(h.node('projectLibraryList')).filter(n => n.tagName === 'BUTTON').every(n => n.disabled)); assert(h.button('恢复项目', 0, true).disabled);
  for (const bad of [null, state({ busy: 1 }), state({ dirty: undefined }), state({ currentId: {} }), state({ currentName: null })]) { const h = harness({ state: bad }); assert.equal(await h.api.open(), false); assert(h.node('projectLibraryBtn').disabled); }
  const broken = harness({ throwState: true }); assert.equal(await broken.api.open(), false); assert(!broken.status().includes('private'));
});
test('missing showModal gives a truthful failure and no database or editor action', async () => {
  const h = harness(); h.node('projectLibraryDialog').showModal = null; assert.equal(await h.api.open(), false); assert.match(h.status(), /无法打开/); assert.equal(h.readCalls.length, 0); assert.deepEqual(h.calls, []);
});
test('save success reflects authoritative new identity without discarding unrelated typed text on sync', async () => {
  const h = await harness({ onSave: (name, options, h) => { h.setState(state({ currentId: id(1), currentName: name, dirty: false })); return true; } }).open();
  h.node('projectLibraryName').value = '保存后的新名称'; h.node('projectLibrarySave').click(); await tick();
  assert.match(h.status(), /当前项目「保存后的新名称」：已保存到本机/); assert.equal(h.node('projectLibraryName').value, '保存后的新名称');
  h.node('projectLibraryName').value = '还没保存的名称'; h.api.sync(); assert.equal(h.node('projectLibraryName').value, '还没保存的名称');
});
test('trash and restore await host completion, use stable IDs and refresh the correct recoverable list', async () => {
  const h = await harness({ onTrash: (target, h) => { h.setData(listing([], [entry(1)])); return true; }, onRestore: (target, h) => { h.setData(listing([entry(1)])); return true; } }).open();
  h.button('移入回收站').click(); await tick(); assert.equal(h.cards().length, 0); assert.equal(h.cards(true).length, 1); assert.match(h.status(), /已移入回收站，仍可恢复/);
  h.button('恢复项目', 0, true).click(); await tick(); assert.equal(h.cards().length, 1); assert.equal(h.cards(true).length, 0); assert.match(h.status(), /项目已恢复/);
  assert.deepEqual(h.calls, [['onTrash', id(1)], ['onRestore', id(1)]]);
});
test('new-photo route delegates safeguards and never claims a file was imported', async () => {
  const h = await harness({ state: state({ previewDirty: true }), onNew: () => true }).open();
  h.node('projectLibraryNew').click(); await tick(); assert.deepEqual(h.calls, [['onNew']]); assert.match(h.status(), /已请求选择新照片/); assert(!h.status().includes('导入成功'));
});
test('close notifications may fail asynchronously without reviving the dialog or leaking rejection', async () => {
  const h = await harness({ onClose: () => Promise.reject(Error('private close detail')) }).open();
  assert.equal(h.api.close(), true); await tick(); assert(!h.node('projectLibraryDialog').open); assert(!h.status().includes('private close detail'));
});
test('size and archive errors never promise unsupported portable editable project exports', async () => {
  for (const code of ['RECORD_TOO_LARGE', 'USE_ARCHIVE']) {
    const h = await harness({ onSave: () => Promise.reject({ code }) }).open(); h.node('projectLibrarySave').click(); await tick();
    assert.match(h.status(), /当前编辑保留/); assert.match(h.status(), /导出图片不会保留编辑历史/);
    assert(!h.status().includes('导出项目文件')); assert(!h.status().includes('项目文件备份'));
  }
});

test('trash exposes permanent delete and clear actions, including when capacity is full',async()=>{
 const h=await harness({data:listing([],Array.from({length:24},(_,i)=>entry(i+1)))}).open();
 assert(!h.button('永久删除',0,true).disabled);h.button('永久删除',0,true).click();await tick();assert.deepEqual(h.calls[0],['onPurge',id(1)]);
 const clear=walk(h.node('projectLibraryTrashList')).find(n=>n.tagName==='BUTTON'&&n.textContent==='清空回收站');assert(!clear.disabled);clear.click();await tick();assert.deepEqual(h.calls[1],['onEmptyTrash']);
});

test('destructive actions are disabled for active trash, missing callbacks and busy storage',async()=>{
 const active=await harness({data:listing([],[entry(1)]),state:state({currentId:id(1)})}).open();assert(active.button('永久删除',0,true).disabled);assert(walk(active.node('projectLibraryTrashList')).find(n=>n.tagName==='BUTTON'&&n.textContent==='清空回收站').disabled);
 const missing=await harness({data:listing([],[entry(1)]),missingCallbacks:['onPurge','onEmptyTrash']}).open();assert(missing.button('永久删除',0,true).disabled);
 const h=await harness({data:listing([],[entry(1)])}).open();h.setState(state({busy:true}));h.api.sync();assert(h.button('永久删除',0,true).disabled);
});

test('detached delete buttons cannot invoke storage after list refresh or close',async()=>{
 const h=await harness({data:listing([],[entry(1)])}).open(),old=h.button('永久删除',0,true),handlers=old.handlers('click');
 await h.api.refresh();for(const action of handlers)action({});assert.equal(h.calls.length,0);const clear=walk(h.node('projectLibraryTrashList')).find(n=>n.tagName==='BUTTON'&&n.textContent==='清空回收站'),oldClear=clear.handlers('click');h.api.close();for(const action of oldClear)action({});assert.equal(h.calls.length,0);
});
