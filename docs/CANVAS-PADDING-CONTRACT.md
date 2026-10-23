# MintCanvasPadding 1.0.0

Pure, synchronous RGBA8 canvas expansion. This candidate adds border pixels only. It does not scale, crop, interpolate, premultiply, color-correct, decode, encode, invoke Canvas, or modify a source buffer. No model, download, key, license service, or third-party package is required.

## Loading and exports

- CommonJS: `const padding = require('./canvas-padding.js')`.
- Browser script: `globalThis.MintCanvasPadding`.
- AMD: an anonymous zero-dependency module.
- Frozen public API: `version`, `LIMITS`, `defaults`, `validate`, `measure`, `plan`, `apply`.
- `version` is the string `"1.0.0"`; recipe schema `version` is the number `1`.
- `LIMITS` is frozen: `{ maxPixels: 67108864, maxEdge: 16384 }`.

## Recipe

`defaults()` returns a fresh object:

```js
{ version: 1, top: 0, right: 0, bottom: 0, left: 0, color: '#ffffff', opacity: 1 }
```

All seven fields are required. There are no partial-recipe merges or implicit defaults in `validate`, `measure`, `plan`, or `apply`. Pass `defaults()` explicitly for a default/identity recipe.

`validate(recipe)` returns a new, normalized ordinary object containing those same seven fields, in that order. It neither changes nor retains the caller's record.

- `version`: exactly numeric `1`.
- `top`, `right`, `bottom`, `left`: finite primitive numbers in the inclusive interval `[0, 0.5]`.
- `color`: a primitive string consisting of `#` followed by exactly six hexadecimal digits. Uppercase digits are accepted and normalized to lowercase. Shorthand, named, whitespace-padded, and eight-digit colors are rejected.
- `opacity`: a finite primitive number in `[0, 1]`.
- Negative zero in numeric fractions/opacity becomes positive zero. No value is coerced from a string, wrapper object, boolean, or other type.

Recipes, image records, and options must have either the current realm's ordinary `Object.prototype` or a null prototype. Their fields must be own, enumerable data properties. Unknown keys, symbols, non-enumerable fields, getters, setters, arrays, class instances, and custom prototypes are rejected. Frozen/sealed data records and parsed JSON are accepted when otherwise valid. Validation snapshots property descriptors and never reads an untrusted record's field through a property accessor. Inherited options are never consulted.

As with ordinary JavaScript reflection, a Proxy can execute its own reflection traps. This API is not a sandbox for Proxy handlers, deliberately replaced language intrinsics, or caller-supplied callback code. Use parsed data records, not executable wrappers, at import boundaries.

## Quantization and source placement

Let `shortEdge = Math.min(inputWidth, inputHeight)`. Independently for each side:

```js
padding[side] = Math.round(shortEdge * recipe[side]);
outputWidth = inputWidth + padding.left + padding.right;
outputHeight = inputHeight + padding.top + padding.bottom;
```

Nonnegative half pixels round upward. The core does not clamp, merge opposing fractions, distribute a rounding remainder, or derive one side from another. Input dimensions are positive integers. For example, input `11 × 5` and fractions `{top:0.5,right:0.25,bottom:0.1,left:0.4}` produce integer padding `{top:3,right:1,bottom:1,left:2}` and output `14 × 9`.

Original pixel `(x, y)` is copied byte-for-byte to output `(x + padding.left, y + padding.top)`. RGB, alpha, and nonzero RGB under alpha zero are preserved exactly. No interpolation or source/background compositing occurs.

All-zero **quantized** padding is a dimension/byte identity, including a recipe whose nonzero fractions round to zero. `apply` still returns a new record, a new `Uint8ClampedArray`, and a separate backing buffer. Mutating the result cannot change the source.

Repeated calls are distinct expansions. Each call recomputes fractions from that call's input short edge; applying the same recipe twice need not add the same number of pixels. Editor adapters should normally reapply a single current recipe to the retained upstream image rather than recursively pad a previous padded preview.

