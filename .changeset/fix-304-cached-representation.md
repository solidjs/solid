---
"@solidjs/web": patch
---

A 304 from a server function no longer stamps a body-format header onto the cache update, so a browser replaying a cached GET still decodes the stored value.
