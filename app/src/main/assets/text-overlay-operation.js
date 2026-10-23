/* Portable, bounded text-history adapter. validate() checks one complete data
 * snapshot; replace needs history context and is accepted by collapse() only
 * when the last effective operation is text-overlay with exactly the same id.
 * collapse() never changes raw history. Each valid replacement substitutes the
 * last effective item with a complete, fresh action:'add' snapshot. Undo is a
 * raw-history pop, so it naturally restores the previous recipe. Any intervening
 * operation prevents replacement; add identifiers cannot be reused anywhere in
 * the raw history. Non-text legacy operations are opaque, identity-preserving
 * references after their own enumerable data `type` string is checked.
 */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MintTextOverlayOperation = api;
})(typeof globalThis === 'object' ? globalThis : this, function (root) {
  'use strict';
  const LIMITS = Object.freeze({ operations: 60, id: 80 });
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  function check(ok, message, code = 'TEXT_OVERLAY_OPERATION_INVALID') {
    if (!ok) { const error = new TypeError(message); error.code = code; throw error; }
  }
  function plain(value) {
    check(value !== null && typeof value === 'object' && !Array.isArray(value), 'Operation must be plain data');
    const proto = Object.getPrototypeOf(value);
    check(proto === Object.prototype || proto === null, 'Invalid operation prototype');
  }
  function type(value) {
    plain(value);
    const descriptor = Object.getOwnPropertyDescriptor(value, 'type');
    check(descriptor && descriptor.enumerable && own(descriptor, 'value') &&
      typeof descriptor.value === 'string' && descriptor.value.length > 0, 'Operation type must be an own data string');
    return descriptor.value;
  }
  function snapshot(value) {
    plain(value);
    const names = Reflect.ownKeys(value), fields = ['type', 'action', 'id', 'recipe'], out = Object.create(null);
    check(names.length === fields.length, 'Missing or unexpected text operation fields');
    for (const key of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      check(typeof key === 'string' && fields.includes(key) && descriptor && descriptor.enumerable &&
        own(descriptor, 'value'), 'Unexpected, hidden, or accessor text operation field');
      out[key] = descriptor.value;
    }
    for (const key of fields) check(own(out, key), 'Missing text operation field: ' + key);
    return out;
  }
  function dependency() {
    const core = typeof module === 'object' && module.exports ? require('./text-overlay.js') : root.MintTextOverlay;
    check(core && typeof core.validate === 'function', 'Text overlay dependency is unavailable', 'TEXT_OVERLAY_MODULE_UNAVAILABLE');
    return core;
  }
  function identifier(value) {
    check(typeof value === 'string' && value.length > 0 && value.length <= LIMITS.id &&
      !/[\u0000-\u001f\u007f-\u009f]/.test(value), 'Invalid text operation id');
    for (let i = 0; i < value.length; i++) {
      const point = value.charCodeAt(i);
      if (point >= 0xd800 && point <= 0xdbff) {
        const next = value.charCodeAt(++i);
        check(next >= 0xdc00 && next <= 0xdfff, 'Invalid text operation id Unicode');
      } else check(point < 0xdc00 || point > 0xdfff, 'Invalid text operation id Unicode');
    }
    return value;
  }
  function validate(value) {
    const op = snapshot(value);
    check(op.type === 'text-overlay', 'Invalid text overlay operation type');
    check(op.action === 'add' || op.action === 'replace', 'Invalid text overlay action');
    const id = identifier(op.id), recipe = dependency().validate(op.recipe);
    return { type: 'text-overlay', action: op.action, id, recipe };
  }
  function array(value) {
    check(Array.isArray(value), 'Text history must be an array');
    const proto = Object.getPrototypeOf(value);
    check(proto === Array.prototype || proto === null, 'Invalid history array prototype');
    const length = Object.getOwnPropertyDescriptor(value, 'length');
    check(length && own(length, 'value') && Number.isSafeInteger(length.value) && length.value <= LIMITS.operations,
      'Text history operation limit exceeded');
    check(Reflect.ownKeys(value).length === length.value + 1, 'Unexpected or sparse history array fields');
    const result = [];
    for (let i = 0; i < length.value; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      check(descriptor && descriptor.enumerable && own(descriptor, 'value'), 'Missing, hidden, or accessor history entry');
      result.push(descriptor.value);
    }
    return result;
  }
  function collapse(value) {
    const entries = array(value), result = [], ids = new Set();
    let latestTextId = null;
    for (const entry of entries) {
      if (type(entry) !== 'text-overlay') { result.push(entry); latestTextId = null; continue; }
      const op = validate(entry);
      if (op.action === 'add') {
        check(!ids.has(op.id), 'Duplicate text add id'); ids.add(op.id); result.push(op);
      } else {
        check(result.length > 0 && latestTextId === op.id, 'Text replacement must immediately follow the same effective text overlay');
        result[result.length - 1] = { type: 'text-overlay', action: 'add', id: op.id, recipe: op.recipe };
      }
      latestTextId = op.id;
    }
    return result;
  }
  return Object.freeze({ LIMITS, validate, collapse });
});
