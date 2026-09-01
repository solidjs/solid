---
"@solidjs/web": patch
---

Eager JSX evaluated during hydration whose template claim misses (e.g. stored in a variable behind an initially false `<Show>` — the server allocated its hydration ids but never rendered it) now materializes its dynamic inserts like a client render, so revealing the detached subtree later produces fully initialized DOM (#3163). Text-node adoption during hydration is restricted to nodes actually being claimed (connected or under a claim root).
