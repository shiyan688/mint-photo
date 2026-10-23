'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fixtures=process.argv[2];assert(fixtures,'Pass public NASA fixture directory');
const enginePath=path.resolve(__dirname,'../app/src/main/assets/portrait-engine.js'),engine=require(enginePath),source=fs.readFileSync(path.resolve(__dirname,'../app/src/main/assets/portrait-ui.js'),'utf8');
const start=source.indexOf(' function apply(c,d)'),end=source.indexOf(' function brushMask(',start);assert(start>=0&&end>start);
const context={window:{PortraitEngine:engine},TYPES:new Set(['beauty']),Uint8ClampedArray};vm.createContext(context);vm.runInContext(source.slice(start,end),context);
const results=[];
for(const id of ['victor','suni','eileen']){
 const meta=JSON.parse(fs.readFileSync(path.join(fixtures,id+'.json'))),landmarks=JSON.parse(fs.readFileSync(path.join(fixtures,id+'.landmarks.json'))).faces[0];
 const input={width:meta.width,height:meta.height,data:new Uint8ClampedArray(fs.readFileSync(path.join(fixtures,id+'.rgba')))};
 for(const values of [{brighten:0},...[25,50,100].map(brighten=>({brighten})),...[25,50,100].map(smooth=>({smooth})),...[25,50,100].map(v=>({brighten:v,smooth:v}))]){
  let actual;const canvas={width:input.width,height:input.height,getContext:()=>({getImageData:()=>({...input,data:input.data.slice()}),createImageData:(width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)}),putImageData:x=>actual=x})};
  context.apply(canvas,{type:'beauty',values,landmarks});const direct=engine.beauty(input,values,landmarks);assert.deepEqual(actual.data,direct.data);assert.equal(actual.data.length,input.data.length);for(let i=3;i<input.data.length;i+=4)assert.equal(actual.data[i],input.data[i]);
  if(values.brighten===0)assert.deepEqual(actual.data,input.data);
  results.push({fixture:id,values,byteExactToReviewedCore:true,alphaUnchanged:true,outputSha256:crypto.createHash('sha256').update(actual.data).digest('hex')});
  if(values.brighten===100)fs.writeFileSync(path.join(__dirname,id+(values.smooth?'_combined100':'_bright100')+'.rgba'),actual.data);
 }
}
fs.writeFileSync(path.join(__dirname,'mobile-real-adapter-results.json'),JSON.stringify({checks:results.length,coreSha256:crypto.createHash('sha256').update(fs.readFileSync(enginePath)).digest('hex'),limits:'Actual production apply function in Node VM with pixel Canvas adapter. Public actual MediaPipe landmark arrays. Not an Android, WebView, face-inference or SOTA quality validation.',results},null,2));console.log('PASS',results.length,'actual mobile source / public-photo variants; not Android runtime');
