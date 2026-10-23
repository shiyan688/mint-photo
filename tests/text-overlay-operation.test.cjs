'use strict';
// Portable history tests, independent of native font engines and pixel fixtures.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const T = require('../app/src/main/assets/text-overlay.js');
const O = require('../app/src/main/assets/text-overlay-operation.js');
const op = (action = 'add', id = 'text-1', text = 'Mint') => ({ type: 'text-overlay', action, id, recipe: { ...T.defaults(), text } });
const clone = value => JSON.parse(JSON.stringify(value));
test('strict frozen operation API and browser lazy dependency work in either script load order', () => {
  assert.deepEqual(Object.keys(O), ['LIMITS', 'validate', 'collapse']); assert.ok(Object.isFrozen(O)); assert.ok(Object.isFrozen(O.LIMITS));
  assert.deepEqual(O.LIMITS, { operations: 60, id: 80 });
  const sandbox = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/src/main/assets/text-overlay-operation.js'), 'utf8'), sandbox);
  assert.equal(vm.runInContext('MintTextOverlayOperation.collapse([]).length', sandbox), 0);
  assert.throws(() => vm.runInContext('MintTextOverlayOperation.validate({type:"text-overlay",action:"add",id:"a",recipe:{}})', sandbox), /unavailable/);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/src/main/assets/text-overlay.js'), 'utf8'), sandbox);
  assert.equal(vm.runInContext('MintTextOverlayOperation.validate({type:"text-overlay",action:"add",id:"a",recipe:MintTextOverlay.defaults()}).id', sandbox), 'a');
});
test('replace folds a complete recipe without mutation and raw-history undo restores each prior value', () => {
  const raw = [op(), op('replace', 'text-1', 'Second'), op('replace', 'text-1', 'Third')];
  raw[1].recipe.rotation = 45; raw[2].recipe.opacity = .4;
  const before = clone(raw), effective = O.collapse(raw);
  assert.deepEqual(raw, before); assert.deepEqual(effective, [{ ...raw[2], action: 'add' }]);
  assert.equal(effective[0].recipe.rotation, 0); assert.notEqual(effective[0].recipe, raw[2].recipe);
  assert.deepEqual(O.collapse(raw.slice(0, -1)), [{ ...raw[1], action: 'add' }]);
  assert.deepEqual(O.collapse(raw.slice(0, 1)), [raw[0]]);
  effective[0].recipe.text = 'mutated'; assert.equal(raw[2].recipe.text, 'Third');
  assert.deepEqual(O.collapse(clone(raw)), [{ ...raw[2], action: 'add' }]);
});
test('legacy edits preserve identity and order, and text additions remain independent layers', () => {
  const opaque = { type: 'tone', settings: { exposure: 20 } }, raw = [opaque, op(), op('replace'), op('add', 'text-2'), { type: 'crop' }];
  const result = O.collapse(raw);
  assert.equal(result[0], opaque); assert.equal(result.at(-1), raw.at(-1));
  assert.deepEqual(result.map(o => o.type), ['tone', 'text-overlay', 'text-overlay', 'crop']);
  assert.equal(result[1].id, 'text-1'); assert.equal(result[2].id, 'text-2');
});
test('standalone, downstream, cross-id replacements and any duplicate add id reject', () => {
  for (const history of [[op('replace')], [op(), { type: 'tone' }, op('replace')],
    [op(), op('replace', 'other')], [op(), op('add', 'second'), op('replace')],
    [op(), op()], [op(), op('replace'), op()], [op(), { type: 'crop' }, op()]])
    assert.throws(() => O.collapse(history), TypeError);
  assert.equal(O.validate(op('replace')).action, 'replace'); // Shape alone has no history context.
  assert.deepEqual(O.collapse([op('add', '__proto__'), op('replace', '__proto__')]).map(x => x.id), ['__proto__']);
});
test('60 raw operations is inclusive, regardless of collapse size', () => {
  const raw = [op(), ...Array.from({ length: 59 }, (_, i) => op('replace', 'text-1', String(i)))];
  assert.equal(O.collapse(raw).length, 1); assert.equal(O.collapse(raw)[0].recipe.text, '58');
  assert.throws(() => O.collapse([...raw, op('replace')]), /limit/);
  assert.equal(O.collapse(Array.from({ length: 60 }, () => ({ type: 'legacy' }))).length, 60);
});
test('all operation fields and recipes validate before accessor reads or coercion', () => {
  let calls = 0;
  for (const key of ['type', 'action', 'id', 'recipe']) for (const mutation of ['missing', 'getter', 'hidden']) {
    const input = op();
    if (mutation === 'missing') delete input[key];
    if (mutation === 'getter') Object.defineProperty(input, key, { enumerable: true, get() { calls++; return 'text-overlay'; } });
    if (mutation === 'hidden') Object.defineProperty(input, key, { enumerable: false });
    assert.throws(() => O.validate(input), TypeError); assert.throws(() => O.collapse([input]), TypeError);
  }
  for (const input of [null, undefined, [], {}, { ...op(), extra: 1 }, { ...op(), [Symbol('s')]: true },
    Object.create(op()), Object.setPrototypeOf(op(), { x: 1 }), { ...op(), action: 'delete' }, { ...op(), type: 'text' },
    { ...op(), recipe: { ...T.defaults(), surprise: 1 } }]) assert.throws(() => O.validate(input), TypeError);
  const accessorRecipe = op(); Object.defineProperty(accessorRecipe.recipe, 'text', { enumerable: true, get() { calls++; return 'unsafe'; } });
  assert.throws(() => O.collapse([accessorRecipe]), TypeError); assert.equal(calls, 0);
  assert.deepEqual(O.validate(Object.assign(Object.create(null), op())), op());
});
test('identifiers are bounded nonempty well-formed strings without controls, no coercion', () => {
  assert.equal(O.validate(op('add', 'x'.repeat(80))).id.length, 80);
  for (const id of ['', 'x'.repeat(81), '\n', '\u007f', '\u0085', '\ud800', '\udc00', 1, {}, null])
    assert.throws(() => O.validate(op('add', id)), TypeError);
});
test('legacy discriminant must be own enumerable data string, but other fields stay opaque', () => {
  let calls = 0;
  const legacy = { type: 'tone' }; Object.defineProperty(legacy, 'settings', { get() { calls++; throw Error('opaque'); } });
  assert.equal(O.collapse([legacy])[0], legacy); assert.equal(calls, 0);
  for (const value of [null, 1, 'tone', [], {}, { type: 3 }, { type: '' }, Object.create({ type: 'tone' }),
    Object.defineProperty({}, 'type', { enumerable: true, get() { calls++; return 'tone'; } }),
    Object.defineProperty({}, 'type', { value: 'tone', enumerable: false })]) assert.throws(() => O.collapse([value]), TypeError);
  assert.equal(calls, 0);
});
test('history arrays must be bounded dense own data; accessors and unusual prototypes reject', () => {
  let calls = 0;
  for (const mutation of ['hole', 'getter', 'hidden', 'extra', 'symbol', 'prototype']) {
    const raw = [op()];
    if (mutation === 'hole') delete raw[0];
    if (mutation === 'getter') Object.defineProperty(raw, 0, { enumerable: true, get() { calls++; return op(); } });
    if (mutation === 'hidden') Object.defineProperty(raw, 0, { enumerable: false });
    if (mutation === 'extra') raw.extra = 1;
    if (mutation === 'symbol') raw[Symbol('x')] = true;
    if (mutation === 'prototype') Object.setPrototypeOf(raw, {});
    assert.throws(() => O.collapse(raw), TypeError, mutation);
  }
  for (const value of [null, {}, 'array']) assert.throws(() => O.collapse(value), TypeError);
  assert.equal(calls, 0); assert.deepEqual(O.collapse(Object.setPrototypeOf([op()], null)), [op()]);
});
