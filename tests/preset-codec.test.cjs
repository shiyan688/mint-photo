'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createCodec } = require('../app/src/main/assets/preset-codec.js');
const tonePath = process.env.MINT_ADVANCED_TONE_PATH || path.join(__dirname, '../app/src/main/assets/advanced-tone.js');
const advancedTone = require(tonePath);
const levelsPath=path.join(__dirname,'../app/src/main/assets/levels.js'),levels=require(levelsPath),levelsSource=fs.readFileSync(levelsPath,'utf8');
const codec = createCodec({ advancedTone, levels });
const source = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/preset-codec.js'), 'utf8');
const toneSource = fs.readFileSync(tonePath, 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const fresh = () => plain(codec.defaults('Portrait'));
const toned = () => { const p = fresh(); p.controls.advancedTone = advancedTone.defaults(); return p; };
const basicKeys = ['exposure', 'contrast', 'saturation', 'temperature'];
const beautyKeys = ['smooth', 'brighten', 'warmth', 'underEye', 'redness', 'lip', 'blush'];
const attemptAll = (input, expected) => {
  for (const method of ['validate', 'stringify', 'hasPortraitEffect', 'colorOnly']) assert.throws(() => codec[method](input), expected, method);
};

test('mobile browser and Node use the same frozen UMD bytes', () => {
  assert.equal(require('node:crypto').createHash('sha256').update(source).digest('hex'),'b03d59aab2fa6b32639ceb1ddc0d22e680adde21a2834aece6cea9e79645e5d6');
  const context = vm.createContext({});
  vm.runInContext(toneSource, context); vm.runInContext(levelsSource, context);
  vm.runInContext(source, context);
  assert.equal(vm.runInContext('typeof MintAdjustmentPreset.createCodec', context), 'function');
  assert.equal(vm.runInContext('MintAdjustmentPreset.createCodec({advancedTone:MintAdvancedTone,levels:MintLevels}).stringify(MintAdjustmentPreset.createCodec({advancedTone:MintAdvancedTone,levels:MintLevels}).defaults("Portrait"))', context), codec.stringify(codec.defaults('Portrait')));
  assert.deepEqual(Object.keys(createCodec({ advancedTone, levels })), ['defaults', 'validate', 'parse', 'stringify', 'hasPortraitEffect', 'colorOnly']);
});

test('neutral defaults have the exact v3 schema and deterministic roundtrip', () => {
  const p = codec.defaults('  Portrait  ');
  assert.deepEqual(plain(p), {
    format: 'mint-adjustment-preset', version: 3, name: 'Portrait',
    controls: {
      basic: { exposure: 0, contrast: 0, saturation: 0, temperature: 0 },
      beauty: { smooth: 0, brighten: 0, warmth: 0, underEye: 0, redness: 0, lip: 0, blush: 0, palette: 'natural' },
      lightBalance: null, levels: null, advancedTone: null
    }
  });
  assert.equal(codec.hasPortraitEffect(p), false);
  assert.deepEqual(codec.parse(codec.stringify(p)), p);
  assert.equal(codec.stringify(codec.parse(codec.stringify(p))), codec.stringify(p));
  assert.equal(codec.stringify(p).includes('\n'), false);
  assert.equal(Object.getPrototypeOf(p), null);
  assert.equal(Object.getPrototypeOf(p.controls), null);
  assert.notEqual(codec.defaults('Portrait'), codec.defaults('Portrait'));
  const original = fresh(); original.name = '  Portrait  ';
  assert.equal(codec.validate(original).name, 'Portrait');
  assert.equal(original.name, '  Portrait  ');
});

test('each basic, beauty and palette boundary is accepted', () => {
  for (const key of basicKeys) for (const n of [-100, -0.25, -0, 0, 0.25, 100, Number.MIN_VALUE]) {
    const p = fresh(); p.controls.basic[key] = n;
    assert.equal(codec.validate(p).controls.basic[key], n === 0 ? 0 : n);
    assert.equal(codec.parse(codec.stringify(p)).controls.basic[key], n === 0 ? 0 : n);
  }
  for (const key of beautyKeys) for (const n of key === 'warmth' ? [-100, -0.5, 0, 0.5, 100] : [0, 0.5, 100]) {
    const p = fresh(); p.controls.beauty[key] = n;
    assert.equal(codec.validate(p).controls.beauty[key], n);
  }
  for (const palette of ['natural', 'peach', 'rose']) { const p = fresh(); p.controls.beauty.palette = palette; assert.equal(codec.validate(p).controls.beauty.palette, palette); }
});

test('nonfinite, out-of-range and coercible control values are rejected', () => {
  for (const key of basicKeys) for (const value of [-100.0001, 100.0001, NaN, Infinity, -Infinity, '1', null, true, undefined, new Number(1), 1n]) {
    const p = fresh(); p.controls.basic[key] = value; attemptAll(p, TypeError);
  }
  for (const key of beautyKeys) for (const value of [key === 'warmth' ? -100.0001 : -0.0001, 100.0001, NaN, Infinity, '1', null, true, {}, []]) {
    const p = fresh(); p.controls.beauty[key] = value; attemptAll(p, TypeError);
  }
  for (const value of ['Natural', '', null, false, 0, {}, ['rose']]) { const p = fresh(); p.controls.beauty.palette = value; attemptAll(p, /palette/); }
});

test('format and schema version are exact, without coercion or future guessing', () => {
  for (const format of [null, 'mint-project', 'Mint-adjustment-preset', {}, 1]) { const p = fresh(); p.format = format; attemptAll(p, /format/); }
  for (const version of [0, 4, 1.1, -1, '1', null, true, NaN, Infinity]) { const p = fresh(); p.version = version; attemptAll(p, /version/); }
  for (const version of ['0', '4', '1.1', '"1"', 'null', 'true']) assert.throws(() => codec.parse(codec.stringify(fresh()).replace('"version":3', '"version":' + version)), /version/);
});

test('every structural and control field is mandatory', () => {
  const paths = [[], ['controls'], ['controls', 'basic'], ['controls', 'beauty']];
  for (const steps of paths) {
    let fixture = fresh(); for (const step of steps) fixture = fixture[step];
    for (const key of Object.keys(fixture)) {
      const p = fresh(); let target = p; for (const step of steps) target = target[step]; delete target[key];
      attemptAll(p, /fields/);
      assert.throws(() => codec.parse(JSON.stringify(p)), /fields/);
    }
  }
});

test('unknown fields and nonportable user/image/geometry state are never stripped', () => {
  const banned = ['photo', 'photos', 'image', 'path', 'filePath', 'id', 'timestamp', 'landmarks', 'mask', 'masks', 'strokes', 'geometry', 'reshape', 'faceId', 'future'];
  for (const steps of [[], ['controls'], ['controls', 'basic'], ['controls', 'beauty']]) for (const field of banned) {
    const p = fresh(); let target = p; for (const step of steps) target = target[step]; target[field] = 0;
    attemptAll(p, /fields/);
  }
  for (const steps of [[], ['curves'], ['hsl', 0]]) {
    const p = toned(); let target = p.controls.advancedTone; for (const step of steps) target = target[step]; target.reshape = 1;
    attemptAll(p, /field/);
  }
});

test('names are trimmed Unicode scalar strings of 1 to 48 code points', () => {
  for (const value of ['A', 'é', 'e\u0301', '名字', '😀'.repeat(48), 'x'.repeat(48), ' Quotes " \\ / ']) {
    const p = codec.defaults(value); assert.equal(p.name, value.trim()); assert.equal(codec.parse(codec.stringify(p)).name, value.trim());
  }
  for (const value of ['', '   ', '\u00a0', 'x'.repeat(49), '😀'.repeat(49), '\ud800', '\udc00', '\ud800x', 'x\udc00', null, 1, {}, new String('A'), ' '.repeat(4097)]) assert.throws(() => codec.defaults(value), TypeError);
  for (let c = 0; c <= 0x9f; c++) if (c <= 0x1f || c >= 0x7f) {
    assert.throws(() => codec.defaults('a' + String.fromCharCode(c) + 'b'), /control/);
    assert.throws(() => codec.defaults(String.fromCharCode(c) + 'a'), /control/);
  }
  assert.equal(codec.defaults('\u00a0A\u00a0').name, 'A');
});

test('advanced tone reuses the authored validator and preserves full recipes', () => {
  const p = toned();
  p.controls.advancedTone.curveMode = 'free';
  p.controls.advancedTone.curves.red = [0.2, 0.8, 0.3, 0.1, 0.9];
  p.controls.advancedTone.enabled = false;
  p.controls.advancedTone.strength = 0.375;
  p.controls.advancedTone.hsl[0] = { hue: -30, saturation: -100, luminance: 100 };
  p.controls.advancedTone.hsl[7] = { hue: 30, saturation: 100, luminance: -100 };
  const expected = advancedTone.validate(p.controls.advancedTone);
  assert.deepEqual(plain(codec.validate(p).controls.advancedTone), expected);
  assert.deepEqual(plain(codec.parse(codec.stringify(p)).controls.advancedTone), expected);
  assert.equal(codec.hasPortraitEffect(p), false);
  for (const mutate of [r => r.version = 2, r => r.curveMode = 'unknown', r => r.strength = 1.01, r => r.enabled = 1, r => r.curves.rgb = [0, .5, .25, .75, 1], r => r.curves.blue.pop(), r => r.hsl[0].hue = 31, r => r.hsl[0].saturation = -101]) {
    const bad = toned(); mutate(bad.controls.advancedTone); attemptAll(bad, TypeError);
  }
});

test('all object-returning APIs return fully owned copies with no source mutation', () => {
  const p = toned(); p.controls.beauty.smooth = 25; const before = JSON.stringify(p);
  for (const method of ['validate', 'colorOnly']) {
    const result = codec[method](p);
    assert.notEqual(result, p); assert.notEqual(result.controls, p.controls); assert.notEqual(result.controls.basic, p.controls.basic); assert.notEqual(result.controls.beauty, p.controls.beauty);
    assert.notEqual(result.controls.advancedTone, p.controls.advancedTone); assert.notEqual(result.controls.advancedTone.curves.red, p.controls.advancedTone.curves.red);
    assert.notEqual(result.controls.advancedTone.hsl[0], p.controls.advancedTone.hsl[0]);
    result.controls.basic.exposure = 10; result.controls.advancedTone.curves.red[1] = .9; result.controls.advancedTone.hsl[0].hue = 4;
  }
  codec.hasPortraitEffect(p); codec.stringify(p);
  assert.equal(JSON.stringify(p), before);
  const deepFreeze = v => { if (v && typeof v === 'object') { Object.freeze(v); for (const x of Object.values(v)) deepFreeze(x); } };
  deepFreeze(p); assert.doesNotThrow(() => codec.validate(p)); assert.doesNotThrow(() => codec.colorOnly(p));
});

test('hasPortraitEffect checks every numeric beauty control and ignores palette alone', () => {
  for (const key of beautyKeys) {
    const p = fresh(); p.controls.beauty[key] = key === 'warmth' ? -.001 : .001;
    assert.equal(codec.hasPortraitEffect(p), true, key);
  }
  for (const palette of ['peach', 'rose']) { const p = toned(); p.controls.beauty.palette = palette; p.controls.basic.exposure = 100; p.controls.advancedTone.curves.rgb[1] = .5; assert.equal(codec.hasPortraitEffect(p), false); }
});

test('colorOnly is a complete valid preset with all portrait controls neutral', () => {
  const p = toned(); p.name = 'Evening'; p.controls.basic.temperature = -13.25;
  for (const key of beautyKeys) p.controls.beauty[key] = 35;
  p.controls.beauty.palette = 'rose'; const before = JSON.stringify(p);
  const result = codec.colorOnly(p);
  assert.deepEqual(result, codec.validate(result));
  assert.deepEqual(plain(result.controls.basic), p.controls.basic);
  assert.deepEqual(plain(result.controls.advancedTone), p.controls.advancedTone);
  assert.deepEqual(result.controls.beauty, codec.defaults('Neutral').controls.beauty);
  assert.equal(result.name, 'Evening'); assert.equal(codec.hasPortraitEffect(result), false);
  assert.equal(JSON.stringify(p), before);
});

test('duplicate JSON keys, including escaped aliases, are rejected at every depth', () => {
  const json = codec.stringify(toned());
  for (const [from, to] of [
    ['"name":"Portrait"', '"name":"Portrait","name":"Other"'],
    ['"name":"Portrait"', '"name":"Portrait","\\u006eame":"Other"'],
    ['"exposure":0', '"exposure":0,"expos\\u0075re":10'],
    ['"palette":"natural"', '"palette":"natural","palette":"rose"'],
    ['"enabled":true', '"enabled":true,"\\u0065nabled":false'],
    ['"hue":0', '"hue":0,"hue":1'],
    ['"format":"mint-adjustment-preset"', '"😀":0,"\\ud83d\\ude00":0,"format":"mint-adjustment-preset"']
  ]) assert.throws(() => codec.parse(json.replace(from, to)), /Duplicate JSON key/);
});

test('poison keys are rejected without pollution, including escaped aliases', () => {
  for (const spelling of ['__proto__', '\\u005f_proto__', 'constructor', 'prototype']) {
    assert.throws(() => codec.parse('{"' + spelling + '":{"polluted":true}}'), /Forbidden JSON key/);
  }
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const p = toned(); Object.defineProperty(p.controls.advancedTone, key, { value: {}, enumerable: true }); attemptAll(p, /field/);
  }
  assert.equal(Object.prototype.polluted, undefined);
});

