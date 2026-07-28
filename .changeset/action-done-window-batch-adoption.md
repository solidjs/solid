---
"@solidjs/signals": patch
---

Re-adopt the queue batch when an action completes. `done()` restored the
active transition with a bare `setActiveTransition`, leaving the global
queue's batch as a detached ambient batch until the scheduled flush. Anything
registered in that microtask window was stranded with nothing to finalize it:
a completed action's held writes were silently lost when another action
resumed in the window (its transition merge never transferred them), a bare
optimistic write never reverted, and an `affects()` mark could leak — leaving
`isPending` stuck true. Completing an action now goes through
`initTransition`, the same batch-adoption path every other
transition-resumption site already uses.
