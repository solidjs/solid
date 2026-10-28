---
"@solidjs/signals": patch
---

A memo or render effect born in a branch that a staged or held condition just opened no longer reads the screen when it calls `latest()` or `isPending()` (#4341). Its first pass runs inside the pass that opened the branch (or inside passes that branch is still creating, such as a `<Show>` or a component inside it), and the branch exists only in that world, so the pass reads that world like any derivation of it, and like `bornInto` does once the node is held. It becomes a verdict reader from its next pass. Before, the reader read the screen, where its branch was still closed: a `<Match>` callback's narrowed accessor saw its own branch as unmounted and threw "Attempting to access a stale value from <Match>", which halted the reactive system. The order of reads inside the reader and whether a memo sits between the read and the binding no longer change this. Apps that do not use `latest()` or `isPending()` ship no new bytes.
