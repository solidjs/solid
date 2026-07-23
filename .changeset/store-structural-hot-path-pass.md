---
"@solidjs/signals": patch
---

Structural store/reconcile hot-path pass (dbmon-shaped workload — keyed reconcile of a fresh 7k-object graph driving 13k effect re-reads — runs ~30% faster end to end; every change validated on a signals-only micro-bench):

- The trap fast path returns node values directly: every node-writing site wraps wrappables before `setSignal`, so re-wrapping on read was redundant (a dev-mode assertion now enforces the invariant; snapshot capture keeps the wrapping path).
- The global `storeLookup` maps raw values to StoreNode **targets** instead of proxies, and reconcile recurses target-to-target (`applyStateChild`) — no `wrap()`/`$PROXY`/`$TARGET` proxy round-trips per visited child. A lookup miss now means the child was never observed, so the subtree is skipped entirely: the diff is O(observed graph), not O(payload graph). Per-family lookups (projections/optimistic) keep their proxy contract and their wrap-based recursion.
- Keyed arrays: identity-equal matched slots skip recursion dispatch outright, and a fully-matched equal-length pass (the steady-state polling tick) returns before allocating its staging array/Map or re-syncing membership.
- `applyDescendants` and `syncArrayNodeMembership` iterate in place instead of allocating key arrays per object per pass.
- Effect values direct-commit on plain sync flushes instead of taking the `queuePendingNode`/`commitPendingNodes` round-trip that exists to sequence transition reveals.
