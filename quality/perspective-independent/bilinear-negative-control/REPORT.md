# Four-corner perspective: independent math, safety and quality audit

## Result

**28/28 tests pass, zero skips, zero open safety/correctness findings in the audited scope.** Two cross-module/boundary issues were corrected by their production owners and independently retested. Bilinear minification remains a documented quality limitation, not an antialiased-resampling claim.

Commands, run from `/workspace/scratch/902a42ed06ad` with Node v24.19.0 on Linux:

```sh
node --test 'mobile-oct22/薄荷人像/tests/perspective-independent.test.cjs'
node 'mobile-oct22/薄荷人像/quality/perspective-independent/make-evidence.cjs'
```

The original candidate can also be selected with `PERSPECTIVE_CORE=/absolute/path/perspective.js`; the final acceptance run uses the actual integrated production core, operation adapter and project module. The suite requires production integration for project acceptance rather than silently skipping it. No production file was edited by this auditor.

## Independent mathematics

- The reference solver constructs eight linear correspondence equations and solves them using partial-pivot Gaussian elimination. It does not copy the production quadrilateral closed-form homography or its matrix inverse.
- 31,434 dense ordinary mapping points cover 93 quadrilaterals at full and capped output sizes, including both directions and corner/interior roundtrips.
- A separate thin-quad stress case, width `1e-5` in normalized source coordinates, verifies rejection outside each vertical boundary at normalized distances `1e-13`, `1e-12`, `1e-10` and `1e-8`. Maximum measured roundtrip error including this ill-conditioned stress case is `7.275957614183426e-9` pixel.
- 48 raster cases compare 4,332 RGBA channels against a whole-source tent-kernel reference. This deliberately does not reuse the production four-tap/floor indexing loop. The reference independently recognizes exact integer crops. Maximum byte difference is **0**.
- 700 deterministic difficult trapezoids were attempted: 394 were accepted under the documented geometric safety thresholds and each accepted map was evaluated on a 31 × 31 grid. The other 306 were rejected with the geometry error, not silently reordered or repaired.
- Output-edge normalization, per-axis fraction rounding, maxSide rendering scale and mapping to actual rendered dimensions are checked independently.
- Identity and exact integer crops preserve all RGBA bytes, including hidden RGB under zero alpha. Nonexact filtering uses linear-light premultiplied alpha, suppresses hidden transparent colors and canonicalizes rounded-zero-alpha output. A black/white midpoint is 188, not 128; an opaque red/transparent cyan midpoint is red with alpha 128, without cyan contamination.

## Safety and integration boundaries

The suite exercises:

- Own-data record validation for recipes, points, options, limits, operations and image metadata; missing/inherited/extra/hidden/symbol/accessor fields; sparse/accessor quadrilateral arrays; nonfinite/coerced/out-of-domain values. Rejected getters and cancellation callbacks do not execute during invalid preflight.
- Object.prototype pollution of missing option/limit/source fields in isolated JS realms.
- Genuine typed-array and backing-buffer branding, including forged Uint16Array/Float32Array prototypes, subclassed arrays, detached storage, SharedArrayBuffer disguised with ArrayBuffer.prototype, and resizable ArrayBuffer with a spoofed `resizable` property.
- Full retained subview backing-buffer accounting, not only visible view length. An own backing `byteLength` getter cannot hide excess memory and is not executed.
- Source and declared raster budgets cannot be bypassed by a tiny output fraction or preview cap; malformed geometry cannot be repaired silently.
- Cancellation before allocation, mid-raster and after native canvas writes; callback-induced detachment; owned output disposal; attempts to return the input or an earlier output as a fresh canvas.
- Operation preflight before any input readback/allocation, full-resolution neutral no-readback identity, and neutral-but-capped fresh output with consistent plan dimensions/work accounting.
- Project roundtrip retains the original Blob identity, saved recipe order and redo state. Original and working-source replay produce their independently calculated dimensions. Eight 4-million-pixel active stages reach 128,000,000 sample work units; the ninth is rejected. Original oversized input remains rejected even with a tiny requested output; explicit working replay is separately planned.
- The actual operation adapter renders through real installed NativeCanvas. Encoded PNG is decoded and compared byte-for-byte with its expected opaque output; the original canvas hash is unchanged.

Limits under test:

| Layer | Pixel/edge bounds | Memory/work bounds |
|---|---|---|
| Core | 67,108,864 pixels; 16,384 per edge | 536,870,912 source-retained-plus-output RGBA bytes; 268,435,456 work units |
| Phone adapter | 8,000,000 pixels; 4,096 per edge | 134,217,728 estimated extra bytes; 128,000,000 cumulative sample work units |

