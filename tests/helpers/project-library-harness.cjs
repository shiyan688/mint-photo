'use strict';
// Production storage/controller/editor scripts with a fault-injected IDB backend.
// Native Canvas/PNG decode is real; DOM and IndexedDB are explicitly not browser.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {makeHarness,assets,root}=require('../../quality/paint-layer-evidence/editor-harness.cjs');
function attach(h){
 const env=h.env;env.assert=require('node:assert/strict');h.$('busy').hidden=true;env.crypto=webcrypto;env.setImmediate=setImmediate;
 for(const name of ['project-library','project-library-controller','project-library-ui','project-backup','project-backup-transport','project-backup-ui'])vm.runInContext(fs.readFileSync(path.join(assets,name+'.js'),'utf8'),env,{filename:name+'.js'});
 const text=fs.readFileSync(path.join(root,'tests/project-library.test.cjs'),'utf8');
 const source=text.slice(text.indexOf('function namedError('),text.indexOf('function validate(record)'));
 // Emulate structured-clone into the receiving realm, preserving native Blob bytes.
 const setup=`(()=>{const Library=MintProjectLibrary,S=Library.STORES;const copy=value=>{if(value===null||typeof value!=='object')return value;if(value instanceof Blob)return new Blob([value],{type:value.type});if(Array.isArray(value))return value.map(copy);const out={};for(const k of Object.keys(value))out[k]=copy(value[k]);return out;};${source};window.__projectStorageBackend=adapter();window.indexedDB=__projectStorageBackend.indexedDB;})()`;
 vm.runInContext(setup,env);env.__probe.initialiseProjectLibrary();
 return Object.assign(h,{backend:env.__projectStorageBackend,library:env.__probe.library,libraryUI:env.__probe.libraryUI,store:env.__probe.projectStorage()});
}
function harness(nativeFactory){return attach(makeHarness(nativeFactory));}
module.exports={harness,attach};
