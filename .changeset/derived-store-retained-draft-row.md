---
"@solidjs/signals": patch
---

A derived store that returns rows from its own draft no longer recurses forever when its source refreshes: the projection draft wrapper resolves to its store proxy wherever the result carries it, so a retained row keeps its identity and stays readable, and an equivalent refresh doesn't re-notify its readers.
