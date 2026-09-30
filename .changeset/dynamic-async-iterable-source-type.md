---
"@solidjs/web": patch
---

`dynamic`'s source type admits `AsyncIterable<T>` — the answer of a `live` server component reference. Type-only: `dynamic` is a memo and already pumped the iterable.
