---
"@solidjs/web": patch
---

Keep the server-function dispatch registry on `globalThis` so a re-evaluated runtime (Vite's SSR program reload after an edit in dev) shares one registry with the RPC seam: `query()`-declared reads no longer answer 405 after the first HMR update (#3346).
