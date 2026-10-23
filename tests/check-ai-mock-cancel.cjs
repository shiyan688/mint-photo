/* Real TLS fixture regression: abort a partial upload, then complete another request. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const root=path.resolve('.work/mock-server-cancel');fs.mkdirSync(root,{recursive:true});
for(const name of ['server.key','server.pem','ca.pem'])fs.copyFileSync(path.resolve('.work/ai-e2e',name),path.join(root,name));
const child=spawn(process.execPath,[process.argv[2]||'tools/ai-e2e-server.cjs'],{env:{...process.env,MINT_E2E_DIR:root,MINT_E2E_PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
let logs='',errors='';child.stdout.on('data',b=>{logs+=b;});child.stderr.on('data',b=>{errors+=b;});
async function until(check){const end=Date.now()+10000;while(Date.now()<end){if(child.exitCode!==null)throw Error('Mock server exited: '+errors);if(check())return;await new Promise(r=>setTimeout(r,30));}throw Error('Mock server timeout: '+logs+errors);}
function get(options,body){return new Promise((resolve,reject)=>{const req=https.request(options,res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks)}));});req.on('error',reject);req.end(body);});}
(async()=>{try{
 await until(()=>/ready on (\d+)/.test(logs));const port=Number(/ready on (\d+)/.exec(logs)[1]),base={hostname:'127.0.0.1',port,ca:fs.readFileSync(path.join(root,'ca.pem')),rejectUnauthorized:true};
 const aborted=https.request({...base,method:'POST',path:'/slow',headers:{'Content-Type':'multipart/form-data; boundary=aborted-fixture','Content-Length':'100000'}});
 aborted.on('error',()=>{});aborted.write('--aborted-fixture\r\npartial-body',()=>setTimeout(()=>aborted.destroy(),150));
 await until(()=>logs.includes('Mock upload cancelled safely'));
 const health=await get({...base,path:'/health'});assert.equal(health.status,200);
 const boundary='MintFixtureAbortThenRetry',png=fs.readFileSync('app/src/main/assets/demo/astronaut.png'),parts=[];
 for(const [name,value]of [['model','mock-png-v1'],['prompt','Remove a test area']])parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
 for(const name of ['image','mask'])parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n`),png,Buffer.from('\r\n'));
 parts.push(Buffer.from(`--${boundary}--\r\n`));const body=Buffer.concat(parts),result=await get({...base,method:'POST',path:'/v1/images/edits',headers:{Authorization:'Bearer mint-e2e-not-secret','Content-Type':`multipart/form-data; boundary=${boundary}`,'Content-Length':body.length}},body);
 assert.equal(result.status,200);const output=Buffer.from(JSON.parse(result.body).data[0].b64_json,'base64');assert.equal(output.readUInt32BE(16),512);assert.equal(output.readUInt32BE(20),512);assert.equal(child.exitCode,null);
 console.log('PASS mock HTTPS: partial upload cancelled, server survived, next multipart edit returned PNG');
 }finally{child.kill();}})().catch(error=>{console.error(error);process.exitCode=1;});
