# Shared light-balance core, version 1

`src/light-balance.cjs` is the dependency-free UMD implementation exposed as
`MintLightBalance` in browsers and through CommonJS. Desktop, mobile, preview,
worker and native export must use this same implementation. This is conventional
8-bit display-referred correction, not a learned model, scene relighting, RAW
processing, highlight reconstruction, local contrast, or a SOTA claim. It cannot
recover clipped channels or determine the true illuminant from an arbitrary object.

## Public API and placement

- `defaults()` returns a fresh neutral recipe.
- `validate(recipe)` returns a fresh, independently owned validated recipe;
  `validate(null)` returns `null`. It does not change caller data.
- `isActive(recipe)` validates first and reports whether any control is non-neutral.
- `apply(image, recipe, { shouldCancel? })` returns an independently owned output
  for an active recipe, or the exact original image object for `null`/neutral.
- `deriveWhiteBalance(image, { x, y, radius? }, { shouldCancel? })` returns only
  `{ r, g, b }`, suitable for `recipe.whiteBalance`. Selection coordinates,
  radius, sample pixels, and image metadata are not part of the portable recipe.
- `LIMITS` and the public API object are frozen. Returned recipes/gains are plain
  mutable data records, not shared singleton state.

Integration order is shared basic tone → this module → Levels → Curves. Inside
this module, linear-light white balance precedes luminance tone. The eyedropper
must receive and visibly display the input to this module, after basic tone but
before existing white balance, these highlight/shadow controls, Levels, or Curves.
Do not resample the final corrected preview and feed it back into this estimator.

## Exact recipe schema

```json
{
  "version": 1,
  "shadows": 0,
  "highlights": 0,
  "whiteBalance": { "r": 1, "g": 1, "b": 1 }
}
```

`shadows` and `highlights` are finite real numbers in the inclusive range
`[-100, 100]`, not exposure stops or percentages of a recovered scene. Positive
values brighten; negative values darken. Fractions are supported. Both controls
have smooth, overlapping luminance weighting, not hard spatial or luminance masks.

Gains are finite linear-light multipliers in the inclusive range `[0.25, 4]`.
Their units are ratios, not Kelvin, tint units, or encoded-sRGB multipliers. A
common multiplier can change exposure until display gamut normalization applies.
All gains exactly 1 and both tone controls exactly 0 are neutral; `-0` is neutral.
`null` disables the stage. `undefined` and missing fields are not valid recipes.
There is no implicit strength, opacity, sample location, or automatic detection.

Every accepted record has only its documented enumerable own data properties,
with either `Object.prototype` or a null prototype. Extra keys, symbols, hidden
properties, accessors, custom prototypes and coercible/non-finite numbers are
rejected. No ordinary record getter is dispatched during validation. Nested
records are copied before cancellation callbacks can run. This validation is not
an isolation sandbox against arbitrary executable JavaScript or hostile global
intrinsic replacement.

## Image, ownership and alpha

Images contain exactly `{ width, height, data }`. Positive integer dimensions
must not exceed 16,384 on either edge or 64,000,000 pixels in total. `data` is an
exact-length, native `Uint8Array` or `Uint8ClampedArray` of unpremultiplied RGBA8
sRGB samples, with fixed ordinary `ArrayBuffer` storage. Fixed offset views are
accepted. Subclasses, Node Buffers, proxies around typed arrays, fake views,
shared storage, resizable storage, detached buffers and wrong lengths reject.
Intrinsic storage getters bypass shadowed `length`, `buffer`, `byteLength`,
`byteOffset`, iteration and copy methods.

The stage never changes the input buffer. Active output owns a fresh
`Uint8ClampedArray`, including when all visible output happens to round unchanged.
The neutral fast path preserves both the exact image object and every byte.
Alpha bytes always remain exact. Alpha-zero hidden RGB remains byte-for-byte
unchanged. RGB with any nonzero alpha, including half-alpha, is processed as
unpremultiplied RGB, identically to opaque RGB; it is not alpha-weighted.

## Numerical transform and explicit gamut tradeoffs

