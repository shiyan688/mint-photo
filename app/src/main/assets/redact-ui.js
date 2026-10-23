'use strict';
/* Reversible local mosaic / opaque cover commands. No pixels, original assets,
 * or external history are stored here. A gesture is provisional until pointerup. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RedactUI = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  let A = null, S = null, serial = 0;
  const MAX_STROKES = 64, MAX_POINTS = 4096, HISTORY_BYTES = 4 * 1024 * 1024;
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const node = id => S && S.nodes[id];
  function modules() {
    const C = root.MintRedact, O = root.MintRedactOperation;
    if (!C || !O || !['defaults', 'validate', 'isActive', 'plan', 'apply'].every(k => typeof C[k] === 'function') ||
        typeof O.validate !== 'function' || typeof O.applyCanvas !== 'function') throw Error('局部遮挡核心未加载，照片未改变。');
    return { C, O };
  }
  function revision() { return String(A.revision()); }
  function live(d) {
    return !!(A && S && d === S.draft && A.getDraft() === d && S.panel.isConnected !== false);
  }
  function cancel() { if (S) { S.pointer = null; S.generation++; } }
  function ensure(d) {
    if (!live(d) || revision() !== S.revision) { cancel(); throw Error('照片版本或工具已变化，请重新打开局部遮挡。'); }
    modules();
  }
  function status(text) { if (node('status')) node('status').textContent = text; }
  function readable(error) {
    const message = error && error.message || '';
    if (/[\u3400-\u9fff]/.test(message)) return message;
    if (/limit|budget|count|memory|too many/i.test(message) || /LIMIT|MEMORY|BUDGET/.test(error && error.code || ''))
      return '已超出安全计算或笔划预算，本次操作未保存；请减少笔划或分段操作。';
    return '本次遮挡无效，已有笔划和原图未改变。';
  }
  function fail(error) { const text = readable(error); status(text); if (A && A.toast) A.toast(text); }
  function redraw() { if (A) A.render(); }
  function release() {
    if (S) {
      cancel();
      for (const [element, key, fn] of S.bindings) if (element[key] === fn) element[key] = null;
      if (root.removeEventListener) root.removeEventListener('blur', S.onBlur);
      if (root.document && root.document.removeEventListener) root.document.removeEventListener('visibilitychange', S.onHidden);
    }
    S = null; A = null;
  }
  function checkCanvas() {
    const canvas = A.getCanvas();
    if (!canvas || typeof canvas.getContext !== 'function' || !Number.isSafeInteger(canvas.width) || !Number.isSafeInteger(canvas.height) ||
        canvas.width < 1 || canvas.height < 1 || canvas.width > 4096 || canvas.height > 4096 || canvas.width * canvas.height > 8000000)
      throw Error('遮挡底图超出800万像素或4096边长预算，未分配画布。');
    return canvas;
  }
  function assess(recipe) {
    if (typeof A.assess !== 'function') throw Error('无法验证导出预算，未保存本次遮挡。');
    const result = A.assess({ type: 'redact', recipe });
    if (!result || !result.original || !result.working || typeof result.original.allowed !== 'boolean' || typeof result.working.allowed !== 'boolean')
      throw Error('无法验证原尺寸与工作尺寸预算，未保存本次遮挡。');
    if (!result.original.allowed && !result.working.allowed)
      throw Error('原尺寸与工作尺寸均超出安全计算预算，本次操作未保存；已有笔划不变。');
    return result;
  }
  function checked(recipe) {
    const next = modules().C.validate(recipe), canvas = checkCanvas();
    // The pixel planner runs before any output can be allocated.
    modules().C.plan(canvas.width, canvas.height, next);
    assess(next);
    ensure(S.draft);
    return next;
  }
  function push(stack, recipe) {
    stack.push({ recipe, bytes: JSON.stringify(recipe).length * 2 });
    let bytes = stack.reduce((sum, item) => sum + item.bytes, 0);
    while (stack.length > 1 && (stack.length > 32 || bytes > HISTORY_BYTES)) bytes -= stack.shift().bytes;
  }
  function sync() {
    if (!S) return;
    const recipe = S.draft.recipe;
    for (const mode of ['mosaic', 'cover']) {
      const button = node(mode);
      if (button) { button.classList.toggle('active', recipe.mode === mode); button.setAttribute('aria-pressed', String(recipe.mode === mode)); }
    }
    if (node('radius')) node('radius').value = String(S.radius * 1000);
    if (node('radius-value')) node('radius-value').textContent = (S.radius * 100).toFixed(1) + '%';
    if (node('block')) { node('block').value = String(recipe.blockSize * 1000); node('block').disabled = recipe.mode !== 'mosaic'; }
    if (node('block-value')) node('block-value').textContent = (recipe.blockSize * 100).toFixed(1) + '%';
    if (node('block-row')) node('block-row').hidden = recipe.mode !== 'mosaic';
    if (node('color')) { node('color').value = recipe.color; node('color').disabled = recipe.mode !== 'cover'; }
    if (node('color-row')) node('color-row').hidden = recipe.mode !== 'cover';
    if (node('undo')) node('undo').disabled = !S.undo.length;
    if (node('redo')) node('redo').disabled = !S.redo.length;
    if (node('clear')) node('clear').disabled = !recipe.strokes.length;
    if (node('count')) node('count').textContent = recipe.strokes.length + '/64笔 · ' + recipe.strokes.reduce((n, stroke) => n + stroke.points.length, 0) + '/4096点';
  }
  function save(recipe) {
    ensure(S.draft);
    const next = checked(recipe);
    if (equal(next, S.draft.recipe)) { sync(); redraw(); return false; }
    push(S.undo, S.draft.recipe); S.redo = [];
    S.draft.recipe = next;
    sync(); redraw(); return true;
  }
  function history(direction) {
    ensure(S.draft); cancel();
    const from = direction === 'undo' ? S.undo : S.redo, to = direction === 'undo' ? S.redo : S.undo;
    if (!from.length) { redraw(); return; }
    const next = checked(from[from.length - 1].recipe);
    push(to, S.draft.recipe); from.pop(); S.draft.recipe = next;
    sync(); redraw();
  }
  function change(field, value) {
    ensure(S.draft); cancel();
    save({ ...S.draft.recipe, [field]: value });
    status('本轮全部笔划使用当前模式、色块和颜色；笔划半径逐笔保留。');
  }
  function bind(id, key, fn) {
    const element = node(id), owner = S;
    if (!element) throw Error('遮挡控件加载不完整。');
    const wrapped = event => {
      // A detached or superseded control must not touch a newer draft.
      if (S !== owner || element.isConnected === false || owner.panel.isConnected === false ||
          (typeof owner.panel.contains === 'function' && !owner.panel.contains(element))) return;
      try { ensure(owner.draft); if (!element.disabled) fn(event || { target: element }); }
      catch (error) { cancel(); fail(error); sync(); redraw(); }
    };
    element[key] = wrapped; S.bindings.push([element, key, wrapped]);
  }
  function setup(panel, adapter) {
    if (adapter === undefined) { adapter = panel; panel = adapter && adapter.panel || root.document && root.document.getElementById('toolPanel'); }
    release(); A = adapter;
    try {
      if (!panel || !A || !['getDraft', 'setDraft', 'getCanvas', 'render', 'revision', 'assess'].every(k => typeof A[k] === 'function'))
        throw Error('遮挡编辑接口未准备好，照片未改变。');
      const { C, O } = modules(), recipe = C.validate(C.defaults());
      O.validate({ type: 'redact', recipe });
      S = { panel, draft: { type: 'redact', recipe }, revision: revision(), generation: 0, pointer: null,
        radius: .04, undo: [], redo: [], nodes: {}, bindings: [] };
      panel.innerHTML = '<div class="redact-controls"><div class="portrait-heading"><strong>局部遮挡</strong><span>本地可撤销</span></div>' +
        '<p class="portrait-copy">在照片上拖动画笔，松手保存一笔。模式、色块和颜色会改变本轮全部笔划；半径只影响下一笔。</p>' +
        '<div class="portrait-actions"><button type="button" id="rd-mosaic" class="small-button">马赛克</button><button type="button" id="rd-cover" class="small-button">纯色遮盖 · 100%不透明</button></div>' +
        '<div class="slider-row"><label for="rd-radius">画笔半径·短边比例</label><input type="range" id="rd-radius" min="2" max="500" step="1" value="40"><output id="rd-radius-value">4.0%</output></div>' +
        '<div class="slider-row" id="rd-block-row"><label for="rd-block">色块大小·短边比例</label><input type="range" id="rd-block" min="10" max="250" step="1" value="40"><output id="rd-block-value">4.0%</output></div>' +
        '<div class="paint-color-row" id="rd-color-row" hidden><label for="rd-color">遮盖颜色</label><input type="color" id="rd-color" value="#173e31"></div>' +
        '<div class="portrait-actions"><button type="button" id="rd-undo" class="small-button">撤销本轮一步</button><button type="button" id="rd-redo" class="small-button">重做本轮一步</button><button type="button" id="rd-clear" class="small-button">清空本轮笔划</button></div>' +
        '<p class="portrait-copy" id="rd-count"></p><p class="portrait-copy" id="rd-status" role="status" aria-live="polite"></p>' +
        '<p class="portrait-copy">马赛克仅适合装饰或弱化细节，不是可靠的隐私遮挡。纯色遮盖为100%不透明硬边，不使用羽化或低透明度。</p>' +
        '<p class="portrait-copy">原图与可编辑草稿仍保留原始内容。分享时只发送导出的栅格图片，不要分享原图或草稿；导出后请放大检查最终遮挡范围。</p></div>';
      for (const id of ['mosaic', 'cover', 'radius', 'radius-value', 'block', 'block-value', 'block-row', 'color', 'color-row', 'undo', 'redo', 'clear', 'count', 'status'])
        S.nodes[id] = typeof panel.querySelector === 'function' ? panel.querySelector('#rd-' + id) : root.document.getElementById('rd-' + id);
      A.setDraft(S.draft);
      for (const mode of ['mosaic', 'cover']) bind(mode, 'onclick', () => change('mode', mode));
      bind('radius', 'oninput', event => {
        const value = Number(event.target.value) / 1000;
        if (!Number.isFinite(value) || value < .002 || value > .5) throw Error('画笔半径无效；应为短边的0.2%至50%。');
        S.radius = value; sync();
      });
      bind('block', 'oninput', event => change('blockSize', Number(event.target.value) / 1000));
      bind('color', 'oninput', event => change('color', event.target.value));
      bind('undo', 'onclick', () => history('undo'));
      bind('redo', 'onclick', () => history('redo'));
      bind('clear', 'onclick', () => { cancel(); save({ ...S.draft.recipe, strokes: [] }); status('已清空本轮笔划，可撤销恢复；原图与已有编辑不变。'); });
      const owner = S;
      S.onBlur = () => { if (S === owner) { cancel(); redraw(); } };
      S.onHidden = () => { if (S === owner && root.document.hidden) { cancel(); redraw(); } };
      if (root.addEventListener) root.addEventListener('blur', S.onBlur);
      if (root.document.addEventListener) root.document.addEventListener('visibilitychange', S.onHidden);
      sync(); status('还没有笔划；应用前可以撤销、重做或清空本轮操作。');
      if (A.hint) A.hint('拖动遮挡，松手保存。隐私内容请使用纯色遮盖并检查导出图片。');
      redraw(); return S.draft;
    } catch (error) {
      const saved = A; release();
      if (saved && typeof saved.setDraft === 'function') saved.setDraft(null);
      if (panel) panel.innerHTML = '<p class="portrait-copy">局部遮挡暂不可用，照片未改变。</p>';
      if (saved && saved.toast) saved.toast(readable(error));
      return null;
    }
  }
  function point(value) {
    if (!value || typeof value.x !== 'number' || typeof value.y !== 'number' || !Number.isFinite(value.x) || !Number.isFinite(value.y) ||
        value.x < 0 || value.x > 1 || value.y < 0 || value.y > 1) throw Error('笔划坐标无效，已完整取消本笔。');
    return { x: value.x, y: value.y };
  }
  function active(d, token) {
    if (!S || !S.pointer || S.pointer.token !== token) return false;
    if (!live(d) || revision() !== S.revision || S.pointer.generation !== S.generation) { cancel(); return false; }
    return true;
  }
  function provisional(d) {
    return active(d, S && S.pointer && S.pointer.token) ? { ...d.recipe, strokes: d.recipe.strokes.concat([S.pointer.stroke]) } : d.recipe;
  }
  function createCanvas(width, height) {
    const canvas = root.document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
  }
  function preview(d) {
    ensure(d); modules().O.validate(d);
    const canvas = checkCanvas(), recipe = modules().C.validate(provisional(d));
    modules().C.plan(canvas.width, canvas.height, recipe);
    return modules().O.applyCanvas(canvas, { type: 'redact', recipe }, createCanvas);
  }
  function changed(d) {
    if (!d || d.type !== 'redact') return false;
    ensure(d); return modules().C.isActive(modules().O.validate(d).recipe);
  }
  function start(d, value) {
    const token = Object.freeze({ id: ++serial });
    try {
      ensure(d); if (S.pointer) return token;
      const p = point(value), canvas = checkCanvas(), recipe = modules().O.validate(d).recipe;
      if (recipe.strokes.length >= MAX_STROKES) throw Error('本轮已达64笔，请先应用后再继续。');
      const total = recipe.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);
      if (total >= MAX_POINTS) throw Error('本轮已达4096点，请先应用后再继续。');
      const stroke = { radius: S.radius, points: [p] };
      modules().C.plan(canvas.width, canvas.height, { ...recipe, strokes: recipe.strokes.concat([stroke]) });
      S.pointer = { token, generation: S.generation, total, stroke };
      redraw();
    } catch (error) { fail(error); }
    return token;
  }
  function move(d, value, token) {
    if (!active(d, token)) return;
    try {
      modules(); const p = point(value), pointer = S.pointer, points = pointer.stroke.points, last = points[points.length - 1];
      if (p.x === last.x && p.y === last.y) return;
      if (pointer.total + points.length >= MAX_POINTS) throw Error('本笔超出4096点上限，已完整取消而非截断；请分段操作。');
      points.push(p); redraw();
    } catch (error) { cancel(); fail(error); redraw(); }
  }
  function finish(d, value, token, cancelled) {
    if (!active(d, token)) return;
    try {
      if (cancelled) { cancel(); return; }
      move(d, value, token); if (!active(d, token)) return;
      const stroke = S.pointer.stroke; cancel();
      save({ ...d.recipe, strokes: d.recipe.strokes.concat([stroke]) });
    } catch (error) { cancel(); fail(error); sync(); }
    finally { redraw(); }
  }
  return Object.freeze({ setup, release, changed, preview, start, move, finish });
});
