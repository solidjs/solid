---
"@solidjs/web": patch
---

The frames client bundle resolves the transport's wire-layer imports (server-function framing, addressing, response headers) to the external `@solidjs/web/server-functions/client` entry instead of bundling private copies — one copy of the framing code in an app, and the transport's flight consumer/codec reads are the shared built instance by construction (the getter-override seam is gone). Shrinks `frames/dist/client.js` by ~2.5 kB minified.
