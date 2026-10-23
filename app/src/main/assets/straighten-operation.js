/* Ordered Android straighten stage. Metadata planning is separate from bounded
 * raster execution; preview downsizing never changes the saved angle or mode. */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.MintStraightenOperation=api;})(typeof globalThis==='object'?globalThis:this,function(root){
 'use strict';
 const LIMITS=Object.freeze({maxPixels:8000000,maxEdge:4096,maxExtraBytes:128*1024*1024,aggregateWork:128000000});
 const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
 function record(v,keys,required,label){if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))throw Error(label+'必须是普通数据对象');const out=Object.create(null);for(const k of Reflect.ownKeys(v)){const d=Object.getOwnPropertyDescriptor(v,k);if(!keys.includes(k)||!d||!d.enumerable||!own(d,'value'))throw Error(label+'包含未知字段或访问器');out[k]=d.value;}for(const k of required)if(!own(out,k))throw Error(label+'缺少字段：'+k);return out;}
 function core(){const C=typeof module==='object'&&module.exports?require('./straighten.js'):root.MintStraighten;if(!C||typeof C.validate!=='function'||typeof C.plan!=='function'||typeof C.apply!=='function')throw Error('调平核心缺失，不能忽略已保存的编辑');return C;}
 function validate(op){const v=record(op,['type','recipe'],['type','recipe'],'调平操作');if(v.type!=='straighten')throw Error('调平操作类型无效');const recipe=record(v.recipe,['version','angle','mode'],['version','angle','mode'],'调平配方');return Object.freeze({type:'straighten',recipe:core().validate(recipe)});}
 function options(v){const o=record(v===undefined?{}:v,['maxSide','shouldCancel'],[],'调平选项');if(own(o,'maxSide')&&(!Number.isInteger(o.maxSide)||o.maxSide<1||o.maxSide>LIMITS.maxEdge))throw Error('调平预览上限无效');if(own(o,'shouldCancel')&&typeof o.shouldCancel!=='function')throw Error('调平取消回调无效');return o;}
 function checkCancel(o){if(own(o,'shouldCancel')&&o.shouldCancel()){const e=new Error('调平已取消，原图未改变');e.name='AbortError';throw e;}}
 function measure(w,h,op){const v=validate(op);return core().plan(w,h,v.recipe);}
 function plan(w,h,op,opts){const o=options(opts),v=validate(op);if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<1||h<1||w>LIMITS.maxEdge||h>LIMITS.maxEdge||w*h>LIMITS.maxPixels)throw Error('调平输入超过手机预算（800万像素、最长边4096）');const p=core().plan(w,h,v.recipe),out=p.outputSize;if(out.width>LIMITS.maxEdge||out.height>LIMITS.maxEdge||out.width*out.height>LIMITS.maxPixels)throw Error('调平输出超过手机预算（800万像素、最长边4096），请选自动裁边或工作尺寸');const scale=own(o,'maxSide')?Math.min(1,o.maxSide/Math.max(out.width,out.height)):1,renderedSize=Object.freeze({width:Math.max(1,Math.round(out.width*scale)),height:Math.max(1,Math.round(out.height*scale))});const scaled=renderedSize.width!==out.width||renderedSize.height!==out.height;
  // Conservative peak: input readback, output RGBA, ImageData copy, output canvas,
  // optional display copy, and a fixed lookup allowance. Existing input excluded.
  const extraBufferBytes=v.recipe.angle===0?0:4*w*h+12*out.width*out.height+(scaled?4*renderedSize.width*renderedSize.height:0)+131072;
  if(extraBufferBytes>LIMITS.maxExtraBytes)throw Error('调平临时缓冲超过128MiB预算，请选自动裁边或工作尺寸');
  const workUnits=v.recipe.angle===0?0:out.width*out.height*(p.quarterTurns===null?4:1)+(scaled?renderedSize.width*renderedSize.height:0);
  return Object.freeze({...p,renderedSize,extraBufferBytes,workUnits});
 }
 function dispose(c,input){if(c&&c!==input){try{c.width=1;}catch(_){}try{c.height=1;}catch(_){}}}
 function applyCanvas(input,op,createCanvas,opts){const o=options(opts),v=validate(op),p=plan(input.width,input.height,v,o);checkCancel(o);if(v.recipe.angle===0)return input;let out=null,small=null;
  const allocate=(w,h)=>{const c=createCanvas?createCanvas(w,h):root.document.createElement('canvas');if(!c||c===input||c===out)throw Error('调平不能重用输入或输出画布');c.width=w;c.height=h;return c;};
  try{const im=input.getContext('2d',{willReadFrequently:true}).getImageData(0,0,input.width,input.height);checkCancel(o);const r=core().apply({width:input.width,height:input.height,data:im.data},v.recipe,own(o,'shouldCancel')?{shouldCancel:o.shouldCancel}:{});checkCancel(o);out=allocate(r.width,r.height);const ctx=out.getContext('2d'),target=typeof root.ImageData==='function'?new root.ImageData(r.data,r.width,r.height):ctx.createImageData(r.width,r.height);if(target.data!==r.data)target.data.set(r.data);ctx.putImageData(target,0,0);checkCancel(o);if(p.renderedSize.width===out.width&&p.renderedSize.height===out.height)return out;checkCancel(o);small=allocate(p.renderedSize.width,p.renderedSize.height);small.getContext('2d').drawImage(out,0,0,small.width,small.height);checkCancel(o);dispose(out,input);return small;
  }catch(e){dispose(small,input);dispose(out,input);throw e;}
 }
 return Object.freeze({LIMITS,validate,measure,plan,applyCanvas});
});
