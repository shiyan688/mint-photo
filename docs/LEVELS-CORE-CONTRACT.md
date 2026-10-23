# MintLevels shared core contract (version 1)

`levels.js` is the single dependency-free CommonJS/browser-global source for conventional, display-referred Levels on 8-bit gamma-encoded sRGB RGBA pixels. Copy its **identical bytes** into desktop/mobile and preview/export modules; do not independently reimplement the equations. The CommonJS filename may be `levels.cjs`; the browser copy can be `levels.js`.

This is not a RAW, linear-light, wide-gamut/HDR, highlight-recovery, learned retouching or state-of-the-art restoration algorithm. It does not recover clipped detail, interpret ICC profiles, decode images or manage color spaces. Inputs must already be straight/unpremultiplied RGBA8 sRGB code values.

## Public API

The frozen API is `module.exports` in CommonJS and `globalThis.MintLevels` when loaded as a script. It exposes:

- `defaults()` → a fresh, fully independent identity recipe.
- `validate(recipe)` → a fresh normalized/deep-copied recipe, or `null` for the explicitly disabled sentinel. Invalid input throws `TypeError`. Validation never mutates the caller's recipe.
- `isActive(recipe)` → validates first, then returns true only for non-null recipes with `strength > 0` and at least one non-default channel. This is parameter activity, not a promise that every pixel will change.
- `buildLuts(recipe)` → fresh `{ red, green, blue }`, each a `Uint8Array(256)`. Each table already includes master and individual channel mapping, strength and final rounding. The returned tables are independent and can be modified without affecting later calls. `null`, default and zero-strength recipes produce identity tables. This bounded helper is synchronous and has no cancellation option.
- `apply(image, recipe, options?)` → validates inputs, checks cancellation and either returns the same input image object for inactive recipes or returns a new `{ width, height, data: Uint8ClampedArray }`. It never writes to the original image/data. It preserves every alpha byte and skips editing the hidden RGB of pixels whose alpha is exactly zero.
- Frozen `LIMITS` and `CHANNELS` metadata.

There is no `enabled` field. Use `null` for explicit disable, or strength zero to retain a disabled recipe. Omitted/undefined recipes are invalid.

## Recipe

```json
{
  "version": 1,
  "strength": 1,
  "channels": {
    "rgb":   { "inputBlack": 0, "inputWhite": 255, "gamma": 1, "outputBlack": 0, "outputWhite": 255 },
    "red":   { "inputBlack": 0, "inputWhite": 255, "gamma": 1, "outputBlack": 0, "outputWhite": 255 },
    "green": { "inputBlack": 0, "inputWhite": 255, "gamma": 1, "outputBlack": 0, "outputWhite": 255 },
    "blue":  { "inputBlack": 0, "inputWhite": 255, "gamma": 1, "outputBlack": 0, "outputWhite": 255 }
  }
}
```

- `version` is exactly numeric 1.
- `strength` is a finite number in `[0, 1]`.
- Input and output black/white points are integers in `[0, 255]`.
- `inputBlack < inputWhite`; `outputBlack <= outputWhite` (constant output is permitted).
- `gamma` is finite and in `[0.1, 10]`.
- No coercion, unknown fields, missing fields, symbols, hidden/non-enumerable fields or accessors are permitted on any recipe/channel record. Ordinary and null-prototype records are accepted; custom prototypes and arrays are rejected. Frozen data records are valid.
- All fields are inspected using own-property descriptors before their values are used. Ordinary getters are never invoked. Numeric objects, NaN and infinities are rejected. Invalid recipes are still rejected when their strength is zero.
- Normalized output fields are defined as own data properties, so inherited setters are not invoked when constructing output records.

## Mapping, order, precision and rounding

For a channel's input code value `v`, which may be fractional after the master mapping:

```text
t = clamp((v - inputBlack) / (inputWhite - inputBlack), 0, 1)
f(v) = outputBlack + pow(t, 1 / gamma) * (outputWhite - outputBlack)
```

Gamma greater than 1 brightens intermediate code values; gamma less than 1 darkens them. Gamma is not an sRGB transfer-function conversion. Each component uses the RGB master first, then its individual channel:

```text
mapped = f_individual(f_rgb(original))
result = Math.round(original + (mapped - original) * strength)
```

Both mappings and the single strength blend use JavaScript `Number` precision. There is **no intermediate clipping to integer, rounding, 8-bit storage, or per-stage strength blend**. Default channel mappings are exact pass-throughs, avoiding unnecessary floating-point round trips. The one final `Math.round` is nonnegative half-up: `0.5 → 1`, `254.5 → 255`. Do not rely on `Uint8ClampedArray` assignment to round fractional values, since that uses ties-to-even instead. The LUT stores only already-rounded integer outputs.

