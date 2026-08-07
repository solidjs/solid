# RFC: SSR and the HTTP exchange

**Start here:** If you’re migrating an app, read the beta tester guide first: [MIGRATION.md](MIGRATION.md)

> **Status note:** Everything here is **shipped** in the 2.0 beta. This document collects the server-rendering entry points and the HTTP exchange surface of `@solidjs/web` — pieces that previously lived in SolidStart or in scattered subpath lore. The per-primitive hydration policy (`ssrSource` / `deferStream`) is documented with async data in [RFC 05](05-async-data.md); `clientOnly` with control flow in [RFC 03](03-control-flow.md); server functions and server components in [RFC 10](10-server-functions.md) / [RFC 11](11-server-components.md).

## Summary

`@solidjs/web` owns both halves of server rendering: the render entry points (`renderToString` and `renderToStream` on the server; `render`, `hydrate` on the client) and the HTTP exchange they run inside (the request event, the response head, the render tree’s authority over it via `httpStatus`/`httpHeader`, and the cookie codec `parseCookieHeader`/`serializeCookie` over native `Headers`). Any Vite app — with or without a metaframework — can server-render, stream, and shape its HTTP responses from core alone.

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
export interface RequestEventLocals {
  [key: string | number | symbol]: any;
}

export interface RequestEvent {
  request: Request;
  locals: RequestEventLocals;
}
```

`RequestEventLocals` is the typing seam for `locals`: a plain exported interface applications **module-augment** — no ambient `App.*` namespace (Start's `App.RequestEventLocals` pattern is retired with it). The blessed augmentation target is `@solidjs/web`, and the merge flows to `getRequestEvent()!.locals` everywhere the event surfaces (the main entry, `createRequestEvent`, the server-functions event):

```ts
declare module "@solidjs/web" {
  interface RequestEventLocals {
    user: User;
  }
}
```

The index signature keeps un-augmented usage permissive — `event.locals.whatever = x` typechecks today and keeps typechecking — so augmentation adds precision for the keys it names without gating anything. The deliberate trade (over a strict empty interface intersected with `Record<string, unknown>` at use sites): unaugmented keys read as `any` rather than erroring, and the permissiveness travels with the one interface instead of depending on every use site remembering the intersection. This matches Start's precedent, whose `RequestEventLocals` carried the same index signature.

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

Said plainly, `httpHeader` is a **shell-time API**. Headers declared by streamed route content — anything below a `<Loading>` boundary that resolves after the shell went out — run post-flush and are committed no-ops by contract. There is no queue that holds them for a later response; the head is on the wire. If a header matters, it belongs to the shell (or to a `deferStream`-held source that keeps the shell waiting for it).

### Cookies: the codec + native `Headers`

```ts
import { parseCookieHeader, serializeCookie, getRequestEvent } from "@solidjs/web";

// inside a server function, loader, or handler:
const event = getRequestEvent()!; // `response` is the integration-augmented stub (see above)

const cookies = parseCookieHeader(event.request.headers.get("cookie"));
const theme = cookies.theme; // string | undefined

event.response.headers.append(
  "set-cookie",
  serializeCookie("session", token, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 7 })
);

