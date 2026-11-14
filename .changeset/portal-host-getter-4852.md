---
"@solidjs/web": patch
---

A disposed `Portal` no longer stays reachable through a live node of the same shape: every portal node shares one `_$host` getter that reads the slot's accessor from the node (#4852).
