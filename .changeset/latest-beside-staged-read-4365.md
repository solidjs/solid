---
"@solidjs/signals": patch
---

A memo or render effect reading `latest(a)` beside `b()` no longer computes a torn pass on a batched write (#4365). The `latest()` read of a's staging opened a transaction for the flush, and the plain `b()` read after it took that transaction for a hold, so it paired a's new value with b's old one. Nothing held the flush, so that pass was shown: a render effect behind a memo ran `[2,1]` before `[2,2]`, and a throw from the pass stuck at the error boundary. `latest()` no longer opens a transaction. Its reader's pass belongs to the frame, and if the flush parks it runs once more in the verdict lane, ahead of the hold.
