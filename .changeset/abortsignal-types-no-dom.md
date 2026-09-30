---
"@solidjs/signals": patch
"solid-js": patch
---

`until`'s `signal` option types as the global `AbortSignal` when the DOM lib or `@types/node` declares one, and as the minimal abort surface `until` uses otherwise, so the published declarations type-check with neither lib under `skipLibCheck: false` (previously TS2304).
