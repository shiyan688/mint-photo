'use strict';
// Actual packaged Levels UI + shared core in a VM. Controlled DOM/canvas, NOT
// Android/WebView rendering, device touch, color-management or export E2E proof.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assets = path.join(__dirname, '../app/src/main/assets');

function canvas(width = 256, height = 1, pixels) {
  let bytes = pixels ? new Uint8ClampedArray(pixels) : new Uint8ClampedArray(width * height * 4);
  if (!pixels) for (let i = 0; i < width * height; i++) bytes.set([i % 256, (i * 3) % 256, 255 - i % 256, i % 256], i * 4);
  let reads = 0, writes = 0;
  const c = { width, height, get data() { return bytes; }, get reads() { return reads; }, get writes() { return writes; } };
  const ctx = {
    getImageData(x, y, w, h) {
      assert.deepEqual([x, y, w, h], [0, 0, c.width, c.height]); reads++;
      return { width: c.width, height: c.height, data: new Uint8ClampedArray(bytes) };
    },
    putImageData(im, x, y) { assert.deepEqual([x, y], [0, 0]); writes++; bytes = new Uint8ClampedArray(im.data); },
    createImageData() { throw Error('UI must not allocate a third frame-sized ImageData'); }
  };
  c.getContext = () => ctx;
  return c;
}

function harness({ missing = false, incomplete = false, withRevision = true, setup = true, source = canvas() } = {}) {
  const nodes = {}, notices = [], hints = [];
  let draft = null, renders = 0, revision = 1, base = source, preview = null;
  function element(id, attrs = '') {
    const classes = new Set(), attributes = {};
    const node = { id, value: attrs.match(/value="([^"]*)"/)?.[1] || '', textContent: '',
      min: attrs.match(/min="([^"]*)"/)?.[1], max: attrs.match(/max="([^"]*)"/)?.[1], step: attrs.match(/step="([^"]*)"/)?.[1],
      classList: { toggle(key, on) { if (on) classes.add(key); else classes.delete(key); }, contains: key => classes.has(key) },
      setAttribute(key, value) { attributes[key] = value; }, getAttribute: key => attributes[key] };
    nodes[id] = node; return node;
  }
  const panel = element('toolPanel'); element('editLabel');
  let markup = '';
  Object.defineProperty(panel, 'innerHTML', {
    get: () => markup,
    set(value) {
      markup = value;
      for (const key of Object.keys(nodes)) if (!['toolPanel', 'editLabel'].includes(key)) delete nodes[key];
      for (const match of value.matchAll(/<[a-z]+\b([^>]*id="([^"]+)"[^>]*)>/g)) element(match[2], match[1]);
    }
  });
  const env = { console, Uint8ClampedArray, Uint8Array, ArrayBuffer, document: { getElementById: id => nodes[id] || null } };
  env.window = env; vm.createContext(env);
  if (!missing) vm.runInContext(fs.readFileSync(path.join(assets, 'levels.js'), 'utf8'), env);
  if (incomplete) env.MintLevels = { defaults() {} };
  vm.runInContext(fs.readFileSync(path.join(assets, 'levels-ui.js'), 'utf8'), env);
  const ui = env.LevelsUI;
  const adapter = {
    getDraft: () => draft, setDraft: value => { draft = value; }, getCanvas: () => base,
    render() {
      renders++; preview = canvas(base.width, base.height, base.data);
      if (draft && ui.changed(draft)) ui.apply(preview, draft);
    },
    toast: text => notices.push(text), hint: text => hints.push(text)
  };
  if (withRevision) adapter.revision = () => revision;
  function inRealm(value) { env.__json = JSON.stringify(value); return vm.runInContext('JSON.parse(__json)', env); }
  if (setup) ui.setup(adapter);
  return { env, ui, nodes, notices, hints, adapter, element,
    get draft() { return draft; }, set draft(value) { draft = value; },
    get base() { return base; }, set base(value) { base = value; },
    get revision() { return revision; }, set revision(value) { revision = value; },
    get renders() { return renders; }, get preview() { return preview; },
    click(id) { const node = nodes[id]; node.onclick({ target: node }); },
    slide(id, value) { const node = nodes[id]; node.value = typeof value === 'string' ? value : String(value); node.oninput({ target: node }); },
    number(id, value) { const node = nodes[id + '-number']; node.value = value; node.onchange({ target: node }); },
    copy() { return canvas(base.width, base.height, base.data); },
    snapshot() { return inRealm(draft); }, inRealm
  };
}

