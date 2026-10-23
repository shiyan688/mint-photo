/* Bounded, local-only project snapshots. No DOM, decode, or network.
 * Every success is an IndexedDB transaction completion, never a request success.
 */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MintProjectLibrary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const DATABASE_NAME = 'mint-photo-editor', DATABASE_VERSION = 2;
  const STORES = Object.freeze({ drafts: 'drafts', metadata: 'projectMetadata', snapshots: 'projectSnapshots' });
  const MAX_ENTRIES = 24, MAX_RECORD_BYTES = 64 * 1024 * 1024, MAX_TOTAL_BYTES = 192 * 1024 * 1024;
  const MAX_NAME_LENGTH = 80, MAX_NAME_BYTES = 320;
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  function error(code, message, cause) {
    const e = new Error(message); e.name = 'ProjectLibraryError'; e.code = code;
    if (cause !== undefined) e.cause = cause;
    return e;
  }
  function fail(code, message) { throw error(code, message); }
  function storageError(e) {
    if (e && e.name === 'ProjectLibraryError') return e;
    const quota = e && e.name === 'QuotaExceededError';
    return error(quota ? 'STORAGE_QUOTA' : 'STORAGE_ABORTED', quota ? '本机存储空间不足，原项目未被覆盖' : '本机存储操作未完成，请重试', e);
  }
  function utf8Bytes(text) {
    // Same replacement semantics as TextEncoder, without requiring a global encoder.
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c < 0x80) bytes++; else if (c < 0x800) bytes += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
      else bytes += 3;
    }
    return bytes;
  }
  function normalizeName(input) {
    if (typeof input !== 'string' || input.length > 1024) fail('INVALID_NAME', '项目名称必须是文字');
    const value = input.normalize('NFC').trim();
    if (!value || Array.from(value).length > MAX_NAME_LENGTH || utf8Bytes(value) > MAX_NAME_BYTES || /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069\ud800-\udfff]/u.test(value)) fail('INVALID_NAME', '项目名称须为 1–80 个字符，不能含控制字符');
    return value;
  }
  function validId(value) {
    if (typeof value !== 'string' || !/^project-[0-9a-f]{32}$/.test(value)) fail('INVALID_ID', '项目标识无效');
    return value;
  }
  function revision(value) {
    if (!Number.isSafeInteger(value) || value < 1) fail('INVALID_REVISION', '需要有效的项目版本');
    return value;
  }
  function plainFields(value, keys, code) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code, '存储对象格式无效');
    const all = Reflect.ownKeys(value);
    if (all.length !== keys.length || all.some(key => typeof key !== 'string' || !keys.includes(key))) fail(code, '存储对象字段无效');
    for (const key of all) {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d.enumerable || !own(d, 'value')) fail(code, '存储对象不能含访问器');
    }
    return value;
  }
  function nativeBlob(value) {
    if (!value || typeof root.Blob !== 'function') return false;
    try { Object.getOwnPropertyDescriptor(root.Blob.prototype, 'size').get.call(value); return true; } catch (_) { return false; }
  }
  function snapshotInput(input) {
    // Clone synchronously before the first await, so callers cannot mutate pending writes.
    const active = new Set(); let nodes = 0, stringBytes = 0, blob = null, blobCount = 0;
    function copy(value, path, depth) {
      if (++nodes > 2000000 || depth > 64) fail('INVALID_RECORD', '项目结构超过安全上限');
      if (value === null || typeof value === 'boolean') return value;
      if (typeof value === 'number') { if (!Number.isFinite(value)) fail('INVALID_RECORD', '项目包含无效数字'); return value; }
      if (typeof value === 'string') { stringBytes += utf8Bytes(value); if (stringBytes > MAX_RECORD_BYTES) fail('RECORD_TOO_LARGE', '项目配方超过 64 MiB 上限'); return value; }
      if (nativeBlob(value)) {
        if (!['source.blob', 'blob'].includes(path) || ++blobCount !== 1) fail('INVALID_RECORD', '项目只能包含一个原照片文件');
        // Blob getters are invoked through their native prototypes, not user properties.
        const size = Object.getOwnPropertyDescriptor(root.Blob.prototype, 'size').get.call(value);
        const type = Object.getOwnPropertyDescriptor(root.Blob.prototype, 'type').get.call(value);
        if (!Number.isSafeInteger(size) || size < 1 || size > MAX_RECORD_BYTES) fail('RECORD_TOO_LARGE', '原照片文件大小无效或超过 64 MiB');
        blob = new root.Blob([value], { type }); return blob;
      }
      if (!value || typeof value !== 'object' || active.has(value)) fail('INVALID_RECORD', '项目不能包含循环或不可存储的值');
      active.add(value);
      let out;
      if (Array.isArray(value)) {
        if (value.length > 2000000 || Reflect.ownKeys(value).length !== value.length + 1) fail('INVALID_RECORD', '项目列表无效');
        out = [];
        for (let i = 0; i < value.length; i++) {
          const d = Object.getOwnPropertyDescriptor(value, String(i));
          if (!d || !d.enumerable || !own(d, 'value')) fail('INVALID_RECORD', '项目列表不能缺项或含访问器');
          out.push(copy(d.value, path + '.' + i, depth + 1));
        }
      } else {
        if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_RECORD', '项目包含不支持的对象');
        out = {};
        for (const key of Reflect.ownKeys(value)) {
          const d = Object.getOwnPropertyDescriptor(value, key);
          if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || !d.enumerable || !own(d, 'value')) fail('INVALID_RECORD', '项目字段无效');
          stringBytes += utf8Bytes(key);
          out[key] = copy(d.value, path ? path + '.' + key : key, depth + 1);
        }
      }
      active.delete(value); return out;
    }
    const record = copy(input, '', 0);
    if (!record || !blob || ![1, 2].includes(record.version)) fail('INVALID_RECORD', '项目缺少原照片或版本无效');
    const keys = record.version === 2 ? ['version', 'source', 'ops', 'redo'] : ['version', 'blob', 'name', 'ops', 'redo'];
    if (Object.keys(record).some(key => !keys.includes(key)) || (record.version === 2 ? !record.source || record.source.blob !== blob : record.blob !== blob)) fail('INVALID_RECORD', '项目版本与照片来源不一致');
    const json = JSON.stringify(record, (key, value) => nativeBlob(value) ? null : value);
    const bytes = blob.size + utf8Bytes(json);
    if (!Number.isSafeInteger(bytes) || bytes > MAX_RECORD_BYTES) fail('RECORD_TOO_LARGE', '单个项目超过 64 MiB 上限');
    return { record, bytes };
  }
  function defaultId() {
    if (!root.crypto || typeof root.crypto.getRandomValues !== 'function') fail('STORAGE_UNAVAILABLE', '安全随机标识不可用');
    const bytes = new Uint8Array(16); root.crypto.getRandomValues(bytes);
    return 'project-' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function create(options) {
    if (!options || typeof options.validateRecord !== 'function') fail('INVALID_RECORD', '必须提供项目验证器');
    const idb = options.indexedDB, validateRecord = options.validateRecord;
    const now = options.now || Date.now, makeId = options.makeId || defaultId;
    if (typeof now !== 'function' || typeof makeId !== 'function') fail('INVALID_RECORD', '测试时钟或标识生成器无效');
    let connection = null, opening = null, blockedPending = false;
    function prepare(record, canonical) {
      const copied = snapshotInput(record);
      if (!canonical) return copied;
      try { return snapshotInput(validateRecord(copied.record)); }
      catch (e) { if (e && e.code === 'RECORD_TOO_LARGE') throw e; throw error('INVALID_RECORD', '项目内容无效，未覆盖现有数据', e); }
    }
    function timestamp(minimum) {
      const value = now();
      if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_RECORD', '本机时间无效');
      return Math.max(value, minimum || 0);
    }
    function metadata(value, key) {
      try {
        plainFields(value, ['schema', 'id', 'name', 'revision', 'createdAt', 'updatedAt', 'trashedAt', 'bytes'], 'CORRUPT_STORAGE');
        if (value.schema !== 1 || validId(value.id) !== key || normalizeName(value.name) !== value.name) fail('CORRUPT_STORAGE', '项目索引无效');
        revision(value.revision);
        if (![value.createdAt, value.updatedAt].every(x => Number.isSafeInteger(x) && x >= 0) || value.updatedAt < value.createdAt || (value.trashedAt !== null && (!Number.isSafeInteger(value.trashedAt) || value.trashedAt < value.createdAt || value.trashedAt > value.updatedAt)) || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > MAX_RECORD_BYTES) fail('CORRUPT_STORAGE', '项目索引超出安全范围');
        return { ...value };
      } catch (e) { throw error('CORRUPT_STORAGE', '项目索引损坏，已停止写入以保护原数据', e); }
    }
    function close() { if (connection) connection.close(); connection = null; }
    function open() {
      if (connection) return Promise.resolve(connection);
      if (opening) return opening;
      if (blockedPending) return Promise.reject(error('STORAGE_BLOCKED', '旧窗口仍占用项目存储，请关闭后重试'));
      if (!idb || typeof idb.open !== 'function') return Promise.reject(error('STORAGE_UNAVAILABLE', '此环境不能使用本机项目存储'));
      let request, abandoned = false;
      const promise = new Promise((resolve, reject) => {
        try { request = idb.open(DATABASE_NAME, DATABASE_VERSION); }
        catch (e) { reject(error('STORAGE_UNAVAILABLE', '无法打开本机项目存储', e)); return; }
        request.onblocked = () => { abandoned = true; blockedPending = true; reject(error('STORAGE_BLOCKED', '其他窗口正在使用旧版存储，请关闭旧窗口后重试')); };
        request.onupgradeneeded = event => {
          try {
            if (abandoned) { request.transaction.abort(); return; }
            const database = request.result;
            if (event.oldVersion > 1) fail('CORRUPT_STORAGE', '数据库版本异常');
            if (event.oldVersion === 0) database.createObjectStore(STORES.drafts);
            if (!database.objectStoreNames.contains(STORES.drafts)) fail('CORRUPT_STORAGE', '旧版草稿存储缺失');
            database.createObjectStore(STORES.metadata); database.createObjectStore(STORES.snapshots);
          } catch (e) { abandoned = true; try { request.transaction.abort(); } catch (_) {} reject(error('CORRUPT_STORAGE', '无法安全升级项目存储，原数据保留', e)); }
        };
        request.onerror = () => { blockedPending = false; reject(error('STORAGE_UNAVAILABLE', '无法打开本机项目存储', request.error)); };
        request.onsuccess = () => {
          blockedPending = false;
          const database = request.result;
          if (abandoned) { database.close(); return; }
          const all = Object.values(STORES);
          if (database.version !== DATABASE_VERSION || all.some(name => !database.objectStoreNames.contains(name))) { database.close(); reject(error('CORRUPT_STORAGE', '本机项目存储结构损坏')); return; }
          database.onversionchange = () => { database.close(); if (connection === database) connection = null; };
          database.onclose = () => { if (connection === database) connection = null; };
          connection = database; resolve(database);
        };
      });
      opening = promise;
      promise.then(() => { if (opening === promise) opening = null; }, () => { if (opening === promise) opening = null; });
      return promise;
    }
    async function transact(names, mode, body, retried) {
      const database = await open();
      let tx;
      try { tx = database.transaction(names, mode); }
      catch (e) {
        if (!retried && e && e.name === 'InvalidStateError') { if (connection === database) close(); return transact(names, mode, body, true); }
        throw storageError(e);
      }
      return new Promise((resolve, reject) => {
        let result, completed = false, failure = null;
        const abort = e => { if (!failure) failure = storageError(e); try { tx.abort(); } catch (_) { reject(failure); } };
        tx.oncomplete = () => completed ? resolve(result) : reject(error('STORAGE_ABORTED', '本机存储结果不完整'));
        tx.onabort = () => reject(failure || storageError(tx.error));
        tx.onerror = event => { if (!failure) failure = storageError(tx.error || event && event.target && event.target.error); };
        const ctx = {
          store: name => tx.objectStore(name),
          done: value => { result = value; completed = true; },
          fail: abort,
          read(request, callback) {
            request.onerror = () => { if (!failure) failure = storageError(request.error); };
            request.onsuccess = () => { try { callback(request.result); } catch (e) { abort(e); } };
          }
        };
        try {
          for (const name of names) { const s = ctx.store(name); if (s.keyPath !== null || s.autoIncrement !== false) fail('CORRUPT_STORAGE', '项目存储键结构损坏'); }
          body(ctx);
        } catch (e) { abort(e); }
      });
    }
    function index(ctx, callback) {
      const entries = [], keys = new Set(); let parts = 0;
      const finish = () => {
        if (++parts !== 2) return;
        if (entries.length !== keys.size || entries.some(entry => !keys.has(entry.id))) fail('CORRUPT_STORAGE', '项目索引和快照不一致');
        const bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
        if (!Number.isSafeInteger(bytes) || bytes > MAX_TOTAL_BYTES) fail('CORRUPT_STORAGE', '项目总量超出安全上限');
        callback(entries, bytes);
      };
      ctx.read(ctx.store(STORES.metadata).openCursor(), function cursor(value) {
        if (!value) { finish(); return; }
        if (entries.length >= MAX_ENTRIES || entries.some(entry => entry.id === value.key)) fail('CORRUPT_STORAGE', '项目索引数量超限或重复');
        entries.push(metadata(value.value, value.key)); value.continue();
      });
      ctx.read(ctx.store(STORES.snapshots).openKeyCursor(), function cursor(value) {
        if (!value) { finish(); return; }
        try { validId(value.key); } catch (e) { throw error('CORRUPT_STORAGE', '项目快照标识损坏', e); }
        if (keys.size >= MAX_ENTRIES || keys.has(value.key)) fail('CORRUPT_STORAGE', '项目快照数量超限或重复');
        keys.add(value.key); value.continue();
      });
    }
    function readSnapshot(ctx, meta, callback) {
      ctx.read(ctx.store(STORES.snapshots).get(meta.id), raw => {
        let value;
        try {
          plainFields(raw, ['schema', 'id', 'revision', 'record'], 'CORRUPT_STORAGE');
          if (raw.schema !== 1 || raw.id !== meta.id || raw.revision !== meta.revision) fail('CORRUPT_STORAGE', '项目快照版本不一致');
          value = prepare(raw.record, true);
          if (value.bytes !== meta.bytes) fail('CORRUPT_STORAGE', '项目快照大小与索引不一致');
        } catch (e) { throw error('CORRUPT_STORAGE', '项目快照损坏，原数据保持不变', e); }
        callback(value.record);
      });
    }
    function selected(entries, id, expectedRevision) {
      const found = entries.find(entry => entry.id === id);
      if (!found) fail('NOT_FOUND', '项目不存在');
      if (expectedRevision !== undefined && found.revision !== expectedRevision) fail('REVISION_CONFLICT', '项目已在另一窗口更新，请重新打开或另存副本');
      return found;
    }
    function nextRevision(meta) { if (meta.revision === Number.MAX_SAFE_INTEGER) fail('INVALID_REVISION', '项目版本已达到上限'); return meta.revision + 1; }
    function write(ctx, meta, record, add) {
      const operation = add ? 'add' : 'put';
      ctx.store(STORES.metadata)[operation](meta, meta.id);
      ctx.store(STORES.snapshots)[operation]({ schema: 1, id: meta.id, revision: meta.revision, record }, meta.id);
      ctx.done({ ...meta });
    }
    function newMetadata(entries, bytes, name, recordBytes, trash) {
      if (entries.length >= MAX_ENTRIES) fail('COLLECTION_FULL', '本机最多保留 24 个项目，包含回收站');
      if (bytes + recordBytes > MAX_TOTAL_BYTES) fail('COLLECTION_TOO_LARGE', '本机项目总量超过 192 MiB，包含回收站');
      const id = validId(makeId());
      if (entries.some(entry => entry.id === id)) fail('ID_COLLISION', '新项目标识重复，未覆盖现有项目，请重试');
      const time = timestamp();
      return { schema: 1, id, name, revision: 1, createdAt: time, updatedAt: time, trashedAt: trash ? time : null, bytes: recordBytes };
    }
    const libraryStores = [STORES.metadata, STORES.snapshots];
    async function list(options) {
      if (options !== undefined && (!options || typeof options !== 'object' || Object.keys(options).some(key => key !== 'includeTrash') || options.includeTrash !== undefined && typeof options.includeTrash !== 'boolean')) fail('INVALID_RECORD', '项目列表选项无效');
      return transact(libraryStores, 'readonly', ctx => index(ctx, entries => ctx.done(entries.filter(entry => options && options.includeTrash || entry.trashedAt === null).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)))));
    }
    async function usage() { return transact(libraryStores, 'readonly', ctx => index(ctx, (entries, bytes) => ctx.done({ count: entries.length, maxCount: MAX_ENTRIES, bytes, maxBytes: MAX_TOTAL_BYTES, maxRecordBytes: MAX_RECORD_BYTES }))); }
    async function get(id) {
      validId(id);
      return transact(libraryStores, 'readonly', ctx => index(ctx, entries => {
        const meta = entries.find(entry => entry.id === id);
        if (!meta) { ctx.done(null); return; }
        readSnapshot(ctx, meta, record => ctx.done({ metadata: meta, record }));
      }));
    }
    async function save(input) {
      if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['id', 'name', 'record', 'expectedRevision'].includes(key))) fail('INVALID_RECORD', '保存项目参数无效');
      const name = normalizeName(input.name), value = prepare(input.record, true), id = input.id;
      if (id !== undefined) { validId(id); revision(input.expectedRevision); }
      else if (input.expectedRevision !== undefined) fail('INVALID_REVISION', '新项目不能指定旧版本');
      const expectedRevision = input.expectedRevision;
      return transact(libraryStores, 'readwrite', ctx => index(ctx, (entries, bytes) => {
        if (id === undefined) { write(ctx, newMetadata(entries, bytes, name, value.bytes, false), value.record, true); return; }
        const meta = selected(entries, id, expectedRevision);
        if (meta.trashedAt !== null) fail('TRASHED', '请先恢复回收站中的项目');
        if (bytes - meta.bytes + value.bytes > MAX_TOTAL_BYTES) fail('COLLECTION_TOO_LARGE', '本机项目总量超过 192 MiB，包含回收站');
        readSnapshot(ctx, meta, () => write(ctx, { ...meta, name, revision: nextRevision(meta), updatedAt: timestamp(meta.updatedAt), bytes: value.bytes }, value.record, false));
      }));
    }
    async function copy(id, options) {
      validId(id);
      if (!options || typeof options !== 'object' || Object.keys(options).some(key => !['name', 'expectedRevision'].includes(key))) fail('INVALID_RECORD', '复制项目参数无效');
      const name = normalizeName(options.name), expectedRevision = revision(options.expectedRevision);
      return transact(libraryStores, 'readwrite', ctx => index(ctx, (entries, bytes) => {
        const meta = selected(entries, id, expectedRevision);
        if (meta.trashedAt !== null) fail('TRASHED', '请先恢复回收站中的项目');
        readSnapshot(ctx, meta, record => write(ctx, newMetadata(entries, bytes, name, meta.bytes, false), record, true));
      }));
    }
    async function transition(id, expectedRevision, trash) {
      validId(id); revision(expectedRevision);
      return transact(libraryStores, 'readwrite', ctx => index(ctx, entries => {
        const meta = selected(entries, id, expectedRevision);
        if (trash && meta.trashedAt !== null) fail('TRASHED', '项目已在回收站');
        if (!trash && meta.trashedAt === null) fail('NOT_TRASHED', '项目不在回收站');
        readSnapshot(ctx, meta, record => { const time = timestamp(meta.updatedAt); write(ctx, { ...meta, revision: nextRevision(meta), updatedAt: time, trashedAt: trash ? time : null }, record, false); });
      }));
    }
    // Destructive operations accept the exact revisions the user confirmed.
    // Both stores are removed atomically; the current autosave is never touched.
    async function purge(id, expectedRevision) {
      validId(id); revision(expectedRevision);
      return transact(libraryStores, 'readwrite', ctx => index(ctx, entries => {
        const meta = selected(entries, id, expectedRevision);
        if (meta.trashedAt === null) fail('NOT_TRASHED', '仅能永久删除回收站中的项目');
        ctx.store(STORES.metadata).delete(meta.id);
        ctx.store(STORES.snapshots).delete(meta.id);
        ctx.done({ deleted: [meta.id], bytes: meta.bytes });
      }));
    }
    async function emptyTrash(expectedItems) {
      if (!Array.isArray(expectedItems) || expectedItems.length > MAX_ENTRIES) fail('INVALID_RECORD', '需要已确认的回收站列表');
      const expected = new Map();
      for (const item of expectedItems) {
        plainFields(item, ['id', 'revision'], 'INVALID_RECORD');
        validId(item.id); revision(item.revision);
        if (expected.has(item.id)) fail('INVALID_RECORD', '回收站列表包含重复项目');
        expected.set(item.id, item.revision);
      }
      return transact(libraryStores, 'readwrite', ctx => index(ctx, entries => {
        const trash = entries.filter(meta => meta.trashedAt !== null);
        if (trash.length !== expected.size || trash.some(meta => expected.get(meta.id) !== meta.revision)) fail('REVISION_CONFLICT', '回收站已变化，请刷新并重新确认');
        for (const meta of trash) {
          ctx.store(STORES.metadata).delete(meta.id);
          ctx.store(STORES.snapshots).delete(meta.id);
        }
        ctx.done({ deleted: trash.map(meta => meta.id), bytes: trash.reduce((sum, meta) => sum + meta.bytes, 0) });
      }));
    }
    async function readDraft() {
      return transact([STORES.drafts], 'readonly', ctx => ctx.read(ctx.store(STORES.drafts).get('current'), record => ctx.done(record === undefined ? null : prepare(record, false).record)));
    }
    async function writeDraft(record) {
      if (record === null || record === undefined) fail('USE_ARCHIVE', '请先将草稿安全移入回收站，不能直接删除');
      const value = prepare(record, false);
      // Validate content but preserve the exact draft shape written by the caller.
      prepare(value.record, true);
      return transact([STORES.drafts], 'readwrite', ctx => { ctx.store(STORES.drafts).put(value.record, 'current'); ctx.done(); });
    }
    async function replaceDraft(record, options) {
      if (!options || typeof options !== 'object' || Object.keys(options).some(key => key !== 'archiveName') || !own(options, 'archiveName')) fail('INVALID_RECORD', '替换草稿参数无效');
      const archiveName = options.archiveName === null ? null : normalizeName(options.archiveName);
      const value = prepare(record, false); prepare(value.record, true);
      return transact([...libraryStores, STORES.drafts], 'readwrite', ctx => index(ctx, (entries, bytes) => {
        const replace = archived => { ctx.store(STORES.drafts).put(value.record, 'current'); ctx.done({ archived }); };
        if (archiveName === null) { replace(null); return; }
        ctx.read(ctx.store(STORES.drafts).get('current'), old => {
          if (old === undefined) { replace(null); return; }
          const previous = prepare(old, true), meta = newMetadata(entries, bytes, archiveName, previous.bytes, true);
          write(ctx, meta, previous.record, true); replace(meta);
        });
      }));
    }
    async function archiveDraftToTrash(name) {
      name = normalizeName(name);
      return transact([...libraryStores, STORES.drafts], 'readwrite', ctx => index(ctx, (entries, bytes) => ctx.read(ctx.store(STORES.drafts).get('current'), record => {
        if (record === undefined) { ctx.done(null); return; }
        const value = prepare(record, true), meta = newMetadata(entries, bytes, name, value.bytes, true);
        write(ctx, meta, value.record, true);
        ctx.store(STORES.drafts).delete('current');
      })));
    }
    return Object.freeze({ list, usage, get, save, copy, trash: (id, expectedRevision) => transition(id, expectedRevision, true), restore: (id, expectedRevision) => transition(id, expectedRevision, false), purge, emptyTrash, readDraft, writeDraft, replaceDraft, archiveDraftToTrash, close });
  }
  return Object.freeze({ create, normalizeName, DATABASE_NAME, DATABASE_VERSION, STORES, MAX_ENTRIES, MAX_RECORD_BYTES, MAX_TOTAL_BYTES, MAX_NAME_LENGTH, MAX_NAME_BYTES });
});
