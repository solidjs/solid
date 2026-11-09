---
"@solidjs/web": patch
---

A viewer that joins a running `broadcast` is sent each live range once, as it shows now. Its snapshot used to carry the frame as it first rendered and then every changed hole whole again, so a late joiner downloaded a big live table twice (about 600 ms to join a 2,000-row table, now about 120 ms).
