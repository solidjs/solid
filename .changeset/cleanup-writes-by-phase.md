---
"@solidjs/signals": patch
"solid-js": patch
---

Development: whether a cleanup may write is now decided by the scope it belongs to, not by where teardown runs it. A setter, store setter, `refresh` or `action` call from an `onCleanup` is an owned write again (`REACTIVE_WRITE_IN_OWNED_SCOPE`, `ACTION_CALLED_IN_OWNED_SCOPE`), under a removed `<For>` row and under a `<Show>` branch alike. A cleanup returned from an effect callback or from `onSettled` may still write and call actions. Move the write into a returned cleanup, or mark the signal `ownedWrite`. Production output is unchanged by this.
