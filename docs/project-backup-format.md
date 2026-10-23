# Single-project portable backup v1

The mobile codec is `app/src/main/assets/project-backup.js`, exposed as the UMD/CommonJS `MintProjectBackup` module. It uses no network, image decoder, canvas, database, native bridge, external dependencies, or `crypto.subtle`.

## Binary envelope

The file extension is `.mintproject`; the emitted MIME is `application/vnd.mint.photo-project`. A file's MIME or filename is not evidence of validity.

All lengths are unsigned little-endian 32-bit integers. The envelope contains exactly these bytes, with no trailing data:

| Offset | Length | Content |
| --- | --- | --- |
| 0 | 8 | ASCII `MINTPRJ1` |
| 8 | 4 | Manifest byte length |
| 12 | 4 | Source byte length |
| 16 | 32 | Raw SHA-256 of manifest bytes |
| 48 | 32 | Raw SHA-256 of source bytes |
| 80 | manifest length | Strict UTF-8 JSON manifest, no BOM |
| 80 + manifest length | source length | Unchanged source image bytes |

Whole-file limit: 64 MiB, including the 80-byte header. Manifest: 1 byte to 24 MiB. Source: 1 byte to 40 MiB. Consequently, the individual maxima cannot both be used simultaneously. `LIMITS.totalBytes` and `LIMITS.maxBytes` refer to the whole-file limit.

SHA-256 provides corruption detection only. Anyone who changes the file can recalculate these hashes. A backup is not signed, authenticated, or encrypted.

## Manifest schema

The manifest has exactly four own fields:

```json
{"format":"mint-photo-project","version":1,"name":"Project name","record":{}}
```

The project name is NFC-normalized and trimmed, contains 1–80 Unicode code points and at most 320 UTF-8 bytes, and excludes C0/C1, bidi controls, line/paragraph separator controls, and malformed Unicode. Export normalizes a valid caller name using `MintProjectLibrary.normalizeName`; import requires that the name is already canonical.

The v2 record is exactly the current `ProjectCore.draftRecord` shape:

```json
{"version":2,"source":{"blob":null,"name":"photo.png","width":3,"height":2,"mime":"image/png","origin":"original"},"ops":[],"redo":[]}
```

`origin` is `original` or `legacy-working-copy`. The native Blob is carried only in the source byte region. Width and height describe the editor's decoded, oriented original. For JPEG, the raw header dimensions may be swapped. Other supported formats must match the raw header dimensions. Source MIME must match the detected image format or be `application/octet-stream`.

A v1 legacy record is exactly:

```json
{"version":1,"blob":null,"name":"old-working-copy.png","ops":[],"redo":[]}
```

The export input may omit the legacy name, ops, and redo fields, which are filled using ProjectCore's existing defaults. The wire format always contains all five fields. Legacy records remain v1 on decode. The codec invokes ProjectCore with header dimensions only to validate legacy operations, and discards its temporary v2 result. The editor must migrate only after it has decoded the actual image, retaining `legacy-working-copy`. No original resolution is fabricated.

Unknown fields, including old incidental autosave timestamps such as `when`, are rejected rather than silently stripped or transferred. Invalid operations and unsupported operation versions fail through the real ProjectCore validator. A structural retention check catches nested fields that a canonical validator would otherwise ignore. History and redo are validated together under the current 60-step and embedded-asset budgets.

This project format deliberately retains background masks, meshes, selected-person context, embedded RGBA image/collage assets, and source bytes. It is not the stripped, transferable adjustment-preset format. Transient/unapplied UI preview is not part of a project record and must not be inserted by the host.

## APIs

```js
const codec = MintProjectBackup.createCodec({
  projectCore: ProjectCore,
  projectLibrary: MintProjectLibrary
});
const blob = await codec.encode(record, { name, shouldCancel });
const { name, record, sourceSha256, manifestSha256 } =
  await codec.decode(blob, { shouldCancel });
```

`encode` synchronously snapshots all record data and its name/cancellation options before its first asynchronous boundary. Config, dependency methods, and per-call options must be own enumerable data properties; inherited values, accessors, and unknown option fields are rejected without invocation. It does not mutate the input or invoke record accessors/toJSON methods. It rejects custom prototypes, hidden/symbol fields, sparse/extended arrays, cycles, functions, undefined, malformed Unicode, and nonfinite numbers. Source Blob identity is checked through native Blob getters and it is copied with native Blob slicing, avoiding overridden instance methods/getters. Both APIs return independent record/data snapshots; native immutable source bytes are never recompressed or expanded to base64.

`inspectHeader(bytes, totalBytes)` accepts exactly 80 bytes as a Uint8Array, validates limits and exact total length, and returns manifest/source lengths plus both hashes as lowercase hex. `sha256Blob(blob, { shouldCancel })` hashes up to 64 MiB and returns a lowercase hex string. It reads at most 1 MiB per chunk and yields to the event loop between chunks. These helpers are intended for boundary tests and cross-language fixtures, not authentication.

Cancellation uses `PROJECT_BACKUP_CANCELED`. Source/type/dimension/parser/checksum errors reject without editing external state. The codec has no storage or host-switch side effects.

## Parser and source boundaries

The strict parser rejects duplicate keys (including escaped aliases), `__proto__`, `prototype`, `constructor`, malformed escapes/Unicode/UTF-8, invalid JSON number syntax, nonfinite numbers, and nonzero numeric literals that underflow to zero. Bounds: root depth 0, maximum depth 64; 2,000,000 value nodes; 256 UTF-8 bytes per key; 6 MiB UTF-8 per decoded string; 24 MiB combined decoded string/key bytes; 128 characters per number token. Valid finite doubles are not rejected solely for exceeding JavaScript's safe-integer range; field-specific integer/range constraints belong to ProjectCore.

Source preflight supports PNG, ordinary 8-bit JPEG (SOF0/1/2), and static WebP. It bounds source dimensions at 80,000,000 pixels and 1,000,000 per edge, limits container chunks/markers to 4096, validates container framing and image dimensions, rejects PNG/WebP animation and duplicate JPEG/WebP image frames, and requires complete container endings. It uses bounded 64 KiB windows rather than reading an entire source into an ArrayBuffer. PNG CRC/decompression and JPEG/WebP pixel decoding are left to the actual host image decoder; passing preflight does not guarantee successful decoding.

The host must still decode the source, check decoded dimensions, validate/render the entire ordered project, and only then perform its atomic durable/current-project switch. Native streaming validation does not replace these JS/image checks. Never derive a filesystem path, URL, network request, or external asset lookup from image or manifest bytes.

## Privacy and verification

A backup contains the original imported image, including any original EXIF metadata, and potentially private facial coordinates, masks, and embedded images. Do not present it as encrypted or as a source-free preset. A system document provider chosen by the user may itself sync files to the cloud; the codec does not make network requests.

Run:

```sh
node --test tests/project-backup.test.cjs
```

The deterministic v1/v2 reference envelopes are in `tests/fixtures/project-backup/`, with adjacent JSON byte counts and independently checkable SHA-256 values. They contain only a self-authored 3×2 solid-color PNG and synthetic operations. Tests cover SHA standard/random/block/chunk vectors, all supported image formats, a real bundled PNG, legacy semantics, full project data preservation, maximum-size embedded asset, parser bounds, corruption/unknown fields/UTF-8/image-header attacks, hostile exports, independent snapshots, cancellation, and a browser-style realm without crypto/encoder APIs. These tests do not claim Android UI, file-provider, or actual image decoder QA.
