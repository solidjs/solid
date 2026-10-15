---
"@solidjs/signals": patch
---

A `createSignal(fn)` or `createMemo(fn)` derivation that reads `latest()` or `isPending()` of a signal an in-flight async memo is holding receives its previous value as `prev` on every re-run under the hold. When its first pass under the hold was equal to the previous value, the next pass received an empty internal marker instead, so `(prev = []) => [...prev]` threw `prev is not iterable` and halted the reactive system.
