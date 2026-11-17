---
"@solidjs/compiler": patch
"@solidjs/babel-plugin": patch
---

A component spread of a zero-argument call (`<C {...fn()} />`) compiles to a thunk (`() => fn()`) instead of passing `fn` itself to `mergeProps`. `mergeProps` memoizes a function source and a memo calls its compute with the previous value, so `fn` was called with the props it returned last time (#4964).
