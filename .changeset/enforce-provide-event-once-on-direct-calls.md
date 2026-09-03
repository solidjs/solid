---
"@solidjs/web": patch
---

Enforce provideEvent's exactly-once contract on direct SSR calls too: the invocation count #3172 added to HTTP dispatch now guards both legs through a shared `provideEventOnce` seam, so a hook that double-invokes or skips the callback fails loudly during a render instead of silently double-committing a mutation or answering `undefined`, while synchronous direct calls keep returning their value synchronously (#3246).