const plain = value => JSON.parse(JSON.stringify(value));
function expected(source, recipe) {
  const out = new Uint8ClampedArray(source);
  const map = (v, c) => c.outputBlack + Math.pow(Math.max(0, Math.min(1, (v - c.inputBlack) / (c.inputWhite - c.inputBlack))), 1 / c.gamma) * (c.outputWhite - c.outputBlack);
  for (let i = 0; i < out.length; i += 4) for (let k = 0; k < 3; k++) {
    if (!source[i + 3]) continue;
    const original = source[i + k], mapped = map(map(original, recipe.channels.rgb), recipe.channels[['red', 'green', 'blue'][k]]);
    out[i + k] = Math.round(original + (mapped - original) * recipe.strength);
  }
  return out;
}

test('neutral setup has exact core defaults, preserves source, and states conventional limitations', () => {
  const h = harness(), c = h.copy();
  assert.equal(h.draft.type, 'levels');
  assert.deepEqual(plain(h.draft.recipe), plain(h.env.MintLevels.defaults()));
  assert.equal(h.ui.changed(h.draft), false);
  assert.equal(h.ui.apply(c, h.draft), c); assert.deepEqual(c.data, h.base.data); assert.equal(c.writes, 0);
  assert.equal(h.base.reads, 0); assert.equal(h.base.writes, 0); assert.equal(h.renders, 1);
  assert.match(h.nodes.toolPanel.innerHTML, /8 位 sRGB/); assert.match(h.nodes.toolPanel.innerHTML, /不是 RAW \/ HDR/);
  assert.match(h.nodes.levelsStatus.textContent, /中性/);
  assert.equal(h.nodes['levelsChannel-rgb'].getAttribute('aria-pressed'), 'true');
  assert.equal(h.nodes['levels-gamma'].min, '0.1'); assert.equal(h.nodes['levels-gamma'].max, '10');
  assert.equal(h.nodes.levelsStrength.min, '0'); assert.equal(h.nodes.levelsStrength.max, '1');
});

test('all five real controls and master/per-channel order match an independent pixel formula', () => {
  const h = harness(), before = new Uint8ClampedArray(h.base.data);
  for (const [key, edits] of Object.entries({
    rgb: { inputBlack: 15, inputWhite: 242, gamma: 1.7, outputBlack: 3, outputWhite: 249 },
    red: { inputBlack: 41, inputWhite: 214, gamma: .65, outputBlack: 12, outputWhite: 229 },
    green: { inputBlack: 8, inputWhite: 233, gamma: 2.4, outputBlack: 5, outputWhite: 241 },
    blue: { inputBlack: 20, inputWhite: 250, gamma: .4, outputBlack: 9, outputWhite: 240 }
  })) {
    h.click('levelsChannel-' + key);
    for (const [field, value] of Object.entries(edits)) h.slide('levels-' + field, value);
  }
  h.slide('levelsStrength', .73);
  const result = h.copy(); h.ui.apply(result, h.draft);
  assert.deepEqual(result.data, expected(before, h.draft.recipe)); assert.notDeepEqual(result.data, before);
  assert.deepEqual(h.base.data, before); assert.equal(h.base.writes, 0);
});

test('master/individual regression is 26 to 13 without intermediate rounding', () => {
  const h = harness({ source: canvas(1, 1, [26, 26, 26, 255]) });
  for (const [key, values] of Object.entries({ rgb: [15, 242, 1.7, 3, 249], red: [41, 214, .65, 12, 229] })) {
    h.click('levelsChannel-' + key);
    ['inputBlack', 'inputWhite', 'gamma', 'outputBlack', 'outputWhite'].forEach((field, i) => h.slide('levels-' + field, values[i]));
  }
  const c = h.copy(); h.ui.apply(c, h.draft);
  assert.equal(c.data[0], 13); assert.equal(c.data[3], 255);
});

