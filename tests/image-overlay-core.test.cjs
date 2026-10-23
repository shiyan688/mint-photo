'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../app/src/main/assets/image-overlay.js');
const { defaults, validate, validateAsset, encodeAsset, decodeAsset, layout, apply, LIMITS } = core;
const recipe = (p = {}) => ({ ...defaults(), ...p });
function image(w, h, pixels = [0, 0, 0, 0]) {
  const data = new Uint8ClampedArray(w * h * 4);
  if (pixels.length === data.length) data.set(pixels);
  else for (let i = 0; i < data.length; i += 4) data.set(pixels, i);
  return { width: w, height: h, data };
}
function asset(w, h, pixels) { return encodeAsset(image(w, h, pixels)); }
function at(im, x, y) { return Array.from(im.data.slice((y * im.width + x) * 4, (y * im.width + x + 1) * 4)); }
function bytes(im) { return Array.from(im.data); }
function bad(fn, code = 'IMAGE_OVERLAY_INVALID') { assert.throws(fn, e => e.code === code); }
function same(actual, expected) { assert.deepEqual(bytes(actual), bytes(expected)); }
function rng(seed) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }

// Slow independent reference. It scans every target pixel, classifies four
// square corners, and uses explicit source neighbors rather than row intervals.
function oracle(target, source, r) {
  const out = image(target.width, target.height, target.data);
  let c, s;
  if (r.rotation === 0) [c, s] = [1, 0];
  else if (r.rotation === 90) [c, s] = [0, 1];
  else if (r.rotation === -90) [c, s] = [0, -1];
  else if (Math.abs(r.rotation) === 180) [c, s] = [-1, 0];
  else [c, s] = [Math.cos(r.rotation * Math.PI / 180), Math.sin(r.rotation * Math.PI / 180)];
  const scale = Math.min(target.width, target.height) * r.size / Math.max(source.width, source.height);
  const dw = source.width * scale, dh = source.height * scale;
  const cx = target.width * r.x, cy = target.height * r.y;
  const local = (x, y) => [c * (x - cx) + s * (y - cy), -s * (x - cx) + c * (y - cy)];
  const inside = ([u, v], closed = false) => u >= -dw / 2 && v >= -dh / 2 && (closed ? u <= dw / 2 && v <= dh / 2 : u < dw / 2 && v < dh / 2);
  for (let y = 0; y < target.height; y++) for (let x = 0; x < target.width; x++) {
    const full = [[x,y],[x+1,y],[x,y+1],[x+1,y+1]].every(p => inside(local(...p), true));
    const n = full ? 1 : 4, sum = [0,0,0,0];
    for (let by = 0; by < n; by++) for (let bx = 0; bx < n; bx++) {
      const uv = local(x + (bx + .5) / n, y + (by + .5) / n);
      if (!inside(uv)) continue;
      let sx = (uv[0] / dw + .5) * source.width - .5;
      let sy = (uv[1] / dh + .5) * source.height - .5;
      if (r.flipX) sx = source.width - 1 - sx;
      if (r.flipY) sy = source.height - 1 - sy;
      sx = Math.max(0,Math.min(source.width-1,sx)); sy = Math.max(0,Math.min(source.height-1,sy));
      const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
      for (let j=0;j<2;j++) for (let k=0;k<2;k++) {
        const index = (Math.min(source.height-1,iy+j)*source.width+Math.min(source.width-1,ix+k))*4;
        const w = (k?fx:1-fx)*(j?fy:1-fy)/(n*n), a = source.data[index+3];
        for (let channel=0;channel<3;channel++) sum[channel] += source.data[index+channel]*a*w;
        sum[3] += a*w;
      }
    }
    const sa = sum[3]*r.opacity;
    if (!sa) continue;
    const i=(y*target.width+x)*4, da=target.data[i+3], inv=1-sa/255, oa=sa+da*inv;
    if (Math.round(oa) === 0) continue;
    for (let channel=0;channel<3;channel++) out.data[i+channel]=Math.round((sum[channel]*r.opacity+target.data[i+channel]*da*inv)/oa);
    out.data[i+3]=Math.round(oa);
  }
  return out;
}

