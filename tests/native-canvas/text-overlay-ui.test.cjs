'use strict';
// Production controls + production text cores, using preinstalled native Skia.
// DOM event plumbing is controlled; this is not Android WebView/device evidence.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const { createCanvas } = require('@napi-rs/canvas');
const assets = path.join(__dirname, '../../app/src/main/assets');
const plain = value => JSON.parse(JSON.stringify(value));
const p = (x, y) => ({ x, y });
function canvas(w = 240, h = 180) {
  const c = createCanvas(w, h); c.resizes = [];
  for (const key of ['width', 'height']) {
    const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(c), key);
    Object.defineProperty(c, key, { configurable: true, get() { return d.get.call(this); }, set(value) { this.resizes.push([key, value]); d.set.call(this, value); } });
  }
  return c;
}
function copy(source) { const out = canvas(source.width, source.height); out.getContext('2d').drawImage(source, 0, 0); return out; }
function pixels(c) { return c.getContext('2d').getImageData(0, 0, c.width, c.height).data; }
function hash(c) { return crypto.createHash('sha256').update(pixels(c)).digest('hex'); }
function fixture() {
  const c = canvas(), ctx = c.getContext('2d'), gradient = ctx.createLinearGradient(0, 0, c.width, c.height);
  gradient.addColorStop(0, '#304a50'); gradient.addColorStop(1, '#888674'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, c.width, c.height); return c;
}
function harness(options = {}) {
  let draft = null, revision = 1, renders = 0, editRequests = 0, editable = null, badBase = false;
  const nodes = {}, notices = [], confirmations = [], allocated = [], editBases = [], listeners = { window: {}, document: {} };
  const cleanBase = fixture(), committed = copy(cleanBase);
  const add = (scope, kind, fn) => (listeners[scope][kind] ||= new Set()).add(fn);
  const remove = (scope, kind, fn) => listeners[scope][kind]?.delete(fn);
  function element(id) {
    const node = { id, value: '', checked: false, disabled: false, textContent: '', hidden: false };
    Object.defineProperty(node, 'innerHTML', { get() { return this.markup || ''; }, set(value) {
      this.markup = value;
      if (id === 'toolPanel') for (const m of value.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
        const el = element(m[3]); el.value = m[2].match(/\bvalue="([^"]*)"/)?.[1] || '';
        el.checked = /\bchecked\b/.test(m[2]); el.disabled = /\bdisabled\b/.test(m[2]);
      }
    } });
    nodes[id] = node; return node;
  }
  for (const id of ['toolPanel', 'editLabel', 'stageHint']) element(id);
  const env = {
    console, Uint8Array, Uint8ClampedArray, Float32Array, Float64Array, ArrayBuffer,
    document: { hidden: false, getElementById: id => nodes[id] || null, createElement: tag => { assert.equal(tag, 'canvas'); const c = canvas(1, 1); allocated.push(c); return c; }, addEventListener: (kind, fn) => add('document', kind, fn), removeEventListener: (kind, fn) => remove('document', kind, fn) },
    addEventListener: (kind, fn) => add('window', kind, fn), removeEventListener: (kind, fn) => remove('window', kind, fn)
  };
  env.window = env; vm.createContext(env);
  for (const file of ['text-overlay.js', 'text-overlay-operation.js', 'text-overlay-ui.js']) if (file !== options.missing) vm.runInContext(fs.readFileSync(path.join(assets, file), 'utf8'), env, { filename: file });
  function realm(value) { env.__json = JSON.stringify(value); return vm.runInContext('JSON.parse(__json)', env); }
  if (options.editable && env.MintTextOverlay) {
    editable = { type: 'text-overlay', action: 'add', id: options.id || 'paragraph-one', recipe: { ...plain(env.MintTextOverlay.defaults()), text: 'OLD PARAGRAPH\nSecond line', size: .14, ...options.recipe } };
    env.MintTextOverlay.render(committed.getContext('2d'), committed.width, committed.height, realm(editable.recipe));
  }
  const adapter = {
    getDraft: () => draft, setDraft: value => { draft = value; }, getCanvas: () => committed, render: () => renders++,
    toast: message => notices.push(message), hint: text => { nodes.stageHint.textContent = text; }, revision: () => revision,
    getEditable: () => editable ? realm(editable) : null,
    createEditBase: () => { editRequests++; if (badBase) return committed; const c = copy(cleanBase); editBases.push(c); return c; },
    confirm: (title, text, yes) => confirmations.push({ title, text, yes })
  };
  const ui = env.TextOverlayUI; ui.setup(adapter);
  return { env, ui, adapter, nodes, committed, cleanBase, notices, confirmations, allocated, editBases, listeners, realm,
    get draft() { return draft; }, get renders() { return renders; }, get editRequests() { return editRequests; },
    get editable() { return plain(editable); }, setEditable(value) { editable = value; }, revision(value) { revision = value; }, badBase(value) { badBase = value; },
    click(id) { const node = nodes['tx-' + id]; assert(node, id); assert(!node.disabled, 'Disabled: ' + id); node.onclick({ target: node }); },
    input(id, value, extras = {}) { const node = nodes['tx-' + id]; node.value = String(value); node.oninput({ target: node, ...extras }); },
    select(id, value) { const node = nodes['tx-' + id]; node.value = String(value); node.onchange({ target: node }); },
    check(id, value) { const node = nodes['tx-' + id]; node.checked = value; node.onchange({ target: node }); },
    emit(scope, kind) { for (const fn of [...(listeners[scope][kind] || [])]) fn(); },
    snapshot() { return realm(draft); }, expected(recipe, source = committed) { const out = copy(source); env.MintTextOverlay.render(out.getContext('2d'), out.width, out.height, realm(recipe)); return out; }
  };
}

