---
"@solidjs/signals": patch
---

Allow writes in cleanups during teardown (#4165). Removing a keyed `<For>` row ran the row's cleanups inside the list's pass, so a setter in an `onCleanup` or `onSettled` cleanup was rejected in development as a write in an owned scope, which halted reactivity. A cleanup is teardown, not part of the computation disposing it, so the dev-only owned-scope write check now stands down while cleanups run. Cleanups keep their owner and context, and production builds are unchanged.
