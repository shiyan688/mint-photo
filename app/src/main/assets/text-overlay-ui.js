'use strict';
/* Paragraph controls share the export layout core. A drag is provisional until
 * pointer-up; re-edit previews start before the old paragraph, never over it. */
(function (root, factory) {
  const api = factory(root,
    typeof module === 'object' && module.exports ? require('./text-overlay.js') : null,
    typeof module === 'object' && module.exports ? require('./text-overlay-operation.js') : null);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TextOverlayUI = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root, fallbackCore, fallbackOperation) {
  let A = null, state = null, serial = 0;
  const $ = id => root.document && root.document.getElementById(id);
  const clone = value => JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const clamp = n => Math.max(0, Math.min(1, n));
  const sliders = [
    ['size', '字号 · 短边比例', .08, .01, .5, .005, 100, '%'],
    ['boxWidth', '文本框宽 · 画面比例', .9, .05, 1, .01, 100, '%'],
    ['lineHeight', '行距倍数', 1.25, 1, 2.5, .05, 1, ''],
    ['rotation', '旋转', 0, -180, 180, 1, 1, '°'],
    ['opacity', '不透明度', 1, 0, 1, .01, 100, '%'],
    ['outlineWidth', '描边 · 字号比例', 0, 0, .15, .005, 100, '%']
  ];
  function modules() {
    const T = root.MintTextOverlay || fallbackCore, O = root.MintTextOverlayOperation || fallbackOperation;
    if (!T || !O || !['defaults', 'validate', 'isActive', 'layout', 'render'].every(k => typeof T[k] === 'function') || typeof O.validate !== 'function') throw Error('文字核心未加载，照片未改变。');
    return { T, O };
  }
  function live(d = state && state.draft) { return !!(A && state && d === state.draft && A.getDraft() === d); }
  function revision() { return String(A.revision()); }
  function currentRevision() { if (!state || revision() !== state.revision) throw Error('照片版本已改变，请重新打开文字工具。'); }
  function readable(error) {
    const message = error && error.message || '';
    if (/[\u3400-\u9fff]/.test(message)) return message;
    if (/wrap|line|text|limit|length|character|budget/i.test(message)) return '文字最多500个字符、12个手动换行段、128个自动换行行；请缩短文字、减小字号或加宽文本框。';
    return '本次文字设置无效，已保留上一次有效内容。';
  }
  function status(text) { if ($('tx-status')) $('tx-status').textContent = text; }
  function fail(error) { const text = readable(error); status(text); if (A && A.toast) A.toast(text); }
  function disposable(canvas) {
    if (!canvas || (A && canvas === A.getCanvas())) return;
    canvas.width = 0; canvas.height = 0;
  }
  function invalidate() {
    if (!state) return;
    if (state.pointer) state.pointer.ended = true;
    state.pointer = null; state.generation++;
  }
  function release() {
    if (state) {
      invalidate();
      for (const [node, key, fn] of state.bindings) if (node[key] === fn) node[key] = null;
      if (root.removeEventListener) root.removeEventListener('blur', state.onBlur);
      if (root.document && root.document.removeEventListener) root.document.removeEventListener('visibilitychange', state.onHidden);
      disposable(state.editBase); state.editBase = null;
    }
    state = null; A = null;
  }
  function base(d) {
    if (!live(d)) throw Error('文字预览已结束，请重新打开工具。');
    currentRevision();
    const canvas = d.action === 'replace' ? state.editBase : A.getCanvas();
    if (!canvas || !Number.isSafeInteger(canvas.width) || !Number.isSafeInteger(canvas.height) || canvas.width < 1 || canvas.height < 1) throw Error('文字预览底图不可用，未改变照片。');
    return canvas;
  }
  function preflight(recipe, canvas) { return modules().T.layout(canvas.getContext('2d'), canvas.width, canvas.height, recipe); }
  function activePointer(d, q) {
    return live(d) && !!q && !q.ended && q === state.pointer && q.draft === d && q.generation === state.generation && revision() === state.revision;
  }
  function shownRecipe(d) { return activePointer(d, state && state.pointer) ? state.pointer.recipe : d.recipe; }
  function changed(d) {
    if (!d || d.type !== 'text-overlay') return false;
    const { T, O } = modules(), checked = O.validate(d), recipe = checked.recipe;
    if (checked.action === 'replace') return !state || !state.original || state.draft.id !== checked.id || !equal(T.validate(recipe), state.original);
    return T.isActive(recipe);
  }
  function apply(canvas, operation) {
    const { T, O } = modules(), op = O.validate(operation);
    if (op.action !== 'add') throw Error('Replace text operations must be collapsed before rendering');
    preflight(op.recipe, canvas);
    T.render(canvas.getContext('2d'), canvas.width, canvas.height, op.recipe);
    return canvas;
  }
  function preview(d) {
    const source = base(d), recipe = modules().T.validate(shownRecipe(d));
    preflight(recipe, source);
    const out = root.document.createElement('canvas');
    try {
      out.width = source.width; out.height = source.height;
      out.getContext('2d').drawImage(source, 0, 0);
      modules().T.render(out.getContext('2d'), out.width, out.height, recipe);
      // Caller owns this temporary canvas and may release it after copying pixels.
      return out;
    } catch (error) { disposable(out); throw error; }
  }
  function edit(fn) {
    if (!live()) return false;
    invalidate();
    try {
      currentRevision();
      const recipe = modules().T.validate(state.draft.recipe); fn(recipe);
      const checked = modules().T.validate(recipe), canvas = base(state.draft);
      preflight(checked, canvas);
      state.draft.recipe = checked;
      status(state.draft.action === 'replace' && !checked.text.trim() ? '清空后应用将移除这个段落；可用主工具栏撤销恢复。' : '文字预览已更新；点击应用后保存。');
      sync(); return true;
    } catch (error) { fail(error); sync(); return false; }
  }
  function getEditable() {
    const value = A.getEditable ? A.getEditable() : null;
    if (!value) return null;
    const checked = modules().O.validate(value);
    if (checked.action !== 'add') throw Error('可编辑段落状态无效，未改变历史。');
    return checked;
  }
  function sync() {
    if (!live()) return;
    const d = state.draft, r = d.recipe;
    if ($('tx-text').value !== r.text) $('tx-text').value = r.text;
    $('tx-fontFamily').value = r.fontFamily; $('tx-align').value = r.align;
    $('tx-color').value = r.color; $('tx-outlineColor').value = r.outlineColor;
    for (const key of ['bold', 'italic', 'shadow']) $('tx-' + key).checked = r[key];
    for (const [key, , , , , , scale, suffix] of sliders) {
      $('tx-' + key).value = String(r[key]);
      $('tx-' + key + '-value').textContent = String(+(r[key] * scale).toFixed(2)) + suffix;
    }
    $('tx-count').textContent = `${Array.from(r.text).length}/500 字符 · ${r.text.split('\n').length}/12 段 · 横向 ${(r.x * 100).toFixed(1)}% / 纵向 ${(r.y * 100).toFixed(1)}%`;
    $('tx-mode').textContent = d.action === 'replace' ? '编辑最近段落 · 应用保存替换记录' : '新段落 · 应用后保存';
    $('tx-edit-latest').disabled = !state.editable || d.action === 'replace';
    $('tx-clear').disabled = !r.text;
    if ($('editLabel')) $('editLabel').textContent = d.action === 'replace' ? '文字替换预览 · 应用后可撤销' : '文字预览 · 应用后保存';
    A.render();
  }
  function bind(id, key, fn) {
    const node = $('tx-' + id), active = state;
    const handler = event => { if (state === active && live()) fn(event || { target: node }); };
    node[key] = handler; state.bindings.push([node, key, handler]);
  }
  function fresh() {
    const { T, O } = modules();
    return O.validate({ type: 'text-overlay', action: 'add', id: 'text-' + Date.now().toString(36) + '-' + (++serial).toString(36) + '-' + Math.random().toString(36).slice(2, 10), recipe: T.defaults() });
  }
  function switchMode(mode) {
    if (!live()) return;
    invalidate();
    const session = state, expectedRevision = state.revision, expectedGeneration = state.generation, before = JSON.stringify(state.draft);
    const proceed = () => {
      if (state !== session || !live() || expectedRevision !== revision() || expectedGeneration !== state.generation || before !== JSON.stringify(state.draft)) return;
      let newBase = null;
      try {
        currentRevision();
        const editable = getEditable(), original = mode === 'replace' ? editable : null;
        if (mode === 'replace' && !original) throw Error('没有可重新编辑的最近段落；原有文字仍保留。');
        const next = original ? modules().O.validate({ ...original, action: 'replace' }) : fresh();
        if (original) {
          if (typeof A.createEditBase !== 'function') throw Error('无法准备编辑底图，原有文字仍保留。');
          newBase = A.createEditBase();
          if (!newBase || newBase === A.getCanvas() || newBase.width !== A.getCanvas().width || newBase.height !== A.getCanvas().height) throw Error('编辑底图无效，原有文字仍保留。');
          currentRevision(); preflight(next.recipe, newBase);
        } else preflight(next.recipe, A.getCanvas());
        const oldBase = state.editBase;
        state.draft = next; state.original = original ? clone(original.recipe) : null; state.editBase = newBase; newBase = null;
        A.setDraft(next); disposable(oldBase);
        state.editable = editable;
        status(original ? '正在编辑最近段落，不会重复叠印；清空后应用可移除它。' : '输入文字，可换行；在照片上拖动移动整个段落。');
        sync();
      } catch (error) { disposable(newBase); fail(error); sync(); }
    };
    if (changed(state.draft)) {
      if (typeof A.confirm !== 'function') { status('请先应用或取消当前段落，再切换编辑对象。'); return; }
      A.confirm('放弃当前文字预览？', '未应用的文字修改将丢弃，已经保存的照片历史不变。', proceed);
    } else proceed();
  }
  function setup(adapter) {
    release(); A = adapter;
    try {
      const d = fresh();
      state = { draft: d, revision: revision(), original: null, editBase: null, editable: getEditable(), generation: 0, pointer: null, bindings: [] };
      A.setDraft(d);
      $('toolPanel').innerHTML = `<div class="portrait-heading"><strong>文字 · 可重新编辑的段落</strong><span>本地可撤销</span></div>
        <p class="portrait-copy" id="tx-mode"></p><div class="portrait-actions"><button type="button" id="tx-new" class="small-button">新段落</button><button type="button" id="tx-edit-latest" class="small-button">编辑最近段落</button></div>
        <label for="tx-text" class="portrait-section-label">文字内容 · 支持多行</label><textarea id="tx-text" class="text-overlay-input" rows="4" placeholder="输入文字，回车换行" aria-describedby="tx-count tx-limits" spellcheck="false"></textarea><p class="portrait-copy" id="tx-count"></p>
        <div class="portrait-actions"><label for="tx-fontFamily">系统字体</label><select id="tx-fontFamily" class="text-overlay-select"><option value="sans">无衬线</option><option value="serif">衬线</option><option value="mono">等宽</option></select><label for="tx-align">对齐</label><select id="tx-align" class="text-overlay-select"><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></div>
        <div class="portrait-actions"><label class="manual-mask-toggle"><input type="checkbox" id="tx-bold">粗体</label><label class="manual-mask-toggle"><input type="checkbox" id="tx-italic">斜体</label><label class="manual-mask-toggle"><input type="checkbox" id="tx-shadow">阴影</label></div>
        <div class="sliders portrait-sliders">${sliders.map(([key, label, value, min, max, step]) => `<div class="slider-row"><label for="tx-${key}">${label}</label><input type="range" id="tx-${key}" min="${min}" max="${max}" step="${step}" value="${value}"><output id="tx-${key}-value"></output></div>`).join('')}</div>
        <div class="portrait-actions"><label for="tx-color">字色</label><input type="color" id="tx-color" value="#ffffff"><label for="tx-outlineColor">描边颜色</label><input type="color" id="tx-outlineColor" value="#000000"></div>
        <div class="portrait-actions"><button type="button" id="tx-center" class="small-button">移到画面中心</button><button type="button" id="tx-clear" class="small-button">清空文字</button></div>
        <div class="portrait-status" id="tx-status" role="status" aria-live="polite">输入文字，可换行；在照片上拖动移动整个段落。</div>
        <p class="portrait-copy subtle" id="tx-limits">最多500个 Unicode 字符、12个手动换行段和128个自动换行行。文本框宽度控制自动换行，不会横向压扁文字；超出画面的部分会裁切。系统字体在不同系统上的字形和换行可能不同。</p>
        <p class="portrait-copy subtle">仅新版段落支持重新编辑，且之后不能有其他类型的已应用编辑。旧版文字与贴纸保持原样。每次应用新增历史记录，不覆盖原图；主工具栏可撤销或重做。</p>`;
      bind('text', 'oninput', event => { if (!event.isComposing) edit(r => { r.text = event.target.value; }); });
      bind('text', 'oncompositionend', event => edit(r => { r.text = event.target.value; }));
      for (const key of ['fontFamily', 'align', 'color', 'outlineColor']) bind(key, 'onchange', event => edit(r => { r[key] = event.target.value; }));
      for (const key of ['bold', 'italic', 'shadow']) bind(key, 'onchange', event => edit(r => { r[key] = !!event.target.checked; }));
      for (const [key] of sliders) bind(key, 'oninput', event => edit(r => { r[key] = Number(event.target.value); }));
      bind('center', 'onclick', () => edit(r => { r.x = .5; r.y = .5; }));
      bind('clear', 'onclick', () => edit(r => { r.text = ''; }));
      bind('new', 'onclick', () => switchMode('add'));
      bind('edit-latest', 'onclick', () => switchMode('replace'));
      state.onBlur = () => { if (!live() || !state.pointer) return; invalidate(); status('未完成的移动已取消，文字仍在原位置。'); sync(); };
      state.onHidden = () => { if (root.document.hidden && state) state.onBlur(); };
      if (root.addEventListener) root.addEventListener('blur', state.onBlur);
      if (root.document.addEventListener) root.document.addEventListener('visibilitychange', state.onHidden);
      A.hint('输入多行文字；拖动移动段落，应用后可撤销'); sync();
    } catch (error) {
      const message = readable(error), adapter = A; release(); adapter.setDraft(null);
      if ($('toolPanel')) $('toolPanel').textContent = message; if (adapter.toast) adapter.toast(message);
    }
  }
  function point(p) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) throw Error('请在照片内拖动文字。');
    return { x: p.x, y: p.y };
  }
  function start(d, p) {
    if (!live(d)) return null;
    invalidate();
    try {
      currentRevision();
      const recipe = modules().T.validate(d.recipe);
      if (!recipe.text.trim()) return null;
      const first = point(p); preflight(recipe, base(d));
      const q = { draft: d, generation: state.generation, start: first, original: clone(recipe), recipe, ended: false };
      state.pointer = q; return q;
    } catch (error) { fail(error); return null; }
  }
  function candidate(q, p) {
    const next = point(p), recipe = clone(q.original);
    const dx = next.x - q.start.x, dy = next.y - q.start.y;
    recipe.x = clamp(q.original.x + dx); recipe.y = clamp(q.original.y + dy);
    return modules().T.validate(recipe);
  }
  function move(d, p, q) {
    if (!activePointer(d, q)) { if (q) q.ended = true; return; }
    try { const recipe = candidate(q, p); preflight(recipe, base(d)); q.recipe = recipe; A.render(); }
    catch (error) { q.ended = true; state.pointer = null; fail(error); sync(); }
  }
  function finish(d, p, q, cancelled) {
    if (!activePointer(d, q)) { if (q) q.ended = true; return; }
    q.ended = true; state.pointer = null;
    if (cancelled) { status('移动已取消，文字仍在原位置。'); sync(); return; }
    try {
      currentRevision(); const recipe = candidate(q, p); preflight(recipe, base(d));
      d.recipe = recipe; status('文字位置已更新；点击应用后保存。');
    } catch (error) { fail(error); }
    sync();
  }
  function overlay(ctx, w, h, d) {
    if (!live(d) || !Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1) return;
    ctx.save();
    try {
      currentRevision(); const recipe = shownRecipe(d);
      if (!recipe.text.trim()) return;
      const layout = modules().T.layout(ctx, w, h, recipe);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = '#e0f7bb'; ctx.lineWidth = Math.max(1, Math.min(w, h) / 400);
      if (ctx.setLineDash) ctx.setLineDash([5, 4]);
      ctx.beginPath();
      layout.corners.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      if (ctx.closePath) ctx.closePath(); else ctx.lineTo(layout.corners[0].x, layout.corners[0].y);
      ctx.stroke(); if (ctx.setLineDash) ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(recipe.x * w, recipe.y * h, Math.max(3, Math.min(w, h) / 150), 0, Math.PI * 2); ctx.stroke();
    } catch (error) { status(readable(error)); }
    finally { ctx.restore(); }
  }
  return { setup, release, changed, apply, preview, start, move, finish, overlay };
});
