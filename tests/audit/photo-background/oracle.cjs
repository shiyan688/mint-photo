'use strict';
// Independent mathematical oracle: no production compositor or sampler calls.
const linear=b=>{const x=b/255;return x<=0.04045?x/12.92:Math.pow((x+0.055)/1.055,2.4);};
const encode=x=>Math.round(255*(x<=0.0031308?12.92*x:1.055*Math.pow(x,1/2.4)-0.055));
function over(source,mask,background){
 const a=(source[3]/255)*mask,b=background[3]/255,total=a+b*(1-a);
 return total===0?[0,0,0,0]:[...source.slice(0,3).map((s,k)=>encode((linear(s)*a+linear(background[k])*b*(1-a))/total)),Math.round(total*255)];
}
function bounds(tw,th,sw,sh,{fit,x,y}){const scale=(fit==='fill'?Math.max:Math.min)(tw/sw,th/sh),width=sw*scale,height=sh*scale;return{scale,width,height,left:(tw-width)*x,top:(th-height)*y};}
module.exports={linear,encode,over,bounds};
