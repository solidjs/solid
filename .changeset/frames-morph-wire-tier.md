---
"@solidjs/web": patch
---

Frames: the range morph (the reconcile that lands a refetched or navigated root over shown content) moves out of the eager frames client into the lazy `wire` tier, about 790 B brotli off every server-components page. A frame call on a page that shows frames starts the tier's load with its request (so a router's hover preload warms it), and a root landing over shown content waits for the tier; adoption and first materialize never morph and never load it.
