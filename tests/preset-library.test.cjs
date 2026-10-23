'use strict';
// Pure store tests, not Android/WebView UI or physical-device durability proof.
// MINIMAL CODEC STUB: models codec boundaries and permits artificial padding for
// budget tests. It is intentionally NOT evidence of the real preset schema or
// strict external JSON validation. The final section uses the shared codec when
// assets/preset-codec.js exists or MINT_PRESET_CODEC points to that exact file.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Library = require('../app/src/main/assets/preset-library.js');
const tests = [];
const test = (name, run) => tests.push({ name, run });
const clone = value => JSON.parse(JSON.stringify(value));
const K = Library.STORAGE_KEY;
const id = number => 'preset-' + number.toString(16).padStart(32, '0');
const throws = (fn, code) => assert.throws(fn, error => error && error.code === code);

function minimalCodecStub() {
  const calls = { parse: [], validate: 0, stringify: 0 };
  function validate(document) {
    calls.validate++;
    assert.ok(document && typeof document === 'object');
    assert.deepEqual(Reflect.ownKeys(document).sort(), ['controls', 'format', 'name', 'version']);
    for (const key of Reflect.ownKeys(document)) assert.ok(Object.hasOwn(Object.getOwnPropertyDescriptor(document, key), 'value'));
    assert.equal(document.format, 'mint-adjustment-preset');
    assert.equal(document.version, 1);
    assert.equal(typeof document.name, 'string');
    assert.ok(document.name.trim());
    assert.deepEqual(Object.keys(document.controls).sort(), ['advancedTone', 'basic', 'beauty']);
    const result = clone(document);
    result.name = result.name.trim();
    return result;
  }
  return {
    calls,
    defaults: name => ({ format: 'mint-adjustment-preset', version: 1, name, controls: { basic: { exposure: 0 }, beauty: { smooth: 0 }, advancedTone: null } }),
    validate,
    parse(text) { calls.parse.push(text); return validate(JSON.parse(text)); },
    stringify(document) { calls.stringify++; return JSON.stringify(validate(document)); },
    hasPortraitEffect(document) { return validate(document).controls.beauty.smooth !== 0; },
    colorOnly(document) { const result = validate(document); result.controls.beauty.smooth = 0; return result; }
  };
}
function memoryStorage(initial = null) {
  let value = initial;
  const storage = {
    reads: 0, writes: 0, failRead: false, failWrite: false, beforeWrite: null,
    getItem(key) { assert.equal(key, K); storage.reads++; if (storage.failRead) throw new Error('Denied storage'); return value; },
    setItem(key, text) {
      assert.equal(key, K); assert.equal(typeof text, 'string'); storage.writes++;
      if (storage.beforeWrite) storage.beforeWrite(text);
      if (storage.failWrite) throw new Error('QuotaExceededError');
      value = text;
    },
    peek: () => value,
    replace: text => { value = text; }
  };
  return storage;
}
function fixture(initial, codec = minimalCodecStub()) {
  const storage = memoryStorage(initial);
  const store = Library.createStore({ codec, storage });
  return { codec, storage, store, doc: name => codec.defaults(name) };
}
function collection(entries) { return JSON.stringify({ format: Library.FORMAT, version: 1, entries }); }
function entry(number, name) { return { id: id(number), preset: minimalCodecStub().defaults(name), favorite: false }; }

