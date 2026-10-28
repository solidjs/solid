---
"@solidjs/signals": patch
---

A memo or render effect reading `latest(a)` beside `b()` no longer computes a torn pass on a batched write (#4365). The `latest()` read of a's staging opened the flush's transaction, and the plain read after it took that transaction for a hold, so it paired a's new value with b's old one. Nothing held the flush, so that pass was shown: a render effect behind a memo ran `[2,1]` before `[2,2]`, and a throw from the pass stuck at the error boundary. The plain read now reads the staging as the frame does, which gives one pass on the frame's world. If the flush parks, the seam re-derives the pass as display-ahead work, as before. Separately, a landing now re-derives a stale reader whose own pass threw. Before, it skipped every errored reader, so the error from a display-ahead pass outlived the hold.
