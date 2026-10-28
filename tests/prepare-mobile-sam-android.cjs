'use strict';
// Test-only fixtures. The models and test APK are never published as artifacts.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const dir=path.resolve('.work/mobile-sam-bench-assets');fs.mkdirSync(dir,{recursive:true});
const sources=[
 {name:'encoder.onnx',url:'https://huggingface.co/T8RIN/imagetoolbox-models/resolve/main/mobile_sam/mobile_sam_image_encoder.onnx',bytes:28157093,sha:'580f5fb648ea1062c0aabc26217aed56921985f03f0cbbd852bba81d760cc749'},
 {name:'decoder.onnx',url:'https://huggingface.co/T8RIN/imagetoolbox-models/resolve/main/mobile_sam/sam_mask_decoder_single.onnx',bytes:16501323,sha:'93915fc7c993ab9d59ab8c9ccd3bce37f7509c81ab4150a74abd4d2abbd8570d'},
 {name:'melvin.jpg',url:'https://images-assets.nasa.gov/image/jsc2007e036047/jsc2007e036047~orig.jpg',bytes:1545361,sha:'34471604e6f19bdbc31e8a556caa9d20bab29c417a7817a1c352740458dcf0eb',local:'.work/public-photo-qa/inputs/melvin-original.jpg'}
];
(async()=>{for(const s of sources){let b;const dst=path.join(dir,s.name);if(fs.existsSync(dst))b=fs.readFileSync(dst);else if(s.local&&fs.existsSync(s.local))b=fs.readFileSync(s.local);else{const r=await fetch(s.url,{signal:AbortSignal.timeout(180000)});if(!r.ok)throw Error(`${s.name}: HTTP ${r.status}`);b=Buffer.from(await r.arrayBuffer());}if(b.length!==s.bytes||crypto.createHash('sha256').update(b).digest('hex')!==s.sha)throw Error(`${s.name}: bytes or SHA mismatch`);fs.writeFileSync(dst,b);console.log(`Verified ${s.name}: ${s.sha}`);}})().catch(e=>{console.error(e);process.exitCode=1;});
