---
"solid-js": patch
---

Support Reveal collapsed mode in string (non-async) SSR by providing RevealGroupContext and collapsing non-frontier fallbacks server-side. Warn for nested Reveal in renderToString where client coordination is limited.
