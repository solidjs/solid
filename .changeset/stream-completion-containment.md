---
"@solidjs/web": patch
---

`renderToStream` contains an `onCleanup` that throws while a render completes normally, as it already did when a render was torn down: the awaited result and the piped consumers finish, the failure reaches the server error hook as `handling: "failed"` and `hasErrors` is set, instead of leaving `await` pending behind an unhandled rejection. After a render failure, `pipeTo` settles only once a slow consumer has drained the written output and closed. A custom serializer that calls `onDone` twice completes the render once.
