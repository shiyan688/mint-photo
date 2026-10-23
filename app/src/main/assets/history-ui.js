/* History navigation only. Project validation, confirmation and atomic replay
 * belong to the host. This module never changes operations or image pixels. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MintHistoryUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_STEPS = 60;
  const IDS = ['historyBtn', 'historyDialog', 'historyStatus', 'historySteps', 'historyOriginal', 'historyLatest'];
  const LABELS = Object.freeze({
    sharpness:'细节 / 锐化', 'portrait-people':'逐人人像',perspective: '四角透视', straighten: '调平', collage: '拼图', 'canvas-padding': '边框 / 留白', 'local-tone': '局部调色',
    'adjustment-preset': '调色配方', geometry: '构图', rotate: '旋转',
    flip: '翻转', crop: '裁剪', idphoto: '证件照', filter: '滤镜',
    adjust: '基础调节', levels: '色阶', 'advanced-tone': '曲线 / HSL',
    text: '文字（旧版）', sticker: '贴纸', draw: '涂鸦（旧版）',
    'light-balance': '明暗/白平衡', 'image-overlay': '图片贴图', redact: '马赛克/遮盖', beauty: '人像修肤', reshape: '五官调整', manual: '手动精修',
    heal: '祛痘（旧版）', warp: '液化（旧版）', background: '背景', 'background-refine': '背景精细修边'
  });
  // Display fixed labels only. Do not read photo names, paths, captions, recipe
  // names, text content or getters from operations just to label a history row.
  function ownValue(object, key) {
    if (!object || typeof object !== 'object') return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : undefined;
  }
  function label(op) {
    const type = ownValue(op, 'type');
    if (type === 'text-overlay' || type === 'paint-layer') {
      const action = ownValue(op, 'action'), noun = type === 'text-overlay' ? '文字' : '涂鸦';
      return action === 'add' ? '新增' + noun : action === 'replace' ? '修改' + noun : noun;
    }
    return typeof type === 'string' && Object.prototype.hasOwnProperty.call(LABELS, type) ? LABELS[type] : '编辑步骤';
  }
  function create(options) {
    const a = options || {}, document = a.document;
    let live = true, generation = 0, bindings = [], nodes = null, opening = false, dispatching = false;
    function find() {
      if (!document || typeof document.getElementById !== 'function' || typeof document.createElement !== 'function') return null;
      const result = {};
      for (const id of IDS) result[id] = document.getElementById(id);
      return result;
    }
    function complete(n) { return !!n && IDS.every(id => !!n[id]); }
    function current(n) { return live && complete(n) && IDS.every(id => document.getElementById(id) === n[id]); }
    function removeBindings() {
      for (const binding of bindings) binding.node.removeEventListener(binding.type, binding.handler);
      bindings = [];
    }
    function bind(node, type, fn, n, token) {
      const handler = event => {
        if (!current(n) || token !== generation) return;
        fn(event);
      };
      node.addEventListener(type, handler);
      bindings.push({ node, type, handler });
    }
    function snapshot() {
      try {
        const s = typeof a.getState === 'function' ? a.getState() : null;
        if (!s || typeof s.loaded !== 'boolean' || typeof s.busy !== 'boolean' ||
            !Number.isSafeInteger(s.revision) || s.revision < 0 ||
            (s.origin !== 'original' && s.origin !== 'legacy-working-copy') ||
            !Array.isArray(s.ops) || !Array.isArray(s.redo) || s.ops.length + s.redo.length > MAX_STEPS) return null;
        // Copy array containers only: labels read immutable canonical tags. Never
        // reverse the caller's redo array or rewrite its history objects.
        return { loaded: s.loaded, busy: s.busy, origin: s.origin, revision: s.revision,
          index: s.ops.length, timeline: s.ops.concat(s.redo.slice().reverse()) };
      } catch (_) { return null; }
    }
    function enabled(s) { return !!s && s.loaded && !s.busy && typeof a.onJump === 'function'; }
    function status(n, message) { if (n && n.historyStatus) n.historyStatus.textContent = message; }
    function disable(n) {
      if (!n) return;
      for (const id of ['historyBtn', 'historyOriginal', 'historyLatest']) if (n[id]) n[id].disabled = true;
    }
    function clear(n) {
      if (!n || !n.historySteps) return;
      while (n.historySteps.firstChild) n.historySteps.removeChild(n.historySteps.firstChild);
    }
    function jump(index, revision, n, token, node) {
      if (!current(n) || token !== generation || node.disabled || !n.historyDialog.open || dispatching) return false;
      const latest = snapshot();
      if (!enabled(latest)) { refresh(); return false; }
      // Crucially, never substitute latest.revision here. The host must reject
      // this rendered index if the project changed before this event arrived.
      dispatching = true;
      try { a.onJump(index, revision); return true; }
      finally { dispatching = false; }
    }
    function refresh() {
      if (!live) return false;
      generation++;
      removeBindings();
      clear(nodes);
      nodes = find();
      clear(nodes);
      disable(nodes);
      if (!complete(nodes)) { status(nodes, '历史面板不可用。'); return false; }
      const n = nodes, token = generation, s = snapshot();
      n.historyBtn.setAttribute('aria-controls', 'historyDialog');
      n.historyBtn.setAttribute('aria-haspopup', 'dialog');
      n.historyBtn.setAttribute('aria-expanded', String(!!n.historyDialog.open));
      n.historyOriginal.textContent = s && s.origin === 'legacy-working-copy' ? '回到旧工作副本' : '回到原图';
      n.historyLatest.textContent = '回到最新步骤';
      const ready = enabled(s);
      n.historyBtn.disabled = !ready;
      n.historyOriginal.disabled = !ready || s.index === 0;
      n.historyLatest.disabled = !ready || s.index === s.timeline.length;
      n.historySteps.setAttribute('aria-busy', String(!!s && s.busy));
      bind(n.historyBtn, 'click', () => { if (!n.historyBtn.disabled) open(); }, n, token);
      bind(n.historyDialog, 'close', () => { refresh(); }, n, token);
      // Close synchronously on Escape so queued rows are invalidated before
      // the browser's asynchronous close event, without losing the open button.
      bind(n.historyDialog, 'cancel', event => {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        close();
      }, n, token);
      if (!s) { status(n, '无法读取历史记录，请稍后重试。'); return false; }
      if (!s.loaded) { status(n, '选择照片后可查看编辑步骤。'); return false; }
      if (s.busy) status(n, '正在处理，请稍候；暂不能切换步骤。');
      else status(n, '当前第 ' + s.index + ' / ' + s.timeline.length + ' 步' +
        (s.timeline.length > s.index ? ' · ' + (s.timeline.length - s.index) + ' 步可重做' : '') +
        (s.origin === 'legacy-working-copy' ? '。来源为旧工作副本，无法恢复已丢失的原图像素。' : '。原图保留。') +
        ' 未应用的预览不计入步骤。');
      const source = s.origin === 'legacy-working-copy' ? '旧工作副本（非原图）' : '保留的原图';
      for (let index = 0; index <= s.timeline.length; index++) {
        const row = document.createElement('li'), button = document.createElement('button');
        const isCurrent = index === s.index, canRedo = index > s.index;
        row.className = 'history-step';
        button.type = 'button';
        button.className = 'history-step-button' + (isCurrent ? ' is-current' : '') + (canRedo ? ' is-redo' : '');
        button.textContent = (index === 0 ? '0 · ' + source : index + ' · ' + label(s.timeline[index - 1])) +
          (isCurrent ? ' · 当前' : canRedo ? ' · 可重做' : ' · 已应用');
        button.setAttribute('data-history-index', String(index));
        if (isCurrent) button.setAttribute('aria-current', 'step');
        button.disabled = !ready || isCurrent;
        bind(button, 'click', () => {
          if (button.parentNode !== row || row.parentNode !== n.historySteps) return;
          jump(index, s.revision, n, token, button);
        }, n, token);
        row.appendChild(button);
        n.historySteps.appendChild(row);
      }
      bind(n.historyOriginal, 'click', () => jump(0, s.revision, n, token, n.historyOriginal), n, token);
      bind(n.historyLatest, 'click', () => jump(s.timeline.length, s.revision, n, token, n.historyLatest), n, token);
      return ready;
    }
    function open() {
      if (!live || opening || !complete(find())) return false;
      opening = true;
      try {
        // Preparation cancels a transient gesture, not a pending tool draft.
        // It must happen before the latest state used for this render is read.
        if (typeof a.onPrepareOpen === 'function') a.onPrepareOpen();
        if (!live || !refresh()) return false;
        const n = nodes;
        if (!n.historyDialog.open) {
          if (typeof n.historyDialog.showModal !== 'function') { status(n, '当前环境无法打开历史面板。'); return false; }
          n.historyDialog.showModal();
        }
        n.historyBtn.setAttribute('aria-expanded', 'true');
        return true;
      } catch (_) { status(nodes, '历史面板暂时无法打开，请重试。'); return false; }
      finally { opening = false; }
    }
    function close() {
      if (!live || !current(nodes)) return false;
      const dialog = nodes.historyDialog;
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      // Also invalidate immediately: close events may be dispatched later.
      refresh();
      return !dialog.open;
    }
    function release() {
      if (!live) return;
      live = false;
      generation++;
      removeBindings();
      disable(nodes);
      clear(nodes);
      if (nodes && nodes.historyBtn) nodes.historyBtn.setAttribute('aria-expanded', 'false');
      if (nodes && nodes.historyDialog && nodes.historyDialog.open && typeof nodes.historyDialog.close === 'function') {
        try { nodes.historyDialog.close(); } catch (_) { /* Already inert even if the host dialog is unavailable. */ }
      }
      nodes = null;
    }
    refresh();
    return Object.freeze({ refresh, open, close, release });
  }
  return Object.freeze({ create });
});
