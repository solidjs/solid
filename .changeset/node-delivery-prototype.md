---
"@solidjs/signals": patch
"@solidjs/web": patch
---

PROTOTYPE (flag-gated, dormant): node-driven patch delivery — one bare
version signal per patched record bumped at the existing emission seams;
the driver applies compiled bodies from a scheduler-timed effect. Enabled
only via globalThis.__PATCH_NODE__; no behavior change otherwise.
