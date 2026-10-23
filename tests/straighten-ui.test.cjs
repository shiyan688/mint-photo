'use strict';
// Shipped UI, operation adapter, and shared rotation math in a controlled DOM.
// A small pixel-canvas fixture exercises delegation and ownership, not native
// Canvas interpolation. Native PNG/export rendering belongs to integration QA.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assets = path.join(__dirname, '../app/src/main/assets');
const plain = value => JSON.parse(JSON.stringify(value));
function harness(options = {}) {
  const nodes = {}, notices = [], hints = [], assessments = [], previews = [], canvases = [];
  let draft = null, revision = '1/1', renders = 0, assessmentOverride = null, renderFailures = 0;
  let full = { w: options.fullWidth || 1200, h: options.fullHeight || 800 };
  function canvas(width, height) {
    let w = width, h = height, bytes = new Uint8ClampedArray(w * h * 4);
    const c = { reads: 0, writes: 0, draws: 0, get bytes() { return bytes; }, getContext() {
      return { getImageData() { c.reads++; return { data: bytes.slice() }; }, createImageData(a, b) { return { data: new Uint8ClampedArray(a * b * 4) }; },
        putImageData(image) { bytes.set(image.data); c.writes++; }, drawImage(input, _x, _y, dw = w, dh = h) {
          c.draws++; const sw = input.width, sh = input.height;
          for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
            const from = (Math.min(sh - 1, Math.floor(y * sh / dh)) * sw + Math.min(sw - 1, Math.floor(x * sw / dw))) * 4;
            bytes.set(input.bytes.subarray(from, from + 4), (y * w + x) * 4);
          }
        } };
    } };
    Object.defineProperties(c, {
      width: { enumerable: true, get: () => w, set(value) { c.writes++; w = value; bytes = new Uint8ClampedArray(w * h * 4); } },
      height: { enumerable: true, get: () => h, set(value) { c.writes++; h = value; bytes = new Uint8ClampedArray(w * h * 4); } }
    });
    canvases.push(c); return c;
  }
  let source = canvas(options.width || 120, options.height || 80);
  for (let i = 0; i < source.bytes.length; i++) source.bytes[i] = (i * 29 + 11) % 256;
  function element(id, attrs = '') {
    const node = { id, value: '', checked: false, disabled: false, isConnected: true, textContent: '',
      click() { if (!this.disabled && this.onclick) return this.onclick({ target: this }); } };
    for (const k of ['min', 'max', 'step', 'type']) node[k] = attrs.match(new RegExp('\\b' + k + '="([^"]+)"'))?.[1] || '';
    nodes[id] = node; return node;
  }
  const panel = element('toolPanel'); element('editLabel'); panel.querySelector = selector => nodes[selector.slice(1)] || null;
  Object.defineProperty(panel, 'innerHTML', { get: () => panel.markup, set(html) {
    panel.markup = html;
    for (const id of Object.keys(nodes)) if (!['toolPanel', 'editLabel'].includes(id)) { nodes[id].isConnected = false; delete nodes[id]; }
    for (const match of html.matchAll(/<[a-z]+\b([^>]*\bid="([^"]+)"[^>]*)>/g)) element(match[2], match[1]);
  } });
  const env = { console, Uint8Array, Uint8ClampedArray, ArrayBuffer, Float64Array, Float32Array,
    document: { getElementById: id => nodes[id] || null, createElement() { throw Error('The adapter must own preview allocation'); } } };
  vm.createContext(env);
  const load = name => vm.runInContext(fs.readFileSync(path.join(assets, name), 'utf8'), env, { filename: name });
  if (!options.missingCore) load('straighten.js');
  if (!options.missingOperation) load('straighten-operation.js');
  const actualOperation = env.MintStraightenOperation;
  if (actualOperation) env.MintStraightenOperation = Object.freeze({ ...actualOperation, applyCanvas(input, op, create, opts) {
    const output = actualOperation.applyCanvas(input, op, create, opts); previews.push({ input, op, opts, output }); return output;
  } });
  load('straighten-ui.js');
  const adapter = { panel, getDraft: () => draft, setDraft: d => { draft = d; }, getCanvas: () => source,
    createCanvas: canvas, revision: () => revision, outputSize: () => full,
    render() { renders++; if (renderFailures > 0) { renderFailures--; throw Error('preview rendering failed'); } },
    toast: text => notices.push(text), hint: text => hints.push(text),
    assess(op) {
      assessments.push(op);
      if (assessmentOverride) return assessmentOverride(op);
      const result = {};
      for (const mode of ['original', 'working']) try {
        const w = mode === 'original' ? full.w : source.width, h = mode === 'original' ? full.h : source.height;
        result[mode] = { allowed: true, output: plain(actualOperation.plan(w, h, op).outputSize), error: '' };
      } catch (error) { result[mode] = { allowed: false, output: null, error: error.message }; }
      return result;
    } };
  const ui = env.StraightenUI, ready = ui.setup(adapter);
  return { env, ui, adapter, panel, nodes, notices, hints, assessments, previews, canvases, actualOperation, ready,
    get draft() { return draft; }, set draft(value) { draft = value; }, get source() { return source; }, get renders() { return renders; },
    setSource(value) { source = value; }, setRevision(value) { revision = value; }, setFull(w, h, basis) { full = basis === undefined ? { w, h } : { w, h, basis }; },
    assessWith(fn) { assessmentOverride = fn; }, failRender() { renderFailures++; }, replaceNode(id) { return element('st-' + id); },
    click(id) { return nodes['st-' + id].click(); },
    change(id, value) { const n = nodes['st-' + id]; n.value = String(value); return n.onchange && n.onchange({ target: n }); },
    input(value) { const n = nodes['st-angle']; n.value = String(value); return n.oninput && n.oninput({ target: n }); },
    grid(value) { const n = nodes['st-grid']; n.checked = value; return n.onchange && n.onchange({ target: n }); },
    run(code) { return vm.runInContext(code, env); }
  };
}
const allowed = (width = 130, height = 100) => ({ allowed: true, error: '', output: { width, height } });
const blocked = error => ({ allowed: false, error, output: null });

