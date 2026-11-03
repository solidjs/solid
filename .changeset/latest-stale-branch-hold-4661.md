---
"@solidjs/signals": patch
---

A memo whose last run read `latest(x)` no longer holds a `<Loading on>` switch while `x`'s new flight is up: its read of the switch's own write is the screen's, and a flight it reads only inside `latest()` is one it reads ahead of (F-6). The fallback shows at once; the memo keeps its committed value until the flight lands (#4661).
