# RFC: Server functions

**Start here:** If you’re migrating an app, read the beta tester guide first: [MIGRATION.md](MIGRATION.md)

> **Status note:** This RFC covers two layers. The base mechanics — the `"use server"` directive, the `@solidjs/web/server-functions` runtime, response helpers, single-flight, and no-JS handling — are **shipped** in the beta. The extension surface (`GET`, `withMeta`, the metadata accessors, `prepareRequest`, method enforcement, `id` on proxies) is now **shipped** as well; this document remains the canonical specification. One follow-up remains deferred: a dev observation hook for the server-function inspector (deliberately deferred until it can be designed together with its consumer). Dev-only compiler-emitted `name` metadata has since shipped (`registerServerReference(id, fn, name)` / `createServerReference(id, name)` seed the metadata channel). Server components build on this runtime — see [11 — Server components](11-server-components.md).

## Summary

Solid 2.0 moves server functions into core: a `"use server"` directive compiled by the build plugin, backed by a framework-agnostic runtime at `@solidjs/web/server-functions`. The runtime ships *mechanisms* — transport, an HTTP handler with hooks, response helpers, a single-flight protocol — while routers and frameworks layer *policy* on top. The extension surface adds exactly four mechanisms: `GET(fn)`, `withMeta(fn, meta)`, the `getServerFunctionMetadata`/`isServerFunction` accessors, and a `prepareRequest` client hook.

The governing philosophy: **the server side of a server function is your function body.** Per-function server concerns (validation, auth guards, logging, rate limiting) are lines of code inside the body; global concerns are the handler and transport hooks; there is no third place. Nothing is compiler-recognized; the compiler’s only contract is the directive.

## Motivation

- **Server functions belong to core, not the metaframework:** In 1.x, `"use server"` lived in SolidStart (via vinxi). 2.0 collapses the runtime into core so any Vite app — with or without Start — gets typed RPC, streaming returns, progressive enhancement, and custom serialization.
- **Mechanisms vs. policy:** Every prior era (Start 0.x `server$`, the v1 proxy) grew an ad-hoc extension surface — per-call `fetch(init)`, `withOptions`, registry mutation, compiler-recognized wrappers. Sorting those concerns by *lifetime* (declaration-static, session-dynamic, call-scoped) yields a much smaller surface and shows the call-scoped slot is actually empty.
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

1. **Function-level directives round-trip wrapper calls.** `export const getData = GET(async (id) => { "use server"; ... })` compiles by swapping only the function expression — the surrounding `GET(...)` call survives in both server and client output. A pure-runtime wrapper needs no compiler support.
2. **Anything referenced only inside a `"use server"` body never reaches the client.** The extraction replaces the body with a reference, and the directive pass’s orphan-scoped dead-code elimination removes now-unused imports and bindings — schema libraries, database handles, helper imports all vanish from client output. **The directive boundary is itself the privacy mechanism.**

One architectural fact worth stating: **a wrapper wraps the *reference*, not the registered function.** `registerServerReference(id, fn)` registers the raw inner function for HTTP dispatch before any wrapper runs, so wrapper-position code can only affect the client transport and the in-process callable — never HTTP dispatch. This is why anything that must run on the dispatch path (validation, auth, logging) belongs *inside* the body, and why the declaration surface (`GET`) is transport-only.

### The runtime: `@solidjs/web/server-functions`

The package resolves to a client entry in the browser and a server entry elsewhere.

**Client:** `configureServerFunctionsClient({ endpoint?, codec?, prepareRequest?, serializeArgs?, responseHandler? })` — call once in the client entry, only when deviating from the defaults (endpoint defaults to `/_server`; `codec` takes seroval plugin options and must match the server’s; `prepareRequest` is the transport middleware hook below; `responseHandler` is the integration seam server components install — see [RFC 11](11-server-components.md)). Compiled client output produces callables that POST to the endpoint with the function id in the `X-Server-Function-Id` header and a per-call `X-Server-Function-Instance` id. **Argument encoding (updated since first draft):** arguments with a natural HTTP encoding (a lone string, FormData, File, Blob, ...) go as-is; everything else is sent as **plain JSON by default** — no serializer in the client bundle — and values JSON can’t carry faithfully (Dates, Maps, Sets, typed arrays, cycles) **throw with a directed message** unless you opt in once via `enableRichArguments()` from the `rich-args` entry, which installs the codec’s write half (~5 KB gz) as `serializeArgs`. *Results* are unaffected — they always travel through the codec, whose decode half the client carries regardless. Async returns (promises, streams) settle over the open connection via length-prefixed chunk framing.

