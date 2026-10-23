# Independent B03 photo-background audit

Result: **37/37 independent tests passed** against the production code fingerprinted in `test-results.json`. No production files were edited by this auditor.

## Verified

- Strict local embedded RGBA schema, normalized original-size provenance, forbidden metadata/accessors, invalid resource limits before pixel reads, cancellation, and allocation failure safety.
- Source alpha multiplied by continuous refined confidence, then premultiplied linear-light composition. An independent 256-confidence-value oracle matched actual Canvas pixels exactly.
- Background-only fill/fit and position, fractional transparent margins, transparent-pixel fringe invariance, and odd-sized severe-minification conservation.
- Opaque foreground coordinates and pixels unchanged; same-photo backgrounds cannot crop the foreground. Prior color, blur, and transparent operations retain exact existing engine pixels.
- Shared four-asset quota across photo background, collage, image overlay, and redo history.
- Actual production PNG export, undo/redo, original source byte preservation, and a portable backup restored into a fresh editor session with redo intact.
- Actual PNG/JPEG/WebP decoding, 1600×800 to 1024×512 normalization, cancelled and stale picker/decode results, Back cancellation, failed and successful main-photo replacement, source-revision rejection, and preview zoom isolation.

## Confirmed defect and resolution

The initial candidate loaded `photo-background.js` before its mandatory `image-overlay.js` dependency, both in production HTML and the native test harness. It threw at script initialization and blocked image backgrounds. The implementation owner corrected the load order. The final independent suite includes a production-HTML ordering regression and all editor paths pass.

## B02 + B03 combined evidence

`b02-b03-refined-comparison-zh.png` compares the same authored background with:

1. Archived host confidence, fill mode.
2. The archived v28 two-erase-stroke recipe, fill mode.
3. That same saved refinement, fit mode with an explicit backdrop.

Full-resolution outputs are `b02-b03-coarse-fill.png`, `b02-b03-refined-fill.png`, and `b02-b03-refined-fit.png`. The contact sheet also shows the same right-shoulder crop for all three. These are actual production PNGs, not recreated presentation approximations.

The archived two strokes change 13,625 mask pixels. Across all three variants, 642,857 pixels selected by refined confidence exactly 1 and original alpha 255 have **maximum RGBA difference 0** versus the original. The face-interior selection contains 80,828 such pixels, and the torso-interior selection 104,700; each also has difference 0. The original NASA JPEG bytes and SHA-256 remain unchanged. See `b02-b03-refined-metrics.json` for precise ROI bounds and hashes.

## Scope limits

Real native Skia Canvas, image decoding, and PNG encoding were used. DOM, storage, picker, bridge, and file sink are injected. This is **not** evidence from Android WebView, Storage Access Framework, browser IndexedDB, an emulator, a phone, real touch, device memory/performance, or Android model inference. The public image and CPU-host mask were reused from existing fixtures; there was no new inference. Saved manual corrections do not imply hair-level recovery or removal of all original-background color contamination.

Core fingerprint: `ed2f0a327d47540a38eb51fdf7f8a681813e0916a01cfe098715aa5cecd03ef0`.

Reproduce from the Android project root:

    node --test tests/audit/photo-background/independent.test.cjs
