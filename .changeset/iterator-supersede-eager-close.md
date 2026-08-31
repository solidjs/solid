---
"@solidjs/signals": patch
---

Close superseded async-iterable flights at supersede time (#3122). The iterator close was registered only as an owner cleanup, and a recompute whose disposal rides the zombie-deferred channel drains it at commitPendingNode — which a verdict-held write defers until the SUPERSEDING flight settles, leaving the stale iterator running to completion. Iterator close is the cancellation hook for resource-shaped streams (fibers, sockets, subscriptions), so the flight teardown now also fires at recompute's `_inFlight` release, keyed to flight identity; the owner cleanup stays as the death backstop.
