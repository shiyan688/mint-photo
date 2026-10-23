'use strict';
// Own synthetic fixture. Actual production project replay + text core, not a UI mockup.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createCanvas,GlobalFonts}=require('@napi-rs/canvas');
const T=require('../../app/src/main/assets/text-overlay.js'),P=require('../../app/src/main/assets/project-core.js');
const root=path.resolve(__dirname,'../..'),outdir=path.join(root,'quality/text-overlay-evidence');fs.mkdirSync(outdir,{recursive:true});
const font=process.env.QA_CJK_FONT||'/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc';
if(!GlobalFonts.registerFromPath(font,'sans-serif')||!GlobalFonts.registerFromPath(font,'QA CJK'))throw Error('Installed Chinese test font unavailable');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function source(w=480,h=360){const c=createCanvas(w,h),x=c.getContext('2d');x.fillStyle='#cad9cb';x.fillRect(0,0,w,h);x.fillStyle='#507568';x.beginPath();x.moveTo(0,h*.765);x.lineTo(w*.375,h*.208);x.lineTo(w,h);x.lineTo(0,h);x.fill();return c;}
function data(c){return c.getContext('2d').getImageData(0,0,c.width,c.height).data;}
const add={type:'text-overlay',action:'add',id:'qa-paragraph',recipe:{...T.defaults(),text:'薄荷 · 暖光\n让日常值得记住',size:.085,rotation:-12,outlineWidth:.04,shadow:true}};
const replace={...add,action:'replace',recipe:{...add.recipe,text:'同一段文字\n改样式仍可撤销',rotation:18,color:'#ffd5a0',size:.08}};
const clear={...replace,recipe:{...replace.recipe,text:''}};
function replay(ops,w=480,h=360){const c=source(w,h);for(const op of P.effectiveOperations(ops))T.render(c.getContext('2d'),w,h,op.recipe);return c;}
const cases=[['原始测试底图',[]],['新增多行文字',[add]],['修改最近段落',[add,replace]]];
const sheet=createCanvas(1230,430),s=sheet.getContext('2d');s.fillStyle='#f5f7f2';s.fillRect(0,0,1230,430);s.fillStyle='#203b31';s.font='bold 21px "QA CJK"';s.fillText('真实文字绘制：多行、旋转、描边、阴影，以及可撤销的段落替换',18,30);
const report={fixture:'Own synthetic opaque raster, no photograph or personal data.',renderer:'Actual MintProjectCore.effectiveOperations and MintTextOverlay in installed native Skia Canvas; not a browser/WebView/screenshot.',width:480,height:360,cases:[]};
for(let i=0;i<cases.length;i++){const [label,ops]=cases[i],c=replay(ops);fs.writeFileSync(path.join(outdir,'case-'+i+'.png'),c.toBuffer('image/png'));s.font='17px "QA CJK"';s.fillText(label,i*410+18,60);s.drawImage(c,i*410+15,76,390,292.5);report.cases.push({label,rawOperations:ops,effectiveOperations:P.effectiveOperations(ops),rgbaSha256:hash(data(c))});}
const undo=replay([add]),cleared=replay([add,replace,clear]);
report.undoRestoresPreviousParagraph=hash(data(undo))===report.cases[1].rgbaSha256;
report.clearReplacementRestoresSource=hash(data(cleared))===report.cases[0].rgbaSha256;
const small=replay([add,replace]),large=replay([add,replace],960,720);
const lines=(c)=>T.layout(c.getContext('2d'),c.width,c.height,replace.recipe).lines.map(l=>l.text);
report.sameAspectSameFontWrapEqual=JSON.stringify(lines(small))===JSON.stringify(lines(large));
if(!report.undoRestoresPreviousParagraph||!report.clearReplacementRestoresSource||!report.sameAspectSameFontWrapEqual)throw Error('Replay invariant failed');
s.font='15px "QA CJK"';s.fillText('自建合成底图；实际生产核心输出，不是手机界面截图。原图与历史保留，修改后不叠画旧字。',18,395);s.font='13px "QA CJK"';s.fillText('字体来自当前云端已安装的 Noto CJK。Android 字体与输入法尚待真机验收，不承诺跨系统逐像素一致。',18,419);
fs.writeFileSync(path.join(outdir,'comparison-zh.png'),sheet.toBuffer('image/png'));fs.writeFileSync(path.join(outdir,'pixel-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cases:report.cases.map(c=>({label:c.label,rgbaSha256:c.rgbaSha256})),undo:report.undoRestoresPreviousParagraph,clear:report.clearReplacementRestoresSource,wrap:report.sameAspectSameFontWrapEqual}));
