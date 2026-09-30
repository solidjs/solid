---
"@solidjs/web": patch
---

`createSSRResponse` no longer hangs when a streamed render ends before its shell flushes (#3719). A render that fails pre-shell (`onError` hears `handling: "failed"`) or is aborted through its `signal` now resolves with a bodyless 500, or a redirect when a `Location` is already on the response stub, and the stub is committed. A render that succeeds with an empty document resolves with an empty 200. The promise still never rejects.
