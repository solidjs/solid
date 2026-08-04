---
"@solidjs/signals": patch
---

Fix ambient writes going stale for a tick under verdict-companion lanes (#2963). An `isPending()` companion flip puts downstream render effects "under an optimistic lane", where reads of plain nodes serve the committed view; with no transaction to re-deliver, an unrelated same-tick write committed silently and the effect missed it until the next write. Readers whose committed-view read hid a fresh value are now recorded on the batch and replayed at commit — deferring to the transaction's completion when one forms mid-flush, preserving same-tick entanglement holds.
