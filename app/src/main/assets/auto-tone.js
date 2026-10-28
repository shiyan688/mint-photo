/* Bounded histogram-driven exposure. Not learned enhancement or illuminant inference. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MintAutoTone=api;})(typeof globalThis==='undefined'?this:globalThis,function(){
'use strict';
function analyze(image){
 if(!image||!Number.isSafeInteger(image.width)||!Number.isSafeInteger(image.height)||image.width<1||image.height<1||image.width*image.height>8000000||!(image.data instanceof Uint8ClampedArray||image.data instanceof Uint8Array)||image.data.length!==image.width*image.height*4)throw TypeError('自动光线需要有效且不超过800万像素的RGBA图片');
 const histogram=new Float64Array(256);let total=0,peak=0;
 for(let i=0;i<image.data.length;i+=4){const weight=image.data[i+3]/255;if(!weight)continue;peak=Math.max(peak,image.data[i],image.data[i+1],image.data[i+2]);const y=Math.round(.2126*image.data[i]+.7152*image.data[i+1]+.0722*image.data[i+2]);histogram[y]+=weight;total+=weight;}
 const quantile=q=>{let sum=0;for(let i=0;i<256;i++){sum+=histogram[i];if(sum>=total*q)return i;}return 255;};
 const recipe={version:1,shadows:0,highlights:0,whiteBalance:{r:1,g:1,b:1}};
 if(!total)return{recipe,median:0,low:0,high:0,reason:'透明图片不做自动光线'};
 const low=quantile(.05),median=quantile(.5),high=quantile(.95);
 // Empty black/white or nearly flat pictures do not contain evidence for exposure.
 if(high-low<12)return{recipe,median,low,high,reason:'画面层次不足，保持原样'};
 const encodedPeak=peak/255,linearPeak=encodedPeak<=.04045?encodedPeak/12.92:((encodedPeak+.055)/1.055)**2.4;
 const gain=median<100?Math.min(1.8,Math.max(1,.98/Math.max(.001,linearPeak)),Math.max(1,(115/Math.max(32,median))**1.4)):median>185?Math.max(.86,(180/median)**.5):1;
 recipe.whiteBalance={r:gain,g:gain,b:gain};
 recipe.shadows=median<110&&low<65?Math.round(Math.min(25,(110-median)*.3)):0;
 recipe.highlights=high>230?Math.round(-Math.min(22,(high-230)*.8)):0;
 return{recipe,median,low,high,reason:'按亮度分布保守调节；不推断肤色或恢复剪切细节'};
}
return Object.freeze({analyze});
});
