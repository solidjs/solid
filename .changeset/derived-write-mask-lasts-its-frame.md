---
"@solidjs/signals": patch
---

A manual write to a writable derived value (`createSignal(fn)`, `createStore(fn)`) inside an action no longer blocks later source changes for the rest of the hold. The write still wins over its own frame's recompute (#2692); a source change in a later frame re-runs the derivation with the write as `prev` (or in the draft), under the transaction and revealed with it. This was a regression since #2692, whose mask only lifted at the transaction's commit (#3733).
