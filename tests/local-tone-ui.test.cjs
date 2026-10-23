'use strict';
// Shipped UI handlers and pixel/mask cores under a controlled DOM, not Android-device QA.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assets = path.join(__dirname, '../app/src/main/assets');
const plain = value => JSON.parse(JSON.stringify(value));
const p = (x, y) => ({ x, y });
function canvas(width = 64, height = 48, input) {
  let data = input ? new Uint8ClampedArray(input) : new Uint8ClampedArray(width * height * 4);
  if (!input) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([70 + x % 70, 90 + y % 60, 60 + (x + y) % 50, y === 0 ? 0 : 255], (y * width + x) * 4);
  const calls = [], c = { width, height, calls, get data() { return data; } };
  const ctx = {
    getImageData() { return { width: c.width, height: c.height, data: new Uint8ClampedArray(data) }; },
    createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData(image) { data = new Uint8ClampedArray(image.data); },
    drawImage(image, ...args) { calls.push({ type: 'image', image, args }); },
    save() {}, restore() {}, beginPath() {}, stroke() {}, setLineDash() {},
    moveTo(...args) { calls.push({ type: 'move', args }); }, lineTo(...args) { calls.push({ type: 'line', args }); },
    ellipse(...args) { calls.push({ type: 'ellipse', args }); }, arc(...args) { calls.push({ type: 'arc', args }); }
  };
  c.getContext = () => ctx; return c;
}
function harness(options = {}) {
  const nodes = {}, notices = [], listeners = { window: {}, document: {} }; let draft, revision = 7, renders = 0;
  const base = canvas(options.width || 64, options.height || 48);
  const add = (scope, kind, fn) => (listeners[scope][kind] ||= new Set()).add(fn);
  const remove = (scope, kind, fn) => listeners[scope][kind]?.delete(fn);
  function element(id) {
    const classes = new Set(), node = { id, value: '', disabled: false, checked: false, hidden: false, textContent: '', classList: { toggle(name, active) { active ? classes.add(name) : classes.delete(name); }, contains: name => classes.has(name) } };
    Object.defineProperty(node, 'innerHTML', { get() { return this.markup || ''; }, set(value) {
      this.markup = value;
      if (id !== 'toolPanel') return;
      for (const match of value.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
        const el = element(match[3]); el.value = match[2].match(/\bvalue="([^"]*)"/)?.[1] || '';
        el.checked = /\bchecked\b/.test(match[2]); el.disabled = /\bdisabled\b/.test(match[2]); el.hidden = /\bhidden\b/.test(match[2]);
      }
    } });
    nodes[id] = node; return node;
  }
  element('toolPanel'); element('editLabel');
  const env = { console, Uint8Array, Uint8ClampedArray, Float32Array, Float64Array, ArrayBuffer,
    document: { hidden: false, getElementById: id => nodes[id] || null, createElement: tag => { assert.equal(tag, 'canvas'); return canvas(1, 1); }, addEventListener: (kind, fn) => add('document', kind, fn), removeEventListener: (kind, fn) => remove('document', kind, fn) },
    addEventListener: (kind, fn) => add('window', kind, fn), removeEventListener: (kind, fn) => remove('window', kind, fn) };
  env.window = env; vm.createContext(env);
  for (const file of ['manual-tools.js', 'local-adjustments.js', 'local-tone-operation.js', 'local-tone-ui.js']) if (file !== options.missing) vm.runInContext(fs.readFileSync(path.join(assets, file), 'utf8'), env, { filename: file });
  const adapter = { revision: () => revision, getDraft: () => draft, setDraft: value => { draft = value; }, getCanvas: () => base, render: () => renders++, toast: text => notices.push(text), hint() {}, confirm() { throw Error('Unexpected confirmation'); } };
  const ui = env.LocalToneUI; ui.setup(adapter);
  return { env, ui, adapter, nodes, base, notices, listeners, get draft() { return draft; }, set draft(value) { draft = value; }, get renders() { return renders; }, revision(value) { revision = value; },
    click(id) { const el = nodes['lt-' + id]; assert(el, id); assert(!el.disabled, 'Disabled: ' + id); el.onclick({ target: el }); },
    input(id, value, finish = true) { const el = nodes['lt-' + id]; assert(el, id); el.value = String(value); el.oninput({ target: el }); if (finish && el.onchange) el.onchange({ target: el }); },
    select(id) { nodes['lt-layer-list'].value = id; nodes['lt-layer-list'].onchange({ target: nodes['lt-layer-list'] }); },
    check(id, value) { const el = nodes['lt-' + id]; el.checked = value; el.onchange({ target: el }); },
    rename(value) { nodes['lt-layer-name'].value = value; this.click('rename'); },
    stroke(points, cancelled = false) { const d = draft, q = ui.start(d, points[0]); for (const point of points.slice(1, -1)) ui.move(d, point, q); ui.finish(d, points.at(-1), q, cancelled); return q; },
    emit(scope, kind) { for (const fn of [...(listeners[scope][kind] || [])]) fn({ type: kind }); },
    copy() { return canvas(base.width, base.height, base.data); },
    snapshot() { env.__snapshot = JSON.stringify(draft); return vm.runInContext('JSON.parse(__snapshot)', env); },
    preview() { const c = this.copy(); ui.apply(c, draft); return c; }
  };
}
function active(h) { return h.draft.layers.find(layer => layer.id === h.nodes['lt-layer-list'].value); }
function selection(h) { return active(h).mask.selection; }

