---
"@solidjs/signals": patch
"solid-js": patch
---

A cleanup that disposes its own root (or throws) runs exactly once: the disposal list is detached before it runs (#3601).
