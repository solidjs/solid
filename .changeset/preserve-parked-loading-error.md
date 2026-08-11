---
"@solidjs/signals": patch
---

Preserve a loading-value memo's settled error while a retry is parked on an unready dependency. The parked retry remains verdict-quiet and resumes when its dependency settles instead of exposing a `NotReadyError` in place of the original error.
