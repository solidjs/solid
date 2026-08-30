# RFC: Server functions

**Start here:** If you’re migrating an app, read the migration guide first: [MIGRATION.md](MIGRATION.md)

> **Status note:** This RFC covers two layers. The base mechanics — the `"use server"` directive, the `@solidjs/web/server-functions` runtime, response helpers, single-flight, and no-JS handling — are **shipped** in the 2.0 prerelease line. The extension surface (`GET`, `withMeta`, the metadata accessors, `prepareRequest`, method enforcement, `id` on proxies, and — added when #3057 supplied the consumer the first draft was waiting on — the per-call invocator `invoke`) is now **shipped** as well; this document remains the canonical specification. One follow-up remains deferred: a dev observation hook for the server-function inspector (deliberately deferred until it can be designed together with its consumer). Dev-only compiler-emitted `name` metadata has since shipped (`registerServerReference(id, fn, name)` / `createServerReference(id, name)` seed the metadata channel). Server components build on this runtime — see [11 — Server components](11-server-components.md).

## Summary

Solid 2.0 moves server functions into core: a `"use server"` directive compiled by the build plugin, backed by a framework-agnostic runtime at `@solidjs/web/server-functions`. The runtime ships _mechanisms_ — transport, an HTTP handler with hooks, response helpers, a single-flight protocol — while routers and frameworks layer _policy_ on top. The extension surface adds exactly five mechanisms: `GET(fn)`, `withMeta(fn, meta)`, the `getServerFunctionMetadata`/`isServerFunction` accessors, a `prepareRequest` client hook, and the per-call invocator `invoke(fn, options, ...args)`.

The governing philosophy: **the server side of a server function is your function body.** Per-function server concerns (validation, auth guards, logging, rate limiting) are lines of code inside the body; global concerns are the handler and transport hooks; there is no third place. Nothing is compiler-recognized; the compiler’s only contract is the directive.

## Motivation

- **Server functions belong to core, not the metaframework:** In 1.x, `"use server"` lived in SolidStart (via vinxi). 2.0 collapses the runtime into core so any Vite app — with or without Start — gets typed RPC, streaming returns, progressive enhancement, and custom serialization.
- **Mechanisms vs. policy:** Every prior era (Start 0.x `server$`, the v1 proxy) grew an ad-hoc extension surface — per-call `fetch(init)`, `withOptions`, registry mutation, compiler-recognized wrappers. Sorting those concerns by _lifetime_ (declaration-static, session-dynamic, call-scoped) yields a much smaller surface. The call-scoped slot was initially empty; a concrete consumer (data-layer cancellation, [#3057](https://github.com/solidjs/solid/issues/3057)) later filled it with `invoke` — a bounded per-call invocator, not the `RequestInit` passthrough the old surfaces grew.
- **The boundary is security-critical:** The handler decodes whatever an attacker sends — the codec reconstructs rich types — and hands it positionally to your function. TypeScript types are fiction at this boundary; treat arguments as untrusted input and check them in the function body.
- **Avoiding the `server$` mistake:** Start 0.x’s `server$` was a compiler-recognized function whose every capability grew compiler knowledge. The directive model exists to avoid that; this design keeps the compiler’s contract at exactly one thing: `"use server"`.

## Detailed design

### The directive and the compiler contract

A function-level `"use server"` directive extracts the function to the server build and replaces it with a fetch-backed reference on the client. A module-level directive does the same for every export of the module.

```ts
export async function addTodo(title: string) {
  "use server";
  await db.insert(title);
  return reload({ revalidate: "todos" });
}
```

Two verified compiler behaviors anchor everything below:

1. **Wrapper calls round-trip at function level.** `export const getData = GET(async (id) => { "use server"; ... })` compiles by swapping only the function expression, so the surrounding `GET(...)` call survives in both server and client output. This works because the directive marks the function _by position_ — the compiler swaps exactly the expression carrying the directive and touches nothing around it.
2. **Anything referenced only inside a `"use server"` body never reaches the client.** The extraction replaces the body with a reference, and the directive pass’s orphan-scoped dead-code elimination removes now-unused imports and bindings — schema libraries, database handles, helper imports all vanish from client output. **The directive boundary is itself the privacy mechanism.**

One architectural fact worth stating, because the two directive levels land on opposite sides of it: **where a wrapper sits relative to the directive decides what it wraps.** At function level the directive marks the inner function, so `registerServerReference(id, fn)` registers the raw function for HTTP dispatch before any wrapper runs — wrapper-position code (`GET(...)` around a `"use server"` body) affects only the client transport and the in-process callable, never HTTP dispatch. That is why the function-level declaration surface (`GET`) is transport-only, and why dispatch-path concerns there belong inside the body.

**Module-level directives invert this: the export’s _evaluated value_ is the server function.** `export const getUser = withValidation(schema, fn)` in a module-level `"use server"` file registers the wrapper’s _return value_ — the composed function — so server-side wrappers (validation, auth, logging, `withDelay(fn, 400)` mock latency) apply to **every call path**: HTTP dispatch and in-process SSR calls alike. Nothing here contradicts the function-level fact; the directive just sits on the other side of the wrapper, so the wrapper is _inside_ the registration instead of outside it. Three properties fall out. First, wrappers are server-only by construction — the client build is rebuilt from scratch as bare reference exports (`createServerReference(id)`), so wrapper code, schemas, and helpers never ship. Second, the compiler stays out of the pattern-matching business: it never asks “which argument is the function” (the `server$()` mistake the positional directive was adopted to end) — it registers the terminal initializer whole, whatever expression it is. Third, the shape check moves to the runtime: `registerServerReference` throws at module eval when handed a non-function, so a stray `export const limit = 5` in a directive module fails the server boot loudly instead of shipping a dead reference the client discovers per-call. Aliasing composes freely (`async function f() {...}` … `export { f }`; alias chains; default exports, named or anonymous — the compiler synthesizes a binding for anonymous default expressions): the alias trace ends at the terminal initializer and registers that. One asymmetry to know: client-transport declarations like `GET` are meaningless _inside_ a module-level file (they are client-side API — there is no client side of a module-level file to declare); they apply at the consumption site or with function-level directives.

### The runtime: `@solidjs/web/server-functions`

The package resolves to a client entry in the browser and a server entry elsewhere.

**Client:** `configureServerFunctionsClient({ endpoint?, codec?, fetch?, prepareRequest?, serializeArgs?, responseHandler? })` — call once in the client entry, only when deviating from the defaults (endpoint defaults to `/_server`; `codec` takes seroval plugin options and must match the server’s; `fetch` replaces the function the transport sends with — always called as `(address, init)` — for concerns the runtime has no opinion about: retries, telemetry, a test double, or pointing calls at a route of the app’s own, which the handler serves through the same `Request` it serves everything else with; `prepareRequest` is the transport middleware hook below; `responseHandler` is the integration seam server components install — see [RFC 11](11-server-components.md)). Compiled client output produces callables that POST to the call’s **data address** — `<endpoint>/data/<id>`, the id in a path segment — with a per-call `X-Server-Function-Instance` id in the headers. The data address is the scripted transport’s own path, where answers are the codec’s; the bare `<endpoint>/<id>` address (a reference’s `.url`, what renders into form actions) answers plain HTTP. Two paths because the two caller kinds get differently shaped answers and shared caches key on the URL: with one shape per path, a cached answer can only ever be replayed to the caller kind it was made for. **Argument encoding (updated since first draft):** arguments with a natural HTTP encoding (a lone string, FormData, File, Blob, ...) go as-is; everything else is sent as **plain JSON by default** — no serializer in the client bundle — and values JSON can’t carry faithfully (Dates, Maps, Sets, typed arrays, cycles) **throw with a directed message** unless you opt in once via `enableRichArguments()` from `@solidjs/web/server-functions/rich-args`, which installs the codec’s write half (~5 KB gz) as `serializeArgs` — importing the entry is the opt-in at the module-graph level, so the serializer ships only when the app asks for it. _Results_ are unaffected — they always travel through the codec, whose decode half the client carries regardless. Async returns (promises, streams) settle over the open connection via length-prefixed chunk framing. (A `@solidjs/web/serialization` subpath exists; most of it is integration-facing plumbing — the bridge exposing the runtime’s serializer machinery for the runtime’s own entries and for integrations building transports — exempt from the 2.0 stability guarantee and subject to change. The one application-facing part is plugin _authoring_: `createPlugin` and `OpaqueReference` are re-exported there from the runtime’s own seroval instance, and custom plugins for the `codec` option must be built from that import — a plugin built against your own `seroval` dependency edge would not fail the build, it would emit nodes the other end of the wire can’t interpret (the version-pinning lesson of solid-start #1474). Application and router code authors plugins there and feeds them to `codec`; everything else on the subpath it should leave alone.)

**Server:** `configureServerFunctionsServer({ endpoint?, codec?, provideEvent?, wrapInvocation?, collectFlightData?, transformResult?, transformDirectResult? })` plus the web-standard HTTP handler:

```ts
import { handleServerFunctionRequest } from "@solidjs/web/server-functions";
import "virtual:solid-server-function-manifest";

// in the server's request handling:
if (url.pathname.startsWith("/_server")) {
  return handleServerFunctionRequest(request);
}
```

The handler resolves the function id, decodes arguments, runs the function under a request-event scope, and encodes the result (forwarding redirect/revalidation metadata through headers). All framework policy layers on through its options — each optional, the bare handler works alone:

- **`createEvent(request)`** — build the request event a call runs under; integrations supply their richer event (cookies, response helpers, platform handles).
- **`provideEvent(event, fn)`** — establish the event scope; defaults to the AsyncLocalStorage instance that `@solidjs/web/storage`’s `provideRequestEvent` parks on the global.
- **`wrapInvocation(run, context)`** — wrap the function execution itself; the per-invocation seam for framework policy that must surround the call (auth guards, logging, error mapping, per-function middleware built in userland). Called inside the event scope with the invocation identity already established — `getServerFunctionInvocation()` answers before, during, and after `run()` — with `context` carrying `{ id, args, event, request?, direct }`. Must return `run()`’s result (replacing it replaces the result; throwing routes through normal error encoding). The **configured** hook also wraps direct SSR calls (`direct: true`, no `request`), so a policy can’t be bypassed by calling the function during a render; the per-request option applies to HTTP dispatch only. One hook, not a chain — composition stays userland, per the symmetry note under `prepareRequest`.
- **`transformResult(event, result, context)`** — observe or replace the result before encoding; the extension point for response-metadata policy. Runs for returned and thrown results alike. Also configurable **server-wide** via `configureServerFunctionsServer` (the per-request option overrides, following the `collectFlightData` fallback pattern), so generic dispatchers that call `handleServerFunctionRequest(request)` with no options still apply it — this is how server components install `frameTransformResult` once. Its in-process mirror for direct SSR calls is `transformDirectResult(value, { id })` (config-only; direct calls never pass through the HTTP handler).
- **`collectFlightData(event, outcome)`** — the single-flight hook (below).
- **`handleNoJS(result, request, args, thrown?)`** — build the response for unscripted calls (below).

**Version skew is recognisable on the wire.** Ids are identity-keyed (`<name>-<hash of file path>`), so ordinary edits — appending, deleting, reordering functions, or editing a body — never move an address another build already handed out; only renaming or removing a function retires its id. A call whose well-formed address is not registered in the deployment that answers it — the ordinary consequence of deploying under open tabs — gets a 404 labelled `X-Server-Function-Unknown`, and the client names it on the rejection (`error.unknownFunction: true`), so an integration can recover (typically: reload the document onto the current build) instead of surfacing a generic failed call. A 404 for a path the address scheme gives no meaning to stays bare — a mistyped route is not skew.

Inside a function body, `getRequestEvent()` (from `@solidjs/web`) reads the current event and `getServerFunctionInvocation()` reads the in-flight call’s id — usable for keying caches or logs. (Renamed from `getServerFunctionMeta` to keep clear of `getServerFunctionMetadata(fn)`, which reads a reference’s _static declaration_ metadata; the invocation accessor describes the call currently executing.) In-process SSR calls run the original function directly (no HTTP loopback) under a derived event marked `serverOnly`.

`registerServerFunction(id, fn)` / `getServerFunction(id)` remain exported for integrations building custom dispatch or introspection. Registry _mutation_ as a userland extension pattern is rejected (see Alternatives).

### Response helpers: `redirect`, `reload`, `respond`

Exported from `@solidjs/web`, usable from server functions and client-side actions alike — same object, same meaning, both sides:

```ts
import { redirect, reload, respond } from "@solidjs/web";

// redirect the caller (integration follows it; 302 default)
return redirect("/dashboard", { revalidate: "session" });

// no value, just "refetch your data" (all keys when omitted)
return reload({ revalidate: "todos" });

// a value plus HTTP metadata a naked return can't express
return respond(item, { status: 201, revalidate: "items" });
```

`respond()` produces a `ResponseEnvelope` — HTTP metadata paired with an in-memory value. The handler forwards the envelope’s headers and status and encodes the value as the body, while scripted callers receive the value transparently. Crucially, the carried response holds a **real JSON body**, so progressive-enhancement consumers (no-JS form posts, direct HTTP) get real JSON while scripted calls get the in-memory value — no reparse. Thrown envelopes ride the same path with an error tag (`X-Server-Function-Error`) and their status forwarded. Check with `isResponseEnvelope()` (a registered-symbol brand, correct across duplicated bundles — always prefer it over `instanceof`).

**Redirects to scripted callers ride a dedicated carrier.** fetch follows the redirect statuses (301/302/303/307/308) before the transport can read them, so a scripted answer masks the 3xx to 200 and carries the redirect in `X-Server-Function-Redirect`: the author’s status plus the target **resolved against the request URL** — exactly the meaning HTTP assigns the `Location` a form post would have received. Resolving server-side means `redirect("/")` and `redirect(new URL("/", url).href)` arrive identical, so an integration compares origins on a real URL instead of guessing navigation strategy from how the author spelled the target (#3102, #3107); decode with `decodeRedirectHeaderValue`. `Location` itself never rides a masked answer — on a 200 it has no HTTP meaning, and an authored `Location` on a forwarding status (a 201’s created-at) stays what it is: data. Unscripted callers get the real 3xx, and the non-followable 3xx band (304) forwards untouched for everyone.

`decodeResponse(response)` (from `@solidjs/web/server-functions`) is the integration-facing decoder: routers call it on responses the transport hands over whole — redirects, revalidation, single-flight payloads — to recover the structured value inside. Raw `Response` returns tagged `X-Content-Raw` pass through the handler untouched.

### Thrown errors: sanitized by default

A thrown `Response`/envelope is intentional control flow and travels untouched. A **plain** thrown value (a bare `Error`, string, or object) is different: serialized verbatim it would ship its `message` and every own-property to the client — a driver/ORM error's failing query, connection string, or bound parameters included. So the handler sanitizes plain thrown values by default: outside the dev build the client receives a generic `Error` (`"Internal Server Error"`) — still an `Error`, so consumer shapes like the router's `submission.error` keep working — with no leaked content. The dev build keeps full fidelity (message, stack, own-properties) for DX and dev tooling.

The dev/prod line is the **build variant, not `NODE_ENV`**: `@solidjs/web` publishes a dev copy of its server-functions server entry behind the `development` export condition — what Vite dev resolves — and every default resolution (plain node, production bundles, deep imports with no bundler signal) gets the sanitizing copy, so the policy fails safe.

Two ways to send intentional error content in production:

- **`respond(error, { status })` / thrown envelopes** — the pre-existing envelope path; carried values are never sanitized.
- **`markSafeError(error)`** (from `@solidjs/web`, next to `respond`/`redirect`/`reload`) — brands an error as intentional client-facing content (a registered-symbol, non-enumerable brand that never rides the wire; check with `isSafeError`). Branded errors pass through sanitization untouched, own-properties included.

Framework error hooks compose the same way: a `wrapInvocation`/`transformResult` override that maps a thrown error expresses intent by throwing an envelope or branding its replacement with `markSafeError` — core never second-guesses a branded value, and never trusts an unbranded one.

### Single-flight

The protocol folds integration data (typically revalidated route data) into a mutation’s response, saving a round trip. Core standardizes only the wire shape and delivery; what the data _is_ — a data-only render, route preloads, a cache query — is entirely the integration’s business.

- **Server:** the `collectFlightData(event, outcome)` hook (config or per-handler) receives the request event and a `ServerFunctionOutcome` — `{ id, value, response, request, thrown }` — and optionally returns a payload. The handler envelopes it as `{ value, data }` under the `X-Single-Flight` response header. It runs after `transformResult`, only for scripted calls that sent the header on the request; redirect-with-data works because the outcome’s `response` carries `Location`, so the hook can produce data for the destination route.
- **Client:** `subscribeFlightData(consumer)` registers the consumer the transport delivers data to. On a single-flight response the transport decodes `{ value, data }`, delivers `data` (with the response as envelope context), awaits async consumers so caches are seeded first, and returns `value` to the caller as if the call were plain. One active consumer at a time; with none registered, the response passes through whole for the integration to `decodeResponse` itself.

**Shipped change:** the request-leg `X-Single-Flight` header moved from per-call attachment (previously the integration sent it, e.g. via `withOptions`) to being set by the client transport **if and only if a flight-data consumer is registered** — subscribing _is_ the opt-in. This is more correct than the per-call header: a consumer-less app never asks the server to do collection work. Same header, new emitter; the server side is unchanged.

**Shipped extension — markup in the payload:** when part of what a mutation invalidates is a _server component_ (RFC 11), the plain envelope cannot carry it — markup never ships as data (single-copy). The handler exposes a `transformFlightResult(event, { value, data }, context)` seam — config or per-handler, the same fallback pattern as `transformResult` — that gets first refusal on the fold. The frames policy (`frameTransformFlightResult`) answers with a frame-stream response: each invalidated call’s markup rides as a region addressed by `(function, arguments)` — the one name both peers derive independently — while the `{ value, data }` envelope rides as response-scoped chunks with component-valued entries as references that resolve to the very boundaries showing those calls. Data reaches the same `subscribeFlightData` consumer, the caller gets the same `value`, and a data-only payload keeps the byte-identical plain envelope — a mutation reads the same whether or not any of what it invalidated was markup, and one round trip settles the value, the data, and the UI.

### No-JS and progressive enhancement

A reference’s `.url` serves as a form `action`, and action urls are **self-describing** (`<endpoint>/<id>?args=...`): an integration can reconstruct a callable from a server-rendered action url alone, with bound arguments kept in the query string where the server reads them for natural-encoding bodies (the callable’s own calls go to the rendered address’s data-address sibling — same mount, same query). `serverFunctionUrl(id, boundArgs?)` and `parseServerFunctionUrl(url)` are the two halves of that scheme for integrations composing action urls the runtime did not render. The bare address marks an unscripted call (a form submit or direct HTTP) — the shape of the answer is the address’s, never a header’s (`X-Server-Function-Instance` identifies the call for invocation context but never shapes the answer); arguments are parsed from the query string or FormData by content-type sniffing — a no-JS form post decodes to a lone `FormData` argument, and a read whose query is not an argument encoding hands that query over as a lone `URLSearchParams`, which is what a `method="get"` form submits (the browser replaces the action url’s query with its fields, so only an address in the path survives one). Which reading applies is decided by the url alone, never by a header, so a cache cannot be made to store one reading and serve it for the other; `args` is reserved on the query, and a value under it that is not an argument array answers 400. What a GET submit renders is the function’s to shape — the no-JS redirect convention is a form-post one. The `handleNoJS` handler hook builds the response for these calls (default: the normal serialized response).

The full unscripted flow (flash cookie → redirect → SSR-seeded submission state) has a settled ownership chain:

- **Core:** `handleNoJS` — _detection and the hook only_, already shipped. Core has no concept of submissions.
- **Router:** the flash-cookie convention **and** the SSR submission seeding. The router is the only consumer of both sides — submissions are its vocabulary — so its server integration supplies the `handleNoJS` implementation and the seed format.
- **Start:** configures rather than implements, same as single-flight.

### The extension surface (shipped)

Three lifetime slots organize everything the historical proxy surfaces conflated:

| Lifetime               | Concern                                                | Surface                                                                         |
| ---------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| **Declaration-static** | properties of the function itself                      | `GET(fn)` for method; `withMeta(fn, meta)` for user-declared transport metadata |
| **Session-dynamic**    | cross-cutting transport policy that changes at runtime | `prepareRequest` client hook; server handler hooks (existing)                   |
| **Call-scoped**        | one specific invocation                                | `invoke(fn, options, ...args)` — signal, keepalive, priority                    |

Per-function _server_ concerns have no slot here because they are not transport: they are body code. Mechanisms live in core; unprivileged patterns ship as standalone packages; conventions live at the layer that consumes them; everything else is code in the function.

#### `GET(fn)`, `withMeta(fn, meta)`, and the metadata channel

`GET` is core’s per-function method declaration (formerly a two-line Start export over the client proxy’s `.GET` getter):

```ts
import { GET } from "@solidjs/web/server-functions";

export const getUser = GET(async (id: string) => {
  "use server";
  return db.users.find(id);
});
```

Calls go over HTTP GET with arguments codec-encoded in the query string of the call’s data address — cacheable by HTTP infrastructure (the varying instance header doesn’t break caching; caches key on URL unless `Vary` says otherwise, and the data address serves the codec shape to every caller, so what a cache stores there is right for anyone who reads it). Arguments too long for a url dispatch over POST instead, which costs the cache entry rather than meeting whichever proxy in the chain draws the line at a 414. Cache headers flow through the handler’s existing header forwarding: `respond(data, { headers: { "cache-control": "max-age=60" } })`. Server-side, the wrapper is identity-flavored — SSR calls stay in-process. Because function-level directives round-trip wrapper calls (above), this needs **no compiler involvement**.

Conditional reads belong here too, and to the **browser**: set `ETag`/`Cache-Control` on a GET-declared read and the browser owns the conditional exchange — it sends `If-None-Match`, receives the 304, and replays its cached 200 without the caller ever seeing a 304. Answering a *scripted* call with a hand-rolled `respond(undefined, { status: 304 })` answers a question the transport never asked — it sends no conditional headers — so the bodiless answer resolves the call to `undefined`, which reads as data loss. The dev build warns when a scripted call is answered with a 304 (#3101).

Under the sugar sits a symbol-branded metadata channel (`Symbol.for`, surviving duplicated module instances — the same trick as the `ResponseEnvelope` brand), populated on both proxies and read through typed accessors. `withMeta(fn, meta)` is its public write path — it exists because `prepareRequest`’s `meta` parameter was otherwise unreachable for user declarations — and `GET` is sugar over the same write:

```ts
export interface ServerFunctionMetadata {
  /** The declared HTTP method. Undeclared references call over POST. */
  readonly method?: "GET" | "POST";
  /** User-declared transport metadata attached with `withMeta`. */
  readonly [key: string]: unknown;
}
export function getServerFunctionMetadata(fn: unknown): ServerFunctionMetadata | undefined;
export function isServerFunction(fn: unknown): fn is ServerFunction;
export function withMeta<F extends (...args: any[]) => any>(fn: F, meta: ServerFunctionMetadata): F;
```

`withMeta` attaches arbitrary user-declared transport metadata to a reference and returns it, shallow-merging later writes over earlier ones; it composes with `GET` in either order. The pattern is declare-on-function, react-in-hook: metadata declared here reaches `prepareRequest` as `context.meta`, so session-dynamic transport policy keys on declarations (e.g. `requiresAuth`) instead of comparing function ids.

- **Routers detect from metadata, not properties:** `query()`’s current `if ((fn as any).GET) fn = fn.GET` sniffing goes away — a `GET(fn)` reference _already calls over GET_; the router reads metadata only where it needs to _know_ (preload URLs, cacheability decisions).
- **Method enforcement:** registration records a has-method entry keyed by function id (internal bookkeeping, not public API) so the handler answers 405 when the request method contradicts the declaration.
- **Why method is the only built-in entry:** sorting by lifetime left it the sole tenant. Per-function static `headers` — the other candidate — lost its last real use case to `prepareRequest`: every concrete example (auth tokens, tracing ids) turned out to be session-dynamic and uniform, not per-function and static. The general options bag returned in a narrowed, function-first form as `withMeta` — user-declared transport metadata only, never behavior — because without a public writer, `prepareRequest`’s `meta` parameter was unreachable for user declarations.

The reference contract shrinks accordingly (no compatibility shims):

| Surface                         | Status                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| callable                        | kept                                                                                     |
| `id`                            | **added** (both proxies; the client already leaked it via `.url`)                        |
| `url`                           | kept                                                                                     |
| `getServerFunctionMetadata(fn)` | **added**                                                                                |
| `.GET` proxy getter             | **removed** (the `GET(fn)` export replaces it; internal transport path remains)          |
| `.withOptions(init)`            | **removed** — session-dynamic uses go through `prepareRequest`; call-scoped uses through `invoke` (bounded options, not `RequestInit`) |
| Start’s `GET` export            | **deleted**; `GET` imports from core                                                     |

#### `prepareRequest`: client-side transport middleware

The motivating case is OAuth bearer tokens: dynamic credentials that rotate during a session and apply uniformly to every call — wrong for declaration-time metadata (not static, not per-function), right for a per-fetch hook on `configureServerFunctionsClient`:

```ts
configureServerFunctionsClient({
  prepareRequest(init, { id, meta }) {
    return { ...init, headers: { ...init.headers, Authorization: `Bearer ${session.token()}` } };
  }
});
```

**Single hook, not a chain** — composition is userland (wrap functions if you need layers). Note the symmetry this completes: server-side global policy is the existing handler hooks (`createEvent` / `transformResult` / `handleNoJS`); client-side global policy is `prepareRequest`.

#### `invoke`: the per-call invocator

The call-scoped slot was empty in the first draft — its two candidate consumers had found better homes, and the standing rule was "revisit only with a concrete use case in hand." The use case arrived ([#3057](https://github.com/solidjs/solid/issues/3057)): a data layer supersedes a query — navigation, a newer search keystroke — and needs the in-flight HTTP request cancelled, which no declaration or session hook can express because it is a fact about _one call_. `invoke` fills the slot:

```ts
import { invoke } from "@solidjs/web/server-functions";

const user = await invoke(getUser, { signal: controller.signal }, id);
```

The mental model: **declaration wrappers are `bind`, `invoke` is `call`.** `GET(fn)`/`withMeta(fn, meta)` return a new reference with context baked in that travels wherever the reference is passed; `invoke` applies one call with ephemeral context and leaves no residue on the reference — which is why the options bag sits positionally in the `thisArg` slot (`Function.prototype.call`'s silhouette) with the call's own arguments spreading naturally after it. The shape is deliberate the other way too: a curried form (`invoke(fn, options)` returning a callable) was rejected because it _is_ a bind — visually indistinguishable from the declaration wrappers, inviting held references and quietly reviving `withOptions`. Options are always required; with nothing to pass, call the function.

**The admission test.** An option belongs here only if it varies between calls of the _same_ function and cannot be declared or configured. Three pass today:

- **`signal`** — the call's lifecycle. Aborting rejects the call and cancels the request (firing `request.signal` server-side); a caller-supplied signal owns the wire (the transport skips its own controller). Timeouts compose through it (`AbortSignal.timeout`, `AbortSignal.any`) rather than being an option themselves.
- **`keepalive`** — lets the request outlive the page: fire-and-forget calls during `pagehide`. The same function called in a different _moment_, not a different declaration.
- **`priority`** — fetch priority hint; speculative prefetch vs. interaction fetch genuinely differ per call site.

The three are not peers: `signal` is **contract** — every transport a reference's invoker adapts to must honor cancel (it is also the teardown handle for connection-shaped responses, scoped to the subscription across reconnects, per `live`) — while `keepalive` and `priority` are **carrier hints** in today's fetch vocabulary. A carrier without the concept no-ops the hint rather than rejecting the call: hints tune delivery, they never change what the call means.

**Refusals are redirects.** Everything with a longer lifetime is rejected _with a pointer to its home_ — each backed by an invariant, not taste, and `invoke` throws the redirect at runtime rather than silently dropping:

| Refused                       | Invariant it would break                                                     | Home                                                        |
| ----------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `headers` / raw `RequestInit` | cache-key integrity — response-changing input must be keyed in the URL/args | `prepareRequest` (session), `withMeta` (declaration), args (data) |
| `method`                      | CSRF posture — methods are server-gated by declaration                       | `GET(fn)`                                                   |
| retries / deadlines / dedupe  | residue-free application — policy is state _across_ calls                    | the data layer, wired through `signal`                      |
| response envelope access      | isomorphism — in-process calls have no `Response` to mirror                  | return metadata as part of the value                        |

The test cuts both ways: an option with no invariant against it gets admitted. That is what keeps the surface principled rather than arbitrary.

**Who calls `invoke`.** The consumer is whatever layer owns per-call policy and holds the _reference_ — a data layer's fetcher calling `invoke(serverFn, { signal }, ...args)` with its own signal is the #3057 shape exactly, and it needs nothing from the wrappers above it because it sits below them. Inside Solid's own reactive model there is no consumer by design: cancellation there is implicit — a superseded computation abandons its promise, the fetch completes anyway and warms whatever cache holds it — and no reactive API hands out controllers. `invoke` is platform interop for the imperative edge (a hand-rolled typeahead, `AbortSignal.timeout` deadlines, `keepalive` during `pagehide`), priced accordingly.

**Composition: forwarding the channel is a decision, not a reflex.** `invoke` dispatches through a registered-symbol channel (`SERVER_FUNCTION_INVOKE`) on the reference — the same cross-bundle trick as the metadata channel. Core's declaration wrappers forward it, adapted to their transport: `GET` invokes over its query encoding (URL-length POST fallback included); `live` ends its iteration on abort, across reconnects. They can forward mechanically because they preserve the call mapping — one caller, one wire. A wrapper that _shares_ calls (a deduping cache, a multicast channel) cannot: a caller-owned signal cannot own a wire other callers are reading, so such a wrapper must first decide what a caller's abort _means_. The conservative adaptation is caller-detach — reject the aborting caller with fetch semantics, let the shared work complete and keep its cache entry (a five-line `Promise.race`); anything stronger (refcounting the wire shut) defends a case that tracked reads pin away in practice. Not forwarding at all is a legitimate floor: the wrapper is then simply not invocable, exactly as it already loses `id`, `url`, and metadata, and `invoke` answers with a directed error naming the contract. That floor is where the first-party router deliberately lands today — `query`/`action`/`liveQuery` do not forward (validated by building the forwarding for all three and weighing what it bought: the abort semantics were each defensible but speculative, and a throw can become forwarding additively later, while shipped semantics on a shared cache are load-bearing immediately). Data layers lose nothing: they consume the reference below the wrapper, not the wrapper. And the line is placement, not prohibition — the channel standardizes the _mechanism_, never the meaning of abort above the transport. That is the wrapper's policy surface: a third-party cache is free to forward with refcounted cancellation, caller-detach, or whatever else its sharing model makes honest.

**Server mirror.** On the server build the call runs in-process: `signal` still rejects the _caller_ with the signal's reason (the work, like a server behind HTTP, runs to completion unless the function observes a signal of its own), and the transport hints are no-ops — they describe a wire that does not exist.

### Validation (decision record)

Validation deliberately ships from **neither core nor the router**. Core ships mechanisms — things that need privileged access to the transport, handler, or proxies — and the router ships only what it consumes; a validation helper touches no privileged surface in either, so it belongs outside both, as a standalone package plus a recipe in the docs. Nothing in the handler or transport exists for validation, and validation is never mandatory. (The same ethos kept try/catch action generators out of core.)

The design works because **the body is the boundary**: validation is ordinary code at the top of the `"use server"` function, and the directive’s dead-code elimination (above) makes schemas server-only _by construction_ — no compiler recognition, no client bundle cost, and the check runs identically on HTTP dispatch and in-process SSR calls. This is also why validation cannot live in wrapper position: wrappers never reach the HTTP dispatch path.

The intended shape, in brief: a non-throwing `validate(schema, value)` helper over [Standard Schema](https://standardschema.dev) (the types-only interface implemented by zod, valibot, arktype, and others) returning `{ ok: true, value }` or `{ ok: false, error }`, where the failure is **plain serializable data** — a fixed `name` plus the spec’s raw `issues` — recognized structurally rather than by class or brand, so it crosses any codec untouched. The caller chooses the failure plane per call site: return the error as an ordinary value (landing in submission state), or throw it wrapped in `respond(error, { status: 400 })` — the pre-existing envelope path, no new core policy. The failure _shape_ is canonical by specification (without one shape, form components can’t work across routers — the same precedent as `respond`/`redirect`/`reload`), but canonical means specified, not shipped from core. The full specification — typing contract, projections, multi-arg handling, preflight guidance — belongs to the standalone package when it materializes, not this RFC.

### Layering

| Layer                                 | Owns                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Core**                              | The directive contract, transport, handler + hooks, `respond`/`redirect`/`reload`, codec configuration, streaming; the shipped extension surface: `GET` + `withMeta` over the metadata channel, `getServerFunctionMetadata`/`isServerFunction`, `prepareRequest`, `invoke` over the invocation channel, `id` on proxies, method 405 enforcement, automatic single-flight header via `subscribeFlightData`. Mechanisms only |
| **Router**                            | Metadata detection in `query()`, single-flight via `subscribeFlightData` registration, errors landing in submission state (already true), the flash-cookie convention and SSR submission seeding via `handleNoJS`                                                                                                                                                                    |
| **Form layer (router/Start, future)** | Field-error UX conventions: typed field accessors, `aria-invalid` wiring, no-JS flash-cookie repopulation, FormData coercion                                                                                                                                                                                                                                                         |
| **Userland**                          | Per-function server concerns as body code (validation, auth guards, logging, rate limiting); `prepareRequest` composition                                                                                                                                                                                                                                                            |

Unprivileged patterns that need neither core nor router access — the validation helper above being the canonical example — ship as standalone packages.

### What belongs in `@solidjs/web` (decision record)

`@solidjs/web` deliberately owns the HTTP exchange itself. Peer ecosystems park Request/Response in a metaframework (React→Next/Remix, Vue→Nuxt, Svelte→SvelteKit); Solid 2.0 collapses that layer, so the exchange vocabulary lives in core:

- `getRequestEvent` — the request coming in.
- `ResponseStub` / `committed` — the response head as it forms.
- `redirect` / `reload` / `respond` — the response going out.
- Server functions — the RPC exchange.
- Frames — the streaming exchange.
- `httpStatus` / `httpHeader` — the render tree's authority over the response head, with scope-tied retraction.

The render-facing half of this vocabulary — the render entry points, the request event, `ResponseStub`, and the response-head primitives — is documented in [12 — SSR and the HTTP exchange](12-ssr-http.md).

The boundary rule for future additions: **own the exchange, not the application semantics above it.** Status, headers, redirects, streaming commitment are core's. Caching policy, routing, sessions, cookie conveniences with options bags, data layers (query/action) belong to the layer above, where routers and libraries legitimately differ. Scope-tied declarations over the core response contract (`httpStatus`/`httpHeader`) are the last stop on that line, not the first step — proposals that carry policy, or that duplicate one-liners without a correctness story, should be declined.

### Compiler implications

- **None, by design.** `GET` (like any in-body helper) is an ordinary runtime import; the wrapper round-trip and body-scoped DCE that make the design work are existing, verified behavior.
- **Module-level exports register by value:** the server build registers each export’s terminal initializer whole — `export const x = withValidation(schema, fn)` registers `withValidation(schema, fn)`, the evaluated value — and the client build emits bare references for every export. The compiler traces aliases to the terminal initializer and never inspects its shape (no “which argument is the function” guessing); anonymous default expressions get a synthesized binding so they register like everything else. The runtime owns the shape check: `registerServerReference` throws at module eval on a non-function value.
- **Shipped since first draft:** the third `registerServerReference(id, fn, name)` argument carrying the compiler-_static_ dev `name` now exists on both proxies (development output only); it seeds the metadata channel as a default that explicit `withMeta`/`GET` writes shallow-merge over. Compiler-_produced_ metadata flowing to the runtime — not a userland convention the compiler recognizes.

## Migration / replacement

| Old                                                           | New                                                                                                                                                                                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import { GET } from "@solidjs/start"`                        | `import { GET } from "@solidjs/web/server-functions"` — Start’s export deleted                                                                                                                                                              |
| `import { createPlugin } from "@solidjs/start/serialization"` | `import { createPlugin } from "@solidjs/web/serialization"` — the same version-pinned seroval re-export (`createPlugin` + `OpaqueReference`, solid-start #1474); author plugins from it and feed them to the `codec` option on both entries |
| `fn.GET` (property access)                                    | gone; a `GET(fn)` reference already calls over GET                                                                                                                                                                                          |
| `fn.withOptions(init)`                                        | `prepareRequest` for session policy; `invoke(fn, options, ...args)` for call-scoped options (bounded: signal, keepalive, priority — never `RequestInit`)                                                                                    |
| Router `query()` `.GET` sniffing                              | metadata detection via `getServerFunctionMetadata` (mostly: nothing — the callable is already the right transport)                                                                                                                          |
| Router `action()` single-flight via `withOptions` header      | automatic: the transport sets the header when the router registers via `subscribeFlightData`                                                                                                                                                |

## Removals

- **`.GET` proxy getter** and **`.withOptions(init)`** on client references (replaced per the table above; no compatibility shims).
- **Start’s `GET` export** (moves to core).
- Registry mutation as an extension pattern: `registerServerFunction`/`getServerFunction` stay exported for integrations building custom dispatch, but swapping a registered function to decorate dispatch is rejected (below).

## Alternatives considered

Recorded so they don’t reopen:

- **`decorateServerFunction` (registry-swap decoration)** — rejected outright, not even as a documented escape hatch. Action-at-a-distance magic (module evaluation mutating dispatch for an id), it contradicts the body-is-the-extension-point model, and it had no concrete consumer once validation moved into the body.
- **`callServerFunction(fn, init, ...args)` (per-call escape hatch)** — cut from the first draft for lack of a consumer; the cut was explicitly conditional ("revisit only with a concrete use case in hand"), and the consumer arrived (#3057: data-layer cancellation). The shape returned as **`invoke(fn, options, ...args)`** with one decisive difference: a bounded, admission-tested options bag instead of raw `RequestInit` — the passthrough remains rejected (see the invoke section's redirect table). A curried form (`invoke(fn, options)` returning a callable) was considered for ergonomics and rejected: it is structurally a `bind`, indistinguishable from the declaration wrappers, and would quietly revive `withOptions`. An ambient form (options set in a stack-scoped window around a plain call) was rejected for action-at-a-distance and async-boundary fragility.
- **General `extend`/`transport(meta, fn)` options bag** — originally deferred, not designed-in: method was the only declaration-static capability, and a one-key options bag is worse API than one named function. A narrowed form returned as **`withMeta(fn, meta)`** — transport/declaration metadata only, function-first, never behavior — because the declare-on-function, react-in-hook pattern needed a public writer to the channel (`prepareRequest`’s `meta` was otherwise unreachable for user declarations). The metadata channel remains the stable contract.
- **Per-function static `headers` metadata** — cut; every concrete use case (bearer tokens, tracing) is session-dynamic and uniform → `prepareRequest`.
- **Compiler recognition of framework functions** (schema-stripping, `extend` as a compiler convention) — rejected; repeats the `server$` mistake of growing compiler knowledge per capability. Dead, not deferred: body-scoped DCE removes the motivation, since schemas never reach the client in the first place.
- **Transplanting wrapped module-level exports to the client build** (briefly landed, then reversed) — the compiler extracted the inner function from `export const x = wrap(async () => ...)` in a module-level directive file, replaced it with the reference, and cloned the wrapper call plus its reachable local dependencies into the client output. Rejected on three grounds: it executes server-module code on the client (module-level files promise the opposite), the wrapper never applied to HTTP dispatch (it registered the inner function, then wrapped only what the client saw), and deciding which call argument “is” the function reintroduces the pattern-matching that the positional directive exists to avoid.
- **Forbidding wrapped module-level exports outright** (the immediate replacement for the transplant; also briefly landed, then reversed) — a compile error on any module-level export whose initializer wrapped a function in a call expression, on the theory that exports must be _syntactically_ the functions. Superseded by export-value registration (the compiler contract above), which keeps the sound part of the rule — the export ≡ registered function invariant, no client-side wrapper lies, no argument pattern-matching — while making the natural composition pattern (`withValidation(schema, fn)`, `withDelay(fn, 400)` mocks) simply work on every call path, because the _evaluated value_ is what registers. The error threw away wrappers’ one honest home (server-side, inside the registration) to enforce a syntactic reading of an invariant that was always about values. A recognized-wrapper allowlist (`GET`/`withMeta` only) was considered along the way and rejected as the same pattern-matching problem with a shorter list.
- **Validation in core (or the router)** — rejected: a validation helper touches zero privileged surface, so it lives outside both (see the decision record above). Core ships mechanisms; the router ships what it consumes; sugar that needs neither lives outside both.
- **Validation API variants** — a throwing/auto-400 `validate` (bakes the failure-plane choice into the helper), an error class with a `Symbol.for` brand + codec plugin + rehydration (plain data plus a structural guard needs no machinery), and per-position `validateArgs(schemas, args)` (tuple schemas already cover multi-arg) — all cut.
- **Schema-first router overloads** (`action(schema, fn)`, SvelteKit-style) — dead: validation is preflight or in-body, so router primitives don’t take schemas.
- **Validation as wrapper/signature metadata** (`withValidation(schema, fn)`) — rejected _as a core/compiler-recognized convention_: at function level wrappers can’t reach the HTTP dispatch path without registry mutation, and schemas would ship to the client or require compiler stripping. Note this rejection is about core blessing the pattern, not the pattern itself: in module-level directive files, export-value registration means a userland `withValidation` wrapper composes onto every call path with schemas server-only by construction — no core recognition involved.
- **Middleware chains** (client hook chains, per-function server middleware stacks) — single hooks + userland composition instead. The server side of that single hook is `wrapInvocation` (added since first draft): one wrap around the execution with the invocation identity available, on which frameworks build per-function middleware in userland; core still ships no chain, and per-function server concerns remain body code first.

## Open questions

1. **Unvalidated-function encouragement.** With validation never mandatory, is encouraging it a docs concern, a lint rule, or a future form-layer dev heuristic?
2. **Form-layer scope.** The router/Start form layer (typed field accessors, `aria-invalid` wiring, flash-cookie repopulation, FormData coercion) is out of scope here.
3. **Upgrade-style capabilities** (0.x had a WebSocket 101 pass-through): out of scope; if runtimes ever make it portable, it would be the second declaration-static tenant that justifies revisiting a general transport form.
