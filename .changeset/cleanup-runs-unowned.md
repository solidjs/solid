---
"@solidjs/signals": patch
---

Cleanups run with no owner and untracked (#4165). Removing a keyed `<For>` row ran the row's cleanups inside the list's pass, so a setter in an `onCleanup` or `onSettled` cleanup was rejected as a write in an owned scope and halted reactivity in development. A cleanup is teardown code, not part of the computation disposing it: its writes are now allowed like an effect callback's, and its reads subscribe nothing.
