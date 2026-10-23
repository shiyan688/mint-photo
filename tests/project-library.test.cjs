'use strict';
// FAULT-INJECTED ADAPTER TESTS, NOT native IndexedDB/browser/WebView durability.
// This controlled adapter models request ordering, serialized transactions,
// structured-clone snapshots, abort rollback, delayed commit, open/upgrade faults.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const Library = require('../app/src/main/assets/project-library.js');
const Core = require('../app/src/main/assets/project-core.js');
const S = Library.STORES, tick = () => new Promise(setImmediate);
const id = n => 'project-' + n.toString(16).padStart(32, '0');
const copy = value => structuredClone(value);
function namedError(name) { const e = new Error('Injected ' + name); e.name = name; return e; }
function adapter({ version = 0, draft } = {}) {
  let stores = new Map(version ? [[S.drafts, new Map(draft === undefined ? [] : [['current', copy(draft)]])]] : []);
  const state = {
    version, connections: [], logs: [], failOpen: 0, blockOpen: false, blocked: [], failAtWrite: 0,
    failCommit: false, deferCommit: false, commits: [], nextError: 'QuotaExceededError', queue: [], active: null,
    raw: () => stores,
    releaseBlocked() { state.blockOpen = false; for (const resume of state.blocked.splice(0)) setImmediate(resume); },
    releaseCommits() { state.deferCommit = false; for (const finish of state.commits.splice(0)) finish(); }
  };
  function transaction(names, mode, database) {
    if (database.closed) throw namedError('InvalidStateError');
    if (names.some(name => !stores.has(name))) throw namedError('NotFoundError');
    let local, ready = false, ended = false, running = false, queue = [], writes = 0;
    const tx = {
      error: null,
      abort() { if (ended) throw namedError('InvalidStateError'); abort(namedError('AbortError')); },
      objectStore(name) {
        if (!names.includes(name)) throw namedError('NotFoundError');
        const store = { keyPath: null, autoIncrement: false };
        function enqueue(operation, key, run) {
          if (ended) throw namedError('TransactionInactiveError');
          const request = {}; state.logs.push({ operation, store: name, key });
          queue.push(() => {
            try { request.result = run(); request.onsuccess?.({ target: request }); }
            catch (e) { request.error = e; request.onerror?.({ target: request }); tx.onerror?.({ target: request }); abort(e); }
          });
          drain(); return request;
        }
        store.get = key => enqueue('get', key, () => copy(local.get(name).get(key)));
        function put(value, key, add) {
          const captured = copy(value);
          return enqueue(add ? 'add' : 'put', key, () => {
            if (mode !== 'readwrite') throw namedError('ReadOnlyError');
            if (++writes === state.failAtWrite) { state.failAtWrite = 0; throw namedError(state.nextError); }
            if (add && local.get(name).has(key)) throw namedError('ConstraintError');
            local.get(name).set(key, captured); return key;
          });
        }
        store.put = (value, key) => put(value, key, false);
        store.add = (value, key) => put(value, key, true);
        store.delete = key => enqueue('delete', key, () => {
          if (++writes === state.failAtWrite) { state.failAtWrite = 0; throw namedError(state.nextError); }
          local.get(name).delete(key);
        });
        function cursor(keysOnly) {
          const request = {}, operation = keysOnly ? 'openKeyCursor' : 'openCursor';
          let keys, index = 0;
          state.logs.push({ operation, store: name });
          const step = () => {
            try {
              if (!keys) keys = [...local.get(name).keys()].sort();
              if (index === keys.length) request.result = null;
              else {
                const key = keys[index++];
                request.result = { key, primaryKey: key, continue() { queue.push(step); drain(); } };
                if (!keysOnly) request.result.value = copy(local.get(name).get(key));
              }
              request.onsuccess?.({ target: request });
            } catch (e) { request.error = e; request.onerror?.({ target: request }); tx.onerror?.({ target: request }); abort(e); }
          };
          queue.push(step); drain(); return request;
        }
        store.openCursor = () => cursor(false); store.openKeyCursor = () => cursor(true);
        return store;
      }
    };
    function end() {
      // Reserve a queued transaction before returning to promise continuations.
      // Otherwise a new transaction can start alongside the scheduled queue head.
      const next = state.queue.shift();
      state.active = next ? true : null;
      if (next) setImmediate(next);
    }
    function abort(e) {
      if (ended) return; ended = true; tx.error = e;
      setImmediate(() => { tx.onabort?.({ target: tx }); end(); });
    }
    function finish() {
      if (ended) return;
      if (state.failCommit) { state.failCommit = false; abort(namedError(state.nextError)); return; }
      ended = true;
      if (mode === 'readwrite') for (const name of names) stores.set(name, local.get(name));
      tx.oncomplete?.({ target: tx }); end();
    }
    function drain() {
      if (!ready || running || ended) return;
      running = true;
      setImmediate(() => {
        running = false; if (ended) return;
        if (queue.length) { queue.shift()(); drain(); }
        else if (state.deferCommit && mode === 'readwrite') state.commits.push(finish);
        else finish();
      });
    }
    const start = () => { state.active = tx; local = new Map(names.map(name => [name, new Map([...stores.get(name)].map(([key, value]) => [key, copy(value)]))])); ready = true; drain(); };
    if (state.active) state.queue.push(start); else { state.active = tx; setImmediate(start); }
    return tx;
  }
  const indexedDB = { open(name, requestedVersion) {
    assert.equal(name, Library.DATABASE_NAME); assert.equal(requestedVersion, 2);
    const request = {};
    function attempt() {
      if (state.failOpen) { state.failOpen--; request.error = namedError('SecurityError'); request.onerror?.(); return; }
      if (state.blockOpen) { state.blocked.push(attempt); request.onblocked?.(); return; }
      let pending = new Map([...stores].map(([name, values]) => [name, new Map(values)]));
      let upgradeAborted = false;
      const database = {
        version: requestedVersion, closed: false,
        objectStoreNames: { contains: name => pending.has(name) },
        createObjectStore(name) { if (pending.has(name)) throw namedError('ConstraintError'); pending.set(name, new Map()); },
        transaction: (names, mode) => transaction(Array.isArray(names) ? names : [names], mode, database),
        close() { database.closed = true; }
      };
      request.result = database;
      if (state.version < requestedVersion) {
        request.transaction = { abort() { upgradeAborted = true; } };
        request.onupgradeneeded?.({ oldVersion: state.version });
        if (upgradeAborted) { request.error = namedError('AbortError'); request.onerror?.(); return; }
        stores = pending; state.version = requestedVersion;
      }
      state.connections.push(database); request.onsuccess?.();
    }
    setImmediate(attempt); return request;
  } };
  return { indexedDB, state };
}
function validate(record) {
  if (record.version === 1) {
    Core.restoreProject(record, { width: 1, height: 1 });
    return { version: 1, blob: record.blob, name: record.name || '照片', ops: record.ops || [], redo: record.redo || [] };
  }
  return Core.draftRecord(record);
}
function record(name = 'photo.png', body = 'original photograph bytes') {
  return Core.makeProject({ blob: new Blob([body], { type: 'image/png' }), name, width: 64, height: 48, origin: 'original' }, [{ type: 'rotate' }], [{ type: 'flip', axis: 'x' }]);
}
function fixture(options = {}) {
  const backend = adapter(options); let counter = 0, time = 1000;
  const store = Library.create({ indexedDB: backend.indexedDB, validateRecord: options.validator || validate, makeId: options.makeId || (() => id(++counter)), now: () => ++time });
  return { ...backend, store };
}
async function rejects(action, code) { await assert.rejects(action, e => { assert.equal(e.code, code, e.stack); return true; }); }
async function until(predicate) { for (let i = 0; i < 100; i++) { if (predicate()) return; await tick(); } throw Error('adapter deadline exceeded'); }

