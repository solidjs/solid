---
"@solidjs/signals": patch
---

An async memo that reads `isPending(x)` no longer shows its verdict beside an `isPending(x)` binding that disagrees with it, and nothing derived from the write it reads ahead of shows before that write does (#4677).

- When the memo's lane landed in the same seam as the write it reads ahead of, the landing voided the binding's lane run, so the memo's `pending: true` showed while the binding stayed `false`. The lane now reveals whole (F-6), and the landing's re-derivation follows next round.
- When the lane landed first, the write's landing re-derived the memo onto a new flight and held its own runs for it, but that flush's runs of effects deriving plainly from the landing still ran: `details: Item 1` showed beside `id: 0`. Those runs now wait with the landing's held runs (F-1, F-7); what derives from a verdict reader still shows now (F-6, D-25).
