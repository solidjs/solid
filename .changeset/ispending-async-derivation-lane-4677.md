---
"@solidjs/signals": patch
---

An async memo that reads `isPending(x)` no longer shows its verdict beside an `isPending(x)` binding that disagrees with it (#4677). When the memo's lane landed in the same seam as the write it reads ahead of, the landing voided the binding's lane run, so the memo's `pending: true` showed while the binding stayed `false`. The lane now reveals whole (F-6) — the binding's run shows beside the memo's — and the landing's re-derivation follows next round.