test('UMD loads without DOM, I/O, or ambient storage and exports immutable limits', () => {
  const context = vm.createContext({}); vm.runInContext(fs.readFileSync(require.resolve('../app/src/main/assets/project-library.js'), 'utf8'), context);
  assert.deepEqual(Object.keys(context), ['MintProjectLibrary']);
  assert.equal(Library.DATABASE_VERSION, 2); assert.equal(Library.MAX_ENTRIES, 24); assert(Object.isFrozen(Library));
  assert.throws(() => Library.create({}), /验证器/);
});
test('v1 database upgrade preserves current draft exactly and adds separate stores', async () => {
  const old = record(), h = fixture({ version: 1, draft: old });
  assert.deepEqual(await h.store.readDraft(), old); assert.equal(h.state.version, 2);
  assert.deepEqual([...h.state.raw().keys()].sort(), Object.values(S).sort());
  assert.deepEqual(await h.store.list(), []);
});
test('save/get/overwrite/copy round trip immutable original, ops and redo independently', async () => {
  const h = fixture(), input = record(), expected = copy(input);
  const pending = h.store.save({ name: '  草稿 A  ', record: input }); input.ops[0].type = 'unsupported'; input.source.name = 'mutated';
  const a = await pending; assert.equal(a.name, '草稿 A'); assert.equal(a.revision, 1);
  const loaded = await h.store.get(a.id); assert.deepEqual(loaded.record, expected);
  assert.equal(await loaded.record.source.blob.text(), 'original photograph bytes');
  loaded.record.redo.length = 0; loaded.metadata.name = 'external';
  const b = await h.store.copy(a.id, { name: '虚拟副本', expectedRevision: 1 });
  assert.notEqual(a.id, b.id); assert.equal(b.revision, 1);
  assert.deepEqual((await h.store.get(b.id)).record, expected);
  const next = record('other.png'); next.ops = [{ type: 'flip', axis: 'y' }];
  const a2 = await h.store.save({ id: a.id, expectedRevision: 1, name: 'A2', record: next });
  assert.equal(a2.revision, 2); assert.equal(a2.createdAt, a.createdAt);
  assert.equal((await h.store.get(b.id)).record.ops[0].type, 'rotate');
  assert.equal((await h.store.get(a.id)).record.ops[0].axis, 'y');
});
test('list and usage read metadata and snapshot keys only, never photo values', async () => {
  const h = fixture(); const a = await h.store.save({ name: 'A', record: record() });
  h.state.logs.length = 0; assert.equal((await h.store.list())[0].id, a.id);
  const usage = await h.store.usage(); assert.equal(usage.count, 1); assert.equal(usage.bytes, a.bytes);
  assert.equal(usage.maxBytes, 192 * 1024 * 1024); assert.equal(usage.maxCount, 24);
  assert(!h.state.logs.some(log => log.store === S.snapshots && log.operation !== 'openKeyCursor'));
});
test('trash is recoverable, counts toward quota and disallows accidental overwrite/copy', async () => {
  const h = fixture(), a = await h.store.save({ name: 'A', record: record() });
  const trashed = await h.store.trash(a.id, 1);
  assert.equal(trashed.revision, 2); assert.equal(trashed.trashedAt, trashed.updatedAt);
  assert.equal((await h.store.list()).length, 0); assert.equal((await h.store.list({ includeTrash: true })).length, 1);
  assert.equal((await h.store.usage()).bytes, a.bytes);
  await rejects(h.store.save({ id: a.id, expectedRevision: 2, name: 'X', record: record() }), 'TRASHED');
  await rejects(h.store.copy(a.id, { expectedRevision: 2, name: 'X' }), 'TRASHED');
  await rejects(h.store.trash(a.id, 2), 'TRASHED');
  assert.equal((await h.store.get(a.id)).record.source.name, 'photo.png');
  const restored = await h.store.restore(a.id, 2); assert.equal(restored.revision, 3); assert.equal(restored.trashedAt, null);
  await rejects(h.store.restore(a.id, 3), 'NOT_TRASHED');
  await rejects(h.store.purge(a.id, 3), 'NOT_TRASHED'); assert.equal(h.store.delete, undefined);
});
test('all stale updates/copies/trash/restores fail and concurrent tabs cannot lose writes', async () => {
  const h = fixture(), a = await h.store.save({ name: 'A', record: record() });
  const other = Library.create({ indexedDB: h.indexedDB, validateRecord: validate, makeId: () => id(90), now: () => 2000 });
  const outcomes = await Promise.allSettled([
    h.store.save({ id: a.id, name: 'First', expectedRevision: 1, record: record() }),
    other.save({ id: a.id, name: 'Second', expectedRevision: 1, record: record() })
  ]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(x => x.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  await rejects(h.store.copy(a.id, { name: 'X', expectedRevision: 1 }), 'REVISION_CONFLICT');
  await rejects(h.store.trash(a.id, 1), 'REVISION_CONFLICT');
  const trashed = await h.store.trash(a.id, 2); await rejects(h.store.restore(a.id, 2), 'REVISION_CONFLICT');
  assert.equal(trashed.revision, 3);
});
test('explicit IDs never implicitly create or overwrite; generated collisions do not overwrite', async () => {
  const h = fixture({ makeId: () => id(1) }); const a = await h.store.save({ name: 'A', record: record() });
  await rejects(h.store.save({ id: a.id, name: 'X', record: record() }), 'INVALID_REVISION');
  await rejects(h.store.save({ id: id(2), expectedRevision: 1, name: 'X', record: record() }), 'NOT_FOUND');
  await rejects(h.store.save({ name: 'X', record: record() }), 'ID_COLLISION');
  await rejects(h.store.copy(a.id, { name: 'Y', expectedRevision: 1 }), 'ID_COLLISION');
  assert.equal((await h.store.get(a.id)).metadata.name, 'A');
});
test('reject malformed names, IDs, revisions and accessors before any put', async () => {
  const h = fixture();
  for (const name of ['', '   ', 'x'.repeat(81), '\u202eevil', 'a\u0000b', {}, 7]) await rejects(h.store.save({ name, record: record() }), 'INVALID_NAME');
  assert.equal(Library.normalizeName('e\u0301'), 'é'); assert.equal(Library.normalizeName('😀'.repeat(80)).length, 160);
  for (const bad of ['__proto__', '', 'PROJECT-' + '0'.repeat(32), null, 8]) await rejects(h.store.get(bad), 'INVALID_ID');
  await rejects(h.store.save({ name: 'X', expectedRevision: 1, record: record() }), 'INVALID_REVISION');
  const input = record(); Object.defineProperty(input, 'ops', { get() { throw Error('getter must not execute'); }, enumerable: true });
  await rejects(h.store.save({ name: 'X', record: input }), 'INVALID_RECORD');
  assert(!h.state.logs.some(log => ['put', 'add'].includes(log.operation)));
});
test('corrupt, cyclic, unknown future and unsupported records never write', async () => {
  const h = fixture(), bad = record(); bad.self = bad;
  for (const input of [bad, { ...record(), version: 9 }, { ...record(), ops: [{ type: 'secret-operation' }] }, { ...record(), extra: 'ignored?' }, { ...record(), source: { width: 1 } }]) await rejects(h.store.save({ name: 'X', record: input }), 'INVALID_RECORD');
  assert(!h.state.logs.some(log => ['put', 'add'].includes(log.operation)));
});
test('24 entries INCLUDING trash bound allocation before writes; no automatic eviction', async () => {
  const h = fixture(); let first;
  for (let i = 0; i < 24; i++) { const entry = await h.store.save({ name: 'same allowed name', record: record() }); first ||= entry; }
  await h.store.trash(first.id, 1);
  await rejects(h.store.save({ name: 'overflow', record: record() }), 'COLLECTION_FULL');
  await rejects(h.store.copy(id(2), { name: 'overflow', expectedRevision: 1 }), 'COLLECTION_FULL');
  assert.equal((await h.store.usage()).count, 24); assert.equal((await h.store.list()).length, 23);
  assert.equal((await h.store.get(first.id)).metadata.trashedAt !== null, true);
});
test('64 MiB per record and 192 MiB total logical bytes are enforced including trash', async () => {
  // Schema-neutral validator ONLY for artificial byte-boundary tests; not ProjectCore coverage.
  const h = fixture({ validator: value => value }), unit = new Uint8Array(1024 * 1024);
  const big = size => ({ version: 2, source: { blob: new Blob(Array(64).fill(unit)).slice(0, size) }, ops: [], redo: [] });
  await rejects(h.store.save({ name: 'too large', record: big(Library.MAX_RECORD_BYTES) }), 'RECORD_TOO_LARGE');
  const value = big(Library.MAX_RECORD_BYTES - 80);
  const entries = [];
  for (let i = 0; i < 3; i++) entries.push(await h.store.save({ name: 'Big ' + i, record: value }));
  await h.store.trash(entries[0].id, 1);
  await rejects(h.store.save({ name: 'overflow', record: record() }), 'COLLECTION_TOO_LARGE');
  assert.equal((await h.store.usage()).count, 3);
});
test('UTF-8 recipe accounting includes embedded data and name bytes, not Blob JSON placeholders', async () => {
  const h = fixture({ validator: value => value }), input = record('薄荷.png'); input.ops = [{ asset: { data: '汉字🙂' } }];
  const a = await h.store.save({ name: '名字', record: input });
  const json = JSON.stringify(input, (key, value) => value instanceof Blob ? null : value);
  assert.equal(a.bytes, input.source.blob.size + Buffer.byteLength(json, 'utf8'));
});
test('save waits for transaction commit, not successful add requests', async () => {
  const h = fixture(); await h.store.list(); h.state.deferCommit = true;
  let settled = false; const pending = h.store.save({ name: 'A', record: record() }).then(value => { settled = true; return value; });
  await until(() => h.state.commits.length === 1); assert.equal(settled, false);
  assert.equal(h.state.raw().get(S.metadata).size, 0);
  h.state.releaseCommits(); const a = await pending; assert.equal(settled, true); assert.equal(h.state.raw().get(S.metadata).get(a.id).name, 'A');
});
test('quota failure between metadata and snapshot writes rolls back old entry entirely', async () => {
  const h = fixture(), a = await h.store.save({ name: 'A', record: record() });
  const before = await h.store.get(a.id); h.state.failAtWrite = 2;
  await rejects(h.store.save({ id: a.id, expectedRevision: 1, name: 'new', record: record('new.png') }), 'STORAGE_QUOTA');
  assert.deepEqual(await h.store.get(a.id), before);
  const next = await h.store.save({ id: a.id, expectedRevision: 1, name: 'retry', record: record() }); assert.equal(next.revision, 2);
});
test('transaction abort after all requests still rejects and preserves existing project', async () => {
  const h = fixture(), a = await h.store.save({ name: 'A', record: record() });
  const before = await h.store.get(a.id); h.state.failCommit = true; h.state.nextError = 'AbortError';
  await rejects(h.store.trash(a.id, 1), 'STORAGE_ABORTED'); assert.deepEqual(await h.store.get(a.id), before);
});
test('new entry quota failure leaves neither orphan metadata nor orphan snapshot', async () => {
  const h = fixture(); h.state.failAtWrite = 2;
  await rejects(h.store.save({ name: 'A', record: record() }), 'STORAGE_QUOTA');
  assert.deepEqual(await h.store.list(), []); assert.equal(h.state.raw().get(S.snapshots).size, 0);
});
test('failed opens are retriable and blocked abandoned upgrades cannot modify v1 data', async () => {
  const h = fixture({ version: 1, draft: record() }); h.state.failOpen = 1;
  await rejects(h.store.list(), 'STORAGE_UNAVAILABLE'); assert.deepEqual(await h.store.list(), []);
  const blocked = fixture({ version: 1, draft: record() }); blocked.state.blockOpen = true;
  await rejects(blocked.store.list(), 'STORAGE_BLOCKED');
  await rejects(blocked.store.list(), 'STORAGE_BLOCKED'); assert.equal(blocked.state.blocked.length, 1);
  blocked.state.releaseBlocked(); await tick(); await tick();
  assert.equal(blocked.state.version, 1); assert.equal(blocked.state.raw().get(S.drafts).size, 1);
  assert.deepEqual(await blocked.store.list(), []); assert.equal(blocked.state.version, 2);
});
test('versionchange closes the old connection and later calls reopen cleanly', async () => {
  const h = fixture(); await h.store.list(); const old = h.state.connections[0];
  old.onversionchange(); assert.equal(old.closed, true);
  assert.deepEqual(await h.store.list(), []); assert.equal(h.state.connections.length, 2);
  h.store.close(); assert.equal(h.state.connections[1].closed, true); await h.store.list(); assert.equal(h.state.connections.length, 3);
});
test('connection closed just before transaction creation retries once without repeating writes', async () => {
  const h = fixture(); await h.store.list(); h.state.connections[0].closed = true;
  const a = await h.store.save({ name: 'A', record: record() }); assert.equal(a.revision, 1);
  assert.equal(h.state.logs.filter(x => x.operation === 'add' && x.store === S.metadata).length, 1);
});
test('structurally corrupt metadata, orphan keys, excess entries and byte mismatches fail closed', async () => {
  for (const corrupt of [
    (h, a) => { h.state.raw().get(S.metadata).get(a.id).bytes = -1; },
    (h, a) => { h.state.raw().get(S.metadata).get(a.id).name = '  trimmed?'; },
    (h, a) => { h.state.raw().get(S.snapshots).delete(a.id); },
    (h, a) => { h.state.raw().get(S.metadata).get(a.id).extra = true; }
  ]) {
    const h = fixture(), a = await h.store.save({ name: 'A', record: record() }); corrupt(h, a);
    await rejects(h.store.list(), 'CORRUPT_STORAGE'); await rejects(h.store.save({ name: 'B', record: record() }), 'CORRUPT_STORAGE');
  }
  const h = fixture(), a = await h.store.save({ name: 'A', record: record() }); h.state.raw().get(S.metadata).get(a.id).bytes++;
  await rejects(h.store.get(a.id), 'CORRUPT_STORAGE'); await rejects(h.store.save({ id: a.id, expectedRevision: 1, name: 'B', record: record() }), 'CORRUPT_STORAGE');
});
test('corrupt snapshot revision/schema/content is not overwritten or silently repaired', async () => {
  for (const corrupt of [raw => raw.revision++, raw => raw.schema = 7, raw => raw.record.ops = [{ type: 'future-operation' }]]) {
    const h = fixture(), a = await h.store.save({ name: 'A', record: record() }); corrupt(h.state.raw().get(S.snapshots).get(a.id));
    const before = copy(h.state.raw().get(S.snapshots).get(a.id));
    await rejects(h.store.get(a.id), 'CORRUPT_STORAGE'); await rejects(h.store.trash(a.id, 1), 'CORRUPT_STORAGE');
    assert.deepEqual(h.state.raw().get(S.snapshots).get(a.id), before);
  }
});
test('draft reads/writes preserve exact v2 record and do not swallow storage errors', async () => {
  const h = fixture(); assert.equal(await h.store.readDraft(), null);
  const input = record(); await h.store.writeDraft(input); assert.deepEqual(await h.store.readDraft(), input);
  h.state.failAtWrite = 1; await rejects(h.store.writeDraft(record('new.png')), 'STORAGE_QUOTA'); assert.deepEqual(await h.store.readDraft(), input);
  await rejects(h.store.writeDraft(null), 'USE_ARCHIVE'); assert.deepEqual(await h.store.readDraft(), input);
});
test('archive authoritative latest draft and remove current in the same commit only', async () => {
  const h = fixture(); await h.store.writeDraft(record('older.png')); await h.store.writeDraft(record('latest.png'));
  const meta = await h.store.archiveDraftToTrash('离开前的草稿'); assert.notEqual(meta.trashedAt, null);
  assert.equal(await h.store.readDraft(), null); assert.equal((await h.store.get(meta.id)).record.source.name, 'latest.png');
  assert.equal(await h.store.archiveDraftToTrash('nothing'), null);
});
test('archive quota failures including draft delete roll back current plus new entry', async () => {
  for (const failAt of [1, 2, 3]) {
    const h = fixture(), old = record('keep.png'); await h.store.writeDraft(old); h.state.failAtWrite = failAt;
    await rejects(h.store.archiveDraftToTrash('archive'), 'STORAGE_QUOTA');
    assert.deepEqual(await h.store.readDraft(), old); assert.deepEqual(await h.store.list({ includeTrash: true }), []);
  }
});
test('replaceDraft atomically archives current and writes new; all failure points roll back', async () => {
  for (const failAt of [1, 2, 3]) {
    const h = fixture(), old = record('old.png'); await h.store.writeDraft(old); h.state.failAtWrite = failAt;
    await rejects(h.store.replaceDraft(record('new.png'), { archiveName: 'old recovery' }), 'STORAGE_QUOTA');
    assert.deepEqual(await h.store.readDraft(), old); assert.equal((await h.store.usage()).count, 0);
  }
  const h = fixture(); await h.store.writeDraft(record('old.png'));
  const result = await h.store.replaceDraft(record('new.png'), { archiveName: 'old recovery' });
  assert.equal((await h.store.readDraft()).source.name, 'new.png');
  assert.equal((await h.store.get(result.archived.id)).record.source.name, 'old.png');
  assert.notEqual(result.archived.trashedAt, null);
});
test('replaceDraft handles missing current/null archive and failed incoming validation safely', async () => {
  const h = fixture(); const initial = await h.store.replaceDraft(record(), { archiveName: 'missing' }); assert.equal(initial.archived, null);
  await rejects(h.store.replaceDraft({ ...record(), ops: [{ type: 'future' }] }, { archiveName: 'old' }), 'INVALID_RECORD');
  assert.equal((await h.store.readDraft()).source.name, 'photo.png'); assert.equal((await h.store.usage()).count, 0);
  assert.deepEqual(await h.store.replaceDraft(record('new.png'), { archiveName: null }), { archived: null });
  assert.equal((await h.store.readDraft()).source.name, 'new.png'); assert.equal((await h.store.usage()).count, 0);
});
test('legacy v1 raw drafts archive without falsely upgrading source dimensions', async () => {
  const old = { version: 1, blob: new Blob(['legacy working pixels'], { type: 'image/png' }), name: 'legacy.png', ops: [{ type: 'rotate' }], redo: [] };
  const h = fixture({ version: 1, draft: old }); assert.deepEqual(await h.store.readDraft(), old);
  const meta = await h.store.archiveDraftToTrash('旧版草稿'); const loaded = await h.store.get(meta.id);
  assert.equal(loaded.record.version, 1); assert.equal(loaded.record.source, undefined); assert.deepEqual(loaded.record, old);
  assert.equal(await h.store.readDraft(), null);
});
test('full library or invalid old draft blocks replacement rather than discarding recovery', async () => {
  const h = fixture(); for (let i = 0; i < 24; i++) await h.store.save({ name: 'P' + i, record: record() });
  const old = record('old.png'); await h.store.writeDraft(old);
  await rejects(h.store.replaceDraft(record('new.png'), { archiveName: 'recovery' }), 'COLLECTION_FULL'); assert.deepEqual(await h.store.readDraft(), old);
  const bad = fixture({ version: 1, draft: { ...record(), ops: [{ type: 'future' }] } });
  await rejects(bad.store.archiveDraftToTrash('invalid'), 'INVALID_RECORD'); assert.equal(bad.state.raw().get(S.drafts).has('current'), true);
});
test('metadata indexes are bounded at the 25th cursor and reject duplicate/key mismatch', async () => {
  const h = fixture(), first = await h.store.save({ name: 'A', record: record() });
  const rawMeta = h.state.raw().get(S.metadata), rawSnapshots = h.state.raw().get(S.snapshots);
  for (let n = 2; n <= 25; n++) {
    rawMeta.set(id(n), { ...first, id: id(n) });
    rawSnapshots.set(id(n), { ...copy(rawSnapshots.get(first.id)), id: id(n) });
  }
  await rejects(h.store.list(), 'CORRUPT_STORAGE');
  const mismatch = fixture(), a = await mismatch.store.save({ name: 'A', record: record() });
  mismatch.state.raw().get(S.metadata).get(a.id).id = id(2);
  await rejects(mismatch.store.usage(), 'CORRUPT_STORAGE');
});
test('snapshot accessor impostors and extra Blobs are rejected without executing their getters', async () => {
  const h = fixture(); let accessed = false;
  const input = record(); input.ops = [{ type: 'rotate', get hidden() { accessed = true; throw Error('must not invoke'); } }];
  await rejects(h.store.save({ name: 'X', record: input }), 'INVALID_RECORD'); assert.equal(accessed, false);
  const another = record(); another.ops = [{ blob: new Blob(['hidden']) }];
  await rejects(h.store.save({ name: 'X', record: another }), 'INVALID_RECORD');
  await rejects(h.store.save({ name: '\ud800', record: record() }), 'INVALID_NAME');
  await rejects(h.store.save({ name: 'line\u2028separator', record: record() }), 'INVALID_NAME');
});
test('sparse arrays, exotic prototypes and excessive nesting fail before storage access', async () => {
  const h = fixture({ validator: value => value });
  const sparse = record(); sparse.ops = new Array(5);
  const exotic = record(); exotic.ops = [new Date()];
  const deep = record(); let at = deep; for (let i = 0; i < 70; i++) { at.extra = {}; at = at.extra; }
  for (const input of [sparse, exotic, deep]) await rejects(h.store.save({ name: 'X', record: input }), 'INVALID_RECORD');
  assert.equal(h.state.logs.length, 0);
});
test('invalid IDs generated by test hook fail before add and do not fall back to insecure randomness', async () => {
  const h = fixture({ makeId: () => 'random-ish' });
  await rejects(h.store.save({ name: 'X', record: record() }), 'INVALID_ID');
  assert.equal((await h.store.usage()).count, 0);
});
test('lower clock never moves metadata backwards and revision exhaustion preserves the project', async () => {
  const h = fixture(), a = await h.store.save({ name: 'A', record: record() });
  const other = Library.create({ indexedDB: h.indexedDB, validateRecord: validate, now: () => 1, makeId: () => id(99) });
  const changed = await other.save({ id: a.id, expectedRevision: 1, name: 'B', record: record() });
  assert.equal(changed.updatedAt, a.updatedAt);
  const rawMeta = h.state.raw().get(S.metadata).get(a.id), rawSnapshot = h.state.raw().get(S.snapshots).get(a.id);
  rawMeta.revision = rawSnapshot.revision = Number.MAX_SAFE_INTEGER;
  await rejects(h.store.trash(a.id, Number.MAX_SAFE_INTEGER), 'INVALID_REVISION');
  assert.equal(rawMeta.trashedAt, null);
});
test('storage absence and corrupt v2 store schema fail rather than creating new empty data', async () => {
  const unavailable = Library.create({ validateRecord: validate }); await rejects(unavailable.list(), 'STORAGE_UNAVAILABLE');
  const h = fixture({ version: 2, draft: record() });
  await rejects(h.store.list(), 'CORRUPT_STORAGE'); assert.equal(h.state.raw().size, 1);
});
test('draft replacement without archive still rolls back on new-draft commit failure', async () => {
  const h = fixture(), old = record('old.png'); await h.store.writeDraft(old); h.state.failCommit = true;
  await rejects(h.store.replaceDraft(record('new.png'), { archiveName: null }), 'STORAGE_QUOTA');
  assert.deepEqual(await h.store.readDraft(), old);
});

test('purge removes exactly one trash snapshot and frees capacity without touching current draft', async () => {
  const h = fixture(), a = await h.store.save({name:'A',record:record('old.png')}), b = await h.store.save({name:'B',record:record('keep.png')});
  const draft = record('current.png'); await h.store.writeDraft(draft); await h.store.trash(a.id,1);
  const result = await h.store.purge(a.id,2); assert.deepEqual(result,{deleted:[a.id],bytes:a.bytes});
  assert.equal(await h.store.get(a.id),null); assert.equal((await h.store.get(b.id)).record.source.name,'keep.png');
  assert.deepEqual(await h.store.readDraft(),draft); assert.equal((await h.store.usage()).count,1); assert.equal((await h.store.usage()).bytes,b.bytes);
});

test('purge and emptyTrash reject stale or restored records before deletion', async () => {
  const h=fixture(), a=await h.store.save({name:'A',record:record()}); await h.store.trash(a.id,1);
  await rejects(h.store.purge(a.id,1),'REVISION_CONFLICT'); await h.store.restore(a.id,2);
  await rejects(h.store.purge(a.id,2),'REVISION_CONFLICT'); await rejects(h.store.purge(a.id,3),'NOT_TRASHED');
  await rejects(h.store.emptyTrash([{id:a.id,revision:2}]),'REVISION_CONFLICT'); assert.equal((await h.store.usage()).count,1);
});

test('emptyTrash requires the exact confirmed set, including newly added trash', async () => {
  const h=fixture(), a=await h.store.save({name:'A',record:record()}), b=await h.store.save({name:'B',record:record()});
  await h.store.trash(a.id,1); const confirmed=[{id:a.id,revision:2}]; await h.store.trash(b.id,1);
  await rejects(h.store.emptyTrash(confirmed),'REVISION_CONFLICT'); assert.equal((await h.store.usage()).count,2);
  await rejects(h.store.emptyTrash([confirmed[0],confirmed[0]]),'INVALID_RECORD');
  const result=await h.store.emptyTrash([...confirmed,{id:b.id,revision:2}]); assert.equal(result.deleted.length,2); assert.equal((await h.store.usage()).count,0);
});

test('permanent deletion rolls back both stores on every delete failure or commit failure', async () => {
  for(const bulk of [false,true]) for(const failure of [1,2,...(bulk?[3,4]:[]),'commit']) {
    const h=fixture(), items=[]; for(let i=0;i<(bulk?2:1);i++){const m=await h.store.save({name:'A'+i,record:record()});await h.store.trash(m.id,1);items.push({id:m.id,revision:2});}
    const before=copy(h.state.raw()); if(failure==='commit')h.state.failCommit=true;else h.state.failAtWrite=failure;
    await rejects(bulk?h.store.emptyTrash(items):h.store.purge(items[0].id,2),'STORAGE_QUOTA'); assert.deepEqual(h.state.raw(),before);
  }
});

test('concurrent restore wins over stale purge and concurrent purge never reports double success', async () => {
  const h=fixture(), a=await h.store.save({name:'A',record:record()}); await h.store.trash(a.id,1);
  const first=await Promise.allSettled([h.store.restore(a.id,2),h.store.purge(a.id,2)]);
  assert.equal(first[0].status,'fulfilled'); assert.equal(first[1].status,'rejected'); assert.equal((await h.store.get(a.id)).metadata.trashedAt,null);
  await h.store.trash(a.id,3); const second=await Promise.allSettled([h.store.purge(a.id,4),h.store.purge(a.id,4)]);
  assert.equal(second.filter(x=>x.status==='fulfilled').length,1); assert.equal((await h.store.usage()).count,0);
});
