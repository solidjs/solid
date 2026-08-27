---
"@solidjs/signals": patch
---

Fix projection transition isolation and `latest()` parity (#3074, #3075). A projection recompute deriving from transition-held sources committed its output through the eager adoption channel, so untracked readers saw the uncommitted value after `flush()` while reads of the source signal correctly stayed committed. Adoption under a live hold now stages a held view: committed-visibility readers keep the pre-hold backing until the transition commits (speculative readers — drafts, owner-context computeds, `latest()` — see the adopted backing). And `latest()` now works through projections: store traps never reach core `read()` without an observer, so the get trap pulls the projection computed up to date under the latest window and serves the in-flight derivation — signal/memo parity.
