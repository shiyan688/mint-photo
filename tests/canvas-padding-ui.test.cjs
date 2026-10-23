'use strict';
// Production UI, production shared math, and production export planner in a
// controlled DOM. No browser/native Canvas, pixel rendering, npm, or downloads.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assets = path.join(__dirname, '../app/src/main/assets');
const clone = value => JSON.parse(JSON.stringify(value));
const sideKeys = ['top', 'right', 'bottom', 'left'];
function harness(options = {}) {
  const nodes = {}, notices = [], hints = [], assessed = [];
  let draft = null, renders = 0, revision = 7, width = options.width || 640, height = options.height || 480;
  let contextReads = 0, canvasWrites = 0, assessOverride = null, renderFailures = 0, markup = '';
  const sourceBytes = Uint8Array.from([3, 5, 7, 0, 101, 19, 0, 255]);
  const base = { data: sourceBytes, getContext() { contextReads++; throw Error('UI must never read or paint source pixels'); } };
  Object.defineProperties(base, {
    width: { get: () => width, set() { canvasWrites++; throw Error('UI must not resize the source'); } },
    height: { get: () => height, set() { canvasWrites++; throw Error('UI must not resize the source'); } }
  });
  const source = { width: options.fullWidth || width, height: options.fullHeight || height, name: 'fixture.png', mime: 'image/png', origin: 'original', blob: new Blob(['fixture'], { type: 'image/png' }) };
  function element(id, tag = 'div', attrs = '') {
    const node = { id, tagName: tag.toUpperCase(), value: '', isConnected: true, disabled: false, textContent: '', attrs };
    for (const key of ['min', 'max', 'step', 'type']) node[key] = attrs.match(new RegExp(key + '="([^"]+)"'))?.[1] || '';
    node.value = attrs.match(/value="([^"]+)"/)?.[1] || '';
    if (id) nodes[id] = node;
    return node;
  }
  const panel = element('toolPanel'); element('editLabel');
  Object.defineProperty(panel, 'innerHTML', { get: () => markup, set(html) {
    markup = html;
    for (const key of Object.keys(nodes)) if (!['toolPanel', 'editLabel'].includes(key)) { nodes[key].isConnected = false; delete nodes[key]; }
    for (const match of html.matchAll(/<([a-z]+)\b([^>]*id="([^"]+)"[^>]*)>/g)) element(match[3], match[1], match[2]);
  } });
  const env = { Blob, console, document: { getElementById: id => nodes[id] || null, createElement() { throw Error('UI must not allocate canvases or elements'); } } };
  env.window = env; vm.createContext(env);
  const load = name => vm.runInContext(fs.readFileSync(path.join(assets, name), 'utf8'), env, { filename: name });
  if (!options.missing) load('canvas-padding.js');
  load('canvas-padding-operation.js'); load('project-core.js'); load('canvas-padding-ui.js');
  env.__source = source;
  const adapter = {
    getDraft: () => draft, setDraft: value => { draft = value; }, getCanvas: () => base,
    getFullSize: () => ({ width: source.width, height: source.height }),
    revision: () => revision,
    assess(recipe) {
      assessed.push(clone(recipe));
      if (assessOverride) return assessOverride(recipe);
      env.__recipe = recipe;
      return vm.runInContext(`(() => {
        const result = {};
        for (const mode of ['original', 'working']) {
          try { result[mode] = { allowed: true, output: ProjectCore.planExport(__source, [{ type: 'canvas-padding', recipe: __recipe }], mode).output, error: '' }; }
          catch (error) { result[mode] = { allowed: false, output: null, error: error.message }; }
        }
        return result;
      })()`, env);
    },
    render() { renders++; if (renderFailures > 0) { renderFailures--; throw Error('preview rendering failed'); } },
    toast: text => notices.push(text), hint: text => hints.push(text)
  };
  const ready = env.CanvasPaddingUI.setup(adapter);
  return {
    env, ui: env.CanvasPaddingUI, nodes, notices, hints, base, adapter, assessed, ready,
    get draft() { return draft; }, set draft(value) { draft = value; }, get renders() { return renders; },
    get contextReads() { return contextReads; }, get canvasWrites() { return canvasWrites; },
    get markup() { return markup; }, get revision() { return revision; }, set revision(value) { revision = value; },
    resize(w, h) { width = w; height = h; }, replaceNode(id) { return element('cp-' + id); },
    assessWith(fn) { assessOverride = fn; }, failRender() { renderFailures++; },
    input(id, value) { const node = nodes['cp-' + id]; node.value = String(value); node.oninput({ target: node }); },
    color(value) { const node = nodes['cp-color']; node.value = value; node.onchange({ target: node }); },
    click(id) { const node = nodes['cp-' + id]; node.onclick({ target: node }); }
  };
}
function recipe(h) { return clone(h.draft.recipe); }
function permitted(width = 700, height = 500) { return { allowed: true, output: { width, height }, error: '' }; }
function blocked(error = '超过800万像素预算') { return { allowed: false, output: null, error }; }

