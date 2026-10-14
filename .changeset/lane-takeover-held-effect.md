---
"@solidjs/signals": patch
---

Fix a render effect a lane took over from a held transaction: it keeps running as the lane's work while it waits on the lane's flight, and drops the hold when it leaves the lane (#3766).
