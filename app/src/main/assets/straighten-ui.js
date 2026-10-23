/* Arbitrary-angle straighten controls. The portable draft contains only a
 * recipe; guide lines never enter pixels or history. Every callback and preview
 * belongs to one immutable source/dimension snapshot and one tool session. */
(function (root) {
  'use strict';
  const PREVIEW_SIDE = 900, MAX_EDGE = 4096, MAX_PIXELS = 8000000;
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  let A = null, S = null;
  const $ = id => S && S.panel.querySelector('#st-' + id);
  function data(value, key, optional) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('校直数据无效，已阻止应用');
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field && optional && !(key in value)) return undefined;
    if (!field || !field.enumerable || !own(field, 'value')) throw Error('校直数据含缺失字段或访问器，已阻止应用');
    return field.value;
  }
  function size(value, shortKeys, bounded) {
    const width = data(value, shortKeys ? 'w' : 'width'), height = data(value, shortKeys ? 'h' : 'height');
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
        (bounded && (width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_PIXELS))) {
      throw Error('校直尺寸超出安全限制（800万像素、单边4096像素），已阻止应用');
    }
    return { width, height };
  }
  function basisSize(value) {
    const result = size(value, true, false), basis = data(value, 'basis', true);
    if (basis !== undefined && basis !== 'original' && basis !== 'working') throw Error('校直尺寸基准无效，已阻止应用');
    return { width: result.width, height: result.height, basis: basis || 'original' };
  }
  function modules() {
    const C = root.MintStraighten, O = root.MintStraightenOperation;
    if (!C || !O || !['defaults', 'validate', 'isActive', 'plan'].every(k => typeof C[k] === 'function') ||
        !['validate', 'plan', 'applyCanvas'].every(k => typeof O[k] === 'function')) {
      throw Error('校直核心未加载，当前作品未改变');
    }
    return { C, O };
  }
  function sameSource() {
    if (!S || !A || A.getDraft() !== S.draft || S.panel !== A.panel || S.panel.isConnected === false) return false;
    const source = A.getCanvas(), basis = basisSize(A.outputSize());
    return source === S.source && source.width === S.width && source.height === S.height &&
      basis.width === S.basis.width && basis.height === S.basis.height && basis.basis === S.basis.basis;
  }
  function live(d) {
    try { return !!S && (!d || d === S.draft) && !S.sourceImportPending && sameSource() && A.revision() === S.revision; }
    catch (_) { return false; }
  }
  function current(d) { if (!live(d)) throw Error('作品或工具已变化，请重新打开校直'); }
  function operation(d) { return modules().O.validate(d); }
  function readable(error) {
    const message = String(error && error.message || '');
    if (/[\u3400-\u9fff]/.test(message)) return message;
    if (/angle|finite|range|recipe|mode|version/i.test(message)) return '校直设置无效：请输入−180至180度的有限数值，已保留上一次有效设置';
    if (/budget|limit|pixel|width|height|dimension|edge/i.test(message)) return '校直尺寸超出安全预算（800万像素、单边4096像素），未缩小声明输出';
    return '校直处理失败，原图和已有编辑已保留';
  }
  function status(message) { const node = $('status'); if (node) node.textContent = message; }
  function fail(error) { const message = readable(error); status(message); if (A && A.toast) A.toast(message); }
  function exportMode(value) {
    const allowed = data(value, 'allowed'), error = data(value, 'error', true), output = data(value, 'output', true);
    if (typeof allowed !== 'boolean' || (error !== undefined && typeof error !== 'string') ||
        (!allowed && (typeof error !== 'string' || !error.trim()))) throw Error('校直导出预算检查不可用，已阻止应用');
    return { allowed, error: error || '', output: allowed ? size(output, false, true) : null };
  }
  function assessment(op) {
    const result = A.assess(op);
    const original = exportMode(data(result, 'original')), working = exportMode(data(result, 'working'));
    return { original, working };
  }
  function evaluate(d) {
    current();
    const op = operation(d), planned = modules().O.plan(S.width, S.height, op, { maxSide: PREVIEW_SIDE });
    // The core is never asked to rasterize or even plan an over-limit original.
    // Export assessment owns both full original and working-stage dimensions.
    const preview = size(data(planned, 'renderedSize'), false, true);
    if (Math.max(preview.width, preview.height) > PREVIEW_SIDE) throw Error('校直预览超过900像素限制，已阻止应用');
    const result = assessment(op); current();
    return { op, preview, original: result.original, working: result.working };
  }
  function dimensions(value) { return value.width + ' × ' + value.height + ' 像素'; }
  function modeText(label, value) { return label + (value.allowed ? '可用 · ' + dimensions(value.output) : '不可用 · ' + value.error); }
  function sync() {
    if (!live()) return;
    const r = operation(S.draft).recipe, e = S.evaluation;
    $('angle').value = String(r.angle); $('angle-number').value = String(r.angle); $('angle-value').textContent = String(r.angle) + '°';
    $('mode').value = r.mode; $('grid').checked = S.grid;
    $('mode-note').textContent = r.mode === 'expand' ? '扩展画布：保留旋转后的完整画面，四角可能透明；不会自动填充。' : '自动裁切：取居中、无新增透明角的较小画布，会裁去边缘；不补边、不放大。';
    $('basis').textContent = (S.basis.basis === 'working' ? '当前工作尺寸推算：' : '当前原图基准：') + dimensions(S.basis) +
      '；当前预览基准：' + dimensions({ width: S.width, height: S.height }) + '。实际工作尺寸以工作尺寸导出检查为准。';
    $('preview-size').textContent = '当前预览：' + dimensions(e.preview) + '（最长边≤900，仅预览缩小）。';
    $('original-export').textContent = modeText('原尺寸导出：', e.original);
    $('working-export').textContent = modeText('工作尺寸导出：', e.working);
    $('budget').textContent = !e.original.allowed && !e.working.allowed ? '两种方式均不可用，已阻止应用；请调整角度或模式，不会静默降低输出尺寸。' :
      (modules().C.isActive(r) ? '应用后新增一条可撤销编辑；已保留原图和已有历史。' : '当前为0°，画面没有变化，不新增历史记录。');
    const label = root.document && root.document.getElementById('editLabel'); if (label) label.textContent = '校直预览 · 正数顺时针';
  }
  function changed(d) {
    if (!d || !live(d)) return false;
    try { return modules().C.isActive(operation(d).recipe) === true; } catch (_) { return false; }
  }
  function canApply(d) {
    if (!changed(d) || S.previewError) return false;
    try { const result = evaluate(d); return live(d) && (result.original.allowed || result.working.allowed); }
    catch (_) { return false; }
  }
  function number(value) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 128 || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) {
      throw Error('请输入−180至180度的有效角度，已保留上一次有效设置');
    }
    const angle = Number(value);
    if (!Number.isFinite(angle) || angle < -180 || angle > 180) throw Error('角度须为−180至180度的有限数值，已保留上一次有效设置');
    if (angle === 0 && /[1-9]/.test(value.trim().split(/e/i)[0])) throw Error('角度精度过小，不能表示为0°；已保留上一次有效设置');
    return angle;
  }
  function edit(change) {
    if (!live()) return false;
    const owner = S, oldRecipe = S.draft.recipe, oldEvaluation = S.evaluation, oldError = S.previewError;
    let committed = false;
    try {
      const next = { ...operation(S.draft).recipe }; change(next);
      const evaluated = evaluate({ type: 'straighten', recipe: next }); current();
      S.draft.recipe = evaluated.op.recipe; S.evaluation = evaluated; S.previewError = null; committed = true;
      sync(); A.render(); current();
      status(!evaluated.original.allowed && !evaluated.working.allowed ? '该角度和模式超出两种导出预算，已阻止应用；可继续调整。' :
        modules().C.isActive(S.draft.recipe) ? '校直预览已更新；点击应用保存一条可撤销记录。' : '已回到0°，不新增历史记录。');
      return true;
    } catch (error) {
      if (S === owner && live()) {
        if (committed) { S.draft.recipe = oldRecipe; S.evaluation = oldEvaluation; S.previewError = oldError; }
        try { sync(); if (committed) A.render(); } catch (_) { /* Preserve the last valid recipe even if rendering is unavailable. */ }
        fail(error);
      }
      return false;
    }
  }
  function bind(id, event, action) {
    const node = $(id), owner = S, generation = S.generation;
    if (!node) throw Error('校直控件缺失');
    const handler = e => {
      if (S !== owner || S.generation !== generation || !live() || $(id) !== node || node.isConnected === false) return false;
      // Read the bound control, not an injected or stale event target.
      return action(node, e);
    };
    node[event] = handler; S.bindings.push([node, event, handler]);
  }
  function clearBindings() {
    if (S) for (const [node, event, handler] of S.bindings) if (node[event] === handler) node[event] = null;
    if (S) S.bindings = [];
  }
  function bindControls() {
    bind('angle', 'oninput', n => edit(r => { r.angle = number(n.value); }));
    bind('angle-number', 'onchange', n => edit(r => { r.angle = number(n.value); }));
    bind('mode', 'onchange', n => edit(r => { r.mode = n.value; }));
    bind('reset', 'onclick', () => edit(r => { r.angle = 0; }));
    bind('grid', 'onchange', n => { const before = S.grid; S.grid = n.checked === true; try { A.render(); return true; } catch (error) { S.grid = before; n.checked = before; fail(error); return false; } });
  }
  function disableControls(disabled) { for (const id of ['angle', 'angle-number', 'mode', 'reset', 'grid']) { const node = $(id); if (node) node.disabled = disabled; } }
  function sourceImportStarted() {
    if (!S || !A) return false;
    let same = false; try { same = sameSource(); } catch (_) { /* Invalid metadata cannot rebind. */ }
    S.sourceImportPending = { restorable: same }; S.generation++; clearBindings(); disableControls(true);
    status('正在导入主照片；暂时停用校直，原图和已有编辑仍保留。'); return true;
  }
  function sourceImportFinished() {
    if (!S || !A || !S.sourceImportPending || !S.sourceImportPending.restorable) return false;
    try {
      if (!sameSource()) return false;
      S.sourceImportPending = null; S.revision = A.revision(); S.generation++;
      S.evaluation = evaluate(S.draft); S.previewError = null; bindControls(); disableControls(false); sync(); A.render();
      status('主照片未替换，校直设置已保留，可继续调整。'); return true;
    } catch (error) { if (S) { S.sourceImportPending = { restorable: false }; clearBindings(); disableControls(true); fail(error); } return false; }
  }
  function preview(d) {
    current(d); const owner = S, adapter = A, allocated = new Set();
    const makeCanvas = (width, height) => {
      current(d);
      const c = adapter.createCanvas(width, height);
      if (!c || c === owner.source || allocated.has(c) || typeof c.getContext !== 'function') throw Error('校直预览画布不可用，当前作品未改变');
      c.width = width; c.height = height; allocated.add(c); return c;
    };
    let output = null;
    try {
      const evaluation = evaluate(d), op = evaluation.op;
      output = modules().O.applyCanvas(owner.source, op, makeCanvas, { maxSide: PREVIEW_SIDE });
      if (output === owner.source) {
        if (modules().C.isActive(op.recipe)) throw Error('校直预览未完成，已阻止应用');
        output = makeCanvas(evaluation.preview.width, evaluation.preview.height);
        output.getContext('2d').drawImage(owner.source, 0, 0, output.width, output.height);
      }
      current(d);
      if (!output || output === owner.source || !allocated.has(output) || typeof output.getContext !== 'function' ||
          output.width !== evaluation.preview.width || output.height !== evaluation.preview.height) throw Error('校直预览尺寸不符，已阻止应用');
      S.evaluation = evaluation; S.previewError = null;
      const node = $('preview-size'); if (node) node.textContent = '当前预览：' + dimensions(output) + '（最长边≤900，仅预览缩小）。';
      return output; // The editor owns this fresh canvas and disposes it after drawing.
    } catch (error) {
      for (const c of allocated) if (c !== owner.source) { c.width = 1; c.height = 1; }
      if (S === owner && live(d)) { S.previewError = readable(error); status(S.previewError); const node = $('budget'); if (node) node.textContent = S.previewError + '；已阻止应用。'; }
      throw error;
    }
  }
  function overlay(ctx, width, height, d) {
    if (!live(d) || !S.grid || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    try { operation(d); } catch (_) { return; }
    ctx.save();
    try {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = Math.max(1, width / 600);
      if (typeof ctx.setLineDash === 'function') ctx.setLineDash([]);
      ctx.beginPath();
      for (const ratio of [1 / 3, 2 / 3]) { ctx.moveTo(width * ratio, 0); ctx.lineTo(width * ratio, height); ctx.moveTo(0, height * ratio); ctx.lineTo(width, height * ratio); }
      ctx.stroke();
    } finally { ctx.restore(); }
  }
  function release() { if (S) { S.generation++; clearBindings(); } S = null; A = null; }
  function setup(adapter) {
    release(); A = adapter;
    try {
      const { C, O } = modules();
      if (!A || !A.panel || !['getDraft', 'setDraft', 'getCanvas', 'createCanvas', 'render', 'revision', 'outputSize', 'assess'].every(k => typeof A[k] === 'function')) throw Error('校直界面适配缺失，当前作品未改变');
      const source = A.getCanvas(), bounds = size({ width: source && source.width, height: source && source.height }, false, true);
      const basis = Object.freeze(basisSize(A.outputSize())), initial = O.validate({ type: 'straighten', recipe: C.defaults() });
      const draft = { type: initial.type, recipe: initial.recipe };
      S = { panel: A.panel, source, width: bounds.width, height: bounds.height, basis, revision: A.revision(), draft,
        grid: true, generation: 0, bindings: [], sourceImportPending: null, evaluation: null, previewError: null };
      A.setDraft(draft); S.evaluation = evaluate(draft);
      S.panel.innerHTML = '<div class="straighten-controls"><div class="portrait-heading"><strong>旋转校直</strong><span>角度单位：度（°）</span></div>' +
        '<p class="portrait-copy">正数顺时针，负数逆时针。调整当前作品，不替换已保留原图；应用后可撤销，已有历史不变。</p>' +
        '<div class="slider-row"><label for="st-angle">校直角度</label><input id="st-angle" type="range" min="-180" max="180" step="0.1"><output id="st-angle-value"></output></div>' +
        '<div class="portrait-actions"><label for="st-angle-number">精确角度（度）</label><input id="st-angle-number" type="number" inputmode="decimal" min="-180" max="180" step="any" style="width:110px"><button type="button" id="st-reset" class="small-button">重置为0°</button></div>' +
        '<div class="portrait-actions"><label for="st-mode">画布处理</label><select id="st-mode"><option value="expand">扩展画布 · 透明角</option><option value="crop">自动裁切 · 裁去边缘</option></select></div>' +
        '<p class="portrait-copy" id="st-mode-note"></p><div class="portrait-actions"><label for="st-grid"><input id="st-grid" type="checkbox">显示参考网格（不导出）</label></div>' +
        '<p class="portrait-copy" id="st-basis"></p><p class="portrait-copy" id="st-preview-size"></p>' +
        '<p class="portrait-copy" id="st-original-export"></p><p class="portrait-copy" id="st-working-export"></p><p class="portrait-copy" id="st-budget"></p>' +
        '<p class="portrait-status" id="st-status" role="status" aria-live="polite"></p>' +
        '<p class="portrait-copy">自动裁切不补边、不放大；扩展模式的透明区域在PNG中保留，JPEG会合成白底。预览和工作尺寸不代表原图分辨率；导出尺寸分别检查，不会静默降级。</p>' +
        '<p class="portrait-copy">拖动滑杆或输入角度校直；照片上的单指拖动不会旋转照片。查看位置请使用导航平移模式或双指操作。</p></div>';
      bindControls(); sync(); A.render(); status('当前为0°，不新增历史记录；拖动滑杆或输入角度开始。');
      if (A.hint) A.hint('正数顺时针；扩展保留透明角，裁切会去掉边缘');
      return draft;
    } catch (error) {
      const adapter = A, message = readable(error); release();
      if (adapter && typeof adapter.setDraft === 'function') adapter.setDraft(null);
      if (adapter && adapter.panel) adapter.panel.textContent = message;
      if (adapter && adapter.toast) adapter.toast(message);
      return null;
    }
  }
  root.StraightenUI = Object.freeze({ setup, release, changed, canApply, preview, overlay, sourceImportStarted, sourceImportFinished });
})(typeof globalThis !== 'undefined' ? globalThis : this);
