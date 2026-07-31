---
"@solidjs/web": patch
---

Offer dynamic's previous component to the incoming one so same-function server components hand off the live mount

When a `dynamic` call site's source resolves to a new server component for the same function under different arguments, the previous value is offered through the `COMPONENT_HANDOFF` contract before the swap: the mounted boundary rebinds to the new call and morphs in place instead of remounting, so client slot state (an expanded sidebar note while typing in search) survives argument changes. Async resolutions transform inside the source promise's own microtask via a transparent thenable — no added resolution hop — and a token guards superseded resolutions from handing off stale content.
