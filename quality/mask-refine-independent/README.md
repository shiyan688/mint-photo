# Independent continuous-mask audit

## Result

26 independent checks pass on the reviewed production scripts. The suite found one real saved-edit integrity defect, which the implementation owner fixed and the same audit verified. No production files were edited by this audit.

The defect was a fail-open dispatch path: if `PortraitUI` was unavailable, the editor silently treated a saved `background-refine` operation as unknown and returned the unedited canvas. The fix routes the operation directly through `MintBackgroundRefineOperation`, independently of UI availability. A missing operation core throws; a missing UI alone no longer discards the edit. The defect required the missing-module condition; it was not observed on the intact normal path.

Pre-fix result and exact production hashes are retained in:
- `pre-fix-missing-ui-output.txt`
- `pre-fix-test-results.json`

Final results and exact production hashes are in `test-results.json`; the full test log is `test-output.txt`.

## Checked

- All 256 base confidence codes survive a native PNG-compatible alpha path without thresholding.
- Color replacement composites continuous alpha in linear light, including partially transparent source pixels; transparent mode multiplies existing alpha and cannot create opacity.
- Sparse and dense sampling of identical polyline geometry yields identical canonical recipes, plans and Float32 output. Reversing or retracing a path does not accumulate opacity within one stroke. Separate keep/erase strokes preserve their order and do accumulate as designed.
- An independently written, all-pixels/all-segments analytic capsule-distance oracle covers 29,041 pixels. It does not use production scanline bounds, planning or rasterization to compute expected coverage.
- 96 combinations cover minimum/maximum radius, soft/hard brushes, positive/negative/no edge shift, maximum/no feather, corners, crossings, one-pixel dimensions and extreme aspect ratios. Every output is finite and bounded. Actual diagnostic work does not exceed the preflight estimate.
- Signed morphology is pointwise monotone; fractional feather preserves constant confidence fields. Zero-strength commands preserve the baseline bit-for-bit.
- Pixel/edge/work failures happen before reading the input canvas or allocating an output canvas. Aggregate export budgets account for repeated refinements and ordered intermediate crop/rotate dimensions. The cancellation callback aborts before any composite input read or output allocation.
- Output allocation failure leaves the source unchanged and releases only the newly allocated failed output.
- The full editor performs original-size replay: an actual 1800×1200 PNG is generated from a 900×600 working preview. The serialized normalized stroke recipe is rerasterized at each resolution. Every exported alpha pixel matches the original-resolution continuous field. The saved file is `normalized-original-export.png`.
- Crop and rotation before the mask operation change its local dimensions correctly; coordinates are interpreted in that operation's coordinate system, not the untransformed source dimensions.
- Green mask visualization is an inspection overlay only. It does not alter the displayed pre-step source pixels, the committed image, or the actual encoded export.
- Recipe JSON round-trip, manual undo/redo, canceled strokes, zero-strength gestures, manual fallback during detection, Cancel/replaced controls, reversed callback order and timeout all preserve the appropriate draft. Stale native results cannot install a mask in the replacement draft. These tests validate callback ownership, not cancellation of native inference itself.
- Legacy `background` recipes preserve their former encoded-space blend; their dispatch/schema is not silently migrated to the new continuous-alpha linear-light mode.
- Missing mask/operation/composition modules fail closed; missing portrait UI cannot silently drop the saved new operation.

## Reproduce

From the project root:

```sh
NODE_PATH=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules \
  node --test tests/audit/mask-refine/independent.test.cjs
```

The audit uses the existing complete editor harness and existing installed `@napi-rs/canvas`. No dependencies, network services, uploads, keys or permissions were added.

## Boundaries

This is production JavaScript state/replay QA plus native Skia pixel/encoding QA. The DOM, native model callback, decoder dispatch, storage and save bridge are controlled test infrastructure. There was no browser, Android WebView, emulator, device, accessibility, touch ergonomics or real model inference validation. The generated PNG is synthetic engineering evidence, not a real-portrait quality evaluation. Desktop process durations and accounting units are not mobile performance or actual peak-memory measurements. No claim of learned hair reconstruction, decontamination or new model capability is supported or intended.