test('blank add starts at identity with safe unique ID and no eager edit-base allocation', () => {
  const h = harness({ editable: true });
  assert.equal(h.draft.type, 'text-overlay'); assert.equal(h.draft.action, 'add'); assert.equal(h.draft.recipe.text, '');
  assert.match(h.draft.id, /^text-[a-z0-9-]+$/); assert.equal(h.ui.changed(h.draft), false);
  assert.equal(h.editRequests, 0); assert.equal(h.nodes['tx-edit-latest'].disabled, false);
  assert.deepEqual(pixels(h.ui.preview(h.draft)), pixels(h.committed));
  const first = h.draft.id; h.click('new'); assert.notEqual(h.draft.id, first); assert.equal(h.confirmations.length, 0);
  assert(h.nodes.toolPanel.markup.includes('不同系统上的字形和换行可能不同'));
  assert(h.nodes.toolPanel.markup.includes('旧版文字与贴纸保持原样'));
});

test('multiline textarea preserves text as data without HTML interpolation', () => {
  const h = harness(), text = '<img src=x onerror=evil()>\n中文与🙂<b>第二行</b>';
  h.input('text', text); assert.equal(h.draft.recipe.text, text); assert.equal(h.nodes['tx-text'].value, text);
  assert(!h.nodes.toolPanel.markup.includes(text)); assert(h.nodes.toolPanel.markup.includes('<textarea'));
  assert.equal(h.ui.changed(h.draft), true); assert.notEqual(hash(h.ui.preview(h.draft)), hash(h.committed));
  assert.equal(h.committed.resizes.length, 0); assert(h.nodes['tx-count'].textContent.includes('/500'));
});

