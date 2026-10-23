'use strict';
// Public deliverable: deterministic synthetic diagram, actual editor operations
// and Native Canvas PNG. No photo, browser-layout, or Android acceptance claim.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),{integrated}=require('../paint-layer-evidence/editor-harness.cjs'),N=require('../text-overlay-independent/native-canvas.cjs'),P=require('../../app/src/main/assets/project-core.js');
const plain=x=>JSON.parse(JSON.stringify(x)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function set(h,id,v){const n=h.node('px-'+id);n.value=String(v);assert.notEqual(n.onchange({target:n}),false,id);h.paint();}
function save(name,c){fs.writeFileSync(path.join(__dirname,name),c.toBuffer('image/png'));}
function text(ctx,v,x,y,size=22,color='#40584f'){ctx.fillStyle=color;ctx.font=`${size}px "Noto Sans CJK SC",sans-serif`;ctx.fillText(v,x,y);}
function fit(ctx,c,x,y,w,h){const f=Math.min(w/c.width,h/c.height);ctx.drawImage(c,x+(w-c.width*f)/2,y+(h-c.height*f)/2,c.width*f,c.height*f);}
(async()=>{
 const input=fs.readFileSync(path.join(root,'quality/perspective-independent/synthetic-perspective-input.png')),im=await N.decode(input),h=await integrated({nativeFactory:N.canvas,navigation:true,width:im.width,height:im.height,file:{bytes:input,image:im}}),before=N.hash(h.state.committed);
 h.setTool('perspective');h.paint();const quad=[{x:.17,y:.10},{x:.88,y:.18},{x:.96,y:.88},{x:.06,y:.95}];
 for(let i=0;i<4;i++)for(const axis of['x','y'])set(h,i+'-'+axis,quad[i][axis]*100);set(h,'width',320);set(h,'height',220);
 const sourceView=N.canvas(h.node('previewCanvas').width,h.node('previewCanvas').height);sourceView.getContext('2d').drawImage(h.node('previewCanvas'),0,0);sourceView.getContext('2d').drawImage(h.node('overlayCanvas'),0,0);save('source-corner-controls.png',sourceView);
 h.click('px-preview');h.paint();const preview=N.copy(h.node('previewCanvas'));save('corrected-preview.png',preview);assert(h.click('applyBtn'));
 const history=plain(h.state.ops),accepted=N.hash(h.state.committed);h.env.__probe.setFormat('image/png');h.env.__probe.setExportMode('original');await h.save();const outputBytes=h.encodes.at(-1).bytes,decoded=await N.decode(outputBytes),output=N.canvas(decoded.width,decoded.height);output.getContext('2d').drawImage(decoded,0,0);fs.writeFileSync(path.join(__dirname,'actual-editor-export.png'),outputBytes);
 assert.deepEqual([output.width,output.height],[320,220]);assert.equal(N.hash(output),N.hash(h.render(history)));assert.equal(N.hash(output),N.hash(preview));h.click('undoBtn');assert.equal(N.hash(h.state.committed),before);h.click('redoBtn');assert.equal(N.hash(h.state.committed),accepted);const restored=P.restoreProject(P.draftRecord(P.makeProject(h.state.sourceAsset,history)));assert.equal(N.hash(h.render(plain(restored.ops))),accepted);assert.deepEqual(Buffer.from(await h.originalBlob.arrayBuffer()),input);
 const sheet=N.canvas(1240,1020),ctx=sheet.getContext('2d');ctx.fillStyle='#f1f6f3';ctx.fillRect(0,0,sheet.width,sheet.height);text(ctx,'四角透视 · 可撤销的真实像素验证',42,60,34,'#173e30');text(ctx,'合成棋盘与文字样例，不是实际摄影、手机截图或 AI 重建',42,101,21);text(ctx,'源画面选角 420 × 320',42,159,25,'#173e30');text(ctx,'实际编辑器导出 PNG 320 × 220',650,159,25,'#173e30');ctx.fillStyle='#ffffff';ctx.fillRect(32,178,580,475);ctx.fillRect(628,178,580,475);fit(ctx,sourceView,45,190,554,445);fit(ctx,output,640,190,554,445);
 text(ctx,'左图是实际源坐标辅助线；右图不含辅助网格或角点标签。',42,701,23);
 text(ctx,'✓ 原 PNG 文件保留，撤销 / 重做 / 草稿重放像素一致',42,747,24,'#146348');
 text(ctx,'✓ 导出解码与完整编辑器重放逐字节一致，输出尺寸未被预览改写',42,792,23,'#146348');
 text(ctx,'四角之外将裁去；输出比例由用户指定，不推断真实物体尺寸。',42,851,22);
 text(ctx,'常规几何重采样，不增加原图细节；大幅压缩或强透视仍可能模糊。',42,892,22);
 text(ctx,'验证范围：云端真实 Native Canvas 栅格与 PNG 编码，不是 Android / WebView。',42,945,20);
 save('comparison-zh.png',sheet);
 const report={scope:'synthetic planar fixture, actual production editor+NativeCanvas; not Android/WebView',recipe:history[0],source:{width:im.width,height:im.height,pngSha256:sha(input),rgbaSha256:before,unchanged:true},output:{width:output.width,height:output.height,pngSha256:sha(outputBytes),rgbaSha256:N.hash(output)},previewMatchesOriginalPng:true,undoRedoExact:true,draftReplayExact:true,originalBlobUnchanged:true,coreSha256:sha(fs.readFileSync(path.join(root,'app/src/main/assets/perspective.js')))};fs.writeFileSync(path.join(__dirname,'editor-metrics.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
