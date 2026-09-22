---
"@solidjs/signals": patch
---

Behavior change: a `createProjection` / `createStore(fn, seed)` / `createOptimisticStore(fn)` draft now stays valid until it is superseded by the next run of the derive or its owner is disposed — no longer "until no longer in flight" (#3585). A subscription set up inside a sync derive can write through the draft from its callback without the never-resolving-Promise workaround; the write applies, notifies subscribers, and arms the flush itself when no async run is in flight to do so (the scheduler used to strand on such writes). Writes through a superseded or disposed draft are dropped silently, so a previous run's leaked callback can no longer write into the current run's state (it did before, whenever nothing had read the projection yet).
