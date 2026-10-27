---
"solid-js": patch
"@solidjs/signals": patch
---

A served answer's arrival during hydration no longer swallows a client write made in the same flush. Writes made before the arrival flush first, outside hydration's own pass, and a write made during it (an effect's, a later round of the flush) makes a node it reaches compute, so the node shows the written value instead of re-serving the server's answer. `@solidjs/signals` exports its internal flush-round counter (`clock`) for this.
