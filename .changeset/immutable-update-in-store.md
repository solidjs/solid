---
"@solidjs/signals": patch
"solid-js": patch
---

Attribution: `IMMUTABLE_UPDATE_IN_STORE` diagnostic. A store setter that replaces a container with a fresh object or array whose leaves are mostly the same values — `draft.user = { ...draft.user, name }`, `draft.items = [...draft.items, x]`, `draft.items = draft.items.filter(…)` — is the React habit the store does not need: it tracks leaves, so a fresh container makes every reader of the container's path re-run for the one leaf that moved. The store's write-channel notify now announces replaced containers to the attribution engine with a leaf census (identity on unwrapped values; object keys by key, array items by membership; containers over 64 leaves are skipped), and the engine warns once per store path when at least half the leaves carried over unchanged, naming the draft mutation that touches only the changed key or index and `reconcile()` for data arriving from outside. Genuinely new data (nothing carried over), draft mutation, and `reconcile()` do not report. New `AttributionHooks.storeReplaced` hook point.
