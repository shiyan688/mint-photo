'use strict';
// Production UI, pixel core and Canvas adapter under a controlled DOM.
// This checks exact RGBA behavior and lifecycle, not a physical Android device.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = '/workspace/scratch/902a42ed06ad';
const siblingAssets = path.resolve(__dirname, '../app/src/main/assets');
const assets = process.env.REDACT_ASSETS || (fs.existsSync(siblingAssets) ? siblingAssets : path.join(root, 'mobile-oct22/薄荷人像/app/src/main/assets'));
const corePath = process.env.REDACT_CORE_PATH || (fs.existsSync(path.join(assets, 'redact-core.js')) ? path.join(assets, 'redact-core.js') : path.join(root, 'redact-core-candidate/redact-core.js'));
const uiPath = process.env.REDACT_UI_PATH || (fs.existsSync(path.join(__dirname, 'redact-ui.js')) ? path.join(__dirname, 'redact-ui.js') : path.join(assets, 'redact-ui.js'));
const operationPath = process.env.REDACT_OPERATION_PATH || path.join(assets, 'redact-operation.js');
const plain = value => JSON.parse(JSON.stringify(value));
const p = (x, y) => ({ x, y });
function canvas(width = 80, height = 60, input) {
  let w = width, h = height, data = input ? new Uint8ClampedArray(input) : new Uint8ClampedArray(w * h * 4), writes = 0;
  if (!input) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([(x * 43 + y * 31) % 256, (x * 13 + y * 71) % 256, (x * 113 + y * 17) % 256, x < 4 ? 0 : 100 + (x + y) % 156], (y * w + x) * 4);
  const c = { get width() { return w; }, set width(value) { writes++; w = value; data = new Uint8ClampedArray(w * h * 4); },
    get height() { return h; }, set height(value) { writes++; h = value; data = new Uint8ClampedArray(w * h * 4); },
    get data() { return data; }, get sizeWrites() { return writes; } };
  const ctx = { getImageData() { return { width: w, height: h, data: new Uint8ClampedArray(data) }; },
    createImageData(width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; },
    putImageData(image) { data = new Uint8ClampedArray(image.data); } };
  c.getContext = () => ctx; return c;
}
function harness(options = {}) {
  let draft = null, revision = 7, renders = 0, allocations = 0;
  let assessment = options.assessment || { original: { allowed: true }, working: { allowed: true } };
  const nodes = {}, notices = [], assessed = [], listeners = { window: {}, document: {} }, base = canvas(options.width || 80, options.height || 60);
  const add = (scope, kind, fn) => (listeners[scope][kind] ||= new Set()).add(fn);
  const remove = (scope, kind, fn) => listeners[scope][kind]?.delete(fn);
  function element(id, parent) {
    const classes = new Set(), attrs = {}, n = { id, parent, isConnected: true, value: '', disabled: false, hidden: false, textContent: '',
      classList: { toggle(name, state) { state ? classes.add(name) : classes.delete(name); }, contains: name => classes.has(name) },
      setAttribute(name, value) { attrs[name] = value; }, getAttribute(name) { return attrs[name]; },
      contains(child) { return child.parent === this && child.isConnected; }, querySelector(selector) { const n = nodes[selector.slice(1)]; return n && n.parent === this ? n : null; } };
    Object.defineProperty(n, 'innerHTML', { get() { return this.markup || ''; }, set(markup) {
      this.markup = markup;
      for (const old of Object.values(nodes)) if (old.parent === n) old.isConnected = false;
      for (const match of markup.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
        const child = element(match[3], n); child.value = match[2].match(/\bvalue="([^"]*)"/)?.[1] || '';
        child.disabled = /\bdisabled\b/.test(match[2]); child.hidden = /\bhidden\b/.test(match[2]);
      }
    } }); nodes[id] = n; return n;
  }
  const panel = element('toolPanel');
  const env = { console, Uint8Array, Uint8ClampedArray, ArrayBuffer, Int32Array, Float64Array,
    document: { hidden: false, getElementById: id => nodes[id] || null, createElement(tag) { assert.equal(tag, 'canvas'); allocations++; return canvas(1, 1); },
      addEventListener: (kind, fn) => add('document', kind, fn), removeEventListener: (kind, fn) => remove('document', kind, fn) },
    addEventListener: (kind, fn) => add('window', kind, fn), removeEventListener: (kind, fn) => remove('window', kind, fn) };
  env.window = env; vm.createContext(env);
  for (const [name, filename] of [['core', corePath], ['operation', operationPath], ['ui', uiPath]])
    if (options.missing !== name) vm.runInContext(fs.readFileSync(filename, 'utf8'), env, { filename });
  const adapter = { panel, revision: () => revision, getDraft: () => draft, setDraft: value => { draft = value; }, getCanvas: () => base,
    render: () => renders++, toast: text => notices.push(text), hint() {}, assess(op) { assessed.push(plain(op)); return typeof assessment === 'function' ? assessment(op) : assessment; } };
  if (options.noAssess) delete adapter.assess;
  const ui = env.RedactUI; options.twoArgs ? ui.setup(panel, adapter) : ui.setup(adapter);
  const h = { env, ui, panel, adapter, base, nodes, notices, assessed, listeners, get draft() { return draft; }, set draft(v) { draft = v; },
    get renders() { return renders; }, get allocations() { return allocations; }, setRevision(v) { revision = v; }, setAssessment(v) { assessment = v; },
    node(id) { return nodes['rd-' + id]; }, click(id) { const n = this.node(id); assert(n, id); assert(!n.disabled, 'disabled ' + id); n.onclick({ target: n }); },
    input(id, value) { const n = this.node(id); n.value = String(value); n.oninput({ target: n }); },
    emit(scope, kind) { for (const fn of [...(listeners[scope][kind] || [])]) fn(); },
    stroke(points = [p(.2, .4), p(.8, .4)], cancelled = false) { const d = draft, token = ui.start(d, points[0]); for (const point of points.slice(1, -1)) ui.move(d, point, token); ui.finish(d, points.at(-1), token, cancelled); return token; },
    preview() { return ui.preview(draft); }, snapshot() { return JSON.stringify(draft); }, realm(value) { env.__json = JSON.stringify(value); return vm.runInContext('JSON.parse(__json)', env); } };
  return h;
}
const pixel = (c, x, y) => Array.from(c.data.slice((y * c.width + x) * 4, (y * c.width + x) * 4 + 4));
const baseline = h => ({ bytes: new Uint8ClampedArray(h.base.data), width: h.base.width, height: h.base.height, writes: h.base.sizeWrites });
function intact(h, before) { assert.deepEqual(h.base.data, before.bytes); assert.equal(h.base.width, before.width); assert.equal(h.base.height, before.height); assert.equal(h.base.sizeWrites, before.writes); }

