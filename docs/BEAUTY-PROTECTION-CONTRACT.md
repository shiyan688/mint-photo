# Per-person beauty protection contract, version 1

`app/src/main/assets/beauty-protection.js` is a new, pure UMD companion. It does
not modify the frozen `portrait-people.js`, `mask-refine.js`, portrait engine,
detector, model or earlier beauty controls. It needs no package, network,
Android/Java API, DOM, canvas or image download.

## What the tool does

The input is an immutable source at the beginning of the **current beauty
phase**, plus the completed, same-size result of the existing full-batch beauty
processor. The protection layer can only attenuate those existing RGB deltas.
It does not invent beauty outside them, change the detector, repair pixels,
recover learned texture or hair detail, or remove a neighboring-face rejection.

- Weight `1` is the exact complete beauty candidate.
- Weight `0` is the exact current beauty-phase source, not the photo's original
  import and not a different history entry.
- Intermediate weights use `source + (candidate - source) * weight` in RGB,
  converted to `Uint8ClampedArray` bytes. Explicit endpoint branches avoid
  interpolation/rounding changes at `0` and `1`.
- Source alpha is never blended. Its bytes and alpha-zero hidden RGB must match
  in the candidate and remain exact in the result. A violating candidate throws
  before output allocation; it is not silently repaired.
- An unchanged candidate pixel cannot acquire a new effect. No face-shaped
  outline or additional face mask is introduced.
- `null`, `undefined`, defaults, zero-strength-only strokes and keep-only
  strokes return a detached, byte-identical candidate. If the beauty candidate
  equals source, protection remains exactly source too.

UI names may be **涂抹保护** and **擦除保护**:

- `mode: 'erase'` erases effect weight and therefore adds protection / recovers
  current-phase source.
- `mode: 'keep'` restores effect weight and therefore removes protection.

This weight interpretation is intentionally different from “erase an image”.

## Dependency injection and API

Browser:

```js
const protection = MintBeautyProtection.createCore({
  people: MintPortraitPeople,
  maskRefine: MintMaskRefine
});
```

Node can `require()` the same `.js` file. There is no second `.cjs` production
copy and no dependency-path fork. Dependencies are the trusted, frozen modules,
not serialized recipe inputs.

`createCore` accepts optional `limits`, with any of `maxPixels`, `maxEdge`,
`maxExtraBytes`, `maxWorkUnits`; values may only tighten the defaults. The module
and instance APIs and exposed limits are frozen.

| Method | Result / purpose |
| --- | --- |
| `defaults(batch)` | New detached v1 recipe, with no edited face entries. |
| `validate(value, batch)` | Detached canonical recipe; `null` / `undefined` become `null`; throws on stale or malformed inputs. |
| `hasInstructions(value, batch)` | True if some edited face contains a positive-strength erase stroke. Validates even when false. Keep-only or zero-strength-only entries are inert. |
| `withFaceStroke(value, batch, faceId, stroke, feather?)` | Detached validated recipe with the stroke appended to that face. New entries use `.002` feather unless provided. |
| `clearFace(value, batch, faceId)` | Detached recipe with only the selected face's entry removed. |
| `withFaceFeather(value, batch, faceId, feather)` | Update an existing entry. Does not create an entry for an otherwise unedited face. A UI may keep an independent “next stroke” feather value. |
| `plan(width, height, value, batch)` | Frozen, full-resolution, pre-allocation plan and resource estimate. |
| `rasterizeFace({width,height}, value, batch, faceId, {shouldCancel}?)` | Full-resolution `{width,height,data:Float32Array}` effect weights, using the exact replay math used by `apply`. Unedited faces return all `1`. Intended for bounded preview overlays, not a new effect domain. |
| `apply(source, candidate, value, batch, {regions,shouldCancel}?)` | Detached same-size `{width,height,data:Uint8ClampedArray}` result; never mutates source, candidate, batch, regions or recipe. |

Images are strict `{width,height,data}` records, with native `Uint8Array` or
`Uint8ClampedArray` RGBA data. Shared, resizable, subclassed or foreign-prototype
views and overridden native view slots are rejected. ArrayBuffer branding uses
native internal-slot getters, not shadowable `buffer.resizable` properties.

## Required multi-person integration

Use the existing processor on the **entire batch with all active controls and
inactive neighbors present**. Do not run independent one-face batches as a
shortcut: that would discard existing neighbor/read-influence protections.

