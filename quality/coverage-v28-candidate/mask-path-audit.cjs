'use strict';
// Read-only production-code probe. Node VM only; not browser/WebView QA.
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const path='app/src/main/assets/portrait-ui.js',source=fs.readFileSync(path,'utf8');
function run(moves){
 const nodes=new Map(),window={},ctx={window,document:{getElementById(id){if(!nodes.has(id))nodes.set(id,{disabled:true});return nodes.get(id);}},Uint8Array,console,setTimeout,clearTimeout,btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary')};
 vm.createContext(ctx);vm.runInContext(source,ctx,{filename:path});window.PortraitUI.init({render(){},toast(){}});
 const d={type:'background',mask:{width:256,height:256,data:Buffer.alloc(256*256).toString('base64')},mode:'transparent',color:'#ffffff',blur:0,feather:0,valid:false,brush:.01};
 const q=window.PortraitUI.start(d,{x:.1,y:.1});
 for(let i=1;i<=moves;i++)window.PortraitUI.move(d,{x:.1+.8*i/moves,y:.1+.8*i/moves},q);
 window.PortraitUI.finish(d,{x:.9,y:.9},q,false);
 const bytes=Buffer.from(d.mask.data,'base64'),diagonal=[];
 for(let x=28;x<=227;x++)diagonal.push(bytes[x*256+x]);
 return {moves,bytes,metrics:{moves,maskWidth:256,maskHeight:256,brushRadiusFraction:.01,interiorDiagonalSamples:diagonal.length,zeroAlphaSamples:diagonal.filter(v=>v===0).length,belowHalfAlphaSamples:diagonal.filter(v=>v<128).length,minAlpha:Math.min(...diagonal),meanAlpha:diagonal.reduce((a,b)=>a+b,0)/diagonal.length}};
}
const sparse=run(1),dense=run(400);let changedPixels=0,maxDifference=0;
for(let i=0;i<sparse.bytes.length;i++){const delta=Math.abs(sparse.bytes[i]-dense.bytes[i]);if(delta)changedPixels++;maxDifference=Math.max(maxDifference,delta);}
const report={auditType:'production PortraitUI start/move/finish executed in controlled Node VM, no browser',productionPath:path,productionSha256:crypto.createHash('sha256').update(source).digest('hex'),sameGeometricPath:{start:[.1,.1],end:[.9,.9]},sparse:sparse.metrics,dense:dense.metrics,comparison:{changedPixels,maxDifference},conclusion:'Current mask painting depends on pointer-event density; sparse long movement can leave holes even on the stroke centerline. This is an alpha-mask correctness/precision gap, not proof about actual device event frequency.'};
fs.writeFileSync('quality/coverage-v28-candidate/mask-path-results.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
