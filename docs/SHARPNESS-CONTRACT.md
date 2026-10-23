# Controlled classical sharpening: version 1

The shared implementation is `app/src/main/assets/sharpness.js`. It exports the
same frozen `MintSharpness` object in a browser and through CommonJS. It has no
runtime dependency, network access, model, mask, or learned component.

This is conservative luminance unsharp detail. It increases the contrast of
already-present edges; it is **not** deconvolution, restoration, a state-of-the-art
reconstruction method, denoising, or recovery of missing/clipped information.
Default amount is zero. An intentionally restrained result is preferable to a
stronger sharpening effect that creates bright/dark edge fringes.

## Portable recipe

`{ version: 1, amount: 0, radius: 1, threshold: 3 }`

- `version` must be the number `1`.
- `amount` is a finite number in `[0,100]`; fractional values are allowed.
- `radius` is a finite number in `[0.3,3]`. It is the blur's per-axis standard
  deviation, expressed at a **1000-pixel short edge**, not display zoom or CSS
  pixels. Actual standard deviation is
  `radius * min(input.width, input.height) / 1000` input pixels.
- `threshold` is a finite number in `[0,30]`, in sRGB-encoded scalar luminance
  code units (0–255). It suppresses small unsharp differences. It is not a noise
  estimate and does not promise denoising. Zero admits noise as well as detail.
- `null` means off. No implicit recipe/defaulting of missing fields is performed.

The input to each operation defines its short edge. A prior crop/resize can
therefore change its pixel radius. The caller must preserve operation order and
must not use display zoom or a separate preview-size override to change this
formula. There is no minimum pixel-radius clamp: tiny inputs can have a subpixel
blur and may show no byte-level change. A resized preview remains approximate:
resampling, quantization, and the fixed 3×3 local halo limiter do not commute with
sharpening. Matching recipe/radius semantics is not a promise that a downsampled
full export equals an independently processed preview.

## API

- `defaults()` returns a new plain recipe, with amount 0, radius 1, threshold 3.
- `validate(recipeOrNull)` validates and returns an independent plain recipe or
  `null`. There is no live link to the caller's record.
- `isActive(recipeOrNull)` validates and returns whether amount is positive.
- `plan({width,height}, recipeOrNull)` validates dimensions and the recipe
  without requiring pixel data or allocating typed buffers. Its argument is
  strictly a size record, **not** an image record containing `data`.
- `apply({width,height,data}, recipeOrNull, {shouldCancel?})` returns a new image
  record with a new `Uint8ClampedArray` for an active recipe. It does not mutate
  input bytes. Null or amount zero returns the **exact original image object**,
  with no image-sized or LUT typed-buffer allocation. Validation and an initial
  cancellation checkpoint still run in the off case.

`data` is unpremultiplied RGBA8 with sRGB-encoded color channels. Only genuine,
local-realm native `Uint8Array` / `Uint8ClampedArray` instances with those exact
prototypes are supported, including fixed offset views. Length must be exactly
`width*height*4`. Shared, resizable, detached, subclassed, proxy-wrapped, other
numeric-type, and `DataView` storage is rejected. Intrinsic typed-array and buffer
getters are used rather than user-shadowable properties or methods.

Recipe, size, image, and options records must have exactly the documented own,
enumerable data fields. Plain or null prototypes are allowed; inherited required
fields, accessors, symbol keys, nonenumerable/unknown fields, arrays, coercions,
nonfinite values, and unsafe prototypes are rejected. The only optional options
field is a function-valued `shouldCancel` (undefined is allowed). Arbitrary
JavaScript proxies/modified platform intrinsics are not an isolation boundary;
this is a strict data API, not a sandbox for running hostile code.

## Numerical algorithm

1. Decode RGB using the standard sRGB transfer function and compute linear
   luminance `Y = .2126 R + .7152 G + .0722 B`. Encode this **scalar** luminance
   back through the sRGB transfer function to `P` in `[0,255]`. It is not a
   weighted average of the three encoded RGB channels.
2. Blur `P * alpha` and alpha separately; divide to obtain coverage-normalized
   blurred luminance. Fully opaque input skips the redundant alpha field.
   Zero-alpha RGB never enters either blur or local ranges. Partially transparent
   colors contribute proportional to coverage. The original alpha byte is never
   filtered or changed, and zero-alpha hidden RGB is copied byte-exact.
3. Each field uses three separable fractional-box stages, six axis passes. Each
   axis stage has variance `sigmaPixels² / 3`. This is a Gaussian-equivalent
   variance approximation, **not an exact Gaussian kernel**. For integer
   half-width `n`, taps `[-n,n]` have weight 1 and the two outer taps `±(n+1)`
   have weight `f`; the sum is normalized by `2n+1+2f`:

   `n = floor((sqrt(1+4*sigmaPixels²)-1)/2)`

   `v = sigmaPixels²/3`

   `f = ((v - n*(n+1)/3)*(2n+1)) / (2*((n+1)²-v))`

   Fractional edge weights vary continuously; there is no rounded pixel-radius
   step. Outside-image samples replicate the nearest edge for each pass. Fields
   are Float32; running sums and scalar/color arithmetic use Number precision.
