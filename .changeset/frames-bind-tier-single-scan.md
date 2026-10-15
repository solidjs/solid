---
"@solidjs/web": patch
---

perf(frames): while the bind tier is announced or loading, the slot walk visits comments only and holds the frame, so `_s:*` attributes are scanned once, after the tier installs, instead of twice
