---
"@solidjs/signals": patch
---

Let a projection's derive return a different entity than the one it currently holds

A projection fetching route data (`createProjection(() => fetchUser(params.id), {})`) crashed on the second navigation with "Cannot reconcile states with different identity": the seed has no `id`, so the first commit passed the root identity guard and the next one threw — inside the projection's computed, which stopped all further updates.

The guard belongs to `reconcile()`, where the caller picked the slot and merging entity X into entity Y's slot is a bug. A projection commit is not a merge: the root proxy is a cell handed out by `createProjection` that can never change reference, so no consumer can hold it as an entity token, and the return form's semantics require the backing data to be swappable. Projection commits now swap instead of throwing. Nothing below the root survives an identity change — every slot is replaced by reference rather than merged into, matching what the keyed diff already does at a nested slot on a key mismatch — and the outgoing raw is dropped from the projection's family map so it can't resurface as the new entity. `reconcile()` itself is unchanged.

Applies to all three projection commit paths: `createProjection`, the derived `createStore(fn, seed)` form, and the derived `createOptimisticStore(fn, seed)` form.

Also fixes `key: null` on those same three forms. `ProjectionOptions["key"]` did not admit `null`, and both call sites resolved the default with `options?.key || "id"`, so a `null` meant to select positional merging was silently swallowed into the `"id"` default — the one escape hatch from keyed identity did not reach `reconcile`.
