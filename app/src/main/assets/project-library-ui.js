/* Local-project presentation only. The host owns validation, confirmations,
 * revision checks and atomic storage/editor transitions. No pixels or network. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MintProjectLibraryUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const IDS = ['projectLibraryBtn', 'projectLibraryDialog', 'projectLibraryStatus', 'projectLibraryName',
    'projectLibrarySave', 'projectLibrarySaveCopy', 'projectLibraryNew', 'projectLibraryRefresh',
    'projectLibraryClose', 'projectLibraryList', 'projectLibraryTrashList'];
  const ERRORS = Object.freeze({
    INVALID_NAME: '名称需 1–80 个字，不能包含控制字符。', INVALID_ID: '项目标识无效，请重读本机。',
    INVALID_REVISION: '项目版本无效，请重读本机。', INVALID_RECORD: '项目数据无效，不能保存或打开。',
    RECORD_TOO_LARGE: '单个项目超过 64 MiB，未保存，当前编辑保留。可减少附加素材；导出图片不会保留编辑历史。',
    COLLECTION_FULL: '作品库已满。可在回收站永久删除不需要的项目，再保存。',
    COLLECTION_TOO_LARGE: '作品库空间不足。可清理回收站后重试，当前编辑保留。',
    NOT_FOUND: '找不到所选项目，请重读本机。', REVISION_CONFLICT: '项目已发生变化，请重读本机后再操作。',
    TRASHED: '所选项目已在回收站，请先恢复。', NOT_TRASHED: '所选项目不在回收站，请重读本机。',
    ID_COLLISION: '项目标识冲突，未创建副本，请重试。',
    CORRUPT_STORAGE: '本机项目记录损坏；未覆盖旧数据，请保留已有备份。',
    STORAGE_UNAVAILABLE: '本机存储不可用，请检查设备空间或存储设置。',
    STORAGE_BLOCKED: '本机存储被其他页面占用，请关闭其他编辑窗口后重试。',
    STORAGE_ABORTED: '存储操作未完成，请重读本机后重试。',
    STORAGE_QUOTA: '设备存储空间不足，未完成保存。请保留备份并检查设备空间。',
    USE_ARCHIVE: '此项目无法保存到本机项目库，当前编辑保留。导出图片不会保留编辑历史。'
  });
  function errorText(error) {
    try { if (error && Object.prototype.hasOwnProperty.call(ERRORS, error.code)) return ERRORS[error.code]; } catch (_) { /* Do not expose arbitrary exception content. */ }
    return '操作未完成，请重读本机后重试。';
  }
  function nameValue(value) {
    if (typeof value !== 'string' || value.length > 1024) return null;
    const name = value.normalize('NFC').trim(), points = Array.from(name);
    // Match storage normalization before dispatch. Unicode mode rejects lone
    // surrogate code units without rejecting valid astral characters/emoji.
    if (!name || points.length > 80 || /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069\ud800-\udfff]/u.test(name)) return null;
    const utf8Bytes = points.reduce((total, point) => {
      const code = point.codePointAt(0);
      return total + (code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4);
    }, 0);
    return utf8Bytes <= 320 ? name : null;
  }
  function bytes(value) { return (value / 1048576).toFixed(value >= 10485760 ? 0 : 1) + ' MiB'; }
  function duplicateName(name) { return Array.from(name).slice(0, 77).join('') + ' 副本'; }
  function validateListing(value) {
    if (!value || !Array.isArray(value.entries) || !Array.isArray(value.trash) || value.entries.length + value.trash.length > 24) throw Error('Invalid listing');
    const seen = new Set();
    const copy = entry => {
      if (!entry || typeof entry.id !== 'string' || !/^project-[0-9a-f]{32}$/.test(entry.id) || seen.has(entry.id) ||
          !nameValue(entry.name) || !Number.isSafeInteger(entry.revision) || entry.revision < 1 ||
          !Number.isSafeInteger(entry.updatedAt) || entry.updatedAt < 0 || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) throw Error('Invalid metadata');
      seen.add(entry.id);
      return { id: entry.id, name: entry.name, revision: entry.revision, updatedAt: entry.updatedAt, bytes: entry.bytes };
    };
    const entries = value.entries.map(copy), trash = value.trash.map(copy), usage = value.usage;
    if (!usage || !Number.isSafeInteger(usage.count) || usage.count !== seen.size ||
        !Number.isSafeInteger(usage.maxCount) || usage.maxCount < usage.count || usage.maxCount > 24 || usage.maxCount < 1 ||
        !Number.isSafeInteger(usage.bytes) || usage.bytes < 0 || !Number.isSafeInteger(usage.maxBytes) || usage.maxBytes < 1) throw Error('Invalid usage');
    return { entries, trash, usage: { count: usage.count, maxCount: usage.maxCount, bytes: usage.bytes, maxBytes: usage.maxBytes } };
  }
  function create(host) {
    const a = host || {}, document = a.document;
    let live = true, nodes = null, bindings = [], rowBindings = [], rows = [], clearTrashControl = null, mountVersion = 0, rowVersion = 0;
    let epoch = 0, shown = false, reading = null, operation = null, data = null, stale = true, problem = '', note = '', nameKey = null;
    function find() {
      if (!document || typeof document.getElementById !== 'function' || typeof document.createElement !== 'function') return null;
      const found = {}; for (const id of IDS) found[id] = document.getElementById(id); return found;
    }
    function complete(n) { return !!n && IDS.every(id => !!n[id]); }
    function current(n) { return live && complete(n) && IDS.every(id => document.getElementById(id) === n[id]); }
    function remove(list) { for (const item of list) item.node.removeEventListener(item.type, item.handler); list.length = 0; }
    function bind(node, type, action, list) {
      const version = mountVersion, n = nodes;
      const handler = event => { if (current(n) && version === mountVersion) action(event); };
      node.addEventListener(type, handler); list.push({ node, type, handler });
    }
    function disable(n) {
      if (n) for (const id of IDS) if (n[id] && !['projectLibraryDialog', 'projectLibraryStatus', 'projectLibraryList', 'projectLibraryTrashList'].includes(id)) n[id].disabled = true;
    }
    function snapshot() {
      try {
        const s = typeof a.getState === 'function' ? a.getState() : null;
        if (!s || typeof s.loaded !== 'boolean' || typeof s.busy !== 'boolean' || typeof s.dirty !== 'boolean' ||
            typeof s.previewDirty !== 'boolean' || (s.currentId !== null && typeof s.currentId !== 'string') || typeof s.currentName !== 'string') return null;
        return { loaded: s.loaded, currentId: s.currentId, currentName: s.currentName, dirty: s.dirty, previewDirty: s.previewDirty, busy: s.busy };
      } catch (_) { return null; }
    }
    function viewActive(n, token) { return current(n) && shown && n.projectLibraryDialog.open && epoch === token; }
    function endView() {
      if (!shown) return;
      shown = false; epoch++; reading = null; rowVersion++; note = '';
      if (operation) stale = true;
      sync();
      if (typeof a.onClose === 'function') { try { Promise.resolve(a.onClose()).catch(() => {}); } catch (_) { /* A close notification cannot reopen a dismissed dialog. */ } }
    }
    function mount() {
      if (!live) return false;
      if (current(nodes)) return true;
      remove(bindings); remove(rowBindings); disable(nodes); rows = []; mountVersion++; rowVersion++; epoch++; reading = null;
      nodes = find(); nameKey = null; stale = true; shown = !!(nodes && nodes.projectLibraryDialog && nodes.projectLibraryDialog.open);
      if (!complete(nodes)) { disable(nodes); if (nodes && nodes.projectLibraryStatus) nodes.projectLibraryStatus.textContent = '本机项目面板不可用。'; return false; }
      const n = nodes;
      for (const id of ['projectLibraryBtn', 'projectLibrarySave', 'projectLibrarySaveCopy', 'projectLibraryNew', 'projectLibraryRefresh', 'projectLibraryClose']) n[id].type = 'button';
      n.projectLibraryBtn.setAttribute('aria-controls', 'projectLibraryDialog');
      n.projectLibraryBtn.setAttribute('aria-haspopup', 'dialog');
      n.projectLibraryStatus.setAttribute('role', 'status'); n.projectLibraryStatus.setAttribute('aria-live', 'polite');
      n.projectLibraryName.setAttribute('aria-label', '当前项目名称'); n.projectLibraryName.maxLength = 160;
      n.projectLibraryName.autocomplete = 'off';
      n.projectLibrarySave.textContent = '保存项目'; n.projectLibrarySaveCopy.textContent = '保存独立副本';
      n.projectLibraryNew.textContent = '新建照片'; n.projectLibraryRefresh.textContent = '重读本机';
      n.projectLibraryClose.setAttribute('aria-label', '关闭本机项目库');
      n.projectLibraryList.setAttribute('aria-label', '本机已保存项目');
      n.projectLibraryTrashList.setAttribute('aria-label', '本机回收站，可恢复且仍占容量');
      bind(n.projectLibraryBtn, 'click', () => { if (!n.projectLibraryBtn.disabled) void open(); }, bindings);
      bind(n.projectLibraryClose, 'click', () => close(), bindings);
      bind(n.projectLibraryDialog, 'close', () => { if (!n.projectLibraryDialog.open) endView(); }, bindings);
      bind(n.projectLibraryDialog, 'cancel', event => { if (event && typeof event.preventDefault === 'function') event.preventDefault(); close(); }, bindings);
      bind(n.projectLibraryRefresh, 'click', () => { if (!n.projectLibraryRefresh.disabled) void refresh(); }, bindings);
      bind(n.projectLibraryName, 'input', () => sync(), bindings);
      bind(n.projectLibrarySave, 'click', () => void dispatch(n.projectLibrarySave, 'save', () => a.onSave(nameValue(n.projectLibraryName.value), { asCopy: false })), bindings);
      bind(n.projectLibrarySaveCopy, 'click', () => void dispatch(n.projectLibrarySaveCopy, 'saveCopy', () => a.onSave(nameValue(n.projectLibraryName.value), { asCopy: true })), bindings);
      bind(n.projectLibraryNew, 'click', () => void dispatch(n.projectLibraryNew, 'new', () => a.onNew()), bindings);
      renderLists(); return true;
    }
    function createNode(tag, className, text) {
      const node = document.createElement(tag); node.className = className;
      if (text !== undefined) node.textContent = text; return node;
    }
    function renderLists() {
      if (!current(nodes)) return;
      remove(rowBindings); rows = []; clearTrashControl = null; rowVersion++;
      const version = rowVersion, n = nodes, token = epoch;
      n.projectLibraryList.textContent = ''; n.projectLibraryTrashList.textContent = '';
      for (const isTrash of [false, true]) {
        const list = isTrash ? n.projectLibraryTrashList : n.projectLibraryList, entries = data ? (isTrash ? data.trash : data.entries) : [];
        if (isTrash && entries.length) {
          const toolbar = createNode('li', 'project-library-trash-actions');
          clearTrashControl = createNode('button', 'button secondary project-library-action danger', '清空回收站');
          const control = clearTrashControl; control.type = 'button';
          control.setAttribute('aria-label', '永久删除回收站中的全部项目');
          bind(control, 'click', () => { if (version === rowVersion && viewActive(n, token) && toolbar.parentNode === list) void dispatch(control, 'emptyTrash', () => a.onEmptyTrash()); }, rowBindings);
          toolbar.appendChild(control); list.appendChild(toolbar);
        }
        if (!entries.length) list.appendChild(createNode('li', 'project-library-empty', data ? (isTrash ? '回收站为空。' : '还没有本机项目。选择照片后，命名保存即可继续编辑。') : '尚未读取本机项目。'));
        for (const entry of entries) {
          const row = createNode('li', 'project-library-card'), title = createNode('strong', 'project-library-card-name', entry.name);
          const stamp = new Date(entry.updatedAt);
          const updated = Number.isFinite(stamp.getTime()) ? stamp.toLocaleString('zh-CN') : '时间不可用';
          row.appendChild(title);
          const badge = createNode('span', 'project-library-current'); row.appendChild(badge);
          row.appendChild(createNode('p', 'project-library-meta', '版本 ' + entry.revision + ' · ' + bytes(entry.bytes) + ' · ' + updated));
          const actions = createNode('div', 'project-library-card-actions');
          const info = { row, list, entry, badge, buttons: [], copyInput: null, isTrash };
          const validRow = () => version === rowVersion && viewActive(n, token) && row.parentNode === list;
          const button = (kind, label, fn) => {
            const control = createNode('button', 'button secondary project-library-action' + (kind === 'purge' ? ' danger' : ''), label); control.type = 'button';
            control.setAttribute('aria-label', label + '：' + entry.name);
            bind(control, 'click', () => { if (validRow()) void dispatch(control, kind, fn, info); }, rowBindings);
            info.buttons.push({ control, kind }); return control;
          };
          if (isTrash) {
            actions.appendChild(button('restore', '恢复项目', () => a.onRestore(entry.id)));
            actions.appendChild(button('purge', '永久删除', () => a.onPurge(entry.id)));
          }
          else {
            actions.appendChild(button('open', '打开项目', () => a.onOpen(entry.id)));
            actions.appendChild(button('trash', '移入回收站', () => a.onTrash(entry.id)));
          }
          row.appendChild(actions);
          if (!isTrash) {
            const copy = createNode('div', 'project-library-copy'), label = createNode('label', 'project-library-copy-label', '独立副本名称');
            const input = createNode('input', 'project-library-copy-name'); input.type = 'text'; input.value = duplicateName(entry.name); input.maxLength = 160; input.autocomplete = 'off';
            input.setAttribute('aria-label', '独立副本名称：' + entry.name); label.appendChild(input); copy.appendChild(label); info.copyInput = input;
            bind(input, 'input', () => { if (validRow()) sync(); }, rowBindings);
            copy.appendChild(button('copy', '复制已存版本', () => a.onCopy(entry.id, nameValue(input.value))));
            row.appendChild(copy);
            row.appendChild(createNode('p', 'project-library-copy-note', '复制本机已保存版本，不包含当前未保存修改或预览。'));
          }
          rows.push(info); list.appendChild(row);
        }
      }
    }
    function sync() {
      if (!mount()) return false;
      const n = nodes, s = snapshot(), locked = !!operation || !!reading || !s || s.busy;
      const visible = shown && !!n.projectLibraryDialog.open, ready = visible && !locked;
      const fresh = !!data && !stale, full = !!data && data.usage.count >= data.usage.maxCount;
      if (s) {
        const key = JSON.stringify([s.loaded, s.currentId, s.currentName]);
        if (key !== nameKey) { n.projectLibraryName.value = s.currentName || '我的照片'; nameKey = key; }
      }
      const validName = !!nameValue(n.projectLibraryName.value);
      n.projectLibraryName.disabled = !ready || !s.loaded;
      n.projectLibraryName.setAttribute('aria-invalid', String(!validName));
      n.projectLibraryBtn.disabled = !s;
      n.projectLibraryBtn.setAttribute('aria-expanded', String(visible));
      n.projectLibraryClose.disabled = false;
      n.projectLibrarySave.disabled = !ready || !fresh || !s.loaded || !validName || typeof a.onSave !== 'function' || (full && !s.currentId);
      n.projectLibrarySaveCopy.disabled = !ready || !fresh || !s.loaded || !validName || full || typeof a.onSave !== 'function';
      n.projectLibraryNew.disabled = !ready || typeof a.onNew !== 'function';
      n.projectLibraryRefresh.disabled = !visible || locked || typeof a.refresh !== 'function';
      n.projectLibraryList.setAttribute('aria-busy', String(locked)); n.projectLibraryTrashList.setAttribute('aria-busy', String(locked));
      if (clearTrashControl) clearTrashControl.disabled = !ready || !fresh || typeof a.onEmptyTrash !== 'function' || !!(s && data.trash.some(entry => entry.id === s.currentId));
      for (const info of rows) {
        const isCurrent = !!s && s.loaded && s.currentId === info.entry.id;
        info.badge.textContent = isCurrent ? '当前项目' : '';
        if (info.copyInput) { info.copyInput.disabled = !ready || !fresh || full; info.copyInput.setAttribute('aria-invalid', String(!nameValue(info.copyInput.value))); }
        for (const item of info.buttons) {
          const callback = { open: 'onOpen', trash: 'onTrash', copy: 'onCopy', restore: 'onRestore', purge: 'onPurge' }[item.kind];
          item.control.disabled = !ready || !fresh || typeof a[callback] !== 'function' || (item.kind === 'purge' && isCurrent) || (item.kind === 'copy' && (full || !nameValue(info.copyInput.value)));
        }
      }
      const lines = [];
      if (!s) lines.push('无法读取当前编辑状态，操作已暂停。');
      else if (!s.loaded) lines.push('尚未选择照片。可以打开已有项目，或新建照片。');
      else if (!s.currentId) lines.push('当前照片尚未保存为本机项目。');
      else lines.push('当前项目「' + s.currentName + '」：' + (s.dirty ? '有未保存修改。' : '已保存到本机。'));
      if (s && s.previewDirty) lines.push('有未应用预览：不会写入项目，请先应用再保存。');
      else lines.push('项目只保存已应用步骤，不包含未应用预览。');
      if (operation) lines.push('正在处理本次操作，请稍候。关闭面板不会取消已开始的存储操作。');
      else if (reading) lines.push('正在读取本机项目…');
      else if (s && s.busy) lines.push('编辑器正在处理，请稍候。');
      else if (note) lines.push(note);
      if (problem) lines.push(problem);
      else if (stale && !reading && !operation) lines.push('列表尚未核实，请点“重读本机”后操作。');
      if (s && s.loaded && !validName) lines.push('名称需 1–80 个字，不能包含控制字符。');
      if (data) lines.push('本机 ' + data.usage.count + ' / ' + data.usage.maxCount + ' 项（含回收站） · ' + bytes(data.usage.bytes) + ' / ' + bytes(data.usage.maxBytes) + '。每项最多 64 MiB。');
      else lines.push('上限：24 项（含回收站）、总量 192 MiB、每项 64 MiB。');
      lines.push('独立副本占用容量；回收站可恢复、仍占容量，不会自动清理。可永久删除不需要的回收站项目来释放空间。');
      lines.push('保存项目不等于导出图片。原图、配方和素材仅存于此设备；清除应用数据会丢失全部项目。');
      n.projectLibraryStatus.textContent = lines.join('\n');
      return !!s;
    }
    async function refresh() {
      if (!mount() || !shown || !nodes.projectLibraryDialog.open) return false;
      const n = nodes, token = epoch, s = snapshot();
      if (operation || !s || s.busy || typeof a.refresh !== 'function') { sync(); return false; }
      if (reading && reading.epoch === token) return reading.promise;
      const job = { epoch: token, promise: null }; reading = job; sync();
      job.promise = (async () => {
        try {
          const next = validateListing(await a.refresh());
          if (!viewActive(n, token) || reading !== job) return false;
          data = next; stale = false; problem = ''; renderLists(); return true;
        } catch (error) {
          if (!viewActive(n, token) || reading !== job) return false;
          stale = true;
          problem = '读取失败，' + (data ? '保留上次列表（可能已过期）；' : '尚未获得可信列表；') + errorText(error);
          return false;
        } finally {
          if (reading === job) reading = null;
          if (viewActive(n, token)) sync();
        }
      })();
      return job.promise;
    }
    async function dispatch(control, kind, callback, row) {
      if (!current(nodes) || !shown || !nodes.projectLibraryDialog.open || !control || control.disabled || operation || reading) return false;
      // Re-read host state at dispatch, not just when this button was rendered.
      sync();
      if (control.disabled || !snapshot()) return false;
      if (row && (row.row.parentNode !== row.list || !rows.includes(row))) return false;
      const n = nodes, token = epoch, job = {}; operation = job; note = ''; sync();
      try {
        const result = await callback();
        if (!viewActive(n, token)) return false;
        if (result === false || (result && result.cancelled === true)) { note = '已取消本次操作。'; return false; }
        stale = true;
        note = ({ save: '项目已保存到本机。', saveCopy: '当前编辑已保存为独立副本。', copy: '已复制本机已保存版本。',
          open: '已打开所选项目。', trash: '项目已移入回收站，仍可恢复。', restore: '项目已恢复。', purge: '项目已永久删除，空间已释放。', emptyTrash: '回收站已清空，空间已释放。', new: '已请求选择新照片。' })[kind];
        operation = null;
        await refresh();
        return true;
      } catch (error) {
        if (viewActive(n, token)) { stale = true; note = ''; problem = errorText(error) + ' 上次列表可能已过期，请重读本机。'; }
        return false;
      } finally {
        if (operation === job) operation = null;
        if (current(n)) {
          sync();
          // A dismissed action cannot write success into a later opening. Only
          // re-read authoritative storage to reconcile that newer view.
          if (shown && n.projectLibraryDialog.open && epoch !== token && !operation && !reading) void refresh();
        }
      }
    }
    async function open() {
      if (!mount()) return false;
      const n = nodes;
      if (shown && n.projectLibraryDialog.open) { sync(); return true; }
      if (!snapshot()) { sync(); return false; }
      try {
        if (!n.projectLibraryDialog.open) {
          if (typeof n.projectLibraryDialog.showModal !== 'function') throw Error('Dialog unavailable');
          n.projectLibraryDialog.showModal();
        }
        shown = true; epoch++; const token = epoch; note = ''; problem = ''; stale = true;
        renderLists(); sync();
        await refresh();
        return viewActive(n, token);
      } catch (_) {
        if (current(n)) { note = '当前环境无法打开本机项目面板。'; sync(); }
        return false;
      }
    }
    function close() {
      if (!current(nodes)) return false;
      const dialog = nodes.projectLibraryDialog;
      // Invalidate queued clicks and async continuations before native close.
      endView();
      try { if (dialog.open && typeof dialog.close === 'function') dialog.close(); }
      catch (_) { sync(); return false; }
      sync(); return !dialog.open;
    }
    function release() {
      if (!live) return;
      live = false; shown = false; epoch++; mountVersion++; rowVersion++; reading = null;
      remove(bindings); remove(rowBindings); disable(nodes);
      if (clearTrashControl) clearTrashControl.disabled = true;
      for (const info of rows) { for (const item of info.buttons) item.control.disabled = true; if (info.copyInput) info.copyInput.disabled = true; }
      if (nodes) {
        nodes.projectLibraryBtn && nodes.projectLibraryBtn.setAttribute('aria-expanded', 'false');
        const dialog = nodes.projectLibraryDialog;
        if (dialog && dialog.open && typeof dialog.close === 'function') { try { dialog.close(); } catch (_) { /* Inert already. */ } }
      }
      rows = []; nodes = null;
    }
    sync();
    return Object.freeze({ open, close, refresh, sync, release });
  }
  return Object.freeze({ create });
});
