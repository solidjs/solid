---
"@solidjs/web": patch
---

Write one `data-lha` address on an element whose attribute was still pending inside a `<Loading>` in a live server component (#4032). When the in-tag hole escalated, the attribute capture was dropped but the address it had spliced into the tag stayed, and the boundary's resume minted a second one in front of it. The stale address rode every later attr op for the element, so the first op moved the element off its bound address and every op after it was dropped. The address now goes with the dropped capture.
