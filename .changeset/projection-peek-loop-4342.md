---
"@solidjs/signals": patch
---

A derived store whose derive peeks (untracked, catching `NotReadyError`) at a memo built from its own keys settles instead of re-running without bound (#4342). A derive's synchronous pass no longer re-runs the readers left linked to it from a flight that has already landed. A held frame keeps those links, and re-running them on every pass made a loop: the reader, then the peeked memo, then the derive, all in one flush, until `queuePendingNode` threw a `RangeError`. This is the query-hook shape: a keyed list of rows, each row with its own hook, and a parent key switched while the list's answer is in flight. Landings still re-run the readers that observed the flight (#4070).
