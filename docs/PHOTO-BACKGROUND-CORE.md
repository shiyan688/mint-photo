# B03 photo-background core contract

`app/src/main/assets/photo-background.js` exports the frozen UMD
`MintPhotoBackground` API. It requires the existing, unchanged
`MintImageOverlay` module (`image-overlay.js`) before browser loading. CommonJS
requires that module locally; AMD declares `./image-overlay`.

This module performs **background-only placement** and alpha composition. It
neither generates a person mask nor resizes, crops, warps, moves, or retouches
foreground pixels. It has no DOM, Canvas, file, URL, storage, network, model,
image decoder, metadata, or external-library dependency other than the frozen
local RGBA asset codec.

## API

```js
const r = MintPhotoBackground.defaults();
const normalized = MintPhotoBackground.validate(r);
const p = MintPhotoBackground.plan(width, height, asset, normalized);
const result = MintPhotoBackground.apply(image, mask, asset, normalized, {
  shouldCancel: () => false
});
```

- `defaults()` returns a new frozen complete recipe.
- `validate(recipe)` returns a new frozen normalized snapshot. Recipes cannot
  omit fields; there are no implicit partial-patch semantics.
- `plan(width, height, asset, recipe)` validates dimensions, recipe, resource
  estimates, and canonical asset encoding. It allocates no bulk pixel buffers.
- `apply(image, mask, asset, recipe, options?)` returns an image record with the
  same dimensions. If every output byte is unchanged it returns the original
  `image` object. Otherwise its RGBA array is newly allocated. Inputs, mask,
  embedded asset, and their backing buffers are never modified.
- `LIMITS` is frozen. There is no setter or caller-provided resource override.

The exact recipe is:

```js
{ version: 1, fit: 'fill', x: 0.5, y: 0.5, backdrop: null }
```

`fit` is either `fill` or `fit`. Finite numeric `x` and `y` are in `[0, 1]`;
negative zero is normalized to positive zero. `backdrop` is `null` or a
six-digit hex color. Hex letters can be supplied in either case and normalize
to lowercase. No alpha hex, color names, CSS expressions, or short hex forms
are accepted. The recipe intentionally contains no source provenance or
original image dimensions; those belong in the adapter's import metadata.

`image` is `{width, height, data}`, with exact-length same-realm native
`Uint8Array` or `Uint8ClampedArray` RGBA8 data. `mask` is the same record shape
with exactly `width * height` same-realm native `Float32Array` confidences in
`[0, 1]`. Every confidence is validated, including before an identity return.
Mask dimensions must match the target **exactly**, not just have the same area.
The mask is continuous, never thresholded.

`asset` is the existing canonical embedded asset shape:

```js
{ version: 1, width, height, data: 'canonical base64 RGBA8 bytes' }
```

The core checks its record and bounded dimensions before preflight, then uses
`MintImageOverlay.validateAsset` and `MintImageOverlay.decodeAsset` unchanged.
It does not duplicate or weaken canonical alphabet, padding, or pad-bit
validation. Encoded values contain pixels only, never filenames, URLs, or
image-container data. No import or network fetch can happen in the pure core.

## Placement and filtering

For target dimensions `(W,H)` and asset dimensions `(Aw,Ah)`:

- Fill scale is `max(W/Aw, H/Ah)`; fit scale is `min(W/Aw, H/Ah)`.
- Draw dimensions are `(Aw*scale, Ah*scale)`.
- `left = (W-drawWidth)*x` and `top = (H-drawHeight)*y`.
- Alignment `0` means left/top, `0.5` means centered, and `1` means right/bottom.
  In fill mode the available space can be negative, so alignment selects the
  crop without changing the foreground's coordinates.

Each destination pixel is a unit square. Its intersection with the placed
asset rectangle gives analytic, continuous geometric coverage. Uncovered fit
padding is transparent with a null backdrop. Transparent asset pixels remain
transparent, also in fill mode. A supplied backdrop is opaque and sits behind
both the photo's transparency and fit padding.

RGBA8 sRGB asset colors are converted to normalized **linear-light,
premultiplied RGBA**, stored in Float32 buffers. Hidden RGB beneath zero alpha
becomes zero before any filtering.

- At scale at least one, use edge-clamped bilinear filtering at the clipped
  destination cell's center and multiply by its analytic coverage. Edge
  clamping happens inside the photo footprint, not over an artificial
  transparent border.
- At scale below one, repeatedly reduce each non-unit dimension to
  `ceil(dimension/2)` until no axis with more than one texel exceeds two
  texels per destination pixel. Each reduction integrates the exact
  rectangular source-texel overlaps in premultiplied linear light. Odd edge
  texels receive their correct area weights, not repeated or dropped samples.
- The remaining mapped destination footprint is integrated as a box over that
  mip field. This is bounded area filtering, not nearest-neighbor stepping,
  arbitrary pixel blocks, or unfiltered point sampling. A final sample has at
  most nine taps mathematically; resource accounting reserves sixteen to cover
  floating-point endpoints on texel boundaries.
- Mip levels are an antialiasing approximation of the full-resolution field.
  Whole-image premultiplied means and uniform fields are preserved within
  Float32 precision, but arbitrary cropped footprints need not equal an
  expensive full-resolution exact-area integral after mip reduction.

