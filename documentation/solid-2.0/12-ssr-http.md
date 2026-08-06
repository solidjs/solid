# RFC: SSR and the HTTP exchange

**Start here:** If you’re migrating an app, read the beta tester guide first: [MIGRATION.md](MIGRATION.md)

> **Status note:** Everything here is **shipped** in the 2.0 beta. This document collects the server-rendering entry points and the HTTP exchange surface of `@solidjs/web` — pieces that previously lived in SolidStart or in scattered subpath lore. The per-primitive hydration policy (`ssrSource` / `deferStream`) is documented with async data in [RFC 05](05-async-data.md); `clientOnly` with control flow in [RFC 03](03-control-flow.md); server functions and server components in [RFC 10](10-server-functions.md) / [RFC 11](11-server-components.md).

## Summary

`@solidjs/web` owns both halves of server rendering: the render entry points (`renderToString` and `renderToStream` on the server; `render`, `hydrate` on the client) and the HTTP exchange they run inside (the request event, the response head, and the render tree’s authority over it via `httpStatus`/`httpHeader`). Any Vite app — with or without a metaframework — can server-render, stream, and shape its HTTP responses from core alone.

## Motivation

Peer ecosystems park Request/Response handling in a metaframework (React→Next/Remix, Vue→Nuxt, Svelte→SvelteKit). Solid 2.0 collapses that layer: the exchange vocabulary lives in core, per the decision record in [RFC 10 — What belongs in `@solidjs/web`](10-server-functions.md#what-belongs-in-solidjsweb-decision-record). The boundary rule is **own the exchange, not the application semantics above it** — status, headers, redirects, and streaming commitment are core’s; caching policy, routing, sessions, and data layers belong to the layer above.

## Detailed design

### Render entry points

Client (`@solidjs/web` in the browser):

- `render(() => <App />, element)` — mount fresh; returns a dispose function.
- `hydrate(() => <App />, element)` — claim server-rendered DOM. Hydration happens once, at t = 0 (see RFC 11’s hard rule); the document must have been rendered with the hydration script in place (below).

Server (`@solidjs/web` under the `node`/`deno`/`worker` conditions):

- `renderToString(() => <App />)` — synchronous; async boundaries render their fallbacks.
- `renderToStream(() => <App />, options?)` — the streaming renderer: the shell flushes first, and each async boundary streams its resolved fragment plus the activation script that swaps it in. A primitive marked `deferStream: true` (RFC 05) holds the shell flush until its first value resolves instead of letting the enclosing `<Loading>` fallback into the HTML. The returned stream is also a thenable: `await renderToStream(...)` resolves once the tree settles with the fully-resolved HTML string — the settled-string form of the render (what `renderToStringAsync` was before its removal).

For hydration, the document needs the hydration script ahead of the app markup: `generateHydrationScript({ nonce?, eventNames? })` returns it as a string for hand-built documents, and `<HydrationScript />` renders it in JSX documents.

### Consuming the stream: `pipe`, `pipeTo`, `readable`

`renderToStream` returns a result with three consumption surfaces — **exactly one may be used per render** (a second consumer throws with a directed message):

- `pipe(writable)` — Node-style writable streams.
- `pipeTo(writable)` — web `WritableStream`; returns a promise that settles when the render has been fully written.
- `readable` — a getter that builds a web `ReadableStream` internally and hands it back. The stream yields `Uint8Array` bytes, `Response`-body ready:

```tsx
import { renderToStream } from "@solidjs/web";

export function handler(request: Request): Response {
  const stream = renderToStream(() => <App />);
  return new Response(stream.readable, {
    headers: { "content-type": "text/html" }
  });
}
```

`readable` exists because web-standard servers (workers, Deno, fetch-shaped Node frameworks) construct a `Response` from a `ReadableStream` — with only `pipeTo`, every integration re-derived the same `TransformStream` dance by hand.

### The request event

The per-request context on the server is the **request event**: the incoming `Request` plus a `locals` bag integrations and middleware hang state on.

```ts
export interface RequestEvent {
  request: Request;
  locals: Record<string | number | symbol, any>;
}
```

- `getRequestEvent()` (from `@solidjs/web`) reads the current event anywhere under a request scope — component bodies during SSR, server function bodies, loaders. Returns `undefined` outside one.
- `provideRequestEvent(event, cb)` (from `@solidjs/web/storage`) establishes the scope, backed by an `AsyncLocalStorage` instance parked on the global under a registered symbol — separately bundled copies of the runtime find the same one. Integrations call it around the render; it throws on the client, where there is no request to scope.

```tsx
import { provideRequestEvent } from "@solidjs/web/storage";
import { renderToStream } from "@solidjs/web";

async function handleRequest(request: Request) {
  return provideRequestEvent({ request, locals: {} }, () =>
    renderToStream(() => <App />)
  );
}
```

Frameworks extend the event shape with richer fields via module augmentation. The one core knows about structurally is `response`:

```ts
export interface ResponseStub {
  status?: number;
  statusText?: string;
  headers: Headers;
  /** Set by the integration once the response head has been derived/sent —
      status and headers can no longer change. */
  committed?: boolean;
}
```

`ResponseStub` is the response head *as it forms*: the integration exposes it as `event.response`, derives the real head from it when it flushes (for streaming that is the shell flush — well before rendering finishes), and sets `committed` at that point. Everything that writes response metadata during render — including the primitives below — treats `committed` as the gate: later writes and cleanup-time retractions become no-ops rather than errors.

### The response head from the render tree: `httpStatus` / `httpHeader`

```tsx
import { httpStatus, httpHeader } from "@solidjs/web";

function NotFound() {
  httpStatus(404);
  httpHeader("cache-control", "no-store");
  return <h1>Not found</h1>;
}
```

`httpStatus(code, text?)` and `httpHeader(name, value, { append? })` declare response status and headers during SSR **for the lifetime of the calling reactive scope**, writing to the request event’s `response` head. On the client both are no-ops — the response head was sent long ago. They are the whole core API: core ships functions only (SolidStart may provide component wrappers for compatibility).

The naming is deliberate — these are scope-tied *declarations*, not mutations: “while this reactive scope is live, the response has this status/header.” Solid reserves `set*` verbs for event-time mutation; like `createSignal`/`onCleanup`, these are called bare in component or reactive-scope bodies (including behind an `if`) and un-declare on scope disposal.

Retraction is what makes the scope tie meaningful: each write snapshots the prior value at write time and restores it when the owning scope is disposed — a header deleted if there was none, a status returned to what a surviving part of the tree set. An error boundary that renders a 500 fallback, declares a status, and later recovers retracts its write instead of stomping to defaults; a 404 page whose inner boundary recovers stays a 404. Both writes and retractions no-op once the head is `committed`.

Under streaming this implies the natural constraint: status and headers must be decided by content in the shell. Anything that resolves after the shell flush is past `committed` and can no longer speak — use `deferStream` (RFC 05) on the source that decides the status if it must be waited for.

### The response-head lifecycle: `createRequestEvent` / `createSSRResponse`

The stub only means something if a handler actually runs the lifecycle: build the stub-backed event, render inside its scope, and derive the outgoing `Response` head at the moment it freezes on the wire. That choreography is core protocol, not integration policy — every handler that reimplements it drifts on the same edges (when exactly `committed` flips, what a redirect set before vs. after the shell flush should do) — so core ships it:

```tsx
import { renderToStream, createRequestEvent, createSSRResponse } from "@solidjs/web";
import { provideRequestEvent } from "@solidjs/web/storage";

export function handleRequest(request: Request): Promise<Response> {
  const event = createRequestEvent(request);
  return provideRequestEvent(event, () =>
    createSSRResponse(renderToStream(() => <App />), event)
  );
}
```

- `createRequestEvent(request, init?)` builds the canonical event: `request`, `locals`, and a fresh uncommitted `response` stub (`createResponseStub()` is exported separately). `init` spreads over the defaults, so a framework extends the shape — or substitutes its own structurally-compatible `response` — while every event still looks the same to code reading it.
- `createSSRResponse(result, event, options?)` accepts a string (from `renderToString`, or an awaited stream) or a `renderToStream` result, and runs the head lifecycle against `event.response`:
  - **At shell flush** — the moment the head freezes — the stub is `committed` and its status/headers are merged over `options.responseInit` (`Set-Cookie` values survive as separate entries; `content-type` defaults to `text/html; charset=utf-8`).
  - **A `Location` present before the flush** becomes a real redirect instead of an HTML response: bodyless, carrying the stub’s cookies, with the status from `getExpectedRedirectStatus` (also exported — the stub’s own status when it is a redirect status, `302` otherwise, because a status set for the page render doesn’t describe the redirect that preempts it).
  - **A `Location` set after the flush** can only be honored client-side: stream completion appends `<script>window.location=…</script>` before closing, carrying `options.nonce` so a strict `script-src` CSP doesn’t block it.
  - `options.transformChunk(chunk)` rewrites each outgoing HTML chunk — the seam handlers use for entry-script injection and doctype prefixes.

  String results return a `Response` synchronously; stream results return a promise that resolves at shell flush, so returning it from a fetch handler sends the head at the right moment by construction.

### Middleware: `composeMiddleware`

Handlers compose request middleware with the same web-standard shape everything else uses — `(request, next) => Response | Promise<Response>`:

```ts
import { composeMiddleware, getRequestEvent } from "@solidjs/web";

const run = composeMiddleware([
  async (request, next) => {
    getRequestEvent()!.locals.user = await authenticate(request);
    const response = await next();
    response.headers.set("x-served-by", "solid");
    return response;
  }
]);
```

`next()` advances the chain (an optional `Request` argument substitutes the request downstream); the terminal `next` handed to the composed function dispatches to the actual handler. Two properties are load-bearing:

- The chain runs **inside the request scope** the handler established, so `getRequestEvent()` — `locals`, the response stub — works in middleware exactly as it does in application code.
- Nothing reaches the wire until the outermost middleware returns: a streamed body hasn’t been consumed yet when `next()` resolves, so headers on the returned `Response` are still mutable through the whole unwind. Error middleware is a plain `try { return await next(); } catch { … }`.

What core deliberately does not ship: routing of middleware (per-path matching), session/cookie policy, and platform adapters — those belong to the layer above, which composes them out of this shape.

## Migration / replacement

| Old (1.x / SolidStart) | New |
|---|---|
| `import { renderToStream } from "solid-js/web"` | `import { renderToStream } from "@solidjs/web"` |
| `import { getRequestEvent } from "solid-js/web"` | `import { getRequestEvent } from "@solidjs/web"` |
| Start’s `<HttpStatusCode code={404} />` / `<HttpHeader />` components (`@solidjs/start`) | `httpStatus(404)` / `httpHeader(...)` primitives from `@solidjs/web` — core ships functions only |
| Hand-rolled `TransformStream` around `pipeTo` for `Response` bodies | `renderToStream(...).readable` |
| Start’s `createMiddleware` (h3 `Middleware` shapes) | `composeMiddleware` over web-standard `(request, next) => Response` functions |
| Hand-rolled head merging / redirect handling in server handlers | `createRequestEvent` + `createSSRResponse` (commit at shell flush, redirect protocol, post-flush script fallback) |

## Removals

- No component forms of the response primitives ship from core (see the boundary rule in RFC 10’s decision record: scope-tied declarations over the core response contract are the last stop on that line).

## Alternatives considered

- **Leaving the exchange to metaframeworks** — rejected; see the decision record in [RFC 10](10-server-functions.md#what-belongs-in-solidjsweb-decision-record).
- **`set`-verb naming (`setHttpStatus`)** — rejected: the primitives declare for a scope’s lifetime and retract on disposal; `set*` is reserved for event-time mutation that owns no scope.
- **Cookie conveniences and other options-bag sugar over `httpHeader`** — declined per the boundary rule (they carry policy); proposals need a correctness story that requires core access, not just a shorter spelling.
