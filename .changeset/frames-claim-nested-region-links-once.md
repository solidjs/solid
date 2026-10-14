---
"@solidjs/web": patch
---

fix(frames): a link inside nested slot regions is claimed once per adoption instead of once per enclosing region, and a streaming document whose server components mint no tier writes an empty `sc:tiers` record so the client skips its per-element slot-marker scan
