# Native project-backup boundary

This source change adds a single-project `.mintproject` import/export path. It does not change the APK signing identity, manifest permissions, model files, original-photo export, or the photo-free JSON preset format. No ZIP/archive extraction or arbitrary filesystem path is supported.

## File boundary

MIME: `application/vnd.mint.photo-project`. The binary file consists of an 80-byte fixed header, the strict UTF-8 JSON manifest, and the original encoded source bytes, with no trailing bytes:

| Offset | Length | Meaning |
| --- | --- | --- |
| 0 | 8 | ASCII `MINTPRJ1` |
| 8 | 4 | Unsigned little-endian manifest byte length |
| 12 | 4 | Unsigned little-endian source byte length |
| 16 | 32 | SHA-256 of manifest bytes |
| 48 | 32 | SHA-256 of source bytes |

Total size, including header, is at most 64 MiB; manifest at most 24 MiB; source at most 40 MiB. Native verifies both hashes while streaming. The original source is never allocated as one native byte array. The manifest parser retains only the small envelope/record/source shell, not its potentially large operation graph. Source buffers are 32 KiB and decoded transport chunks at most 128 KiB.

Native JSON syntax rules reject duplicate keys (including escaped-equivalent keys), the exact object keys `__proto__`, `prototype`, and `constructor` at every depth (ordinary string values are preserved), malformed UTF-8, unpaired surrogates, trailing content, depth over 64, more than 2,000,000 value nodes, keys over 256 decoded UTF-8 bytes, strings over 6 MiB, aggregate decoded key/string bytes over 24 MiB, number tokens over 128 characters, infinities, and nonzero literals that underflow to zero. Finite fractional values remain allowed generically; schema fields such as source dimensions are checked separately.

The root is exactly `{format:"mint-photo-project",version:1,name,record}`. Project name is NFC, already trimmed, 1–80 Unicode code points and at most 320 UTF-8 bytes; control/bidi-override/isolate characters are rejected. Version 2 record is exactly `{version:2,source,ops,redo}`, with source exactly `{blob:null,name,width,height,mime,origin}`. Version 1 is exactly `{version:1,blob:null,name,ops,redo}`. Dimensions must be positive integers, at most 1,000,000 per edge and 80,000,000 pixels. Combined operation/redo history is at most 60 steps. Only original or legacy-working-copy source markers are accepted.

Native checks PNG/JPEG/WebP source magic and declared source MIME consistency (the generic `application/octet-stream` declaration is permitted). This is not a native decoder. The independent JS codec validates every operation, source image structure and header dimensions, and the editor decodes/replays before installing a project. Hashes detect corruption; they are neither a signature nor encryption.

## Import

- Only an exact `.mintproject` and/or exact project MIME accept request opens the project picker. Mixed image, JSON, wildcard, or unrelated accepts are rejected. Existing image/preset chooser behavior is retained.
- Android `ACTION_OPEN_DOCUMENT`, `CATEGORY_OPENABLE`, one `content:` URI, read grant only. Project-specific `EXTRA_LOCAL_ONLY=true` is advisory, not a guarantee that a provider does not sync externally.
- Project MIME or octet-stream provider MIME is allowed only after complete bounded native validation. A declared oversize length fails before reading; unknown provider lengths still face actual streaming limits.
- Validation runs on the existing serial import worker. Back, destruction, and a 120-second project-read timeout cancel the read, close its stream, and clear the chooser callback.
- Only the same granted URI that was validated is returned to the WebView. Generation and callback identity checks discard stale results. JS independently validates its second read to protect against provider content changes.

## Chunk export protocol

All methods are exposed on `Android`:

