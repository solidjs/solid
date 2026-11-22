---
"@solidjs/universal": patch
---

A custom renderer's single-child hole now mounts content that arrives during a held action at the commit, like `@solidjs/web` does, instead of showing a bare element before it.
