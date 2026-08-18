---
"@solidjs/signals": patch
---

Store rewrite: plain-store reconcile notifies inline after the adoption
descent instead of a queue/drain round trip; projection folds stay deferred
for downstream-hold correctness.
