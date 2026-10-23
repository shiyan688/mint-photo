# Independent mobile straighten audit

Completed: 2026-10-22. Production was read-only throughout this audit. Original audit outputs were written only under `/workspace/shared/mobile-straighten-audit`. This portable copy is intended for `quality/straighten-independent` in the app repository.

## Result

PASS under the explicitly documented binary64/libm geometric-tolerance contract. Two actionable defects found independently were fixed by the production owners and verified on the final files:

1. Expand lost positive sub-ULP AABB increments when adding them to a large integer. Before correction, 100×1 at 89.99999999999999° returned 2×100 rather than 2×101, and 2×3 at 1e-20° returned 2×3 rather than 3×4. A 16384×1 tiny-angle case incorrectly avoided the 16385 output-edge rejection. Final split-increment arithmetic passes all these counterexamples without snapping the angle.
2. The persisted operation adapter accepted explicit recipe:null or recipe:undefined as a default 0° operation. This could silently omit malformed saved rotation. The final operation adapter rejects those records before delegating to the pure core. The pure optional-argument default API remains separate.

Final independently authored tests: 10 core tests and 6 complete-editor/native-Canvas tests passed. No dependency, network, browser, signing, or production change was made by this audit.

## Numerical verification

- `decimal-geometry-audit.py`: 1,360 total fixed-seed/general/thin/near-axis/near-45 cases. 1,346 valid output geometries agreed with an independent 100-digit Decimal trigonometric and active-constraint optimizer; 14 over-limit cases were correctly rejected. Zero failures on the final production core. The original candidate had 78 expand mismatches.
- `structured-boundary-audit.py`: separately constructed 2,058 rational-triangle angle/integer-span cases. In 576 cases, binary64/libm crop dimensions differed by one pixel on an axis from the high-precision real-number floor. These are recorded, not folded into the zero-failure general sample or concealed.
- Representative limitation: 8×8 crop at 36.86989764584403° produces 6×6 in the binary64 implementation. High precision yields the optimal continuous span 4.999999999999999928058265527054133… and consequently a strict real-number floor output of 5×5. The span-5 boundary exceeds the exact source constraint by approximately 1.007184282621242e-16 pixels. No arbitrary-angle exact-real flooring guarantee is supported by this audit.
- `boundary-pixel-audit.cjs`: all 8,232 final corners of those 2,058 cases satisfy the declared geometric tolerance. Independent direct-angle inverse sampling found maximum source-boundary escape of 1.1368683772161603e-13 pixels. All corner samples from an opaque source rounded to alpha 255. All pixels of 35 distinct-angle small representative crops were opaque; real Canvas PNG encoding and native decoding matched their declared plan dimensions.
- The intentionally chosen objective is maximal continuous centered pixel-center span area before quantization, not maximal integer raster pixel count. At 4×9, 33° crop chooses 2×3; a different feasible 3×3 integer raster exists. This is a documented objective, not hidden upscale.

## Pixel, data, and lifecycle coverage

Core:
- Exact 0° returns the same input object and data, preserving hidden RGB.
- Exact ±90°/±180° matches frozen geometry.js byte-for-byte on asymmetric, odd/even, and 1-pixel-thin images, including transparent hidden RGB.
- Independent inverse sampler summing over every source pixel matched production arbitrary-angle linear-light premultiplied-alpha output to at most one channel byte across multiple thin/asymmetric shapes and both modes.
- Altering RGB only under input alpha zero cannot affect arbitrary-angle output. All zero-alpha output RGB channels are zero.
- Opaque crops remain opaque, including near ±90°, near 45°, and 1-pixel-thin inputs.
- Edge-coordinate round trips and exact quarter-turn half-pixel positions agree.
- Malformed metadata and own accessors fail before getter execution or cancellation callbacks. Cancellation returns no partial raster and leaves input bytes unchanged.

