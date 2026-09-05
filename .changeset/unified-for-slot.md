---
"solid-js": patch
"@solidjs/web": patch
---

Unified For: keyed `<For>` is driven by one persistent slot that owns both row bookkeeping and DOM placement — an intrusive row chain + incremental key map updated by a prefix/suffix/LIS pass inside an ordinary two-phase render effect — replacing the mapArray + reconcileArrays double pass. Structural operations (swap, reorder, insert, remove) run 1.2–7x faster across jfb and uibench; creation and clear stay at parity via flat-mode first fills (parallel arrays, structure materializes lazily on the first partial structural op).

Default-on with zero new API and zero compiler involvement: the slot rides For's own module graph (`$for.impl`), web's insert engages it with its renderer-ops singleton, and apps without For tree-shake it entirely (~2.1 KB in For-bearing bundles). Bulk-clear fast paths honor classic's ownership rules — `null` markers (trailing child with preceding siblings) and streamed foreign nodes are never wiped. Empty-rendering rows hold their position with a placeholder instead of demoting. Declines to classic mapArray: hydration claiming (post-hydration mounts engage), key functions, duplicate keys, dynamic top-level rows, `fallback`, non-array subjects; post-engage contract exits demote to classic under the original owner.
