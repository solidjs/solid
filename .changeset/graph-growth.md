---
"@solidjs/signals": patch
---

`GRAPH_GROWTH` (warn, perf): the live owner count at a route's settle climbed on consecutive visits — something each visit leaves behind. The observe core registers top-level roots weakly; the engine walks the owner tree at navigation settle (never a per-node counter), emits a `graph` attribution record (`GraphEvent`), and exports `graphSize()` from `solid-js/attribution`. `graphGrowth: { visits, ratio } | false` configures the check.
