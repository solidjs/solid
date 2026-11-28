---
"@solidjs/signals": patch
---

A tracked `latest()` read (a JSX binding, a memo or an effect) of an optimistic value now re-runs when the action ends, if a `refresh()` from outside the action landed a different server value beneath the guess while the action was running. Before, the binding kept showing the guess after the action ended without a refresh of its own, while the screen and an untracked `latest()` call already showed the server value. Applies to `createOptimistic` and to the fields of a `createOptimisticStore` row (keyed or `key: null`). `isPending` is unchanged.