test('per-channel edits change only the selected component, not alpha or alpha-zero hidden RGB', () => {
  const h = harness(); h.click('levelsChannel-green'); h.slide('levels-gamma', 2);
  const c = h.copy(); h.ui.apply(c, h.draft);
  let changes = 0;
  for (let i = 0; i < c.data.length; i += 4) {
    assert.equal(c.data[i], h.base.data[i]); assert.equal(c.data[i + 2], h.base.data[i + 2]);
    assert.equal(c.data[i + 3], h.base.data[i + 3]);
    if (!h.base.data[i + 3]) assert.deepEqual(c.data.slice(i, i + 4), h.base.data.slice(i, i + 4));
    else if (c.data[i + 1] !== h.base.data[i + 1]) changes++;
  }
  assert(changes > 0);
});

test('maximum points/gamma and constant output are accepted; every alpha byte is preserved', () => {
  const h = harness(); h.slide('levels-inputBlack', 254); h.slide('levels-gamma', 10); h.slide('levels-outputBlack', 255);
  const c = h.copy(); h.ui.apply(c, h.draft);
  assert.equal(h.draft.recipe.channels.rgb.outputBlack, 255); assert.equal(h.draft.recipe.channels.rgb.outputWhite, 255);
  for (let i = 0; i < c.data.length; i += 4) {
    assert.equal(c.data[i + 3], h.base.data[i + 3]);
    assert.deepEqual(c.data.slice(i, i + 3), h.base.data[i + 3] === 0 ? h.base.data.slice(i, i + 3) : new Uint8ClampedArray([255, 255, 255]));
  }
  h.slide('levels-gamma', .1); assert.equal(h.draft.recipe.channels.rgb.gamma, .1);
  h.click('levelsReset'); h.slide('levels-inputWhite', 1); h.slide('levels-outputWhite', 0);
  const dark = h.copy(); h.ui.apply(dark, h.draft);
  for (let i = 4; i < dark.data.length; i += 4) assert.deepEqual(dark.data.slice(i, i + 3), new Uint8ClampedArray([0, 0, 0]));
});

test('strength blends once with final half-up rounding; zero retains recipe but is identity', () => {
  const h = harness({ source: canvas(1, 1, [0, 0, 0, 255]) });
  h.slide('levels-outputWhite', 1); h.slide('levels-outputBlack', 1); h.slide('levelsStrength', .5);
  assert.deepEqual(h.preview.data, new Uint8ClampedArray([1, 1, 1, 255]));
  h.slide('levelsStrength', 0); assert.equal(h.ui.changed(h.draft), false); assert.deepEqual(h.preview.data, h.base.data);
  assert.equal(h.draft.recipe.channels.rgb.outputBlack, 1);
  h.slide('levelsStrength', 1); assert.equal(h.ui.changed(h.draft), true);
});

test('precise numeric inputs preserve non-slider-step gamma/strength without silent rounding', () => {
  const h = harness(); h.number('levels-gamma', '.3333333333333333'); h.number('levelsStrength', '0.123456789');
  assert.equal(h.draft.recipe.channels.rgb.gamma, 1 / 3); assert.equal(h.draft.recipe.strength, .123456789);
  assert.equal(h.nodes['levels-gamma-number'].value, String(1 / 3));
  assert.equal(h.nodes['levels-gamma-number'].step, 'any');
  assert.deepEqual(h.preview.data, expected(h.base.data, h.draft.recipe));
});

