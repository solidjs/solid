---
"@solidjs/signals": patch
---

Store rewrite: reconcile walk validation hoisted to one authority. `descend`
resolves the tracked target first — a lookup hit implies the previous value
was wrappable and never raw-marked (only wrappables acquire targets), so
per-pair `isWrappable`/`isRawValue` checks on the old side are gone; the new
side still validates fully (frozen/platform/markRaw'd values stay leaves).
The keyed array walk's alignment checks are routing heuristics, not
semantics, so they use bare typeof gates and defer validation to `descend`.
Closes the remaining dbmon tick gap to statistical parity with the legacy
implementation (best-case ticks now beat legacy's).
