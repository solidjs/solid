---
"@solidjs/signals": patch
---

Three behavior-preserving state consolidations from the architecture audit, each making a past bug class unrepresentable. Pending sources use a single container (the singular-slot/Set dual representation and its promotion invariant — the mechanism behind #2893's first bug — is gone). Ambient work now uses the same batch shape as a transaction, deleting the globalQueue's parallel batch fields and the `initTransition` adoption/aliasing blocks (the alias-drift bug family). Full bundle −523 min / −179 gzip bytes; core floor −440 / −151. All 1,052 tests pass unchanged; every patch was independently re-measured and reviewed hunk-by-hunk for observable-behavior drift before landing.
