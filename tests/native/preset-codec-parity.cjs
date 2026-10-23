'use strict';

// No downloads or test dependencies. Defaults to shipped assets; an explicit source
// directory tests the actual candidate codec and validators before asset promotion.
// node tests/native/preset-codec-parity.cjs /absolute/candidate/src
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const source = path.resolve(process.argv[2] || path.join(root, 'app/src/main/assets'));
const modules = {};
for (const name of ['preset-codec', 'advanced-tone', 'levels', 'light-balance']) {
  const file = ['cjs', 'js'].map(ext => path.join(source, `${name}.${ext}`)).find(file => fs.existsSync(file));
  assert.ok(file, `Missing ${name} in ${source}`);
  modules[name] = { file, api: require(file), sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
}
const codec = modules['preset-codec'].api.createCodec({
  advancedTone: modules['advanced-tone'].api,
  levels: modules.levels.api,
  lightBalance: modules['light-balance'].api
});
assert.equal(codec.defaults('Parity').version, 3, 'This regression requires the actual v3 codec');
const clone = value => JSON.parse(JSON.stringify(value));
const light = { version: 1, shadows: 0, highlights: 0, whiteBalance: { r: 1, g: 1, b: 1 } };
const active = { version: 1, shadows: 42.5, highlights: -31.25, whiteBalance: { r: 1.125, g: 1, b: .875 } };
const base = version => {
  const doc = clone(codec.defaults('自然柔光 🌿'));
  doc.version = version;
  if (version < 3) delete doc.controls.lightBalance;
  if (version < 2) delete doc.controls.levels;
  return doc;
};
const full = version => {
  const doc = base(version);
  doc.controls.advancedTone = modules['advanced-tone'].api.defaults();
  if (version >= 2) doc.controls.levels = modules.levels.api.defaults();
  if (version === 3) doc.controls.lightBalance = clone(active);
  return doc;
};
const cases = [];
const add = (label, value, expected) => cases.push({ label, text: typeof value === 'string' ? value : JSON.stringify(value), expected });
const mutate = (label, doc, change, expected = false) => { const next = clone(doc); change(next); add(label, next, expected); };
const locate = (doc, fields) => fields.reduce((value, key) => value[key], doc);
const badNumbers = [null, true, false, '1', {}, [], -101, 101];
for (const version of [1, 2, 3]) {
  for (const doc of [base(version), full(version)]) {
    add(`v${version} default/full`, doc, true);
    add(`v${version} whitespace`, ` \r\n\t${JSON.stringify(doc)}\n`, true);
    for (const key of ['exposure', 'contrast', 'saturation', 'temperature']) {
      for (const value of [-100, -0.25, 0, .25, 100, Number.MIN_VALUE]) {
        mutate(`v${version} ${key} boundary ${value}`, doc, d => d.controls.basic[key] = value, true);
      }
      for (const value of badNumbers) mutate(`v${version} invalid ${key}`, doc, d => d.controls.basic[key] = value);
    }
    for (const key of ['smooth', 'brighten', 'warmth', 'underEye', 'redness', 'lip', 'blush']) {
      for (const value of key === 'warmth' ? [-100, 0, .25, 100] : [0, .25, 100]) {
        mutate(`v${version} ${key} boundary ${value}`, doc, d => d.controls.beauty[key] = value, true);
      }
      for (const value of badNumbers) mutate(`v${version} invalid ${key}`, doc, d => d.controls.beauty[key] = value);
    }
    for (const name of ['x', '🌿'.repeat(48), '汉'.repeat(48), '\u00a0x\uFEFF', 'Quote " \\ /']) mutate(`v${version} Unicode name`, doc, d => d.name = name, true);
    for (const name of ['', ' ', '\u00a0', 'x'.repeat(49), '🌿'.repeat(49), '\uD800', '\uDC00', 'a\u0000b', '\u007f', '\u0085']) mutate(`v${version} invalid name`, doc, d => d.name = name);
    for (const fields of [[], ['controls'], ['controls', 'basic'], ['controls', 'beauty']]) {
      for (const key of Object.keys(locate(doc, fields))) mutate(`v${version} missing ${fields}.${key}`, doc, d => delete locate(d, fields)[key]);
      for (const key of ['future', 'image', 'sourceId', 'path', '__proto__', 'constructor', 'prototype']) {
        mutate(`v${version} extra ${fields}.${key}`, doc, d => Object.defineProperty(locate(d, fields), key, { value: 1, enumerable: true }));
      }
    }
    for (const n of ['1e309', '-1e309', '1e-999', '-1e-999', '1e-324', '01', '+1', '.1', '1.', '0x1', 'NaN', 'Infinity', '0e' + '0'.repeat(127)]) {
      add(`v${version} hostile numeric token ${n}`, JSON.stringify(doc).replace('"exposure":0', `"exposure":${n}`), false);
    }
    for (const n of ['0e-999', '-0e-999', '5e-324', '-5e-324', '0.' + '0'.repeat(126)]) {
      add(`v${version} valid numeric token ${n}`, JSON.stringify(doc).replace('"exposure":0', `"exposure":${n}`), true);
    }
    for (const field of ['name', 'version', 'controls', 'basic', 'exposure']) {
      add(`v${version} duplicate ${field}`, JSON.stringify(doc).replace(`"${field}":`, `"${field}":null,"${field}":`), false);
    }
  }
  for (const unsupported of [0, 4, 100, 1.5, 2.5, '3', null, true]) mutate(`v${version} unsupported version`, base(version), d => d.version = unsupported);
  if (version < 3) for (const value of [null, light, active]) mutate(`v${version} lightBalance cannot be smuggled`, base(version), d => d.controls.lightBalance = value);
  if (version === 1) mutate('v1 levels cannot be smuggled', base(1), d => d.controls.levels = null);
}
const v3 = full(3);
v3.controls.lightBalance = clone(light);
add('v3 explicit identity', v3, true);
for (const fields of [['controls', 'lightBalance'], ['controls', 'lightBalance', 'whiteBalance']]) {
  for (const key of Object.keys(locate(v3, fields))) mutate(`v3 missing ${fields}.${key}`, v3, d => delete locate(d, fields)[key]);
  for (const key of ['enabled', 'strength', 'temperature', 'tint', 'sample', 'coordinates', 'pixels', 'photo', 'path', 'sourceId', '__proto__', 'constructor', 'prototype']) {
    mutate(`v3 unsupported ${fields}.${key}`, v3, d => Object.defineProperty(locate(d, fields), key, { value: 1, enumerable: true }));
  }
  for (const value of [null, true, 1, 'identity', [], {}]) {
    if (fields.length === 2 && value === null) continue;
    mutate(`v3 invalid record ${fields}`, v3, d => locate(d, fields.slice(0, -1))[fields.at(-1)] = value);
  }
}
for (const version of [0, 2, 1.5, '1', null, true]) mutate('lightBalance version', v3, d => d.controls.lightBalance.version = version);
for (const key of ['shadows', 'highlights']) {
  for (const value of [-100, -.25, 0, .25, 100, Number.MIN_VALUE, -Number.MIN_VALUE]) mutate(`${key} boundary`, v3, d => d.controls.lightBalance[key] = value, true);
  for (const value of [...badNumbers, -100.00000000000001, 100.00000000000001]) mutate(`${key} invalid`, v3, d => d.controls.lightBalance[key] = value);
  for (const n of ['1e-999', '-1e-999', '1e-324', '1e309', '0e' + '0'.repeat(127)]) add(`${key} hostile token`, JSON.stringify(v3).replace(`"${key}":0`, `"${key}":${n}`), false);
  add(`duplicate ${key}`, JSON.stringify(v3).replace(`"${key}":0`, `"${key}":0,"${key}":1`), false);
}
for (const key of ['r', 'g', 'b']) {
  for (const value of [.25, .25000000000000006, 1, 1.125, 3.9999999999999996, 4]) mutate(`gain ${key} boundary`, v3, d => d.controls.lightBalance.whiteBalance[key] = value, true);
  for (const value of [...badNumbers, 0, .24999999999999997, 4.000000000000001, Number.MIN_VALUE]) mutate(`gain ${key} invalid`, v3, d => d.controls.lightBalance.whiteBalance[key] = value);
  add(`duplicate gain ${key}`, JSON.stringify(v3).replace(`"${key}":1`, `"${key}":1,"${key}":2`), false);
}
for (const [raw, escaped] of [['lightBalance', 'lightBala\\u006ece'], ['shadows', 'sha\\u0064ows'], ['r', '\\u0072']]) {
  add(`escaped duplicate ${raw}`, JSON.stringify(v3).replace(`"${raw}":`, `"${escaped}":null,"${raw}":`), false);
}
// Deterministic varied valid recipes ensure non-null levels/curves are validated
// alongside active new controls, rather than skipped when advancedTone is null.
let seed = 0x4d696e74;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
for (let i = 0; i < 256; i++) {
  const doc = full(3);
  doc.controls.lightBalance.shadows = random() * 200 - 100;
  doc.controls.lightBalance.highlights = random() * 200 - 100;
  for (const key of ['r', 'g', 'b']) doc.controls.lightBalance.whiteBalance[key] = .25 + random() * 3.75;
  doc.controls.basic.exposure = random() * 200 - 100;
  doc.controls.levels.strength = random();
  doc.controls.advancedTone.strength = random();
  add(`deterministic active recipe ${i}`, doc, true);
}
const text = JSON.stringify(full(3));
for (const input of ['', 'null', '[]', 'true', '{}', '\uFEFF' + text, text + 'true', '/*comment*/' + text, text.slice(0, -1) + ',}']) add('invalid JSON framing', input, false);
const exact = text + ' '.repeat(65536 - Buffer.byteLength(text));
add('exact byte limit', exact, true);
add('over byte limit', exact + ' ', false);

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mint-native-preset-'));
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed: ${result.stderr}\n${result.stdout}`);
  return result.stdout;
};
try {
  const files = [path.join(root, 'app/src/main/java/com/qingyan/editor/PresetPayload.java'), path.join(__dirname, 'PresetPayloadParity.java')];
  const javac = spawnSync('javac', ['-version'], { encoding: 'utf8' });
  if (!javac.error && javac.status === 0) run('javac', ['--release', '17', '-d', out, ...files]);
  else run('java', ['-m', 'jdk.compiler/com.sun.tools.javac.Main', '-source', '17', '-target', '17', '-d', out, ...files]);
  const results = run('java', ['-cp', out, 'com.qingyan.editor.PresetPayloadParity'], {
    input: cases.map(test => Buffer.from(test.text).toString('base64')).join('\n') + '\n'
  }).trim().split('\n');
  assert.equal(results.length, cases.length);
  let accepted = 0;
  for (const [index, test] of cases.entries()) {
    let js = false;
    try { codec.parse(test.text); js = true; } catch (invalid) { /* Codec rejection is compared below. */ }
    const java = results[index] === '1';
    assert.equal(js, test.expected, `JS expectation: ${test.label}`);
    assert.equal(java, js, `Java/JS mismatch: ${test.label}`);
    if (java) accepted++;
  }
  console.log(`PASS: ${cases.length} Java/JS preset acceptance comparisons (${accepted} valid, ${cases.length - accepted} rejected); Java import/export preserve accepted bytes`);
  for (const [name, module] of Object.entries(modules)) console.log(`${name}: ${module.sha256} ${module.file}`);
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}
