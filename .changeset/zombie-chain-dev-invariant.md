---
"@solidjs/signals": patch
---

Dev-only owner-chain invariant on the disposal splice (#3543 follow-up). `disposeChildren` unlinks a self-disposing node from its parent's child chain by position: a node with no `_prevSibling` is written up as the chain's head. The only way that is false is a node flagged live that sits elsewhere — the #3543 shape, a zombie that lost `REACTIVE_ZOMBIE` — and the write then clobbers the head with a stale `_nextSibling`, orphaning every live child ahead of it. Dev builds now assert `parent._firstChild === node` at that write and report `[INVARIANT_VIOLATION] owner-chain-head` (thrown under `__TEST__`, `console.error` diagnostic in dev). The check is `__DEV__`-guarded and folds out of the prod and observe tiers (size unchanged).

Also pins the create-pass shape of #3543: a lazy memo zombified by its owner's rerun and first read from the owner's new pass goes through `recompute(comp, true)`, whose flag wipe must carry `REACTIVE_ZOMBIE` too.
