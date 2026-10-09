---
"@solidjs/signals": patch
---

An `isPending` or `latest` read inside `untrack` no longer re-derives the computation it runs in when that computation's dependencies go pending. Both windows marked the running computation a verdict reader even when untracked, so a library that probes pending state inside `untrack`, such as `@solidjs/router`'s link claim with `pendingLinks`, made a non-keyed `Show` rebuild its child each time its condition's source refetched. An untracked verdict read still makes its reader see the committed screen, so `[isPending(x), x()]` keeps A10's pairing.
