---
"@solidjs/web": patch
---

Bound the request body cap by the bytes actually received: a conforming Content-Length under the limit no longer skips the counting read, so an under-declared body cannot stream past `bodySizeLimit` into the decoder, and the abort/teardown coupling for abandoned uploads now covers declared-length POSTs too (#3236).
