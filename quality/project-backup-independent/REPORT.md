# Independent project-backup audit

Date: 2026-10-22 UTC. Scope: read-only production review and independently authored adversarial tests, not only a rerun of the feature author's tests. No production source, Gradle build, dependencies, model files, network endpoints, signing configuration, or browser security settings were changed by this auditor.

## Final outcome

- **15/15 independent tests pass** on the final fingerprinted source.
- Boundary/transport suite: **7/7**, including **63 independently constructed cross-language binary fixtures** run through the shipped JavaScript codec and the shipped Java streaming reader.
- Real-Canvas/state suite: **8/8**, including actual PNG decoding/rendering/export, complete two-person coordinate/history/asset recovery, delayed autosave ordering, storage failure, cancellation and atomic rollback.
- **No unresolved confirmed blocker** in the tested cloud-completable scope. Two independently identified issues were fixed by the production owners and retested below.

Run from the Android project root:

```sh
node --test tests/project-backup-independent.test.cjs
node --test tests/native-canvas/project-backup-independent.test.cjs
```

The boundary suite compiles only the production JVM payload classes and a tiny audit driver into a temporary directory. If javac is absent it uses the already installed JDK compiler module; it installs nothing and does not invoke Gradle.

## Findings and verified fixes

### A. Runtime-invalid redo accepted during recovery — moderate, fixed

**Counterexample:** a correctly checksummed project with empty committed operations and one redo `portrait-people` beauty operation. The operation uses the existing synthetic two-face detection fixture, copies the first face's landmarks onto the second face, and gives the first face nonzero brightening. Every JSON, hash, source-image and structural recipe check succeeds, but actual replay rejects the overlapping person regions.

**Before the fix:** import returned true, changed the current source, and durably retained a redo that could not be replayed. Only a later Redo click surfaced the overlap error. No old source was irreversibly lost, and the failed Redo itself was atomic, but import did not meet the requested full-history preflight guarantee.

**Cause:** `prepareNamedProject` rendered committed operations only. Structural validation alone does not prove pixel-dependent face overlap and transparency constraints.

**Fix independently verified:** the editor now renders committed operations plus reversed redo before its atomic storage switch, and also validates prefixes before text/paint/image layer mutations that could collapse away older states. It disposes each validation raster and renders the selected committed state. Event-loop yields and cancellation checks separate prefix replays. The final independent regression confirms rejection before current source, committed pixels, stored draft, or recovery archive changes. This shared preparation path also protects reopening named projects.

Regressions in the independent NativeCanvas suite: runtime-invalid redo rejection; a structurally valid 500-character text layer whose actual layout exceeds 128 wrapped lines but is hidden by a later empty replacement (tested both in committed history and redo); cancellation between prefix replays with no installation or draft/archive change. The hidden-text case uses real Canvas layout, not injected failure.

### B. Native unsafe-key validation differed from JavaScript — low, fixed

**Counterexamples:** operation objects containing raw `__proto__`, `prototype`, `constructor`, or escaped `__pro\u0074o__` keys, with freshly recomputed valid hashes.

**Before the fix:** Java's reader accepted these nested keys; JavaScript rejected them. Java held ordinary Maps and did not execute operations, so this was defense in depth, not an exploitable Java prototype-pollution path or successful end-to-end import bypass.

**Fix independently verified:** Java now rejects these three dangerous decoded keys at every depth. The 63-case differential matrix now has matching acceptance/rejection in every case, including escaped aliases.

### Final lifecycle-only delta review — accepted

The production owner added idle-only notices for valid native results from a previous page with no corresponding Promise. The editor only displays a `此前工程备份` textContent toast; it does not install a project, advance draft state, or mark current work saved. Unknown results remain ignored while another request is active. A 32-ID bounded cache suppresses recent settled duplicates; an evicted ID can produce another notice but cannot mutate project state.

An additional independent test covers exact 80-character request-ID and 2000-character message boundaries, malformed payload rejection, the 32-entry cache/eviction boundary, duplicate settled results, active-session isolation and a throwing notice callback. The two feature-author tests for the recreated idle transport and actual editor toast were also rerun: **2/2 passed** separately from the 15 independent tests. This verifies JavaScript dispatch and controlled editor behavior, not actual Activity recreation. The full independent suites were rerun after this delta, and final source fingerprints refreshed.

## Independent coverage

### Envelope, JSON, Unicode, and numeric boundaries

