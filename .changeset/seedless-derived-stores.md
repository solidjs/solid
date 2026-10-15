---
"@solidjs/signals": patch
"solid-js": patch
---

Derived stores no longer need a seed (#3194). `createStore(fn)`, `createProjection(fn)` and `createOptimisticStore(fn)` accept a derive that takes no draft and answers a complete value — sync, a promise, or an async iterable whose every yield is a complete snapshot. The root is a plain object (an array keeps its `[]` seed); pass `undefined` for the seed to reach the options, e.g. `createStore(fetchUser, undefined, { key: "email" })`. Until the first answer lands the store is unreadable, as with any seed (A25); `seedLoadingValue` needs a seed and is not offered on the seedless form.

With the seedless form available, a seed is a complete `T` again (#3258's requirement, reverted then because async stores that needed the options slot had to invent one). A `{}` seed on a return-form derive is now a type error: drop it. A mutating derive that builds its object from an empty seed needs `{} as T`.
