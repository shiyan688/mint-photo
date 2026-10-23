# MintPaintLayer version 1

This isolated candidate contains a dependency-free UMD paint-layer core. It does not edit production files, sign builds, allocate keys, load photographs, or modify a photo. It renders a newly owned transparent layer only. The editor integration must separately composite that layer over an independent photo copy and publish only after every stage succeeds.

## Public API

The CommonJS export, AMD export, or browser global `MintPaintLayer` is frozen:

- `version`: numeric `1`.
- `LIMITS`: the frozen limits below.
- `defaults()`: a new deeply frozen `{version: 1, strokes: []}`.
- `validate(recipe)`: validates and copies a recipe, returning a deeply frozen canonical snapshot. `null` or `undefined` means the empty default. No input objects or arrays are retained.
- `hasPaint(recipe)`: validates the entire recipe, then reports whether any paint stroke has positive opacity. This is a structural possibility check, **not** a pixel-nonempty test. A following eraser can erase everything, a tiny subpixel brush may rasterize to zero coverage, and paint may be clipped at the border. Erase-only and zero-opacity-paint recipes return false.
- `plan(width, height, recipe)`: metadata-only full preflight. Returns a frozen object `{width, height, pixels, strokeCount, totalPoints, eraseWorkPixels, eraseTileCount, maxTilePixels}` without allocating a canvas. `maxTilePixels` is the actual reusable mask allocation area for this image, or zero if no positive-opacity erase exists. `eraseWorkPixels` counts all active erase bounding rectangles, including erase-only recipes, not just visibly painted pixels.
- `renderLayer(width, height, recipe, options?)`: synchronous full preflight, render, and ownership transfer. Returns the new transparent canvas, including for empty, erase-only, or fully erased results. It never returns null to signal no paint. It has no photo argument.

All methods revalidate their inputs. A valid result from `validate` can be reused, but it is never trusted as an unvalidated shortcut. `plan` and `renderLayer` use the identical preflight implementation.

### Recipe

```js
{
  version: 1,
  strokes: [{
    mode: 'paint',           // or 'erase'
    color: '#ff0055',        // required for both modes; eraser ignores color
    width: 0.02,            // diameter as a fraction of the source short edge
    opacity: 0.5,
    points: [{x: 0.2, y: 0.4}, {x: 0.8, y: 0.6}]
  }]
}
```

Every listed field is required as an own enumerable data descriptor. Unknown keys, symbols, hidden fields, accessors, inherited required values, sparse arrays, array extra fields, and unsafe prototypes are rejected. Plain objects with Object.prototype or null prototypes and arrays with Array.prototype or null prototypes are allowed. Class instances and foreign-realm prototypes are rejected; transfer serialized JSON across realms if necessary. Array indices must be dense own enumerable data descriptors.

Colors must be exactly seven characters, `#` followed by six hexadecimal digits; they are canonicalized to lowercase. Numeric fields must be finite actual numbers, without coercion. Coordinates and opacity are inclusive `[0,1]`; width is inclusive `[0.002,0.12]`. Every stroke has at least one point. Negative zero is canonicalized to zero. Duplicate points and zero-opacity strokes are retained in snapshots and count against recipe budgets. Every stroke keeps its own captured style; later toolbar changes have no effect on earlier strokes.

Getter bodies are not invoked by validation. JavaScript Proxy traps and modified language intrinsics are outside this defensive-data contract: this is not an execution sandbox for hostile active code.

### Options and canvas ownership

Only optional own enumerable function fields `createCanvas` and `shouldCancel` are accepted. Unknown fields, accessors, null options, and present-but-undefined functions are rejected.

`createCanvas(width, height)` must return a genuinely fresh, unshared, newly owned, correctly sized Canvas with a normal unclipped 2D context. Never return the photo canvas, a displayed preview, a previously published layer, or another caller's canvas. Core calls the factory once for the output and, if erasure is present, at most once more for a reusable mask. The mask dimensions may differ from output dimensions. A WeakSet rejects factories that return a previously issued canvas without disposing that previous owner's canvas.

Required context methods: save, restore, setTransform, clearRect, setLineDash, beginPath, moveTo, lineTo, arc, fill, stroke, getImageData, putImageData. Canvas-provided ImageData must expose correctly sized one-byte-channel RGBA data. Factories and Canvas methods are trusted implementation dependencies, not serialized recipe data.

The default factory uses `document.createElement('canvas')`; without document it uses OffscreenCanvas if available. No DOM, browser, canvas package, or network dependency is needed to load the module or call validate/hasPaint/plan. A non-browser runtime must provide a factory to render.

