---
"@solidjs/signals": patch
---

Smaller core for apps without `isPending`/`latest` or optimistic lanes: the verdict engine's async-memo bookkeeping, its re-derive checks and the pass-lane seat now sit behind the engines' hooks, so a bundle that never installs them folds that code away (hello world −92 B brotli). No behavior change.
