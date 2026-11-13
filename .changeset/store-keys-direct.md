---
"@solidjs/signals": patch
---

A spread or a `merge()`/`omit()` consumer that reads the keys of a store now asks the store's handler for them directly instead of going through the proxy with `Reflect.ownKeys`. The engine validates every proxy `ownKeys` result against the proxy's target, and for a store that check cost about twice the trap itself. Reading the keys of a 12-key store this way goes from about 880 ns to about 280 ns, and re-running an element spread over a store record takes about 10% fewer instructions. The keys returned and the tracking are the same; any other proxy (a merge or omit view, a projection draft, a foreign proxy) is still read through `Reflect.ownKeys`. Bundles that include the merge/omit source walkers are 45 bytes larger minified.
