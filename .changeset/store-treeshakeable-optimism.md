---
"@solidjs/signals": patch
---

Store: the optimistic write channel is tree-shakeable. The optimistic-only
machinery (engine-write diffing, landing consumption, view composition, the
tentative reconcile channel) moved out of the plain store/reconcile modules
into the optimistic module behind an injection table installed by
`createOptimisticStore` — every call site is `fam?.opt`-gated, so the table
is always populated before it can be reached and plain paths pay nothing.
Apps that never use optimistic stores now shake ~0.5kb gzip of store code;
the whole-package (bundlephobia-style) size drops ~0.5kb gzip as well from
the accompanying dead-export sweep.