test('starts with no layers and exact pixel identity; explicit neutral layers are real metadata edits', () => {
  const h = harness(); assert.equal(h.draft.sourceRevision, '7'); assert.equal(h.ui.changed(h.draft), false); assert.deepEqual(h.preview().data, h.base.data);
  assert.equal(h.ui.start(h.draft, p(.5, .5)), null);
  for (const type of ['radial', 'linear', 'selection']) { h.click('add-' + type); assert.equal(h.ui.changed(h.draft), true); assert.deepEqual(h.preview().data, h.base.data); }
  assert.deepEqual(Object.keys(h.draft).sort(), ['layers', 'sourceRevision', 'type']);
  assert(h.nodes.toolPanel.markup.includes('本轮最多8层，应用后整组可撤销；原图不覆盖'));
});
test('four real adjustment controls replay local pixels, preserve alpha, hidden RGB and source', () => {
  const h = harness(), source = h.base.data.slice(); h.click('add-radial');
  for (const [key, value] of [['exposure', 30], ['contrast', 20], ['saturation', -25], ['temperature', 15]]) h.input(key, value);
  assert.deepEqual(plain(active(h).adjustments), { exposure: 30, contrast: 20, saturation: -25, temperature: 15 });
  const out = h.preview(); let affected = 0;
  for (let i = 0; i < out.data.length; i += 4) {
    affected += out.data[i] !== source[i] || out.data[i + 1] !== source[i + 1] || out.data[i + 2] !== source[i + 2];
    assert.equal(out.data[i + 3], source[i + 3]); if (!source[i + 3]) assert.deepEqual(out.data.slice(i, i + 4), source.slice(i, i + 4));
  }
  assert(affected > 0 && affected < h.base.width * h.base.height / 2); assert.deepEqual(h.base.data, source);
  assert.deepEqual(h.preview().data, out.data);
  h.check('enabled', false); assert.deepEqual(h.preview().data, source); h.check('enabled', true);
  h.input('opacity', 0); assert.deepEqual(h.preview().data, source); assert(h.ui.changed(h.draft));
});
test('each layer retains values; selector, rename, hide, delete and local undo restore exact snapshots', () => {
  const h = harness(); h.click('add-radial'); const first = active(h).id; h.input('exposure', 20); h.rename('脸部 <保留>');
  h.click('add-linear'); const second = active(h).id; h.input('temperature', -20); h.select(first);
  assert.equal(h.nodes['lt-exposure'].value, '20'); assert.equal(h.nodes['lt-temperature'].value, '0');
  assert(h.nodes['lt-layer-list'].markup.includes('&lt;保留&gt;'));
  const before = JSON.stringify(h.draft); h.click('delete'); assert.equal(h.draft.layers.length, 1); assert.equal(active(h).id, second);
  h.click('undo'); assert.equal(JSON.stringify(h.draft), before); assert.equal(active(h).id, first);
  h.click('clear-batch'); assert.equal(h.ui.changed(h.draft), false); h.click('undo'); assert.equal(JSON.stringify(h.draft), before);
  const name = active(h).name; h.rename(''); assert.equal(active(h).name, name); h.rename('x'.repeat(81)); assert.equal(active(h).name, name);
});
test('slider input gestures coalesce into one undo without losing other edits', () => {
  const h = harness(); h.click('add-radial'); const baseline = JSON.stringify(h.draft);
  h.input('exposure', 10, false); h.input('exposure', 20, false); h.input('exposure', 30, true);
  h.click('undo'); assert.equal(JSON.stringify(h.draft), baseline);
  h.click('undo'); assert.equal(h.draft.layers.length, 0);
});
test('radial center and radii use transactional drag and explicit geometry sliders', () => {
  const h = harness(); h.click('add-radial'); const before = JSON.stringify(h.draft), q = h.ui.start(h.draft, p(.5, .5));
  h.ui.move(h.draft, p(.6, .6), q); assert.equal(JSON.stringify(h.draft), before); h.ui.finish(h.draft, p(.65, .6), q, false);
  assert(Math.abs(active(h).mask.cx - .65) < 1e-12); assert(Math.abs(active(h).mask.cy - .6) < 1e-12);
  h.stroke([p(.9, .6), p(.95, .6)]); assert(Math.abs(active(h).mask.rx - .3) < 1e-10);
  h.input('radial-ry', 15); h.input('radial-feather', 80); assert.equal(active(h).mask.ry, .15); assert.equal(active(h).mask.feather, .8);
  const current = JSON.stringify(h.draft); h.stroke([p(.5, .5), p(.3, .3)], true); assert.equal(JSON.stringify(h.draft), current);
});
test('linear endpoint-to-endpoint drags, reverse and degenerate rejection preserve valid state', () => {
  const h = harness(); h.click('add-linear'); h.stroke([p(.1, .2), p(.8, .7)]);
  assert.deepEqual(plain(active(h).mask), { kind: 'linear', x0: .1, y0: .2, x1: .8, y1: .7, reverse: false });
  h.stroke([p(.8, .7), p(.9, .8)]); assert.equal(active(h).mask.x1, .9); h.check('linear-reverse', true); assert(active(h).mask.reverse);
  const before = JSON.stringify(h.draft); h.stroke([p(.4, .4), p(.401, .401)]); assert.equal(JSON.stringify(h.draft), before); assert(h.notices.at(-1).includes('两端'));
  h.stroke([p(.4, .4)]); assert.equal(JSON.stringify(h.draft), before);
});
test('explicit empty brush selection protects every pixel; all/clear are never unrestricted null', () => {
  const h = harness(); h.click('add-selection'); h.input('exposure', 40);
  assert.equal(selection(h).base, 'none'); assert.deepEqual(h.preview().data, h.base.data);
  h.click('selection-all'); assert.equal(selection(h).base, 'all'); assert.notDeepEqual(h.preview().data, h.base.data);
  h.click('selection-clear'); assert.equal(selection(h).base, 'none'); assert.notEqual(selection(h), null); assert.deepEqual(h.preview().data, h.base.data);
  h.click('undo'); assert.equal(selection(h).base, 'all');
});
test('brush includes pointer-up endpoint; repeated/late events cannot duplicate a committed stroke', () => {
  const h = harness(); h.click('add-selection'); const d = h.draft, q = h.ui.start(d, p(.2, .4));
  h.ui.move(d, p(.3, .4), q); assert.equal(selection(h).commands.length, 0); h.ui.finish(d, p(.6, .4), q, false);
  assert.deepEqual(plain(selection(h).commands[0].points), [p(.2, .4), p(.3, .4), p(.6, .4)]);
  const before = JSON.stringify(d); h.ui.finish(d, p(.7, .5), q, false); h.ui.finish(d, p(.7, .5), q, true); h.ui.move(d, p(.8, .4), q); assert.equal(JSON.stringify(d), before);
  h.input('exposure', 35); const out = h.preview(), i = (Math.round(.4 * (out.height - 1)) * out.width + Math.round(.5 * (out.width - 1))) * 4; assert(out.data[i] > h.base.data[i]);
});
test('brush add/subtract, invert, feather and selection undo preserve shared recipe semantics', () => {
  const h = harness(); h.click('add-selection'); h.click('selection-all'); h.click('selection-subtract'); h.stroke([p(.5, .5)]);
  assert.equal(selection(h).commands[0].mode, 'subtract'); h.input('selection-feather', 3); assert.equal(selection(h).feather, .03);
  h.click('selection-invert'); h.click('selection-add'); h.stroke([p(.7, .5)]); assert.equal(selection(h).commands[1].mode, 'subtract');
  h.click('selection-subtract'); h.stroke([p(.6, .5)]); assert.equal(selection(h).commands[2].mode, 'add');
  h.click('selection-undo'); assert.equal(selection(h).commands.length, 2);
  const weights = h.env.MintManualTools.rasterizeSelection(65, 65, selection(h), vm.runInContext('({sourceRevision:"7"})', h.env));
  assert(weights[Math.round(.5 * 64) * 65 + Math.round(.5 * 64)] > .9); assert.equal(weights[0], 0);
});
test('lasso rejects short/collinear paths byte-exactly, accepts nonzero geometry and even-odd bowtie', () => {
  const h = harness(); h.click('add-selection'); h.click('mode-lasso'); const before = JSON.stringify(h.draft);
  for (const points of [[p(.2, .2)], [p(.2, .2), p(.3, .3)], [p(.2, .2), p(.3, .3), p(.4, .4)]]) { h.stroke(points); assert.equal(JSON.stringify(h.draft), before); }
  h.stroke([p(.2, .2), p(.8, .8), p(.2, .8), p(.8, .2)]); assert.equal(selection(h).commands.length, 1);
  h.input('exposure', 30); assert.notDeepEqual(h.preview().data, h.base.data);
});
test('cancelled, interrupted and out-of-bounds pointers leave the entire operation byte-exact', () => {
  for (const kind of ['radial', 'linear', 'selection']) {
    const h = harness(); h.click('add-' + kind); const d = h.draft, before = JSON.stringify(d);
    h.stroke([p(.2, .2), p(.8, .8)], true); assert.equal(JSON.stringify(d), before);
    const q = h.ui.start(d, p(.3, .4)); h.ui.move(d, p(Infinity, .5), q); h.ui.finish(d, p(.7, .8), q, false); assert.equal(JSON.stringify(d), before);
    const q2 = h.ui.start(d, p(.2, .2)); h.emit('window', 'blur'); h.ui.finish(d, p(.8, .8), q2, false); assert.equal(JSON.stringify(d), before);
    const q3 = h.ui.start(d, p(.2, .2)); h.env.document.hidden = true; h.emit('document', 'visibilitychange'); h.ui.finish(d, p(.8, .8), q3, false); assert.equal(JSON.stringify(d), before);
  }
});
test('switching tool mode, selection action, layer, delete or undo invalidates stale pointers', () => {
  for (const action of ['mode-lasso', 'selection-clear', 'selection-all', 'selection-invert', 'delete', 'undo']) {
    const h = harness(); h.click('add-selection'); const d = h.draft, q = h.ui.start(d, p(.2, .2)); h.ui.move(d, p(.4, .4), q); h.click(action);
    const before = JSON.stringify(d); h.ui.finish(d, p(.8, .8), q, false); assert.equal(JSON.stringify(d), before, action);
  }
  const h = harness(); h.click('add-selection'); const first = active(h).id; h.click('add-selection'); const q = h.ui.start(h.draft, p(.2, .2)); h.select(first); const before = JSON.stringify(h.draft); h.ui.finish(h.draft, p(.8, .8), q, false); assert.equal(JSON.stringify(h.draft), before);
});
test('new pointer supersedes old, replaced draft and changed source revision cannot commit', () => {
  const h = harness(); h.click('add-selection'); const d = h.draft, first = h.ui.start(d, p(.2, .2)), second = h.ui.start(d, p(.6, .6));
  h.ui.finish(d, p(.3, .3), first, false); assert.equal(selection(h).commands.length, 0); h.ui.finish(d, p(.7, .6), second, false); assert.equal(selection(h).commands.length, 1);
  let q = h.ui.start(d, p(.8, .8)), before = JSON.stringify(d); h.draft = null; h.ui.finish(d, p(.9, .9), q, false); assert.equal(JSON.stringify(d), before); h.draft = d;
  q = h.ui.start(d, p(.8, .8)); h.revision(8); h.ui.finish(d, p(.9, .9), q, false); assert.equal(JSON.stringify(d), before); assert.equal(h.ui.start(d, p(.8, .8)), null);
});
test('stroke point bound includes pointer-up; limit errors do not partially save geometry', () => {
  const h = harness({ width: 16, height: 16 }); h.click('add-selection'); let q = h.ui.start(h.draft, p(.1, .1));
  for (let i = 1; i < 512; i++) h.ui.move(h.draft, p(.1 + i / 1000, .1), q);
  h.ui.finish(h.draft, p(.611, .1), q, false); assert.equal(selection(h).commands[0].points.length, 512);
  const before = JSON.stringify(h.draft); q = h.ui.start(h.draft, p(.1, .2));
  for (let i = 1; i < 512; i++) h.ui.move(h.draft, p(.1 + i / 1000, .2), q);
  h.ui.finish(h.draft, p(.7, .2), q, false); assert.equal(JSON.stringify(h.draft), before); assert(h.notices.at(-1).includes('512'));
});
test('at most eight layers; shared per-selection command bound stays fail-closed', () => {
  const h = harness({ width: 8, height: 8 }); for (let i = 0; i < 8; i++) h.click('add-selection'); assert.equal(h.draft.layers.length, 8); assert(h.nodes['lt-add-selection'].disabled);
  for (let i = 0; i < 128; i++) h.stroke([p(.2, .2)]);
  assert.equal(selection(h).commands.length, 128); const before = JSON.stringify(h.draft); h.stroke([p(.3, .3)]); assert.equal(JSON.stringify(h.draft), before); assert(h.notices.at(-1).includes('128'));
  h.select(h.draft.layers[0].id); h.stroke([p(.4, .4)]); assert.equal(JSON.stringify(h.draft), before); assert(h.notices.at(-1).includes('128'));
});
test('overlay uses shared radial and linear weights, real selection raster and current boundary', () => {
  const h = harness(); h.click('add-radial'); let target = canvas(64, 48); h.ui.overlay(target.getContext(), 64, 48, h.draft, null);
  let image = target.calls.find(call => call.type === 'image').image;
  for (const [x, y] of [[0, 0], [32, 24], [40, 24]]) { const expected = Math.round(h.env.MintLocalAdjustments.weight(active(h).mask, (x + .5) / 64, (y + .5) / 48) * 60); assert.equal(image.data[(y * 64 + x) * 4 + 3], expected); }
  assert(target.calls.some(call => call.type === 'ellipse' && call.args[0] === 32 && call.args[2] === 16));
  h.click('add-linear'); h.check('linear-reverse', true); target = canvas(64, 48); h.ui.overlay(target.getContext(), 64, 48, h.draft, null); image = target.calls.find(call => call.type === 'image').image; assert.equal(image.data[(24 * 64) * 4 + 3], 60); assert.equal(image.data[(24 * 64 + 63) * 4 + 3], 0);
  h.click('add-selection'); target = canvas(64, 48); h.ui.overlay(target.getContext(), 64, 48, h.draft, null); image = target.calls.find(call => call.type === 'image').image; assert.equal(image.data.filter((_, i) => i % 4 === 3).some(Boolean), false);
  h.stroke([p(.5, .5)]); target = canvas(64, 48); h.ui.overlay(target.getContext(), 64, 48, h.draft, null); image = target.calls.find(call => call.type === 'image').image; assert(image.data[(24 * 64 + 32) * 4 + 3] > 0); assert.equal(image.data[3], 0);
  h.check('show-mask', false); target = canvas(64, 48); h.ui.overlay(target.getContext(), 64, 48, h.draft, null); image = target.calls.find(call => call.type === 'image').image; assert.equal(image.data[(24 * 64 + 32) * 4 + 3], 0); assert(image.data.filter((_, i) => i % 4 === 3).some(Boolean), 'boundary remains visible without green fill');
});
test('preview rendering failure rejects prospective draft without discarding the previous operation', () => {
  const h = harness(); h.click('add-radial'); const before = JSON.stringify(h.draft), core = h.env.MintLocalToneOperation;
  h.env.MintLocalToneOperation = { ...core, apply() { throw Error('Manual-tool work budget exceeded'); } }; h.input('exposure', 20); assert.equal(JSON.stringify(h.draft), before); assert(h.notices.at(-1).includes('上限'));
  assert.throws(() => h.preview(), /budget/); h.env.MintLocalToneOperation = core;
});
test('release removes listeners, ignores retained controls and pointers, and permits saved replay', () => {
  const h = harness(); h.click('add-radial'); h.input('exposure', 30); const d = h.draft, saved = h.snapshot(), expected = h.preview(), staleClick = h.nodes['lt-delete'].onclick, q = h.ui.start(d, p(.5, .5));
  h.ui.release(); h.ui.release(); assert.equal(h.listeners.window.blur.size, 0); assert.equal(h.listeners.document.visibilitychange.size, 0); staleClick({}); h.ui.finish(d, p(.8, .8), q, false); assert.equal(JSON.stringify(d), JSON.stringify(saved));
  const replay = h.copy(); h.ui.apply(replay, saved); assert.deepEqual(replay.data, expected.data);
  h.ui.setup(h.adapter); assert.equal(h.listeners.window.blur.size, 1); assert.equal(h.listeners.document.visibilitychange.size, 1); staleClick({}); assert.equal(h.draft.layers.length, 0);
});
test('missing modules fail closed, including saved-operation replay after release', () => {
  for (const missing of ['manual-tools.js', 'local-adjustments.js', 'local-tone-operation.js']) { const h = harness({ missing }); assert.equal(h.draft, null); assert(h.notices.at(-1).includes('未加载')); assert.throws(() => h.ui.apply(h.copy(), {}), /未加载/); }
});