```js
const context = {
  sourceRevision: batch.sourceRevision,
  batchId: batch.batchId,
  phase: 'beauty'
};
const beautyPlan = processor.planSize(width, height, batch, context);
const protectionPlan = protection.plan(width, height, recipe, batch);

// Before invoking either renderer, the wrapper checks the combined processor
// and protection estimates against its complete-pipeline resource policy.
const regions = beautyPlan.faces.map(face => ({
  faceId: face.id,
  writeBounds: face.writeBounds
}));
const candidate = processor.applyBeauty(source, batch, {
  sourceRevision: batch.sourceRevision,
  batchId: batch.batchId,
  shouldCancel
});
const output = protection.apply(source, candidate, recipe, batch, {
  regions,
  shouldCancel
});
```

Omit `shouldCancel` rather than explicitly passing `undefined` to APIs whose
strict options validate its presence. The callback, when present, is a function.

`regions` is a strict dense array containing **every** current batch face ID
exactly once:

```js
[
  {faceId:'face-1', writeBounds:{minX:12,minY:15,maxX:80,maxY:94}},
  {faceId:'face-2', writeBounds:null}
]
```

Bounds are **inclusive integer pixel indices**, inside the output dimensions;
`min <= max`. Inactive/no-write faces use `null`. Non-null bounds may not overlap,
including their boundary pixels. Reordered region records are allowed because
they are matched by ID, not by array index.

The core validates this structural contract but cannot authenticate arbitrary
caller-supplied regions as a frozen-engine plan. The wrapper must pass bounds
from the trusted processor planning call for these exact dimensions and batch.
Existing processor overlap/protected-neighbor checks remain authoritative.

With effective protection, omitting `regions` is an error. If regions are
provided even for a null recipe, all candidate RGB deltas must lie inside their
union. Support escapes throw before output allocation. Each person's mask is
applied **only inside that person's own writeBounds**. A stroke that traverses
another active face therefore cannot erase that other person's beauty. Null
writeBounds never apply a mask. Other faces retain their complete candidate
unless they have their own edited entry.

`rasterizeFace` deliberately returns a complete image-coordinate field, not a
cropped face mask. An overlay can show stroke geometry or clip it to the trusted
domain, but displaying a mask must not expand the actual processing domain.

## Serializable recipe

```js
{
  version: 1,
  sourceRevision: 'source-A',
  batchId: 'batch-A',
  detector: {id:'...', modelSha256:'<64 lowercase hex>', topology:'MediaPipe478'},
  detectionSize: {width:201,height:101},
  faceOrder: ['face-1','face-2'],
  faces: [
    {
      faceId: 'face-1',
      landmarks: [{x:0.2,y:0.4,z:0.01}, /* exact detector mesh snapshot */],
      strokes: [
        {
          mode: 'erase',
          radius: 0.04,
          hardness: 0.6,
          strength: 1,
          points: [{x:0.2,y:0.4},{x:0.25,y:0.42}]
        }
      ],
      feather: 0.002
    }
  ]
}
```

Only edited faces get entries. Metadata, face order, and each edited face's
exact full landmark snapshot are retained. Comparisons include `x`, `y`, `z`
values and whether `z` is present. Thus a same-ID/same-batch edited-face mesh
replacement, reorder, missing `z`, source replacement, fresh batch, detector
change, topology change, or detection-size change is rejected. Beauty/reshape
control changes do not invalidate the recipe. Unedited faces do not duplicate
their geometry into this recipe; their current geometry remains checked by the
full-batch processor. IDs are batch-local, not a claim of person identity across
new detections. Re-detection must start a fresh recipe.

No image pixel data, base mask, URI, data URL, image path, face photo or
`edgeShift` is permitted. The internal all-effect base is the constant one-pixel
`255` mask, not image data. The internal mask-replay revision is a private
constant so its shorter string limit does not truncate or rewrite the real
portrait `sourceRevision`; real metadata is checked outside mask-refine.

All records must be own-data ordinary/null-prototype records with enumerable
allowed string fields. Unknown fields, symbols, inherited defaults, accessors,
missing fields, sparse/decorated arrays, invalid prototypes and nonfinite
numbers are rejected. Snapshot/stroke/region accessors are not executed. Point
arrays are dense native arrays; each point is a strict `{x,y}` record.

### Brush limits and normalized geometry

- Maximum five edited faces, 32 strokes per face, 2,048 points per stroke and
  **4,096 aggregate raw points across all faces**. The raw total is charged before
  duplicate/collinear simplification, so high-rate event streams cannot bypass
  validation by simplifying to one point afterward.
- Points use normalized **image pixel edges** in `[0,1]`: pixel centers are
  `((x+.5)/width, (y+.5)/height)`.
- Radius is `[.002,.15]` times the output's **short edge**. No low-resolution mask
  resize or minimum-pixel-radius substitution is used.
