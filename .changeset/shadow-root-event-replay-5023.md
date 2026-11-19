---
"@solidjs/web": patch
---

Events fired inside a shadow root before hydration finishes are now replayed to their handlers. The server bootstrap records the original target while the event is in flight, because after dispatch the target is the shadow host and `composedPath()` is empty (#5023).
