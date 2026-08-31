---
"@solidjs/signals": patch
---

Round-10.8 audit fixes (final round): demotion re-drive compute passes capture throws per entry (a throwing getter routes to its boundary instead of halting held siblings during scheduling), and each re-driven entry owns a disposable root — unbind cancels the fallback effect whether queued or live, retiring the "demoted rows outlive removal" edge.
