---
"@solidjs/web": patch
---

Frames client: a live-hole apply no longer searches the frame for its marker on every write. Each hole's target is cached between applies and reused while it is still the frame's and still matches; otherwise the search runs as before.
