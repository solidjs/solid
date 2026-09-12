---
"@solidjs/signals": patch
---

`isPending(details)` reports the load of an optimistic value when `details` derives it through an async memo (#3379). `notifyStatus` now assigns the node's optimistic lane before poking its companions, so a companion lane created by the poke is parented to the node's lane: the indicator effect flushes on the companion's child lane immediately instead of merging it into the held lane and waiting on the async it reports.
