'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const {root,assets}=require('./source-paths.cjs');
const base=require('./base-editor-harness.cjs');
const N=require('./native-canvas.cjs');
function create(){const h=base.makeHarness(N.canvas);Object.assign(h.env,{setInterval,clearInterval});h.$('toolPanel').querySelector=s=>h.node(s.slice(1));for(const f of ['canvas-padding','canvas-padding-operation','canvas-padding-ui','image-overlay','image-import','image-overlay-operation','image-overlay-ui'])vm.runInContext(fs.readFileSync(assets+'/'+f+'.js','utf8'),h.env,{filename:f+'.js'});h.node('overlayCanvas').getBoundingClientRect=()=>{const s=h.node('canvasWrap').style;return{left:parseFloat(s.left)||0,top:parseFloat(s.top)||0,width:parseFloat(s.width)||600,height:parseFloat(s.height)||800};};h.io=(key,value)=>{const e=h.node('io-'+key);e.value=String(value);return e.oninput({target:e});};h.ioCheck=(key,value)=>{const e=h.node('io-'+key);e.checked=value;return e.onchange({target:e});};return h;}
async function integrated(w=180,h=120){const e=create(),c=N.fixture(w,h,true),bytes=c.toBuffer('image/png'),blob=e.file('primary.png',w,h,{bytes,type:'image/png',image:await N.decode(bytes)});await e.load(blob);assert.equal(e.state.sourceBlob,blob);e.originalBlob=blob;e.originalBytes=bytes;e.setTool('image-overlay');return e;}
async function overlay(h,w=19,height=13,options={}){const c=N.fixture(w,height,true),bytes=c.toBuffer('image/png'),blob=h.file('overlay.png',w,height,{bytes,type:'image/png',image:await N.decode(bytes),...options});return{c,bytes,blob};}
module.exports={create,integrated,overlay,N,assets,plain:base.plain};
