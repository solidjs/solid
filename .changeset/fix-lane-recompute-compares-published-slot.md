---
"@solidjs/signals": patch
---

A memo deriving from an optimistic value now reveals together with the override when the override is written after its transaction already staged the same derived result (e.g. `setOptimistic` after an `await` inside an action whose earlier write produced the same value). The lane recompute compared its result against the transaction-held value instead of the value on screen, called it unchanged, and left the derivation stale until the action committed (#3330).
