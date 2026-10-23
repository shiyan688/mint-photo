/* Mint project backup v1. Binary, bounded, local-only; no paths, fetch, decoder,
 * canvas, storage, or crypto.subtle dependency. SHA-256 detects corruption only:
 * backups are neither authenticated nor encrypted and contain private source data.
 */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MintProjectBackup = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const MiB = 1024 * 1024;
  const LIMITS = Object.freeze({ headerBytes: 80, totalBytes: 64 * MiB, maxBytes: 64 * MiB, manifestBytes: 24 * MiB,
    sourceBytes: 40 * MiB, sourcePixels: 80000000, sourceEdge: 1000000,
    hashChunkBytes: MiB, imageReadBytes: 65536, imageChunks: 4096,
    depth: 64, nodes: 2000000, stringBytes: 6 * MiB, allStringBytes: 24 * MiB,
    keyBytes: 256, numberCharacters: 128, nameCodePoints: 80, nameBytes: 320 });
  const MAGIC = 'MINTPRJ1', FORMAT = 'mint-photo-project', MIME = 'application/vnd.mint.photo-project', EXTENSION = '.mintproject';
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const descriptor = Object.getOwnPropertyDescriptor, keys = Reflect.ownKeys;
  const B = root.Blob, blobSize = B && descriptor(B.prototype, 'size').get,
    blobType = B && descriptor(B.prototype, 'type').get,
    blobSlice = B && B.prototype.slice, blobBuffer = B && B.prototype.arrayBuffer;
  function fail(code, message) { const e = new Error(message); e.name = 'ProjectBackupError'; e.code = code; throw e; }
  function check(ok, code, message) { if (!ok) fail(code, message); }
  function invalid(ok, message) { check(ok, 'INVALID_PROJECT', message); }
  function poison(key) { return key === '__proto__' || key === 'prototype' || key === 'constructor'; }
  function nativeSize(value) { try { return blobSize.call(value); } catch (_) { fail('INVALID_BLOB', '项目必须是本机文件，不能使用路径或网址'); } }
  function native(value) { if (!blobSize) return false; try { blobSize.call(value); return true; } catch (_) { return false; } }
  function optionData(input, allowed, required, label) {
    invalid(input && typeof input === 'object' && !Array.isArray(input) && [Object.prototype, null].includes(Object.getPrototypeOf(input)), label + '必须是普通对象');
    const out = Object.create(null);
    for (const key of keys(input)) {
      const d = descriptor(input, key);
      invalid(typeof key === 'string' && allowed.includes(key) && d && d.enumerable && own(d, 'value'), label + '包含未知字段或访问器');
      put(out, key, d.value);
    }
    invalid(required.every(key => own(out, key)), label + '缺少必要字段'); return out;
  }
  function settings(options, named) {
    const out = optionData(options === undefined ? Object.create(null) : options, named ? ['name', 'shouldCancel'] : ['shouldCancel'], named ? ['name'] : [], '项目选项');
    invalid(out.shouldCancel === undefined || typeof out.shouldCancel === 'function', '项目取消选项无效'); return out;
  }
  function method(input, key) {
    invalid(input && typeof input === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(input)), '项目验证模块无效');
    const d = descriptor(input, key);
    invalid(d && d.enumerable && own(d, 'value') && typeof d.value === 'function', '项目验证模块缺少本机方法：' + key); return d.value;
  }
  function canceled(options) { if (options.shouldCancel && options.shouldCancel()) fail('PROJECT_BACKUP_CANCELED', '项目备份操作已取消'); }
  async function pause(options) { canceled(options); await new Promise(resolve => root.setTimeout(resolve, 0)); canceled(options); }
  async function read(blob, start, end, options) {
    canceled(options);
    const part = blobSlice.call(blob, start, end);
    let buffer;
    if (blobBuffer) buffer = await blobBuffer.call(part);
    else {
      check(typeof root.FileReader === 'function', 'UNAVAILABLE', '本机文件读取接口不可用');
      buffer = await new Promise((resolve, reject) => { const r = new root.FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error || new Error('文件读取失败')); r.readAsArrayBuffer(part); });
    }
    canceled(options);
    check(buffer.byteLength === end - start, 'TRUNCATED', '项目文件读取长度不一致');
    return new Uint8Array(buffer);
  }
  function unicode(text, max) {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) { const n = text.charCodeAt(++i); invalid(n >= 0xdc00 && n <= 0xdfff, '项目包含无效 Unicode'); bytes += 4; }
      else { invalid(c < 0xdc00 || c > 0xdfff, '项目包含无效 Unicode'); bytes += c < 128 ? 1 : c < 2048 ? 2 : 3; }
      check(bytes <= max, 'MANIFEST_TOO_LARGE', '项目文字超过安全上限');
    }
    return bytes;
  }
  function safeRealm() {
    for (const p of [Object.prototype, Array.prototype]) for (const k of keys(p)) {
      const d = descriptor(p, k);
      invalid(k !== 'toJSON', '项目验证环境包含不安全序列化器');
      invalid(own(d, 'value') || p === Object.prototype && k === '__proto__', '项目验证环境包含不安全访问器');
    }
  }
  function put(o, k, v) { Object.defineProperty(o, k, { value: v, writable: true, configurable: true, enumerable: true }); }
  // The complete record is copied synchronously before the first asynchronous read.
  // Never invoke caller getters/toJSON, accept sparse arrays, or serialize hidden data.
  function snapshot(input, allowBlob) {
    let nodes = 0, strings = 0, found = null;
    const active = new Set();
    function str(value, key) {
      strings += unicode(value, key ? LIMITS.keyBytes : LIMITS.stringBytes);
      check(strings <= LIMITS.allStringBytes, 'MANIFEST_TOO_LARGE', '项目文字总量超过安全上限'); return value;
    }
    function copy(v, path, depth) {
      invalid(++nodes <= LIMITS.nodes && depth <= LIMITS.depth, '项目结构超过安全上限');
      if (v === null || typeof v === 'boolean') return v;
      if (typeof v === 'string') return str(v, false);
      if (typeof v === 'number') { invalid(Number.isFinite(v), '项目包含非有限数字'); return v === 0 ? 0 : v; }
      if (allowBlob && native(v)) {
        invalid((path === 'source.blob' || path === 'blob') && !found, '项目只能包含一个原照片文件');
        const size = nativeSize(v); check(size >= 1 && size <= LIMITS.sourceBytes, 'SOURCE_TOO_LARGE', '照片文件须为 1 字节至 40 MiB');
        found = blobSlice.call(v, 0, size, blobType.call(v)); return found;
      }
      invalid(v && typeof v === 'object' && !active.has(v), '项目包含循环或不可存储的值');
      const array = Array.isArray(v), p = Object.getPrototypeOf(v);
      invalid(array ? p === Array.prototype : p === Object.prototype || p === null, '项目不能包含自定义对象');
      active.add(v);
      const actual = keys(v), out = array ? [] : Object.create(null);
      invalid(actual.length <= LIMITS.nodes, '项目字段过多');
      if (array) {
        const len = descriptor(v, 'length').value;
        invalid(Number.isSafeInteger(len) && len <= LIMITS.nodes && actual.length === len + 1, '项目列表包含额外字段或缺失项');
        for (let i = 0; i < len; i++) { const d = descriptor(v, String(i)); invalid(d && d.enumerable && own(d, 'value'), '项目列表不能包含访问器或缺失项'); put(out, String(i), copy(d.value, path + '.' + i, depth + 1)); }
      } else for (const k of actual) {
        const d = descriptor(v, k);
        invalid(typeof k === 'string' && !poison(k) && d.enumerable && own(d, 'value'), '项目不能包含不安全字段或访问器');
        str(k, true); put(out, k, copy(d.value, path ? path + '.' + k : k, depth + 1));
      }
      active.delete(v); return out;
    }
    const value = copy(input, '', 0); return { value, blob: found };
  }
  function fields(v, allowed, required) {
    invalid(v && typeof v === 'object' && !Array.isArray(v), '项目对象无效');
    invalid(Object.keys(v).every(k => allowed.includes(k)) && (required || allowed).every(k => own(v, k)), '项目包含未知字段或缺少必要字段');
  }
  function retained(input, output) {
    if (!input || typeof input !== 'object' || native(input)) return;
    invalid(output && typeof output === 'object' && Array.isArray(input) === Array.isArray(output), '项目验证丢失了已有结构');
    if (Array.isArray(input)) invalid(input.length === output.length, '项目验证改变了历史长度');
    for (const k of Object.keys(input)) { invalid(own(output, k), '项目包含验证器未识别的字段：' + k); retained(input[k], output[k]); }
  }
  // Duplicate-aware, bounded JSON parser. JSON.parse is used ONLY for an already
  // lexically checked individual string token, never for an object/document.
  function parseJSON(text) {
    let p = 0, nodes = 0, strings = 0;
    const ws = () => { while (p < text.length && [32, 9, 10, 13].includes(text.charCodeAt(p))) p++; };
    function string(key) {
      invalid(text[p++] === '"', '项目 JSON 字符串无效'); const start = p - 1;
      while (p < text.length) {
        const c = text.charCodeAt(p++);
        if (c === 34) {
          let s; try { s = JSON.parse(text.slice(start, p)); } catch (_) { fail('INVALID_PROJECT', '项目 JSON 转义无效'); }
          strings += unicode(s, key ? LIMITS.keyBytes : LIMITS.stringBytes);
          check(strings <= LIMITS.allStringBytes, 'MANIFEST_TOO_LARGE', '项目文字总量超过安全上限'); return s;
        }
        invalid(c >= 32, '项目 JSON 包含未转义控制字符');
        if (c === 92) {
          const e = text[p++];
          if (e === 'u') { invalid(/^[0-9a-fA-F]{4}$/.test(text.slice(p, p + 4)), '项目 Unicode 转义无效'); p += 4; }
          else invalid(['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(e), '项目 JSON 转义无效');
        }
        invalid(p - start <= (key ? LIMITS.keyBytes : LIMITS.stringBytes) * 6 + 2, '项目字符串标记过大');
      }
      fail('INVALID_PROJECT', '项目 JSON 字符串被截断');
    }
    const digit = c => c >= '0' && c <= '9';
    function number() {
      const start = p; let nonzero = false;
      if (text[p] === '-') p++;
      if (text[p] === '0') p++;
      else { invalid(text[p] >= '1' && text[p] <= '9', '项目 JSON 数字无效'); while (digit(text[p])) { if (text[p] !== '0') nonzero = true; p++; } }
      if (text[p] === '.') { p++; invalid(digit(text[p]), '项目 JSON 小数无效'); while (digit(text[p])) { if (text[p] !== '0') nonzero = true; p++; } }
      if (text[p] === 'e' || text[p] === 'E') { p++; if (text[p] === '+' || text[p] === '-') p++; invalid(digit(text[p]), '项目 JSON 指数无效'); while (digit(text[p])) p++; }
      invalid(p - start <= LIMITS.numberCharacters, '项目数字标记过大');
      const v = Number(text.slice(start, p)); invalid(Number.isFinite(v) && !(v === 0 && nonzero), '项目数字溢出或下溢'); return v === 0 ? 0 : v;
    }
    function value(depth) {
      invalid(++nodes <= LIMITS.nodes && depth <= LIMITS.depth, '项目 JSON 结构超过安全上限'); ws(); const c = text[p];
      if (c === '"') return string(false);
      if (c === '{') {
        p++; ws(); const o = Object.create(null);
        if (text[p] === '}') { p++; return o; }
        while (true) {
          const k = string(true); invalid(!poison(k) && !own(o, k), '项目 JSON 包含危险键或重复键');
          ws(); invalid(text[p++] === ':', '项目 JSON 缺少冒号'); put(o, k, value(depth + 1)); ws(); const end = text[p++];
          if (end === '}') return o; invalid(end === ',', '项目 JSON 对象分隔符无效'); ws();
        }
      }
      if (c === '[') {
        p++; ws(); const a = [];
        if (text[p] === ']') { p++; return a; }
        while (true) { a.push(value(depth + 1)); ws(); const end = text[p++]; if (end === ']') return a; invalid(end === ',', '项目 JSON 列表分隔符无效'); }
      }
      for (const [word, v] of [['true', true], ['false', false], ['null', null]]) if (text.slice(p, p + word.length) === word) { p += word.length; return v; }
      return number();
    }
    const result = value(0); ws(); invalid(p === text.length, '项目 JSON 含尾随内容'); return result;
  }
  function decodeUTF8(bytes) {
    // Explicit scalar UTF-8 validation, including BOM rejection and overlong forms.
    const parts = [], units = []; let p = 0;
    function unit(c) { units.push(c); if (units.length >= 8192) { parts.push(String.fromCharCode.apply(null, units)); units.length = 0; } }
    invalid(!(bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191), '项目 JSON 不能包含 UTF-8 BOM');
    while (p < bytes.length) {
      let c = bytes[p++], count = 0, min = 0;
      if (c < 128) { unit(c); continue; }
      if (c >= 194 && c <= 223) { c &= 31; count = 1; min = 128; }
      else if (c >= 224 && c <= 239) { c &= 15; count = 2; min = 2048; }
      else if (c >= 240 && c <= 244) { c &= 7; count = 3; min = 65536; }
      else fail('INVALID_UTF8', '项目清单不是有效 UTF-8');
      check(p + count <= bytes.length, 'INVALID_UTF8', '项目 UTF-8 被截断');
      for (let i = 0; i < count; i++) { const b = bytes[p++]; check((b & 192) === 128, 'INVALID_UTF8', '项目 UTF-8 续字节无效'); c = c * 64 + (b & 63); }
      check(c >= min && c <= 1114111 && !(c >= 55296 && c <= 57343), 'INVALID_UTF8', '项目 UTF-8 标量无效');
      if (c < 65536) unit(c); else { c -= 65536; unit(55296 + (c >> 10)); unit(56320 + (c & 1023)); }
    }
    if (units.length) parts.push(String.fromCharCode.apply(null, units)); return parts.join('');
  }
  const K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  const rotr = (v, n) => (v >>> n) | (v << (32 - n));
  class SHA256 {
    constructor() { this.h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]); this.w = new Uint32Array(64); this.tail = new Uint8Array(64); this.used = 0; this.length = 0; }
    block(bytes, off) {
      const w = this.w, h = this.h;
      for (let i = 0; i < 16; i++) { const j = off + i * 4; w[i] = (bytes[j] << 24) | (bytes[j+1] << 16) | (bytes[j+2] << 8) | bytes[j+3]; }
      for (let i = 16; i < 64; i++) { const a = w[i-15], b = w[i-2]; w[i] = w[i-16] + (rotr(a,7)^rotr(a,18)^(a>>>3)) + w[i-7] + (rotr(b,17)^rotr(b,19)^(b>>>10)); }
      let [a,b,c,d,e,f,g,j] = h;
      for (let i = 0; i < 64; i++) { const t = (j + (rotr(e,6)^rotr(e,11)^rotr(e,25)) + ((e&f)^(~e&g)) + K[i] + w[i]) >>> 0, u = ((rotr(a,2)^rotr(a,13)^rotr(a,22)) + ((a&b)^(a&c)^(b&c))) >>> 0; j=g;g=f;f=e;e=(d+t)>>>0;d=c;c=b;b=a;a=(t+u)>>>0; }
      h[0]+=a;h[1]+=b;h[2]+=c;h[3]+=d;h[4]+=e;h[5]+=f;h[6]+=g;h[7]+=j;
    }
    update(b) {
      this.length += b.length; let p = 0;
      if (this.used) { const n = Math.min(64 - this.used, b.length); this.tail.set(b.subarray(0,n),this.used); this.used += n; p = n; if (this.used === 64) { this.block(this.tail,0); this.used=0; } }
      for (; p + 64 <= b.length; p += 64) this.block(b,p);
      if (p < b.length) { this.tail.set(b.subarray(p),0); this.used=b.length-p; }
    }
    digest() {
      const bits = this.length * 8, pad = new Uint8Array(this.used < 56 ? 64 : 128); pad.set(this.tail.subarray(0,this.used)); pad[this.used]=128;
      const view = new DataView(pad.buffer); view.setUint32(pad.length-8,Math.floor(bits/4294967296));view.setUint32(pad.length-4,bits>>>0);
      this.block(pad,0); if(pad.length===128)this.block(pad,64);
      const out=new Uint8Array(32), dv=new DataView(out.buffer); for(let i=0;i<8;i++)dv.setUint32(i*4,this.h[i]); return out;
    }
  }
  const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2,'0')).join('');
  const unhex = value => Uint8Array.from(value.match(/../g), s => parseInt(s,16));
  async function sha256Blob(blob, inputOptions) {
    const options=settings(inputOptions), size=nativeSize(blob); check(size<=LIMITS.totalBytes,'FILE_TOO_LARGE','校验文件超过64MiB');
    const h=new SHA256(); canceled(options);
    for(let p=0;p<size;p+=LIMITS.hashChunkBytes){h.update(await read(blob,p,Math.min(size,p+LIMITS.hashChunkBytes),options));await pause(options);}
    canceled(options);return hex(h.digest());
  }
  function inspectHeader(bytes,totalBytes) {
    check(bytes instanceof Uint8Array&&bytes.length===80,'INVALID_HEADER','项目文件头必须为80字节');
    check(Number.isSafeInteger(totalBytes)&&totalBytes>=82&&totalBytes<=LIMITS.totalBytes,'FILE_TOO_LARGE','项目文件须不超过64MiB');
    check(MAGIC.split('').every((c,i)=>bytes[i]===c.charCodeAt(0)),'INVALID_HEADER','不是支持的薄荷项目文件');
    const v=new DataView(bytes.buffer,bytes.byteOffset,80),manifestLength=v.getUint32(8,true),sourceLength=v.getUint32(12,true);
    check(manifestLength>=1&&manifestLength<=LIMITS.manifestBytes,'MANIFEST_TOO_LARGE','项目清单须不超过24MiB');
    check(sourceLength>=1&&sourceLength<=LIMITS.sourceBytes,'SOURCE_TOO_LARGE','项目照片须不超过40MiB');
    check(80+manifestLength+sourceLength===totalBytes,'INVALID_LENGTH','项目文件被截断或含尾随数据');
    return Object.freeze({manifestLength,sourceLength,manifestSha256:hex(bytes.subarray(16,48)),sourceSha256:hex(bytes.subarray(48,80))});
  }
  function dimensions(width,height) {
    check(Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&width>0&&height>0&&width<=LIMITS.sourceEdge&&height<=LIMITS.sourceEdge&&width*height<=LIMITS.sourcePixels,'IMAGE_DIMENSIONS','照片尺寸无效或超过8000万像素');return{width,height};
  }
  // Reads only bounded windows, even for JPEG scan data. No image-sized buffer.
  async function inspectSource(blob,options) {
    const n=nativeSize(blob);check(n>=1&&n<=LIMITS.sourceBytes,'SOURCE_TOO_LARGE','照片文件须为1字节至40MiB');
    let cache=null,start=0;
    async function at(p,len) {
      check(p>=0&&len>=0&&p+len<=n,'INVALID_IMAGE','照片结构被截断');
      if(!cache||p<start||p+len>start+cache.length){start=p;cache=await read(blob,p,Math.min(n,p+Math.max(len,LIMITS.imageReadBytes)),options);await pause(options);}
      return cache.subarray(p-start,p-start+len);
    }
    const tag=(b,p=0)=>String.fromCharCode(b[p],b[p+1],b[p+2],b[p+3]),be16=(b,p=0)=>b[p]*256+b[p+1],be32=(b,p=0)=>b[p]*16777216+b[p+1]*65536+b[p+2]*256+b[p+3],le16=(b,p=0)=>b[p]+256*b[p+1],le24=(b,p=0)=>b[p]+256*b[p+1]+65536*b[p+2],le32=(b,p=0)=>b[p]+256*b[p+1]+65536*b[p+2]+16777216*b[p+3];
    const head=await at(0,Math.min(n,12));let result;
    if(n>=33&&[137,80,78,71,13,10,26,10].every((v,i)=>head[i]===v)){
      let p=8,count=0,header=false,idat=false,ended=false,endedIdat=false;
      while(p<n){check(++count<=LIMITS.imageChunks,'INVALID_IMAGE','PNG块数量超限');const b=await at(p,8),len=be32(b),kind=tag(b,4),q=p+8;check(len<=n-p-12&&/^[A-Za-z]{4}$/.test(kind),'INVALID_IMAGE','PNG块长度或名称无效');
        check(!['acTL','fcTL','fdAT'].includes(kind),'INVALID_IMAGE','项目照片不支持动画PNG');
        if(kind==='IHDR'){check(!header&&p===8&&len===13,'INVALID_IMAGE','PNG尺寸头无效');const a=await at(q,13);result={mime:'image/png',...dimensions(be32(a),be32(a,4))};check(([0,2,3,4,6].includes(a[9]))&&({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]})[a[9]].includes(a[8])&&a[10]===0&&a[11]===0&&a[12]<=1,'INVALID_IMAGE','PNG参数无效');header=true;}
        else check(header,'INVALID_IMAGE','PNG缺少尺寸头');
        if(kind==='IDAT'){check(!endedIdat,'INVALID_IMAGE','PNG数据块顺序无效');idat=true;}else if(idat)endedIdat=true;
        if(kind==='IEND'){check(len===0&&idat&&p+12===n,'INVALID_IMAGE','PNG结束块无效');ended=true;}
        if(kind[0]===kind[0].toUpperCase())check(['IHDR','PLTE','IDAT','IEND'].includes(kind),'INVALID_IMAGE','PNG关键块不受支持');
        p=q+len+4;
      }
      check(header&&idat&&ended,'INVALID_IMAGE','PNG照片不完整');
    }else if(n>=4&&head[0]===255&&head[1]===216){
      let p=2,count=0,frame=false,scan=false,ended=false;
      while(p<n){check(++count<=LIMITS.imageChunks,'INVALID_IMAGE','JPEG块数量超限');check((await at(p++,1))[0]===255,'INVALID_IMAGE','JPEG标记无效');while(p<n&&(await at(p,1))[0]===255)p++;check(p<n,'INVALID_IMAGE','JPEG标记截断');const marker=(await at(p++,1))[0];
        if(marker===217){check(frame&&scan&&p===n,'INVALID_IMAGE','JPEG结束标记无效');ended=true;break;}
        check(marker!==0&&marker!==216&&marker!==1&&!(marker>=208&&marker<=215),'INVALID_IMAGE','JPEG图片头标记无效');
        const len=be16(await at(p,2));check(len>=2&&p+len<=n,'INVALID_IMAGE','JPEG块长度无效');
        if(marker>=192&&marker<=207&&![196,200,204].includes(marker)){check([192,193,194].includes(marker)&&!frame&&len>=11,'INVALID_IMAGE','仅支持常见8位静态JPEG');const b=await at(p,8),components=b[7];check(b[2]===8&&[1,3,4].includes(components)&&len===8+3*components,'INVALID_IMAGE','JPEG尺寸头无效');result={mime:'image/jpeg',...dimensions(be16(b,5),be16(b,3))};frame=true;}
        if(marker===218){const b=await at(p,3);check(frame&&len>=8&&len===6+2*b[2]&&b[2]>=1&&b[2]<=4&&p+len<n,'INVALID_IMAGE','JPEG扫描头无效');scan=true;p+=len;let terminated=false;
          while(p<n){await at(p,1);const off=p-start,index=cache.indexOf(255,off);if(index<0){p=start+cache.length;continue;}p=start+index;const markerStart=p;while(p<n&&(await at(p,1))[0]===255)p++;check(p<n,'INVALID_IMAGE','JPEG扫描截断');const code=(await at(p,1))[0];if(code===0||(code>=208&&code<=215)){p++;continue;}p=markerStart;terminated=true;break;}
          check(terminated,'INVALID_IMAGE','JPEG扫描不完整');
        }else p+=len;
      }
      check(frame&&scan&&ended,'INVALID_IMAGE','JPEG照片不完整');
    }else if(n>=12&&tag(head)==='RIFF'&&tag(head,8)==='WEBP'){
      check(le32(head,4)+8===n,'INVALID_IMAGE','WebP长度无效');let p=12,count=0,extended=null,frame=null;
      while(p<n){check(++count<=LIMITS.imageChunks,'INVALID_IMAGE','WebP块数量超限');const b=await at(p,8),kind=tag(b),len=le32(b,4),q=p+8;check(q+len+(len%2)<=n,'INVALID_IMAGE','WebP块长度无效');if(len%2)check((await at(q+len,1))[0]===0,'INVALID_IMAGE','WebP填充无效');check(kind!=='ANIM'&&kind!=='ANMF','INVALID_IMAGE','项目照片不支持动画WebP');
        if(kind==='VP8X'){check(p===12&&len===10&&!extended,'INVALID_IMAGE','WebP扩展头无效');const a=await at(q,10);check((a[0]&195)===0&&a[1]===0&&a[2]===0&&a[3]===0,'INVALID_IMAGE','WebP扩展参数无效或为动画');extended=dimensions(le24(a,4)+1,le24(a,7)+1);}
        if(kind==='VP8 '){check(!frame&&len>=10,'INVALID_IMAGE','WebP图像头无效');const a=await at(q,10);check((a[0]&1)===0&&a[3]===157&&a[4]===1&&a[5]===42,'INVALID_IMAGE','WebP VP8头无效');frame=dimensions(le16(a,6)&16383,le16(a,8)&16383);}
        if(kind==='VP8L'){check(!frame&&len>=5,'INVALID_IMAGE','WebP无损头无效');const a=await at(q,5);check(a[0]===47&&(a[4]>>5)===0,'INVALID_IMAGE','WebP无损参数无效');frame=dimensions(1+a[1]+((a[2]&63)<<8),1+(a[2]>>6)+(a[3]<<2)+((a[4]&15)<<10));}
        p=q+len+(len%2);
      }
      check(frame,'INVALID_IMAGE','WebP缺少图像');if(extended)check(extended.width===frame.width&&extended.height===frame.height,'INVALID_IMAGE','WebP图像尺寸不一致');result={mime:'image/webp',...frame};
    }else fail('INVALID_IMAGE','项目照片仅支持PNG、JPEG和WebP文件');
    canceled(options);return result;
  }
  function createCodec(config) {
    const dependencies = optionData(config, ['projectCore', 'projectLibrary'], ['projectCore'], '项目验证配置');
    const restoreProject = method(dependencies.projectCore, 'restoreProject'), draftRecord = method(dependencies.projectCore, 'draftRecord');
    const normalizeName = dependencies.projectLibrary === undefined ? null : method(dependencies.projectLibrary, 'normalizeName');
    function name(input,strict) {
      invalid(typeof input==='string'&&input.length<=1024,'项目名称无效');unicode(input,LIMITS.nameBytes*4);
      const normalized=normalizeName?normalizeName(input):input.normalize('NFC').trim();
      invalid(normalized.length>0&&Array.from(normalized).length<=LIMITS.nameCodePoints&&unicode(normalized,LIMITS.nameBytes)<=LIMITS.nameBytes&&!/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u.test(normalized),'项目名称须为1至80个字符且不能含控制字符');
      invalid(!strict||normalized===input,'项目名称不是规范格式');return normalized;
    }
    function schema(record,wire) {
      invalid(record&&[1,2].includes(record.version),'项目记录版本不受支持');
      if(record.version===2){fields(record,['version','source','ops','redo']);fields(record.source,['blob','name','width','height','mime','origin']);if(wire)invalid(record.source.blob===null,'项目照片必须使用独立二进制区');}
      else {fields(record,['version','blob','name','ops','redo'],wire?undefined:['version','blob']);if(wire)invalid(record.blob===null,'旧项目照片必须使用独立二进制区');}
    }
    function canonical(record,info) {
      safeRealm();let result;
      if(record.version===2){
        const s=record.source;check((s.width===info.width&&s.height===info.height)||(info.mime==='image/jpeg'&&s.width===info.height&&s.height===info.width),'IMAGE_DIMENSIONS','项目记录尺寸与照片文件头不一致');
        invalid(s.mime===info.mime||s.mime==='application/octet-stream','项目照片格式声明与内容不一致');
        result=draftRecord(record);retained(record,result);
      }else{
        // Validation only. Deliberately discard the temporary v2 result, keeping
        // the v1 working-copy marker for migration AFTER actual host image decode.
        const migrated=restoreProject(record,{width:info.width,height:info.height});
        result={version:1,blob:record.blob,name:migrated.source.name,ops:migrated.ops,redo:migrated.redo};retained(record,result);
      }
      return result;
    }
    async function encode(input,options) {
      const opts=settings(options,true);canceled(opts);safeRealm();
      const copied=snapshot(input,true),record=copied.value;schema(record,false);invalid(copied.blob,'项目缺少原照片文件');
      const projectName=name(opts.name,false),info=await inspectSource(copied.blob,opts),result=canonical(record,info);canceled(opts);
      const raw=snapshot(result,true).value;
      if(raw.version===2)raw.source.blob=null;else raw.blob=null;
      const text=JSON.stringify({format:FORMAT,version:1,name:projectName,record:raw});
      check(unicode(text,LIMITS.manifestBytes)<=LIMITS.manifestBytes,'MANIFEST_TOO_LARGE','项目清单超过24MiB');
      const manifest=new B([text],{type:'application/json'}),source=copied.blob,total=80+nativeSize(manifest)+nativeSize(source);
      check(total<=LIMITS.totalBytes,'FILE_TOO_LARGE','项目备份超过64MiB');
      const hashOptions={shouldCancel:opts.shouldCancel},manifestHash=await sha256Blob(manifest,hashOptions),sourceHash=await sha256Blob(source,hashOptions),header=new Uint8Array(80),view=new DataView(header.buffer);
      for(let i=0;i<MAGIC.length;i++)header[i]=MAGIC.charCodeAt(i);view.setUint32(8,nativeSize(manifest),true);view.setUint32(12,nativeSize(source),true);header.set(unhex(manifestHash),16);header.set(unhex(sourceHash),48);
      canceled(opts);return new B([header,manifest,source],{type:MIME});
    }
    async function decode(file,options) {
      const opts=settings(options);canceled(opts);safeRealm();const total=nativeSize(file);
      check(total>=80&&total<=LIMITS.totalBytes,'FILE_TOO_LARGE','项目文件被截断或超过64MiB');
      const header=inspectHeader(await read(file,0,80,opts),total),manifest=blobSlice.call(file,80,80+header.manifestLength),source=blobSlice.call(file,80+header.manifestLength,total);
      const manifestHash=await sha256Blob(manifest,opts);check(manifestHash===header.manifestSha256,'CHECKSUM_MISMATCH','项目清单校验失败，文件可能损坏');
      const sourceHash=await sha256Blob(source,opts);check(sourceHash===header.sourceSha256,'CHECKSUM_MISMATCH','项目照片校验失败，文件可能损坏');
      const text=decodeUTF8(await read(manifest,0,header.manifestLength,opts)),body=parseJSON(text);canceled(opts);
      fields(body,['format','version','name','record']);invalid(body.format===FORMAT&&body.version===1,'项目备份格式或版本不受支持');const projectName=name(body.name,true);schema(body.record,true);
      const info=await inspectSource(source,opts),photo=new B([source],{type:info.mime});
      if(body.record.version===2)body.record.source.blob=photo;else body.record.blob=photo;
      const record=canonical(body.record,info);canceled(opts);
      return {name:projectName,record,sourceSha256:sourceHash,manifestSha256:manifestHash};
    }
    return Object.freeze({encode,decode});
  }
  return Object.freeze({LIMITS,MIME,EXTENSION,createCodec,inspectHeader,sha256Blob});
});