Complete editor with real native pixels:
- A manual clone stroke was created through the shipped manual UI handlers, committed, followed by straighten 17.3° and a geometry crop. An independently computed rotation of the manually retouched image, followed by the frozen crop stage, matched the exported PNG encoder pixels exactly. Undo/redo retained original serialized stroke coordinates and restored expected stage pixels.
- Actual PNG encoding/decoding preserves transparent corners and partial alpha. Actual JPEG encoding/decoding composites white corners and is fully opaque. Both match declared dimensions.
- A 1120×720 original exported at the independently planned full rotated dimensions while committed and display preview longest sides remained ≤900. The export was not based on that preview.
- Source Blob identity, original byte hash, and retained working-source pixel hash are unchanged by tested edits/exports.
- Rotation invalidates cached face landmarks. A pending pre-rotation face result is rejected; the next detection uses the newly committed canvas.
- Mobile source/output edge and pixel limits reject before image readback or canvas allocation, even when a 900px preview is requested. Aggregate 128M work budget rejects excess replay.
- Null/undefined persisted recipes fail closed in both the operation adapter and project creation.

## Expected phase behavior, made visible

`axis-phase-contact-sheet.png` is a synthetic checkerboard visualization, inspected after generation. It contrasts exact zero/90° with nonzero 1e-20°/90°−1 ULP. The conservative centered ceil-AABB adds a pixel, shifting output sampling by half a pixel; this can visibly soften high-frequency checkerboards even at a numerically tiny nonzero angle. It is an intentional consequence of the no-snap, centered-canvas contract, not a claimed continuous visual transition at exact quarter turns.

The 1×1 opaque red probe stays 1×1 with alpha 255 at exact 0°/90°, and becomes 2×2 with alpha 64 in each pixel for those nearby arbitrary angles. No epsilon snap or silent resize was introduced to hide that behavior.

## Evidence and limitations

- `core-audit.test.cjs`, `core-final.tap`: independent core regressions, 10/10.
- `editor-audit.test.cjs`, `editor-final.tap`: full shipped editor handlers, real Canvas raster/PNG/JPEG backend, 6/6.
- `decimal-results.json`, `decimal-final.log`: ordinary/near-axis oracle result.
- `structured-boundary-results.json`: all 2,058 constructed cases and all 576 quantization differences.
- `boundary-pixel-results.json`: corner safety, 35 actual PNG checks.
- `axis-phase-contact-sheet.png`, `axis-phase-report.json`: exact/near-axis visual and byte evidence.
- `manual-straighten-crop.png`, `manual-order.json`: ordered edit output and serialized operations/hash evidence.
- `alpha-straighten.png`, `alpha-straighten.jpg`: actual encoded output comparison, visually inspected.
- `full-original-export.png`: full-resolution replay output.
- `binary64-boundary-8x8-to-6x6.png`: actual 6×6 output at the documented precision boundary.

The DOM, timers, source selection, and Android bridge are controlled test infrastructure. Canvas rendering and image codecs use the existing installed @napi-rs/canvas adapter, including its already documented putImageData current-transform workaround. This is not browser-screen QA, Android device QA, native model inference validation, a performance guarantee, or a claim about private/real portraits. Only synthetic fixtures were used. Strict real-number interval quantization is explicitly not verified or promised.

## Audited file hashes (SHA-256)

- straighten.js: 7b28d67aba28747e85abf95c12b39522153871c4d084038bcb053244fa11f98e
- straighten-operation.js: 3ab6a354b76ec3775de8d7d6f4ee8843356e5e970effd0aff107ee1d2289be65
- straighten-ui.js: 1b12b5f36fc106ac59f89a7cdc57b61ffc794b1a2bdfb58b210019977a0a6421
- editor.js: 28a5f8cc9ce3a8e908e80a3d5ec90962d5a5b03e205140d9f091b1fb6330d85f
- project-core.js: c95b72ee806c9fae20ae901ffc551002b787930957efcec79ee3ddb3d1a0c12b

## Reproduction

Set NODE_PATH=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules for the native scripts. The portable core test defaults to production app/src/main/assets/straighten.js under the resolved repository root; STRAIGHTEN_CORE is an optional explicit override. Run Node's test runner on the two test files; run the Python oracle scripts followed by boundary-pixel-audit.cjs. Each script writes only to its own directory. Set MINT_APP_ROOT to override the default repository root two directories above the scripts. The final tests above were rerun against production, not only the candidate.
