'use strict';
// Host CPU benchmark with pinned public-photo inference. No device or quality claim.
// Usage: node --expose-gc tools/benchmark-portrait-detail.cjs <inference-dir> <output.json> <baseline-dir> [--baseline-only]
// Optional MINT_BENCH_EDGES=900,2560,4096 / MINT_BENCH_PHOTOS=collins / MINT_BENCH_REPEATS=3.
// MINT_BENCH_ORIGINALS_DIR uses <id>-original.jpg when available, without upscaling it.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks'),{createCanvas,loadImage}=require('@napi-rs/canvas');
const root=path.resolve(__dirname,'..'),input=path.resolve(process.argv[2]||path.join(root,'.work/public-photo-qa/inference'));
const output=path.resolve(process.argv[3]||path.join(root,'.work/portrait-performance-20261028/report.json'));
const baselineDir=path.resolve(process.argv[4]||path.join(root,'.work/portrait-performance-20261028/baseline'));
const baselineOnly=process.argv.includes('--baseline-only'),moduleNames=['portrait-detail-engine.js','edge-refine.js'];
const original=moduleNames.map(n=>require(path.join(baselineDir,n))),current=moduleNames.map(n=>require(path.join(root,'app/src/main/assets',n)));
const M=require('../app/src/main/assets/mask-refine.js');
const bytes=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength),hash=a=>crypto.createHash('sha256').update(a).digest('hex');
const repeats=Number(process.env.MINT_BENCH_REPEATS||3),edges=(process.env.MINT_BENCH_EDGES||'900,2560,4096').split(',').map(Number);
const ids=(process.env.MINT_BENCH_PHOTOS||'chawla,collins,jemison,melvin').split(',');
assert(Number.isInteger(repeats)&&repeats>=1&&repeats<=20);assert(edges.every(n=>Number.isInteger(n)&&n>0&&n<=4096));
function summary(samples){const s=[...samples].sort((a,b)=>a-b);return{samplesMs:samples,medianMs:s[Math.floor(s.length/2)],minMs:s[0],maxMs:s.at(-1)};}
async function main(){
  const report={date:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,baselineOnly,repeats,
    scope:'Pinned public-photo host inference, resized stress inputs; wall time of pure algorithm only, excluding decode/resize/mask rasterization/hash/PNG. Not physical Android, fresh inference, image-quality improvement or additional real image detail.',
    baselineSha256:Object.fromEntries(moduleNames.map(n=>[n,hash(fs.readFileSync(path.join(baselineDir,n)))])),
    currentSha256:Object.fromEntries(moduleNames.map(n=>[n,hash(fs.readFileSync(path.join(root,'app/src/main/assets',n)))])),cases:[]};
  for(const id of ids){
    const originalPath=process.env.MINT_BENCH_ORIGINALS_DIR?path.resolve(process.env.MINT_BENCH_ORIGINALS_DIR,id+'-original.jpg'):null;
    const hasOriginal=originalPath&&fs.existsSync(originalPath),sourcePath=hasOriginal?originalPath:path.join(input,id+'.png');
    const metaBytes=fs.readFileSync(path.join(input,id+'.json')),meta=JSON.parse(metaBytes),encoded=fs.readFileSync(sourcePath),img=await loadImage(encoded);
    for(const edge of edges){
      const scale=Math.min(hasOriginal?1:Infinity,edge/Math.max(img.width,img.height),Math.sqrt(8000000/(img.width*img.height)));
      const width=Math.max(1,Math.floor(img.width*scale)),height=Math.max(1,Math.floor(img.height*scale));
      const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,width,height);
      const im={width,height,data:ctx.getImageData(0,0,width,height).data},sourceHash=hash(bytes(im.data));
      const mask=M.rasterize({width,height},M.defaults('performance-'+id,meta.mask)),maskHash=hash(bytes(mask.data));
      const settings={smooth:65,brighten:0,warmth:0},landmarks=meta.faces[0]||null;
      for(const [index,name] of ['detail-v2','guided-alpha'].entries()){
        const invoke=engine=>index===0?engine.beauty(im,settings,landmarks):engine.refine(im,mask);
        // Warm both module instances before timed samples. Alternate measurement order.
        invoke(original[index]);if(!baselineOnly)invoke(current[index]);
        const reference=invoke(original[index]),expected=bytes(reference.data),expectedHash=hash(expected);
        const timings={baseline:[],current:[]};let exact=true;
        for(let round=0;round<repeats;round++){
          const order=baselineOnly?['baseline']:round%2?['current','baseline']:['baseline','current'];
          for(const variant of order){
            if(global.gc)global.gc();
            const start=performance.now(),result=invoke(variant==='baseline'?original[index]:current[index]);
            timings[variant].push(performance.now()-start);
            if(!bytes(result.data).equals(expected))exact=false;
          }
        }
        assert(exact,`${id} ${width}x${height} ${name}: output bytes changed`);
        assert.equal(hash(bytes(im.data)),sourceHash,'source changed');assert.equal(hash(bytes(mask.data)),maskHash,'mask changed');
        const baseline=summary(timings.baseline),updated=baselineOnly?null:summary(timings.current);
        const row={id,algorithm:name,dimensions:[width,height],pixels:width*height,upscaled:scale>1,faceCount:meta.faces.length,
          sourceSize:meta.sourceSize,decodedSourceSize:[img.width,img.height],inferenceRuntime:meta.runtime,newInference:false,
          inputFile:path.relative(root,sourcePath).replace(/\\/g,'/'),inferenceSha256:hash(metaBytes),inputEncodedSha256:hash(encoded),outputSha256:expectedHash,outputBytesExact:exact,sourceUnchanged:true,maskUnchanged:true,
          settings:index===0?settings:null,baseline,current:updated,speedup:updated?baseline.medianMs/updated.medianMs:null};
        report.cases.push(row);console.log(JSON.stringify({id,name,size:row.dimensions,baselineMs:baseline.medianMs,currentMs:updated?.medianMs,speedup:row.speedup,exact}));
      }
      canvas.width=canvas.height=1;
    }
  }
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