test('zero is a portable identity and angle controls describe real direction, units, dimensions, and source preservation', () => {
  const h = harness(); assert.equal(h.ready, h.draft);
  assert.deepEqual(plain(h.draft), { type: 'straighten', recipe: { version: 1, angle: 0, mode: 'expand' } });
  assert.equal(h.ui.changed(h.draft), false); assert.equal(h.ui.canApply(h.draft), false);
  const slider = h.nodes['st-angle']; assert.equal(slider.min, '-180'); assert.equal(slider.max, '180'); assert.equal(slider.step, '0.1');
  assert.equal(h.nodes['st-angle-number'].step, 'any'); assert.equal(h.nodes['st-grid'].checked, true);
  assert.match(h.panel.markup, /正数顺时针/); assert.match(h.panel.markup, /精确角度（度）/); assert.match(h.panel.markup, /不替换已保留原图/);
  assert.match(h.nodes['st-basis'].textContent, /1200 × 800.*120 × 80/);
  assert.match(h.nodes['st-basis'].textContent, /当前预览基准/); assert.doesNotMatch(h.nodes['st-basis'].textContent, /当前工作基准/);
  assert.match(h.nodes['st-preview-size'].textContent, /120 × 80/);
  assert.match(h.nodes['st-original-export'].textContent, /1200 × 800/); assert.match(h.nodes['st-working-export'].textContent, /120 × 80/);
  assert.match(h.panel.markup, /不补边、不放大/); assert.match(h.panel.markup, /PNG.*JPEG/); assert.doesNotMatch(h.panel.markup, /<canvas|<img|<script|type="file"/);
});
test('slider and numeric controls retain exact finite degrees without snapping near right angles', () => {
  const h = harness(); assert.equal(h.input(17.3), true); assert.equal(h.draft.recipe.angle, 17.3);
  for (const angle of [-180, -90, -0.1, 0.000000001, 89.99999999999999, 90.00000000000001, 180]) {
    assert.equal(h.change('angle-number', angle), true); assert.equal(h.draft.recipe.angle, angle);
    assert.equal(h.nodes['st-angle-number'].value, String(angle)); assert.equal(h.ui.canApply(h.draft), true);
  }
  h.change('angle-number', '1e-7'); assert.equal(h.draft.recipe.angle, 1e-7);
  h.change('angle-number', '-0'); assert.equal(Object.is(h.draft.recipe.angle, -0), false); assert.equal(h.ui.changed(h.draft), false);
});
test('expand and crop declare different real outputs; changing mode at zero is not an edit', () => {
  const h = harness(); h.change('mode', 'crop'); assert.equal(h.ui.changed(h.draft), false); assert.equal(h.ui.canApply(h.draft), false);
  h.input(30); const crop = h.nodes['st-working-export'].textContent; assert.match(h.nodes['st-mode-note'].textContent, /裁去边缘.*不补边、不放大/);
  h.change('mode', 'expand'); assert.notEqual(h.nodes['st-working-export'].textContent, crop); assert.match(h.nodes['st-mode-note'].textContent, /四角可能透明.*不会自动填充/);
  assert.equal(h.ui.changed(h.draft), true); assert.equal(h.ui.canApply(h.draft), true);
});
test('blank, non-finite, out-of-range, and nondecimal inputs retain the previous valid recipe and controls', () => {
  const h = harness(); h.input(12.5); const before = JSON.stringify(h.draft);
  for (const value of ['', ' ', 'NaN', 'Infinity', '-Infinity', '180.00001', '-180.1', '0x10', 'false', '12px', '1e309', '1e-999', '-0.00001e-999', '0'.repeat(129)]) {
    assert.equal(h.change('angle-number', value), false); assert.equal(JSON.stringify(h.draft), before); assert.equal(h.nodes['st-angle-number'].value, '12.5');
  }
  assert.equal(h.change('mode', 'fill'), false); assert.equal(JSON.stringify(h.draft), before);
});
test('a working-size metadata fallback is labelled honestly and a basis change invalidates a session', () => {
  const h = harness(); h.setFull(2560, 1920, 'working'); h.ui.setup(h.adapter);
  assert.match(h.nodes['st-basis'].textContent, /当前工作尺寸推算：2560 × 1920/); assert.doesNotMatch(h.nodes['st-basis'].textContent, /当前原图基准/);
  h.input(10); const before = JSON.stringify(h.draft); h.setFull(2560, 1920, 'original'); h.input(20);
  assert.equal(JSON.stringify(h.draft), before); assert.equal(h.ui.canApply(h.draft), false);
});
test('reset and repeated adjustments never accumulate transforms or create history; checks do not mutate the draft', () => {
  const h = harness(), initialSource = h.source, before = h.source.bytes.slice();
  for (const angle of [10, 20, -20, 20]) h.input(angle);
  h.change('mode', 'crop'); h.click('reset'); assert.equal(h.draft.recipe.angle, 0); assert.equal(h.draft.recipe.mode, 'crop');
  assert.equal(h.ui.changed(h.draft), false); assert.equal(h.ui.canApply(h.draft), false);
  h.input(3.75); const snapshot = JSON.stringify(h.draft), renders = h.renders;
  for (let i = 0; i < 6; i++) { assert.equal(h.ui.changed(h.draft), true); assert.equal(h.ui.canApply(h.draft), true); }
  assert.equal(JSON.stringify(h.draft), snapshot); assert.equal(h.renders, renders); assert.equal(h.source, initialSource);
  assert.deepEqual(h.source.bytes, before); assert.equal(h.source.reads, 0); assert.equal(h.source.writes, 0);
});
test('both blocked export modes disable Apply but retain the chosen recipe and show precise reasons before applying', () => {
  const h = harness(); h.assessWith(() => ({ original: blocked('原尺寸超过800万像素'), working: blocked('工作尺寸超过4096边长') }));
  assert.equal(h.input(37), true); assert.equal(h.draft.recipe.angle, 37); assert.equal(h.ui.changed(h.draft), true); assert.equal(h.ui.canApply(h.draft), false);
  assert.match(h.nodes['st-original-export'].textContent, /原尺寸超过800万像素/); assert.match(h.nodes['st-working-export'].textContent, /工作尺寸超过4096边长/);
  assert.match(h.nodes['st-budget'].textContent, /两种方式均不可用.*不会静默/);
  h.assessWith(() => ({ original: blocked('原图过大'), working: allowed(162, 142) })); assert.equal(h.ui.canApply(h.draft), true);
  assert.equal(h.draft.recipe.angle, 37);
});
test('original metadata beyond pure-core bounds cannot make a valid working edit inaccessible', () => {
  const h = harness({ fullWidth: 30000, fullHeight: 20000 }); assert.equal(h.ready, h.draft); assert.equal(h.input(17.5), true);
  assert.equal(h.ui.canApply(h.draft), true); assert.match(h.nodes['st-basis'].textContent, /30000 × 20000/);
  assert.match(h.nodes['st-original-export'].textContent, /不可用.*800万像素/); assert.match(h.nodes['st-working-export'].textContent, /可用/);
  const p = h.ui.preview(h.draft); assert(p.width <= 900 && p.height <= 900);
});
test('allowed original-only and working-only modes use their declared dimensions, not preview dimensions', () => {
  const h = harness(); h.assessWith(() => ({ original: allowed(1777, 1333), working: blocked('工作阶段预算已满') })); h.input(15);
  assert.equal(h.ui.canApply(h.draft), true); assert.match(h.nodes['st-original-export'].textContent, /1777 × 1333/); assert.match(h.nodes['st-working-export'].textContent, /工作阶段预算已满/);
  h.assessWith(() => ({ original: blocked('原尺寸不可用'), working: allowed(880, 660) })); h.input(16);
  assert.match(h.nodes['st-working-export'].textContent, /880 × 660/); assert.doesNotMatch(h.nodes['st-preview-size'].textContent, /880 × 660/);
});
test('missing, malformed, inherited, or accessor assessment fields fail closed without executing getters', () => {
  const h = harness(); h.input(10); const before = JSON.stringify(h.draft); let getterCalls = 0;
  const inherited = Object.create({ allowed: true }); inherited.output = { width: 2, height: 2 };
  const accessor = { working: allowed() }; Object.defineProperty(accessor, 'original', { enumerable: true, get() { getterCalls++; return allowed(); } });
  const outputAccessor = { height: 4 }; Object.defineProperty(outputAccessor, 'width', { enumerable: true, get() { getterCalls++; return 4; } });
  const results = [null, {}, { original: allowed() }, { original: inherited, working: allowed() }, accessor,
    { original: { allowed: true, output: outputAccessor }, working: allowed() },
    { original: { allowed: 'true', output: { width: 2, height: 2 } }, working: allowed() },
    { original: allowed(5000, 1), working: allowed() }, { original: allowed(NaN, 1), working: allowed() },
    { original: { allowed: false }, working: allowed() }, { original: blocked(''), working: allowed() }];
  for (const result of results) {
    h.assessWith(() => result); assert.equal(h.ui.canApply(h.draft), false); assert.equal(h.input(20), false); assert.equal(JSON.stringify(h.draft), before);
  }
  assert.equal(getterCalls, 0); assert.throws(() => h.ui.preview(h.draft));
});
test('draft and recipe inherited/accessor fields are rejected without executing getters', () => {
  const h = harness(); h.input(5); h.env.__draft = h.draft;
  h.run('globalThis.__getterCalls = 0; Object.defineProperty(__draft,"recipe",{enumerable:true,configurable:true,get(){ __getterCalls++; throw Error("getter executed"); }});');
  assert.equal(h.ui.changed(h.draft), false); assert.equal(h.ui.canApply(h.draft), false); assert.throws(() => h.ui.preview(h.draft)); assert.equal(h.env.__getterCalls, 0);
  const g = harness(); g.env.__draft = g.draft;
  g.run('__draft.recipe = Object.create({version:1,angle:10,mode:"expand"});');
  assert.equal(g.ui.changed(g.draft), false); assert.equal(g.ui.canApply(g.draft), false); assert.throws(() => g.ui.preview(g.draft));
});
test('preview is fresh, bounded, production-math rendered, and always based on the original session canvas', () => {
  const h = harness(), before = h.source.bytes.slice(); h.input(17.3); const op = JSON.stringify(h.draft);
  const one = h.ui.preview(h.draft), two = h.ui.preview(h.draft);
  assert.notEqual(one, two); assert.notEqual(one, h.source); assert.notEqual(two, h.source);
  assert.equal(h.previews[0].input, h.source); assert.equal(h.previews[1].input, h.source); assert.equal(h.previews[0].opts.maxSide, 900);
  assert.deepEqual(one.bytes, two.bytes); assert.equal(JSON.stringify(h.draft), op); assert.deepEqual(h.source.bytes, before); assert.equal(h.source.writes, 0);
  assert.match(h.nodes['st-preview-size'].textContent, new RegExp(one.width + ' × ' + one.height));
});
test('zero-angle operation identity is copied into an independently disposable preview without losing source pixels', () => {
  const h = harness(), before = h.source.bytes.slice(), one = h.ui.preview(h.draft), two = h.ui.preview(h.draft);
  assert.equal(h.previews[0].output, h.source); assert.notEqual(one, h.source); assert.notEqual(one, two); assert.deepEqual(one.bytes, before);
  one.width = 1; one.height = 1; assert.deepEqual(h.source.bytes, before); assert.equal(h.source.width, 120); assert.equal(h.source.height, 80);
  assert.equal(h.ui.canApply(h.draft), false);
});
test('preview bounds apply even to identity source and never change declared dimensions or angle', () => {
  const h = harness({ width: 1000, height: 600, fullWidth: 2000, fullHeight: 1200 });
  const zero = h.ui.preview(h.draft); assert.equal(zero.width, 900); assert.equal(zero.height, 540);
  h.input(33.333333333); const before = JSON.stringify(h.draft), rotated = h.ui.preview(h.draft);
  assert.equal(Math.max(rotated.width, rotated.height), 900); assert.equal(JSON.stringify(h.draft), before);
  assert.match(h.nodes['st-working-export'].textContent, /可用/); assert.equal(h.source.width, 1000); assert.equal(h.source.height, 600);
});
test('preview allocation alias, fake identity for active recipes, and wrong output sizes fail closed', () => {
  const a = harness(); a.input(15); a.adapter.createCanvas = () => a.source;
  assert.throws(() => a.ui.preview(a.draft)); assert.equal(a.source.width, 120); assert.equal(a.ui.canApply(a.draft), false);
  const b = harness(); b.input(15); b.env.MintStraightenOperation = { ...b.actualOperation, applyCanvas: input => input };
  assert.throws(() => b.ui.preview(b.draft), /未完成/); assert.equal(b.ui.canApply(b.draft), false);
  const c = harness(); c.input(15); c.env.MintStraightenOperation = { ...c.actualOperation, applyCanvas: (_input, _op, create) => create(2, 3) };
  assert.throws(() => c.ui.preview(c.draft), /尺寸不符/); assert.equal(c.ui.canApply(c.draft), false); assert.equal(c.canvases.at(-1).width, 1);
});
test('grid only paints overlay lines, never enters the portable recipe or changes Apply/history eligibility', () => {
  const h = harness(), lines = [], calls = [], before = JSON.stringify(h.draft), source = h.source.bytes.slice();
  const ctx = { save() { calls.push('save'); }, restore() { calls.push('restore'); }, setLineDash() {}, beginPath() {},
    moveTo(...args) { lines.push(args); }, lineTo(...args) { lines.push(args); }, stroke() { calls.push('stroke'); } };
  h.ui.overlay(ctx, 600, 400, h.draft); assert.equal(lines.length, 8); assert.deepEqual(calls, ['save', 'stroke', 'restore']);
  h.grid(false); lines.length = 0; h.ui.overlay(ctx, 600, 400, h.draft); assert.equal(lines.length, 0);
  assert.equal(JSON.stringify(h.draft), before); assert.equal(h.ui.changed(h.draft), false); assert.equal(h.ui.canApply(h.draft), false); assert.deepEqual(h.source.bytes, source);
  h.grid(true); h.input(7); assert.equal(h.ui.canApply(h.draft), true); assert.deepEqual(Object.keys(h.draft).sort(), ['recipe', 'type']);
  assert.deepEqual(Object.keys(h.draft.recipe).sort(), ['angle', 'mode', 'version']);
});
test('stale revision, source identity, dimensions, full basis, draft, or detached panel makes controls and previews inert', () => {
  for (const kind of ['revision', 'identity', 'size', 'full', 'draft', 'panel']) {
    const h = harness(); h.input(8); const d = h.draft, before = JSON.stringify(d), renders = h.renders;
    if (kind === 'revision') h.setRevision('1/2');
    if (kind === 'identity') h.setSource({ width: 120, height: 80, getContext() {} });
    if (kind === 'size') h.source.width = 121;
    if (kind === 'full') h.setFull(1201, 800);
    if (kind === 'draft') h.draft = { type: 'other' };
    if (kind === 'panel') h.panel.isConnected = false;
    h.input(20); h.click('reset'); assert.equal(JSON.stringify(d), before); assert.equal(h.renders, renders);
    assert.equal(h.ui.changed(d), false); assert.equal(h.ui.canApply(d), false); assert.throws(() => h.ui.preview(d));
  }
});
test('detached/replaced controls, old handlers, and foreign event targets cannot apply stale values', () => {
  const h = harness(), old = h.nodes['st-angle'], handler = old.oninput; old.value = '20'; old.isConnected = false;
  handler({ target: old }); assert.equal(h.draft.recipe.angle, 0); old.isConnected = true; h.replaceNode('angle'); handler({ target: old }); assert.equal(h.draft.recipe.angle, 0);
  const g = harness(); g.nodes['st-angle'].oninput({ target: { value: '77' } }); assert.equal(g.draft.recipe.angle, 0);
  const oldReset = g.nodes['st-reset'].onclick, prior = g.draft; g.ui.release(); g.ui.setup(g.adapter); g.input(9); oldReset({});
  assert.equal(g.draft.recipe.angle, 9); assert.equal(prior.recipe.angle, 0);
});
test('revision changes during prospective assessment cannot commit or render a stale recipe', () => {
  const h = harness(), before = JSON.stringify(h.draft), renders = h.renders;
  h.assessWith(() => { h.setRevision('changed'); return { original: allowed(), working: allowed() }; });
  assert.equal(h.input(15), false); assert.equal(JSON.stringify(h.draft), before); assert.equal(h.renders, renders); assert.equal(h.ui.canApply(h.draft), false);
});
test('failed main-photo import restores only the same draft, source, dimensions and basis, with old handlers invalidated', () => {
  const h = harness(); h.input(12.25); h.grid(false); const oldHandler = h.nodes['st-angle'].oninput;
  h.setRevision('1/2'); assert.equal(h.ui.sourceImportStarted(), true); assert.equal(h.nodes['st-angle'].disabled, true); assert.equal(h.ui.canApply(h.draft), false);
  assert.throws(() => h.ui.preview(h.draft)); assert.equal(h.ui.sourceImportFinished(), true); assert.equal(h.nodes['st-angle'].disabled, false);
  h.nodes['st-angle'].value = '50'; oldHandler({ target: h.nodes['st-angle'] }); assert.equal(h.draft.recipe.angle, 12.25); assert.equal(h.nodes['st-grid'].checked, false);
  assert.equal(h.ui.canApply(h.draft), true); assert.equal(h.input(-4), true);
  for (const kind of ['source', 'size', 'basis', 'draft']) {
    const g = harness(); g.input(5); const old = g.draft; g.setRevision('1/2'); g.ui.sourceImportStarted();
    if (kind === 'source') g.setSource({ width: 120, height: 80 });
    if (kind === 'size') g.source.height++;
    if (kind === 'basis') g.setFull(1000, 700);
    if (kind === 'draft') g.draft = { type: 'other' };
    assert.equal(g.ui.sourceImportFinished(), false); assert.equal(g.ui.canApply(old), false); assert.equal(old.recipe.angle, 5); assert.equal(g.nodes['st-angle'].disabled, true);
  }
});
test('source import started after an already stale source cannot rebind, and release prevents late finish', () => {
  const h = harness(); h.input(11); h.source.width++; h.ui.sourceImportStarted(); assert.equal(h.ui.sourceImportFinished(), false);
  const g = harness(); g.input(11); g.setRevision('1/2'); g.ui.sourceImportStarted(); g.ui.release(); assert.equal(g.ui.sourceImportFinished(), false);
  g.ui.setup(g.adapter); assert.equal(g.draft.recipe.angle, 0); assert.equal(g.ui.sourceImportFinished(), false);
});
test('release is repeatable, clears only owned handlers and prevents retained handlers from editing a reopened tool', () => {
  const h = harness(), saved = Object.values(h.nodes), oldHandler = h.nodes['st-angle'].oninput, foreign = () => {};
  h.nodes['st-grid'].onchange = foreign; h.ui.release(); h.ui.release();
  for (const n of saved) for (const key of ['oninput', 'onchange', 'onclick']) if (n[key] !== undefined && n[key] !== foreign) assert.equal(n[key], null);
  assert.equal(h.nodes['st-grid'].onchange, foreign); h.ui.setup(h.adapter); h.input(8); oldHandler({ target: { value: '42' } }); assert.equal(h.draft.recipe.angle, 8);
});
test('render failure rolls a prospective edit back without touching the source', () => {
  const h = harness(); h.input(5); const before = JSON.stringify(h.draft), source = h.source.bytes.slice(); h.failRender();
  assert.equal(h.input(21), false); assert.equal(JSON.stringify(h.draft), before); assert.equal(h.nodes['st-angle'].value, '5'); assert.deepEqual(h.source.bytes, source);
  assert.match(h.notices.at(-1), /原图和已有编辑已保留/);
});
test('preview budget overflow rejects the prospective setting rather than approximating lower-resolution geometry', () => {
  const h = harness({ width: 3000, height: 1, fullWidth: 3000, fullHeight: 1 });
  const before = JSON.stringify(h.draft); assert.equal(h.input(45), true); h.click('reset');
  const g = harness({ width: 3000, height: 2500, fullWidth: 3000, fullHeight: 2500 });
  const snapshot = JSON.stringify(g.draft), assessmentCount = g.assessments.length;
  assert.equal(g.input(45), false); assert.equal(JSON.stringify(g.draft), snapshot); assert.equal(g.assessments.length, assessmentCount);
  assert.match(g.notices.at(-1), /预算/); assert.equal(JSON.stringify(h.draft), before);
});
test('malformed plans and missing core/operation modules cannot show effective controls or fake previews', () => {
  for (const option of ['missingCore', 'missingOperation']) {
    const h = harness({ [option]: true }); assert.equal(h.ready, null); assert.equal(h.draft, null); assert.equal(h.renders, 0); assert.match(h.panel.textContent, /核心未加载/);
  }
  const h = harness(); h.input(9); const before = JSON.stringify(h.draft);
  h.env.MintStraightenOperation = { ...h.actualOperation, plan() { return { renderedSize: { width: 901, height: 100 } }; } };
  assert.equal(h.ui.canApply(h.draft), false);
  assert.equal(h.input(12), false); assert.equal(JSON.stringify(h.draft), before); assert.throws(() => h.ui.preview(h.draft), /900/); assert.equal(h.ui.canApply(h.draft), false);
  h.env.MintStraighten = null; assert.equal(h.ui.setup(h.adapter), null); assert.equal(h.draft, null);
});
test('runtime budget messages stay in textContent and never become markup', () => {
  const h = harness(), markup = h.panel.markup, payload = '<img src=x onerror=alert(1)>';
  h.assessWith(() => ({ original: blocked(payload), working: blocked('工作尺寸预算不可用') })); h.input(12);
  assert.equal(h.panel.markup, markup); assert.match(h.nodes['st-original-export'].textContent, /<img src=x/); assert.equal(h.nodes.img, undefined);
});
