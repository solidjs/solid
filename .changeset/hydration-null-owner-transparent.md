---
"solid-js": patch
---

Fix `hydrate()` throwing `TypeError: Cannot read properties of null (reading '_config')` when `createMemo` or a function-form `createSignal` is created with no owner. An ownerless node has no hydration id to consume, so it now takes the same path as `{ transparent: true }` and runs live. Function-form `createSignal` also honors `transparent` during hydration.
