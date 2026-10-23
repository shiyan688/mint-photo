# Replayable confidence-mask refinement core

`app/src/main/assets/mask-refine.js` is a dependency-free UMD module, exported as `MintMaskRefine` and CommonJS. It edits a single-channel confidence mask only. It does not perform segmentation inference, generate missing hair, read RGB, composite images, infer a foreground clip, or modify old baked masks/history. Fine-resolution manual commands are replayable; the model base remains its original coarse resolution.

## API

- `defaults(sourceRevision, baseMask?)`: a fresh version-1 recipe. Omitted base is `{width:1,height:1,data:'AA=='}` (zero confidence), with no strokes and zero adjustments.
- `validate(recipe, {sourceRevision}?)`: a fully independent, JSON-portable canonical snapshot. If the optional expected revision is supplied it must match exactly; no revision is inferred or substituted. Duplicate and forward-collinear event points are removed. Limits are checked on the original point arrays before simplification.
- `plan({width,height}, recipe)`: dimensions-only validation and full cumulative work/memory preflight. Does not allocate typed image buffers.
- `rasterize({width,height}, recipe, {shouldCancel}?)`: `{width,height,data,diagnostics}`. `data` is an owned row-major `Float32Array`, one confidence value in `[0,1]` per pixel. A supplied `shouldCancel` property must contain a function. A truthy callback result throws an `AbortError` with `code: 'ABORT_ERR'`.

The caller owns associating a recipe with the correct ordered source stage. Call `validate(recipe, {sourceRevision: currentStageRevision})` when admitting/replaying it. Rasterization preserves the revision recorded in the recipe and has no source image with which to verify it independently.

### Strict version-1 recipe

```
{
  version: 1,
  sourceRevision: "nonempty string, at most 160 UTF-16 code units",
  base: {width: integer, height: integer, data: "canonical Base64 UInt8 confidence"},
  strokes: [{
    mode: "keep" | "erase",
    radius: 0.0005 ... 0.25,
    hardness: 0 ... 1,
    strength: 0 ... 1,
    points: [{x: 0 ... 1, y: 0 ... 1}, ...]
  }],
  edgeShift: -0.02 ... 0.02,
  feather: 0 ... 0.02
}
```

All fields shown are required. No unknown fields, symbols, accessors, nonenumerable record fields, sparse arrays, array subclasses, nonfinite numbers, unsafe record prototypes, typed-array bases, or implicit string/number conversions are accepted. Ordinary and null-prototype records are accepted; arrays must be ordinary dense native arrays with own data entries. Optional fields are read only from validated own descriptors, never inherited. This blocks getter-based input side effects; JavaScript proxies can still run their reflection traps and are not a supported trust boundary. Base64 must have the exact encoded byte length, standard alphabet, correct padding, and zero unused pad bits; whitespace and URL-safe variants are rejected. Negative zero canonicalizes to zero.

## Geometry and processing order

1. **Continuous model confidence.** Decode UInt8 base values and divide by 255, without thresholding. Bilinearly sample using pixel centers, `sourceX = (x + 0.5) * baseWidth / outputWidth - 0.5`, and clamp to the base border. A neutral recipe at matching base dimensions preserves every original code exactly to Float32 representation. Different dimensions perform only this declared bilinear resampling.
2. **Ordered manual strokes.** Points refer to normalized **pixel edges**, so `(x,y)` maps to `(x*width,y*height)`. Samples are at pixel centers `(column+0.5,row+0.5)`. Radius is `recipeRadius * min(width,height)`, without any minimum-pixel floor. A stroke covers the continuous union of capsules along the entire polyline, including round endpoints. A one-point stroke is a disk. There are no dabs, event-density opacity accumulation, or segment-end sampling holes.
3. **Signed edge shift.** Positive values expand confidence by maxima; negative values shrink it by minima, over the full image domain, after all strokes.
4. **Symmetric feather.** A normalized, symmetric separable fractional box filter softens both sides of the resulting boundary. It is not clipped back to the initial model foreground.

For brush distance `d`, pixel radius `r`, and hardness `h`, coverage is 1 at `d <= h*r`, 0 outside `d > r`, and `q*q*(3-2*q)` in between, with `q=(r-d)/(r-h*r)`. Hardness 1 is a hard disk. Maximal coverage is collected over the **whole stroke**, then its strength is applied once: keep uses `a + (1-a)*coverage*strength`; erase uses `a*(1-coverage*strength)`. Different strokes deliberately accumulate in order. Strength zero skips the stroke completely. A keep stroke may restore confidence in any initially transparent region. No RGB, source-image alpha, or foreground eligibility mask limits it.