The core's memory figure excludes its fixed 2 KiB lookup table and host-side copies. The adapter separately estimates the source readback and output/intermediate buffers. These are enforced planning bounds, not a measurement of Android peak RSS.

## Resolved findings

1. **Neutral capped adapter plan/apply mismatch.** A neutral recipe with explicit `maxSide` previously advertised a reduced rendered size while applyCanvas returned the uncapped input and charged zero work. The adapter owner changed the no-op rule to apply only when rendered size equals input size. Independent regression confirms neutral 1200 × 800 with maxSide 90 returns a new 90 × 60 image, charges 21,600 work units and the appropriate readback/output estimate, leaving the input unchanged. Full-size neutral still returns its input without readback.
2. **Condition-dependent source-boundary tolerance.** The core owner added normalized source half-plane membership before inverse mapping, with fixed 256-epsilon perpendicular-distance allowance. The inverse condition can no longer enlarge the accepted source region. Independent thin-quad outside/edge tests pass.

## Synthetic visual evidence and quality limitation

The source fixture contains a textured checker plane, border, corner markers and sharp text. It is a synthetic planar target, not a private input or real camera image. Its simulated photograph is generated using the independent correspondence solver and nearest-cell sampling. That construction introduces its own raster aliasing; the rectified image is not promised to recover the pristine reference exactly.

- `planar-contact-sheet.png`: reference, synthetic photographed plane and production correction.
- `synthetic-perspective-input.png`: 420 × 320 stage input.
- `synthetic-perspective-corrected.png`: 320 × 220 production result.
- `visual-quality-results.json`: complete recipe, source/result hashes and each image's SHA-256.
- `adapter-native-png.png`: actual adapter output, PNG-encoded and independently decoded during the test.

Fixture recipe:

```json
{"version":1,"quad":[{"x":0.17,"y":0.10},{"x":0.88,"y":0.18},{"x":0.96,"y":0.88},{"x":0.06,"y":0.95}],"outputFraction":{"width":0.7619047619047619,"height":0.6875}}
```

The source RGBA SHA-256 is unchanged before/after:
`aa18111b3834ae4758c45c44a76310bef0f747bb0d8abe20627b388016199831`.
The corrected RGBA SHA-256 is:
`2dc8c695256c729438288814716bf04ba54355b8c25a05483bd611c570c4acd6`.

`minification-contact-sheet.png` compares production bilinear against exact source-cell area integration in linear light:

- **256 × 256 one-pixel checker → 17 × 17:** bilinear red channel spans 68–248; area reference spans 187–188. Maximum RGB channel error is 119, mean absolute error 21.5017, RMS error 30.3364.
- **577 × 289 sharp text/line target → 97 × 49:** maximum RGB channel error is 224, mean absolute error 20.7004, RMS error 41.4726.

This demonstrates visible moiré and missing fine strokes under strong minification. Four-tap bilinear is not an area/EWA/mipmap antialiasing filter. The feature should not promise uniformly high quality for arbitrary perspective or severe shrinking. Enlarging a selected quadrilateral likewise does not add real detail. An independent box reference is used here to expose aliasing, not to claim it is the preferred filter for every projective transform.

## Evidence and reproducibility

- `test-output-production.txt`: exact 28-test production run output.
- `mathematical-safety-results.json`: exact source/test/oracle hashes, counts and limits.
- `visual-quality-results.json`: synthetic inputs/results, quality metrics and PNG hashes.
- `oracle.cjs`: independent solve, mapping and all-source raster oracle.
- `make-evidence.cjs`: deterministic fixture and reference generator.
- `artifact-sha256.json`: delivery manifest.

Audited production hashes:

- perspective.js: `38d468669b11972df53ea0efb2e746518e131896b12b31a7e8567ad267b13282`
- perspective-operation.js: `b301c56b18f53c03e881c8586af5ac42a27839d28ebb601bb60bab1660d79f7a`
- project-core.js: `9fa1bbc2ccd98d477ef1983043dbf3cbbcea97c5e982e92e3f4b2ecfb53ed344`

## Explicit scope limits

This is independent Node/NativeCanvas host verification of math, records/buffers, adapters, project planning and synthetic quality. It is **not** a real browser, Android WebView, device-memory, touch interaction, MediaStore/native sharing or camera-image acceptance test. The parent owns complete-editor UI/export acceptance. No dependencies, model weights, private fixtures, signing changes or network downloads were added.