**Server:** `configureServerFunctionsServer({ endpoint?, codec?, provideEvent?, collectFlightData?, transformResult?, transformDirectResult? })` plus the web-standard HTTP handler:

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
- **`transformResult(event, result, context)`** — observe or replace the result before encoding; the extension point for response-metadata policy. Runs for returned and thrown results alike. Also configurable **server-wide** via `configureServerFunctionsServer` (the per-request option overrides, following the `collectFlightData` fallback pattern), so generic dispatchers that call `handleServerFunctionRequest(request)` with no options still apply it — this is how server components install `frameTransformResult` once. Its in-process mirror for direct SSR calls is `transformDirectResult(value, { id })` (config-only; direct calls never pass through the HTTP handler).
- **`collectFlightData(event, outcome)`** — the single-flight hook (below).
- **`handleNoJS(result, request, args, thrown?)`** — build the response for unscripted calls (below).

Inside a function body, `getRequestEvent()` (from `@solidjs/web`) reads the current event and `getServerFunctionMeta()` reads the calling function’s id — usable for keying caches or logs. In-process SSR calls run the original function directly (no HTTP loopback) under a derived event marked `serverOnly`.

`registerServerFunction(id, fn)` / `getServerFunction(id)` remain exported for integrations building custom dispatch or introspection. Registry *mutation* as a userland extension pattern is rejected (see Alternatives).

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

`decodeResponse(response)` (from `@solidjs/web/server-functions`) is the integration-facing decoder: routers call it on responses the transport hands over whole — redirects, revalidation, single-flight payloads — to recover the structured value inside. Raw `Response` returns tagged `X-Content-Raw` pass through the handler untouched.

### Single-flight

The protocol folds integration data (typically revalidated route data) into a mutation’s response, saving a round trip. Core standardizes only the wire shape and delivery; what the data *is* — a data-only render, route preloads, a cache query — is entirely the integration’s business.

- **Server:** the `collectFlightData(event, outcome)` hook (config or per-handler) receives the request event and a `ServerFunctionOutcome` — `{ id, value, response, request, thrown }` — and optionally returns a payload. The handler envelopes it as `{ value, data }` under the `X-Single-Flight` response header. It runs after `transformResult`, only for scripted calls that sent the header on the request; redirect-with-data works because the outcome’s `response` carries `Location`, so the hook can produce data for the destination route.
- **Client:** `subscribeFlightData(consumer)` registers the consumer the transport delivers data to. On a single-flight response the transport decodes `{ value, data }`, delivers `data` (with the response as envelope context), awaits async consumers so caches are seeded first, and returns `value` to the caller as if the call were plain. One active consumer at a time; with none registered, the response passes through whole for the integration to `decodeResponse` itself.

**Shipped change:** the request-leg `X-Single-Flight` header moved from per-call attachment (previously the integration sent it, e.g. via `withOptions`) to being set by the client transport **if and only if a flight-data consumer is registered** — subscribing *is* the opt-in. This is more correct than the per-call header: a consumer-less app never asks the server to do collection work. Same header, new emitter; the server side is unchanged.

**Shipped extension — markup in the payload:** when part of what a mutation invalidates is a *server component* (RFC 11), the plain envelope cannot carry it — markup never ships as data (single-copy). The handler exposes a `transformFlightResult(event, { value, data }, context)` seam — config or per-handler, the same fallback pattern as `transformResult` — that gets first refusal on the fold. The frames policy (`frameTransformFlightResult`) answers with a frame-stream response: each invalidated call’s markup rides as a region addressed by `(function, arguments)` — the one name both peers derive independently — while the `{ value, data }` envelope rides as response-scoped chunks with component-valued entries as references that resolve to the very boundaries showing those calls. Data reaches the same `subscribeFlightData` consumer, the caller gets the same `value`, and a data-only payload keeps the byte-identical plain envelope — a mutation reads the same whether or not any of what it invalidated was markup, and one round trip settles the value, the data, and the UI.

