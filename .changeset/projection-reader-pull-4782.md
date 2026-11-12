---
"@solidjs/signals": patch
---

A projection read by another projection's derive is brought up to date before it is read, and its reader is ordered after it. A write that dirtied N rows no longer re-ran each downstream reader up to N times (#4782).
