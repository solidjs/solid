---
"@solidjs/signals": patch
---

Fix computeds going permanently stale when a dependency write lands beneath their own recompute (#3037). Two holes, both hit by nested projections whose sources materialize mid-derive:

- Store reads of absent keys and accessors were suppressed by the global `writing` counter — any store read during any open setter (a projection derive runs its whole body inside one) silently skipped subscribing. Suppression is now per-target (`inDraft`), so external reads mid-derive subscribe normally while own-draft reads still don't self-track.
- A write notifying a subscriber that is mid-recompute was silently dropped: the heap refuses `RECOMPUTING` nodes, and the pass's flag wipe discarded the mark. `insertSubs` now latches `REACTIVE_MISSED_WAKE` — only for links the pass already validated (gen-current) and excluding the in-flight tail link, whose read returns the committing value fresh — and `recompute`'s tail consumes the latch to reschedule. `updateIfNecessary` also gained a reentrancy guard: nested computations (e.g. mapArray rows) reading the recomputing node's store could re-enter `recompute` and corrupt its live dep bookkeeping.

Size ceilings: simple-app floor 10 → 10.1 KB (measured 10.06), isPending/latest 9.2 → 9.3 KB (measured 9.24) — the latch, reschedule tail, and reentrancy guard all sit on always-retained core paths.
