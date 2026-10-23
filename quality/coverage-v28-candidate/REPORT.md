# v28 candidate audit of Android photo editor v27

Scope: bounded source audit, not a new release or whole-product acceptance. All 103 baseline IDs are retained in `coverage-103-v28-candidate.json`; non-reviewed rows remain explicitly unreviewed. Production files were not edited, no software installed, no browser security bypass attempted, no signing key created, no private photo uploaded.

## Key correction

**Person/background alpha already has a real local keep/erase brush.** `portrait-ui.js:67–76,92–101` includes painted confidence updates, mask view, ten-snapshot undo, interpolation, cancellation rollback and render application. This is not merely the manual-retouch selection or a beauty ellipse. Local tone/dodge-burn equivalent is also already present: radial/linear/brush/lasso selection, additive/subtractive selection, positive/negative exposure, opacity and undo (`local-tone-ui.js:141–157`). Do not duplicate either feature under a new label.

## Top three next A candidates

### 1. Precise, replayable alpha-mask refinement (B02; partly B01)

Highest priority because there is both a feature gap and a reproduced correctness defect.

- Native person confidence is capped at 256 pixels on the longest side and quantized to bytes (`PortraitAnalyzer.java:174–193`). Manual masks also start with longest side 256 (`portrait-ui.js:71`).
- `brushMask` destructively paints those bytes, with fixed falloff and radius-only controls (`:68–75,92`). There are no normalized stroke recipes, strength/hardness controls, explicit edge contraction/expansion, or fringe-color decontamination. The saved project still has only a raster mask (`project-core.js:108–116,246–251`).
- `move` caps interpolation at 40 dabs per event (`portrait-ui.js:95`). Executing the actual production gesture methods in a controlled Node VM reproduced different alpha for the same straight path. At 1% radius, one long diagonal move left **58/200 interior centerline samples alpha zero** (74 under half alpha). With 400 events, all 200 samples were fully retained. 982 mask pixels differed, max alpha difference 255. See `mask-path-results.json` and `mask-path-audit.cjs`. This proves an algorithmic event-density issue, not how often a physical handset emits events.
- Recommended increment: immutable base alpha plus source-bound normalized correction strokes; continuous path sampling independent of event density; original-scale replay; strength/hardness; bounded alpha edge shift. Preserve old raster projects. Test cancellation, undo, crop/rotate ordering, preview/export parity and budget rejection.
- This does **not** recover missing true hair detail from a coarse segmentation model. Feathering is not learned matting. B01 remains incomplete.

### 2. Complete classical liquify modes (T04; partial S03)

- Only `push` and `restore` are valid commands (`manual-tools.js:107–126`), and only those are in the UI (`manual-retouch-ui.js:19–21,35`). Smooth, twirl, pinch and bloat are absent.
- Existing selection snapshots already constrain displacement. Existing push uses fixed arc-length resampling and anti-fold bounds (`manual-tools.js:270–295,327–420`). Do not claim there is currently no protection or no safety guard.
- Add bounded deformation modes while preserving those invariants. A separate reusable freeze/unfreeze mask would improve workflow, but a mere renamed inverted selection is not the full missing feature.
- Current transparent-source liquify rejection is intentional (`manual-retouch-ui.js:12,20`); do not remove it without a correct alpha-warp implementation and tests.

### 3. Imported-photo background compositing (B03)

- Engine and project schema only accept color, blur and transparent (`portrait-engine.js:519`; `project-core.js:248`). No imported-background asset or fit/crop/position state exists there.
- General image overlay is foreground source-over (`image-overlay.js:374–385`), not an imported photo behind the person alpha. It does not close B03.
- Reuse the existing local import/asset infrastructure, composite beneath the foreground, persist placement/asset in project backup, and verify export/cancel/source preservation. No new model/API is required for this bounded compositor.

Additional A gap: user-painted protection/erase-back for per-person beauty (R11). The strict face schema allows only `id`, `landmarks`, `beauty`, `reshape`, with no user correction mask (`portrait-people.js:53–65`). Landmark/neighbor protection is not a user-painted override. This can follow the mask foundation, rather than duplicating manual-repair or tone selection.

## B: model and authorization boundary

Only `face_landmarker.task` and `selfie_segmenter.tflite` are bundled. Skin masks combine landmark polygons with color/luminance heuristics (`portrait-engine.js:195–237`); the capability declaration explicitly says classical, non-learned retouch (`:549`). There is no learned hair-matting, full body/garment/teeth parsing, blemish classifier, generative reconstruction or true super-resolution path.

Better automatic hair alpha (B01), reliable semantic part control (C09), learned blemish preservation (R02/R11), and reconstruction/super-resolution (G09/G10) require a chosen, provenance/license-reviewed and technically compatible model/runtime, or an authorized service. Paid SDK/API use, credentials and private-photo upload each require their own applicable authorization. Manual eye/teeth color controls are still possible in A; do not overstate that every such control inherently needs a new model. Neither adding a model nor evaluating one public portrait establishes SOTA/parity.

## C: runtime and install validation boundary

Current v27 records unsigned builds and controlled code/Canvas/DOM validation, not current signed installation or current browser/WebView/device acceptance (`docs/CLOUD-VALIDATION-2026-10-22.json`; `docs/VALIDATION.md:1–10`). `tests/run-pure.sh:2` explicitly excludes the real-browser editor test.

Sandboxed Chromium was previously documented as failing before page load with a Unix socket permission error (`docs/VALIDATION.md:108–109`). Parent reports the no-sandbox route was denied; this audit did not retry either route. A functioning permitted browser is needed for actual layout/touch/pointer capture/import/export tests. NativeCanvas and controlled DOM are not substitute proof. Earlier signed-emulator bridge smoke belongs only to its earlier artifact.

Still needed: authorized signing with upgrade identity preserved, current-build WebView/device install, actual SAF save/reopen/cancel, multitouch interaction, supported WebView compatibility, process-death recovery and measured memory/latency. No new signing key is authorized by this audit.

## Reproduce the bounded alpha probe

From the project root: `node quality/coverage-v28-candidate/mask-path-audit.cjs`. It reads production `portrait-ui.js` and calls its exposed gesture methods in a Node VM with minimal DOM/adapter stubs. It only writes the audit JSON. Source SHA-256 is recorded so a future production fix is distinguishable from the audited v27 result.

## v28 implementation result after the read-only audit

B02 has now been upgraded with continuous, normalized output-resolution strokes, hardness/strength, signed edge shift, feather, immutable base, cancel/undo and real editor/backup/PNG tests. The original `mask-path-results.json` is the **v27 baseline** (its source SHA is recorded), not a claim that the new user entry still uses that event-dependent algorithm. Legacy background recipes retain their old meaning; new background editing dispatches to `background-refine`.

Still partial, not full acceptance: no new learned matting model, hair recovery or foreground decontamination; no actual WebView layout/device/storage verification. All 103 work-package acceptance flags remain false where broader end-to-end acceptance was not established. Remaining bounded existing-rights candidates are T04 additional manual liquify modes and B03 direct local-image background replacement; model/SOTA quality and actual signed device validation remain distinct blockers. See `docs/MASK-REFINE.zh-CN.md` and `quality/mask-refine-independent/README.md`.
