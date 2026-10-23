# MintRedact v1 integration contract

Candidate only: `redact-core.js`. Pure JavaScript UMD, no imports, dependencies,
Canvas, DOM, network, file access, timers, or UI. CommonJS, AMD and browser-global
(`MintRedact`) entry points expose the same frozen API. Files in production were
not edited by this worker.

## API

- `LIMITS`: frozen public limits, listed below.
- `defaults()`: fresh, independent, deeply frozen complete default recipe.
- `validate(recipe)`: strictly validate and return a canonical, deeply frozen,
  independent snapshot. Throws; does not silently coerce, clamp, truncate or
  ignore unsupported fields. `null` / `undefined` are not defaults.
- `isActive(recipe)`: validate, then report whether at least one stroke exists.
  A geometrically tiny stroke can miss all pixel centers but remains active.
- `plan(width, height, recipe)`: validate and perform exactly the same resource
  preflight as `apply`, without allocating any pixel buffers. Frozen result:
  `{width,height,pixels,active,mode,blockEdge,gridColumns,gridRows,gridCells,
  strokeCount,totalPoints,segmentCount,segmentRows,workPixels,extraBytes}`.
- `apply({width,height,data}, recipe, {shouldCancel} = {})`: validate and preflight
  before output allocation, then return RGBA data. Neutral recipes return the
  **exact input wrapper object and input buffer**, with no pixel allocation.
  Active recipes return a fresh plain `{width,height,data}` with a fresh native
  `Uint8ClampedArray`, even if pixels happen not to change. No source pixel is
  ever written on success, validation failure, cancellation or callback failure.

The input wrapper must be an own, plain data record with exactly those three
fields. Wrap native `ImageData` as `{width: im.width,height: im.height,data: im.data}`.
Data must be an exact native `Uint8Array` or `Uint8ClampedArray` with exactly
`width*height*4` entries. Subarray views and offsets are supported. Intrinsic
typed-array length/buffer/offset getters are used; shadow getters are not read.
Shared, resizable, detached, subclassed and non-native buffers/views are rejected.
Ordinary arrays, Buffer, DataView and float/16-bit pixel arrays are rejected.
Input bytes are unpremultiplied 8-bit RGBA, in row-major order.

## Exact recipe schema

```
{
  version: 1,
  mode: 'mosaic' | 'cover',
  blockSize: 0.01..0.25,
  color: '#rrggbb',
  strokes: [{radius: 0.002..0.5, points: [{x: 0..1, y: 0..1}, ...]}, ...]
}
```

All fields are required own enumerable data properties. No symbols, hidden
fields, accessors, inherited fallbacks, extra fields, unsafe record prototypes,
array subclasses, sparse arrays or array custom fields are accepted. Ordinary
Object/Array prototypes and null prototypes are accepted; output is canonical
ordinary records/arrays. Numbers must be primitive finite numbers. Colors accept
exactly six hexadecimal digits and canonicalize to lowercase; negative zero in
coordinates canonicalizes to positive zero. Each stroke needs at least one point.

Defaults: `{version:1, mode:'mosaic', blockSize:0.04, color:'#173e31', strokes:[]}`.
Validation always checks every field, including block size in cover mode and
color in mosaic mode. Coordinates/radius never clip invalid recipe values.
Only the generated pixel mask clips at image boundaries.

Portable JavaScript cannot detect every transparent Proxy. Descriptor-based
validation does not invoke property getters, but Proxy reflection traps can run;
untrusted executable Proxy objects are outside the plain-data contract. Likewise
this module does not defend against globally monkey-patched JavaScript intrinsics.
Data records parsed from JSON are the intended project-replay input.

## Hard capsule coverage

