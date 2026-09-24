---
"@solidjs/web": patch
---

Nested subpath `package.json` files no longer declare `name`/`exports`, which shadowed the root exports map for `@solidjs/web/server-functions/client` under prefix-matching resolvers (Vite 8 / Rolldown, Node CJS). `@solidjs/web/server-functions/rich-args` now builds on Vite 8 without a `resolve.dedupe` workaround.