1. `beginProjectBackup(requestId, fileName, totalBytes)`
2. Wait for `onNativeProjectBackupTransfer(requestId,"ready",-1,"")`.
3. `appendProjectBackup(requestId,index,base64)` with zero-based consecutive indices. Wait for `onNativeProjectBackupTransfer(requestId,"chunk",index,"")` before sending another command.
4. `finishProjectBackup(requestId)` only after the last acknowledgement.
5. On successful complete-file validation, native opens `ACTION_CREATE_DOCUMENT` and emits `onNativeProjectBackupTransfer(requestId,"picker",-1,"")`.
6. `onNativeProjectBackupExportResult(requestId,success,message)` reports system-picker cancellation or the actual copy result.

`cancelProjectBackup(requestId)` cancels only the matching in-progress transport; it does not dismiss or replace an already-open system save picker. A different or invalid request ID cannot delete the current owner's cache or clear its shared export lock. Request IDs are ASCII letters/digits/underscore/hyphen, 1–80 characters. JS must generate a fresh ID for each request and ignore stale callbacks. Numeric bridge arguments are received as doubles so nonfinite/fractional values are rejected before narrowing to Java integers.

Encoded chunks are limited and checked for canonical Base64 length/alphabet/padding before decoding, with at most 128 KiB decoded. Only one command may be outstanding. Duplicate begins, duplicate/out-of-order indices, concurrent chunks, premature finish, invalid Base64, declared-length mismatch, timeout and failed final validation terminate only the owned transfer. Error events use index -1; a failed transfer also receives the ID-correlated final failure callback. The export lock is held until queued writes and temp cleanup finish. An idle transfer times out after 120 seconds.

The output is written first to one private cache file. Only after complete native validation is a system save picker opened. The suggested filename is sanitized and always has the distinct `.mintproject` suffix; it is never used as a path. Only the picker-granted `content:` destination is written. The shared export lock guards image, preset, and project export. No whole-file Base64 string crosses the bridge.

## Lifecycle and cleanup

- Mid-stream Activity teardown marks the session cancelled and queues close/delete behind any accepted chunk. Active temporary files are protected from a replacement Activity's cache sweep until their owner releases them.
- Bounded Android saved state contains the request ID and phase, never image/manifest/chunk data. Recreated interrupted streams report failure with the old request ID and do not resume.
- A completed pending picker retains only a validated cache filename, sanitized suggested name, MIME, and ID. Before opening a destination stream, the restored file is fully revalidated on the worker. If no picker result arrives before resumed Activity state, the interrupted pending export is cleared safely.
- Copy already in progress is not replayed after recreation. The replacement reports an uncertain result under the old ID, asking the user to check the chosen location, never unconfirmed success. The old Activity may safely finish its already-started write but cannot update the replacement page.
- Errors/cancellation delete private temporary state. A failed destination copy attempts to remove only the newly created incomplete destination document, never an imported original. Provider deletion support is not guaranteed, so an incomplete external document can remain after an I/O error.

The UI must warn before export that this is an unencrypted full-original backup, including edit history and face coordinates where present, and that cloud-backed document providers may sync it. `EXTRA_LOCAL_ONLY` does not replace that warning.

## Verification and remaining device checks

`sh tests/native/run.sh` passes 26 existing export checks, all 630 existing preset checks, 460 project payload/transport checks, and 37 static native integration assertions. Both JS-produced v1/v2 fixtures pass Java's independent reader. Tests cover all byte truncation positions in the small fixture, hash/header corruption, UTF-8/duplicate/depth/number/name limits, source magic, exact lengths, bounded/canonical chunks, duplicate/out-of-order chunks, early/double finish, cleanup, and static owner/cancellation/recreation wiring.

Unsigned assemble/lint passed using the already-installed offline toolchain before the final unsafe-object-key hardening. The parent aggregate build/lint must validate this final frozen source.

These JVM and source assertions are not Android runtime evidence. Real-device/system-provider validation remains required for interrupted pickers, background/process death, provider cancellation/timeouts, partial destination writes, low storage, low memory, and supported Android/WebView combinations. No new signed APK or installation is produced by this work.
