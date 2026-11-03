---
"@solidjs/signals": patch
---

An `<Errored>` whose error was read only by memos (a `<Show>`/`<Match>` condition) heals once nothing reads the failed source any more, instead of staying on its fallback after navigating to another branch (#4644).
