---
"@solidjs/web": patch
---

server-mock types adopt CSPNonce for renderToString/renderToStream, matching the runtime's per-destination nonce split (string or { script, style } with false to leave a destination un-nonced).
