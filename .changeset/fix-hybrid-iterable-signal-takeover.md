---
"solid-js": patch
---

Hybrid async-iterable takeover for signal-shaped nodes (#2993). `ssrSource: "hybrid"` on a `createMemo`/`createSignal(fn)` async generator serializes only the server's first yield — the client is supposed to continue the iteration, but signal-shaped nodes adopted that first yield and latched there forever (stores already re-ran their generator through the shadow-draft takeover). The client now re-runs the generator once hydration adoption completes: its first yield reproduces the server value and subsequent yields apply live. Sync and promise-shaped hybrid computes keep their adopt-the-serialized-value semantics.
