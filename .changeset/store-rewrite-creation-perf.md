---
"@solidjs/signals": patch
---

Store rewrite performance: eliminate the eager per-object accessor scan
(replaced by allocation-free per-node probes computed at node creation, with
own-gated single probes on fold paths), and construct proxy targets with
direct field assignment on a shared hidden-class chain. uibench drops from
36.6ms (legacy) to 27.5ms; dbmon tick reaches legacy parity.
