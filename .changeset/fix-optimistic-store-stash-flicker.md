---
"solid-js": patch
---

Fix `createOptimisticStore` flicker on the second toggle of the same property when the action calls `refresh()` after `yield`. The stash branch's committed-view rerun was firing whenever the action queue was empty, even if the transition was still waiting on async reporters — causing render effects to briefly read the previous committed value before the new override. The rerun now also requires `_asyncReporters` to be empty, matching `transitionComplete`'s definition of idle.
