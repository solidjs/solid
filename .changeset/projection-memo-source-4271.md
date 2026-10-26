---
"@solidjs/signals": patch
---

A derived store (`createProjection` or `createStore(fn)`) over a memo now follows the memo after it has shown a value: when the memo goes pending again, `isPending` on the store's keys reports it, and when the memo later throws, the error reaches the error boundary instead of the store silently keeping its last value. (#4271)
