'use strict';
// Reuses the existing complete-editor DOM/storage/export harness. Production
// scripts are executed unchanged except the pre-existing read-only state probe.
// Canvas/decoder injection is test infrastructure, never a substitute renderer.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..'),assets=path.join(root,'app/src/main/assets');
const plain=x=>JSON.parse(JSON.stringify(x));
function replaceOnce(text,from,to){assert.equal(text.split(from).length,2,'Harness extraction boundary changed: '+from);return text.replace(from,to);}
function makeHarness(nativeFactory=null){
 const file=path.join(root,'tests/export-back.test.cjs'),source=fs.readFileSync(file,'utf8'),end=source.indexOf("const test=require('node:test');");assert(end>0);
 let plumbing=source.slice(0,end);
 plumbing=replaceOnce(plumbing,'env.window = env; env.addEventListener = () => {};',"env.window = env; env.__events = {}; env.addEventListener = (name, fn) => { (env.__events[name] ||= new Set()).add(fn); }; env.removeEventListener = (name, fn) => env.__events[name]?.delete(fn);");
 plumbing=replaceOnce(plumbing,'requestAnimationFrame() { return ++counter; }','requestAnimationFrame(fn) { const id=++counter; (env.__frames ||= new Map()).set(id,fn); return id; }');
 plumbing=replaceOnce(plumbing,"function fakeCanvas(width = 1, height = 1) {","function fakeCanvas(width = 1, height = 1) { if (__nativeFactory) return __nativeFactory(width, height, {encodes, settings, descriptors, pendingEncodes});");
 plumbing=replaceOnce(plumbing,"for (const id of ['previewCanvas', 'overlayCanvas']) Object.assign(ids.get(id), fakeCanvas());","for (const id of ['previewCanvas', 'overlayCanvas']) Object.defineProperties(ids.get(id), Object.getOwnPropertyDescriptors(fakeCanvas()));");
 plumbing=replaceOnce(plumbing,'this.naturalWidth = d.width; this.naturalHeight = d.height;','this.naturalWidth = d.width; this.naturalHeight = d.height; this.__native = d.image;');
 plumbing=replaceOnce(plumbing,'commit, setTool, saveDraftSoon,','commit, setTool, saveDraftSoon, paint, renderPipeline, replaceHistory,');
 const m={exports:{}};new Function('require','module','exports','__dirname','__nativeFactory',plumbing+'\nmodule.exports=harness;')(createRequire(file),m,m.exports,path.dirname(file),nativeFactory);
 const h=m.exports(),env=h.env,panelNodes=new Map(),oldLookup=env.document.getElementById.bind(env.document),oldCreate=env.document.createElement.bind(env.document);
 const decorate=e=>{e.children=[];e.appendChild=c=>{e.children.push(c);if(c.id)panelNodes.set(c.id,c);};if(!nativeFactory&&e.getContext){const ctx=e.getContext('2d');ctx.measureText=text=>({width:Array.from(text).length*50,actualBoundingBoxAscent:40,actualBoundingBoxDescent:10});ctx.setTransform=()=>{};ctx.strokeText=()=>{};ctx.createImageData=(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)});}return e;};
 env.document.getElementById=id=>panelNodes.get(id)||oldLookup(id);env.document.createElement=tag=>decorate(oldCreate(tag));
 for(const id of ['previewCanvas','overlayCanvas'])decorate(h.$(id));
 Object.defineProperty(h.$('toolPanel'),'innerHTML',{configurable:true,set(html){this.markup=html;panelNodes.clear();for(const m of html.matchAll(/<([a-z]+)\b([^>]*id="([^"]+)"[^>]*)>/g)){const e=decorate(oldCreate(m[1]));e.id=m[3];e.value=m[2].match(/value="([^"]*)"/)?.[1]||'';e.checked=/\bchecked\b/.test(m[2]);panelNodes.set(e.id,e);}},get(){return this.markup||'';}});
 env.document.__events={};env.document.addEventListener=(n,f)=>(env.document.__events[n]??=new Set()).add(f);env.document.removeEventListener=(n,f)=>env.document.__events[n]?.delete(f);
 Object.assign(env,{ArrayBuffer,Float32Array,Float64Array,btoa:v=>Buffer.from(v,'binary').toString('base64'),atob:v=>Buffer.from(v,'base64').toString('binary')});
 for(const f of ['geometry','text-overlay','text-overlay-operation','text-overlay-ui'])vm.runInContext(fs.readFileSync(path.join(assets,f+'.js'),'utf8'),env,{filename:f+'.js'});
 h.$('stage').clientWidth=600;h.$('stage').clientHeight=800;
 const node=id=>env.document.getElementById(id);
 return Object.assign(h,{node,plain,realm(o){env.__json=JSON.stringify(o);return vm.runInContext('JSON.parse(__json)',env);},click(id){const e=node(id);assert(e,'Missing #'+id);assert(!e.disabled,'Disabled #'+id);return e.click();},input(key,value){const e=node('tx-'+key);e.value=String(value);e.oninput({target:e});},select(key,value){const e=node('tx-'+key);e.value=value;e.onchange({target:e});},check(key,value){const e=node('tx-'+key);e.checked=value;e.onchange({target:e});},setTool:tool=>env.__probe.setTool(tool),paint(){env.__probe.paint();},emit(kind){for(const fn of [...(env.__events[kind]||[])])fn();},event(type,x=.5,y=.5,id=1){node('overlayCanvas').listeners[type]?.({type,pointerId:id,clientX:x*600,clientY:y*800,preventDefault(){}});},render(ops,base=h.state.source,maxSide=Infinity){return env.EditorTest.renderPipeline(maxSide,this.realm(ops),base);}});
}
async function integrated(options={}){const h=makeHarness(options.nativeFactory),blob=h.file('text-source.png',options.width||320,options.height||240,{type:'image/png',...options.file});await h.load(blob);assert.equal(h.state.sourceBlob,blob,h.$('toast').textContent);h.originalBlob=blob;h.setTool('text');assert.equal(h.state.draft?.type,'text-overlay',h.$('toast').textContent);return h;}
module.exports={integrated,makeHarness,plain,assets,root};