Drawing state is saved/restored, including transformation, compositing, opacity, styles, line geometry, dashes, filter, and shadows. A fresh default clip is a factory precondition: Canvas has no portable way to recover an arbitrary hidden clip. The current path is scratch state and is not preserved by Canvas save/restore. This causes no input-path loss because the API accepts only fresh owned canvases, not a caller's context.

## Geometry and exact compositing semantics

- A source point maps to `x * (width - 1), y * (height - 1)`. Normalized endpoints are the first/last source pixel positions, not width/height beyond the last pixel.
- Brush diameter is `stroke.width * min(width, height)` with no integer rounding or minimum-pixel clamp. Paths have round caps and joins.
- A single point, all-identical points, or points collapsing to one location in a one-pixel dimension are rendered as an actual filled disc. A multi-point gesture is one continuous path.
- Paint uses one native source-over path stroke or disc fill with globalAlpha equal to that stroke's opacity. There are no individual semi-transparent segment/point stamps. Separate overlapping gestures accumulate normally; self-overlap within one gesture does not repeatedly apply opacity.
- Erase implements the mathematical destination-out alpha result, **not native Canvas destination-out**. A whole opaque path is rendered once into each required coverage-mask tile with source-over and alpha 1. For each destination pixel, with existing alpha `A` and mask coverage byte `C`, the new alpha is exactly `round(A * (1 - opacity * C / 255))` before Canvas storage. RGB bytes in the ImageData buffer remain unchanged unless the new alpha is zero, in which case RGB is zeroed too. The edited ImageData is written directly with putImageData, which ignores draw compositing/globalAlpha. This is necessary because the installed native backend has a verified partial-alpha destination-out defect.
- Consequently an eraser never adds white or any color, never draws on the photo, and can only reduce this layer's alpha. A subsequent paint gesture can paint into an erased region normally. Clearing or erasing the layer reveals the separately composited backdrop; it does not erase that backdrop.
- Eraser bounds are the min/max source points, extended by brush radius plus two antialias pixels, rounded outward and clipped to the source image. The right/bottom edges are exclusive. The full path is redrawn with integer translation in every needed tile, not split into overlapping segments.
- The mask has fixed dimensions `min(imageWidth,1000) × min(imageHeight,1000)` throughout one render, including short final tiles. The same mask canvas is reset and reused. Reads and layer writes cover only the active rectangular part of each tile. Each destination pixel belongs to exactly one tile per eraser gesture, so opacity is applied once per gesture with no tile-overlap multiplication.
- Canvas clipping and antialiasing determine geometric coverage. Exact byte equality across browsers, native implementations, operating systems, different resolutions, or different tiling viewports is **not promised**. Likewise Canvas premultiplication/readback may requantize RGB at small alpha despite retaining the original RGB ImageData bytes. See verified limits below.

## Bounds, resources and cancellation

| Limit | Value |
| --- | ---: |
| Strokes per recipe | 128 |
| Points per stroke | 1024 |
| Total points per recipe | 8192 |
| Output pixels | 8,000,000 |
| Output longest edge | 4096 |
| Width fraction | 0.002–0.12 |
| Reusable mask pixels | 1,000,000 |
| Cumulative active erase bbox pixels | 32,000,000 |

Dimensions must be positive safe integers and satisfy both edge and area budgets. Limits cannot be raised through options. Every recipe, point, dimension, and cumulative work limit is checked **before any canvas allocation**. Zero-opacity erasers count toward stroke/point budgets but consume no erase work, masks, or readbacks. plan permits calling code to reject original/work-resolution export before other allocations; the application should also enforce a cumulative budget across multiple history operations.

Logical RGBA pixel storage is bounded by one output (up to 32 MB), one mask (up to 4 MB), and two tile ImageData buffers (up to 4 MB each), roughly 44 MB at the core's maximum. This is not a total-process memory guarantee: native/Canvas copies, renderer/GPU storage, JS GC lifetimes, photo input, composite output and other editor allocations are additional. Mask viewport resets and whole-path rasterization also have work beyond the 32M JavaScript alpha-update budget. Tile dimensions, point count and stroke count bound this work, but device latency and memory need real-phone validation.

`shouldCancel()` is checked before allocating output, before each stroke, before each mask tile, after native mask drawing, before each tile write, and after drawing-state restoration before return. A truthy result throws an Error named AbortError, code PAINT_LAYER_CANCELLED. A thrown callback error propagates. Native drawing calls and the bounded per-tile alpha loop are not interrupted midway. Rendering is synchronous and does not yield the browser event loop; cancellation cannot receive new user input while JavaScript is blocking.

