---
"solid-js": patch
---

Keep an SSR error fallback when a surrounding children slot retries after an async sibling settles. Its hydration keys remain stable, its error is serialized once, and async content inside the fallback keeps resolving.
