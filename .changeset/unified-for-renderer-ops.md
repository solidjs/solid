---
"@solidjs/web": patch
---

Unified For slot is renderer-agnostic: all platform touches ride a SlotOps interface (insert/remove/createText/isNode/clear/tag) handed to the slot by the engaging insert as one module-level singleton — monomorphic call sites, verified perf-neutral (interleaved A/B dead even on mount/tick/tick_partial). This is what lets the slot travel with For's module graph and gives universal renderers a direct adoption path.
