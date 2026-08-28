---
"@solidjs/signals": patch
"@solidjs/web": patch
---

Patch-channel semantics completion: a throwing patch now routes through its
registering owner's queue chain to the enclosing error boundary (render-
effect parity; sibling isolation preserved, unhandled errors still rethrow),
and the dual-driver effect fallback splits phases with the same compiled
body — a next===prev read pass tracks in compute, the force apply writes in
the effect phase where transitions and batching expect DOM writes
