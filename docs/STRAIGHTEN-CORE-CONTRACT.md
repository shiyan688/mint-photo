# MintStraighten 1.0.0

Shared pure JavaScript transform integrated into the Android ordered raster pipeline. The core itself needs no new dependency, model, Canvas, network, signing, or security change. Mobile budgets and lifecycle are enforced by the separate adapter.

## Loading and API

- CommonJS: `const S = require('./straighten.js')`.
- Browser classic script: global `MintStraighten`.
- Frozen API: `version`, `LIMITS`, `defaults`, `validate`, `isActive`, `plan`, `apply`, `mapEdgePoint`.
- `defaults()` returns a fresh frozen `{ version: 1, angle: 0, mode: 'expand' }`.
- `validate(recipe)` returns a fresh frozen canonical recipe. `null`/`undefined` select defaults; otherwise all three fields must be own enumerable data properties and no other fields are accepted. Angle is a finite number in `[-180,180]`, clockwise in screen coordinates. Mode is exactly `expand` or `crop`. Negative zero becomes positive zero. No coercion.
- `isActive(recipe)` is exactly `validate(recipe).angle !== 0`.
- `plan(width, height, recipe)` returns a deeply frozen metadata plan without allocating source/output image buffers. Its input dimensions are the actual source dimensions, never a smaller preview proxy for the full-size operation.
- `apply({width,height,data}, recipe, {shouldCancel?})` returns `{width,height,data}`. `data` must be an exactly sized, same-realm native `Uint8Array` or `Uint8ClampedArray`. Output is `Uint8ClampedArray`. No source byte is modified.
- **Identity:** angle zero returns the exact original image object and its exact original data view, without making an output buffer. The caller must not later mutate it under the assumption it is a copy.
- **Nonidentity:** every nonzero accepted angle returns a fresh image object and output data, even when output dimensions happen to equal the input.

## Plan fields and integration

- `version: 1`, `recipe` (canonical recipe snapshot).
- `sourceSize`, `outputSize`: `{width,height}`.
- `quarterTurns`: `0`, `1`, `2`, `3` only for exact integer-degree multiples of 90; otherwise `null`. `isQuarterTurn` is the corresponding boolean.
- `cos`, `sin`: clockwise rotation coefficients.
- `sourceCenter`, `outputCenter`: `{x,y}` in **pixel-center index coordinates**, so a W-pixel dimension has center `(W-1)/2`.
- `cropCenterExtents`: `null` for expand and quarter-turn paths; otherwise `{x,y,integerWidth,integerHeight}`. `x,y` are approximate floating continuous center spans. The integer fields are authoritative and match `outputSize`; preserving sub-ULP contractions can make these one smaller than `floor(x)+1` on extremely near-quarter boundaries.
- `geometryTolerance`: `64 * Number.EPSILON * max(1,width,height)`, used only for finite geometric feasibility/corner verification, never to snap an angle to a quarter turn.
- `estimates`:
  - `sourcePixels`, `outputPixels`: logical raster areas, including identity's logical output area.
  - `sourceBytes`: `4 * sourcePixels`.
  - `outputBytes`: allocated output RGBA bytes, zero for identity and `4 * outputPixels` otherwise.
  - `totalRgbaBytes`: `sourceBytes + outputBytes`.
  - `extraBytes`: `outputBytes + 2048`; the fixed 256-entry Float64 sRGB decode table is conservatively counted once. Excludes input, small JS metadata, VM overhead, caller-owned Canvas/backbuffers, downstream images, and any application pipeline copies.
  - `bilinearTaps`: at most `4 * outputPixels` for arbitrary angles, zero for integer branches.
  - `workUnits`: zero for identity, `outputPixels` for nonzero quarter turns, otherwise `bilinearTaps`. It is a bounded operation-count proxy, not an exact instruction or time estimate.
- `apply` additionally checks actual source backing-buffer bytes plus output bytes. A small subview retaining a backing buffer larger than the memory ceiling is rejected before output allocation. `plan` cannot know the backing-buffer size.
- No `maxSide` or automatic resize option exists. The caller must independently enforce its stricter full-resolution limits before preview allocation or execution. Android integration is expected to enforce 8 MP / edge 4096 / its 128 MiB pipeline accounting and cumulative work limit separately.

## Exact quarter turns and arbitrary inverse mapping

Only `angle % 90 === 0` selects the integer branch. There is no epsilon angle snap and no positive-modulo normalization before this test. All RGBA bytes, including hidden RGB beneath alpha zero, are copied exactly for nonzero quarter turns. The mapping agrees byte-for-byte with frozen mobile `geometry.js` when its crop is full and flips are disabled. ±180 both map to 2 turns, −90 to 3, +90 to 1. Exact quarter turns ignore crop-vs-expand differences because the rotated image is already rectangular.

For arbitrary angles, trigonometry is evaluated on a small signed residual from the nearest exact quarter turn, then transformed by that quadrant. This avoids losing the difference between the two adjacent representable degree values around 90°. A nonzero residual that underflows to zero radians is explicitly rejected with `STRAIGHTEN_LIMIT`, not silently treated as identity.

