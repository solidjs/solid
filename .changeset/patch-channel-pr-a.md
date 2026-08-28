---
"@solidjs/signals": patch
---

Stage 2 (PR-A): the patch channel. Compiled per-record patch consumers
(`registerPatch`, undocumented compiler-contract export) dispatched by store
visibility transitions at all four sites: adoption walk and setter notify
(plain stores, with ancestor bubbling for targeted nested writes), fold
commit (projections — held folds hold their patches), and the override
lifecycle (application emits the visible draft; consumption and engine
reverts force-reapply from the live view). Application timing: per-flush
apply queue at render-effect phase; transition-stamped emissions release
when THEIR batch commits (reverted transactions drop by GC); optimistic
emissions drain at lane-effect timing so in-flight visibility works while
actions stash the regular queues. Unpatched stores pay a null check and the
module tree-shakes out of non-store bundles. Gauntlet: effect-phase timing,
reconcile prev pairing, nested-write bubbling, unbind/multi-consumer,
transition hold, optimistic in-flight + DOM revert, projection refetch,
disposed-owner drop.
