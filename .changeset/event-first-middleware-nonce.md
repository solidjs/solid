---
"@solidjs/web": minor
---

Event-first middleware and a per-request CSP nonce on the request event.

**Breaking (prerelease):** `FetchMiddleware` is now `(event, next) => Response | Promise<Response>` — the request is `event.request` — and `composeMiddleware(middlewares)` returns `(event, next) => Promise<Response>`. `next()` takes no arguments: to hand a different request downstream, assign `event.request` before calling it, so the event stays the single source of truth for what later middleware, the handler and the render see. Passing an argument to `next()` rejects with a migration error. `FetchMiddleware` takes an optional event type parameter for integrations with richer events.

`RequestEvent` gains `nonce?: CSPNonce`. `renderToString`, `renderToStream` and `createSSRResponse` fall back to the request event's `nonce` when no explicit `nonce` option is passed, and the render context carries the resolved value, so `<HydrationScript />`, the streamed data/swap scripts, preload links, inline styles and the post-flush redirect fallback all get it. An explicit option wins; an explicit `null`, `""` or `{ script: false, style: false }` renders without one. The event's nonce is read when the render starts — middleware sets it before calling `next()`. `createSSRResponse`'s `nonce` option now accepts the `{ script, style }` form too (its script half is used).
