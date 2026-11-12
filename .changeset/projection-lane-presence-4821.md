---
"@solidjs/signals": patch
---

fix(store): presence and keys of a slot a lane pass derived read the same frame as its value, so `mapArray` over a keyed projection no longer maps an empty slot after a declined removal (#4821)
