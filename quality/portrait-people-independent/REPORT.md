# Independent mobile multiple-face source-checkpoint QA

Date: 2026-10-22 UTC. Read-only independent audit of `/workspace/scratch/902a42ed06ad/mobile-oct22/薄荷人像`. Production code and existing tests were not edited by this auditor. New tests and reports are confined to this directory. No network access, dependencies, models, signing, builds, or device claims were added.

## Findings first

1. Fixed during audit by the implementation owner: `portrait-people-operation.js` previously read `image.width` and `image.height` before the strict source validator. A getter therefore ran once before rejection. The owner now copies descriptor values through its strict record boundary first. The independent regression confirms zero getter invocations.
2. Fixed during audit by the shared-core author: the original frozen core read `buffer.resizable` as an ordinary property in `imageValue`. An own getter executed, and an actually resizable buffer could shadow the property with `false` and be accepted. A genuinely shared buffer with a spoofed ArrayBuffer prototype and an own `resizable:false` was also accepted. The author replaced instance reads with captured native ArrayBuffer byteLength/resizable getters, and the parent copied the single shared fix to mobile. Independent final retesting passes all three cases through both core and mobile wrapper: six checks, zero failures. A genuinely fixed buffer may retain an unused own shadow getter, but it is never invoked.

The new shared-core checkpoint is `0de2c158f3a23c6e4de8326e7474ad809e02d41ccc2931a5ccfba76505a02b3a`, not the original frozen digest. The exact reviewed change is saved in `core-hardening.diff`; only intrinsic metadata capture and backing-store validation changed. No image algorithm, support bounds, phase merge, or resource formula changed. All four actual-fixture output hashes are identical before and after this patch (`pixel-hash-continuity.json`).

Final retest at 17:02 UTC: 24 core/boundary tests, 11 combined UI state tests, and six backing-store regressions pass. No confirmed finding remains open within this audit's tested scope. This is not an unrestricted application-quality or device-acceptance conclusion.

Reproduce the backing-store regression: `node /workspace/shared/mobile-multiface-independent/source-buffer-repro.cjs`. Final `buffer-results.json` identifies the shipped mobile paths and records all six passing results. Pre-hardening failures are retained separately for traceability.

## Passing independent regression coverage

`independent-core.cjs`: 24 passing tests. `independent-ui.cjs`: 11 passing tests. `source-buffer-repro.cjs`: six passing API/case checks. These are bounded regression results, not an overall application pass.

- Original frozen core SHA-256 was `cde5049c0758f6eea4f476c7bc2180fb573dafebaa088c123f0430fc05d0b929`; final reviewed core is `0de2c158f3a23c6e4de8326e7474ad809e02d41ccc2931a5ccfba76505a02b3a` with only the backing-boundary fix above. Legacy engine remains exactly `5cde7dcd60aab1d68e1ec5fb026c6396c2f395c1597dd03113c34674ba57d524`. Full tested adapter/UI hashes are in result JSON files and `final-source-hashes.json`.
- Source revision, optional explicit batch ID, model digest, topology, source/draft object identity, stale callback and cancellation boundaries were exercised. No dimensional-equality substitution is used as source identity in the UI tests.
- Own-data batch accessors are rejected without invocation. Unknown fields, symbols, holes, inherited controls, invalid ranges, missing values, explicit invalid optional values, and malformed source typed arrays are rejected in tested cases.
- Both multiple-face phases start neutral. Multiple-face selection never silently chooses index zero. Different per-face controls survive explicit switching. Staged redetection retains edits until accepted; a reversed detector order installs detached zero values and a new batch. Stale confirmation or callback cannot overwrite the current draft.
- Group operations reject nonzero hidden controls from the other phase.
- On both actual supplied 2-person and 5-person synthetic QA composite inputs, beauty and reshape output is byte-exactly the union of independent frozen-engine deltas computed from the same immutable phase input. Each tested face changes nonzero pixels. Reversing the batch face array preserves output. Source data is unchanged.
- Four inactive neighbors in the five-face fixture retain every byte in their protected regions for beauty and reshape: 632,792 neighboring bytes checked in each phase.
- Overlapping active/inactive faces reject before engine invocation. A distinct read-halo-only overlap also rejects even though active write bounds and inactive protected bounds do not overlap. Exact test bounds are saved in `core-results.json`.
- Beauty preserves partial alpha and hidden RGB. Neutral reshape is byte-exact identity, while active reshape rejects nonopaque input and planning flags the unresolved alpha precondition.
- Cancellation at entry, after the first face, and during output verification returns no partial result and does not mutate source bytes. Synchronous engine calls themselves are not preemptible.
- Preflight rejects over-4096 edges, over-8,000,000-pixel dimensions, excessive cumulative typed-array estimates, and excessive whole-history work. The chosen 900×500 one-face brighten test costs 8,100,000 estimated work units: 15 steps pass and 16 reject against 128,000,000.
- Ordered raster history round-trips group operations, geometry, and redo snapshots. Saved landmarks are detached. This is not a desktop fixed-pipeline test.
- Local preset target context must match the exact selected face mesh and contain no other active person edits. Portable version-3 recipes retain controls only and reject person context. Legacy one-face preset numerical output remains exactly the frozen-engine result.
- Combined production UI modules with an independent controlled DOM/native-callback harness verify ID-photo and autoheal require an explicit target for two faces. The chosen second-face landmarks reach the consumer; first-face fallback never occurs. ID-photo cancellation preserves its current draft. Overlapping automatic-heal target geometry rejects. Generic picker entry cancels an existing pointer.