test('all typography controls update the real validated recipe and pixel rendering', () => {
  const h = harness(); h.input('text', 'Actual text\nSecond line');
  h.select('fontFamily', 'serif'); h.select('align', 'right'); h.check('bold', false); h.check('italic', true);
  h.check('shadow', true); h.select('color', '#aaddff'); h.select('outlineColor', '#101010');
  for (const [key, value] of [['size', .15], ['boxWidth', .65], ['lineHeight', 1.6], ['rotation', 23], ['opacity', .8], ['outlineWidth', .08]]) h.input(key, value);
  const r = plain(h.draft.recipe);
  assert.deepEqual([r.fontFamily, r.align, r.bold, r.italic, r.shadow, r.color, r.outlineColor], ['serif', 'right', false, true, true, '#aaddff', '#101010']);
  assert.deepEqual([r.size, r.boxWidth, r.lineHeight, r.rotation, r.opacity, r.outlineWidth], [.15, .65, 1.6, 23, .8, .08]);
  assert.equal(hash(h.ui.preview(h.draft)), hash(h.expected(r))); assert.notEqual(hash(h.ui.preview(h.draft)), hash(h.committed));
  h.input('opacity', 0); assert.equal(h.ui.changed(h.draft), false); assert.deepEqual(pixels(h.ui.preview(h.draft)), pixels(h.committed));
});

test('Unicode and line limits reject entire edits, including invalid control input', () => {
  const h = harness(); h.input('size', .01); h.input('boxWidth', 1); h.input('text', '🙂'.repeat(500));
  assert.equal(Array.from(h.draft.recipe.text).length, 500);
  let before = JSON.stringify(h.draft); h.input('text', '🙂'.repeat(501)); assert.equal(JSON.stringify(h.draft), before); assert.equal(Array.from(h.nodes['tx-text'].value).length, 500);
  h.input('text', Array(12).fill('line').join('\n')); before = JSON.stringify(h.draft);
  for (const invalid of [Array(13).fill('line').join('\n'), 'hello\u0000bad', '\ud800']) { h.input('text', invalid); assert.equal(JSON.stringify(h.draft), before); }
  h.select('fontFamily', 'url(https://example.invalid/font)'); assert.equal(JSON.stringify(h.draft), before);
  h.input('size', NaN); assert.equal(JSON.stringify(h.draft), before); assert(h.notices.length >= 6);
});

test('preflight rejects over-128 wrapped lines before mutation, also on resize controls', () => {
  const h = harness(); h.input('size', .5); h.input('boxWidth', .05); h.input('text', 'safe');
  let before = JSON.stringify(h.draft); h.input('text', 'W'.repeat(200)); assert.equal(JSON.stringify(h.draft), before); assert.equal(h.nodes['tx-text'].value, 'safe');
  h.input('size', .01); h.input('boxWidth', 1); h.input('text', 'W'.repeat(200));
  h.input('size', .5); before = JSON.stringify(h.draft); h.input('boxWidth', .05); assert.equal(JSON.stringify(h.draft), before); assert.equal(h.draft.recipe.boxWidth, 1);
  assert(h.notices.at(-1).includes('128'));
});

test('composition input remains provisional until compositionend', () => {
  const h = harness(); h.input('text', '旧文字'); h.input('text', '中文输入', { isComposing: true }); assert.equal(h.draft.recipe.text, '旧文字');
  const node = h.nodes['tx-text']; node.oncompositionend({ target: node }); assert.equal(h.draft.recipe.text, '中文输入');
});

test('Edit Latest is explicit and previews replace old pixels without double printing', () => {
  const h = harness({ editable: true }), committedHash = hash(h.committed), original = h.editable;
  assert.equal(h.editRequests, 0); h.click('edit-latest');
  assert.equal(h.editRequests, 1); assert.equal(h.draft.action, 'replace'); assert.equal(h.draft.id, original.id); assert.equal(h.ui.changed(h.draft), false);
  assert.equal(hash(h.ui.preview(h.draft)), committedHash);
  h.input('text', 'NEW WORDS'); h.select('color', '#ffe477'); h.input('rotation', -18);
  assert.equal(h.ui.changed(h.draft), true); assert.equal(hash(h.ui.preview(h.draft)), hash(h.expected(h.draft.recipe, h.cleanBase)));
  assert.notEqual(hash(h.ui.preview(h.draft)), hash(h.expected(h.draft.recipe, h.committed)));
  assert.equal(hash(h.committed), committedHash); assert.deepEqual(h.editable, original); assert.equal(h.committed.resizes.length, 0);
  h.input('text', original.recipe.text); h.select('color', original.recipe.color); h.input('rotation', original.recipe.rotation); assert.equal(h.ui.changed(h.draft), false);
});

