---
"@solidjs/web": patch
---

A cleanup that throws while a stream is torn down no longer crashes the server (#4029). Aborting `renderToStream`'s `signal` disposes the render inside the `abort` listener, where a throw became an uncaught exception; the teardown now reports it through `onError` as a failed render (`handling: "failed"`) and finishes.
