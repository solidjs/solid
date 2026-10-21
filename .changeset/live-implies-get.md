---
"@solidjs/web": patch
---

`live(fn)` now implies `GET`: a live source is a read by contract, so the declaration grants GET dispatch on the server and connects over the GET transport on the client. `live(GET(fn))` keeps working and is equivalent. The client's POST-at-the-live-address path is gone, which trims live pages by ~144 B minified.
