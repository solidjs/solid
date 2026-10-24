---
"@solidjs/signals": patch
---

A memo whose first read rejected stays uninitialized when it is re-asked: an `isPending` pass and `latest()` throw NotReady until a value lands instead of reading `undefined` (#4244).
