---
"@solidjs/web": patch
---

frames: the assets tier (frames savings pass C5) — the head mirror a segment's `assets` record drives (the stylesheet gate, module and typed preloads, inline styles) leaves the eager frames client for the lazy chunk `@solidjs/web/frames/assets`, loaded through the tier mechanism. A style-gated segment is not ready while the tier is not resident: the server's fallback stays on screen and the reveal happens at max(tier load, stylesheet load) — no segment reveals unstyled. A segment without stylesheets never waits on the tier; inline styles, modules and preloads apply when it is resident (at the record's arrival, or at the install). New export path `@solidjs/web/frames/assets` (`@experimental`); `InstallOptions.tiers` loaders resolve `TierModule` (a module with or without `install()`).
