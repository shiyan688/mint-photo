# Independent image-overlay audit

Result: 38/38 independent tests passed against the SHA-pinned production files in audit-manifest.json. No production files were changed by this auditor.

## Findings and resolution

1. Pending import → blur originally cleared loading but left controls disabled. Reported before final integration. Production now refreshes controls; direct repro and integrated regression pass, including a subsequent import.
2. Original JPEG parser stopped at the first SOS. A real 1,969-byte JPEG truncated to 985 bytes imported as a damaged 47×31 asset. Production now scans to EOI and rejects truncation and trailing bytes before decoder allocation. Real progressive/oriented JPEG remains supported.

The accepted-truncated PNGs and repro-truncated-jpeg-result.txt preserve historical pre-fix evidence. The old reproduction script now rejects, as intended. They are not current failures.

## Independent coverage

- 14 compositor/import tests: separate 1,000-case scalar Porter-Duff oracle, exact cardinal transforms/flips, edge coverage, transparent-color minification, maximum 1024×1024 raw asset, cancellation and source immutability, actual encoded PNG/JPEG/WebP compared with independent native decode, actual 8MP→1024×512 normalization, cleanup and hostile inputs.
- 7 additional format tests: six MIME/magic mismatch combinations, JPEG/VP8/VP8L dimension and length limits, animated WebP rejection, real progressive JPEG with EXIF rotation, 12MiB and 4096-edge boundary, patched JPEG termination validation.
- 13 full-editor cases: add/replace single-pass pixel oracle; hide/Undo/redo; crop/rotation/padding coordinates; actual pointer handlers under modeled 2.5× zoom and pinch cancellation; pending import cancellation and source swaps; stale controls/blur callbacks; stored history/source identity; real PNG export; export blocking during import; opacity-zero repeated previews; failed replay and retry atomicity.
- 4 project/operation cases: strict data schema, retained asset cap, latest-only replacement, every Undo/redo split, original Blob identity, malformed future history/URI rejection and ordered geometry planning.

## Reproduce

NODE_PATH=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules node --test independent-core-import.cjs import-format-boundaries.test.cjs editor-independent.test.cjs operation-project.test.cjs

Run from this audit directory. The final combined result is all-independent-results.tap. Test harness files are isolated here; production JavaScript is loaded unchanged except a read-only state probe used by the established editor harness. Canvas rasterization/encoding uses installed @napi-rs/canvas, not a replacement production renderer. File-picker/storage/DOM behavior is modeled.

## Limits

No Android device, WebView, APK, or performance claim is made. An additional Chromium check could not execute: restricted socket creation, followed by a failed approved-mode environment setup. No denied path was read and no sandbox settings were changed. No package install, network use, private photo, signing key, model/API permission, or production edit was used.
