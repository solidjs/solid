---
"solid-js": patch
---

fix: stores now batch like signals on cold writes

Untracked reads of a store property after a `setStore` mutation now return the
previous value until `flush()` (or the surrounding effect/transition) commits,
matching `createSignal` semantics. The `in` operator batches the same way —
after a cold add or delete, presence reflects the pre-write shape until commit.
Previously both reads resolved synchronously against the override, which broke
the "no reading uncommitted state" invariant for store properties that had
never been observed.

Internally we upsert a transient pending node for the property (and, on
presence change, a matching `STORE_HAS` node) on cold writes, queue the new
value as `_pendingValue`, and sweep nodes that never gain a subscriber when
their pending write commits. Optimistic stores and projection writes are
unaffected — they keep their immediate-visibility semantics.