## Pixel fixtures and evidence

Both source PNGs were visually inspected before pixel tests. They are labeled synthetic composites from public NASA adult portraits, not actual group photographs and not private photos. Inputs: `/workspace/shared/mobile-multiface-qa/synthetic-2-adults-900.png` (900×500) and `synthetic-5-adults-900.png` (900×680). Existing provenance and host inference evidence remain in that directory. `fixture-metadata.json` records PNG/RGBA hashes. Only PNG decoding to RGBA was performed locally; no new model inference was run.

Per-face changed pixels in independent direct-engine outputs:

- Two-face beauty: 47,474; 46,230.
- Two-face reshape: 2,879; 7,519.
- Five-face beauty: 14,486; 23,467; 20,888; 21,564; 21,014.
- Five-face reshape: 1,916; 2,572; 3,353; 1,817; 2,580.

Output hashes, exact settings, verification logic and resource estimates are reproducible from `independent-core.cjs` and `core-results.json`.

## Reproduction

From any working directory, run:

- `node /workspace/shared/mobile-multiface-independent/independent-core.cjs`
- `node /workspace/shared/mobile-multiface-independent/independent-ui.cjs`
- `node /workspace/shared/mobile-multiface-independent/source-buffer-repro.cjs`

`MINT_ROOT` can override the source tree path. The default tree uses the currently installed source. Preserve/copy the `2.rgba`, `5.rgba`, and `fixture-metadata.json` files alongside the tests. These tests use only Node built-ins; the initial PNG extraction used the already-installed Pillow package without installation.

## Limits and interpretation

This is source-checkpoint regression evidence, not a claim of Android/WebView/native inference execution, browser rendering, ARM correctness, real-device memory/performance, aesthetic quality, identity consistency, or general crowded/occluded group-photo success. The UI harness controls DOM events and simulates the native bridge callback; it is not a real browser. Actual Canvas/export verification is owned separately and is not included in these 35 tests.

Full-resolution budgets are preflight policy checks here, not large real-device peak measurements. Memory estimates exclude source/canvas/native/history/GPU storage, arbitrary JS heap overhead, and delayed garbage collection; cumulative typed allocations are not measured peak RSS. The detector's max-five/900-edge preview limits can miss small or obstructed faces. Conservative overlap/read-region rejection is deliberate.

An opaque `sourceRevision` is caller binding, not a pixel digest. Persistent history associates each batch with its saved ordered stage; this test does not turn that token into source-content authentication. Explicit one-face auto-selection is permitted, but multiple faces require explicit choice. The original frozen core's ArrayBuffer issue is fixed in the reviewed shared checkpoint. The QA does not claim protection against a compromised JavaScript runtime that replaces intrinsics before module initialization, or arbitrary caller callbacks that deliberately mutate source storage.
