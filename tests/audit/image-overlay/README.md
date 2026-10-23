# Portable independent image-overlay audit

Final result: **38/38 independent checks passed** against the 65 production files pinned in PRODUCTION_SHA256SUMS. No production files were changed by this audit or by its portable rerun.

## Placement and command

Place this directory at `tests/audit/image-overlay` inside the photo-editor source tree. The default source root resolves three parent directories above this directory. The harness and native-Canvas adapter are bundled; no external candidate directory, earlier quality folder, browser, package installation, download, private photo, signing key, or API/model permission is used at runtime.

With the two development dependencies already available, run from this directory:

```
npm test
```

Or, without npm:

```
node --test independent-core-import.cjs import-format-boundaries.test.cjs editor-independent.test.cjs operation-project.test.cjs
```

To run from a separate audit directory, explicitly select the source root:

```
MINT_SOURCE_ROOT=/path/to/photo-editor node --test independent-core-import.cjs import-format-boundaries.test.cjs editor-independent.test.cjs operation-project.test.cjs
```

Use NODE_PATH only if dependencies are installed outside normal Node resolution. Tested runtime versions are pinned in package.json and recorded in runtime-versions.json: Node 24.19.0, @napi-rs/canvas 0.1.100 and sharp 0.35.5. No dependency install was performed for this audit.

Results and synthetic output images are written only to `results/`, or to the directory specified by MINT_AUDIT_OUTPUT. The audit reads production assets but never writes them. The four files in `fixtures/` are synthetic PNG, JPEG, WebP, and an EXIF-orientation 6 progressive JPEG. No personal or demo photography is included.

From the source root, verify the audited production bytes with:

```
sha256sum -c tests/audit/image-overlay/PRODUCTION_SHA256SUMS
```

From this audit directory, verify this handoff's files with `sha256sum -c PACKAGE_SHA256SUMS`. Rerunning tests naturally updates results/ and its recorded hashes.

## Findings closed

1. A pending image import canceled by blur originally left the pick/file controls disabled. Production now refreshes controls. The integrated regression confirms late completion is ignored and a new import succeeds.
2. The original JPEG header parser accepted a real 1,969-byte synthetic JPEG truncated to 985 bytes. Production now scans through EOI and rejects byte truncations and trailing data before object-URL creation or decode. Real progressive JPEG and EXIF rotation remain valid.

No remaining concrete blocker was found in this audit's scope.

## Coverage

- 14 pure/compositor/import checks: independent 1,000-case Porter-Duff oracle, exact cardinal/flipped geometry, edge coverage, premultiplied alpha minification, maximum 1024×1024 embedded asset, cancellation/source immutability, real PNG/JPEG/WebP native decode comparisons, actual 8MP→1024×512 downscale, cleanup and malformed input rejection.
- 7 format-boundary checks: every wrong MIME/magic pairing, JPEG/VP8/VP8L dimension and length limits, animated WebP rejection, progressive oriented JPEG, 12MiB file limit, 4096-edge/7,999,488-pixel boundary and patched JPEG termination validation.
- 13 complete-editor checks: single-composition add/replace pixel oracle, hide/Undo/redo, ordered crop/rotation/padding coordinates, actual editor pointer handlers with modeled 2.5× zoom, pinch cancellation, stale controls/blur callbacks, pending-import source swaps, source Blob identity, persistence and real PNG export, export-blocking during import, repeated opacity-zero previews and allocation-failure/retry atomicity.
- 4 operation/project checks: strict data schema, retained-asset cap, latest-only replacement, every raw Undo/redo split, malformed future history/URI rejection and ordered geometry planning.

## Evidence and limits

`results/independent-results.tap` is the final portable rerun. `results/core-import-evidence.json` records synthetic codec/pixel evidence. Native PNG outputs include integrated-replaced.png, integrated-export.png and minified-alpha.png. `portable-manifest.json` pins all handoff files and the production-list hash.

Production JavaScript executes unchanged except a read-only state probe used by the test harness. Pixel operations and PNG/JPEG/WebP codecs use installed native Skia; DOM, storage, timers, file-picker completion and CSS bounding rectangles are modeled. This is not Android device or WebView QA, not a timing/latency guarantee and not a cross-backend bit-equivalence claim. Chromium verification was attempted but did not execute because browser/environment startup was blocked; it is counted as **not run**, not passed. No further browser or permission attempt was made.
