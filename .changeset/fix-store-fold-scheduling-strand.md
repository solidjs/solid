---
"@solidjs/signals": patch
---

Fix store folds silently stranding while any transition is in flight (#3089). The fold queue armed a drain only when it was empty, assuming every drain clears it — but a held re-queue or an incomplete-transition flush (which skips `commitPendingNodes` entirely) leaves entries behind after `scheduled` is consumed, and every later fold was then queued without ever scheduling a drain: the committed backing froze at stale state (a derived store's seed) while its nodes committed, and readers on different rails saw torn state — `length` 0, `Object.keys` `["0"]`, the element intact. `queueFold` now always arms the scheduler, and folds carry a write-time transition stamp so drafts written under a still-running transition — including unobserved keys, which have no pending node for the drain's held check to see — defer to that transition's settle instead of landing in whichever flush drains next.
