---
"@solidjs/signals": patch
---

A memo or effect whose first pass was never pending or errored no longer sends a "status cleared" notification when no boundary is collecting readers. That notification could only reach a boundary that had recorded the node, and none has while the collecting set is empty. Creating a render effect is about 6% faster in a Node microbench.
