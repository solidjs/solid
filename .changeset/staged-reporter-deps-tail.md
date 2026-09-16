---
"@solidjs/signals": patch
---

A render effect that stops reading a pending memo no longer keeps the memo's source held, in every ordering. Reporter liveness now reads this pass's deps — `reporterBlocksSource`'s scan stops at `_depsTail` instead of walking the committed frame's deps that A30 keeps linked until the commit trims them (a staged pass that had stopped reading the memo still looked live through its kept dep, and the hold it kept was the commit that would have trimmed it). A reporter retires when its pass drops a dep — not only when it recovers from pending, which a reporter registered by the stale-reader carve-out never was — and the retirement wakes every parked transaction rather than the reporter's stamp, since the transaction waiting on it registered it without stamping it. Semantic fuzzer (#3446), same campaign: 994 pass / 0 fail / 6 policy, from 984 / 4 / 12.
