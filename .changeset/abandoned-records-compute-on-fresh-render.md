---
"@solidjs/web": patch
---

A streamed boundary that fails on the server can leave nested reads still pending. The server abandons those reads, and their records used to settle as `undefined`, which the client's fresh render of the failed fragment would then adopt as the server's answer. The server now unregisters abandoned records, so those reads compute on the client. The fresh render also spends an id on each element's hydration key, as the server did, so its reads line up with the server's records by id.