- Hardness is `[0,.8]`, retaining a smooth falloff at the outer brush boundary.
- Strength is `[0,1]`; zero is inert.
- Feather is `[.0005,.01]` times the short edge; default `.002`. The exact frozen
  fractional, separable feather passes run once after replaying that face's
  strokes. No edge shift, morphology or binary confidence threshold is added.
- The frozen mask-refine continuous capsule path computes maximum coverage
  within a stroke, avoiding opacity that depends on duplicate pointer events or
  dab spacing. Separate strokes intentionally accumulate. Ordered keep strokes
  can restore effect after erase strokes.

## Resources, cancellation and failure atomicity

The hard ceiling is 8,388,608 pixels, a 4,096-pixel edge, 167,772,160 extra typed
array bytes and 256,000,000 conservative work units. Complex large renders can
hit the work ceiling below the dimension ceiling. Limits are safety bounds, not
performance claims or a guarantee of export availability on a real device.

`plan(...).faces` contains `{faceId,mask}` for every effectively edited face. Its
`mask` is the full-resolution frozen rasterizer plan, including segment visits,
coverage/box pixels, feather, output and scratch. No inactive keep-only or
zero-strength-only mask is allocated.

`plan(...).resources` exposes:

- `retainedOutputBytes = 4 * width * height` for the detached aggregate output.
- `maskWorkingBytes`: sum of **all** planned masks' output, scratch, decoded
  base, and queue bytes (queue is zero here because edgeShift is fixed zero).
- `estimatedPeakExtraBytes` / `extraPeakBytes`: output plus that sum. This
  deliberately covers all mask typed allocations even if garbage collection
  does not occur between faces, rather than assuming only the last mask exists.
- `cumulativeTypedArrayBytes`: the same conservative allocation sum.
- `estimatedWorkUnits` / `workUnits`: the sum of itemized
  `candidateValidationWorkUnits`, `outputCopyWorkUnits`,
  `maskWeightValidationWorkUnits`, `mergeWorkUnits`, `schemaWorkUnits`,
  `maskPlanningWorkUnits` and `maskRasterWorkUnits`. Raster work is charged once.
  The two mask-planning traversals are separately charged for segments, rows and
  active strokes; they do not run the full raster pixel loops. Finite/range scans
  cover every generated mask, while all RGB merges together visit at most one
  image's pixel count because the accepted face write domains are disjoint.
  These are conservative weighted scheduling units, not CPU instructions or
  measured timing.
- `preflightWorkUnits`: a separately exposed bound for one public `plan` call
  (`schemaWorkUnits` plus one of the two mask-planning traversal bounds). A
  wrapper that explicitly calls `plan` and then `apply` should add this extra
  preflight cost to the complete operation's work budget; `apply` itself already
  includes its own validation and preallocation plan.

All dimensions, recipe entries, aggregate budgets and regions are validated
before output/raster allocation. The wrapper must additionally budget the
frozen portrait processor and its retained candidate, which this plan excludes.
Source, canvas/native/GPU/history copies, JS metadata/VM overhead and unrelated
application allocations are also excluded and stated in the plan. This is not a
measured Android peak.

`shouldCancel` is checked before work, between planning/validation phases,
through candidate rows, mask rasterizer checkpoints, full-field checks, merge
rows and immediately before return. Cancellation throws `AbortError` with
`code: 'ABORT_ERR'`. No partial output is returned, neither source nor candidate
is mutated, and the caller must not commit a cancelled/stale result into history.
Allocation errors and all validation failures likewise return no partial pixels.
The trusted callback must not mutate input buffers or recipe state itself.

## Verification

Run `node --test tests/beauty-protection-core.test.cjs`.

The core suite uses deterministic synthetic RGBA fields and permitted synthetic
468/478 detector meshes, with no new model, downloads or external dependencies.
It covers an independent continuous-coverage/feather reference; two-face crossing
strokes; zero/one/intermediate weights; unchanged pixel support; null and
zero-strength identity; erase/keep replay; duplicate/dense events; full-resolution
diagonals and aspect ratio; source alpha/hidden RGB; batch, geometry and order
binding; malformed records/accessors; point, memory and work thresholds; native
buffer spoofing; and cancellation across phases.

The frozen dependency SHA-256 checks are:

- `portrait-people.js`: `0de2c158f3a23c6e4de8326e7474ad809e02d41ccc2931a5ccfba76505a02b3a`
- `mask-refine.js`: `1f87ce10085e42cf8e67309ac49dd6f608d40ecb32258ab8a76ed67b6bc4baa2`

These are core contracts, not claims of human-face visual quality, real-device
gesture correctness, release signing, store publication or learning-based repair.
