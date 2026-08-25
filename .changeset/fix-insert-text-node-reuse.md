---
"@solidjs/web": patch
---

Reuse text nodes for dynamic text in multi slots. `normalize` now leaves string/number values raw (the compute phase stays free of DOM writes and allocations, so transition forks cannot leak state before commit) and `insertExpression` materializes them at commit — adopting the positional text node with a `.data` write and allocating only when no text node is there. Previously every changed text value beside an element sibling allocated a replacement node and swapped it in, roughly halving update throughput on dbmon-style workloads. Hydration claiming still adopts the server's live text node, and a failed claim keeps the phantom-render semantics the old fresh-node allocation triggered.
