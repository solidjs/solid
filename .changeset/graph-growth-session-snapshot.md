---
"@solidjs/signals": patch
---

`GRAPH_GROWTH` no longer reports long-lived state that the page just left also read. What outlived a navigation was the set of nodes reachable as that one navigation opened, and the walk reaches a module-level source (solid-refresh's per-component registry signal in dev, a global store) only through a page that reads it. So arriving at a route from pages sharing more and more of its components, or of its global state, read as growth with nothing leaked. The nodes met as navigations open now go into one set kept for the session, so such a source counts the same at every settle once met, and only what keeps accumulating climbs. Leaked roots, ownerless effects and per-visit subscriptions still report as before. Fixes #4101.
