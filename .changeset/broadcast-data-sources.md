---
"@solidjs/web": patch
---

`broadcast(fn)` now shares data sources too. When a broadcast returns an async iterable of values (a generator of data), callers with the same arguments share one source: the first caller's runs, later callers' answers are closed unread, and each codec record is serialized once and written to every viewer. A viewer that joins later gets the latest value, then the shared stream. Before, a data broadcast was served per connection, exactly like `live`.
