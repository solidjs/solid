---
"@solidjs/signals": patch
---

`latest()` over a keyed `createOptimisticStore` list now keeps the rows the list shows (which rows, their order, the length) until the action commits, even after a `refresh()` from outside the action lands the server's rows beneath the guess. Before, `latest(() => items.length)` counted a row that a pending removal hides. Row fields not guessed still read the refetched value. Other optimistic values guessed alongside the list (optimistic signals, store properties, `key: null` stores) also keep their guess through `latest()` until the commit. A newer guess that waits on its own async is still `latest()`'s value before the screen shows it.
