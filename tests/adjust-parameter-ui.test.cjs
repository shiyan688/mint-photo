'use strict';
// Runs the shipped showTool('adjust') and its event handlers. This validates
// state/DOM contracts, not browser layout or the pixel adjustment algorithm.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/editor.js'), 'utf8');
const start = source.indexOf('function showTool(');
const end = source.indexOf('function commitTransform(', start);
assert(start >= 0 && end > start, 'production tool setup must be present');
const keys = ['brightness', 'contrast', 'saturation', 'warmth'];
const plain = value => JSON.parse(JSON.stringify(value));

function harness() {
  const ids = new Map(), nodes = new Set(), renders = [];
  const voids = new Set(['input', 'br', 'hr', 'img', 'meta', 'link']);
  function matches(node, selector) {
    if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
    if (selector.startsWith('#')) return node.id === selector.slice(1);
    const attr = selector.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
    if (attr) return node.hasAttribute(attr[1]) && (attr[2] === undefined || node.getAttribute(attr[1]) === attr[2]);
    return node.tagName.toLowerCase() === selector.toLowerCase();
  }
  function descendants(node) {
    return node.children.flatMap(child => [child, ...descendants(child)]);
  }
  function element(tag, initial = {}, parent = null) {
    const attrs = { ...initial }, classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
    let text = '';
    const el = {
      tagName: tag.toUpperCase(), id: attrs.id || '', children: [], parentElement: parent,
      dataset: {}, hidden: 'hidden' in attrs, open: 'open' in attrs, disabled: 'disabled' in attrs,
      value: String(attrs.value || ''),
      classList: {
        contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name),
        toggle(name, force) { const yes = force ?? !classes.has(name); if (yes) classes.add(name); else classes.delete(name); return yes; }
      },
      setAttribute(name, value) { attrs[name] = String(value); },
      getAttribute: name => attrs[name] ?? null,
      hasAttribute: name => Object.hasOwn(attrs, name),
      querySelectorAll(selector) { return descendants(this).filter(node => matches(node, selector)); },
      click() { assert(!this.disabled, 'clicked disabled control ' + this.id); return this.onclick?.({ target: this }); }
    };
    for (const [name, value] of Object.entries(attrs)) if (name.startsWith('data-')) el.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    Object.defineProperty(el, 'textContent', {
      get() { return text + this.children.map(child => child.textContent).join(''); },
      set(value) { text = String(value); for (const child of this.children) remove(child); this.children.length = 0; }
    });
    Object.defineProperty(el, 'innerHTML', {
      get() { return this.markup || ''; },
      set(value) { this.markup = String(value); text = ''; for (const child of this.children) remove(child); this.children.length = 0; parse(this.markup, this); }
    });
    el.appendText = value => { text += value; };
    if (el.id) { assert(!ids.has(el.id), 'duplicate generated ID ' + el.id); ids.set(el.id, el); }
    if (parent) parent.children.push(el);
    nodes.add(el);
    return el;
  }
  function remove(node) {
    for (const child of node.children) remove(child);
    nodes.delete(node);
    if (node.id && ids.get(node.id) === node) ids.delete(node.id);
  }
  // Preserve actual nesting, including closed details and hidden ancestors;
  // a flat fake DOM would conceal a misplaced wrapper or closing tag.
  function parse(markup, root) {
    const stack = [root];
    for (const token of markup.matchAll(/<\/?[a-z][^>]*>|[^<]+/gi)) {
      const value = token[0];
      if (!value.startsWith('<')) { stack.at(-1).appendText(value); continue; }
      const tag = value.match(/^<(\/?)([a-z][a-z0-9]*)\b([^>]*)>/i);
      assert(tag, 'supported generated HTML');
      if (tag[1]) { assert.equal(stack.at(-1).tagName.toLowerCase(), tag[2].toLowerCase(), 'balanced closing ' + tag[2]); stack.pop(); continue; }
      const attrs = {};
      for (const attr of tag[3].matchAll(/([a-zA-Z][\w:-]*)(?:="([^"]*)")?/g)) attrs[attr[1]] = attr[2] ?? '';
      const node = element(tag[2], attrs, stack.at(-1));
      if (!voids.has(tag[2].toLowerCase()) && !tag[3].endsWith('/')) stack.push(node);
    }
    assert.equal(stack.length, 1, 'all generated containers close');
  }
  for (const id of ['toolPanel', 'stageHint', 'applyBar', 'editLabel']) element('div', { id });
  const document = {
    getElementById: id => ids.get(id) || null,
    querySelectorAll: selector => [...nodes].filter(node => matches(node, selector))
  };
  const env = { document, console, source: { width: 400, height: 600 }, viewport: null,
    pointer: null, painting: false, currentStroke: null, activeTool: null, draft: null,
    $: document.getElementById, scheduleRender: () => renders.push(true) };
  env.window = env;
  vm.createContext(env);
  vm.runInContext(source.slice(start, end), env, { filename: 'editor.js:showTool' });
  env.showTool('adjust');
  const h = {
    env, document, nodes, renders, $: document.getElementById,
    select(key) { this.$('adjust-' + key + '-option').click(); },
    input(key, value) { const input = this.$(key); input.value = String(value); input.oninput({ target: input }); },
    quick(name) { const button = document.querySelectorAll('[data-quick-adjust]').find(node => node.dataset.quickAdjust === name); assert(button, 'preset ' + name); button.click(); },
    visibleRows() { return keys.filter(key => !this.$('adjust-' + key + '-row').hidden); }
  };
  return h;
}

