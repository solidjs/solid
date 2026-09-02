---
"@solidjs/signals": patch
---

Region audit follow-up: delivery bumps wired at the real notification choke points (notifyFold entry, both eager walk tails, the setter channel) instead of the reconcile special case; `createRegion` declines optimistic families and accessor-bearing records (raw reads cannot represent either) and reads `t.v` at commit time (the pure-phase compute's captured value is one fold stale under setter folds); commit contract is `commit(raw)` only — compiled bodies own scalar baselines. Adds the regions delivery/decline/lifecycle test matrix.
