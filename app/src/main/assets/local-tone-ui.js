'use strict';
/* Current-batch local color layers. Pixels and masks use the shared deterministic
 * cores; pointer previews never mutate saved recipes before a valid pointer-up. */
(() => {
  let A = null, state = null, serial = 0;
  const $ = id => document.getElementById(id);
  const copy = value => JSON.parse(JSON.stringify(value));
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const escapeHTML = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const keys = ['exposure', 'contrast', 'saturation', 'temperature'];
  const slider = (id, label, value, min, max, step = 1) => `<div class="slider-row"><label for="lt-${id}">${label}</label><input type="range" id="lt-${id}" min="${min}" max="${max}" step="${step}" value="${value}"><output id="lt-${id}-value">${value}</output></div>`;
  function modules() {
    const O = window.MintLocalToneOperation, L = window.MintLocalAdjustments, M = window.MintManualTools;
    if (!O || !L || !M || !['validate', 'changed', 'apply'].every(k => typeof O[k] === 'function') ||
        typeof L.weight !== 'function' || typeof M.validateSelection !== 'function' || typeof M.rasterizeSelection !== 'function') {
      throw Error('局部调色核心未加载，未应用任何效果');
    }
    return { O, L, M };
  }
  function live(d = state && state.draft) { return !!(state && A && state.draft === d && A.getDraft() === d); }
  function current() { return state && state.draft.layers.find(layer => layer.id === state.activeId); }
  function status(text) { if ($('lt-status')) $('lt-status').textContent = text; }
  function readable(error) {
    if (/[\u3400-\u9fff]/.test(error.message || '')) return error.message;
    if (/collinear|lasso|polygon/i.test(error.message || '')) return '套索至少需要三个不共线的点，请重新圈选。';
    if (/gradient|endpoint/i.test(error.message || '')) return '渐变两端太近，请拉开一点再松手。';
    if (/revision/i.test(error.message || '')) return '照片版本已改变，请重新打开局部调色。';
    if (/limit|budget|count|memory|too many/i.test(error.message || '') || /LIMIT|MEMORY/.test(error.code || '')) return '选区已达到处理上限，请减少笔划或分轮应用；已有图层不变。';
    return '本次调整无效，未改变已有图层；请检查数值或缩短笔划。';
  }
  function fail(error) { const text = readable(error); status(text); if (A) A.toast(text); }
  function invalidate() {
    if (!state) return;
    if (state.pointer) state.pointer.ended = true;
    state.pointer = null; state.generation++; state.sliderKey = null;
  }
  function release() {
    if (state) {
      invalidate();
      if (window.removeEventListener) window.removeEventListener('blur', state.onBlur);
      if (document.removeEventListener) document.removeEventListener('visibilitychange', state.onHidden);
    }
    state = null; A = null;
  }
  function changed(d) { return !!(d && d.type === 'local-tone' && modules().O.changed(d)); }
  function apply(canvas, op) {
    const { O } = modules(), ctx = canvas.getContext('2d', { willReadFrequently: true });
    const im = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const out = O.apply({ width: im.width, height: im.height, data: im.data }, op);
    im.data.set(out.data); ctx.putImageData(im, 0, 0); return canvas;
  }
  function recipe(d, base = 'none') { return { version: 1, sourceRevision: d.sourceRevision, base, inverted: false, feather: 0, commands: [] }; }
  function stash(op, activeId) {
    const saved = { op: copy(op), activeId }, size = JSON.stringify(saved).length * 2;
    state.undo.push({ ...saved, size }); state.undoBytes += size;
    // Bound retained recipe snapshots without keeping any full-frame pixel history.
    while (state.undo.length > 1 && (state.undo.length > 32 || state.undoBytes > 4 * 1024 * 1024)) state.undoBytes -= state.undo.shift().size;
  }
  function update(fn, options = {}) {
    if (!live()) return false;
    const oldSliderKey = state.sliderKey;
    invalidate();
    try {
      const { O } = modules();
      if (String(A.revision()) !== state.draft.sourceRevision) throw Error('照片版本已改变，请重新打开局部调色。');
      const before = O.validate(state.draft), next = copy(before), previousId = state.activeId;
      fn(next);
      const checked = O.validate(next);
      if (JSON.stringify(before) === JSON.stringify(checked)) { sync(); return false; }
      // Reject a recipe that cannot render at the actual preview size before it
      // can replace the last valid draft. Never substitute an unrestricted mask.
      const canvas = A.getCanvas(), im = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
      O.apply({ width: im.width, height: im.height, data: im.data }, checked);
      if (!options.sliderKey || oldSliderKey !== options.sliderKey) stash(before, previousId);
      state.draft.layers = checked.layers;
      if (options.activeId !== undefined) state.activeId = options.activeId;
      if (!current()) state.activeId = checked.layers.length ? checked.layers[checked.layers.length - 1].id : null;
      state.sliderKey = options.sliderKey || null; state.maskCache = null;
      if ($('editLabel')) $('editLabel').textContent = '局部预览 · 应用本轮整组';
      status('本轮图层已更新，原图不变。');
      sync(); return true;
    } catch (error) { fail(error); sync(); return false; }
  }
  function layerUpdate(fn, options) {
    const layer = current();
    if (!layer) return false;
    return update(next => fn(next.layers.find(item => item.id === layer.id)), options);
  }
  function setValue(id, value, suffix = '') { const input = $('lt-' + id); if (!input) return; input.value = String(value); if ($('lt-' + id + '-value')) $('lt-' + id + '-value').textContent = String(value) + suffix; }
  function sync() {
    if (!live()) return;
    const d = state.draft, layer = current(), mask = layer && layer.mask;
    $('lt-layer-list').innerHTML = d.layers.map((item, index) => `<option value="${escapeHTML(item.id)}">${index + 1}. ${item.enabled ? '' : '（隐藏）'}${escapeHTML(item.name)}</option>`).join('');
    $('lt-layer-list').value = state.activeId || ''; $('lt-layer-list').disabled = !layer;
    $('lt-layer-count').textContent = `${d.layers.length}/8 层 · 按列表顺序叠加`;
    for (const kind of ['radial', 'linear', 'selection']) $('lt-add-' + kind).disabled = d.layers.length >= 8;
    for (const id of ['layer-name', 'rename', 'enabled', 'opacity', 'delete', ...keys]) $('lt-' + id).disabled = !layer;
    $('lt-undo').disabled = !state.undo.length; $('lt-clear-batch').disabled = !d.layers.length;
    $('lt-layer-name').value = layer ? layer.name : ''; $('lt-enabled').checked = !!(layer && layer.enabled);
    setValue('opacity', layer ? Math.round(layer.opacity * 100) : 100, '%');
    for (const key of keys) setValue(key, layer ? layer.adjustments[key] : 0);
    $('lt-radial-controls').hidden = !mask || mask.kind !== 'radial';
    $('lt-linear-controls').hidden = !mask || mask.kind !== 'linear';
    $('lt-selection-controls').hidden = !mask || mask.kind !== 'selection';
    $('lt-empty').hidden = !!layer; $('lt-layer-controls').hidden = !layer;
    $('lt-show-mask').checked = state.showMask;
    if (mask && mask.kind === 'radial') for (const key of ['cx', 'cy', 'rx', 'ry', 'feather']) setValue('radial-' + key, +(mask[key] * 100).toFixed(2), '%');
    if (mask && mask.kind === 'linear') {
      for (const key of ['x0', 'y0', 'x1', 'y1']) setValue('linear-' + key, +(mask[key] * 100).toFixed(2), '%');
      $('lt-linear-reverse').checked = mask.reverse;
    }
    if (mask && mask.kind === 'selection') {
      setValue('selection-feather', +(mask.selection.feather * 100).toFixed(2), '%');
      $('lt-selection-invert').classList.toggle('active', mask.selection.inverted);
      $('lt-selection-undo').disabled = !mask.selection.commands.length;
      const selections = d.layers.filter(item => item.mask.kind === 'selection').map(item => item.mask.selection);
      const commands = selections.reduce((n, item) => n + item.commands.length, 0), points = selections.reduce((n, item) => n + item.commands.reduce((sum, command) => sum + command.points.length, 0), 0);
      $('lt-selection-info').textContent = `本层${mask.selection.commands.length}笔 · 本轮合计${commands}/128笔、${points}/4096点${mask.selection.base === 'none' && !mask.selection.commands.length && !mask.selection.inverted ? ' · 空选区保护全部像素' : ''}`;
    }
    setValue('brush-radius', +(state.radius * 100).toFixed(1), '%');
    for (const mode of ['brush', 'lasso']) $('lt-mode-' + mode).classList.toggle('active', state.mode === mode);
    for (const mode of ['add', 'subtract']) $('lt-selection-' + mode).classList.toggle('active', state.selectionMode === mode);
    A.render();
  }
  function bind(id, type, fn, d) { $('lt-' + id)[type] = event => { if (live(d)) fn(event || { target: $('lt-' + id) }); }; }
  function bindRange(id, fn, d) {
    bind(id, 'onpointerdown', () => { state.sliderKey = null; }, d);
    bind(id, 'oninput', event => fn(+event.target.value, { sliderKey: id + ':' + state.activeId }), d);
    bind(id, 'onchange', () => { state.sliderKey = null; }, d);
  }
  function add(kind) {
    if (!live() || state.draft.layers.length >= 8) return;
    const d = state.draft, id = 'local-' + state.session + '-' + (++state.nextId), name = ({ radial: '径向蒙版', linear: '线性渐变', selection: '手绘选区' })[kind] + ' ' + state.nextId;
    const mask = kind === 'radial' ? { kind, cx: .5, cy: .5, rx: .25, ry: .25, feather: .5 } : kind === 'linear' ? { kind, x0: .25, y0: .5, x1: .75, y1: .5, reverse: false } : { kind, selection: recipe(d) };
    const added = update(next => next.layers.push({ id, name, enabled: true, opacity: 1, sourceRevision: d.sourceRevision, adjustments: { exposure: 0, contrast: 0, saturation: 0, temperature: 0 }, mask }), { activeId: id });
    if (added) status(kind === 'selection' ? '先涂选或套索圈选，再调明暗与颜色。空选区不会改变像素。' : kind === 'radial' ? '拖动中心移动范围，拖边缘圆点调整半径；也可用下方滑杆。松手后更新。' : '拖动两个端点，或从空白位置拉出新渐变；松手后更新。');
  }
  function setup(adapter) {
    release(); A = adapter;
    let d;
    try { d = modules().O.validate({ type: 'local-tone', sourceRevision: String(A.revision()), layers: [] }); }
    catch (error) { A.setDraft(null); $('toolPanel').textContent = readable(error); fail(error); return; }
    state = { draft: d, activeId: null, session: ++serial, nextId: 0, generation: 0, pointer: null, mode: 'brush', selectionMode: 'add', radius: .05, showMask: true, undo: [], undoBytes: 0, sliderKey: null, maskCache: null };
    A.setDraft(d);
    $('toolPanel').innerHTML = `<div class="portrait-heading"><strong>局部调色 · 只改变你选的范围</strong><span>本地可撤销</span></div>
      <p class="portrait-copy">本轮最多8层，应用后整组可撤销；原图不覆盖。每层从零调整开始，蒙版范围与颜色参数分别保存。</p>
      <div class="portrait-actions local-tone-add"><button class="small-button" id="lt-add-radial">＋ 径向</button><button class="small-button" id="lt-add-linear">＋ 渐变</button><button class="small-button" id="lt-add-selection">＋ 手绘选区</button></div>
      <label class="local-tone-layer-label" for="lt-layer-list">当前图层</label><select id="lt-layer-list" class="local-tone-layer-list" aria-label="选择当前图层"></select><div class="portrait-copy" id="lt-layer-count"></div>
      <p class="portrait-copy" id="lt-empty">还没有图层。添加一种蒙版，再调整曝光、对比、饱和或色温。</p>
      <div id="lt-layer-controls"><div class="portrait-actions"><input id="lt-layer-name" class="local-tone-name" type="text" maxlength="80" aria-label="图层名称"><button class="small-button" id="lt-rename">改名</button><button class="small-button" id="lt-delete">删除当前层</button></div>
      <label class="manual-mask-toggle"><input id="lt-enabled" type="checkbox" checked>显示当前层效果</label>${slider('opacity', '图层不透明度', 100, 0, 100)}
      <div class="sliders portrait-sliders">${slider('exposure', '曝光', 0, -100, 100)}${slider('contrast', '对比', 0, -100, 100)}${slider('saturation', '饱和', 0, -100, 100)}${slider('temperature', '色温', 0, -100, 100)}</div>
      <div id="lt-radial-controls"><div class="portrait-section-label">椭圆范围 · 位置与半径占画面宽高的百分比</div>${slider('radial-cx', '中心横向', 50, 0, 100, .5)}${slider('radial-cy', '中心纵向', 50, 0, 100, .5)}${slider('radial-rx', '横向半径', 25, .5, 100, .5)}${slider('radial-ry', '纵向半径', 25, .5, 100, .5)}${slider('radial-feather', '边缘羽化', 50, 5, 100)}</div>
      <div id="lt-linear-controls"><div class="portrait-section-label">渐变两端 · 默认从0%过渡到100%</div>${slider('linear-x0', '起点横向', 25, 0, 100, .5)}${slider('linear-y0', '起点纵向', 50, 0, 100, .5)}${slider('linear-x1', '终点横向', 75, 0, 100, .5)}${slider('linear-y1', '终点纵向', 50, 0, 100, .5)}<label class="manual-mask-toggle"><input id="lt-linear-reverse" type="checkbox">反向渐变</label></div>
      <div id="lt-selection-controls"><div class="portrait-section-label">手绘选区 · 松手保存一笔</div><div class="portrait-actions"><button class="small-button" id="lt-mode-brush">涂选</button><button class="small-button" id="lt-mode-lasso">套索</button><button class="small-button" id="lt-selection-add">加选</button><button class="small-button" id="lt-selection-subtract">减选</button></div>${slider('brush-radius', '画笔半径', 5, .2, 50, .1)}${slider('selection-feather', '选区羽化', 0, 0, 10, .5)}<div class="portrait-actions"><button class="small-button" id="lt-selection-all">全选</button><button class="small-button" id="lt-selection-invert">反选</button><button class="small-button" id="lt-selection-clear">清空选区</button><button class="small-button" id="lt-selection-undo">撤销选区一笔</button></div><p class="portrait-copy" id="lt-selection-info"></p></div></div>
      <label class="manual-mask-toggle"><input id="lt-show-mask" type="checkbox" checked>显示绿色蒙版范围（不计图层不透明度）</label>
      <div class="portrait-status" id="lt-status" role="status" aria-live="polite">先添加图层；不添加就不会改变照片。</div><div class="portrait-actions local-history"><button class="small-button" id="lt-undo">撤销本轮一步</button><button class="small-button" id="lt-clear-batch">清空本轮图层</button></div><p class="portrait-copy subtle">这是常规局部明暗与色彩调整，不是 AI 重建或 RAW 高光恢复。旧的已应用图层组不会被重新编辑；用主工具栏撤销可撤销整组。</p>`;
    for (const kind of ['radial', 'linear', 'selection']) bind('add-' + kind, 'onclick', () => add(kind), d);
    bind('layer-list', 'onchange', event => { invalidate(); if (d.layers.some(layer => layer.id === event.target.value)) state.activeId = event.target.value; state.maskCache = null; sync(); }, d);
    bind('rename', 'onclick', () => { const name = $('lt-layer-name').value.trim(); if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) { fail(Error('图层名称需为1到80个字符，不能包含控制字符。')); return; } layerUpdate(layer => { layer.name = name; }); }, d);
    bind('enabled', 'onchange', event => layerUpdate(layer => { layer.enabled = event.target.checked; }), d);
    bindRange('opacity', (value, options) => layerUpdate(layer => { layer.opacity = value / 100; }, options), d);
    for (const key of keys) bindRange(key, (value, options) => layerUpdate(layer => { layer.adjustments[key] = value; }, options), d);
    for (const key of ['cx', 'cy', 'rx', 'ry', 'feather']) bindRange('radial-' + key, (value, options) => layerUpdate(layer => { if (layer.mask.kind === 'radial') layer.mask[key] = value / 100; }, options), d);
    for (const key of ['x0', 'y0', 'x1', 'y1']) bindRange('linear-' + key, (value, options) => layerUpdate(layer => { if (layer.mask.kind === 'linear') layer.mask[key] = value / 100; }, options), d);
    bind('linear-reverse', 'onchange', event => layerUpdate(layer => { if (layer.mask.kind === 'linear') layer.mask.reverse = event.target.checked; }), d);
    for (const mode of ['brush', 'lasso']) bind('mode-' + mode, 'onclick', () => { invalidate(); state.mode = mode; sync(); }, d);
    for (const mode of ['add', 'subtract']) bind('selection-' + mode, 'onclick', () => { invalidate(); state.selectionMode = mode; sync(); }, d);
    bindRange('brush-radius', value => { invalidate(); if (Number.isFinite(value) && value >= .2 && value <= 50) state.radius = value / 100; sync(); }, d);
    bindRange('selection-feather', (value, options) => layerUpdate(layer => { if (layer.mask.kind === 'selection') layer.mask.selection.feather = value / 100; }, options), d);
    for (const [id, base] of [['all', 'all'], ['clear', 'none']]) bind('selection-' + id, 'onclick', () => {
      const updated = layerUpdate(layer => { if (layer.mask.kind === 'selection') layer.mask.selection = recipe(d, base); });
      if (updated) status(base === 'none' ? '选区已清空：本层保护全部像素；其他层不变。' : '本层已全选，可减选需要保护的范围。');
    }, d);
    bind('selection-invert', 'onclick', () => layerUpdate(layer => { if (layer.mask.kind === 'selection') layer.mask.selection.inverted = !layer.mask.selection.inverted; }), d);
    bind('selection-undo', 'onclick', () => layerUpdate(layer => { if (layer.mask.kind === 'selection') layer.mask.selection.commands.pop(); }), d);
    bind('show-mask', 'onchange', event => { state.showMask = event.target.checked; state.maskCache = null; A.render(); }, d);
    bind('delete', 'onclick', () => { const id = state.activeId; update(next => { next.layers = next.layers.filter(layer => layer.id !== id); }); }, d);
    bind('clear-batch', 'onclick', () => { if (update(next => { next.layers = []; })) status('本轮图层已清空，可撤销恢复；已应用的历史不变。'); }, d);
    bind('undo', 'onclick', () => {
      invalidate(); const saved = state.undo[state.undo.length - 1]; if (!saved) return;
      try {
        if (String(A.revision()) !== d.sourceRevision) throw Error('照片版本已改变，请重新打开局部调色。');
        const O = modules().O, checked = O.validate(saved.op), canvas = A.getCanvas();
        const im = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
        O.apply({ width: im.width, height: im.height, data: im.data }, checked);
        d.layers = checked.layers; state.undo.pop(); state.undoBytes -= saved.size;
        state.activeId = saved.activeId; state.maskCache = null; status('已撤销本轮一步；原图不变。');
        if ($('editLabel')) $('editLabel').textContent = '局部预览 · 应用本轮整组';
      } catch (error) { fail(error); }
      sync();
    }, d);
    state.onBlur = () => { if (!live(d)) return; const drawing = !!state.pointer; invalidate(); if (drawing) { status('未完成的笔划已取消，已有图层不变。'); A.render(); } };
    state.onHidden = () => { if (document.hidden) state && state.onBlur(); };
    if (window.addEventListener) window.addEventListener('blur', state.onBlur);
    if (document.addEventListener) document.addEventListener('visibilitychange', state.onHidden);
    if ($('editLabel')) $('editLabel').textContent = '局部预览 · 应用本轮整组';
    A.hint('添加蒙版后调色；松手保存范围，应用保存本轮整组'); sync();
  }
  function point(p) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) throw Error('笔划位置超出照片，请在照片内重新操作。');
    return { x: p.x, y: p.y };
  }
  function activePointer(d, pointer) { return live(d) && pointer && !pointer.ended && state.pointer === pointer && pointer.draft === d && pointer.generation === state.generation && pointer.layerId === state.activeId && String(A.revision()) === d.sourceRevision; }
  function start(d, p) {
    if (!live(d) || !current()) return null;
    invalidate();
    try {
      if (String(A.revision()) !== d.sourceRevision) throw Error('照片版本已改变，请重新打开局部调色。');
      const layer = current(), first = point(p), m = copy(layer.mask);
      const q = { draft: d, generation: state.generation, layerId: layer.id, kind: m.kind, mask: m, start: first, points: [first], tool: state.mode, radius: state.radius, selectionMode: state.selectionMode, ended: false, blocked: false };
      if (m.kind === 'radial') {
        const handles = [[m.cx - m.rx, m.cy, 'rx'], [m.cx + m.rx, m.cy, 'rx'], [m.cx, m.cy - m.ry, 'ry'], [m.cx, m.cy + m.ry, 'ry']];
        const nearest = handles.filter(h => h[0] >= 0 && h[0] <= 1 && h[1] >= 0 && h[1] <= 1).map(h => ({ mode: h[2], distance: Math.hypot(first.x - h[0], first.y - h[1]) })).sort((a, b) => a.distance - b.distance)[0];
        q.dragMode = nearest && nearest.distance < .045 ? nearest.mode : 'center';
      } else if (m.kind === 'linear') {
        const a = Math.hypot(first.x - m.x0, first.y - m.y0), b = Math.hypot(first.x - m.x1, first.y - m.y1);
        q.dragMode = Math.min(a, b) < .055 ? (a <= b ? 'start' : 'end') : 'new';
      }
      state.pointer = q; A.render(); return q;
    } catch (error) { fail(error); return null; }
  }
  function append(q, p) {
    const next = point(p), prev = q.points[q.points.length - 1];
    if (Math.hypot(next.x - prev.x, next.y - prev.y) <= .000001) return;
    if (q.points.length >= 512) throw Error('本笔最多512个点，请松手后分成短笔；本笔未应用。');
    q.points.push(next);
  }
  function move(d, p, q) {
    if (!activePointer(d, q) || q.blocked) return;
    try { append(q, p); } catch (error) { q.blocked = true; fail(error); }
    A.render();
  }
  function draggedMask(q) {
    const m = copy(q.mask), p = q.points[q.points.length - 1];
    if (m.kind === 'radial') {
      if (q.dragMode === 'center') { m.cx = clamp(m.cx + p.x - q.start.x, 0, 1); m.cy = clamp(m.cy + p.y - q.start.y, 0, 1); }
      else if (q.dragMode === 'rx') m.rx = clamp(Math.abs(p.x - m.cx), .005, 1);
      else m.ry = clamp(Math.abs(p.y - m.cy), .005, 1);
    } else if (m.kind === 'linear') {
      if (q.dragMode === 'new') { m.x0 = q.start.x; m.y0 = q.start.y; }
      if (q.dragMode === 'start') { m.x0 = p.x; m.y0 = p.y; }
      else { m.x1 = p.x; m.y1 = p.y; }
    }
    return m;
  }
  function finish(d, p, q, cancelled) {
    if (!activePointer(d, q)) { if (q) q.ended = true; return; }
    q.ended = true; state.pointer = null;
    if (cancelled || q.blocked) { status(cancelled ? '本笔已取消，已有图层不变。' : '本笔未应用，请分成短笔重试。'); A.render(); return; }
    try {
      append(q, p);
      let mask;
      if (q.kind === 'selection') {
        const M = modules().M, next = M.validateSelection(q.mask.selection, { sourceRevision: d.sourceRevision });
        if (q.tool === 'lasso' && q.points.length < 3) throw Error('套索至少需要三个不共线的点，请重新圈选。');
        const selections = d.layers.filter(layer => layer.mask.kind === 'selection').map(layer => layer.mask.selection);
        const count = selections.reduce((n, item) => n + item.commands.length, 0), points = selections.reduce((n, item) => n + item.commands.reduce((sum, command) => sum + command.points.length, 0), 0);
        if (count >= M.LIMITS.selectionCommands || points + q.points.length > M.LIMITS.selectionPoints) throw Error('本轮选区合计最多128笔、4096个点，请减少笔划或分轮应用。');
        const mode = next.inverted ? (q.selectionMode === 'add' ? 'subtract' : 'add') : q.selectionMode;
        const command = { kind: q.tool, mode, points: copy(q.points) }; if (q.tool === 'brush') command.radius = q.radius;
        next.commands.push(command); mask = { kind: 'selection', selection: M.validateSelection(next, { sourceRevision: d.sourceRevision }) };
      } else {
        // A click without movement is not an accidental new gradient or radius edit.
        if (q.points.length === 1) { A.render(); return; }
        mask = draggedMask(q);
      }
      if (layerUpdate(layer => { layer.mask = mask; })) status('本层范围已更新，颜色参数不变；原图未覆盖。');
    } catch (error) { fail(error); A.render(); }
  }
  function circle(ctx, x, y, radius) { ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke(); }
  function boundary(ctx, w, h, m, provisional = false) {
    if (ctx.setLineDash) ctx.setLineDash(provisional ? [5, 4] : []);
    if (m.kind === 'radial') {
      ctx.beginPath(); ctx.ellipse(m.cx * w, m.cy * h, m.rx * w, m.ry * h, 0, 0, Math.PI * 2); ctx.stroke();
      for (const [x, y] of [[m.cx, m.cy], [m.cx - m.rx, m.cy], [m.cx + m.rx, m.cy], [m.cx, m.cy - m.ry], [m.cx, m.cy + m.ry]]) circle(ctx, x * w, y * h, 4);
    } else if (m.kind === 'linear') {
      ctx.beginPath(); ctx.moveTo(m.x0 * w, m.y0 * h); ctx.lineTo(m.x1 * w, m.y1 * h); ctx.stroke();
      const dx = m.x1 - m.x0, dy = m.y1 - m.y0, len = Math.hypot(dx, dy);
      if (len > 0) for (const [x, y] of [[m.x0, m.y0], [m.x1, m.y1]]) {
        ctx.beginPath(); ctx.moveTo((x - dy / len * 2) * w, (y + dx / len * 2) * h); ctx.lineTo((x + dy / len * 2) * w, (y - dx / len * 2) * h); ctx.stroke(); circle(ctx, x * w, y * h, 5);
      }
    }
    if (ctx.setLineDash) ctx.setLineDash([]);
  }
  function overlay(ctx, w, h, d, pointer) {
    if (!live(d) || !current() || !Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1) return;
    const layer = current(), m = layer.mask;
    ctx.save();
    try {
      const { M, L } = modules();
      if (state.showMask || m.kind === 'selection') {
        let cache = state.maskCache;
        if (!cache || cache.w !== w || cache.h !== h || cache.layer !== layer || cache.showMask !== state.showMask) {
          const selected = m.kind === 'selection' ? M.rasterizeSelection(w, h, m.selection, { sourceRevision: d.sourceRevision }) : null;
          const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
          const cc = canvas.getContext('2d'), im = cc.createImageData(w, h);
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const index = y * w + x, weight = selected ? selected[index] : L.weight(m, (x + .5) / w, (y + .5) / h), i = index * 4;
            const edge = selected && weight >= .5 && (x === 0 || y === 0 || x === w - 1 || y === h - 1 || selected[index - 1] < .5 || selected[index + 1] < .5 || selected[index - w] < .5 || selected[index + w] < .5);
            im.data[i] = edge ? 220 : 70; im.data[i + 1] = 235; im.data[i + 2] = edge ? 180 : 160;
            im.data[i + 3] = edge ? 190 : state.showMask ? weight * 60 : 0;
          }
          cc.putImageData(im, 0, 0); cache = state.maskCache = { canvas, w, h, layer, showMask: state.showMask };
        }
        ctx.drawImage(cache.canvas, 0, 0);
      }
      ctx.strokeStyle = '#e0f7bb'; ctx.lineWidth = Math.max(1, Math.min(w, h) / 400); boundary(ctx, w, h, m);
      const q = activePointer(d, pointer) ? pointer : state.pointer;
      if (activePointer(d, q) && !q.blocked) {
        if (q.kind !== 'selection') boundary(ctx, w, h, draggedMask(q), true);
        else {
          if (ctx.setLineDash) ctx.setLineDash(q.tool === 'lasso' ? [5, 4] : []);
          ctx.beginPath(); q.points.forEach((p, i) => { const x = p.x * (w - 1) + .5, y = p.y * (h - 1) + .5; if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
          if (q.tool === 'lasso' && q.points.length > 1) ctx.lineTo(q.points[0].x * (w - 1) + .5, q.points[0].y * (h - 1) + .5);
          ctx.stroke();
          if (q.tool === 'brush') { const p = q.points[q.points.length - 1]; circle(ctx, p.x * (w - 1) + .5, p.y * (h - 1) + .5, q.radius * Math.min(w, h)); }
        }
      }
    } catch (error) { status('蒙版预览失败，未忽略范围限制。' + readable(error)); }
    finally { ctx.restore(); }
  }
  window.LocalToneUI = { setup, release, changed, apply, start, move, finish, overlay };
})();
