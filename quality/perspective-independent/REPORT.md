# Independent perspective audit: final bounded-prefilter acceptance

## Result and exact scope

**38/38 tests pass, zero skips, no open safety/correctness finding in this audited scope.** The final production kernel is `linear-premultiplied-anisotropic-mipmap`, capped at 16 directional samples. Severe-minification artifacts found in the initial bilinear and isotropic-mipmap versions were not accepted merely as documentation; both prompted production corrections and independent retesting.

This is Node v24.19.0/Linux verification of production math, input/buffer safety, canvas operation adaptation, project planning/persistence, native PNG encoding/decoding and deterministic synthetic quality. It is **not** actual Android/WebView, touchscreen, device-memory/RSS, MediaStore, camera-photo or complete-editor acceptance. The parent separately owns full-editor UI/export verification. No production code, dependencies, signing, model weights or private inputs were changed by this auditor.

Commands from `/workspace/scratch/902a42ed06ad`:

```sh
node --test 'mobile-oct22/薄荷人像/tests/perspective-independent.test.cjs'
node 'mobile-oct22/薄荷人像/quality/perspective-independent/make-evidence.cjs'
node 'mobile-oct22/薄荷人像/quality/perspective-independent/prefilter-analysis.cjs'
```

The final tests use the actual integrated production files, not a substituted implementation. `PERSPECTIVE_CORE=/absolute/file.js` remains available for candidate comparisons. Production integration is required for project acceptance; it is never silently skipped.

## Frozen production hashes

- perspective.js: `3a3b57ea8da4ce4a7c99b180a454e9f00a4242a0460621d267ad5487fbe66557`
- perspective-operation.js: `238e8d9587e8538e3c4c4e10d3e3b607e5d1a33ed0511b89c375c949c1766a24`
- project-core.js: `9fa1bbc2ccd98d477ef1983043dbf3cbbcea97c5e982e92e3f4b2ecfb53ed344`

`mathematical-safety-results.json` additionally pins the test, oracle, generator and NativeCanvas-helper hashes. `artifact-sha256.json` is the complete evidence manifest.

## Independent mathematical/reference methods

1. **Homography:** solve eight correspondence equations using partial-pivot Gaussian elimination. Neither the production closed-form quadrilateral formula nor its matrix inverse is copied. 31,434 ordinary dense mapping points test 93 shapes at full/capped resolutions, both directions and corner/interior roundtrips.
2. **Non-minifying pixels:** whole-source tent-kernel accumulation, deliberately avoiding production's floor/four-tap indexing. Known magnifying interior rectangles assert zero mip allocation as well as reference bytes.
3. **Minifying pixels:** independent exact source-cell box integration in linear light, including premultiplied alpha. Power-of-two reductions align with the mip footprint and match exactly. Across these two exact-reference families, **30 rasters and 9,960 RGBA channels have maximum byte delta 0**.
4. **Geometry safety:** 700 deterministic difficult trapezoids are attempted. 394 accepted shapes are scanned on 31 × 31 grids; 306 fail with explicit geometry errors rather than being reordered/repaired. A width-`1e-5` source quad checks fixed source-boundary tolerance and rejects normalized outside offsets from `1e-13` to `1e-8`. Maximum mapping error including that ill-conditioned stress case is `7.275957614183426e-9` pixel.
5. **Sampling bounds:** 2,205 independently finite-differenced Jacobians verify certified major/minor footprint bounds, mip-level sufficiency and bounded directional sample counts. This does not use the production analytic derivative expressions.

Identity and exact integer crops preserve all source RGBA bytes, including RGB hidden under zero alpha. Nonexact filtering suppresses hidden transparent colors and zeroes RGB when rounded alpha is zero. Explicit color checks distinguish linear light from encoded-space interpolation: black/white midpoint is 188, not 128; opaque red/transparent cyan yields red with alpha 128 and no cyan halo.

## Safety and operational coverage