test('invalid numeric controls never mutate the last valid recipe or schedule a render', () => {
  const h = harness(); h.slide('levels-gamma', 1.5);
  for (const value of ['', ' ', '\t', 'NaN', 'Infinity', '-Infinity', '1e999', '0x10', '1.2x', ' 2', '2 ', {}, null, true, ['2']]) {
    const recipe = h.draft.recipe, renders = h.renders;
    h.number('levels-gamma', value);
    assert.equal(h.draft.recipe, recipe, String(value)); assert.equal(h.renders, renders);
    assert.equal(h.nodes['levels-gamma-number'].value, '1.5');
  }
  assert(h.notices.length >= 15);
  for (const [id, value] of [['levels-inputBlack', '1.5'], ['levels-inputWhite', '256'], ['levels-gamma', '0.09'], ['levels-gamma', '10.01'], ['levelsStrength', '-0.1'], ['levelsStrength', '1.1']]) {
    const recipe = h.draft.recipe, renders = h.renders;
    h.slide(id, value); assert.equal(h.draft.recipe, recipe); assert.equal(h.renders, renders);
  }
});

test('input ordering is strict and output equality is legal, with correctly constrained controls', () => {
  const h = harness(); h.slide('levels-inputBlack', 50); h.slide('levels-inputWhite', 200);
  assert.equal(h.nodes['levels-inputWhite'].min, '51'); assert.equal(h.nodes['levels-inputBlack'].max, '199');
  for (const [field, value] of [['inputWhite', 50], ['inputWhite', 0], ['inputBlack', 200], ['inputBlack', 255]]) {
    const recipe = h.draft.recipe; h.slide('levels-' + field, value); assert.equal(h.draft.recipe, recipe);
  }
  h.slide('levels-outputBlack', 100); h.slide('levels-outputWhite', 100);
  assert.equal(h.nodes['levels-outputBlack'].max, '100'); assert.equal(h.nodes['levels-outputWhite'].min, '100');
  for (const [field, value] of [['outputBlack', 101], ['outputWhite', 99]]) {
    const recipe = h.draft.recipe; h.slide('levels-' + field, value); assert.equal(h.draft.recipe, recipe);
  }
});

test('preview changes are not accumulated and repeated identical events do not render', () => {
  const h = harness(); h.slide('levels-gamma', 2); const first = new Uint8ClampedArray(h.preview.data);
  h.slide('levels-gamma', 3); assert.notDeepEqual(h.preview.data, first);
  h.slide('levels-gamma', 2); assert.deepEqual(h.preview.data, first);
  const before = h.renders, recipe = h.draft.recipe;
  h.slide('levels-gamma', 2); assert.equal(h.renders, before); assert.equal(h.draft.recipe, recipe);
  assert.equal(h.base.writes, 0); assert.equal(h.base.reads, 0);
});

test('channel changes restore independent values without rendering or editing the recipe', () => {
  const h = harness(); h.slide('levels-gamma', 2); h.click('levelsChannel-red'); h.slide('levels-inputBlack', 20);
  const before = h.renders, recipe = h.draft.recipe;
  h.click('levelsChannel-rgb'); assert.equal(h.nodes['levels-gamma'].value, '2'); assert.equal(h.nodes['levels-inputBlack'].value, '0');
  h.click('levelsChannel-red'); assert.equal(h.nodes['levels-gamma'].value, '1'); assert.equal(h.nodes['levels-inputBlack'].value, '20');
  assert.equal(h.renders, before); assert.equal(h.draft.recipe, recipe);
});

test('reset current channel preserves other channels/strength; all reset is exact neutral', () => {
  const h = harness(); h.slide('levels-gamma', 2); h.click('levelsChannel-blue'); h.slide('levels-outputWhite', 230); h.slide('levelsStrength', .7);
  h.click('levelsResetChannel');
  assert.deepEqual(plain(h.draft.recipe.channels.blue), plain(h.env.MintLevels.defaults().channels.blue));
  assert.equal(h.draft.recipe.channels.rgb.gamma, 2); assert.equal(h.draft.recipe.strength, .7);
  h.click('levelsReset'); assert.deepEqual(plain(h.draft.recipe), plain(h.env.MintLevels.defaults()));
  assert.equal(h.ui.changed(h.draft), false); assert.deepEqual(h.preview.data, h.base.data);
});

