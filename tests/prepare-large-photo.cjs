#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const source=require('./fixtures/large-photo-source.json');
const dir=path.resolve('.work/ai-e2e-large-inputs');
(async()=>{
 fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,'mint-e2e-large-source.jpg');
 let data=fs.existsSync(file)?fs.readFileSync(file):null;
 if(!data){const response=await fetch(source.url,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error(`NASA download failed: ${response.status}`);data=Buffer.from(await response.arrayBuffer());}
 const hash=crypto.createHash('sha256').update(data).digest('hex');
 if(hash!==source.sha256||data.length!==source.bytes)throw Error('NASA original does not match pinned bytes/hash; do not silently replace the fixture.');
 fs.writeFileSync(file,data);
 const oversized=path.join(dir,'mint-e2e-large-over40mib.jpg'),fd=fs.openSync(oversized,'w');
 try{fs.writeSync(fd,data);fs.ftruncateSync(fd,40*1024*1024+1);}finally{fs.closeSync(fd);}
 fs.writeFileSync(path.join(dir,'source.json'),JSON.stringify({...source,downloadedSha256:hash,oversizeBytes:fs.statSync(oversized).size},null,2)+'\n');
 console.log(`Prepared pinned NASA original ${source.width}x${source.height}, ${source.pixels} pixels. Oversize JPEG is a synthetic byte-limit fixture. Mock service is NOT real AI.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
