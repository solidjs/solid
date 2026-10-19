---
"@solidjs/web": patch
---

Frames: the range morph (the reconcile that lands a refetched or navigated root over shown content) moves out of the eager frames client into the lazy `wire` tier, about 790 B brotli off every server-components page. A frame starts the tier's load when a new version or address arrives over content it shows, and its root waits for the tier; adoption and first materialize never morph and never load it.
