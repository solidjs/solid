---
"@solidjs/web": patch
---

`live` calls move to a live address, `<endpoint>/live/<id>`, answered in event-stream framing.

A `live` loop is a third caller kind receiving a third answer shape, so it gets a third path beside `/data/<id>` (caches key on the url, and a read carries no transport header). The server frames what it answers there as server-sent events — `text/event-stream`, `Cache-Control: no-store`, `X-Accel-Buffering: no`, one codec payload per `data:` event, a comment heartbeat every 20s — so buffering middleboxes pass live responses through. Each value-shaped yield carries a digest of its JSON form as the event's `id:`; the loop echoes the last one back as `Last-Event-ID` on reconnect, and a reconnect whose position equals the first yield's digest gets that yield skipped (fewer yields than before on a digest-equal reconnect — flagged). A cursor source reads the header off the request. Streamed answers at the data address are byte-identical to before.

A client and server versioned apart miss each other on live calls until both are current. Development builds warn once when a page holds more than five live connections and the document came over HTTP/1.1.
