# Advanced tone v1: shared pixel contract

`src/advanced-tone.cjs` is a dependency-free UMD module. CommonJS exports and the browser/worker global `MintAdvancedTone` expose the same code. These are conventional display-referred curves and HSL controls, not a learned retouching system, a claim of state-of-the-art portrait enhancement, a color-managed RAW pipeline, or a way to recover clipped RAW highlights.

## API and identity

- `defaults()` returns a fresh, editable identity recipe, with `enabled: true`, `strength: 1`, and `curveMode: 'monotone'`. Every nested array/object is independent.
- `validate(recipe | null)` returns a detached normalized recipe, or preserves `null`. It does not silently repair malformed recipes. `undefined` is invalid; the parent document schema decides how absent legacy fields become `null`.
- `isActive(recipe)` validates first, then checks enabled, nonzero strength, and non-identity curves/HSL. `null`, disabled, zero-strength, and all-identity recipes are inactive.
- `apply(image, recipe, { shouldCancel }?)` is synchronous. An inactive recipe returns the original image object and bytes without allocation. An active recipe returns a new `{width, height, data: Uint8ClampedArray}` and never writes to the source.
- `histogram(image, { maxSamples }?)` computes a diagnostic histogram of the supplied **rendered preview**, not source/RAW sensor data. See the sampling contract below.
- Read-only constants `LIMITS`, `NODES`, `BANDS`, and `CENTERS` are exported for integration.

An image is an exact plain record `{width, height, data}` with own enumerable data properties. `width` and `height` are positive safe integers, each at most 16,384, and the product is at most 64,000,000 pixels. `data` is `Uint8Array` or `Uint8ClampedArray` with exactly `width * height * 4` bytes, backed by a non-detached `ArrayBuffer`; shared buffers are rejected. Offsets into a larger buffer are supported. A native `ImageData` is wrapped explicitly as `{width: imageData.width, height: imageData.height, data: imageData.data}` by the caller. Input is straight/unpremultiplied 8-bit gamma-encoded sRGB RGBA, not linear RGB, premultiplied RGBA, an ICC profile conversion, or a floating-point HDR raster.

The recipe, image record, and options reject unexpected keys, symbols, nonenumerable fields, inherited fields, accessor properties, and custom object prototypes. Plain objects with `Object.prototype` or `null` prototypes are accepted. Recipe arrays must be ordinary dense arrays with exact length, own enumerable data elements, no extra keys, and `Array.prototype`. Validation reads descriptors rather than executing getters. Intrinsic typed-array and buffer getters are used, so shadowed `length`/`buffer` accessors cannot run. As with JavaScript reflection generally, hostile Proxy traps are not a sandbox boundary; callers must pass structured data, not arbitrary executable objects.

Even an inactive recipe validates the supplied image and recipe. Alpha is copied exactly; RGB under alpha zero is copied exactly and never adjusted. Alpha does not scale the visible pixel's adjustment strength because RGB is straight, not premultiplied. A partial-alpha pixel receives the same color transform as an opaque pixel of the same RGB. The result is rounded once by `Uint8ClampedArray` assignment after the final strength blend, using JavaScript's nearest-even tie handling.

## Frozen recipe representation

```js
{
  version: 1,
  enabled: true,
  strength: 1,               // finite 0..1
  curveMode: 'monotone',     // 'monotone' or explicitly selected 'free'
  curves: {
    rgb:   [0, .25, .5, .75, 1],
    red:   [0, .25, .5, .75, 1],
    green: [0, .25, .5, .75, 1],
    blue:  [0, .25, .5, .75, 1]
  },
  hsl: [
    {hue: 0, saturation: 0, luminance: 0}, // red
    {hue: 0, saturation: 0, luminance: 0}, // orange
    {hue: 0, saturation: 0, luminance: 0}, // yellow
    {hue: 0, saturation: 0, luminance: 0}, // green
    {hue: 0, saturation: 0, luminance: 0}, // aqua
    {hue: 0, saturation: 0, luminance: 0}, // blue
    {hue: 0, saturation: 0, luminance: 0}, // purple
    {hue: 0, saturation: 0, luminance: 0}  // magenta
  ]
}
```

Curve y values are finite `0..1`; their five fixed input x coordinates are `[0, .25, .5, .75, 1]`. Endpoints are editable, not implicitly pinned. Monotone mode requires each y array to be nondecreasing, including plateaus. Free mode permits deliberate reversals such as solarization, but still prohibits overshoot between the endpoints of each segment. Changing UI mode must not silently reinterpret or clamp a stored curve. Hue is finite `-30..30` degrees; saturation and luminance are finite `-100..100`. Band order and centers are fixed: red 0°, orange 30°, yellow 60°, green 120°, aqua 180°, blue 240°, purple 270°, magenta 300°.

