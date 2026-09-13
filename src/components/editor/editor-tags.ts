/** Custom save tag for async hydration mutations. Paired with `history-merge`
 *  on the same editor.update call so undo bundles the conversion + the
 *  metadata fill into a single step, while still triggering a save via the
 *  HydrationSaveListener in editor.tsx.
 *
 *  Kept in its own module so decorator components (which import it) do not have
 *  to import `editor.tsx` and create a circular dependency through `nodes`. */
export const LYCHEE_SAVE_TAG = "lychee-save"
