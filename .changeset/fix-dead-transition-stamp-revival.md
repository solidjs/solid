---
"@solidjs/signals": patch
---

Harden the transaction-stamp lifecycle around #3140 (companion to #3143, which clears `_transition` stamps when pending values commit). `initTransition` now refuses a transaction whose `_done` chain ends in `true` — the belt for dead references that survive outside the commit path (merged forwarding chains, async settles racing completion), since `setSignal` re-opens a node's stamped transaction before the value-equal bail and re-activating a corpse spins the flush drain loop (dev threw the loop guard; production hung). The dev loop guard also now reports what kept the loop alive — transition done-state, queue counts, and the last staged node — instead of only that it happened.
