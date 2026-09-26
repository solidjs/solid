---
"@solidjs/signals": patch
---

Fix a chained optimistic store dropping a write back to the base's previous value (#3672)

- `createOptimisticStore(base)` over a `createStore` serves the base's live value; its own nodes are links whose `_value` is never served and never updated when the base commits. The engine's no-op check for an optimistic write compared against that stale `_value`, so once a first action had been confirmed in the base, a second action writing the key back to its earlier value (`position` from 1 back to 0), re-adding a key the base had deleted, or popping a row the base had appended emitted no override while the action's other writes showed. The optimistic setter now syncs a chained node without an active override to the visible committed value before the engine write.
