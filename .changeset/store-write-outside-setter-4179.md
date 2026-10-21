---
"@solidjs/signals": patch
---

Dev: writing to a store proxy outside its setter (`store.n = 5`, `store.items.push(x)`, `delete store.user`, `Object.defineProperty(store, …)`) is still ignored, but no longer silently — a new `STORE_WRITE_OUTSIDE_SETTER` warning reports it once per store object and key, with the `setStore(s => { s.key = value })` form of the write (#4179). No production bytes.
