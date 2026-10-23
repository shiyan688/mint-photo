# MintPortraitPeople v1 integration contract

Candidate implementation is `portrait-people.js`; `portrait-people.cjs` has identical bytes.
UMD global: `MintPortraitPeople`. No engine imports, no model dependency, no network. Inject the qualified unmodified engine (source SHA256 `5cde7dcd60aab1d68e1ec5fb026c6396c2f395c1597dd03113c34674ba57d524`); support proofs depend on its exact formulas. Runtime function presence/capability labels are not code authentication.

## API

- `createProcessor({engine, detector?, limits?})` returns `{applyBeauty, applyReshape, plan, planSize, limits, detector}`.
- `processor.applyBeauty(image, batch, {sourceRevision, batchId?, detector?, shouldCancel?})` returns `{width,height,data:Uint8ClampedArray}`.
- `processor.applyReshape(image, batch, sameOptions)` returns the same shape.
- `processor.plan(image, batch, {...sameOptions, phase:'beauty'|'reshape'})` performs validation and safety/resource planning without allocating image-sized arrays. Returns per-face `protectedBounds`, `writeBounds`, `readBounds`, `influenceBounds`, normalized `displayBounds`, and resource estimates.
- `processor.planSize(width,height,batch,{...sameOptions,phase})` plans without pixel data or image-sized allocation. Same bounds/resources as plan; `opaqueAlphaRequired` signals an unresolved alpha precondition that apply will check. Use before decoding or allocating export pixels.
- `createBatch({sourceRevision,batchId,detector,detectionSize,landmarks:[mesh,...]})` returns a detached mutable plain batch, preserving every detected face including zero-control faces; assigns `face-1` through `face-N` only in supplied detector order. New batch IDs are the caller's responsibility. Never pass old controls into this helper, and never reuse a batch ID for a new detection.
- `validateBatch(batch, context?)` returns a detached mutable plain validated copy. If context is given it requires a nonempty `sourceRevision`; optional `batchId` and `detector` must match.
- `defaultsBeauty()` and `defaultsReshape()` return fresh complete zero-control records. Palette default is `natural`.
- `hasEffect(batch, phase)` strictly validates the batch then returns whether the specified phase has any nonzero numeric control.
- `getFaceBounds(batch)` strictly validates and returns `[{id,x,y,width,height}]`, normalized/clamped bounds of all landmarks, usable for explicit face selection overlays.
- `DEFAULT_DETECTOR` is `{id:'mediapipe-face-landmarker', modelSha256:'64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff', topology:'MediaPipe478'}`. Processor pins this unless an explicit different valid detector is supplied at creation. Runtime context.detector, if supplied, must also match.

## Strict batch

```
{
  version: 1,
  sourceRevision: 'nonempty opaque source/snapshot revision',
  batchId: 'nonempty opaque unique detection batch id',
  detector: {id:'nonempty string', modelSha256:'64 lowercase hex', topology:'MediaPipe468'|'MediaPipe478'},
  detectionSize: {width:integer,height:integer},
  faces: [{
    id: 'face-1',
    landmarks: [{x:number,y:number,z?:number}, ...],
    beauty: {smooth:0,brighten:0,warmth:0,underEye:0,redness:0,lip:0,blush:0,palette:'natural'},
    reshape: {slim:0,eyes:0,nose:0,jaw:0}
  }]
}
```

All listed fields are mandatory except point z. Unknown fields, accessors, custom prototypes, symbols, missing values, sparse arrays, NaN/Infinity, duplicate/missing face IDs, and oversized structures reject. Plain Object.prototype/null-prototype records and ordinary dense arrays only. 0–5 faces; IDs must form face-1..face-N but array ordering can vary without changing output. Mesh length is exactly topology 468 or 478. x/y in [-4,4], z in [-10,10]; engine coordinates are clamped to [0,1]. Beauty controls 0..100 except warmth -100..100; palettes natural/peach/rose. Reshape slim/eyes 0..60, nose/jaw -50..50.

Image is a plain `{width,height,data}` record. Wrap native ImageData explicitly rather than passing its accessors. Data must be non-shared native Uint8Array/Uint8ClampedArray, length width*height*4. Dimensions and detectionSize have fixed caps 16384 per edge / 16777216 pixels. Processor limits may only tighten fixed maxima: `{maxPixels,maxEdge,maxExtraBytes,maxWorkUnits}`. Defaults are 16777216,16384,268435456,2000000000 respectively. Mobile should set 8000000,4096,134217728 and an appropriate tighter work cap.

## Safety behavior

Each active face is evaluated against the same immutable phase input; no sequential cross-face warping or repeated whitening. Only verified disjoint deltas are merged. Output is atomic: invalid input, overlap, unexpected engine writes, cancellation, resource limits, or engine failure never return partial pixels. Source bytes are never changed by this core with the frozen supplied engine. shouldCancel is checked before/after each face and during output verification; synchronous engine internals themselves are not interruptible. Keep UI generation/job checks too.

`sourceRevision` proves only explicit caller binding, not image identity by dimensions or a pixel hash. History must bind each immutable operation snapshot to its own revision. Detection dimensions need not equal render dimensions, since normalized coordinates permit preview/export scaling; they do not authorize geometry changes. Crop/rotate/reshape/redetect must invalidate or regenerate downstream batch geometry as appropriate.

Bounds use inclusive integer pixel coordinates `{minX,minY,maxX,maxY}`, or null for no effect. Influence includes conservative write/read support derived from the exact frozen engine formulas; it is tested against every other detected face's protected bounds, including inactive neighbors, and against other active influence rectangles. Conservative rejection is intentional for close faces. No hard clipping/feathering of an otherwise invalid warp. Beauty preserves alpha and hidden RGB. Active reshape rejects any nonopaque source pixel; zero-effect reshape remains exact identity.

Stable budget fields are `plan.resources.extraPeakBytes` and `plan.resources.workUnits`. Additional `cumulativeTypedArrayBytes` sums all engine allocations across faces; `extraPeakBytes` assumes previous face temporaries become reclaimable, NOT prompt garbage collection. Work units count conservative image-pixel passes, not CPU instructions or elapsed time.

Memory figures distinguish retained result bytes, engine output bytes, conservative live engine temporary bytes, extra peak estimate, and cumulative typed-array allocation estimate. They are JS allocation estimates, NOT real-device/browser peak guarantees; source/canvas/native/history/GPU storage and delayed garbage collection are separate. Runtime should keep its existing whole-pipeline budget.

Errors have stable `.code` and useful `.message`; detailed code list and proof/tests in README after implementation.
