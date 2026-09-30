---
"@solidjs/web": patch
---

Live server components reconnect conditionally (frame face). Every frame chunk carries a server-minted digest (`html`: skeleton digest plus a `holes` map; `fragment`/`hole`/`attr`: their own), the mount keeps a ledger of applied content (`Frame.have()`), and the `live` loop asks the frames handler per connect (`responseHandler.resume`) so a reconnect sends the address's version ordinal as `Last-Event-ID` and the ledger as `X-Frame-Have`. A frame render given that list (`FrameStreamOptions.resume.have`, read by `frameTransformResult` at the live address) skips the root when the skeleton matches and emits only the settled holes and attrs whose digest differs — never a fragment or a fallback reveal over content the client names. `FrameChunk` gains `hole` and `attr` members; `FRAME_HAVE_HEADER` / `FRAME_HAVE_BUDGET` are exported from the frames client and server entries.
