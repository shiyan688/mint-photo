/* MintBeautyProtection v1: per-batch, per-face attenuation of a frozen beauty
 * result. This adds no beauty, repair, detector, or face-shaped mask of its own.
 * Inject the unchanged portrait-people and mask-refine modules into createCore. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.MintBeautyProtection = api;
})(typeof globalThis === 'object' ? globalThis : null, function () {
  'use strict';

  const LIMITS = Object.freeze({maxPixels:8388608, maxEdge:4096, maxExtraBytes:167772160, maxWorkUnits:256000000, faces:5, strokesPerFace:32, strokePoints:2048, points:4096});
  const DEFAULT_FEATHER = .002;
  const MASK_REVISION = 'beauty-protection:v1';
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const typed = Object.getPrototypeOf(Uint8Array.prototype);
  const typedLength = Object.getOwnPropertyDescriptor(typed, 'length').get;
  const typedBuffer = Object.getOwnPropertyDescriptor(typed, 'buffer').get;
  const bufferBytes = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
  const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable');

  function fail(code, message, Type) {
    const error = new (Type || TypeError)(message);
    error.code = code;
    throw error;
  }
  function record(value, required, optional, label) {
    if (!value || typeof value !== 'object' || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail('INVALID_RECORD', label + ' must be a plain own-data record.');
    const keys = Reflect.ownKeys(value), out = Object.create(null), allowed = required.concat(optional || []);
    for (const key of keys) {
      if (typeof key !== 'string' || !allowed.includes(key)) fail('UNKNOWN_FIELD', label + ' has an unknown field or symbol.');
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d || !own(d, 'value')) fail('ACCESSOR', label + '.' + key + ' cannot be an accessor.');
      if (!d.enumerable) fail('INVALID_RECORD', label + '.' + key + ' must be enumerable.');
      out[key] = d.value;
    }
    for (const key of required) if (!own(out, key)) fail('MISSING_FIELD', label + '.' + key + ' is required.');
    return out;
  }
  function array(value, min, max, label) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail('INVALID_ARRAY', label + ' must be an ordinary dense array.');
    const length = Object.getOwnPropertyDescriptor(value, 'length').value;
    if (length < min || length > max) fail('LIMIT', label + ' exceeds its length bounds.', RangeError);
    if (Reflect.ownKeys(value).length !== length + 1) fail('INVALID_ARRAY', label + ' must contain only dense numeric entries.');
    const out = [];
    for (let i = 0; i < length; i++) {
      const d = Object.getOwnPropertyDescriptor(value, String(i));
      if (!d || !own(d, 'value')) fail('ACCESSOR', label + ' cannot have holes or accessors.');
      if (!d.enumerable) fail('INVALID_ARRAY', label + ' entries must be enumerable.');
      out.push(d.value);
    }
    return out;
  }
  function number(value, min, max, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail('RANGE', label + ' must be finite within [' + min + ', ' + max + '].', RangeError);
    return value === 0 ? 0 : value;
  }
  function integer(value, min, max, label) {
    number(value, min, max, label);
    if (!Number.isSafeInteger(value)) fail('RANGE', label + ' must be an integer.', RangeError);
    return value;
  }
  function equalDetector(a, b) { return a.id === b.id && a.modelSha256 === b.modelSha256 && a.topology === b.topology; }
  function freeze(value) {
    if (value && typeof value === 'object') { for (const key of Object.keys(value)) freeze(value[key]); Object.freeze(value); }
    return value;
  }
  function checkpoint(shouldCancel) {
    if (shouldCancel && shouldCancel()) { const error = new Error('Beauty protection cancelled.'); error.name = 'AbortError'; error.code = 'ABORT_ERR'; throw error; }
  }
  function hasEdits(face) { return face.strokes.some(stroke => stroke.mode === 'erase' && stroke.strength > 0); }
  function inside(bounds, x, y) { return !!bounds && x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY; }
  function intersects(a, b) { return !!a && !!b && a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY; }
  function maskRecipe(face) {
    // A private constant avoids imposing mask-refine's shorter revision-string
    // limit on portrait batches. Real source/batch/detector bindings stay above it.
    return {version:1, sourceRevision:MASK_REVISION, base:{width:1, height:1, data:'/w=='}, strokes:face.strokes, edgeShift:0, feather:face.feather};
  }
  function nativeBytes(data, count, label, float) {
    const permitted = float ? [Float32Array.prototype] : [Uint8Array.prototype, Uint8ClampedArray.prototype];
    if (!ArrayBuffer.isView(data) || !permitted.includes(Object.getPrototypeOf(data))) fail('IMAGE_DATA', label + ' must be a native ' + (float ? 'Float32' : 'RGBA byte') + ' array.');
    for (const key of ['length', 'buffer', 'byteLength', 'byteOffset']) if (own(data, key)) fail('IMAGE_DATA', label + ' native slots cannot be overridden.');
    if (Object.getOwnPropertySymbols(data).length) fail('IMAGE_DATA', label + ' cannot have own symbols.');
    const buffer = typedBuffer.call(data);
    if (Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype) fail('IMAGE_DATA', label + ' must use a non-shared ArrayBuffer.');
    try {
      bufferBytes.call(buffer);
      if (resizable && resizable.get.call(buffer)) fail('IMAGE_DATA', label + ' cannot use a resizable ArrayBuffer.');
    } catch (error) { fail('IMAGE_DATA', label + ' must use a genuine non-shared, non-resizable ArrayBuffer.'); }
    if (typedLength.call(data) !== count) fail('IMAGE_DATA', label + ' has an unexpected length.');
    return data;
  }

  function createCore(options) {
    const o = record(options, ['people', 'maskRefine'], ['limits'], 'core options');
    const people = o.people, maskRefine = o.maskRefine;
    if (!people || typeof people.validateBatch !== 'function' || !maskRefine || typeof maskRefine.validate !== 'function' || typeof maskRefine.plan !== 'function' || typeof maskRefine.rasterize !== 'function') fail('DEPENDENCY', 'Compatible frozen portrait-people and mask-refine modules are required.');
    const limits = {...LIMITS};
    if (own(o, 'limits')) {
      const custom = record(o.limits, [], ['maxPixels', 'maxEdge', 'maxExtraBytes', 'maxWorkUnits'], 'limits');
      for (const key of Object.keys(custom)) limits[key] = integer(custom[key], 1, LIMITS[key], 'limits.' + key);
    }
    function dimensions(width, height) {
      integer(width, 1, limits.maxEdge, 'width'); integer(height, 1, limits.maxEdge, 'height');
      if (width * height > limits.maxPixels) fail('LIMIT', 'Beauty protection exceeds its full-resolution pixel budget.', RangeError);
      return {width, height};
    }
    function metadata(batch) {
      return {version:1, sourceRevision:batch.sourceRevision, batchId:batch.batchId, detector:{...batch.detector}, detectionSize:{...batch.detectionSize}, faceOrder:batch.faces.map(face => face.id), faces:[]};
    }
    function defaults(batch) { return metadata(people.validateBatch(batch)); }
    function canonical(value, batch) {
      const b = people.validateBatch(batch);
      if (value === null || value === undefined) return {recipe:null, batch:b};
      const r = record(value, ['version', 'sourceRevision', 'batchId', 'detector', 'detectionSize', 'faceOrder', 'faces'], [], 'beauty protection');
      if (r.version !== 1) fail('VERSION', 'Unsupported beauty protection version.', RangeError);
      if (r.sourceRevision !== b.sourceRevision) fail('SOURCE_MISMATCH', 'Beauty protection belongs to a different source revision.');
      if (r.batchId !== b.batchId) fail('BATCH_MISMATCH', 'Beauty protection belongs to a different detection batch.');
      const detector = record(r.detector, ['id', 'modelSha256', 'topology'], [], 'protection detector');
      if (!equalDetector(detector, b.detector)) fail('MODEL_MISMATCH', 'Beauty protection detector/model/topology changed.');
      const size = record(r.detectionSize, ['width', 'height'], [], 'protection detectionSize');
      if (size.width !== b.detectionSize.width || size.height !== b.detectionSize.height) fail('DETECTION_SIZE_MISMATCH', 'Beauty protection detection dimensions changed.');
      const order = array(r.faceOrder, b.faces.length, b.faces.length, 'faceOrder');
      if (order.some((id, i) => id !== b.faces[i].id)) fail('FACE_ORDER_MISMATCH', 'Beauty protection detection order changed.');
      const ids = new Set(); let totalPoints = 0;
      const faces = array(r.faces, 0, limits.faces, 'protection faces').map(value => {
        const f = record(value, ['faceId', 'landmarks', 'strokes', 'feather'], [], 'protection face');
        const target = b.faces.find(face => face.id === f.faceId);
        if (!target || ids.has(f.faceId)) fail('FACE_ID', 'Protection face IDs must be unique members of this detection batch.');
        ids.add(f.faceId);
        const landmarks = array(f.landmarks, target.landmarks.length, target.landmarks.length, 'protection landmarks').map((value, i) => {
          const p = record(value, ['x', 'y'], ['z'], 'protection landmark'), expected = target.landmarks[i];
          number(p.x, -4, 4, 'landmark.x'); number(p.y, -4, 4, 'landmark.y');
          if (own(p, 'z')) number(p.z, -10, 10, 'landmark.z');
          if (p.x !== expected.x || p.y !== expected.y || own(p, 'z') !== own(expected, 'z') || (own(p, 'z') && p.z !== expected.z)) fail('GEOMETRY_MISMATCH', 'Protection landmark snapshot does not match ' + f.faceId + '.');
          return {...expected};
        });
        const strokes = array(f.strokes, 1, limits.strokesPerFace, 'face strokes').map(value => {
          const s = record(value, ['mode', 'radius', 'hardness', 'strength', 'points'], [], 'protection stroke');
          if (s.mode !== 'keep' && s.mode !== 'erase') fail('STROKE_MODE', 'Stroke mode must be keep or erase.');
          const rawPoints = array(s.points, 1, limits.strokePoints, 'stroke points');
          totalPoints += rawPoints.length;
          if (totalPoints > limits.points) fail('POINT_BUDGET', 'Beauty protection exceeds its aggregate raw-point budget.', RangeError);
          const points = rawPoints.map(value => { const p = record(value, ['x', 'y'], [], 'stroke point'); return {x:number(p.x, 0, 1, 'point.x'), y:number(p.y, 0, 1, 'point.y')}; });
          return {mode:s.mode, radius:number(s.radius, .002, .15, 'stroke.radius'), hardness:number(s.hardness, 0, .8, 'stroke.hardness'), strength:number(s.strength, 0, 1, 'stroke.strength'), points};
        });
        const face = {faceId:f.faceId, landmarks, strokes, feather:number(f.feather, .0005, .01, 'face.feather')};
        // Reuse exactly the frozen continuous-path canonicalizer. The aggregate
        // RAW point budget has already been charged, before simplification.
        face.strokes = maskRefine.validate(maskRecipe(face)).strokes;
        return face;
      });
      faces.sort((a, c) => order.indexOf(a.faceId) - order.indexOf(c.faceId));
      return {recipe:{...metadata(b), faces}, batch:b};
    }
    function validate(value, batch) { return canonical(value, batch).recipe; }
    function hasInstructions(value, batch) { const r = validate(value, batch); return !!r && r.faces.some(hasEdits); }
    function withFaceStroke(value, batch, faceId, stroke, feather) {
      const p = canonical(value, batch), r = p.recipe || metadata(p.batch), face = p.batch.faces.find(face => face.id === faceId);
      if (!face) fail('FACE_ID', 'Cannot add protection for an unknown face.');
      let entry = r.faces.find(entry => entry.faceId === faceId);
      if (!entry) { entry = {faceId, landmarks:face.landmarks.map(point => ({...point})), strokes:[], feather:DEFAULT_FEATHER}; r.faces.push(entry); }
      if (feather !== undefined) entry.feather = feather;
      entry.strokes.push(stroke);
      return validate(r, p.batch);
    }
    function clearFace(value, batch, faceId) {
      const p = canonical(value, batch), r = p.recipe || metadata(p.batch);
      if (!p.batch.faces.some(face => face.id === faceId)) fail('FACE_ID', 'Cannot clear protection for an unknown face.');
      r.faces = r.faces.filter(face => face.faceId !== faceId);
      return r;
    }
    function withFaceFeather(value, batch, faceId, feather) {
      const p = canonical(value, batch), r = p.recipe || metadata(p.batch);
      if (!p.batch.faces.some(face => face.id === faceId)) fail('FACE_ID', 'Cannot feather protection for an unknown face.');
      const amount = number(feather, .0005, .01, 'face.feather');
      const entry = r.faces.find(face => face.faceId === faceId);
      // Do not create an otherwise unedited face merely to remember a UI knob.
      if (entry) entry.feather = amount;
      return r;
    }
    function prepare(width, height, value, batch, shouldCancel) {
      checkpoint(shouldCancel);
      const size = dimensions(width, height), p = canonical(value, batch), pixels = width * height;
      const faces = [], outputBytes = 4 * pixels;
      let maskBytes = 0, maskWork = 0, plannerWork = 0;
      if (p.recipe) for (const face of p.recipe.faces) {
        checkpoint(shouldCancel);
        if (!hasEdits(face)) continue;
        const mask = maskRefine.plan(size, maskRecipe(face));
        maskBytes += mask.maxWorkingBytes; maskWork += mask.workUnits;
        // Planning visits segments and their rows, not every candidate pixel
        // inside each row. Charge both our plan and rasterize's internal plan.
        plannerWork += 2 * (8 * mask.segmentCount + 8 * mask.segmentRows + 16 * mask.activeStrokes);
        faces.push({faceId:face.faceId, mask});
      }
      // All mask outputs AND scratch/base buffers are summed, not just the last
      // live field: this remains conservative if GC does not run between faces.
      // Work uses conservative weighted scheduling units, not CPU instructions.
      // Region count bounds candidate support checks; disjoint validated write
      // domains mean the aggregate RGB merge visits at most N pixels, not M*N.
      const estimatedPeakExtraBytes = outputBytes + maskBytes;
      const candidateValidationWorkUnits = pixels * (5 + p.batch.faces.length);
      const outputCopyWorkUnits = pixels;
      const maskWeightValidationWorkUnits = pixels * faces.length;
      const mergeWorkUnits = faces.length ? 4 * pixels : 0;
      const recipeFaces = p.recipe ? p.recipe.faces : [];
      const schemaVisits = p.batch.faces.reduce((sum, face) => sum + face.landmarks.length, 0) + recipeFaces.reduce((sum, face) => sum + face.landmarks.length + face.strokes.reduce((total, stroke) => total + 1 + 3 * stroke.points.length, 0), 0);
      const schemaWorkUnits = 64 * schemaVisits;
      const estimatedWorkUnits = candidateValidationWorkUnits + outputCopyWorkUnits + maskWeightValidationWorkUnits + mergeWorkUnits + schemaWorkUnits + plannerWork + maskWork;
      const resources = {pixels, activeMasks:faces.length, retainedOutputBytes:outputBytes, maskWorkingBytes:maskBytes,
        estimatedPeakExtraBytes, extraPeakBytes:estimatedPeakExtraBytes, cumulativeTypedArrayBytes:estimatedPeakExtraBytes,
        candidateValidationWorkUnits, outputCopyWorkUnits, maskWeightValidationWorkUnits, mergeWorkUnits, schemaWorkUnits,
        maskPlanningWorkUnits:plannerWork, maskRasterWorkUnits:maskWork,
        preflightWorkUnits:schemaWorkUnits + plannerWork / 2,
        estimatedWorkUnits, workUnits:estimatedWorkUnits,
        excludes:'source and candidate buffers, frozen portrait processor, canvas/native/GPU/history copies, JS objects and VM overhead; not a measured device peak'};
      if (estimatedPeakExtraBytes > limits.maxExtraBytes) fail('MEMORY_BUDGET', 'Beauty protection exceeds its conservative full-resolution extra-buffer budget.', RangeError);
      if (estimatedWorkUnits > limits.maxWorkUnits) fail('WORK_BUDGET', 'Beauty protection exceeds its aggregate work budget.', RangeError);
      checkpoint(shouldCancel);
      return {...p, size, publicPlan:freeze({version:1, width, height, sourceRevision:p.batch.sourceRevision, batchId:p.batch.batchId, faces, resources})};
    }
    function plan(width, height, value, batch) { return prepare(width, height, value, batch).publicPlan; }
    function rasterizeFace(size, value, batch, faceId, options) {
      const s = record(size, ['width', 'height'], [], 'mask size');
      const opt = options === undefined ? Object.create(null) : record(options, [], ['shouldCancel'], 'mask options');
      if (own(opt, 'shouldCancel') && typeof opt.shouldCancel !== 'function') fail('INVALID_CALLBACK', 'shouldCancel must be a function.');
      const p = prepare(s.width, s.height, value, batch, opt.shouldCancel);
      if (!p.batch.faces.some(face => face.id === faceId)) fail('FACE_ID', 'Cannot rasterize protection for an unknown face.');
      const entry = p.recipe && p.recipe.faces.find(face => face.faceId === faceId);
      checkpoint(opt.shouldCancel);
      if (!entry || !hasEdits(entry)) {
        const data = new Float32Array(s.width * s.height); data.fill(1);
        checkpoint(opt.shouldCancel);
        return {width:s.width, height:s.height, data};
      }
      const mask = maskRefine.rasterize(p.size, maskRecipe(entry), opt.shouldCancel ? {shouldCancel:opt.shouldCancel} : undefined);
      if (!mask || mask.width !== s.width || mask.height !== s.height) fail('MASK_OUTPUT', 'Mask rasterizer returned mismatched dimensions.');
      const data = nativeBytes(mask.data, s.width * s.height, 'mask weights', true);
      for (let i = 0; i < data.length; i++) {
        if ((i & 4095) === 0) checkpoint(opt.shouldCancel);
        if (!Number.isFinite(data[i]) || data[i] < 0 || data[i] > 1) fail('MASK_OUTPUT', 'Mask rasterizer returned an invalid continuous weight.');
      }
      checkpoint(opt.shouldCancel);
      return {width:s.width, height:s.height, data};
    }
    function image(value, label) {
      const im = record(value, ['width', 'height', 'data'], [], label), size = dimensions(im.width, im.height);
      return {...size, data:nativeBytes(im.data, size.width * size.height * 4, label + '.data', false)};
    }
    function regions(value, batch, width, height) {
      const ids = new Set(), out = array(value, batch.faces.length, batch.faces.length, 'beauty regions').map(value => {
        const r = record(value, ['faceId', 'writeBounds'], [], 'beauty region');
        if (!batch.faces.some(face => face.id === r.faceId) || ids.has(r.faceId)) fail('FACE_ID', 'Beauty regions must contain every batch face exactly once.');
        ids.add(r.faceId);
        if (r.writeBounds === null) return {faceId:r.faceId, writeBounds:null};
        const b = record(r.writeBounds, ['minX', 'minY', 'maxX', 'maxY'], [], 'writeBounds');
        integer(b.minX, 0, width - 1, 'minX'); integer(b.maxX, b.minX, width - 1, 'maxX');
        integer(b.minY, 0, height - 1, 'minY'); integer(b.maxY, b.minY, height - 1, 'maxY');
        return {faceId:r.faceId, writeBounds:{...b}};
      });
      for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) if (intersects(out[i].writeBounds, out[j].writeBounds)) fail('FACE_OVERLAP', 'Beauty protection cannot use overlapping face write domains.');
      return out;
    }
    function apply(source, result, value, batch, options) {
      const opt = options === undefined ? Object.create(null) : record(options, [], ['regions', 'shouldCancel'], 'apply options');
      if (own(opt, 'shouldCancel') && typeof opt.shouldCancel !== 'function') fail('INVALID_CALLBACK', 'shouldCancel must be a function.');
      const cancel = opt.shouldCancel;
      checkpoint(cancel);
      const before = image(source, 'source'), candidate = image(result, 'result');
      if (before.width !== candidate.width || before.height !== candidate.height) fail('IMAGE_SIZE', 'Beauty source and result must have the same dimensions.');
      const p = prepare(before.width, before.height, value, batch, cancel);
      if (p.publicPlan.faces.length && !own(opt, 'regions')) fail('MISSING_REGIONS', 'Edited beauty protection requires the full frozen processor write-domain plan.');
      const safeRegions = own(opt, 'regions') ? regions(opt.regions, p.batch, before.width, before.height) : null;
      // Validate the ENTIRE candidate before allocating. Invalid engine output
      // is rejected rather than silently fixing alpha or masking away an escape.
      for (let y = 0; y < before.height; y++) {
        checkpoint(cancel);
        for (let x = 0; x < before.width; x++) {
          const i = (y * before.width + x) * 4, a = before.data, b = candidate.data;
          if (a[i + 3] !== b[i + 3] || (a[i + 3] === 0 && (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]))) fail('ALPHA_CHANGED', 'Beauty candidate changed source alpha or transparent hidden RGB.');
          if (safeRegions && (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) && !safeRegions.some(region => inside(region.writeBounds, x, y))) fail('SUPPORT_ESCAPE', 'Beauty candidate changed pixels outside the frozen face write domains.');
        }
      }
      checkpoint(cancel);
      const data = new Uint8ClampedArray(candidate.data);
      for (const facePlan of p.publicPlan.faces) {
        const bounds = safeRegions.find(region => region.faceId === facePlan.faceId).writeBounds;
        if (!bounds) continue;
        checkpoint(cancel);
        const entry = p.recipe.faces.find(face => face.faceId === facePlan.faceId);
        const mask = maskRefine.rasterize(p.size, maskRecipe(entry), cancel ? {shouldCancel:cancel} : undefined);
        if (!mask || mask.width !== before.width || mask.height !== before.height) fail('MASK_OUTPUT', 'Mask rasterizer returned mismatched dimensions.');
        const weights = nativeBytes(mask.data, before.width * before.height, 'mask weights', true);
        for (let j = 0; j < weights.length; j++) {
          if ((j & 4095) === 0) checkpoint(cancel);
          if (!Number.isFinite(weights[j]) || weights[j] < 0 || weights[j] > 1) fail('MASK_OUTPUT', 'Mask rasterizer returned an invalid continuous weight.');
        }
        for (let y = bounds.minY; y <= bounds.maxY; y++) {
          checkpoint(cancel);
          for (let x = bounds.minX; x <= bounds.maxX; x++) {
            const j = y * before.width + x, i = j * 4, weight = weights[j];
            if (weight === 1 || before.data[i + 3] === 0) continue;
            for (let c = 0; c < 3; c++) {
              // Explicit endpoints avoid rounding/interpolation artifacts.
              data[i + c] = weight === 0 ? before.data[i + c] : before.data[i + c] + (candidate.data[i + c] - before.data[i + c]) * weight;
            }
          }
        }
      }
      checkpoint(cancel);
      return {width:before.width, height:before.height, data};
    }
    return Object.freeze({version:1, limits:freeze(limits), defaults, validate, hasInstructions, plan, apply, withFaceStroke, clearFace, withFaceFeather, rasterizeFace});
  }
  return Object.freeze({version:1, LIMITS, DEFAULT_FEATHER, createCore});
});
