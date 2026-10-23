# Independent per-person beauty-protection audit

Final checked: 2026-10-22 21:11 UTC. Production files were read but not edited by this auditor. Test and evidence files are confined to `tests/beauty-protection-independent.test.cjs` and this directory.

## Result

48 bounded checks pass: 26 core/adapter/history checks, 15 controlled-DOM UI checks, and 7 real backup-codec/JVM boundary checks. No confirmed production defect remains open within this tested scope. This is not a whole-app, aesthetic-quality, Android, WebView, or real-device acceptance conclusion.

The final work-accounting revision was retested. The core now itemizes raster, planner traversal, validation, copy, merge and schema costs. The mobile adapter includes the additional protection preflight performed before `core.apply`. Earlier temporary work multipliers are not the final tested contract.

## Strong crossing-mask counterexamples

The inputs are existing synthetic QA composites made from public NASA adult portraits, not actual group photographs. No new photograph, download, model, inference, paid API, signing key, or browser/security change was introduced.

Both faces are active in the two-face case. A horizontal protection stroke physically crosses both candidate delta regions, but only face 1 is allowed to blend against its source:

- 30,339 selected-face pixels are attenuated.
- All 49,749 changed candidate pixels of the unselected face remain byte-exactly the full candidate, including 27,264 pixels touched by the crossing mask.
- 26,435 selected-face mask-zero pixels equal the before-current-beauty source exactly; 20,431 mask-one pixels equal the candidate exactly; 5,887 changed pixels have intermediate mask values.
- An independently written all-pixel capsule/feather reference and RGB interpolation match the production result with maximum error 0 bytes.

In the five-face case, 12,896 selected-face pixels are attenuated, all 91,955 nonselected candidate-delta pixels remain exact, and the raw mask crosses 15,719 of those pixels. The independent reference again has maximum error 0 bytes. Mask placement differs because the selected detected face is in the lower row.

`two-face-crossing-evidence.png` was generated with the installed native Canvas and visually inspected. Its raw mask panel deliberately shows the cross-person brush. `results.json` contains the numerical proof; the montage is not a substitute for pixel assertions. `source-2-adults.png` is a byte-for-byte copy of the already-present public fixture for self-contained backup replay.

## Other verified boundaries

- Frozen `portrait-people.js` and `portrait-engine.js` hashes remain unchanged.
- Legacy/no-mask, zero-strength and keep-only paths preserve full candidate bytes. Uniform 0/1 mask oracles verify explicit endpoints, including partial alpha and hidden RGB.
- Alpha or hidden-RGB changes in the candidate reject before blending. Candidate writes outside frozen domains reject. No change is created where source and candidate were already equal.
- Source revision, batch ID, detector/model, detection dimensions, face order, and each edited face's exact xyz values and z presence are bound. Parameter changes remain valid. Only edited faces carry landmark snapshots; this is not a full-batch geometry fingerprint or identity tracking.
- Invalid records, accessors, prototypes, symbols, sparse arrays, raw point/stroke limits, native typed-array metadata shadows, shared buffers, spoofed backing-store prototypes and resizable buffers fail closed in tested cases. Accessors are not executed.
- Cancellation at entry, validation, mask generation and merge returns no partial output and mutates neither source nor candidate nor recipe.
- Maximum hardness .8 still has positive required feather and 14 intermediate sampled values; largest adjacent weight change in the tested profile is 0.122941, not a binary edge.
- At 1057×731, one mask charges 3,090,668 detached output bytes plus 6,181,337 full-resolution mask/scratch/base bytes. Two masks charge 15,453,342 total extra bytes. No 1024-grid mask downsampling is substituted. Exact budget thresholds reject before rasterization.
- The adapter preserves the input immediately before this beauty step, not the original photograph or an earlier geometry state. Whole-history cumulative work rejects the first over-budget step.
- UI tests cover explicit numbered selection, stroke ownership across another face, duplicate finish, second pointer cancellation, stale canvas/revision/geometry, mode/control/detection/manual changes, separate mask undo/redo, per-face clear/feather, parameter resets that preserve masks, zero-strength no-op, redetection staging/clearing, and stale confirmations.
- The actual `PortraitUI` wrapper regards mask-only drafts as changed and requires confirmation before discarding them for manual tools. A stale manual-switch confirmation cannot discard a newer draft.
- Real project backup encoding/decoding preserves source PNG bytes, version-2 masks, geometry, and redo. Five malformed recipe variants are rejected by JS. The native reader deliberately accepts their structurally valid bounded envelopes and delegates operation-specific validation to JS; this is not a claim that Java validates protection semantics.

## Reproduce

From the Android tree:

- `node tests/beauty-protection-independent.test.cjs`
- `node quality/beauty-protection-independent/ui-audit.cjs`
- `node quality/beauty-protection-independent/backup-audit.cjs`
- `NODE_PATH=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules node quality/beauty-protection-independent/render-evidence.cjs`

The backup check compiles production Java in a temporary directory using the installed JDK compiler and removes that directory afterward. The visual rendering command uses already-installed `@napi-rs/canvas`.

Exact tested source hashes are in `final-source-hashes.json`; detailed results are in `results.json`, `ui-results.json`, `backup-results.json`, and `visual-evidence.json`.

## Limits

The core and UI tests are host CPU and controlled DOM/VM checks. The native test is ordinary JVM execution, not Android SAF, Activity lifecycle, native model execution, or ARM behavior. No browser/device performance, peak RSS, aesthetic result, group-photo detection recall, or physical touch timing was established. Resource numbers are conservative scheduling/allocation policy, not measured mobile memory. Source, candidate, Canvas/native/GPU/history storage and VM overhead are explicitly outside the core's extra-buffer figure. Opaque revision tokens bind caller context but are not pixel-content hashes.
