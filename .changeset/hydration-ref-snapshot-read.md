---
"@solidjs/signals": patch
---

Hydration no longer discards a served element and calls its ref twice when the ref reads a signal whose value differs from the hydration snapshot. The ref is served the snapshot and runs once on the served element; its read no longer replays the pass that created the element.
