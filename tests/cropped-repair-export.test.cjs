'use strict';
// Actual pure pixel code. No browser, model, handset, or source mutation.
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../app/src/main/assets/repair-brush-core.js');
const P=require('../app/src/main/assets/project-core.js');
function image(side){const im={width:side,height:side,data:new Uint8ClampedArray(side*side*4)};for(let y=0;y<side;y++)for(let x=0;x<side;x++)im.data.set([x%256,y%256,(x+y)%256,255],(y*side+x)*4);return im;}
function stroke(end=.8){return {version:1,type:'repair-stroke',mode:'clone',sourceRevision:'crop-1',radius:.08,hardness:.4,strength:1,points:[{x:.2,y:.65},{x:end,y:.65}],source:{x:.2,y:.25},sampleMode:'manual',selection:null};}
function result(side,c){const im=image(side);try{const out=R.apply(im,c,{sourceRevision:'crop-1'});return {side,accepted:true,changed:out.data.some((v,i)=>v!==im.data[i])};}catch(error){return{side,accepted:false,error:error.message};}}
test('cropped preview must not accept a saved repair that both export sizes reject',()=>{const src={blob:new Blob(['synthetic'],{type:'image/png'}),width:2800,height:2800,name:'crop.png',mime:'image/png',origin:'original'},crop={type:'crop',x:.45,y:.45,w:.1,h:.1};const original=P.planExport(src,[crop],'original').output.width,working=P.planExport(src,[crop],'working').output.width;assert.equal(original,280);assert.equal(working,256);const outcomes=[90,working,original].map(n=>result(n,stroke()));assert.equal(new Set(outcomes.map(r=>r.accepted)).size,1,JSON.stringify(outcomes));});
test('short cropped clone remains valid and changes pixels at every replay size',()=>{for(const side of [90,256,280]){const out=result(side,stroke(.25));assert.equal(out.accepted,true,JSON.stringify(out));assert.equal(out.changed,true);}});
