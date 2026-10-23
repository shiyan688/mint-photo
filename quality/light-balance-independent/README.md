# Independent mobile light-balance / portable v3 audit

This directory contains audit code, numeric reports, and a portable recipe only. No original/cropped photograph, RGBA payload, or full-size exported PNG is bundled. Production code is not patched by the audit.

## Run

From the Android project root, using the already-installed native Canvas package:

    node quality/light-balance-independent/run-audit.cjs final

This runs 32 bounded production adapter/event regressions and records source SHA-256 before and after the run. Any failure or source mutation exits nonzero. Results go under this directory's `results/`; set `MINT_AUDIT_OUT` to another existing or creatable directory if needed.

To compare the frozen public-photo fixture against desktop output, supply the external fixture basename without its `.json` / `.rgba.gz` extensions:

    MINT_FIXTURE_BASE=/absolute/path/to/05_mukai node quality/light-balance-independent/frozen-fixture-parity.cjs

The recipe defaults to the bundled `qa-five-groups.mintpreset.json`; `MINT_PRESET_FILE` may override it. The source metadata must contain dimensions and the existing 478-point target mesh. No detector, model, network request, dependency download, browser, or signing step is run.

`MINT_MOBILE_ROOT` can target another explicitly authorized checkout. By default the project root is two directories above this audit directory, so the package is relocatable with the project. `MINT_EXPECTED_RGBA_SHA` and `MINT_EXPECTED_LIGHT_SHA` may override the pinned golden values for a separately approved future fixture/core update. Do not use an override to conceal a mismatch.

Parity checks create PNG bytes in memory and decode them through installed native Canvas. No image is written by default. If explicitly desired for local QA, `MINT_WRITE_PARITY_PNG=1` writes only the processed result into the result directory. Do not include that photograph in source distributions.

## Coverage and evidence limits

- Real shipped light operation/UI, preset operation/UI, project persistence, complete editor Apply/Save events, and viewport pointer routing.
- Exact neutral identity/alpha, strict finite/range/accessor validation, allocation cleanup, failclosed missing core, original Blob/source preservation.
- Standalone and preset neutral-patch sampling from the correct pre-light stage, repeated sampling without compounding, frozen basis, pointercancel/lost-capture/blur/hidden/pinch, stale nodes/import/source revisions.
- v1/v2 → v3 migration, clearing absent light controls, commit/undo/redo/project replay, native PNG export.
- Recovery after failed main-photo decode. Two narrowly scoped neighboring overlay guards verify a late asset decoder cannot revive and an old drag cannot move a preserved overlay.
- Five active portable stages: beauty → basic → light balance → levels → curves/HSL. The frozen 897×1000 fixture checks the pure mobile adapter, separate stage chain, complete-editor full-size route, and original-size PNG export/decode against one desktop SHA-256.

This is installed native Skia with controlled DOM, decode scheduling, storage, and Android-save transport. It is not Android WebView, a handset, touchscreen, Android encoder/gallery, or broad real-device performance/color-quality certification. The helper adapts the installed library's known `putImageData` transform difference only, as documented by the existing project Canvas adapter. Transparent RGB can be normalized by native Canvas; alpha and pure-core neutral identity are checked separately.

## Final recorded result

- 32/32 bounded regressions pass against the final light core; source fingerprints remained stable during the recorded run.
- Frozen fixture: 897×1000 pixels, 478 existing target landmarks.
- Light core SHA-256: bfd8cb0be2fbdaea50ce59b5646cf6a99ae3a980fdb97cd554a901761860dac1.
- Codec SHA-256: b03d59aab2fa6b32639ceb1ddc0d22e680adde21a2834aece6cea9e79645e5d6.
- Expected desktop and all four mobile RGBA SHA-256: 63a27a4dfef6e425923241e9ac8d642b19f5100890b88cd46ace31230fde3162.

See `results/final.json`, `results/final.tap`, and `results/frozen-fixture-parity.json` for machine-readable outcome and exact inspected-source fingerprints.
