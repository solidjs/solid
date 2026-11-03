---
"@solidjs/signals": patch
---

An `<Errored>` heals once no reader it caught still reads the failed source, instead of staying on its fallback after navigating to another branch (#4644). This covers an error read only by memos (a `<Show>`/`<Match>` condition), and a source something outside the boundary still reads: a hoisted memo, a derived store or projection, a reader under another `<Errored>`.
