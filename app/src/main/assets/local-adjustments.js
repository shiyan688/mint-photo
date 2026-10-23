/* Source-bound, non-destructive 8-bit sRGB local adjustment layers.
 * These are explicit classical color operations, not learned retouching.
 * Geometry is normalized to the immutable original before any reshape. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.MintLocalAdjustments=api;})(typeof globalThis==='object'?globalThis:null,function(){
'use strict';
const LIMITS=Object.freeze({layers:8,pixels:64000000,edge:16384});
const KEYS=['exposure','contrast','saturation','temperature'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function check(ok,message){if(!ok)throw new TypeError(message);}
function obj(o,keys,label){check(o&&typeof o==='object'&&!Array.isArray(o),`Invalid ${label}`);for(const k of keys)check(Object.hasOwn(o,k),`Missing ${label} field`);for(const k of Reflect.ownKeys(o)){const d=Object.getOwnPropertyDescriptor(o,k);check(typeof k==='string'&&keys.includes(k)&&d.enumerable&&'value'in d,`Invalid ${label} field`);}return o;}
function num(v,a,b,label){check(typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b,`Invalid ${label}`);return v;}
function str(v,n,label){check(typeof v==='string'&&v.length>0&&v.length<=n&&!/[\u0000-\u001f\u007f]/.test(v),`Invalid ${label}`);return v;}
function validateLayers(layers,context){
 check(Array.isArray(layers)&&layers.length<=LIMITS.layers,'At most 8 local adjustment layers');
 const ids=new Set();
 return layers.map(layer=>{
  obj(layer,['id','name','enabled','opacity','sourceRevision','adjustments','mask'],'layer');
  const id=str(layer.id,160,'layer ID');check(!ids.has(id),'Duplicate layer ID');ids.add(id);
  const sourceRevision=str(layer.sourceRevision,160,'layer source revision');
  if(context)check(sourceRevision===context.sourceRevision,'Local layer belongs to another source revision');
  check(typeof layer.enabled==='boolean','Invalid layer visibility');
  obj(layer.adjustments,KEYS,'adjustments');const adjustments={};for(const k of KEYS)adjustments[k]=num(layer.adjustments[k],-100,100,k);
  let mask;const m=layer.mask;
  if(m?.kind==='radial'){
   obj(m,['kind','cx','cy','rx','ry','feather'],'radial mask');
   mask={kind:'radial',cx:num(m.cx,0,1,'cx'),cy:num(m.cy,0,1,'cy'),rx:num(m.rx,.005,1,'rx'),ry:num(m.ry,.005,1,'ry'),feather:num(m.feather,.05,1,'feather')};
  }else if(m?.kind==='selection'){
   obj(m,['kind','selection'],'selection mask');
   const manual=typeof module==='object'&&module.exports?require('./manual-tools.cjs'):globalThis.MintManualTools;
   check(manual,'Manual selection module is unavailable');check(m.selection!==null,'A selection adjustment layer requires an explicit selection');
   mask={kind:'selection',selection:manual.validateSelection(m.selection,{sourceRevision})};
  }else{
   obj(m,['kind','x0','y0','x1','y1','reverse'],'linear mask');check(m.kind==='linear','Unknown mask kind');check(typeof m.reverse==='boolean','Invalid gradient reverse');
   mask={kind:'linear',x0:num(m.x0,0,1,'x0'),y0:num(m.y0,0,1,'y0'),x1:num(m.x1,0,1,'x1'),y1:num(m.y1,0,1,'y1'),reverse:m.reverse};
   check(Math.hypot(mask.x1-mask.x0,mask.y1-mask.y0)>=.005,'Gradient endpoints are too close');
  }
  return{id,name:str(layer.name,80,'layer name'),enabled:layer.enabled,opacity:num(layer.opacity,0,1,'layer opacity'),sourceRevision,adjustments,mask};
 });
}
function weight(mask,x,y){
 check(mask.kind!=='selection','Selection masks require the actual raster dimensions');
 if(mask.kind==='radial'){
  const d=Math.hypot((x-mask.cx)/mask.rx,(y-mask.cy)/mask.ry);if(d>=1)return 0;if(d<=1-mask.feather)return 1;
  const t=(1-d)/mask.feather;return t*t*(3-2*t);
 }
 const dx=mask.x1-mask.x0,dy=mask.y1-mask.y0;
 const t=clamp(((x-mask.x0)*dx+(y-mask.y0)*dy)/(dx*dx+dy*dy),0,1),s=t*t*(3-2*t);return mask.reverse?1-s:s;
}
function validateImage(image){check(image&&Number.isSafeInteger(image.width)&&Number.isSafeInteger(image.height)&&image.width>0&&image.height>0&&image.width<=LIMITS.edge&&image.height<=LIMITS.edge&&image.width*image.height<=LIMITS.pixels,'Invalid layer image dimensions');check((image.data instanceof Uint8Array||image.data instanceof Uint8ClampedArray)&&image.data.length===image.width*image.height*4,'Invalid RGBA image');}
function curveFor(settings){
 const values={};for(const k of KEYS)values[k]=settings[k]===undefined?0:num(settings[k],-100,100,k);
 const gain=2**(values.exposure/50),slope=2**(values.contrast/100),chroma=1+values.saturation/100,warm=values.temperature*.26;
 const linear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4,srgb=v=>v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055;
 const curve=new Float32Array(256);for(let i=0;i<256;i++)curve[i]=(srgb(Math.min(1,linear(i/255)*gain))*255-127.5)*slope+127.5;
 return{curve,chroma,warm,active:KEYS.some(k=>values[k]!==0)};
}
function pixel(data,i,c,w){
 const r=c.curve[data[i]]+c.warm,g=c.curve[data[i+1]]+c.warm*.08,b=c.curve[data[i+2]]-c.warm,l=r*.2126+g*.7152+b*.0722;
 data[i]=data[i]*(1-w)+clamp(l+(r-l)*c.chroma,0,255)*w;
 data[i+1]=data[i+1]*(1-w)+clamp(l+(g-l)*c.chroma,0,255)*w;
 data[i+2]=data[i+2]*(1-w)+clamp(l+(b-l)*c.chroma,0,255)*w;
}
function tone(image,settings){validateImage(image);const c=curveFor(settings);if(!c.active)return image;const out={width:image.width,height:image.height,data:new Uint8ClampedArray(image.data)};for(let i=0;i<out.data.length;i+=4)if(out.data[i+3])pixel(out.data,i,c,1);return out;}
function apply(image,layers,context){
 validateImage(image);const normalized=validateLayers(layers,context);
 if(normalized.length)check(context&&typeof context.sourceRevision==='string','Local layers require immutable source identity');
 const active=normalized.map(l=>({...l,curve:curveFor(l.adjustments)})).filter(l=>l.enabled&&l.opacity>0&&l.curve.active);
 if(!active.length)return image;
 const {width,height}=image,out={width,height,data:new Uint8ClampedArray(image.data)};
 for(const layer of active){
  const m=layer.mask;let x0=0,y0=0,x1=width,y1=height,selected=null;
  if(m.kind==='selection'){
   const manual=typeof module==='object'&&module.exports?require('./manual-tools.cjs'):globalThis.MintManualTools;
   check(manual,'Manual selection module is unavailable');
   selected=manual.rasterizeSelection(width,height,m.selection,{sourceRevision:context.sourceRevision});
  }
  if(m.kind==='radial'){x0=Math.max(0,Math.floor((m.cx-m.rx)*width));y0=Math.max(0,Math.floor((m.cy-m.ry)*height));x1=Math.min(width,Math.ceil((m.cx+m.rx)*width));y1=Math.min(height,Math.ceil((m.cy+m.ry)*height));}
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=(y*width+x)*4;if(!out.data[i+3])continue;const w=(selected?selected[y*width+x]:weight(m,(x+.5)/width,(y+.5)/height))*layer.opacity;if(w>0)pixel(out.data,i,layer.curve,w);}
 }
 return out;
}
return Object.freeze({LIMITS,KEYS:Object.freeze(KEYS),validateLayers,weight,tone,apply});
});
