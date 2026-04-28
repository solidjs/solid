---
"solid-js": patch
---

Fixes #2686. Owned non-lazy memos no longer autodispose when their
subscriber count momentarily drops to zero (e.g. during a transition swap,
or when read only through `untrack` from a suspending render-effect). They
now live for their owner's lifetime and retain their cached value, so an
async `createMemo` read via `untrack` from a suspending consumer settles
once and stays settled across re-runs.

Lazy memos (`createMemo(fn, { lazy: true })`) and unowned memos retain the
previous "compute-on-demand, dispose-when-not-needed" semantics, and the
JSDoc on `lazy` now documents this contract.

Internally this folds the per-node config booleans (`_ownedWrite`,
`_noSnapshot`, `_transparent`, `_inSnapshotScope`, `_childrenForbidden`,
`_preventAutoDisposal`) into a single `_config: number` bitfield with
`CONFIG_*` constants, replacing `_preventAutoDisposal` (opt-out) with
`CONFIG_AUTO_DISPOSE` (opt-in). Public node options are unchanged.
