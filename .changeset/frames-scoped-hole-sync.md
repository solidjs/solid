---
"@solidjs/web": patch
---

Frames client: a live stream's writes no longer re-walk the whole frame. After every write, the slot sync used to walk all of the frame's content and re-parse every binding marker, and each live-hole apply searched the frame for its marker. Both costs grew with everything the frame showed, which was most of the per-write client time once a chat thread had history. Now only a root morph, a reveal, or an empty write ("re-walk what you hold") walks the whole frame. Any other write reuses the last walk's result and walks only the ranges its live holes morphed. That reuse runs in the lazy bind tier; without the tier, the walk sees only comments. Live-hole markers are cached between applies. When reuse can't be exact (a reveal whose content landed after its flush, an attr patch on a consumer, a hole whose parent element is a consumer), the full walk runs as before.
