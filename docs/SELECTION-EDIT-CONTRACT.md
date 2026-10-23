# Visible selection edit construction, v1

`selection-edit.js` / UMD `MintSelectionEdit` is a command-construction adapter,
not a rasterizer and not a migration of saved selections.

`const E = MintSelectionEdit.createEditor(MintManualTools)` captures the existing
strict `validateSelection` implementation. It requires that authoritative core.

- `E.append(recipeOrNull, command, {sourceRevision})` returns an independent
  existing v1 selection recipe. A new add from null starts with `base:'none'`;
  a new subtract from null starts with `base:'all'`. When the current recipe is
  inverted, only the new command's mode is swapped. This makes UI add/subtract
  refer to the visible selection, rather than the hidden pre-inversion mask.
- `E.setFeather(recipeOrNull, fraction, {sourceRevision})` keeps null unrestricted;
  otherwise returns a new validated snapshot with feather 0..0.1. UI should ask
  for a selection before changing feather, not silently create an empty mask.
- Commands use the unchanged brush/lasso shapes, normalized pixel-center
  coordinates, bounds and budgets of `MintManualTools`.

No source revision change, saved recipe version bump or history migration occurs.
Existing commands, snapshots, inversion, union/subtract order and feather math
are untouched. Undoing the appended command recovers the old mask exactly.
Selection limits changed destination pixels; it is NOT donor/neighbor isolation.

Tests: `node --test tests/selection-edit.test.cjs` plus independent production UI
regressions in `tests/audit/manual-deformation/`.