Duplicate points and redundant forward-collinear points canonicalize using a `1e-12` normalized-coordinate roundoff tolerance. This is not a resolution-sized path simplifier. The same straight or piecewise-straight geometry with sparse/dense events receives the same canonical path and resource budget. Reversals and real bends remain. Capsules are evaluated by distance, not approximated through resampling. Pixel-center sampling intentionally does not invent antialias coverage or widen a subpixel brush: a tiny stroke between sample centers can affect no pixel, but a diagonal through pixel centers has no artificial dab gaps.

### Continuous edge shift, and border behavior

The edge-shift distance is `abs(edgeShift)*shortEdge`. For each axis let `n=floor(distance)` and `f=distance-n`. The extrema include all samples from `-n` to `n` plus the linearly interpolated samples at `±(n+f)`. Horizontal then vertical passes produce a bounded separable continuous morphology. Integer distances correspond to square/Chebyshev support, **not** an exact circular Euclidean distance transform. Fractional changes are continuous; distance zero is exactly bypassed.

Feather uses `radius=feather*shortEdge`, unit-weight taps `-floor(radius)..floor(radius)`, fractional-weight outer taps at `±(floor(radius)+1)`, and normalization `2*floor(radius)+1+2*fraction`. One horizontal and one vertical pass are applied. It is a square separable box profile, not Gaussian/learned matting. Zero feather is exactly bypassed.

Both filters replicate the nearest image-border value. There is no implicit zero matte outside the canvas. Therefore uniform confidence stays uniform, including an all-foreground mask at the image border. Values remain continuous in `[0,1]`; soft model alpha is never binarized. Tiny floating-point differences are limited by Float32 storage between passes.

## Bounds, allocation, work, and cancellation

- Output: at most **8,388,608 pixels**, at most **4096 per edge**, positive integer dimensions.
- Base: at most **262,144 pixels**, at most **1024 per edge**.
- Commands: at most **128 strokes**, **2048 points per stroke**, **4096 total original points**; each stroke has at least one point.
- Typed working buffers, including output: capped at **160 MiB**. The implementation uses one Float32 output; at most one Float32 scratch shared by coverage, morphology and feather; one UInt8 decoded base; and an optional Int32 deque of at most the largest image edge. It retains no full-image dab list or per-stroke image stack.
- Conservative cumulative scheduling budget: **256,000,000 work units**. All stroke candidate visits, per-stroke clear/blend bounding-box visits, polyline rows, base sampling, extrema deque passes, and feather initialization/pass loops are counted before typed buffers are allocated. Units are weighted pixel-loop costs, not individual CPU instructions or a wall-clock promise. Complex but schema-valid recipes may fail the work cap; long sparse strokes cannot bypass it.

`plan()` exposes output dimensions, short edge, pixel radii, active stroke count, segment count, `dabCount: 0`, segment rows, candidate `coverageVisits`, cumulative `strokeBoxPixels`, `workUnits`, and buffer byte counts (`outputBytes`, `scratchBytes`, `baseBytes`, `queueBytes`, `maxWorkingBytes`). Byte accounting is exact for typed buffers; bounded recipe/segment records and engine bookkeeping are additional small metadata, not image-sized arrays. Even the largest configuration uses under 65 MiB of typed buffers, leaving ample room below the 160 MiB ceiling for these records.

`diagnostics` also exposes actual base, coverage, clear, blend, segment, morphology, deque, and feather visits, plus `actualWorkUnits <= workUnits`. Every input is validated and snapshotted before cancellation callbacks run. Callbacks cannot change in-flight geometry by changing the original recipe. Cancellation is checked before allocations, during planning and Base64 decode, at every raster row and segment, and at every filter scanline. No partial output is returned, and input data/recipes are never mutated. This is synchronous computation: a callback can observe an already-shared cancellation flag, but cannot itself make the main-thread event loop run.

## Verification

Run `node --test tests/mask-refine-core.test.cjs`.

Focused tests cover the UMD browser/Node contract; all neutral byte-confidence codes; soft/bilinear base confidence; transparent-domain keep/erase; zero strength; ordering; sparse/dense and duplicate/collinear canonicalization; minimum-radius gap-free diagonals; exact edge-coordinate/short-edge conventions; independent brute-force capsule/morphology/feather references; border and degenerate dimensions; fractional continuous edge shifts; symmetric feather; repeatability; cancellation with input immutability; maximum-output planning; cumulative budget failure before typed allocation; malformed Base64; schema limits; accessors/symbols/unsafe prototypes and inherited optional getters; and seeded arbitrary/nearly-axis-aligned paths.

A maximum-output smoke run at 4096×2048, with maximum edge shift and feather, produced 8,388,608 Float32 confidence samples using 67,125,249 planned typed-buffer bytes. Its planned/actual work counts were 185,047,041 / 168,263,681. Runtime is environment-dependent and is not an Android latency guarantee.
