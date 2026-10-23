# MintImageOverlay v1 integration contract

Candidate-only implementation: `image-overlay.js`. No production files were edited
by this worker. Pure JavaScript UMD with CommonJS, AMD and browser-global
`MintImageOverlay` entry points. No imports, dependencies, Canvas/DOM, network,
file access, timers, native image decoder, URI resolver, signing, or private photos.
The API and public limits are frozen.

## API

- `defaults()` returns a fresh frozen complete recipe.
- `validate(recipe)` strictly validates and returns a fresh frozen canonical recipe.
- `validateAsset(asset)` strictly validates a bounded embedded asset, including the
  entire canonical base64 encoding, and returns a fresh frozen asset record. Its
  immutable base64 string may be shared; no pixel buffer is allocated.
- `encodeAsset({width,height,data})` accepts already-decoded local straight-alpha
  RGBA8 pixels within asset limits and returns a frozen embedded asset. It does
  not read files or import image formats.
- `decodeAsset(asset)` validates before allocation and returns a fresh
  `{width,height,data:Uint8ClampedArray}`. Each call creates an independent buffer.
- `layout(width,height,asset,recipe)` runs the same geometry/resource preflight as
  `apply` and validates the entire asset without allocating any pixel buffers.
  It returns the frozen layout/resource record documented below.
- `apply(image,asset,recipe,{shouldCancel} = {})` validates, plans and composites.
  The target image is never mutated. Changed results are fresh plain
  `{width,height,data:Uint8ClampedArray}` records. Exact no-ops return the **original
  input object and buffer**: opacity zero, entirely transparent assets, no sampled
  coverage, or a rendered result whose bytes all equal the target. Callers must
  therefore not assume every successful call returns a new object or buffer.

Invalid input is rejected rather than coerced, truncated, silently defaulted or
partially rendered. `undefined`/`null` are not default recipes or assets. Only
omitting the options argument supplies an empty options record.

## Strict schemas

Recipe, every field required:

```js
{
  version: 1,
  x: 0..1,
  y: 0..1,
  size: 0.02..2,
  rotation: -180..180,
  opacity: 0..1,
  flipX: boolean,
  flipY: boolean
}
```

Defaults: `{version:1,x:0.5,y:0.5,size:0.5,rotation:0,opacity:1,
flipX:false,flipY:false}`. Numbers must be finite primitive numbers. Negative zero
canonicalizes to positive zero. All fields are checked even at opacity zero.

Embedded asset, every field required:

```js
{version:1,width:positiveInteger,height:positiveInteger,data:canonicalBase64}
```

`data` is exactly `width*height*4` row-major straight-alpha RGBA8 bytes encoded as
standard padded base64. Alphabet is A–Z, a–z, 0–9, `+` and `/`; `=` only occurs in
its required trailing positions. Nonzero pad bits, missing/redundant padding,
URL-safe alphabet, whitespace, data URLs and unpadded encodings are rejected.
Encoded length is checked before scanning characters. Validation uses bounded
scalar loops, not an unbounded/backtracking regex or a file decoder. No `uri`,
`url`, file path, MIME or arbitrary metadata fields are accepted. A caller that
imports an image must decode/orient/downsize it separately, then call
`encodeAsset` with the reviewed bounded working pixels.

Target/encoding-input image: exactly `{width,height,data}`. Options: either `{}`
or exactly `{shouldCancel:function}`.

Every record must have the exact allowed **own enumerable data properties**, with
no missing keys, extra fields, symbols, hidden fields, accessors, inherited
fallbacks, array prototypes or custom/class prototypes. Ordinary local Object
and null prototypes are accepted. Values are copied from property descriptors;
property getters are not invoked. Primitive type/dimension checks precede numeric
work or pixel allocation.

Pixel `data` is a local native `Uint8Array` or `Uint8ClampedArray`, exactly
`width*height*4` entries. Native subarray views and offsets are accepted. Buffer,
DataView, ordinary arrays, wider typed arrays, foreign-realm typed arrays and
subclassed arrays are rejected. Backing buffers must be local ordinary attached
fixed-size ArrayBuffers, not shared/resizable/subclassed buffers. Intrinsic
length/buffer/offset getters and native copying bypass user-defined shadow
getters/methods. **The strict property-set rule applies to records, not every
indexed property of the pixel view.** Expando/shadow fields on a native pixel
view are ignored and are never read. Enumerating up to 32 million typed-array
index keys would itself violate the bounded-memory objective. Numeric pixels
are native indexed elements, not arbitrary JavaScript getters.

Native ImageData wrappers have their own prototype, so integrations should pass
`{width:im.width,height:im.height,data:im.data}`, not ImageData itself.

Portable JavaScript cannot reject every transparent Proxy without reflection
traps executing. Proxies/executable hostile objects and globally monkey-patched
intrinsics are outside the plain-data contract. Descriptor validation does not
invoke ordinary accessors, but Proxy reflection traps can run. JSON-parsed recipe
and asset data is the intended portable replay boundary.

## Geometry

Coordinates use continuous image edges: target spans `[0,width] × [0,height]`,
with destination pixel centers `(x+0.5,y+0.5)`.

