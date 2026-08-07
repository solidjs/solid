# RFC: SSR and the HTTP exchange

**Start here:** If you’re migrating an app, read the beta tester guide first: [MIGRATION.md](MIGRATION.md)

> **Status note:** Everything here is **shipped** in the 2.0 beta. This document collects the server-rendering entry points and the HTTP exchange surface of `@solidjs/web` — pieces that previously lived in SolidStart or in scattered subpath lore. The per-primitive hydration policy (`ssrSource` / `deferStream`) is documented with async data in [RFC 05](05-async-data.md); `clientOnly` with control flow in [RFC 03](03-control-flow.md); server functions and server components in [RFC 10](10-server-functions.md) / [RFC 11](11-server-components.md).

## Summary

`@solidjs/web` owns both halves of server rendering: the render entry points (`renderToString` and `renderToStream` on the server; `render`, `hydrate` on the client) and the HTTP exchange they run inside (the request event, the response head, the render tree’s authority over it via `httpStatus`/`httpHeader`, and cookie access via `getCookie`/`setCookie`/`deleteCookie`). Any Vite app — with or without a metaframework — can server-render, stream, and shape its HTTP responses from core alone.

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

### Cookies: `getCookie` / `setCookie` / `deleteCookie`

```ts
import { getCookie, setCookie, deleteCookie } from "@solidjs/web";

// inside a server function, loader, or handler:
const theme = getCookie("theme"); // string | undefined
setCookie("session", token, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 7 });
deleteCookie("session"); // empty value + Max-Age=0, honoring { path, domain }
```

Cookies are the one header where “just use `httpHeader`” has a correctness story core must own — parsing the `Cookie` grammar, encoding values that round-trip, and (below) keeping multiple `Set-Cookie` values intact through every merge — so the helpers ship from core while everything built *on* cookies (sessions, auth) stays above.

All three resolve the request event the same way the response primitives do: called with a name they read `getRequestEvent()` ambiently; called with an explicit event first (`getCookie(event, name)`, `setCookie(event, name, value, options?)`) they work against exactly that event — middleware and handlers outside the ambient scope included.

- **Reads are a request-only view.** `getCookie(name)` parses the `Cookie` header the client sent, decoded, or `undefined`. A `setCookie` in the same request does **not** read back — the request is what arrived, the response is what you’re building, and merging the two invents a browser round trip that hasn’t happened.
- **Writes append `Set-Cookie` onto `event.response.headers`.** `serializeCookie` formats it: name and value percent-encoded (any string round-trips), `path` defaulting to `/`, and `domain`/`maxAge`/`expires`/`httpOnly`/`secure`/`sameSite` emitted exactly when given — no other magic. The wire-format halves (`parseCookieHeader`/`serializeCookie`) are exported for code building on the same grammar.
- **The `set*` verbs are deliberate** where `httpStatus`/`httpHeader` avoid them: cookie writes are event-time *mutations* of the outgoing head — appends that own no scope and never retract — not scope-tied declarations.
- **Committed is a hard line, never a silent one.** `httpStatus` past `committed` no-ops by contract — a retraction-capable declaration arriving late has nothing to say. A cookie write is imperative data (a session being established); losing it is a bug. So `setCookie` after the head went out **throws in the dev build** and reports through `console.error` (and no-ops) in production, where crashing a request that is already streaming would compound the bug.

**The multi-`Set-Cookie` guarantee.** `Set-Cookie` is the one header that must never fold: multiple values are separate headers, commas are legal *inside* a single value (`Expires`), and `Headers` iteration semantics differ across runtimes. Every place core materializes a response head — `createSSRResponse`’s derivation (including its redirect paths), the server-function handler’s response encoding and forwarded `respond()`/`redirect()` metadata, the no-JS form redirect — carries `Set-Cookie` values entry-by-entry via `getSetCookie()` + append, never `get`/`set` or constructor-copy folding. That is the portability contract across Node/undici, workerd, and Deno; integrations merging headers themselves should follow the same rule.

During a server function the handler folds the event’s response stub onto the outgoing response as the head freezes — cookies set by the mutation ride whatever leaves, thrown redirects included (the set-session-then-`throw redirect()` login flow works by construction) — and marks the stub `committed`, so a straggling write after the response is on the wire reports instead of vanishing.

### Sessions (recipe)

Sessions are deliberately **userland** — the boundary rule again: core owns the exchange (cookie in, cookie out, committed semantics), not the policy above it (what’s in the session, how it’s protected, where it lives). The primitives plus WebCrypto — available on every runtime core targets — are the whole recipe.

A signed session cookie (data in the cookie, HMAC keeps it tamper-proof; it is readable, so nothing secret goes in it):

```ts
import { getCookie, setCookie, deleteCookie } from "@solidjs/web";

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
  const raw = getCookie("session");
  const value = raw && (await unsign(raw, secret));
  return value ? JSON.parse(value) : {};
}

export async function setSession(data: Record<string, unknown>, secret: string) {
  setCookie("session", await sign(JSON.stringify(data), secret), {
    httpOnly: true, secure: true, sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7
  });
}

export function clearSession() {
  deleteCookie("session");
}
```

The storage-backed variant is the same shape with the payload swapped for a pointer: the cookie carries only a random id (`crypto.randomUUID()`, signed the same way if you want tamper evidence), and `getSession`/`setSession` read and write the data against your store (KV, Redis, a database row) keyed by it. That keeps the cookie small, makes sessions revocable server-side, and lets the data hold things a readable cookie never could. Which store, what’s in the session, and when it rotates are exactly the policy decisions that make this userland.

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
| Start’s `getCookie`/`setCookie` (vinxi/h3 re-exports) | `getCookie`/`setCookie`/`deleteCookie` from `@solidjs/web` — ambient or explicit-event, committed-aware |

## Removals

- No component forms of the response primitives ship from core (see the boundary rule in RFC 10’s decision record: scope-tied declarations over the core response contract are the last stop on that line).

## Alternatives considered

- **Leaving the exchange to metaframeworks** — rejected; see the decision record in [RFC 10](10-server-functions.md#what-belongs-in-solidjsweb-decision-record).
- **`set`-verb naming (`setHttpStatus`)** — rejected: the primitives declare for a scope’s lifetime and retract on disposal; `set*` is reserved for event-time mutation that owns no scope.
- **Cookie helpers as sugar over `httpHeader`** — the original decline, superseded: `getCookie`/`setCookie` ship because they cleared the bar the boundary rule sets — a correctness story requiring core access (the `Cookie` grammar, committed-aware writes, and the multi-`Set-Cookie` merge guarantee only core’s materialization paths can promise), not just a shorter spelling. Sessions and other policy atop cookies remain above the line.
