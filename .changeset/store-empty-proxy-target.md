---
"@solidjs/signals": patch
---

Store proxies wrap an empty object (an empty array for array stores) and use the store's internal target as their handler. V8 checks every trap result against the proxy target's own keys, so key listing, `for...in` and spread on stores get faster. `Object.freeze`, `Object.preventExtensions` and `Object.setPrototypeOf` on a store now throw a TypeError instead of breaking it.
