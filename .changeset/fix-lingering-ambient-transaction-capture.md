---
"@solidjs/signals": patch
---

Fix unrelated async work being captured by a lingering ambient transaction (#3141). Parking is flush-driven, but a transaction opened without any writes — an action whose first statements only await — scheduled nothing, so `activeTransition` and the adopted batch stayed armed across the async gap. The next unrelated work to arrive was adopted into a transaction it had nothing to do with: an optimistic store's authoritative landing would not render until the stranger action settled, an unowned optimistic write rode that transaction instead of reverting at the flush, and `deep()`/per-key readers disagreed about the committed value in the meantime. `initTransition` now guarantees a flush, so the ambient window closes in one flush regardless of whether the transaction wrote anything — enforcing the A26 containment ruling.
