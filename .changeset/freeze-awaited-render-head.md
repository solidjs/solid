---
"@solidjs/web": patch
---

An awaited `renderToStream(...)` result now freezes the request's response head at completion — the render commits `event.response` right before its final dispose — so `httpStatus`/`httpHeader` declarations survive into `createSSRResponse(html, event)`, which sees the already-committed stub and passes it through. Previously the thenable disposed the render owner before resolving, while the head was still open, so every scope-tied declaration's cleanup retracted it: a page calling `httpStatus(404)` rendered through `await renderToStream(...)` came back as a 200 and its `httpHeader` writes vanished. The piped forms are unchanged (they already froze at shell flush), and so are the retraction semantics themselves — a scope disposed mid-render, such as an errored boundary that recovered, still retracts its declarations. Integrations no longer need to commit the stub from `onCompleteAll` to work around this.
