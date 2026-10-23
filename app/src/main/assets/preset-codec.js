/* Mint adjustment preset v3 (reads and migrates v1/v2). No I/O, image data, rendering, or tone math.
 * This exact file is shared by CommonJS and browser/WebView integrations. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module !== null && module.exports) module.exports = api;
  if (root) {
    const attributes = Object.create(null);
    attributes.value = api; attributes.enumerable = true; attributes.configurable = true; attributes.writable = true;
    Object.defineProperty(root, 'MintAdjustmentPreset', attributes);
  }
})(typeof globalThis === 'object' ? globalThis : null, function () {
  'use strict';

  const MAX_BYTES = 65536, MAX_DEPTH = 12, MAX_NODES = 512, MAX_TOKENS = 2048;
  const MAX_STRING = 4096, MAX_NUMBER = 128;
  const FORMAT = 'mint-adjustment-preset';
  const BASIC = Object.freeze(['exposure', 'contrast', 'saturation', 'temperature']);
  const BEAUTY = Object.freeze(['smooth', 'brighten', 'warmth', 'underEye', 'redness', 'lip', 'blush', 'palette']);
  const own = Object.hasOwn;
  const descriptor = Object.getOwnPropertyDescriptor;
  const define = Object.defineProperty;
  const keys = Reflect.ownKeys;
  const proto = Object.getPrototypeOf;
  const isArray = Array.isArray;
  const finite = Number.isFinite;
  const create = Object.create;
  const objectPrototype = Object.prototype, arrayPrototype = Array.prototype;

  function check(condition, message) { if (!condition) throw new TypeError(message); }
  function put(target, key, value) {
    const attributes = create(null);
    attributes.value = value; attributes.enumerable = true; attributes.writable = true; attributes.configurable = true;
    define(target, key, attributes);
  }
  function poison(key) { return key === '__proto__' || key === 'prototype' || key === 'constructor'; }
  function data(value, key, label) {
    const d = descriptor(value, key);
    check(d !== undefined && own(d, 'value') && d.enumerable, 'Invalid ' + label + ' data property');
    return d.value;
  }
  function record(value, allowed, label) {
    check(value !== null && typeof value === 'object' && !isArray(value), 'Invalid ' + label);
    const p = proto(value);
    check(p === objectPrototype || p === null, 'Invalid ' + label + ' prototype');
    const actual = keys(value);
    check(actual.length === allowed.length, 'Invalid ' + label + ' fields');
    const out = create(null);
    for (let i = 0; i < actual.length; i++) {
      const key = actual[i];
      let found = false;
      for (let j = 0; j < allowed.length; j++) if (key === allowed[j]) found = true;
      check(typeof key === 'string' && found, 'Invalid ' + label + ' field');
      put(out, key, data(value, key, label));
    }
    return out;
  }
  // Validate scalar Unicode and count UTF-8 bytes without TextEncoder, Buffer,
  // coercion, replacement characters, or an allocation proportional to input.
  function unicode(value, maxBytes) {
    let count = 0, bytes = 0;
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = value.charCodeAt(i + 1);
        check(next >= 0xdc00 && next <= 0xdfff, 'Invalid Unicode surrogate');
        i++; bytes += 4;
      } else {
        check(c < 0xdc00 || c > 0xdfff, 'Invalid Unicode surrogate');
        bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
      }
      count++;
      check(bytes <= maxBytes, 'Preset exceeds UTF-8 byte limit');
    }
    return count;
  }
  function name(value) {
    check(typeof value === 'string' && value.length <= MAX_STRING, 'Invalid preset name');
    unicode(value, MAX_BYTES);
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      check(c > 0x1f && !(c >= 0x7f && c <= 0x9f), 'Preset name contains a control character');
    }
    const trimmed = value.trim();
    const count = unicode(trimmed, MAX_BYTES);
    check(count >= 1 && count <= 48, 'Preset name must contain 1 to 48 Unicode code points');
    return trimmed;
  }
  function number(value, low, high, label) {
    check(typeof value === 'number' && finite(value) && value >= low && value <= high, 'Invalid ' + label);
    return value === 0 ? 0 : value;
  }
  function neutralBeauty() {
    const result = create(null);
    for (let i = 0; i < BEAUTY.length; i++) put(result, BEAUTY[i], BEAUTY[i] === 'palette' ? 'natural' : 0);
    return result;
  }
  // Descriptor-only cloning prevents the trusted tone validator from seeing an
  // accessor, sparse array, symbol, hidden property, custom prototype, or cycle.
  function cloneJSON(value, depth, budget) {
    check(depth <= MAX_DEPTH, 'Preset nesting limit exceeded');
    check(++budget.nodes <= MAX_NODES, 'Preset node limit exceeded');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      check(finite(value), 'Invalid finite JSON number');
      return value === 0 ? 0 : value;
    }
    if (typeof value === 'string') {
      check(value.length <= MAX_STRING, 'Preset string limit exceeded');
      unicode(value, MAX_BYTES);
      return value;
    }
    check(typeof value === 'object', 'Invalid JSON value');
    const array = isArray(value), p = proto(value);
    check(array ? p === arrayPrototype : p === null || p === objectPrototype, 'Invalid JSON prototype');
    const actual = keys(value);
    check(actual.length <= MAX_NODES, 'Preset node limit exceeded');
    const out = array ? [] : create(null);
    if (array) {
      const size = descriptor(value, 'length');
      check(size !== undefined && own(size, 'value') && Number.isSafeInteger(size.value) && size.value >= 0 && size.value < MAX_NODES, 'Invalid JSON array length');
      check(actual.length === size.value + 1, 'Invalid JSON array fields');
      for (let i = 0; i < size.value; i++) put(out, String(i), cloneJSON(data(value, String(i), 'array element'), depth + 1, budget));
    } else {
      for (let i = 0; i < actual.length; i++) {
        const key = actual[i];
        check(typeof key === 'string' && !poison(key), 'Invalid JSON object field');
        check(key.length <= MAX_STRING, 'Preset key limit exceeded');
        unicode(key, MAX_BYTES);
        put(out, key, cloneJSON(data(value, key, 'object field'), depth + 1, budget));
      }
    }
    return out;
  }
  // The injected validator uses ordinary array methods and object assignments.
  // Refuse accessor-polluted built-in prototypes before crossing that boundary.
  // Native __proto__ is never read or written and is the sole permitted accessor.
  function safeToneRealm() {
    const prototypes = [objectPrototype, arrayPrototype];
    for (let i = 0; i < prototypes.length; i++) {
      const all = keys(prototypes[i]);
      for (let j = 0; j < all.length; j++) {
        const d = descriptor(prototypes[i], all[j]);
        check(own(d, 'value') || (i === 0 && all[j] === '__proto__'), 'Unsafe accessor on a tone validator prototype');
      }
    }
  }

  // A bounded JSON parser is used instead of JSON.parse so duplicate keys cannot
  // disappear, including aliases such as "name" and "\\u006eame".
  function readJSON(text) {
    check(typeof text === 'string', 'Preset text must be a string');
    check(text.length <= MAX_BYTES, 'Preset exceeds UTF-8 byte limit');
    unicode(text, MAX_BYTES); // Before tokenization or allocating parsed objects.
    let position = 0, nodes = 0, tokens = 0;
    function token() { check(++tokens <= MAX_TOKENS, 'Preset token limit exceeded'); }
    function whitespace() {
      while (position < text.length) {
        const c = text.charCodeAt(position);
        if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) position++;
        else break;
      }
    }
    function string() {
      token();
      check(text[position++] === '"', 'Expected JSON string');
      const start = position;
      let out = '';
      while (position < text.length) {
        check(position - start <= MAX_STRING, 'Preset string token limit exceeded');
        let c = text[position++];
        if (c === '"') { unicode(out, MAX_BYTES); return out; }
        check(c.charCodeAt(0) >= 0x20, 'Unescaped JSON control character');
        if (c === '\\') {
          check(position < text.length, 'Incomplete JSON escape');
          c = text[position++];
          if (c === '"' || c === '\\' || c === '/') out += c;
          else if (c === 'b') out += '\b';
          else if (c === 'f') out += '\f';
          else if (c === 'n') out += '\n';
          else if (c === 'r') out += '\r';
          else if (c === 't') out += '\t';
          else if (c === 'u') {
            check(position + 4 <= text.length, 'Incomplete Unicode escape');
            let code = 0;
            for (let i = 0; i < 4; i++) {
              const digit = text.charCodeAt(position++);
              const n = digit >= 48 && digit <= 57 ? digit - 48 : digit >= 65 && digit <= 70 ? digit - 55 : digit >= 97 && digit <= 102 ? digit - 87 : -1;
              check(n >= 0, 'Invalid Unicode escape'); code = code * 16 + n;
            }
            out += String.fromCharCode(code);
          } else check(false, 'Invalid JSON escape');
        } else out += c;
      }
      check(false, 'Unterminated JSON string');
    }
    function digit(c) { return c >= '0' && c <= '9'; }
    function numeric() {
      token();
      const start = position;
      let nonzero = false;
      if (text[position] === '-') position++;
      if (text[position] === '0') position++;
      else {
        check(text[position] >= '1' && text[position] <= '9', 'Invalid JSON number');
        while (digit(text[position])) { if (text[position] !== '0') nonzero = true; position++; }
      }
      if (text[position] === '.') {
        position++; check(digit(text[position]), 'Invalid JSON fraction');
        while (digit(text[position])) { if (text[position] !== '0') nonzero = true; position++; }
      }
      if (text[position] === 'e' || text[position] === 'E') {
        position++;
        if (text[position] === '+' || text[position] === '-') position++;
        check(digit(text[position]), 'Invalid JSON exponent');
        while (digit(text[position])) position++;
      }
      check(position - start <= MAX_NUMBER, 'Preset number token limit exceeded');
      const value = Number(text.slice(start, position));
      check(finite(value) && !(value === 0 && nonzero), 'JSON number overflow or underflow');
      return value === 0 ? 0 : value;
    }
    function value(depth) {
      check(depth <= MAX_DEPTH, 'Preset nesting limit exceeded');
      check(++nodes <= MAX_NODES, 'Preset node limit exceeded');
      whitespace();
      const c = text[position];
      if (c === '"') return string();
      if (c === '{') {
        token(); position++; whitespace();
        const result = create(null);
        if (text[position] === '}') { token(); position++; return result; }
        while (true) {
          const key = string();
          check(!poison(key), 'Forbidden JSON key');
          check(!own(result, key), 'Duplicate JSON key');
          whitespace(); check(text[position++] === ':', 'Expected JSON colon'); token();
          put(result, key, value(depth + 1)); whitespace();
          const end = text[position++]; token();
          if (end === '}') return result;
          check(end === ',', 'Expected JSON object separator'); whitespace();
        }
      }
      if (c === '[') {
        token(); position++; whitespace();
        const result = [];
        let count = 0;
        if (text[position] === ']') { token(); position++; return result; }
        while (true) {
          put(result, String(count++), value(depth + 1)); whitespace();
          const end = text[position++]; token();
          if (end === ']') return result;
          check(end === ',', 'Expected JSON array separator'); whitespace();
        }
      }
      if (c === 't' && text.slice(position, position + 4) === 'true') { token(); position += 4; return true; }
      if (c === 'f' && text.slice(position, position + 5) === 'false') { token(); position += 5; return false; }
      if (c === 'n' && text.slice(position, position + 4) === 'null') { token(); position += 4; return null; }
      return numeric();
    }
    const result = value(1);
    whitespace(); check(position === text.length, 'Trailing JSON content');
    return result;
  }

  function quote(value) {
    let result = '"';
    for (let i = 0; i < value.length; i++) {
      const c = value[i], n = value.charCodeAt(i);
      if (c === '"' || c === '\\') result += '\\' + c;
      else if (n < 0x20) result += '\\u' + ('0000' + n.toString(16)).slice(-4);
      else result += c;
    }
    return result + '"';
  }
  // Only called on owned validated records/arrays. No toJSON or user hooks.
  function writeJSON(value) {
    if (value === null) return 'null';
    if (typeof value === 'string') return quote(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    let result = '';
    if (isArray(value)) {
      const length = descriptor(value, 'length').value;
      for (let i = 0; i < length; i++) result += (i ? ',' : '') + writeJSON(data(value, String(i), 'array element'));
      return '[' + result + ']';
    }
    const all = keys(value);
    for (let i = 0; i < all.length; i++) result += (i ? ',' : '') + quote(all[i]) + ':' + writeJSON(data(value, all[i], 'object field'));
    return '{' + result + '}';
  }

  function createCodec(options) {
    const opt = record(options, options !== null && typeof options === 'object' && own(options, 'lightBalance') ? ['advancedTone', 'levels', 'lightBalance'] : ['advancedTone', 'levels'], 'codec options');
    check(opt.advancedTone !== null && typeof opt.advancedTone === 'object', 'Expected trusted advancedTone module');
    const validator = data(opt.advancedTone, 'validate', 'advancedTone validate');
    check(typeof validator === 'function', 'Expected advancedTone.validate');
    check(opt.levels !== null && typeof opt.levels === 'object', 'Expected trusted levels module');
    const levelsValidator = data(opt.levels, 'validate', 'levels validate');
    check(typeof levelsValidator === 'function', 'Expected levels.validate');
    let lightValidator = null;
    if (own(opt, 'lightBalance')) {
      check(opt.lightBalance !== null && typeof opt.lightBalance === 'object', 'Expected trusted lightBalance module');
      lightValidator = data(opt.lightBalance, 'validate', 'lightBalance validate');
      check(typeof lightValidator === 'function', 'Expected lightBalance.validate');
    }
    // A neutral v3 recipe is readable without the optional new module. Bound and
    // whitelist it here too, so missing support never silently drops active edits.
    function lightRecipe(value) {
      const r = record(value, ['version', 'shadows', 'highlights', 'whiteBalance'], 'lightBalance');
      check(r.version === 1, 'Unsupported lightBalance version');
      const wb = record(r.whiteBalance, ['r', 'g', 'b'], 'white balance');
      const clean = create(null), gains = create(null);
      put(clean, 'version', 1);
      put(clean, 'shadows', number(r.shadows, -100, 100, 'shadows'));
      put(clean, 'highlights', number(r.highlights, -100, 100, 'highlights'));
      const channels = ['r', 'g', 'b'];
      for (let i = 0; i < channels.length; i++) put(gains, channels[i], number(wb[channels[i]], 0.25, 4, 'white balance gain'));
      put(clean, 'whiteBalance', gains);
      return clean;
    }
    function validate(document) {
      const doc = record(document, ['format', 'version', 'name', 'controls'], 'preset');
      check(doc.format === FORMAT, 'Unsupported preset format');
      check(doc.version === 1 || doc.version === 2 || doc.version === 3, 'Unsupported preset version');
      const cleanName = name(doc.name);
      const controls = record(doc.controls, doc.version === 1 ? ['basic', 'beauty', 'advancedTone'] : doc.version === 2 ? ['basic', 'beauty', 'levels', 'advancedTone'] : ['basic', 'beauty', 'lightBalance', 'levels', 'advancedTone'], 'controls');
      const basic = record(controls.basic, BASIC, 'basic controls');
      const beauty = record(controls.beauty, BEAUTY, 'beauty controls');
      const cleanBasic = create(null), cleanBeauty = create(null);
      for (let i = 0; i < BASIC.length; i++) put(cleanBasic, BASIC[i], number(basic[BASIC[i]], -100, 100, BASIC[i]));
      for (let i = 0; i < BEAUTY.length - 1; i++) {
        const key = BEAUTY[i]; put(cleanBeauty, key, number(beauty[key], key === 'warmth' ? -100 : 0, 100, key));
      }
      check(beauty.palette === 'natural' || beauty.palette === 'peach' || beauty.palette === 'rose', 'Invalid beauty palette');
      put(cleanBeauty, 'palette', beauty.palette);
      let tone = null;
      if (controls.advancedTone !== null) {
        const source = cloneJSON(controls.advancedTone, 3, { nodes: 0 });
        safeToneRealm();
        tone = cloneJSON(validator(source), 3, { nodes: 0 });
        check(tone !== null && typeof tone === 'object' && !isArray(tone), 'Invalid advanced tone validator result');
      }
      let levels = null;
      if (doc.version >= 2 && controls.levels !== null) {
        const source = cloneJSON(controls.levels, 3, { nodes: 0 });
        safeToneRealm();
        levels = cloneJSON(levelsValidator(source), 3, { nodes: 0 });
        check(levels !== null && typeof levels === 'object' && !isArray(levels), 'Invalid levels validator result');
      }
      let lightBalance = null;
      if (doc.version === 3 && controls.lightBalance !== null) {
        const source = lightRecipe(cloneJSON(controls.lightBalance, 3, { nodes: 0 }));
        const active = source.shadows !== 0 || source.highlights !== 0 || source.whiteBalance.r !== 1 || source.whiteBalance.g !== 1 || source.whiteBalance.b !== 1;
        check(!active || lightValidator !== null, 'Active lightBalance requires the trusted lightBalance module');
        if (lightValidator !== null) {
          safeToneRealm();
          lightBalance = lightRecipe(cloneJSON(lightValidator(source), 3, { nodes: 0 }));
        } else lightBalance = source;
      }
      const cleanControls = create(null), result = create(null);
      put(cleanControls, 'basic', cleanBasic); put(cleanControls, 'beauty', cleanBeauty); put(cleanControls, 'lightBalance', lightBalance); put(cleanControls, 'levels', levels); put(cleanControls, 'advancedTone', tone);
      put(result, 'format', FORMAT); put(result, 'version', 3); put(result, 'name', cleanName); put(result, 'controls', cleanControls);
      return result;
    }
    function defaults(presetName) {
      const basic = create(null);
      for (let i = 0; i < BASIC.length; i++) put(basic, BASIC[i], 0);
      return validate({ format: FORMAT, version: 3, name: presetName, controls: { basic: basic, beauty: neutralBeauty(), lightBalance: null, levels: null, advancedTone: null } });
    }
    function parse(text) { return validate(readJSON(text)); }
    function stringify(document) {
      const result = writeJSON(validate(document));
      unicode(result, MAX_BYTES);
      return result;
    }
    function hasPortraitEffect(document) {
      const beauty = validate(document).controls.beauty;
      for (let i = 0; i < BEAUTY.length - 1; i++) if (beauty[BEAUTY[i]] !== 0) return true;
      return false;
    }
    function colorOnly(document) {
      const result = validate(document);
      put(result.controls, 'beauty', neutralBeauty());
      return result;
    }
    return Object.freeze({ defaults: defaults, validate: validate, parse: parse, stringify: stringify, hasPortraitEffect: hasPortraitEffect, colorOnly: colorOnly });
  }
  return Object.freeze({ createCodec: createCodec });
});
