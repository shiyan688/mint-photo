/* Ordered local visual mosaic / opaque cover. Never changes or clears the source file. */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.MintRedactOperation=api;})(typeof globalThis==='object'?globalThis:this,function(root){
 'use strict';
 const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
 function core(){const C=typeof module==='object'&&module.exports?require('./redact-core.js'):root.MintRedact;if(!C||!['validate','plan','apply','isActive'].every(k=>typeof C[k]==='function'))throw Error('马赛克/遮盖核心缺失，不能忽略已保存的遮盖');return C;}
 function validate(op){
  if(!op||typeof op!=='object'||Array.isArray(op)||![Object.prototype,null].includes(Object.getPrototypeOf(op)))throw Error('遮盖步骤必须是普通数据');
  const keys=Reflect.ownKeys(op),v=Object.create(null);if(keys.length!==2)throw Error('遮盖步骤字段不完整');
  for(const key of keys){const d=Object.getOwnPropertyDescriptor(op,key);if(!['type','recipe'].includes(key)||!d||!d.enumerable||!own(d,'value'))throw Error('遮盖步骤含未知字段或访问器');v[key]=d.value;}
  if(!own(v,'type')||!own(v,'recipe')||v.type!=='redact')throw Error('无效的遮盖步骤');
  return {type:'redact',recipe:core().validate(v.recipe)};
 }
 function plan(width,height,op){return core().plan(width,height,validate(op).recipe);}
 function apply(image,op){return core().apply(image,validate(op).recipe);}
 function applyCanvas(input,op,createCanvas){
  const v=validate(op),C=core(),w=input.width,h=input.height;C.plan(w,h,v.recipe);
  if(!C.isActive(v.recipe))return input;
  const ctx=input.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('遮盖底图不可读取');
  const pixels=C.apply({width:w,height:h,data:ctx.getImageData(0,0,w,h).data},v.recipe);
  let out=null;
  try{out=createCanvas?createCanvas(w,h):root.document.createElement('canvas');if(!out||out===input)throw Error('不能覆盖遮盖前的原始画布');out.width=w;out.height=h;const target=out.getContext('2d');if(!target)throw Error('无法分配遮盖输出');const im=target.createImageData(w,h);im.data.set(pixels.data);target.putImageData(im,0,0);return out;}
  catch(error){if(out&&out!==input){out.width=1;out.height=1;}throw error;}
 }
 return Object.freeze({validate,plan,apply,applyCanvas});
});
