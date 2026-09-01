---
"@solidjs/signals": patch
---

Replace the structural channels' snapshot/watermark/sweep machinery with per-entry applied-version chains: emissions stamp a per-kind structural version, entries apply an item only on an unbroken chain from what their registration read (baseline soundness by arithmetic), and any gap takes exactly one resync at the end of the flush, after every queue. This closes the audited class wholesale — cross-window coverage errors, lane-resync-before-stale-ops ordering, and duplicate sweep deliveries have no mechanism left to be wrong in — and held-window registrants improve to receiving real baseline-sound ops. Reveals dedup to one notification (the settle loop skips staged-fold targets), revert-form resyncs resolve committed truth only, and late-mounted bindings repair their ancestor raw chain at registration (gated to stale aliases of the same child — never tentative rows).
