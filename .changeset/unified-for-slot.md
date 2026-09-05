---
"solid-js": patch
"@solidjs/web": patch
"@solidjs/signals": patch
---

Unified For: keyed `<For>` is driven by one persistent slot that owns both row bookkeeping and DOM placement — an intrusive row chain + incremental key map updated by a prefix/suffix/LIS pass inside an ordinary two-phase render effect — replacing the mapArray + reconcileArrays double pass. Structural operations (swap, reorder, insert, remove) run 1.2–7x faster across jfb and uibench; creation and clear stay at parity via flat-mode first fills (parallel arrays, structure materializes lazily on the first partial structural op).

Default-on with zero new API and zero compiler involvement: the slot rides For's own module graph (`$for.impl`), web's insert engages it with its renderer-ops singleton, and the slot algorithm tree-shakes out of apps without For (~2.1 KB rides For-bearing bundles; ~0.3 KB of engagement seam in `insert` — the `$for` guards, renderer ops, and hole hand-off — is retained by every web bundle; hydration adds ~0.8 KB to hydrating bundles only). A For passed through a component's `{props.children}` engages too — the hole seam hands the wrapper's hole to the slot, tears it down cleanly when the children change, and routes a post-engage demote back through the hosting effect's classic path. Bulk-clear fast paths honor classic's ownership rules — `null` markers (trailing child with preceding siblings) and streamed foreign nodes are never wiped. Empty-rendering rows hold their position with a placeholder instead of demoting.

Hydration: lists engage during hydration and claim the server rows themselves — whole-parent holes and comment-bounded anchored holes alike (the hydrating client resolves anchored holes to their `<!--/-->` marker with the bounded region). The slot's row parent takes the same id classic's mapArray owner spends (For peeks it via an `enableHydration()`-installed hook; mapArray gains an internal `lazy` option so the classic pass no longer claims first), so rows mint identical hydration keys; claims are recorded so a demote mid-fill hands them back and classic's re-run claims the same nodes; the fill commit reconciles against the region only on server/client mismatch. All hydration behavior lives in a module installed by `enableHydration()` — CSR bundles shake it.

Declines to classic mapArray: key functions, duplicate keys, dynamic top-level rows, `fallback`, non-array subjects; post-engage contract exits demote to classic under the original owner.
