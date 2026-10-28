'use strict';
// Two independent VM contexts execute the unchanged production JS as distinct pages.
// Native callback scheduling below is simulated; this is not an Android device run.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const file=path.join(__dirname,'portrait-ui.test.cjs'),source=fs.readFileSync(file,'utf8'),end=source.indexOf('(async () => {');assert(end>0);
const m={exports:{}};new Function('require','module','exports','__dirname',source.slice(0,end)+'\nmodule.exports={harness,mask};')(createRequire(file),m,m.exports,__dirname);
const {harness,mask}=m.exports;
test('fresh pages have distinct IDs and cannot consume a stale previous-page callback',()=>{
 const oldPage=harness({native:true});oldPage.setup('background');oldPage.click('detectPortrait');const oldId=oldPage.requests[0].id;
 const current=harness({native:true});current.setup('background');current.click('detectPortrait');const id=current.requests[0].id;
 assert.match(oldId,/^portrait-[0-9a-f]{32}-1$/);assert.match(id,/^portrait-[0-9a-f]{32}-1$/);assert.notEqual(id,oldId);
 current.env.window.onPortraitAnalysis(oldId,JSON.stringify({ok:true,mask:mask(8,8)}));assert.equal(current.env.draft.ready,false);
 const expected={width:8,height:8,data:Buffer.alloc(64,128).toString('base64')};current.env.window.onPortraitAnalysis(id,JSON.stringify({ok:true,mask:expected}));assert.equal(current.env.draft.ready,true);assert.equal(current.env.draft.recipe.base.data,expected.data);
});
test('canceled same-page request is ignored and native busy does not corrupt manual state',()=>{
 const h=harness({native:true});h.setup('background');h.click('detectPortrait');const first=h.requests[0].id;h.ui.cancelJob();h.click('detectPortrait');const second=h.requests[1].id;assert.notEqual(first,second);
 h.env.window.onPortraitAnalysis(first,JSON.stringify({ok:true,mask:mask(8,8)}));assert.equal(h.env.draft.ready,false);
 h.env.window.onPortraitAnalysis(second,JSON.stringify({ok:false,error:'正在分析上一张照片，请稍后重试。'}));assert.match(h.notices.at(-1),/上一张照片/);assert.equal(h.env.draft.ready,false);h.click('manualMask');assert.equal(h.env.draft.recipe.strokes.length,0);
});
test('missing or failing secure random fails closed and leaves manual mode available',()=>{
 for(const crypto of [undefined,{getRandomValues(){throw Error('rng failure')}}]){const h=harness({native:true});h.env.crypto=crypto;h.setup('background');h.click('detectPortrait');assert.equal(h.requests.length,0);assert.match(h.notices.at(-1),/手动工具/);assert.equal(h.env.draft.ready,false);assert.equal(h.timers.size,0);h.click('manualMask');assert.equal(h.env.draft.recipe.strokes.length,0);}
});