test('empty replacement is explicit undoable removal; empty new paragraph is not a change', () => {
  const h = harness({ editable: true }); h.click('edit-latest'); h.click('clear');
  assert.equal(h.draft.recipe.text, ''); assert.equal(h.ui.changed(h.draft), true); assert.equal(h.draft.action, 'replace');
  assert.equal(hash(h.ui.preview(h.draft)), hash(h.cleanBase)); assert(h.nodes['tx-status'].textContent.includes('移除'));
  const effective = h.env.MintTextOverlayOperation.collapse(h.realm([h.editable, plain(h.draft)]));
  const replay = copy(h.cleanBase); h.ui.apply(replay, effective[0]); assert.equal(hash(replay), hash(h.cleanBase));
  const undone = h.env.MintTextOverlayOperation.collapse(h.realm([h.editable]));
  const restore = copy(h.cleanBase); h.ui.apply(restore, undone[0]); assert.equal(hash(restore), hash(h.committed));
  const newer = harness(); assert.equal(newer.ui.changed(newer.draft), false);
});

test('apply accepts collapsed add only and replays after UI release', () => {
  const h = harness(); h.input('text', 'Persisted\nParagraph'); h.input('rotation', 12); const saved = h.snapshot(), expected = h.ui.preview(h.draft);
  h.ui.release(); const out = copy(h.committed); assert.equal(h.ui.apply(out, saved), out); assert.equal(hash(out), hash(expected));
  const invalid = h.realm({ ...plain(saved), action: 'replace' }), before = hash(out);
  assert.throws(() => h.ui.apply(out, invalid), /collapsed/); assert.equal(hash(out), before);
});

test('relative drag does not teleport; only valid pointer-up commits', () => {
  const h = harness(); h.input('text', 'Move me'); const d = h.draft, q = h.ui.start(d, p(.15, .2));
  const initial = plain(d.recipe); h.ui.move(d, p(.25, .35), q);
  assert.deepEqual(plain(d.recipe), initial); assert.equal(h.ui.changed(d), true);
  assert.equal(hash(h.ui.preview(d)), hash(h.expected({ ...initial, x: .6, y: .65 })));
  h.ui.finish(d, p(.25, .35), q, false); assert(Math.abs(d.recipe.x - .6) < 1e-12); assert(Math.abs(d.recipe.y - .65) < 1e-12);
  const committed = JSON.stringify(d); h.ui.finish(d, p(.9, .9), q, false); assert.equal(JSON.stringify(d), committed);
  const click = h.ui.start(d, p(.1, .1)); h.ui.finish(d, p(.1, .1), click, false); assert.equal(JSON.stringify(d), committed);
  const edge = h.ui.start(d, p(.1, .1)); h.ui.finish(d, p(1, 1), edge, false); assert.equal(d.recipe.x, 1); assert.equal(d.recipe.y, 1);
});

test('unchanged replacement drag renders provisionally without marking draft dirty', () => {
  const h = harness({ editable: true }); h.click('edit-latest'); const d = h.draft, q = h.ui.start(d, p(.3, .3)), before = JSON.stringify(d);
  h.ui.move(d, p(.45, .5), q); assert.equal(JSON.stringify(d), before); assert.equal(h.ui.changed(d), false);
  assert.notEqual(hash(h.ui.preview(d)), hash(h.committed)); h.ui.finish(d, p(.45, .5), q, false); assert.equal(h.ui.changed(d), true);
});

