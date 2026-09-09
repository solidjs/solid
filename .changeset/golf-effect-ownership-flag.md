---
"@solidjs/signals": patch
---

Trim the #3319/#3322 fixes: `runEffect` reads `activeTransition` directly instead of a `parkHeldOwners` flag toggled around the ordinary effect phase (lane runners and the creation-time immediate run mark themselves exempt with `LANE_RUN`), and `contestEffect` is inlined into its single call site in `recompute`. Behavior-identical; -41 B minified on the core floor.
