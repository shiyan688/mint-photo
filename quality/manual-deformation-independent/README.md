# Independent manual-deformation audit

The independent reviewer made no production edits. This directory records the frozen v29 findings and independent regression checks for the manual radial/twist extension. `v29-counterexamples.tap` intentionally contains five failures from the unfixed v29 implementation; it is historical evidence, not a final candidate result. `integrated-first.tap` records an intermediate UI number-formatting defect, subsequently fixed.

## Final audited candidate, 2026-10-22 UTC

- Independent tests: **35/35 passed**, in `final-independent.tap`.
- Combined old/new/independent focused tests: **105/105 passed**, in `final-focused.tap`.
- Frozen legacy comparison: **110 exact image/diagnostic comparisons**, including one-pixel dimensions, alpha, selections, and aggressive push/restore accumulation.
- All five baseline counterexamples are corrected. Selection donor isolation remains intentionally outside the contract.
- An early new-mode candidate doubled a tap's effect for tiny nonzero pointer jitter. The core author corrected the per-dab dose; the independent continuity regression now passes for all four new kinds.
- An integrated UI check found the repair radius displayed as `1.7999999999999998` after changing modes. Bounded display formatting fixed it without changing the stored values.
- No remaining functional blocker was found within the tested cloud scope. Exact audited production hashes and residual limitations are in `final-audit.json`.

Run the independent set after integration:

    node --test tests/audit/manual-deformation/*.test.cjs

## Verified before extension

- Existing focused suites: 47/47 passed.
- `manual-tools.js`, `manual-retouch-ui.js`, `project-core.js`, and `editor.js` matched the frozen v29 source archive exactly.
- Independent UI counterexamples found subtract-from-null, inverted add, inverted subtract, and feather-on-null selection defects.
- Original-size project preflight omitted the liquify work ceiling. A 3000×2400 image with 20 wide pushes passed project planning but failed rendering with `MANUAL_WORK_LIMIT`.
- The field limiter held its strict 0.45 neighbor bound. Independent sampling of all cells in a mixed 40-stroke case found a minimum Jacobian of 0.546904 and no out-of-domain source nodes.
- Alpha and hidden transparent RGB were preserved by the core. Android intentionally refuses translucent input because alpha is not geometrically warped.

## Source influence is not destination protection

A hard half-image selection left every excluded destination byte unchanged. However, modifying only the excluded source colors affected 35 selected output pixels through the bilinear footprint (maximum red-channel difference 67). This is consistent with the v29 contract: selected weights attenuate destination displacement, not source donors. Do not claim automatic neighboring-person or neighboring-texture isolation.

## Acceptance checks

The independent tests cover visible selection semantics and immutable snapshots; export preflight; a frozen-v29 byte/diagnostic oracle; radial and clockwise/counterclockwise signs; actual synthetic circle expansion/contraction; duplicate and dense-pointer equivalence; tiny-jitter dose continuity; exact zero-strength/empty-selection behavior; cancellation; full-support restore; transparent-input core invariants; and direct displacement/Jacobian probing. The legacy oracle is owned by the core author at `tests/fixtures/manual-tools-legacy-v29.cjs`; its exact SHA-256 is asserted.

Integration checks cover all four new UI buttons, actual changed pixels on release, source RGBA and Blob identity, project history round-trip/replay, independent repair/deformation controls, direct and interactive alpha refusal, repair-donor ordering, rejected export budgets, a working-size-only warning, stale DOM/gesture rejection, local undo and clear. Budget tests separately prove the Android 256 MiB host allowance, cumulative 800 million work-unit ceiling, and crop-before-versus-after operation order. Original-size requests fail explicitly instead of silently shrinking.

The final independent field probe mixes 36 legacy/new commands with hard selection. It samples 57,600 bilinear-cell Jacobians: minimum sampled determinant 0.5152471759902824, maximum neighbor displacement gradient 0.4400000412691639, zero out-of-domain source nodes. The production reported determinant lower bound is 0.1426920210185856. The underlying field, not just those reported diagnostics, is checked.

The reviewer also visually inspected the core author's synthetic original, bloat, pucker and clockwise grid PNGs. The figures show local smooth deformation and unchanged exterior grid; this is qualitative synthetic evidence, not a portrait quality result.

No test here is Android/WebView or handset acceptance. The mathematical field probe is test-only source instrumentation in a VM and fails explicitly if the field declaration changes; it is not a production debug API or an assertion based solely on the production diagnostics.

The planner's byte/work counts are conservative guards, not measured process memory or elapsed time. The UI harness uses controlled DOM and pixel surfaces, not a browser layout engine or real touch input. Device timing, WebView delivery, saved backup browser download, and native gallery behavior remain separate acceptance work.
