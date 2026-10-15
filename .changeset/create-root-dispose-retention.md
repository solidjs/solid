---
"@solidjs/signals": patch
---

A `createRoot` dispose function no longer keeps the root's `init` function (and everything it closes over) alive while it is held (#4095).