## Curve evaluation

Every channel evaluates the **master RGB curve first, then its individual channel curve** on normalized gamma-sRGB code values. These operations generally do not commute. The intermediate value is not quantized to 8 bits.

Interpolation is uniform-grid shape-preserving cubic Hermite/PCHIP. For interval width `h = .25`, define secants `d[i] = (y[i+1] - y[i]) / h`.

- At an interior point, the slope is zero if adjacent secants have opposite signs or either is zero. Otherwise it is their harmonic mean `2*d[i-1]*d[i]/(d[i-1]+d[i])`.
- For the first endpoint, start with `(3*d[0]-d[1])/2`. Set it to zero if it is zero/opposite in sign to `d[0]`. If the first two secants have opposite signs, limit its magnitude to `3*abs(d[0])`. Apply the mirrored rule to the last endpoint.
- For segment parameter `t = (x-x[i])/h`, evaluate `(2t³-3t²+1)y[i] + (t³-2t²+t)h*m[i] + (-2t³+3t²)y[i+1] + (t³-t²)h*m[i+1]`.

Each curve is compiled into a 4,097-entry Float64 LUT spanning `0..1` inclusive. Every entry is validated to be finite, within its own segment's endpoint bounds, and within `0..1`; monotone mode additionally checks nondecreasing output. Tolerance `1e-12` is only for floating-point evaluation error, with final values bounded to segment extrema. Linear interpolation between adjacent dense LUT entries preserves those bounds. Three 256-entry composed Float64 channel LUTs apply master→channel without intermediate byte rounding. Arbitrary control points, hidden spline types, or extrapolation outside `0..1` are not supported.

## HSL and strength

HSL uses the **curve result in gamma-encoded sRGB**, with conventional HSL lightness `(max(R,G,B)+min(R,G,B))/2`, not luminance or linear-light energy. Exact achromatic pixels (`max == min`) are left alone by HSL, including the entire grayscale ramp. Individual channel curves may intentionally colorize gray before this stage.

For original pre-HSL hue `H`, find its adjacent named hue centers on the circle. Red is repeated at 360° after magenta 300°. Between centers `Ha` and `Hb`, weights are `wa = 1-t`, `wb = t`, with `t = (H-Ha)/(Hb-Ha)`. The weights are nonnegative and sum to one. Each of the three band controls is independently interpolated with **the same original H and same weights**. A hue shift does not move a pixel into another band's saturation/luminance adjustment. This is continuous across all boundaries and the 360°/0° wrap, although the control interpolation is piecewise linear, not a promise of continuous first derivatives.

Let `C = max(R,G,B)-min(R,G,B)` and let `S` be the pre-HSL saturation. Define `smoothstep(t) = t²*(3-2t)` for clamped `t in 0..1`. The near-neutral gate is:

`g = smoothstep(min(1, S/.1)) * smoothstep(min(1, C/.05))`.

The chroma factor matters near black and white: an RGB one-code perturbation such as `[0,1,1]` has HSL saturation 1 but almost no actual chroma. Saturation gating alone would incorrectly give it a full ±.25 lightness change. Both factors reach zero smoothly and have zero derivative at their endpoints. This is an explicit conventional safeguard, not a perceptual model.

With interpolated controls `dh`, `ds`, `dl`:

- `H' = wrap360(H + dh*g)`; magnitude is at most 30°.
- `S' = clamp(S * (1 + ds*g/100), 0, 1)`; the multiplicative factor is `0..2`, not an additive color overlay.
- `L' = clamp(L + .0025*dl*g, 0, 1)`; maximum change is ±.25 HSL lightness, not an opaque white overlay.

Convert HSL to gamma-sRGB, then perform **one final strength blend**: `outRGB = originalRGB + strength * (adjustedRGB-originalRGB)`. Curves and HSL do not each receive a separate strength blend. Resetting all values is byte-exact; reducing strength is not a hidden recipe rewrite.

## Memory and cancellation

An active transform allocates only one full RGBA8 output, small curve LUTs, and scalar per-pixel state. It never creates a full float raster. At the 64 MP limit, input and output alone may occupy about 512 MB; acceptance by this core is not a promise that every device can comfortably process that size. The application's stricter preview/export budgets still apply.