## Metadata-only measurement versus render preflight

`measure(width, height, recipe)` returns **only dimensions**, without reading or allocating image pixels. It accepts positive integer input and output edges up to `1,000,000`, inclusive. Input and output pixel products must be safe integers. The edge bound currently makes products at most `1,000,000,000,000`, safely below JavaScript's safe-integer maximum. It rejects unsafe/invalid numbers and an expanded output edge beyond its metadata bound.

`measure` does **not** promise the image can be rendered or allocated. This distinction is intentional: the Android editor may retain original metadata up to 80 megapixels while generating a much smaller working preview/export. For example, an original `10000 × 8000` with 0.5 on every side measures as `18000 × 16000`; that metadata is valid even though the theoretical original-size operation exceeds render limits.

`plan(width, height, recipe, options?)` uses the **same internal measurement/quantization function**, then enforces the hard render ceilings on **both input and output**:

- At most `67,108,864` pixels (64 Mi pixels), inclusive.
- At most `16,384` pixels on either edge, inclusive.
- Any tighter caller limits described below.

An 80MP input accepted by `measure` is rejected by `plan`, even for zero padding. No pixel allocation occurs in either function. Exceeding a budget is an error, never an implicit scale-down or clipping operation.

Both functions return a new ordinary record with **exactly** these fields:

```js
{
  inputSize: { width: inputWidth, height: inputHeight },
  outputSize: { width: outputWidth, height: outputHeight },
  padding: { top: topPixels, right: rightPixels, bottom: bottomPixels, left: leftPixels }
}
```

All size/padding values are integer pixel counts. No recipe, color, alpha, source buffer, offset field, or renderability flag is included. Placement is completely specified by `padding.left` and `padding.top`. `measure` has no options argument and does not poll cancellation.

## Caller options

Only `plan` and `apply` accept options. Omission/`undefined` means defaults. A supplied `null` is invalid. All option fields are optional own enumerable data properties, and only these three keys are allowed:

```js
{ maxPixels: 67108864, maxEdge: 16384, shouldCancel: () => false }
```

- `maxPixels`: positive integer no larger than `67,108,864`.
- `maxEdge`: positive integer no larger than `16,384`.
- `shouldCancel`: a synchronous function. Any truthy return aborts.

Overrides can only tighten the hard ceilings. Values above a ceiling are rejected, not silently ignored or clamped. A present option with `undefined`, `null`, an accessor, or a wrong type is invalid. An inherited getter is not read.

Mobile working-preview/export preflight should use `{ maxPixels: 8000000, maxEdge: 4096 }` when that is the caller's existing budget. This is eight million pixels, not 8 Mi pixels. The padded output must fit those limits too. If downsampling is needed, the adapter must choose and produce the actual working image first, then run `plan` on its actual dimensions; `measure` is for original/project metadata only.

## Applying pixels

`apply(image, recipe, options?)` accepts an exact image record:

```js
{ width: positiveInteger, height: positiveInteger, data: rgba8 }
```

`data` must be a real `Uint8Array` or `Uint8ClampedArray` containing exactly `4 * width * height` visible bytes. Signed, wider, floating-point, `DataView`, array, fake-tag, and proxied typed-array inputs are rejected. Real cross-realm RGBA8 arrays are accepted. A nonzero-offset view into a larger buffer is accepted; only its visible span is copied. The backing buffer must be attached and non-shared. SharedArrayBuffer, including cross-realm shared buffers, and detached/out-of-bounds views are rejected.

Captured typed-array/ArrayBuffer intrinsics read the source's actual brand, buffer, byte offset, and byte length. Overridden `.buffer`, `.byteLength`, `.byteOffset`, `.length`, `.constructor`, `Symbol.toStringTag`, or species accessors on a real source are not consulted. Copying uses fresh native byte views and captured typed-array `set`, not source-provided methods.

The return value has exactly `{ width, height, data }`. `data` is a new `Uint8ClampedArray` with exactly `4 * outputWidth * outputHeight` bytes.

