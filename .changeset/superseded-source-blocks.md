---
"@solidjs/signals": patch
---

A transaction blocked on a memo's flight stays blocked while an upstream re-ask supersedes that flight (#3462).

`transitionComplete` judged a reporter's source by its own flight alone (the self entry in `_pendingSources`). A re-ask upstream retires that entry and leaves the source pending on the new flight instead, so the verdict flipped to "complete" while the source's reader still could not render. The transaction was parked, so nothing re-judged it until a re-entry: repeating `setShow(true)` while the first write was held re-entered it, and the flush committed `Show: true` beside `Panel: hidden`, with the panel catching up seconds later at the chain's landing. The source now blocks while it is pending on anything; the landing folds the transaction in as before (A15), and without the repeated write the frames are unchanged.
