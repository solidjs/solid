---
"@solidjs/signals": patch
---

Fix `<For>`/`mapArray`/`repeat` over an async-derived store key rendering nothing after the source first settles (#2944). The store's untracked-read uninitialized guard consulted `STATUS_UNINITIALIZED`, whose clear is deferred to batch commit — so during the settle flush it vetoed the keyed diff's item reads (untracked by design inside the map's internal owner) with a fresh `NotReadyError` that nothing would sweep, wedging the map computed permanently. The guard now also requires the firewall to still be in flight (`STATUS_PENDING`, the live bit that mirrors core `read()`'s verdict) or errored.
