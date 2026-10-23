# Independent collage integration audit

Date: 2026-10-22 UTC. Final result: **23 tests passed, 0 failed**.
One non-destructive P2 interaction defect was found and independently verified fixed. No open production defect was reproduced in this bounded audit.

## Scope and limits

The shipped JavaScript executes unchanged through the existing `quality/paint-layer-evidence/editor-harness.cjs`, with real installed `@napi-rs/canvas` 0.1.100 pixels/decoders/PNG and JPEG encoders. The DOM, file-picker callbacks, main-image decode scheduling, IndexedDB and Android save bridge are controlled test infrastructure. Separate cases invoke the production image importer with real native decoder callbacks, not a mocked import result. No browser was used or configured. No dependencies, models, permissions, signing or production files were changed by this auditor.

This is **Native Canvas + controlled-DOM evidence**, not Android handset, Android WebView, browser, touchscreen, system picker, system save/storage, Android codec, model quality, face detection, or device-memory certification. Inputs and saved output images are synthetic colors, alpha patterns, gradients and checkers. There are no private photos. Resampling equivalence is asserted within this installed backend, not across Canvas implementations.

`support.cjs` reuses the pre-existing native Canvas adapter. That adapter unwraps native image/canvas objects and resets the transform around putImageData to isolate a documented difference in this installed Canvas package. It does not replace collage rendering or project logic. Interactive imports in the complete-editor harness use parser-checked real encoded bytes and separately native-decoded image content; an additional direct-import case executes asynchronous native decoding inside the production importer itself.

## Reproduction

Place this directory at `quality/collage-independent` in the project and use the already-installed Node/native Canvas environment:

    node --test quality/collage-independent/native-replay.test.cjs
    sha256sum -c quality/collage-independent/PRODUCTION_SHA256SUMS

The support file resolves the project relative to its own directory. For an audit copy outside the project, an optional `MINT_MOBILE_ROOT` environment variable can select the project. No workspace path is hard-coded.

Tests regenerate the synthetic evidence images and full-versus-working hash record in this directory. `native-results.tap` is the captured final run under Node v24.19.0. The production checksums cover the shipped JavaScript and HTML at the time of that final run.

## Strong evidence

- All 2/3/4-cell horizontal, vertical and grid templates produce the expected independent center colors and transparent outer gutters. Three-cell grid has the full-height left cell and two filled right cells.
- Real pixels verify fit letterboxing, fill focus endpoints, background opacity and source alpha compositing.
- A 2048×1280 authored output remains full-size without an explicit preview cap; a 900 cap produces 900×563 and never mutates the recipe.
- Full-editor PNG and JPEG exports decode to the declared **1536×1024** while the committed preview is **900×600**. PNG preserves transparent corners; JPEG has a white opaque corner.
- A **4000×1000 high-frequency source** produces a full original-source PNG whose decoded pixels exactly equal direct full-source collage replay. Explicit working mode exactly equals replay from the 2560-pixel working source and has a distinct pixel hash. Both outputs remain 1536×1024. This rules out silent preview upscaling on the tested path.
- Geometry, overlay and manual operations before collage are included in the first cell. Real manual clone and liquify operations on both sides of collage remain order-sensitive; undo/redo, source Blob identity, original file bytes and draft restoration preserve the tested history.
- Production imports accept actual PNG/JPEG/WebP bytes and preserve their independently decoded RGBA content. A 1800×1200 source becomes a 1024×683 embedded copy. The operation stores only bounded RGBA asset data, not file names, paths or URLs. A forged MIME is rejected before decoder use.
- Invalid operation JSON, missing fields/assets/core, invalid dimensions and unsupported URI-style assets fail closed. Full authored output and source budgets are checked before a tiny preview. Source/intermediate and cumulative full-replay processing limits cannot be bypassed by a later small collage or a **64-pixel final-export request**. The latter is refused before decode/encoding begins.
- The four-external-asset history budget is shared by collage, overlays and redo history.
- Cancellation at every reachable renderer checkpoint and injected allocation failure retain input pixels and dispose owned temporary surfaces. Failed Apply retains source, raw history, redo, draft and revision.
- Local import has an enabled visible Cancel control, does not activate global busy, and cannot revive after Back/cancel. Failed main replacement restores controls without reviving stale cell decoder, picker or an older main-source decode. Second touch, pointer cancellation, lost capture and blur do not select/commit the pending cell interaction.

## Closed finding: P2 Export modal during local import

Before the fix, `openExport()` checked image-overlay loading but not collage loading. Reproduction:

1. Start a new incomplete collage.
2. Start a deferred secondary-image import.
3. Click Export before the import resolves.

Observed before fix: `CollageUI.isLoading() === true` and `exportDialog.open === true`. The modal could cover the local Cancel control. Direct Save correctly refused and created no output, so this was a recoverable interaction gap, not data loss or a save bypass.

The integration owner added the collage-loading guard at the start of `openExport()`. The final independent regression verifies Export does not open the modal, direct Save creates no output, cancellation resolves the old import as inactive, and no history/source mutation occurs. Status: **closed**.

Before-fix editor SHA-256: `11530607090f7dc4ae66be0ee07cb17931d186d55486fa2cd24cdf5b88f72772`.
After-fix editor SHA-256: `75499b043aa9b2ee3facdb006ec294a67746c86cf9f454e019d89d8eb0ebb723`.
Core SHA-256: `27498c9b1d10340df05d0d569129a7e4fa50ef2238f305406a223dab9693ff50`.

## Files

- `native-replay.test.cjs`, `support.cjs`: relocatable independent tests.
- `native-results.tap`: final 23/23 result.
- `PRODUCTION_SHA256SUMS`: relative production fingerprints.
- `full-vs-working.json`: distinct original/working decoded-pixel hashes.
- `actual-export.png`, `actual-export.jpg`: actual 1536×1024 synthetic encoder outputs, not screenshots.
- `integrated-collage.png`: synthetic ordered-replay output.
