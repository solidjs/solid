---
"@solidjs/signals": patch
---

fix(signals): a pending memo nothing reads no longer holds a fresh `<Loading>` when its subtree mounts under a held update (#4542)
