---
"@solidjs/signals": patch
---

An optimistic guess into a second `createOptimistic` log shows at once while another action's `refresh()` is in flight over the list both read (#4666). A reader held by that action's hold is seated in the new guess's lane when every flight it waits on is a re-ask (D-34 ¶3, F-11); one pending on a new question stays held (#4577). The same holds when that log already carries another action's guess whose lane has shown: a render effect reading the overlay now re-runs at that lane's reveal instead of waiting with the refresh's hold.
