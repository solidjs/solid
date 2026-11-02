---
"@solidjs/signals": patch
---

`mapArray` and `<For>` with a `keyed` function or `keyed: false` no longer call `setSignal` for a row whose signal already holds the new item and has no staged write. Before, every retained row in the common prefix and suffix was written on every list update.
