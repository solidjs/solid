---
"@solidjs/signals": patch
---

Document the lean-posture contract for `why()`/`subscriptions()` on the records channel (`why` shares `history("rerun")`'s gate; `subscriptions` reads the graph and is unaffected); ratchet the engine-cost tripwire cap to 4.