1. Decode each sRGB byte into linear light with the standard piecewise sRGB
   transfer: `c/12.92` at `c <= 0.04045`, otherwise `((c+0.055)/1.055)^2.4`.
2. Multiply linear R, G and B by the three white-balance gains.
3. If any gained channel exceeds 1, divide **all three** by their common maximum.
   Otherwise leave all three unchanged. This preserves the corrected linear RGB
   ratios and avoids separate channel clipping. The tradeoff is explicit:
   out-of-gamut gained luminance is reduced. This is not highlight recovery.
4. Compute linear luminance `L = 0.2126 R + 0.7152 G + 0.0722 B`.
   Let `s = shadows/100`, `h = highlights/100`, and:

   ```text
   d = 2 ln(2) [s (1-L)^2 + h L^2]
   E(d) = d |d| / (|d| + 0.1)
   Y = L exp(E(d)) / [1-L + L exp(E(d))]
   ```

   Luminance endpoints 0 and 1 remain fixed. `E` is a fixed C1 easing of the
   log-odds displacement, not a user control. It softens weak adjustments and
   removes the sharp chroma-transition slope when a mixed shadow/highlight recipe
   changes from brightening to darkening. It does not create a dead zone.
5. Scale all corrected linear RGB channels together by `Y/L` (black stays
   black). If any scaled channel exceeds 1, divide **all three** by the common
   maximum again. In-gamut results attain target luminance while preserving
   corrected linear RGB ratios. Out-of-gamut results preserve those ratios but
   deliberately sacrifice target luminance. No separate channel clipping and
   no white-mixing desaturation are used. This is **not** a claim of constant
   perceptual hue/saturation, encoded HSL hue, or natural beauty at extreme
   settings. See the rejected white-mixing control and measured evidence in
   `LIGHT-BALANCE-CHROMA-REVIEW.md`.
6. Encode sRGB, then round once, half up. A `1e-10` code-value tolerance only
   stabilizes floating-point arithmetic at mathematical half-code ties. Final
   numerical `[0,1]` clamping guards roundoff; it is not the gamut algorithm.
   There is no byte quantization between WB, tone and gamut reconstruction.

The transform is pointwise and continuous in its non-quantized RGB/control
inputs. There is no neighborhood blur, edge mask, local adaptation or spatial
halo source. A maximum-channel normalization can have a derivative kink where
its limiting channel changes, but never clips one channel independently.

### Monotonicity

For the raw displacement, `d'(L) = 4 ln(2)[-s(1-L)+hL]`, hence
`d'(L) >= -4 ln(2)` over all supported controls. The easing has derivative
`|d|(|d|+0.2)/(|d|+0.1)^2`, in `[0,1]`. Therefore:

```text
d/dL [logit(L) + E(d(L))] >= 4 - 4 ln(2) > 0
```

So the tone luminance curve is strictly increasing throughout `(0,1)`, including
opposing full-strength controls. Neutral grayscale remains neutral. Quantized
grayscale is nondecreasing, not strictly increasing at every 8-bit sample.
This is not a claim that arbitrary colored inputs with different chromaticities
must preserve their relative luminance through out-of-gamut white balance or tone normalization.

## Eyedropper sampling, robust statistics and failures

The caller explicitly designates an expected neutral patch. This module neither
recognizes neutral objects nor detects faces, skin, illumination or scene color.
No chosen pixel, location or source coordinate is persisted in the recipe.

- `x`, `y` are finite normalized coordinates in `[0,1]`, mapping to
  `round(x*(width-1))`, `round(y*(height-1))`.
- `radius` is optional, default `0.01`, finite in `[0,0.05]`. Its unit is the
  smaller image edge. The integer pixel radius is
  `clamp(round(radius*min(width,height)), 2, 32)`, including when radius is 0.
- The footprint is a square clipped to the image, at most 65×65 pixels. At least
  9 usable samples and at least 50% of the clipped footprint must be usable.
- Only alpha exactly 255 is usable. Every channel must be in `[9,246]` and
  linear luminance in `[0.01,0.9]`. Dark, near-channel-black, near-clipped,
  fully transparent and partially transparent samples are excluded.
