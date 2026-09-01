---
"@solidjs/signals": patch
---

Share the pending-backing visibility decision between per-key store reads and deep()/snapshot composition (#3147). deep()/snapshot remain the speculative peek channel (they see ordinary pending staging synchronously), but a transition-HELD landing (#3164 fold) is now masked to the committed view for them exactly as it is for per-key readers, so the two reader families can no longer disagree while a transaction holds store landings.
