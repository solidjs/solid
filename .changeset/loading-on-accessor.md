---
"@solidjs/signals": patch
"solid-js": patch
---

Dev: warn `LOADING_ON_ACCESSOR` when a Loading boundary's `on` receives a function (`on={route}` or `on={() => route()}`). The boundary never calls it, so it never re-arms; pass the value, `on={route()}`. Dev builds only.
