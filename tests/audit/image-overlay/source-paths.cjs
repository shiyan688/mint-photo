'use strict';
const path=require('node:path'),fs=require('node:fs');
// Default location in source package: tests/audit/image-overlay.
const root=path.resolve(process.env.MINT_SOURCE_ROOT||path.join(__dirname,'../../..'));
const assets=path.join(root,'app/src/main/assets');
if(!fs.existsSync(path.join(assets,'image-overlay.js')))throw Error('Set MINT_SOURCE_ROOT to the photo-editor source root, or place this directory at tests/audit/image-overlay.');
const output=path.resolve(process.env.MINT_AUDIT_OUTPUT||path.join(__dirname,'results'));
fs.mkdirSync(output,{recursive:true});
module.exports={root,assets,output};
