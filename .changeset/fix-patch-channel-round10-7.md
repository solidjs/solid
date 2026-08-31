---
"@solidjs/signals": patch
---

Round-10.7 audit fixes: delivery dedup stamps are canonicalized through currentTransition and released at delivery (no merged-away transition retention, correct dedup across merges), held-owner demotion re-drives isolate their first scheduled run per entry, and an explicit unbind after demotion cancels the queued redrive (demotion severing split from the unbind mark).