// deleting = expiring: empty value + Max-Age=0, matching the path/domain it was set under
event.response.headers.append("set-cookie", serializeCookie("session", "", { maxAge: 0 }));
```

Cookies are **not core API** — core owns the **exchange** (the request’s headers in, the response stub’s headers out) and the **codec**, nothing ambient. The web platform hands you whole `Cookie`/`Set-Cookie` headers but no codec for the pairs inside them; `parseCookieHeader`/`serializeCookie` are that codec — the platform-gap primitives — and the two lines above are the whole blessed pattern. Everything built *on* cookies (sessions, auth, an ambient jar) is policy and lives above the line.

- **The codec is dependency-free and does one thing.** Names and values travel percent-encoded and the parser decodes symmetrically, so any string round-trips; `path` defaults to `/` — the only default — and `domain`/`maxAge`/`expires`/`httpOnly`/`secure`/`sameSite` are emitted exactly when given. No signing, no encryption: integrity layers belong to the caller (see the sessions recipe).
- **Both entries export the one real implementation.** A pure value transformer has legitimate browser uses (`document.cookie = serializeCookie(...)`, parsing `document.cookie`), and a client-side no-op stub would hand back silent garbage — so isomorphic code like a shared render path can call it anywhere. Nothing in the client runtime imports it internally, so it tree-shakes out of bundles that don’t.
- **Reads are a request-only view.** The `Cookie` header is what the client sent; an appended `Set-Cookie` in the same request does **not** read back — the request is what arrived, the response is what you’re building, and merging the two invents a browser round trip that hasn’t happened.
- **Writes are event-time mutations of the outgoing head** — `Headers.append` semantics exactly, owning no scope and never retracting. (Cookies declared through `httpHeader` are also simply correct now — its retraction snapshots and restores `set-cookie` entry-exactly instead of comma-joining — but the append above is the blessed spelling.)
- **Committed is a hard line, never a silent one — enforced on the stub itself.** A late cookie is imperative data (a session being established); losing it is a bug. The moment the head freezes (shell flush, or the server-function commit seam), the stub’s `headers` mutating methods fail loudly: a post-commit write **throws in the dev build** and reports through `console.error` (and no-ops) in production, where crashing a request that is already streaming would compound the bug. Because the enforcement lives on the stub, it covers every writer uniformly — direct appends, middleware, anything — not just code polite enough to check `committed` first.

**The multi-`Set-Cookie` guarantee.** `Set-Cookie` is the one header that must never fold: multiple values are separate headers, commas are legal *inside* a single value (`Expires`), and `Headers` iteration semantics differ across runtimes. Every place core materializes a response head — `createSSRResponse`’s derivation (including its redirect paths), the server-function handler’s response encoding and forwarded `respond()`/`redirect()` metadata, the no-JS form redirect — carries `Set-Cookie` values entry-by-entry via `getSetCookie()` + append, never `get`/`set` or constructor-copy folding. That is the portability contract across Node/undici, workerd, and Deno; integrations merging headers themselves should follow the same rule.

During a server function the handler folds the event’s response stub onto the outgoing response as the head freezes — cookies appended by the mutation ride whatever leaves, thrown redirects included (the set-session-then-`throw redirect()` login flow works by construction) — and commits the stub, so a straggling write after the response is on the wire fails loudly instead of vanishing.

### Sessions (recipe)

Sessions are deliberately **userland** — the boundary rule again: core owns the exchange (cookie in, cookie out, committed semantics) and the codec, not the policy above it (what’s in the session, how it’s protected, where it lives). The codec plus WebCrypto — available on every runtime core targets — are the whole recipe.

A signed session cookie (data in the cookie, HMAC keeps it tamper-proof; it is readable, so nothing secret goes in it):

```ts
import { parseCookieHeader, serializeCookie, getRequestEvent } from "@solidjs/web";

const encoder = new TextEncoder();

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign", "verify"]
  );
}

async function sign(value: string, secret: string) {
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(value));
  return `${value}.${btoa(String.fromCharCode(...new Uint8Array(mac)))}`;
}

async function unsign(signed: string, secret: string) {
  const at = signed.lastIndexOf(".");
  if (at < 0) return undefined;
  const value = signed.slice(0, at);
  const mac = Uint8Array.from(atob(signed.slice(at + 1)), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), mac, encoder.encode(value));
  return valid ? value : undefined;
}

export async function getSession(secret: string): Promise<Record<string, unknown>> {
  const { request } = getRequestEvent()!;
  const raw = parseCookieHeader(request.headers.get("cookie")).session;
  const value = raw && (await unsign(raw, secret));
  return value ? JSON.parse(value) : {};
}

export async function setSession(data: Record<string, unknown>, secret: string) {
  const { response } = getRequestEvent()!;
  response.headers.append(
    "set-cookie",
    serializeCookie("session", await sign(JSON.stringify(data), secret), {
      httpOnly: true, secure: true, sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7
    })
  );
}

