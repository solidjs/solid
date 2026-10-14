---
"@solidjs/signals": patch
"@solidjs/web": patch
---

ABANDONED_FLIGHTS no longer fires for a frames slot arg that every re-shipped record re-reads while it is still pending (#3852). Dev builds mark the per-key slot-arg memo with an internal option that the check skips; the memo's flights are still recorded and still counted in `feedback()`.
