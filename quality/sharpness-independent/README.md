# Independent controlled-sharpening audit

## Result and precise scope

PASS: 19 independent tests, direct-convolution reference pixels, typed-allocation accounting, and inspection of two actual natural-photo fixtures plus synthetic blurred-edge/noise fixtures. No core correctness blocker found for the tested source. Production files were not edited by this audit.

This is a conservative handcrafted conventional sharpening tool, not deconvolution, reconstruction, denoising, missing-detail recovery or SOTA evidence. Pixel execution is the unchanged production JavaScript module in Node, with the already-installed `@napi-rs/canvas` used only for decoding/encoding and comparison sheets. It is not browser/WebView, Android device/emulator, GPU, interactive latency, subjective population-wide quality or downstream editor-history/export evidence.

Inspected core SHA-256: `44e95137e818d4157370975a795364ee6e303d719c0db4456f71d5e08bc6d707`.

## Archive distribution note

Large PNG evidence is distributed separately from the source snapshot to stay below attachment limits. The evidence ZIP includes both unprocessed resized inputs and contact sheets, but omits redundant full-frame amount25/50/100 portraits. Their exact hashes remain in `file-hashes.json`; regenerate them with the supplied generator and the previously saved public-input QA pack. The ZIP manifest explicitly lists omitted files. No portrait is bundled into the APK as a new feature/demo asset.

## First files to inspect

- `portrait-face-source-25-50-100.png`: historical NASA photograph, input 1000×1250, same crop and scaling for source / amount25 / 50 / 100; radius1, threshold3.
- `portrait-radius-threshold-sweep.png`: radius0.3 / 1 / 3 and threshold0 / 3 / 15 at amount100. These settings are intentionally not described as equally natural.
- `modern-face-source-25-50-100.png`: second modern natural photograph, input1600×2000; same source / 25 / 50 / 100 sequence, radius1/threshold3.
- `modern-equipment-source-25-50-100.png` and `modern-helmet-edge-source-25-50-100.png`: real non-skin fabric, lettering, equipment, hard edges, reflective highlights and dark boundaries.
- `modern-max-radius-zero-threshold.png`: useful counterexample for stronger texture/noise response at100/radius3/threshold0.
- `synthetic-edges-radius3-source-25-50-100.png`: controlled blurred-edge strength progression at radius3/threshold3.
- `synthetic-edges-source-25-50-100.png`: retains the default radius1/threshold3 result, including its lack of change on these particular smooth logistic edges. This is a limitation, not omitted evidence.
- `synthetic-noise-threshold-sweep.png`: noise tradeoff at amount100/radius3 with threshold0 / 3 / 15 / 30.
- Full-resolution processed PNGs, `pixel-evidence.json`, `test-results.tap`, and `file-hashes.json` accompany the sheets.

The full-sized PNGs preserve QA output resolution. Sheets may enlarge crops or reduce whole-photo views for comparison; labels identify settings. Measurements always use the underlying unscaled processed images, not contact-sheet pixels.

## Actual findings

At radius1/threshold3, increasing amount is deliberately subtle. On the historical portrait, amount100 raises mean absolute horizontal luminance gradient by1.23%; selected cheek mean luminance changes by−0.005 encoded units out of255, with high-frequency RMS+1.77%. On the modern portrait, the same amount gives whole-image gradient+2.84%, selected equipment gradient+3.67%, cheek mean−0.011/255, cheek high-frequency RMS+1.33%, and no measured change in the selected flat background. Alpha is unchanged.

Visual inspection of both actual face crops and modern non-skin edge crops found no obvious white/black halos or skin whitening for source/25/50/100 at radius1/threshold3. This is a bounded sample observation, not a guarantee for all images or settings. Texture is still present and no facial geometry or identity reconstruction occurs.

Synthetic logistic-edge peak gradient at radius3/threshold3 progresses35→36→37→39 encoded units/pixel for source→25→50→100. Its10–90% transition width narrows5.40→5.21→5.07→4.85pixels. The wider blur changes less:13.17→12.83pixels at100. No overshoot above215 or undershoot below40 was measured beyond floating-point epsilon. A separately tested already-crisp two-tone step remains unchanged. Total gradient of a monotone edge stays constant; peak gradient and transition width are the informative diagnostics here.

