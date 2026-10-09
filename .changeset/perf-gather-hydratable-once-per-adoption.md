---
"@solidjs/web": patch
---

Frames (document adoption): gather an adopted boundary's hydration keys once per adoption, not once per occurrence. Each adopted occurrence's claim window used to select `[_hk^="<prefix>"]` over the whole hydration root — 37 ms on a 652-occurrence comment thread, more than the rest of its hydration. The boundary now indexes the `_hk` nodes under its element once (bucketed by occurrence prefix) and serves every window — the occurrence's and a streamed `<Loading>`'s resume inside it — from that index; a fragment revealed into the element later extends the index for the revealed parent, so late (post-done) claims still find their nodes. The page-level gather and the streamed boundary's resume path are unchanged.
