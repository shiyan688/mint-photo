#!/usr/bin/env node
/* Disposable public-photo transport fixture. NOT an AI model or a user-key proxy. */
'use strict';
const https=require('node:https'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const dir=path.resolve('.work/ai-e2e'),port=9443;fs.mkdirSync(dir,{recursive:true});
function crc(b){let n=0xffffffff;for(const v of b){n^=v;for(let k=0;k<8;k++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;}
function chunk(name,data){const t=Buffer.from(name),b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);t.copy(b,4);data.copy(b,8);b.writeUInt32BE(crc(Buffer.concat([t,data])),b.length-4);return b;}
function png(w,h){const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=6;const pixels=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*(w*4+1)+1+x*4;pixels[i]=230;pixels[i+1]=40+(x%60);pixels[i+2]=170+(y%60);pixels[i+3]=255;}return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);}
function parts(bytes,boundary){const result={};for(const piece of bytes.toString('latin1').split('--'+boundary).slice(1,-1)){const i=piece.indexOf('\r\n\r\n');if(i<0)continue;const name=/name="([^"]+)"/.exec(piece.slice(0,i))?.[1];if(name)result[name]=Buffer.from(piece.slice(i+4,-2),'latin1');}return result;}
let requests=[];
const server=https.createServer({key:fs.readFileSync(path.join(dir,'server.key')),cert:fs.readFileSync(path.join(dir,'server.pem'))},async(req,res)=>{
 if(req.method==='GET'&&req.url==='/health'){res.end('mock-only');return;}
 if(req.method!=='POST'){res.writeHead(405);res.end();return;}
 const chunks=[];let size=0;for await(const b of req){size+=b.length;if(size>20*1024*1024){res.writeHead(413);res.end();return;}chunks.push(b);}
 const b=/boundary=([^;]+)/.exec(req.headers['content-type']||'')?.[1];if(!b){res.writeHead(400);res.end();return;}const p=parts(Buffer.concat(chunks),b),prompt=p.prompt?.toString('utf8')||'',mode=prompt.startsWith('Remove')?'erase':prompt.startsWith('Extend')?'outpaint':'edit';
 const authorized=req.headers.authorization==='Bearer mint-e2e-not-secret'&&p.model?.toString()==='mock-png-v1';if(!authorized||req.url==='/unauthorized'){res.writeHead(401);res.end('{"error":"mock rejected credential"}');return;}
 if(!p.image||!p.mask||!p.image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||!p.mask.subarray(16,24).equals(p.image.subarray(16,24))){res.writeHead(400);res.end();return;}
 const w=p.image.readUInt32BE(16),h=p.image.readUInt32BE(20);if(w*h>8000000){res.writeHead(413);res.end();return;}
 const id=requests.length+1;requests.push({id,mode,width:w,height:h,path:req.url,mask:true,keyRecorded:false});fs.writeFileSync(path.join(dir,'requests.json'),JSON.stringify(requests,null,2));fs.writeFileSync(path.join(dir,`request-${id}-${mode}-mask.png`),p.mask);fs.writeFileSync(path.join(dir,`request-${id}-${mode}-image.png`),p.image);
 let output=png(req.url==='/wrong-ratio'?64:w,req.url==='/wrong-ratio'?128:h);fs.writeFileSync(path.join(dir,`mock-${id}-${mode}.png`),output);if(req.url==='/slow')await new Promise(r=>setTimeout(r,12000));
 if(res.destroyed)return;res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({data:[{b64_json:output.toString('base64')}]}));
});server.listen(port,'0.0.0.0',()=>console.log('Mock-only HTTPS Images Edits fixture ready on '+port));
