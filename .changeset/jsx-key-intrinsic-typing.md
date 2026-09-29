---
"@solidjs/web": patch
"@solidjs/h": patch
---

JSX typings: `$key?: string | number` is declared on intrinsic elements (`JSX.CustomAttributes`), the entity identity the frame morph matches keyed server elements by. Both compilers already handled it (SSR → `_key`, DOM strips it); TypeScript rejected it.
