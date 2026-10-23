/* Portable, bounded paint-history adapter. validate() checks one complete data
 * snapshot; replace needs history context and is accepted by collapse() only
 * when the last effective operation is paint-layer with exactly the same id.
 * collapse() never changes raw history. Each valid replacement substitutes the
 * last effective item with a complete, fresh action:'add' snapshot. Undo is a
 * raw-history pop, so it naturally restores the previous recipe. Any intervening
 * operation prevents replacement; add identifiers cannot be reused anywhere in
 * the raw history. Non-paint legacy operations are opaque, identity-preserving
 * references after their own enumerable data `type` string is checked.
 */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MintPaintLayerOperation = api;
})(typeof globalThis === 'object' ? globalThis : this, function (root) {
  'use strict';
  const LIMITS = Object.freeze({ operations: 60, id: 80 });
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  function check(ok, message, code = 'PAINT_LAYER_OPERATION_INVALID') {
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
    check(names.length === fields.length, 'Missing or unexpected paint operation fields');
    for (const key of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      check(typeof key === 'string' && fields.includes(key) && descriptor && descriptor.enumerable &&
        own(descriptor, 'value'), 'Unexpected, hidden, or accessor paint operation field');
      out[key] = descriptor.value;
    }
    for (const key of fields) check(own(out, key), 'Missing paint operation field: ' + key);
    return out;
  }
  function dependency() {
    const core = typeof module === 'object' && module.exports ? require('./paint-layer.js') : root.MintPaintLayer;
    check(core && typeof core.validate === 'function', 'Paint overlay dependency is unavailable', 'PAINT_LAYER_MODULE_UNAVAILABLE');
    return core;
  }
  function identifier(value) {
    check(typeof value === 'string' && value.length > 0 && value.length <= LIMITS.id &&
      !/[\u0000-\u001f\u007f-\u009f]/.test(value), 'Invalid paint operation id');
    for (let i = 0; i < value.length; i++) {
      const point = value.charCodeAt(i);
      if (point >= 0xd800 && point <= 0xdbff) {
        const next = value.charCodeAt(++i);
        check(next >= 0xdc00 && next <= 0xdfff, 'Invalid paint operation id Unicode');
      } else check(point < 0xdc00 || point > 0xdfff, 'Invalid paint operation id Unicode');
    }
    return value;
  }
  function validate(value) {
    const op = snapshot(value);
    check(op.type === 'paint-layer', 'Invalid paint overlay operation type');
    check(op.action === 'add' || op.action === 'replace', 'Invalid paint overlay action');
    const id = identifier(op.id), recipe = dependency().validate(op.recipe);
    return { type: 'paint-layer', action: op.action, id, recipe };
  }
  function array(value) {
    check(Array.isArray(value), 'Paint history must be an array');
    const proto = Object.getPrototypeOf(value);
    check(proto === Array.prototype || proto === null, 'Invalid history array prototype');
    const length = Object.getOwnPropertyDescriptor(value, 'length');
    check(length && own(length, 'value') && Number.isSafeInteger(length.value) && length.value <= LIMITS.operations,
      'Paint history operation limit exceeded');
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
    let latestPaintId = null;
    for (const entry of entries) {
      if (type(entry) !== 'paint-layer') { result.push(entry); latestPaintId = null; continue; }
      const op = validate(entry);
      if (op.action === 'add') {
        check(!ids.has(op.id), 'Duplicate paint add id'); ids.add(op.id); result.push(op);
      } else {
        check(result.length > 0 && latestPaintId === op.id, 'Paint replacement must immediately follow the same effective paint overlay');
        result[result.length - 1] = { type: 'paint-layer', action: 'add', id: op.id, recipe: op.recipe };
      }
      latestPaintId = op.id;
    }
    return result;
  }
  function plan(width,height,value){return dependency().plan(width,height,validate(value).recipe);}
  function applyCanvas(input, value, createCanvas) {
    const op=validate(value), w=input&&input.width,h=input&&input.height;
    plan(w,h,op);
    check(Number.isSafeInteger(w)&&Number.isSafeInteger(h)&&w>0&&h>0&&w<=4096&&h<=4096&&w*h<=8000000,'Paint canvas exceeds budget');
    check(input&&typeof input.getContext==='function','Invalid paint source canvas');
    const make=createCanvas || ((width,height)=>{const c=root.document.createElement('canvas');c.width=width;c.height=height;return c;});
    check(typeof make==='function','Missing paint canvas factory');
    let layer=null,out=null;
    try {
      const scratch=(width,height)=>{const c=make(width,height);check(c&&c!==input,'Paint factory must not return source');return c;};
      if(dependency().hasPaint(op.recipe))layer=dependency().renderLayer(w,h,op.recipe,{createCanvas:scratch});
      out=make(w,h);check(out&&out!==input&&out!==layer&&out.width===w&&out.height===h,'Invalid fresh paint output canvas');
      const ctx=out.getContext('2d');check(ctx&&typeof ctx.drawImage==='function','Paint output allocation failed');
      ctx.drawImage(input,0,0);if(layer)ctx.drawImage(layer,0,0);return out;
    } catch(error) {if(out&&out!==input&&out!==layer){try{out.width=1;out.height=1;}catch(_){}}throw error;}
    finally {if(layer&&layer!==input){try{layer.width=1;layer.height=1;}catch(_){}}}
  }
  return Object.freeze({ LIMITS, validate, collapse, plan, applyCanvas });
});
