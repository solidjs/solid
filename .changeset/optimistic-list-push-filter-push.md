---
"@solidjs/signals": patch
---

Optimistic keyed lists: a push after a filter (with earlier saves still out) no longer hands `<For>` an `undefined` row; a guess written while an earlier action's `refresh()` is out shows at once instead of waiting for that refresh; a refresh landing older than a guess no longer brings back a row another pending guess removed; and an unkeyed list's guess written after a correction composes on what the screen shows, not on the truth beneath it (no duplicated, empty or missing rows).

New DEV diagnostic `OPTIMISTIC_WRITE_BEFORE_LOAD`: an optimistic write to a source whose first answer has not landed (`createOptimistic(async fn)`, `createOptimisticStore(fn, seed)`) throws in development and makes no guess — before its first answer the source is loading, not a value to be optimistic over. Keep pending items in a separate list until the source loads, or disable the action until then. Production behaviour is unchanged.
