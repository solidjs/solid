---
"@solidjs/signals": patch
"solid-js": patch
---

`{ shallow: true }` computed stores keep their leaves raw on every path (#3498). The projection draft no longer wraps a nested value in a draft proxy — leaf identity holds and a frozen leaf can no longer trip a Proxy invariant — and the loading shadow, its commit copy, the SSR draft and snapshots, and the hydration replay shadow copy only the root container instead of JSON-cloning the tree, which turned `Date` into a string, `NaN` into `null`, dropped `undefined` properties, and could not represent BigInt or cycles. Deep stores are unchanged.
