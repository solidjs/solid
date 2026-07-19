---
"solid-js": patch
---

Fix hydration crashing when a lazy component module is evaluated with Solid Refresh enabled (#2920). Refresh component registrations now use plain signals so module-level bookkeeping does not require a reactive owner or consume hydration child IDs.