### No-JS and progressive enhancement

A reference’s `.url` serves as a form `action`, and action urls are **self-describing** (`?id=...&args=...`): an integration can reconstruct a callable from a server-rendered action url alone, with bound arguments kept in the query string where the server reads them for natural-encoding bodies. The absence of the `X-Server-Function-Instance` header marks an unscripted call (no-JS form post or direct HTTP); arguments are parsed from the query string or FormData by content-type sniffing — a no-JS form post decodes to a lone `FormData` argument. The `handleNoJS` handler hook builds the response for these calls (default: the normal serialized response).

The full unscripted flow (flash cookie → redirect → SSR-seeded submission state) has a settled ownership chain:

- **Core:** `handleNoJS` — *detection and the hook only*, already shipped. Core has no concept of submissions.
- **Router:** the flash-cookie convention **and** the SSR submission seeding. The router is the only consumer of both sides — submissions are its vocabulary — so its server integration supplies the `handleNoJS` implementation and the seed format.
- **Start:** configures rather than implements, same as single-flight.

### The extension surface (shipped)

Three lifetime slots organize everything the historical proxy surfaces conflated:

| Lifetime | Concern | Surface |
|---|---|---|
| **Declaration-static** | properties of the function itself | `GET(fn)` for method; `withMeta(fn, meta)` for user-declared transport metadata |
| **Session-dynamic** | cross-cutting transport policy that changes at runtime | `prepareRequest` client hook; server handler hooks (existing) |
| **Call-scoped** | one specific invocation | *empty* — both candidate consumers found better homes |

Per-function *server* concerns have no slot here because they are not transport: they are body code. Mechanisms live in core; unprivileged patterns ship as standalone packages; conventions live at the layer that consumes them; everything else is code in the function.

#### `GET(fn)`, `withMeta(fn, meta)`, and the metadata channel

`GET` is core’s per-function method declaration (formerly a two-line Start export over the client proxy’s `.GET` getter):

```ts
import { GET } from "@solidjs/web/server-functions";

export const getUser = GET(async (id: string) => {
  "use server";
  return db.users.find(id);
});
```

Calls go over HTTP GET with arguments codec-encoded in the query string — cacheable by HTTP infrastructure (the varying instance header doesn’t break caching; caches key on URL unless `Vary` says otherwise). Cache headers flow through the handler’s existing header forwarding: `respond(data, { headers: { "cache-control": "max-age=60" } })`. Server-side, the wrapper is identity-flavored — SSR calls stay in-process. Because function-level directives round-trip wrapper calls (above), this needs **no compiler involvement**.

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

- **Routers detect from metadata, not properties:** `query()`’s current `if ((fn as any).GET) fn = fn.GET` sniffing goes away — a `GET(fn)` reference *already calls over GET*; the router reads metadata only where it needs to *know* (preload URLs, cacheability decisions).
- **Method enforcement:** registration records a has-method entry keyed by function id (internal bookkeeping, not public API) so the handler answers 405 when the request method contradicts the declaration.
- **Why method is the only built-in entry:** sorting by lifetime left it the sole tenant. Per-function static `headers` — the other candidate — lost its last real use case to `prepareRequest`: every concrete example (auth tokens, tracing ids) turned out to be session-dynamic and uniform, not per-function and static. The general options bag returned in a narrowed, function-first form as `withMeta` — user-declared transport metadata only, never behavior — because without a public writer, `prepareRequest`’s `meta` parameter was unreachable for user declarations.

The reference contract shrinks accordingly (beta — no compatibility shims):

| Surface | Status |
|---|---|
| callable | kept |
| `id` | **added** (both proxies; the client already leaked it via `.url`) |
| `url` | kept |
| `getServerFunctionMetadata(fn)` | **added** |
| `.GET` proxy getter | **removed** (the `GET(fn)` export replaces it; internal transport path remains) |
| `.withOptions(init)` | **removed** — session-dynamic uses go through `prepareRequest`; call-scoped uses are cut |
| Start’s `GET` export | **deleted**; `GET` imports from core |

#### `prepareRequest`: client-side transport middleware