test('safe JSON Unicode parsing distinguishes escaped scalar pairs and lone surrogates', () => {
  const json = codec.stringify(fresh());
  assert.equal(codec.parse(json.replace('Portrait', '\\ud83d\\ude00')).name, '😀');
  assert.equal(codec.parse(json.replace('Portrait', '\\u00e9')).name, 'é');
  for (const value of ['\\ud800', '\\udc00', '\\ud800x', 'x\\udc00', '\\ud800\\ud800', '\\udc00\\ud800', '\\uZZZZ', '\\u123', '\\x41']) assert.throws(() => codec.parse(json.replace('Portrait', value)), TypeError);
  for (const raw of ['\ud800', '\udc00', '\ud800a']) assert.throws(() => codec.parse(json.replace('Portrait', raw)), /Unicode/);
  assert.throws(() => codec.parse('{"\\ud800":0}'), /Unicode/);
});

test('JSON numeric grammar, overflow, underflow and negative zero are safe', () => {
  const json = codec.stringify(fresh());
  const withNumber = n => json.replace('"exposure":0', '"exposure":' + n);
  for (const [text, expected] of [['1e2', 100], ['-1E+2', -100], ['1.25', 1.25], ['1e-2', .01], ['-0', 0], ['-0.000e+20', 0], ['5e-324', Number.MIN_VALUE], ['0e99999', 0]]) {
    assert.equal(codec.parse(withNumber(text)).controls.basic.exposure, expected);
  }
  for (const text of ['01', '-01', '.1', '1.', '+1', '-', '- 1', '1e', '1e+', '0x10', 'NaN', 'Infinity', '1e309', '-1e309', '1e-324', '-1e-999', '0.0001e-999', '9'.repeat(129), '1_0', '1 2']) assert.throws(() => codec.parse(withNumber(text)), TypeError, text);
  assert.equal(codec.stringify(codec.parse(withNumber('-0'))), json);
});

