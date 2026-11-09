---
"@solidjs/signals": patch
---

A memo whose verdict posture is only inherited (it reads a memo that calls `isPending`/`latest`, and probes nothing itself) is the hold's work where it reads the hold's own write: it reads that staging instead of the pre-hold value, so a branch the hold opens no longer reads the pre-hold world and the hold lands, whether the writes go through one `flush()` or several. A memo that probes in its own body still reads the screen, and what a branch born into the hold then asks for no longer keeps the hold from landing (#4544).
