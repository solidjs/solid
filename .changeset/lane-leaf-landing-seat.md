---
"@solidjs/signals": patch
---

A render effect that reads a memo over `isPending(source)` and then a second async memo mounts once both first flights land (#3766). The effect went pending as work of the verdict lane, and the landing re-ran it outside the lane, where the uninitialized probe memo had nothing to show: it threw with no source to wake it, and the lane stayed blocked on its own reader. A leaf whose own pass in a lane ends pending now runs its next pass as that lane's. A held render effect that a lane took over and whose pass then leaves the lane goes back to the transaction that held it, instead of keeping its held flag with no transaction (a `null` `_into` crash the semantic fuzzer found).