- Own-data validation rejects missing/inherited/extra/hidden/symbol/accessor fields, sparse/accessor quad arrays, unsafe prototypes and invalid numeric values without executing rejected getters.
- Isolated-realm Object.prototype pollution cannot supply missing source, limit or option fields.
- Intrinsic branding rejects forged byte-array prototypes, shared buffers disguised as ArrayBuffer, resizable buffers with spoofed metadata, subclasses and detached storage. Full retained backing bytes are counted even for small subviews. Own backing `byteLength` getters cannot hide memory.
- Source/full declared raster caps cannot be evaded with tiny output fractions or small previews. The entire retained source, output and all mip levels are counted before allocation or cancellation callbacks. Exact lower memory/work thresholds and one-byte/one-unit-under boundaries are tested.
- Cancellation before raster work, inside mip construction, mid-output raster and after canvas writes preserves the source and cannot publish partial output. Callback-induced detachment is detected.
- Readback/allocation does not occur on invalid recipes, cancellation or phone-budget rejection. Aliasing the input or an old output as a fresh canvas is rejected. Failed writes/cancelled owned outputs are disposed without resizing the input.
- Full-resolution neutral returns the same input without readback. Neutral with an actual preview cap returns a fresh capped result and charges its real mip/sample work.
- Project serialization/restoration preserves original Blob identity, ordered recipes and redo history. Original versus explicit working-size replay uses independently derived stage dimensions. Cumulative work is enforced, and oversize originals cannot be hidden behind tiny perspective output.
- Real installed NativeCanvas executes the operation adapter. PNG is encoded, decoded and compared byte-for-byte against expected opaque output; original canvas bytes remain unchanged.

## Enforced resource model

| Layer | Raster limits | Memory/work limits |
|---|---|---|
| Core | 67,108,864 pixels; 16,384 per edge | 536,870,912 retained-source + output + mip bytes; 268,435,456 work units |
| Phone adapter | 8,000,000 pixels; 4,096 per edge | 134,217,728 estimated extra bytes; 128,000,000 per-operation and cumulative sample/build work units |

Mip levels contain Float32 premultiplied-linear RGBA and are charged at 16 bytes/pixel. Their construction is charged at four parent reads/pixel; sample work includes the certified directional count and bilinear/trilinear taps. The core excludes its fixed 2 KiB lookup table and host copies. The adapter separately accounts for source readback, output/intermediate copies and mip storage. These are planning bounds, not measured Android peak memory.

A concrete regression confirms 4000 × 2000 at full-quad fraction .99 exceeds the phone's 128 MiB extra-buffer budget and is rejected **before readback**, although a capped 900-pixel preview fits. The implementation does not silently lower the declared output to pass this test.

## Findings corrected and retested

1. **Neutral capped plan/apply mismatch:** initial adapter advertised reduced renderedSize but returned uncapped input and charged zero work. Final adapter distinguishes actual-size identity from capped sampling.
2. **Condition-expanded source membership:** initial inverse-matrix tolerance could expand a thin quad's accepted source area. A fixed normalized source half-plane tolerance now precedes inverse mapping.
3. **Severe bilinear minification aliasing:** checker/text fixtures exposed obvious moiré and lost strokes. Final mip-prefiltered sampling substantially reduces these errors.
4. **Isotropic mip overblur:** the first prefilter erased untouched-axis stripes during pure 8:1 shrink in the other axis. Bounded directional sampling now preserves those fixtures exactly at 8:1 in both directions and at the 16:1 boundary.
5. **Mip adapter accounting:** new mip bytes and build/sample work now flow into phone memory, per-stage work and cumulative-work preflight. The new rejection-before-readback regression passes.

## Quality measurements against independent source-area integration

