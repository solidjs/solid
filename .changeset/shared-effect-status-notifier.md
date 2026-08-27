---
"@solidjs/signals": patch
---

Effects dispatch status through one shared notifier instead of storing it per node: `effect()` stored the module-level `notifyEffectStatus` on every effect through `ext()`, allocating the full 19-field `NodeExtension` at every effect creation — +127 B/node and +23% effect creation time, shipped unnoticed with the stage-3 cold-field split. Status walks now resolve the notifier via `statusNotifierOf` (an own `_x` channel — boundaries — wins; effect nodes fall back to the shared one), which preserves the walks' display-consumer membership semantics exactly. Effect nodes drop to 488 B (below even the pre-stage-3 528) and creation recovers to ~1.07 ms/10k from 1.26.
