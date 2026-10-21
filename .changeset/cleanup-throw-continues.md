---
"@solidjs/signals": patch
"solid-js": patch
---

A cleanup (`onCleanup` or an effect's returned cleanup) that throws no longer aborts the rest of the teardown: every other cleanup in the tree still runs, and the first error is rethrown once the teardown is done. Outside a flush (a root's `dispose()`), the dispose call rethrows it. Inside a flush (a branch switch retiring a frame, a pass replacing an uncommitted one, an effect disposing a root), `flush()` rethrows it after the flush has finished, so commits and effects are never left half-applied, and lazy nodes released before the throw are still released. On the server, `disposeOwner` runs every cleanup the same way, so `renderToStream`'s final dispose still reports the error (#4193).