The motivating case is OAuth bearer tokens: dynamic credentials that rotate during a session and apply uniformly to every call — wrong for declaration-time metadata (not static, not per-function), right for a per-fetch hook on `configureServerFunctionsClient`:

```ts
configureServerFunctionsClient({
  prepareRequest(init, { id, meta }) {
    return { ...init, headers: { ...init.headers, Authorization: `Bearer ${session.token()}` } };
  },
});
```

**Single hook, not a chain** — composition is userland (wrap functions if you need layers). Note the symmetry this completes: server-side global policy is the existing handler hooks (`createEvent` / `transformResult` / `handleNoJS`); client-side global policy is `prepareRequest`.

**There is no per-call API.** The two cases that leaned on one found better homes: single-flight opt-in becomes automatic via `subscribeFlightData` registration (above), and abort signals have no known consumer today — revisit only with a concrete use case in hand.

### Validation (decision record)

Validation deliberately ships from **neither core nor the router**. Core ships mechanisms — things that need privileged access to the transport, handler, or proxies — and the router ships only what it consumes; a validation helper touches no privileged surface in either, so it belongs outside both, as a standalone package plus a recipe in the docs. Nothing in the handler or transport exists for validation, and validation is never mandatory. (The same ethos kept try/catch action generators out of core.)

The design works because **the body is the boundary**: validation is ordinary code at the top of the `"use server"` function, and the directive’s dead-code elimination (above) makes schemas server-only *by construction* — no compiler recognition, no client bundle cost, and the check runs identically on HTTP dispatch and in-process SSR calls. This is also why validation cannot live in wrapper position: wrappers never reach the HTTP dispatch path.