test('missing or incomplete module fails closed and replay never claims a successful effect', () => {
  for (const options of [{ missing: true }, { incomplete: true }]) {
    const h = harness(options), c = h.copy();
    assert.equal(h.draft, null); assert.match(h.notices.at(-1), /未加载/);
    assert.equal(h.ui.changed(null), false); assert.equal(h.ui.changed({ type: 'other' }), false);
    assert.throws(() => h.ui.changed({ type: 'levels', recipe: null }), /未加载/);
    assert.throws(() => h.ui.apply(c, { type: 'levels', recipe: null }), /未加载/);
    assert.equal(c.reads, 0); assert.equal(c.writes, 0);
  }
});

test('initial recipes are validated and copied; malformed initial state never falls back silently', () => {
  const h = harness({ setup: false }), initial = h.env.MintLevels.defaults(); initial.channels.red.gamma = 1.23456789;
  h.ui.setup(h.adapter, initial); assert.notEqual(h.draft.recipe, initial); assert.equal(h.draft.recipe.channels.red.gamma, 1.23456789);
  initial.channels.red.gamma = 2; assert.equal(h.draft.recipe.channels.red.gamma, 1.23456789);
  for (const invalid of [h.inRealm({}), h.inRealm({ ...plain(initial), strength: '1' })]) {
    h.ui.setup(h.adapter, invalid); assert.equal(h.draft, null); assert.match(h.notices.at(-1), /参数无效/);
  }
  h.ui.setup(h.adapter); assert.equal(h.ui.changed(h.draft), false);
});

test('release detaches every event handler; captured callbacks cannot mutate a new session', () => {
  const h = harness(); h.slide('levels-gamma', 2);
  const oldDraft = h.draft, saved = [];
  for (const node of Object.values(h.nodes)) for (const event of ['onclick', 'oninput', 'onchange']) if (node[event]) saved.push({ node, event, handler: node[event] });
  h.ui.release();
  for (const { node, event } of saved) assert.equal(node[event], null);
  h.ui.setup(h.adapter); h.slide('levels-gamma', 1.5);
  const current = h.draft.recipe, renders = h.renders, notices = h.notices.length;
  for (const { node, handler } of saved) { node.value = '3'; handler({ target: node }); }
  assert.equal(h.draft.recipe, current); assert.equal(h.renders, renders); assert.equal(h.notices.length, notices);
  assert.equal(oldDraft.recipe.channels.rgb.gamma, 2); assert.equal(h.nodes['levels-gamma'].value, '1.5');
});

test('old-channel callbacks and event targets from another control are inert', () => {
  const h = harness(), node = h.nodes['levels-gamma'], handler = node.oninput;
  const oldReset = h.nodes.levelsResetChannel.onclick;
  h.click('levelsChannel-red'); h.slide('levels-gamma', 2);
  const recipe = h.draft.recipe, renders = h.renders;
  node.value = '3'; handler({ target: node }); oldReset({ target: h.nodes.levelsResetChannel });
  node.oninput({ target: h.nodes.levelsStrength });
  assert.equal(h.draft.recipe, recipe); assert.equal(h.renders, renders);
  assert.equal(h.draft.recipe.channels.rgb.gamma, 1); assert.equal(h.draft.recipe.channels.red.gamma, 2);
});

test('draft replacement invalidates editing permanently, even if old identity is restored', () => {
  const h = harness(), old = h.draft, input = h.nodes['levels-gamma'], handler = input.oninput;
  h.draft = h.snapshot(); input.value = '2'; handler({ target: input }); h.draft = old;
  handler({ target: input }); h.click('levelsReset');
  assert.equal(old.recipe.channels.rgb.gamma, 1); assert.equal(h.renders, 1);
});

test('photo revision changes invalidate sliders, channel switching and both resets', () => {
  const h = harness(); h.slide('levels-gamma', 2); h.revision++;
  const recipe = h.draft.recipe, renders = h.renders;
  h.click('levelsChannel-red'); h.slide('levels-gamma', 3); h.click('levelsResetChannel'); h.click('levelsReset');
  h.revision--; h.slide('levels-gamma', 4);
  assert.equal(h.draft.recipe, recipe); assert.equal(h.draft.recipe.channels.rgb.gamma, 2); assert.equal(h.renders, renders);
});

