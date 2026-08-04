---
"solid-js": patch
---

Fix `ssrSource` on derived stores during SSR: the server `createStore` dropped the options argument entirely, so `ssrSource: "client"` sources still ran on the server (#2972) and `ssrSource: "server"` async sources were not awaited or serialized (#2971). Sync sources are unaffected: their code is the value transport, so the client re-runs them on hydrated inputs as before.
