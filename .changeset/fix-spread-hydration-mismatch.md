---
"solid-js": patch
---

Bump dom-expressions to 0.41.0-next.9 to fix SSR spread element hydration mismatch. Dynamic children of spread elements were incorrectly wrapped in memo() on the server, consuming extra owner slots and causing _hk value misalignment with the client.
