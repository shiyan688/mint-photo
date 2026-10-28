/* Versioned detail-v2 fork. Legacy portrait-engine.js remains byte-frozen for saved projects. */
/*
 * PortraitEngine: deterministic, offline pixel algorithms, not machine learning.
 * Actual face landmarks / person confidence masks must be supplied by a detector.
 * No input is mutated. Every operation returns { width, height, data } (RGBA8).
 *
 * Geometry uses normalized x/y, with radii relative to the shorter image edge.
 * Beauty smooth/brighten and reshape slim/eyes are 0..100; warmth/nose/jaw
 * are -100..100. Heal strength and warp strength are 0..1, not percentages.
 * Healing accepts up to 64 spots, clamping each radius to 0.12. Brush warp
 * defaults to radius 0.12, caps radius at 0.5 and displacement at 0.45 * radius.
 * Landmarks: MediaPipe 468/478 topology, [{x,y}, ...] or [[x,y], ...].
 * Beauty also accepts up to five meshes together, applying overlapping masks once.
 * Beauty without landmarks requires an explicit region {x,y,r}; otherwise no-op.
 * Positive nose/jaw values narrow; negative values widen. Eyes magnify, slim narrows.
 * Masks contain one confidence per pixel. 0..1 and 0..255 are accepted; a maximum
 * above 1 selects byte scaling. Set mask.maxValue = 255 to disambiguate dark bytes.
 * Feather and background blur are pixel radii at a 1000-pixel long edge. Feather
 * expands the transition outward: confidence=1 foreground stays exactly intact.
 * Transparent mode multiplies source alpha by confidence; color composites onto
 * opaque sRGB; blur changes background RGB but retains the source alpha channel.
 * Full-size output is retained; temporary filtering buffers are capped at 1024px.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PortraitDetailEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_PIXELS = 16777216, WORK_EDGE = 1024;
  const OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
  const FEATURES = [
    [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246],
    [263,249,390,373,374,380,381,382,362,398,384,385,386,387,388,466],
    [61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185],
    [70,63,105,66,107,55,65,52,53,46],
    [336,296,334,293,300,276,283,282,295,285]
  ];
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const number = (n, fallback, lo, hi) => typeof n === 'number' && Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  function validate(image) {
    if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width * image.height > MAX_PIXELS) throw new RangeError('Invalid image dimensions (maximum 16 megapixels).');
    if (!(image.data instanceof Uint8ClampedArray || image.data instanceof Uint8Array) || image.data.length !== image.width * image.height * 4) throw new TypeError('Expected exactly width * height * 4 RGBA bytes.');
    return image;
  }
  function copy(image) { return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) }; }
  function point(p) {
    if (!p) return null;
    const x = Array.isArray(p) ? p[0] : p.x, y = Array.isArray(p) ? p[1] : p.y;
    return finite(x) && finite(y) ? { x: clamp(x, 0, 1), y: clamp(y, 0, 1) } : null;
  }
  function mesh(landmarks) {
    if (!Array.isArray(landmarks) || landmarks.length < 468) return null;
    const p = landmarks.map(point);
    const needed = OVAL.concat(...FEATURES, [1,98,327]);
    if (needed.some(i => !p[i])) return null;
    const xs = OVAL.map(i => p[i].x), ys = OVAL.map(i => p[i].y);
    const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
    if (right - left < 0.03 || bottom - top < 0.03) return null;
    return { p, left, right, top, bottom };
  }
  function circle(region, width, height, maxR) {
    const p = point(region);
    if (!p || !finite(region.r) || region.r <= 0) return null;
    return { x: p.x * (width - 1), y: p.y * (height - 1), r: Math.max(0.5, Math.min(width, height) * clamp(region.r, 0.001, maxR || 0.5)) };
  }
  // Bilinear RGBA interpolation is premultiplied, preventing transparent color fringes.
  function sampleRGBA(source, width, height, x, y, target, offset) {
    x = clamp(x, 0, width - 1); y = clamp(y, 0, height - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
    const fx = x - x0, fy = y - y0;
    const i0 = (y0 * width + x0) * 4, i1 = (y0 * width + x1) * 4, i2 = (y1 * width + x0) * 4, i3 = (y1 * width + x1) * 4;
    const w0 = (1-fx)*(1-fy), w1 = fx*(1-fy), w2 = (1-fx)*fy, w3 = fx*fy;
    const a0=source[i0+3]*w0, a1=source[i1+3]*w1, a2=source[i2+3]*w2, a3=source[i3+3]*w3, alpha=a0+a1+a2+a3;
    for (let c=0;c<3;c++) target[offset+c] = alpha > 0 ? (source[i0+c]*a0+source[i1+c]*a1+source[i2+c]*a2+source[i3+c]*a3)/alpha : 0;
    target[offset+3] = alpha;
  }
  function sampleScalar(source, width, height, x, y, confidenceScale) {
    x=clamp(x,0,width-1); y=clamp(y,0,height-1);
    const x0=Math.floor(x), y0=Math.floor(y), x1=Math.min(width-1,x0+1), y1=Math.min(height-1,y0+1), fx=x-x0, fy=y-y0;
    if(confidenceScale) {
      const a=clamp(source[y0*width+x0]/confidenceScale,0,1),b=clamp(source[y0*width+x1]/confidenceScale,0,1),c=clamp(source[y1*width+x0]/confidenceScale,0,1),d=clamp(source[y1*width+x1]/confidenceScale,0,1);
      return (a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+d*fx)*fy;
    }
    return (source[y0*width+x0]*(1-fx)+source[y0*width+x1]*fx)*(1-fy)+(source[y1*width+x0]*(1-fx)+source[y1*width+x1]*fx)*fy;
  }
  function workSize(image) {
    const scale = Math.min(1, WORK_EDGE / Math.max(image.width, image.height));
    return { width: Math.max(1, Math.round(image.width*scale)), height: Math.max(1, Math.round(image.height*scale)) };
  }
  function resize(image, width, height) {
    if (width===image.width && height===image.height) return image;
    const out={width,height,data:new Uint8ClampedArray(width*height*4)};
    const sx=(image.width-1)/Math.max(1,width-1), sy=(image.height-1)/Math.max(1,height-1);
    for (let y=0;y<height;y++) for(let x=0;x<width;x++) sampleRGBA(image.data,image.width,image.height,x*sx,y*sy,out.data,(y*width+x)*4);
    return out;
  }
  // Separable sliding box convolution: O(pixels), independent of kernel area.
  function scalarBlur(input, width, height, radius) {
    if (radius<1) return input.slice();
    radius=Math.min(128,Math.round(radius));
    const tmp=new Float32Array(input.length), out=new Float32Array(input.length), k=radius*2+1;
    for(let y=0;y<height;y++) {
      const row=y*width; let sum=0;
      for(let i=-radius;i<=radius;i++) sum+=input[row+clamp(i,0,width-1)];
      for(let x=0;x<width;x++) { tmp[row+x]=sum/k; sum+=input[row+Math.min(width-1,x+radius+1)]-input[row+Math.max(0,x-radius)]; }
    }
    for(let x=0;x<width;x++) {
      let sum=0; for(let i=-radius;i<=radius;i++) sum+=tmp[clamp(i,0,height-1)*width+x];
      for(let y=0;y<height;y++) { out[y*width+x]=sum/k; sum+=tmp[Math.min(height-1,y+radius+1)*width+x]-tmp[Math.max(0,y-radius)*width+x]; }
    }
    return out;
  }
  // Normalized convolution excludes transparent pixels. Background inputs have
  // already encoded their non-subject confidence in alpha before downsampling.
  function weightedBlur(image, radius) {
    const {width,height,data}=image, out=copy(image), tmp=new Float32Array(width*height*4);
    radius=Math.max(1,Math.min(128,Math.round(radius)));
    const inv=1/(2*radius+1);
    function add(index, sign, sums) {
      const i=index*4, weight=data[i+3]/255*sign;
      sums[0]+=data[i]*weight; sums[1]+=data[i+1]*weight; sums[2]+=data[i+2]*weight; sums[3]+=weight;
    }
    for(let y=0;y<height;y++) {
      const row=y*width, sums=[0,0,0,0];
      for(let i=-radius;i<=radius;i++) add(row+clamp(i,0,width-1),1,sums);
      for(let x=0;x<width;x++) {
        const o=(row+x)*4; for(let c=0;c<4;c++) tmp[o+c]=sums[c]*inv;
        add(row+Math.min(width-1,x+radius+1),1,sums); add(row+Math.max(0,x-radius),-1,sums);
      }
    }
    for(let x=0;x<width;x++) {
      const sums=[0,0,0,0];
      for(let y=-radius;y<=radius;y++) { const i=(clamp(y,0,height-1)*width+x)*4; for(let c=0;c<4;c++) sums[c]+=tmp[i+c]; }
      for(let y=0;y<height;y++) {
        const i=(y*width+x)*4;
        if(sums[3]>0.00001) for(let c=0;c<3;c++) out.data[i+c]=sums[c]/sums[3];
        const a=(Math.min(height-1,y+radius+1)*width+x)*4, b=(Math.max(0,y-radius)*width+x)*4;
        for(let c=0;c<4;c++) sums[c]+=tmp[a+c]-tmp[b+c];
      }
    }
    return out;
  }
  function polygon(mask,width,height,points,value,expand) {
    const cx=points.reduce((s,p)=>s+p.x,0)/points.length, cy=points.reduce((s,p)=>s+p.y,0)/points.length;
    const ps=points.map(p=>({x:(cx+(p.x-cx)*expand)*(width-1),y:(cy+(p.y-cy)*expand)*(height-1)}));
    const minY=clamp(Math.ceil(Math.min(...ps.map(p=>p.y))),0,height-1), maxY=clamp(Math.floor(Math.max(...ps.map(p=>p.y))),0,height-1);
    for(let y=minY;y<=maxY;y++) {
      const cuts=[];
      for(let i=0,j=ps.length-1;i<ps.length;j=i++) {
        const a=ps[i],b=ps[j]; if((a.y>y)!==(b.y>y)) cuts.push(a.x+(y-a.y)*(b.x-a.x)/(b.y-a.y));
      }
      cuts.sort((a,b)=>a-b);
      for(let i=0;i+1<cuts.length;i+=2) {
        const start=clamp(Math.ceil(cuts[i]),0,width-1),end=clamp(Math.floor(cuts[i+1]),0,width-1);
        for(let x=start;x<=end;x++) mask[y*width+x]=value;
      }
    }
  }
  const smoothstep = (low, high, value) => {
    const t = clamp((value-low)/(high-low),0,1);
    return t*t*(3-2*t);
  };
  // A distance ramp, unlike min(binary, blur), reaches zero continuously at the
  // actual contour. Two chamfer sweeps are O(pixels), not O(pixels * landmarks).
  function inwardDistance(binary,width,height) {
    const distance=new Float32Array(binary.length), diagonal=Math.SQRT2;
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
      const i=y*width+x;
      if(!binary[i]) continue;
      let d=Math.min(x+1,y+1,width-x,height-y);
      if(x) d=Math.min(d,distance[i-1]+1);
      if(y) {
        d=Math.min(d,distance[i-width]+1);
        if(x) d=Math.min(d,distance[i-width-1]+diagonal);
        if(x+1<width) d=Math.min(d,distance[i-width+1]+diagonal);
      }
      distance[i]=d;
    }
    for(let y=height-1;y>=0;y--) for(let x=width-1;x>=0;x--) {
      const i=y*width+x; if(!binary[i]) continue;
      let d=distance[i];
      if(x+1<width) d=Math.min(d,distance[i+1]+1);
      if(y+1<height) {
        d=Math.min(d,distance[i+width]+1);
        if(x) d=Math.min(d,distance[i+width-1]+diagonal);
        if(x+1<width) d=Math.min(d,distance[i+width+1]+diagonal);
      }
      distance[i]=d;
    }
    return distance;
  }
  // Broad, continuous warm-chroma confidence, not a light-skin RGB threshold.
  // Dark brown, olive, rosy and pale skin remain eligible. Neutral hair, blue /
  // green objects and saturated lipstick are protected even inside the mesh.
  function skinConfidence(r,g,b) {
    return smoothstep(-8,4,r-g)*smoothstep(-4,18,r-b)*
      (1-smoothstep(8,32,b-g))*(1-smoothstep(0.28,0.55,(r-g)/(r+g+b+30)));
  }
  function skinMask(work,face,region) {
    const {width,height,data}=work, out=new Float32Array(width*height);
    if(face) {
      polygon(out,width,height,OVAL.map(i=>face.p[i]),1,1);
      const faceWidth=(face.right-face.left)*(width-1);
      const boundary=inwardDistance(out,width,height);
      const features=new Float32Array(out.length);features.fill(1);
      FEATURES.forEach(ids=>polygon(features,width,height,ids.map(i=>face.p[i]),0,1.02));
      const featureDistance=inwardDistance(features,width,height);
      const edgeFeather=Math.max(3,faceWidth*0.11), featureFeather=Math.max(2,faceWidth*0.065);
      // Estimate only illumination, not ethnicity / a target complexion. This
      // prevents hair and deep occlusion shadows being lifted to a pale patch.
      const histogram=new Uint32Array(256);let count=0;
      for(let i=0;i<out.length;i++) {
        const spatial=smoothstep(0,edgeFeather,Math.max(0,boundary[i]-0.75))*
          smoothstep(0,featureFeather,Math.max(0,featureDistance[i]-0.75));
        out[i]=spatial;
        const j=i*4;
        if(spatial>0.55 && data[j+3]>128 && skinConfidence(data[j],data[j+1],data[j+2])>0.5) {
          histogram[Math.round(data[j]*0.2126+data[j+1]*0.7152+data[j+2]*0.0722)]++;count++;
        }
      }
      let median=0, accumulated=0;
      if(count) for(;median<255;median++){accumulated+=histogram[median];if(accumulated>=count/2)break;}
      for(let i=0;i<out.length;i++) if(out[i]) {
        const j=i*4, r=data[j],g=data[j+1],b=data[j+2],y=r*0.2126+g*0.7152+b*0.0722;
        out[i]*=skinConfidence(r,g,b)*smoothstep(Math.max(4,median*0.20),Math.max(24,median*0.60),y);
      }
    } else {
      // Explicit brush regions retain their original semantics, including use
      // on cool-colored / non-skin pixels. Automatic skin gating is face-only.
      const c=circle(region,width,height); if(!c) return out;
      for(let y=Math.max(0,Math.floor(c.y-c.r));y<=Math.min(height-1,Math.ceil(c.y+c.r));y++) for(let x=Math.max(0,Math.floor(c.x-c.r));x<=Math.min(width-1,Math.ceil(c.x+c.r));x++) {
        const q=((x-c.x)**2+(y-c.y)**2)/(c.r*c.r); if(q<1) out[y*width+x]=(1-q)**2;
      }
    }
    return out;
  }
  const linearTable=new Float32Array(256), srgbTable=new Float32Array(4097);
  for(let i=0;i<256;i++){const v=i/255;linearTable[i]=v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;}
  for(let i=0;i<=4096;i++){const v=i/4096;srgbTable[i]=255*(v<=0.0031308?v*12.92:1.055*v**(1/2.4)-0.055);}
  function linearValue(value) {
    const low=Math.floor(value),high=Math.min(255,low+1);
    return linearTable[low]+(linearTable[high]-linearTable[low])*(value-low);
  }
  function srgbValue(value) {
    const v=clamp(value,0,1)*4096,low=Math.floor(v),high=Math.min(4096,low+1);
    return srgbTable[low]+(srgbTable[high]-srgbTable[low])*(v-low);
  }
  // Optional face-aware classical color controls. These are not learned skin
  // parsing, ethnicity classification, or a claim of state-of-the-art retouching.
  const INNER_LIPS=[78,95,88,178,87,14,317,402,318,324,308,415,310,311,312,13,82,81,80,191];
  const PALETTES={natural:{lip:[0.55,0.12,0.12],blush:[0.65,0.21,0.16]},peach:{lip:[0.65,0.20,0.12],blush:[0.75,0.27,0.16]},rose:{lip:[0.55,0.10,0.19],blush:[0.65,0.16,0.23]}};
  function faceColorMasks(work,faces,skin,wanted) {
    const {width:w,height:h,data}=work,n=w*h;
    const under=new Float32Array(n),cheek=new Float32Array(n),lips=new Float32Array(n),redTarget=new Float32Array(n);
    const low=weightedBlur(work,Math.max(2,Math.round(Math.min(w,h)*0.014)));
    for(const face of faces) {
      const px=id=>({x:face.p[id].x*(w-1),y:face.p[id].y*(h-1)}),a=px(33),b=px(263),chin=px(152),forehead=px(10);
      let ax=b.x-a.x,ay=b.y-a.y;const span=Math.hypot(ax,ay);if(span<4)continue;ax/=span;ay/=span;
      let dx=-ay,dy=ax;if(dx*(chin.x-forehead.x)+dy*(chin.y-forehead.y)<0){dx=-dx;dy=-dy;}
      const fw=span/0.73,fh=Math.hypot(chin.x-forehead.x,chin.y-forehead.y);
      const skinForFace=skinMask(work,face),cheekLocal=new Float32Array(n),eyeLocal=new Float32Array(n);
      function ellipse(target,cx,cy,rx,ry) {
        const reach=rx+ry;
        for(let y=Math.max(0,Math.floor(cy-reach));y<=Math.min(h-1,Math.ceil(cy+reach));y++)for(let x=Math.max(0,Math.floor(cx-reach));x<=Math.min(w-1,Math.ceil(cx+reach));x++){
          const ox=x-cx,oy=y-cy,q=((ox*ax+oy*ay)/rx)**2+((ox*dx+oy*dy)/ry)**2;
          if(q<1){const i=y*w+x;target[i]=Math.max(target[i],(1-q)**3);}
        }
      }
      for(const ids of [[33,133,145,61,234],[263,362,374,291,454]]) {
        const outer=px(ids[0]),inner=px(ids[1]),lower=px(ids[2]),mouth=px(ids[3]),side=px(ids[4]);
        const eyeSpan=Math.hypot(outer.x-inner.x,outer.y-inner.y);
        if(wanted.underEye)ellipse(eyeLocal,lower.x+dx*eyeSpan*.28,lower.y+dy*eyeSpan*.28,eyeSpan*.65,eyeSpan*.38);
        // Cheek placement follows landmarks, not a fixed image-axis ellipse.
        ellipse(cheekLocal,outer.x*.36+mouth.x*.33+side.x*.31,outer.y*.36+mouth.y*.33+side.y*.31,fw*.28,fh*.20);
      }
      let sumY=0,sumRed=0,total=0;
      for(let i=0;i<n;i++){
        const j=i*4,weight=cheekLocal[i]*skinForFace[i]*data[j+3]/255;
        if(weight>0.001){const r=linearTable[data[j]],g=linearTable[data[j+1]],b=linearTable[data[j+2]],Y=.2126*r+.7152*g+.0722*b;
          sumY+=Y*weight;sumRed+=(r-g)/Math.max(.04,r+g+b)*weight;total+=weight;}
      }
      const referenceY=total?sumY/total:0,referenceRed=total?sumRed/total:0;
      for(let i=0;i<n;i++){
        const j=i*4,localY=.2126*linearTable[low.data[j]]+.7152*linearTable[low.data[j+1]]+.0722*linearTable[low.data[j+2]];
        const deficit=referenceY>0?clamp((referenceY-localY)/Math.max(.015,referenceY)*2,0,1):0;
        // Only dark local tone, never lower lid/iris or an all-face brightener.
        under[i]=Math.max(under[i],eyeLocal[i]*skinForFace[i]*deficit);
        cheek[i]=Math.max(cheek[i],cheekLocal[i]*skinForFace[i]);
        if(wanted.redness&&total){const r=linearTable[low.data[j]],g=linearTable[low.data[j+1]],b=linearTable[low.data[j+2]];
          const excess=clamp(((r-g)/Math.max(.04,r+g+b)-referenceRed-.015)/.18,0,1);
          redTarget[i]=Math.max(redTarget[i],skinForFace[i]*excess);}
      }
      if(wanted.lip){
        const outer=new Float32Array(n);polygon(outer,w,h,FEATURES[2].map(i=>face.p[i]),1,1);
        // Inner mouth is always excluded, including teeth and its soft boundary.
        polygon(outer,w,h,INNER_LIPS.map(i=>face.p[i]),0,1.05);
        const distance=inwardDistance(outer,w,h),feather=Math.max(1.2,fw*.018);
        for(let i=0;i<n;i++)lips[i]=Math.max(lips[i],smoothstep(0,feather,Math.max(0,distance[i]-.5)));
      }
    }
    return {under,cheek,lips,redTarget};
  }
  function perceptualChroma(r,g,b) {
    const l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b),m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b),s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
    return [1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s];
  }
  function tintChroma(r,g,b,target,strength,chromaLimit) {
    if(strength<=1e-12)return [r,g,b];
    const Y=.2126*r+.7152*g+.0722*b,targetY=.2126*target[0]+.7152*target[1]+.0722*target[2];
    let nr=r+(target[0]*Y/targetY-r)*strength,ng=g+(target[1]*Y/targetY-g)*strength,nb=b+(target[2]*Y/targetY-b)*strength;
    if(chromaLimit!==undefined){const before=perceptualChroma(r,g,b),after=perceptualChroma(nr,ng,nb),delta=Math.hypot(after[0]-before[0],after[1]-before[1]);
      if(delta>chromaLimit){const amount=chromaLimit/delta;nr=r+(nr-r)*amount;ng=g+(ng-g)*amount;nb=b+(nb-b)*amount;}}
    // Luminance stays constant. Compress only out-of-gamut chroma, no clipping.
    let scale=1;for(const v of [nr,ng,nb]){if(v>linearTable[254])scale=Math.min(scale,Math.max(0,(linearTable[254]-Y)/(v-Y)));if(v<0)scale=Math.min(scale,Y/(Y-v));}
    return [Y+(nr-Y)*scale,Y+(ng-Y)*scale,Y+(nb-Y)*scale];
  }
  // Bilinear interpolation can only reach one work pixel beyond nonzero support.
  // Keep that conservative border when projecting to the full-resolution image.
  function beautyBounds(mask,lips,width,height,outputWidth,outputHeight) {
    let left=width,top=height,right=-1,bottom=-1;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=y*width+x;
      if(mask[i]>0||(lips&&lips[i]>0)){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
    }
    if(right<0)return null;
    const sx=(width-1)/Math.max(1,outputWidth-1),sy=(height-1)/Math.max(1,outputHeight-1);
    return {left:sx?Math.max(0,Math.floor((left-1)/sx)):0,right:sx?Math.min(outputWidth-1,Math.ceil((right+1)/sx)):outputWidth-1,
      top:sy?Math.max(0,Math.floor((top-1)/sy)):0,bottom:sy?Math.min(outputHeight-1,Math.ceil((bottom+1)/sy)):outputHeight-1};
  }
  function beauty(image,settings,landmarks) {
    validate(image); settings=settings||{};
    const smooth=number(settings.smooth,0,0,100)/100, brighten=number(settings.brighten,0,0,100)/100, warmth=number(settings.warmth,0,-100,100)/100;
    const underEye=number(settings.underEye,0,0,100)/100,redness=number(settings.redness,0,0,100)/100,lip=number(settings.lip,0,0,100)/100,blush=number(settings.blush,0,0,100)/100;
    const palette=Object.prototype.hasOwnProperty.call(PALETTES,settings.palette)?PALETTES[settings.palette]:PALETTES.natural;
    const out=copy(image);
    if(!smooth&&!brighten&&!warmth&&!underEye&&!redness&&!lip&&!blush) return out;
    // Both the original single mesh and an array of meshes are supported. All
    // face masks are max-unioned against the original image, never accumulated.
    const single=mesh(landmarks),faces=single?[single]:Array.isArray(landmarks)?landmarks.slice(0,5).map(mesh).filter(Boolean):[];
    if(!faces.length&&!circle(settings.region,image.width,image.height)) return out;
    const size=workSize(image),work=resize(image,size.width,size.height);
    let mask=null,faceWidth=Math.min(size.width,size.height);
    if(faces.length) for(const face of faces) {
      const next=skinMask(work,face);
      if(!mask) mask=next;else for(let i=0;i<mask.length;i++) mask[i]=Math.max(mask[i],next[i]);
      faceWidth=Math.min(faceWidth,(face.right-face.left)*(size.width-1));
    }
    else mask=skinMask(work,null,settings.region);
    const colorMasks=faces.length&&(underEye||redness||lip||blush)?faceColorMasks(work,faces,mask,{underEye,redness,lip,blush}):null;
    const bounds=beautyBounds(mask,colorMasks&&lip?colorMasks.lips:null,size.width,size.height,image.width,image.height);
    if(!bounds)return out;
    const detailV2=true;let blurred=null,fine=null;
    if(smooth) {
      // Excluded eye, lip and hair colors must not enter the skin low-pass.
      const samples=copy(work);
      for(let i=0;i<mask.length;i++)samples.data[i*4+3]*=mask[i];
      const radius=Math.max(1,Math.min(8,Math.round(faceWidth*0.014)));blurred=weightedBlur(samples,detailV2?radius+1:radius);if(detailV2)fine=weightedBlur(samples,Math.max(1,Math.round(radius/3)));
    }
    const sx=(size.width-1)/Math.max(1,image.width-1),sy=(size.height-1)/Math.max(1,image.height-1),pixel=new Float64Array(4),finePixel=new Float64Array(4);
    for(let y=bounds.top;y<=bounds.bottom;y++) for(let x=bounds.left;x<=bounds.right;x++) {
      const i=(y*image.width+x)*4; if(!image.data[i+3]) continue;
      const red=image.data[i],green=image.data[i+1],blue=image.data[i+2];
      let m=sampleScalar(mask,size.width,size.height,x*sx,y*sy);
      const lipMask=colorMasks&&lip?sampleScalar(colorMasks.lips,size.width,size.height,x*sx,y*sy):0;
      if(m<=0.00001&&lipMask<=0.00001) continue;
      // Full-resolution confidence prevents a 1024px mask from bleeding across
      // a strand of hair / other high-contrast non-skin detail during export.
      const confidence=faces.length?skinConfidence(red,green,blue):1;
      if(faces.length)m=Math.min(m,confidence);
      if(m<=0.00001&&lipMask<=0.00001) continue;
      let edge=0;
      if(smooth) {
        sampleRGBA(blurred.data,size.width,size.height,x*sx,y*sy,pixel,0);
        const dr=red-pixel[0],dg=green-pixel[1],db=blue-pixel[2],difference=(dr*dr+dg*dg+db*db)/3;
        // Keep significant edges and some pore texture even at the slider max.
        if(detailV2){sampleRGBA(fine.data,size.width,size.height,x*sx,y*sy,finePixel,0);pixel[0]=clamp(pixel[0]+(red-finePixel[0])*.65,0,255);pixel[1]=clamp(pixel[1]+(green-finePixel[1])*.65,0,255);pixel[2]=clamp(pixel[2]+(blue-finePixel[2])*.65,0,255);edge=smooth*.72*Math.exp(-difference/(24*24))*m;}else edge=smooth*0.48*Math.exp(-difference/(22*22))*m;
      }
      let r=linearValue(red+(pixel[0]-red)*edge),g=linearValue(green+(pixel[1]-green)*edge),b=linearValue(blue+(pixel[2]-blue)*edge);
      const luminance=r*0.2126+g*0.7152+b*0.0722,peak=Math.max(r,g,b);
      // Bounded linear-light exposure, not a white overlay. Shared RGB gain
      // preserves chromaticity. Shadows stay anchored; highlights roll off.
      const light=Math.min(1+0.32*brighten*m*smoothstep(0.004,0.025,luminance)*(1-smoothstep(0.35,0.98,peak)),Math.max(1,linearTable[254]/Math.max(1e-9,peak)));
      r*=light;g*=light;b*=light;
      if(warmth) {
        const warm=warmth*m*0.18*(1-smoothstep(0.45,0.98,peak));
        const oldY=r*0.2126+g*0.7152+b*0.0722;
        r*=1+warm;b*=1-warm;
        const newY=r*0.2126+g*0.7152+b*0.0722,normalize=newY>0?oldY/newY:1;
        r*=normalize;g*=normalize;b*=normalize;
        // Compress only out-of-gamut chroma around the same luminance, instead
        // of clipping channels and changing hue or making colored highlights.
        const maximum=Math.max(r,g,b);
        if(maximum>linearTable[254]){const chroma=Math.max(0,(linearTable[254]-oldY))/Math.max(0.00001,maximum-oldY);r=oldY+(r-oldY)*chroma;g=oldY+(g-oldY)*chroma;b=oldY+(b-oldY)*chroma;}
      }
      if(colorMasks) {
        if(underEye){const weight=sampleScalar(colorMasks.under,size.width,size.height,x*sx,y*sy)*Math.min(1,confidence);
          const gain=Math.min(1+.22*underEye*weight*(1-smoothstep(.35,.85,Math.max(r,g,b))),Math.max(1,linearTable[254]/Math.max(1e-9,r,g,b)));r*=gain;g*=gain;b*=gain;}
        if(redness){const weight=sampleScalar(colorMasks.redTarget,size.width,size.height,x*sx,y*sy)*redness*.28*Math.min(1,confidence);
          // Correct excess local red toward the same-luminance neutral only a little.
          const Y=.2126*r+.7152*g+.0722*b;r+= (Y-r)*weight;g+=(Y-g)*weight;b+=(Y-b)*weight;}
        if(blush){const spatial=sampleScalar(colorMasks.cheek,size.width,size.height,x*sx,y*sy)*Math.min(1,confidence),weight=spatial*blush;[r,g,b]=tintChroma(r,g,b,palette.blush,weight*.22,weight*.014);}
        if(lip&&lipMask){const Y=.2126*r+.7152*g+.0722*b;
          const protect=smoothstep(.006,.035,Y)*(1-smoothstep(.65,.92,Y))*smoothstep(1,12,red-green);
          [r,g,b]=tintChroma(r,g,b,palette.lip,lip*lipMask*.42*protect);}
      }
      out.data[i]=srgbValue(r);out.data[i+1]=srgbValue(g);out.data[i+2]=srgbValue(b);
    }
    return out;
  }
  function heal(image,settings) {
    validate(image); settings=settings||{}; const out=copy(image), strength=number(settings.strength,0.8,0,1);
    if(!strength||!Array.isArray(settings.spots)) return out;
    const sample=new Float64Array(4);
    for(const spot of settings.spots.slice(0,64)) {
      const s=circle(spot,image.width,image.height,0.12); if(!s) continue;
      const samples=[];
      for(let ring=0;ring<2;ring++) for(let j=0;j<24;j++) {
        const a=j*Math.PI/12, dx=Math.cos(a)*(1.3+ring*0.35), dy=Math.sin(a)*(1.3+ring*0.35);
        const x=s.x+dx*s.r,y=s.y+dy*s.r;
        if(x<0||y<0||x>image.width-1||y>image.height-1) continue;
        sampleRGBA(out.data,image.width,image.height,x,y,sample,0);
        if(sample[3]<16) continue;
        samples.push({dx,dy,r:sample[0],g:sample[1],b:sample[2],w:sample[3]/255,l:(sample[0]+sample[1]+sample[2])/3});
      }
      if(samples.length<6) continue;
      const sorted=samples.map(v=>v.l).sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)];
      const selected=samples.filter(v=>Math.abs(v.l-median)<=40);
      if(selected.length<6) continue;
      // Least-squares local color plane follows smooth illumination instead of a flat stamp.
      const A=[0,0,0,0,0,0],B=[[0,0,0],[0,0,0],[0,0,0]];
      for(const s of selected) {
        const a=s.dx,b=s.dy,w=s.w; A[0]+=w;A[1]+=w*a;A[2]+=w*b;A[3]+=w*a*a;A[4]+=w*a*b;A[5]+=w*b*b;
        [s.r,s.g,s.b].forEach((v,c)=>{B[c][0]+=w*v;B[c][1]+=w*v*a;B[c][2]+=w*v*b;});
      }
      const [a,b,c,d,e,f]=A,det=a*(d*f-e*e)-b*(b*f-e*c)+c*(b*e-d*c);
      const coeff=B.map(v=>Math.abs(det)<1e-8?[v[0]/a,0,0]:[
        ((d*f-e*e)*v[0]+(c*e-b*f)*v[1]+(b*e-c*d)*v[2])/det,
        ((c*e-b*f)*v[0]+(a*f-c*c)*v[1]+(b*c-a*e)*v[2])/det,
        ((b*e-c*d)*v[0]+(b*c-a*e)*v[1]+(a*d-b*b)*v[2])/det
      ]);
      for(let y=Math.max(0,Math.floor(s.y-s.r));y<=Math.min(image.height-1,Math.ceil(s.y+s.r));y++) for(let x=Math.max(0,Math.floor(s.x-s.r));x<=Math.min(image.width-1,Math.ceil(s.x+s.r));x++) {
        const dx=(x-s.x)/s.r,dy=(y-s.y)/s.r,q=dx*dx+dy*dy;if(q>=1) continue;
        const i=(y*image.width+x)*4,weight=strength*(1-q)**2;
        for(let k=0;k<3;k++) {const v=clamp(coeff[k][0]+coeff[k][1]*dx+coeff[k][2]*dy,0,255);out.data[i+k]+= (v-out.data[i+k])*weight;}
      }
    }
    return out;
  }
  function warp(image,settings) {
    validate(image);settings=settings||{};const out=copy(image),from=point(settings.from),to=point(settings.to),strength=number(settings.strength,1,0,1);
    if(!from||!to||!strength) return out;
    const radius=number(settings.radius,0.12,0,0.5)*Math.min(image.width,image.height);
    if(!radius) return out;
    let dx=(to.x-from.x)*(image.width-1)*strength,dy=(to.y-from.y)*(image.height-1)*strength;
    const length=Math.hypot(dx,dy),limit=radius*0.45;if(length===0) return out;if(length>limit){dx*=limit/length;dy*=limit/length;}
    const cx=from.x*(image.width-1)+dx,cy=from.y*(image.height-1)+dy;
    for(let y=Math.max(0,Math.floor(cy-radius));y<=Math.min(image.height-1,Math.ceil(cy+radius));y++) for(let x=Math.max(0,Math.floor(cx-radius));x<=Math.min(image.width-1,Math.ceil(cx+radius));x++) {
      const q=((x-cx)**2+(y-cy)**2)/(radius*radius);if(q>=1) continue;
      const weight=(1-q)**2;sampleRGBA(image.data,image.width,image.height,x-dx*weight,y-dy*weight,out.data,(y*image.width+x)*4);
    }
    return out;
  }
  function reshape(image,settings,landmarks) {
    validate(image);settings=settings||{};const out=copy(image),face=mesh(landmarks);
    const slim=number(settings.slim,0,0,100)/100,eyes=number(settings.eyes,0,0,100)/100,nose=number(settings.nose,0,-100,100)/100,jaw=number(settings.jaw,0,-100,100)/100;
    if(!face||(!slim&&!eyes&&!nose&&!jaw)) return out;
    const p=i=>({x:face.p[i].x*(image.width-1),y:face.p[i].y*(image.height-1)}),fw=(face.right-face.left)*(image.width-1),fh=(face.bottom-face.top)*(image.height-1),cx=(face.left+face.right)*(image.width-1)/2;
    if(fw<2||fh<2) return out;
    const fields=[];
    function move(i,amount,rx,ry) {const a=p(i),delta=(cx-a.x)*amount;fields.push({x:a.x+delta,y:a.y,rx,ry,dx:delta,dy:0,type:'move'});}
    if(slim){move(234,slim*0.15,fw*0.34,fh*0.4);move(454,slim*0.15,fw*0.34,fh*0.4);}
    if(jaw){move(172,jaw*0.18,fw*0.30,fh*0.27);move(397,jaw*0.18,fw*0.30,fh*0.27);}
    if(eyes) for(const pair of [[33,133],[263,362]]) {
      const a=p(pair[0]),b=p(pair[1]),span=Math.max(2,Math.hypot(a.x-b.x,a.y-b.y));
      fields.push({x:(a.x+b.x)/2,y:(a.y+b.y)/2,rx:span*0.9,ry:span*0.62,amount:eyes*0.25,type:'eye'});
    }
    if(nose){const a=p(1);fields.push({x:a.x,y:a.y,rx:fw*0.20,ry:fh*0.20,amount:nose*0.28,type:'nose'});}
    const minX=Math.max(0,Math.floor(Math.min(...fields.map(f=>f.x-f.rx)))),maxX=Math.min(image.width-1,Math.ceil(Math.max(...fields.map(f=>f.x+f.rx))));
    const minY=Math.max(0,Math.floor(Math.min(...fields.map(f=>f.y-f.ry)))),maxY=Math.min(image.height-1,Math.ceil(Math.max(...fields.map(f=>f.y+f.ry))));
    const maxShift=Math.min(fw,fh)*0.12;
    for(let y=minY;y<=maxY;y++) for(let x=minX;x<=maxX;x++) {
      let dx=0,dy=0;
      for(const f of fields) {
        const ox=x-f.x,oy=y-f.y,q=(ox/f.rx)**2+(oy/f.ry)**2;if(q>=1) continue;
        const weight=(1-q)**2;
        if(f.type==='move'){dx-=f.dx*weight;dy-=f.dy*weight;}
        else if(f.type==='eye'){const factor=1/(1+f.amount*weight)-1;dx+=ox*factor;dy+=oy*factor;}
        else dx+=ox*f.amount*weight;
      }
      if(Math.abs(dx)+Math.abs(dy)<1e-7) continue;
      const length=Math.hypot(dx,dy);if(length>maxShift){dx*=maxShift/length;dy*=maxShift/length;}
      sampleRGBA(image.data,image.width,image.height,x+dx,y+dy,out.data,(y*image.width+x)*4);
    }
    return out;
  }
  function readMask(mask,width,height) {
    if(!mask||!Number.isInteger(mask.width)||!Number.isInteger(mask.height)||mask.width<1||mask.height<1||mask.width*mask.height>MAX_PIXELS||!mask.data||mask.data.length!==mask.width*mask.height) throw new TypeError('Expected a one-channel confidence mask.');
    let scale=mask.maxValue===255?255:1;
    for(let i=0;i<mask.data.length;i++) {if(!finite(mask.data[i])) throw new TypeError('Mask confidence must be finite.');if(mask.data[i]>1) scale=255;}
    const out=new Float32Array(width*height),sx=(mask.width-1)/Math.max(1,width-1),sy=(mask.height-1)/Math.max(1,height-1);
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) out[y*width+x]=sampleScalar(mask.data,mask.width,mask.height,x*sx,y*sy,scale);
    return {data:out,scale};
  }
  // Downsampling happens AFTER excluding the subject, so even export-size hard
  // edges cannot contaminate background samples with foreground RGB.
  function backgroundSamples(image,width,height,mask,scale) {
    const out={width,height,data:new Uint8ClampedArray(width*height*4)},src=image.data;
    const sx=(image.width-1)/Math.max(1,width-1),sy=(image.height-1)/Math.max(1,height-1),mx=(mask.width-1)/Math.max(1,image.width-1),my=(mask.height-1)/Math.max(1,image.height-1);
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
      const px=x*sx,py=y*sy,x0=Math.floor(px),y0=Math.floor(py),x1=Math.min(image.width-1,x0+1),y1=Math.min(image.height-1,y0+1),fx=px-x0,fy=py-y0;
      const xs=[x0,x1,x0,x1],ys=[y0,y0,y1,y1],weights=[(1-fx)*(1-fy),fx*(1-fy),(1-fx)*fy,fx*fy];
      let red=0,green=0,blue=0,total=0;
      for(let k=0;k<4;k++) {
        const i=(ys[k]*image.width+xs[k])*4,m=sampleScalar(mask.data,mask.width,mask.height,xs[k]*mx,ys[k]*my,scale),weight=weights[k]*(1-m)*src[i+3]/255;
        red+=src[i]*weight;green+=src[i+1]*weight;blue+=src[i+2]*weight;total+=weight;
      }
      const i=(y*width+x)*4;
      if(total>1e-8){out.data[i]=red/total;out.data[i+1]=green/total;out.data[i+2]=blue/total;out.data[i+3]=total*255;}
    }
    return out;
  }
  function parseColor(value) {
    if(typeof value!=='string'||!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) throw new TypeError('Background color must be #RGB or #RRGGBB.');
    let hex=value.slice(1);if(hex.length===3) hex=hex.split('').map(c=>c+c).join('');
    return [parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16)];
  }
  function background(image,settings) {
    validate(image);settings=settings||{};const out=copy(image);if(!settings.mask) return out;
    const continuous=settings.continuousAlpha===true;
    if(continuous) {
      if(!(settings.mask.data instanceof Float32Array)||settings.mask.width!==image.width||settings.mask.height!==image.height||settings.mask.data.length!==image.width*image.height)throw new Error('Continuous alpha must match exact working pixels.');
      for(const value of settings.mask.data)if(!finite(value)||value<0||value>1)throw new Error('Continuous alpha must contain finite unit probabilities.');
    }
    const mode=settings.mode||'blur';if(!['color','blur','transparent'].includes(mode)) throw new RangeError('Unknown background mode.');
    const blur=number(settings.blur,20,0,50),feather=continuous?0:number(settings.feather,2,0,20),color=mode==='color'?parseColor(settings.color||'#FFFFFF'):null;
    const size=workSize(image),prepared=continuous?{data:settings.mask.data,scale:1}:readMask(settings.mask,size.width,size.height),mask=prepared.data;
    const featherRadius=Math.round(feather*Math.max(size.width,size.height)/1000);
    let softened=featherRadius?scalarBlur(mask,size.width,size.height,featherRadius):mask;
    if(featherRadius)for(let i=0;i<mask.length;i++) softened[i]=Math.max(mask[i],softened[i]);
    const blurred=mode==='blur'&&blur>0?weightedBlur(backgroundSamples(image,size.width,size.height,settings.mask,prepared.scale),Math.max(1,Math.round(blur*Math.max(size.width,size.height)/1000))):null;
    if(mode==='blur'&&!blurred) return out;
    if(blurred) for(let i=3;i<blurred.data.length;i+=4) blurred.data[i]=255;
    const sx=(size.width-1)/Math.max(1,image.width-1),sy=(size.height-1)/Math.max(1,image.height-1),pixel=new Float64Array(4);
    const mx=(settings.mask.width-1)/Math.max(1,image.width-1),my=(settings.mask.height-1)/Math.max(1,image.height-1);
    for(let y=0;y<image.height;y++) for(let x=0;x<image.width;x++) {
      const i=(y*image.width+x)*4,original=sampleScalar(settings.mask.data,settings.mask.width,settings.mask.height,x*mx,y*my,prepared.scale);
      const m=featherRadius?Math.max(original,clamp(sampleScalar(softened,size.width,size.height,x*sx,y*sy),0,1)):original;
      if(mode==='transparent'){out.data[i+3]=image.data[i+3]*m;continue;}
      if(mode==='color') {
        const alpha=m*image.data[i+3]/255;
        if(continuous) {
          // Learned alpha is composited directly in linear light, without
          // thresholding/dilating strands or an opaque segmentation overlay.
          for(let c=0;c<3;c++)out.data[i+c]=alpha===1?image.data[i+c]:alpha===0?color[c]:srgbValue(linearTable[image.data[i+c]]*alpha+linearTable[color[c]]*(1-alpha));
        } else for(let c=0;c<3;c++)out.data[i+c]=image.data[i+c]*alpha+color[c]*(1-alpha);
        out.data[i+3]=255;
      } else if(m<1) {
        sampleRGBA(blurred.data,size.width,size.height,x*sx,y*sy,pixel,0);
        for(let c=0;c<3;c++)out.data[i+c]=image.data[i+c]*m+pixel[c]*(1-m);
      }
    }
    return out;
  }
  Object.defineProperty(beauty,'capabilities',{value:Object.freeze({version:1,implementation:'classical-face-color-detail-v2',learnedRetouch:false,controls:Object.freeze(['smooth','brighten','warmth','underEye','redness','lip','blush']),palettes:Object.freeze(['natural','peach','rose']),faceOnly:Object.freeze(['underEye','redness','lip','blush']),landmarkTopology:'MediaPipe468/478'})});
  return Object.freeze({beauty,heal,reshape,warp,background});
});