test('JSON grammar rejects malformed, truncated, trailing, BOM and nonstring input', () => {
  const json = codec.stringify(fresh());
  for (const text of ['', ' ', '{', '[', 'null', 'true', '0', '[]', '{}', '\ufeff' + json, json + '{}', json + 'x', json.replace('"Portrait"', '"Por\ntrait"'), json.slice(0, -1), json.replace('"controls":', '"controls"'), json.replace('"exposure":0,', '"exposure":0,,'), json.replace('"advancedTone":null}', '"advancedTone":null,}'), json.replace('"name"', "'name'"), json.replace('"exposure":0', '"exposure":/* hi */0')]) assert.throws(() => codec.parse(text), TypeError);
  for (const text of [null, undefined, 1, {}, [], Buffer.from(json), new String(json)]) assert.throws(() => codec.parse(text), /must be a string/);
  assert.deepEqual(codec.parse(' \t\r\n' + json + '\t\r\n '), codec.defaults('Portrait'));
});

test('64 KiB UTF-8 cap is checked before JSON parsing or validator execution', () => {
  let calls = 0;
  const spy = createCodec({ levels, advancedTone: { validate() { calls++; throw new Error('must not run'); } } });
  const ascii = codec.stringify(fresh());
  const padded = ascii + ' '.repeat(65536 - Buffer.byteLength(ascii));
  assert.equal(Buffer.byteLength(padded), 65536); assert.doesNotThrow(() => codec.parse(padded));
  assert.throws(() => spy.parse(padded + ' '), /UTF-8 byte limit/);
  assert.throws(() => spy.parse('x'.repeat(65537)), /UTF-8 byte limit/);
  const emoji = codec.stringify(codec.defaults('😀'));
  const paddedEmoji = emoji + ' '.repeat(65536 - Buffer.byteLength(emoji));
  assert.ok(paddedEmoji.length < 65536); assert.doesNotThrow(() => codec.parse(paddedEmoji));
  assert.throws(() => spy.parse(paddedEmoji + ' '), /UTF-8 byte limit/);
  assert.throws(() => spy.parse('"' + '😀'.repeat(16384) + '"'), /UTF-8 byte limit/);
  assert.equal(calls, 0);
});

