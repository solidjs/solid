---
"@solidjs/web": patch
---

Server-component boundary identity is now the call's intrinsic `(function, arguments)` address — per-args, exactly like the router's query cache, so a cached component always mounts the boundary showing the call it was cached for. Same-args refetches still resolve the identical component and morph in place (no remount through `dynamic`'s equals-gate); a source switching arguments swaps boundaries, re-materialized instantly from the frame host's retained state. This fixes hover preloads for other arguments morphing mounted content, and intermittently blank or stale pages when navigating back and forth between two routes inside the query cache's freshness window.
