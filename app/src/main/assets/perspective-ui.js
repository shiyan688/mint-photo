/* Four-corner projective selection UI. The recipe contains source pixel-EDGE
 * coordinates, never canvas handles, grid pixels, or preview dimensions.
 * Pointer API: start(d,{x,y}) selects the nearest corner within radius .12 in
 * normalized SOURCE axes; it does not jump the corner. move/finish accept the
 * same source coordinates. Always consume perspective events in the editor,
 * including false starts and corrected-preview mode, so they cannot paint.
 * Optional opaque gesture tokens guard integrations that retain pointer state.
 */
(function (root) {
  'use strict';
  const PREVIEW_SIDE = 900, MAX_EDGE = 4096, MAX_PIXELS = 8000000, HIT_RADIUS = 0.12;
  const LABELS = ['左上 TL', '右上 TR', '右下 BR', '左下 BL'];
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const issuedCanvases = new WeakSet();
  let A = null, S = null;
  const $ = id => S && S.panel.querySelector('#px-' + id);
  function data(value, key, optional) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('透视数据无效，已阻止应用');
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field && optional && !(key in value)) return undefined;
    if (!field || !field.enumerable || !own(field, 'value')) throw Error('透视数据含缺失字段或访问器，已阻止应用');
    return field.value;
  }
  function size(value, shortKeys, bounded) {
    const width = data(value, shortKeys ? 'w' : 'width'), height = data(value, shortKeys ? 'h' : 'height');
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
        (bounded && (width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_PIXELS))) {
      throw Error('透视尺寸超出安全限制（800万像素、单边4096像素），已阻止应用');
    }
    return { width, height };
  }
  function basisSize(value) {
    const result = size(value, true, false), basis = data(value, 'basis', true);
    if (basis !== undefined && basis !== 'original' && basis !== 'working') throw Error('透视尺寸基准无效，已阻止应用');
    return { width: result.width, height: result.height, basis: basis || 'original' };
  }
  function modules() {
    const C = root.MintPerspective, O = root.MintPerspectiveOperation;
    if (!C || !O || !['defaults', 'validate', 'isActive', 'plan', 'mapEdgePoint'].every(k => typeof C[k] === 'function') ||
        !['validate', 'plan', 'applyCanvas'].every(k => typeof O[k] === 'function')) throw Error('透视核心未加载，当前作品未改变');
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
  function current(d) { if (!live(d)) throw Error('作品或工具已变化，请重新打开透视校正'); }
  function operation(d) { return modules().O.validate(d); }
  function copyRecipe(r) { return { version: r.version, quad: r.quad.map(p => ({ x: p.x, y: p.y })), outputFraction: { width: r.outputFraction.width, height: r.outputFraction.height } }; }
  function readable(error) {
    const message = String(error && error.message || '');
    if (/[\u3400-\u9fff]/.test(message)) return message;
    if (/convex|quad|winding|collinear|singular|horizon|area|cross|point|corner|matrix|homograph/i.test(message)) return '四角须按左上、右上、右下、左下围成凸四边形，不能交叉或共线；已保留上一次有效设置';
    if (/fraction|finite|range|recipe|version|coordinate/i.test(message)) return '透视数值无效，已保留上一次有效设置';
    if (/budget|limit|pixel|width|height|dimension|edge|memory/i.test(message)) return '透视尺寸超出安全预算（800万像素、单边4096像素），未缩小声明输出';
    return '透视处理失败，原图和已有编辑已保留';
  }
  function status(message) { const node = $('status'); if (node) node.textContent = message; }
  function fail(error, quiet) { const message = readable(error); status(message); if (!quiet && A && A.toast) A.toast(message); }
  function exportMode(value) {
    const allowed = data(value, 'allowed'), error = data(value, 'error', true), output = data(value, 'output', true);
    if (typeof allowed !== 'boolean' || (error !== undefined && typeof error !== 'string') ||
        (!allowed && (typeof error !== 'string' || !error.trim()))) throw Error('透视导出预算检查不可用，已阻止应用');
    return { allowed, error: error || '', output: allowed ? size(output, false, true) : null };
  }
  function assessment(op) {
    const result = A.assess(op);
    return { original: exportMode(data(result, 'original')), working: exportMode(data(result, 'working')) };
  }
  function evaluate(d) {
    current(); const owner = S;
    const op = operation(d), planned = modules().O.plan(owner.width, owner.height, op, { maxSide: PREVIEW_SIDE });
    const preview = size(data(planned, 'renderedSize'), false, true), output = size(data(planned, 'outputSize'), false, true);
    if (Math.max(preview.width, preview.height) > PREVIEW_SIDE) throw Error('透视预览超过900像素限制，已阻止应用');
    const result = assessment(op); current(owner.draft);
    return { op, preview, output, original: result.original, working: result.working };
  }
  function sourcePreviewSize() {
    const scale = Math.min(1, PREVIEW_SIDE / Math.max(S.width, S.height));
    return { width: Math.max(1, Math.round(S.width * scale)), height: Math.max(1, Math.round(S.height * scale)) };
  }
  function dimensions(value) { return value.width + ' × ' + value.height + ' 像素'; }
  function declaredSize(r) { return { width: Math.max(1, Math.round(S.basis.width * r.outputFraction.width)), height: Math.max(1, Math.round(S.basis.height * r.outputFraction.height)) }; }
  function modeText(label, value) { return label + (value.allowed ? '可用 · ' + dimensions(value.output) : '不可用 · ' + value.error); }
  function sync() {
    if (!live()) return;
    const r = operation(S.draft).recipe, e = S.evaluation, declared = declaredSize(r);
    for (let i = 0; i < 4; i++) for (const axis of ['x', 'y']) { const n = $(i + '-' + axis); n.value = String(r.quad[i][axis] * 100); n.disabled = S.corrected; }
    $('width').value = String(declared.width); $('height').value = String(declared.height);
    $('width').max = String(S.basis.width); $('height').max = String(S.basis.height);
    $('grid').checked = S.grid; $('grid').disabled = S.corrected;
    $('preview').textContent = S.corrected ? '返回选角' : '校正预览';
    $('mode-note').textContent = S.corrected ? '正在查看实际透视校正结果。此处不显示可拖动角点，返回选角后再调整。' : '正在原始当前画面上选角；拖动带标签的四角，或输入下方坐标。选区外像素将被裁去。';
    $('basis').textContent = (S.basis.basis === 'working' ? '当前工作尺寸推算：' : '当前原图基准：') + dimensions(S.basis) +
      '；当前预览基准：' + dimensions({ width: S.width, height: S.height }) + '。输出宽高按此完整基准设定，不能超过各自原轴。';
    $('declared-size').textContent = '声明输出：' + dimensions(declared) + '；不因900像素预览限制而改变。';
    $('preview-size').textContent = (S.corrected ? '校正预览：' + dimensions(e.preview) : '选角视图：' + dimensions(sourcePreviewSize()) + '；校正预览将为：' + dimensions(e.preview)) + '（最长边≤900，仅预览缩小）。';
    $('original-export').textContent = modeText('原尺寸导出：', e.original);
    $('working-export').textContent = modeText('工作尺寸导出：', e.working);
    $('budget').textContent = S.previewError ? S.previewError + '；已阻止应用，请重试校正预览。' :
      !e.original.allowed && !e.working.allowed ? '两种方式均不可用，已阻止应用；请减小输出宽高，不会静默降低输出尺寸。' :
      modules().C.isActive(r) ? '应用后新增一条可撤销编辑；已保留原图和已有历史。' : '当前为完整四角与原宽高，画面没有变化，不新增历史记录。';
    const label = root.document && root.document.getElementById('editLabel'); if (label) label.textContent = S.corrected ? '透视校正预览 · 返回选角可调整' : '源画面选角 · TL → TR → BR → BL';
  }
  function changed(d) {
    if (!d || !live(d)) return false;
    try { return modules().C.isActive(operation(d).recipe) === true; } catch (_) { return false; }
  }
  function canApply(d) {
    if (!changed(d) || S.previewError || S.gesture) return false;
    try { const result = evaluate(d); return live(d) && (result.original.allowed || result.working.allowed); }
    catch (_) { return false; }
  }
  function decimal(value, label) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 128 || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) throw Error(label + '须为有效十进制数值，已保留上一次有效设置');
    const n = Number(value);
    if (!Number.isFinite(n) || (n === 0 && /[1-9]/.test(value.trim().split(/e/i)[0]))) throw Error(label + '数值无效或精度过小，已保留上一次有效设置');
    return n === 0 ? 0 : n;
  }
  function coordinate(value) {
    const n = decimal(value, '角点坐标');
    if (n < 0 || n > 100 || (n > 0 && n / 100 === 0)) throw Error('角点坐标须为0至100%，已保留上一次有效设置');
    return n / 100;
  }
  function outputFraction(value, axis) {
    const n = decimal(value, '输出' + (axis === 'width' ? '宽度' : '高度'));
    if (!Number.isSafeInteger(n) || n < 1 || n > S.basis[axis]) throw Error('输出宽高须为1至当前基准对应边长的整数像素，不会放大声明输出；已保留上一次有效设置');
    return n / S.basis[axis];
  }
  function edit(change, quiet) {
    if (!live()) return false;
    const owner = S, oldRecipe = S.draft.recipe, oldEvaluation = S.evaluation, oldError = S.previewError;
    let committed = false;
    try {
      const next = copyRecipe(operation(S.draft).recipe); change(next);
      const evaluated = evaluate({ type: 'perspective', recipe: next }); current(owner.draft);
      S.draft.recipe = evaluated.op.recipe; S.evaluation = evaluated; committed = true;
      // A source-only redraw must not erase an earlier failed full transform.
      sync(); A.render(); current(owner.draft);
      if (S.previewError) status(S.previewError + '；已保留设置，校正预览成功后才能应用。');
      else status(!evaluated.original.allowed && !evaluated.working.allowed ? '当前输出超出两种导出预算，已阻止应用；可继续减小宽高。' :
        modules().C.isActive(S.draft.recipe) ? '四角与输出尺寸已更新；点击校正预览检查结果，再应用保存。' : '已恢复完整四角与原宽高，不新增历史记录。');
      return true;
    } catch (error) {
      if (S === owner && live()) {
        const renderError = S.previewError;
        if (committed) { S.draft.recipe = oldRecipe; S.evaluation = oldEvaluation; S.previewError = renderError || oldError; }
        try { sync(); if (committed) A.render(); } catch (_) { /* Preserve valid geometry even if the display is unavailable. */ }
        fail(error, quiet);
      }
      return false;
    }
  }
  function bind(id, event, action) {
    const node = $(id), owner = S, generation = S.generation;
    if (!node) throw Error('透视控件缺失');
    const handler = e => {
      if (S !== owner || S.generation !== generation || !live() || $(id) !== node || node.isConnected === false || node.disabled) return false;
      return action(node, e); // Never use a foreign event target.
    };
    node[event] = handler; S.bindings.push([node, event, handler]);
  }
  function clearBindings() {
    if (S) for (const [node, event, handler] of S.bindings) if (node[event] === handler) node[event] = null;
    if (S) S.bindings = [];
  }
  function togglePreview() {
    if (!live()) return false;
    cancelGesture(); const owner = S, before = S.corrected;
    try { S.corrected = !before; sync(); A.render(); current(owner.draft); status(S.previewError ? S.previewError + '；已阻止应用。' : S.corrected ? '正在查看校正结果；返回选角可继续调整。' : '已返回源画面选角，输出设置保持不变。'); return true; }
    catch (error) {
      if (S === owner && live()) { S.corrected = before; try { sync(); A.render(); } catch (_) {} fail(error); }
      return false;
    }
  }
  function bindControls() {
    for (let i = 0; i < 4; i++) for (const axis of ['x', 'y']) bind(i + '-' + axis, 'onchange', n => { const value = n.value; cancelGesture(); return edit(r => { r.quad[i][axis] = coordinate(value); }); });
    for (const axis of ['width', 'height']) bind(axis, 'onchange', n => { const value = n.value; cancelGesture(); return edit(r => { r.outputFraction[axis] = outputFraction(value, axis); }); });
    bind('reset', 'onclick', () => { cancelGesture(); return edit(r => { const d = modules().C.defaults(); r.quad = copyRecipe(d).quad; r.outputFraction = { ...d.outputFraction }; }); });
    bind('preview', 'onclick', togglePreview);
    bind('grid', 'onchange', n => { const owner = S, before = S.grid; S.grid = n.checked === true; try { A.render(); current(owner.draft); return true; } catch (error) { if (S === owner && live()) { S.grid = before; n.checked = before; fail(error); } return false; } });
  }
  function disableControls(disabled) {
    for (const id of ['width', 'height', 'reset', 'preview', 'grid', ...[0, 1, 2, 3].flatMap(i => [i + '-x', i + '-y'])]) { const node = $(id); if (node) node.disabled = disabled; }
  }
  function validPoint(p) { return p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y); }
  function start(d, p) {
    if (!live(d) || S.corrected || S.gesture || !validPoint(p) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return false;
    try {
      const r = operation(d).recipe; let corner = -1, distance = HIT_RADIUS;
      for (let i = 0; i < 4; i++) { const v = Math.hypot(p.x - r.quad[i].x, p.y - r.quad[i].y); if (v <= distance) { distance = v; corner = i; } }
      if (corner < 0) return false;
      const token = Object.freeze({ kind: 'perspective-corner', corner });
      S.gesture = { token, recipe: d.recipe, evaluation: S.evaluation, previewError: S.previewError, corner, origin: { x: p.x, y: p.y }, anchor: { ...r.quad[corner] } };
      status('正在调整' + LABELS[corner] + '；手势取消会恢复拖动前的精确位置。'); return token;
    } catch (error) { fail(error); return false; }
  }
  function move(d, p, token) {
    if (!live(d) || S.corrected || !S.gesture || (token && token !== S.gesture.token) || !validPoint(p)) return false;
    const g = S.gesture;
    return edit(r => { r.quad[g.corner] = { x: Math.max(0, Math.min(1, g.anchor.x + p.x - g.origin.x)), y: Math.max(0, Math.min(1, g.anchor.y + p.y - g.origin.y)) }; }, true);
  }
  function finish(d, p, token, cancelled) {
    if (cancelled) return cancelGesture();
    if (!live(d) || !S.gesture || (token && token !== S.gesture.token)) return false;
    if (validPoint(p)) move(d, p, token);
    if (!live(d) || !S.gesture) return false;
    S.gesture = null; sync(); try { A.render(); } catch (error) { fail(error); return false; } return true;
  }
  function cancelGesture(silent) {
    if (!S || !S.gesture) return false;
    const owner = S, g = S.gesture; S.gesture = null;
    let same = false; try { same = sameSource(); } catch (_) {}
    if (!same) return false;
    S.draft.recipe = g.recipe; S.evaluation = g.evaluation; S.previewError = g.previewError;
    if (!silent && live()) {
      try { sync(); A.render(); if (S === owner && live()) status('已取消本次拖动，恢复拖动前的四角与尺寸。'); }
      catch (error) { if (S === owner && live()) fail(error); }
    }
    return true;
  }
  function sourceImportStarted() {
    if (!S || !A) return false;
    const owner = S; cancelGesture(true); if (S !== owner) return false; let same = false; try { same = sameSource(); } catch (_) {}
    S.sourceImportPending = { restorable: same }; S.generation++; clearBindings(); disableControls(true);
    status('正在导入主照片；暂时停用透视，原图和已有编辑仍保留。'); return true;
  }
  function sourceImportFinished() {
    if (!S || !A || !S.sourceImportPending || !S.sourceImportPending.restorable) return false;
    const owner = S;
    try {
      if (!sameSource()) return false;
      S.sourceImportPending = null; S.revision = A.revision(); S.generation++;
      S.evaluation = evaluate(S.draft); bindControls(); disableControls(false); sync(); A.render(); current(owner.draft);
      status(S.previewError ? S.previewError + '；校正预览成功后才能应用。' : '主照片未替换，透视设置已保留，可继续调整。'); return true;
    } catch (error) { if (S === owner) { S.sourceImportPending = { restorable: false }; clearBindings(); disableControls(true); fail(error); } return false; }
  }
  function preview(d) {
    current(d); const owner = S, adapter = A, allocated = new Set();
    const makeCanvas = (width, height) => {
      current(d); const c = adapter.createCanvas(width, height); current(d);
      if (!c || c === owner.source || issuedCanvases.has(c) || allocated.has(c) || typeof c.getContext !== 'function') throw Error('透视预览画布不可用，当前作品未改变');
      issuedCanvases.add(c); allocated.add(c); c.width = width; c.height = height; return c;
    };
    try {
      const evaluation = evaluate(d), op = evaluation.op, expected = S.corrected ? evaluation.preview : sourcePreviewSize();
      let output;
      if (S.corrected) output = modules().O.applyCanvas(owner.source, op, makeCanvas, { maxSide: PREVIEW_SIDE, shouldCancel: () => !live(d) || S !== owner });
      if (!S.corrected || output === owner.source) {
        if (S.corrected && modules().C.isActive(op.recipe)) throw Error('透视校正预览未完成，已阻止应用');
        output = makeCanvas(expected.width, expected.height); output.getContext('2d').drawImage(owner.source, 0, 0, output.width, output.height);
      }
      current(d);
      if (!output || output === owner.source || !allocated.has(output) || typeof output.getContext !== 'function' || output.width !== expected.width || output.height !== expected.height) throw Error('透视预览尺寸不符，已阻止应用');
      S.evaluation = evaluation; if (S.corrected) S.previewError = null;
      sync(); return output; // Fresh editor-owned canvas, safe to dispose after draw.
    } catch (error) {
      for (const c of allocated) {
        // A reentrant import may have adopted an allocated canvas as its new
        // source. Never dispose either the old or the currently active photo.
        try { if (c !== owner.source && c !== adapter.getCanvas() && (!A || c !== A.getCanvas())) { c.width = 1; c.height = 1; } } catch (_) {}
      }
      if (S === owner && live(d)) { S.previewError = readable(error); status(S.previewError); const node = $('budget'); if (node) node.textContent = S.previewError + '；已阻止应用。'; }
      throw error;
    }
  }
  function overlay(ctx, width, height, d) {
    if (!live(d) || S.corrected || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    let r; try { r = operation(d).recipe; } catch (_) { return; }
    const q = r.quad.map(p => ({ x: p.x * width, y: p.y * height }));
    ctx.save();
    try {
      ctx.strokeStyle = 'rgba(255,255,255,0.94)'; ctx.lineWidth = Math.max(1.5, width / 500);
      if (typeof ctx.setLineDash === 'function') ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(q[0].x, q[0].y); for (let i = 1; i < 4; i++) ctx.lineTo(q[i].x, q[i].y); ctx.lineTo(q[0].x, q[0].y); ctx.stroke();
      if (S.grid) {
        // The inverse homography maps output thirds into the SOURCE view.
        // Use a core-issued plan: adapter plans may wrap its metadata.
        const C = modules().C, plan = C.plan(S.width, S.height, r, { maxSide: PREVIEW_SIDE });
        const out = plan.renderedSize, lines = [];
        for (const t of [1 / 3, 2 / 3]) {
          lines.push([{ x: out.width * t, y: 0 }, { x: out.width * t, y: out.height }]);
          lines.push([{ x: 0, y: out.height * t }, { x: out.width, y: out.height * t }]);
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath();
        for (const line of lines) {
          const a = C.mapEdgePoint(plan, line[0], 'outputToSource'), b = C.mapEdgePoint(plan, line[1], 'outputToSource');
          if (a && b) { ctx.moveTo(a.x / S.width * width, a.y / S.height * height); ctx.lineTo(b.x / S.width * width, b.y / S.height * height); }
        }
        ctx.stroke();
      }
      const radius = Math.max(5, Math.min(10, Math.min(width, height) / 28)), font = Math.max(10, Math.min(16, width / 30));
      ctx.font = '600 ' + font + 'px sans-serif'; ctx.textBaseline = 'middle';
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = S.gesture && S.gesture.corner === i ? '#fff3a6' : '#4ee5b5';
        ctx.beginPath(); ctx.arc(q[i].x, q[i].y, radius, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#153a32'; ctx.stroke();
        const left = i === 0 || i === 3, top = i < 2;
        ctx.textAlign = left ? 'left' : 'right';
        const x = Math.max(3, Math.min(width - 3, q[i].x + (left ? radius + 4 : -radius - 4))), y = Math.max(font, Math.min(height - font, q[i].y + (top ? radius + font : -radius - font)));
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; if (typeof ctx.strokeText === 'function') ctx.strokeText(LABELS[i], x, y);
        ctx.fillStyle = '#ffffff'; ctx.fillText(LABELS[i], x, y); ctx.lineWidth = Math.max(1.5, width / 500);
      }
    } finally { ctx.restore(); }
  }
  function release() { if (S) { cancelGesture(true); S.generation++; clearBindings(); } S = null; A = null; }
  function setup(adapter) {
    release(); A = adapter;
    try {
      const { C, O } = modules();
      if (!A || !A.panel || !['getDraft', 'setDraft', 'getCanvas', 'createCanvas', 'render', 'revision', 'outputSize', 'assess'].every(k => typeof A[k] === 'function')) throw Error('透视界面适配缺失，当前作品未改变');
      const source = A.getCanvas(), bounds = size({ width: source && source.width, height: source && source.height }, false, true);
      const basis = Object.freeze(basisSize(A.outputSize())), initial = O.validate({ type: 'perspective', recipe: C.defaults() });
      const draft = { type: initial.type, recipe: initial.recipe };
      S = { panel: A.panel, source, width: bounds.width, height: bounds.height, basis, revision: A.revision(), draft,
        grid: true, corrected: false, gesture: null, generation: 0, bindings: [], sourceImportPending: null, evaluation: null, previewError: null };
      A.setDraft(draft); S.evaluation = evaluate(draft);
      S.panel.innerHTML = '<div class="perspective-controls"><div class="portrait-heading"><strong>四角透视校正</strong><span>源画面选角</span></div>' +
        '<p class="portrait-copy">四角按左上 TL → 右上 TR → 右下 BR → 左下 BL 依次围成凸四边形，校正为矩形。调整当前作品，不替换已保留原图；应用后可撤销，已有历史不变。</p>' +
        '<div class="portrait-actions"><button type="button" id="px-preview" class="small-button">校正预览</button><button type="button" id="px-reset" class="small-button">重置四角与尺寸</button></div>' +
        '<p class="portrait-copy" id="px-mode-note"></p><div class="perspective-corners">' + LABELS.map((label, i) => '<fieldset><legend>' + label + '</legend><label for="px-' + i + '-x">X（%）</label><input id="px-' + i + '-x" type="number" inputmode="decimal" min="0" max="100" step="any"><label for="px-' + i + '-y">Y（%）</label><input id="px-' + i + '-y" type="number" inputmode="decimal" min="0" max="100" step="any"></fieldset>').join('') + '</div>' +
        '<div class="portrait-actions perspective-output"><label for="px-width">输出宽（像素）</label><input id="px-width" type="number" inputmode="numeric" min="1" step="1"><label for="px-height">输出高（像素）</label><input id="px-height" type="number" inputmode="numeric" min="1" step="1"></div>' +
        '<div class="portrait-actions"><label for="px-grid"><input id="px-grid" type="checkbox">显示参考网格（不导出）</label></div>' +
        '<p class="portrait-copy" id="px-basis"></p><p class="portrait-copy" id="px-declared-size"></p><p class="portrait-copy" id="px-preview-size"></p>' +
        '<p class="portrait-copy" id="px-original-export"></p><p class="portrait-copy" id="px-working-export"></p><p class="portrait-copy" id="px-budget"></p>' +
        '<p class="portrait-status" id="px-status" role="status" aria-live="polite"></p>' +
        '<p class="portrait-copy">X从左到右、Y从上到下，坐标0%与100%表示画面像素外边缘。不能交叉、共线或调换角点；无效输入保留上一设置。透视会重采样且可能拉伸选区，不会恢复缺失细节；透明像素保留，JPEG合成白底。缩小使用预滤波，强斜切或两方向压缩相差很大时细节仍可能变软；预算不足将明确拒绝，不静默缩小声明尺寸。</p>' +
        '<p class="portrait-copy">只拖动角点附近可选角，画面其它位置不会绘画。取消手势会恢复本次拖动前的位置；双指或导航平移可查看画面。网格与标签仅供参考，不写入导出图片。</p></div>';
      bindControls(); sync(); A.render(); status('当前为完整四角与原宽高，不新增历史记录；先在源画面选择四角。');
      if (A.hint) A.hint('拖动 TL、TR、BR、BL 四角；校正预览看结果，返回选角继续调整');
      return draft;
    } catch (error) {
      const adapter = A, message = readable(error); release();
      if (adapter && typeof adapter.setDraft === 'function') adapter.setDraft(null);
      if (adapter && adapter.panel) adapter.panel.textContent = message;
      if (adapter && adapter.toast) adapter.toast(message);
      return null;
    }
  }
  root.PerspectiveUI = Object.freeze({ setup, release, changed, canApply, preview, overlay, start, move, finish, cancelGesture, sourceImportStarted, sourceImportFinished });
})(typeof globalThis !== 'undefined' ? globalThis : this);
