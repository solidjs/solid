---
"@solidjs/signals": patch
---

Three behavior-preserving state consolidations from the architecture audit, each making a past bug class unrepresentable. Pending sources use a single container (the singular-slot/Set dual representation and its promotion invariant — the mechanism behind #2893's first bug — is gone). The optimistic-node brand moves from the `_overrideValue` sentinel tri-encoding to a config bit, deleting `OVERRIDE_UNDEFINED` and all wrap/unwrap sites (#2898's collision can no longer be expressed). Ambient work now uses the same batch shape as a transaction, deleting the globalQueue's parallel batch fields and the `initTransition` adoption/aliasing blocks (the alias-drift bug family). Full bundle −660 min / −221 gzip bytes; core floor −538 / −170. All 1,052 tests pass unchanged; every patch was independently re-measured and reviewed hunk-by-hunk for observable-behavior drift before landing.
