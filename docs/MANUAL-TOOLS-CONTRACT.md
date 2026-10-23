# Shared manual selection and liquify contract

Status: version 1; conventional deterministic image mathematics, not AI or a learned/SOTA retouching model. The browser, worker, native export and Android WebView must use the same `src/manual-tools.cjs` implementation. Browser global: `MintManualTools`. CommonJS: `require('./src/manual-tools.cjs')`.

## Public API

```js
validateSelection(recipe, { sourceRevision })
rasterizeSelection(width, height, recipe, { sourceRevision, shouldCancel? })
validateLiquifyCommands(commands, { sourceRevision })
liquify({ width, height, data }, commands, { sourceRevision, shouldCancel? })
```

Validators return independent canonical deep copies. They do not modify inputs. Treat saved command snapshots as immutable; edit the current selection or append a new command instead. Rendering validates/copies the complete recipe before using it, so a later change to the current selection cannot retarget a saved command. The rendering context source revision is required for any non-null selection and for liquify validation/rendering. A source revision is a nonempty string of at most 160 characters, with no ASCII control characters. Integer revisions must be converted by the caller to its stable string identity.

Recipe/command/point objects have exactly the fields below. Missing, extra, symbolic, non-enumerable, accessor, inherited or unexpected-prototype fields are rejected. Arrays must be dense, bounded and have no extra own fields; accessors are rejected before their getters run. All numbers must be finite and in range. Explicit `null` is meaningful; `undefined` is not its replacement.

### Selection recipe

```js
null // no restriction, not an empty selection

{
  version: 1,
  sourceRevision: 'immutable-original-revision',
  base: 'none',       // 'none' | 'all'
  inverted: false,    // boolean
  feather: 0.025,    // 0..0.1, fraction of image short edge
  commands: [
    { kind: 'brush', mode: 'add', radius: 0.08,
      points: [{ x: 0.3, y: 0.4 }, { x: 0.4, y: 0.5 }] },
    { kind: 'lasso', mode: 'subtract',
      points: [{ x: 0.4, y: 0.3 }, { x: 0.6, y: 0.3 }, { x: 0.5, y: 0.6 }] }
  ]
}
```

* `mode` is exactly `add` or `subtract`.
* Brush radius is `0.002..0.5` of the short edge. Brush paths have at least one point and are unions of round capsules between consecutive points, including the endpoints. A single point is a circular dab.
* Lasso paths contain at least three points and are implicitly closed. They must contain three noncollinear points: a normalized cross-product magnitude greater than `1e-12` is required. Duplicate-only and straight-line lassos reject. Self-intersecting paths use even-odd filling; valid bowties are not rejected just because their signed area cancels.
* All point `x`/`y` values are in `[0,1]`. Pixel-center positions are `x*(width-1)`, `y*(height-1)`. Radius and feather multiply `min(width,height)`, not a preview-specific scale.
* Brush/polygon boundaries are included. Integer pixel centers are the raster samples; hard selection edges are not separately anti-aliased.

### Selection composition and feather

1. Start with all zero (`base:'none'`) or all one (`base:'all'`).
2. Apply commands in order. Add is hard union, `mask=max(mask,shape)`. Subtract is `mask=mask*(1-shape)`. Each command's shape is binary; repeated overlapping segments of one stroke do not accumulate opacity.
3. Feather the composed result once, not each stroke independently.
4. Invert last: `mask=1-mask` when `inverted` is true.

Feather is a bounded, separable fractional box filter, horizontal then vertical, with clamped edge extension. For radius `r=feather*shortEdge`, offsets through `floor(r)` have weight one, offsets at `ceil(r)` have weight `r-floor(r)` when fractional, and the normalization is `1+2r`. Radius zero is exact identity. Uniform zero and one masks remain exact; feather has compact support rather than a Gaussian tail. This is an intentionally simple predictable feather, not an isotropic Gaussian.

`rasterizeSelection` returns `null` for unrestricted null selection, otherwise a new `Float32Array(width*height)` whose weights are in `[0,1]`. In particular, an explicit all-zero mask protects every pixel. Never test an empty selection by truthiness and replace it with null. Always replay the recipe at the actual target resolution; do not resize a preview mask for original-size export.

A subtracted shape is not a separate hard freeze mask: feather can soften its boundary. Exact exclusion is defined by the final raster weight being zero. If future UI needs a permanent hard protection/freeze region, it needs a separate contract.

