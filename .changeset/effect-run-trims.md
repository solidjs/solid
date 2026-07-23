---
"@solidjs/signals": patch
---

Per-run effect/write trims on the plain synchronous path, each individually measured: `recompute` skips the `clearStatus` chain on status-free nodes (guaranteed no-op — every branch of its body is gated on one of the guarded fields) and skips `insertSubs` for subscriber-less nodes; the `syncCompanions` hook call in `setSignal`/optimistic writes is gated on companion existence (its entire body is the two companion pokes); and the store `get` trap's fast path reads through `readNodeFast` — `read()`'s plain-signal fast path hoisted over the call, falling back to the full `read()` whenever a global read window (latest/pending-check/transition/lane/snapshot capture) or node layer is active. The last is worth a consistent ~2–3% on store-read-heavy flushes; the gates are neutral-to-positive and remove dead per-run work from every effect.