test('depth, node, string-token and number-token budgets bound hostile JSON', () => {
  assert.throws(() => codec.parse('['.repeat(13) + '0' + ']'.repeat(13)), /nesting limit/);
  assert.throws(() => codec.parse('[' + Array(513).fill('0').join(',') + ']'), /node limit/);
  assert.throws(() => codec.parse('{' + Array.from({ length: 420 }, (_, i) => '"k' + i + '":{}').join(',') + '}'), /token limit/);
  assert.throws(() => codec.parse('{"x":"' + 'x'.repeat(4097) + '"}'), /string token limit/);
  assert.throws(() => codec.parse('1' + '0'.repeat(128)), /number token limit/);
  const p = toned(); let v = p.controls.advancedTone; for (let i = 0; i < 14; i++) { v.next = {}; v = v.next; }
  assert.throws(() => codec.validate(p), /nesting limit/);
  const wide = toned(); wide.controls.advancedTone.extra = Array(512).fill(0); assert.throws(() => codec.validate(wide), /node limit|array length/);
  const cyclic = toned(); cyclic.controls.advancedTone.self = cyclic.controls.advancedTone; assert.throws(() => codec.validate(cyclic), /nesting limit|node limit/);
});

test('custom and inherited prototypes, dates, boxed values and class instances fail closed', () => {
  for (const value of [[], new Date(), new Map(), new Set(), Object.create(fresh()), new (class Preset {})(), 1, 'preset', null, undefined]) attemptAll(value, TypeError);
  for (const steps of [['controls'], ['controls', 'basic'], ['controls', 'beauty'], ['controls', 'advancedTone']]) {
    const p = toned(); let target = p; for (let i = 0; i < steps.length - 1; i++) target = target[steps[i]];
    const key = steps.at(-1); target[key] = Object.assign(Object.create({ inherited: 1 }), target[key]); attemptAll(p, /prototype/);
  }
  const p = toned(); Object.setPrototypeOf(p.controls.advancedTone.hsl, null); attemptAll(p, /prototype/);
});

