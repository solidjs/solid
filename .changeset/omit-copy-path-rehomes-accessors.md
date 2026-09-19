---
"@solidjs/signals": patch
---

`omit()`'s no-Proxy copy path re-homes accessors with the source as receiver instead of forwarding the descriptor, matching `merge()`'s copy path. A prop's getter is defined only for a read through its own object — the compiler's server-side props keep their state on the instance — so a copy that must stay live defines its own getter that reads through the source.
