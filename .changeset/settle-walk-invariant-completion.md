---
"@solidjs/signals": patch
---

Complete the SETTLE_WALK_UNINITIALIZED_SOURCE dev invariant: register the diagnostic code in the DiagnosticCode union (the emit site referenced an unregistered code, failing typecheck), and exempt uninitialized sources that still have truth to reveal — a transition-held first landing (streamed hydration) parks its value in `_pendingValue` with the flag still set, and a comparator throw on that landing leaves the node errored; both were false positives.