The intended shape, in brief: a non-throwing `validate(schema, value)` helper over [Standard Schema](https://standardschema.dev) (the types-only interface implemented by zod, valibot, arktype, and others) returning `{ ok: true, value }` or `{ ok: false, error }`, where the failure is **plain serializable data** — a fixed `name` plus the spec’s raw `issues` — recognized structurally rather than by class or brand, so it crosses any codec untouched. The caller chooses the failure plane per call site: return the error as an ordinary value (landing in submission state), or throw it wrapped in `respond(error, { status: 400 })` — the pre-existing envelope path, no new core policy. The failure *shape* is canonical by specification (without one shape, form components can’t work across routers — the same precedent as `respond`/`redirect`/`reload`), but canonical means specified, not shipped from core. The full specification — typing contract, projections, multi-arg handling, preflight guidance — belongs to the standalone package when it materializes, not this RFC.

### Layering

| Layer | Owns |
|---|---|
| **Core** | The directive contract, transport, handler + hooks, `respond`/`redirect`/`reload`, codec configuration, streaming; the shipped extension surface: `GET` + `withMeta` over the metadata channel, `getServerFunctionMetadata`/`isServerFunction`, `prepareRequest`, `id` on proxies, method 405 enforcement, automatic single-flight header via `subscribeFlightData`. Mechanisms only |
| **Router** | Metadata detection in `query()`, single-flight via `subscribeFlightData` registration, errors landing in submission state (already true), the flash-cookie convention and SSR submission seeding via `handleNoJS` |
| **Form layer (router/Start, future)** | Field-error UX conventions: typed field accessors, `aria-invalid` wiring, no-JS flash-cookie repopulation, FormData coercion |
| **Userland** | Per-function server concerns as body code (validation, auth guards, logging, rate limiting); `prepareRequest` composition |

Unprivileged patterns that need neither core nor router access — the validation helper above being the canonical example — ship as standalone packages.

### Compiler implications

- **None, by design.** `GET` (like any in-body helper) is an ordinary runtime import; the wrapper round-trip and body-scoped DCE that make the design work are existing, verified behavior.
- **One pre-existing bug to fix regardless:** with a *module-level* `"use server"` directive, a wrapped export (`export const x = wrapper(async () => ...)`) is silently dropped from the client build — only direct function exports become references. This gets more visible with `GET(fn)` as the blessed idiom. Minimum: a diagnostic; better: extract the inner function and preserve the call in client output.
- **Shipped since first draft:** the third `registerServerReference(id, fn, name)` argument carrying the compiler-*static* dev `name` now exists on both proxies (development output only); it seeds the metadata channel as a default that explicit `withMeta`/`GET` writes shallow-merge over. Compiler-*produced* metadata flowing to the runtime — not a userland convention the compiler recognizes.

## Migration / replacement

| Old | New |
|---|---|
| `import { GET } from "@solidjs/start"` | `import { GET } from "@solidjs/web/server-functions"` — Start’s export deleted |
| `fn.GET` (property access) | gone; a `GET(fn)` reference already calls over GET |
| `fn.withOptions(init)` | `prepareRequest` for session policy; call-scoped uses cut |
| Router `query()` `.GET` sniffing | metadata detection via `getServerFunctionMetadata` (mostly: nothing — the callable is already the right transport) |
| Router `action()` single-flight via `withOptions` header | automatic: the transport sets the header when the router registers via `subscribeFlightData` |

## Removals

- **`.GET` proxy getter** and **`.withOptions(init)`** on client references (replaced per the table above; beta — no compatibility shims).
- **Start’s `GET` export** (moves to core).
- Registry mutation as an extension pattern: `registerServerFunction`/`getServerFunction` stay exported for integrations building custom dispatch, but swapping a registered function to decorate dispatch is rejected (below).

## Alternatives considered

Recorded so they don’t reopen:

- **`decorateServerFunction` (registry-swap decoration)** — rejected outright, not even as a documented escape hatch. Action-at-a-distance magic (module evaluation mutating dispatch for an id), it contradicts the body-is-the-extension-point model, and it had no concrete consumer once validation moved into the body.
- **`callServerFunction(fn, init, ...args)` (per-call escape hatch)** — cut; the settled inventory has no per-call mechanism. Its two candidate consumers found better homes: single-flight opt-in becomes automatic via `subscribeFlightData`, and abort signals have no known consumer today.
- **General `extend`/`transport(meta, fn)` options bag** — originally deferred, not designed-in: method was the only declaration-static capability, and a one-key options bag is worse API than one named function. A narrowed form returned as **`withMeta(fn, meta)`** — transport/declaration metadata only, function-first, never behavior — because the declare-on-function, react-in-hook pattern needed a public writer to the channel (`prepareRequest`’s `meta` was otherwise unreachable for user declarations). The metadata channel remains the stable contract.
- **Per-function static `headers` metadata** — cut; every concrete use case (bearer tokens, tracing) is session-dynamic and uniform → `prepareRequest`.
- **Compiler recognition of framework functions** (schema-stripping, `extend` as a compiler convention) — rejected; repeats the `server$` mistake of growing compiler knowledge per capability. Dead, not deferred: body-scoped DCE removes the motivation, since schemas never reach the client in the first place.
- **Validation in core (or the router)** — rejected: a validation helper touches zero privileged surface, so it lives outside both (see the decision record above). Core ships mechanisms; the router ships what it consumes; sugar that needs neither lives outside both.
- **Validation API variants** — a throwing/auto-400 `validate` (bakes the failure-plane choice into the helper), an error class with a `Symbol.for` brand + codec plugin + rehydration (plain data plus a structural guard needs no machinery), and per-position `validateArgs(schemas, args)` (tuple schemas already cover multi-arg) — all cut.
- **Schema-first router overloads** (`action(schema, fn)`, SvelteKit-style) — dead: validation is preflight or in-body, so router primitives don’t take schemas.
- **Validation as wrapper/signature metadata** (`withValidation(schema, fn)`) — rejected: wrappers can’t reach the HTTP dispatch path without registry mutation, and schemas would ship to the client or require compiler stripping.
- **Middleware chains** (client hook chains, per-function server middleware stacks) — single hooks + userland composition instead; per-function server middleware is body code.

## Open questions

1. **Unvalidated-function encouragement.** With validation never mandatory, is encouraging it a docs concern, a lint rule, or a future form-layer dev heuristic?
2. **Form-layer scope.** The router/Start form layer (typed field accessors, `aria-invalid` wiring, flash-cookie repopulation, FormData coercion) is out of scope here.
3. **Upgrade-style capabilities** (0.x had a WebSocket 101 pass-through): out of scope; if runtimes ever make it portable, it would be the second declaration-static tenant that justifies revisiting a general transport form.
