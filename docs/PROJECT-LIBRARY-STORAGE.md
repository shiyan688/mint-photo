# Local project library storage

`app/src/main/assets/project-library.js` provides a browser-independent storage module, exported as `MintProjectLibrary` in the browser and CommonJS in tests. It performs no decoding, rendering, network access, cloud synchronization, permanent deletion, export, or native Android file access.

## Data and limits

The existing IndexedDB database, `mint-photo-editor`, upgrades from version 1 to version 2. It keeps the existing out-of-line-key `drafts` store and `current` key intact. Two new out-of-line-key stores are created:

- `projectMetadata`: small listing records, keyed by project ID.
- `projectSnapshots`: `{schema:1,id,revision,record}`, keyed by the same ID.

Names are trimmed and NFC-normalized, limited to 80 Unicode code points and 320 UTF-8 bytes, and cannot contain control characters, bidi controls, line separators, or unpaired surrogates. Duplicate display names are allowed; IDs, not names, identify projects. Generated IDs are `project-` plus 32 lowercase hexadecimal characters from `crypto.getRandomValues`. No insecure random fallback is provided.

Metadata fields are exactly `{schema:1,id,name,revision,createdAt,updatedAt,trashedAt,bytes}`. Timestamps are integer epoch milliseconds. `trashedAt` is `null` for active projects. Revisions start at 1 and increase for overwrite, trash, and restore. A backwards-moving system clock cannot move an existing record's `updatedAt` backwards.

Limits are:

- 24 named entries total, **including trash**.
- 64 MiB logical bytes per project snapshot.
- 192 MiB logical bytes across all named snapshots, **including trash**.
- The separate current autosave is independently bounded to 64 MiB; it is not included in the named-library usage counter.

Logical bytes are the original Blob's native byte size plus UTF-8 bytes of the JSON record with that one Blob represented by `null`. Thus embedded image/collage strings, undo/redo recipes, source metadata and JSON punctuation count. Named-project metadata wrappers, indexes, browser-specific Blob deduplication, transactional temporary copies, SQLite/browser bookkeeping and operating-system overhead do not. The browser may run out of quota before these application limits. This counter is not a free-disk estimate. Copying retains independent immutable recipe snapshots and the original bytes; no physical Blob deduplication is promised.

All records are synchronously copied and bounded before awaiting an open or starting a write. Only plain data objects/arrays, finite numbers, strings, booleans, null, and a single native Blob at `source.blob` (v2) or `blob` (legacy v1) are accepted. Sparse arrays, cycles, accessors, symbols, exotic prototypes, extra Blobs, unsupported top-level record fields, excessive depth and excessive node counts are rejected.

## Constructing the module

```js
const library = MintProjectLibrary.create({
  indexedDB: window.indexedDB,
  validateRecord(record) {
    if (record.version === 1) {
      // Validate operation schema without pretending these are actual dimensions.
      ProjectCore.restoreProject(record, { width: 1, height: 1 });
      return {
        version: 1, blob: record.blob, name: record.name || '照片',
        ops: record.ops || [], redo: record.redo || []
      };
    }
    return ProjectCore.draftRecord(record);
  }
});
```

`validateRecord` is required, synchronous, and must return a complete independently valid record, not a boolean or Promise. The storage boundary makes its own copies before and after validation. A legacy v1 snapshot stays v1: actual dimensions and `legacy-working-copy` provenance must be established by the editor's actual image decoder before restoring it into an editing session. Never label the dummy validation dimensions as actual source dimensions.

Optional `now()` and `makeId()` dependencies exist for deterministic tests. Production should use the defaults.

## Stable API

Every asynchronous method returns a Promise. Success means the IndexedDB transaction completed, not merely that a `get`, `put` or `add` request succeeded.

- `list({includeTrash:false} = {})` returns fresh metadata objects, active only by default, newest updated first with ID as the stable tie-breaker.
- `usage()` returns `{count,maxCount,bytes,maxBytes,maxRecordBytes}` across active and trashed entries.
- `get(id)` returns `{metadata,record}` or `null` if the ID does not exist. It can retrieve trash for recovery. It validates that snapshot's schema, revision, record and logical byte count.
- `save({name,record})` creates a new project at revision 1 with a new ID. It never chooses an existing project by name and never evicts any project.
- `save({id,name,record,expectedRevision})` overwrites an existing **active** project. The exact previously observed revision is mandatory. Missing IDs do not implicitly create new projects.
- `copy(id,{name,expectedRevision})` duplicates the stored active snapshot under a new ID at revision 1. It does not copy current unsaved editor changes; save those separately if wanted.
- `trash(id,expectedRevision)` soft-deletes an active project. Snapshot bytes remain recoverable and remain counted.
- `restore(id,expectedRevision)` restores a trashed project. There is no purge, permanent-delete, automatic-eviction or empty-trash API.
- `readDraft()` returns the existing draft's exact data shape, including raw v1 shape, or `null`. It enforces the storage shape/size boundary but does not migrate, decode, or swallow errors.
- `writeDraft(record)` validates and writes ordinary autosave while preserving the caller's exact record shape. `null` and `undefined` reject with `USE_ARCHIVE`; they never delete the draft.
- `archiveDraftToTrash(name)` atomically reads authoritative `drafts/current`, validates it, creates a **new trash entry**, then removes `current` in the same transaction. Returns that entry's metadata or `null` if there was no draft. It never archives a stale caller-supplied record in place of the authoritative one.
- `replaceDraft(record,{archiveName:null|string})` atomically validates and writes the new current draft. A string also archives the authoritative old `current` as a new trash entry in the **same transaction**, returning `{archived:metadata|null}`. A `null` archive name intentionally replaces without creating a recovery entry. Invalid incoming/old records, any quota failure, a full library, or a failed final commit leave the old draft and library unchanged.
- `close()` releases the cached open connection; a later operation can open again.

