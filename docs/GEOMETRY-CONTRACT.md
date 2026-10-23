# Shared integer geometry contract v1

Global `MintGeometry` (UMD/CommonJS). This module copies RGBA8 pixels, never interpolates or changes color. Operation order is crop → clockwise quarter-turn → horizontal/vertical flip in the **output axes**.

## Recipe and API

`{version:1,crop:{x,y,w,h},quarterTurns:0|1|2|3,flipX:boolean,flipY:boolean}`. Crop values are normalized pixel **edges** in the incoming image; x/y ≥ 0, w/h > 0, both end edges ≤ 1. All fields are mandatory in non-null recipes. `null` means identity. Unknown fields, nonfinite values, getters, symbols, hidden fields and non-plain records fail closed. Returned recipes are independent snapshots.

- `defaults()`, `validate(recipe|null)`, `isActive(recipe|null)`.
- `plan(width,height,recipe)`: no pixel allocation. Returns `{sourceSize:{width,height},crop:{x,y,width,height},outputSize:{width,height},quarterTurns,flipX,flipY}`.
- `apply({width,height,data},recipe,{shouldCancel}?)`: exact RGBA8 `Uint8Array` or `Uint8ClampedArray`; returns a new `{width,height,data:Uint8ClampedArray}`. Input is immutable; alpha and hidden RGB are copied exactly. Canvas callers must wrap native ImageData into the plain three-field record. Canvas decoding/premultiplication behavior is outside this pure-core guarantee.
- `mapPoint(width,height,recipe,{x,y},direction='forward')`: continuous **pixel-center coordinates**, integer 0 denotes first pixel center. Valid center domain is 0…dimension−1. Forward maps incoming-image centers to displayed output; inverse returns source centers. Outside retained crop/output returns `null`.
- `mapEdgePoint(...)`: same signature, but closed continuous **pixel-edge coordinates**, valid 0…dimension. Maps rectangle boundaries/corners. Do not mix its convention with pixel centers or normalized landmark coordinates.

## Quantization and limits

Integer crop left = round(x × W), right = round((x+w) × W), likewise top/bottom. Left/top clamp to valid source pixels; right/bottom clamp to source bounds, with at least one retained pixel. Both boundaries are quantized once. Extent is **not** independently rounded; no half-pixel sampling, padding, scaling or resampling. Independent preview and full-size plans may differ by one pixel of quantization; normalized framing remains the saved intent.

For aspect-ratio UI that promises exact output dimensions, snap its chosen rectangle/extent to the original integer grid before serializing normalized crop values. Nominal ratios alone cannot guarantee exact integer ratios at every preview resolution.

Metadata plan max edge 32,768 / 80,000,000 pixels, allocation-free. Pixel apply max 67,108,864 pixels (64 Mi-pixels), same edge limit. Applications retain their stricter export/memory budgets (Android 8,000,000 original pixels). The core's input+output memory is not a whole-application peak-memory guarantee. Cancellation checked before allocation, every 16 output rows, and before return. Aborted output is never exposed; source remains intact. A synchronous caller cannot promise immediate UI-thread interruption.

## Application integration is deliberately different

Android retains immutable source Blob and an ordered raster history. New commands are `{type:'geometry',recipe}` at their exact history position; manual strokes and face landmarks belong to the incoming canvas at their own step. Re-detection after a committed geometry step is required. Legacy crop/rotate/flip retain their prior renderer and saved meaning.

Desktop uses its own final framing stage after original-space edits. Existing masks/strokes remain original-space. Manual editing must use the unframed image or rigorously inverse-map via this API. Do not feed a framed preview into original-space tools. Project file formats are not interchangeable.

When editing an aggregated desktop recipe, a visible clockwise right-turn after an existing output-axis flip changes `quarterTurns=(quarterTurns+1)%4` **and swaps flipX/flipY**. Merely incrementing q rotates in a different space. Independently sequenced Android operations do not need this swap.

No EXIF reinterpretation is performed here. Source dimensions/pixels must already use the decoder's oriented image.