Coordinates map to `x*(width-1), y*(height-1)`. Pixel centers use integer `(x,y)`
coordinates, including the first and last rows/columns. Radius means
`radius * min(width,height)`, not diameter. Each segment is the closed capsule
formed by the centerline rectangle plus round endpoint discs; a single point or
duplicate-point segment is a disc. A gesture is the union of all its capsules;
all gestures are unioned. Collinear subdivision, duplicate events, reversed
segments, repeated gestures and stroke order do not compound opacity or color.
No alpha brush, soft edge, antialiasing, feather or sampling-gap stamping exists.

For reproducible floating-point boundary handling, squared radius includes
`64*Number.EPSILON*max(1, radiusInPixels^2)`. The resulting hard boundary expands
the mathematical radius by less than `2e-11` pixels at supported limits. This is
not a soft boundary: each pixel is wholly inside or outside, and cover writes
alpha 255. Analytic scanline intersections use bounded rectangle edges rather
than slope division, including subnormal near-axis slopes. Conservative integer
endpoint rounding is checked against distance to the segment.

Every pixel outside the union mask stays byte-exact, including hidden RGB.
Coverage is independent of input alpha.

## Cover and mosaic semantics

**Cover:** every covered pixel is replaced with the exact requested RGB and
alpha `255`, including previously transparent pixels. It is the opaque option;
the editor must not offer opacity or feathering for this recipe. Whether a
chosen region covers everything the user intends still requires user judgment.

**Mosaic is decorative, not secure redaction.** It can leave recognizable text
or faces and preserves alpha. Grid origin is the image origin, never the stroke
origin. Cell edge is `max(1, round(shortEdge*blockSize))` integer pixels. Partial
right/bottom cells include only in-bounds pixels. The average is computed from
the entire original-source cell, not merely covered pixels:

```
R = round(sum(sourceR * sourceAlpha) / sum(sourceAlpha))
G = round(sum(sourceG * sourceAlpha) / sum(sourceAlpha))
B = round(sum(sourceB * sourceAlpha) / sum(sourceAlpha))
```

For each covered pixel with nonzero alpha, set that RGB and preserve its exact
source alpha. Alpha-zero pixels retain **all four original bytes**, including
hidden RGB, even in a cell with nonzero alpha elsewhere. Zero-alpha-only cells
therefore remain byte-exact. RGB sums use JavaScript numbers and remain far
below the safe integer limit. Rounding is `Math.round`, not Uint8ClampedArray's
tie-to-even conversion. Input is treated in its current encoded byte space;
there is no gamma/linear-light or color-space conversion.

All averages read original `data`, never already-modified output, so overlap
and processing order cannot feed edited pixels back into subsequent results.

## Limits, resource preflight and cancellation

Public limits:

| Name | Value |
|---|---:|
| maxStrokes | 64 |
| maxTotalPoints | 4096 |
| maxPixels | 8,000,000 |
| maxEdge | 4096 |
| minRadius / maxRadius | 0.002 / 0.5 |
| minBlockSize / maxBlockSize | 0.01 / 0.25 |
| maxExtraBytes | 134,217,728 (128 MiB) |
| maxWorkPixels | 64,000,000 |
| cancelIntervalPixels | 16,384 |

Dimensions must be positive safe integers. Pixel and edge limits apply even to
neutral operations. There is no downsample fallback, truncated stroke, skipped
work or success value returned after a limit breach.

Let `P=width*height`, `S=sum(max(1,pointsPerStroke-1))`, `C=gridCells`.
`segmentRows=height*S`. For active operations:

- `workPixels = 2*P + height*S` for cover (copy + output-mask scan + geometry).
- `workPixels = 3*P + height*S` for mosaic (also original-source averaging).
- `extraBytes = 2 MiB + 256*totalPoints + 256*strokeCount + 4*P +
  4*(width+1) + 160*S + (mosaic ? 3*C : 0)`.