test('cancel, blur, hidden page and obsolete pointer preserve exact starting draft', () => {
  const h = harness(); h.input('text', 'Safe position'); const d = h.draft, before = JSON.stringify(d), image = hash(h.ui.preview(d));
  for (const mode of ['cancel', 'blur', 'hidden']) {
    const q = h.ui.start(d, p(.25, .3)); h.ui.move(d, p(.4, .45), q);
    if (mode === 'cancel') h.ui.finish(d, p(.4, .45), q, true);
    else if (mode === 'blur') h.emit('window', 'blur');
    else { h.env.document.hidden = true; h.emit('document', 'visibilitychange'); h.env.document.hidden = false; }
    h.ui.finish(d, p(.8, .8), q, false); assert.equal(JSON.stringify(d), before); assert.equal(hash(h.ui.preview(d)), image);
  }
  const old = h.ui.start(d, p(.2, .2)), replacement = h.ui.start(d, p(.3, .3));
  h.ui.finish(d, p(.9, .9), old, false); assert.equal(JSON.stringify(d), before);
  h.ui.finish(d, p(.3, .3), replacement, false); assert.equal(JSON.stringify(d), before);
});

test('revision changes, invalid points and edits during a drag cannot commit stale geometry', () => {
  const h = harness(); h.input('text', 'Version guard'); const d = h.draft, before = JSON.stringify(d);
  const q = h.ui.start(d, p(.2, .2)); h.ui.move(d, p(.4, .4), q); h.revision(2); h.ui.finish(d, p(.8, .8), q, false);
  assert.equal(JSON.stringify(d), before); assert.throws(() => h.ui.preview(d), /版本/); assert.equal(h.ui.start(d, p(.3, .3)), null);
  h.input('text', 'stale'); assert.equal(JSON.stringify(d), before); h.revision(1);
  const invalid = h.ui.start(d, p(.2, .2)); h.ui.move(d, p(NaN, .5), invalid); h.ui.finish(d, p(.8, .8), invalid, false); assert.equal(JSON.stringify(d), before);
  const other = h.ui.start(d, p(.2, .2)); h.ui.move(d, p(.4, .4), other); h.select('color', '#001122'); h.ui.finish(d, p(.8, .8), other, false);
  assert.equal(d.recipe.x, .5); assert.equal(d.recipe.y, .5); assert.equal(d.recipe.color, '#001122');
});

test('switching mode confirms discard and delayed confirmation cannot overwrite newer input', () => {
  const h = harness({ editable: true }); h.input('text', 'Unsaved'); const initial = h.draft;
  h.click('edit-latest'); assert.equal(h.editRequests, 0); assert.equal(h.confirmations.length, 1); assert.equal(h.draft, initial);
  h.input('text', 'Newer unsaved'); h.confirmations[0].yes(); assert.equal(h.editRequests, 0); assert.equal(h.draft, initial);
  h.click('edit-latest'); h.confirmations[1].yes(); assert.equal(h.draft.action, 'replace'); assert.equal(h.editRequests, 1);
  const editBase = h.editBases[0]; h.click('new'); assert.equal(h.draft.action, 'add'); assert(editBase.resizes.some(([k, n]) => k === 'width' && n === 0));
  assert.equal(h.committed.resizes.length, 0);
});

test('bad edit base is rejected without releasing committed pixels or losing current draft', () => {
  const h = harness({ editable: true }), before = h.draft, original = hash(h.committed); h.badBase(true); h.click('edit-latest');
  assert.equal(h.draft, before); assert.equal(h.draft.action, 'add'); assert.equal(hash(h.committed), original); assert.equal(h.committed.resizes.length, 0); assert(h.notices.at(-1).includes('底图无效'));
});

test('hostile saved IDs never enter markup and unavailable legacy edit stays disabled', () => {
  const h = harness({ editable: true, id: '<script>alert(1)</script>' }); h.click('edit-latest');
  assert.equal(h.draft.id, '<script>alert(1)</script>'); assert(!h.nodes.toolPanel.markup.includes('<script>'));
  const none = harness(); assert.equal(none.nodes['tx-edit-latest'].disabled, true); assert.equal(none.editRequests, 0);
});

