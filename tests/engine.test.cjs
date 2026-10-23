'use strict';
// Tests execute the actual pure functions extracted from the shipped editor.
// FakeCanvas only supplies getImageData/putImageData; this is not browser rendering QA.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const text=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/editor.js'),'utf8');
const checks=[];
function actual(name,next){const start=text.indexOf(`function ${name}(`),end=text.indexOf(`function ${next}(`,start+1);assert(start>=0&&end>start);return text.slice(start,end);}
const env={};vm.createContext(env);
vm.runInContext(`const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));${actual('pixelEffect','applyOperation')}${actual('operationSize','outputSize')}`,env);
function pixel(r,g,b,a=255,op){let bytes=new Uint8ClampedArray([r,g,b,a]);const c={width:1,height:1,getContext:()=>({getImageData:()=>({data:bytes}),putImageData:im=>{bytes=im.data;}})};env.pixelEffect(c,op);return Array.from(bytes);}
function test(name,fn){fn();checks.push(name);console.log('PASS',name);}
test('identity adjustment preserves all RGBA values',()=>assert.deepEqual(pixel(28,144,231,91,{type:'adjust',values:{}}),[28,144,231,91]));
test('brightness raises RGB but preserves alpha',()=>assert.deepEqual(pixel(100,100,100,130,{type:'adjust',values:{brightness:20}}),[131,131,131,130]));
test('extreme brightness clamps channels',()=>assert.deepEqual(pixel(220,240,255,255,{type:'adjust',values:{brightness:100}}),[255,255,255,255]));
test('minimum saturation creates neutral gray',()=>{const p=pixel(100,200,40,255,{type:'adjust',values:{saturation:-100}});assert.equal(p[0],p[1]);assert.equal(p[1],p[2]);});
test('warmth raises red and lowers blue',()=>assert.deepEqual(pixel(100,100,100,255,{type:'adjust',values:{warmth:50}}),[121,100,79,255]));
test('minimum contrast flattens RGB to midpoint',()=>assert.deepEqual(pixel(23,145,245,255,{type:'adjust',values:{contrast:-100}}),[128,128,128,255]));
test('black-and-white filter uses equal channels',()=>{const p=pixel(255,20,125,99,{type:'filter',id:'mono'});assert.equal(p[0],p[1]);assert.equal(p[1],p[2]);assert.equal(p[3],99);});
test('all eight filters produce valid RGBA and retain transparency',()=>{for(const id of ['original','mint','warm','film','clear','mono','cool','fade']){const p=pixel(12,120,245,77,{type:'filter',id});assert.equal(p[3],77);assert(p.every(n=>n>=0&&n<=255));}});
test('original filter is pixel-identical',()=>assert.deepEqual(pixel(10,45,233,255,{type:'filter',id:'original'}),[10,45,233,255]));
test('rotate swaps width and height',()=>{const s=env.operationSize(1500,1900,{type:'rotate'});assert.equal(s.w,1900);assert.equal(s.h,1500);});
test('crop rounds to nonzero integer dimensions',()=>{const s=env.operationSize(1500,1900,{type:'crop',w:.88,h:.88*1500/1900});assert.equal(s.w,1320);assert.equal(s.h,1320);const tiny=env.operationSize(1,1,{type:'crop',w:.1,h:.1});assert.equal(tiny.w,1);assert.equal(tiny.h,1);});
test('non-geometric operations preserve image dimensions',()=>{for(const type of ['filter','adjust','draw','text','sticker','flip']){const s=env.operationSize(222,333,{type});assert.equal(s.w,222);assert.equal(s.h,333);}});
const html=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/index.html'),'utf8');
test('static HTML IDs are unique',()=>{const ids=Array.from(html.matchAll(/\bid="([^"]+)"/g),m=>m[1]);assert.equal(new Set(ids).size,ids.length);});
test('network-free content policy blocks frames and forms',()=>{for(const rule of ["connect-src 'none'","object-src 'none'","frame-src 'none'","form-action 'none'","base-uri 'none'"])assert(html.includes(rule));});
test('asset bundle has no external network URL',()=>{for(const file of ['index.html','style.css','editor.js']){const data=fs.readFileSync(path.join(__dirname,'../app/src/main/assets',file),'utf8');assert(!/https?:\/\//i.test(data),file+' contains network URL');}});
test('source exposes truthful pending export completion callback',()=>{assert(text.includes('exportPending=true'));assert(text.includes('window.onNativeExportResult='));assert(text.includes('savedCurrent=success&&exportRevision===projectRevision'));assert(text.includes('if(savedCurrent)hasSaved=true'));assert(text.includes('exportRevision=null'));});
console.log(`ALL ${checks.length} PURE/STATIC CHECKS PASSED`);
fs.writeFileSync(path.join(__dirname,'../engine-test-results.json'),JSON.stringify({passed:checks.length,checks,limits:'Pure function and static checks only. Browser interaction and actual Android device execution were not run.',date:new Date().toISOString()},null,2));
