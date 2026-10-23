# MintCollageLayout v1 integration contract

Candidate-only implementation. The worker does not edit app integration files.
`collage-layout.js` is zero-dependency UMD: CommonJS, AMD, or browser global
`MintCollageLayout`. It uses no DOM, Canvas, images, files, networking, timers,
typed pixels or pixel buffers. The API and public `LIMITS` record are frozen.

## API

- `defaults(count = 2)` returns a fresh, recursively frozen complete recipe for
  2–4 cells. `undefined` count uses 2. Other invalid values are rejected.
- `validate(recipe)` strictly validates and returns a fresh recursively frozen
  canonical recipe. It never supplies missing fields or mutates input.
- `plan(sourceSizes, recipe, options?)` validates the full authored output and
  every source, computes geometry, and returns a recursively frozen plan.
- `hitTest(plan, {x,y})` accepts a plan returned by this module instance and a
  strict own-data normalized point. It returns a zero-based cell index or `null`
  for gutters/outside. Fit letterboxes still belong to their full cell.

Separate calls return independent objects/arrays throughout. A source input,
recipe input, other result or other cell cannot mutate an existing snapshot.
Primitive values such as strings are naturally shared. Inputs are never frozen
or mutated by this module.

## Strict schemas

Every recipe field is mandatory:

```js
{
  version: 1,
  width: 1600,                 // integer 256..4096
  height: 1600,                // integer 256..4096
  layout: 'grid',              // 'horizontal' | 'vertical' | 'grid'
  gutter: 0.02,                // finite 0..0.1, proportion of short output edge
  background: {
    color: '#ffffff',          // exactly # and six RGB hexadecimal digits
    opacity: 1                // finite 0..1, including fully transparent
  },
  cells: [                    // dense ordinary array, exactly 2..4 entries
    { fit: 'fill', x: 0.5, y: 0.5 },
    { fit: 'fill', x: 0.5, y: 0.5 }
  ]
}
```

The shown two-cell recipe is the exact default. Each cell requires `fit` equal to
`'fit'` or `'fill'`, and finite normalized `x` and `y` in 0..1. All values are
validated even when background opacity is zero or a fit mode ignores focus.
Hexadecimal color may arrive in either case; the snapshot canonicalizes it to
lowercase. Shorthand, alpha hex, CSS names, whitespace, newlines and boxed strings
are rejected. Negative numeric zero canonicalizes to positive zero.

`sourceSizes` is a dense ordinary 2–4 entry array matching recipe cell count:

```js
[{ width: 1600, height: 1200 }, { width: 1024, height: 768 }]
```

Each source record has exactly `width` and `height`, positive integers:

- Source 0 is the current input: each edge ≤4096, area ≤8,000,000 pixels.
- Sources 1–3 are already-decoded, oriented and bounded working assets: each edge
  ≤1024, area ≤1,048,576 pixels. Import/downsampling happens outside this core.

Options are `{}` or exactly `{maxSide: integer}` with `maxSide` in 1..4096. Omitting
options or passing `undefined` uses full authored size. An own `maxSide: undefined`
is invalid, as are inherited options, unknown fields, `null` or implicit coercion.

Every record must be an ordinary local Object or a null-prototype object with
exact allowed **own enumerable data properties**. Missing/extra fields, symbols,
hidden fields, accessors, inherited fallback properties, class/custom/array
prototypes and foreign-realm records are rejected. Values are read from own
property descriptors; ordinary getters are not executed. Optional properties are
used only when they exist as valid own data fields. A getter named `maxSide` on
Object.prototype is not consulted.

Arrays must have the local Array.prototype, exactly the allowed own `length` and
indexed fields, and no holes, symbols, non-enumerable indices, custom fields or
accessors. Frozen dense arrays remain valid. Cross-realm arrays are rejected.

