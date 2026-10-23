'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const production = path.resolve(__dirname, '../app/src/main/assets/history-ui.js');
const modulePath = process.env.MINT_HISTORY_UI_PATH || (fs.existsSync(production) ? production : path.join(__dirname, 'history-ui.js'));
const UI = require(modulePath);
const ids = ['historyBtn', 'historyDialog', 'historyStatus', 'historySteps', 'historyOriginal', 'historyLatest'];
class Node {
  constructor(tag, id = '') {
    this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.parentNode = null;
    this.attributes = {}; this.listeners = new Map(); this.disabled = false; this.open = false;
    this.className = ''; this._text = ''; this.modalCalls = 0; this.closeCalls = 0;
  }
  set innerHTML(_) { throw Error('History must not use innerHTML'); }
  get firstChild() { return this.children[0] || null; }
  set textContent(value) { this._text = String(value); for (const c of this.children) c.parentNode = null; this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  appendChild(node) { if (node.parentNode) node.parentNode.removeChild(node); this.children.push(node); node.parentNode = this; return node; }
  removeChild(node) { const index = this.children.indexOf(node); assert.notEqual(index, -1); this.children.splice(index, 1); node.parentNode = null; return node; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] === undefined ? null : this.attributes[name]; }
  addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(handler); }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  handlers(type) { return [...(this.listeners.get(type) || [])]; }
  emit(type, extra = {}) {
    const event = { type, target: this, currentTarget: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
    for (const handler of this.handlers(type)) handler(event);
    return event;
  }
  click() { if (!this.disabled) this.emit('click'); }
  showModal() { assert(!this.open); this.modalCalls++; this.open = true; }
  close() { this.closeCalls++; this.open = false; this.emit('close'); }
}
function state(change = {}) { return { loaded: true, origin: 'original', ops: [], redo: [], revision: 7, busy: false, ...change }; }
function harness(initial = state(), options = {}) {
  const nodes = new Map(), created = [], calls = [], order = [];
  for (const id of ids) if (options.omit !== id) nodes.set(id, new Node(id === 'historyDialog' ? 'dialog' : id === 'historySteps' ? 'ol' : 'button', id));
  const document = { getElementById(id) { return nodes.get(id) || null; }, createElement(tag) { const node = new Node(tag); created.push(node); return node; } };
  let s = initial, prepare = 0;
  const api = UI.create({ document, getState() { order.push('read'); if (options.throwRead) throw Error('private /photo/path'); return s; },
    onPrepareOpen() { order.push('prepare'); prepare++; options.prepare?.(h); },
    onJump(index, revision) { calls.push([index, revision]); options.onJump?.(index, revision, h); } });
  const h = { api, nodes, document, created, calls, order, node: id => nodes.get(id),
    set: next => { s = next; }, get state() { return s; }, get prepare() { return prepare; },
    rows: () => nodes.get('historySteps').children.map(row => row.children[0]),
    open() { assert.equal(api.open(), true); return h.rows(); } };
  return h;
}
const typed = type => ({ type });

