# MintExportSize v1 candidate

Dependency-free, pure final-output resize planning. This isolated candidate contains no image resampling, Canvas/DOM access, file access, network requests, native Android changes, signing, or new dependencies. It does not modify ProjectCore, pipeline history, source data, or production assets.

## Integration boundary

1. Select the existing explicit `original` or `working` source basis.
2. Call `ProjectCore.planExport(source, ops, mode)` first. It must still validate the source and every intermediate stage under its current limits before decoding/rendering.
3. Pass that plan's **post-edit output dimensions** to `MintExportSize.plan(width, height, recipe)`. This includes all crop, rotation, ID-photo and padding operations. Do not pass original metadata dimensions or preview dimensions instead.
4. Render the original plan from its selected source, with existing stale-job/cancellation checks.
5. If `resized` is true, create a distinct final destination of exactly `output.width × output.height` and resample the completed edited image once. If false, reuse the rendered input without allocating a duplicate for resize.
6. Encode/export that final image using the existing lifecycle, transparent-PNG/JPEG-flattening rules, save confirmation and native validation.

This helper has no source-basis parameter and cannot label pixels as original. The caller must retain and display ProjectCore's `mode`, `usesOriginal` and warning. A requested edge is a **final output long edge**, not permission to pre-shrink an oversized original source or intermediate image. A very small final request must not bypass a rejected ProjectCore plan.

The helper does not add a project-history operation or change persistence schemas. It is a planner for a per-export option.

## Module loading

- CommonJS: `require('./export-size.js')` returns the frozen API, with no global export.
- AMD: `define([], factory)` returns the same API, with no global export.
- Browser script: exports `globalThis.MintExportSize`.
- The exposed API is precisely `LIMITS`, `defaults`, `validate` and `plan`.

## Strict recipe

Exactly three own, enumerable data properties are required:

```json
{ "version": 1, "mode": "unchanged", "longEdge": null }
```

or:

```json
{ "version": 1, "mode": "long-edge", "longEdge": 2048 }
```

- `version` must be the number `1`.
- `mode` must be exactly `unchanged` or `long-edge`.
- `unchanged` requires `longEdge: null`, not undefined, a stale number or an omitted field.
- `long-edge` requires a number that is an integer from 1 through 4096 inclusive.
- No numeric coercion occurs. Numeric strings, boxed numbers, booleans, BigInts, non-finite numbers and fractions are invalid.
- Unknown own keys, symbols, non-enumerable keys and all accessor properties are rejected. Validation reads descriptors and never invokes property getters/setters.
- Only a plain record with the current realm's `Object.prototype`, or a null-prototype record, is accepted. Custom prototypes and inherited required fields are rejected. Cross-realm records must be serialized and parsed in the consuming realm, or copied into a null-prototype own-data record.
- This descriptor validation is not a sandbox for malicious JavaScript Proxies: reflective operations can invoke proxy traps. Normal JSON recipes have no such traps.

`defaults()` returns a new unchanged recipe every time. `validate(recipe)` returns a new canonical plain-object copy. Neither accepts an omitted recipe as a default; call `defaults()` explicitly. Inputs and returned records are independent. The API and `LIMITS` are frozen, while returned recipes/plans are detached ordinary data records.

## Planning

Signature: `plan(inputWidth, inputHeight, recipe)`.

The input dimensions must each be numeric integers from 1 through 4096, with product at most **8,000,000 pixels**. Input dimensions are validated before the recipe and before dimension reduction. Both input and output remain subject to those limits.

- `unchanged`: preserve both input dimensions exactly, `resized: false`, `requestedEdge: null`, `scale: 1`.
- `long-edge` larger than the input's longest edge: throw `RangeError` with an explicit upscaling message. Do not clamp the request or silently increase pixels.
- `long-edge` equal to the input's longest edge: preserve exact dimensions, `resized: false`, `requestedEdge` retains that number, `scale: 1`.
- A smaller requested edge becomes the exact output longest edge. The other dimension is rounded nearest, half up, with minimum 1 pixel. Orientation is retained.

For input long edge `L`, input short edge `S` and requested edge `T`, the rounded short edge is:

```text
max(1, floor((2 × S × T + L) / (2 × L)))
```

All operands are exact bounded integers, so the half-up decision does not depend on a near-half floating-point multiplication. The returned `scale` is the nominal long-edge ratio `T / L`. It is not a claim that the quantized width and height both have that exact ratio. Ordinary rounding differs from the ideal short edge by at most half a pixel; a sub-half-pixel ideal short edge is clamped to 1. Very thin images can therefore have an unavoidable visible aspect-ratio change at tiny sizes. No dimension exceeds the corresponding input dimension.

Examples:

