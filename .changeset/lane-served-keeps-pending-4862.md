---
"@solidjs/signals": patch
---

A guess lane's pass that is served the committed value of a flight still in the air keeps the node's pending, so a `<Loading on>` fallback waiting on that flight stays up instead of showing the previous key's rows (#4862).