Counterexamples and limits:

- At radius1/threshold3, both selected smooth synthetic edges are byte-identical through amount100. Below-threshold detail and very small normalized radii can produce no visible result; amount100 does not mean every image becomes visibly sharper.
- Historical portrait radius1/threshold0 at100 raises cheek high-frequency RMS by16.5%. Radius3/threshold0 raises synthetic noise RMS by13.2%; max-strength modern-photo flat-background RMS rises9.05% and cheek RMS10.85%. Sharpening is not denoising, and max is not universally natural.
- The max-radius/zero-threshold modern-photo cheek mean increases0.294/255. This is a small local contrast bias, not evidence of literal zero change to brightness at every setting. Common linear RGB scaling and soft gamut limiting avoid adding a white component, but quantization introduces small chromaticity differences.
- No lost-detail ground truth, donor recovery objective, beauty/ethnicity inference, model comparison or reconstruction claim is used. Resizing the public inputs for QA is disclosed; these are published JPEG photographs, not camera RAW or guaranteed unprocessed originals.

## Independent math, security and resources

The separate reference implementation uses direct per-tap convolution in double precision, not the production running-sum implementation. It independently constructs three fractional-box stages per axis, alpha-normalized encoded linear luminance, soft threshold, bounded detail, local-range limiting and common linear RGB gain. All reference comparisons stay within one rounding code, with fewer than0.2% of channels differing. The kernel's per-axis variance is exactly the requested sigma² across fractional/integer transitions in the tested range. Sigma=radius×input short edge/1000, with no minimum-pixel inflation;100/1000/2000 input edges produce0.03/0.3/0.6pixel sigma for radius0.3.

Boundary coverage includes strict fields and ranges; inherited/prototype/accessor/hidden/symbol fields; wrong native typed arrays, Buffer/subclasses/proxies, shared/detached/resizable storage; typed-array own-property shadowing; valid byte offsets; no hidden alpha-zero RGB contamination; exact alpha; constant colors; source immutability; early and in-progress cancellation; callback-detached storage; amount0 exact identity with no typed allocation; allocation-free planning; and invalid-size denial before cancellation or scratch/output allocation.

Admitted maximum:16,777,216pixels and16384per edge. Worst-case declared alpha scratch+output is16×pixels+24×width+2048bytes; opaque scratch+output is12×pixels+24×width+2048. These equal observed instrumented typed allocations. At the widest admitted frame, alpha scratch+output is256.38MiB, plus64MiB source=320.38MiB. This excludes canvases, existing editor frames/history, JS/runtime overhead and decoder buffers, so it is NOT proof that a mobile device can safely process the maximum. Cancellation uses synchronous cooperative callback polling; it does not yield to the browser event loop or prove interactive Android responsiveness.

## Provenance and permitted use

Original bytes are unchanged. Before processing, both actual images were visually inspected and verified against the existing pack's SHA-256 values.

1. Historical input: `05_mukai.jpg`, credit NASA, source metadata https://images-assets.nasa.gov/image/S97-00568/metadata.json ; source SHA-256 `953f91ea6e69d5bdc86e87380b127627e7e5dcf6c0a9d6b7b7edf3fa6d3ed8ad`.
2. Modern input: `01_kim.jpg`, credit NASA/Josh Valcarcel, source metadata https://images-assets.nasa.gov/image/jsc2024e052605_alt/metadata.json ; source SHA-256 `4807d6ff31c34867ab51319a7787ba6f616edd7e7d1d10921716d856715bcc9f`.

The existing provenance manifest restricts this pack to private, local informational QA. NASA media policy: https://www.nasa.gov/nasa-brand-center/images-and-media/ . No commercial/model release was obtained. These are not cleared marketing, public-demo, in-app-example, training or dataset-redistribution assets; logos/subjects do not endorse this tool. No identity or ethnicity was inferred from the photographs. Source IDs/credits come from the provided manifest, not face identification.

## Reproduction

From the app directory:

    node --test tests/sharpness-independent.test.cjs
    NODE_PATH=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules node quality/sharpness-independent/build-evidence.cjs

No installs, downloads, model calls, keys, private photographs, browser launch or security-setting changes are needed. Production module hashes and output hashes must be rechecked after edits; this audit does not certify future bytes automatically.
