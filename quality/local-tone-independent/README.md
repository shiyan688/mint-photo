# Independent mobile local-tone audit

40 independent pure-pixel/security/controlled-editor tests and 8 real native Skia Canvas replay tests pass at the source hashes recorded in `audit.json`. The auditor did not change production code. Full reproducible logs are `workflows.tap` and `pixels.tap`.

The checks cover strict source-bound layer validation, actual weighted local color, protected and transparent pixels, explicit empty selections, selection re-rasterization at export size, immutable originals, current-batch layer management, interrupted gestures, grouped history, geometry/preset/manual replay, restored drafts and failure recovery.

Two integration issues were identified and addressed by the production owners: passing native ImageData to the strict plain-object adapter, and initializing pointer source identity before the editor incremented its revision. Final behavioral and real-pixel tests pass after both changes.

This is not browser, WebView, Android emulator, physical handset, native gallery/SAF, real-device memory or perceptual/model-quality validation. No dependency was installed or downloaded; no signing or APK installation occurred. Cancellation is checked synchronously at layer boundaries, not inside the unchanged shared pixel loop. Older committed groups remain ordered history and are not freely editable as earlier individual layers.

Native Canvas loses hidden RGB through premultiplied storage, so raw core RGBA tests separately verify hidden-color preservation. Original PNG Blob bytes are verified unchanged.

Run from the project directory:

- `node --test tests/local-tone-independent.test.cjs`
- `NODE_PATH=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules node --test tests/native-canvas/local-tone-pixels-independent.test.cjs`