No partially rendered layer is returned on cancellation or errors. Owned output and mask backing stores are disposed best-effort on allocation, context, readback, draw, write, or final-publication-check failures. Disposal tries both dimensions independently, sets browser dimensions to zero, then falls back to 1×1 on native implementations that reset zero dimensions to defaults. The original error is not masked by disposal failure. If a factory allocates internally and throws before returning its canvas, the factory owns that inaccessible allocation's cleanup.

Successful return transfers ownership to the caller. A later caller-side composition/publication failure is outside this API; the caller must release the returned layer. The core cannot dispose a result after ownership has transferred. Native draw/restore failures may report the native exception; invalid recipe/options use PAINT_LAYER_INVALID, bounds/work errors PAINT_LAYER_LIMIT, and invalid Canvas behavior PAINT_LAYER_CANVAS.

## Verification and honest platform limits

Frozen focused suite: **161 passing tests**, zero failures/skips with Node and the already-installed `@napi-rs/canvas` **0.1.100**. This comprises 140 data/ownership/metadata/call-contract checks and 21 real-native raster checks. See TEST_RESULTS.txt. No dependency installation is needed or was performed.

Verified native pixels include real discs, distinct per-stroke color/width/opacity, source-over accumulation, same-gesture nonaccumulation, exact center alpha for 0.25/0.5/0.75 erasers, repeated partial erasers, transparent erase-only layers, full erasure, paint-after-erase, backdrop reveal, straight-event-density byte equivalence, duplicate-point byte equivalence, endpoint mapping, layer cleanup, and source-sized geometry. Input immutability checks concern recipe ownership, not preservation of any real photograph by the separate editor integration.

Two important native limitations were independently isolated:

1. Native Canvas `destination-out` with opacity 0.5 leaves opaque alpha approximately 191 rather than 128. Opacity 0.25 leaves 239 rather than 191. Both globalAlpha and rgba source alpha reproduce this backend defect independently of MintPaintLayer. `native-compositing-repro.cjs` intentionally exits nonzero when this backend fails standards conformance; NATIVE_COMPOSITING_REPRO.json records it. The final core's coverage-and-alpha implementation avoids that defective compositing path and its partial-erasure tests now pass.
2. Rasterizing the same path into a tiled versus whole-size native viewport changes some antialiased edge coverage. The fixed reusable viewport does not eliminate this backend effect. In the recorded 1400×900 diagonal fixture, final alpha differs by at most 5/255; in a bent/self-crossing fixture with repeated partial erasure, at most 19/255. These are observed fixture-specific differences, **not universal bounds or byte-identical-edge passes**. The test suite explicitly labels and tests these tolerances. Fully covered interiors are exact: 140,988 and 307,966 independently compared flat interior pixels had zero mismatches, including tile boundaries. An additional explicit tile-crossing interior test has neither gaps nor excess erasure. See NATIVE_TILE_COMPARISON.json. General browser/phone antialiased-boundary appearance is still unverified.

Fourteen optional local Chromium pixel tests are provided in paint-layer.browser.test.cjs. The installed Chromium could not launch in this execution environment because of its process/socket restrictions, and the alternate supported launch path failed during environment setup. Thus these browser checks **did not run to assertion completion**. No browser, Android WebView, Android device, phone memory/latency, or signed-build acceptance is claimed. No further launch bypasses were attempted. The optional suite should be run through an approved working browser environment before such claims.

### Commands

Core plus optional native raster tests:

```sh
NODE_PATH=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules node --test tests/paint-layer-core.test.cjs
```

For aggregate pure and native checks without duplicate registrations or intentional skips:

```sh
PAINT_CORE_TEST_MODE=pure node --test tests/paint-layer-core.test.cjs
PAINT_CORE_TEST_MODE=native NODE_PATH=/path/to/installed/node_modules node --test tests/paint-layer-core.test.cjs
```

Pure mode registers exactly 140 pure checks and never loads the native package. Native mode registers exactly 21 real-raster checks and fails clearly if the installed package cannot be found. The default mode registers all 161 checks; only this default mode permits explicit native-test skips when the optional package is absent. The package declares no dependencies and does not download anything. PURE_TEST_RESULTS.txt and NATIVE_TEST_RESULTS.txt record the separate clean runs.

Actual browser/WebView tests remain unrun in this environment. No security or sandbox workaround was used.
