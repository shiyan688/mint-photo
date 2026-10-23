'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createCanvas,ImageData,GlobalFonts}=require('@napi-rs/canvas');
const C=require('../../app/src/main/assets/canvas-padding.js');
if(!GlobalFonts.registerFromPath(process.env.QA_CJK_FONT||'/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc','QA CJK'))throw Error('Installed test font unavailable');
const root=path.resolve(__dirname,'../..'),outdir=path.join(root,'quality/canvas-padding-evidence');fs.mkdirSync(outdir,{recursive:true});
const hash=a=>crypto.createHash('sha256').update(a).digest('hex');
const base=createCanvas(480,360),b=base.getContext('2d');b.fillStyle='#cadee2';b.fillRect(0,0,480,360);b.fillStyle='#efd38b';b.beginPath();b.arc(370,75,35,0,2*Math.PI);b.fill();b.fillStyle='#5b8573';b.beginPath();b.moveTo(0,290);b.lineTo(170,95);b.lineTo(480,360);b.lineTo(0,360);b.fill();b.fillStyle='#264d42';b.fillRect(20,325,100,8);b.fillStyle='#d28f6f';b.fillRect(0,0,12,12);b.fillStyle='#7585b5';b.fillRect(468,348,12,12);
const source={width:480,height:360,data:b.getImageData(0,0,480,360).data};
const cases=[['原图 / 零留白',C.defaults()],['均匀白边 5%',{...C.defaults(),top:.05,right:.05,bottom:.05,left:.05}],['底部加宽 15%',{...C.defaults(),top:.06,right:.06,left:.06,bottom:.15}],['透明留白 5%',{...C.defaults(),top:.05,right:.05,bottom:.05,left:.05,opacity:0}]];
const sheet=createCanvas(1640,486),s=sheet.getContext('2d');s.fillStyle='#f5f7f2';s.fillRect(0,0,1640,486);s.fillStyle='#203b31';s.font='bold 23px "QA CJK"';s.fillText('真实画布扩展：原照片区域不缩放，输出尺寸随留白增加',18,32);
const report={fixture:'Own synthetic raster; no personal photo or third-party stock asset.',renderer:'Actual MintCanvasPadding pure RGBA output; native Skia PNG encoding and contact-sheet only, not Android screenshot.',source:{width:480,height:360,rgbaSha256:hash(source.data)},cases:[]};
for(let n=0;n<cases.length;n++){
 const[label,recipe]=cases[n],p=C.plan(480,360,recipe),o=C.apply(source,recipe);let wrong=0;
 for(let y=0;y<360;y++)for(let x=0;x<480;x++)for(let k=0;k<4;k++)if(o.data[((y+p.padding.top)*o.width+x+p.padding.left)*4+k]!==source.data[(y*480+x)*4+k])wrong++;
 if(wrong)throw Error('Source byte preservation failed');
 const c=createCanvas(o.width,o.height);c.getContext('2d').putImageData(new ImageData(o.data,o.width,o.height),0,0);fs.writeFileSync(path.join(outdir,'case-'+n+'.png'),c.toBuffer('image/png'));
 const dx=n*410+15,dy=104,scale=.7;
 for(let y=0;y<Math.ceil(o.height*scale);y+=14)for(let x=0;x<Math.ceil(o.width*scale);x+=14){s.fillStyle=((x/14+y/14)%2)?'#dce2de':'#ffffff';s.fillRect(dx+x,dy+y,Math.min(14,o.width*scale-x),Math.min(14,o.height*scale-y));}
 s.drawImage(c,dx,dy,o.width*scale,o.height*scale);s.fillStyle='#203b31';s.font='18px "QA CJK"';s.fillText(label,dx,65);s.font='15px "QA CJK"';s.fillText('输出 '+o.width+' × '+o.height+' 像素',dx,88);
 report.cases.push({label,recipe,plan:p,rgbaSha256:hash(o.data),sourceRegionMismatchedBytes:wrong,png:'case-'+n+'.png'});
}
s.font='17px "QA CJK"';s.fillStyle='#203b31';s.fillText('自建合成底图，所有面板用相同展示比例；核心没有缩放照片。透明区域以棋盘格示意。',18,445);s.font='15px "QA CJK"';s.fillText('真实像素验证图，不是手机界面截图。PNG 保留透明；JPEG 会合成白底。尚待 Android WebView 与手机内存/触控验收。',18,472);
fs.writeFileSync(path.join(outdir,'comparison-zh.png'),sheet.toBuffer('image/png'));fs.writeFileSync(path.join(outdir,'pixel-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
