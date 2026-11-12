---
"@solidjs/signals": patch
---

fix: a memo's two plain reads of a held value agree when its first `latest()`/`isPending()` of it comes between them (#4777)
