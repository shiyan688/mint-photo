/* Mobile ordered raster adapter. A batch belongs to its saved stage, not an identity. */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.MintPortraitPeopleOperation=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
 'use strict';const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k),LIMITS=Object.freeze({maxPixels:8000000,maxEdge:4096,maxExtraBytes:134217728,maxWorkUnits:128000000});
 function dep(name,file){const x=typeof module==='object'&&module.exports?require('./'+file+'.js'):root[name];if(!x)throw Error('逐人人像核心缺失，不能跳过已有编辑');return x;}
 function core(){return dep('MintPortraitPeople','portrait-people');}
 function processor(){return core().createProcessor({engine:dep('PortraitEngine','portrait-engine'),limits:LIMITS});}
 function protectionCore(){return dep('MintBeautyProtection','beauty-protection').createCore({people:core(),maskRefine:dep('MintMaskRefine','mask-refine')});}
 function record(v,keys,required=keys){if(!v||typeof v!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(v)))throw Error('逐人人像操作必须是普通数据');const out=Object.create(null);for(const k of Reflect.ownKeys(v)){const d=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||!keys.includes(k)||!d.enumerable||!own(d,'value'))throw Error('逐人人像操作含不支持字段');out[k]=d.value;}for(const k of required)if(!own(out,k))throw Error('逐人人像操作缺少字段');return out;}
 function validate(value){
  const v=record(value,['type','phase','batch','version','protection'],['type','phase','batch']);
  if(v.type!=='portrait-people'||!['beauty','reshape'].includes(v.phase))throw Error('逐人人像阶段无效');
  const batch=core().validateBatch(v.batch);
  if(core().hasEffect(batch,v.phase==='beauty'?'reshape':'beauty'))throw Error('单步逐人人像不能隐藏另一个阶段的参数');
  if(!own(v,'version')){if(own(v,'protection'))throw Error('美颜保护必须使用明确的版本2操作');return{type:'portrait-people',phase:v.phase,batch};}
  if(v.version!==2||v.phase!=='beauty'||!own(v,'protection'))throw Error('版本2仅支持带明确保护字段的逐人美颜');
  return{type:'portrait-people',version:2,phase:'beauty',batch,protection:protectionCore().validate(v.protection,batch)};
 }
 function guarded(fn){try{return fn();}catch(error){const labels={FACE_OVERLAP:'人物距离较近，调整或取样区域可能碰到另一人；本次已拒绝，请降低塑形幅度或使用手动局部工具',WORK_BUDGET:'逐人人像计算量超出保守预算，请减少人数或参数，或选择工作尺寸',MEMORY_BUDGET:'逐人人像估计内存超出预算，请减少人数或控制项',TRANSPARENT_RESHAPE:'透明图片暂不支持逐人塑形，避免透明边缘错位',GEOMETRY:'人脸定位范围过小或异常，请重新识别或使用手动工具'};if(error&&labels[error.code]){const e=Error(labels[error.code]);e.code=error.code;throw e;}throw error;}}
 function plan(width,height,value){
  const op=validate(value),p=guarded(()=>processor().planSize(width,height,op.batch,{sourceRevision:op.batch.sourceRevision,phase:op.phase}));
  if(p.resources.cumulativeTypedArrayBytes>LIMITS.maxExtraBytes)throw Error('逐人人像数组分配估计超过128MiB，请减少同时调整的人数或控制项，或选择工作尺寸');
  // Legacy and explicit empty protection retain the existing plan and pixels.
  if(op.version!==2||!protectionCore().hasInstructions(op.protection,op.batch))return p;
  const mask=guarded(()=>protectionCore().plan(width,height,op.protection,op.batch)),a=p.resources,b=mask.resources;
  const peak=a.estimatedPeakExtraBytes+b.estimatedPeakExtraBytes,total=a.cumulativeTypedArrayBytes+b.cumulativeTypedArrayBytes,work=a.estimatedWorkUnits+b.estimatedWorkUnits+b.preflightWorkUnits;
  if(![peak,total,work].every(Number.isSafeInteger))throw Error('美颜保护资源估计无效');
  if(peak>LIMITS.maxExtraBytes||total>LIMITS.maxExtraBytes)throw Error('逐人美颜与保护笔划合计数组预算超过128MiB，请减少同时调整人数或选择工作尺寸');
  if(work>LIMITS.maxWorkUnits)throw Error('逐人美颜与保护笔划合计计算量超出预算，请减少笔划或选择工作尺寸');
  return Object.freeze({...p,protection:mask,resources:Object.freeze({...a,extraPeakBytes:peak,estimatedPeakExtraBytes:peak,cumulativeTypedArrayBytes:total,workUnits:work,estimatedWorkUnits:work,protectionMaskBytes:b.cumulativeTypedArrayBytes})});
 }
 function isActive(value){const op=validate(value);return core().hasEffect(op.batch,op.phase);}
 function apply(image,value,options){
  image=record(image,['width','height','data']);const op=validate(value),p=plan(image.width,image.height,op),opts=options===undefined?{}:record(options,['shouldCancel'],[]);
  const candidate=guarded(()=>processor()[op.phase==='beauty'?'applyBeauty':'applyReshape'](image,op.batch,{sourceRevision:op.batch.sourceRevision,...opts}));
  if(op.version!==2||!protectionCore().hasInstructions(op.protection,op.batch))return candidate;
  // Regions come only from the complete, guarded all-face plan. A stroke may
  // cross a neighbour, but it must never attenuate that neighbour's candidate.
  return protectionCore().apply(image,candidate,op.protection,op.batch,{regions:p.faces.map(f=>({faceId:f.id,writeBounds:f.writeBounds})),...opts});
 }
 function applyCanvas(input,value){const op=validate(value);plan(input.width,input.height,op);if(!isActive(op))return input;const ctx=input.getContext('2d',{willReadFrequently:true}),im=ctx.getImageData(0,0,input.width,input.height),result=apply({width:im.width,height:im.height,data:im.data},op);let output=null;try{output=root.document.createElement('canvas');output.width=result.width;output.height=result.height;const c=output.getContext('2d'),pixels=typeof root.ImageData==='function'?new root.ImageData(result.data,result.width,result.height):c.createImageData(result.width,result.height);if(pixels.data!==result.data)pixels.data.set(result.data);c.putImageData(pixels,0,0);return output;}catch(e){if(output){output.width=1;output.height=1;}throw e;}}
 return Object.freeze({LIMITS,CAPABILITIES:Object.freeze({operationVersion:2,beautyProtection:true,protectionStage:"before-current-beauty"}),validate,plan,isActive,apply,applyCanvas});
});
