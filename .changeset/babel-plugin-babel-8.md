---
"@solidjs/babel-plugin": patch
---

Support `@babel/core` 8 alongside 7: the peer range is now `^7.20.12 || ^8.0.0`. SSR no longer reads `Scope#uids` (removed in Babel 8), and evaluated negative or non-finite numbers are built with `valueToNode`.
