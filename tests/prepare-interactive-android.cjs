'use strict';
// Disposable research fixture: verify exact bytes. Never distribute this test APK/model.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const dir=path.resolve('.work/interactive-test-assets');fs.mkdirSync(dir,{recursive:true});
const sources=[
 {name:'interactive-research.task',url:'https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/1/interactive_segmentation.task',bytes:30525312,sha:'38431bc66b883404e8397f74c3579404315b9b52b04a46c6346fe906a7309b03',local:'.work/magic-touch-v2.task'},
 {name:'interactive-melvin.jpg',url:'https://images-assets.nasa.gov/image/jsc2007e036047/jsc2007e036047~orig.jpg',bytes:1545361,sha:'34471604e6f19bdbc31e8a556caa9d20bab29c417a7817a1c352740458dcf0eb',local:'.work/public-photo-qa/inputs/melvin-original.jpg'},
 {name:'astronaut.png',bytes:791555,sha:'88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5',local:'app/src/main/assets/demo/astronaut.png'}
];
async function main(){for(const s of sources){const p=path.join(dir,s.name);let data;if(fs.existsSync(p))data=fs.readFileSync(p);else if(fs.existsSync(s.local))data=fs.readFileSync(s.local);else{if(!s.url)throw Error(`${s.name}: local fixture missing`);const r=await fetch(s.url,{signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error(`${s.name}: HTTP ${r.status}`);data=Buffer.from(await r.arrayBuffer());}if(data.length!==s.bytes||crypto.createHash('sha256').update(data).digest('hex')!==s.sha)throw Error(`${s.name}: bytes/SHA mismatch`);fs.writeFileSync(p,data);console.log(`Verified research input ${s.name}: ${s.bytes} bytes, ${s.sha}`);}}
main().catch(e=>{console.error(e);process.exitCode=1;});
