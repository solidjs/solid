---
"@solidjs/web": patch
---

Hoist SolidStart's remaining web-protocol pieces into `@solidjs/web`: `clientOnly`, the JSX response components `HttpStatusCode`/`HttpHeader`, and the renamed `getServerFunctionInvocation` through the server-functions bridge.

- **`clientOnly(() => import("./Comp"), { lazy? })`** (named export, both builds) wraps a dynamically imported component so it renders only in the browser: the server renders `props.fallback` and never starts the import, the client shows the fallback until load + mount and then swaps the real component in. Unlike `lazy()`, it avoids Suspense entirely and never server-renders the wrapped component, so it participates in no hydration asset manifest and its code is guaranteed to never run on the server; the mount gate keeps hydration mismatch-free. `{ lazy: true }` defers the import to the component's first render.
- **`<HttpStatusCode code text?>` / `<HttpHeader name value append?>`** declare response status and headers from JSX during SSR, writing to the request event's `response` head (the core `RequestEvent` contract — no framework event required). Retraction semantics fix two SolidStart reference bugs: writes snapshot the prior value at write time and restore it on disposal — a 404 page whose inner boundary recovers stays a 404 instead of being stomped back to 200, and header retraction is an exact revert instead of the reference's broken comma-splitting (split `", "`, join `","`). Both writes and retractions are no-ops once the integration marks the event `complete` (response head sent). Client builds render nothing and touch nothing.
- **`getServerFunctionInvocation`** (and its `ServerFunctionInvocation` type) re-export through `@solidjs/web/server-functions`, replacing `getServerFunctionMeta` — the rename resolves the near-collision with `getServerFunctionMetadata(fn)` (static declaration metadata) versus this accessor's info about the call in flight. Clean rename, no back-compat alias.

Requires the next `@dom-expressions/runtime` release (the `response`/`complete` request-event contract and the invocation rename land there).
