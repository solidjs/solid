---
"@solidjs/web": patch
---

A stylesheet released while it is still loading no longer hangs a gate that warmed it again inside the removal grace. The release schedules the element's removal 100 ms later; a mount in between (a `useHead` stylesheet under `<Loading>`) warmed the same registry entry and waited on that element's load, and the removal took the element out before it loaded. A removed link fires neither load nor error, so the boundary stayed on its fallback. The removal now settles a pending load the way an error does, and the gate warms the sheet again on a new element and waits on that one.
