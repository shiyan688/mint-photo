# Independent local-photo-background audit

Run from the Android project root:

    node --test tests/audit/photo-background/independent.test.cjs

Requires only the already installed Node runtime and `@napi-rs/canvas`; no downloads or extra dependencies are installed.

The audit calls the unchanged production photo-background compositor, background-refine adapter, editor event handlers, local still-image importer, project core and backup codec. The mathematical oracle in `oracle.cjs` does not call production blending or placement helpers.

Coverage includes strict schema and embedded asset provenance; continuous source alpha times confidence; linear-light premultiplied source-over; fit/fill and alignment; fractional margins; minification conservation; alpha fringes; source/caller Canvas immutability; resource and shared-history quotas; source revision and viewport isolation; real PNG/JPEG/WebP decode; cancel/back/stale picker/decode/main-source replacement; undo/redo; full-size PNG; and a portable project backup restored into a fresh session.

Evidence and per-run production SHA-256 hashes are written only to `quality/photo-background-independent/`. The public-photo comparison reuses the existing NASA fixture and its archived CPU-host confidence mask. It does not run a new model or claim hair-level recovery.

Important limitations: Native Skia Canvas and PNG are real, but DOM, IndexedDB, Android bridge and file chooser/sink are injected. This is not Chromium/Android WebView, Storage Access Framework, browser IndexedDB, a real phone, real touch, inference parity, memory profiling, or device performance evidence.