`shouldCancel` is optional and must be a function if present. It is checked before any output allocation, before every row chunk, and once after the final chunk. Chunks contain at most 32 rows and 65,536 pixels (`max(1, min(32, floor(65536/width)))` rows). A truthy return throws an `Error` with `name: 'AbortError'` and `code: 'ABORT_ERR'`; no partial result is returned, and source bytes remain unchanged. A pre-aborted identity operation also throws. Exceptions from the callback propagate. The callback must not mutate or detach input while a transform is running.

These are synchronous cancellation checkpoints, **not event-loop yields**. A browser UI cannot dispatch a new click into a currently blocked JavaScript thread. Run rendering in the existing dedicated worker and use the application's worker/job cancellation lifecycle; or supply a callback that can observe an externally updated cancellation flag. The module itself performs no network, file, DOM, or worker operations.

## Histogram return shape and sampling

```js
{
  bins: {red: Float64Array(256), green: Float64Array(256),
         blue: Float64Array(256), luma: Float64Array(256)},
  sampledPixels, visibleSamples, effectiveSamples, totalPixels,
  stride, maxSamples,
  alphaWeighting: 'alpha/255',
  colorSpace: 'gamma-encoded-sRGB',
  luma: '0.2126R+0.7152G+0.0722B (code values)',
  endpoints: {
    red: {black, white, blackFraction, whiteFraction},
    green: {black, white, blackFraction, whiteFraction},
    blue: {black, white, blackFraction, whiteFraction},
    luma: {black, white, blackFraction, whiteFraction}
  },
  approximate,
  samplingMethod: 'all-pixels' /* or 'deterministic-stratified-hash-v1' */,
  strideMeaning: 'maximum stratum width; not a fixed stepping interval',
  stratumMaxPixels
}
```

`maxSamples` defaults to 262,144 and must be a positive safe integer at most 64,000,000. There are exactly `min(totalPixels,maxSamples)` samples. For sample index `j`, the contiguous raster-order stratum is `[floor(j*N/K), floor((j+1)*N/K))`. Choose one offset with a deterministic 32-bit avalanche hash of `(j+1) XOR 0x51f15e5d`, using xor-shifts 16,15,16 and multipliers `0x7feb352d`, `0x846ca68b`. Divide the unsigned hash by `2^32`, multiply by stratum length, and floor. This avoids the obvious phase-lock of scanning every nth pixel of a periodic texture. There is no random process state. It cannot guarantee freedom from every adversarial alias pattern.

`stride` is retained as a budget/display diagnostic meaning `ceil(N/K)`, the **maximum stratum width**, not an actual fixed step. `stratumMaxPixels` duplicates that explicit meaning. With one sample per source pixel the method is `all-pixels`; otherwise `approximate: true` and the stratified method are reported.

- `sampledPixels` counts all selected pixels, including transparent pixels.
- `visibleSamples` counts selected pixels with alpha greater than zero.
- `effectiveSamples` is the sum of `alpha/255` over visible samples.
- Alpha-zero pixels and their hidden RGB do not contribute. Every contributing RGB/luma bin receives `alpha/255`; samples are not composited over white or black.
- Luma is rounded to the nearest integer code bin from `.2126*R + .7152*G + .0722*B` on gamma code values. It is explicitly **not physical relative luminance**, despite using familiar coefficients.
- Endpoint `black` and `white` are weighted sample counts at code bins 0 and 255. Fractions divide by `effectiveSamples`, with zero fractions if no visible sample exists. Counts are not scaled into estimated whole-image counts.

Even an exhaustive histogram is exhaustive only for the supplied rendered preview. Approximate endpoint percentages must be labeled sampled-preview estimates; neither zero endpoints nor nonzero endpoints prove whether the original has recoverable or clipped RAW highlight/shadow detail. The caller owns preview revision/job freshness and must not show a stale histogram for newer settings. Histograms are derived UI state and must not be serialized as recipe/source data.

## Verification

Run `node --test tests/advanced-tone.test.cjs`. Tests cover browser/CommonJS export equivalence; identity and reset semantics; descriptor/prototype/sparse/nonfinite rejection; size and sample budgets; PCHIP monotonicity and segment extrema; independent noncommuting master→channel reference evaluation; spectral hue shifts, wrap, and adjacent band partitions; near-gray and one-code near-white/black controls; bounded saturation/lightness; single strength blending; source/alpha/hidden-RGB invariants; cancellation before/during/after processing; alpha-weighted histogram accounting; empty histograms; and periodic RGB/transparent sampling negative controls.

This isolated core does not change the existing portrait/manual cores, pipeline order, project schema, UI undo rules, or export wiring. Those integrations must call this same module, preserve the recipe version, and be verified separately.
