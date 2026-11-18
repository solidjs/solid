---
"@solidjs/signals": patch
---

A reader's first read of an errored async source no longer asks it again. A memo that reads through `x catch alt` makes a new error boundary on each run, and a component that mounts over a failed store, now read the error instead of re-asking the source and waiting on that ask. A reader re-run by a change still retries the source it read before (#5002).
