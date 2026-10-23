/* Pure project persistence and export planning. No decode, canvas, I/O, or mutation.
 * Source dimensions must be the decoder's actual, EXIF-oriented dimensions.
 * Keep source.blob as the immutable imported Blob; never replace it with a preview.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ProjectCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 2, MAX_STEPS = 60, MAX_PIXELS = 8000000, MAX_EDGE = 4096;
  const WORKING_EDGE = 2560, MAX_MASK_PIXELS = 262144, MAX_DRAW_POINTS = 16384;
  const MAX_SOURCE_PIXELS = 80000000, MAX_SOURCE_BYTES = 40 * 1024 * 1024;
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const fail = message => { throw new Error(message); };
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.prototype.toString.call(value) !== '[object Object]') fail(label + '必须是有效对象');
    return value;
  }
  function fields(value, keys, label) {
    object(value, label);
    for (const key of Object.keys(value)) if (!keys.includes(key)) fail(label + '包含不支持的字段：' + key);
  }
  function number(value, min, max, label) {
    if (!finite(value) || value < min || value > max) fail(label + '超出有效范围');
    return value;
  }
  function integer(value, min, max, label) {
    number(value, min, max, label);
    if (!Number.isSafeInteger(value)) fail(label + '必须是整数');
    return value;
  }
  function flag(value, label) {
    if (typeof value !== 'boolean') fail(label + '必须是布尔值');
    return value;
  }
  function choice(value, choices, label) {
    if (!choices.includes(value)) fail(label + '不受支持');
    return value;
  }
  function list(value, max, label, copy) {
    if (!Array.isArray(value) || value.length > max) fail(label + '无效或超过数量上限 ' + max);
    const out = [];
    for (let i = 0; i < value.length; i++) {
      if (!own(value, i)) fail(label + '包含缺失项');
      out.push(copy(value[i], i));
    }
    return out;
  }
  function size(value, label) {
    object(value, label);
    const width = integer(value.width, 1, 1000000, label + '宽度');
    const height = integer(value.height, 1, 1000000, label + '高度');
    if (!Number.isSafeInteger(width * height)) fail(label + '像素数无效');
    return { width, height };
  }
  function hasBlob(value) {
    if (!value || typeof Blob === 'undefined') return false;
    try { Blob.prototype.slice.call(value, 0, 0); return Number.isSafeInteger(value.size) && value.size > 0; }
    catch (_) { return false; }
  }
  function sourceMetadata(input, requireBlob) {
    object(input, '照片来源');
    const dimensions = size(input, '照片');
    if (dimensions.width * dimensions.height > MAX_SOURCE_PIXELS) fail('照片超过 8000 万像素的导入上限');
    if (requireBlob && !hasBlob(input.blob)) fail('草稿缺少有效照片文件，无法恢复原始像素');
    if (hasBlob(input.blob) && input.blob.size > MAX_SOURCE_BYTES) fail('照片文件超过 40 MiB 的导入上限');
    const origin = input.origin === undefined ? 'original' : choice(input.origin, ['original', 'legacy-working-copy'], '照片来源标记');
    if (input.name !== undefined && typeof input.name !== 'string') fail('照片名称无效');
    const name = (input.name || '照片').trim() || '照片';
    if (name.length > 1024 || /[\u0000-\u001f]/.test(name)) fail('照片名称无效');
    if (input.mime !== undefined && typeof input.mime !== 'string') fail('照片格式无效');
    const mime = (input.mime || (input.blob && input.blob.type) || 'application/octet-stream').trim().toLowerCase();
    if (!/^image\/[a-z0-9.+-]+$/.test(mime) && mime !== 'application/octet-stream') fail('照片格式必须是图片');
    return { blob: input.blob, name, ...dimensions, mime, origin };
  }
  function point(value, label) {
    fields(value, ['x', 'y'], label);
    return { x: number(value.x, 0, 1, label + '横坐标'), y: number(value.y, 0, 1, label + '纵坐标') };
  }
  function circle(value, maxRadius, label) {
    fields(value, ['x', 'y', 'r'], label);
    return { x: number(value.x, 0, 1, label + '横坐标'), y: number(value.y, 0, 1, label + '纵坐标'), r: number(value.r, 0.000001, maxRadius, label + '半径') };
  }
  function color(value) {
    if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) fail('编辑颜色必须是六位十六进制颜色');
    return value;
  }
  function values(value, ranges, label) {
    fields(value, Object.keys(ranges), label);
    const out = {};
    for (const key of Object.keys(value)) out[key] = number(value[key], ranges[key][0], ranges[key][1], label + key);
    return out;
  }
  function landmarks(value) {
    if (value === null || value === undefined) return null;
    if (!Array.isArray(value) || ![468, 478].includes(value.length)) fail('人脸关键点必须包含 468 或 478 个点');
    return list(value, 478, '人脸关键点', p => {
      fields(p, ['x', 'y', 'z'], '人脸关键点');
      // MediaPipe can report points outside the frame. Preserve, do not clamp.
      const out = { x: number(p.x, -4, 4, '关键点横坐标'), y: number(p.y, -4, 4, '关键点纵坐标') };
      if (p.z !== undefined) out.z = number(p.z, -10, 10, '关键点深度');
      return out;
    });
  }
  function mask(value) {
    fields(value, ['width', 'height', 'data', 'maxValue'], '人像蒙版');
    const dimensions = size(value, '蒙版'), length = dimensions.width * dimensions.height;
    if (length > MAX_MASK_PIXELS || Math.max(dimensions.width, dimensions.height) > 4096) fail('人像蒙版过大，最多允许 262144 个像素且单边不超过 4096');
    let data;
    if (typeof value.data === 'string') {
      data = value.data;
      // Verify byte length without decoding or allocating an attacker-sized buffer.
      const expectedLength = Math.ceil(length / 3) * 4;
      if (data.length !== expectedLength || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) fail('人像蒙版编码无效');
      const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
      if (data.length / 4 * 3 - padding !== length) fail('人像蒙版字节数与尺寸不一致');
    } else if (Array.isArray(value.data) || value.data instanceof Uint8Array || value.data instanceof Uint8ClampedArray) {
      if (value.data.length !== length) fail('人像蒙版字节数与尺寸不一致');
      data = Array.from(value.data, byte => integer(byte, 0, 255, '蒙版字节'));
    } else fail('人像蒙版数据无效');
    const out = { ...dimensions, data };
    if (value.maxValue !== undefined) out.maxValue = choice(value.maxValue, [255], '蒙版字节范围');
    return out;
  }
  function crop(op) {
    const x = number(op.x, 0, 1, '裁剪横坐标'), y = number(op.y, 0, 1, '裁剪纵坐标');
    const w = number(op.w, 0.000000001, 1, '裁剪宽度'), h = number(op.h, 0.000000001, 1, '裁剪高度');
    if (x + w > 1 + 1e-9 || y + h > 1 + 1e-9) fail('裁剪区域超出照片边界');
    return { x, y, w, h };
  }
  function manualToolsCore(){const m=typeof module==='object'&&module.exports?require('./manual-tools.js'):globalThis.MintManualTools;if(!m||typeof m.planLiquify!=='function')fail('液化规划核心缺失，不能忽略已有编辑');return m;}
  function paddingOperationCore(){const C=typeof module==='object'&&module.exports?require('./canvas-padding-operation.js'):globalThis.MintCanvasPaddingOperation;if(!C)fail('边框核心缺失，不能忽略已有编辑');return C;}
  function paddingCore(){const C=typeof module==='object'&&module.exports?require('./canvas-padding.js'):globalThis.MintCanvasPadding;if(!C)fail('边框核心缺失，不能规划尺寸');return C;}
  function textOperationCore(){const T=typeof module==='object'&&module.exports?require('./text-overlay-operation.js'):globalThis.MintTextOverlayOperation;if(!T)fail('文字核心缺失，不能忽略已有编辑');return T;}
  function backgroundRefineOperationCore(){const c=typeof module==='object'&&module.exports?require('./background-refine-operation.js'):globalThis.MintBackgroundRefineOperation;if(!c)fail('精细修边核心缺失，不能忽略已有编辑');return c;}
  function sharpnessOperationCore(){const c=typeof module==='object'&&module.exports?require('./sharpness-operation.js'):globalThis.MintSharpnessOperation;if(!c)fail('锐化核心缺失，不能忽略已有编辑');return c;}
  function lightOperationCore(){const L=typeof module==='object'&&module.exports?require('./light-balance-operation.js'):globalThis.MintLightBalanceOperation;if(!L)fail('明暗/白平衡核心缺失，不能忽略已有编辑');return L;}
  function presetOperationCore(){const C=typeof module==='object'&&module.exports?require('./preset-operation.js'):globalThis.MintPresetOperation;if(!C)fail('配方核心缺失，不能忽略已有编辑');return C;}
  function portraitPeopleOperationCore(){const C=typeof module==='object'&&module.exports?require('./portrait-people-operation.js'):globalThis.MintPortraitPeopleOperation;if(!C)fail('逐人人像核心缺失，不能忽略已有编辑');return C;}
  function perspectiveOperationCore(){const C=typeof module==='object'&&module.exports?require('./perspective-operation.js'):globalThis.MintPerspectiveOperation;if(!C)fail('透视核心缺失，不能忽略已有编辑');return C;}
  function straightenOperationCore(){const C=typeof module==='object'&&module.exports?require('./straighten-operation.js'):globalThis.MintStraightenOperation;if(!C)fail('调平核心缺失，不能忽略已有编辑');return C;}
  function collageOperationCore(){const C=typeof module==='object'&&module.exports?require('./collage-operation.js'):globalThis.MintCollageOperation;if(!C)fail('拼图核心缺失，不能忽略已有拼图');return C;}
  function embeddedAssetBudget(list){let count=0,bytes=0;for(const op of list){const assets=op.type==='collage'?op.assets:op.type==='image-overlay'&&op.action==='add'?[op.asset]:op.type==='background-refine'&&op.mode==='image'?[op.picture.asset]:[];for(const a of assets){count++;bytes+=a.width*a.height*4;}}if(count>4||bytes>16*1024*1024)fail('贴图、拼图与照片背景历史合计最多4张外部工作素材、16MiB原始RGBA，包含重做历史');}
  function imageOperationCore(){const I=typeof module==='object'&&module.exports?require('./image-overlay-operation.js'):globalThis.MintImageOverlayOperation;if(!I)fail('图片贴图核心缺失，不能忽略已有编辑');return I;}
  function redactOperationCore(){const R=typeof module==='object'&&module.exports?require('./redact-operation.js'):globalThis.MintRedactOperation;if(!R)fail('马赛克/遮盖核心缺失，不能忽略已有编辑');return R;}
  function paintOperationCore(){const T=typeof module==='object'&&module.exports?require('./paint-layer-operation.js'):globalThis.MintPaintLayerOperation;if(!T)fail('绘画核心缺失，不能忽略已有编辑');return T;}
  function validateTextSequence(list){embeddedAssetBudget(list);let result=list.some(op=>op.type==='text-overlay')?textOperationCore().collapse(list):list;result=result.some(op=>op.type==='paint-layer')?paintOperationCore().collapse(result):result;return result.some(op=>op.type==='image-overlay')?imageOperationCore().collapse(result):result;}
  function effectiveOperations(list){return validateTextSequence(operations(list));}
  function geometryCore() { const G=typeof module==='object'&&module.exports?require('./geometry.js'):globalThis.MintGeometry;if(!G||typeof G.plan!=='function')fail('构图核心缺失，不能忽略已有编辑');return G; }
  function operation(op) {
    object(op, '编辑步骤');
    const typeDescriptor = Object.getOwnPropertyDescriptor(op, 'type');
    if (!typeDescriptor || !typeDescriptor.enumerable || !own(typeDescriptor, 'value') || typeof typeDescriptor.value !== 'string') fail('编辑步骤缺少有效类型');
    const type = typeDescriptor.value;
    let out = { type };
    switch (type) {
      case 'portrait-people': out=portraitPeopleOperationCore().validate(op);break;
      case 'perspective': out=perspectiveOperationCore().validate(op);break;
      case 'straighten': out=straightenOperationCore().validate(op);break;
      case 'collage': out=collageOperationCore().validate(op);break;
      case 'background-refine': out=backgroundRefineOperationCore().validate(op);break;
      case 'sharpness': out=sharpnessOperationCore().validate(op);break;
      case 'light-balance': out=lightOperationCore().validate(op);break;
      case 'image-overlay': out=imageOperationCore().validate(op);break;
      case 'redact': out=redactOperationCore().validate(op);break;
      case 'canvas-padding': out=paddingOperationCore().validate(op);break;
      case 'text-overlay': out=textOperationCore().validate(op);break;
      case 'paint-layer': out=paintOperationCore().validate(op);break;
      case 'local-tone': {const L=typeof module==='object'&&module.exports?require('./local-tone-operation.js'):globalThis.MintLocalToneOperation;if(!L)fail('局部调色核心缺失，不能忽略已有编辑');out=L.validate(op);break;}
      case 'adjustment-preset': {const P=typeof module==='object'&&module.exports?require('./preset-operation.js'):globalThis.MintPresetOperation;if(!P)fail('配方核心缺失，不能忽略已有编辑');out=P.validate(op);break;}
      case 'geometry': {fields(op,['type','recipe'],'构图');const d=Object.getOwnPropertyDescriptor(op,'recipe');if(!d||!d.enumerable||!own(d,'value'))fail('构图缺少有效配方');out.recipe=geometryCore().validate(d.value);break;}
      case 'rotate': fields(op, ['type'], '旋转'); break;
      case 'flip': fields(op, ['type', 'axis'], '翻转'); out.axis = choice(op.axis, ['x', 'y'], '翻转方向'); break;
      case 'crop':
        fields(op, ['type', 'x', 'y', 'w', 'h', 'ratio'], '裁剪'); out = { ...out, ...crop(op) };
        if (op.ratio !== undefined) out.ratio = number(op.ratio, 0, 1000, '裁剪比例');
        break;
      case 'idphoto':
        fields(op, ['type', 'x', 'y', 'w', 'h', 'outW', 'outH', 'selected'], '证件照'); out = { ...out, ...crop(op) };
        // Preserve fixed output pixels. Export planning separately checks budgets.
        out.outW = integer(op.outW, 1, 1000000, '证件照输出宽度'); out.outH = integer(op.outH, 1, 1000000, '证件照输出高度');
        if (op.selected !== undefined) out.selected = flag(op.selected, '证件照选择状态');
        break;
      case 'filter':
        fields(op, ['type', 'id'], '滤镜'); out.id = choice(op.id, ['original', 'mint', 'warm', 'film', 'clear', 'mono', 'cool', 'fade'], '滤镜'); break;
      case 'adjust':
        fields(op, ['type', 'values'], '调节'); out.values = values(op.values, { brightness: [-100,100], contrast: [-100,100], saturation: [-100,100], warmth: [-100,100] }, '调节'); break;
      case 'levels': {
        fields(op,['type','recipe'],'色阶');const rd=Object.getOwnPropertyDescriptor(op,'recipe');if(!rd||!rd.enumerable||!own(rd,'value'))fail('色阶缺少有效配方');
        const T=typeof module==='object'&&module.exports?require('./levels.js'):globalThis.MintLevels;if(!T||typeof T.validate!=='function')fail('色阶核心缺失，不能忽略已有编辑');out.recipe=T.validate(rd.value);break;
      }
      case 'advanced-tone': {
        fields(op, ['type','recipe'], '曲线与分色');
        const T=typeof module==='object'&&module.exports?require('./advanced-tone.js'):globalThis.MintAdvancedTone;
        if(!T||typeof T.validate!=='function')fail('调色核心缺失，不能忽略已有编辑');
        out.recipe=T.validate(op.recipe);break;
      }
      case 'text': case 'sticker':
        fields(op, ['type', 'text', 'x', 'y', 'size', 'color', 'shadow'], '文字或贴纸');
        if (typeof op.text !== 'string' || op.text.length > 80) fail('文字或贴纸内容无效，最多 80 个字符');
        out = { ...out, text: op.text, x: number(op.x, 0, 1, '文字横坐标'), y: number(op.y, 0, 1, '文字纵坐标'), size: number(op.size, 0.001, 0.5, '文字大小'), color: color(op.color) };
        if (op.shadow !== undefined) out.shadow = flag(op.shadow, '文字阴影');
        break;
      case 'draw': {
        fields(op, ['type', 'lines', 'width', 'color'], '涂鸦'); let count = 0;
        out.lines = list(op.lines, 512, '涂鸦笔画', line => {
          if (!Array.isArray(line) || !line.length) fail('涂鸦笔画不能是空笔画');
          count += line.length; if (count > MAX_DRAW_POINTS) fail('涂鸦采样点超过 16384 个，请减少笔画');
          return list(line, MAX_DRAW_POINTS, '涂鸦采样点', p => point(p, '涂鸦点'));
        });
        out.width = number(op.width, 0.000001, 0.06, '涂鸦笔宽'); out.color = color(op.color); break;
      }
      case 'beauty':
        fields(op, ['type', 'values', 'landmarks', 'region', 'palette'], '人像修肤');
        out.values = values(op.values, { smooth: [0,100], brighten: [0,100], warmth: [-40,40], underEye: [0,100], redness: [0,100], lip: [0,100], blush: [0,100] }, '修肤');
        out.landmarks = landmarks(op.landmarks); out.region = op.region == null ? null : circle(op.region, 0.45, '修肤区域');
        if (op.palette !== undefined) out.palette = choice(op.palette, ['natural', 'peach', 'rose'], '妆色'); break;
      case 'reshape':
        fields(op, ['type', 'values', 'landmarks'], '五官调整');
        out.values = values(op.values, { slim: [0,60], eyes: [0,60], nose: [-50,50], jaw: [-50,50] }, '五官调整'); out.landmarks = landmarks(op.landmarks); break;
      case 'manual': {
        fields(op, ['type','sourceRevision','selection','liquify','repair'], '手动精修');
        if(typeof op.sourceRevision!=='string'||!op.sourceRevision.length||op.sourceRevision.length>160||/[\u0000-\u001f\u007f]/.test(op.sourceRevision))fail('手动精修原图版本无效');
        const M=typeof module==='object'&&module.exports?require('./manual-tools.js'):globalThis.MintManualTools;
        const R=typeof module==='object'&&module.exports?require('./repair-brush-core.js'):globalThis.RepairBrushCore;
        if(!M||!R)fail('手动精修核心缺失，不能忽略笔划');
        out.sourceRevision=op.sourceRevision;out.selection=M.validateSelection(op.selection,{sourceRevision:out.sourceRevision});
        if(!Array.isArray(op.liquify)||op.liquify.length>20)fail('本轮最多20个液化笔划');
        out.liquify=M.validateLiquifyCommands(op.liquify,{sourceRevision:out.sourceRevision});
        out.repair=list(op.repair,20,'纹理修复笔划',c=>{const normalized=R.validate(c,{sourceRevision:out.sourceRevision,manualTools:M});if(normalized.sourceRevision!==out.sourceRevision)fail('修复笔划原图版本不匹配');return normalized;});
        if(out.liquify.length&&out.repair.some(c=>c.sampleMode==='automatic'))fail('同批液化后不能使用旧关键点自动取样；请分批应用后重新识别人脸');
        break;
      }
      case 'heal':
        fields(op, ['type', 'spots', 'radius', 'strength'], '祛痘');
        out.spots = list(op.spots, 64, '祛痘点', p => circle(p, 0.12, '祛痘点')); out.strength = number(op.strength, 0, 1, '祛痘强度');
        if (op.radius !== undefined) out.radius = number(op.radius, 0.000001, 0.12, '祛痘笔刷'); break;
      case 'warp':
        fields(op, ['type', 'strokes', 'radius', 'strength'], '液化');
        out.strokes = list(op.strokes, 20, '液化笔画', stroke => {
          fields(stroke, ['from', 'to', 'radius', 'strength'], '液化笔画');
          return { from: point(stroke.from, '液化起点'), to: point(stroke.to, '液化终点'), radius: number(stroke.radius, 0.000001, 0.3, '液化半径'), strength: number(stroke.strength, 0, 1, '液化强度') };
        });
        if (op.radius !== undefined) out.radius = number(op.radius, 0.000001, 0.3, '液化笔刷');
        if (op.strength !== undefined) out.strength = number(op.strength, 0, 1, '液化强度'); break;
      case 'background':
        fields(op, ['type', 'mask', 'mode', 'color', 'blur', 'feather', 'valid', 'brush'], '背景');
        out.mask = op.mask == null ? null : mask(op.mask); out.mode = choice(op.mode, ['color', 'blur', 'transparent'], '背景模式');
        out.color = color(op.color); out.blur = number(op.blur, 0, 50, '背景虚化'); out.feather = number(op.feather, 0, 12, '背景柔边'); out.valid = flag(op.valid, '背景蒙版状态');
        if (out.valid && !out.mask) fail('背景步骤缺少有效人像蒙版');
        if (op.brush !== undefined) out.brush = number(op.brush, 0.000001, 0.25, '背景修边笔刷'); break;
      default: fail('不支持的编辑步骤：' + type);
    }
    return out;
  }
  function operations(ops) { return list(ops, MAX_STEPS, '编辑步骤（最多 60 步）', operation); }
  function makeProject(input, ops = [], redo = []) {
    const source = sourceMetadata(input, true), copiedOps = operations(ops), copiedRedo = operations(redo);
    if (copiedOps.length + copiedRedo.length > MAX_STEPS) fail('编辑与重做历史合计不能超过 60 步');
    validateTextSequence(copiedOps.concat(copiedRedo.slice().reverse()));
    return { version: VERSION, source, ops: copiedOps, redo: copiedRedo };
  }
  function restoreProject(record, decodedDimensions) {
    object(record, '草稿');
    if (!Number.isInteger(record.version) || record.version < 1) fail('草稿版本无效');
    if (record.version > VERSION) fail('草稿来自更新版本，当前版本不能恢复');
    if (record.version === 1) {
      const dimensions = size(decodedDimensions, '旧版草稿解码');
      return makeProject({ blob: record.blob, name: record.name, ...dimensions, mime: record.blob && record.blob.type, origin: 'legacy-working-copy' }, record.ops === undefined ? [] : record.ops, record.redo === undefined ? [] : record.redo);
    }
    if (!own(record, 'source') || !own(record, 'ops') || !own(record, 'redo')) fail('第二版草稿缺少照片来源或编辑历史');
    if (!record.source || !own(record.source, 'origin')) fail('第二版草稿缺少照片来源标记');
    return makeProject(record.source, record.ops, record.redo);
  }
  function draftRecord(project) { return restoreProject(project); }
  function nextSize(current, op) {
    if(op.type==='perspective')return perspectiveOperationCore().measure(current.width,current.height,op).outputSize;
    if(op.type==='straighten')return straightenOperationCore().measure(current.width,current.height,op).outputSize;
    if(op.type==='collage')return collageOperationCore().dimensions(op);
    if(op.type==='canvas-padding')return paddingCore().measure(current.width,current.height,op.recipe).outputSize;
    if(op.type==='geometry')return geometryCore().plan(current.width,current.height,op.recipe).outputSize;
    if (op.type === 'rotate') return { width: current.height, height: current.width };
    if (op.type === 'idphoto') return { width: op.outW, height: op.outH };
    if (op.type === 'crop') return { width: Math.max(1, Math.round(current.width * op.w)), height: Math.max(1, Math.round(current.height * op.h)) };
    return { ...current };
  }
  function outputSize(source, ops = []) {
    let current = size(source, '照片');
    for (const op of effectiveOperations(ops)) current = nextSize(current, op);
    return current;
  }
  function withinBudget(dimensions, label) {
    if (dimensions.width * dimensions.height > MAX_PIXELS || Math.max(dimensions.width, dimensions.height) > MAX_EDGE) fail(label + '超过当前保守导出预算（800 万像素、最长边 4096），未自动缩小；请选择工作尺寸或减少证件照输出尺寸');
  }
  function planExport(source, ops = [], mode = 'working') {
    choice(mode, ['original', 'working'], '导出模式');
    const metadata = sourceMetadata(source, false), copiedOps = operations(ops);
    const effective=validateTextSequence(copiedOps),paintById=new Map(effective.filter(op=>op.type==='paint-layer').map(op=>[op.id,op]));const imageById=new Map(effective.filter(op=>op.type==='image-overlay').map(op=>[op.id,op]));let paintEraseWork=0,redactWork=0,imageWork=0,collageWork=0,straightenWork=0,perspectiveWork=0,peopleWork=0,sharpnessWork=0,maskRefineWork=0,manualWork=0;
    if (mode === 'original') {
      if (metadata.origin !== 'original') fail('旧版草稿只保留工作副本，无法恢复或导出原始分辨率；请重新导入原照片');
      if (!hasBlob(metadata.blob)) fail('缺少原始照片文件，不能导出原始分辨率');
      // Check BEFORE any decode, even if later crop or ID-photo output is tiny.
      withinBudget(metadata, '原始照片');
    }
    const scale = mode === 'working' ? Math.min(1, WORKING_EDGE / Math.max(metadata.width, metadata.height)) : 1;
    const input = { width: Math.max(1, Math.round(metadata.width * scale)), height: Math.max(1, Math.round(metadata.height * scale)) };
    withinBudget(input, '工作照片');
    let output = { ...input }; const steps = [];
    for (let i = 0; i < copiedOps.length; i++) {
      if(copiedOps[i].type==='manual'&&copiedOps[i].liquify.length){const op=copiedOps[i],job=manualToolsCore().planLiquify(output.width,output.height,op.liquify,{sourceRevision:op.sourceRevision});manualWork+=job.workUnits;if(!Number.isFinite(manualWork)||manualWork>800000000)fail('全部液化计算超过安全预算，请减少笔划或选择工作尺寸');const estimated=job.maxWorkingBytes+output.width*output.height*12+32*1024*1024;if(!Number.isFinite(estimated)||estimated>256*1024*1024)fail('液化预计缓冲超过256MiB预算，请选择工作尺寸；没有自动缩小原图');}
      if(copiedOps[i].type==='adjustment-preset'){const job=presetOperationCore().planPortrait(output.width,output.height,copiedOps[i]);if(job){peopleWork+=job.resources.workUnits;if(peopleWork>portraitPeopleOperationCore().LIMITS.maxWorkUnits)fail('逐人人像累计计算超过预算，请减少步骤或选择工作尺寸');}}
      if(copiedOps[i].type==='portrait-people'){const job=portraitPeopleOperationCore().plan(output.width,output.height,copiedOps[i]);peopleWork+=job.resources.workUnits;if(peopleWork>portraitPeopleOperationCore().LIMITS.maxWorkUnits)fail('逐人人像累计计算超过预算，请减少步骤或选择工作尺寸');}
      if(copiedOps[i].type==='background-refine'){const job=backgroundRefineOperationCore().plan(output.width,output.height,copiedOps[i]);maskRefineWork+=job.workUnits;if(!Number.isFinite(maskRefineWork)||maskRefineWork>backgroundRefineOperationCore().LIMITS.aggregateWork)fail('全部修边计算超过安全预算，请减少步骤或选择工作尺寸');}
      if(copiedOps[i].type==='sharpness'){const job=sharpnessOperationCore().plan(output.width,output.height,copiedOps[i]);sharpnessWork+=job.workUnits;if(!Number.isFinite(sharpnessWork)||sharpnessWork>sharpnessOperationCore().LIMITS.aggregateWork)fail('全部锐化计算超过安全预算，请减少锐化步骤或选择工作尺寸');}
      if(copiedOps[i].type==='perspective'){const job=perspectiveOperationCore().plan(output.width,output.height,copiedOps[i]);perspectiveWork+=job.workUnits;if(perspectiveWork>perspectiveOperationCore().LIMITS.aggregateWork)fail('全部透视处理超过安全计算预算，请减少步骤或选择工作尺寸');}
      if(copiedOps[i].type==='straighten'){const job=straightenOperationCore().plan(output.width,output.height,copiedOps[i]);straightenWork+=job.workUnits;if(straightenWork>straightenOperationCore().LIMITS.aggregateWork)fail('全部调平超过安全计算预算，请减少步骤或选择工作尺寸');}
      if(copiedOps[i].type==='collage'){const job=collageOperationCore().plan(output.width,output.height,copiedOps[i]);collageWork+=job.estimates.workPixels;if(collageWork>collageOperationCore().LIMITS.aggregateWork)fail('全部拼图超过安全计算预算，请减少步骤或选择工作尺寸');}
      if(copiedOps[i].type==='image-overlay'&&copiedOps[i].action==='add'){const job=imageOperationCore().plan(output.width,output.height,imageById.get(copiedOps[i].id));imageWork+=job.workUnits;if(imageWork>imageOperationCore().LIMITS.aggregateWork)fail('全部图片贴图超过安全计算预算，请减少贴图或选择工作尺寸');}
      if(copiedOps[i].type==='redact'){const job=redactOperationCore().plan(output.width,output.height,copiedOps[i]);redactWork+=job.workPixels;if(redactWork>128000000)fail('全部马赛克/遮盖超出安全计算预算，请减少笔划或选择工作尺寸');}
      if(copiedOps[i].type==='paint-layer'&&copiedOps[i].action==='add'){const job=paintOperationCore().plan(output.width,output.height,paintById.get(copiedOps[i].id));paintEraseWork+=job.eraseWorkPixels;if(paintEraseWork>32000000)fail('全部涂鸦橡皮合计超过3200万像素计算预算，请减少笔划或选择工作尺寸');}
      output = nextSize(output, copiedOps[i]); withinBudget(output, '第 ' + (i + 1) + ' 步中间图像'); steps.push({ ...output });
    }
    return { mode, input, output, steps, scale, usesOriginal: mode === 'original', warning: metadata.origin === 'legacy-working-copy' ? '旧版草稿仅有工作副本，原始文件与原始分辨率不可恢复。' : ((scale < 1 ? '工作尺寸模式会从最长边 2560 像素的副本重算，原始文件保持不变。' : '') + (copiedOps.some(op=>op.type==='perspective') ? ' 四角透视仅保留所选四边形；按当前来源尺寸同比重算输出，拉伸不会增加细节。' : '') + (copiedOps.some(op=>op.type==='straighten') ? ' 调平按所选来源尺寸重算；扩展模式保留透明角，自动裁边会缩小画布且不补放大。' : '') + (copiedOps.some(op=>op.type==='background-refine'&&op.mode==='image') ? ' 照片背景为最多1024长边的嵌入工作副本，铺满可能裁去部分背景，但不会裁切前景；放大不增加细节。' : '') + (copiedOps.some(op=>op.type==='collage') ? ' 拼图尺寸按声明配方输出；第一格从所选来源重放，其余图片是最多1024长边的嵌入副本。格子放大不会增加源图细节。' : '')) };
  }
  return Object.freeze({ makeProject, restoreProject, draftRecord, planExport, outputSize, effectiveOperations });
});
