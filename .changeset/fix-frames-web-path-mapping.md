---
"@solidjs/web": patch
---

Fix frames types build on fresh installs: map bare `@solidjs/web` in `frames/tsconfig.build.json` paths (alongside the existing server-functions/client mapping). The insert-dedup change imports `insert` from `@solidjs/web`, which fails under NodeNext without the package self-link that only local `link` checkouts have.
