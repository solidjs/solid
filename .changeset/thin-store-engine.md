---
"@solidjs/signals": patch
---

Stores run on one signal per key a reader touches (the "thin" engine), in place of the deep engine's per-target committed backing and overlay. The public store API and its rules are unchanged; an app with stores ships about 2 to 3.3 KB less brotli, and an app without stores ships no store code at all. A push to a list no reader has read yet is now kept for a boundary that resumes after it, so the resume claims the server's rows and catches up (GH3).
