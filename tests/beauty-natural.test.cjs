'use strict';
// Quantitative regressions for the reported pale face polygon. These deliberately
// use smooth synthetic fields to expose mask/tonal errors, not claim photo quality.
const test=require('node:test');
const assert=require('node:assert/strict');
const engine=require(process.env.MINT_ENGINE_UNDER_TEST||'../app/src/main/assets/portrait-engine.js');
const OVAL=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
function mesh(cx=.5,scale=1){
  const p=Array.from({length:478},()=>({x:cx,y:.5}));
  OVAL.forEach((id,i)=>{const a=i*2*Math.PI/OVAL.length;p[id]={x:cx+.29*scale*Math.sin(a),y:.5-.4*scale*Math.cos(a)};});
  const ellipse=(ids,x,y,rx,ry)=>ids.forEach((id,i)=>{const a=i*2*Math.PI/ids.length;p[id]={x:cx+(x-.5+rx*Math.cos(a))*scale,y:.5+(y-.5+ry*Math.sin(a))*scale};});
  ellipse([33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246],.39,.405,.065,.025);
  ellipse([263,249,390,373,374,380,381,382,362,398,384,385,386,387,388,466],.61,.405,.065,.025);
  ellipse([61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185],.5,.65,.11,.035);
  ellipse([70,63,105,66,107,55,65,52,53,46],.39,.34,.075,.015);
  ellipse([336,296,334,293,300,276,283,282,295,285],.61,.34,.075,.015);
  return p;
}
function image(w=384,h=480,fn=()=>[160,112,84,255]){
  const data=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)data.set(fn(x,y),4*(y*w+x));
  return {width:w,height:h,data};
}
function at(im,x=.4,y=.54){return Array.from(im.data.subarray(4*(Math.round(y*(im.height-1))*im.width+Math.round(x*(im.width-1))),4*(Math.round(y*(im.height-1))*im.width+Math.round(x*(im.width-1)))+4));}
const linear=c=>(c/=255)<=.04045?c/12.92:((c+.055)/1.055)**2.4;
const luminance=rgb=>.2126*linear(rgb[0])+.7152*linear(rgb[1])+.0722*linear(rgb[2]);
const chromaticity=rgb=>{const l=rgb.slice(0,3).map(linear),sum=l.reduce((a,b)=>a+b,0);return l.map(v=>v/sum);};
function sameBytes(actual,expected){
  assert.equal(actual.length,expected.length);
  for(let i=0;i<actual.length;i++)if(actual[i]!==expected[i])assert.fail(`byte ${i}: ${actual[i]} !== ${expected[i]}`);
}
const face=mesh();

test('max brightness has no contour or feature-hole gradient cliffs on uniform skin',()=>{
  const source=image(),output=engine.beauty(source,{brighten:100},face);
  let largestStep=0,changed=0;
  for(let y=1;y<source.height;y++)for(let x=1;x<source.width;x++){
    const i=4*(y*source.width+x),delta=output.data[i]-source.data[i];
    if(delta)changed++;
    largestStep=Math.max(largestStep,Math.abs(delta-(output.data[i-4]-source.data[i-4])),Math.abs(delta-(output.data[i-source.width*4]-source.data[i-source.width*4])));
  }
  assert(changed>12000,'the repair must still visibly work on skin');
  assert(largestStep<=3,`adjacent brightness jump is ${largestStep}, visible mask outline`);
  // Exclusions remain protected at their centers, but are softly approached.
  for(const [x,y]of[[.39,.34],[.61,.34],[.39,.405],[.61,.405],[.5,.65]])assert.deepEqual(at(output,x,y),at(source,x,y));
});

test('brightness retains linear-light chromaticity across diverse skin tones',()=>{
  for(const rgb of [[67,42,30],[104,68,49],[145,97,67],[175,139,91],[188,141,113],[221,173,163],[235,211,191]]){
    const source=image(192,240,()=>[...rgb,255]),output=engine.beauty(source,{brighten:100},face),result=at(output);
    const before=chromaticity(rgb),after=chromaticity(result);
    const drift=Math.max(...before.map((v,i)=>Math.abs(v-after[i])));
    assert(drift<.012,`${rgb} → ${result.slice(0,3)} chromaticity drift ${drift}`);
    assert(result[0]>rgb[0],`no useful lift for ${rgb}`);
    assert(result[0]-rgb[0]<=24,`unbounded lift for ${rgb}`);
    assert(result.slice(0,3).every(v=>v<255),'skin must not clip');
  }
});

