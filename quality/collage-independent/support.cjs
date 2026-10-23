'use strict';
const assert=require('node:assert/strict'),path=require('path');
const root=process.env.MINT_MOBILE_ROOT||path.resolve(__dirname,'../..'),assets=path.join(root,'app/src/main/assets');
const B=require(root+'/quality/paint-layer-evidence/editor-harness.cjs'),N=require(root+'/quality/text-overlay-independent/native-canvas.cjs');
const plain=x=>JSON.parse(JSON.stringify(x));
function create(){const h=B.makeHarness(N.canvas,true);h.node('overlayCanvas').getBoundingClientRect=()=>{const s=h.node('canvasWrap').style;return{left:parseFloat(s.left)||0,top:parseFloat(s.top)||0,width:parseFloat(s.width)||600,height:parseFloat(s.height)||800};};h.co=(key,value,event='onchange')=>{const e=h.node('co-'+key);assert(e,'missing co-'+key);e.value=String(value);return e[event]({target:e});};h.pointer=(type,x,y,id=1)=>{const n=h.node('overlayCanvas'),b=n.getBoundingClientRect();return n.listeners[type]({type,pointerId:id,pointerType:'touch',clientX:b.left+x*b.width,clientY:b.top+y*b.height,preventDefault(){}});};return h;}
function solid(w,h,color){const c=N.canvas(w,h),x=c.getContext('2d'),d=x.createImageData(w,h);for(let i=0;i<w*h;i++)d.data.set(color,i*4);x.putImageData(d,0,0);return c;}
async function photoFile(h,c,mime='image/png',options={}){const bytes=c.toBuffer(mime),image=await N.decode(bytes),blob=h.file('synthetic.'+mime.split('/')[1],image.width,image.height,{bytes,type:mime,image,...options});return{bytes,blob,image,c};}
async function start(w=180,height=120){const h=create(),c=N.fixture(w,height,true),f=await photoFile(h,c);await h.load(f.blob);assert.equal(h.state.sourceBlob,f.blob,h.$('toast').textContent);h.original=f;h.setTool('collage');h.paint();assert.equal(h.state.draft?.type,'collage',h.$('toast').textContent);return h;}
async function add(h,index=1,mime='image/png',c=solid(31,19,[180,40,80,128]),options={}){const f=await photoFile(h,c,mime,options),result=await h.env.CollageUI.importFile(f.blob,index);return{...f,result};}
function apply(h){h.paint();assert.equal(h.click('applyBtn'),true,h.$('toast').textContent);}
function pixel(c,x,y){return [...c.getContext('2d').getImageData(x,y,1,1).data];}
module.exports={root,assets,N,plain,create,start,add,apply,solid,photoFile,pixel};
