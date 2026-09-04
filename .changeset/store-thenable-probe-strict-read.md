---
"@solidjs/signals": patch
---

Stop the store proxy's dev strict-read check from firing on the engine's
thenable probe. Resolving a promise with a store proxy — `refresh(store)`'s
waiter delivers the store, `Promise.resolve(store)`, `return store` from an
async function — makes the engine read `store.then` synchronously in the
caller's scope. When that scope carries a strict-read label (an effect
callback, a component body) the read produced a spurious
`STRICT_READ_UNTRACKED` warning, and against a refetching derived store it
could escalate to the `PENDING_ASYNC_UNTRACKED_READ` throw, rejecting the
promise being resolved. `await refresh(list)` inside an action logged the
warning on every call. The `then` probe is not a read the user wrote and is
now exempt from both.
