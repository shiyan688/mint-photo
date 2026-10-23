'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const S = require('../app/src/main/assets/straighten.js');
const geometryPath = require.resolve('../app/src/main/assets/geometry.js');
const G = fs.existsSync(geometryPath) ? require(geometryPath) : null;
const recipe = (angle = 0, mode = 'expand') => ({ version: 1, angle, mode });
const rng = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
function image(w, h, rgba) {
  const data = new Uint8ClampedArray(w * h * 4);
  if (rgba) for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width: w, height: h, data };
}
function randomImage(w, h, seed) { const im = image(w, h), rand = rng(seed); for (let i=0;i<im.data.length;i++) im.data[i]=Math.floor(rand()*256); return im; }
function bad(fn, code='STRAIGHTEN_INVALID') { assert.throws(fn, e => e.code === code); }
function same(a,b) { assert.equal(a.width,b.width);assert.equal(a.height,b.height);assert.deepEqual(a.data,b.data); }
function referenceQuarter(im, angle) {
  let out = { width: im.width, height: im.height, data: new Uint8ClampedArray(im.data) };
  const n = ((angle / 90) % 4 + 4) % 4;
  for (let k=0;k<n;k++) {
    const next=image(out.height,out.width);
    for (let y=0;y<out.height;y++) for(let x=0;x<out.width;x++) {
      const dest=((x*next.width)+(out.height-1-y))*4,src=(y*out.width+x)*4;
      next.data.set(out.data.subarray(src,src+4),dest);
    }
    out=next;
  }
  return out;
}
// Independent reference: direct signed-angle trig, explicit inverse 2x2 matrix,
// point-to-neighbor distances, no module plan/helper/LUT or optimized row state.
function referenceArbitrary(im,r,w,h) {
  const rad=r.angle*Math.PI/180, c=Math.cos(rad),s=Math.sin(rad),det=c*c+s*s;
  const out=image(w,h);
  function decode(byte) { const v=byte/255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4; }
  function encode(v) {return Math.round((v<=0.0031308?12.92*v:1.055*v**(1/2.4)-0.055)*255);}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const u=x-(w-1)/2,v=y-(h-1)/2;
    const sx=(c*u+s*v)/det+(im.width-1)/2,sy=(-s*u+c*v)/det+(im.height-1)/2;
    const sum=[0,0,0,0];
    for(const yy of [Math.floor(sy),Math.floor(sy)+1]) for(const xx of [Math.floor(sx),Math.floor(sx)+1]) {
      if(xx<0||yy<0||xx>=im.width||yy>=im.height)continue;
      const q=(yy*im.width+xx)*4, weight=(1-Math.abs(xx-sx))*(1-Math.abs(yy-sy)),a=im.data[q+3]/255;
      sum[3]+=weight*a; for(let k=0;k<3;k++)sum[k]+=weight*a*decode(im.data[q+k]);
    }
    const q=(y*w+x)*4,alpha=Math.round(sum[3]*255);
    if(alpha){for(let k=0;k<3;k++)out.data[q+k]=encode(sum[k]/sum[3]);out.data[q+3]=alpha;}
  }
  return out;
}
function assertCropCorners(p) {
  const {width:w,height:h}=p.outputSize,{width:sw,height:sh}=p.sourceSize;
  const c=p.cos,s=p.sin,tol=128*Number.EPSILON*Math.max(sw,sh);
  for(const x of [0,w-1])for(const y of [0,h-1]){
    const u=x-(w-1)/2,v=y-(h-1)/2;
    const a=c*u+s*v+(sw-1)/2,b=-s*u+c*v+(sh-1)/2;
    assert(a>=-tol&&a<=sw-1+tol&&b>=-tol&&b<=sh-1+tol,JSON.stringify({p,a,b}));
  }
}
// Independent 1-D concave-product search: no analytic candidate intersections.
function maximumAreaOracle(W,H,c,s) {
  if(!W||!H)return 0;
  let low=0,high=Math.min(W/c,H/s);
  const value=x=>x*Math.max(0,Math.min((W-c*x)/s,(H-s*x)/c));
  for(let i=0;i<120;i++){const a=(2*low+high)/3,b=(low+2*high)/3;if(value(a)<value(b))low=a;else high=b;}
  return value((low+high)/2);
}

