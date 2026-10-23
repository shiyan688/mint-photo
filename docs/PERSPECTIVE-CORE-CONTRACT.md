# MintPerspective 1.0.0 candidate contract

Pure, synchronous, dependency-free four-corner projective rectification for RGBA8 images. `perspective.js` and `perspective.cjs` are byte-identical UMD builds: browser global `MintPerspective`, or `require('./perspective.cjs')`. No DOM, canvas, network, models, file I/O, signing, detection, UI, or existing application files are involved.

## API and recipe

- `defaults()` returns a deeply frozen, fresh neutral recipe.
- `validate(recipe)` accepts `null`/`undefined` as neutral, otherwise strictly validates and returns a deeply frozen detached snapshot. Invalid data or geometry throws; nothing is silently repaired or reordered.
- `isActive(recipe)` validates and reports whether the recipe differs from the exact neutral recipe. This is recipe activity, not whether a particular rounded raster happens to change.
- `plan(width, height, recipe, options?)` returns a deeply frozen issued plan without pixel-buffer allocation or callback invocation.
- `apply(image, recipe, options?)` preflights completely, then returns an RGBA image. It never mutates source pixels. Cancellation or failure throws without returning a partial image.
- `mapEdgePoint(issuedPlan, point, direction)` maps pixel-edge coordinates or returns `null` for invalid/nonissued/outside inputs. Direction is mandatory, exactly `sourceToOutput` or `outputToSource`.

The only supported non-null recipe shape is:

```js
{
  version: 1,
  quad: [
    { x: 0, y: 0 }, // correspondence: output top-left
    { x: 1, y: 0 }, // correspondence: output top-right
    { x: 1, y: 1 }, // correspondence: output bottom-right
    { x: 0, y: 1 }  // correspondence: output bottom-left
  ],
  outputFraction: { width: 1, height: 1 }
}
```

Quad coordinates are normalized source **pixel-edge** coordinates, inclusively `0..1`: source `(0,0)` is its outer top-left edge, `(width,height)` its outer bottom-right edge. These are not pixel-center/landmark coordinates. Labels are correspondences, not a request to sort points. Cyclic rotations with positive winding are valid deliberate rotations. Reversed winding/reflection is invalid.

All fields are mandatory. Width and height fractions must be finite and strictly greater than zero, at most one. Declared pixels are independently `max(1, Math.round(currentFullInputAxis * fraction))`, including ordinary JavaScript half-up rounding. Positive subnormal fractions validly become one output pixel. Fractions are relative to the **entire current stage input**, not the quad bounding box, opposite-edge lengths, or the original photo before upstream stages. They permit proportional recipe replay on working/preview inputs; they do not encode physical object dimensions, recover a camera metric, or imply a uniquely correct aspect ratio. The caller must show the declared output size before applying/exporting.

The selected quad fills the complete output rectangle. There is no transparent expansion canvas: the outside region is cropped away. Normal interpolation support may include source pixels whose centers fall just beyond a selected quad boundary; this is not a separate hard pixel mask.

## Options, limits and plan fields

```js
{
  maxSide: 900,                  // optional positive integer <= 16384
  shouldCancel: () => false,    // optional synchronous callback
  limits: {                    // optional, any subset; lower-only
    maxEdge: 4096,
    maxPixels: 8000000,
    maxBytes: 128 * 1024 * 1024,
    maxWorkUnits: 128000000
  }
}
```

Core ceilings: source, declared output and rendered output edges <=16384 and each <=64 Mi pixels; retained source plus newly allocated output RGBA and all retained Float32 mip levels <=512 MiB; mip construction plus sampling/copy work <=256 Mi work units. These are simultaneous ceilings, not a promise that every 64-Mi-pixel operation fits: a full 8192² minification pyramid plus source exceeds 512 MiB and is rejected before allocation. All caller-supplied caps must be positive integers no greater than the corresponding core ceiling. `maxSide` is a rendering option, not permission to exceed a source cap. The example phone policy is usable directly, while the host adapter must also account for its own readback, ImageData, canvas/GPU/history and concurrent operations.

