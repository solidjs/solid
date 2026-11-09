---
"@solidjs/signals": patch
---

fix(signals): `latest()` and `isPending()` in a hydration claim read the server's snapshot, as a plain read does, so a client write during the hydration window no longer puts a nested `<Loading on>` into a fallback the server never rendered (a "Hydration key miss") (#4570)
