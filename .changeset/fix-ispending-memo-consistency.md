---
"@solidjs/signals": patch
---

Fix `isPending` memos reading inconsistently during an action-held transition (#3078)

Two defects stacked in the report:

- Untracked top-level reads of subscriber-less auto-dispose memos were destructive: `read()` tore the node down inline (`unobserved`) and the next read revived it with a full recompute in the ambient transition/lane context, so consecutive reads could answer `false → true → false` with no write in between. Reads now queue the node for a re-validating dormancy sweep at the top of the next flush — reads are idempotent within a tick, the leak protection is preserved (reclamation within one microtask; the enqueue arms `schedule()`), and a same-tick dirtying is reclaimed instead of recomputed, matching the old compute counts across flushes.
- The fresh-read pairing rule (#2831/#3028) suppressed the pending verdict for any compute that saw a staged plain write while an action still held the transition, making `createMemo(() => isPending(x))` report `false` while a direct `isPending(x)` probe reported `true` for the whole action window. A plain signal's staged write is an input to a computation still in flight, not a landed answer awaiting reveal: `heldAwaitingAsync` now treats an unsettled action as "still computing" for input-staged (non-computed) nodes, while a computed's landed async answer keeps the pairing rule even inside an open action.