test('API is frozen and UMD CommonJS, AMD, browser global agree', () => {
  assert(Object.isFrozen(core)); assert(Object.isFrozen(LIMITS));
  assert.deepEqual(Object.keys(core).sort(), ['LIMITS','defaults','validate','validateAsset','encodeAsset','decodeAsset','layout','apply'].sort());
  const code = fs.readFileSync(__dirname + '/../app/src/main/assets/image-overlay.js', 'utf8');
  const globalContext = vm.createContext({}); vm.runInContext(code, globalContext);
  assert.equal(typeof globalContext.MintImageOverlay.apply, 'function');
  let amd; const define = (_, factory) => { amd = factory(); }; define.amd = {};
  vm.runInNewContext(code, { define }); assert.equal(typeof amd.apply, 'function');
});

test('defaults, snapshots, null prototypes and negative zero canonicalization', () => {
  assert.notEqual(defaults(), defaults()); assert(Object.isFrozen(defaults()));
  const input = recipe({x:-0,y:-0,rotation:-0,opacity:-0}), result=validate(input);
  assert(Object.isFrozen(result)); assert(!Object.is(result.x,-0)); assert(!Object.is(result.opacity,-0));
  input.x = 1; assert.equal(result.x,0);
  assert.deepEqual(validate(Object.assign(Object.create(null), recipe())),defaults());
  const a=asset(1,1,[12,34,56,78]); assert.notEqual(validateAsset(a),a); assert(Object.isFrozen(validateAsset(a)));
});

test('recipe rejects missing, extra, symbols, accessors, hidden properties, unsafe prototypes without getters', () => {
  let called=0;
  for (const key of Object.keys(defaults())) {
    const missing=recipe(); delete missing[key]; bad(()=>validate(missing));
    const getter=recipe(); Object.defineProperty(getter,key,{enumerable:true,get(){called++;throw Error('getter');}}); bad(()=>validate(getter));
    const hidden=recipe(); Object.defineProperty(hidden,key,{enumerable:false,value:hidden[key]}); bad(()=>validate(hidden));
  }
  bad(()=>validate({...defaults(),surprise:0})); bad(()=>validate({...defaults(),[Symbol('x')]:1}));
  bad(()=>validate(Object.assign(Object.create({x:0}),defaults())));
  for (const v of [null,undefined,[],new Date(),()=>{},'{}']) bad(()=>validate(v));
  for (const v of [NaN,Infinity,-Infinity,'0',null,true,{},new Number(.5)]) bad(()=>validate(recipe({x:v})));
  for (const [key,value] of [['x',-1],['y',1.01],['size',.019],['size',2.001],['rotation',181],['opacity',-1]]) bad(()=>validate(recipe({[key]:value})),'IMAGE_OVERLAY_LIMIT');
  for (const p of [{version:2},{flipX:1},{flipY:'false'}]) bad(()=>validate(recipe(p)));
  assert.equal(called,0);
});

test('asset canonical base64 roundtrips byte-for-byte including 1/2/no padding', () => {
  const random=rng(19);
  for (let w=1;w<=17;w++) for (let h=1;h<=9;h++) {
    const im=image(w,h,[]); for(let i=0;i<im.data.length;i++)im.data[i]=Math.floor(random()*256);
    const a=encodeAsset(im); assert.equal(a.data,Buffer.from(im.data).toString('base64'));
    same(decodeAsset(a),im); assert.notEqual(decodeAsset(a).data,im.data);
    assert.equal(a.width,w); assert.equal(a.height,h);
  }
});