test('all slider positions progressively lift skin without a final white-screen surge',()=>{
  for(const rgb of [[67,42,30],[160,112,84],[228,205,188]]){
    const source=image(192,240,()=>[...rgb,255]);
    const values=[0,10,25,50,75,100].map(brighten=>at(engine.beauty(source,{brighten},face))[0]);
    for(let i=1;i<values.length;i++)assert(values[i]>=values[i-1],`${rgb}: ${values}`);
    assert(new Set(values).size>=5,`poor usable slider resolution: ${values}`);
    assert(values.at(-1)-values[0]<=24,`maximum is not a usable portrait setting: ${values}`);
  }
});

test('shadow anchors and specular highlights stay bounded at max brightness',()=>{
  for(const rgb of [[0,0,0],[8,6,4],[12,9,7],[249,244,238],[255,255,255]]){
    const source=image(101,101,()=>[...rgb,255]),output=engine.beauty(source,{brighten:100,region:{x:.5,y:.5,r:.5}}),result=at(output,.5,.5);
    for(let c=0;c<3;c++)assert(Math.abs(result[c]-rgb[c])<=2,`${rgb} → ${result.slice(0,3)} loses shadow/highlight detail`);
  }
});

test('face-contained hair, green/blue fabric, and neutral occluders are not bleached',()=>{
  const patches=[[18,16,14],[30,25,23],[65,105,70],[55,75,125],[90,93,94]];
  for(const rgb of patches){
    const source=image(192,240,(x,y)=>x>60&&x<92&&y>115&&y<144?[...rgb,255]:[188,141,113,255]);
    const output=engine.beauty(source,{brighten:100,smooth:100,warmth:100},face);
    const before=at(source,.4,.54),after=at(output,.4,.54);
    for(let c=0;c<3;c++)assert(Math.abs(before[c]-after[c])<=1,`${rgb} was altered to ${after.slice(0,3)}`);
  }
});

test('warmth changes color without a brightness jump or colored blacks',()=>{
  const source=image(101,101,()=>[170,120,90,255]);
  for(const warmth of [-100,-50,50,100]){
    const output=engine.beauty(source,{warmth,region:{x:.5,y:.5,r:.5}}),result=at(output,.5,.5);
    assert(Math.abs(luminance(result)-luminance([170,120,90]))<.003,`warmth ${warmth} changes exposure`);
    assert.equal(Math.sign(result[0]-170),Math.sign(warmth));
  }
  const black=image(101,101,()=>[0,0,0,71]);
  sameBytes(engine.beauty(black,{warmth:100,region:{x:.5,y:.5,r:.5}}).data,black.data);
});

test('face-mask union applies once and is invariant to duplicate faces and order',()=>{
  const source=image(),second=mesh(.56,.75),settings={smooth:70,brighten:100,warmth:40};
  sameBytes(engine.beauty(source,settings,[face,face]).data,engine.beauty(source,settings,face).data);
  sameBytes(engine.beauty(source,settings,[face,second]).data,engine.beauty(source,settings,[second,face,second]).data);
  assert(engine.beauty(source,settings,[face]).data.some((v,i)=>v!==source.data[i]));
});

test('explicit region stays opt-in on cool colors; no face or region stays an exact no-op',()=>{
  const source=image(81,61,()=>[60,100,140,127]);
  sameBytes(engine.beauty(source,{brighten:100,smooth:100,warmth:100}).data,source.data);
  assert(at(engine.beauty(source,{brighten:100,region:{x:.5,y:.5,r:.5}}),.5,.5)[2]>140);
});

test('zero, alpha bytes, transparent RGB, and source data are preserved with all controls',()=>{
  const source=image(192,240,(x,y)=>[160+(x%7),115,88,(x*17+y*19)%256]),snapshot=source.data.slice();
  sameBytes(engine.beauty(source,{smooth:0,brighten:0,warmth:0},face).data,source.data);
  for(const settings of [{brighten:100},{smooth:100},{warmth:-100},{smooth:100,brighten:100,warmth:100}]){
    const result=engine.beauty(source,settings,face);
    assert.notEqual(result.data,source.data);
    for(let i=0;i<source.data.length;i+=4){
      assert.equal(result.data[i+3],source.data[i+3]);
      if(!source.data[i+3])assert.deepEqual(result.data.subarray(i,i+4),source.data.subarray(i,i+4));
    }
  }
  sameBytes(source.data,snapshot);
});

test('export-size masks cannot bleach a one-pixel blue or black occluder',()=>{
  const w=1301,h=1511,strand=Math.round(.4*(w-1));
  const source=image(w,h,(x,y)=>x===strand&&y>h*.48&&y<h*.58?(y%2?[0,0,0,197]:[15,45,95,197]):[160,112,84,197]);
  const output=engine.beauty(source,{smooth:100,brighten:100,warmth:100},face);
  for(let y=Math.ceil(h*.48);y<Math.floor(h*.58);y++){
    const i=4*(y*w+strand);
    assert.deepEqual(output.data.subarray(i,i+4),source.data.subarray(i,i+4));
  }
});
