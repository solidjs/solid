---
"@solidjs/web": patch
---

Fix SSR stream never closing when a fragment rejects terminally while async work in its subtree is still pending (#3165). Pending promises written to the hydration serializer now join an abandonment ledger keyed by hydration id; a fragment settling with an error releases everything under its key — descendant registry fragments settle so `flushEnd` can drain, and abandoned serialized deferreds resolve so seroval's completion fires. Independent live boundaries keep gating the response as before.
