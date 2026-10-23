/* Local, bounded adjustment-preset library. No DOM, image data, paths, or I/O
 * except the explicitly injected localStorage-compatible storage. The shared
 * preset codec, not this library, defines and validates preset controls.
 *
 * A successful load() is required before every first write/recovery. Mutations
 * persist before committing memory. A failed load preserves the last snapshot
 * and blocks writes; a failed setItem preserves memory and can be retried.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else Object.defineProperty(root, 'MintPresetLibrary', { value: api, enumerable: true, configurable: true, writable: true });
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const STORAGE_KEY = 'mint-adjustment-presets-v1';
  const FORMAT = 'mint-adjustment-preset-library';
  const MAX_ENTRIES = 40, MAX_COLLECTION_BYTES = 256 * 1024, MAX_PRESET_BYTES = 64 * 1024;
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const descriptor = Object.getOwnPropertyDescriptor;
  const objectPrototype = Object.prototype;
  const ID_PATTERN = /^preset-[0-9a-f]{32}$/;

  function fail(code, message) {
    const error = new Error(message);
    error.name = 'PresetLibraryError';
    error.code = code;
    throw error;
  }
  function record(value, allowed, required, label, code) {
    code = code || 'INVALID_ARGUMENT';
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code, label + ' must be a record');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== objectPrototype) fail(code, label + ' has an unsupported prototype');
    const result = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || !allowed.includes(key)) fail(code, label + ' contains an unsupported field');
      const property = descriptor(value, key);
      if (!property || !own(property, 'value') || !property.enumerable) fail(code, label + ' must contain enumerable data properties');
      Object.defineProperty(result, key, { value: property.value, enumerable: true });
    }
    for (const key of required) if (!own(result, key)) fail(code, label + ' is missing a required field');
    return result;
  }
  // Count UTF-8 bytes without depending on TextEncoder, Buffer, or toString
  // hooks. Reject isolated surrogates instead of silently replacing them.
  function checkBytes(text, limit, code) {
    if (typeof text !== 'string') fail(code, 'Expected text');
    if (text.length > limit) fail(code, 'Text exceeds its UTF-8 byte limit');
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = text.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff)) fail(code, 'Text contains an invalid Unicode surrogate');
        bytes += 4;
      } else {
        if (c >= 0xdc00 && c <= 0xdfff) fail(code, 'Text contains an invalid Unicode surrogate');
        bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
      }
      if (bytes > limit) fail(code, 'Text exceeds its UTF-8 byte limit');
    }
    return text;
  }
  function validId(id) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) fail('INVALID_ID', 'Invalid local preset ID');
    return id;
  }
  // localStorage methods normally live on Storage.prototype. Resolve data
  // methods without invoking an accessor on a mock or custom storage object.
  function method(target, key, allowInherited) {
    if (!target || (typeof target !== 'object' && typeof target !== 'function')) fail('INVALID_ARGUMENT', 'Missing ' + key);
    let current = target;
    for (let depth = 0; current && depth < 16; depth++) {
      const property = descriptor(current, key);
      if (property) {
        if (!own(property, 'value') || typeof property.value !== 'function') fail('INVALID_ARGUMENT', key + ' must be a data method');
        return property.value.bind(target);
      }
      if (!allowInherited) break;
      current = Object.getPrototypeOf(current);
    }
    fail('INVALID_ARGUMENT', 'Missing ' + key + ' method');
  }
  // The collection is not an interchange format. Native JSON syntax parsing is
  // followed by a bounded duplicate-key scan, so duplicate/escaped aliases at
  // any level (including inside presets) cannot be normalized away on loading.
  function collectionJSON(text) {
    checkBytes(text, MAX_COLLECTION_BYTES, 'COLLECTION_LIMIT');
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { fail('CORRUPT_STORAGE', 'Stored preset collection is not valid JSON'); }
    let position = 0;
    function whitespace() { while (position < text.length && /[\x20\t\r\n]/.test(text[position])) position++; }
    function string() {
      const start = position++;
      while (position < text.length) {
        const c = text[position++];
        if (c === '\\') position++;
        else if (c === '"') return JSON.parse(text.slice(start, position));
      }
      fail('CORRUPT_STORAGE', 'Invalid JSON string');
    }
    function value(depth) {
      if (depth > 24) fail('CORRUPT_STORAGE', 'Stored preset collection is nested too deeply');
      whitespace();
      if (text[position] === '"') { string(); return; }
      if (text[position] === '{') {
        position++; whitespace();
        const keys = new Set();
        if (text[position] === '}') { position++; return; }
        while (true) {
          const key = string();
          if (keys.has(key)) fail('CORRUPT_STORAGE', 'Stored preset collection contains a duplicate JSON key');
          if (key === '__proto__' || key === 'constructor' || key === 'prototype') fail('CORRUPT_STORAGE', 'Stored preset collection contains a forbidden key');
          keys.add(key); whitespace(); position++; value(depth + 1); whitespace();
          if (text[position++] === '}') return;
          whitespace();
        }
      }
      if (text[position] === '[') {
        position++; whitespace();
        if (text[position] === ']') { position++; return; }
        while (true) {
          value(depth + 1); whitespace();
          if (text[position++] === ']') return;
        }
      }
      while (position < text.length && !/[\x20\t\r\n,\]}]/.test(text[position])) position++;
    }
    value(1);
    return parsed;
  }

  function createStore(options) {
    const opt = record(options, ['codec', 'storage'], ['codec', 'storage'], 'Store options');
    const validate = method(opt.codec, 'validate', false);
    const parse = method(opt.codec, 'parse', false);
    const stringify = method(opt.codec, 'stringify', false);
    const getItem = method(opt.storage, 'getItem', true);
    const setItem = method(opt.storage, 'setItem', true);
    let entries = [], loaded = false, lastText = null, sequence = 0;

    function presetText(preset) {
      return checkBytes(stringify(preset), MAX_PRESET_BYTES, 'PRESET_LIMIT');
    }
    function canonical(preset) { return parse(presetText(validate(preset))); }
    function snapshot(entry) { return { id: entry.id, preset: canonical(entry.preset), favorite: entry.favorite }; }
    function list() { return entries.map(snapshot); }
    function read() {
      let text;
      try { text = getItem(STORAGE_KEY); }
      catch (_) { loaded = false; fail('STORAGE_READ', 'Could not read the local preset collection; existing data was not changed'); }
      if (text !== null && typeof text !== 'string') {
        loaded = false;
        fail('STORAGE_READ', 'Storage returned an unsupported value; existing data was not changed');
      }
      return text;
    }
    function load() {
      loaded = false;
      const text = read();
      let next = [];
      if (text !== null) {
        const collection = record(collectionJSON(text), ['format', 'version', 'entries'], ['format', 'version', 'entries'], 'Collection', 'CORRUPT_STORAGE');
        if (collection.format !== FORMAT || collection.version !== 1 || !Array.isArray(collection.entries)) fail('CORRUPT_STORAGE', 'Unsupported stored preset collection');
        if (collection.entries.length > MAX_ENTRIES) fail('ENTRY_LIMIT', 'The preset collection exceeds 40 entries');
        const ids = new Set(), names = new Set();
        next = collection.entries.map(raw => {
          const entry = record(raw, ['id', 'preset', 'favorite'], ['id', 'preset', 'favorite'], 'Stored entry', 'CORRUPT_STORAGE');
          validId(entry.id);
          if (ids.has(entry.id)) fail('CORRUPT_STORAGE', 'The preset collection contains duplicate IDs');
          if (typeof entry.favorite !== 'boolean') fail('CORRUPT_STORAGE', 'A stored favorite flag is invalid');
          const preset = canonical(entry.preset);
          if (names.has(preset.name)) fail('CORRUPT_STORAGE', 'The preset collection contains duplicate names');
          ids.add(entry.id); names.add(preset.name);
          return { id: entry.id, preset: preset, favorite: entry.favorite };
        });
      }
      // Prepare the public result before committing in case codec validation
      // fails. Both caller and store receive independent canonical records.
      const result = next.map(snapshot);
      entries = next; lastText = text; loaded = true;
      return result;
    }
    function ready() { if (!loaded) fail('NOT_LOADED', 'Load a valid preset collection before making changes'); }
    function indexOf(id) {
      validId(id);
      const index = entries.findIndex(entry => entry.id === id);
      if (index < 0) fail('NOT_FOUND', 'The local preset was not found');
      return index;
    }
    function newId() {
      // Local lookup key only, not an authentication token or exported value.
      // Sequence also prevents collisions with a deterministic Math.random.
      for (let attempt = 0; attempt <= MAX_ENTRIES; attempt++) {
        sequence++;
        const time = ('000000000000' + Date.now().toString(16)).slice(-12);
        const count = ('00000000' + sequence.toString(16)).slice(-8);
        const random = () => ('000000' + Math.floor(Math.random() * 0x1000000).toString(16)).slice(-6);
        const id = 'preset-' + time + count + random() + random();
        if (!entries.some(entry => entry.id === id)) return id;
      }
      fail('ID_EXHAUSTED', 'Could not allocate a local preset ID');
    }
    function persist(next) {
      if (next.length > MAX_ENTRIES) fail('ENTRY_LIMIT', 'A maximum of 40 presets can be saved');
      // Do not call JSON.stringify on records/arrays: inherited toJSON hooks
      // must not observe or alter collection data. IDs have a fixed ASCII shape.
      const body = next.map(entry => '{"id":"' + entry.id + '","preset":' + presetText(entry.preset) + ',"favorite":' + (entry.favorite ? 'true' : 'false') + '}').join(',');
      const text = checkBytes('{"format":"' + FORMAT + '","version":1,"entries":[' + body + ']}', MAX_COLLECTION_BYTES, 'COLLECTION_LIMIT');
      if (read() !== lastText) {
        loaded = false;
        fail('STORAGE_CHANGED', 'The local preset collection changed elsewhere; load it again before writing');
      }
      try { setItem(STORAGE_KEY, text); }
      catch (_) { fail('STORAGE_WRITE', 'Could not save the local preset collection; memory was not changed'); }
      entries = next; lastText = text;
    }
    function save(document, options) {
      ready();
      const opt = record(options === undefined ? {} : options, ['id', 'favorite'], [], 'Save options');
      if (own(opt, 'favorite') && typeof opt.favorite !== 'boolean') fail('INVALID_ARGUMENT', 'Favorite must be a boolean');
      const index = own(opt, 'id') ? indexOf(opt.id) : -1;
      const preset = canonical(document);
      if (entries.some((entry, i) => i !== index && entry.preset.name === preset.name)) fail('DUPLICATE_NAME', 'A preset with this name already exists; choose its explicit ID to overwrite it');
      const entry = { id: index < 0 ? newId() : entries[index].id, preset: preset, favorite: own(opt, 'favorite') ? opt.favorite : index < 0 ? false : entries[index].favorite };
      const result = snapshot(entry), next = entries.slice();
      if (index < 0) next.push(entry); else next[index] = entry;
      persist(next);
      return result;
    }
    function setFavorite(id, favorite) {
      ready();
      if (typeof favorite !== 'boolean') fail('INVALID_ARGUMENT', 'Favorite must be a boolean');
      const index = indexOf(id), next = entries.slice();
      next[index] = { id: entries[index].id, preset: entries[index].preset, favorite: favorite };
      const result = snapshot(next[index]);
      persist(next);
      return result;
    }
    function remove(id) {
      ready();
      const index = indexOf(id), result = snapshot(entries[index]);
      const next = entries.filter((_, i) => i !== index);
      persist(next);
      return result;
    }
    function importText(text) {
      // Call the strict shared parser on the original text, never JSON.parse
      // followed by duck typing. Importing alone never touches local storage.
      checkBytes(text, MAX_PRESET_BYTES, 'PRESET_LIMIT');
      return canonical(parse(text));
    }
    function exportText(id) { return presetText(entries[indexOf(id)].preset); }
    return Object.freeze({ load: load, list: list, save: save, setFavorite: setFavorite, remove: remove, importText: importText, exportText: exportText });
  }
  return Object.freeze({ createStore: createStore, STORAGE_KEY: STORAGE_KEY, FORMAT: FORMAT, MAX_ENTRIES: MAX_ENTRIES, MAX_COLLECTION_BYTES: MAX_COLLECTION_BYTES, MAX_PRESET_BYTES: MAX_PRESET_BYTES });
});
