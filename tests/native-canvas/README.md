# Native-Canvas geometry audit

This directory is optional QA, not production code. Copy it to `tests/native-canvas/` in the Android project. It does not modify production files. Scripts accept a source-root argument, so they can also run from a separate checkout or staging directory.

## Prerequisites

- Node.js 18+ (Blob, structuredClone and node:test).
- **An already installed `@napi-rs/canvas` package**, resolvable by Node from this script directory. Both the raster audit and PNG generator use that native dependency. These scripts do not download or install anything. The independent core test needs no native dependency.
- The complete project, including `app/src/main/assets/` and `tests/gesture-lifecycle.test.cjs`. The audit reuses that test's controlled DOM harness and fails clearly if its extraction boundary changes.

## Run after copying

From the project root:

```sh
node tests/native-canvas/geometry-audit.cjs
node --test tests/native-canvas/geometry-core-independent.test.cjs
node tests/native-canvas/geometry-contact-sheet.cjs
```

The default source root is two directories above each script. Raster audit and image outputs default to `tests/native-canvas/results/`.

To inspect a different source tree from any working directory:

```sh
node /path/to/geometry-audit.cjs /path/to/android-project /path/to/results
GEOMETRY_SOURCE_ROOT=/path/to/android-project node --test /path/to/geometry-core-independent.test.cjs
node /path/to/geometry-contact-sheet.cjs /path/to/android-project /path/to/results
```

`geometry-audit.cjs` exits nonzero for failed assertions and writes `audit-results.json`, with exact inspected source hashes. Each run reads the current production files. The core tests use an independent forward-scatter reference and a deterministic random seed.

## Important scope and adapter details

- Pixel checks use installed native Skia, **not Chromium, Android WebView, an emulator or a handset**. UI lifecycle checks use shipped handlers in the existing controlled DOM and fake Canvas harness, not actual input or layout.
- The installed `@napi-rs/canvas` exhibited non-browser behavior: `putImageData` respected the current transform matrix (CTM). The raster audit's `specCanvas` adapter wraps **only** this call with `save()`, `resetTransform()`, `putImageData()`, `restore()`. Browser Canvas defines that pixel write independently of the CTM. This explicit compatibility correction belongs to the test adapter; no production function is patched.
- The contact-sheet generator uses identity CTMs for its pixel writes, so it needs no such correction. It draws a synthetic labeled input, passes its RGBA to the actual shared core, then encodes those actual result pixels. It does not recreate the output using Canvas rotation or reflection.
- The PNG is **not an application screenshot or a photograph**. The rotate, horizontal-flip and vertical-flip columns each start from the same crop. Labels turn/mirror with the image, intentionally. All panels are 1:1 pixels. Separate unannotated result PNGs and a hash/recipe manifest are included.
- No model, Android export encoder/gallery, device memory/performance or touchscreen behavior is covered.

## Recorded verification

Fresh run on 2026-10-22 using Node.js v24.19.0 and the preinstalled `@napi-rs/canvas` 0.1.100, against geometry SHA-256:

`c8a0dc83278229ed9b07978801afe3a1a835eb505415ffc91e937a51d77590ba`

- Raster/lifecycle audit: **14/14 passed**.
- Pure independent geometry: **10/10 passed**, including 600 seeded random transformations, exact RGBA, boundary rounding, maps/inverse maps, cancellation, budgets, malformed buffers and inherited-getter regression.
- Synthetic PNG contact sheet generated and visually inspected for crop membership, clockwise direction, horizontal/vertical direction and rotated/mirrored labels.

`results/audit-results.json` is the authoritative per-run result and inspected-source fingerprint. `results-core.tap` and `results-audit.log` are the captured output from this delivery.