test('asset rejects malformed alphabet, length, padding, noncanonical pad bits and URI fields', () => {
  const a=asset(1,1,[0,0,0,0]);
  for(const data of ['AAAAAA=','AAAAAA===','AAAAA===','AAAAAA__','AAAAAA--','AAAAAA\n=','AAAAAA =','AAAAAB==','AAAAAA=A','AAAAA\u0000==','AAAAAA\uFF1D\uFF1D']) bad(()=>validateAsset({...a,data}));
  const a2=asset(2,1,[0,0,0,0]); assert.equal(a2.data.length,12);
  bad(()=>validateAsset({...a2,data:a2.data.slice(0,-2)+'B='}));
  const a3=asset(3,1,[0,0,0,0]); bad(()=>validateAsset({...a3,data:a3.data.slice(0,-1)+'='}));
  for(const extra of [{uri:'file:///private/image.png'},{url:'https://invalid.example/picture'},{dataURL:'data:image/png;base64,AAAA'}]) bad(()=>validateAsset({...a,...extra}));
  for(const data of [null,new String(a.data),[],{toString(){throw Error('should not call');}}])bad(()=>validateAsset({...a,data}));
  for(const p of [{width:0},{width:1025},{height:1.5},{width:Infinity},{height:'1'}])bad(()=>validateAsset({...a,...p}),'IMAGE_OVERLAY_LIMIT');
  bad(()=>validateAsset({...a,version:0}));
});

test('asset and image record getter and prototype rejection occurs without reading accessors', () => {
  let calls=0;const a=asset(1,1,[0,0,0,255]);
  for(const key of Object.keys(a)){
    const b={...a};Object.defineProperty(b,key,{enumerable:true,get(){calls++;throw Error('getter');}});bad(()=>validateAsset(b));
    const c={...a};delete c[key];bad(()=>validateAsset(c));
  }
  for(const key of ['width','height','data']){
    const b=image(1,1);Object.defineProperty(b,key,{enumerable:true,get(){calls++;throw Error('getter');}});bad(()=>apply(b,a,recipe()));
  }
  bad(()=>apply({...image(1,1),extra:true},a,recipe()));
  bad(()=>apply({...image(1,1),[Symbol()]:1},a,recipe()));
  bad(()=>validateAsset(Object.assign(Object.create({}),a))); assert.equal(calls,0);
});

