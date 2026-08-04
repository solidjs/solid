---
"@solidjs/web": patch
---

Make the document boundary's record drain re-drainable and wire the adopt-time record-race seam (#2968). `adoptBoundary` previously absorbed `_$HY.r` slot/region records exactly once, synchronously at adoption — so a record whose data script ran after adoption was never delivered, and the frames client misclassified the invoked slot as argless content (halting the reactive system on the first props read). The drain now applies each key once but can run again, and the frame receives `recordsPending` (parser still running, or fragments still pending) plus `drainRecords`, letting a recordless occurrence wait one macrotask and classify with the record present.
