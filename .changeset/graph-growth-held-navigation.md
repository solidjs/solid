---
"@solidjs/signals": patch
---

Attribution: `GRAPH_GROWTH` no longer counts the previous route's computations when a navigation settles through a held transition (#3989). The navigation record still settles in the landing, but its graph walk waits for that drain's end, after the landing's commits dispose the page left — the same instant a one-drain navigation is counted. Observe tier only; no production bytes.
