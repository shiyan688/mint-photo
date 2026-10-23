# Independent named-project preservation audit

Audit date: 2026-10-22 UTC. Scope: local named-project storage, controller, UI contracts, editor confirmation settlement, autosave/switch ordering and legacy drafts. This audit does not modify production code. The parent integration task fixed the confirmation bug found here; the UI owner also fixed the non-destructive name-validation mismatch reported here.

## Result

- `tests/project-library-independent.test.cjs`: **25 passed, 0 failed**.
- Combined existing storage (35), controller (16), UI (35) and independent (25) tests: **111 passed, 0 failed**.
- Source hashes and test/support hashes: `SHA256SUMS`.
- Raw test output: `independent-results.tap`, `combined-results.tap`.
- No dependency installation, browser launch, security-policy change, new model, signer or network request was used.

Commands, from repository root:

```sh
node --test --test-reporter=tap tests/project-library-independent.test.cjs
node --test --test-reporter=tap tests/project-library.test.cjs tests/project-library-controller.test.cjs tests/project-library-ui.test.cjs tests/project-library-independent.test.cjs
```

## Concrete issue found and fixed

`askProjectConfirmation` attached an unconditional cancellation listener to both `close` and `cancel`. Closing a dialog queues its native `close` event. If another prompt replaced the first before that queued event was delivered, the old event canceled and closed the **new** prompt.

The independent reproduction extracted the unchanged function from editor.js and used a controlled dialog with queued close delivery:

1. `ask(A)` opens A.
2. `ask(B)` settles A false and opens B.
3. Deliver the pending native close event from A.
4. Before the fix, B resolves false and closes without a B decision.

Original editor SHA-256: `f2ba9b81d256acd5530cef72064dba9e503e462d74055f70f076a8b697e20715`.
Observed output before fix: `{first:false, secondOpenBeforeOldClose:true, queued:1}`, then `{second:false, secondOpenAfterOldClose:false}`.

The parent changed only close-event cancellation to require the dialog to actually be closed. Explicit `cancel`, No and Back still settle false. The 21st independent regression now verifies the newer prompt remains open and can be approved. This is an event-order contract test, **not proof of a native browser's event dispatch**.

## Independent coverage

The first 15 tests run production storage/controller/ProjectCore with the separate `fault-idb.cjs` model in this directory. That model is independently implemented rather than copied from the existing storage tests. It deliberately serializes all transactions, supports structured copies, queues individual requests, delays transaction completion and injects quota faults at each write or final commit. It cannot prove real IndexedDB semantics.

Coverage includes:

- Exact original Blob bytes, original dimensions/provenance, raw ordered operations, redo order, embedded overlay pixels and collage assets.
- Initial named save, overwrite with expected revision, independent current copy versus a stored-version copy, soft trash and restore.
- Copy independence after a source record changes. The stored version does not acquire unsaved current edits.
- Dirty switch flushing the latest memory state, atomic archive/replacement, target adoption only after storage success.
- No cancel preserving memory, autosave, preview and stored project entries.
- Stale source/revision after prepare and after pending confirmation, without adopting or archiving a stale target.
- Refresh not rebasing an active editor onto another tab's new revision. Stale copy/trash/restore fail their compare-and-swap checks.
- Individual write faults and failure **after all requests succeeded but before transaction completion**. Old storage is unchanged; the controller does not claim success or adopt a new named identity.
- Failed install restoring the old autosave while retaining the already-created recovery entry and the named target.
- Invalid unopened draft blocking import without silently replacing its raw bytes.
- v1 database upgrade retaining exact v1 legacy data without invented source fields or 1x1 dimensions; dimensions/provenance are established only on a later actual restore call.
- v2 draft upgrade retaining known dimensions, origin and payload without rewriting it.
- Invalid source dimensions, mismatched revision, orphan key and byte-counter mismatch rejecting without repair/deletion.
- Twenty-four trashed entries still counting toward capacity, restore still working, and no permanent-delete/purge/clear API.

Tests 16–21 extract the **actual current editor confirmation function**, not a rewritten version. Controlled DOM events verify No, Back, cancel and close each settle once, Yes remains true, retained old Yes callbacks do nothing, and queued old close does not cancel the newer prompt.

Tests 22–25 execute the complete production editor through `tests/helpers/project-library-harness.cjs`. These four reuse the parent integration harness and its explicitly fault-injected IDB backend; they are independent scenarios, not an independent implementation of that backend. Their decoder is deliberately a 24x18 controlled fake and they make no pixel claim. They verify:

- A pending-switch autosave timer cannot overwrite the just-opened snapshot.
- Even an already-dispatched old timer callback reads the current editor rather than carrying a stale photo.
- Cancellation reschedules the autosave skipped during the confirmation.
- A previously in-flight autosave finishes before atomic replacement and cannot win afterward.
- Back resolves the open false, releases busy and leaves committed editing usable.

## Additional non-destructive UX mismatch

At initial inspection, UI `nameValue` accepted U+2028/U+2029 line separators and unpaired UTF-16 surrogates, while storage `normalizeName` rejected them. A pasted invalid name could therefore enable Save and then receive a storage error. Storage still failed closed. The UI owner fixed the validator to match the storage boundary and added two focused tests. Those tests and the combined suite pass against UI SHA-256 `b42f0edd7f262cc101c3254d74199bc30615f684f3946dcf6628319d41e0a97b`. No data-loss assertion is attached to this mismatch.

## Exact uncovered boundaries

1. **Native IndexedDB has not run in this audit.** Neither fault-injected model establishes actual browser transaction lifetime, upgrade scheduling, request/error bubbling, Blob serialization on disk, browser quota handling or disk persistence.
2. No Android/WebView device run, process death/cold launch, browser refresh/reopen, reboot, OS eviction, low-disk condition or power-loss test. Transaction completion is not power-loss durability.
3. No real simultaneous browser tabs/processes. Revision conflicts and serialized writes are modeled. Current autosave is intentionally last-writer-wins and has no cross-tab session lock.
4. No UI screenshot, focus/keyboard/accessibility tree, real native dialog queue or file picker was exercised. This audit does not claim modal stacking or Android picker behavior is accepted.
5. The four complete-editor timing tests use a fake decoder and Canvas. Parent-owned native Canvas/PNG replay is separate; no pixel or export-fidelity claim derives from these four tests.
6. No signed Android build/install, desktop packaging or exact packaged-byte verification was performed by this audit.
7. Metadata-only list/usage can check key correspondence and declared limits, but cannot detect a well-formed false byte count in an unrelated unopened snapshot without reading it. This matches the documented API boundary.
8. Clearing application/browser data, uninstalling or losing the device can remove all projects. The library is local-only and a flattened image export is not an editable-project backup.

Recommended remaining acceptance: on a supported Android WebView and desktop browser, save an original with overlay/collage plus redo, verify named save survives a genuine application/process close and restart, reopen it, compare original binary payload and recipe/assets, exercise soft trash/restore after restart, and repeat a v1-database upgrade with an existing legacy draft. Confirm quota failures leave the previous named entry and current draft readable. Do not weaken file/security settings to obtain that result.