For output pixel index `(x,y)`, inverse sampling is:

```
dx = x - outputCenter.x
dy = y - outputCenter.y
sx =  cos*dx + sin*dy + sourceCenter.x
sy = -sin*dx + cos*dy + sourceCenter.y
```

No geometric scale factor is introduced. Sampling uses the four neighboring source pixel centers. Samples outside the source are transparent black. Coordinates are not clamped to hide a faulty crop plan.

## Expand mode

Output dimensions are the ceil of the rotated **source edge** AABB:

```
width  = ceil(abs(cos)*sourceWidth + abs(sin)*sourceHeight)
height = ceil(abs(sin)*sourceWidth + abs(cos)*sourceHeight)
```

The implementation evaluates this ceil with an integer base plus a separately ceiled small signed increment, using `1-a = b*b/(1+a)` for `a=max(abs(cos),abs(sin))`, `b=min(...)`. It does not add an almost-zero positive increment to a large integer before ceiling it. Thus 100×1 at 90°−1 ULP correctly expands to 2×101, and 2×3 at 1e-20° to 3×4. The previous candidate incorrectly returned 2×100 and 2×3 respectively; both are saved as regression assertions. A 16384×1 input at 1e-20° now correctly fails preflight because its planned output is 16385×2. Exact zero/quarter turns still bypass floating AABB math.

The source and destination centers coincide. Transparent corners are intentional. Bilinear filtering can produce partially transparent antialiased edge pixels. There is no edge replication, inpainting, background fill, hidden resize, or corner removal.

## Crop mode and exact quantization intent

For arbitrary angles, crop is an explicit centered axis-aligned rectangle inside the rotated **source pixel-center bounds**, not the outer source edges. Set `W=sourceWidth-1`, `H=sourceHeight-1`, `c=abs(cos)`, `s=abs(sin)`. The continuous output center spans `X,Y` maximize `X*Y` subject to:

```
c*X + s*Y <= W
s*X + c*Y <= H
X >= 0, Y >= 0
```

The optimizer evaluates feasible product-stationary peaks on each linear constraint and their intersection. The 45-degree/parallel case requires no small determinant division; a symmetric sum/difference intersection is used close to 45 degrees. Well-conditioned intersections use an integer base plus a separate small correction, preserving true tiny contractions near exact quarter turns before quantization.

The mathematical quantization is `floor(X)+1` by `floor(Y)+1`, equivalent in real arithmetic to `floor(X+1)` but avoiding premature addition rounding. For well-conditioned intersections, the correction is floored before addition to the integer base. The plan independently inverse-maps all four **final raster center corners** and rejects a corner beyond source center bounds, allowing only the stated floating-point tolerance. Sampling does not clamp these corners. An opaque source therefore gives fully opaque crop pixels, including corners.

This definition deliberately maximizes **continuous center-span area before flooring**, not the number of integer output pixels. Example: a 3×4 source at 31° produces 2×2, although a different feasible 2×3 integer rectangle exists. This is a documented quantization choice, not hidden zooming. A genuinely oblique 1×N/N×1 source yields a centered 1×1 crop, since no non-degenerate axis-aligned rectangle can fit inside a rotated line. At exact quarter turns, the full N×1/1×N raster is preserved.

Boundary examples:

- 4×3 at exact 90° → 3×4; at either adjacent representable degree value → 2×3.
- 2×1000 at 90° ± 1 ULP → 999×1, not 1000×1.
- 2×1000 at 0.001° → 1×999; at 45° → 1×1.
- 100×100 at 45° → 71×71; at 90° ± 1 ULP → 99×99.

**Numerical limitation:** JavaScript IEEE-754/libm trigonometry is not an interval/high-precision real-number solver. The targeted near-quarter contraction and near-axis expansion increments are preserved, but at other transcendental integer boundaries an extent within trig roundoff of an exact integer can quantize differently by one pixel. Example: 3×1000 at `30.000000000000004°` can produce the same height as exactly 30° because the sine rounds to 0.5. No broader exact-real-number flooring/ceiling guarantee is claimed. All final corners must still satisfy the explicit geometric tolerance and opaque-corner tests.

## Color and alpha

- Decode each 8-bit sRGB color through the exact IEC-style piecewise sRGB formula into a 256-entry Float64 table. Every possible input byte is represented directly; no interpolated or approximate LUT is used.
- Accumulate bilinear weights in **linear-light, premultiplied alpha**. Hidden RGB with source alpha zero contributes nothing.
- Unpremultiply by the accumulated unquantized alpha, then encode through the exact piecewise sRGB formula and round to 8 bits. Alpha is rounded to 8 bits separately.
- If output alpha rounds to zero, output RGB is zero too.
- The arbitrary branch is resampling, not a lossless rotation. Identity and exact quarter turns intentionally bypass it to preserve every byte.
- Independent reference tests permit at most one output-byte difference to accommodate rounding at the differing double-precision matrix/trig accumulation boundaries; this is not a LUT approximation allowance.

## Limits, validation and cancellation