test('UMD loads without DOM, storage, network, or global pollution', () => {
  const context = vm.createContext({});
  const before = Reflect.ownKeys(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/src/main/assets/preset-library.js'), 'utf8'), context);
  assert.deepEqual(Reflect.ownKeys(context).filter(key => !before.includes(key)), ['MintPresetLibrary']);
  assert.deepEqual(Object.keys(context.MintPresetLibrary).sort(), Object.keys(Library).sort());
  assert.equal(Library.STORAGE_KEY, 'mint-adjustment-presets-v1');
  assert.equal(Library.MAX_ENTRIES, 40);
  assert.equal(Library.MAX_COLLECTION_BYTES, 262144);
  assert.equal(Library.MAX_PRESET_BYTES, 65536);
});
test('new store requires load; empty load does not rewrite storage', () => {
  const { store, storage, doc } = fixture();
  assert.deepEqual(store.list(), []);
  throws(() => store.save(doc('A')), 'NOT_LOADED');
  throws(() => store.setFavorite(id(1), true), 'NOT_LOADED');
  throws(() => store.remove(id(1)), 'NOT_LOADED');
  assert.deepEqual(store.load(), []);
  assert.equal(storage.writes, 0); assert.equal(storage.peek(), null);
});
test('save, rename by explicit ID, favorite, reload, export and delete round-trip', () => {
  const { store, storage, codec, doc } = fixture(); store.load();
  const a = store.save(doc('  晨间薄荷  '));
  assert.match(a.id, /^preset-[0-9a-f]{32}$/); assert.equal(a.preset.name, '晨间薄荷'); assert.equal(a.favorite, false);
  const favorite = store.setFavorite(a.id, true); assert.equal(favorite.favorite, true);
  const changed = doc('夜晚'); changed.controls.basic.exposure = 14;
  const renamed = store.save(changed, { id: a.id }); assert.equal(renamed.id, a.id); assert.equal(renamed.favorite, true);
  const fresh = Library.createStore({ codec, storage }); assert.deepEqual(fresh.load(), [renamed]);
  assert.deepEqual(JSON.parse(fresh.exportText(a.id)), renamed.preset);
  const removed = fresh.remove(a.id); assert.deepEqual(removed, renamed); assert.deepEqual(fresh.list(), []);
  assert.deepEqual(JSON.parse(storage.peek()).entries, []);
});
test('all input and output boundaries are independent nested snapshots', () => {
  const { store, storage, codec, doc } = fixture(); store.load();
  const input = doc('A'); input.controls.advancedTone = { nested: { value: 3 } };
  const saved = store.save(input, { favorite: true });
  input.controls.advancedTone.nested.value = 10; input.controls.basic.exposure = 99;
  saved.preset.controls.advancedTone.nested.value = 20; saved.favorite = false; saved.id = id(100);
  const listed = store.list(); listed[0].preset.controls.advancedTone.nested.value = 30; listed.length = 0;
  assert.equal(store.list()[0].preset.controls.advancedTone.nested.value, 3);
  const loaded = store.load(); loaded[0].preset.controls.basic.exposure = 40;
  const favored = store.setFavorite(store.list()[0].id, false); favored.preset.controls.basic.exposure = 50;
  assert.equal(store.list()[0].preset.controls.basic.exposure, 0);
  assert.equal(Library.createStore({ codec, storage }).load()[0].preset.controls.advancedTone.nested.value, 3);
});
test('duplicate canonical names are rejected; explicit overwrite retains ordering and favorite', () => {
  const { store, storage, doc } = fixture(); store.load();
  const a = store.save(doc('A'), { favorite: true }), b = store.save(doc('B'));
  const before = storage.peek();
  throws(() => store.save(doc(' A ')), 'DUPLICATE_NAME');
  throws(() => store.save(doc('B'), { id: a.id }), 'DUPLICATE_NAME');
  assert.equal(storage.peek(), before);
  const result = store.save(doc(' C '), { id: a.id });
  assert.equal(result.favorite, true); assert.deepEqual(store.list().map(e => e.id), [a.id, b.id]);
  assert.equal(store.save(doc('C'), { id: a.id, favorite: false }).favorite, false);
});
test('unknown/malformed IDs and non-boolean favorites never write', () => {
  const { store, storage, doc } = fixture(); store.load(); const a = store.save(doc('A'));
  const before = storage.writes;
  for (const bad of ['', null, 7, '__proto__', 'constructor', 'preset-xyz', id(1).toUpperCase(), { toString: () => a.id }]) {
    throws(() => store.save(doc('B'), { id: bad }), 'INVALID_ID');
    throws(() => store.setFavorite(bad, true), 'INVALID_ID');
    throws(() => store.remove(bad), 'INVALID_ID');
    throws(() => store.exportText(bad), 'INVALID_ID');
  }
  throws(() => store.save(doc('B'), { id: id(999) }), 'NOT_FOUND');
  throws(() => store.remove(id(999)), 'NOT_FOUND');
  for (const favorite of [undefined, null, 0, 1, 'true', {}]) {
    throws(() => store.setFavorite(a.id, favorite), 'INVALID_ARGUMENT');
    throws(() => store.save(doc('B'), { favorite }), 'INVALID_ARGUMENT');
  }
  assert.equal(storage.writes, before);
});
test('save options reject getters, hidden/symbol/unknown fields and custom prototypes without reading them', () => {
  const { store, doc } = fixture(); store.load(); let reads = 0;
  const getter = {}; Object.defineProperty(getter, 'id', { enumerable: true, get() { reads++; return id(1); } });
  const hidden = {}; Object.defineProperty(hidden, 'favorite', { value: true });
  for (const options of [null, [], 4, getter, hidden, { extra: true }, { [Symbol('favorite')]: true }, Object.create({ favorite: true }), JSON.parse('{"__proto__":{}}')]) {
    throws(() => store.save(doc('A'), options), 'INVALID_ARGUMENT');
  }
  assert.equal(reads, 0);
  const clean = Object.create(null); clean.favorite = true;
  assert.equal(store.save(doc('A'), clean).favorite, true);
});
test('inherited option accessors are neither read nor mistaken for explicit save options', () => {
  const { store, doc } = fixture(); store.load(); let reads = 0;
  Object.defineProperty(Object.prototype, 'favorite', { configurable: true, get() { reads++; return true; } });
  Object.defineProperty(Object.prototype, 'id', { configurable: true, get() { reads++; return id(1); } });
  try { assert.equal(store.save(doc('A'), {}).favorite, false); }
  finally { delete Object.prototype.favorite; delete Object.prototype.id; }
  assert.equal(reads, 0);
});
test('construction rejects option/method accessors without executing them; native-style inherited storage methods work', () => {
  const codec = minimalCodecStub(), storage = memoryStorage(); let reads = 0;
  const getter = { storage }; Object.defineProperty(getter, 'codec', { enumerable: true, get() { reads++; return codec; } });
  throws(() => Library.createStore(getter), 'INVALID_ARGUMENT');
  throws(() => Library.createStore({ codec, storage, key: 'other' }), 'INVALID_ARGUMENT');
  const badStorage = {}; Object.defineProperty(badStorage, 'getItem', { get() { reads++; return () => null; } });
  throws(() => Library.createStore({ codec, storage: badStorage }), 'INVALID_ARGUMENT');
  const badCodec = { ...codec }; Object.defineProperty(badCodec, 'parse', { get() { reads++; return () => null; } });
  throws(() => Library.createStore({ codec: badCodec, storage }), 'INVALID_ARGUMENT');
  assert.equal(reads, 0);
  class Storage { constructor() { this.value = null; } getItem(key) { assert.equal(key, K); return this.value; } setItem(key, value) { assert.equal(key, K); this.value = value; } }
  const nativeLike = Library.createStore({ codec, storage: new Storage() }); nativeLike.load(); nativeLike.save(codec.defaults('A'));
  assert.equal(nativeLike.list().length, 1);
});
test('polluting payload keys do not alter built-in prototypes or invoke toJSON', () => {
  const before = Reflect.ownKeys(Object.prototype), { store, doc, storage } = fixture(); store.load();
  const payload = JSON.parse(JSON.stringify(doc('A')).replace('"name":"A"', '"name":"A","__proto__":{"polluted":true}'));
  assert.throws(() => store.save(payload));
  throws(() => store.save(doc('A'), JSON.parse('{"constructor":{},"prototype":{}}')), 'INVALID_ARGUMENT');
  assert.deepEqual(Reflect.ownKeys(Object.prototype), before); assert.equal({}.polluted, undefined);
  assert.equal(storage.writes, 0);
});
test('serialized collection contains only the envelope and canonical preset, never source or local export metadata', () => {
  const { store, storage, doc } = fixture(); store.load(); const saved = store.save(doc('A'), { favorite: true });
  const raw = JSON.parse(storage.peek());
  assert.deepEqual(Object.keys(raw), ['format', 'version', 'entries']);
  assert.deepEqual(Object.keys(raw.entries[0]), ['id', 'preset', 'favorite']);
  const exported = JSON.parse(store.exportText(saved.id));
  assert.deepEqual(Object.keys(exported), ['format', 'version', 'name', 'controls']);
  assert.equal(Object.hasOwn(exported, 'favorite'), false); assert.equal(Object.hasOwn(exported, 'id'), false);
  for (const key of ['image', 'path', 'source', 'mesh', 'landmarks', 'mask', 'selection', 'crop']) {
    assert.throws(() => store.save({ ...doc('B'), [key]: 'private' }));
    assert.equal(store.list().length, 1);
  }
});
test('imports use the original strict-codec parse boundary and never persist', () => {
  const codec = minimalCodecStub(), originalParse = codec.parse;
  const input = '{"name":"A","name":"B"}';
  codec.parse = text => { if (text === input) throw new TypeError('Strict duplicate JSON rejection'); return originalParse(text); };
  const { store, storage, doc } = fixture(undefined, codec);
  assert.throws(() => store.importText(input), /Strict duplicate JSON rejection/);
  const text = JSON.stringify(doc('A')), imported = store.importText(text);
  assert.equal(codec.calls.parse.includes(text), true); imported.controls.basic.exposure = 10;
  assert.equal(storage.writes, 0); assert.equal(storage.reads, 0); assert.deepEqual(store.list(), []);
  assert.equal(store.importText(text).controls.basic.exposure, 0);
});
test('setItem failure on save, overwrite, favorite, and delete preserves memory and durable data', () => {
  const { store, storage, doc } = fixture(); store.load(); const a = store.save(doc('A'));
  const before = store.list(), raw = storage.peek(); storage.failWrite = true;
  for (const mutate of [() => store.save(doc('B')), () => store.save(doc('Renamed'), { id: a.id }), () => store.setFavorite(a.id, true), () => store.remove(a.id)]) {
    throws(mutate, 'STORAGE_WRITE'); assert.deepEqual(store.list(), before); assert.equal(storage.peek(), raw);
  }
  storage.failWrite = false; assert.equal(store.setFavorite(a.id, true).favorite, true);
});
test('persist happens before an in-memory success is observable', () => {
  const { store, storage, doc } = fixture(); store.load(); const a = store.save(doc('A'));
  storage.beforeWrite = text => { assert.equal(store.list()[0].favorite, false); assert.equal(JSON.parse(text).entries[0].favorite, true); };
  store.setFavorite(a.id, true); assert.equal(store.list()[0].favorite, true);
});
test('read failures preserve the last snapshot and block mutations until a successful load', () => {
  const { store, storage, doc } = fixture(); store.load(); store.save(doc('A')); const before = store.list();
  storage.failRead = true; throws(() => store.load(), 'STORAGE_READ'); assert.deepEqual(store.list(), before);
  storage.failRead = false; throws(() => store.save(doc('B')), 'NOT_LOADED');
  store.load(); store.save(doc('B')); assert.equal(store.list().length, 2);
  storage.failRead = true; throws(() => store.save(doc('C')), 'STORAGE_READ'); assert.equal(store.list().length, 2);
  storage.failRead = false; throws(() => store.remove(before[0].id), 'NOT_LOADED');
});
test('malformed/non-string storage never silently resets or writes', () => {
  for (const text of ['', '{', 'null', '[]', '{}', 'true', 42, undefined]) {
    const { store, storage, doc } = fixture(null); storage.replace(text);
    assert.throws(() => store.load()); throws(() => store.save(doc('A')), 'NOT_LOADED');
    assert.equal(storage.peek(), text); assert.equal(storage.writes, 0); assert.deepEqual(store.list(), []);
  }
});
test('unknown collection fields, versions, entry fields, malformed IDs, favorites and documents are rejected intact', () => {
  const good = { format: Library.FORMAT, version: 1, entries: [entry(1, 'A')] };
  const cases = [
    { ...good, extra: true }, { ...good, format: 'other' }, { ...good, version: 2 }, { ...good, entries: null },
    { ...good, entries: [{ ...entry(1, 'A'), extra: true }] },
    { ...good, entries: [{ ...entry(1, 'A'), id: '__proto__' }] },
    { ...good, entries: [{ ...entry(1, 'A'), favorite: 1 }] },
    { ...good, entries: [{ id: id(1), preset: entry(1, 'A').preset }] },
    { ...good, entries: [{ ...entry(1, 'A'), preset: { format: 'other' } }] }
  ];
  for (const value of cases) {
    const raw = JSON.stringify(value), { store, storage, doc } = fixture(raw);
    assert.throws(() => store.load()); throws(() => store.save(doc('B')), 'NOT_LOADED');
    assert.equal(storage.peek(), raw); assert.equal(storage.writes, 0);
  }
});
test('duplicate IDs and canonical duplicate names are rejected intact', () => {
  for (const entries of [[entry(1, 'A'), entry(1, 'B')], [entry(1, 'A'), entry(2, ' A ')]]) {
    const raw = collection(entries), { store, storage } = fixture(raw);
    throws(() => store.load(), 'CORRUPT_STORAGE'); assert.equal(storage.peek(), raw); assert.equal(storage.writes, 0);
  }
});
test('duplicate JSON keys, escaped aliases and poison keys at every collection depth are rejected', () => {
  const raw = collection([entry(1, 'A')]);
  const cases = [raw.replace('"version":1', '"version":1,"version":1'), raw.replace('"version":1', '"version":1,"\\u0076ersion":1'), raw.replace('"favorite":false', '"favorite":true,"favorite":false'), raw.replace('"name":"A"', '"name":"B","\\u006eame":"A"'), raw.replace('"basic":{', '"basic":{"__proto__":{},'), raw.replace('"basic":{', '"basic":{"constructor":{},')];
  for (const value of cases) {
    const { store, storage } = fixture(value); throws(() => store.load(), 'CORRUPT_STORAGE');
    assert.equal(storage.peek(), value); assert.equal(storage.writes, 0);
  }
});
test('deeply nested collection input is bounded and does not overflow the call stack', () => {
  const raw = '['.repeat(10000) + '0' + ']'.repeat(10000), { store, storage } = fixture(raw);
  throws(() => store.load(), 'CORRUPT_STORAGE'); assert.equal(storage.peek(), raw); assert.equal(storage.writes, 0);
});
test('failed reload keeps old entries, and only a valid explicit reload enables recovery', () => {
  const { store, storage, doc } = fixture(); store.load(); const a = store.save(doc('A')), valid = storage.peek();
  storage.replace('{broken'); throws(() => store.load(), 'CORRUPT_STORAGE'); assert.deepEqual(store.list(), [a]);
  throws(() => store.save(doc('B')), 'NOT_LOADED'); assert.equal(storage.peek(), '{broken');
  storage.replace(valid); store.load(); store.save(doc('B')); assert.equal(store.list().length, 2);
});
test('stale writes cannot overwrite an out-of-band changed or corrupt collection', () => {
  for (const external of ['{broken', collection([entry(25, 'External')]), null]) {
    const { store, storage, doc } = fixture(); store.load(); const a = store.save(doc('A'));
    storage.replace(external); const writes = storage.writes;
    throws(() => store.setFavorite(a.id, true), 'STORAGE_CHANGED');
    assert.deepEqual(store.list(), [a]); assert.equal(storage.peek(), external); assert.equal(storage.writes, writes);
    throws(() => store.remove(a.id), 'NOT_LOADED');
  }
});
test('two stores cannot silently lose each other’s updates', () => {
  const { store, storage, codec, doc } = fixture(); store.load();
  const second = Library.createStore({ codec, storage }); second.load();
  store.save(doc('A')); throws(() => second.save(doc('B')), 'STORAGE_CHANGED');
  second.load(); second.save(doc('B')); assert.equal(second.list().length, 2);
  store.load(); assert.deepEqual(store.list(), second.list());
});
test('40-entry limit allows editing and deleting at capacity but rejects entry 41', () => {
  const { store, storage, doc } = fixture(); store.load();
  for (let i = 0; i < 40; i++) store.save(doc('Preset ' + i));
  const raw = storage.peek(), first = store.list()[0];
  throws(() => store.save(doc('41st')), 'ENTRY_LIMIT'); assert.equal(storage.peek(), raw); assert.equal(store.list().length, 40);
  store.save(doc('Renamed'), { id: first.id }); store.setFavorite(first.id, true); store.remove(first.id);
  store.save(doc('Replacement')); assert.equal(store.list().length, 40);
  const tooMany = collection(Array.from({ length: 41 }, (_, i) => entry(i + 1, 'N' + i)));
  const bad = fixture(tooMany); throws(() => bad.store.load(), 'ENTRY_LIMIT'); assert.equal(bad.storage.peek(), tooMany);
});
test('256 KiB collection budget is UTF-8 based and failed oversized writes leave old data intact', () => {
  for (const padding of ['x'.repeat(60000), '薄'.repeat(20000)]) {
    const { store, storage, doc } = fixture(); store.load();
    const make = name => { const value = doc(name); value.controls.advancedTone = { stubPadding: padding }; return value; };
    for (let i = 0; i < 4; i++) store.save(make('A' + i));
    const raw = storage.peek(); assert.ok(Buffer.byteLength(raw, 'utf8') <= 262144);
    throws(() => store.save(make('Too large')), 'COLLECTION_LIMIT');
    assert.equal(storage.peek(), raw); assert.equal(store.list().length, 4);
  }
});
test('oversized or invalid-Unicode raw collection is rejected before parsing and preserved', () => {
  for (const raw of [' '.repeat(262145), '薄'.repeat(90000), '"\ud800"']) {
    const { store, storage } = fixture(raw); throws(() => store.load(), 'COLLECTION_LIMIT');
    assert.equal(storage.peek(), raw); assert.equal(storage.writes, 0);
  }
});
test('exact collection and preset byte limits remain usable without rewriting a valid load', () => {
  const base = collection([entry(1, 'Quote " slash \\ braces {[]} 薄荷')]);
  const raw = base + ' '.repeat(262144 - Buffer.byteLength(base, 'utf8'));
  const { store, storage, doc } = fixture(raw);
  assert.equal(store.load().length, 1); assert.equal(storage.peek(), raw); assert.equal(storage.writes, 0);
  const text = JSON.stringify(doc('Exact'));
  const boundary = text + ' '.repeat(65536 - Buffer.byteLength(text, 'utf8'));
  assert.equal(store.importText(boundary).name, 'Exact');
  throws(() => store.importText(boundary + ' '), 'PRESET_LIMIT');
});
test('64 KiB imported and saved preset bounds apply even if a minimal injected codec omits them', () => {
  const { store, storage, doc } = fixture(); store.load();
  for (const text of [' '.repeat(65537), '薄'.repeat(22000), '"\ud800"', {}, null]) throws(() => store.importText(text), 'PRESET_LIMIT');
  const large = doc('A'); large.controls.advancedTone = { stubPadding: 'x'.repeat(65536) };
  throws(() => store.save(large), 'PRESET_LIMIT'); assert.equal(storage.writes, 0); assert.deepEqual(store.list(), []);
});
test('deterministic random and clock still produce distinct local IDs', () => {
  const { store, doc } = fixture(); store.load(); const random = Math.random, now = Date.now;
  try {
    Math.random = () => 0; Date.now = () => 0;
    for (let i = 0; i < 40; i++) store.save(doc('A' + i));
  } finally { Math.random = random; Date.now = now; }
  assert.equal(new Set(store.list().map(e => e.id)).size, 40);
});

const codecPath = process.env.MINT_PRESET_CODEC || path.join(__dirname, '../app/src/main/assets/preset-codec.js');
if (fs.existsSync(codecPath)) {
  const Shared = require(codecPath);
  const AdvancedTone = require('../app/src/main/assets/advanced-tone.js');
  const realCodec = () => Shared.createCodec({ advancedTone: AdvancedTone, levels: require('../app/src/main/assets/levels.js') });
  test('REAL SHARED CODEC: actual basic/beauty/advanced-tone controls survive store/export/import/reload exactly', () => {
    const codec = realCodec(), { store, storage } = fixture(undefined, codec); store.load();
    const input = codec.defaults('共享薄荷'); input.controls.basic.exposure = 12; input.controls.basic.temperature = -18;
    input.controls.beauty.smooth = 27; input.controls.beauty.underEye = 15; input.controls.beauty.palette = 'rose';
    input.controls.advancedTone = AdvancedTone.defaults();
    const saved = store.save(input, { favorite: true });
    const exported = store.exportText(saved.id), imported = store.importText(exported);
    assert.deepEqual(imported, codec.validate(input)); assert.equal(codec.hasPortraitEffect(imported), true);
    const fresh = Library.createStore({ codec, storage }); assert.deepEqual(fresh.load(), [saved]);
    assert.deepEqual(codec.parse(exported), saved.preset); assert.equal(exported.includes(saved.id), false); assert.equal(exported.includes('favorite'), false);
    const color = codec.colorOnly(imported); assert.equal(codec.hasPortraitEffect(color), false);
    assert.equal(codec.hasPortraitEffect(store.list()[0].preset), true);
  });
  test('REAL SHARED CODEC: imports reject duplicate keys, unknown/image metadata, malformed controls, versions, and oversized files', () => {
    const codec = realCodec(), { store, storage } = fixture(undefined, codec);
    const raw = codec.stringify(codec.defaults('A'));
    const cases = [raw.replace('"name":"A"', '"name":"A","name":"B"'), raw.replace('"name":"A"', '"name":"A","\\u006eame":"B"'), raw.replace('"version":3', '"version":4'), raw.replace('"exposure":0', '"exposure":101'), raw.replace('"name":"A"', '"name":"A","image":"private"'), raw.replace('"basic":{', '"basic":{"__proto__":{},'), raw.replace('"name":"A"', '"name":"A","favorite":true')];
    for (const text of cases) assert.throws(() => store.importText(text));
    assert.equal(storage.writes, 0); assert.equal(storage.reads, 0); assert.deepEqual(store.list(), []);
  });
  test('REAL SHARED CODEC: malicious accessors/prototypes never execute and original photo/face state cannot enter presets', () => {
    const codec = realCodec(), { store, storage } = fixture(undefined, codec); store.load(); let reads = 0;
    const doc = codec.defaults('A'); Object.defineProperty(doc.controls.basic, 'exposure', { enumerable: true, get() { reads++; return 0; } });
    assert.throws(() => store.save(doc)); assert.equal(reads, 0);
    for (const key of ['source', 'path', 'blob', 'landmarks', 'mesh', 'mask', 'selection', 'crop', 'history']) {
      const bad = codec.defaults('A'); bad[key] = 'not allowed'; assert.throws(() => store.save(bad));
    }
    assert.equal(storage.writes, 0); assert.equal({}.polluted, undefined);
  });
  test('REAL SHARED CODEC: collection serialization ignores inherited toJSON hooks', () => {
    const codec = realCodec(), { store, storage } = fixture(undefined, codec); store.load(); const doc = codec.defaults('A'); let calls = 0;
    Object.defineProperty(Object.prototype, 'toJSON', { configurable: true, value() { calls++; throw new Error('Inherited toJSON executed'); } });
    Object.defineProperty(Array.prototype, 'toJSON', { configurable: true, value() { calls++; throw new Error('Inherited array toJSON executed'); } });
    try { const saved = store.save(doc); assert.equal(store.exportText(saved.id), codec.stringify(doc)); assert.equal(store.load().length, 1); }
    finally { delete Object.prototype.toJSON; delete Array.prototype.toJSON; }
    assert.equal(calls, 0); assert.equal(JSON.parse(storage.peek()).entries.length, 1);
  });
} else {
  console.log('NOTE: Shared-codec integration skipped; set MINT_PRESET_CODEC or install the shared asset. Stub checks do not prove codec security.');
}

let passed = 0;
for (const { name, run } of tests) {
  try { run(); passed++; console.log('PASS', name); }
  catch (error) { console.error('FAIL', name); console.error(error); process.exitCode = 1; }
}
console.log(`${passed}/${tests.length} preset-library checks passed (pure store logic${fs.existsSync(codecPath) ? ' + shared-codec integration' : ', minimal codec stub only'})`);
