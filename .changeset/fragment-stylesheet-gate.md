---
"@solidjs/web": patch
---

Streamed fragments gated on their stylesheets now reveal under a nonce-based CSP, and no longer stay on the fallback when a sheet loads before its fragment's template is parsed (#3747). The gated links carry `data-dfc` instead of inline `onload`/`onerror` handlers, which a strict `script-src` blocks; a capture-phase listener installed by the stream's fragment helpers, from a script that carries the nonce, counts them down. The content template is now written ahead of its links: a cached sheet could fire `load` before the parser reached the template, and `$dfr` dropped the reveal.