| Synthetic case | Initial bilinear | Intermediate isotropic mip | Final bounded anisotropic mip |
|---|---:|---:|---:|
| 256² checker → 17², max RGB byte error | 119 | 1 | 1 |
| Same checker, mean absolute RGB error | 21.5017 | 0.4083 | 0.4083 |
| 577 × 289 text → 97 × 49, mean absolute RGB error | 20.7004 | 4.0633 | 4.0238 |
| Same text, RMS RGB error | 41.4726 | 8.4676 | 8.3816 |
| Unchanged-axis stripes, pure 8:1 other-axis shrink, max error | 0 | 188 | 0 |

Additional final observations:

- Near-unity 257 × 129 → 256 × 128 checker: area-reference mean error 0.1479 and RMS 0.4027. It is not heavily blurred by a sudden full-level filter switch.
- Odd-size linear-light ramp, 577 × 289 → 97 × 49: mean error 0.0410, maximum 3. No systematic coordinate renormalization drift was observed.
- Odd alpha stripes, 257 × 129 → 17 × 9: RGB matches the area reference exactly and changing hidden RGB has no effect. Alpha differs by at most 8, mean 3.8039, because this bounded filter is not exact box integration. No cyan/colored halo appears.
- At the **16:1 anisotropy boundary**, untouched-axis stripes remain exact.
- **Beyond the 16-sample cap**, deliberate softness remains. At 32:1 pure vertical reduction, one-pixel horizontal-axis frequencies collapse toward gray: mean error 127.5 versus exact area. The plan sets `sampling.maySoftenMinorAxis=true`. This is explicitly recorded and visualized, not presented as universal high-quality resampling.

The final filter is an antialiasing approximation, not exact area/EWA integration. Odd mip boundaries repeat the previous level's edge cell using fixed `2^level` source-edge scale. Extremely anisotropic transformations can soften the minor axis; magnification never adds genuine source detail.

## Current synthetic planar fixture for editor/export verification

- `synthetic-perspective-input.png`: 420 × 320.
- `synthetic-perspective-corrected.png`: current 320 × 220 production result.
- `planar-contact-sheet.png`: pristine reference, synthetic photographed plane, correction.
- `prefilter-contact-sheet.png`: checker, text, odd ramp, alpha, 8:1 anisotropy and over-cap tradeoff.
- `adapter-native-png.png`: actual adapter PNG, independently decoded in the test.

```json
{"version":1,"quad":[{"x":0.17,"y":0.10},{"x":0.88,"y":0.18},{"x":0.96,"y":0.88},{"x":0.06,"y":0.95}],"outputFraction":{"width":0.7619047619047619,"height":0.6875}}
```

Source RGBA SHA-256, unchanged before/after:
`aa18111b3834ae4758c45c44a76310bef0f747bb0d8abe20627b388016199831`

Final corrected RGBA SHA-256:
`bcfb4e21363487cdaee0df2a9174a36eec2f17a0d2f0f10beee971c9db726c22`

The simulated photograph is generated using the independent homography and nearest-cell sampling of a synthetic plane, so it contains construction aliasing. The correction is not claimed to reproduce the pristine plane exactly or to demonstrate real camera-photo recovery.

## Historical negative controls and final evidence

- `bilinear-negative-control/`: frozen core `38d468…3282`, exact source modules, historical 28-test report, tests and visual evidence. Historical acceptance there is superseded by this final report.
- `isotropic-negative-control/`: measured evidence from source hash `e356dd…0877`, including the lost-stripe failure. Its SOURCE-NOTE explicitly records that source copying raced the subsequent candidate update; no mismatched source is labeled as the isotropic version.
- `anisotropic-candidate-e917f3.js`: intermediate source snapshot, not the final production hash.
- `test-output-production.txt`: final 38-test run.
- `mathematical-safety-results.json`: exact checks/counts/limits/source hashes.
- `visual-quality-results.json` and `prefilter-quality-results.json`: final image hashes, metrics, recipes and sampling plans.
- `oracle.cjs`, `make-evidence.cjs`, `prefilter-analysis.cjs`: reproducible reference/generation methods.
- `artifact-sha256.json`: complete artifact manifest, with historical controls kept distinct.
