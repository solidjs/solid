---
"@solidjs/signals": patch
"solid-js": patch
---

The `flush` record lists what each drain changed on screen; `OPTIMISTIC_REVERTED` is judged from it; `DEV.hooks.onUpdate` removed

- **`FlushEvent.changes`**: one entry per signal, memo or store property whose shown value the drain changed — by a commit, a held transition's landing, or an optimistic value appearing or lifting — with `nodeId`, `nodeName`, `key` (store properties) and `origin` (the action step, effect, interaction or navigation that staged the value; a held write keeps its origin, so a landing names its action). First values and effects are not listed. New types `FlushChange` and `FlushLive`: the record's `live` is now `{ changes: [{ node, prev?, value? }] }`, index for index with `event.changes`, the values only for a listener that subscribed with `{ bodies: true }`.
- **`AttributionHooks.staged(el)`** replaces `optimisticReverted`: core reports where a value was staged (`queuePendingNode`, `list`), never where it became visible; the engine compares what each staged node showed before and after the drain. `OPTIMISTIC_REVERTED` is that comparison's: a shown guess replaced by its covered value (`reverted`) or by a different one (`superseded`), judged at the end of the drain that shows the correction.
- **Removed**: `DEV.hooks.onUpdate`. Subscribe to `OBSERVE.records` `"flush"` instead (observe and dev builds; requires `attribution.enable()`).
