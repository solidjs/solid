---
"@solidjs/signals": patch
---

`until()` through a derivation of an optimistic value resolves when the source confirms the guess (#3943). Once every guess the derivation depends on has been confirmed by its own source, its value is the truth (same inputs), so `until(() => doubled() === 2)` sees it; nothing is recomputed. A correction still re-derives the derivation inside the action's hold.
