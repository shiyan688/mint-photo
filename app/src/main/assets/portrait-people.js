/* MintPortraitPeople v1. Deterministic batch-local face controls, not identity tracking.
 * Frozen-engine companion; see CONTRACT.md and README.md for support proofs.
 * This file and portrait-people.cjs are intentionally byte-identical. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MintPortraitPeople = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX = Object.freeze({maxPixels:16777216,maxEdge:16384,maxExtraBytes:268435456,maxWorkUnits:2000000000});
  const DEFAULT_DETECTOR = Object.freeze({id:'mediapipe-face-landmarker',modelSha256:'64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',topology:'MediaPipe478'});
  const OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
  const LIPS = [61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185];
  const BEAUTY_KEYS = ['smooth','brighten','warmth','underEye','redness','lip','blush','palette'];
  const SHAPE_KEYS = ['slim','eyes','nose','jaw'];
  const own = (v,k) => Object.prototype.hasOwnProperty.call(v,k);
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  const typed = Object.getPrototypeOf(Uint8Array.prototype);
  const typedGet = name => Object.getOwnPropertyDescriptor(typed,name).get;
  const typedLength = typedGet('length'), typedBuffer = typedGet('buffer');
  // Native internal-slot checks: instance properties can be shadowed or getters.
  // byteLength also rejects SharedArrayBuffer even with a spoofed prototype.
  const bufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get;
  const resizableDescriptor = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable');
  const bufferResizable = resizableDescriptor && resizableDescriptor.get;
  function fail(code,message,Type) { const e = new (Type || Error)(message); e.code=code; throw e; }
  function record(v, required, optional, label) {
    if (!v || typeof v!=='object' || (Object.getPrototypeOf(v)!==Object.prototype && Object.getPrototypeOf(v)!==null)) fail('INVALID_RECORD',label+' must be a plain own-data record.',TypeError);
    const descriptors=Object.getOwnPropertyDescriptors(v), keys=Reflect.ownKeys(descriptors), allowed=required.concat(optional||[]);
    if (keys.some(k=>typeof k!=='string'||!allowed.includes(k))) fail('UNKNOWN_FIELD',label+' has an unknown field or symbol.',TypeError);
    for(const k of keys) if(!own(descriptors[k],'value')) fail('ACCESSOR',label+'.'+k+' cannot be an accessor.',TypeError);
    for(const k of required) if(!own(descriptors,k)) fail('MISSING_FIELD',label+'.'+k+' is required.',TypeError);
    const out=Object.create(null);for(const k of keys)out[k]=descriptors[k].value;return out;
  }
  function array(v,max,label,exact) {
    if(!Array.isArray(v)||Object.getPrototypeOf(v)!==Array.prototype)fail('INVALID_ARRAY',label+' must be an ordinary dense array.',TypeError);
    const length=Object.getOwnPropertyDescriptor(v,'length').value;
    if(length>max||(exact!==undefined&&length!==exact))fail('LIMIT',label+' length is outside its permitted bound.',RangeError);
    const ds=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(ds);
    if(keys.length!==length+1)fail('INVALID_ARRAY',label+' must have only dense numeric entries.',TypeError);
    for(let i=0;i<length;i++)if(!own(ds,String(i))||!own(ds[i],'value'))fail('ACCESSOR',label+' cannot contain holes or accessors.',TypeError);
    const out=[];for(let i=0;i<length;i++)out.push(ds[i].value);return out;
  }
  function finite(v,min,max,label) {
    if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail('RANGE',label+' must be finite within ['+min+','+max+'].',RangeError);return v;
  }
  function integer(v,min,max,label){finite(v,min,max,label);if(!Number.isSafeInteger(v))fail('RANGE',label+' must be an integer.',RangeError);return v;}
  function textValue(v,max,label){if(typeof v!=='string'||!v.length||v.length>max||!v.trim()||/[\x00-\x1f\x7f]/.test(v))fail('INVALID_TEXT',label+' must be a nonempty bounded string.',TypeError);return v;}
  function dimensions(v,label,limits){const d=record(v,['width','height'],[],label);const width=integer(d.width,1,limits.maxEdge,label+'.width'),height=integer(d.height,1,limits.maxEdge,label+'.height');if(width*height>limits.maxPixels)fail('LIMIT',label+' exceeds the pixel budget.',RangeError);return{width,height};}
  function detectorValue(v){const d=record(v,['id','modelSha256','topology'],[],'detector');textValue(d.id,128,'detector.id');if(typeof d.modelSha256!=='string'||! /^[0-9a-f]{64}$/.test(d.modelSha256))fail('MODEL','detector.modelSha256 must be 64 lowercase hex characters.',TypeError);if(d.topology!=='MediaPipe468'&&d.topology!=='MediaPipe478')fail('TOPOLOGY','Unsupported detector topology.',RangeError);return{id:d.id,modelSha256:d.modelSha256,topology:d.topology};}
  function sameDetector(a,b){return a.id===b.id&&a.modelSha256===b.modelSha256&&a.topology===b.topology;}
  function defaultsBeauty(){return{smooth:0,brighten:0,warmth:0,underEye:0,redness:0,lip:0,blush:0,palette:'natural'};}
  function defaultsReshape(){return{slim:0,eyes:0,nose:0,jaw:0};}
  function controls(v,phase){const keys=phase==='beauty'?BEAUTY_KEYS:SHAPE_KEYS,d=record(v,keys,[],phase),out={};for(const k of keys){if(k==='palette'){if(!['natural','peach','rose'].includes(d[k]))fail('RANGE','Unsupported beauty.palette.',RangeError);out[k]=d[k];}else{const lo=k==='warmth'?-100:(k==='nose'||k==='jaw'?-50:0),hi=phase==='beauty'?100:(k==='slim'||k==='eyes'?60:50);out[k]=finite(d[k],lo,hi,phase+'.'+k);}}return out;}
  function meshValue(v,n){return array(v,n,'landmarks',n).map((point,i)=>{const p=record(point,['x','y'],['z'],'landmarks['+i+']'),out={x:finite(p.x,-4,4,'landmark.x'),y:finite(p.y,-4,4,'landmark.y')};if(own(p,'z'))out.z=finite(p.z,-10,10,'landmark.z');return out;});}
  function contextValue(v,withPhase){const c=record(v,['sourceRevision'].concat(withPhase?['phase']:[]),['batchId','detector','shouldCancel'],'context');textValue(c.sourceRevision,256,'context.sourceRevision');if(own(c,'batchId'))textValue(c.batchId,256,'context.batchId');if(own(c,'detector'))c.detector=detectorValue(c.detector);if(own(c,'shouldCancel')&&typeof c.shouldCancel!=='function')fail('INVALID_CALLBACK','shouldCancel must be a function.',TypeError);if(withPhase)phaseValue(c.phase);return c;}
  function phaseValue(v){if(v!=='beauty'&&v!=='reshape')fail('PHASE','phase must be beauty or reshape.',RangeError);return v;}
  function validateBatch(v,context){
    const b=record(v,['version','sourceRevision','batchId','detector','detectionSize','faces'],[],'batch');if(b.version!==1)fail('VERSION','Unsupported portrait batch version.',RangeError);
    textValue(b.sourceRevision,256,'batch.sourceRevision');textValue(b.batchId,256,'batch.batchId');const detector=detectorValue(b.detector),detectionSize=dimensions(b.detectionSize,'detectionSize',MAX),n=detector.topology==='MediaPipe468'?468:478;
    const ids=new Set(),faces=array(b.faces,5,'faces').map((f,i)=>{const d=record(f,['id','landmarks','beauty','reshape'],[],'face');if(typeof d.id!=='string'||!/^face-[1-5]$/.test(d.id)||ids.has(d.id))fail('FACE_ID','Face IDs must be unique batch-local face-1..face-5.',TypeError);ids.add(d.id);return{id:d.id,landmarks:meshValue(d.landmarks,n),beauty:controls(d.beauty,'beauty'),reshape:controls(d.reshape,'reshape')};});
    for(let i=1;i<=faces.length;i++)if(!ids.has('face-'+i))fail('FACE_ID','Face IDs must form the contiguous batch-local set face-1..face-N.',TypeError);
    if(context!==undefined){const c=contextValue(context,false);if(c.sourceRevision!==b.sourceRevision)fail('SOURCE_MISMATCH','Portrait batch belongs to a different source revision.');if(own(c,'batchId')&&c.batchId!==b.batchId)fail('BATCH_MISMATCH','Portrait batch ID is stale.');if(c.detector&&!sameDetector(c.detector,detector))fail('MODEL_MISMATCH','Portrait detector metadata does not match the expected model/topology.');}
    return{version:1,sourceRevision:b.sourceRevision,batchId:b.batchId,detector,detectionSize,faces};
  }
  function createBatch(v){const d=record(v,['sourceRevision','batchId','detector','detectionSize','landmarks'],[],'detection'),meshes=array(d.landmarks,5,'landmarks');return validateBatch({version:1,sourceRevision:d.sourceRevision,batchId:d.batchId,detector:d.detector,detectionSize:d.detectionSize,faces:meshes.map((landmarks,i)=>({id:'face-'+(i+1),landmarks,beauty:defaultsBeauty(),reshape:defaultsReshape()}))});}
  function active(face,phase){return (phase==='beauty'?BEAUTY_KEYS:SHAPE_KEYS).some(k=>k!=='palette'&&face[phase][k]!==0);}
  function hasEffect(batch,phase){phaseValue(phase);return validateBatch(batch).faces.some(f=>active(f,phase));}
  function extents(points){return{minX:Math.min(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxX:Math.max(...points.map(p=>p.x)),maxY:Math.max(...points.map(p=>p.y))};}
  function clampedMesh(face){const p=face.landmarks.map(p=>({x:clamp(p.x,0,1),y:clamp(p.y,0,1)})),oval=extents(OVAL.map(i=>p[i]));return{p,oval,all:extents(p)};}
  function displayBounds(face){const a=clampedMesh(face).all;return{id:face.id,x:a.minX,y:a.minY,width:a.maxX-a.minX,height:a.maxY-a.minY};}
  function getFaceBounds(batch){return validateBatch(batch).faces.map(displayBounds);}
  function freeze(value){if(value&&typeof value==='object'){for(const k of Object.keys(value))freeze(value[k]);Object.freeze(value);}return value;}
  function pixelsRect(r,w,h){if(!r)return null;const b={minX:Math.max(0,Math.floor(r.minX)),minY:Math.max(0,Math.floor(r.minY)),maxX:Math.min(w-1,Math.ceil(r.maxX)),maxY:Math.min(h-1,Math.ceil(r.maxY))};return b.minX>b.maxX||b.minY>b.maxY?null:b;}
  function union(a,b){if(!a)return b;if(!b)return a;return{minX:Math.min(a.minX,b.minX),minY:Math.min(a.minY,b.minY),maxX:Math.max(a.maxX,b.maxX),maxY:Math.max(a.maxY,b.maxY)};}
  function expand(b,r,w,h){return b?pixelsRect({minX:b.minX-r,minY:b.minY-r,maxX:b.maxX+r,maxY:b.maxY+r},w,h):null;}
  function intersects(a,b){return !!(a&&b&&a.minX<=b.maxX&&b.minX<=a.maxX&&a.minY<=b.maxY&&b.minY<=a.maxY);}
  function inside(b,x,y){return !!(b&&x>=b.minX&&x<=b.maxX&&y>=b.minY&&y<=b.maxY);}
  function protectedRect(m,w,h){return pixelsRect({minX:m.all.minX*(w-1)-1,minY:m.all.minY*(h-1)-1,maxX:m.all.maxX*(w-1)+1,maxY:m.all.maxY*(h-1)+1},w,h);}
  function workSize(w,h){const s=Math.min(1,1024/Math.max(w,h));return{width:Math.max(1,Math.round(w*s)),height:Math.max(1,Math.round(h*s))};}
  // Exact engine polygon arithmetic, but keep only bounds, never a pixel mask.
  // Centroid cancellation and edge interpolation can round beyond raw extrema.
  function workPolygonBounds(points,w,h){
    const cx=points.reduce((sum,p)=>sum+p.x,0)/points.length,cy=points.reduce((sum,p)=>sum+p.y,0)/points.length;
    const ps=points.map(p=>({x:(cx+(p.x-cx))*(w-1),y:(cy+(p.y-cy))*(h-1)}));
    const minY=clamp(Math.ceil(Math.min(...ps.map(p=>p.y))),0,h-1),maxY=clamp(Math.floor(Math.max(...ps.map(p=>p.y))),0,h-1);let result=null;
    for(let y=minY;y<=maxY;y++){
      const cuts=[];for(let i=0,j=ps.length-1;i<ps.length;j=i++){const a=ps[i],b=ps[j];if((a.y>y)!==(b.y>y))cuts.push(a.x+(y-a.y)*(b.x-a.x)/(b.y-a.y));}
      cuts.sort((a,b)=>a-b);for(let i=0;i+1<cuts.length;i+=2){const start=clamp(Math.ceil(cuts[i]),0,w-1),end=clamp(Math.floor(cuts[i+1]),0,w-1);if(start<=end)result=union(result,{minX:start,minY:y,maxX:end,maxY:y});}
    }
    return result;
  }
  // Bilinear sampleScalar can touch a nonzero texel at one work-grid cell beyond
  // the polygon. floor/ceil + one FULL pixel covers floating-point endpoints too.
  function fromWork(b,size,w,h,halo){if(!b)return null;const sx=(size.width-1)/Math.max(1,w-1),sy=(size.height-1)/Math.max(1,h-1);return pixelsRect({minX:sx?(b.minX-halo)/sx-1:0,minY:sy?(b.minY-halo)/sy-1:0,maxX:sx?(b.maxX+halo)/sx+1:w-1,maxY:sy?(b.maxY+halo)/sy+1:h-1},w,h);}
  function beautySupport(m,settings,w,h,size){
    let grid=workPolygonBounds(OVAL.map(i=>m.p[i]),size.width,size.height);
    if(settings.lip)grid=union(grid,workPolygonBounds(LIPS.map(i=>m.p[i]),size.width,size.height));
    const writeBounds=fromWork(grid,size,w,h,1);
    const faceWidth=(m.oval.maxX-m.oval.minX)*(size.width-1),smoothRadius=settings.smooth?Math.max(1,Math.min(8,Math.round(faceWidth*.014))):0;
    const anyColor=!!(settings.underEye||settings.redness||settings.lip||settings.blush),colorRadius=anyColor?Math.max(2,Math.round(Math.min(size.width,size.height)*.014)):0;
    // One interpolation cell at each stage, the finite box-filter radius, and
    // the source resize bilinear neighbor are included even when gates exclude it.
    const readBounds=fromWork(grid,size,w,h,2+Math.max(smoothRadius,colorRadius));
    return{writeBounds,readBounds,influenceBounds:union(writeBounds,readBounds),workPolygonBounds:grid};
  }
  function shapeSupport(m,s,w,h){
    const p=i=>({x:m.p[i].x*(w-1),y:m.p[i].y*(h-1)}),fw=(m.oval.maxX-m.oval.minX)*(w-1),fh=(m.oval.maxY-m.oval.minY)*(h-1),cx=(m.oval.minX+m.oval.maxX)*(w-1)/2,fields=[];
    if(fw<2||fh<2)return{writeBounds:null,readBounds:null,influenceBounds:null,fields:[]};
    function move(i,amount,rx,ry){const a=p(i),delta=(cx-a.x)*amount;fields.push({x:a.x+delta,y:a.y,rx,ry});}
    if(s.slim){move(234,s.slim/100*.15,fw*.34,fh*.4);move(454,s.slim/100*.15,fw*.34,fh*.4);}
    if(s.jaw){move(172,s.jaw/100*.18,fw*.30,fh*.27);move(397,s.jaw/100*.18,fw*.30,fh*.27);}
    if(s.eyes)for(const pair of [[33,133],[263,362]]){const a=p(pair[0]),b=p(pair[1]),span=Math.max(2,Math.hypot(a.x-b.x,a.y-b.y));fields.push({x:(a.x+b.x)/2,y:(a.y+b.y)/2,rx:span*.9,ry:span*.62});}
    if(s.nose){const a=p(1);fields.push({x:a.x,y:a.y,rx:fw*.20,ry:fh*.20});}
    const writeBounds=pixelsRect({minX:Math.min(...fields.map(f=>f.x-f.rx)),minY:Math.min(...fields.map(f=>f.y-f.ry)),maxX:Math.max(...fields.map(f=>f.x+f.rx)),maxY:Math.max(...fields.map(f=>f.y+f.ry))},w,h);
    const maxShift=Math.min(fw,fh)*.12,readBounds=expand(writeBounds,maxShift+1,w,h);
    return{writeBounds,readBounds,influenceBounds:union(writeBounds,readBounds),fields,maxShift};
  }
  function limitsValue(v){if(v===undefined)return{...MAX};const d=record(v,[],Object.keys(MAX),'limits'),out={...MAX};for(const k of Object.keys(d))out[k]=integer(d[k],1,MAX[k],'limits.'+k);return out;}
  function imageValue(v,limits){
    const d=record(v,['width','height','data'],[],'image'),size=dimensions({width:d.width,height:d.height},'image',limits),data=d.data;
    if(!ArrayBuffer.isView(data)||(Object.getPrototypeOf(data)!==Uint8Array.prototype&&Object.getPrototypeOf(data)!==Uint8ClampedArray.prototype))fail('IMAGE_DATA','Image data must be a native byte typed array.',TypeError);
    for(const k of ['length','buffer','byteLength','byteOffset'])if(own(data,k))fail('IMAGE_DATA','Typed-array properties cannot be overridden.',TypeError);
    if(Object.getOwnPropertySymbols(data).length)fail('IMAGE_DATA','Typed-array symbols cannot be overridden.',TypeError);
    const buffer=typedBuffer.call(data);if(Object.getPrototypeOf(buffer)!==ArrayBuffer.prototype)fail('IMAGE_DATA','Shared/resizable/foreign image buffers are unsupported.',TypeError);
    let resizable=false;
    try {bufferByteLength.call(buffer);resizable=bufferResizable?bufferResizable.call(buffer):false;}
    catch(error){fail('IMAGE_DATA','Expected a genuine non-shared ArrayBuffer backing store.',TypeError);}
    if(resizable||typedLength.call(data)!==size.width*size.height*4)fail('IMAGE_DATA','Expected exactly width * height * 4 non-resizable RGBA bytes.',TypeError);
    return{width:size.width,height:size.height,data};
  }
  function cancel(c){if(c.shouldCancel&&c.shouldCancel())fail('CANCELLED','Portrait processing was cancelled.');}
  function resources(w,h,size,faces,phase){
    const n=w*h,k=size.width*size.height,act=faces.filter(f=>f.active),outputBytes=4*n;
    let maxTemporary=0,totalTemporary=0,workUnits=n;const resized=size.width!==w||size.height!==h;
    for(const face of act){
      const s=face.controls,anyColor=phase==='beauty'&&!!(s.underEye||s.redness||s.lip||s.blush);
      // Allocation SUM is intentionally used as a conservative per-call engine
      // temporary bound: it includes arrays already unreachable but not yet GC'd.
      const temp=phase==='beauty'?k*(16+(resized?4:0)+(anyColor?60:0)+(s.lip?8:0)+(s.smooth?24:0))+1024*(1+(anyColor?1:0))+32:0;
      maxTemporary=Math.max(maxTemporary,temp);totalTemporary+=temp;
      workUnits+=phase==='beauty'?n*3+k*(s.smooth?19:14)+(anyColor?k*28:0):n*3;
    }
    // First face's engine result becomes the accumulator, not another copy.
    const simultaneousImageBytes=outputBytes*(act.length>1?2:1),peakExtraBytes=simultaneousImageBytes+maxTemporary;
    return{pixels:n,workPixels:k,activeFaces:act.length,retainedOutputBytes:outputBytes,maxConcurrentEngineOutputBytes:act.length>1?outputBytes:0,engineTemporaryBytes:maxTemporary,extraPeakBytes:peakExtraBytes,estimatedPeakExtraBytes:peakExtraBytes,cumulativeTypedArrayBytes:outputBytes*Math.max(1,act.length)+totalTemporary,workUnits,estimatedWorkUnits:workUnits,staticEngineTableBytes:17412,excludes:'source, canvas/native/GPU/history copies, JS objects, VM overhead and delayed collection between calls; not a measured real-device peak'};
  }
  function createProcessor(options){
    const o=record(options,['engine'],['detector','limits'],'processor options'),engine=o.engine;
    if(!engine||typeof engine.beauty!=='function'||typeof engine.reshape!=='function')fail('ENGINE','A frozen compatible portrait engine is required.',TypeError);
    const detector=detectorValue(own(o,'detector')?o.detector:DEFAULT_DETECTOR),limits=limitsValue(o.limits);
    function prepareSize(width,height,batch,options,phase){
      const c=contextValue(options,false);cancel(c);const im=dimensions({width,height},'image',limits),b=validateBatch(batch,c);
      if(!sameDetector(b.detector,detector))fail('MODEL_MISMATCH','Portrait batch does not match this processor detector/model/topology.');
      // A mobile policy also limits input detection dimensions, even when the
      // current render is a small preview. Same dimensions are never identity.
      dimensions(b.detectionSize,'detectionSize',limits);
      const size=workSize(im.width,im.height),faces=b.faces.slice().sort((a,b)=>a.id.localeCompare(b.id)).map(f=>{
        const m=clampedMesh(f),isActive=active(f,phase);let support={writeBounds:null,readBounds:null,influenceBounds:null};
        if(isActive){if(m.oval.maxX-m.oval.minX<.03||m.oval.maxY-m.oval.minY<.03)fail('GEOMETRY','Active face '+f.id+' has degenerate clamped mesh geometry.');support=phase==='beauty'?beautySupport(m,f.beauty,im.width,im.height,size):shapeSupport(m,f.reshape,im.width,im.height);}
        return{id:f.id,active:isActive,protectedBounds:protectedRect(m,im.width,im.height),displayBounds:displayBounds(f),controls:f[phase],...support};
      });
      for(const a of faces)if(a.active)for(const b of faces)if(a.id!==b.id){
        if(intersects(a.influenceBounds,b.protectedBounds))fail('FACE_OVERLAP','Influence of '+a.id+' touches protected '+b.id+'; no portrait pixels were produced.');
        if(b.active&&intersects(a.influenceBounds,b.influenceBounds))fail('FACE_OVERLAP','Active influence regions of '+a.id+' and '+b.id+' overlap; no portrait pixels were produced.');
      }
      const estimate=resources(im.width,im.height,size,faces,phase);
      if(estimate.estimatedPeakExtraBytes>limits.maxExtraBytes)fail('MEMORY_BUDGET','Portrait batch exceeds the conservative extra-buffer budget.',RangeError);
      if(estimate.estimatedWorkUnits>limits.maxWorkUnits)fail('WORK_BUDGET','Portrait batch exceeds the work budget.',RangeError);
      cancel(c);
      return{im,b,c,plan:freeze({version:1,phase,sourceRevision:b.sourceRevision,batchId:b.batchId,detector:{...detector},width:im.width,height:im.height,workSize:size,opaqueAlphaRequired:phase==='reshape'&&estimate.activeFaces>0,faces,resources:estimate})};
    }
    function prepare(image,batch,options,phase){
      const im=imageValue(image,limits),p=prepareSize(im.width,im.height,batch,options,phase);p.im=im;
      if(p.plan.opaqueAlphaRequired)for(let i=3;i<im.data.length;i+=4){if((i&65535)===3)cancel(p.c);if(im.data[i]!==255)fail('TRANSPARENT_RESHAPE','Active multi-person reshape requires a fully opaque source.');}
      cancel(p.c);return p;
    }
    function planningOptions(options){const o=contextValue(options,true),c={sourceRevision:o.sourceRevision};for(const k of ['batchId','detector','shouldCancel'])if(own(o,k))c[k]=o[k];return{phase:o.phase,context:c};}
    function plan(image,batch,options){const o=planningOptions(options);return prepare(image,batch,o.context,o.phase).plan;}
    function planSize(width,height,batch,options){const o=planningOptions(options);return prepareSize(width,height,batch,o.context,o.phase).plan;}
    function apply(image,batch,options,phase){
      const p=prepare(image,batch,options,phase),{im,b,c}=p,act=p.plan.faces.filter(f=>f.active);let output=null;
      for(const f of act){
        cancel(c);const face=b.faces.find(v=>v.id===f.id);
        // Never feed accumulated pixels back to the engine. Trusted frozen
        // PortraitEngine does not mutate im, controls, or landmarks.
        let result=engine[phase](im,face[phase],face.landmarks);cancel(c);
        result=imageValue(result,limits);if(result.width!==im.width||result.height!==im.height||typedBuffer.call(result.data)===typedBuffer.call(im.data))fail('ENGINE_OUTPUT','Engine output must be separate, same-size RGBA bytes.');
        for(let y=0;y<im.height;y++){if((y&31)===0)cancel(c);for(let x=0;x<im.width;x++){
          const i=(y*im.width+x)*4,a=im.data,z=result.data;
          if(z[i]===a[i]&&z[i+1]===a[i+1]&&z[i+2]===a[i+2]&&z[i+3]===a[i+3])continue;
          if(!inside(f.writeBounds,x,y))fail('SUPPORT_ESCAPE','Engine changed pixels outside planned support for '+f.id+'.');
          if(z[i+3]!==a[i+3]||(phase==='beauty'&&a[i+3]===0))fail('ALPHA_CHANGED','Engine changed source alpha or transparent hidden RGB.');
          for(const neighbor of p.plan.faces)if(neighbor.id!==f.id&&inside(neighbor.protectedBounds,x,y))fail('PROTECTED_FACE_CHANGED','Engine changed a protected neighboring face.');
          if(output){output.data[i]=z[i];output.data[i+1]=z[i+1];output.data[i+2]=z[i+2];output.data[i+3]=z[i+3];}
        }}
        if(!output)output=result;result=null;cancel(c);
      }
      if(!output)output={width:im.width,height:im.height,data:new Uint8ClampedArray(im.data)};
      cancel(c);return output;
    }
    return Object.freeze({applyBeauty:(image,batch,options)=>apply(image,batch,options,'beauty'),applyReshape:(image,batch,options)=>apply(image,batch,options,'reshape'),plan,planSize,limits:freeze(limits),detector:freeze(detector)});
  }
  return Object.freeze({version:1,DEFAULT_DETECTOR,MAX_LIMITS:MAX,createProcessor,createBatch,validateBatch,defaultsBeauty,defaultsReshape,hasEffect,getFaceBounds});
});