Portable JavaScript cannot detect every transparent Proxy without executing its
reflection traps. Proxies/executable hostile objects and modified native JS
intrinsics are outside the plain-data contract. JSON-parsed data is the intended
portable replay boundary. Reflection over an enormous malformed object's own
keys can itself cost memory; the bounded schema is not a sandbox for adversarial
arbitrary executable objects or unbounded object graphs.

## Authored output and preview

Authored `width*height` must be ≤8,000,000 pixels, even when asking for a tiny
preview. `validate` performs this full output-budget check before `plan` reads
source sizes or preview options. Source budgets also apply to every preview.

Without `maxSide`, output dimensions exactly equal the authored dimensions. With
`maxSide` smaller than the authored long edge, use the common scale
`maxSide / max(width,height)`, round each dimension to the nearest integer, then
clamp each to at least 1. Preview never upscales. Aspect is preserved up to
unavoidable integer rounding, most visible at tiny dimensions.

Gutter is `round(min(outputWidth,outputHeight) * recipe.gutter)`, calculated at the
actual output size. The same integer gutter applies to all outer edges and inner
separators. Every cell must contain at least one whole output pixel in each
dimension. An impossible layout throws instead of creating empty/negative cells
or silently changing layout/gutter. For example, all 1×1 previews are impossible;
a zero-gutter 2×2 preview can hold a four-cell grid.

## Cell layout

All cell edges and dimensions are integer output pixel edges. After subtracting
outer and inner gutters, split remaining width/height using integer division.
Each remainder pixel goes to the earliest left/top segment until exhausted.
Cells never overlap, go outside the canvas, or leave an unused template slot.

- `horizontal`: one row of N cells, in input order, each full content height.
- `vertical`: one column of N cells, in input order, each full content width.
- `grid`, 2 cells: two full-height columns.
- `grid`, 3 cells: input 0 occupies the full-height left column; inputs 1 and 2
  occupy the top-right and bottom-right half-height cells. The left cell has no
  horizontal separator or blank fourth quadrant.
- `grid`, 4 cells: 2×2, row-major input order.

## Fit, fill and focus

Rectangles use continuous pixel **edges**, as accepted by the nine-argument
Canvas `drawImage(image,sx,sy,sw,sh,dx,dy,dw,dh)` overload. They are not texel-center
indices. Source spans `[0,width] × [0,height]`.

- `fill`: destinationRect is exactly the entire cellRect. Crop the source to the
  cell aspect while retaining the largest possible source rectangle. Set the
  cropped dimension's offset to `(sourceDimension − cropDimension) * focus`.
  Focus 0, 0.5 and 1 align the crop to the start, exact center and end of the
  available crop travel. Uncropped axes have zero offset. SourceRect edges may be
  fractional. This is normalized crop-travel alignment, not a semantic point that
  is always centered, face detection, or segmentation.
- `fit`: sourceRect is the entire source. Uniformly scale to fit inside the cell
  and center the letterbox in both axes. Focus remains validated but is ignored.
  DestinationRect edges may be fractional to preserve source aspect exactly.

Cell rectangles are always integer; fill destination rectangles are integer;
exact-fit destination rectangles are integer when their aspect permits it. There
is no independent x/y scaling or source stretching. Fit areas outside the image
show the caller-rendered background. Source alpha remains the renderer's concern.

## Plan output and estimates

```js
{
  outputSize: { width, height },
  gutterPixels,
  cells: [{
    sourceRect: { x, y, width, height },
    destinationRect: { x, y, width, height },
    cellRect: { x, y, width, height }
  }, ...],
  estimates: {
    authoredPixels, authoredOutputBytes,
    outputPixels, sourcePixels, cellPixels,
    sourceBytes, outputBytes, residentRgbaBytes,
    extraBytes, workPixels
  }
}
```

Let `A=authored width*height`, `P=actual output width*height`, `S=sum(source areas)`,
and `C=sum(cell areas)`. The scalar estimates are:

