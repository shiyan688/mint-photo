# Android Levels UI contract

`app/src/main/assets/levels-ui.js` exposes `window.LevelsUI`. Load the byte-identical shared `levels.js` before it. The module does not implement pixel equations, automatic settings, detection, histogram allocation, or a separate export formula.

## Public API

- `setup(adapter, initialRecipe = null)` releases prior controls, validates and copies a supplied recipe, or uses neutral core defaults when the argument is omitted/null. It stores and returns `{type: 'levels', recipe}`. Invalid inputs/missing core clear the draft and display an error, never a substituted successful effect.
- `release()` invalidates the session and detaches owned handlers without changing the draft or source. Captured callbacks remain inert after release or re-entry.
- `changed(draft)` returns false for absent/unrelated drafts, otherwise delegates activity and validation to `MintLevels.isActive`. A missing core or invalid Levels recipe throws rather than silently dropping an operation.
- `apply(canvas, draft)` validates the recipe and dimensions, reads the passed processing canvas, applies the shared core using exactly `{width, height, data}`, and reuses the readback ImageData for publication. Neutral/disabled recipes do not write pixels. Return value is the same canvas. Replay after `release()` does not require an adapter, controls, or UI state.

Android's processing boundary is **8,000,000 pixels and 4,096 pixels per edge**, checked before canvas readback. This is intentionally more conservative than the shared core's desktop-capable ceiling. No image-sized scratch buffer is retained by the UI; active processing adds the core output to the canvas readback, not a third UI ImageData.

## Adapter and rendering

Required adapter methods match AdvancedToneUI: `getDraft`, `setDraft`, `getCanvas`, `render`, `toast`, and `hint`. Optional `revision()` supplies a stable primitive photo/project revision. `getCanvas()` supplies the stable, unchanged committed baseline during this editing session.

`render()` must create a fresh processing copy of that committed baseline for each preview and pass the copy to `apply`. Never pass the previous adjusted preview. The UI never applies effects itself during control edits or touches source pixels; `apply` additionally rejects the currently live baseline canvas by identity. The normal ordered history/export pipeline likewise supplies its processing canvas, not the original source asset.

The current draft identity, baseline canvas identity/dimensions, optional revision, panel, originating control and handler are checked before an edit. Once a draft/photo/revision mismatch is observed, that session cannot revive. Field and current-channel reset handlers capture their channel and are replaced on synchronization, preventing queued callbacks from a prior channel from editing the new selection. Nested preset editors should call `release()` on exit and have `getDraft()` return null when their parent session is inactive.

## Controls

- `levelsChannel-rgb`, `levelsChannel-red`, `levelsChannel-green`, `levelsChannel-blue` select independently stored channel controls. Selection alone does not render or mutate the recipe.
- `levels-inputBlack`, `levels-inputWhite`, `levels-gamma`, `levels-outputBlack`, and `levels-outputWhite` are sliders for the selected channel. Each has a paired `-number` precise numeric entry committed on change.
- `levelsStrength` and `levelsStrength-number` use the actual **0–1** recipe scale, not a 0–100 percentage.
- `levelsResetChannel` resets only the selected channel, retaining other channels and strength.
- `levelsReset` restores all channels and strength to neutral defaults. Strength zero also gives explicit bypass while retaining the channel settings.

Black/white points remain integers in 0–255, input black is strictly below input white, output black may equal output white, gamma is 0.1–10 and strength 0–1. Point slider/numeric bounds track the opposite point. Precise gamma/strength entry supports values between slider steps. Invalid strings, non-finite numbers, out-of-range values and invalid point relationships leave the last valid recipe and preview unchanged; they are not clamped or coerced into valid edits. Identical edits do not replace the recipe or request another render.

No histogram is presented by this module. Existing histogram UI must not describe a reduced preview as full-resolution source statistics.

## Focused verification

Run `node --test tests/levels-ui.test.cjs` without installing dependencies. These are controlled DOM/canvas tests using the actual packaged core in a VM, not Android/WebView or device tests. They cover real exact pixel output, master/channel order and the 26→13 precision regression, all alpha bytes and hidden RGB, extrema/equal outputs, neutral/bypass, reset, strict validation, stale callbacks, source preservation, non-accumulating previews, memory-boundary rejection, and replay after release. Exact budget boundaries are checked without allocating maximum-size frames.