test('fresh UI is neutral with frozen normalized commands, privacy explanation and no pixel allocation', () => {
  const h = harness(), before = baseline(h);
  assert.deepEqual(plain(h.draft), { type: 'redact', recipe: { version: 1, mode: 'mosaic', blockSize: .04, color: '#173e31', strokes: [] } });
  assert(Object.isFrozen(h.draft.recipe)); assert(Object.isFrozen(h.draft.recipe.strokes));
  assert.equal(h.ui.changed(h.draft), false); assert.equal(h.preview(), h.base); assert.equal(h.allocations, 0);
  assert.equal(h.node('mosaic').getAttribute('aria-pressed'), 'true'); assert(h.node('color-row').hidden); assert(!h.node('block-row').hidden);
  assert.match(h.panel.innerHTML, /不是可靠的隐私遮挡/); assert.match(h.panel.innerHTML, /100%不透明硬边/);
  assert.match(h.panel.innerHTML, /草稿仍保留原始内容/); assert.match(h.panel.innerHTML, /只发送导出的栅格图片/); assert.match(h.panel.innerHTML, /放大检查/);
  assert(!/id="rd-(opacity|feather|erase)/.test(h.panel.innerHTML)); intact(h, before);
});

test('provisional preview paints actual pixels without entering draft; pointerup includes exact endpoint once', () => {
  const h = harness(), before = baseline(h), d = h.draft, token = h.ui.start(d, p(.2, .4));
  h.ui.move(d, p(.5, .4), token); assert.equal(d.recipe.strokes.length, 0); assert.equal(h.ui.changed(d), false);
  const preview = h.preview(); assert.notDeepEqual(preview.data, h.base.data); assert.equal(d.recipe.strokes.length, 0); intact(h, before);
  h.ui.finish(d, p(.8, .4), token, false);
  assert.deepEqual(plain(d.recipe.strokes[0]), { radius: .04, points: [p(.2, .4), p(.5, .4), p(.8, .4)] });
  assert(Object.isFrozen(d.recipe.strokes[0].points[0])); assert.equal(h.ui.changed(d), true);
  const saved = h.snapshot(); h.ui.finish(d, p(.9, .9), token, false); h.ui.move(d, p(.1, .1), token); assert.equal(h.snapshot(), saved);
  assert.notDeepEqual(h.preview().data, h.base.data); intact(h, before);
});

test('opaque cover has hard 100% alpha, including transparent source, and exact untouched outside bytes', () => {
  const h = harness(), before = baseline(h); h.click('cover'); h.input('color', '#ABCDEF'); h.input('radius', 100);
  h.stroke([p(0, .5), p(.5, .5)]); const out = h.preview();
  assert.deepEqual(pixel(out, 1, 30), [171, 205, 239, 255]); assert.deepEqual(pixel(out, 30, 30), [171, 205, 239, 255]);
  assert.deepEqual(pixel(out, 75, 55), pixel(h.base, 75, 55)); assert.equal(h.draft.recipe.color, '#abcdef');
  for (let i = 0; i < out.data.length; i += 4) if (!out.data.slice(i, i + 4).every((v, j) => v === before.bytes[i + j]))
    assert.deepEqual(Array.from(out.data.slice(i, i + 4)), [171, 205, 239, 255]);
  assert(h.node('block-row').hidden); assert(!h.node('color-row').hidden); intact(h, before);
});

test('radius freezes per stroke while recipe mode, blocks and color update all current strokes', () => {
  const h = harness(), d = h.draft, token = h.ui.start(d, p(.2, .4)); h.input('radius', 100); h.ui.finish(d, p(.8, .4), token, false);
  const first = d.recipe; assert.equal(first.strokes[0].radius, .04); h.stroke([p(.2, .7), p(.8, .7)]); assert.equal(d.recipe.strokes[1].radius, .1);
  h.input('block', 200); assert.equal(d.recipe.blockSize, .2); const mosaic = h.preview().data;
  h.click('cover'); h.input('color', '#e67812'); assert.equal(d.recipe.mode, 'cover'); assert.equal(d.recipe.color, '#e67812');
  assert.notDeepEqual(h.preview().data, mosaic); assert.equal(first.mode, 'mosaic'); assert.equal(first.blockSize, .04); assert.equal(first.strokes.length, 1);
  assert(h.assessed.length >= 5); assert.equal(d.type, 'redact'); assert.deepEqual(Object.keys(d).sort(), ['recipe', 'type']);
});

test('pointercancel, blur, hidden document and mode changes cancel entire stroke; late callbacks are inert', () => {
  for (const action of ['cancel', 'blur', 'hidden', 'mode', 'block']) {
    const h = harness(), d = h.draft, token = h.ui.start(d, p(.2, .4)); h.ui.move(d, p(.6, .4), token);
    if (action === 'cancel') h.ui.finish(d, p(.8, .4), token, true);
    if (action === 'blur') h.emit('window', 'blur');
    if (action === 'hidden') { h.env.document.hidden = true; h.emit('document', 'visibilitychange'); h.env.document.hidden = false; }
    if (action === 'mode') h.click('cover');
    if (action === 'block') h.input('block', 70);
    const saved = h.snapshot(); h.ui.finish(d, p(.8, .4), token, false); assert.equal(h.snapshot(), saved); assert.equal(d.recipe.strokes.length, 0);
    assert.equal(h.preview(), h.base); h.stroke(); assert.equal(h.draft.recipe.strokes.length, 1);
  }
});

test('release, new sessions, stale controls and late blur callbacks cannot mutate a newer draft', () => {
  const h = harness(), old = h.draft, token = h.ui.start(old, p(.2, .4));
  const callbacks = [h.node('cover').onclick, h.node('clear').onclick, h.node('radius').oninput];
  const oldBlur = [...h.listeners.window.blur], oldHidden = [...h.listeners.document.visibilitychange];
  h.ui.release(); h.ui.setup(h.adapter); const d = h.draft, next = h.ui.start(d, p(.3, .4));
  for (const fn of callbacks) if (fn) fn({ target: { value: '250' } }); for (const fn of oldBlur) fn();
  h.env.document.hidden = true; for (const fn of oldHidden) fn(); h.env.document.hidden = false;
  h.ui.finish(old, p(.8, .4), token, false); h.ui.finish(d, p(.8, .4), next, false);
  assert.equal(old.recipe.strokes.length, 0); assert.equal(d.recipe.strokes.length, 1); assert.equal(d.recipe.mode, 'mosaic'); assert.equal(d.recipe.strokes[0].radius, .04);
});

test('stale revision and replaced draft invalidate gestures permanently and fail preview/changed closed', () => {
  const h = harness(), old = h.draft, token = h.ui.start(old, p(.2, .4)), saved = h.snapshot();
  h.setRevision(8); assert.throws(() => h.preview(), /版本/); assert.throws(() => h.ui.changed(old), /版本/);
  h.ui.finish(old, p(.8, .4), token, false); h.setRevision(7); h.ui.finish(old, p(.8, .4), token, false); assert.equal(h.snapshot(), saved);
  const token2 = h.ui.start(old, p(.2, .4)), replacement = { type: 'filter', id: 'original' }; h.draft = replacement;
  h.ui.move(old, p(.5, .4), token2); h.draft = old; h.ui.finish(old, p(.8, .4), token2, false); assert.equal(h.snapshot(), saved);
});

test('detached buttons and panels do nothing even if retained callbacks are invoked manually', () => {
  const h = harness(), before = h.snapshot(); h.node('cover').isConnected = false; h.node('cover').onclick(); assert.equal(h.snapshot(), before);
  h.node('cover').isConnected = true; h.panel.isConnected = false; h.node('cover').onclick(); assert.equal(h.snapshot(), before);
  h.ui.start(h.draft, p(.2, .4)); assert.equal(h.snapshot(), before); assert.throws(() => h.preview(), /工具/);
});

test('both budgets reject atomically, either allowed mode permits save, and malformed assessment rejects', () => {
  const h = harness(), before = baseline(h), saved = h.snapshot();
  h.setAssessment({ original: { allowed: false }, working: { allowed: false } }); h.stroke(); assert.equal(h.snapshot(), saved); assert(h.node('undo').disabled);
  assert.match(h.notices.at(-1), /均超出/); intact(h, before);
  h.setAssessment({ original: { allowed: false }, working: { allowed: true } }); h.stroke(); assert.equal(h.draft.recipe.strokes.length, 1);
  const valid = h.snapshot(); h.setAssessment({ original: { allowed: true } }); h.stroke(); assert.equal(h.snapshot(), valid);
  h.setAssessment({ original: { allowed: true }, working: { allowed: false } }); h.stroke(); assert.equal(h.draft.recipe.strokes.length, 2);
});

test('budget-rejected mode/block changes preserve current recipe, reset controls and cancel provisional stroke', () => {
  const h = harness(); h.stroke(); const saved = h.snapshot(), d = h.draft, token = h.ui.start(d, p(.2, .7));
  h.setAssessment({ original: { allowed: false }, working: { allowed: false } }); h.click('cover'); assert.equal(h.snapshot(), saved);
  assert.equal(h.node('mosaic').getAttribute('aria-pressed'), 'true'); h.ui.finish(d, p(.8, .7), token, false); assert.equal(h.snapshot(), saved);
  h.input('block', 200); assert.equal(h.snapshot(), saved); assert.equal(h.node('block').value, '40');
});

test('undo/redo/clear restore exact recipes and pixels without ever resizing source', () => {
  const h = harness({ twoArgs: true }), before = baseline(h); h.stroke(); const saved = h.snapshot(), pixels = h.preview().data;
  h.click('undo'); assert.equal(h.draft.recipe.strokes.length, 0); assert.equal(h.preview(), h.base);
  h.click('redo'); assert.equal(h.snapshot(), saved); assert.deepEqual(h.preview().data, pixels);
  h.click('clear'); assert.equal(h.draft.recipe.strokes.length, 0); assert.equal(h.preview(), h.base);
  h.click('undo'); assert.equal(h.snapshot(), saved); assert.deepEqual(h.preview().data, pixels); intact(h, before);
});

test('history refusal leaves undo/redo stacks intact; a later valid retry restores the same commands', () => {
  const h = harness(); h.stroke(); const saved = h.snapshot(); h.click('undo');
  h.setAssessment({ original: { allowed: false }, working: { allowed: false } }); h.click('redo'); assert.equal(h.draft.recipe.strokes.length, 0); assert(!h.node('redo').disabled);
  h.setAssessment({ original: { allowed: true }, working: { allowed: true } }); h.click('redo'); assert.equal(h.snapshot(), saved);
});

test('clear and undo during active drag cancel it; late endpoint cannot re-add a stroke', () => {
  for (const action of ['clear', 'undo']) {
    const h = harness(); h.stroke(); const d = h.draft, token = h.ui.start(d, p(.2, .7)); h.ui.move(d, p(.7, .7), token); h.click(action);
    const saved = h.snapshot(); h.ui.finish(d, p(.8, .7), token, false); assert.equal(h.snapshot(), saved); assert.equal(d.recipe.strokes.length, 0);
  }
});

test('64 strokes and 4096 total points are hard limits, not truncation; duplicate endpoint is not a new point', () => {
  const h = harness(); for (let i = 0; i < 64; i++) h.stroke([p(.2, .4)]);
  const saved = h.snapshot(); h.stroke(); assert.equal(h.snapshot(), saved); assert.equal(h.draft.recipe.strokes.length, 64);
  const g = harness(), d = g.draft, token = g.ui.start(d, p(.2, .4));
  for (let i = 1; i < 4096; i++) g.ui.move(d, p(i % 2 ? .8 : .2, .4), token);
  g.ui.finish(d, p(.8, .4), token, false); assert.equal(d.recipe.strokes[0].points.length, 4096);
  const full = g.snapshot(); g.stroke(); assert.equal(g.snapshot(), full);
  const q = harness(), qt = q.ui.start(q.draft, p(.2, .4)); for (let i = 1; i <= 4096; i++) q.ui.move(q.draft, p(i % 2 ? .8 : .2, .4), qt);
  q.ui.finish(q.draft, p(.8, .4), qt, false); assert.equal(q.draft.recipe.strokes.length, 0); assert.match(q.notices.at(-1), /完整取消/);
});

test('invalid coordinates cancel the entire gesture and invalid controls preserve recipe', () => {
  for (const point of [p(NaN, .4), p(.5, Infinity), p(-.01, .2), p(.5, 1.01), { x: '0.5', y: .5 }]) {
    const h = harness(), d = h.draft, token = h.ui.start(d, p(.2, .4)); h.ui.move(d, point, token); h.ui.finish(d, p(.8, .4), token, false); assert.equal(d.recipe.strokes.length, 0);
  }
  const h = harness(), saved = h.snapshot(); h.input('block', 'NaN'); assert.equal(h.snapshot(), saved); h.input('radius', 501); assert.equal(h.node('radius').value, '40');
  h.click('cover'); const next = h.snapshot(); h.input('color', '#fff'); assert.equal(h.snapshot(), next); assert.equal(h.node('color').value, '#173e31');
});

test('missing modules/interfaces fail setup closed; runtime missing core rejects without allocating or saving', () => {
  for (const missing of ['core', 'operation']) { const h = harness({ missing }); assert.equal(h.draft, null); assert.match(h.panel.innerHTML, /暂不可用/); assert.equal(h.allocations, 0); }
  assert.equal(harness({ noAssess: true }).draft, null);
  const h = harness(), before = baseline(h), saved = h.snapshot(), token = h.ui.start(h.draft, p(.2, .4)); h.env.MintRedact = null;
  assert.throws(() => h.preview(), /核心/); h.ui.finish(h.draft, p(.8, .4), token, false); assert.equal(h.snapshot(), saved); assert.equal(h.allocations, 0); intact(h, before);
});

test('preview planner failures occur before Canvas allocation and never mutate saved commands', () => {
  const h = harness(), core = h.env.MintRedact, before = baseline(h), token = h.ui.start(h.draft, p(.2, .4));
  h.env.MintRedact = { ...core, plan() { throw Error('allocation budget exceeded'); } }; const saved = h.snapshot();
  assert.throws(() => h.preview(), /budget/); assert.equal(h.allocations, 0); h.ui.finish(h.draft, p(.8, .4), token, false);
  assert.equal(h.snapshot(), saved); intact(h, before); h.env.MintRedact = core; h.stroke(); assert.equal(h.draft.recipe.strokes.length, 1);
});

test('released preview/changed cannot publish stale commands and wrong tokens cannot finish another gesture', () => {
  const h = harness(), d = h.draft, first = h.ui.start(d, p(.2, .4)), second = h.ui.start(d, p(.2, .7));
  h.ui.finish(d, p(.8, .7), second, false); assert.equal(d.recipe.strokes.length, 0); h.ui.finish(d, p(.8, .4), first, false); assert.equal(d.recipe.strokes.length, 1);
  h.ui.release(); assert.throws(() => h.ui.preview(d), /工具/); assert.throws(() => h.ui.changed(d), /工具/);
});

test('local history retains at most32 actions and mode-only changes remain neutral', () => {
  const h = harness(); h.click('cover'); assert.equal(h.ui.changed(h.draft), false); h.click('mosaic'); assert.equal(h.ui.changed(h.draft), false);
  for (let i = 0; i < 35; i++) h.stroke([p(.2, .4)]);
  for (let i = 0; i < 32; i++) h.click('undo'); assert(h.node('undo').disabled); assert.equal(h.draft.recipe.strokes.length, 3);
});


test('preview rejects malformed operation or recipe instead of silently normalizing extra state away', () => {
  const h = harness(), before = baseline(h); h.draft.unexpected = true;
  assert.throws(() => h.preview()); assert.equal(h.allocations, 0); intact(h, before); delete h.draft.unexpected;
  h.draft.recipe = h.realm({ ...plain(h.draft.recipe), opacity: .1 });
  assert.throws(() => h.preview()); assert.equal(h.allocations, 0); intact(h, before);
});
