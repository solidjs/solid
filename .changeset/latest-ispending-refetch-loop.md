---
"@solidjs/signals": patch
---

A pass that reads `latest(m)` and then `isPending(m)` of an unheld refetch outside any `Loading` no longer loops ("Potential Infinite Loop Detected"): the `latest` read opened the flush's transaction for nothing held, the probe asked to re-run at that transaction's landing, and every re-run opened another. The probe now joins the verdict lane without asking for that re-run; the reader shows the committed value beside `true`, then the refetch's answer.