For intuitive visible editing of an inverted current selection, the UI should swap the newly appended raw add/subtract mode. Starting an add stroke with no current recipe creates `base:'none'`; starting subtract from unrestricted creates `base:'all'`.

### Liquify commands

```js
{
  kind: 'push', // 'push' | 'restore'
  sourceRevision: 'immutable-original-revision',
  radius: 0.15,    // 0.002..0.5 of original short edge
  strength: 0.6,   // 0..1
  points: [{ x: 0.45, y: 0.5 }, { x: 0.55, y: 0.5 }],
  selection: null // or the independent complete selection recipe at stroke start
}
```

All six fields are required. There are no extra `id`, `enabled`, `opacity` or source-coordinate fields. A push needs two different points to move anything; a one-point/zero-length push is a legal identity. A one-point restore is a legal dab. Strength zero is exact byte identity.

The complete push polyline is resampled at fixed arc-length midpoint dabs with travel at most `0.35*radius`, carrying residual distance across pointer-event segment boundaries. Subdividing the same polyline into more collinear input points does not restart the dab grid or increase the effect/work. Each dab proposes an inverse displacement opposite its normalized drag vector, multiplied once by strength and the saved selection. The compact radial kernel is one inside half the radius, then falls with cubic smoothstep to exact zero at the outer radius. The displacement field is accumulated; image pixels are not resampled between strokes or dabs.

Restore computes the maximum smooth capsule coverage over its stroke and proposes `D_new=D*(1-strength*coverage*selection)` once for that stroke. It changes displacement toward identity, not the image toward a blurred prior image. A full-strength restore whose central half-radius plateau covers every displaced pixel returns the exact input bytes. A smaller/partial restore can be geometry-limited at its boundary and need not erase every affected pixel in one pass. Restore never adds displacement where there was none.

### Inverse-map geometry safety

The field maps destination `p` to immutable input `p+D(p)`. Each proposed increment is first clipped to keep grid-point source coordinates inside the input rectangle. A common step factor in `[0,1]` is then computed analytically for every horizontal and vertical neighbor edge affected by the dab, including a one-pixel halo. The positive root of `|a+t*b|² <= 0.44²` bounds the step. The target `0.44` includes a Float32 rounding margin below the public strict bound `0.45`. Extremely aggressive strokes may be limited or skipped instead of folding.

For bilinear interpolation of this grid displacement, each Jacobian column of `D` is a convex interpolation of neighboring displacement differences, each shorter than `0.45`. Therefore `||J_D||₂ <= sqrt(2)*0.45 < 1`. The continuous inverse map is orientation preserving and globally injective on the convex rectangle: it cannot fold. Its determinant has the conservative lower bound `(1-sqrt(2)*maxEdgeGradient)^2`. Cell boundaries are continuous and piecewise differentiable. Sampling coordinates are numerically clamped to the input rectangle only for floating-point/boundary safety; the displacement map itself is bounded before sampling.

After all pushes/restores, the core checks the final maximum edge difference and samples the immutable input exactly once with bilinear, premultiplied-alpha color interpolation. Destination alpha is copied exactly from the input, never warped. Fully transparent destination pixels retain their entire original RGBA bytes. Pixels with zero displacement retain their source bytes, including pixels excluded by every saved command. A command with zero selection weight does not erase edits made earlier under a different selection snapshot; it simply makes no new change there.

### Return value and diagnostics

```js
{
  width, height,
  data: Uint8ClampedArray, // independent RGBA result
  diagnostics: {
    totalSteps, limitedSteps, skippedSteps,
    maxEdgeGradient, minJacobianLowerBound, maxDisplacement,
    changedPixels, estimatedWork, estimatedMemoryBytes
  }
}
```

`maxDisplacement` is in target pixels. `changedPixels` counts changed RGB triplets in the final output, not intermediate field changes. Limits and their diagnostics are deliberate safety/quality constraints, not claims of unrestricted professional liquify behavior.

## Bounded resource use and cancellation

The exported frozen `LIMITS` currently contains:

| Bound | Maximum |
| --- | ---: |
| Pixels | 16,777,216 |
| Either image edge | 16,384 |
| Selection commands / total selection points | 128 / 4,096 |
| Liquify commands / total path points | 128 / 4,096 |
| Nested selection snapshot commands / points over one liquify render | 1,024 / 16,384 |
| Subdivided push dabs plus restore strokes | 8,192 |
| Conservative estimated work units | 800,000,000 |
| Estimated live pixel memory | 512 MiB |

