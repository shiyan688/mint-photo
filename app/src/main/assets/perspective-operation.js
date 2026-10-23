/* Source-preserving ordered perspective stage. Saved output fractions belong to
 * the stage input, never to its capped display canvas. */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.MintPerspectiveOperation=api;})(typeof globalThis==='object'?globalThis:this,function(root){
 'use strict';
 const LIMITS=Object.freeze({maxPixels:8000000,maxEdge:4096,maxExtraBytes:128*1024*1024,aggregateWork:128000000});
 const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k), issued=new WeakSet();
 function record(v,keys,required,label){if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))throw Error(label+'必须是普通数据对象');const out=Object.create(null);for(const k of Reflect.ownKeys(v)){const d=Object.getOwnPropertyDescriptor(v,k);if(!keys.includes(k)||!d||!d.enumerable||!own(d,'value'))throw Error(label+'包含未知字段或访问器');out[k]=d.value;}for(const k of required)if(!own(out,k))throw Error(label+'缺少字段：'+k);return out;}
 function core(){const C=typeof module==='object'&&module.exports?require('./perspective.js'):root.MintPerspective;if(!C||!['validate','plan','apply','isActive'].every(k=>typeof C[k]==='function'))throw Error('透视核心缺失，不能忽略已保存的编辑');return C;}
 function validate(op){const v=record(op,['type','recipe'],['type','recipe'],'透视操作');if(v.type!=='perspective')throw Error('透视操作类型无效');if(!v.recipe)throw Error('透视操作缺少配方');return Object.freeze({type:'perspective',recipe:core().validate(v.recipe)});}
 function options(v){const o=record(v===undefined?{}:v,['maxSide','shouldCancel'],[],'透视选项');if(own(o,'maxSide')&&(!Number.isInteger(o.maxSide)||o.maxSide<1||o.maxSide>LIMITS.maxEdge))throw Error('透视预览上限无效');if(own(o,'shouldCancel')&&typeof o.shouldCancel!=='function')throw Error('透视取消回调无效');return o;}
 function checkCancel(o){if(own(o,'shouldCancel')&&o.shouldCancel()){const e=new Error('透视处理已取消，原图未改变');e.name='AbortError';throw e;}}
 function measure(w,h,op){return core().plan(w,h,validate(op).recipe);}
 function plan(w,h,op,opts){const o=options(opts),v=validate(op);if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<1||h<1||w>LIMITS.maxEdge||h>LIMITS.maxEdge||w*h>LIMITS.maxPixels)throw Error('透视输入超过手机预算（800万像素、最长边4096），请先裁剪或选择工作尺寸');
  const p=core().plan(w,h,v.recipe,own(o,'maxSide')?{maxSide:o.maxSide}:{}),out=p.outputSize,rendered=p.renderedSize;
  if(out.width>LIMITS.maxEdge||out.height>LIMITS.maxEdge||out.width*out.height>LIMITS.maxPixels)throw Error('透视输出超过手机预算（800万像素、最长边4096）');
  const active=core().isActive(v.recipe)||rendered.width!==w||rendered.height!==h;
  if(!Number.isSafeInteger(p.mipBytes)||p.mipBytes<0||!Number.isSafeInteger(p.workUnits)||p.workUnits<0)throw Error('透视采样预算信息缺失，已阻止应用');
  const extraBufferBytes=active?4*w*h+12*rendered.width*rendered.height+p.mipBytes+131072:0;
  if(extraBufferBytes>LIMITS.maxExtraBytes)throw Error('透视临时缓冲超过128MiB预算，请减少输出尺寸或选择工作尺寸');
  // The shared planner charges mip construction and bounded anisotropic
  // samples, not merely one bilinear tap group per output pixel.
  const workUnits=active?p.workUnits:0;
  if(workUnits>LIMITS.aggregateWork)throw Error('透视采样超过安全计算预算，请减少输出尺寸或选择工作尺寸');
  return Object.freeze({...p,extraBufferBytes,workUnits});
 }
 function dispose(c,input){if(c&&c!==input){try{c.width=1;}catch(_){}try{c.height=1;}catch(_){}}}
 function applyCanvas(input,op,createCanvas,opts){const o=options(opts),v=validate(op),p=plan(input.width,input.height,v,o);checkCancel(o);if(!core().isActive(v.recipe)&&p.renderedSize.width===input.width&&p.renderedSize.height===input.height)return input;let out=null;
  try{const im=input.getContext('2d',{willReadFrequently:true}).getImageData(0,0,input.width,input.height);checkCancel(o);
   const args={};if(own(o,'maxSide'))args.maxSide=o.maxSide;if(own(o,'shouldCancel'))args.shouldCancel=o.shouldCancel;
   const r=core().apply({width:input.width,height:input.height,data:im.data},v.recipe,args);checkCancel(o);
   if(r.width!==p.renderedSize.width||r.height!==p.renderedSize.height)throw Error('透视输出尺寸不符，已阻止应用');
   const c=createCanvas?createCanvas(r.width,r.height):root.document.createElement('canvas');if(!c||c===input||issued.has(c)||typeof c.getContext!=='function')throw Error('透视不能重用输入或旧输出画布');issued.add(c);out=c;out.width=r.width;out.height=r.height;
   const ctx=out.getContext('2d'),target=typeof root.ImageData==='function'?new root.ImageData(r.data,r.width,r.height):ctx.createImageData(r.width,r.height);if(target.data!==r.data)target.data.set(r.data);ctx.putImageData(target,0,0);checkCancel(o);return out;
  }catch(e){dispose(out,input);throw e;}
 }
 return Object.freeze({LIMITS,validate,measure,plan,applyCanvas});
});