For a switch/import workflow, the editor must finish validating, decoding and rendering the proposed target first, flush its current memory changes, obtain any required user decision about recovery, then use `replaceDraft`. After commit, adopt the already-prepared editor state. Do not call `archiveDraftToTrash` followed by `writeDraft` as a substitute for atomic replacement. Ordinary autosave and cross-tab draft writes remain last-writer-wins, matching the previous single-current-draft behavior. Named project mutations use revisions to prevent lost updates; the library does not lock an entire editing session or coordinate arbitrary old app versions.

## Transaction and failure behavior

Each named-library operation reads bounded metadata and a bounded snapshot **key cursor** to detect mismatched/orphan IDs without reading every original photo Blob. `list` and `usage` never fetch snapshot values. They validate structural metadata, count bounds, total claimed bytes and key correspondence. A target snapshot is validated when read or mutated; its stored bytes and revision must match metadata. The module does not cryptographically authenticate same-origin storage and cannot detect an otherwise well-formed byte-counter falsification for an unrelated unopened snapshot without reading that snapshot. Browser/application data corruption is not silently repaired, deleted, or replaced.

All requests and their dependent requests are queued synchronously from the transaction body or IndexedDB request callbacks. There is no `await` inside a transaction. Metadata/snapshot changes and optional draft changes commit together. Generated-ID collisions fail rather than overwrite, and new entries use `add`. Existing-entry updates re-read the revision within the same read-write transaction. A transaction abort, quota error, invalid/corrupt target, invalid metadata, or failed atomic draft replacement rejects while preserving the prior stored state.

Failed opens are not cached permanently. A blocked upgrade rejects promptly and any late abandoned upgrade is aborted or late connection closed. Repeated attempts while that blocked request is still pending do not enqueue additional opens. Connections close on `versionchange`; a later call reopens. A connection that closed immediately before transaction creation is reopened once, before any requests have run. Writes are never automatically retried after uncertain transaction outcomes.

Known error codes: `INVALID_NAME`, `INVALID_ID`, `INVALID_REVISION`, `INVALID_RECORD`, `RECORD_TOO_LARGE`, `COLLECTION_FULL`, `COLLECTION_TOO_LARGE`, `NOT_FOUND`, `REVISION_CONFLICT`, `TRASHED`, `NOT_TRASHED`, `ID_COLLISION`, `CORRUPT_STORAGE`, `STORAGE_UNAVAILABLE`, `STORAGE_BLOCKED`, `STORAGE_ABORTED`, `STORAGE_QUOTA`, `USE_ARCHIVE`.

A library full of 24 entries, even if they are all trashed, remains full. This release deliberately provides no destructive way to reclaim those entries. Restore and overwrite an existing project where appropriate; do not tell users that trash frees capacity. Exported images are flattened results, not an external backup of this editable library. Browser/app data clearing, device loss, OS eviction or app uninstall can still remove all local data. Transaction completion is not a claim of physical-device power-loss durability.

## Verification and limits

Run:

```sh
node --test tests/project-library.test.cjs
```

These are **fault-injected adapter tests, not native IndexedDB or Android/WebView tests**. The adapter models serialized transactions, structured clone, request ordering, delayed commit, abort rollback, and open/upgrade faults. Tests cover real `ProjectCore` record validation, independent original/undo/redo copies, metadata-only listing, stale and concurrent updates, copy/trash/restore, legacy draft migration, bounds, corruption rejection, atomic recoverable draft transitions and late failures. Artificial 64/192 MiB boundary tests use a clearly labeled schema-neutral validator only to isolate storage accounting.

Native browser storage tests have not run. The installed Playwright-managed browser binary was absent, and a system Chromium launch terminated before opening any page with crashpad initialization failure and `socket() failed: Operation not permitted`. No browser installation, later retry, browser page access or system configuration change was performed. No Chromium probe process remained afterward. This is not evidence of actual browser transaction behavior or real-device durability; those remain separate acceptance checks.