test('repeated setup/release detaches listeners, releases edit bases and invalidates old controls', () => {
  const h = harness({ editable: true });
  for (let i = 0; i < 4; i++) {
    h.click('edit-latest'); const node = h.nodes['tx-text'], stale = node.oninput, d = h.draft, before = JSON.stringify(d), base = h.editBases.at(-1);
    assert.equal(h.listeners.window.blur.size, 1); assert.equal(h.listeners.document.visibilitychange.size, 1);
    h.ui.release(); assert.equal(h.listeners.window.blur.size, 0); assert.equal(h.listeners.document.visibilitychange.size, 0); assert.equal(node.oninput, null);
    assert(base.resizes.some(([k, n]) => k === 'width' && n === 0)); stale({ target: { value: 'stale handler' } }); assert.equal(JSON.stringify(d), before);
    h.ui.setup(h.adapter); assert.equal(h.committed.resizes.length, 0);
  }
});

test('preview returns caller-owned clones and releases failed temporary without changing either base', () => {
  const h = harness({ editable: true }); h.click('edit-latest'); h.input('text', 'New');
  const one = h.ui.preview(h.draft), two = h.ui.preview(h.draft); assert.notEqual(one, two); assert.notEqual(one, h.committed); assert.notEqual(one, h.editBases[0]);
  const baseHash = hash(h.editBases[0]), originalHash = hash(h.committed);
  h.env.MintTextOverlay = { ...h.env.MintTextOverlay, render(ctx) { ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 0, 100, 100); throw Error('forced runtime Canvas failure'); } };
  assert.throws(() => h.ui.preview(h.draft), /runtime Canvas/); const failed = h.allocated.at(-1);
  assert(failed.resizes.some(([k, n]) => k === 'width' && n === 0)); assert.equal(hash(h.editBases[0]), baseHash); assert.equal(hash(h.committed), originalHash);
});

test('overlay draws rotated core corners and restores context state', () => {
  const h = harness(); h.input('text', 'Bounds'); h.input('rotation', 31); h.input('outlineWidth', .08); h.check('shadow', true);
  const c = canvas(240, 180), ctx = c.getContext('2d'); ctx.strokeStyle = '#123456'; ctx.lineWidth = 9; ctx.translate(2, 3);
  const old = ctx.getTransform(), starts = [], lines = [], move = ctx.moveTo.bind(ctx), line = ctx.lineTo.bind(ctx);
  ctx.moveTo = (...args) => { starts.push(args); move(...args); }; ctx.lineTo = (...args) => { lines.push(args); line(...args); };
  const plan = h.env.MintTextOverlay.layout(ctx, c.width, c.height, h.draft.recipe); h.ui.overlay(ctx, c.width, c.height, h.draft, null);
  assert.deepEqual(starts[0], [plan.corners[0].x, plan.corners[0].y]); assert.deepEqual(lines[0], [plan.corners[1].x, plan.corners[1].y]);
  // This native Canvas version exposes a stale strokeStyle getter after restore.
  // Verify actual subsequent stroke pixels, not that unreliable cached getter.
  assert.equal(ctx.lineWidth, 9); assert.deepEqual(ctx.getTransform(), old);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.restore();
  ctx.beginPath(); ctx.moveTo(20, 40); ctx.lineTo(100, 40); ctx.stroke();
  assert.deepEqual(Array.from(ctx.getImageData(50, 43, 1, 1).data), [0x12, 0x34, 0x56, 255]);
});

test('missing core fails closed with no successful draft', () => {
  for (const missing of ['text-overlay.js', 'text-overlay-operation.js']) {
    const h = harness({ missing }); assert.equal(h.draft, null); assert(h.notices.at(-1).includes('未加载')); assert.equal(h.committed.resizes.length, 0);
  }
});
