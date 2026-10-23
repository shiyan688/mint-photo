# Independent Android named-preset audit

Completed 2026-10-22 UTC. Final result: **23/23 workflow tests and 6/6 native-Skia pixel tests pass**, after three asynchronous lifecycle defects were reported and corrected by the integrating developer. The auditor changed tests and audit reports only. The shared codec remains byte-for-byte frozen at SHA-256 `e69a72b82d6b6c5dc565b39bcb7df21bd0c5842c99735f87eae784c97c7eb84d`.

## What was independently checked

- Naming, saving, favorite persistence, renaming while retaining ID/favorite/controls, duplicate-name failure atomicity, and loading a neutral named preset.
- Escaped/nested duplicate JSON keys, exact 64KiB UTF-8 boundary with Chinese/emoji text, and all recipe allowlist levels rejecting photo/blob/path/landmark/source/mask additions.
- Newer imports superseding older reads, reset/edit/curve navigation invalidating pending reads, changing photos discarding stale imports, and current native-detector callback ownership across reset, color-only, replacement loads, repeated requests, source changes, and geometry history.
- Production editor refusal to commit a portrait preset without a current face; explicit color-only retains the requested basic color effect while removing portrait effects.
- Curve subeditor reset retains name/basic/beauty/palette; previous dedicated integration tests cover return/reopen retention.
- Full production editor routing and history for preset → manual → geometry, undo, redo, reset, and original Blob identity.
- Two-way image/preset export locking both during image encode and native callback wait; preset completion does not mark the photo saved or clear an image job; leaving the tool retains a preset export lock until its own result.
- Real RGBA replay: preset → liquify/clone → crop/quarter-turn/flip equals independently sequenced pure stages. Swapping operation order changes output. Replays, project persistence, undo/redo/reset preserve expected bytes and original PNG Blob. A second preset/manual stage after geometry is also checked.

## Defects found and rechecked

1. Reset originally did not invalidate a pending JSON FileReader. A late read silently restored imported effects after reset. The generation/serial invalidation fix is now tested.
2. Reset or explicit color-only originally accepted an earlier face callback and repopulated discarded landmarks. The callback-generation fix is now tested.
3. The first callback fix exposed a mismatch with the production detector: a stale pending PortraitUI job blocked a new load/repeated detection request, then the old result was discarded. The editor adapter now cancels that outstanding job before replacement. Both replacement-load and repeated-request newest-only tests pass.

There are no remaining failures in these bounded tests. The original/reset race cases use controlled callback scheduling; they are not claims about observed timing or touch reachability on a handset.

## Reproduce

From the Android project root:

- `node --test --test-reporter=tap tests/preset-independent.test.cjs`
- `node --test --test-reporter=tap tests/native-canvas/preset-pixels-independent.test.cjs`

The second command requires the **already installed** `@napi-rs/canvas` package. This audit used Node 24.19.0 and package 0.1.100. No dependency was downloaded or installed. It is deliberately outside the top-level dependency-free test directory.

## Evidence and limits

`workflows.tap`, `pixels.tap`, and `audit.json` contain final results and inspected-file fingerprints. The workflow tests transparently reuse only harness plumbing from `preset-ui.test.cjs` and `export-back.test.cjs`, without running those files' existing tests. The latter evaluates the complete shipped editor, adding a read-only state/handler probe; dynamic DOM support and opaque synthetic Canvas plumbing are test-only adapters.

Pixel tests extract the production editor's canvas/applyOperation/renderPipeline functions verbatim and load the shipped UI/core modules. Their reference checks separately sequence the core stages, so this is an independent routing/order/replay oracle, not a second implementation of every color algorithm. Native Skia `putImageData` is explicitly wrapped to ignore CTM, matching the earlier geometry audit's compatibility adapter. Synthetic opaque fixtures avoid hidden-RGB/premultiplication ambiguities.

These results are **not** browser layout/input, Chromium, Android WebView, emulator, handset, native system file picker/gallery, real-photo quality, model detection, or mobile memory/performance certification. Java source was inspected, but its native runtime was not executed by this audit. No signed APK, private-photo upload, model change, or security setting change was performed.
