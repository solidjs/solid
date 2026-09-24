---
"@solidjs/signals": patch
---

`GRAPH_GROWTH` (warn, perf): the live reactive graph — owners, computations, signals, edges — measured at each route's settle climbed on consecutive visits, and which measure climbed names the leak. The observe core registers top-level roots weakly; the engine walks the owner tree and the reactive graph it reaches at navigation settle (never a per-node counter), emits a `graph` attribution record (`GraphEvent`, `GraphSize`), and exports `graphSize()` from `solid-js/attribution`. `graphGrowth: { visits, ratio } | false` configures the check.
