---
"@solidjs/signals": patch
---

`refresh(memo)` inside an action no longer loops forever when a render
effect reads `isPending(memo)` (#4349). The action's transaction landed
beneath the re-ask's flight, so the reader observed the flight and held a
frame of its own; the lane seam then re-derived that reader on the committed
world every round, and each re-run re-entered the same transaction and parked
it again until the dev guard threw "Potential Infinite Loop Detected". A
reader a parked transaction holds that read none of its stagings now runs at
the landing instead. The same loop hit `[isPending(x), x()]` in one render
effect after an action's write to `x`'s input. A bare refresh stays quiet
(`v41`, then `v42`); `affects()` + `refresh()` shows `pending`, then `v42`.
