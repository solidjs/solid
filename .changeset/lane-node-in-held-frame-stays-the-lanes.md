---
"@solidjs/signals": patch
---

A lane's node inside a held frame stays the lane's: `holdFrame` no longer re-lists a verdict reader (or a derivation of a guess) created under a held pass on the frame's transaction, where the landing nulled its transaction with its lane value still on and the next read of it crashed (`laneRead` → `txOf(null)`, `REACTIVITY_HALTED`) — a `Loading` over `latest(x)`, or a memo of `isPending(() => x())`, unmounted and remounted while `x` is held (fuzzer F7a/F7b; A15 #3698: lane work never makes its node transaction work).
