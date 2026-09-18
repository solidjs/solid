---
"@solidjs/signals": patch
---

`Object.getOwnPropertyDescriptor` on a store is now reactive: the descriptor trap subscribes to the key's presence node and witnesses `isPending()` / `affects()` as `in` does. Previously a render effect that inspected a key through a descriptor never re-ran for an optimistic add or delete, and an `isPending()` probe over it saw nothing.
