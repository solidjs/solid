---
"@solidjs/signals": patch
---

A deferred child keeps `REACTIVE_ZOMBIE` when it re-runs (#3543). `recompute()` and `updateIfNecessary()` rewrote `_flags` wholesale, so a zombie that re-ran while its owner's commit waited (an unrelated parked action is enough) was later disposed as an ordinary child: the parent-chain splice wrote `parent._firstChild = next` and detached the replacement, which stayed subscribed where no owner cleanup could reach it. A compiled `<Show when={n() > 0 && n() < 2}>` leaked one nested memo per update and eventually tripped `HUGE_FAN_OUT`. The flag also routes heap queues and the transaction verdict, so a re-run zombie is again judged as a zombie: the #3463 pin's removal commits when its action ends (5000) rather than waiting on a refetch only the zombie reads (6000).
