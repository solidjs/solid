---
"@solidjs/signals": patch
---

A verdict memo (`createMemo(() => isPending(x))`, the router's `useIsRouting`) whose probe ran before its flush joined a transaction now shows `true` while that transaction is held, instead of `false` until it lands (#4439).