Dimensions, counts, snapshot expansion, segment subdivisions, estimated region work and memory are checked before allocating pixel-sized output/field/mask arrays. Estimates intentionally reject pathological long paths, enormous selections or repeated wide strokes even when their point counts fit. Work units are a conservative workload proxy, not CPU instructions or a wall-clock deadline.

Liquify memory estimates include the caller-owned RGBA input, independent output, two Float32 displacement fields, a reusable Float32 brush-weight buffer, one reusable selection mask when required, one optional feather scratch mask, the scanline prefix, and 2 MiB for bounded metadata. The implementation does not retain a raster mask per historical command.

`shouldCancel`, if supplied, must be a function. A truthy return aborts with `name:'AbortError'`, `code:'MANUAL_CANCELLED'`, without mutating the input. It is checked before allocation, at command/dab boundaries and during pixel/scanline loops. The API is synchronous: queued browser events cannot run inside it. Worker callers should terminate stale jobs, or use an already-observable cancellation flag such as a supported atomic/shared flag; do not rely on an ordinary message updating a flag mid-call. Integration must disregard results from superseded generations.

Validation errors use `TypeError` with `code:'MANUAL_INVALID'`; work, memory and unexpected geometry failures use `MANUAL_WORK_LIMIT`, `MANUAL_MEMORY_LIMIT`, and `MANUAL_GEOMETRY`. Do not silently downscale an original-size export to evade a limit. Surface a useful error or let the user simplify edits.

## Replay, integration and quality scope

* Store normalized geometry and a stable immutable original-source revision. Desktop schema integration uses nullable `manualSelection` and arrays `manualLiquify`/`manualRepair`.
* Save an independent selection recipe for every effect command at gesture start. Later current-selection changes are not retroactive. User undo/redo removes/adds recipes and replays from the source, not from an already rasterized result.
* Coordinate overlays belong to an original-coordinate editing view. Do not pretend original-coordinate paths automatically track a subsequent face reshaping operation.
* Agreed integration order is base retouch/tone/local color layers, then shared liquify, then explicit repair/clone, then background/automatic facial reshaping. The input to liquify is immutable for that replay, not necessarily the raw unadjusted photo.
* Radius/point fractions replay at full size. Raster quantization and adaptive safety limiting can cause small preview/original differences; arbitrary-resolution outputs are not asserted byte-identical.
* This is a conservative raster inverse-displacement editor. It does not perform learned face reconstruction, optical flow, semantic-aware selection, texture synthesis or professional blemish healing. Healing and explicit-source cloning have a separate shared repair-core contract.

## Tests and reproducible pixel evidence

Run:

```sh
node --test tests/manual-tools.test.cjs
MANUAL_TOOLS_EVIDENCE_DIR=/tmp/mint-manual-evidence node --test tests/manual-tools.test.cjs
```

The optional evidence case uses the repository's existing `sharp` dependency to write `original.png`, `selection.png`, `pushed.png`, `restored.png` and `pixel-evidence.json`. The fixture is generated coordinate ramps and a checkerboard, not a private or downloaded image. It proves a real non-identity push and byte-exact full restore, rather than only UI control availability.

Current synthetic fixture is 257×193. The initial verified run changes 2,170 pixels; its maximum displacement is 3.995619 pixels, maximum edge gradient 0.439999875, and determinant lower bound 0.142692199. Full restore changes zero pixels and has zero displacement. Source and restored raw RGBA SHA-256 both equal `5639d4a0f209a90b8fd8f3cb21a24832a9da8d356d27f1fc3511f133c42cf00f`. Re-run after any algorithm change rather than treating these numbers as timeless quality claims.

Coverage includes circle/capsule and curved-path boundaries; polygon boundaries and bowties; null versus explicit empty masks; ordered add/subtract, compact feather and invert; strict validation, snapshots and revision mismatches; budget rejection; exact alpha/mask exclusion/zero-strength identities; immutable-input interpolation; full and partial restore; aggressive crossing deformation and positive geometry bounds; preview/original geometry scaling; narrow images; UMD loading; and cancellation without input mutation. Additional independent QA is maintained separately.

A local synthetic performance check also exercised 12000×1000 geometry and 4096×4096 (16 MP) feathered selection plus a small push. The 16 MP case estimated 471,891,976 live bytes and completed in about 0.85 seconds on that executor. This is a single development measurement, not an Android/device performance guarantee. A separate deterministic stress pass covered 100 random images / 1,600 commands with maximum observed neighbor-field difference 0.440000185 and exact alpha preservation.