test('accessor, nonenumerable, symbol and unknown properties never execute getters', () => {
  let calls = 0;
  for (const steps of [[], ['controls'], ['controls', 'basic'], ['controls', 'beauty'], ['controls', 'advancedTone'], ['controls', 'advancedTone', 'curves'], ['controls', 'advancedTone', 'hsl', 0]]) {
    const fixture = toned(); let f = fixture; for (const step of steps) f = f[step];
    for (const key of Object.keys(f)) for (const mode of ['accessor', 'hidden']) {
      const p = toned(); let target = p; for (const step of steps) target = target[step];
      const d = mode === 'accessor' ? { get() { calls++; throw new Error('Getter executed'); }, enumerable: true } : { value: target[key], enumerable: false };
      Object.defineProperty(target, key, d); attemptAll(p, TypeError);
    }
    for (const type of ['symbol', 'hidden-extra', 'getter-extra']) {
      const p = toned(); let target = p; for (const step of steps) target = target[step];
      if (type === 'symbol') target[Symbol('hidden')] = 1;
      else Object.defineProperty(target, 'extra', { get() { calls++; throw new Error('Getter executed'); }, enumerable: type !== 'hidden-extra' });
      attemptAll(p, TypeError);
    }
  }
  assert.equal(calls, 0);
});