- Overlay center is `(recipe.x*width,recipe.y*height)`.
- Displayed **long edge** is `recipe.size*min(width,height)`.
- Uniform scale is `displayedLongEdge/max(asset.width,asset.height)`.
- Aspect ratio is preserved. There is no stretching or crop-to-box behavior.
- Positive rotation is clockwise in normal y-down image coordinates.
- Flips mirror source sampling around the overlay center in its local axes,
  before rotation. They do not move or resize the footprint.
- The transformed rectangle is clipped only by the target canvas. Coordinates
  outside the allowed normalized range are rejected, not clipped into range.
- Exact 0, ±90 and ±180 degree angles use exact sine/cosine values.

`layout` returns:

```js
{
  width,height,assetWidth,assetHeight,
  centerX,centerY,drawWidth,drawHeight,scale,cos,sin,
  bounds:{x,y,width,height},
  active,candidatePixels,interiorPixels,boundaryPixels,samples,
  mipLevels,mipWidth,mipHeight,mipPixels,
  mipSizes:[{width,height}, ...],
  workUnits,extraBytes
}
```

`bounds` is the clipped conservative destination pixel rectangle with half-open
right/bottom edges. It can include untouched corner pixels around rotation.
`active` means nonzero opacity and nonempty geometry, not guaranteed changed
pixels or known nontransparent asset content. All nested bounds/mip records and
arrays are frozen. `mipSizes` excludes the original asset and lists each generated
level in order; `mipPixels` is the sum of all generated level pixel counts.

For each destination row, the planner intersects two pairs of transformed
half-planes with that row. It counts candidate and fully interior destination
pixels before allocating pixel buffers. The rasterizer uses the same intervals.
It does not scan every pixel of a large rotated bounding box just to reject its
corners. Fully interior and edge candidates are counted separately and exactly
for this algorithm; conservative measure-zero candidates may still contribute
no sample coverage.

## Filtering, edge antialiasing and source-over

Filtering uses premultiplied alpha in **encoded sRGB byte space**, followed by
standard source-over. This is not linear-light rendering or color-management.
Inputs must already have the desired working color space; embedded data has no
ICC profile or metadata.

1. If a source dimension that can still be reduced exceeds **2 texels per output
   pixel**, generate a box-filtered mip level. Each dimension becomes
   `max(1,ceil(previousDimension/2))`. Repeat until each reducible dimension has
   density ≤2. A dimension already at one texel cannot be reduced further.
2. Each new level is an area-overlap box average covering the complete previous
   image. Odd sizes use their true fractional overlaps rather than uneven pair
   groups. Each output texel touches at most 3×3 previous texels. RGB is
   premultiplied by alpha before averaging, and all generated channels are stored
   as Float64 values. Zero-alpha hidden colors never enter the result. Geometry
   remains based on the original aspect ratio, not rounded mip dimensions.
3. A fully interior destination pixel takes one bilinear sample at its center
   from the selected level. No mip is generated at 1:1 or enlargement, preserving
   exact aligned source pixels. Difference-form bilinear interpolation preserves
   constant fields exactly, including a 127.5-valued checkerboard mean.
4. A destination pixel touching the transformed geometric boundary uses a fixed
   **4×4** grid at offsets 1/8, 3/8, 5/8 and 7/8 of the pixel. Each subpixel has
   weight 1/16. Out-of-rectangle samples contribute transparent zero; inside
   samples use the same premultiplied bilinear filtering. This provides
   intermediate rotation/translation edge coverage instead of binary clipping.
   Samples exactly on local left/top edges are in; right/bottom edges are out.
5. Bilinear coordinates clamp to edge texel centers **inside** the footprint.
   There is no additional transparent filter border, which would incorrectly
   soften an exactly aligned opaque 1:1 rectangle.
6. Global opacity multiplies both sampled alpha and premultiplied color, then
   the result composites source-over the original target pixel.

In formulas, sampled `A` is 0..255 and sampled premultiplied channel `P` is
`channel*alpha` (0..65025). With opacity `o`, destination channel `D`, and
original destination alpha `Ad`:

```text
As = A * o
inverse = 1 - As/255
Ao = As + Ad * inverse
Co = (P*o + D*Ad*inverse) / Ao
```

RGBA output uses `Math.round` to integers and Uint8ClampedArray storage. A sample
with zero source alpha leaves all target bytes untouched. If output alpha rounds
to zero on an already-transparent destination, its original hidden RGB is
retained. All unsampled/out-of-footprint pixels remain byte-exact, including
hidden RGB. Target reads always use original input pixels, never output pixels.

Limits are intentional: fixed 4×4 geometric-edge coverage is approximate and can
miss extremely thin/subpixel slivers. Interior bilinear filtering is not a
full-pixel integration, and a selected mip can still contain up to 2 texels per
output pixel. Discrete mip changes can slightly alter apparent sharpness. This
is a bounded practical overlay filter, not anisotropic/Lanczos/SOTA resampling,
not a claim of analytic coverage, and not a cross-backend bit-equivalence claim.
Floating point behavior at exact rounding boundaries can vary with arithmetic
rearrangement; use this core for consistent preview/export/replay when required.

