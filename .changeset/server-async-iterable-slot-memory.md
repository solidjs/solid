---
"solid-js": patch
---

Server `createMemo` over an async iterable now keeps by-slot flight memory like thenables do: a `<Loading>` retry that re-creates the node adopts the slot's settled first value (or joins its pending flight) instead of opening a fresh iterable every pass, so sources that hand back a new iterable per call (subscribers, `liveQuery()`) converge instead of reporting "did not converge".
