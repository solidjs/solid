---
"@solidjs/signals": patch
---

A store write made outside a flush by imperative code is no longer visible to computations until the flush that carries it, as a signal write is not (A28): a memo created inside an action that adopted such a write published the pending value where the same memo over a signal published the committed one. A property node born in that window stages the write so the carrying flush delivers it through the node.
