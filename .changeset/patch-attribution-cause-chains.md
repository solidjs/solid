---
"@solidjs/signals": patch
---

Attribution cause chains thread through patch deliveries: emission seams re-stamp the delivery signal with the record's store path and value transition (via a new `patchEmit` hook), and delivery effects name themselves `patchDelivery(store.path)` — so "why did this run" for a patch-applied DOM update reads as the record's write, with previews, instead of an anonymous counter. Dev-only.