- Correct 80-byte envelope plus independently recomputed Node SHA-256 hashes.
- Separate manifest/source hash mutations, payload mutations, truncated header/body, trailing data, wrong magic, unsigned 0x7fffffff/0x80000000/0xffffffff lengths.
- Exact inclusive 24 MiB manifest, 40 MiB source, and 64 MiB total header boundaries without allocating maximum-size bodies; maxima cannot both be used together.
- NaN, infinities, fractional/unsafe/negative total lengths rejected before a body read.
- Duplicate object keys, escaped duplicate aliases, raw/escaped dangerous keys.
- BOM, overlong/truncated UTF-8, isolated continuation bytes, surrogate UTF-8, scalars above Unicode maximum; malformed escapes and unpaired JSON surrogates.
- Invalid JSON numeric grammar, finite 5e-324 allowed, nonzero 1e-324 underflow rejected, infinities rejected, negative zero allowed, and exact 128-versus-129 character number token boundary.
- Depth/key bounds and strict trailing syntax.
- Caller edits after asynchronous encode begins cannot change the captured project name, source metadata, nested committed edits, redo or original bytes.

### State, durability, and actual pixels

- Synthetic two-person portrait operation: both sets of **478 landmarks**, separate person parameters and detector/context metadata survive restoration.
- Committed history, redo, an embedded 2×2 RGBA sticker, original encoded PNG bytes and actual PNG export pixels remain identical through a fresh editor recovery.
- Redo then Undo restores the same pixels; backup does not mark the project as a named-library save.
- A delayed older autosave commits before the backup's latest snapshot. Background/timer flush attempts during the backup cannot overwrite the latest snapshot with the older one.
- An injected failed local autosave does not prevent rescue backup. The local saved revision is not falsely advanced, the warning is preserved, and that rescue backup independently restores the latest edits.
- Storage failure at each of the three atomic archive/replacement writes leaves the current source, pixels, committed history, unapplied preview and prior draft intact, with no half-created metadata/snapshot archive.
- Cancellation while an older autosave commits prevents encode/delivery and retains the current editor and latest draft.
- Cancellation between hidden-layer history prefix replays prevents further replay, installation and draft/archive mutation. A counting wrapper observes the real text renderer without replacing its output.
- Old-ID transfer/result/error callbacks after cancellation cannot acknowledge, cancel or complete a new transfer.
- Picker-phase transport disposal settles the JavaScript promise with an uncertain-save error without cancelling a potentially written native destination.

## Evidence

- `boundary.tap`: latest 7/7 boundary/transport test output.
- `pixels-state.tap`: latest 8/8 actual-Canvas/storage-state test output.
- `lifecycle-authored.tap`: targeted 2/2 feature-author lifecycle-notice regression output, not included in the independent test count.
- `differential.json`: all 63 envelope fixture outcomes for JavaScript and Java.
- `faces-assets-roundtrip.json`: exact pixel/source hashes and preserved data assertions.
- `faces-assets-restored.png`: actual recovered PNG export from the self-authored raster. Visually inspected. This is a test raster, not an app screenshot or user's photograph.
- `source-fingerprints.json`: SHA-256 fingerprints of reviewed production files and independent test files.
- `ProjectBackupAudit.java`: small read-only command-line adapter around the production Java reader.

## Explicit limits and remaining real-device checks

NativeCanvas is the already installed Skia-backed Node implementation, not Android Canvas or Chromium. DOM events, IndexedDB scheduling/faults, the file picker and the system save sink are controlled test infrastructure. The production storage adapter runs unchanged on the injected transactional backend. The existing native Canvas adapter includes its documented putImageData transform-compatibility adjustment.

This audit does **not** establish actual browser IndexedDB persistence, Android/WebView behavior, Android SAF provider durability, Activity/process death, foreground/background restoration, real low-memory/low-storage behavior, hardware gestures, provider close/flush semantics, or a real destination file write. Java numeric-bridge checks and true-result-after-provider-close ordering were reviewed in source, not executed in an Activity. Those require device/provider validation. No Gradle build was run by this audit; the parent's aggregate build owns Android compilation/lint evidence.

Checksums remain corruption detection, not authenticity. Recomputed hashes on malicious source bytes are not evidence of a safe or semantically unchanged photo. Image decoder permissiveness is platform-dependent; actual source decode remains a required separate host gate. The backup remains intentionally unencrypted and retains originals, private coordinates and embedded assets; it is not the portable source-free preset format.
