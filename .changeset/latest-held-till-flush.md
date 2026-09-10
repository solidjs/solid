---
"@solidjs/signals": patch
---

Writes become visible at flush — to every channel. `latest()` and `isPending()` now read the flushed staged world: `setCount(30); latest(count)` answers the pre-write value until the flush that carries the write, after which `latest(count)` and `latest(doubled)` agree in the same instant. This gives `latest` one rule regardless of reader (handler, memo, prop getter) and removes the mid-tick shadow pull introduced for #2922. All writes now take a single path (stage, mark unflushed, schedule) and are promoted by `flush()`/`recompute` — the eager write heuristic, the `_notifiedAt`/notify-epoch dedupe, and the `latestRead` unflushed branch are gone. Spec: A28.
