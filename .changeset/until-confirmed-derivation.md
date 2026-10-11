---
"@solidjs/signals": patch
---

`until()` through a derivation of an optimistic value resolves once the source confirms the guess (#3943). A derivation's optimistic value counts as the truth when every guess it depends on has been confirmed (its source produced a value equal to the guess) and none of its other inputs has a write still held by the action; nothing is recomputed. A guess made again after a confirmation, an unconfirmed guess the derivation reads, or a held write it reads keeps `until()` waiting, as before.
