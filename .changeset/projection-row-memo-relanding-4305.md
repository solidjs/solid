---
"@solidjs/signals": patch
---

A keyed derived store over an async memo follows every landing (#4305): when the source goes pending, the readers of the store's keys wait on the derive itself, so a reader whose value a landing leaves unchanged (a memo per row under `mapArray`/`<For>`) is released by the landing instead of holding the first one forever. The same holds when the derive re-runs while its source is pending.
