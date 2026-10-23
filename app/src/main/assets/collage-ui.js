/* Local 2–4-photo collage controls. Only a complete bounded operation may be
 * applied. Pending files, selection gestures and callbacks belong to one source
 * and tool session; neither files nor decoder URLs are retained in the recipe. */
(function (root) {
  'use strict';
  let A = null, S = null;
  const PLACEHOLDER = Object.freeze({ version: 1, width: 1, height: 1, data: 'AAAAAA==' });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const $ = id => S && S.panel.querySelector('#co-' + id);
  const cloneCell = c => ({ fit: c.fit, x: c.x, y: c.y });
  const cellDefault = () => ({ fit: 'fill', x: 0.5, y: 0.5 });
  const mutableRecipe = r => ({ ...r, background: { ...r.background }, cells: r.cells.map(cloneCell) });
  function modules() {
    const L = root.MintCollageLayout, O = root.MintCollageOperation, I = root.MintImageImport, C = root.MintImageOverlay;
    if (!L || !O || !I || !C || !['defaults', 'validate', 'plan', 'hitTest'].every(k => typeof L[k] === 'function') ||
        !['validate', 'applyCanvas'].every(k => typeof O[k] === 'function') || typeof I.importFile !== 'function' || typeof C.validateAsset !== 'function') {
      throw Error('拼图核心未加载，当前作品未改变');
    }
    return { L, O, I, C };
  }
  function live(d) {
    if (!S || !A || (d && d !== S.draft) || A.getDraft() !== S.draft || S.panel.isConnected === false) return false;
    const c = A.getCanvas();
    return !S.sourceImportPending && A.revision() === S.revision && c === S.source && c.width === S.width && c.height === S.height;
  }
  function current(d) { if (!live(d)) throw Error('作品或工具已变化，请重新打开拼图'); }
  function status(message) { const e = $('status'); if (e) e.textContent = message; }
  function readable(error) {
    const text = String(error && error.message || '');
    if (/[\u3400-\u9fff]/.test(text)) return text;
    if (/budget|limit|pixel|width|height|range|dimension/i.test(text)) return '拼图设置超出安全限制：每边256–4096像素，总像素不超过800万；请调整尺寸或间距';
    return '拼图处理失败，当前作品和已有编辑已保留';
  }
  function fail(error) { const text = readable(error); status(text); if (A && A.toast) A.toast(text); }
  function invalidatePointer() { if (S && S.pointer) S.pointer.ended = true; if (S) S.pointer = null; }
  function invalidateSelection() { invalidatePointer(); if (S) { S.generation++; S.fileRequest = null; } }
  function rememberActive() {
    for (let i = 0; i < S.draft.recipe.cells.length; i++) S.cells[i] = cloneCell(S.draft.recipe.cells[i]);
    for (let i = 0; i < S.draft.assets.length; i++) S.assets[i] = S.draft.assets[i];
  }
  function filled(d) { return d.assets.length === d.recipe.cells.length - 1 && d.assets.every(Boolean); }
  function operation(d, placeholders) {
    const recipe = modules().L.validate(d.recipe);
    if (!Array.isArray(d.assets) || d.assets.length !== recipe.cells.length - 1) throw Error('拼图素材数量无效');
    if (!placeholders && !filled(d)) throw Error('请先为每个附加格选择一张本地图片');
    return modules().O.validate({ type: 'collage', recipe, assets: d.assets.map(a => a || PLACEHOLDER) });
  }
  function assessment(d) {
    const result = A.assess(operation(d, false));
    if (!result || !result.original || !result.working || typeof result.original.allowed !== 'boolean' || typeof result.working.allowed !== 'boolean') {
      throw Error('拼图导出预算检查不可用');
    }
    return result;
  }
  function canApply(d) {
    if (!live(d) || !d || d.type !== 'collage' || S.loading || !filled(d)) return false;
    try { const result = assessment(d); return live(d) && (result.original.allowed || result.working.allowed); } catch (_) { return false; }
  }
  function changed(d) {
    if (!d || d.type !== 'collage' || !S || d !== S.draft) return false;
    // Incomplete and temporarily hidden cells are still unsaved user work.
    return !same(d.recipe, S.initial) || d.assets.some(Boolean) || S.assets.some(Boolean) || S.cells.some((c, i) => !same(c, S.initialCells[i]));
  }
  function modeText(name, mode) {
    return name + (mode.allowed ? '可用' : '不可用' + (mode.error ? '：' + String(mode.error) : '（超出安全预算）'));
  }
  function sync() {
    if (!live()) return;
    const d = S.draft, r = d.recipe, n = r.cells.length, loading = !!S.loading;
    S.selected = Math.min(S.selected, n - 1);
    $('count').value = String(n); $('layout').value = r.layout;
    $('width').value = String(r.width); $('height').value = String(r.height);
    $('gutter').value = String(+(r.gutter * 100).toFixed(2)); $('gutter-value').textContent = String(+(r.gutter * 100).toFixed(2)) + '%';
    $('color').value = r.background.color;
    $('opacity').value = String(+(r.background.opacity * 100).toFixed(1)); $('opacity-value').textContent = String(+(r.background.opacity * 100).toFixed(1)) + '%';
    const selected = r.cells[S.selected]; $('fit').value = selected.fit;
    for (const axis of ['x', 'y']) {
      const value = String(+(selected[axis] * 100).toFixed(1));
      $(axis).value = value; $(axis + '-number').value = value; $(axis + '-value').textContent = value + '%';
    }
    for (const id of ['count', 'layout', 'width', 'height', 'gutter', 'color', 'opacity', 'fit', 'reset']) $(id).disabled = loading;
    for (const id of ['x', 'y', 'x-number', 'y-number']) $(id).disabled = loading || selected.fit === 'fit';
    for (let i = 0; i < 4; i++) {
      const node = $('cell-' + i); node.hidden = i >= n; node.disabled = loading;
      node.textContent = (i + 1) + (i === 0 ? ' · 当前作品' : d.assets[i - 1] ? ' · 已选图片' : ' · 待选图片');
      node.setAttribute('aria-pressed', String(i === S.selected)); node.className = 'small-button' + (i === S.selected ? ' active' : '');
    }
    const asset = S.selected > 0 ? d.assets[S.selected - 1] : null;
    $('selected').textContent = '正在调整第' + (S.selected + 1) + '格' + (S.selected === 0 ? ' · 当前作品作为第一格，不能替换' : asset ? ' · 可替换本地图片' : ' · 请选择本地图片');
    $('pick').disabled = loading || S.selected === 0; $('file').disabled = loading || S.selected === 0;
    $('pick').textContent = asset ? '替换这格图片' : '选择这格图片';
    $('cancel-import').hidden = !loading; $('cancel-import').disabled = !loading;
    $('dimensions').textContent = '声明输出：' + r.width + ' × ' + r.height + ' 像素 · 每边256–4096，总计≤800万像素；不会静默缩小输出';
    $('assets').textContent = ['第1格：当前作品'].concat(d.assets.map((a, i) => '第' + (i + 2) + '格：' + (a ? a.width + ' × ' + a.height + ' RGBA8 工作副本' : '待选择'))).join('；');
    $('fit-note').textContent = selected.fit === 'fill' ? '填满会裁切边缘；焦点0%对应左侧/顶部，100%对应右侧/底部。' : '完整适应会居中保留整张图片，空余区域显示背景；焦点仅在填满裁切时生效。';
    if (!filled(d)) $('budget').textContent = '补齐全部附加图片后检查原尺寸和工作尺寸导出预算；空格只作预览，不能应用。';
    else try {
      const result = assessment(d);
      $('budget').textContent = modeText('原尺寸导出：', result.original) + '；' + modeText('工作尺寸导出：', result.working) +
        (!result.original.allowed && !result.working.allowed ? '。两种方式均不可用，已阻止应用，请减小声明输出尺寸。' : '。应用后新增一条可撤销编辑。');
    } catch (error) { $('budget').textContent = readable(error) + '；已阻止应用。'; }
    const label = root.document && root.document.getElementById('editLabel'); if (label) label.textContent = '拼图预览 · 当前作品作为第一格';
    A.render();
  }
  function bind(id, event, action) {
    const node = $(id), owner = S;
    if (!node) throw Error('拼图控件缺失');
    const handler = e => { if (S === owner && live() && $(id) === node && node.isConnected !== false) return action(e || { target: node }); };
    node[event] = handler; S.bindings.push([node, event, handler]);
  }
  function number(value, integer) {
    if (typeof value !== 'string' || !value.trim()) throw Error('请输入有效的拼图数值');
    const result = Number(value); if (!Number.isFinite(result) || (integer && !Number.isSafeInteger(result))) throw Error('请输入有效的拼图数值');
    return result;
  }
  function edit(change) {
    if (!live() || S.loading) return false;
    try {
      const next = mutableRecipe(modules().L.validate(S.draft.recipe)); change(next);
      const checked = modules().L.validate(next); invalidateSelection();
      S.draft.recipe = checked; rememberActive(); status('预览已更新；补齐图片后点击应用，新增一条可撤销编辑'); sync(); return true;
    } catch (error) { sync(); fail(error); return false; }
  }
  function changeCount(value) {
    if (!live() || S.loading) return false;
    try {
      const count = number(value, true); if (count < 2 || count > 4) throw Error('拼图支持2–4格');
      rememberActive(); const next = mutableRecipe(S.draft.recipe); next.cells = S.cells.slice(0, count).map(cloneCell);
      const checked = modules().L.validate(next); invalidateSelection(); S.draft.recipe = checked; S.draft.assets = S.assets.slice(0, count - 1);
      S.selected = Math.min(S.selected, count - 1); status('格数已更新；暂时隐藏的格子素材和设置保留到离开此工具'); sync(); return true;
    } catch (error) { sync(); fail(error); return false; }
  }
  function selectCell(index) {
    if (!live() || S.loading || !Number.isInteger(index) || index < 0 || index >= S.draft.recipe.cells.length) return false;
    invalidateSelection(); S.selected = index; sync(); return true;
  }
  function cancelImport() {
    if (!S) return false;
    const had = !!S.loading || !!S.fileRequest; S.importToken++; S.loading = null; S.fileRequest = null; invalidatePointer();
    if (had) status('本次图片导入已取消，原有格子和已应用编辑不变'); if (live()) sync(); return had;
  }
  async function importFile(file, index) {
    if (!live() || S.loading || !file) return false;
    if (index === undefined) index = S.selected;
    if (!Number.isInteger(index) || index < 1 || index >= S.draft.recipe.cells.length) return false;
    invalidateSelection(); const owner = S, adapter = A, token = ++S.importToken, revision = S.revision;
    S.loading = { token, index }; status('正在导入第' + (index + 1) + '格本地图片…可随时取消，当前作品不变'); sync();
    const cancelled = () => S !== owner || A !== adapter || !live(owner.draft) || owner.importToken !== token || adapter.revision() !== revision;
    try {
      const result = await modules().I.importFile(file, { core: modules().C, shouldCancel: cancelled });
      if (cancelled()) return false;
      const asset = modules().C.validateAsset(result.asset), next = { type: 'collage', recipe: owner.draft.recipe, assets: owner.draft.assets.slice() };
      next.assets[index - 1] = asset;
      // Validate all real pixels before replacing the selected slot. A full
      // export-budget failure is visible and disables Apply, not a silent resize.
      if (filled(next)) operation(next, false);
      if (cancelled()) return false;
      owner.draft.assets = next.assets; owner.assets[index - 1] = asset;
      status('第' + (index + 1) + '格已嵌入 ' + asset.width + ' × ' + asset.height + ' RGBA8 工作副本；未保留附加图片原文件');
      return true;
    } catch (error) { if (!cancelled()) fail(error); return false; }
    finally { if (S === owner && owner.importToken === token) { owner.loading = null; if (live()) sync(); } }
  }
  function pickFile() {
    if (!live() || S.loading || S.selected === 0) return;
    S.fileRequest = { generation: S.generation, revision: S.revision, index: S.selected };
    $('file').value = ''; $('file').click();
  }
  function receiveFile(event) {
    const request = S.fileRequest, file = event.target.files && event.target.files[0]; event.target.value = ''; S.fileRequest = null;
    if (!request || request.generation !== S.generation || request.revision !== S.revision || request.index !== S.selected) return false;
    return importFile(file, request.index);
  }
  function sourceImportStarted() {
    if (!S || !A) return;
    invalidateSelection(); S.importToken++; S.loading = null;
    const canvas = A.getCanvas(); S.sourceImportPending = { canvas, width: canvas.width, height: canvas.height };
  }
  function sourceImportFinished() {
    if (!S || !A || !S.sourceImportPending) return;
    const pending = S.sourceImportPending, canvas = A.getCanvas();
    if (A.getDraft() !== S.draft || canvas !== pending.canvas || canvas !== S.source || canvas.width !== pending.width || canvas.height !== pending.height || canvas.width !== S.width || canvas.height !== S.height) return;
    S.sourceImportPending = null; S.revision = A.revision(); invalidateSelection(); status('主照片未替换，拼图设置已保留，可继续调整'); sync();
  }
  function makeCanvas(width, height) {
    const c = A.createCanvas ? A.createCanvas(width, height) : root.document.createElement('canvas');
    if (!c || c === A.getCanvas() || typeof c.getContext !== 'function') throw Error('拼图预览画布不可用');
    c.width = width; c.height = height; return c;
  }
  function preview(d) {
    current(d); const input = A.getCanvas(), op = operation(d, true);
    const output = modules().O.applyCanvas(input, op, makeCanvas, { maxSide: 900 });
    if (!output || output === input || typeof output.getContext !== 'function') throw Error('拼图预览未生成独立画布，当前作品未改变');
    // The editor owns and disposes this fresh canvas after every render.
    return output;
  }
  // Cell selection does not mutate the recipe. Numeric focus controls remain
  // usable on narrow touch screens without a crop drag accidentally committing.
  function start(d, p) {
    invalidatePointer();
    if (!live(d) || S.loading || !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    try {
      const candidate = modules().L.hitTest(layout(d), { x: p.x, y: p.y });
      if (candidate === null) return null;
      const q = { draft: d, candidate, start: { x: p.x, y: p.y }, generation: S.generation, ended: false };
      S.pointer = q; return q;
    } catch (error) { fail(error); return null; }
  }
  function active(d, q) { return live(d) && q && S.pointer === q && !q.ended && q.generation === S.generation; }
  function move(d, p, q) {
    if (!active(d, q)) return false;
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) { invalidatePointer(); return false; }
    return true;
  }
  function finish(d, p, q, cancelled) {
    if (!active(d, q)) return false;
    q.ended = true; S.pointer = null;
    if (cancelled || !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x - q.start.x) + Math.abs(p.y - q.start.y) > 0.04) return false;
    try {
      const index = modules().L.hitTest(layout(d), { x: p.x, y: p.y });
      return index === q.candidate ? selectCell(q.candidate) : false;
    } catch (error) { fail(error); return false; }
  }
  function layout(d) {
    const sizes = [{ width: S.width, height: S.height }].concat(d.assets.map(a => a ? { width: a.width, height: a.height } : { width: 1, height: 1 }));
    return modules().L.plan(sizes, d.recipe, { maxSide: 900 });
  }
  function overlay(ctx, width, height, d) {
    if (!live(d)) return;
    const p = layout(d), b = p.cells[S.selected].cellRect, scaleX = width / p.outputSize.width, scaleY = height / p.outputSize.height;
    ctx.save();
    try {
      ctx.strokeStyle = '#eff8df'; ctx.lineWidth = Math.max(1, width / 450);
      ctx.setLineDash([Math.max(3, width / 120), Math.max(2, width / 180)]);
      ctx.strokeRect(b.x * scaleX, b.y * scaleY, b.width * scaleX, b.height * scaleY);
    } finally { ctx.restore(); }
  }
  function release() {
    if (S) {
      S.importToken++; S.loading = null; S.fileRequest = null; invalidatePointer();
      for (const [node, event, handler] of S.bindings) if (node[event] === handler) node[event] = null;
      if (root.removeEventListener) root.removeEventListener('blur', S.onBlur);
      if (root.document && root.document.removeEventListener) root.document.removeEventListener('visibilitychange', S.onHidden);
    }
    S = null; A = null;
  }
  function slider(id, label, max, step) {
    return '<div class="slider-row"><label for="co-' + id + '">' + label + '</label><input id="co-' + id + '" type="range" min="0" max="' + max + '" step="' + step + '"><output id="co-' + id + '-value"></output></div>';
  }
  function setup(adapter) {
    release(); A = adapter;
    try {
      modules(); if (!A || !A.panel || !['getDraft', 'setDraft', 'getCanvas', 'render', 'revision', 'assess'].every(k => typeof A[k] === 'function')) throw Error('拼图界面适配缺失');
      const source = A.getCanvas(); if (!source || !Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) || source.width < 1 || source.height < 1) throw Error('当前作品尺寸无效');
      const initial = modules().L.validate(modules().L.defaults(2)), cells = [0, 1, 2, 3].map(i => initial.cells[i] ? cloneCell(initial.cells[i]) : cellDefault());
      const draft = { type: 'collage', recipe: initial, assets: [null] };
      S = { panel: A.panel, source, width: source.width, height: source.height, revision: A.revision(), draft, initial,
        cells, initialCells: cells.map(cloneCell), assets: [null, null, null], selected: 1, generation: 0, importToken: 0,
        loading: null, pointer: null, fileRequest: null, sourceImportPending: null, bindings: [] };
      A.setDraft(draft);
      S.panel.innerHTML = '<div class="collage-controls"><div class="portrait-heading"><strong>本地多图拼图</strong><span>2–4格 · 离线可撤销</span></div>' +
        '<p class="portrait-copy">当前作品作为第一格；附加本地图片后新增一条编辑，不新建项目、不替换主照片原件。</p>' +
        '<div class="portrait-actions"><label for="co-count">格数</label><select id="co-count"><option value="2">2格</option><option value="3">3格</option><option value="4">4格</option></select><label for="co-layout">布局</label><select id="co-layout"><option value="horizontal">横向并排</option><option value="vertical">纵向排列</option><option value="grid">网格</option></select></div>' +
        '<p class="portrait-copy">网格：2格左右并排，3格左大右侧两格，4格2×2。</p>' +
        '<div class="portrait-actions"><label for="co-width">输出宽</label><input id="co-width" type="number" inputmode="numeric" min="256" max="4096" step="1" style="width:88px"><label for="co-height">输出高</label><input id="co-height" type="number" inputmode="numeric" min="256" max="4096" step="1" style="width:88px"></div>' +
        slider('gutter', '格间距', 10, 0.1) + '<div class="portrait-actions"><label for="co-color">背景颜色</label><input id="co-color" type="color"></div>' + slider('opacity', '背景不透明度', 100, 1) +
        '<div class="portrait-actions" role="group" aria-label="选择要调整的格子">' + [0, 1, 2, 3].map(i => '<button type="button" id="co-cell-' + i + '" class="small-button" aria-pressed="false"></button>').join('') + '</div>' +
        '<p class="portrait-copy" id="co-selected"></p><div class="portrait-actions"><button type="button" id="co-pick" class="small-button primary">选择这格图片</button><button type="button" id="co-cancel-import" class="small-button" hidden>取消导入</button><input id="co-file" type="file" accept="image/png,image/jpeg,image/webp" hidden></div>' +
        '<div class="portrait-actions"><label for="co-fit">图片适配</label><select id="co-fit"><option value="fill">填满裁切</option><option value="fit">完整适应</option></select><button type="button" id="co-reset" class="small-button">重置这格摆放</button></div>' +
        slider('x', '水平焦点', 100, 0.1) + '<div class="portrait-actions"><label for="co-x-number">水平焦点数值 %</label><input id="co-x-number" type="number" inputmode="decimal" min="0" max="100" step="0.1" style="width:88px"></div>' +
        slider('y', '垂直焦点', 100, 0.1) + '<div class="portrait-actions"><label for="co-y-number">垂直焦点数值 %</label><input id="co-y-number" type="number" inputmode="decimal" min="0" max="100" step="0.1" style="width:88px"></div>' +
        '<p class="portrait-copy" id="co-fit-note"></p><p class="portrait-copy" id="co-dimensions"></p><p class="portrait-copy" id="co-assets"></p><p class="portrait-copy" id="co-budget"></p>' +
        '<p class="portrait-status" id="co-status" role="status" aria-live="polite">选择第2格本地图片开始；点击格子按钮调整各格。</p>' +
        '<p class="portrait-copy">附加源图片仅限静态PNG/JPEG/WebP，≤12MiB、800万像素、最长边4096；每张转为≤1024长边、≤1,048,576像素的RGBA8工作副本嵌入草稿，放大不会增加细节。附加原文件、路径和链接不保存。不支持动画、SVG、自由图层重排或已应用拼图重编。</p>' +
        '<p class="portrait-copy">PNG保留透明背景；JPEG会合成白底。减少格数会暂存隐藏格子的素材和设置，离开工具后不保留未应用内容；只应用当前显示的格子。</p></div>';
      bind('count', 'onchange', e => changeCount(e.target.value)); bind('layout', 'onchange', e => edit(r => { r.layout = e.target.value; }));
      for (const key of ['width', 'height']) bind(key, 'onchange', e => edit(r => { r[key] = number(e.target.value, true); }));
      bind('gutter', 'oninput', e => edit(r => { r.gutter = number(e.target.value) / 100; }));
      bind('color', 'onchange', e => edit(r => { r.background.color = e.target.value; }));
      bind('opacity', 'oninput', e => edit(r => { r.background.opacity = number(e.target.value) / 100; }));
      for (let i = 0; i < 4; i++) bind('cell-' + i, 'onclick', () => selectCell(i));
      bind('pick', 'onclick', pickFile); bind('file', 'onchange', receiveFile); bind('cancel-import', 'onclick', cancelImport);
      bind('fit', 'onchange', e => edit(r => { r.cells[S.selected].fit = e.target.value; }));
      for (const axis of ['x', 'y']) {
        bind(axis, 'oninput', e => edit(r => { r.cells[S.selected][axis] = number(e.target.value) / 100; }));
        bind(axis + '-number', 'onchange', e => edit(r => { r.cells[S.selected][axis] = number(e.target.value) / 100; }));
      }
      bind('reset', 'onclick', () => edit(r => { r.cells[S.selected] = cellDefault(); }));
      const owner = S;
      S.onBlur = () => { if (S !== owner) return; invalidatePointer(); if (S.loading) cancelImport(); };
      S.onHidden = () => { if (S === owner && (root.document.hidden || root.document.visibilityState === 'hidden')) S.onBlur(); };
      if (root.addEventListener) root.addEventListener('blur', S.onBlur);
      if (root.document && root.document.addEventListener) root.document.addEventListener('visibilitychange', S.onHidden);
      if (A.hint) A.hint('当前作品固定在第一格；选择附加图片，再用焦点滑杆调整裁切');
      sync(); return draft;
    } catch (error) {
      const adapter = A, text = readable(error); release(); if (adapter && adapter.setDraft) adapter.setDraft(null);
      if (adapter && adapter.panel) adapter.panel.textContent = text; if (adapter && adapter.toast) adapter.toast(text); return null;
    }
  }
  root.CollageUI = Object.freeze({ setup, release, changed, canApply, preview, isLoading: () => !!S && !!S.loading,
    cancelImport, importFile, start, move, finish, overlay, sourceImportStarted, sourceImportFinished });
})(typeof globalThis !== 'undefined' ? globalThis : this);
