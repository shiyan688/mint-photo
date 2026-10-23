'use strict';
/* Constructs NEW visible-selection edits. Stored v1 mask recipes are unchanged. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MintSelectionEdit=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function fail(message){throw new Error('SELECTION_EDIT: '+message);}
  function record(value,allowed,required,label){
    if(!value||typeof value!=='object'||Array.isArray(value))fail(label+' must be a data object');
    const proto=Object.getPrototypeOf(value);
    if(proto!==Object.prototype&&proto!==null)fail(label+' has an unsafe prototype');
    const out=Object.create(null),descriptors=Object.getOwnPropertyDescriptors(value);
    for(const key of Reflect.ownKeys(descriptors)){
      if(typeof key!=='string'||!allowed.includes(key))fail(label+' has an unsupported field');
      const d=descriptors[key];
      if(!Object.prototype.hasOwnProperty.call(d,'value')||!d.enumerable)fail(label+' must contain own enumerable data');
      out[key]=d.value;
    }
    for(const key of required)if(!Object.prototype.hasOwnProperty.call(out,key))fail(label+' is missing '+key);
    return out;
  }
  function createEditor(manualTools){
    if(!manualTools||typeof manualTools!=='object')fail('manual selection validator is required');
    const d=Object.getOwnPropertyDescriptor(manualTools,'validateSelection');
    if(!d||typeof d.value!=='function')fail('manual selection validator is required');
    const validate=d.value;
    function context(options){
      const o=record(options,['sourceRevision'],['sourceRevision'],'options');
      // Use the single authoritative validator for revision bounds and recipes.
      validate({version:1,sourceRevision:o.sourceRevision,base:'none',inverted:false,feather:0,commands:[]},{sourceRevision:o.sourceRevision});
      return {sourceRevision:o.sourceRevision};
    }
    function empty(sourceRevision,base){return {version:1,sourceRevision,base,inverted:false,feather:0,commands:[]};}
    function append(recipe,command,options){
      const ctx=context(options),single=empty(ctx.sourceRevision,'none');
      single.commands=[command];
      const c=validate(single,ctx).commands[0];
      const next=recipe===null?empty(ctx.sourceRevision,c.mode==='subtract'?'all':'none'):validate(recipe,ctx);
      // The UI mode acts on the VISIBLE mask; v1 commands act before inversion.
      if(next.inverted)c.mode=c.mode==='add'?'subtract':'add';
      next.commands.push(c);
      return validate(next,ctx);
    }
    function setFeather(recipe,amount,options){
      const ctx=context(options);
      if(typeof amount!=='number'||!Number.isFinite(amount)||amount<0||amount>.1)fail('feather is outside 0..0.1');
      // Feather alone must not silently turn unrestricted editing into an empty mask.
      if(recipe===null)return null;
      const next=validate(recipe,ctx);next.feather=amount;
      return validate(next,ctx);
    }
    return Object.freeze({append,setFeather});
  }
  return Object.freeze({VERSION:1,createEditor});
});
