'use strict';
const captured=require('../model-fixture-results/host-astronaut-analysis.json').landmarks;
const xs=captured.map(p=>p.x),ys=captured.map(p=>p.y),left=Math.min(...xs),top=Math.min(...ys),fw=Math.max(...xs)-left,fh=Math.max(...ys)-top;
function image(width,height){const data=new Uint8ClampedArray(width*height*4);let state=813;for(let i=0;i<width*height;i++){state=(Math.imul(state,1664525)+1013904223)>>>0;const cool=i%37<4;data.set([cool?55:145+state%71,90+(state>>>8)%62,cool?190:65+(state>>>16)%44,i%11===0?0:i%7===0?97:255],i*4);}return{width,height,data};}
function face(x=.22,y=.12,w=.55,h=.75){return captured.map(p=>({x:x+(p.x-left)/fw*w,y:y+(p.y-top)/fh*h}));}
const beautySpecs=[
 {name:'transparent-mixed-face',width:321,height:257,settings:{smooth:65},faces:[face()]},
 {name:'all-controls-overlap',width:241,height:203,settings:{smooth:100,brighten:100,warmth:-80,underEye:70,redness:90,lip:80,blush:65,palette:'rose'},faces:[face(),face(.28,.16,.5,.72)]},
 {name:'lip-only',width:239,height:199,settings:{lip:100},faces:[face()]},
 {name:'face-at-boundary',width:173,height:211,settings:{smooth:45,brighten:60,warmth:55},faces:[face(-.08,-.06,.6,.85)]},
 {name:'manual-top-left',width:1031,height:31,settings:{smooth:100,brighten:50,region:{x:0,y:0,r:.49}}},
 {name:'manual-bottom-right',width:31,height:1033,settings:{smooth:65,warmth:100,region:{x:1,y:1,r:.5}}},
 {name:'one-column-work',width:2,height:1501,settings:{brighten:100,region:{x:.5,y:.49,r:.5}}},
 {name:'one-row-work',width:1501,height:1,settings:{smooth:100,region:{x:.5,y:0,r:.5}}},
 {name:'single-pixel',width:1,height:1,settings:{smooth:100,brighten:100,region:{x:0,y:0,r:.5}}},
 {name:'no-face',width:77,height:63,settings:{smooth:100,lip:100}},
 {name:'neutral',width:73,height:59,settings:{},faces:[face()]}
];
const edgeSpecs=[{name:'mixed-alpha',width:83,height:71},{name:'downsample-horizontal',width:1031,height:29},{name:'downsample-vertical',width:17,height:1057},{name:'one-row',width:1537,height:1},{name:'one-column',width:1,height:1561},{name:'single',width:1,height:1}];
function edgeInput(spec){const im=image(spec.width,spec.height),data=new Float32Array(spec.width*spec.height),values=[0,.02,.02001,.17,.5,.97999,.98,1];for(let i=0;i<data.length;i++)data[i]=values[i%values.length];return{image:im,mask:{width:spec.width,height:spec.height,data}};}
module.exports={image,beautySpecs,edgeSpecs,edgeInput};