No color-space profile is interpreted here: the import adapter must supply
ordinary sRGB RGBA8 pixels. Source-image byte colors are likewise interpreted
as sRGB. Normalized linear alpha is never gamma-transformed.

## Composition and exact branches

At each unchanged foreground coordinate:

1. Effective foreground alpha is `(sourceAlpha / 255) * confidence`.
2. Sample the transformed photo background. If requested, put it over the
   opaque backdrop color in premultiplied linear light.
3. Composite foreground over that result using continuous source-over alpha.
4. Unpremultiply only for nonzero result alpha, convert linear RGB to sRGB,
   and round alpha/RGB to RGBA8.

A fully selected, fully opaque foreground pixel is copied byte-for-byte, with
no transfer-function roundtrip. If all foreground pixels meet that condition,
return the original image after all schema/mask/asset validation. If the
sampled background is completely transparent, surviving source RGB is copied
exactly while its alpha alone is confidence-scaled. An output whose alpha
rounds to zero is canonical transparent black; hidden source colors are not
retained or allowed to bleed into visible output. These choices mean the
result of an entirely neutral operation may be the original image, except
that hidden colors in transparent output are intentionally normalized.

## Bounds, accounting, and cancellation

Existing mobile image bounds are unchanged:

| Resource | Limit |
| --- | ---: |
| Target longest edge | 4,096 px |
| Target pixels | 8,000,000 |
| Embedded asset longest edge | 1,024 px |
| Embedded asset pixels | 1,048,576 |
| Core extra buffers | 64 MiB |
| Core work units | 100,000,000 |
| Periodic per-pixel cancellation interval | 16,384 pixels |

All dimensions are positive safe integers. Shared, detached, resizable,
subclassed, foreign-realm, and wrong-brand buffers/views are rejected. Ordinary
fixed ArrayBuffer offset views are accepted. Native intrinsic typed-array
accessors are used; shadow `length`, `buffer`, `byteOffset`, `set`, and
`subarray` getters are never read.

Recipe/image/mask/asset/options records must have only the exact allowed own,
enumerable data properties and either the local Object prototype or null
prototype. Missing own fields, inherited required fields, symbols, hidden
fields, accessors, and unsafe prototypes are rejected without reading those
getters. This is data validation, not a JavaScript sandbox: a Proxy's own
reflection traps and a caller's cancellation callback are executable caller
code. Callbacks must not mutate, detach, or otherwise invalidate input buffers.

The frozen plan exposes:

- `width`, `height`, `targetPixels`, `assetPixels`, `assetWidth`, `assetHeight`.
- `scale`, `drawWidth`, `drawHeight`, `left`, `top`, and clipped integer `bounds`.
- `candidatePixels`, `maxSampleTaps`, `mipLevels`, `mipWidth`, `mipHeight`,
  `mipPixels`, and frozen `mipSizes`. `mipPixels`/`mipSizes` exclude the linear
  base level and include every reduced level.
- `decodedBytes = 4*assetPixels`.
- `baseLinearBytes = 16*assetPixels`.
- `mipBytes = 16*sum(reduced level pixels)`.
- `outputBytes = 4*targetPixels`.
- `allowanceBytes = 2 MiB` for small working records, codec overhead and lookup.
- Integer `extraBytes` equal to the sum of the preceding five byte categories.
  All float mip levels are reserved simultaneously; prompt garbage collection
  is not assumed. Estimates are conservative even when identity shortcuts
  avoid some buffers.
- Integer `workUnits` conservatively counts two canonical base64 scans, decoded
  byte writes and alpha visits, mask validation, linear-base conversion,
  mip taps/output, destination output visits and background taps. It is an
  algorithmic effort bound, not a CPU-instruction or wall-clock guarantee.

Preflight occurs before any decode, float-image, mip, or output allocation.
Plan accounting excludes caller-owned target/mask/embedded strings and adapter
Canvas staging, mask generation/refinement, and project copies. The adapter
must add its other live buffers and work to its existing aggregate limits;
this module does not grant a larger mobile memory profile.

`options` may contain only optional function `shouldCancel`. It is called
before work and bulk allocations, after validation/decoding, periodically
through confidence/base-conversion/output loops, and on every mip/output row.
Cancellation throws `AbortError` with `code: PHOTO_BACKGROUND_CANCELLED` and
never publishes a partial result. The frozen shared asset codec has no
cancellation parameter: its bounded canonical scan/decode is atomic here,
with checks immediately before and after. Schema errors use
`PHOTO_BACKGROUND_INVALID`; dimension/resource/range-limit errors use
`PHOTO_BACKGROUND_LIMIT`. Shared asset errors are normalized to these codes.

## Verification

Run:

```sh
node --test tests/photo-background-core.test.cjs
```

Tests cover API loaders, full strict schemas, descriptor safety, local brands
and buffers, inherited/shadow getters, malformed canonical base64, integer
limits, equal-area wrong mask dimensions, confidence finiteness, asymmetric
fill crops and fit padding, continuous fractional coverage, translucent source
and background, linear-light mixing, hidden-RGB fringes, optional backdrop,
exact stationary opaque foreground, source immutability, aliasing buffers,
120 deterministic randomized comparisons to an independent small-image oracle,
checkerboard minification, odd-dimensional weighted means, extreme aspect
ratios, honest byte accounting, bulk-allocation preflight, and cancellation
through every long phase. Integration and project replay tests belong to the
adapter layer and do not replace these pure-core tests.
