# Non-destructive project core

`app/src/main/assets/project-core.js` is a dependency-free UMD/CommonJS module. Browser global: `ProjectCore`. It does not decode images, render pixels, access storage, generate identifiers, or mutate inputs.

## API and record shape

- `makeProject({blob,name,width,height,mime,origin?}, ops=[], redo=[])` returns `{version:2,source,ops,redo}`. `source` contains the same six source fields; `origin` defaults to `original`.
- `restoreProject(record, {width,height}?)` restores a version 2 record, or migrates version 1 using the supplied decoded working-copy dimensions. Version 2 dimensions are never overwritten by this fallback. Future or corrupt schemas throw descriptive Chinese errors.
- `draftRecord(project)` validates and returns a detached record suitable for IndexedDB. The Blob object reference is unchanged. Operation/history objects and nested arrays are copied. IDs, timestamps, and revision control belong to the editor and are not synthesized or preserved by these five core APIs.
- `outputSize(source, ops=[])` returns `{width,height}` in operation order, using the source dimensions without reducing resolution. It validates operations but is not an allocation safety check.
- `planExport(source, ops=[], mode='working')` returns `{mode,input,output,steps,scale,usesOriginal,warning}`. `input`, `output`, and each entry of `steps` have `{width,height}`. `steps[i]` is the size after operation `i`.

Dimensions must be actual decoder-reported, EXIF-oriented dimensions, not raw EXIF width/height or an editor preview size. Source metadata and restore validation enforce the same import caps: 40 MiB encoded Blob and 80,000,000 source pixels. This pure module cannot establish that dimensions correspond to encoded bytes; the editor must do so on import and verify them again when decoding for export. Treat `source.blob` as readonly. Preserve the imported Blob bytes and never replace them with a PNG/JPEG generated from a preview. IndexedDB structured cloning may produce another Blob object, but must retain its bytes.

## Export behavior

Call `planExport` before full-resolution decoding. `original` requires a real nonempty Blob and origin `original`, and rejects source or intermediate canvases above 8,000,000 pixels or a 4096-pixel edge. It never silently downscales. The source check applies even if an early crop or ID-photo operation would reduce the eventual output. `working` starts with a longest edge of at most 2560; the renderer must honor the returned input dimensions. This does not authorize a decoder to allocate an arbitrary large full-resolution image first.

The 8 MP/4096 limits are a conservative implementation budget, not a device-validated safe-memory guarantee. Pixel buffers, decoder allocations, and temporary processing buffers can coexist. Actual Android device-memory behavior still requires separate testing.

Every crop rounds once at its position in the pipeline and keeps a minimum 1-pixel dimension. Rotation swaps the current dimensions. ID-photo operations retain their fixed output pixels in both modes; later operations continue from that fixed size. All intermediate dimensions are checked, not just the final output.

Version 1 stored a recompressed working image, not the original. It always migrates to `legacy-working-copy`, including after re-saving in version 2. Original export is unavailable for it; working export includes an explicit warning. Reimporting the original file is the only way to establish a new original source.

## Operation validation and scope

The supported operation types and fields match `editor.js` and `portrait-ui.js`: rotate, flip, crop, filter, adjust, text, sticker, draw, beauty, reshape, heal, warp, background, and idphoto. Unknown fields/types, nonfinite geometry, invalid parameter ranges, sparse arrays, and histories exceeding 60 total applied/redo steps are rejected. The stored redo array order is preserved, not executed or reversed.

Masks allow at most 262144 bytes and a 4096-pixel edge. Base64 encoding and exact decoded length are checked before any decoding. Byte arrays and Uint8/Uint8ClampedArray masks are copied to portable arrays. Drawing is limited to 512 strokes and 16384 total points per operation, healing to 64 spots, and liquify to 20 strokes. Face meshes contain 468 or 478 finite object points, allowing bounded off-frame positions reported by the detector without silently clamping them.

Run `node tests/project-core.test.cjs`. These are pure schema, cloning, byte-retention, geometry and budget tests, not Android decoder, Canvas, image-quality, persistence race, or device-memory verification.
