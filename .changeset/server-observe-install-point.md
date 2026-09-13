---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
---

Server observe surface: `OBSERVE.server` and the invocation channel

`OBSERVE` gains a `server` slot — an augmentable `ServerObserve` interface declared empty in `@solidjs/signals` (re-exported by `solid-js`) and populated by `@solidjs/web`'s server runtime, so server-side observability consumers subscribe on the one `OBSERVE` object they already know from the client. The first channel is `OBSERVE.server.invocations`: `subscribe("invocation", (event, live) => …)` delivers one `{ id, direct, at, durationMs, outcome, deferred? }` record per server-function execution — HTTP dispatch and direct SSR calls alike — when it settles, with the request event, `request`, `args`, and the result or the error as thrown beside it. Observers, not policy: any number of listeners, none able to alter the call; `wrapInvocation` remains the single policy hook.

`@solidjs/web` now publishes observe-tier server artifacts (`dist/server.observe.js`, `server-functions/dist/server.observe.js`, `frames/dist/server.observe.js`) under the `observe` export condition, alongside the existing dev/prod pairs. The surface and every emit site fold out of the prod artifacts.