test('zero controls are exact identity and draft contains only required portable fields', () => {
  const h = harness(); assert.equal(h.ready, true); assert.equal(h.ui.changed(h.draft), false);
  assert.deepEqual(Object.keys(h.draft).sort(), ['recipe', 'type']);
  assert.deepEqual(recipe(h), { version: 1, top: 0, right: 0, bottom: 0, left: 0, color: '#ffffff', opacity: 1 });
  for (const id of ['equal', ...sideKeys]) {
    const n = h.nodes['cp-' + id]; assert.equal(n.min, '0'); assert.equal(n.max, '50'); assert.equal(n.step, '0.1'); assert.equal(n.value, '0');
  }
  assert.equal(h.nodes['cp-opacity'].min, '0'); assert.equal(h.nodes['cp-opacity'].max, '100');
  assert.equal(h.nodes['cp-original-layout'].textContent, '原尺寸布局（仅计算）：640 × 480 像素');
  assert.match(h.markup, /不缩放、不拉伸/); assert.match(h.markup, /PNG保留透明/); assert.match(h.markup, /JPEG不支持透明/);
  assert.doesNotMatch(h.markup, /type="hidden"|<canvas|<img|<script/);
});

test('equal and independent controls use short-edge fractions, including exact endpoints', () => {
  const h = harness({ width: 64, height: 48 }); h.input('equal', 50);
  for (const side of sideKeys) assert.equal(h.draft.recipe[side], .5);
  assert.equal(h.nodes['cp-original-layout'].textContent, '原尺寸布局（仅计算）：112 × 96 像素');
  h.input('top', 1.2); h.input('right', 5); h.input('bottom', 10); h.input('left', 0);
  assert.deepEqual(sideKeys.map(side => h.draft.recipe[side]), [.012, .05, .1, 0]);
  assert.equal(h.nodes['cp-equal-value'].textContent, '各边不同');
  h.input('equal', 0); assert.equal(h.ui.changed(h.draft), false);
});

test('three explicit presets reset previous color and opacity and contain real recipes', () => {
  const h = harness(); h.click('swatch-black'); h.input('opacity', 31); h.click('preset-white');
  assert.deepEqual(recipe(h), { version: 1, top: .05, right: .05, bottom: .05, left: .05, color: '#ffffff', opacity: 1 });
  h.click('preset-bottom'); assert.deepEqual(sideKeys.map(side => h.draft.recipe[side]), [.06, .06, .15, .06]);
  h.click('preset-transparent'); assert.deepEqual(recipe(h), { version: 1, top: .05, right: .05, bottom: .05, left: .05, color: '#ffffff', opacity: 0 });
  assert.equal(h.ui.changed(h.draft), true, 'transparent padding still expands dimensions');
  h.click('reset'); assert.deepEqual(recipe(h), clone(h.env.MintCanvasPadding.defaults())); assert.equal(h.ui.changed(h.draft), false);
});

test('colors and opacity affect only the recipe; invalid fields rollback all controls', () => {
  const h = harness(); h.click('swatch-mint'); assert.equal(h.draft.recipe.color, '#b7e4d4');
  h.click('swatch-black'); assert.equal(h.draft.recipe.color, '#000000');
  h.click('swatch-white'); assert.equal(h.draft.recipe.color, '#ffffff');
  h.color('#AABBCC'); assert.equal(h.draft.recipe.color, '#aabbcc'); h.input('opacity', 0); assert.equal(h.draft.recipe.opacity, 0);
  assert.equal(h.ui.changed(h.draft), false, 'color/alpha changes without padding remain identity');
  const before = JSON.stringify(h.draft);
  for (const [id, value] of [['top', -1], ['right', 50.1], ['bottom', 'NaN'], ['left', ''], ['opacity', 101]]) {
    h.input(id, value); assert.equal(JSON.stringify(h.draft), before); assert.notEqual(h.nodes['cp-' + id].value, String(value));
  }
  h.color('#fff'); assert.equal(JSON.stringify(h.draft), before); assert.equal(h.nodes['cp-color'].value, '#aabbcc');
});