test('frozen CommonJS and browser UMD APIs and exact default schema',()=>{
  assert(Object.isFrozen(S));assert(Object.isFrozen(S.LIMITS));
  assert.deepEqual(S.defaults(),recipe());assert.notEqual(S.defaults(),S.defaults());assert(Object.isFrozen(S.defaults()));
  const c=vm.createContext({});vm.runInContext(fs.readFileSync(require.resolve('../app/src/main/assets/straighten.js'),'utf8'),c);
  assert.equal(typeof c.MintStraighten.apply,'function');assert.equal(c.MintStraighten.version,'1.0.0');
});
test('canonical frozen recipes, null defaults and no aliasing',()=>{
  assert.deepEqual(S.validate(null),recipe());assert.deepEqual(S.validate(undefined),recipe());
  const r=recipe(-0,'crop'),v=S.validate(r);r.mode='expand';
  assert(Object.isFrozen(v));assert.equal(v.mode,'crop');assert.equal(Object.is(v.angle,-0),false);
  assert.deepEqual(S.validate(Object.assign(Object.create(null),recipe(12))),recipe(12));
  assert.equal(S.isActive(recipe(0,'crop')),false);assert.equal(S.isActive(recipe(1e-12)),true);
});
test('recipe fields must be own enumerable data; getters, symbols, extras and unsafe prototypes rejected unread',()=>{
  let called=0;
  for(const key of Object.keys(recipe())){
    const missing=recipe();delete missing[key];bad(()=>S.validate(missing));
    const accessor=recipe();Object.defineProperty(accessor,key,{enumerable:true,get(){called++;throw Error('read');}});bad(()=>S.validate(accessor));
    const hidden=recipe();Object.defineProperty(hidden,key,{enumerable:false,value:hidden[key]});bad(()=>S.validate(hidden));
  }
  for(const value of [[],()=>{},true,'{}',new Date(),Object.assign(Object.create({}),recipe()),{...recipe(),extra:0},{...recipe(),[Symbol('x')]:0}])bad(()=>S.validate(value));
  const inherited=Object.create({get angle(){called++;return 2;}});Object.assign(inherited,{version:1,mode:'crop'});bad(()=>S.validate(inherited));
  assert.equal(called,0);
});
test('angle and enum validation rejects coercion and unsupported recipes',()=>{
  for(const angle of [NaN,Infinity,-Infinity,{},new Number(0),'0',true,null])bad(()=>S.validate(recipe(angle)));
  for(const angle of [-180.000001,180.000001])bad(()=>S.validate(recipe(angle)),'STRAIGHTEN_LIMIT');
  for(const patch of [{version:2},{version:'1'},{mode:'Crop'},{mode:''},{mode:null}])bad(()=>S.validate({...recipe(),...patch}));
  for(const a of [-180,-90,0,90,180])assert.equal(S.validate(recipe(a)).angle,a);
  bad(()=>S.plan(3,3,recipe(Number.MIN_VALUE)),'STRAIGHTEN_LIMIT');
  bad(()=>S.plan(3,3,recipe(-Number.MIN_VALUE)),'STRAIGHTEN_LIMIT');
});
test('source and output dimensions, pixel, edge and work budgets preflight',()=>{
  for(const [w,h] of [[0,1],[1,0],[-1,2],[2.5,2],[NaN,2],['2',2],[16385,1],[8193,8192]])bad(()=>S.plan(w,h,recipe()),'STRAIGHTEN_LIMIT');
  const p=S.plan(8192,8192,recipe(90));assert.equal(p.estimates.totalRgbaBytes,512*1024*1024);
  assert.equal(p.estimates.workUnits,64*1024*1024);assert.equal(p.estimates.extraBytes,p.estimates.outputBytes+2048);
  bad(()=>S.plan(8192,8192,recipe(45)),'STRAIGHTEN_LIMIT');
  bad(()=>S.plan(16384,1,recipe(0.00001)),'STRAIGHTEN_LIMIT');
  const identity=S.plan(8192,8192,recipe());assert.equal(identity.estimates.outputBytes,0);assert.equal(identity.estimates.workUnits,0);
});
test('plans are deeply immutable snapshots with fixed coordinate/estimate fields',()=>{
  const r=recipe(17),p=S.plan(13,7,r);r.angle=0;
  for(const o of [p,p.sourceSize,p.outputSize,p.sourceCenter,p.outputCenter,p.recipe,p.estimates])assert(Object.isFrozen(o));
  assert.equal(p.recipe.angle,17);assert.equal(p.quarterTurns,null);assert.equal(p.isQuarterTurn,false);
  assert.equal(p.estimates.sourcePixels,91);assert.equal(p.estimates.outputPixels,p.outputSize.width*p.outputSize.height);
  assert.equal(p.estimates.bilinearTaps,4*p.estimates.outputPixels);
  assert.equal(p.estimates.workUnits,p.estimates.bilinearTaps);
  assert.equal(p.sourceCenter.x,6);assert.equal(p.sourceCenter.y,3);
  assert(Object.isFrozen(S.plan(13,7,recipe(17,'crop')).cropCenterExtents));
});
test('identity returns exact original object, view and hidden RGB unchanged',()=>{
  for(const data of [new Uint8Array([99,88,77,0]),new Uint8ClampedArray([99,88,77,0])]){
    const im={width:1,height:1,data};for(const mode of ['crop','expand'])assert.equal(S.apply(im,recipe(-0,mode)),im);
  }
});
test('every exact quarter-turn matches independent raster rotation over asymmetric odd/even sizes',()=>{
  for(let w=1;w<=9;w++)for(let h=1;h<=8;h++)for(const angle of [-180,-90,0,90,180])for(const mode of ['crop','expand']){
    const im=randomImage(w,h,w*100+h);for(let i=3;i<im.data.length;i+=12)im.data[i]=0;
    const before=new Uint8ClampedArray(im.data),out=S.apply(im,recipe(angle,mode));
    same(out,referenceQuarter(im,angle));assert.deepEqual(im.data,before);
    if(angle!==0){assert.notEqual(out,im);assert.notEqual(out.data,im.data);}
    const p=S.plan(w,h,recipe(angle,mode));assert.equal(p.quarterTurns,((angle/90)%4+4)%4);
  }
});
test('exact quarter-turn byte parity with frozen mobile Geometry', {skip:!G},()=>{
  for(let w=1;w<=11;w++)for(let h=1;h<=10;h++)for(const angle of [-180,-90,0,90,180]){
    const im=randomImage(w,h,w*19+h);for(let i=3;i<im.data.length;i+=8)im.data[i]=0;
    same(S.apply(im,recipe(angle)),G.apply(im,{...G.defaults(),quarterTurns:((angle/90)%4+4)%4}));
  }
});
test('near-quarter and tiny nonzero angles never enter integer/identity branch',()=>{
  for(const a of [-179.99999999999997,-90.00000000000001,-89.99999999999999,-1e-15,1e-15,89.99999999999999,90.00000000000001,179.99999999999997]){
    const p=S.plan(4,3,recipe(a,'crop'));assert.equal(p.quarterTurns,null);assert.equal(p.isQuarterTurn,false);
    const im=image(4,3,[24,200,120,0]),out=S.apply(im,recipe(a,'crop'));
    assert.notEqual(out,im);assert(out.data.every(v=>v===0));
  }
  for(const a of [89.99999999999999,90.00000000000001])assert.deepEqual(S.plan(4,3,recipe(a,'crop')).outputSize,{width:2,height:3});
});
test('expand ceil edge-AABB is centered with explicit transparent corners',()=>{
  for(const angle of [-135,-44,-12,12,44,135]){
    const p=S.plan(9,5,recipe(angle)),out=S.apply(image(9,5,[255,100,20,255]),recipe(angle));
    const rad=angle*Math.PI/180;
    assert.equal(p.outputSize.width,Math.ceil(Math.abs(Math.cos(rad))*9+Math.abs(Math.sin(rad))*5));
    assert.equal(p.outputSize.height,Math.ceil(Math.abs(Math.sin(rad))*9+Math.abs(Math.cos(rad))*5));
    assert.equal(out.data[3],0);assert.equal(out.data.at(-1),0);
    assert.deepEqual(S.mapEdgePoint(p,{x:4.5,y:2.5}),{x:out.width/2,y:out.height/2});
  }
});
test('expand preserves positive sub-ULP edge extents before ceiling',()=>{
  // Before correction: 100x1 near90 incorrectly gave 2x100; 2x3 at1e-20
  // incorrectly gave 2x3. Real edge-AABB ceiling requires both increments.
  for(const angle of [89.99999999999999,90.00000000000001,-89.99999999999999,-90.00000000000001]){
    assert.deepEqual(S.plan(100,1,recipe(angle)).outputSize,{width:2,height:101});
    assert.deepEqual(S.plan(1,100,recipe(angle)).outputSize,{width:101,height:2});
  }
  for(const angle of [1e-20,-1e-20,1e-15,-1e-15])assert.deepEqual(S.plan(2,3,recipe(angle)).outputSize,{width:3,height:4});
  for(const angle of [179.99999999999997,-179.99999999999997])assert.deepEqual(S.plan(2,3,recipe(angle)).outputSize,{width:3,height:4});
  for(const angle of [0,90,-90,180,-180]){
    const odd=Math.abs(angle)===90;
    assert.deepEqual(S.plan(100,1,recipe(angle)).outputSize,odd?{width:1,height:100}:{width:100,height:1});
  }
  bad(()=>S.plan(16384,1,recipe(1e-20)),'STRAIGHTEN_LIMIT');
  bad(()=>S.plan(1,16384,recipe(89.99999999999999)),'STRAIGHTEN_LIMIT');
});
test('clockwise inverse signs verified using an asymmetric landmark',()=>{
  const im=image(5,5);im.data.set([255,0,0,255],(0*5+2)*4);
  const out=S.apply(im,recipe(30)),p=S.plan(5,5,recipe(30));let ax=0,ay=0,sum=0;
  for(let y=0;y<out.height;y++)for(let x=0;x<out.width;x++){const a=out.data[(y*out.width+x)*4+3];ax+=x*a;ay+=y*a;sum+=a;}
  assert(ax/sum>p.outputCenter.x);assert(ay/sum<p.outputCenter.y);
});
test('arbitrary bilinear samples agree with independent exact-sRGB reference',()=>{
  const rand=rng(204);
  for(let n=0;n<160;n++){
    const im=randomImage(1+Math.floor(rand()*13),1+Math.floor(rand()*12),n+1),r=recipe(-177+rand()*354,n%2?'crop':'expand');
    const out=S.apply(im,r),ref=referenceArbitrary(im,r,out.width,out.height);
    for(let k=0;k<out.data.length;k++)assert(Math.abs(out.data[k]-ref.data[k])<=1,`case ${n}, byte ${k}: ${out.data[k]} vs ${ref.data[k]}`);
  }
});
test('linear-light midpoint is bright rather than gamma-dark',()=>{
  const im=image(2,1);im.data.set([0,0,0,255,255,255,255,255]);
  const out=S.apply(im,recipe(45,'crop'));assert.deepEqual(out.data,new Uint8ClampedArray([188,188,188,255]));
});
test('premultiplication ignores hidden RGB and never creates alpha-zero nonblack output',()=>{
  const a=image(4,3,[0,255,0,0]),b=image(4,3,[255,0,255,0]);
  for(const im of [a,b])im.data.set([255,30,5,255],(1*4+2)*4);
  for(const angle of [1,17,45,-71,91])for(const mode of ['expand','crop']){
    const out=S.apply(a,recipe(angle,mode)),ref=S.apply(b,recipe(angle,mode));same(out,ref);
    for(let k=0;k<out.data.length;k+=4)if(!out.data[k+3])assert.deepEqual(Array.from(out.data.slice(k,k+4)),[0,0,0,0]);
    for(let k=0;k<out.data.length;k+=4)if(out.data[k+3])assert.deepEqual(Array.from(out.data.slice(k,k+3)),[255,30,5]);
  }
});
test('low alpha is correctly quantized and transparent pixels have black RGB',()=>{
  const im=image(1,1,[255,128,64,1]),out=S.apply(im,recipe(45));
  assert(out.data.every(v=>v===0));
});
test('every byte-valued color/alpha survives a centered arbitrary single-pixel sample',()=>{
  for(let v=0;v<=255;v++){
    const im=image(1,1,[v,255-v,(v*17)%256,v]),out=S.apply(im,recipe(23,'crop'));
    assert.deepEqual(Array.from(out.data),v?[v,255-v,(v*17)%256,v]:[0,0,0,0]);
  }
});
test('crop center-extent candidate matches independent concave search over random dimensions',()=>{
  const rand=rng(551);
  for(let n=0;n<5000;n++){
    const w=1+Math.floor(rand()*16384),h=1+Math.floor(rand()*Math.min(16384,Math.floor(S.LIMITS.maxPixels/w)));
    const a=-179.9+rand()*359.8,p=S.plan(w,h,recipe(a,'crop')),e=p.cropCenterExtents,c=Math.abs(p.cos),s=Math.abs(p.sin);
    const expected=maximumAreaOracle(w-1,h-1,c,s),actual=e.x*e.y;
    assert(Math.abs(actual-expected)<=Math.max(1e-7,expected*1e-11),JSON.stringify({w,h,a,expected,actual}));
    assertCropCorners(p);assert.equal(p.outputSize.width,e.integerWidth);assert.equal(p.outputSize.height,e.integerHeight);assert(Math.abs(p.outputSize.width-(Math.floor(e.x)+1))<=1);assert(Math.abs(p.outputSize.height-(Math.floor(e.y)+1))<=1);
  }
});
test('crop maximizer dominates brute-force feasible small-span candidates, not maximum raster count',()=>{
  for(let w=2;w<=9;w++)for(let h=2;h<=9;h++)for(const angle of [1,17,31,44.99999,45,45.00001,67,89]){
    const p=S.plan(w,h,recipe(angle,'crop')),c=Math.abs(p.cos),s=Math.abs(p.sin),area=p.cropCenterExtents.x*p.cropCenterExtents.y;
    for(let ix=0;ix<=80;ix++){const x=Math.min((w-1)/c,(h-1)/s)*ix/80;for(let iy=0;iy<=80;iy++){
      const y=Math.min((w-1)/s,(h-1)/c)*iy/80;
      if(c*x+s*y<=w-1&&s*x+c*y<=h-1)assert(x*y<=area+1e-8);
    }}
  }
  assert.deepEqual(S.plan(3,4,recipe(31,'crop')).outputSize,{width:2,height:2});
});
test('thin, one-pixel, 45-degree and nearest-quarter crop boundaries are finite and inside',()=>{
  const angles=[-179.99999999999997,-135,-90.00000000000001,-89.99999999999999,-45.00000000000001,-45,-44.99999999999999,-0.001,0.001,44.99999999999999,45,45.00000000000001,89.99999999999999,90.00000000000001,135,179.99999999999997];
  for(const [w,h] of [[1,1],[1,999],[999,1],[2,1000],[1000,2],[3,16384],[16384,3],[100,100],[8192,8192]])for(const a of angles){
    const p=S.plan(w,h,recipe(a,'crop'));assertCropCorners(p);
    assert(Number.isFinite(p.outputSize.width));assert(Number.isFinite(p.outputSize.height));
    if(w===1||h===1)assert.deepEqual(p.outputSize,{width:1,height:1});
  }
  for(const a of [89.99999999999999,90.00000000000001])assert.deepEqual(S.plan(2,1000,recipe(a,'crop')).outputSize,{width:999,height:1});
  assert.deepEqual(S.plan(2,1000,recipe(0.001,'crop')).outputSize,{width:1,height:999});
  assert.deepEqual(S.plan(2,1000,recipe(45,'crop')).outputSize,{width:1,height:1});
  assert.deepEqual(S.plan(100,100,recipe(45,'crop')).outputSize,{width:71,height:71});
});
test('opaque crop inputs never produce a transparent or partial-alpha corner or pixel',()=>{
  const angles=[0.001,0.5,5,17,31,44.99999999999999,45,45.00000000000001,67,89.99999999999999,90.00000000000001,135,179.99999999999997];
  for(let w=1;w<20;w++)for(let h=1;h<20;h++)for(const a of angles){
    const out=S.apply(image(w,h,[9,101,255,255]),recipe(a,'crop'));
    for(let i=0;i<out.data.length;i+=4)assert.deepEqual(Array.from(out.data.slice(i,i+4)),[9,101,255,255]);
  }
});
test('source view strictness rejects Buffer, foreign, subclass, wrong length, detached/shared/resizable data',()=>{
  const samples=[Buffer.alloc(4),new Uint16Array(4),new DataView(new ArrayBuffer(4)),[0,0,0,0],new Uint8Array(3),new Uint8Array(5),new(class extends Uint8Array{})(4),vm.runInNewContext('new Uint8Array(4)'),Object.create(Uint8Array.prototype)];
  if(typeof SharedArrayBuffer==='function')samples.push(new Uint8Array(new SharedArrayBuffer(4)));
  if(Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable'))samples.push(new Uint8Array(new ArrayBuffer(4,{maxByteLength:8})));
  const detached=new Uint8Array(4);structuredClone(detached.buffer,{transfer:[detached.buffer]});samples.push(detached);
  for(const data of samples)bad(()=>S.apply({width:1,height:1,data},recipe(10)));
  const buffer=new ArrayBuffer(20),view=new Uint8Array(buffer,4,4);view.set([1,2,3,4]);
  assert.equal(S.apply({width:1,height:1,data:view},recipe()).data,view);
});
test('intrinsic source metadata never invokes shadowing typed-array getters',()=>{
  const data=new Uint8Array([12,34,56,255]);let reads=0;
  for(const key of ['length','buffer','byteLength','byteOffset'])Object.defineProperty(data,key,{get(){reads++;throw Error('shadow getter');}});
  const out=S.apply({width:1,height:1,data},recipe(25,'crop'));
  assert.deepEqual(Array.from(out.data),[12,34,56,255]);assert.equal(reads,0);
});
test('image/options records reject accessors or unsafe prototypes without inherited getter calls',()=>{
  let calls=0;const base=image(1,1);
  for(const key of ['width','height','data']){
    const im={...base};Object.defineProperty(im,key,{enumerable:true,get(){calls++;throw Error('getter');}});bad(()=>S.apply(im,recipe(10)));
  }
  bad(()=>S.apply({...base,extra:1},recipe(10)));bad(()=>S.apply({...base,[Symbol('extra')]:1},recipe(10)));
  bad(()=>S.apply(Object.assign(Object.create({}),base),recipe(10)));
  for(const options of [[],{extra:1},{shouldCancel:1},Object.create({get shouldCancel(){calls++;return()=>false;}})])bad(()=>S.apply(base,recipe(10),options));
  bad(()=>S.apply(base,recipe(10),Object.defineProperty({},'shouldCancel',{enumerable:true,get(){calls++;}})));
  Object.defineProperty(Object.prototype,'shouldCancel',{configurable:true,get(){calls++;throw Error('inherited');}});
  try{S.apply(base,recipe(10),{});}finally{delete Object.prototype.shouldCancel;}
  assert.equal(calls,0);
});
test('strict preflight occurs before cancellation callbacks or output-array allocation',()=>{
  let callbacks=0;bad(()=>S.apply(image(1,1),{...recipe(),extra:1},{shouldCancel(){callbacks++;}}));assert.equal(callbacks,0);
  const context=vm.createContext({});
  vm.runInContext(`const Native = Uint8ClampedArray; globalThis.allocations=0; globalThis.im={width:1,height:1,data:new Native(4)};
    globalThis.Uint8ClampedArray=function(n){allocations++;return new Native(n)};Uint8ClampedArray.prototype=Native.prototype;`,context);
  vm.runInContext(fs.readFileSync(require.resolve('../app/src/main/assets/straighten.js'),'utf8'),context);
  assert.throws(()=>vm.runInContext(`MintStraighten.apply(im,{version:1,angle:1,mode:'expand',extra:1})`,context));
  assert.equal(context.allocations,0);
  assert.throws(()=>vm.runInContext(`MintStraighten.apply(im,{version:1,angle:1,mode:'expand'},{shouldCancel:()=>true})`,context));
  assert.equal(context.allocations,0);
  vm.runInContext(`MintStraighten.apply(im,{version:1,angle:1,mode:'expand'})`,context);assert.equal(context.allocations,1);
});
test('preflight counts retained backing buffer, not only a small RGBA subview',()=>{
  // The large untouched ArrayBuffer is virtual; no output buffer may be allocated.
  const backing=new ArrayBuffer(S.LIMITS.maxBytes+1),im={width:1,height:1,data:new Uint8Array(backing,0,4)};
  bad(()=>S.apply(im,recipe()),'STRAIGHTEN_LIMIT');
});
test('cancellation before/within/after loops fails without returning partial output or modifying source',()=>{
  for(const angle of [0,13,90,180]){
    const im=randomImage(60,40,17),before=im.data.slice();let calls=0;
    assert.throws(()=>S.apply(im,recipe(angle),{shouldCancel(){calls++;return true;}}),e=>e.name==='AbortError'&&e.code==='STRAIGHTEN_CANCELLED');
    assert.equal(calls,1);assert.deepEqual(im.data,before);
    if(angle){calls=0;assert.throws(()=>S.apply(im,recipe(angle),{shouldCancel(){return ++calls===4;}}),e=>e.code==='STRAIGHTEN_CANCELLED');assert.equal(calls,4);assert.deepEqual(im.data,before);}
  }
  const wide=image(4096,1);let calls=0;assert.throws(()=>S.apply(wide,recipe(180),{shouldCancel(){return ++calls===3;}}),e=>e.code==='STRAIGHTEN_CANCELLED');assert.equal(calls,3);
  const im=image(1,1);let finalCalls=0;assert.throws(()=>S.apply(im,recipe(45,'crop'),{shouldCancel(){return ++finalCalls===3;}}),e=>e.code==='STRAIGHTEN_CANCELLED');
});
test('callback exceptions propagate and source detachment is caught fail-safe',()=>{
  const sentinel=new Error('callback');assert.throws(()=>S.apply(image(2,2),recipe(12),{shouldCancel(){throw sentinel;}}),e=>e===sentinel);
  const im=image(2,2);let n=0;bad(()=>S.apply(im,recipe(12),{shouldCancel(){if(++n===2)structuredClone(im.data.buffer,{transfer:[im.data.buffer]});return false;}}));
});
test('arbitrary output is fresh and source bytes stay untouched',()=>{
  const im=randomImage(23,19,22),before=im.data.slice();for(const angle of [-179,-91,-45,0.1,14,89,179])for(const mode of ['crop','expand']){
    const out=S.apply(im,recipe(angle,mode));assert.notEqual(out,im);assert.notEqual(out.data,im.data);assert.deepEqual(im.data,before);
  }
});
test('edge mapping roundtrips with clockwise signs, exact quarters and untrusted-plan rejection',()=>{
  const rand=rng(99);for(const a of [-180,-90,-45,0,31,90,135,180])for(const mode of ['crop','expand']){
    const p=S.plan(17,8,recipe(a,mode));for(let i=0;i<30;i++){
      const point={x:rand()*17,y:rand()*8},f=S.mapEdgePoint(p,point),v=S.mapEdgePoint(p,f,'inverse');
      assert(Math.abs(v.x-point.x)<1e-12);assert(Math.abs(v.y-point.y)<1e-12);
    }
    if(a===90)assert.deepEqual(S.mapEdgePoint(p,{x:0,y:0}),{x:8,y:0});
  }
  const p=S.plan(2,3,recipe(12));bad(()=>S.mapEdgePoint({...p},{x:0,y:0}));bad(()=>S.mapEdgePoint(p,{x:0,y:0,z:0}));bad(()=>S.mapEdgePoint(p,{x:0,y:0},'wrong'));
});