Plan fields:

- `sourceSize: {width,height}`: full current input dimensions.
- `outputSize: {width,height}`: declared dimensions derived from fractions, unaffected by `maxSide`.
- `renderedSize: {width,height}`: actual raster dimensions after proportional `maxSide` downsize. Scale is `min(1,maxSide/max(declared axes))`, then each axis rounds independently with minimum one. Never upscales beyond the declared size.
- `renderScale: {x,y}`: actual rendered/declared per-axis ratios after rounding.
- `kind`: `identity`, `copy`, or `resample`; `copyRect` gives exact integer source bounds for `copy`, otherwise null.
- `workUnits`: zero for identity, one per copied output pixel, otherwise `4*sum(mipPixels) + renderedPixels*sampleCountBound*tapsPerSample`. The certified sample count is 1..16; taps per sample are 4 with no mip levels or 8 when trilinear can occur. Geometry validation/JS bookkeeping is not modeled as image work. This is a conservative bound, not a measured count.
- `estimatedBytes`: dimension-based source RGBA plus allocated output RGBA plus all Float32 mip bytes, same as `estimates.totalBytes`.
- `mipBytes`, `mipLevels`: total retained mip bytes and frozen descriptors `{level,width,height,scale,pixels,bytes}`. Source is level 0 and is never copied into a full-size float buffer.
- `sampling`: filter policy, hard `maxSamples:16`, certified `sampleCountBound`, `tapsPerSample`, global major/minor/base footprint upper bounds and anisotropy ratio upper bound. `maySoftenMinorAxis` is a conservative warning that the 16-sample cap could increase the base LOD; it is not a claim that every pixel reaches the cap.
- `estimates`: `sourcePixels`, `declaredOutputPixels`, `outputPixels` (actual rendered pixels), `sourceBytes`, `outputBytes` (zero for identity), `totalRgbaBytes` (source+output only), `mipBytes`, `mipPixels`, `totalBytes` (source+output+mips), `extraBytes` (output+mips+2048-byte static decode table), `staticTableBytes`, `workUnits`, `mipWorkUnits`, `sampleWorkUnits`, `maxFootprintBound`, `sampleCountBound`, `tapsPerSample`, `bilinearTaps` (all bounded final-raster taps, not mip-building taps).
- `recipe`, `limits`, normalized `outputToSourceMatrixNormalized` and `sourceToOutputMatrixNormalized`, plus `geometry` diagnostics are frozen snapshots.

Matrices operate between the unit output square and normalized source coordinates, not directly in pixel units. `mapEdgePoint` is the supported pixel-unit interface. Its output coordinate space is always **actual rendered** pixel edges, so source-view projective thirds can be obtained from `(renderedWidth/3,0)` etc. Passing declared coordinates to a downscaled plan is incorrect. A real issued plan is required, not a JSON clone or a look-alike. The core uses a private WeakSet to validate ownership.

`plan` cannot know unused backing-buffer retention from dimensions alone. `apply` additionally counts the source typed array's complete native backing byteLength, including bytes outside a legal subview, together with output and all mip buffers before allocation/callbacks. `maxBytes` excludes the static 2KiB table, small JS objects, VM overhead, caller buffers/canvases, GPU memory and other operations. No numeric budget guarantees available process memory. Ordinary allocation failure may still throw the engine's allocation exception.

Preview work renders directly into `renderedSize`; there is no declared-size intermediate output image. A minifying preview can allocate the explicitly budgeted source-derived mip pyramid; source-size input readback and mip construction are not free simply because the output is tiny. Even a neutral recipe with a smaller `maxSide` directly resamples into the preview. The exact neutral recipe without actual downsize returns the original image object and backing array byte-for-byte. A host choosing to skip neutral operations must handle its preview downsize separately.

## Geometry and numerical safety

