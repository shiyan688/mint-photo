'use strict';
/* Controls keep only a portable recipe. The adapter owns preview rendering and
 * history; this module never allocates, resizes, or paints a photo canvas. */
(function (root, factory) {
  const api = factory(root, typeof module === 'object' && module.exports ? require('./canvas-padding.js') : null);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CanvasPaddingUI = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root, fallbackCore) {
  const PREVIEW_LIMITS = Object.freeze({ maxPixels: 8000000, maxEdge: 4096 });
  const SIDES = ['top', 'right', 'bottom', 'left'];
  let A = null, state = null;
  const $ = id => root.document && root.document.getElementById(id);
  const percent = value => String(+(value * 100).toFixed(2)) + '%';
  function core() {
    const C = root.MintCanvasPadding || fallbackCore;
    if (!C || !['defaults', 'validate', 'measure', 'plan'].every(key => typeof C[key] === 'function')) throw Error('留白核心未加载，照片未改变。');
    return C;
  }
  function live(draft = state && state.draft) {
    return !!(A && state && draft === state.draft && A.getDraft() === draft && $('toolPanel') === state.panel && state.panel.isConnected !== false);
  }
  function current() {
    if (!live() || A.revision() !== state.revision || A.getCanvas() !== state.source || state.source.width !== state.width || state.source.height !== state.height) {
      throw Error('照片版本已改变，请重新打开留白工具。');
    }
  }
  function size(value) {
    if (!value || !Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height) || value.width < 1 || value.height < 1) throw Error('画布尺寸无效，照片未改变。');
    return { width: value.width, height: value.height };
  }
  function mode(value) {
    if (!value || typeof value.allowed !== 'boolean' || typeof value.error !== 'string') throw Error('导出尺寸检查不可用，照片未改变。');
    return { allowed: value.allowed, output: value.allowed ? size(value.output) : null, error: value.error };
  }
  function readable(error) {
    const text = String(error && error.message || '');
    if (/[\u3400-\u9fff]/.test(text)) return text;
    if (/budget|edge|input|output|pixels|width|height/i.test(text)) return '留白后的预览超出安全尺寸上限（800万像素、单边4096像素），已保留上一次有效设置。';
    return '留白设置无效，已保留上一次有效设置。';
  }
  function status(text) { const node = $('cp-status'); if (node) node.textContent = text; }
  function fail(error) { const text = readable(error); status(text); if (A && A.toast) A.toast(text); }
  function checked(recipe) {
    current();
    const C = core(), r = C.validate(recipe);
    const preview = C.plan(state.width, state.height, r, PREVIEW_LIMITS);
    const full = size(A.getFullSize()), layout = C.measure(full.width, full.height, r);
    const assessed = A.assess(C.validate(r));
    if (!assessed) throw Error('导出尺寸检查不可用，照片未改变。');
    const original = mode(assessed.original), working = mode(assessed.working);
    current();
    if (!original.allowed && !working.allowed) {
      throw Error('原尺寸和工作尺寸导出均超出安全预算，已保留上一次有效设置。' +
        (original.error ? ' 原尺寸：' + original.error : '') + (working.error ? ' 工作尺寸：' + working.error : ''));
    }
    return { recipe: r, preview, layout, original, working };
  }
  function dimensions(value) { return value.width + ' × ' + value.height + ' 像素'; }
  function modeText(label, assessment) {
    return label + (assessment.allowed ? '可用 · ' + dimensions(assessment.output) : '不可用（安全预算）' + (assessment.error ? ' · ' + assessment.error : ''));
  }
  function sync() {
    if (!live()) return;
    const r = state.draft.recipe, same = SIDES.every(side => r[side] === r.top);
    for (const key of SIDES.concat('opacity')) {
      $('cp-' + key).value = String(+(r[key] * 100).toFixed(2));
      $('cp-' + key + '-value').textContent = percent(r[key]);
    }
    $('cp-equal').value = String(+(r.top * 100).toFixed(2));
    $('cp-equal-value').textContent = same ? percent(r.top) : '各边不同';
    $('cp-color').value = r.color;
    const evaluation = state.evaluation;
    $('cp-original-layout').textContent = '原尺寸布局（仅计算）：' + dimensions(evaluation.layout.outputSize);
    $('cp-original-export').textContent = modeText('原尺寸导出：', evaluation.original);
    $('cp-working-export').textContent = modeText('工作尺寸导出：', evaluation.working);
    $('cp-preview-size').textContent = '当前预览：' + dimensions(evaluation.preview.outputSize);
    if ($('editLabel')) $('editLabel').textContent = '留白预览 · 应用后可撤销';
  }
  function number(value) {
    if (typeof value !== 'string' || !value.trim()) throw Error('留白设置无效，已保留上一次有效设置。');
    const result = Number(value);
    if (!Number.isFinite(result)) throw Error('留白设置无效，已保留上一次有效设置。');
    return result / 100;
  }
  function edit(change) {
    if (!live()) return false;
    const session = state, oldRecipe = state.draft.recipe, oldEvaluation = state.evaluation;
    let committed = false;
    try {
      current();
      const next = core().validate(oldRecipe); change(next);
      const evaluation = checked(next);
      current();
      state.draft.recipe = evaluation.recipe; state.evaluation = evaluation; committed = true;
      sync(); A.render();
      status('留白预览已更新；点击应用保存一条可撤销记录。');
      return true;
    } catch (error) {
      if (state === session && live()) {
        if (committed) {
          state.draft.recipe = oldRecipe; state.evaluation = oldEvaluation;
          try { current(); A.render(); } catch (_) { /* Preserve the recipe if preview is unavailable. */ }
        }
        sync(); fail(error);
      }
      return false;
    }
  }
  function bind(id, event, action) {
    const node = $('cp-' + id), session = state;
    const handler = e => {
      if (state !== session || !live() || $('cp-' + id) !== node || node.isConnected === false) return;
      action(e || { target: node });
    };
    node[event] = handler; state.bindings.push([node, event, handler]);
  }
  function release() {
    if (state) for (const [node, event, handler] of state.bindings) if (node[event] === handler) node[event] = null;
    state = null; A = null;
  }
  function changed(draft) {
    if (!draft || draft.type !== 'canvas-padding' || !live(draft)) return false;
    try {
      current();
      if (Object.keys(draft).length !== 2 || !Object.prototype.hasOwnProperty.call(draft, 'recipe')) return false;
      const p = core().measure(state.width, state.height, core().validate(draft.recipe));
      return SIDES.some(side => p.padding[side] > 0);
    } catch (_) { return false; }
  }
  function setup(adapter) {
    release(); A = adapter;
    try {
      if (!A || !['getDraft', 'setDraft', 'getCanvas', 'getFullSize', 'assess', 'render', 'revision'].every(key => typeof A[key] === 'function')) throw Error('留白工具初始化失败，照片未改变。');
      const panel = $('toolPanel'), source = A.getCanvas(), base = size(source), draft = { type: 'canvas-padding', recipe: core().defaults() };
      if (!panel) throw Error('留白面板不可用，照片未改变。');
      state = { panel, source, width: base.width, height: base.height, revision: A.revision(), draft, evaluation: null, bindings: [] };
      A.setDraft(draft); state.evaluation = checked(draft.recipe);
      panel.innerHTML = '<div class="portrait-heading"><strong>画布留白 · 边框</strong><span>本地可撤销</span></div>' +
        '<p class="portrait-copy">只向外扩展画布，不缩放、不拉伸照片内容。每边按当前画面短边的比例计算，留白会改变导出尺寸。</p>' +
        '<div class="portrait-actions canvas-padding-presets"><button type="button" id="cp-preset-white" class="small-button">白色均匀 5%</button><button type="button" id="cp-preset-bottom" class="small-button">底部加宽 15%</button><button type="button" id="cp-preset-transparent" class="small-button">透明均匀 5%</button></div>' +
        '<p class="portrait-copy subtle">底部加宽：上、左、右各6%，底部15%。移动均匀滑杆会同时设置四边；也可逐边调整。</p>' +
        '<div class="sliders portrait-sliders canvas-padding-sliders">' +
        '<div class="slider-row"><label for="cp-equal">均匀留白</label><input type="range" id="cp-equal" min="0" max="50" step="0.1" value="0"><output id="cp-equal-value"></output></div>' +
        '<div class="slider-row"><label for="cp-top">上边</label><input type="range" id="cp-top" min="0" max="50" step="0.1" value="0"><output id="cp-top-value"></output></div>' +
        '<div class="slider-row"><label for="cp-right">右边</label><input type="range" id="cp-right" min="0" max="50" step="0.1" value="0"><output id="cp-right-value"></output></div>' +
        '<div class="slider-row"><label for="cp-bottom">下边</label><input type="range" id="cp-bottom" min="0" max="50" step="0.1" value="0"><output id="cp-bottom-value"></output></div>' +
        '<div class="slider-row"><label for="cp-left">左边</label><input type="range" id="cp-left" min="0" max="50" step="0.1" value="0"><output id="cp-left-value"></output></div>' +
        '<div class="slider-row"><label for="cp-opacity">不透明度</label><input type="range" id="cp-opacity" min="0" max="100" step="1" value="100"><output id="cp-opacity-value"></output></div></div>' +
        '<div class="portrait-actions canvas-padding-colors"><label for="cp-color">留白颜色</label><input type="color" id="cp-color" value="#ffffff"><button type="button" id="cp-swatch-white" class="small-button">白色</button><button type="button" id="cp-swatch-black" class="small-button">黑色</button><button type="button" id="cp-swatch-mint" class="small-button">薄荷</button></div>' +
        '<div class="portrait-actions"><button type="button" id="cp-reset" class="small-button">重置为零留白</button></div>' +
        '<div class="canvas-padding-dimensions"><p class="portrait-copy" id="cp-original-layout"></p><p class="portrait-copy" id="cp-original-export"></p><p class="portrait-copy" id="cp-working-export"></p><p class="portrait-copy subtle" id="cp-preview-size"></p></div>' +
        '<div class="portrait-status" id="cp-status" role="status" aria-live="polite"></div>' +
        '<p class="portrait-copy subtle">PNG保留透明留白；JPEG不支持透明，会合成到白色背景。不透明度只影响新增边框，照片原有像素和透明度保持不变。</p>' +
        '<p class="portrait-copy subtle">原尺寸布局仅计算尺寸，不分配原图像素。导出可用性分别按原尺寸和工作尺寸安全预算检查；超限不会静默缩小照片。</p>';
      bind('equal', 'oninput', e => edit(r => { const value = number(e.target.value); for (const side of SIDES) r[side] = value; }));
      for (const key of SIDES.concat('opacity')) bind(key, 'oninput', e => edit(r => { r[key] = number(e.target.value); }));
      bind('color', 'onchange', e => edit(r => { r.color = e.target.value; }));
      for (const [name, color] of [['white', '#ffffff'], ['black', '#000000'], ['mint', '#b7e4d4']]) bind('swatch-' + name, 'onclick', () => edit(r => { r.color = color; }));
      for (const name of ['white', 'bottom', 'transparent']) bind('preset-' + name, 'onclick', () => edit(r => {
        Object.assign(r, core().defaults());
        for (const side of SIDES) r[side] = name === 'bottom' ? .06 : .05;
        if (name === 'bottom') r.bottom = .15;
        if (name === 'transparent') r.opacity = 0;
      }));
      bind('reset', 'onclick', () => edit(r => Object.assign(r, core().defaults())));
      sync(); A.render(); status('当前为零留白，照片未改变。选择预设或拖动滑杆开始。');
      if (A.hint) A.hint('向外添加留白，不缩放照片；应用后可撤销');
      return true;
    } catch (error) {
      const text = readable(error), active = A; release();
      if (active && active.setDraft) active.setDraft(null);
      if ($('toolPanel')) $('toolPanel').textContent = text;
      if (active && active.toast) active.toast(text);
      return false;
    }
  }
  return { setup, release, changed };
});
