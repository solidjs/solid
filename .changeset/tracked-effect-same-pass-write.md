---
"@solidjs/signals": patch
---

A `createTrackedEffect` whose first run reads a signal written earlier in the same effect phase (another effect's first run, a parent's `onSettled` writing a prop) now re-runs once the write commits, as `createEffect(compute, fn)` does (#4598). A tracked effect reads the committed value and links its dependencies in the effect phase, after the write had already walked the signal's subscribers, so the commit at the next seam notified nobody. After a tracked effect's run, a dependency staged this flush whose subscriber walk predates the run queues the effect again for the round that commits it; writes that net to the committed value stage no change and queue nothing. The pass's own write-then-read is still never observed and never re-runs (#3006), and `onSettled` stays one-shot.