All geometry tests use normalized source coordinates, so valid huge/thin source aspect ratios do not themselves become degenerate quads. The four edges must each have Euclidean length >=1e-6; each consecutive cross product must be strictly >1e-10 with sine >=1e-6; signed area must be >=1e-8. Positive screen-coordinate winding and four strict convex turns reject crossed, concave, repeated and nearly collinear quads.

An analytic square-to-quad homography is constructed. All matrix/inverse entries and the determinant must be finite, determinant strictly positive. The denominator is affine over the complete unit square; its four corners certify global positive minimum and maximum. Minimum/maximum ratio must be >=1e-6, so no interior pole can be hidden between samples. The normalized infinity-norm matrix condition number must be <=1e8.

The source Jacobian determinant is `det(H)/denominator^3`, providing positive finite global minimum and maximum. Each derivative numerator is affine in one axis; endpoint maxima divided by the global denominator minimum squared bound all four derivatives across the entire square. Their squared sum divided by the minimum Jacobian bounds the local normalized-coordinate condition number and must be <=1e12. This is a conservative bound: some extreme but mathematically nonsingular quads intentionally fail. Forward and inverse corner reprojection are also checked before plan issuance. Geometry is never rescued by clamping invalid points into a valid quad.

Mapping first rejects coordinates outside the source/full output rectangle. Source-to-output additionally tests every source-quad half-plane before inverse projection, using fixed normalized perpendicular boundary roundoff <=256 machine epsilons (approximately 5.68e-14). The inverse condition number never widens that accepted source region. Exactly/on-edge points can have final floating-point values clamped to the boundary within the documented roundoff/reprojection tolerance. Truly outside points beyond that numerical tolerance return null. Invalid direction, forged plan, malformed point, nonfinite values, inherited/accessor fields, and missing fields return null rather than throwing from the mapping API.

## Sampling, alpha, bounded antialiasing and exact crops

Output pixel centers `(x+.5,y+.5)` are normalized by the actual rendered dimensions, inverse-mapped to source pixel **edges**, then converted to sample-center coordinates by subtracting `.5`. The center's finite source-domain check precedes all filtering. The selected quad's interior is never geometrically padded or extrapolated beyond the source image.

The exact neutral recipe returns the original object without touching bytes, including alpha-zero hidden RGB. An axis-aligned quad with exactly representable integer source-edge products and actual output dimensions equal to its integer crop extent uses byte copying and also preserves hidden RGB. No near-integer snapping occurs. A nonneutral fraction that rounds to unchanged dimensions can therefore use a byte-preserving copy rather than filtering. All other transforms are resampling, not lossless image edits.

The base kernel decodes every source input byte using the exact piecewise sRGB formula into a 256-entry Float64 table. It accumulates linear-light premultiplied alpha, unpremultiplies at the end, and uses exact piecewise sRGB encoding. Alpha rounds separately. Alpha-zero input hidden RGB contributes nothing, and RGB is zero whenever output alpha rounds to zero.

For minification, retained Float32 RGBA mip levels hold `(linearRed*alphaByte, linearGreen*alphaByte, linearBlue*alphaByte, alphaByte)`, not gamma-encoded or quantized 8-bit intermediate colors. Level 1 averages four source samples; each next level averages four preceding-level samples. Dimensions independently ceil-divide by two; a missing odd-edge child repeats the preceding level's last cell. The pyramid has no full-size float level 0. Every required mip's complete 16-byte/pixel storage and four-child construction work are counted. The global footprint bounds determine the required highest level; construction stops at 1×1 even for extreme footprint bounds.

Coordinates at level L use fixed source-edge scale `2^L`: sample center is `sourceEdge/2^L-.5`, never normalized-source-coordinate times the rounded mip dimensions. This avoids spatial drift for odd sizes such as 577×289. Odd boundaries repeat the previous LEVEL's terminal cell recursively; they are not an exact original-pixel area integration beyond the edge. At every level the outer pixel/cell is repeated to cover filter support. The filtered footprint can extend beyond the selected quad or source boundary even though its valid center cannot; edge extension is intentional filter support, never repair of invalid geometry.

