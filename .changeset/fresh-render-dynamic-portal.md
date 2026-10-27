---
"solid-js": patch
"@solidjs/web": patch
---

A boundary whose server render failed is rendered fresh on the client while adopting the server's records. Inside that render, a `<Dynamic>` tag now creates its element instead of throwing a hydration mismatch, and a `<Portal>` mounts. Hydration also completes when the adopted error has no client boundary to catch it.