| Input | Requested edge | Output | Resized |
| --- | ---: | --- | --- |
| 3000 × 2000 | 1500 | 1500 × 1000 | true |
| 2001 × 3001 | 1024 | 683 × 1024 | true |
| 4 × 2 | 3 | 3 × 2 | true |
| 4096 × 1 | 1 | 1 × 1 | true |
| 500 × 1501 after crop + rotation | 750 | 250 × 750 | true |
| 1300 × 1100 after padding | 650 | 650 × 550 | true |
| 3001 × 2001 | 3001 | 3001 × 2001 | false |
| 3001 × 2001 | 3002 | throws, no upscaling | n/a |

## Returned plan

```json
{
  "recipe": { "version": 1, "mode": "long-edge", "longEdge": 2000 },
  "input": { "width": 4000, "height": 2000 },
  "output": { "width": 2000, "height": 1000 },
  "resized": true,
  "requestedEdge": 2000,
  "scale": 0.5,
  "allocation": {
    "bytesPerPixel": 4,
    "inputBytes": 32000000,
    "outputBytes": 8000000,
    "extraBytes": 8000000,
    "peakBytes": 40000000,
    "pairBytes": 40000000,
    "maxPairBytes": 67108864
  }
}
```

Every successful call returns new metadata records, including an independent canonical recipe. Mutating a returned plan cannot alter the input recipe, another plan, or the API's frozen limits.

## Allocation preflight

The accepted budget is a conservative **64 MiB aggregate pair limit**, not 64 MiB per image:

- `bytesPerPixel`: 4, for an RGBA8 raster.
- `inputBytes`: processed input width × height × 4.
- `outputBytes`: planned output width × height × 4, even for identity.
- `pairBytes`: inputBytes + outputBytes. This conservative number is always checked against `maxPairBytes = 67,108,864`, even for identity.
- `extraBytes`: outputBytes if a resize is needed; otherwise 0 because the input can be reused.
- `peakBytes`: inputBytes + extraBytes, the resize-only simultaneous raster estimate.

At the 8MP limit, an identity plan reports inputBytes = outputBytes = 32,000,000, pairBytes = 64,000,000, extraBytes = 0 and peakBytes = 32,000,000. Under the stricter 8MP/no-upscaling dimension limits, the pair cap is a defensive invariant and cannot currently be reached. Tests verify these byte boundaries; they do not pretend the otherwise unreachable pair-limit rejection was exercised.

These estimates are **not total application memory** and not a guarantee of phone safety. They exclude decoded sources retained elsewhere, editor/history canvases, GPU/WebView backing copies, resampling buffers, PNG/JPEG encoders, flattened-JPEG copies, native byte arrays and output files. The caller must maintain its existing independent budgets and lifecycle cleanup. The planner itself creates only small metadata objects and allocates no pixel buffer.

## Error behavior

- Invalid record structure, mode or unchanged `longEdge` mismatch: `TypeError`.
- Unsupported version, invalid numeric dimension/edge, image-budget breach or requested upscaling: `RangeError`.
- Errors are synchronous and leave the input recipe unchanged.
- Error messages are developer-facing English. The UI should provide a meaningful localized failure message and must not silently fall back to a different size or source basis.

## Verification

Run from this candidate folder:

```sh
node --check export-size.js
node --test export-size.test.cjs project-plan-boundary.test.cjs
```

`npm test` is a convenience alias requiring no install. `npm run test:pure` or `node --test export-size.test.cjs` runs just the portable core suite.

The read-only integration test defaults to the sibling project at `../mobile-oct22/薄荷人像/app/src/main/assets`. When relocating the candidate, set `MINT_PROJECT_ASSETS` to an existing assets directory. The boundary fixtures contain fabricated metadata-only Blobs, not user photos and not decoded images.

Verified on Node v24.19.0:

- **57 tests pass**: 51 portable core tests and 6 existing-ProjectCore composition tests.
- Core coverage includes wide/tall/square/tiny geometry; half-up ties; strict fields, prototypes, accessors and numeric types; exact size limits; no upscaling; equality/unchanged identity; byte accounting; no mutation; JSON round trips; CommonJS/AMD/browser exports; and no DOM, pixel allocator, dependency, network or timer access.
- One core test also checks **12,000 deterministic input/target cases**, each paired with its transposed orientation, against rounding/dimension/allocation invariants.
- Composition coverage includes post-crop/rotation, padding, source versus working basis, rejection of oversized original or intermediate dimensions even with a tiny requested final output, and legacy-working-copy provenance.

`TEST_RESULTS.txt` records the successful run. `SHA256SUMS` freezes candidate files for adoption. No image-quality, Canvas-renderer, WebView, actual Android, encoder output or device-memory validation is claimed by this pure planner suite.
