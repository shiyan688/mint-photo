# Independent multiline text integration audit

Recorded 2026-10-22. **16/16 plain Node + 13/13 native Canvas tests pass; 0 failures, 0 skips.** The exact source and evidence fingerprints are in `audit-manifest.json`; TAP output is preserved separately.

## Reproduce

Run from the project root:

```sh
node --test --test-reporter=tap tests/text-overlay-independent.test.cjs
NODE_PATH=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules \
  node --test --test-reporter=tap tests/native-canvas/text-overlay-pixels-independent.test.cjs
```

The native suite requires the already-installed `@napi-rs/canvas` and `/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc`. Missing requirements fail the test run, rather than silently skipping it. No package, font, image or network download is performed.

## What was exercised

- Actual `editor.js` event handlers and complete render/export pipeline, `project-core.js`, the text UI and both shared text modules.
- Commit → explicit Edit Latest → append-only replacement → exact undo/redo, including empty replacement and revival.
- Every undo split of a multi-add/multi-replacement history, with reversed redo-stack storage and exact raw-history round trips.
- Standalone, cross-ID, duplicate-ID, intervening-operation and invalid future-redo replacement rejection before installation/export.
- Raw export planning steps versus collapsed effective rendering. One effective replacement is rendered once, never over the prior paragraph.
- Geometry before/between text layers, preserved source dimensions and original Blob identity/bytes.
- Real PNG encode/decode and export dispatch, including 1200 × 900 original resolution versus the 900 × 675 preview. Export equals original-resolution replay and differs from an upscaled preview.
- Draft storage/restore retaining both raw replacement and redo; full pixel equality after restoration.
- Partial draw failures during commit, preview and export; final preview display-copy failure; rollback/recovery and no partial export dispatch.
- Stale controls/gestures, cancel/blur, failed undo retry and scratch/edit-base Canvas ownership.
- Source alpha and exact cleared RGBA at the Canvas boundary.

## Findings corrected and regression-verified

Two integration issues were reproduced and reported to the parent implementation owner, who applied the production fixes:

1. A final `previewCanvas.drawImage` failure formerly escaped `paint()`, retained the full-size temporary until garbage collection, left Apply enabled and omitted the failure notice. Both plain and native regression tests now verify guarded publication, explicit temporary release, disabled Apply, unchanged history/committed pixels and successful recovery.
2. `ProjectCore` formerly read a supplied operation's `type` getter twice before the strict text operation validator rejected it. It now obtains an own enumerable data descriptor first. The targeted type/recipe accessor regression verifies zero invocations. This is not a blanket proof that every legacy ProjectCore object boundary rejects every possible JavaScript accessor; JSON records cannot contain getters.

No unresolved P1 defect was found in the exercised scope. These tests do not establish absence of bugs outside that scope.

## Evidence and limitations

- `editor-harness.cjs` extracts only the existing `tests/export-back.test.cjs` harness construction, with asserted extraction boundaries, and loads current production scripts. The pre-existing editor state probe is extended for direct invocation of production functions. Production rendering is not replaced.
- The plain-Node suite uses controlled DOM, storage, timers, decoder/encoder and Canvas metrics. It proves state/control flow, not real pixels.
- The native suite injects actual Skia-backed canvases into that same full-editor harness. Fixtures are locally generated, PNG encode/decode is real, and pixel/hash assertions use those real native outputs. DOM events, decode dispatch, IndexedDB, timers and the Android save transport remain controlled. An accepted mock save call is not a real Android file-picker/gallery save.
- Native `putImageData` in the installed library respects the current transformation matrix, unlike browser Canvas. The explicit adapter wraps only that call with save/resetTransform/restore to match browser pixel-write semantics. No production function is patched for that library artifact.
- Generic font fallback in this installed native build omitted CJK glyphs without an explicit alias. The test process aliases the installed Noto CJK font to `sans-serif`; no production font recipe is changed. CJK glyphs in the final contact sheet were visually inspected. Cross-platform glyph/layout/pixel identity is not claimed.
- `expected()` uses the production text core on a separately copied original/preceding-stage canvas. It independently checks editor replay/history composition and no double-paint, not a second implementation of text shaping.
- There is no Chromium, Android WebView, emulator, handset, touchscreen, native file-picker, device-memory/performance or signing evidence. No private photo is used.

## Visual outputs

`contact-sheet.png` is a synthetic native-Canvas evidence sheet, **not an application screenshot**. It shows source, initial paragraph, replacement preview, replacement commit, deliberately incorrect double-paint control, and cleared replacement. Preview and replacement RGBA hashes are equal; the incorrect control differs; the cleared result matches the source exactly. The first four text panels were checked visually for CJK/Latin multiline placement, rotation, outline and shadow.

The six unannotated PNGs and `pixel-evidence.json` retain exact raw histories, recipes, dimensions and RGBA SHA-256 hashes. The intentionally wrong `doublepaint-control.png` is a negative comparison, not shipped output.
