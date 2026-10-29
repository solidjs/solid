---
"@solidjs/signals": patch
---

An `<Errored>` heals when the last reader that caught its error is disposed. The boundary waits on what threw only while a reader holding the error is alive, so a `<Show when={isPending(m)}>` that closes over `m()` once the action that made `m` throw settles no longer leaves the fallback up (#4373).