export function clearSession() {
  const { response } = getRequestEvent()!;
  response.headers.append("set-cookie", serializeCookie("session", "", { maxAge: 0 }));
}
```

The storage-backed variant is the same shape with the payload swapped for a pointer: the cookie carries only a random id (`crypto.randomUUID()`, signed the same way if you want tamper evidence), and `getSession`/`setSession` read and write the data against your store (KV, Redis, a database row) keyed by it. That keeps the cookie small, makes sessions revocable server-side, and lets the data hold things a readable cookie never could. Which store, what’s in the session, and when it rotates are exactly the policy decisions that make this userland.

### The response-head lifecycle: `createRequestEvent` / `createSSRResponse` / `commitEventResponse`

The stub only means something if a handler actually runs the lifecycle: build the stub-backed event, run inside its scope, and derive the outgoing `Response` head at the moment it freezes on the wire. That choreography is core protocol, not integration policy — every handler that reimplements it drifts on the same edges (when exactly `committed` flips, what a redirect set before vs. after the shell flush should do, which stub headers may fold onto a non-page response) — so core ships it. A handler's response leaves through one of exactly **two exits**: page results through `createSSRResponse`, any other `Response` — a middleware early return, an API result — through `commitEventResponse`.

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

- `commitEventResponse(response, event?)` is the **other exit** — handler-lifecycle plumbing for a `Response` that did not go through `createSSRResponse` (a middleware early return, an API result), the same fold the server-function handler's own responses take. It folds the event's stub onto the response — `Set-Cookie` appends entry-by-entry alongside the response's own, other stub headers fill gaps only (never the wire-protocol family the handlers own, never `Content-Type`/`Content-Length` on a bodiless response), the status is never taken from the stub — then commits the stub, so later writes fail loudly. `event` defaults to the ambient `getRequestEvent()`. It is **idempotent at the handler edge**: an already-committed stub passes the response through untouched, so a handler applies it unconditionally after its middleware chain fully unwinds — page responses come back from `createSSRResponse` committed and do not double-fold. Like `createResponseStub` and `getExpectedRedirectStatus`, this is an integrator-tier export: application middleware never calls it — writes to `event.response` inside the request scope are the application surface; the handler edge runs the fold once.

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

What core deliberately does not ship: routing of middleware (per-path matching), session policy (see the recipe above — cookie *access* is core, what you build on it is not), and platform adapters — those belong to the layer above, which composes them out of this shape.

## Migration / replacement

| Old (1.x / SolidStart) | New |
|---|---|
| `import { renderToStream } from "solid-js/web"` | `import { renderToStream } from "@solidjs/web"` |
| `import { getRequestEvent } from "solid-js/web"` | `import { getRequestEvent } from "@solidjs/web"` |
| Start’s `<HttpStatusCode code={404} />` / `<HttpHeader />` components (`@solidjs/start`) | `httpStatus(404)` / `httpHeader(...)` primitives from `@solidjs/web` — core ships functions only |
| Hand-rolled `TransformStream` around `pipeTo` for `Response` bodies | `renderToStream(...).readable` |
| Start’s `createMiddleware` (h3 `Middleware` shapes) | `composeMiddleware` over web-standard `(request, next) => Response` functions |
| Hand-rolled head merging / redirect handling in server handlers | `createRequestEvent` + `createSSRResponse` (commit at shell flush, redirect protocol, post-flush script fallback) |
| Start’s `getCookie`/`setCookie` (vinxi/h3 re-exports) | `parseCookieHeader`/`serializeCookie` from `@solidjs/web` over `event.request.headers` / `event.response.headers` — the codec + native `Headers`; a first-party `cookies()` jar middleware is planned as a post-freeze fast-follow |
| Start’s ambient `App.RequestEventLocals` namespace (`@solidjs/start/env`) | module-augmented `RequestEventLocals` from `@solidjs/web`: `declare module "@solidjs/web" { interface RequestEventLocals { user: User } }` — a plain exported interface, no global `App.*` namespace; flows to `getRequestEvent()!.locals` everywhere |
| Hand-folding stub cookies/headers onto middleware or API responses | `commitEventResponse(response, event?)` from `@solidjs/web` at the handler edge — committed stubs pass through untouched |

## Removals

- No component forms of the response primitives ship from core (see the boundary rule in RFC 10’s decision record: scope-tied declarations over the core response contract are the last stop on that line).

## Alternatives considered

- **Leaving the exchange to metaframeworks** — rejected; see the decision record in [RFC 10](10-server-functions.md#what-belongs-in-solidjsweb-decision-record).
- **`set`-verb naming (`setHttpStatus`)** — rejected: the primitives declare for a scope’s lifetime and retract on disposal; `set*` is reserved for event-time mutation that owns no scope.
- **Ambient cookie conveniences (`getCookie`/`setCookie`/`deleteCookie`)** — the final ruling, after the position moved twice. Originally declined as sugar over `httpHeader`; then briefly **added** during the C6 round (ambient helpers riding `getRequestEvent()`, committed-aware writes) on the correctness argument; then **cut before release** with the line redrawn where it stays: cookies are not core API — core owns the exchange and the codec, nothing ambient. The parts of C6 with a correctness story core alone can tell survive it (the codec’s round-trip grammar, the committed-stub loudness, the multi-`Set-Cookie` merge guarantee); the ambient *reading and writing* did not — it is convenience, and convenience over the exchange is middleware’s job. This matches the Remix/React Router precedent: the codec lives in core, ambience ships as router middleware. A first-party `cookies()` jar middleware is planned as a post-freeze fast-follow — no API commitment yet.
- **Throw-through-boundaries for response control flow** — rejected: letting redirects/`notFound` be thrown during render and caught by `<Loading>`/`<Errored>` boundaries as the way to answer them. After the shell flush the status is frozen and a boundary may already have streamed fallback HTML, so a boundary-caught response throw has no coherent post-commit meaning — there is nothing left it could truthfully do to the exchange. The stub + data-layer model answers every case explicitly instead: pre-flush `Location` becomes a real redirect, post-flush `Location` becomes the client-side script fallback, and server functions carry thrown `Response`s to the client transport whole. A thrown `Response` is control flow for the *integration*, never an error for a boundary to swallow.
