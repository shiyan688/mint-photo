'use strict';
// Read-only repro of the frozen core source metadata boundary. No image mutation.
const fs=require('node:fs'),path=require('node:path');
const root=process.env.MINT_ROOT||path.resolve(__dirname,'../..'),dir=path.join(root,'app/src/main/assets');
const C=require(process.env.PEOPLE_CORE||path.join(dir,'portrait-people.js')),E=require(path.join(dir,'portrait-engine.js')),O=require(path.join(dir,'portrait-people-operation.js'));
const batch=C.createBatch({sourceRevision:'buffer-audit',batchId:'buffer-audit',detector:C.DEFAULT_DETECTOR,detectionSize:{width:1,height:1},landmarks:[]});
const p=C.createProcessor({engine:E}),context={sourceRevision:batch.sourceRevision},op={type:'portrait-people',phase:'beauty',batch},results=[];
for(const api of ['shared-core','mobile-wrapper']){
 const apply=data=>api==='shared-core'?p.applyBeauty({width:1,height:1,data},batch,context):O.apply({width:1,height:1,data},op);
 let calls=0;const data=new Uint8ClampedArray(4);Object.defineProperty(data.buffer,'resizable',{get(){calls++;return false;}});
 let accepted=true,error=null;try{apply(data);}catch(e){accepted=false;error=e.message;}
 results.push({api,case:'own resizable getter',expected:'do not invoke backing-buffer shadow getter; native fixed buffer may be accepted',accepted,getterCalls:calls,error,pass:calls===0});
 const shared=new SharedArrayBuffer(4);Object.setPrototypeOf(shared,ArrayBuffer.prototype);Object.defineProperty(shared,'resizable',{value:false});accepted=true;error=null;try{apply(new Uint8ClampedArray(shared));}catch(e){accepted=false;error=e.message;}results.push({api,case:'SharedArrayBuffer with ArrayBuffer.prototype and own resizable:false',nativeSharedByteLength:Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype,'byteLength').get.call(shared),expected:'reject genuinely shared backing storage regardless of prototype',accepted,error,pass:!accepted});
 const intrinsic=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')?.get;
 if(intrinsic){const buffer=new ArrayBuffer(4,{maxByteLength:8});Object.defineProperty(buffer,'resizable',{value:false});accepted=true;error=null;try{apply(new Uint8ClampedArray(buffer));}catch(e){accepted=false;error=e.message;}results.push({api,case:'resizable buffer with own false shadow',nativeResizable:intrinsic.call(buffer),expected:'reject actually resizable backing buffer',accepted,error,pass:!accepted});}
}
const report={createdAt:new Date().toISOString(),runtime:process.version,corePath:process.env.PEOPLE_CORE||path.join(dir,'portrait-people.js'),wrapperPath:path.join(dir,'portrait-people-operation.js'),results};fs.writeFileSync(path.join(__dirname,'buffer-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=results.some(x=>!x.pass)?1:0;
