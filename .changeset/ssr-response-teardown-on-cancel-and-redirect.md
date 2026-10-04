---
"@solidjs/web": patch
---

`createSSRResponse` over a stream result now tears the render down when nobody will read it (#3768). Cancelling the resolved body (the client went away, a HEAD request whose body the host cancels) disposes the render through `renderToStream`'s disconnect path, as cancelling its `readable` does: every async source still being pulled is returned, `onCleanup` runs, and nothing more is written. This emits `SSR_STREAM_ABANDONED` with `data.reason: "consumer"`. A pre-flush `Location` (a bodyless redirect) tears the render down the same way, as the JSDoc already said, but without the finding, because nobody left. Previously both only dropped writes, and the render ran on until its sources happened to end. The render's observe record settles as `"abandoned"` in both cases.