test('4096 shared selection points apply across all layers; undo frees the budget', () => {
  const h = harness({ width: 8, height: 8 });
  for (let layer = 0; layer < 8; layer++) {
    h.click('add-selection'); const q = h.ui.start(h.draft, p(.1, .3));
    for (let i = 1; i < 512; i++) h.ui.move(h.draft, p(.1 + i / 1000, .3), q);
    h.ui.finish(h.draft, p(.611, .3), q, false);
  }
  const before = JSON.stringify(h.draft); assert.equal(h.draft.layers.reduce((n, layer) => n + layer.mask.selection.commands[0].points.length, 0), 4096);
  h.stroke([p(.5, .5)]); assert.equal(JSON.stringify(h.draft), before); assert(h.notices.at(-1).includes('4096'));
  h.click('selection-undo'); h.stroke([p(.5, .5)]); assert.equal(selection(h).commands.length, 1); assert.equal(selection(h).commands[0].points.length, 1);
});
test('revision change blocks sliders, clear and local undo without a false success message', () => {
  const h = harness(); h.click('add-radial'); h.input('exposure', 20); const before = JSON.stringify(h.draft);
  h.revision(8);
  for (const action of [() => h.input('exposure', 30), () => h.click('clear-batch'), () => h.click('undo')]) {
    action(); assert.equal(JSON.stringify(h.draft), before); assert(h.nodes['lt-status'].textContent.includes('版本已改变'));
  }
  h.revision(7); h.click('undo'); assert.equal(active(h).adjustments.exposure, 0);
});
test('saved replay uses readback ImageData storage rather than a third full-frame allocation', () => {
  const h = harness(); h.click('add-radial'); h.input('exposure', 30); const c = h.copy();
  c.getContext().createImageData = () => { throw Error('third full-frame buffer'); };
  h.ui.apply(c, h.draft); assert.notDeepEqual(c.data, h.base.data);
});
