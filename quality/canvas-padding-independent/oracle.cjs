'use strict';
// Independent forward-scatter oracle: no production planning or rendering calls.
const defaults=()=>({version:1,top:0,right:0,bottom:0,left:0,color:'#ffffff',opacity:1});
const op=(changes={})=>({type:'canvas-padding',recipe:{...defaults(),...changes}});
function padding(im,r){const s=Math.min(im.width,im.height),left=Math.floor(s*r.left+.5),right=Math.floor(s*r.right+.5),top=Math.floor(s*r.top+.5),bottom=Math.floor(s*r.bottom+.5),width=im.width+left+right,height=im.height+top+bottom,alpha=Math.floor(255*r.opacity+.5),rgb=parseInt(r.color.slice(1),16),color=alpha?[rgb>>>16,(rgb>>>8)&255,rgb&255,alpha]:[0,0,0,0],data=new Uint8ClampedArray(width*height*4);for(let i=0;i<data.length;i+=4)data.set(color,i);for(let y=0;y<im.height;y++)for(let x=0;x<im.width;x++)for(let k=0;k<4;k++)data[4*((y+top)*width+x+left)+k]=im.data[4*(y*im.width+x)+k];return{width,height,data};}
function fixture(width=13,height=9){const data=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([(17*x+31*y)%256,(x+53*y)%256,(73*x+7*y)%256,[0,1,63,127,128,254,255][(x+y)%7]],4*(y*width+x));return{width,height,data};}
module.exports={defaults,op,padding,fixture};
