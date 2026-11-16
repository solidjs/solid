---
"@solidjs/web": patch
---

A server function call made inside a tracking computation is the computation fetching its value — a read whatever the wire shape. The transport no longer advertises flight data sources nor delivers a mutation notification for it, so a `query()` fetcher that calls a plain server function stops invalidating the query that asked (#4913).