test('actual UMD module exposes the same four-method browser interface without dependencies', () => {
  const sandbox = {}; vm.runInNewContext(fs.readFileSync(modulePath, 'utf8'), sandbox);
  assert.equal(typeof sandbox.MintHistoryUI.create, 'function');
  assert.deepEqual(Object.keys(UI.create({})), ['refresh', 'open', 'close', 'release']);
});
test('chronological order is applied operations then reverse of redo stack', () => {
  const h = harness(state({ ops: [typed('adjust'), typed('levels')], redo: [typed('background'), typed('crop')] }));
  const rows = h.open();
  assert.deepEqual(rows.map(n => n.textContent), ['0 · 保留的原图 · 已应用', '1 · 基础调节 · 已应用', '2 · 色阶 · 当前', '3 · 裁剪 · 可重做', '4 · 背景 · 可重做']);
  assert.match(h.node('historyStatus').textContent, /当前第 2 \/ 4 步 · 2 步可重做/);
});
test('zero operations has exactly one current source row and disabled boundary shortcuts', () => {
  const h = harness(); const rows = h.open();
  assert.equal(rows.length, 1); assert.equal(rows[0].getAttribute('aria-current'), 'step'); assert(rows[0].disabled);
  assert(h.node('historyOriginal').disabled); assert(h.node('historyLatest').disabled);
  rows[0].emit('click'); assert.equal(h.calls.length, 0);
});
test('60 operations creates indices 0 through 60, including fully undone histories', () => {
  for (const current of [0, 1, 30, 59, 60]) {
    const all = Array.from({ length: 60 }, () => typed('adjust'));
    const h = harness(state({ ops: all.slice(0, current), redo: all.slice(current).reverse() }));
    const rows = h.open(); assert.equal(rows.length, 61);
    assert.deepEqual(rows.map(n => Number(n.getAttribute('data-history-index'))), Array.from({ length: 61 }, (_, i) => i));
    assert.equal(rows.filter(n => n.getAttribute('aria-current') === 'step').length, 1);
    assert.equal(rows[current].getAttribute('aria-current'), 'step'); assert(rows[current].disabled);
  }
});
test('over 60 total operations fails closed without truncating or misindexing', () => {
  const h = harness(state({ ops: Array.from({ length: 31 }, () => typed('adjust')), redo: Array.from({ length: 30 }, () => typed('levels')) }));
  assert.equal(h.api.open(), false); assert.equal(h.rows().length, 0); assert(h.node('historyBtn').disabled);
  assert.match(h.node('historyStatus').textContent, /无法读取/); assert.equal(h.calls.length, 0);
});
test('only the current row has aria-current and every current button is disabled', () => {
  const h = harness(state({ ops: [typed('levels')], redo: [typed('crop')] })); const rows = h.open();
  for (let i = 0; i < rows.length; i++) { assert.equal(rows[i].disabled, i === 1); assert.equal(rows[i].getAttribute('aria-current'), i === 1 ? 'step' : null); }
  rows[1].emit('click'); assert.deepEqual(h.calls, []);
});
test('legacy working copy explicitly avoids claiming its source is the original', () => {
  const h = harness(state({ origin: 'legacy-working-copy', ops: [typed('levels')] }));
  assert.match(h.open()[0].textContent, /旧工作副本（非原图）/);
  assert.equal(h.node('historyOriginal').textContent, '回到旧工作副本');
  assert.match(h.node('historyStatus').textContent, /无法恢复已丢失的原图像素/);
});
test('every canonical type and add/replace action has a trusted Chinese label', () => {
  const cases = [
    ['canvas-padding', '边框 / 留白'], ['local-tone', '局部调色'], ['adjustment-preset', '调色配方'],
    ['geometry', '构图'], ['rotate', '旋转'], ['flip', '翻转'], ['crop', '裁剪'], ['idphoto', '证件照'],
    ['filter', '滤镜'], ['adjust', '基础调节'], ['levels', '色阶'], ['advanced-tone', '曲线 / HSL'],
    ['text', '文字（旧版）'], ['sticker', '贴纸'], ['draw', '涂鸦（旧版）'], ['beauty', '人像修肤'],
    ['reshape', '五官调整'], ['manual', '手动精修'], ['heal', '祛痘（旧版）'], ['warp', '液化（旧版）'], ['background', '背景'], ['background-refine', '背景精细修边']
  ];
  const ops = cases.map(([type]) => typed(type));
  for (const [type, noun] of [['text-overlay', '文字'], ['paint-layer', '涂鸦']]) for (const [action, verb] of [['add', '新增'], ['replace', '修改']]) { ops.push({ type, action }); cases.push([type, verb + noun]); }
  const rows = harness(state({ ops })).open().slice(1);
  for (let i = 0; i < cases.length; i++) assert(rows[i].textContent.includes(' · ' + cases[i][1] + ' ·'), cases[i][0]);
});
test('hostile photo text, paths, recipe names and type strings are never rendered as HTML or text', () => {
  const payload = '<img src=x onerror=alert(1)>/private/user/photo.jpg';
  const ops = [{ type: 'text', text: payload }, { type: 'text-overlay', action: 'add', recipe: { text: payload } },
    { type: 'adjustment-preset', recipe: { name: payload } }, { type: payload, action: payload }, { type: '__proto__' }, { type: 'constructor' }];
  const h = harness(state({ ops })); h.open();
  assert(!h.node('historySteps').textContent.includes(payload)); assert(!h.node('historySteps').textContent.includes('constructor'));
  assert(h.created.every(n => ['LI', 'BUTTON'].includes(n.tagName)));
  assert.equal(h.rows().at(-1).textContent, '6 · 编辑步骤 · 当前');
});
test('labels do not evaluate arbitrary getters or inherited tags', () => {
  let calls = 0; const op = { get type() { calls++; return 'text'; }, get text() { calls++; throw Error(); } };
  const text = { type: 'text-overlay', get action() { calls++; throw Error(); } };
  const h = harness(state({ ops: [op, text, Object.create({ type: 'levels' })] })); h.open();
  assert.equal(calls, 0); assert.match(h.rows()[1].textContent, /编辑步骤/); assert.match(h.rows()[2].textContent, /文字/); assert.match(h.rows()[3].textContent, /编辑步骤/);
});
test('missing any required DOM node disables available routes without throwing', () => {
  for (const omit of ids) { const h = harness(state({ ops: [typed('levels')] }), { omit }); assert.equal(h.api.open(), false); assert.equal(h.api.refresh(), false); for (const id of ['historyBtn', 'historyOriginal', 'historyLatest']) if (h.node(id)) assert(h.node(id).disabled); assert.doesNotThrow(() => h.api.release()); }
});
test('unloaded and busy states disable open, rows and shortcuts', () => {
  for (const change of [{ loaded: false }, { busy: true }]) {
    const h = harness(state({ ops: [typed('levels')], redo: [typed('crop')], ...change }));
    assert.equal(h.api.open(), false); assert(h.node('historyBtn').disabled); assert(h.node('historyOriginal').disabled); assert(h.node('historyLatest').disabled);
    assert(h.rows().every(row => row.disabled)); assert.equal(h.node('historyDialog').open, false); assert.equal(h.calls.length, 0);
  }
});
test('open prepares before the newest snapshot and uses changes made by preparation', () => {
  const h = harness(state(), { prepare: h => h.set(state({ ops: [typed('levels')], revision: 19 })) });
  h.order.length = 0; const rows = h.open();
  assert.deepEqual(h.order, ['prepare', 'read']); assert.equal(rows.length, 2); assert.match(rows[1].textContent, /当前/);
  rows[0].click(); assert.deepEqual(h.calls, [[0, 19]]);
});
test('row jump passes prefix index and the captured revision, including after project revision changes', () => {
  const h = harness(state({ ops: [typed('levels')], redo: [typed('crop')], revision: 17 })); const rows = h.open();
  h.set(state({ ops: [typed('background')], revision: 18 })); rows[2].click();
  assert.deepEqual(h.calls, [[2, 17]]); assert(h.node('historyDialog').open, 'host owns close on successful atomic replay');
});
test('source and latest shortcuts bind the rendered prefix and revision', () => {
  for (const id of ['historyOriginal', 'historyLatest']) {
    const h = harness(state({ ops: [typed('levels')], redo: [typed('crop'), typed('filter')], revision: 42 })); h.open();
    h.set(state({ ops: [], revision: 43 })); h.node(id).click();
    assert.deepEqual(h.calls, [[id === 'historyOriginal' ? 0 : 3, 42]]); assert(h.node('historyDialog').open);
  }
});
test('latest runtime busy/unloaded state blocks old clickable rows without a host refresh', () => {
  for (const change of [{ busy: true }, { loaded: false }]) {
    const h = harness(state({ ops: [typed('levels')] })); const row = h.open()[0]; h.set(state({ ops: [typed('levels')], ...change })); row.click();
    assert.deepEqual(h.calls, []); assert(h.node('historyBtn').disabled);
  }
});
test('source arrays and operations stay frozen, ordered and byte-for-byte unchanged', () => {
  const ops = Object.freeze([Object.freeze(typed('levels'))]), redo = Object.freeze([Object.freeze(typed('crop')), Object.freeze(typed('background'))]);
  const s = Object.freeze(state({ ops, redo })), before = JSON.stringify(s), h = harness(s);
  h.open(); h.rows()[3].click(); h.api.refresh(); h.api.close(); h.api.release();
  assert.equal(JSON.stringify(s), before); assert.equal(s.ops, ops); assert.equal(s.redo, redo);
});
test('refresh removes old nodes/listeners and makes stored old callbacks inert', () => {
  const h = harness(state({ ops: [typed('levels')] })); const row = h.open()[0], callback = row.handlers('click')[0], oldRow = row.parentNode;
  h.set(state({ ops: [typed('crop')], revision: 8 })); h.api.refresh(); callback(); row.emit('click');
  assert.deepEqual(h.calls, []); assert.equal(oldRow.parentNode, null); assert.equal(row.handlers('click').length, 0);
  h.rows()[0].click(); assert.deepEqual(h.calls, [[0, 8]]);
});
test('detached row or replaced dialog cannot act against the visible project', () => {
  for (const mode of ['row', 'dialog']) {
    const h = harness(state({ ops: [typed('levels')] })); const row = h.open()[0], callback = row.handlers('click')[0];
    if (mode === 'row') h.node('historySteps').removeChild(row.parentNode); else h.nodes.set('historyDialog', new Node('dialog', 'historyDialog'));
    callback(); assert.deepEqual(h.calls, []);
  }
});
test('host close is explicit, invalidates queued rows and permits reopening', () => {
  const h = harness(state({ ops: [typed('levels')] })); const row = h.open()[0], handler = row.handlers('click')[0]; row.click();
  assert(h.node('historyDialog').open); assert.equal(h.api.close(), true); assert.equal(h.node('historyDialog').open, false);
  handler(); h.rows()[0].emit('click'); assert.deepEqual(h.calls, [[0, 7]]);
  h.node('historyBtn').click(); assert(h.node('historyDialog').open); assert.equal(h.node('historyBtn').getAttribute('aria-expanded'), 'true');
});
test('native cancel closes safely and does not strand the reopen button', () => {
  const h = harness(state({ ops: [typed('levels')] })); const row = h.open()[0], callback = row.handlers('click')[0];
  assert(h.node('historyDialog').emit('cancel').defaultPrevented); assert.equal(h.node('historyDialog').open, false); callback();
  h.node('historyBtn').click(); assert(h.node('historyDialog').open); assert.deepEqual(h.calls, []);
});
test('external native dialog close refreshes controls and old events become inert', () => {
  const h = harness(state({ ops: [typed('levels')] })); const callback = h.open()[0].handlers('click')[0];
  h.node('historyDialog').close(); callback(); assert.equal(h.calls.length, 0); assert.equal(h.node('historyBtn').getAttribute('aria-expanded'), 'false'); h.node('historyBtn').click(); assert(h.node('historyDialog').open);
});
test('release removes own listeners, disables controls and makes all saved handlers/methods inert', () => {
  const h = harness(state({ ops: [typed('levels')], redo: [typed('crop')] })); h.open();
  const oldNodes = [...h.nodes.values(), ...h.created], saved = oldNodes.flatMap(n => ['click', 'close', 'cancel'].flatMap(type => n.handlers(type)));
  let foreign = 0; h.node('historyBtn').addEventListener('click', () => foreign++);
  const before = h.calls.length; h.api.release(); h.api.release();
  for (const callback of saved) callback({ preventDefault() {} });
  assert.equal(h.calls.length, before); assert.equal(h.api.refresh(), false); assert.equal(h.api.open(), false); assert.equal(h.api.close(), false);
  assert.equal(h.node('historyDialog').open, false); assert.equal(h.rows().length, 0);
  for (const id of ['historyBtn', 'historyOriginal', 'historyLatest']) assert(h.node(id).disabled);
  assert.equal(h.node('historyBtn').handlers('click').length, 1, 'unrelated listener is preserved');
  h.node('historyBtn').emit('click'); assert(foreign > 0);
});
test('repeated refresh/open has a single live handler per event and no duplicate jump', () => {
  const h = harness(state({ ops: [typed('levels')] }));
  for (let i = 0; i < 30; i++) { h.api.refresh(); h.api.open(); }
  assert.equal(h.node('historyDialog').modalCalls, 1); assert.equal(h.node('historyBtn').handlers('click').length, 1);
  h.rows()[0].click(); assert.deepEqual(h.calls, [[0, 7]]);
});
test('malformed snapshot/getState errors fail closed without exposing error messages', () => {
  for (const s of [null, state({ revision: NaN }), state({ revision: -1 }), state({ revision: 1.5 }), state({ ops: {} }), state({ redo: null }), state({ busy: 0 }), state({ loaded: 1 }), state({ origin: 'private-path' })]) {
    const h = harness(s); assert.equal(h.api.open(), false); assert(h.node('historyBtn').disabled); assert.equal(h.rows().length, 0);
  }
  const h = harness(state(), { throwRead: true }); assert.equal(h.api.open(), false); assert(!h.node('historyStatus').textContent.includes('private'));
});
test('missing showModal reports inability without pretending the panel opened', () => {
  const h = harness(); h.node('historyDialog').showModal = null; assert.equal(h.api.open(), false); assert.match(h.node('historyStatus').textContent, /无法打开/);
});
test('busy updates during a pending host decision leave the dialog open and disable navigation', () => {
  const h = harness(state({ ops: [typed('levels')] }), { onJump(i, r, h) { h.set(state({ ops: [typed('levels')], busy: true })); h.api.refresh(); } });
  h.open()[0].click(); assert(h.node('historyDialog').open); assert(h.rows().every(row => row.disabled)); assert.deepEqual(h.calls, [[0, 7]]);
});
test('onJump may close synchronously on success without a stale UI write after returning', () => {
  const h = harness(state({ ops: [typed('levels')] }), { onJump(i, r, h) { h.set(state({ revision: 8 })); h.api.close(); } });
  h.open()[0].click(); assert.equal(h.node('historyDialog').open, false); assert.equal(h.rows().length, 1); assert(h.rows()[0].disabled);
});
test('host exceptions do not lock future navigation, and UI never claims success', () => {
  let fail = true; const h = harness(state({ ops: [typed('levels')] }), { onJump() { if (fail) throw Error('host rejected'); } });
  h.open(); assert.throws(() => h.rows()[0].click(), /host rejected/); assert(h.node('historyDialog').open); fail = false; h.rows()[0].click(); assert.equal(h.calls.length, 2);
});
