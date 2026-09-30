---
"solid-js": patch
---

Fix hydration adoption throwing when a traced compute calls `Promise.withResolvers()` or `Promise.try()`. The trace run swaps the global `Promise` for a never-settling mock that lacked these two statics, so the call threw out of hydration instead of adopting the server value. The mock now provides both: `withResolvers` returns a never-settling mock with no-op `resolve`/`reject`, and `try` returns a never-settling mock without invoking its callback (matching how the mock's constructor ignores its executor).