- `authoredPixels=A`; `authoredOutputBytes=4*A`.
- `outputPixels=P`; `sourcePixels=S`; `cellPixels=C`.
- `sourceBytes=4*S`; `outputBytes=4*P`.
- `residentRgbaBytes=4*(S+P)`, logical decoded source/output bytes.
- `extraBytes=65,536 + 4*(2*S+3*P)`, conservative modeled buffer allowance: two
  copies of every source plus three output-sized buffers and small-plan overhead.
  It intentionally overcounts an adapter that releases secondary canvases one at
  a time and does not depend on garbage collection between cell draws.
- `workPixels=S+P+16*C`, modeled source traversal, background traversal and an
  allowance of sixteen filter taps per cell output pixel, including letterboxes.

The planner itself never allocates these pixel buffers. `extraBytes` and
`workPixels` are conservative **planning models**, not hard upper bounds for
arbitrary native Canvas implementations, OS memory usage, CPU instructions or
wall-clock latency. Native decoding, native filtering, GPU surfaces, IPC buffers,
original full-resolution imports, pixel/string histories and encoders can have
additional costs. No cross-platform Canvas resampling byte identity is promised.
The parent must bound its actual pipeline and handle allocation/decoding failures.

For maximum output plus a maximum primary and three maximum secondary sources,
`A=P=8,000,000`, `S=11,145,728` and modeled `extraBytes=185,231,360` (~176.65 MiB).
This is a scalar estimate, not a reserved allocation. Geometry work and retained
plan state remain O(N) with N≤4; no image-sized geometry arrays are created.

## Hit testing

Points must be exact own-data `{x,y}` with primitive finite numbers. Finite outside
coordinates are valid queries and return null, never clamp to a cell. Left/top
edges are inclusive; right/bottom edges are exclusive. In particular `x=1` or
`y=1` is outside. A gutter-free shared edge selects the cell to its right/bottom.
The hit zone is the entire cell, including a fit letterbox.
Comparisons stay in normalized coordinates rather than multiplying the point
back into pixels, avoiding boundary roundoff such as `(85/261)*261 < 85`.

Only unchanged plan objects returned by this module instance are accepted. A
private WeakSet provides authentication without retaining plans strongly; a
serialized/cloned/forged plan is rejected before its properties are read. Replan
after deserializing a recipe. No user property getter on the point is invoked.

## Error and renderer responsibilities

- TypeError with `code='COLLAGE_LAYOUT_INVALID'`: schema, primitive type,
  unsupported enum/version, source count or plan identity errors.
- RangeError with `code='COLLAGE_LAYOUT_LIMIT'`: finite numeric bounds, integer,
  edge/pixel budgets, or impossible nonempty cell layout.

Failures do not mutate any input or return partial plans. This synchronous O(4)
core has no cancellation callback because it performs no image-sized work.

The renderer must independently validate snapshot data, initialize a clean
transparent output canvas, fill the authored background once with its requested
opacity, restore drawing opacity to 1, and draw each validated image with its
planned source/destination edges. It must preserve normal alpha source-over,
clear canvas state between operations, clean up temporary surfaces on any
failure/cancel, and avoid exposing partially composed output. Image import
authorization, orientation/downsampling, asset storage, UI, recipe/history
capture, preview staleness, export and device compatibility are parent concerns.

## Verification

Run `node --test collage-layout.test.cjs` from this directory. The suite covers
UMD entry points, exact defaults/limits, recursively frozen independent snapshots,
required/unknown/hidden/symbol fields, getter/prototype/array attacks, inherited
optional maxSide, alpha schema, source limits, authored output limits before
preview, no upscaling, one-pixel impossible layout, all templates, three-cell
complete coverage, odd-size exhaustive remainders, exact centered fill, continuous
source-edge crop, centered fit aspect, hit boundaries/gutters/letterboxes, actual
maximum dimensions without typed/native pixel allocation, and 3,000 seeded random
layout invariants. Native Android rendering and app integration are not tested by
this isolated core suite.