4. With `d = P - blur(P)`, only `abs(d) > threshold` proceeds. The soft detail is
   `sign(d) * (abs(d)-threshold)² / (abs(d)+threshold)`. Its derivative is zero
   at a positive threshold, avoiding a hard threshold jump. For threshold zero
   this reduces to `d` (very small floating-point differences are skipped).
5. Apply amount and a smooth asymptotic cap of 12 scalar luminance codes:
   `deltaP = amount/100 * 12 * softDetail / (12+abs(softDetail))`.
   This is a bound on scalar luminance change, **not on each RGB channel**.
6. Decode the candidate scalar luminance back to linear light. Compute original
   visible-pixel linear-luminance bounds in the clipped 3×3 neighborhood. A soft
   limiter attenuates the desired delta by `1/(1+abs(delta)/directionalRoom)`.
   It cannot create a new local luminance extremum before output quantization.
   In particular, already-crisp two-color steps stay unchanged rather than
   acquiring black/white overshoot. This limiter also deliberately reduces
   fine isolated texture/noise sharpening; it is not an edge-recovery claim.
7. Brightening receives a second soft limiter using the linear RGB gamut
   headroom. Apply one common linear RGB gain. Zero color channels stay zero;
   no white component or independently sharpened RGB channel is introduced.
   The requested lift is sacrificed when gamut requires it. Fully saturated
   pixels cannot be brightened, but can be darkened. Finally encode and round
   half-up once, retaining original alpha. Integer output can differ from the
   continuous luminance bound by approximately half a code through quantization.

Flat images stay unchanged. On noisy input, threshold zero can increase visible
noise even at a conservative amount. A positive threshold reduces that effect
but does not infer whether a feature is real detail, noise, or compression.

## Resource preflight and cancellation

Dimensions must be positive safe integers, at most 16,384 on either edge and at
most 16,777,216 pixels. The mobile integration may enforce its stricter 8 MP /
4096-edge budget before calling the core. Resource validation occurs before
image-sized allocations; unsupported size is rejected rather than downscaled
silently. Allocation failure is allowed to throw; no partial image is returned.

`plan()` reports:

- Dimensions, pixel count, `active`, `sigmaPixels`, `boxRadius`, `edgeWeight`,
  and total three-stage `supportPixels`.
- `blurPassesPerField` (6 active, 0 off), and `maxBlurPixelVisits` (12×pixels
  active, accounting for the worst-case alpha field).
- `workUnits = 24*pixels + 6*(width+height)*(2*boxRadius+1)` when active, zero
  when off. These are stable, conservative **scheduling weights**, not an exact
  CPU instruction count, wall-clock prediction, or additional allocation.
- `inputBytes = 4*pixels`.
- `opaqueWorkingBytes = 12*pixels + 24*width + 2048` when active, zero off.
- `maxWorkingBytes = 16*pixels + 24*width + 2048` when active, zero off.
- `maxTotalBytes = inputBytes + maxWorkingBytes`.

Working memory includes output, up to three full Float32 fields, one three-row
Float64 buffer, and the decode LUT. It excludes JavaScript object/VM overhead,
caller-held decoded images, Canvas readbacks, histories, and other simultaneous
operations. It is not a guarantee that every runtime can allocate the maximum.
The global worst-case owned-buffer limit is 268,830,720 bytes; 4096² active pixels
need at most 268,535,808 bytes plus the 67,108,864-byte source. Normal opaque photos
use one fewer Float32 field. Callers must account for their own surrounding
memory and accumulated ordered-operation budgets.

All blurs use sliding sums: work is linear in pixel count with bounded initial
edge sums, not proportional to kernel area. Cancellation is checked before each
typed allocation, in row chunks of at most 65,536 pixels/32 rows, during column
sum setup, and before publication. A true return throws an `AbortError` with
`code: 'ABORT_ERR'`. Exceptions from the callback propagate. Callbacks should be
pure and must not mutate input bytes, records or global intrinsics. Storage
transfer/detachment during a callback is detected at the checkpoint and rejected.
A synchronous call cannot receive new UI events until it yields/finishes; the
host remains responsible for generation tokens, worker/thread use where
available, and discarding stale results before UI/history publication.

## Verification and scope

Run `node --test tests/sharpness-core.test.cjs` for the owned pure suite. It covers
UMD/identity, strict descriptors and records, detached/shared/resizable storage,
no-allocation preflight/cancellation, independent direct convolution/reference
pixels, dimensions/work/memory/radius variance, transparent and partially
transparent edges, local range and chroma/gamut, flat/step/ramp/tiny/border images,
seeded noise amplification and threshold suppression, meaningful softened-edge
contrast improvement, deterministic output, and cancellation through final
publication. Independent natural-image/portrait QA and mobile/desktop operation,
preview, export, history and project validation belong to their integration
suites; these pure tests alone are not an end-to-end application claim.