test('source replacement or resize blocks editing when optional revision is absent', () => {
  for (const replace of [true, false]) {
    const h = harness({ withRevision: false }), recipe = h.draft.recipe;
    if (replace) h.base = canvas(); else h.base.width++;
    h.slide('levels-gamma', 2); h.click('levelsReset');
    assert.equal(h.draft.recipe, recipe); assert.equal(h.renders, 1);
  }
});

test('detached/replaced DOM nodes cannot operate on the live draft', () => {
  const h = harness(), node = h.nodes['levels-gamma'], handler = node.oninput, recipe = h.draft.recipe;
  h.element('levels-gamma'); node.value = '2'; handler({ target: node }); assert.equal(h.draft.recipe, recipe);
  h.nodes.toolPanel = { textContent: '' }; h.click('levelsReset'); assert.equal(h.draft.recipe, recipe);
});

test('saved operation replay remains exact after release and at another resolution', () => {
  const h = harness(); h.slide('levels-gamma', 1.7); h.click('levelsChannel-red'); h.slide('levels-inputBlack', 15); h.slide('levelsStrength', .82);
  const saved = h.snapshot(), first = h.copy(); h.ui.apply(first, h.draft); h.ui.release();
  const replay = h.copy(); assert.equal(h.ui.changed(saved), true); h.ui.apply(replay, saved); assert.deepEqual(replay.data, first.data);
  const bigger = canvas(400, 3), original = new Uint8ClampedArray(bigger.data);
  h.ui.apply(bigger, saved); assert.deepEqual(bigger.data, expected(original, saved.recipe));
});

test('apply protects the live source and uses readback storage without a third full-frame allocation', () => {
  const h = harness(); h.slide('levels-gamma', 2);
  assert.throws(() => h.ui.apply(h.base, h.draft), /副本/); assert.equal(h.base.reads, 0); assert.equal(h.base.writes, 0);
  const c = h.copy(); h.ui.apply(c, h.draft);
  assert.equal(c.reads, 1); assert.equal(c.writes, 1); assert.deepEqual(c.data, expected(h.base.data, h.draft.recipe));
});

test('apply rejects malformed recipes and oversized dimensions before any pixel allocation/write', () => {
  const h = harness(), c = h.copy(), invalid = h.snapshot(); invalid.recipe.channels.rgb.inputWhite = 0;
  assert.throws(() => h.ui.apply(c, invalid)); assert.equal(c.reads, 0); assert.equal(c.writes, 0);
  assert.throws(() => h.ui.apply(c, { type: 'other', recipe: null })); assert.equal(c.reads, 0);
  for (const [width, height] of [[0, 1], [1, 0], [1.5, 1], [4097, 1], [1, 4097], [4001, 2000], [3000, 3000], [16385, 1], [1, 16385], [16384, 16384], [8001, 8000]]) {
    const huge = { width, height, getContext() { throw Error('oversized readback was attempted'); } };
    assert.throws(() => h.ui.apply(huge, h.draft), /尺寸/);
  }
});

test('mobile budget accepts exact 8 MP and 4096-edge boundaries without allocating test frames', () => {
  const h = harness();
  for (const [width, height] of [[4000, 2000], [2000, 4000], [4096, 1], [1, 4096]]) {
    const sentinel = Error('dimension check passed; deliberately no large test allocation');
    let reads = 0;
    const boundary = { width, height, getContext() { return { getImageData() { reads++; throw sentinel; } }; } };
    assert.throws(() => h.ui.apply(boundary, h.draft), error => error === sentinel);
    assert.equal(reads, 1);
  }
});

test('null recipe replay is disabled without pixel writes, independent of UI setup default', () => {
  const h = harness(), disabled = h.inRealm({ type: 'levels', recipe: null }), c = h.copy();
  h.ui.release(); assert.equal(h.ui.changed(disabled), false); h.ui.apply(c, disabled);
  assert.deepEqual(c.data, h.base.data); assert.equal(c.writes, 0);
});
