---
"@solidjs/signals": patch
---

A store target whose last node is released drops its emptied node dictionaries, so a store the app still holds keeps no per-target residue after its readers unmount (#5024).