function assertSelection(h, selected) {
  assert.deepEqual(h.visibleRows(), [selected]);
  for (const key of keys) {
    const button = h.$('adjust-' + key + '-option');
    assert.equal(button.getAttribute('aria-pressed'), String(key === selected));
    assert.equal(button.classList.contains('active'), key === selected);
  }
}

test('adjust begins neutral with one brightness slider and a collapsed quick-color drawer', () => {
  const h = harness();
  assert.deepEqual(plain(h.env.draft), { type: 'adjust', values: { brightness: 0, contrast: 0, saturation: 0, warmth: 0 } });
  assertSelection(h, 'brightness');
  assert.equal(h.$('quickAdjustDetails').open, false);
  assert.equal(h.$('quickAdjustDetails').children[0].tagName, 'SUMMARY');
  assert.equal(h.$('quickAdjustDetails').children[0].textContent, '快速调色');
});

test('selecting any parameter changes only its visible row and pressed state', () => {
  const h = harness(), draft = h.env.draft, before = plain(draft), count = h.renders.length;
  const inputs = keys.map(key => h.$(key));
  for (const key of ['contrast', 'warmth', 'saturation', 'brightness', 'brightness']) {
    h.select(key);
    assertSelection(h, key);
    assert.equal(h.env.draft, draft);
    assert.deepEqual(plain(h.env.draft), before);
    assert.equal(h.renders.length, count, 'selection must not recompute the image');
    keys.forEach((name, i) => assert.equal(h.$(name), inputs[i], 'keep the original input ' + name));
  }
});

test('independent values survive switching, including negative warmth and hidden inputs', () => {
  const h = harness(), expected = { brightness: 23, contrast: -14, saturation: 31, warmth: -42 };
  for (const [key, value] of Object.entries(expected)) {
    h.select(key);
    const count = h.renders.length;
    h.input(key, value);
    assert.equal(h.renders.length, count + 1);
    assert.equal(String(h.$(key + 'Value').textContent), String(value));
  }
  for (const key of keys) {
    h.select(key);
    assert.equal(String(h.$(key).value), String(expected[key]));
    assert.equal(String(h.$(key + 'Value').textContent), String(expected[key]));
    assert.deepEqual(plain(h.env.draft.values), expected);
  }
});

test('quick color updates every original input and readout while preserving the selected parameter', () => {
  const h = harness(), originals = keys.map(key => h.$(key));
  h.select('warmth');
  h.$('quickAdjustDetails').open = true;
  const presets = { fresh: [4, 5, 7, 0], sun: [3, -3, 4, 14], cool: [2, 4, -3, -12] };
  for (const [name, values] of Object.entries(presets)) {
    const count = h.renders.length;
    h.quick(name);
    assert.equal(h.renders.length, count + 1);
    assertSelection(h, 'warmth');
    keys.forEach((key, i) => {
      assert.equal(h.$(key), originals[i]);
      assert.equal(h.env.draft.values[key], values[i]);
      assert.equal(String(h.$(key).value), String(values[i]));
      assert.equal(String(h.$(key + 'Value').textContent), String(values[i]));
    });
    const active = h.document.querySelectorAll('[data-quick-adjust]').filter(node => node.classList.contains('active'));
    assert.deepEqual(active.map(node => node.dataset.quickAdjust), [name]);
  }
});

test('manual editing clears preset selection; reset clears all values without changing parameter selection', () => {
  const h = harness();
  h.select('contrast');
  h.quick('sun');
  h.input('contrast', 9);
  assert(h.document.querySelectorAll('[data-quick-adjust]').every(node => !node.classList.contains('active')));
  h.quick('reset');
  assertSelection(h, 'contrast');
  assert.deepEqual(plain(h.env.draft.values), { brightness: 0, contrast: 0, saturation: 0, warmth: 0 });
  for (const key of keys) {
    assert.equal(String(h.$(key).value), '0');
    assert.equal(String(h.$(key + 'Value').textContent), '0');
  }
  const count = h.renders.length, before = plain(h.env.draft);
  h.$('quickAdjustDetails').open = false;
  h.$('quickAdjustDetails').open = true;
  assert.equal(h.renders.length, count);
  assert.deepEqual(plain(h.env.draft), before);
});

test('generated nested markup keeps unique original controls, labels and accessible parameter targets', () => {
  const h = harness(), panel = h.$('toolPanel'), details = h.$('quickAdjustDetails');
  assert.equal(panel.querySelectorAll('input').length, keys.length, 'do not clone ranges into a second control');
  for (const key of keys) {
    const input = h.$(key), row = h.$('adjust-' + key + '-row'), button = h.$('adjust-' + key + '-option');
    assert(row.classList.contains('parameter-slider'));
    assert.equal(input.parentElement, row);
    assert.equal(h.$(key + 'Value').parentElement, row);
    assert(h.$(key + 'Value').classList.contains('parameter-readout'));
    const label = row.querySelectorAll('label');
    assert.equal(label.length, 1);
    assert.equal(label[0].getAttribute('for'), key);
    assert.equal(button.dataset.adjustParam, key);
    assert(button.classList.contains('parameter-option'));
    assert.equal(button.getAttribute('aria-controls'), row.id);
    assert(!details.querySelectorAll('input').includes(input), 'primary parameters stay outside folded quick color');
  }
  const strip = panel.querySelectorAll('.parameter-strip');
  assert.equal(strip.length, 1);
  assert.equal(strip[0].getAttribute('role'), 'group');
  assert(strip[0].getAttribute('aria-label'));
  assert.equal(strip[0].querySelectorAll('.parameter-option').length, keys.length);
  assert.equal(details.querySelectorAll('[data-quick-adjust]').length, 4);
});
