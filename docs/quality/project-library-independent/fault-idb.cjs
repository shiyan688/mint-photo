'use strict';
// INDEPENDENT FAULT-INJECTED MODEL ONLY. Not a native browser storage test.
// Each transaction works on a cloned database and commits all included stores
// together. Requests are separate scheduled jobs. Completion can be paused or
// failed after every request has succeeded. This deliberately serializes even
// non-overlapping transactions and cannot establish real IndexedDB durability.
const clone = x => structuredClone(x);
const named = name => Object.assign(new Error('Injected ' + name), { name });
function makeIDB({ version = 0, draft } = {}) {
  let stores = new Map(version ? [['drafts', new Map(draft === undefined ? [] : [['current', clone(draft)]])]] : []);
  const state = { version, requests: [], transactions: [], faultWrite: 0, failCommit: false, holdCommit: false, held: [], opens: 0, raw: () => stores, release() { this.holdCommit = false; this.held.splice(0).forEach(fn => fn()); } };
  let active = null; const waiting = [];
  const indexedDB = { open(name, version) {
    const req = {}; state.opens++;
    setImmediate(() => {
      const db = { version, closed: false, objectStoreNames: { contains: name => stores.has(name) },
        createObjectStore(name) { if (stores.has(name)) throw named('ConstraintError'); stores.set(name, new Map()); },
        close() { this.closed = true; }, transaction(names, mode) { if (this.closed) throw named('InvalidStateError'); return transaction(typeof names === 'string' ? [names] : names, mode); }
      };
      req.result = db;
      const old = clone(stores); let aborted = false;
      req.transaction = { abort() { aborted = true; } };
      if (state.version < version) req.onupgradeneeded?.({ oldVersion: state.version });
      if (aborted) { stores = old; req.error = named('AbortError'); req.onerror?.({ target: req }); return; }
      state.version = version; req.onsuccess?.({ target: req });
    });
    return req;
  } };
  function transaction(names, mode) {
    let data, alive = true, ready = false, scheduled = false, writeCount = 0; const jobs = [];
    const tx = { error: null, abort() { if (!alive) throw named('InvalidStateError'); abort(named('AbortError')); }, objectStore(name) {
      if (!names.includes(name)) throw named('NotFoundError');
      const queue = (kind, key, action, req = {}) => {
        if (!alive) throw named('TransactionInactiveError');
        state.requests.push({ mode, name, kind, key });
        jobs.push(() => { try { req.result = action(); req.onsuccess?.({ target: req }); } catch (error) { req.error = error; req.onerror?.({ target: req }); tx.onerror?.({ target: req }); abort(error); } });
        schedule(); return req;
      };
      const write = (kind, value, key) => { const captured = clone(value); return queue(kind, key, () => { if (mode !== 'readwrite') throw named('ReadOnlyError'); if (++writeCount === state.faultWrite) { state.faultWrite = 0; throw named('QuotaExceededError'); } if (kind === 'add' && data.get(name).has(key)) throw named('ConstraintError'); if (kind === 'delete') data.get(name).delete(key); else data.get(name).set(key, captured); return key; }); };
      const cursor = keysOnly => { const req = {}; let keys, at = 0;
        const advance = () => queue(keysOnly ? 'openKeyCursor' : 'openCursor', null, () => {
          keys ||= [...data.get(name).keys()].sort(); if (at === keys.length) return null;
          const key = keys[at++], value = { key, primaryKey: key, continue: advance }; if (!keysOnly) value.value = clone(data.get(name).get(key)); return value;
        }, req);
        return advance();
      };
      return { keyPath: null, autoIncrement: false, get: key => queue('get', key, () => clone(data.get(name).get(key))), put: (value, key) => write('put', value, key), add: (value, key) => write('add', value, key), delete: key => write('delete', undefined, key), openCursor: () => cursor(false), openKeyCursor: () => cursor(true) };
    } };
    state.transactions.push({ tx, names, mode });
    function advanceTransaction() { active = null; const next = waiting.shift(); if (next) { active = next; setImmediate(next); } }
    function abort(error) { if (!alive) return; alive = false; tx.error = error; setImmediate(() => { tx.onabort?.({ target: tx }); advanceTransaction(); }); }
    function commit() { if (!alive) return; if (state.failCommit) { state.failCommit = false; return abort(named('QuotaExceededError')); } alive = false; if (mode === 'readwrite') for (const name of names) stores.set(name, data.get(name)); tx.oncomplete?.({ target: tx }); advanceTransaction(); }
    function schedule() { if (!ready || scheduled || !alive) return; scheduled = true; setImmediate(() => { scheduled = false; if (!alive) return; if (jobs.length) { jobs.shift()(); schedule(); } else if (state.holdCommit && mode === 'readwrite') state.held.push(commit); else commit(); }); }
    const start = () => { data = clone(stores); ready = true; schedule(); };
    if (active) waiting.push(start); else { active = start; setImmediate(start); }
    return tx;
  }
  return { indexedDB, state };
}
module.exports = { makeIDB };
