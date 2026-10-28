'use strict';
// Controlled native-Canvas microbenchmark; this is not Android frame latency.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const {performance}=require('perf_hooks'),{createCanvas,loadImage}=require('@napi-rs/canvas');
const current=require('../app/src/main/assets/ai-edit-core.js');
const baseline=require(path.resolve(process.argv[2]));
const photo=process.argv[3],output=process.argv[4];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const pixels=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data;
const destroy=c=>{c.width=c.height=1;};
const stats=a=>({samplesMs:a,medianMs:[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)]});
(async()=>{
 const bytes=fs.readFileSync(photo),im=await loadImage(bytes),factor=Math.min(1,2560/Math.max(im.width,im.height));
 const src=createCanvas(Math.round(im.width*factor),Math.round(im.height*factor));src.getContext('2d').drawImage(im,0,0,src.width,src.height);
 const sourceHash=hash(pixels(src)),rows=[];
 for(const mode of ['erase','outpaint']){
  const opts={mode,left:.1,right:.1,top:.1,bottom:.1,strokes:[{radius:.04,points:[{x:.12,y:.45},{x:.22,y:.52}]}]};
  const prepared=current.prepare(src,opts,createCanvas),generated=createCanvas(prepared.width,prepared.height);
  generated.getContext('2d').fillStyle='#c15683';generated.getContext('2d').fillRect(0,0,generated.width,generated.height);
  const times={before:[],after:[]},hashes={};
  for(let round=0;round<4;round++)for(const name of (round%2?['after','before']:['before','after'])){
   const start=performance.now(),out=(name==='before'?baseline:current).composite(prepared,generated,createCanvas),elapsed=performance.now()-start;
   const sum=hash(pixels(out));if(hashes[name])assert.equal(sum,hashes[name]);hashes[name]=sum;destroy(out);if(round)times[name].push(elapsed);
  }
  assert.equal(hashes.before,hashes.after);rows.push({mode,width:prepared.width,height:prepared.height,before:stats(times.before),after:stats(times.after),outputRgbaSha256:hashes.after,pixelExact:true});
  current.release(prepared);destroy(generated);
 }
 // Isolate the removed PNG roundtrip. Both routes start with the same independent raster copy.
 const open={before:[],after:[]};let encodedBytes=0;
 for(let i=0;i<4;i++)for(const name of (i%2?['after','before']:['before','after'])){
  const start=performance.now(),c=createCanvas(src.width,src.height);c.getContext('2d').drawImage(src,0,0);let result=c;
  if(name==='before'){const png=c.toBuffer('image/png');encodedBytes=png.length;const decoded=await loadImage(png);result=createCanvas(c.width,c.height);result.getContext('2d').drawImage(decoded,0,0);destroy(c);}
  const elapsed=performance.now()-start;assert.equal(hash(pixels(result)),sourceHash);destroy(result);if(i)open[name].push(elapsed);
 }
 assert.equal(hash(pixels(src)),sourceHash);destroy(src);
 const report={runtime:process.version+' Windows native Skia Canvas',scope:'Core composite and isolated AI-open raster-copy/PNG-roundtrip only; no network/model, browser DOM, Android or physical-device latency',photo:{sha256:hash(bytes),original:[im.width,im.height],working:[Math.round(im.width*factor),Math.round(im.height*factor)]},baselineSha256:hash(fs.readFileSync(process.argv[2])),currentSha256:hash(fs.readFileSync('app/src/main/assets/ai-edit-core.js')),composite:rows,openRaster:{before:stats(open.before),after:stats(open.after),removedPngBytes:encodedBytes,pixelExact:true},sourceUnchanged:true};
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
