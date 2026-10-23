'use strict';
/* Conventional Levels controls. Rendering always uses the shared MintLevels
 * core, never an independent approximation or the previous preview pixels. */
(() => {
  let session = null, serial = 0;
  // Match the Android project/export boundary, which is intentionally tighter
  // than the shared desktop-capable core's 64 MP / 16384-edge ceiling.
  const MOBILE_LIMITS = Object.freeze({ pixels: 8000000, edge: 4096 });
  const $ = id => document.getElementById(id);
  const channels = { rgb: 'RGB 整体', red: '红通道', green: '绿通道', blue: '蓝通道' };
  const fields = [
    ['inputBlack', '输入黑点', 0, 255, 1],
    ['inputWhite', '输入白点', 0, 255, 1],
    ['gamma', '中间调 γ', .1, 10, .01],
    ['outputBlack', '输出黑点', 0, 255, 1],
    ['outputWhite', '输出白点', 0, 255, 1]
  ];
  function core() {
    const value = window.MintLevels;
    if (!value || !['defaults', 'validate', 'isActive', 'apply'].every(key => typeof value[key] === 'function') || !value.LIMITS) {
      throw Error('色阶核心未加载，未应用任何效果。');
    }
    return value;
  }
  function recipeOf(draft) {
    if (!draft || draft.type !== 'levels') throw TypeError('无效的色阶编辑。');
    return core().validate(draft.recipe);
  }
  function changed(draft) {
    return !!draft && draft.type === 'levels' && core().isActive(draft.recipe);
  }
  function release() {
    const previous = session;
    session = null; serial++;
    if (!previous) return;
    previous.invalidated = true;
    for (const [node, handlers] of previous.bindings) {
      for (const [name, handler] of handlers) if (node[name] === handler) node[name] = null;
    }
    previous.bindings.clear();
  }
  function live(s) {
    if (!s || session !== s || s.serial !== serial || s.invalidated) return false;
    try {
      if (s.adapter.getDraft() !== s.draft || $('toolPanel') !== s.panel ||
          s.adapter.getCanvas() !== s.source || s.source.width !== s.width || s.source.height !== s.height ||
          (s.hasRevision && !Object.is(s.adapter.revision(), s.revision))) {
        s.invalidated = true;
        return false;
      }
      return true;
    } catch (_) { s.invalidated = true; return false; }
  }
  function bind(s, id, name, fn) {
    const node = $(id);
    const handler = event => {
      // Check the originating node and handler as well as the photo/session.
      // A detached control or queued callback cannot edit a later channel/tool.
      if (!live(s) || $(id) !== node || node[name] !== handler) return;
      if (event && event.target && event.target !== node) return;
      fn(node);
    };
    if (!s.bindings.has(node)) s.bindings.set(node, new Map());
    s.bindings.get(node).set(name, handler);
    node[name] = handler;
  }
  function numeric(value) {
    // DOM values are strings, but empty/whitespace, hex, Infinity and coercible
    // objects are not numeric edits. Core validation enforces every constraint.
    if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
      throw TypeError('Invalid Levels control');
    }
    const n = Number(value);
    if (!Number.isFinite(n)) throw TypeError('Invalid Levels control');
    return n;
  }
  function notice(s, text) {
    if (!live(s)) return;
    const status = $('levelsStatus');
    if (status) status.textContent = text;
    s.adapter.toast(text);
  }
  function edit(s, fn) {
    if (!live(s)) return;
    let next;
    try {
      next = recipeOf(s.draft);
      fn(next);
      next = core().validate(next);
    } catch (_) {
      sync(s);
      notice(s, '数值无效，未改变色阶。黑白点须为 0–255 整数，输入黑点小于白点、输出黑点不大于白点；γ 为 0.1–10，强度为 0–1。');
      return;
    }
    if (!live(s)) return;
    // Repeated identical input events do not replace the recipe or schedule
    // another render. A.render must start from its unchanged committed canvas.
    const different = JSON.stringify(s.draft.recipe) !== JSON.stringify(next);
    if (different) s.draft.recipe = next;
    sync(s);
    if (different && live(s)) s.adapter.render();
  }
  function control(id, label, value, min, max, step) {
    return `<div class="slider-row"><label for="${id}">${label}</label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}"><input type="number" id="${id}-number" aria-label="${label}精确数值" min="${min}" max="${max}" step="${step === 1 ? 1 : 'any'}" value="${value}" inputmode="decimal" style="width:5.5em;min-width:0;padding:5px;border:1px solid #d6e3db;border-radius:6px;background:#fff;color:inherit"></div>`;
  }
  function values(id, value, min, max) {
    for (const suffix of ['', '-number']) {
      const node = $(id + suffix);
      node.min = String(min); node.max = String(max); node.value = String(value);
    }
  }
  function sync(s) {
    if (!live(s)) return;
    const recipe = s.draft.recipe, key = s.channel, c = recipe.channels[key];
    values('levelsStrength', recipe.strength, 0, 1);
    for (const name of Object.keys(channels)) {
      $('levelsChannel-' + name).classList.toggle('active', name === key);
      $('levelsChannel-' + name).setAttribute('aria-pressed', String(name === key));
    }
    for (const [field, , low, high] of fields) {
      const min = field === 'inputWhite' ? c.inputBlack + 1 : field === 'outputWhite' ? c.outputBlack : low;
      const max = field === 'inputBlack' ? c.inputWhite - 1 : field === 'outputBlack' ? c.outputWhite : high;
      values('levels-' + field, c[field], min, max);
      // The key is captured now, not read from mutable state when a delayed
      // handler runs. Rebinding makes old-channel callbacks inert immediately.
      for (const [suffix, event] of [['', 'oninput'], ['-number', 'onchange']]) {
        bind(s, 'levels-' + field + suffix, event, node => edit(s, next => { next.channels[key][field] = numeric(node.value); }));
      }
    }
    bind(s, 'levelsResetChannel', 'onclick', () => edit(s, next => { next.channels[key] = core().defaults().channels[key]; }));
    $('levelsStatus').textContent = core().isActive(recipe)
      ? `${channels[key]} · 强度 ${+(recipe.strength * 100).toFixed(4)}% · 预览中，应用后生效`
      : recipe.strength === 0 ? '强度为 0，保留参数但不改变照片。' : '中性起点，保持原色。';
  }
  function setup(adapter, initialRecipe = null) {
    release();
    const panel = $('toolPanel');
    let recipe, source, revision;
    try {
      if (!adapter || !['getDraft', 'setDraft', 'getCanvas', 'render', 'toast', 'hint'].every(key => typeof adapter[key] === 'function')) throw TypeError('色阶编辑接口不可用。');
      recipe = initialRecipe === null ? core().defaults() : core().validate(initialRecipe);
      source = adapter.getCanvas();
      if (!panel || !source) throw TypeError('色阶编辑需要已打开的照片。');
      if (typeof adapter.revision === 'function') revision = adapter.revision();
    } catch (error) {
      if (adapter && typeof adapter.setDraft === 'function') adapter.setDraft(null);
      const text = /未加载/.test(error.message) ? error.message : '色阶参数无效或照片不可用，未应用任何效果。';
      if (panel) panel.textContent = text;
      if (adapter && typeof adapter.toast === 'function') adapter.toast(text);
      return null;
    }
    const draft = { type: 'levels', recipe };
    const s = { adapter, panel, draft, source, width: source.width, height: source.height,
      serial, revision, hasRevision: typeof adapter.revision === 'function',
      channel: 'rgb', invalidated: false, bindings: new Map() };
    session = s;
    adapter.setDraft(draft);
    if (!live(s)) return null;
    panel.innerHTML = `<div class="portrait-heading"><strong>色阶 · 从原色开始</strong><span>本地可撤销</span></div>
      <p class="portrait-copy">手动设置黑白点与中间调。8 位 sRGB 常规色阶，不是 RAW / HDR 高光恢复，也不会自动美颜。</p>
      <div class="segmented tone-channels" role="group" aria-label="色阶通道">${Object.entries(channels).map(([key, label]) => `<button type="button" id="levelsChannel-${key}">${label}</button>`).join('')}</div>
      <div class="sliders portrait-sliders">${fields.map(([key, label, min, max, step]) => control('levels-' + key, label, recipe.channels.rgb[key], min, max, step)).join('')}</div>
      <p class="portrait-copy">输入：黑点小于白点。输出：黑点不大于白点，允许等值。γ 大于 1 提亮中间调，小于 1 压暗。</p>
      ${control('levelsStrength', '总强度 0–1', recipe.strength, 0, 1, .01)}
      <div class="portrait-actions"><button type="button" class="small-button" id="levelsResetChannel">重置当前通道</button><button type="button" class="small-button" id="levelsReset">全部回到中性</button></div>
      <p class="portrait-copy" id="levelsStatus" role="status" aria-live="polite"></p>
      <p class="portrait-copy subtle">先整体 RGB，再分通道，最后混合一次总强度。预览不会累积上一帧的调整；应用后可撤销。不恢复已剪切的细节。</p>`;
    for (const key of Object.keys(channels)) bind(s, 'levelsChannel-' + key, 'onclick', () => {
      if (s.channel === key) return;
      s.channel = key; sync(s);
    });
    for (const [suffix, event] of [['', 'oninput'], ['-number', 'onchange']]) {
      bind(s, 'levelsStrength' + suffix, event, node => edit(s, next => { next.strength = numeric(node.value); }));
    }
    bind(s, 'levelsReset', 'onclick', () => edit(s, next => {
      const neutral = core().defaults(); next.channels = neutral.channels; next.strength = neutral.strength;
    }));
    if ($('editLabel')) $('editLabel').textContent = '色阶预览 · 应用后保存';
    adapter.hint('先整体 RGB，再分通道；所有改动从中性开始');
    sync(s);
    if (live(s)) adapter.render();
    return draft;
  }
  function apply(canvas, draft) {
    const levels = core(), recipe = recipeOf(draft);
    const width = canvas && canvas.width, height = canvas && canvas.height;
    // Refuse impossible dimensions before asking the canvas for a frame-sized
    // readback, not merely after allocating it in the shared core.
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
        width > Math.min(MOBILE_LIMITS.edge, levels.LIMITS.edge) || height > Math.min(MOBILE_LIMITS.edge, levels.LIMITS.edge) ||
        width * height > Math.min(MOBILE_LIMITS.pixels, levels.LIMITS.pixels)) {
      throw TypeError('色阶图像尺寸超出移动端处理范围（800 万像素、单边 4096）。');
    }
    if (session && live(session) && canvas === session.source) throw TypeError('色阶预览必须使用照片副本，不能覆盖原图。');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw TypeError('色阶画布不可用。');
    const im = ctx.getImageData(0, 0, width, height), source = { width, height, data: im.data };
    const out = levels.apply(source, recipe);
    if (out !== source) {
      // Reuse the readback ImageData: no third frame-sized UI buffer.
      im.data.set(out.data); ctx.putImageData(im, 0, 0);
    }
    return canvas;
  }
  window.LevelsUI = { setup, release, changed, apply };
})();
