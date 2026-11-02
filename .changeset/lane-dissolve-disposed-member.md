---
"@solidjs/signals": patch
---

A lane member disposed before its lane dissolves no longer runs again (#4613). When an action's commit disposed a region whose list was still the action's lane work (e.g. a keyed `<For each={[filter()]}>` region swapped by a filter change held with the action), dissolving the lane re-queued the dead list memo; its pass dropped the disposed flag, so it mapped rows in the torn-down region, stayed subscribed, and dev logged `RUN_WITH_DISPOSED_OWNER`. A disposed reader is no reader (F-3, D-11): dissolution now skips it.
