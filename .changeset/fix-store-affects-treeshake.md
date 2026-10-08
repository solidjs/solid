---
"@solidjs/signals": patch
---

Keep store-targeted `affects()` working in tree-shaken production bundles. Install the store registration through an explicit dependency of `affects()` instead of a side-effect-only import that bundlers can discard.