Work units are bounded pixel/geometry **visits**, not literal distinct changed
pixels or CPU instructions. A geometry visit does a constant number of float
operations, at most four rectangle-edge intersections, two disc intersections,
and two endpoint distance checks. Worst-case geometry is <=16,777,216 visits,
not covered-area times event count. Row difference counts fit Int32. There is
no full-image mask buffer or per-pixel list of segments. Valid supported sizes
and recipes fit both caps. Using independent maxima even the deliberately loose
extra-buffer estimate stays below 58 MiB; actual representative plans are saved
in `SYNTHETIC_PIXEL_EVIDENCE.json`. An 8MP active cover allocation is also tested.

For neutral operations workPixels is zero and extraBytes includes only the
2 MiB allowance plus recipe accounting; it does not imply an actual 2 MiB
allocation. Preflight makes only bounded recipe/plan objects, no pixel buffers.
The estimate covers this core's extra buffers/recipe allowance, not the source
image, browser/JS runtime, Canvas backing stores, decoded originals, encoder,
other pipeline stages, hook allocations or deferred-GC behavior. It is not a
measurement or reservation of physical memory. Parent should preflight its
whole pipeline as well and catch platform allocation failures.

`shouldCancel` is an optional own function property, with no other options.
Called before pixel allocation, throughout chunked source copy and mosaic
sampling, on every scanline, every 256 segment tests, and once immediately before
return. Truthy means throw `AbortError` with code `REDACT_CANCELLED`. No partial
result escapes. Exceptions from the hook propagate unchanged. This is synchronous
cooperative cancellation, not event-loop yielding or a promised wall-clock bound.
To react to UI events during an active run, use an appropriate worker/chunked
parent orchestration rather than expecting the main event loop to run inside it.
Callers/hooks must not mutate or detach the source concurrently. This core never
modifies it, but cannot prevent code outside the core from doing so.

## Errors and integration

- `TypeError`, `code: 'REDACT_INVALID'`: unsupported/non-data schema, primitive
  number/type/enum/color errors, source/options data shape errors.
- `RangeError`, `code: 'REDACT_LIMIT'`: numeric range, dimensions, point/stroke,
  resource budget errors.
- `Error`, `name: 'AbortError'`, `code: 'REDACT_CANCELLED'`: cooperative cancellation.
- Hook exceptions and runtime allocation errors propagate; no fake result.

Do not edit frozen validated snapshots in UI. Clone into UI state, validate
again at boundaries. Store/replay the recipe with original normalized image
coordinates and current operation order. Obtain `plan` before decoding a large
image or accepting an expensive history operation. The core intentionally does
not own UI, project schema versioning, export encoders, thumbnail invalidation,
worker scheduling or alternate render branches.

## Verification and evidence

Run `npm test` or `node --test redact-core.test.cjs` (no dependencies).
Run `npm run evidence` / `node synthetic-evidence.cjs` to recompute the JSON pixel
evidence. `TEST_RESULTS.txt` records the actual final test run. Tests include
CommonJS/global/AMD, descriptors and accessors, budgets, RGBA alpha cases,
outside-mask byte identity, neutral object identity, one-pixel dimensions,
clipping, 320 randomized independent pixel-distance oracle comparisons,
1-to-4096-point line density invariance, near-tangent and subnormal slopes,
source subarray offsets, repeated/overlapping/reversed strokes, cancellation at
early/mid/final checkpoints, actual 8MP allocation, and resource preflight.

Computed example: an origin-anchored 2x2 cell with RGBA
`[100,0,0,255]`, `[0,100,0,128]`, `[0,0,100,0]`, `[100,100,100,64]` gives
`[71,43,14]` weighted RGB. Alpha values remain 255,128,0,64 and the hidden
blue pixel stays `[0,0,100,0]`. The 9x9 capsule evidence records the exact 17-pixel
hard mask and opaque `[18,52,86,255]` result over transparent input.

These are synthetic Node tests, not Android/WebView/Canvas/PNG/JPEG/thumbnail
or browser tests. Those final pipeline claims belong to parent integration QA.
