---
"@solidjs/web": patch
---

A `<Portal>` rendered inside another `<Portal>` now mounts after its parent's content, as in 1.x, so a portal opened from inside another one stacks on top of it (#4963).
