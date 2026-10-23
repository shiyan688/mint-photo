'use strict';
// Non-public QA only. Pass the verified public NASA fixture metadata path.
// Renders actual production local-tone outputs; no generative image processing.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const {createCanvas,ImageData,GlobalFonts}=require('@napi-rs/canvas');
if(!GlobalFonts.registerFromPath(process.env.QA_CJK_FONT||'/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc','QA CJK'))throw Error('Chinese QA font unavailable');
const O=require('../../app/src/main/assets/local-tone-operation.js');
const M=require('../../app/src/main/assets/manual-tools.js');
const root=path.resolve(__dirname,'../..'),file=process.argv[2];
if(!file)throw Error('Provide the verified 05_mukai.json fixture path');
const meta=JSON.parse(fs.readFileSync(file,'utf8')),width=meta.width,height=meta.height;
const data=new Uint8ClampedArray(zlib.gunzipSync(fs.readFileSync(file.replace(/\.json$/,'.rgba.gz'))));
const source={width,height,data},hash=x=>crypto.createHash('sha256').update(x).digest('hex');
if(hash(data)!=='fb04f53789a6c982dea47d47b745c82346e61776fe9affb55b67c6a08021fb6b')throw Error('Fixture hash mismatch');
const revision='qa-public-stage-1',sel={version:1,sourceRevision:revision,base:'none',inverted:false,feather:.025,commands:[{kind:'brush',mode:'add',radius:.11,points:[{x:.28,y:.79},{x:.56,y:.80},{x:.7,y:.85}]}]};
const base={id:'qa-layer',name:'公开照片局部调色演示',sourceRevision:revision,enabled:true,opacity:1,adjustments:{exposure:0,contrast:0,saturation:0,temperature:0}};
const cases=[['原始测试图',null],['径向：曝光 +8 / 对比 +5',{...base,mask:{kind:'radial',cx:.45,cy:.44,rx:.29,ry:.36,feather:.95},adjustments:{...base.adjustments,exposure:8,contrast:5}}],['渐变：饱和 -30 / 色温 -6',{...base,mask:{kind:'linear',x0:.2,y0:.18,x1:.7,y1:.7,reverse:false},adjustments:{...base.adjustments,saturation:-30,temperature:-6}}],['手绘选区：饱和 +30 / 色温 -10',{...base,mask:{kind:'selection',selection:sel},adjustments:{...base.adjustments,saturation:30,temperature:-10}}]];
const outdir=path.join(root,'quality/local-tone-evidence');fs.mkdirSync(outdir,{recursive:true});
const sheet=createCanvas(1600,542),ctx=sheet.getContext('2d');ctx.fillStyle='#f5f7f2';ctx.fillRect(0,0,1600,542);ctx.fillStyle='#203b31';ctx.font='bold 19px "QA CJK"';ctx.fillText('实际局部调色像素输出：手动指定范围，不是自动人像识别或 SOTA 模型',16,26);
const report={fixture:{name:'NASA S97-00568 / Chiaki Mukai',width,height,sha256:hash(data),rights:'Non-public informational QA; no endorsement, marketing or training permission. https://www.nasa.gov/nasa-brand-center/images-and-media/'},renderer:'Production MintLocalToneOperation + unchanged MintLocalAdjustments. Native Skia contact-sheet layout, not Android WebView.',cases:[]};
for(let i=0;i<cases.length;i++){
 const [label,layer]=cases[i],op=layer?{type:'local-tone',sourceRevision:revision,layers:[layer]}:null,out=op?O.apply(source,op,{sourceRevision:revision}):source;
 let changed=0,alphaChanged=0,outsideChanged=0;const weights=layer?.mask.kind==='selection'?M.rasterizeSelection(width,height,sel,{sourceRevision:revision}):null;
 for(let j=0;j<width*height;j++){const p=j*4;if(out.data[p+3]!==data[p+3])alphaChanged++;if(out.data[p]!==data[p]||out.data[p+1]!==data[p+1]||out.data[p+2]!==data[p+2]){changed++;if(weights&&weights[j]===0)outsideChanged++;}}
 if(alphaChanged||outsideChanged)throw Error('Alpha or selection scope violation');
 const c=createCanvas(width,height);c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(out.data),width,height),0,0);const name='case-'+i+'.png';fs.writeFileSync(path.join(outdir,name),c.toBuffer('image/png'));
 ctx.font='15px "QA CJK"';ctx.fillText(label,i*400+10,54);ctx.drawImage(c,i*400+10,68,380,380*height/width);
 report.cases.push({label,operation:op,rgbaSha256:hash(out.data),changedPixels:changed,alphaChanged,outsideSelectedAreaChanged:weights?outsideChanged:null});
}
ctx.font='13px "QA CJK"';ctx.fillText('NASA 公开照片的 897 × 1000 派生测试图。颜色/构图不自动评优；仅作私有功能验证。尚未真机验收。',16,525);
fs.writeFileSync(path.join(outdir,'comparison-zh.png'),sheet.toBuffer('image/png'));fs.writeFileSync(path.join(outdir,'pixel-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
