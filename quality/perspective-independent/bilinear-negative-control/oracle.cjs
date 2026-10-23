'use strict';
// Independent QA oracle: solve eight correspondence equations with partial
// pivoting, not production's closed-form quadrilateral homography/inversion.
const assert = require('node:assert/strict');
const square = [[0,0],[1,0],[1,1],[0,1]];
function solve(from, to) {
  const rows = [];
  for (let i=0;i<4;i++) {
    const [x,y]=from[i], [u,v]=to[i];
    rows.push([x,y,1,0,0,0,-u*x,-u*y,u]);
    rows.push([0,0,0,x,y,1,-v*x,-v*y,v]);
  }
  for(let col=0;col<8;col++) {
    let pivot=col;for(let row=col+1;row<8;row++)if(Math.abs(rows[row][col])>Math.abs(rows[pivot][col]))pivot=row;
    assert(Math.abs(rows[pivot][col])>1e-15,'Oracle correspondence system is singular');
    [rows[col],rows[pivot]]=[rows[pivot],rows[col]];
    const div=rows[col][col];for(let j=col;j<=8;j++)rows[col][j]/=div;
    for(let row=0;row<8;row++)if(row!==col){const f=rows[row][col];for(let j=col;j<=8;j++)rows[row][j]-=f*rows[col][j];}
  }
  return [...rows.map(row=>row[8]),1];
}
function map(m,x,y){const d=m[6]*x+m[7]*y+m[8];return{x:(m[0]*x+m[1]*y+m[2])/d,y:(m[3]*x+m[4]*y+m[5])/d};}
function matrices(recipe){const q=recipe.quad.map(p=>[p.x,p.y]);return{back:solve(square,q),forward:solve(q,square)};}
function linear(x){return (x/=255)<=.04045?x/12.92:((x+.055)/1.055)**2.4;}
function encode(x){return Math.round(255*(x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055));}
function sampleAll(im,nx,ny){
  const x=Math.max(0,Math.min(im.width-1,nx*im.width-.5)), y=Math.max(0,Math.min(im.height-1,ny*im.height-.5));
  let alpha=0;const c=[0,0,0];
  // Sum the tent-kernel over the WHOLE input, deliberately avoiding the
  // production floor/fraction/four-tap indexing path.
  for(let sy=0;sy<im.height;sy++)for(let sx=0;sx<im.width;sx++){
    const w=Math.max(0,1-Math.abs(x-sx))*Math.max(0,1-Math.abs(y-sy)),offset=(sy*im.width+sx)*4,a=w*im.data[offset+3];
    alpha+=a;for(let j=0;j<3;j++)c[j]+=a*linear(im.data[offset+j]);
  }
  return Math.round(alpha)?[...c.map(v=>encode(v/alpha)),Math.round(alpha)]:[0,0,0,0];
}
function render(im,recipe,width,height){const q=recipe.quad,edges=[q[0].x*im.width,q[0].y*im.height,q[2].x*im.width,q[2].y*im.height],data=new Uint8ClampedArray(width*height*4);if(q[0].x===q[3].x&&q[1].x===q[2].x&&q[0].y===q[1].y&&q[2].y===q[3].y&&edges.every(Number.isInteger)&&edges[2]-edges[0]===width&&edges[3]-edges[1]===height){for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set(im.data.subarray(4*((y+edges[1])*im.width+x+edges[0]),4*((y+edges[1])*im.width+x+edges[0]+1)),4*(y*width+x));return{width,height,data};}const m=matrices(recipe).back;for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=map(m,(x+.5)/width,(y+.5)/height);data.set(sampleAll(im,p.x,p.y),4*(y*width+x));}return{width,height,data};}
function fixture(width,height,opaque=false){const data=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([(x*73+y*31+13)%256,(x*17+y*59+241)%256,(x*113+y*83+19)%256,opaque?255:[0,1,64,128,254,255][(x+3*y)%6]],4*(y*width+x));return{width,height,data};}
module.exports={square,solve,map,matrices,sampleAll,render,fixture,linear,encode};
