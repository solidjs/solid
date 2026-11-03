---
"@solidjs/signals": patch
---

A memo over an error boundary's output no longer halts when the boundary's source rejects during a held change: the boundary shows its fallback, as it does when a render effect reads the output directly (#4640).
