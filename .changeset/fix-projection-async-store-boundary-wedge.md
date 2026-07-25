---
"@solidjs/signals": patch
---

Fix a projection over an async store wedging its Loading boundary on `undefined` (#2938). The store trap's uninitialized guard (#2897) also ran for observer-present reads, vetoing `read()`'s verdict with the stale UNINITIALIZED flag during the settle flush (the firewall's flag clear is deferred to batch commit) and throwing a fresh NotReadyError for an already-settled source that no sweep would ever release. The guard is now scoped to its documented contract — genuinely untracked fall-throughs — so downstream recomputes read the first values off the pending rail at settle, while untracked reads still throw for the whole uninitialized window (the seed never leaks).