Required regression: master `{inputBlack:15,inputWhite:242,outputBlack:3,outputWhite:249,gamma:1.7}`, individual channel `{inputBlack:41,inputWhite:214,outputBlack:12,outputWhite:229,gamma:0.65}`, strength 1, input 26 produces **13**. Rounding the master prematurely incorrectly produces 12.

`buildLuts` is suitable for graphs and already-visible pixel components. Applying these tables manually must still preserve alpha and alpha-zero hidden RGB. Do not apply strength a second time or use a LUT on a premultiplied component.

## Image/storage boundary

`image` contains exactly the own enumerable data properties `{ width, height, data }` and uses an ordinary or null prototype. Accessor/hidden/symbol/unknown fields and custom prototypes are rejected without calling ordinary getters.

- Width/height are safe integers at least 1 and at most 16,384 per edge.
- `width * height <= 64,000,000` (decimal 64 MP).
- Data is a native, same-realm `Uint8Array` or `Uint8ClampedArray`, exactly `width * height * 4` bytes long. Valid nonzero-offset views into larger fixed-size buffers are supported.
- ArrayBuffers must be nonempty, fixed-size and non-shared. Shared, detached, resizable, fake, proxied, wrong-type and wrong-length storage is rejected.
- Custom typed-array subclasses, including Node `Buffer`, are not accepted. For a Buffer source, create a native `Uint8Array` view over its existing buffer/offset/length before calling this API; do not change its bytes.
- Intrinsic typed-array and ArrayBuffer getters are used. Any shadowed `length`, `buffer`, `byteLength`, `byteOffset`, iterator or copy methods are ignored and never executed. Typed-array extra properties are not treated as image-record fields or enumerated; this avoids enumerating up to 256 million indices.
- Record validation is not a sandbox against hostile JavaScript Proxies or globally replaced language intrinsics: Proxy reflection traps may run. Prefer JSON-derived plain records. No plugin, browser, DOM or Node-specific production dependencies are used.

For an active recipe, image-sized incremental allocation is four bytes per pixel, plus three 256-byte tables and small fixed metadata. No maximum-size allocation or performance guarantee is claimed by the test suite.

## Options and cancellation

The optional `options` record permits only the own enumerable data field `shouldCancel`, whose value is a function or undefined. An empty ordinary/null-prototype record is valid; explicit `null`, unknown/hidden/symbol/accessor fields and custom prototypes are invalid. Omitting options is valid. No record getter or inherited `shouldCancel` is called.

`shouldCancel()` is invoked with no arguments; any truthy result aborts with an `Error` having `name === 'AbortError'` and `code === 'ABORT_ERR'`. A callback's own thrown error propagates unchanged. Cancellation is checked:

1. After complete image/recipe/options validation, before even LUT allocation (also for inactive recipes).
2. After LUT construction, immediately before the image-sized output allocation.
3. At every pixel chunk boundary, with at most 65,536 pixels and at most 32 rows per chunk.
4. After processing, immediately before publishing the result.

Input storage is rechecked after callbacks. A callback that transfers/detaches it causes a `TypeError`, never a corrupt successful result. The normalized recipe snapshot cannot be changed by later caller recipe mutation. Callbacks must not change source pixel bytes; the core does not snapshot the entire input.

This is cooperative **synchronous** processing; it does not yield to the event loop. A UI main-thread click cannot interrupt a currently running synchronous call by itself. Use the intended worker/job integration and a callback that can observe current cancellation state. No partial output is returned or exposed on cancellation/failure. The inactive return aliases the original image by design; callers needing a separate mutable copy must copy it themselves.

## Verification

Run with the existing local Node runtime, with no dependency install:

```sh
node --test levels.test.cjs
```

The suite covers CommonJS/browser-global loading in Node VM (not a browser UI test), fresh defaults, exact identity/null/zero-strength behavior, 256-value ramps across every component, 120 deterministic randomized direct-formula comparisons, extreme endpoint/gamma/strength monotonicity, gray neutrality, independent channels, master order, the 26→13 double-round regression, one strength blend, half-up rounding, every alpha byte, hidden RGB, immutable input, offset views, independent LUTs, cancellation before both allocation phases/during chunks/at publication, detach-on-callback handling, dimension boundaries, malformed numeric/record/option/storage rejection, getter avoidance and inherited-setter-safe output construction.

The 64 MP cap is tested at the dimension-validation boundary without allocating a 256 MB input. Large-image throughput, desktop/mobile visual inspection, native packaging and end-to-end export behavior are separate integration checks.