At each output center the analytic inverse homography Jacobian is converted into source-pixels per output-pixel. Its largest singular value `major` and positive determinant give stable `minor=det/major`; zero, negative or nonfinite local determinants are rejected rather than made positive. `base=max(1,minor,major/16)` sets mip LOD `log2(base)`, clipped to the constructed range. With no minification along the minor axis and a major footprint at most 16, LOD is zero, so no unnecessary base blur is introduced.

The major SOURCE-space direction is the principal eigenvector of `J*J^T`. Use `N=ceil(major/base)` with a tiny relative roundoff guard, bounded 1..16. `N` equally weighted source samples span `major-base` along that direction, with endpoints at ±half the span. For N=1 sample only the center. Each sample uses bilinear interpolation in the surrounding mip levels and blends their premultiplied values trilinearly. Distributing only the extent not already covered by the base avoids a discontinuous blur jump when scale moves just above unity. A final alpha/RGB conversion occurs only after all samples accumulate.

The anisotropic scheme preserves the unminified axis in the 8:1 and 16:1 axis-aligned stripe tests. Above 16:1, the bounded policy raises the base LOD to `major/16`, deliberately trading some minor-axis detail for finite work and alias suppression. `sampling.maySoftenMinorAxis` warns when conservative plan bounds indicate this may occur. It is an approximation, not exact projective area/EWA integration or an unlimited anisotropic filter. Strong compression and extreme skew can still soften detail. Filter footprints are local Jacobian approximations, not a globally integrated curved footprint.

Per-plan work bounds are not a blanket 128-taps/pixel charge. An elementwise absolute derivative-bound matrix bounds the major singular value across the full output. Minor's upper bound is the minimum of the certified row/column norms and square root of the maximum positive Jacobian determinant. The minimum positive determinant gives `anisotropyBound=majorBound²/minDet`. Therefore `sampleCountBound=boundedCeil(min(majorBound,anisotropyBound))`, capped 16; `baseFootprintBound=max(1,minorBound,majorBound/16)` bounds required mip LOD. Actual pixel sample count is guarded against escaping the issued bound. Work uses 4 taps/sample with no mips, 8 when a mip blend can occur, plus all mip construction. All memory/work caps remain preallocation checks.

Independent double-precision/reference tests permit at most one output-byte difference at float intermediate and accumulation/rounding boundaries, not a gamma approximation allowance. The module makes no automatic lens correction, learned/SOTA model, camera calibration, super-resolution, or physically metric rectification claim.

## Strict data, errors and cancellation

Recipe, nested point/fraction, image, options and limit records allow only `Object.prototype` or null prototypes. Mandatory fields must be own enumerable data properties. Unknown/hidden fields, symbols, accessors and inherited/unsafe prototypes are rejected before field values are used. Quad must be a same-realm ordinary dense four-element array without holes/extras/accessors/hidden entries. `validate` snapshots all fields, so subsequent caller recipe edits do not affect a plan.

Image must be `{width,height,data}` using a genuine same-realm native Uint8Array or Uint8ClampedArray view with exact length `width*height*4`. Native typed-array getters and native tag getter validate length, backing and byte brand. Overridden view metadata (`length`, `buffer`, `byteLength`, `byteOffset`) or own symbols are rejected without invoking getters. Ordinary Buffer, subclass, foreign-realm, Float32/Uint16-prototype-spoofed and fake typed arrays are rejected. Nonmetadata custom typed-array properties are not enumerated or used. The backing must have native ArrayBuffer prototype and actual nonshared, nonresizable native slots; spoofing SAB's prototype or shadowing `resizable` cannot bypass the native getter checks. Fixed subviews are allowed. Shared, detached, resizable and subclassed backing stores are not. Like ordinary JavaScript validation, reflection on caller-supplied Proxy objects can run Proxy traps; this is not a security sandbox for hostile realms or replaced intrinsics.

