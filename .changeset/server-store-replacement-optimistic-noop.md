---
"solid-js": patch
---

Server store setters now apply returned replacements (#3064): a setter returning a wrappable value adopts it into the same root as a plain data operation, matching the client contract — previously the return value was silently dropped while draft mutations landed. Array replacements truncate correctly (also fixes an array-shrink hole in projection sync replacement). Optimistic writes are now true no-ops on the server: `createOptimistic` setters and `createOptimisticStore` setters neither run nor land, since optimistic writes are masks that revert at settle and server output represents settled state — the old aliasing serialized optimistic masks as authoritative state. Server-side writes remain data-only: they update state for subsequent reads and serialization; nothing re-renders.
