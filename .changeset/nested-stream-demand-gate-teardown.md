---
"@solidjs/web": patch
---

Server function response streaming now demand-gates and tears down every async-iterable or ReadableStream source in the result graph, not just a top-level one (#3125). A stream nested inside the result (`{ items: rows(), total }`) no longer produces unbounded ahead of a slow consumer, and a cancelled or aborted request closes it — `iterator.return()` runs, so generator `finally` blocks release their resources instead of leaking per abandoned request. The demand gate is shared across concurrently pumped sources (a consumer read wakes all parked pulls; each steps once and re-parks).
