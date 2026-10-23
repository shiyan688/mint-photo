'use strict';
// Independent, controlled DOM and RGBA surface. Not WebView/handset coverage.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assets = path.resolve(__dirname, '../../../app/src/main/assets');
function surface(width = 128, height = 128, initial) {
  let data = initial ? new Uint8ClampedArray(initial) : new Uint8ClampedArray(width * height * 4);
  if (!initial) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
    data.set([x * 2, y * 2, ((x >> 3) ^ (y >> 3)) & 1 ? 220 : 30, 255], (y * width + x) * 4);
  const canvas = { width, height, get data() { return data; } };
  const ctx = {
    getImageData() { return { width, height, data: new Uint8ClampedArray(data) }; },
    createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData(image) { data = new Uint8ClampedArray(image.data); },
    save() {}, restore() {}, beginPath() {}, arc() {}, moveTo() {}, lineTo() {}, stroke() {}, drawImage() {}
  };
  canvas.getContext = () => ctx;
  return canvas;
}
function harness(options = {}) {
  const nodes = {}, notices = [], base = options.base || surface();
  let draft;
  function element(id) {
    const classes = new Set();
    return nodes[id] = { id, value: '', checked: false, disabled: false, textContent: '',
      classList: { toggle(key, on) { on ? classes.add(key) : classes.delete(key); }, contains: key => classes.has(key) } };
  }
  element('toolPanel'); element('editLabel');
  Object.defineProperty(nodes.toolPanel, 'innerHTML', { set(value) {
    for (const match of value.matchAll(/<[^>]*id="([^"]+)"[^>]*>/g)) {
      const node = element(match[1]);
      node.value = match[0].match(/value="([^"]+)"/)?.[1] || '';
      node.checked = match[0].includes('checked'); node.disabled = match[0].includes('disabled');
    }
  } });
  const env = { console, Uint8Array, Uint8ClampedArray, Float32Array, Float64Array, setTimeout,
    document: { getElementById: id => nodes[id] || null, createElement: () => surface() } };
  env.window = env; vm.createContext(env);
  for (const filename of ['manual-tools.js', 'selection-edit.js', 'repair-brush-core.js', 'manual-retouch-ui.js']) {
    const file = path.join(assets, filename);
    if (filename === 'selection-edit.js' && !fs.existsSync(file)) continue;
    vm.runInContext(fs.readFileSync(file, 'utf8'), env, { filename });
  }
  const adapter = { revision: () => 'audit-ui', getDraft: () => draft, setDraft: value => { draft = value; },
    getCanvas: () => base, render() {}, toast: text => notices.push(text), hint() {}, detectFace() {}, ...options.adapter };
  env.ManualRetouchUI.setup(adapter);
  return { env, base, nodes, notices, adapter, get draft() { return draft; },
    inRealm(value) { env.__auditSerialized = JSON.stringify(value); return vm.runInContext('JSON.parse(__auditSerialized)', env); },
    click(id) { if (!nodes[id] || nodes[id].disabled) throw Error('Unavailable test control: ' + id); nodes[id].onclick(); },
    slide(id, value) { nodes[id].value = String(value); nodes[id].oninput({ target: nodes[id] }); },
    stroke(points, cancelled = false) { const token = env.ManualRetouchUI.start(draft, points[0]);
      for (const point of points.slice(1, -1)) env.ManualRetouchUI.move(draft, point, token);
      env.ManualRetouchUI.finish(draft, points.at(-1), token, cancelled); return token; },
    mask() { return env.MintManualTools.rasterizeSelection(base.width, base.height, draft.selection, { sourceRevision: draft.sourceRevision }); }
  };
}
module.exports = { assets, surface, harness };