test('changed uses quantized preview padding with no render, assessment, or source reads', () => {
  const h = harness({ width: 64, height: 32 }); h.input('equal', .1);
  assert.equal(h.ui.changed(h.draft), false, 'subpixel padding rounds to zero');
  h.input('top', 2); assert.equal(h.ui.changed(h.draft), true);
  const snapshot = JSON.stringify(h.draft), renders = h.renders, assessments = h.assessed.length;
  for (let i = 0; i < 10; i++) assert.equal(h.ui.changed(h.draft), true);
  assert.equal(h.renders, renders); assert.equal(h.assessed.length, assessments); assert.equal(JSON.stringify(h.draft), snapshot);
  assert.equal(h.contextReads, 0); assert.equal(h.canvasWrites, 0);
});

test('full 80MP layout is metadata-only while actual working export remains allowed', () => {
  const h = harness({ width: 2560, height: 2048, fullWidth: 10000, fullHeight: 8000 });
  assert.equal(h.ready, true); h.click('preset-white'); assert.equal(h.draft.recipe.top, .05);
  assert.equal(h.nodes['cp-original-layout'].textContent, '原尺寸布局（仅计算）：10800 × 8800 像素');
  assert.match(h.nodes['cp-original-export'].textContent, /不可用.*预算/);
  assert.equal(h.nodes['cp-working-export'].textContent, '工作尺寸导出：可用 · 2764 × 2252 像素');
  assert.equal(h.nodes['cp-preview-size'].textContent, '当前预览：2764 × 2252 像素');
  assert.equal(h.contextReads, 0); assert.equal(h.canvasWrites, 0);
});

test('neither export allowed rejects mutation and restores prior recipe and visible values', () => {
  const h = harness(); h.input('equal', 5); const before = JSON.stringify(h.draft), renders = h.renders;
  h.assessWith(() => ({ original: blocked('原图过大'), working: blocked('工作图过大') })); h.input('bottom', 50);
  assert.equal(JSON.stringify(h.draft), before); assert.equal(h.nodes['cp-bottom'].value, '5'); assert.equal(h.renders, renders);
  assert.match(h.nodes['cp-status'].textContent, /原尺寸和工作尺寸.*预算/); assert.match(h.notices.at(-1), /工作图过大/);
});

test('preview checks both 8MP and 4096-edge budgets before accepting an export-allowed recipe', () => {
  for (const [width, height] of [[2500, 2500], [4000, 1000]]) {
    const h = harness({ width, height }); const before = JSON.stringify(h.draft), assessments = h.assessed.length;
    h.assessWith(() => ({ original: permitted(), working: permitted() })); h.input('equal', 50);
    assert.equal(JSON.stringify(h.draft), before); assert.equal(h.assessed.length, assessments, 'preview rejection precedes export assessment');
    assert.match(h.notices.at(-1), /800万像素.*4096/);
  }
});

test('actual working export may be too large even when a smaller preview fits', () => {
  const h = harness({ width: 512, height: 512, fullWidth: 10000, fullHeight: 8000 });
  const before = JSON.stringify(h.draft); h.input('equal', 50);
  assert.equal(JSON.stringify(h.draft), before); assert.match(h.notices.at(-1), /原尺寸和工作尺寸导出均超出/);
});

test('original-only allowance is not mistaken for a blocked draft; both modes remain truthful', () => {
  const h = harness(); h.assessWith(() => ({ original: permitted(688, 528), working: blocked('工作尺寸阶段超限') })); h.input('equal', 5);
  assert.equal(h.draft.recipe.top, .05); assert.equal(h.nodes['cp-original-export'].textContent, '原尺寸导出：可用 · 688 × 528 像素');
  assert.match(h.nodes['cp-working-export'].textContent, /不可用.*工作尺寸阶段超限/);
});

test('malformed or failed budget assessment is fail-closed and does not change the draft', () => {
  const h = harness(), before = JSON.stringify(h.draft);
  for (const result of [null, {}, { original: permitted(), working: { allowed: true, output: null, error: '' } }, { original: permitted(), working: { allowed: 'true', output: { width: 1, height: 1 }, error: '' } }]) {
    h.assessWith(() => result); h.input('equal', 5); assert.equal(JSON.stringify(h.draft), before);
  }
  h.assessWith(() => { throw Error('assessment failed'); }); h.click('preset-white'); assert.equal(JSON.stringify(h.draft), before);
});

test('source revision changes reject sliders, presets and reset without false success', () => {
  const h = harness(); h.input('equal', 5); const before = JSON.stringify(h.draft), renders = h.renders; h.revision++;
  for (const action of [() => h.input('top', 10), () => h.click('preset-bottom'), () => h.click('reset'), () => h.color('#000000')]) {
    action(); assert.equal(JSON.stringify(h.draft), before); assert.match(h.nodes['cp-status'].textContent, /版本已改变/);
  }
  assert.equal(h.ui.changed(h.draft), false); assert.equal(h.renders, renders);
});

