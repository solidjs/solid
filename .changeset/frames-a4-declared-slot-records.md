---
"@solidjs/web": patch
---

frames: A4 (S-record) — the document face declares a slot record at its marker: `_$HY.r["sc:slot:<fid>:<occurrence>"]` is a pending promise written with the occurrence's markup and settled with the args by the record's data script (the shape a fragment's `<key>_fr` takes), so the adopting client awaits a record that trails its range's reveal through the value's own `.then` instead of polling the registry (C2 (a2) flips). Output shape: ≈ +32–38 B per document slot record (the resolver helpers are shared with the page's fragment declarations); a sync render (`renderToString`) writes the settled value as before. Deleted: the #2968 `setTimeout` re-drain poll and `FrameOptions.recordsPending` / `FrameOptions.drainRecords`.
