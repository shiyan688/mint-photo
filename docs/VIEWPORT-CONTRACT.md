# Preview navigation contract

`viewport.js` exports UMD `MintViewport`. It is display math only, not a project schema or pixel processing module. The normalized center convention follows the desktop reference comparison math, with independent stricter mobile bounds.

- `defaults()` → `{u:0.5,v:0.5,zoom:1}`.
- `validate(view)` requires own plain data fields, finite u/v in0..1 and zoom1..8. No accessors, inherited/unknown fields or coercion.
- `layout(view,image,pane)` → `{left,top,width,height,scale,fitScale,view}`. Images: integer dimensions≤4096 and≤8,000,000px. CSS panes: finite positive dimensions≤100000. An image axis smaller than the pane stays centered; larger axes clamp to keep the pane covered. The returned canonical view is an independent record.
- `pan(view,{x,y},image,pane)` uses CSS pixel displacement, positive x/y moving the image right/down.
- `zoomAt(view,nextZoom,anchor,image,pane)` accepts absolute next zoom, preserving the focal image coordinate when boundary constraints permit.
- `pinch(view,startAnchor,currentAnchor,factor,image,pane)` always uses the initial gesture view, not incremental rounding. It combines centroid translation with scale. Zoom is bounded.
- `mapPoint(view,point,image,pane,{clamp:true})` returns continuous normalized current-image edge coordinates. With clamp:false, points outside the image return null. This is not integer source-pixel addressing.

`viewport-ui.js` exports `MintViewportUI.create(adapter)` with `refresh/reset/cancel/handle/setZoom/setMode/state/release`. Adapter owns nodes, source geometry, DOM display layout, cursor, capture and cancellation of the editor's provisional stroke. The controller never reads canvas pixels or writes a project. `cancel(false)` preserves active-touch exclusivity; `cancel(true)` ends an abandoned browser lifecycle. Stored callbacks are inert after release.

Stage capture and overlay bubbling call the same `handle(event)`; a WeakMap ensures each event object is processed once. All multi-pointer gestures cancel the original provisional edit, and no remaining single pointer transitions back into editing. More than8 active coordinate points latches fail-closed recovery, with at most64 recorded pointer IDs. Over64 requires lifecycle cancellation. No navigation state is imported from/exported to photo recipes.