test('revision changes during budget assessment cannot commit stale prospective recipes', () => {
  const h = harness(), before = JSON.stringify(h.draft);
  h.assessWith(() => { h.revision++; return { original: permitted(), working: permitted() }; }); h.input('equal', 5);
  assert.equal(JSON.stringify(h.draft), before); assert.match(h.notices.at(-1), /版本已改变/);
});

test('source dimensions changed in place also invalidate stale controls', () => {
  const h = harness(), before = JSON.stringify(h.draft); h.resize(800, 600); h.click('preset-white');
  assert.equal(JSON.stringify(h.draft), before); assert.match(h.notices.at(-1), /版本已改变/);
});

test('detached controls, detached panel, and replaced draft cannot edit current history', () => {
  const h = harness(), before = JSON.stringify(h.draft), node = h.nodes['cp-equal'], handler = node.oninput;
  node.value = '5'; node.isConnected = false; handler({ target: node }); assert.equal(JSON.stringify(h.draft), before);
  node.isConnected = true; h.replaceNode('equal'); handler({ target: node }); assert.equal(JSON.stringify(h.draft), before);
  h.nodes.toolPanel.isConnected = false; h.click('preset-white'); assert.equal(JSON.stringify(h.draft), before);
  h.nodes.toolPanel.isConnected = true; const old = h.draft; h.draft = { type: 'other' }; h.click('preset-white'); assert.equal(JSON.stringify(old), before);
});

test('release clears all owned listeners, preserves foreign handlers and rejects retained handlers after reopening', () => {
  const h = harness(); h.click('preset-bottom'); const old = h.draft, before = JSON.stringify(old), handler = h.nodes['cp-reset'].onclick;
  const nodes = Object.values(h.nodes), foreign = () => {}; h.nodes['cp-color'].onchange = foreign;
  h.ui.release(); h.ui.release();
  for (const n of nodes) for (const key of ['onclick', 'oninput', 'onchange']) if (n[key] !== undefined && n[key] !== foreign) assert.equal(n[key], null);
  assert.equal(h.nodes['cp-color'].onchange, foreign); handler({}); assert.equal(JSON.stringify(old), before);
  assert.equal(h.ui.changed(old), false); assert.equal(h.ui.setup(h.adapter), true); handler({}); assert.equal(h.draft.recipe.top, 0);
});

test('preview-render failure rolls recipe and controls back and does not touch committed canvas', () => {
  const h = harness(); h.input('equal', 5); const before = JSON.stringify(h.draft); h.failRender(); h.input('bottom', 15);
  assert.equal(JSON.stringify(h.draft), before); assert.equal(h.nodes['cp-bottom'].value, '5'); assert.match(h.notices.at(-1), /保留上一次有效/);
  assert.equal(h.contextReads, 0); assert.equal(h.canvasWrites, 0); assert.deepEqual(h.base.data, Uint8Array.from([3, 5, 7, 0, 101, 19, 0, 255]));
});

test('all control operations leave source bytes and dimensions untouched without any canvas allocation', () => {
  const h = harness(), before = h.base.data.slice();
  for (const name of ['preset-white', 'preset-bottom', 'preset-transparent', 'swatch-black', 'swatch-mint', 'reset']) h.click(name);
  h.input('equal', 25); h.input('bottom', 40); h.input('opacity', 13); h.color('#123456'); h.ui.release();
  assert.deepEqual(h.base.data, before); assert.equal(h.base.width, 640); assert.equal(h.base.height, 480); assert.equal(h.contextReads, 0); assert.equal(h.canvasWrites, 0);
});

test('error messages use textContent and never interpolate runtime data into static HTML', () => {
  const h = harness(), markup = h.markup, payload = '<img src=x onerror=alert(1)>';
  h.assessWith(() => ({ original: blocked(payload), working: blocked(payload) })); h.click('preset-white');
  assert.equal(h.markup, markup); assert.match(h.nodes['cp-status'].textContent, /<img src=x/); assert.equal(h.nodes.img, undefined);
});

test('missing shared core fails closed instead of showing ineffective controls', () => {
  const h = harness({ missing: true }); assert.equal(h.ready, false); assert.equal(h.draft, null); assert.equal(h.renders, 0);
  assert.match(h.notices.at(-1), /未加载/); assert.equal(h.ui.changed(null), false);
});
