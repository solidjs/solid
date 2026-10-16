---
"@solidjs/signals": patch
"@solidjs/web": patch
---

Smaller floor bundles: the optional engines (lanes, verdicts, boundaries, stores, affects, external sources) install their scheduler hooks as module variables, so an app that never loads them no longer retains their paths in `recompute`, `read` and the settle step; client-only `render` no longer retains hydration text adoption, and the delegated dispatcher drops dead guards. The JSX hello world goes from 10.35 KB to 9.75 KB brotli.
