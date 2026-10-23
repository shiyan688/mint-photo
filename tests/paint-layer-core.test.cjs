'use strict';
const nodeTest = require('node:test');
const mode = process.env.PAINT_CORE_TEST_MODE || 'all';
if (!['all','pure','native'].includes(mode)) throw Error('PAINT_CORE_TEST_MODE must be pure, native, or all');
const test = mode === 'native' ? function () {} : nodeTest;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../app/src/main/assets/paint-layer.js');
let native;
try { if (mode !== 'pure') native = require('@napi-rs/canvas'); } catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  if (mode === 'native') throw Error('Explicit native test mode requires the already-installed @napi-rs/canvas package on the Node resolution path');
}
const dot = (fields = {}) => ({ mode: 'paint', color: '#ff0000', width: .1, opacity: 1,
  points: [{ x: .5, y: .5 }], ...fields });
const recipe = (...strokes) => ({ version: 1, strokes });
const clone = value => JSON.parse(JSON.stringify(value));
const invalid = value => assert.throws(() => core.validate(value));
const nativeTest = (name, fn) => mode === 'pure' ? undefined : nodeTest(name, { skip: !native && 'optional @napi-rs/canvas is not installed' }, fn);

function fakeCanvas(width, height, setup) {
  const calls = [], stack = [];
  const ctx = { globalAlpha: .37, globalCompositeOperation: 'xor', lineCap: 'butt', lineJoin: 'miter',
    lineWidth: 3, strokeStyle: '#123456', fillStyle: '#654321', shadowColor: 'red', shadowBlur: 9,
    shadowOffsetX: 4, shadowOffsetY: 5, filter: 'blur(4px)', lineDashOffset: 2,
    transform: [2, 0, 0, 2, 7, 8], dash: [2, 3] };
  const initial = clone(ctx);
  let path = [];
  ctx.save = function () { calls.push(['save']); const state = {}; for (const k of Object.keys(initial)) state[k] = Array.isArray(this[k]) ? [...this[k]] : this[k]; stack.push(state); };
  ctx.restore = function () { calls.push(['restore']); Object.assign(this, stack.pop()); };
  ctx.setTransform = function (...args) { this.transform = args; calls.push(['transform', ...args]); };
  ctx.setLineDash = function (value) { this.dash = [...value]; };
  ctx.clearRect = function (...args) { calls.push(['clear', ...args]); };
  ctx.beginPath = function () { path = []; };
  for (const key of ['moveTo', 'lineTo', 'arc']) ctx[key] = function (...args) { path.push([key, ...args]); };
  for (const key of ['stroke', 'fill']) ctx[key] = function () { calls.push([key, { ...this, path: clone(path), dash: [...this.dash] }]); };
  ctx.getImageData = function (x,y,w,h) { calls.push(['getImageData',x,y,w,h]); return {width:w,height:h,data:new Uint8ClampedArray(w*h*4)}; };
  ctx.putImageData = function (image,x,y) { calls.push(['putImageData',x,y,image.width,image.height]); };
  const canvas = { width, height, getContext(kind) { assert.equal(kind, '2d'); return ctx; }, ctx, calls, initial, stack };
  if (setup) setup(canvas);
  return canvas;
}
function fakeRender(w, h, r, options) {
  let canvas; const surfaces=[];
  const result = core.renderLayer(w, h, r, { createCanvas: (w, h) => {const c=fakeCanvas(w,h);if(!canvas)canvas=c;surfaces.push(c);return c;}, ...options });
  assert.equal(result, canvas);
  canvas.surfaces=surfaces;
  return canvas;
}
function draws(canvas) { return canvas.calls.filter(c => c[0] === 'fill' || c[0] === 'stroke'); }
function state(canvas) { const out = {}; for (const key of Object.keys(canvas.initial)) out[key] = canvas.ctx[key]; return out; }
function render(r, w = 201, h = 201, options = {}) {
  return core.renderLayer(w, h, r, { createCanvas: native.createCanvas, ...options });
}
function rgba(canvas, x, y) { return [...canvas.getContext('2d').getImageData(x, y, 1, 1).data]; }
function bytes(canvas) { return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; }
function near(actual, expected, epsilon = 2) { assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be within ${epsilon} of ${expected}`); }

// Public contract and independent module-loading modes.
test('public API and nested limits are frozen and exact', () => {
  assert.deepEqual(Object.keys(core).sort(), ['LIMITS', 'defaults', 'hasPaint', 'plan', 'renderLayer', 'validate', 'version'].sort());
  assert.equal(core.version, 1); assert.ok(Object.isFrozen(core)); assert.ok(Object.isFrozen(core.LIMITS));
  assert.deepEqual(core.LIMITS, { maxStrokes:128, maxPointsPerStroke:1024, maxTotalPoints:8192, maxPixels:8000000, maxEdge:4096, minWidth:.002, maxWidth:.12,maxTilePixels:1000000,maxEraseWorkPixels:32000000 });
});
test('UMD browser-global and AMD branches load without a canvas or dependencies', () => {
  const source = fs.readFileSync(require.resolve('../app/src/main/assets/paint-layer.js'), 'utf8');
  const browser = vm.createContext({}); vm.runInContext(source, browser); assert.equal(browser.MintPaintLayer.version, 1);
  let amd; const define = (deps, factory) => { assert.equal(deps.length, 0); amd = factory(); }; define.amd = {};
  vm.runInNewContext(source, { define }); assert.equal(amd.version, 1);
});
test('defaults and null/undefined are independently frozen empty recipes', () => {
  for (const r of [core.defaults(), core.validate(null), core.validate(undefined)]) {
    assert.deepEqual(r, recipe()); assert.ok(Object.isFrozen(r)); assert.ok(Object.isFrozen(r.strokes)); assert.equal(core.hasPaint(r), false);
  }
  assert.notEqual(core.defaults(), core.defaults());
});
test('canonical snapshot is deep-frozen, cloned, lowercase, normalized, and detached from caller', () => {
  const input = recipe(dot({ color: '#ABCdEF', points: [{ x: -0, y: 1 }] }));
  const result = core.validate(input);
  assert.equal(result.strokes[0].color, '#abcdef'); assert.equal(Object.is(result.strokes[0].points[0].x, -0), false);
  for (const x of [result, result.strokes, result.strokes[0], result.strokes[0].points, result.strokes[0].points[0]]) assert.ok(Object.isFrozen(x));
  input.strokes[0].color = '#000000'; input.strokes[0].points[0].x = 1; input.strokes.length = 0;
  assert.equal(result.strokes[0].color, '#abcdef'); assert.equal(result.strokes[0].points[0].x, 0);
  assert.notEqual(core.validate(result), result);
  assert.throws(() => result.strokes[0].points.push({ x: 0, y: 0 }));
});
test('null-prototype records and dense null-prototype arrays are safe input', () => {
  const p = Object.assign(Object.create(null), { x: 0, y: 1 });
  const points = [p]; Object.setPrototypeOf(points, null);
  const s = Object.assign(Object.create(null), dot({ points }));
  const strokes = [s]; Object.setPrototypeOf(strokes, null);
  const r = Object.assign(Object.create(null), { version: 1, strokes });
  assert.equal(core.validate(r).strokes[0].points[0].y, 1);
});
for (const value of [false, true, 1, '1', [], new Date(), Object.create({ version:1, strokes:[] })]) {
  test(`reject non-record recipe ${Object.prototype.toString.call(value)}`, () => invalid(value));
}
for (const key of ['version', 'strokes']) test(`reject missing recipe ${key}`, () => { const r = recipe(); delete r[key]; invalid(r); });
for (const value of [0, 2, '1', NaN, Infinity]) test(`reject recipe version ${value}`, () => invalid({ version: value, strokes: [] }));
for (const [label, mutate] of [
  ['unknown recipe field', r => { r.extra = true; }],
  ['symbol recipe field', r => { r[Symbol('extra')] = true; }],
  ['hidden recipe field', r => { Object.defineProperty(r, 'version', { value:1, enumerable:false }); }],
  ['unsafe recipe prototype', r => { Object.setPrototypeOf(r, { polluted:true }); }],
  ['array subclass', r => { class Extra extends Array {} r.strokes = new Extra(); }],
  ['array extra field', r => { r.strokes.extra = true; }],
  ['array symbol field', r => { r.strokes[Symbol('extra')] = true; }],
  ['sparse strokes', r => { r.strokes = Array(1); }],
  ['sparse points', r => { r.strokes[0].points = Array(1); }],
  ['unknown stroke field', r => { r.strokes[0].extra = true; }],
  ['unsafe stroke prototype', r => { Object.setPrototypeOf(r.strokes[0], { mode:'paint' }); }],
  ['unknown point field', r => { r.strokes[0].points[0].z = 0; }],
  ['unsafe point prototype', r => { Object.setPrototypeOf(r.strokes[0].points[0], { z:1 }); }],
  ['hidden point field', r => { Object.defineProperty(r.strokes[0].points[0], 'x', { value:.5, enumerable:false }); }],
  ['hidden array index', r => { Object.defineProperty(r.strokes, '0', { value:r.strokes[0], enumerable:false }); }],
  ['array numeric alias', r => { r.strokes['01'] = r.strokes[0]; }],
  ['unsafe own __proto__', r => { Object.defineProperty(r, '__proto__', { value:{}, enumerable:true }); }]
]) test(`reject ${label}`, () => { const r = recipe(dot()); mutate(r); invalid(r); });
for (const where of ['recipe', 'stroke', 'point', 'strokes', 'points']) test(`reject ${where} getter without invoking it`, () => {
  const r = recipe(dot()); let invoked = 0;
  const target = where === 'recipe' ? r : where === 'stroke' ? r.strokes[0] : where === 'point' ? r.strokes[0].points[0] : where === 'strokes' ? r.strokes : r.strokes[0].points;
  const key = where === 'recipe' ? 'version' : where === 'stroke' ? 'color' : where === 'point' ? 'x' : '0';
  Object.defineProperty(target, key, { enumerable:true, get() { invoked++; throw Error('must not run'); } });
  invalid(r); assert.equal(invoked, 0);
});
for (const key of ['mode', 'color', 'width', 'opacity', 'points']) test(`reject missing stroke ${key}`, () => { const s = dot(); delete s[key]; invalid(recipe(s)); });
for (const key of ['x', 'y']) test(`reject missing point ${key}`, () => { const s = dot(); delete s.points[0][key]; invalid(recipe(s)); });
for (const mode of ['Paint', 'source-over', '', undefined, 1]) test(`reject mode ${mode}`, () => invalid(recipe(dot({ mode }))));
for (const color of ['white', '#fff', '#ffffffff', 'rgb(1,2,3)', '#GGGGGG', '#123456\n', new String('#123456')]) test(`reject color ${String(color)}`, () => invalid(recipe(dot({ color }))));
for (const width of [0, .001999, .120001, -1, NaN, Infinity, '0.01']) test(`reject width ${width}`, () => invalid(recipe(dot({ width }))));
for (const opacity of [-.001, 1.001, NaN, Infinity, '0.5']) test(`reject opacity ${opacity}`, () => invalid(recipe(dot({ opacity }))));
for (const coordinate of [-.001, 1.001, NaN, Infinity, '.5', null]) test(`reject point coordinate ${coordinate}`, () => invalid(recipe(dot({ points:[{ x:coordinate, y:.5 }] }))));
test('boundary width, opacity and coordinates are accepted; no coercion', () => {
  const r = core.validate(recipe(dot({ width:.002, opacity:0, points:[{ x:0, y:1 }] }), dot({ mode:'erase', width:.12, opacity:1 })));
  assert.equal(r.strokes.length, 2);
});
test('empty strokes valid, but empty or non-array point lists invalid', () => {
  assert.deepEqual(core.validate(recipe()), recipe());
  for (const points of [[], {}, null, new Uint8Array(2)]) invalid(recipe(dot({ points })));
});
test('128 strokes accepted and 129 rejected', () => {
  assert.equal(core.validate(recipe(...Array.from({ length:128 }, () => dot()))).strokes.length, 128);
  invalid(recipe(...Array.from({ length:129 }, () => dot())));
});
test('1024 points/stroke accepted and 1025 rejected', () => {
  assert.equal(core.validate(recipe(dot({ points:Array.from({ length:1024 }, () => ({ x:.5, y:.5 })) }))).strokes[0].points.length, 1024);
  invalid(recipe(dot({ points:Array.from({ length:1025 }, () => ({ x:.5, y:.5 })) })));
});
test('8192 total points accepted and 8193 rejected, even if all are transparent', () => {
  const strokes = Array.from({ length:8 }, () => dot({ opacity:0, points:Array.from({ length:1024 }, () => ({ x:.5, y:.5 })) }));
  assert.equal(core.validate(recipe(...strokes)).strokes.length, 8); invalid(recipe(...strokes, dot({ opacity:0 })));
});
test('hasPaint is structural, ignores erase and zero alpha, and still validates all input', () => {
  assert.equal(core.hasPaint(recipe(dot({ mode:'erase' }))), false);
  assert.equal(core.hasPaint(recipe(dot({ opacity:0 }), dot({ mode:'erase' }))), false);
  assert.equal(core.hasPaint(recipe(dot(), dot({ mode:'erase', width:.12 }))), true);
  assert.throws(() => core.hasPaint(recipe(dot(), dot({ mode:'bad' }))));
});

// Rendering and resource/error contracts, without relying on a rasterizer.
test('source recipe remains byte-identical after rendering and may be frozen', () => {
  const r = core.validate(recipe(dot())); const before = JSON.stringify(r); fakeRender(101, 73, r); assert.equal(JSON.stringify(r), before);
});
test('factory cannot mutate the in-flight canonical snapshot', () => {
  const r = recipe(dot({ color:'#123456' })); let c;
  core.renderLayer(101, 101, r, { createCanvas(w,h) { r.strokes[0].color = '#ffffff'; r.strokes[0].points[0].x=0; return c = fakeCanvas(w,h); } });
  const d = draws(c)[0][1]; assert.equal(d.fillStyle, '#123456'); assert.equal(d.path[0][1], 50);
});
test('null/default/erase-only layers are returned; no photo or drawImage API is used', () => {
  for (const r of [null, undefined, recipe(), recipe(dot({ opacity:0 }))]) { const c = fakeRender(10, 10, r); assert.equal(draws(c).length, 0); assert.equal(c.calls.filter(x=>x[0]==='clear').length, 1); }
  const erased=fakeRender(10,10,recipe(dot({mode:'erase'})));assert.equal(draws(erased).length,0);assert.equal(draws(erased.surfaces[1]).length,1);
});
test('source points map to pixel-center range, and width uses short edge without integer rounding', () => {
  const c = fakeRender(101, 51, recipe(dot({ width:.002, points:[{ x:0,y:0 },{ x:1,y:1 }] })));
  const d = draws(c)[0][1]; assert.deepEqual(d.path, [['moveTo',0,0],['lineTo',100,50]]); assert.equal(d.lineWidth, .002 * 51);
});
test('each stroke freezes its style; eraser uses one opaque coverage path and mathematical alpha', () => {
  const c = fakeRender(101, 101, recipe(dot({ color:'#ff0000', width:.02, opacity:.25 }), dot({ color:'#0000ff', width:.1, opacity:.75 }), dot({ mode:'erase', color:'#ffffff', width:.06, opacity:.5 })));
  const d = draws(c).map(x=>x[1]);
  assert.deepEqual(d.map(x=>[x.fillStyle,x.lineWidth,x.globalAlpha,x.globalCompositeOperation]), [
    ['#ff0000',2.02,.25,'source-over'],['#0000ff',10.100000000000001,.75,'source-over']]);
  const mask=draws(c.surfaces[1])[0][1];assert.deepEqual([mask.fillStyle,mask.lineWidth,mask.globalAlpha,mask.globalCompositeOperation],['#000000',6.06,1,'source-over']);
  assert.equal(c.calls.filter(c=>c[0]==='putImageData').length,1);assert.equal(c.surfaces[1].width,0);assert.equal(c.surfaces[1].height,0);
});
test('one continuous path draw per stroke, and repeated-point strokes are actual filled discs', () => {
  const points = [{x:.2,y:.3},{x:.4,y:.5},{x:.6,y:.7}];
  const c = fakeRender(101,101,recipe(dot({ points }),dot({ points:[{x:.4,y:.4},{x:.4,y:.4}] })));
  const d = draws(c); assert.deepEqual(d.map(x=>x[0]),['stroke','fill']); assert.equal(d[0][1].path.length,3);
  assert.deepEqual(d[1][1].path[0], ['arc',40,40,5.050000000000001,0,Math.PI*2]);
});
test('collapsed one-pixel dimensions become a real dot, not a zero-length stroke', () => {
  const c = fakeRender(1,1,recipe(dot({ points:[{x:0,y:0},{x:1,y:1}] })));
  assert.equal(draws(c)[0][0], 'fill');
});
test('round caps/joins, neutral transforms/shadows/filter/dashes, and original drawing state restored', () => {
  const c = fakeRender(101,101,recipe(dot({ points:[{x:.1,y:.2},{x:.7,y:.8}] })));
  const d=draws(c)[0][1]; assert.equal(d.lineCap,'round'); assert.equal(d.lineJoin,'round'); assert.deepEqual(d.transform,[1,0,0,1,0,0]);
  assert.equal(d.shadowBlur,0); assert.equal(d.shadowOffsetX,0); assert.equal(d.shadowOffsetY,0); assert.equal(d.filter,'none'); assert.deepEqual(d.dash,[]); assert.equal(d.lineDashOffset,0);
  assert.deepEqual(state(c), c.initial); assert.equal(c.stack.length,0);
});
test('unrecognized option fields/getters, null and wrong hook types rejected before allocation', () => {
  let count=0, getter=0;
  const bad = [{ noSuch:true }, null, { createCanvas:1 }, { shouldCancel:false }, Object.create({ shouldCancel:()=>false })];
  const o={}; Object.defineProperty(o,'shouldCancel',{ enumerable:true,get(){getter++;} }); bad.push(o);
  for(const opts of bad) assert.throws(()=>core.renderLayer(10,10,null,opts));
  assert.equal(getter,0);
  assert.throws(()=>core.renderLayer(10,10,recipe(dot({width:1})),{createCanvas(){count++;}})); assert.equal(count,0);
});
for (const [w,h] of [[0,1],[1,0],[-1,1],[1.5,1],[NaN,1],[Infinity,1],['1',1],[4097,1],[1,4097],[4096,4096],[4000,2001]]) {
  test(`reject dimensions ${w} x ${h} before factory allocation`,()=>{let calls=0;assert.throws(()=>core.renderLayer(w,h,null,{createCanvas(){calls++;}}));assert.equal(calls,0);});
}
test('exact 8M-pixel and 4096-edge budgets are accepted without override',()=>{
  assert.equal(fakeRender(4000,2000,null).width,4000);assert.equal(fakeRender(4096,1,null).width,4096);
  assert.throws(()=>core.renderLayer(1,1,null,{maxPixels:9000000}));
});
test('pre-allocation cancellation returns AbortError without allocating',()=>{
  let called=0;assert.throws(()=>core.renderLayer(20,20,null,{createCanvas(){called++;},shouldCancel:()=>true}),{name:'AbortError',code:'PAINT_LAYER_CANCELLED'});assert.equal(called,0);
});
test('cancellation between strokes releases layer and restores context, without publishing',()=>{
  let c,checks=0;assert.throws(()=>core.renderLayer(101,101,recipe(dot(),dot()),{createCanvas:(w,h)=>(c=fakeCanvas(w,h)),shouldCancel:()=>++checks===3}),{name:'AbortError'});
  assert.equal(draws(c).length,1);assert.deepEqual(state(c),c.initial);assert.equal(c.width,0);assert.equal(c.height,0);
});
test('cancellation after the final draw but before return releases completed layer',()=>{
  let c,checks=0;assert.throws(()=>core.renderLayer(101,101,recipe(dot()),{createCanvas:(w,h)=>(c=fakeCanvas(w,h)),shouldCancel:()=>++checks===3}),{name:'AbortError'});
  assert.equal(draws(c).length,1);assert.equal(c.width,0);assert.equal(c.height,0);
});
test('empty-layer cancellation also checked before publication',()=>{
  let c,checks=0;assert.throws(()=>core.renderLayer(101,101,null,{createCanvas:(w,h)=>(c=fakeCanvas(w,h)),shouldCancel:()=>++checks===2}),{name:'AbortError'});assert.equal(c.width,0);
});
test('exception in cancellation callback restores and releases the owned layer',()=>{
  let c,checks=0;const failure=Error('cancel callback failed');assert.throws(()=>core.renderLayer(101,101,recipe(dot()),{createCanvas:(w,h)=>(c=fakeCanvas(w,h)),shouldCancel(){if(++checks===2)throw failure;return false;}}),error=>error===failure);assert.equal(c.width,0);assert.deepEqual(state(c),c.initial);
});
test('factory allocation exception propagates unchanged',()=>{
  const failure=Error('allocation failed');assert.throws(()=>core.renderLayer(101,101,null,{createCanvas(){throw failure;}}),error=>error===failure);
});
for(const kind of ['dimensions','no-context','context-throws','method','save','clear','stroke','fill','restore','publish-size']) test(`clean up ${kind} failure before returning`,()=>{
  let c;const r=recipe(dot({points:kind==='stroke'?[{x:0,y:0},{x:1,y:1}]:[{x:.5,y:.5}]}));
  assert.throws(()=>core.renderLayer(101,101,r,{createCanvas(w,h){c=fakeCanvas(w,h);
    if(kind==='dimensions')c.width=102;
    if(kind==='no-context')c.getContext=()=>null;
    if(kind==='context-throws')c.getContext=()=>{throw Error('context failed');};
    if(kind==='method')delete c.ctx.arc;
    if(['save','restore','stroke','fill'].includes(kind))c.ctx[kind]=()=>{throw Error(kind+' failed');};
    if(kind==='clear')c.ctx.clearRect=()=>{throw Error('clear failed');};
    if(kind==='publish-size'){const original=c.ctx.restore;c.ctx.restore=function(){original.call(this);c.width=102;};}
    return c;
  }}));assert.equal(c.width,0);assert.equal(c.height,0);
  if(['clear','stroke','fill'].includes(kind))assert.deepEqual(state(c),c.initial);
});
test('cleanup continues after failing width setter and never masks render error',()=>{
  let c;const failure=Error('draw failed');assert.throws(()=>core.renderLayer(101,101,recipe(dot()),{createCanvas(w,h){c=fakeCanvas(w,h);Object.defineProperty(c,'width',{get:()=>w,set(){throw Error('dispose width failed');}});c.ctx.fill=()=>{throw failure;};return c;}}),error=>error===failure);assert.equal(c.height,0);
});
test('reused canvas is rejected without damaging the prior published owner',()=>{
  const c=fakeCanvas(101,101);const opts={createCanvas:()=>c};assert.equal(core.renderLayer(101,101,null,opts),c);assert.throws(()=>core.renderLayer(101,101,null,opts),/new, unshared/);assert.equal(c.width,101);assert.equal(c.height,101);
});
test('default no-browser branch fails clearly with no global mutation',()=>{
  if(typeof document==='undefined'&&typeof OffscreenCanvas==='undefined')assert.throws(()=>core.renderLayer(10,10,null),/No Canvas factory/);
});
test('browser default factory initializes exact dimensions and cleans up its own setter failure',()=>{
  const source=fs.readFileSync(require.resolve('../app/src/main/assets/paint-layer.js'),'utf8');let c;
  const sandbox=vm.createContext({document:{createElement(name){assert.equal(name,'canvas');return c=fakeCanvas(300,150);}}});vm.runInContext(source,sandbox);
  assert.equal(sandbox.MintPaintLayer.renderLayer(31,17,null),c);assert.equal(c.width,31);assert.equal(c.height,17);
  let broken;const failing=vm.createContext({document:{createElement(){broken={height:150};Object.defineProperty(broken,'width',{get:()=>300,set(v){if(v!==0&&v!==1)throw Error('size failed');}});return broken;}}});vm.runInContext(source,failing);assert.throws(()=>failing.MintPaintLayer.renderLayer(31,17,null),/size failed/);assert.equal(broken.height,0);
});
test('OffscreenCanvas fallback can render without document',()=>{
  const source=fs.readFileSync(require.resolve('../app/src/main/assets/paint-layer.js'),'utf8');let c;
  function OffscreenCanvas(w,h){return c=fakeCanvas(w,h);}
  const sandbox=vm.createContext({OffscreenCanvas});vm.runInContext(source,sandbox);assert.equal(sandbox.MintPaintLayer.renderLayer(31,17,null),c);
});

// Native raster evidence: real pixels, not just mocked Canvas calls.
nativeTest('native null/default/erase-only/zero-alpha canvases remain entirely transparent',()=>{
  for(const r of [null,core.defaults(),recipe(dot({opacity:0})),recipe(dot({mode:'erase'}))])assert.equal(bytes(render(r)).some(v=>v!==0),false);
});
nativeTest('native dot is a real disc with opaque center and transparent corners',()=>{
  const c=render(recipe(dot()));assert.deepEqual(rgba(c,100,100),[255,0,0,255]);assert.equal(rgba(c,90,90)[3],0);assert.equal(rgba(c,111,100)[3],0);assert.ok(rgba(c,105,100)[3]>200);
});
nativeTest('native individual stroke colors, widths and opacities survive later strokes',()=>{
  const c=render(recipe(dot({color:'#ff0000',width:.04,opacity:.25,points:[{x:.2,y:.5}]}),dot({color:'#0000ff',width:.12,opacity:.75,points:[{x:.8,y:.5}]})));
  const red=rgba(c,40,100),blue=rgba(c,160,100);assert.deepEqual(red.slice(0,3),[255,0,0]);near(red[3],64);assert.deepEqual(blue.slice(0,3),[0,0,255]);near(blue[3],191);assert.equal(rgba(c,46,100)[3],0);assert.ok(rgba(c,168,100)[3]>150);
});
nativeTest('native overlapping separate partial-alpha strokes accumulate with source-over',()=>{
  const c=render(recipe(dot({opacity:.5}),dot({opacity:.5,color:'#0000ff'})));const p=rgba(c,100,100);near(p[3],191);near(p[0],85);near(p[1],0);near(p[2],170);
});
nativeTest('native a self-overlapping continuous stroke applies alpha once, not per segment',()=>{
  const c=render(recipe(dot({opacity:.5,points:[{x:.2,y:.5},{x:.8,y:.5},{x:.2,y:.5},{x:.8,y:.5}]})));near(rgba(c,100,100)[3],128);near(rgba(c,60,100)[3],128);
});
nativeTest('native deterministic partial eraser is correct despite backend destination-out deviation',()=>{
  const c=render(recipe(dot({color:'#1267cd',width:.12}),dot({mode:'erase',color:'#ffffff',width:.08,opacity:.5})));
  const p=rgba(c,100,100);
  near(p[3],128);
  near(p[0],18);near(p[1],103);near(p[2],205);assert.equal(rgba(c,110,100)[3],255);
});
nativeTest('native full erasure can empty a layer despite structural hasPaint=true',()=>{
  const r=recipe(dot({width:.04}),dot({mode:'erase',width:.12}));assert.equal(core.hasPaint(r),true);assert.equal(bytes(render(r)).some(v=>v!==0),false);
});
nativeTest('native paint after erase paints normally and erased pixels reveal backdrop on later composition',()=>{
  const r=recipe(dot({width:.12}),dot({mode:'erase',width:.08}));const layer=render(r);const backdrop=native.createCanvas(201,201);const ctx=backdrop.getContext('2d');ctx.fillStyle='#00ff00';ctx.fillRect(0,0,201,201);ctx.drawImage(layer,0,0);
  assert.deepEqual(rgba(backdrop,100,100),[0,255,0,255]);assert.deepEqual(rgba(backdrop,110,100),[255,0,0,255]);
  const later=render(recipe(...r.strokes,dot({color:'#0000ff',width:.04})));assert.deepEqual(rgba(later,100,100),[0,0,255,255]);
});
nativeTest('native identical straight-line gesture with 2 vs 101 collinear points is byte-identical',()=>{
  const sparse=[{x:.1,y:.5},{x:.9,y:.5}],dense=Array.from({length:101},(_,i)=>({x:.1+.8*i/100,y:.5}));
  for(const mode of ['paint','erase']){const prefix=mode==='erase'?[dot({width:.12,points:sparse})]:[];const a=render(recipe(...prefix,dot({mode,opacity:.37,points:sparse})));const b=render(recipe(...prefix,dot({mode,opacity:.37,points:dense})));assert.deepEqual(bytes(a),bytes(b));}
});
nativeTest('native 1 vs 1024 identical points are byte-identical real dots',()=>{
  const a=render(recipe(dot({opacity:.37}))),b=render(recipe(dot({opacity:.37,points:Array.from({length:1024},()=>({x:.5,y:.5}))})));assert.deepEqual(bytes(a),bytes(b));
});
nativeTest('native source mapping reaches final row/column without shifting to width or height',()=>{
  const c=render(recipe(dot({width:.12,points:[{x:1,y:1}]})),101,51);assert.ok(rgba(c,100,50)[3]>200);assert.equal(rgba(c,96,46)[3],0);
});
nativeTest('native same-aspect dimensions scale geometry and short-edge thickness',()=>{
  const r=recipe(dot({width:.1,points:[{x:.2,y:.5},{x:.8,y:.5}]}));const small=render(r,201,101),large=render(r,401,201);
  assert.equal(rgba(small,100,50)[3],255);assert.equal(rgba(large,200,100)[3],255);assert.equal(rgba(small,100,57)[3],0);assert.equal(rgba(large,200,107)[3],255);assert.equal(rgba(large,200,112)[3],0);
});
nativeTest('native final cancellation shrinks backing store despite zero-dimension reset quirk',()=>{
  let c,n=0;assert.throws(()=>render(recipe(dot()),201,201,{createCanvas(w,h){return c=native.createCanvas(w,h);},shouldCancel:()=>++n===3}),{name:'AbortError'});assert.ok(c.width<=1);assert.ok(c.height<=1);
});
nativeTest('native returned context drawing state is restored',()=>{
  let original;const c=render(recipe(dot()),201,201,{createCanvas(w,h){const canvas=native.createCanvas(w,h),ctx=canvas.getContext('2d');ctx.globalAlpha=.23;ctx.lineWidth=7;ctx.lineCap='square';ctx.globalCompositeOperation='xor';ctx.setLineDash([3,7]);ctx.translate(2,4);original={alpha:ctx.globalAlpha,lineWidth:ctx.lineWidth,lineCap:ctx.lineCap,gco:ctx.globalCompositeOperation,dash:ctx.getLineDash(),matrix:ctx.getTransform()};return canvas;}});
  const ctx=c.getContext('2d');assert.equal(ctx.globalAlpha,original.alpha);assert.equal(ctx.lineWidth,original.lineWidth);assert.equal(ctx.lineCap,original.lineCap);assert.equal(ctx.globalCompositeOperation,original.gco);assert.deepEqual(ctx.getLineDash(),original.dash);assert.deepEqual(ctx.getTransform(),original.matrix);
});

// Metadata-only erase-work preflight and bounded tiled raster erasure.
test('plan returns immutable source-sized metadata without calling any canvas factory',()=>{
 const p=core.plan(201,101,recipe(dot(),dot({mode:'erase',opacity:0})));
 assert.deepEqual(p,{width:201,height:101,pixels:20301,strokeCount:2,totalPoints:2,eraseWorkPixels:0,eraseTileCount:0,maxTilePixels:0});assert.ok(Object.isFrozen(p));
 const empty=core.plan(1,1,null);assert.equal(empty.totalPoints,0);assert.equal(empty.maxTilePixels,0);
});
test('plan includes clipped antialias-aware eraser bounds and <=1M-pixel tiles',()=>{
 const r=recipe(dot({mode:'erase',points:[{x:0,y:0},{x:1,y:1}]}));
 const p=core.plan(1400,900,r);assert.equal(p.eraseWorkPixels,1260000);assert.equal(p.eraseTileCount,2);assert.equal(p.maxTilePixels,900000);
 const single=core.plan(1,1,r);assert.equal(single.eraseWorkPixels,1);assert.equal(single.eraseTileCount,1);assert.equal(single.maxTilePixels,1);
});
test('32M cumulative eraser pixels accepted and overflow rejected before any allocation',()=>{
 const s=dot({mode:'erase',points:[{x:0,y:0},{x:1,y:1}]});
 const exactly=recipe(...Array.from({length:4},()=>clone(s)));assert.equal(core.plan(4000,2000,exactly).eraseWorkPixels,32000000);
 const excessive=recipe(...exactly.strokes,clone(s));let calls=0;assert.throws(()=>core.plan(4000,2000,excessive),/pixel-work budget/);
 assert.throws(()=>core.renderLayer(4000,2000,excessive,{createCanvas(){calls++;}}),/pixel-work budget/);assert.equal(calls,0);
});
test('zero-opacity erasers consume recipe limits but no pixel work, allocations or readbacks',()=>{
 const r=recipe(...Array.from({length:128},()=>dot({mode:'erase',opacity:0,points:[{x:0,y:0},{x:1,y:1}]})));
 const p=core.plan(4000,2000,r);assert.equal(p.eraseWorkPixels,0);assert.equal(p.totalPoints,256);
 const c=fakeRender(100,100,r);assert.equal(c.surfaces.length,1);assert.equal(c.calls.filter(x=>x[0]==='getImageData').length,0);
});
test('all coverage canvases are <=1M pixels and released before the layer is returned',()=>{
 const sizes=[];let output;const surfaces=[];const r=recipe(dot({mode:'erase',points:[{x:0,y:0},{x:1,y:1}]}));
 const c=core.renderLayer(1400,900,r,{createCanvas(w,h){sizes.push([w,h]);const c=fakeCanvas(w,h);surfaces.push(c);if(!output)output=c;return c;}});
 assert.equal(c,output);assert.deepEqual(sizes,[[1400,900],[1000,900]]);assert.ok(sizes.slice(1).every(([w,h])=>w*h<=1000000));
 for(const mask of surfaces.slice(1)){assert.equal(mask.width,0);assert.equal(mask.height,0);assert.equal(draws(mask).length,2);assert.equal(mask.stack.length,0);}
});
test('cancel after first tile prevents the next tile and destroys the unpublished layer',()=>{
 let checks=0;const surfaces=[];const r=recipe(dot({mode:'erase',points:[{x:0,y:0},{x:1,y:1}]}));
 assert.throws(()=>core.renderLayer(1400,900,r,{createCanvas(w,h){const c=fakeCanvas(w,h);surfaces.push(c);return c;},shouldCancel:()=>++checks===6}),{name:'AbortError'});
 assert.equal(surfaces.length,2);assert.equal(surfaces[0].calls.filter(x=>x[0]==='putImageData').length,1);
 for(const c of surfaces){assert.equal(c.width,0);assert.equal(c.height,0);assert.equal(c.stack.length,0);}
});
for(const kind of ['allocation','mask-context','mask-fill','mask-read','layer-read','layer-write','bad-image'])test(`release layer and tile after ${kind} failure`,()=>{
 const surfaces=[];const failure=Error(kind+' failed');
 assert.throws(()=>core.renderLayer(101,101,recipe(dot({mode:'erase'})),{createCanvas(w,h){
  if(surfaces.length===1&&kind==='allocation')throw failure;
  const c=fakeCanvas(w,h);surfaces.push(c);const isMask=surfaces.length===2;
  if(isMask&&kind==='mask-context')c.getContext=()=>{throw failure;};
  if(isMask&&kind==='mask-fill')c.ctx.fill=()=>{throw failure;};
  if(isMask&&kind==='mask-read')c.ctx.getImageData=()=>{throw failure;};
  if(!isMask&&kind==='layer-read')c.ctx.getImageData=()=>{throw failure;};
  if(!isMask&&kind==='layer-write')c.ctx.putImageData=()=>{throw failure;};
  if(isMask&&kind==='bad-image')c.ctx.getImageData=()=>({width:w,height:h,data:new Uint8ClampedArray(4)});
  return c;
 }}));for(const c of surfaces){assert.equal(c.width,0);assert.equal(c.height,0);}
});
test('failed coverage factory cannot reuse or clear the published canvas from an earlier render',()=>{
 const prior=fakeCanvas(101,101);core.renderLayer(101,101,null,{createCanvas:()=>prior});let calls=0,owned;
 assert.throws(()=>core.renderLayer(101,101,recipe(dot({mode:'erase'})),{createCanvas(w,h){return ++calls===1?(owned=fakeCanvas(w,h)):prior;}}),/new, unshared/);
 assert.equal(prior.width,101);assert.equal(prior.height,101);assert.equal(owned.width,0);
});

function referenceDraw(ctx,w,h,s,opaque){
 const first=s.points[0],x=p=>p.x*(w-1),y=p=>p.y*(h-1);
 ctx.globalCompositeOperation='source-over';ctx.globalAlpha=opaque?1:s.opacity;ctx.fillStyle=ctx.strokeStyle=opaque?'#000000':s.color;ctx.lineWidth=s.width*Math.min(w,h);ctx.lineCap=ctx.lineJoin='round';ctx.beginPath();
 if(s.points.every(p=>x(p)===x(first)&&y(p)===y(first))){ctx.arc(x(first),y(first),ctx.lineWidth/2,0,Math.PI*2);ctx.fill();}
 else{ctx.moveTo(x(first),y(first));for(const p of s.points.slice(1))ctx.lineTo(x(p),y(p));ctx.stroke();}
}
function fullMaskReference(strokes,w,h){
 const out=native.createCanvas(w,h),ctx=out.getContext('2d');
 for(const s of strokes){if(!s.opacity)continue;if(s.mode==='paint'){referenceDraw(ctx,w,h,s,false);continue;}
  const mask=native.createCanvas(w,h),m=mask.getContext('2d');referenceDraw(m,w,h,s,true);const coverage=m.getImageData(0,0,w,h).data,im=ctx.getImageData(0,0,w,h);
  for(let i=3;i<im.data.length;i+=4){im.data[i]=Math.round(im.data[i]*(1-s.opacity*coverage[i]/255));if(!im.data[i])im.data[i-1]=im.data[i-2]=im.data[i-3]=0;}ctx.putImageData(im,0,0);mask.width=1;mask.height=1;
 }return out;
}
function equalBytes(a,b){assert.equal(a.length,b.length);let count=0,maximum=0,first=-1;for(let i=0;i<a.length;i++){if(a[i]!==b[i]){count++;maximum=Math.max(maximum,Math.abs(a[i]-b[i]));if(first<0)first=i;}}assert.equal(count,0,`${count} byte mismatches, maximum ${maximum}, first ${first}`);}
function boundedNativeEdges(actual,reference,width,height,maxAlpha,maxPremultiplied){
 const a=bytes(actual),b=bytes(reference);let peakAlpha=0,peakPremultiplied=0,interior=0,seamInterior=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4,alpha=Math.abs(a[i+3]-b[i+3]);peakAlpha=Math.max(peakAlpha,alpha);
  for(let c=0;c<3;c++)peakPremultiplied=Math.max(peakPremultiplied,Math.abs(a[i+c]*a[i+3]/255-b[i+c]*b[i+3]/255));
  if(x<2||y<2||x>=width-2||y>=height-2||!b[i+3])continue;
  let flat=true;neighbors:for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const k=((y+dy)*width+x+dx)*4;for(let c=0;c<4;c++)if(b[k+c]!==b[i+c]){flat=false;break neighbors;}}
  if(flat){interior++;if(Math.abs(x-1000)<=3)seamInterior++;for(let c=0;c<4;c++)assert.equal(a[i+c],b[i+c],`tile-interior gap or overerase at ${x},${y}, channel${c}`);}
 }
 assert.ok(interior>10000);assert.ok(seamInterior>100);assert.ok(peakAlpha<=maxAlpha,`native edge alpha delta ${peakAlpha}`);assert.ok(peakPremultiplied<=maxPremultiplied,`native premultiplied edge delta ${peakPremultiplied}`);
}
nativeTest('native deterministic eraser .25/.5/.75 uses requested alpha without whitening',()=>{
 for(const opacity of [.25,.5,.75]){const p=rgba(render(recipe(dot({color:'#1267cd'}),dot({mode:'erase',opacity}))),100,100);near(p[3],Math.round(255*(1-opacity)),0);near(p[0],18);near(p[1],103);near(p[2],205);}
});
nativeTest('native repeated .25/.5 erasers multiply remaining alpha once per stroke',()=>{
 for(const opacity of [.25,.5]){const p=rgba(render(recipe(dot(),dot({mode:'erase',opacity}),dot({mode:'erase',opacity}))),100,100);assert.equal(p[3],Math.round(Math.round(255*(1-opacity))*(1-opacity)));}
});
nativeTest('native one self-overlapping erase gesture reduces alpha once at crossings',()=>{
 const points=[{x:.2,y:.5},{x:.8,y:.5},{x:.2,y:.5},{x:.8,y:.5}];const p=rgba(render(recipe(dot({width:.12,points}),dot({mode:'erase',opacity:.5,points}))),100,100);assert.equal(p[3],128);
});
nativeTest('native tiled diagonal has exact interiors and explicitly bounded antialiased-edge differences',()=>{
 const points=[{x:0,y:0},{x:1,y:1}];const strokes=[dot({color:'#ff6600',opacity:.7,width:.12,points}),dot({mode:'erase',opacity:.25,width:.06,points})];
 const r=recipe(...strokes);assert.equal(core.plan(1400,900,r).eraseTileCount,2);boundedNativeEdges(render(r,1400,900),fullMaskReference(strokes,1400,900),1400,900,5,5);
});
nativeTest('native tiled bends preserve tile interiors; whole-mask edge byte equivalence is NOT claimed',()=>{
 const points=[{x:0,y:0},{x:1,y:1},{x:.03,y:.78},{x:.9,y:.1}];const strokes=[dot({color:'#4682b4',width:.12,points}),dot({mode:'erase',opacity:.5,width:.08,points}),dot({mode:'erase',opacity:.25,width:.04,points})];
 assert.equal(core.plan(1400,900,recipe(...strokes)).eraseTileCount,4);boundedNativeEdges(render(recipe(...strokes),1400,900),fullMaskReference(strokes,1400,900),1400,900,19,14);
});
nativeTest('native small clipped erase bbox matches independent full-image coverage exactly',()=>{
 const strokes=[dot({color:'#139ac1',width:.12}),dot({mode:'erase',width:.03,opacity:.5,points:[{x:.49,y:.49},{x:.51,y:.52}]})];equalBytes(bytes(render(recipe(...strokes))),bytes(fullMaskReference(strokes,201,201)));
});
nativeTest('native tile boundary has neither gaps nor extra erasure through opaque stroke interiors',()=>{
 const points=[{x:0,y:0},{x:0,y:.5},{x:1,y:.5},{x:1,y:1}];const strokes=[dot({width:.12,points}),dot({mode:'erase',width:.06,opacity:.5,points})];
 const result=render(recipe(...strokes),1400,900),expected=fullMaskReference(strokes,1400,900);
 for(let x=995;x<=1005;x++)for(let y=430;y<=470;y++){assert.deepEqual(rgba(result,x,y),rgba(expected,x,y));assert.equal(rgba(result,x,y)[3],128);}
});
