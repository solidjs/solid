---
"@solidjs/signals": patch
---

One ownership relation, `ownsHold`, answers "is this hold part of the running pass's world" for the stale-reader clause, the lane arm and the store's backing holds — a refactor with no behavior change, recording the ruling that a lane is a transaction with an override whose world includes the transition that owns it.
