---
"solid-js": patch
---

Server `createProjection` / `createStore` over an async iterable pump in frame scope like a memo does (Stage 8 B5): inside a server-owned frame render every yield lands in the store, commits the binding ledger (live holes reading the store re-emit) and holds the response until the source ends; reads follow the live state. A live-branded source there stays connected, and under a live component's document render a projection takes its first value and closes the source, so the document completes. The slot-border trace's snapshot now waits only for undrained writes, not for a pull in flight.
