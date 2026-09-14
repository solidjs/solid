---
"@solidjs/web": patch
---

`renderToString` now disposes its reactive root synchronously before returning instead of via `setTimeout`, so a synchronous loop of renders no longer retains every graph until the next macrotask (#3385). The request event's response head is committed right before that dispose — the same head-freeze point an awaited `renderToStream` already uses — so `httpStatus`/`httpHeader` declarations still reach `createSSRResponse`. A render that throws leaves the head uncommitted and retracts its declarations as before.