- Compute each usable pixel's `ln(R/G)` and `ln(B/G)`. Use the componentwise
  medians as a robust chromaticity center. Retain inliers only when both absolute
  log-ratio deviations are at most `0.15` (about a 16.2% ratio factor).
- Require at least 9 inliers and at least 60% of usable samples to be inliers.
  This checks consistency, not whether the chosen object's true color is gray.
- Sort inlier linear R/G/B independently, trim `floor(0.2*n)` values from each
  end of each channel, then take channel means `mR,mG,mB`.
- Set provisional gains to `1/mR,1/mG,1/mB`. Normalize them together by
  `luminance(sumRGB) / luminance(sumRGB / meanRGB)`, using arithmetic channel
  sums over **all accepted inliers**, not just the independently trimmed values.
  This neutralizes the robust representative RGB while preserving accepted
  inlier arithmetic mean linear luminance before gamut and quantization.
  A truly gray patch returns exact unit gains.
- Reject, rather than clamp, any resulting gain outside `[0.25,4]`.

Mean-luminance preservation is conditional: gamut normalization can reduce it,
and final 8-bit quantization introduces error. The tests include an accepted
bright patch where one corrected inlier leaves gamut, explicitly demonstrating
this limitation. Mixed light, strongly non-neutral selection, clipping,
metamerism, sensor response, missing RAW data and severe casts cannot be solved
by these three gains.

Malformed arguments throw `TypeError`. Selection-quality failures throw
`RangeError` with stable codes:

- `WB_SAMPLE_INSUFFICIENT`: too few usable pixels or less than 50% usable.
- `WB_SAMPLE_INCONSISTENT`: too few chromaticity inliers or less than 60% inliers.
- `WB_GAIN_RANGE`: the estimated gains exceed the supported budget.

These errors leave image/recipe/selection data untouched and return no partial
gains. UI may invite another neutral patch; it must not silently clamp gains or
claim successful neutralization after an error.

## Cancellation and publication

Both processing methods accept only the optional `shouldCancel` callback.
An affirmative result throws `AbortError` with code `ABORT_ERR`; callback errors
propagate. All arguments validate before callbacks run. Even a neutral apply
checks cancellation. Apply checks before the 256-entry decode table, before
image allocation, at chunks of no more than 65,536 pixels / 32 rows, and before
publication. Sampling checks before sample-array allocation, every eight scan
rows, after scan, after inlier classification, and before publication. Sampling
sorts at most 4,225 values per channel.

Every checkpoint also verifies fixed backing length and view offset. A callback
that detaches/transfers storage causes rejection, not zero-filled publication.
No image or partial result is returned after cancellation or an error. These
are synchronous checkpoints, not event-loop yields. Callers must not mutate or
transfer the input while processing; the module cannot undo mutations made by
the caller's own cancellation callback.

## Verified evidence and limitations

Run `node --test tests/light-balance-core.test.cjs` directly. No package install,
network, browser, model, private-photo fixture or image service is required.
The numerical tests use an independent scalar reference, actual output pixels,
all integer tone values at opposing extremes, transparent/half-alpha fixtures,
malformed/accessor/storage adversaries and cancellation/detachment checkpoints.

`quality/light-balance-qa/chroma-report.json` records the current candidate and
its negative controls. `desaturating-core-report.json` and
`desaturating-synthetic-ramps.png` retain the rejected intermediate version. The rejected maximum-chroma/luminance-preserving WB control
is retained in a test as a counterexample, not shipped as a fallback. Across the
same five saturated hue ramps, its worst neighboring-channel steps were
18/17/48/32/52 codes; the final core yields 2/2/2/8/3 and passes the original
8-code regression bound without relaxing it. The wider 243 gain/tone-corner
sweep still reaches 13 codes under extreme 16:1 relative gains. Thus the evidence
supports improvement over that concrete banding failure, not universal absence
of 8-bit banding or photographic quality validation. The separate `chroma-comparison.png` uses two public portraits for private
informational QA. Neither it nor these tests establish screen/UI, mobile-device,
color-managed-display or natural-portrait quality acceptance.
