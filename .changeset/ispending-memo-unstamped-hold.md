---
"@solidjs/signals": patch
---

A memo wrapping `isPending(x)` agrees with a direct `isPending(x)` read while a sibling async memo holds the write (#3457).

- The fresh-read pairing rule (A10) only mutes a verdict for a LANDED answer awaiting reveal; while the transaction still has an async source computing, pending is the verdict for every reader. That carve-out was gated on the node's `_transition` stamp, but a sync memo staged AFTER the transaction opened is pushed straight into the transaction's batch and is not stamped until the flush stashes the hold. A wrapper memo recomputing on the companion flip read the memo's fresh staged value mid-flush, was told "not pending", and cached `false` for the whole hold, while the direct render-effect probe (which reads the committed value under the companion lane) reported `true`. The scan now runs for an unstamped node too: the transaction it resolves to is the one that owns its staged write.