test('sparse, accessor, hidden, symbolic and extra-key arrays are rejected without reading elements', () => {
  let calls = 0;
  for (const locate of [p => p.controls.advancedTone.curves.rgb, p => p.controls.advancedTone.hsl]) for (const mode of ['hole', 'accessor', 'hidden', 'extra', 'symbol', 'toJSON']) {
    const p = toned(), a = locate(p);
    if (mode === 'hole') delete a[0];
    if (mode === 'accessor') Object.defineProperty(a, '0', { enumerable: true, get() { calls++; throw new Error('Getter executed'); } });
    if (mode === 'hidden') Object.defineProperty(a, '0', { value: a[0], enumerable: false });
    if (mode === 'extra') a.extra = 1;
    if (mode === 'symbol') a[Symbol('extra')] = 1;
    if (mode === 'toJSON') Object.defineProperty(a, 'toJSON', { get() { calls++; throw new Error('Getter executed'); } });
    attemptAll(p, TypeError);
  }
  assert.equal(calls, 0);
});

test('inherited hostile getters and setters stay uncalled in an isolated VM', () => {
  const context = vm.createContext({ toneSource, levelsSource, codecSource: source });
  const result = vm.runInContext(`
    eval(toneSource); eval(levelsSource); eval(codecSource);
    const c = MintAdjustmentPreset.createCodec({advancedTone:MintAdvancedTone,levels:MintLevels});
    const p = c.defaults('Safe');
    const tone = MintAdvancedTone.defaults();
    const json = c.stringify(p);
    let hits = 0;
    const property = Object.assign(Object.create(null), {configurable:true, get(){hits++;throw new Error('Inherited getter executed');}, set(){hits++;throw new Error('Inherited setter executed');}});
    for (const key of ['toJSON','value','smooth','red','0','polluted','get','set']) Object.defineProperty(Object.prototype,key,property);
    Object.defineProperty(Array.prototype,'constructor',property);
    let neutralOK = false, toneRejected = false, accessorRejected = false, inheritedRejected = false;
    try {
      const output = c.parse(json);
      neutralOK = c.stringify(output) === json && !c.hasPortraitEffect(output) && c.stringify(c.colorOnly(output)) === json;
      p.controls.advancedTone = tone;
      try { c.validate(p); } catch(e) { toneRejected = e.message.includes('prototype'); }
      const ownAccessor = c.defaults('Own'); Object.defineProperty(ownAccessor,'name',Object.assign(Object.create(null),{enumerable:true,get(){hits++;return 'bad';}}));
      try { c.validate(ownAccessor); } catch(e) { accessorRejected = true; }
      const bad = Object.create({get format(){hits++;return 'mint-adjustment-preset';}});
      try { c.validate(bad); } catch(e) { inheritedRejected = true; }
    } finally {
      for (const key of ['toJSON','value','smooth','red','0','polluted','get','set']) delete Object.prototype[key];
      Object.defineProperty(Array.prototype,'constructor',Object.assign(Object.create(null),{value:Array,writable:true,configurable:true}));
    }
    JSON.stringify({hits,neutralOK,toneRejected,accessorRejected,inheritedRejected});
  `, context);
  assert.deepEqual(JSON.parse(result), { hits: 0, neutralOK: true, toneRejected: true, accessorRejected: true, inheritedRejected: true });
});

