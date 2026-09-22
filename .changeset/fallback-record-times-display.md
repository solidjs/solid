---
"@solidjs/signals": patch
---

The `fallback` attribution record (and the feedback fold's `shows`/`flashes`) times the fallback's display, not the boundary's swap. A `<Loading>` swap is a staged write that lands with its frame (#3575: `on` follows the frame); the engine now holds the show under that transaction and stamps `at` at the end of the drain that rendered it, and a swap cleared before then — the content landed before the frame did, or the commit's own sweep cleared it ahead of any effect (the `LOADING_ON_OUTSIDE_HOLD` shape) — was never on screen and produces no record. `AttributionHooks.boundaryFallback` gains a fourth argument, the transaction the swap is staged in (`null` for a lane swap).
