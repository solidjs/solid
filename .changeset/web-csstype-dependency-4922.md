---
"@solidjs/web": patch
"@solidjs/h": patch
"solid-js": patch
---

fix: `csstype` is declared by the packages whose published JSX types import it (#4922). `@solidjs/web` (#4923) and `@solidjs/h` now depend on it, and `solid-js`, whose types no longer use it, drops it.
