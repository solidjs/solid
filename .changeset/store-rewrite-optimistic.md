---
"@solidjs/signals": minor
---

Store rewrite: optimistic stores ride core lanes natively. `createOptimisticStore`
(plain and derived, non-shallow) now serves from the rewrite: per-property nodes
are armed core signals, so optimistic writes, per-transaction ownership,
entanglement, reverts, and refetch-holds are all engine-inherited — the
store-side override layer, backup snapshots, and owner maps are gone. Structural
optimism (adds/deletes/length) rides armed presence nodes and consumes on
authoritative landings; value overrides persist with their owning transaction.
Reconcile diffs against the lane view so optimistic rows recycle their proxies
when landed data carries the same key. snapshot/deep compose the optimistic
view. Also fixes legacy `createWriteTraps` clobbering `projectionWriteActive`
(hard reset instead of save/restore).
