/* Android ordered-stage adapter. Geometry-only padding never scales source pixels.
 * Actual raster allocation is limited separately from metadata measure(). */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.MintCanvasPaddingOperation=api;})(typeof globalThis==='object'?globalThis:this,function(root){
 'use strict';
 const LIMITS=Object.freeze({maxPixels:8000000,maxEdge:4096});
 const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
 function core(){const C=typeof module==='object'&&module.exports?require('./canvas-padding.js'):root.MintCanvasPadding;if(!C||!C.validate||!C.plan||!C.apply)throw Error('边框核心缺失，不能忽略已保存的编辑');return C;}
 function validate(op){
  if(!op||typeof op!=='object'||Array.isArray(op)||![Object.prototype,null].includes(Object.getPrototypeOf(op)))throw Error('边框操作必须是普通数据');
  const names=Reflect.ownKeys(op),out=Object.create(null);
  if(names.length!==2)throw Error('边框操作字段不完整');
  for(const key of names){const d=Object.getOwnPropertyDescriptor(op,key);if(!['type','recipe'].includes(key)||!d||!d.enumerable||!own(d,'value'))throw Error('边框操作包含未知字段或访问器');out[key]=d.value;}
  if(!own(out,'type')||!own(out,'recipe')||out.type!=='canvas-padding')throw Error('无效的边框操作');
  return{type:'canvas-padding',recipe:core().validate(out.recipe)};
 }
 function apply(image,op){const v=validate(op);return core().apply(image,v.recipe,LIMITS);}
 function applyCanvas(input,op,createCanvas){
  const v=validate(op),C=core(),w=input.width,h=input.height,p=C.plan(w,h,v.recipe,LIMITS);
  if(!Object.values(p.padding).some(n=>n!==0))return input;
  const pixels=C.apply({width:w,height:h,data:input.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data},v.recipe,LIMITS);
  let out=null;
  try{
   out=createCanvas?createCanvas(pixels.width,pixels.height):root.document.createElement('canvas');
   out.width=pixels.width;out.height=pixels.height;
   const ctx=out.getContext('2d'),im=typeof root.ImageData==='function'?new root.ImageData(pixels.data,pixels.width,pixels.height):ctx.createImageData(pixels.width,pixels.height);
   if(im.data!==pixels.data)im.data.set(pixels.data);ctx.putImageData(im,0,0);return out;
  }catch(error){if(out&&out!==input){out.width=1;out.height=1;}throw error;}
 }
 return Object.freeze({LIMITS,validate,apply,applyCanvas});
});
