---
"@solidjs/web": patch
---

frames: the assets tier (frames savings pass C5) — the head mirror a segment's `assets` record drives (the stylesheet gate, module and typed preloads, inline styles) leaves the eager frames client for the lazy chunk `@solidjs/web/frames/assets`, loaded through the tier mechanism. A segment whose assets record carries stylesheets or inline styles is not ready while the tier is not resident: the server's fallback stays on screen and the reveal happens at max(tier load, stylesheet load) — no segment reveals unstyled. Once the tier is resident only stylesheets gate; inline styles, modules and preloads apply at the record's arrival, and a segment with none of these never waits on the tier. New export path `@solidjs/web/frames/assets` (`@experimental`); `InstallOptions.tiers` loaders resolve `TierModule` (a module with or without `install()`).
