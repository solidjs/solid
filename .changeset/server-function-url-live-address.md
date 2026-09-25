---
"@solidjs/web": patch
---

`serverFunctionUrl` on a `live` reference returns the live address (`<endpoint>/live/<id>[?args=...]`) — the url that reference's own call requests, so a fetch of it is the call: a standing event stream to fetch by hand (`curl -N`), not to preload or prefetch. It used to return the data address, which a live call never requests. The one-shot url is the inner `GET(fn)`'s.

Frame attr holes: an `attr` re-emission now matches the element to the tag's whole attribute text the way the root morph matches server output — attributes absent from it are removed even when the emission carries no `removed` list (a conditional reconnect's cannot). `data-lha` and a `<details>`/`<dialog>` `open` are kept, as the morph keeps them.