test('poisoned JSON.parse/stringify and inherited toJSON cannot be dispatched', () => {
  const context = vm.createContext({ toneSource, levelsSource, codecSource: source });
  assert.equal(vm.runInContext(`
    eval(toneSource); eval(levelsSource); eval(codecSource);
    const c = MintAdjustmentPreset.createCodec({advancedTone:MintAdvancedTone,levels:MintLevels});
    const p = c.defaults('Safe');
    JSON.parse = JSON.stringify = function(){throw new Error('JSON hook executed');};
    Object.defineProperty(Object.prototype,'toJSON',{get(){throw new Error('toJSON getter executed');}});
    c.stringify(c.parse(c.stringify(p))) === c.stringify(p);
  `, context), true);
});

test('dependency injection requires an own data-property validator and no coercion', () => {
  let calls = 0;
  for (const value of [undefined, null, {}, { lightBalance: null, levels: null, advancedTone: null }, { advancedTone: {} }, { advancedTone: { validate: 1 } }, { advancedTone, extra: true }]) assert.throws(() => createCodec(value), TypeError);
  const dependency = {}; Object.defineProperty(dependency, 'validate', { enumerable: true, get() { calls++; return advancedTone.validate; } });
  assert.throws(() => createCodec({ levels, advancedTone: dependency }), /data property/);
  const options = { levels }; Object.defineProperty(options, 'advancedTone', { enumerable: true, get() { calls++; return advancedTone; } });
  assert.throws(() => createCodec(options), /data property/);
  assert.equal(calls, 0);
});


test('inherited descriptor-field getters installed before codec initialization remain uncalled', () => {
  const context = vm.createContext({ toneSource, levelsSource, codecSource: source });
  assert.equal(vm.runInContext(`
    eval(toneSource); eval(levelsSource);
    let hits = 0;
    const property = Object.assign(Object.create(null), {configurable:true,get(){hits++;throw new Error('Inherited getter');}});
    for (const key of ['get','set','value','enumerable','writable','configurable','toJSON']) Object.defineProperty(Object.prototype,key,property);
    let success = false;
    try {
      eval(codecSource);
      const c = MintAdjustmentPreset.createCodec({advancedTone:MintAdvancedTone,levels:MintLevels});
      const p = c.defaults('Safe');
      success = c.parse(c.stringify(p)).name === 'Safe';
    } finally {
      for (const key of ['get','set','value','enumerable','writable','configurable','toJSON']) delete Object.prototype[key];
    }
    success && hits === 0;
  `, context), true);
});

test('deterministic valid-preset roundtrip corpus and grammar mutation corpus', () => {
  let state = 0x52d861f1;
  function random() { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; }
  for (let sample = 0; sample < 250; sample++) {
    const p = sample % 2 ? toned() : fresh();
    p.name = ['Daylight', '名字', '😀', 'é', 'A \\ \"'][sample % 5] + sample;
    for (const key of basicKeys) p.controls.basic[key] = random() * 200 - 100;
    for (const key of beautyKeys) p.controls.beauty[key] = key === 'warmth' ? random() * 200 - 100 : random() * 100;
    p.controls.beauty.palette = ['natural', 'peach', 'rose'][sample % 3];
    if (p.controls.advancedTone) {
      const r = p.controls.advancedTone; r.curveMode = 'free'; r.strength = random();
      for (const key of ['rgb', 'red', 'green', 'blue']) r.curves[key] = Array.from({ length: 5 }, random);
      for (const band of r.hsl) { band.hue = random() * 60 - 30; band.saturation = random() * 200 - 100; band.luminance = random() * 200 - 100; }
    }
    assert.deepEqual(codec.parse(codec.stringify(p)), codec.validate(p));
  }
  const base = codec.stringify(fresh()), inserts = ['{', '}', '[', ']', ':', ',', '"', '\\', ' ', '0', 'e', '-', '\n', 'x'];
  for (let sample = 0; sample < 1500; sample++) {
    const offset = Math.floor(random() * base.length), insert = inserts[Math.floor(random() * inserts.length)];
    const text = base.slice(0, offset) + insert + base.slice(offset + (sample % 2));
    let accepted = false;
    try { codec.parse(text); accepted = true; } catch (error) { assert.ok(error instanceof TypeError); }
    if (accepted) assert.doesNotThrow(() => JSON.parse(text), 'Codec must never accept invalid JSON syntax');
  }
});
