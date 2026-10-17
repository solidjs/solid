---
"solid-js": patch
---

Server rendering: a suspended read unwinds to its boundary through fewer handler frames. `runWithOwner`, the sync memo's pull, `ssrScope` and `runWithBoundaryErrorContext` restore their state in one catch (and inline on the normal path) instead of a catch plus a finally, and a sync memo whose eager pull met a `NotReadyError` re-raises it for a read in the same synchronous turn instead of running the compute a second time. No behavior change; streaming pages with many pending boundaries flush their shell sooner.
