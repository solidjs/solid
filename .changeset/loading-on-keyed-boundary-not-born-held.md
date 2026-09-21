---
"@solidjs/signals": patch
"solid-js": patch
---

`Loading`'s `on` prop is a dependency list, not a key (#3540). The expression is tracked and its value is never compared: a write to anything it reads — plain, optimistic, or a source going pending — **re-arms** the boundary. A re-armed boundary that has something pending under it shows its fallback again; one with nothing pending does nothing (no fallback flash). `latest()` inside `on` is redundant.

The re-arm lands in the **current frame**. A write that makes content pending is held by the readers still showing the old content, and its batch commits when the data lands — but the boundary's swap to its fallback is not part of that batch: it is applied at the flush's finalize, mainline, past any transaction park, so the fallback shows now beside whatever the write is still holding elsewhere on the page. Previously the swap was staged into the pending write's transaction and landed with its commit, by which point the data had arrived and the fallback never showed whenever any other reader of the same data existed (#3524, #3529). The children are not re-created; they stay alive behind the fallback.

`Errored` accepts the same `on`: while it shows its error fallback, a change to a dependency clears the caught error and retries the children (reset keys). `createErrorBoundary` takes `{ on }` as its third argument.

Boundaries are exempt from A29 born-held: a `Loading` mounted while a transaction holds what it reads shows its fallback now (and reveals the staged content at the commit) instead of being born held with the transaction. Born held stays right for a plain memo or effect — published, its value would tear the frame — but a boundary that has not revealed is the exception by definition: its job is to catch what is not ready under it rather than let it hold. This also closes the static-vs-function-child `<Show keyed>` inconsistency from the issue.
