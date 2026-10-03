---
"@solidjs/signals": patch
---

Size audit (measurement branch): the lane layer rebuilt from the §28 principles (S0 skeleton). A node's value lives in one of three places — `_value` the committed truth, `_pendingValue` a transaction's staging, `_x._lane` the lane's value — and the lane transaction carries the shown/held state (`_shown`, `_held`); the seat of a pass is its node's; leaves read the screen; the body-end correction runs at the seam with one more pure round so its re-derivations are the parent's; a dissolving lane retires the void world's flights. Removes `CONFIG_LANE_HELD`, `CONFIG_HELD_TRUTH`, `REACTIVE_VERDICT_RERUN` and the seam-time value swap. Fixes #3409 (indicators of a body-end correction clear together) and the #3698 held-lane children case. Design and results in `documentation/plans/size-reduction-carve-step1.md` §28.
