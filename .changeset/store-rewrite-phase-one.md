---
"@solidjs/signals": patch
---

Store rewrite phase 1 (in progress, branch-scoped): plain deep stores and
reconcile now serve from the new single-home storage model
(`src/store/next/`) — owned-raw backing with copy-on-write privatization
(user source objects are never mutated), lazy per-property nodes as real core
signals (transition holds, isPending, and lanes ride core machinery
natively), and reconcile as the adoption channel with the ownership-guarded
identity skip. Fixes the unsound nested reconcile same-reference skip
(FINDING-1: a re-sent reference after a flushed setter write now restores the
incoming values). Derived, shallow, and optimistic store forms still route to
the legacy implementation via transitional dispatchers. Design contract and
findings log: `packages/solid-signals/INTERNALS-STORE-STATE.md`,
`packages/solid-signals/rules-mining/`.
