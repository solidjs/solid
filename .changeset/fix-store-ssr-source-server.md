---
"solid-js": patch
---

Fix `ssrSource` on derived stores during SSR: the server `createStore` dropped the options argument entirely, so `ssrSource: "client"` sources still ran on the server (#2972) and `ssrSource: "server"` lost its serialization hints (#2971). Explicit `ssrSource: "server"` now also serializes synchronous results (stores, memos, signals, effects) so the client adopts the server value instead of silently re-running a source that may not be client-safe.