Errors: `TypeError` with `PERSPECTIVE_INVALID` for malformed records/types/views; `RangeError` with `PERSPECTIVE_LIMIT` for ranges/dimensions/resources; `RangeError` with `PERSPECTIVE_GEOMETRY` for inadmissible/singular/unstable geometry. Cancellation throws `AbortError` with `PERSPECTIVE_CANCELLED`. Callback exceptions propagate unchanged.

All strict/resource preflight runs before pixel allocation or calling `shouldCancel`. `plan` validates a supplied callback but never calls it. `apply` checks it before allocation, before/after every mip level, each mip/output row, each additional 1024-pixel span inside a row, before output allocation and after processing. Identity has only the initial check because no processing follows. Any truthy synchronous callback result cancels. Source detachment during any callback is detected before continued sampling. The source is never modified by the core, but callbacks must themselves be side-effect free. Synchronous checks do not pump the browser event loop; host worker/scheduling support is still needed for UI responsiveness.

## Verification and scope

Run `node --test tests.cjs` beside the core files. Current focused suite: 40/40 passing, no skips, Node 24.19.0. Coverage includes:

- UMD loading and byte parity; deep immutable snapshots and strict own-data validation.
- 323 neutral asymmetric sizes plus all hidden color bytes; 2500 exhaustive exact integer crops on power-of-two grids.
- 2500 random convex quads, 20,000 independently Gaussian-solved grid/corner projections and inverse roundtrips.
- 250 independently sampled random RGBA images, using original-source scalar kernel weights and numerically differentiated independent homography for anisotropic filtering; stripe/checkerboard/nonlinear gradients; all 256 color/alpha values; alpha halos and alpha-zero rules.
- Declared/rendered dimension split, direct bounded preview allocation, one-pixel outputs, huge/thin source planning, normalized reprojection, degeneracy and conservative condition rejection.
- Native backing-brand, accessor, spoofed metadata, RAB/SAB, detached source and retained-subview attacks; preflight memory/work/source caps; preallocation/midrow/final atomic cancellation.
- Issued-plan mapping, explicit directions, outside points, and thin-quad outside membership without condition-number-expanded tolerance.
- Severe checker minification; exact 8:1 and 16:1 untouched-axis stripes in both orientations; near-unity/no-minify behavior; 16-sample cap diagnostics; exact mip allocations/work accounting; cancellation during mip construction and final anisotropic rendering.

Independent app audit accepted final core SHA256 `3a3b57ea8da4ce4a7c99b180a454e9f00a4242a0460621d267ad5487fbe66557`: 38/38 passing, no skips; 31,434 homography mappings; 30 exact-reference rasters/9,960 channels with maximum byte delta zero; 2,205 independently finite-differenced Jacobians within certified sample/mip bounds; 8:1 and 16:1 untouched-axis stripe cases exact. The separate app audit report and evidence own those results. Its prefiltered quality fixtures observed checker 256²→17² maximum error 1 versus independent linear-light area integration (old bilinear 119); sharp-text 577×289→97×49 RGB MAE approximately 4.02 (old bilinear 20.70); 8:1 unminified-axis stripes exactly preserved in both orientations (the rejected isotropic-only mip draft lost that detail). These fixture comparisons are quality evidence, not proof that this approximate filter equals exact area integration. Do not infer an Android/device pass from Node/host-Canvas tests. No UI, application integration, Android runtime, canvas/export parity, actual-device performance, full 64-Mi-pixel render allocation or full application acceptance claim is made here. Parent integration owns operation order, history/project serialization, masks/landmark coordinate conversions, host memory accounting and caller UI behavior.

Single cloud-Node timing observations for the antialiased version with an opaque test image (not device guarantees): 1280×800→900×563 perspective preview 395 ms, mip 4,096,000 bytes; 2000×1000→1600×800 perspective 823 ms, mip 8,000,000 bytes; 4000×2000→900×450 direct preview 531 ms, mip 42,000,000 bytes. Timings vary by hardware, image alpha/content and runtime warm-up. These synchronous runs still require host worker/scheduling support for responsive UI cancellation.
