/* Ordered collage: current image is cell 1; secondary RGBA working assets are embedded. */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.MintCollageOperation=api;})(typeof globalThis==='object'?globalThis:this,function(root){
 'use strict';
 const LIMITS=Object.freeze({assets:4,assetBytes:16*1024*1024,aggregateWork:128000000,maxExtraBytes:128*1024*1024});
 const own=Function.call.bind(Object.prototype.hasOwnProperty),cache=new WeakMap();
 function fail(message){throw new TypeError(message);}
 function record(v,keys,required,label){if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail(label+'必须是普通数据');const out=Object.create(null);for(const k of Reflect.ownKeys(v)){const d=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||!keys.includes(k)||!d||!d.enumerable||!own(d,'value'))fail(label+'包含未知字段或访问器');out[k]=d.value;}for(const k of required)if(!own(out,k))fail(label+'缺少字段 '+k);return out;}
 function list(v,min,max){if(!Array.isArray(v)||![Array.prototype,null].includes(Object.getPrototypeOf(v)))fail('拼图素材必须是数组');const d=Object.getOwnPropertyDescriptor(v,'length');if(!d||!own(d,'value')||d.value<min||d.value>max||Reflect.ownKeys(v).length!==d.value+1)fail('拼图素材数量无效');const out=[];for(let i=0;i<d.value;i++){const p=Object.getOwnPropertyDescriptor(v,String(i));if(!p||!p.enumerable||!own(p,'value'))fail('拼图素材不能有空项或访问器');out.push(p.value);}return out;}
 function dependencies(){const node=typeof module==='object'&&module.exports,L=node?require('./collage-layout.js'):root.MintCollageLayout,C=node?require('./image-overlay.js'):root.MintImageOverlay;if(!L||!L.plan||!L.validate||!C||!C.validateAsset||!C.decodeAsset)fail('拼图或嵌入素材核心缺失，不能忽略已有拼图');return{L,C};}
 function asset(v,C){if(v&&typeof v==='object'&&Object.isFrozen(v)&&cache.has(v))return cache.get(v);const out=C.validateAsset(v);if(v&&typeof v==='object'&&Object.isFrozen(v))cache.set(v,out);cache.set(out,out);return out;}
 function validate(v){const o=record(v,['type','recipe','assets'],['type','recipe','assets'],'拼图步骤');if(o.type!=='collage')fail('拼图步骤类型无效');const {L,C}=dependencies(),recipe=L.validate(o.recipe),assets=list(o.assets,1,3).map(v=>asset(v,C));if(assets.length+1!==recipe.cells.length)fail('拼图格数与本地素材数量不一致');return Object.freeze({type:'collage',recipe,assets:Object.freeze(assets)});}
 function opts(v){const o=record(v===undefined?{}:v,['maxSide','shouldCancel'],[],'拼图选项');if(own(o,'shouldCancel')&&typeof o.shouldCancel!=='function')fail('取消检查必须是函数');return o;}
 function cancel(o){if(own(o,'shouldCancel')&&o.shouldCancel()){const e=new Error('拼图已取消');e.name='AbortError';e.code='COLLAGE_CANCELLED';throw e;}}
 function plan(width,height,operation,options){const o=opts(options),op=validate(operation),sizes=[{width,height},...op.assets.map(a=>({width:a.width,height:a.height}))],p=dependencies().L.plan(sizes,op.recipe,own(o,'maxSide')?{maxSide:o.maxSide}:undefined);if(p.estimates.extraBytes>LIMITS.maxExtraBytes||p.estimates.workPixels>LIMITS.aggregateWork)fail('拼图超出额外缓冲或计算预算，请减少输出尺寸');return p;}
 function dimensions(operation){const r=validate(operation).recipe;return {width:r.width,height:r.height};}
 function applyCanvas(input,operation,createCanvas,options){
  const o=opts(options);cancel(o);if(!input||typeof input.getContext!=='function')fail('拼图第一格图像不可用');if(typeof createCanvas!=='function')fail('拼图画布接口缺失');
  const op=validate(operation),p=plan(input.width,input.height,op,o),{C}=dependencies();cancel(o);let out=null;const owned=new Set(),allocated=new Set([input]);
  function make(w,h){const c=createCanvas(w,h);if(!c||allocated.has(c))fail('拼图输出不能重用输入或已占用画布');allocated.add(c);owned.add(c);if(c.width!==w||c.height!==h||typeof c.getContext!=='function')fail('拼图画布尺寸或接口无效');return c;}
  function dispose(c){if(c&&owned.has(c)){owned.delete(c);c.width=1;c.height=1;}}
  try{out=make(p.outputSize.width,p.outputSize.height);const ctx=out.getContext('2d');if(!ctx)fail('无法分配拼图输出');ctx.clearRect(0,0,out.width,out.height);ctx.save();try{ctx.globalCompositeOperation='source-over';ctx.globalAlpha=op.recipe.background.opacity;ctx.fillStyle=op.recipe.background.color;ctx.fillRect(0,0,out.width,out.height);ctx.globalAlpha=1;ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
   for(let i=0;i<p.cells.length;i++){cancel(o);let src=input,temporary=null;try{if(i){const a=op.assets[i-1],im=C.decodeAsset(a);cancel(o);temporary=src=make(a.width,a.height);const x=src.getContext('2d');if(!x)fail('无法分配拼图素材画布');const rgba=x.createImageData(a.width,a.height);rgba.data.set(im.data);x.putImageData(rgba,0,0);}const c=p.cells[i],s=c.sourceRect,d=c.destinationRect,b=c.cellRect;ctx.save();try{ctx.beginPath();ctx.rect(b.x,b.y,b.width,b.height);ctx.clip();ctx.drawImage(src,s.x,s.y,s.width,s.height,d.x,d.y,d.width,d.height);}finally{ctx.restore();}}finally{dispose(temporary);}}
  }finally{ctx.restore();}cancel(o);owned.delete(out);return out;}catch(e){for(const c of [...owned])dispose(c);throw e;}
 }
 return Object.freeze({LIMITS,validate,plan,dimensions,applyCanvas});
});