Border alpha is `Math.round(recipe.opacity * 255)`. If the quantized alpha is zero, all four padding bytes are zero, even if the requested color is nonzero or a tiny positive opacity rounded down. Otherwise each padding pixel is the chosen color's three RGB bytes and the quantized alpha byte. Partial alpha is **straight/unpremultiplied** color. Source bytes are copied without blending, including underneath transparent padding choices.

Both input and output sizes are checked before output allocation. The budgets are deterministic safety ceilings, not a guarantee that every device has sufficient memory; a runtime allocation failure may still throw. At the hard maximum the new output alone can require 268,435,456 bytes. Mobile must retain its tighter limits.

## Cancellation and failure behavior

- `plan` validates and computes dimensions, then polls once before returning.
- `apply` completes schema, source, and dimension checks, then polls **before output allocation**.
- It polls again before output rows 16, 32, 48, etc., and once after all output rows have been written, before returning. A one-row image is polled twice.
- A truthy callback result throws an `Error` whose `name` is `"AbortError"`. A callback exception propagates unchanged. Type/schema failures throw `TypeError`; invalid ranges/budgets/versions throw `RangeError`. Error wording is diagnostic, not a stable localization interface.
- No partial output is returned on failure. The core never writes to source pixels, even if work was cancelled after some or all output rows were filled.
- Callbacks should be side-effect-free cancellation probes. If a callback detaches a source buffer or makes its fixed-length view out-of-bounds, the operation rejects rather than returning corrupted pixels. Mutations deliberately made by caller callbacks are not mutations made by the core.
- This is synchronous computation. For live interruption by another UI event, run it in a worker or use the host's existing scheduling model; do not expect the same JavaScript event loop to process unrelated events during a call.

## Adapter boundaries and reversibility

This directory is an isolated shared-core candidate, not an installed Android or desktop change.

The host adapter owns file decoding, original image retention, working-image sizing, existing render pipeline order, model calls, preview scheduling, history/undo, recipe persistence/import, export MIME/filename settings, and progress/error presentation. It should:

1. Validate imported recipes before use. Do not merge unvalidated executable objects into application state.
2. Store the recipe separately from upstream pixels so toggling/resetting/undoing padding recomputes from an unpadded source. Expansion itself is not a destructive overwrite of the original.
3. Use `measure` for large original/project dimensions, and `plan` with the current actual working dimensions and host limits before rendering. Do not reject valid large metadata merely because original-resolution padding would exceed a working-export budget.
4. Place this border step at the intended final canvas-expansion stage. The core does not alter or infer the existing geometry/filter/mask pipeline.
5. Pass an immutable-in-practice source view for the duration of the call. Treat returned RGBA8 as straight alpha and choose any eventual encoder/flattening policy explicitly. Canvas or image encoders may not preserve hidden RGB; the byte-exact guarantee applies to this core's RGBA8 output, not downstream conversions.
6. Ignore stale results using the host's operation token and cancellation mechanism. An AbortError is not a successful partial render.

No UI state, Android source, desktop source, SDK, signing material, model, preset codec, browser, or file-service integration is changed by this candidate.

## Verification

Run from this directory with Node.js (tested on v24.19.0):

```sh
node --check canvas-padding.js
node --test canvas-padding.test.js
```

Tests use only Node built-ins. Coverage includes UMD/CommonJS/AMD loading; exact independent-reference pixel comparisons across 400 seeded cases; identity and hidden RGB; asymmetric placement; fractions/half-pixel quantization; repeated expansion; transparent/partial/opaque borders; strict imported-data schemas and non-invoked accessors; null-prototype/frozen records; nonzero-offset/cross-realm typed arrays; shared/detached/resized buffers; 64 Mi/16384 ceilings and tighter mobile budgets; 80MP metadata measurement; unsafe/oversized metadata rejection; and instrumented proof that output limits and initial cancellation precede output allocation, plus cancellation after partial and complete copying.
