---
"@solidjs/web": patch
---

Remove the internal `scriptNonce`/`styleNonce` exports from the server build. They stayed exported after #4016 only because `@solidjs/vite-plugin` ≤ 3.0.0-next.49 imported them. 3.0.0-next.50 projects the nonce itself (solidjs/solid-vite-plugin#409). Apps must use `@solidjs/vite-plugin` 3.0.0-next.50 or later with this release.
