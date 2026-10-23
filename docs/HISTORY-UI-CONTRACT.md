# History step list UI contract

Scope: Android history navigation UI integrated in the production editor. No operation schema, pixel algorithm, signing, dependency or network change.

## Files

- `history-ui.js`: dependency-free UMD module, `MintHistoryUI` in a browser or `module.exports` in Node.
- `history-ui.test.cjs`: controlled-DOM tests that load the actual module, not a reimplementation.
- Production `index.html` / `style.css`: actual modal, toolbar and responsive styles.

## API

`MintHistoryUI.create({ document, getState, onPrepareOpen, onJump })` returns the frozen methods `refresh()`, `open()`, `close()`, `release()`.

`getState()` returns `{ loaded: boolean, origin: 'original' | 'legacy-working-copy', ops: Array, redo: Array, revision: nonnegative safe integer, busy: boolean }`. The combined history is at most 60 operations. `origin` must still have a valid fallback when unloaded. The UI fails closed on unreadable/invalid snapshots or incomplete required DOM.

Required static IDs: `historyBtn`, `historyDialog`, `historyStatus`, `historySteps`, `historyOriginal`, `historyLatest`. The steps container should be an `ol`. The dialog uses native `open`, `showModal()` and `close()`. Basic DOM requirements include `getElementById`, `createElement`, `appendChild`, `firstChild`, `removeChild`, `parentNode`, `textContent`, `setAttribute`, `addEventListener`, `removeEventListener`. No `innerHTML`, selector parsing, focus simulation, browser-only globals or dependencies are needed by the module.

`onPrepareOpen()` runs before the snapshot for opening is read. The host must only cancel transient pointer/gesture state here; it must preserve an existing tool draft. If open is called directly while busy/unloaded, preparation may run, but the dialog remains closed and no jump is dispatched.

The timeline is `ops.concat(redo.slice().reverse())`. Source is index 0, and operation i is prefix i + 1. The current prefix is `ops.length`. Every jump uses the revision captured when the row/shortcut was rendered, never the current revision substituted at click time. The UI rechecks current loaded/busy availability immediately before dispatch. An old index from a newer project is passed with its old expected revision, allowing the host to reject the exact stale request.

`onJump(index, expectedRevision)` is the host boundary. The host owns pending-preview confirmation, a second revision/busy check after confirmation, atomic replay, rollback, source retention, undo/redo branching, dirty/save state and closing only on success. The UI does not close or declare replay success after invoking it. A synchronous host exception is not swallowed and cannot permanently lock future dispatch. Standard async error handling, if needed, remains the host's responsibility.

Call `refresh()` after relevant history/revision/busy changes. Repeated refresh safely replaces rows, removes owned listeners and invalidates detached/saved callbacks. `close()` invalidates old controls immediately, including before an asynchronous native close event. Escape/cancel is closed synchronously and preserves a working reopen button. `release()` is idempotent, removes owned listeners, disables controls, clears rows, closes the dialog and makes all saved callbacks/methods inert. Unrelated host listeners are retained. Existing editor `data-close` and Android Back handling may call native `dialog.close()`; its close listener refreshes the UI. Include `historyDialog` in the host Back-dialog order as appropriate.

Labels use only fixed Chinese strings selected by own data `type`/`action` tags. Text, names, paths and recipe contents are never inserted. Unknown/inherited/accessor tags use a generic label. Main's canonical project validator remains authoritative: this is not another schema validator. A legacy source is explicitly labeled “旧工作副本（非原图）”.

## Verification

Run `node --test tests/history-ui.test.cjs` from the project root. After copying test/module into a production checkout, the test defaults to `../app/src/main/assets/history-ui.js`, or use `MINT_HISTORY_UI_PATH=/absolute/path/to/history-ui.js node --test history-ui.test.cjs` to select the target explicitly.

Tests cover chronological ordering, current/redo markers and accessibility, trusted Chinese labels, text/HTML injection and getter avoidance, 0/60/61 boundaries, missing DOM, unloaded/busy states, preparation order, captured revision forwarding, frozen sources, refreshed/detached/released controls, close/cancel/reopen, repeated refresh and synchronous host callbacks/failures. This is controlled-DOM validation only, not real browser rendering, WebView, Android device, touch, accessibility-service or screenshot acceptance.