test('only local native RGBA8 views and ordinary fixed attached buffers accepted', () => {
  const a=asset(1,1,[1,2,3,255]);
  for(const data of [[],[0,0,0,0],Buffer.alloc(4),new Uint16Array(4),new Float32Array(4),new DataView(new ArrayBuffer(4)),new Uint8Array(5),new Proxy(new Uint8Array(4),{})]) bad(()=>apply({width:1,height:1,data},a,recipe()));
  class Sub extends Uint8Array {} bad(()=>apply({width:1,height:1,data:new Sub(4)},a,recipe()));
  const foreign=vm.runInNewContext('new Uint8Array(4)');bad(()=>apply({width:1,height:1,data:foreign},a,recipe()));
  if(typeof SharedArrayBuffer!=='undefined')bad(()=>apply({width:1,height:1,data:new Uint8Array(new SharedArrayBuffer(4))},a,recipe()));
  const detached=new Uint8Array(4);structuredClone(detached,{transfer:[detached.buffer]});bad(()=>apply({width:1,height:1,data:detached},a,recipe()));
  class AB extends ArrayBuffer {} bad(()=>apply({width:1,height:1,data:new Uint8Array(new AB(4))},a,recipe()));
  if (Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')) bad(()=>apply({width:1,height:1,data:new Uint8Array(new ArrayBuffer(4,{maxByteLength:8}))},a,recipe()));
  const backing=new Uint8Array(12);backing.set([7,8,9,255],4);const sub={width:1,height:1,data:backing.subarray(4,8)};
  same(decodeAsset(encodeAsset(sub)),sub);
  let called=0;for(const key of ['length','buffer','byteOffset','subarray','set'])Object.defineProperty(sub.data,key,{get(){called++;throw Error('shadow');}});
  assert.equal(encodeAsset(sub).data,'BwgJ/w==');assert.equal(called,0);
});

test('integer target/asset limits are checked even when opacity is zero', () => {
  const a=asset(1,1,[0,0,0,0]);
  for(const [w,h] of [[0,1],[1,0],[1.5,1],[4097,1],[4000,2001],[NaN,1],[1,Infinity],['2',2]])bad(()=>layout(w,h,a,recipe({opacity:0})),'IMAGE_OVERLAY_LIMIT');
  bad(()=>encodeAsset({width:1025,height:1,data:new Uint8Array(4100)}),'IMAGE_OVERLAY_LIMIT');
});

test('strict optional cancellation options reject invalid records without invoking getters', () => {
  const im=image(1,1), a=asset(1,1,[255,0,0,255]);let calls=0;
  for(const v of [null,[],true,{shouldCancel:true},{other:()=>false},Object.create({shouldCancel(){}})])bad(()=>apply(im,a,recipe(),v));
  const opt={};Object.defineProperty(opt,'shouldCancel',{enumerable:true,get(){calls++;throw Error('getter');}});bad(()=>apply(im,a,recipe(),opt));assert.equal(calls,0);
});

test('opacity zero is exact object/buffer identity but still validates the full asset and recipe', () => {
  const im=image(3,2,[12,34,56,0]),a=asset(2,1,[255,0,0,255]);
  assert.equal(apply(im,a,recipe({opacity:0})),im);
  bad(()=>apply(im,{...a,data:'?'.repeat(a.data.length)},recipe({opacity:0})));
  bad(()=>apply(im,a,recipe({opacity:0,flipX:'no'})));
});

test('aligned opaque overlay preserves exact pixels and asset orientation', () => {
  const source=image(3,2,[255,0,0,255,0,255,0,255,0,0,255,255,12,34,56,255,42,43,44,255,200,201,202,255]);
  const target=image(3,2,[87,77,67,129]);same(apply(target,encodeAsset(source),recipe({size:1.5})),source);
  const before=bytes(target);apply(target,encodeAsset(source),recipe({size:1.5}));assert.deepEqual(bytes(target),before);
});

test('standard sRGB source-over for opaque, translucent and transparent destination', () => {
  const a=asset(1,1,[200,100,50,128]);
  assert.deepEqual(at(apply(image(1,1,[20,40,80,255]),a,recipe({size:1})),0,0),[110,70,65,255]);
  assert.deepEqual(at(apply(image(1,1,[20,40,80,128]),a,recipe({size:1})),0,0),[140,80,60,192]);
  assert.deepEqual(at(apply(image(1,1,[31,47,61,0]),a,recipe({size:1})),0,0),[200,100,50,128]);
  assert.deepEqual(at(apply(image(1,1,[20,40,80,255]),a,recipe({size:1,opacity:.5})),0,0),[65,55,72,255]);
});

test('transparent source hidden colors never bleed; all-transparent assets are identity', () => {
  const target=image(5,3,[77,88,99,0]),a=asset(2,1,[255,0,255,0,0,255,0,0]);
  for(const rotation of [0,17,90,180])assert.equal(apply(target,a,recipe({size:1.5,rotation})),target);
  const mixed=asset(2,1,[255,0,0,0,0,0,255,255]);
  const result=apply(image(4,2),mixed,recipe({size:2}));
  for(let i=0;i<result.data.length;i+=4)if(result.data[i+3])assert.deepEqual(Array.from(result.data.slice(i,i+3)),[0,0,255]);
});

test('exact 90/-90/180 rotations and flips', () => {
  const src=image(2,2,[1,0,0,255,2,0,0,255,3,0,0,255,4,0,0,255]),a=encodeAsset(src),im=image(2,2);
  const reds=r=>{const d=apply(im,a,recipe({size:1,...r})).data;return[d[0],d[4],d[8],d[12]];};
  assert.deepEqual(reds({rotation:90}),[3,1,4,2]);assert.deepEqual(reds({rotation:-90}),[2,4,1,3]);
  assert.deepEqual(reds({rotation:180}),[4,3,2,1]);assert.deepEqual(reds({rotation:-180}),[4,3,2,1]);
  assert.deepEqual(reds({flipX:true}),[2,1,4,3]);assert.deepEqual(reds({flipY:true}),[3,4,1,2]);assert.deepEqual(reds({flipX:true,flipY:true}),[4,3,2,1]);
});

test('size uses overlay long / target short edge, continuous centers, aspect and clipping', () => {
  const a=asset(4,2,[255,0,0,255]),r=recipe({x:0,y:.5,size:1});const p=layout(10,6,a,r);
  assert.equal(p.drawWidth,6);assert.equal(p.drawHeight,3);assert.equal(p.centerX,0);assert.equal(p.centerY,3);
  assert.deepEqual(p.bounds,{x:0,y:1,width:3,height:4});assert(Object.isFrozen(p));assert(Object.isFrozen(p.bounds));
  const im=image(10,6,[6,7,8,9]),out=apply(im,a,r);
  for(let y=0;y<6;y++)for(let x=3;x<10;x++)assert.deepEqual(at(out,x,y),at(im,x,y));
  const tall=layout(6,10,asset(2,4,[0,0,0,255]),recipe({size:1}));assert.equal(tall.drawWidth,3);assert.equal(tall.drawHeight,6);
});

test('fractional edges and rotated boundaries have intermediate antialias coverage without leakage', () => {
  const a=asset(1,1,[240,80,40,255]),im=image(7,7,[9,8,7,0]);
  const r=recipe({size:4/7,rotation:37}),p=layout(7,7,a,r),out=apply(im,a,r);
  assert(p.boundaryPixels>0);assert(Array.from(out.data).filter((_,i)=>i%4===3).some(a=>a>0&&a<255));
  for(let y=0;y<7;y++)for(let x=0;x<7;x++)if(x<p.bounds.x||y<p.bounds.y||x>=p.bounds.x+p.bounds.width||y>=p.bounds.y+p.bounds.height)assert.deepEqual(at(out,x,y),at(im,x,y));
  const fractional=apply(image(2,2),a,recipe({x:.625,y:.5,size:.5}));assert.deepEqual([at(fractional,0,0)[3],at(fractional,1,0)[3]],[32,96]);
});

test('subquantum opacity and coverage retain transparent destination hidden RGB', () => {
  const im=image(1,1,[12,34,56,0]),a=asset(1,1,[255,0,0,255]);
  assert.equal(apply(im,a,recipe({size:1,opacity:Number.MIN_VALUE})),im);
  assert.equal(apply(im,a,recipe({size:.02})),im);
});

test('random small images agree with independent geometry/source-over oracle (no mips)', () => {
  const random=rng(738918);let maxError=0;
  for(let iteration=0;iteration<300;iteration++){
    const w=2+Math.floor(random()*9),h=2+Math.floor(random()*9),aw=1+Math.floor(random()*3),ah=1+Math.floor(random()*3);
    const target=image(w,h,[]),source=image(aw,ah,[]);
    for(const im of [target,source])for(let i=0;i<im.data.length;i++)im.data[i]=Math.floor(random()*256);
    const r=recipe({x:random(),y:random(),size:Math.max(.8,3/Math.min(w,h)),rotation:(random()-.5)*360,opacity:random(),flipX:random()>.5,flipY:random()>.5});
    const a=encodeAsset(source);assert.equal(layout(w,h,a,r).mipLevels,0);
    const actual=apply(target,a,r),expected=oracle(target,source,r);
    for(let i=0;i<actual.data.length;i++)maxError=Math.max(maxError,Math.abs(actual.data[i]-expected.data[i]));
    assert.deepEqual(bytes(actual),bytes(expected),'iteration '+iteration);
  }
  assert.equal(maxError,0);
});

test('mip minification suppresses high-frequency opaque checker aliasing', () => {
  const src=image(128,128,[]);for(let y=0;y<128;y++)for(let x=0;x<128;x++){const i=(y*128+x)*4,v=((x+y)&1)*255;src.data.set([v,v,v,255],i);}
  const a=encodeAsset(src),r=recipe({size:1}),p=layout(27,27,a,r),out=apply(image(27,27),a,r);
  assert.equal(p.mipLevels,2);assert.equal(p.mipWidth,32);assert.equal(p.mipHeight,32);assert.equal(p.mipPixels,64*64+32*32);
  for(let i=0;i<out.data.length;i+=4){assert.equal(out.data[i],128);assert.equal(out.data[i+1],128);assert.equal(out.data[i+2],128);assert.equal(out.data[i+3],255);}
});

test('mip minification premultiplies before filtering and never mixes transparent hidden colors', () => {
  const src=image(64,64,[]);for(let y=0;y<64;y++)for(let x=0;x<64;x++)src.data.set((x+y)&1?[255,0,0,0]:[0,0,255,255],(y*64+x)*4);
  const a=encodeAsset(src),r=recipe({size:1}),out=apply(image(9,9),a,r);
  assert.equal(layout(9,9,a,r).mipLevels,2);
  for(let i=0;i<out.data.length;i+=4)assert.deepEqual(Array.from(out.data.slice(i,i+4)),[0,0,255,128]);
});

test('odd-size area mip preserves a uniform color and total alpha, including 1px dimensions', () => {
  for(const [w,h] of [[65,63],[1,65],[65,1],[3,17]]){
    const a=asset(w,h,[17,84,191,128]),im=image(13,11),r=recipe({size:.5,rotation:29,flipX:true});
    const p=layout(13,11,a,r),out=apply(im,a,r);assert(p.mipLevels>0);
    for(let i=0;i<out.data.length;i+=4)if(out.data[i+3])assert.deepEqual(Array.from(out.data.slice(i,i+3)),[17,84,191]);
  }
});

test('layout is allocation-free for pixel buffers and accounts boundary and mip costs conservatively', () => {
  const a=asset(1024,1024,[10,20,30,255]),p=layout(4000,2000,a,recipe({size:.02,rotation:47}));
  assert.equal(p.mipLevels,4);assert.equal(p.samples,p.interiorPixels+16*p.boundaryPixels);
  assert.equal(p.candidatePixels,p.interiorPixels+p.boundaryPixels);
  assert.equal(p.extraBytes,2*1024*1024+4194304+32000000+32*p.mipPixels);
  assert(p.extraBytes<=LIMITS.maxExtraBytes);assert(p.workUnits<=LIMITS.maxWorkUnits);
  assert(Object.isFrozen(p.mipSizes));for(const size of p.mipSizes)assert(Object.isFrozen(size));
  const neutral=layout(4000,2000,a,recipe({opacity:0}));assert.equal(neutral.extraBytes,2*1024*1024);assert.equal(neutral.mipPixels,0);assert.equal(neutral.samples,0);
});

test('cancellation before allocation, during base64/decode/mips/copy/raster, and callback exceptions preserve source', () => {
  const im=image(128,128,[12,34,56,78]),a=asset(128,128,[120,140,160,255]),r=recipe({size:.2,rotation:25});
  const before=bytes(im);let calls=0;apply(im,a,r,{shouldCancel(){calls++;return false;}});assert(calls>20);
  const stops=new Set([1,2,3,4,5,6,Math.floor(calls*.25),Math.floor(calls*.5),Math.floor(calls*.75),calls]);
  for(const stop of stops){let n=0;assert.throws(()=>apply(im,a,r,{shouldCancel(){return ++n===stop;}}),e=>e.name==='AbortError'&&e.code==='IMAGE_OVERLAY_CANCELLED');assert.deepEqual(bytes(im),before);}
  const error=new Error('callback failure');assert.throws(()=>apply(im,a,r,{shouldCancel(){throw error;}}),e=>e===error);assert.deepEqual(bytes(im),before);
});

test('real maximum asset encode/decode and 8MP target composition execute within the advertised plan', () => {
  const src=image(1024,1024,[15,85,195,255]);const a=encodeAsset(src);assert.equal(a.data.length,LIMITS.maxAssetBase64Chars);same(decodeAsset(a),src);
  const target=image(4000,2000,[21,22,23,255]),r=recipe({size:2}),p=layout(4000,2000,a,r);
  assert.equal(p.candidatePixels,8000000);assert.equal(p.interiorPixels,8000000);assert.equal(p.boundaryPixels,0);
  assert(p.workUnits<=LIMITS.maxWorkUnits);assert(p.extraBytes<=LIMITS.maxExtraBytes);
  const out=apply(target,a,r);assert.notEqual(out,target);assert.equal(out.data.length,32000000);
  assert.deepEqual(at(out,0,0),[15,85,195,255]);assert.deepEqual(at(out,3999,1999),[15,85,195,255]);
  assert.deepEqual(at(target,0,0),[21,22,23,255]);
  // Second real 8MP call forces the full maximum-asset mip chain and allocated
  // target buffer, rather than only asserting a formula or rejecting a size.
  const small=recipe({size:.02,rotation:37}),q=layout(4000,2000,a,small),filtered=apply(target,a,small);
  assert(q.mipLevels>0);assert.notEqual(filtered,target);assert.deepEqual(at(filtered,2000,1000),[15,85,195,255]);
});

test('odd-sized minified one-pixel result agrees with independent whole-image area mean', () => {
  const random=rng(827311);
  for(const size of [3,5,7,9,13,31,65]){
    const src=image(size,size,[]);let alpha=0,red=0,green=0,blue=0;
    for(let i=0;i<src.data.length;i+=4){for(let k=0;k<4;k++)src.data[i+k]=Math.floor(random()*256);const a=src.data[i+3];alpha+=a;red+=a*src.data[i];green+=a*src.data[i+1];blue+=a*src.data[i+2];}
    const out=apply(image(1,1),encodeAsset(src),recipe({size:1}));
    assert.deepEqual(at(out,0,0),[Math.round(red/alpha),Math.round(green/alpha),Math.round(blue/alpha),Math.round(alpha/(size*size))]);
  }
});

test('preflight and failures allocate no pixel buffers; simulated output allocation failure is source-atomic', () => {
  let allocations=0,failAt=Infinity;
  function instrument(Type){return new Proxy(Type,{construct(target,args){allocations++;if(allocations===failAt)throw new RangeError('simulated allocation failure');return Reflect.construct(target,args);}});}
  const context={Object,Array,ArrayBuffer,Uint8Array:instrument(Uint8Array),Uint8ClampedArray:instrument(Uint8ClampedArray),Float64Array:instrument(Float64Array),module:{exports:{}}};
  vm.runInNewContext(fs.readFileSync(__dirname+'/../app/src/main/assets/image-overlay.js','utf8'),context);
  const c=context.module.exports,a=asset(2,2,[128,64,32,255]),target=image(2,2,[11,22,33,44]),before=bytes(target);
  c.layout(2,2,a,recipe());assert.equal(allocations,0);
  bad(()=>c.apply(target,{...a,data:'?'.repeat(a.data.length)},recipe(),{}));assert.equal(allocations,0);
  assert.throws(()=>c.apply(target,a,recipe(),{shouldCancel:()=>true}),e=>e.name==='AbortError');assert.equal(allocations,0);
  c.apply(target,a,recipe({opacity:0}),{});assert.equal(allocations,0);
  failAt=2;assert.throws(()=>c.apply(target,a,recipe({size:1}),{}),/simulated allocation failure/);
  assert.deepEqual(bytes(target),before);
});

test('plan row accounting upper-bounds brute-force active sample work over extreme geometry', () => {
  const random=rng(99812),a=asset(1,1,[200,0,0,255]);
  const rotations=[0,Number.MIN_VALUE,1e-300,90,-90,180,-180,89.99999999999999,-179.99999999999,45,-135];
  for(let run=0;run<120;run++){
    const w=1+Math.floor(random()*19),h=1+Math.floor(random()*19),rotation=rotations[run%rotations.length];
    const r=recipe({x:run%3===0?0:run%3===1?1:random(),y:random(),size:run%2?.02:2,rotation});
    const p=layout(w,h,a,r),target=image(w,h,[7,9,11,31]);
    assert(p.candidatePixels<=w*h);assert(p.samples<=16*w*h);assert(p.interiorPixels<=p.candidatePixels);
    same(apply(target,a,r),oracle(target,decodeAsset(a),r));
  }
});