Core limits: edge 16384, source and output each at most 64 Mi pixels, source+allocated-output RGBA at most 512 MiB, and at most 256 Mi bilinear taps. The old mobile Geometry module's edge limit is 32768; the new core intentionally uses the approved stricter 16384 ceiling.

Recipe, image, options and point records accept only `Object.prototype` or null prototypes. All required fields must be own enumerable data properties. Extras, symbols, hidden fields, accessors, arrays, and unsafe prototypes are rejected using descriptors before field values are used. Missing optional fields are not inherited, and inherited `shouldCancel` getters never execute. Typed-array metadata uses intrinsic getters, not shadowable `.length`/`.buffer` properties. Native same-realm data views only; Buffer, subclasses, foreign-realm typed arrays, detached/shared/resizable/subclassed buffers and incorrect lengths are rejected. Fixed-length RGBA subviews are allowed, with the full backing buffer counted for the memory ceiling. Typed-array custom metadata is ignored rather than enumerating millions of indexed properties.

All strict preflight occurs before output-pixel allocation or calling the user callback. There is one output pixel allocation for nonidentity; no linear floating image copy or other full-size scratch image is created.

`shouldCancel` must be a function if present. It is checked before allocation, at every output row, every 1024 pixels within a row, and once after processing. A true return throws an `AbortError` with `code='STRAIGHTEN_CANCELLED'`; no partial image escapes. Callback exceptions propagate. Detaching the source during a callback is detected and rejected. The core never mutates source pixels; callbacks should be side-effect free. This is synchronous code: cancellation checks do not themselves yield to browser UI events. A worker or application scheduling strategy is still needed for responsiveness.

Validation errors are `TypeError` with `STRAIGHTEN_INVALID`; dimension/angle-range/budget/underflow violations are `RangeError` with `STRAIGHTEN_LIMIT`. Ordinary allocation failures can still throw the engine's error: numeric budgets cannot guarantee available process memory.

## Optional edge-point mapping

`mapEdgePoint(plan, {x,y}, direction='forward')` uses an actual frozen plan issued by this module; forged/copy plans are rejected. Coordinates are pixel **edge** coordinates (source center `width/2,height/2`). Directions are `forward` or `inverse`. It returns a new `{x,y}` without clipping, so a source point outside the centered crop can map outside the output. Input coordinates must be finite within ±32768. This method is not a hit-test and does not clamp points to the canvas.

## Evidence and performance

Run in this source package: `node --test tests/straighten-core.test.cjs`.

31 tests pass in Node 24.19.0, covering independent RGBA/reference sampling, all asymmetric sizes 1…9×1…8 at all exact turns, byte parity with frozen mobile Geometry, 5,000 random crop problems against independent 1-D optimization, brute-force feasible small rectangles, exhaustive small opaque crops, near-quarter/thin/45-degree geometry, all input-byte color/alpha values at a centered sample, hostile records/getters/views, preallocation budget/cancel checks, mid-row/final cancellation, source detachment and edge-point roundtrips.

An independent read-only numerical audit also passed 19,602 nearest-90-degree dimension cases (zero mismatches), 10,000 random crop problems (zero corner violations; maximum relative area difference 1.38×10⁻¹² versus independent bisection), and 756 boundary/thin cases including 288 strict near-quarter checks.

After the expand-ceiling correction, a separate 100-digit Decimal oracle passed all 1,360 valid/rejected geometry cases, and 10 independent core audit tests passed. This specifically verifies the previously failing near-zero/near-90-degree expand extents and preflight rejection at the edge ceiling.

Observed single cloud-Node runs (not device performance guarantees):

- 900×600 preview-size input, 13° expand → 1012×788: 83 ms.
- 2000×2000 (4 MP), 13° crop → 1667×1667: 411 ms.
- 1280×800, 13° expand → 1428×1068: 145 ms.
- 4000×2000, 13° crop → 3835×1167: 611 ms.
- 4000×2000, exact 90° → 2000×4000: 121 ms.

No Android runtime, WebView, UI, export, visual-device comparison or full 64-Mi-pixel allocation benchmark is claimed by this candidate. Parent integration owns downstream-operation order, mobile memory totals, thumbnails, preview/original coordinate conversion, UI cancellation and device acceptance tests.

## Packaged test references

The packaged tests require `../app/src/main/assets/straighten.js` and the sibling frozen Geometry module through relative paths. The production core has no path dependencies. The core's optional null default is not a persisted operation default: `MintStraightenOperation.validate` requires a complete, nonnull recipe.

Independent adversarial integer-boundary probing added 2,058 Pythagorean-angle cases. Of those, 576 differ by one pixel from an ideal-real 100-digit oracle, within the already disclosed binary64 integer-boundary limitation; this is not claimed as 2,058 exact-real matches. The 8×8 crop at 36.86989764584403° has a real span 4.999999999999999928… but a binary64 planned span 5, producing 6×6 rather than 5×5. The inverse-corner discrepancy is about 1.007×10⁻¹⁶. Final-corner tolerance and opaque-alpha checks remain mandatory.
