---
"@solidjs/signals": patch
---

A `<Loading>` that has not shown content no longer reveals content derived from a write still held outside it (F-7, F-1). Two reveals did not consult the hold: a first load the held write re-asked (kept out of every hold, #2937) landed mainline and revealed its answer beside a screen still showing the frame before the write (#4593); and a reader settled by an answer staged in the hold — a rejection, which marks no frame reader (D-41) — revealed the content's stale committed value under a re-armed `on` boundary and let the held write commit early (#4591). The boundary now waits on the held node and reveals with that hold's commit; the rejection shows when a value for the same question would. A first load re-asked under an open action still reveals at its landing (#2937).
