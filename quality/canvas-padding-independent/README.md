# Independent Android canvas-padding audit

Result: **34/34 passing**: 15 pure/controlled-editor tests (including 400 independent randomized RGBA cases), plus 19 native-Canvas tests. No production files changed and no confirmed production defect found in the exercised scope.

## Reproduce

From the Android project root:

```
node --test --test-reporter=tap tests/canvas-padding-independent.test.cjs
NODE_PATH=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules node --test --test-reporter=tap tests/native-canvas/canvas-padding-independent.test.cjs
```

Reports: `pure-results.tap`, `native-results.tap`. Production hashes and exact boundaries: `audit-manifest.json`. Pixel hashes, dimensions and recipes: `pixel-evidence.json`.

## What was established

- Forward-scatter oracle, independently written without production planning/rendering calls, matches 400 asymmetric, skinny, random-color/alpha cases. Actual source bytes, including hidden RGB and all alpha values, remain exact at the integer top/left offset in pure RGBA output. Half-pixel rounding, zero identity, new-buffer non-aliasing, cancellation before/mid/after copy and input detachment are covered.
- Strict plain data, own fields, accessors rejected without execution, offset byte views, detached/shared/inexact data rejection; metadata 1,000,000-edge limits are distinct from 64 Mi-pixel/16,384 raster limits. Mobile 8,000,000-pixel/4096-edge preflight rejects before source read/Canvas allocation.
- Complete unchanged editor is exercised with **all shipped production modules together in one VM**. The harness reuses the existing text-overlay/export-back extraction, with a test-only state/action probe and controlled DOM/storage/timer/decoder/native-transport plumbing.
- Neutral controls, explicit presets, asymmetric/equal percentages, color, opacity, reset/cancel, stale revision and stale control callback protection. 80MP source metadata remains retained and supports a valid working-size result even when original-size export is prohibited. Both-budget rejection keeps the last valid recipe.
- Actual native RGBA and PNG prove no source scaling/clipping, transparent padding RGBA zero, current source-rectangle offsets, five repeated growth stages, source-file Blob retention, raw history undo/redo and persisted drafts, reset, and crop→rotate→padding→text→manual→crop replay plus text→rotate→padding ordering.
- A real 3200×1200 synthetic input exports at **3440×1440 original** versus **2752×1152 working**; preview is **968×406**, never upscaled for export or silently fitted after padding. JPEG flattening applies only at export and leaves the project RGBA unchanged.
- Allocation, createImageData and putImageData faults in commit/preview/export roll back or preserve source/history and release owned scratch. A final display-blit failure also releases the temporary preview. Deferred PNG publication is blocked when project revision changes. Invalid export history preflights before decode, encode, allocation or Android transmission. Stale portrait-detection callbacks cannot attach previous-coordinate landmarks after a committed border.

## Important limits

These are **not Android screenshots or device tests**. `contact-sheet.png` is a labeled synthetic native-Canvas contact sheet. Real PNG encodes/decodes and pixel comparisons use installed `@napi-rs/canvas`; the existing adapter explicitly resets the transform only around putImageData because this installed library diverges from browser Canvas semantics there. No production renderer is replaced.

Pure-byte tests establish exact hidden-RGB preservation. Native Canvas may discard hidden RGB or quantize colors through premultiplication during original decode/readback, before the padding module receives the pixels. Native assertions start from those decoded pixels, not unobservable original-file hidden RGB.

The 80MP scenario uses real production metadata planning with a controlled decoder; it does not allocate an 80MP native raster. No physical Android/WebView/browser execution, APK validation, SAF gallery save/reopen, offline model inference, EXIF/color-profile behavior, OS low-memory/lifecycle test, real touch gesture, screen-reader or accessibility validation was run in this audit. Parent build/device work is separate evidence.
