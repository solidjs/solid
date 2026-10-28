---
"@solidjs/signals": patch
"solid-js": patch
---

`<For>` / `mapArray` over a shallow store diffs the store's backing array instead of reading every slot through the proxy. A one-row write on a 1,000-row shallow store spent ~1.3 ms in per-slot trap reads; the list's diff now costs what it does over a plain array (~0.05 ms). Optimistic shallow stores, accessor slots and reads inside a setter keep the per-slot path.
