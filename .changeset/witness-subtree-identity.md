---
"@solidjs/signals": patch
---

Deep witnesses buy subtree identity in keyed reconcile: an under-witness flag threads through the adoption walk so records beneath a `witness()`/`deep()` subscription keep key-matched proxy identity without materializing per-record nodes (the R18 "subscribing buys liveness" contract, satisfied by the witness itself). Unwitnessed captures still detach.
