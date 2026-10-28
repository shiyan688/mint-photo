/* Bounded grayscale guided alpha refinement. Aligns uncertainty, cannot recover missing hair. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MintEdgeRefine=api;})(typeof globalThis==='object'?globalThis:this,function(){'use strict';
 const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
 function mean(a,w,h,r){const tmp=new Float32Array(a.length),out=new Float32Array(a.length),k=r*2+1;for(let y=0;y<h;y++){let sum=0;for(let i=-r;i<=r;i++)sum+=a[y*w+clamp(i,0,w-1)];for(let x=0;x<w;x++){tmp[y*w+x]=sum/k;sum+=a[y*w+Math.min(w-1,x+r+1)]-a[y*w+Math.max(0,x-r)];}}for(let x=0;x<w;x++){let sum=0;for(let i=-r;i<=r;i++)sum+=tmp[clamp(i,0,h-1)*w+x];for(let y=0;y<h;y++){out[y*w+x]=sum/k;sum+=tmp[Math.min(h-1,y+r+1)*w+x]-tmp[Math.max(0,y-r)*w+x];}}return out;}
 function refine(image,mask,options){
  const w=image.width,h=image.height;
  if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<1||h<1||w*h>8000000||Math.max(w,h)>4096||!image.data||image.data.length!==w*h*4||!mask||mask.width!==w||mask.height!==h||mask.data.length!==w*h)throw Error('边缘贴合尺寸或像素无效');
  const check=()=>{if(options&&options.shouldCancel&&options.shouldCancel()){const e=Error('边缘贴合已取消');e.name='AbortError';throw e;}};
  check();
  const scale=Math.min(1,768/Math.max(w,h)),sw=Math.max(1,Math.round(w*scale)),sh=Math.max(1,Math.round(h*scale)),n=sw*sh,I=new Float32Array(n),P=new Float32Array(n),II=new Float32Array(n),IP=new Float32Array(n);
  for(let y=0;y<sh;y++){
   check();const sy=Math.min(h-1,Math.floor((y+.5)*h/sh));
   for(let x=0;x<sw;x++){
    const sx=Math.min(w-1,Math.floor((x+.5)*w/sw)),j=(sy*w+sx)*4,i=y*sw+x,alpha=image.data[j+3]/255;
    I[i]=(.2126*image.data[j]+.7152*image.data[j+1]+.0722*image.data[j+2])/255*alpha;P[i]=mask.data[sy*w+sx];II[i]=I[i]*I[i];IP[i]=I[i]*P[i];
   }
  }
  const r=4,mi=mean(I,sw,sh,r),mp=mean(P,sw,sh,r),mii=mean(II,sw,sh,r),mip=mean(IP,sw,sh,r),A=new Float32Array(n),B=new Float32Array(n);
  check();
  for(let i=0;i<n;i++){A[i]=(mip[i]-mi[i]*mp[i])/(Math.max(0,mii[i]-mi[i]*mi[i])+.0009);B[i]=mp[i]-A[i]*mi[i];}
  const ma=mean(A,sw,sh,r),mb=mean(B,sw,sh,r),out=new Float32Array(w*h);
  // A and B use identical coordinates. Preserve double precision and the original
  // interpolation operation order; only uncertain pixels need x coordinates.
  for(let y=0;y<h;y++){
   check();
   const sy=clamp((y+.5)*sh/h-.5,0,sh-1),y0=Math.floor(sy),y1=Math.min(sh-1,y0+1),fy=sy-y0,row0=y0*sw,row1=y1*sw;
   for(let x=0;x<w;x++){
    const j=y*w+x,p=mask.data[j];
    if(!Number.isFinite(p)||p<0||p>1)throw Error('边缘蒙版无效');
    if(p<=.02||p>=.98){out[j]=p;continue;}
    const k=j*4,g=(.2126*image.data[k]+.7152*image.data[k+1]+.0722*image.data[k+2])/255*(image.data[k+3]/255),sx=clamp((x+.5)*sw/w-.5,0,sw-1),x0=Math.floor(sx),x1=Math.min(sw-1,x0+1),fx=sx-x0,i0=row0+x0,i1=row0+x1,i2=row1+x0,i3=row1+x1;
    const a=(ma[i0]*(1-fx)+ma[i1]*fx)*(1-fy)+(ma[i2]*(1-fx)+ma[i3]*fx)*fy;
    const b=(mb[i0]*(1-fx)+mb[i1]*fx)*(1-fy)+(mb[i2]*(1-fx)+mb[i3]*fx)*fy;
    const q=a*g+b;
    out[j]=clamp(p+clamp(q-p,-.3,.3)*4*p*(1-p),0,1);
   }
  }
  return{width:w,height:h,data:out};
 }
 return Object.freeze({refine});
});
