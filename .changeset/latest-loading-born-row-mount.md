---
"@solidjs/signals": patch
---

A `latest()` loading flag no longer stays `true` forever when a memo's branch creates a memo and a render effect that reads it (#5073). The render effect waited on the verdict lane's reveal, and the lane waited on that render effect.
