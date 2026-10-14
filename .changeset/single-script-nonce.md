---
"@solidjs/web": patch
---

`HydrationScript`, `generateHydrationScript` and `createSSRResponse` now take the same `CSPNonce` as `renderToString`/`renderToStream` (a string or a `{ script, style }` pair) and use its script half, so `event.nonce` can be passed to all of them as is. `scriptNonce` and `styleNonce`, which only existed to do that projection, are now internal: they are no longer documented, and stay exported only for `@solidjs/vite-plugin`'s generated handler until it stops importing them.