## Resource limits, preflight and cancellation

Frozen `LIMITS`:

| Name | Value |
|---|---:|
| maxPixels / maxEdge | 8,000,000 / 4,096 |
| maxAssetPixels / maxAssetEdge | 1,048,576 / 1,024 |
| maxAssetBytes | 4,194,304 |
| maxAssetBase64Chars | 5,592,408 |
| minSize / maxSize | 0.02 / 2 |
| edgeSamplesPerAxis | 4 |
| maxMipTexelsPerPixel | 2 |
| maxWorkUnits | 100,000,000 |
| maxExtraBytes | 67,108,864 (64 MiB) |
| cancelIntervalPixels | 16,384 |

Every dimension is a positive safe integer. All hard limits apply even at opacity
zero. `apply` validates options and target, snapshots the recipe/asset record,
computes the complete plan and checks its budget, then scans canonical base64,
before allocating decoded asset/output/mip buffers. `layout` does the same
preflight and canonical scan without any pixel allocations.

Let `P=targetPixels`, `B=assetBytes`, `C=assetBase64Chars`, `R=bounds.height`,
`I=interiorPixels`, `E=boundaryPixels`, `M=sum(mipLevelPixels)`:

- `samples = I + 16*E`
- Active `workUnits = C + B + B/4 + P + I + E + 4*samples + 13*M + 8*R`
- Active `extraBytes = 2 MiB + B + 4*P + 32*M`
- Inactive `workUnits = C`; inactive `extraBytes = 2 MiB`

Work units bound character scans, decoded-byte writes, alpha checks, copied
pixels, candidate pixels, bilinear texel taps, mip texel taps/writes and row
geometry. They are not literal CPU instructions, latency estimates or only
changed pixels. Mip work budgets all 9 source taps plus 4 output writes per new
texel even when fewer neighbors exist. Mip memory counts **every generated
Float64 level allocation**, not just two simultaneously reachable levels, so
intermediate level collection is not needed to fit the estimate.

The 2 MiB allowance covers small plans, bounded arrays/chunks, wrappers and
accounting, not a real reserved buffer. Asset strings and caller-owned input
pixels already exist and are not extra allocations from `apply`. The estimate
does not cover JS/runtime overhead, encoder/Canvas backing stores, parent image
pipeline buffers, retained history assets, callback allocations, or physical
memory pressure. It is not an OS allocation guarantee. The parent must bound its
whole pipeline and catch allocation errors.

`encodeAsset` accounts `2 MiB + 4*encodedLength` for output/intermediate strings,
uses bounded 8192-character chunks, and never spreads a large buffer into a
function. `decodeAsset` accounts `2 MiB + assetBytes`. Both are bounded by the
asset caps; only `apply` accepts cancellation options.

`shouldCancel` is called before pixel allocation, during base64 validation and
decoding in bounded chunks, during the alpha scan, on every mip and raster row,
during chunked target copying, at most every 16,384 raster/mip pixel visits, and
immediately before return. Truthy means throw `AbortError` with code
`IMAGE_OVERLAY_CANCELLED`. Hook exceptions propagate unchanged. No partial result
escapes. No source mutation occurs on successful rendering, invalid input,
cancellation, callback failure, or allocation failure.

Cancellation is synchronous/cooperative, not event-loop yielding or a wall-clock
responsiveness promise. To cancel in response to UI events while compositing,
use an appropriate worker/orchestration mechanism. Callers/hooks must not mutate
or detach source pixels while the core runs. The core never writes the source,
but cannot prevent an external callback from doing so.

## Errors and integration responsibilities

- TypeError / `IMAGE_OVERLAY_INVALID`: schema/type/base64/prototype errors.
- RangeError / `IMAGE_OVERLAY_LIMIT`: numeric, dimension, work or memory limits.
- Error named AbortError / `IMAGE_OVERLAY_CANCELLED`: cooperative cancellation.
- Callback and platform allocation errors propagate unchanged.

Keep one bounded embedded working asset in each actual image-overlay operation,
not a URI dependent on a temporary file grant. Preserve the primary image and
operation ordering. Selection/import consent, image decoding/orientation,
import-size limits, UI, operation/history/project validation, deletion and preview
staleness are parent responsibilities. This core does not store or upload data.

## Verification

`npm test` / `node --test image-overlay.test.cjs` runs the dependency-free tests.
The suite covers UMD entry points; strict hostile schemas/accessors/base64;
native/detached/shared/subclassed views; input offsets; identity and immutable
input; exact aligned pixels; source-over alpha; rotation/flips/clipping/aspect;
intermediate geometric edge coverage; hidden RGB; 300 independent randomized
pixel-oracle cases; extreme/near-cardinal geometry; high-frequency and
transparent-color minification; odd-dimension whole-image area means; cancellation
and thrown allocation errors; allocation-free preflight; a real maximum 1MP asset
roundtrip and two actual 8MP compositions (one full-frame, one mip-filtered).

`TEST_RESULTS.txt` records the latest run. No native Android/device test or
cross-backend comparison was performed by this isolated-core worker. Integration
must run its own application, operation/history and device checks.
