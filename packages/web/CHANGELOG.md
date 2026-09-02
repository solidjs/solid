# @solidjs/web

## 2.0.0-rc.6

### Patch Changes

- ee73e05: Treat adapter-provided empty POST streams as zero-argument server function calls while continuing to refuse non-empty or invalidly tagged bodies.
- c7c0ffb: `provideEvent`'s invocation contract is enforced at HTTP dispatch (#3172). A hook that invoked the callback twice double-committed a mutation under a 200, and one that never invoked it answered a void success without running the function. A second invocation is now refused before the function body runs again, and both violations fail the request with a sanitized 500 (the hook is named in development), re-checked after the hook returns so a swallowed refusal cannot answer 200.
- a964f03: A 2xx the client transport cannot recognize now fails the call instead of resolving as `undefined` (#3173, revisiting #3087). A captive portal, WAF interstitial, or misrouted SPA index answering 200 with HTML was indistinguishable from a void result; the transport now requires a success response to carry the runtime's body-format tag (stamped on every encoded response, void included) or the verbatim-passthrough marker, and rejects anything else with the status and content-type named. Genuine void results and raw passthroughs are unaffected; the header alone is judge, never the body.
- 67bf03d: Handle primitive class values consistently between static, dynamic, and array forms (#3189). Dynamic numeric class values now stringify like the compiler's static template output on both client and server, and standalone booleans inside class arrays are ignored per clsx-style composition instead of emitting a literal "true" class.
- 7d559bf: Eager JSX evaluated during hydration whose template claim misses (e.g. stored in a variable behind an initially false `<Show>` — the server allocated its hydration ids but never rendered it) now materializes its dynamic inserts like a client render, so revealing the detached subtree later produces fully initialized DOM (#3163). Text-node adoption during hydration is restricted to nodes actually being claimed (connected or under a claim root).
- 8f26066: Preserve statically selected options when a dynamic `multiple` expression on `<select>` is initially truthy (#3179). The template parses under single-select rules before the binding effect runs, so the first truthy `multiple` write now restores selectedness from the options' defaults, matching the static attribute. Later toggles keep the live selection state, exactly like toggling the attribute on static markup.
- 3c357fb: Create ambiguous SVG tags (`a`, `script`, `style`, `title`) in the SVG namespace when Dynamic renders them inside SVG content during client rendering (#3187). Dynamic intrinsic elements now materialize lazily inside the insert() that renders them, where the live insertion parent provides the namespace hint — matching how the parser resolves these tags in static templates and server-rendered markup (children of `foreignObject` stay HTML).
- e220cfa: Stop buffering aborted or refused server-function uploads and answer broken request bodies cleanly.
- a1a68a7: Default server-function error-stack serialization from the compiled development variant
- bbff5e0: Direct `value`/`checked` (and other stateful DOM property) bindings no longer overwrite pre-hydration user input during the hydration claim pass (#3182). Hydratable compiled output now routes locked DOM properties through `setProperty`, which skips writes on hydrating nodes and carries the `<select value>` microtask and input/textarea nullish special cases.
- c21b0a4: Reactive style bindings (`style()` and `setStyleProperty()`) no longer overwrite server-rendered inline styles during the initial hydration pass, consistent with class and attribute bindings (#3180). The first subsequent reactive update applies the client value.
- d5fbfa3: Ignore inherited properties in client-side style objects and JSX spreads, including special children and ref positions, to match SSR output.
- 57e3178: Prevent an abandoned sanitized promise in a server-function result from causing an unhandled rejection when another value fails to encode.
- b73635b: Keep bound handler tuples reusable across non-delegated events by leaving the user-provided tuple unchanged when installing a listener.
- 74a11e3: Reduce collision-safe client event listener bookkeeping while preserving handler identity and removal options
- f22d6e7: Remove replaced non-delegated event listener objects with their original capture option.
- 0a2fcf0: Keep generator bodies, stream pulls, and encoded result getters inside their server-function request event for HTTP dispatch and direct SSR calls.
- f4e490b: Judge decoded arguments, guarded results and navigation targets by what they
  are rather than by how they are spelled, and never forward a `Content-Length`
  that describes a body the transport replaced.

  Seven defects, five of them introduced by the guards added in #3168, #3170,
  #3175 and #3176. Each fix removes a special case rather than adding one: the
  argument walk stops for no prototype, the guard shell keeps only the flag that
  reaches the wire, the scheme floor asks the URL parser instead of a regex, and
  the event is awaited only when it is genuinely a promise.

  Runtime-composed SSR responses now discard stale body-framing headers, and
  late streaming redirects emit a client script only for relative or HTTP(S)
  targets.

- c42fc3f: Decoded server-function arguments no longer carry `__proto__` as an own key (#3168). Both decode roads (plain JSON and the codec) preserved the key faithfully, so an ordinary `Object.assign` merge in a handler re-prototyped its result with attacker-supplied data. The key is now stripped recursively at the argument-decode seam, covering plain objects, arrays, and revived Map/Set entries, with cycle protection.
- ca13ed1: Dispatch delegated events to EventListenerObject handlers through their handleEvent method, including after replacing a bound tuple.
- 2a6567d: Update object-valued class bindings after in-place mutations by tracking a separate snapshot of the classes applied to each element.
- 70a6180: `prepareRequest`'s return is validated instead of replacing the request init wholesale (#3174). A hook returning a fresh object — the natural way to write "add an auth header" — silently dropped the argument payload, the abort signal, and every protocol header, and the call still dispatched. A returned init that lost the transport headers (or is not an object) now fails the call at the call site naming the hook; deliberate body/signal replacement over a spread init remains in contract.
- Updated dependencies [a7c6b8e]
- Updated dependencies [8d1ba82]
- Updated dependencies [3e48a75]
- Updated dependencies [04b5b7f]
- Updated dependencies [da1f7bf]
  - solid-js@2.0.0-rc.6

## 2.0.0-rc.5

### Patch Changes

- 5ab6c61: Add the `selectedcontent` HTML element to the JSX intrinsic element types.
- bacfb34: Add `serializeErrorStacks` to the serialization codec options (and `createSerializer`): error-stack disclosure defaulted to `NODE_ENV === "development"`, which describes the process rather than the artifact — a production build run with `NODE_ENV=development` shipped stacks to the wire, including application-code stacks for errors marked with `markSafeError`. Deployments can now pin `codec: { serializeErrorStacks: false }` regardless of the ambient variable (#3152)
- 51392f3: Bound what a server-function call may send (#3115). The argument payload is buffered and decoded before dispatch, so its cost was paid before application code could decline it: a 32 MB body was accepted and decoded, and a modest argument list forced a range error out of any function when spread into the call. `bodySizeLimit` (default 1 MiB, matching the neighbours' server-action ceilings) now refuses an oversized POST body or `?args=` encoding with 413 before any decoding — a declared Content-Length is checked up front, a chunked body is buffered under the cap — and `maxArguments` (default 1000) refuses an oversized argument list with 400. Both are configurable through `configureServerFunctionsServer` and per-handler options; `Infinity` removes a bound. The decode depth cap also now holds whichever body format the caller selects (#3119): the plain-JSON format walked into a bare `JSON.parse` with no ceiling, where the framed codec enforced 64 levels — the same ceiling now applies to both, and a non-array argument encoding in either body format answers 400 instead of surfacing as the function's own failure.
- 02e0ebf: Enforce the `Location`/`X-Revalidate` bounds at the transport edge (#3158). `redirect()` and the revalidate helpers refuse over-long values, but a hand-built `Response` reached the wire unchecked — a ~1 MB `Location` became a ~1 MB redirect header, to die at the proxy after the mutation committed. The bound is now a property of the transport, one check where the composed headers leave for every producer; the helpers' authoring-time throws remain the legible fast path. Refused, never trimmed: a cut target is a different address, a dropped revalidate key is a silently stale cache.
- ec52360: Contain flight-data collector errors per source: a throwing collector no longer fails the mutation response (the client received an error for a mutation that succeeded) or drop the other sources' slices — the failing source is simply omitted and logged.
- da50a36: Warn in dev when a scripted server function call is answered with 304 Not Modified (#3101). The scripted transport sends no conditional headers, so a hand-rolled 304 resolves the call to `undefined` rather than "unchanged" — the warning points at GET-declared reads with ETag/Cache-Control, where the browser owns the conditional exchange and replays its cached answer.
- 2f18c56: Deliver a server-function encode failure as a failure, not an empty success (#3117). When the codec could not encode a result, the head was already committed — status spent, no error tag possible — and the body simply stopped; a truncated body decodes to `undefined`, the same answer a void function gives, so a mutation that ran and committed its side effects was indistinguishable from one that returned nothing, and a data layer might retry it. The failure now travels in band: a terminal error-trailer frame (a `!`-prefixed payload on the existing chunk framing, unambiguous because codec frames always open with `{`) that the decoder throws — as the call's failure when it is the first frame, and into every still-pending async value when a later value's encoding fails mid-stream, with the delivered head keeping its data. The trailer is sanitized like any thrown error (generic in production, cause preserved in dev via `Server function result could not be encoded: …`). Version skew degrades safely: an old client reading a trailer fails the call with a decode error rather than resolving `undefined`.
- 0932c89: Amortize ChunkReader buffer growth: the framed-stream reader reallocated and copied everything received so far on every network read, making one frame O(reads²) — ~200× the CPU for a payload delivered at slow-client read sizes, on both the server (argument decode) and client (response decode) legs. Growth now appends in place, compacts drained frames, and reallocates at ≥2× only when outgrown (#3154)
- 817b4d1: Bound the composed redirect and revalidate response headers (#3131, the
  #3093 class). A 20K-character redirect target or a few hundred
  revalidation keys produced a header past receivers' limits — undici's
  16 KiB default, nginx's one-page proxy buffer for the whole header block —
  so the response died at the socket (HPE_HEADER_OVERFLOW) after the
  mutation committed. Truncation is not an option for these values the way
  it was for #3093's error label: a trimmed target is a different address
  and a trimmed key list is a silently stale cache. So `redirect()` and the
  `revalidate` option now refuse past 4096 characters with a legible error
  naming the remedy (carry the state server-side; split the invalidation or
  use coarser keys). The bound sits in the producing helpers, which run
  inside the function body, so both the returned and thrown spellings land
  on the ordinary error path — what leaves dispatch is the error shape,
  attributable and parseable. A raw `Response` built by hand with an
  oversized `Location` remains the author's own; only the helpers are
  bounded.
- 929642b: Trust only a conforming (digit-string) Content-Length in the bodySizeLimit guard: a negative declaration (`-1`) satisfied neither the over-limit check nor the undeclared-body buffer path and streamed the body into the decoder uncapped; non-conforming declarations now route through the bounded buffer (#3153)
- ecfee20: Two cookie fixes. The no-JS flash cookie now degrades instead of vanishing
  when an outcome exceeds the browser's 4 KB cookie ceiling (#3137): past it
  the whole Set-Cookie was silently discarded — no error anywhere, and the
  page after the redirect looked like nothing was submitted, inviting the
  retry that writes twice. The encoder drops the input echo first, then
  bounds the value itself (a string keeps the longest prefix that fits,
  structured results reduce to the outcome flag), and the submission arrives
  with `truncated` set so integrations can say "succeeded, result too large
  to display". And `serializeCookie` now refuses in dev the shapes every
  browser silently rejects on arrival (#3138): `__Host-`/`__Secure-` prefix
  requirements and `SameSite=None`/`Partitioned` without `Secure` — each one
  attribute away from a cookie that never comes back, with login-shaped
  consequences. The validation compiles out of production builds. CHIPS
  `partitioned` is also supported now, so partitioned third-party cookies no
  longer require hand-building the header string.
- 30f9387: Direct (SSR-time) server-function calls now run under a per-call shallow copy of the render's `locals` instead of sharing the object: concurrent calls no longer overwrite each other's (and the render's) per-request context. Reads still inherit everything middleware set, and nested objects stay shared by reference; `event.response` remains deliberately shared (#3156)
- af4cfc8: Two server-function grant fixes (#3129, #3128). A `GET()` declaration now
  dies with the binding it was made about: `registerServerFunction` revokes
  the id's declared method when it rebinds the id to a different function,
  so a mutation registered onto a once-declared id (an id collision, a
  module re-evaluated in a live process after an edit dropped the wrapper)
  no longer inherits GET dispatch and the origin-gate exemption — a function
  that still declares GET re-runs `GET()` right after re-registering, which
  re-arms the grant exactly when it is still meant. And the single-flight
  request header is now honored on POST only, the server half of the
  client's own rule: folding on a GET would put a second body — an envelope
  carrying data computed from that caller's request — at a cacheable url
  under whatever public Cache-Control the author wrote, with nothing naming
  the variance, one curl away from a shared-cache poisoning.
- be7bcd2: The bare server-function address no longer decides its answer shape by the
  absence of a header (#3139). The no-JS redirect convention (303, outcome
  in the flash cookie) engaged on shape alone — form content type, no format
  tag — which a page script's `fetch(url, { body: new URLSearchParams(...) })`
  also matches: the script followed the 303 to the referrer's HTML, read
  `response.ok === true`, and its answer disappeared into a cookie it would
  never look at. Dispatch now reads the browser's own word for the caller
  kind: `Sec-Fetch-Mode: navigate` (or no fetch metadata, for older
  browsers) keeps the convention, while a script's form-shaped post is
  refused 400 before dispatch — before the mutation runs — pointing at the
  data address and the format tag, the two spellings that work. Tagged
  direct-HTTP callers keep the plain response as documented.
- 08b4d1c: Never mutate an application-held Response: the server-function handler takes ownership of the dispatched Response with a copy before any transport stamp lands, and `commitEventResponse` folds cookies/gap-fill headers onto a rebuilt Response instead of writing in place — a module-level cached Response no longer accumulates every caller's Set-Cookie (one user's session cookie served to the next) (#3155)
- 93adc02: Three transport-correctness fixes on the server-function HTTP surface. A
  POST whose body-format tag names no decoding this runtime has — an unknown
  tag, a duplicated format header comma-joined by `Headers`, an untagged
  non-form body — is refused 400 before dispatch instead of calling the
  function with a substituted `undefined` argument that let the mutation
  commit and answer 200 (#3130). The transport's defaulted
  `Cache-Control: no-store` is no longer written onto a 304, which is a
  cache UPDATE rather than a stored response — the default was instructing
  caches to evict the very entry the conditional request had just confirmed
  (#3134). And `redirect()` percent-encodes non-ASCII code points in its
  target before the value touches the latin1 `Location` header: targets
  above U+00FF used to throw (masked as a sanitized 500) and latin1-range
  characters rode as raw bytes a client decoded to U+FFFD, redirecting
  `/café` to `/caf%EF%BF%BD` (#3135). ASCII passes through untouched, so
  already-encoded targets are not double-encoded.
- 19fa8b0: Fix two server-function transport encoding issues:
  - Bound the error response header value (#3093). The header is a classification label — the structured error travels in the body — so long thrown messages (nine-fold inflated by percent-encoding for non-latin1 text) no longer blow past receiver header limits and turn the application error into an unreadable response.
  - Support null-body statuses (204, 205, 304) (#3095). `respond(undefined, { status: 204 })` and raw null-body `Response`s now answer with a real bodiless response at the declared status instead of a `TypeError` from the `Response` constructor that dispatch sanitized into a phantom generic error at 200. A value-carrying result on a null-body status is reported as a legible authoring error naming the status, in every build.

- 1a95943: Server-function failure is now signaled by the protocol's error tag alone, and thrown errors answer a real 500 (#3097). The client no longer treats `status >= 500` as failure on responses the runtime encoded — `respond(value, { status: 500 })` resolves with its value like any other returned value, and only a thrown outcome rejects. A peer's own 5xx (proxy, load balancer) carries no body-format header and is still refused before decoding. On the server, a plain thrown error now answers 500 instead of 200-with-tag, so intermediaries — CDN metrics, load-balancer health, log alerts — see what the tag tells the client; thrown envelopes keep the author's status as before.
- 5be07a8: Forward an author's 3xx status consistently (#3096). The scripted redirect mask now covers exactly the statuses fetch follows (301, 302, 303, 307, 308) — a 304, the natural answer for a conditional read, forwards untouched for every caller. Returned envelopes keep their status for unscripted callers (the returned path used to hardcode 200 where the thrown path forwarded it), and the no-JS form convention honors a returned redirect envelope's Location the way it already honored a thrown one.
- 8963843: Fix SSR stream never closing when a fragment rejects terminally while async work in its subtree is still pending (#3165). Pending promises written to the hydration serializer now join an abandonment ledger keyed by hydration id; a fragment settling with an error releases everything under its key — descendant registry fragments settle so `flushEnd` can drain, and abandoned serialized deferreds resolve so seroval's completion fires. Independent live boundaries keep gating the response as before.
- 8d34af1: Answer the labelled version-skew 404 before the CSRF origin gate (#3136).
  A removed id is no longer in METHODS, so it could not be recognised as a
  declared read and the gate fired on it: every caller without origin proof
  — a CDN revalidating a GET-declared read, an uptime monitor, a
  server-to-server client (Node's fetch sends none of the headers the gate
  reads) — got a bare 403 instead of the `X-Server-Function-Unknown` 404,
  so a deploy that removed a function read as an auth/WAF failure in the
  edge logs and the #3110 recovery signal was invisible. Nothing is
  registered at an unknown id, so the gate had nothing there to protect,
  and the ids were never secret — the compiler ships them in the client
  bundle. The hoisted lookup is a side-effect-free Map read, the labelled
  404 no longer carries the CSRF `Vary` (its answer does not depend on
  origin proof, so it must not fragment shared-cache entries on it), and
  the meaningless-path 404 stays bare and stays gated. Diagnosed, measured,
  and drafted by @frenzzy.
- fc5d079: Name the contract a `GET()` declaration signs, and add the opt-out of its trade (#3114). The origin gate is skipped for GET-declared reads by design — same-origin policy already keeps a cross-site caller from reading the response, and the gate's `Vary` fragments the shared-cache entries the helper exists to enable — which makes declaring GET a safety assertion, not only a transport choice: the function becomes executable from any origin, with caller-chosen arguments, carrying the user's ambient cookies. That contract is now stated on `GET()`'s documentation on both entries (declare GET only for reads that are safe in the RFC 9110 §9.2.1 sense), and `csrf: { protectDeclaredReads: true }` lets a deployment that does not rely on shared caches apply the origin gate to its reads as well. Both halves are pinned by tests: the default skip, and the opt-in gate.
- 1d2d1e5: Fix a deep-but-legal server function result being reported as a failed call (#3160). `guardFailures` walked the result recursively, so ~10k+ nesting overflowed the stack and the `RangeError` escaped into dispatch's catch as a phantom function error — a successful, committed call answered with a generic 500. The container walk now carries an explicit stack (the `isJSONSafe` precedent), and any residual synchronous throw on the codec road is renamed to an encode error before rethrow so misattribution cannot recur from another cause.
- 2320bc9: Channels behind a plain-object getter or used as a Map key are now guarded (#3176). The failure-guard walk previously skipped both while the codec pumped them anyway, so a rejecting promise behind either rode the wire with its raw message, streams reached that way were never torn down at disconnect, and the getter shape could take the whole process down as an unhandled rejection (the fast-JSON probe minted an extra, unobserved promise per read). Getters are now invoked exactly once and materialized as data properties, Map keys are walked like values, the JSON-safe probe reads through descriptors so it never invokes an accessor, and a throwing getter fails the call as a sanitized 500 instead of an encode-time in-band failure.
- 2f6d8cc: Label the unknown-id 404 so version skew is recoverable (#3110). A call whose well-formed address is not registered in the answering deployment — a tab holding the previous build's ids across a deploy, or a genuinely removed function — now answers with an `X-Server-Function-Unknown` header, and the client stamps `unknownFunction: true` (plus a directed message) on the rejection. Integrations can act on it — typically by reloading the document onto the current build — instead of surfacing a generic failed call. A 404 for a path the address scheme gives no meaning to stays unlabelled.
- fe4bfa0: Type the client `live()` reference truthfully: calling it returns the reconnecting iterable itself, synchronously — not a `Promise` of one. The declaration previously routed through `ServerFunction`, whose call signature promises `Promise<T>`; the mismatch was masked by the dangling declaration references this release also fixes. Isomorphic consumers are unaffected: they `await` the call, and awaiting the client's plain iterable is identity.
- 02f87fe: live() reconnects through the 4xx statuses that say "retry" and honors Retry-After (#3100). The reconnect loop treated the whole 4xx band as a definite rejection, so a rate limiter's 429 — or a gateway's 408 — permanently closed a healthy stream. 408 (RFC 9110 §15.5.9), 425 (RFC 8470) and 429 (RFC 6585 §4) now reconnect like a 5xx, as does any failure whose response carries Retry-After — the peer inviting the retry in as many words. A named Retry-After wait (seconds or HTTP-date, stamped on the error as `retryAfter` in seconds for policy layers) replaces the exponential backoff guess for that attempt, capped at 60s so a misconfigured header cannot end the stream in all but name.
- 5230666: Fix hydration ids drifting after a reactive lone spread (#3105). A lone spread now passes its accessor straight to `spread()` on the client — no `mergeProps`, no memo, no hydration id — matching the server's existing pass-through fast path. The runtime resolves a function props source inside its own tracking scopes.
- 653dd41: Multi-source single-flight: named flight-data sources alongside the unnamed hook

  The single-flight channel assumed exactly one data-owning integration — one
  `collectFlightData` hook on the server, one `subscribeFlightData` consumer on
  the client, later registrations displacing earlier ones. An app running two
  caches (a router's route data and a query library's client) had no way to
  refresh both from one mutation response: whichever library registered last
  silently won.

  The channel now multiplexes named sources over the same round trip:
  - `registerFlightDataSource(id, hook)` (server) registers a collector
    additively next to the unnamed `collectFlightData` slot, which remains the
    data-owning integration's (a router's).
  - `subscribeFlightData(id, consumer)` (client) subscribes a consumer to its
    source's slice; the bare legacy signature keeps meaning the unnamed source.
  - The request-leg `X-Single-Flight` header now carries the subscribed source
    ids, so the server only runs collectors the client can consume; the
    response leg echoes the ids actually folded, making the payload shape
    self-describing. With named sources in play, `data` is the keyed envelope
    `{ [source]: slice, ... }` and each slice is delivered to its consumer,
    awaited, before the mutation's promise resolves.

  Fully wire-compatible in every cross-version pairing: a lone unnamed
  registration still sends and echoes the literal `true` with the raw payload
  shape, byte-identical to the previous protocol, and unrecognized opt-in
  values from hand-tagged requests still reach the unnamed hook. Existing
  integrations (Solid Router, TanStack Solid Start) keep working unchanged; the
  keyed envelope only materializes when a named source registers on both ends.

- 8d17083: Server function response streaming now demand-gates and tears down every async-iterable or ReadableStream source in the result graph, not just a top-level one (#3125). A stream nested inside the result (`{ items: rows(), total }`) no longer produces unbounded ahead of a slow consumer, and a cancelled or aborted request closes it — `iterator.return()` runs, so generator `finally` blocks release their resources instead of leaking per abandoned request. The demand gate is shared across concurrently pumped sources (a consumer read wakes all parked pulls; each steps once and re-parks).
- 006a115: Carry masked redirects in a dedicated header and retire the RC transition shims. Scripted callers now receive redirects as `X-Server-Function-Redirect: <status> <url>` with the target resolved server-side against the request URL (#3102) — `Location` never rides a masked 200, so an authored `Location` on a forwarding status (a 201's created-at) stays data, and integrations compare origins on a real URL instead of guessing navigation strategy from the author's spelling (#3107). `decodeRedirectHeaderValue` is exported for readers. Removed the transitional instance-header scripted fallback at the bare address and its forced no-store (#3094): the answer shape is now a function of the URL alone, with the data address as the only scripted path.
- e637272: Navigation targets now carry an http(s) scheme floor on both legs of the redirect header (#3175). `maskRedirect` resolves targets with `new URL(target, requestUrl)` where an absolute scheme wins over the base, so `throw redirect(next)` with user data emitted `javascript:alert(document.cookie)` as the header's "resolved absolute target" — same-origin script execution in any integration that navigates to the decoded value. The transport now refuses non-http(s) schemes on `X-Server-Function-Redirect` and `Location` with a sanitized 500 (relative targets and cross-origin http(s) still flow — the same-origin-vs-allowlist policy is a separate, pending decision), and `decodeRedirectHeaderValue` enforces the resolved-absolute-http(s) contract it documents, so a hostile peer cannot re-open the class against `location.href = decoded.url` integrations.
- 0b9d69a: Fix post-`createEvent` refusals silently dropping the event's response stub (#3159). The scripted-form 400, malformed-arguments 400, and maxArguments 400 returned directly instead of through `commitEventResponse`, so a `Set-Cookie` an integration wrote in `createEvent` (a rotated session, a fresh CSRF token) never reached the browser on exactly the requests where something already went wrong. Every exit past `createEvent` now folds and commits the stub, which also arms the stub's late-write instrumentation on refusals.
- f739ec3: Sanitize a failure that escapes through a server function's result graph.
  `sanitizeServerError` guarded the one road a thrown error takes out of
  dispatch; a rejected promise, an async iterable that throws, or a stream
  that errors reaches the codec as a value to encode instead, and shipped
  its `message` and every own-property to the client verbatim — a driver
  error's failing query, connection string and bound params included —
  under a 200 carrying no error tag, because the head was already
  committed. Those channels are now wrapped before either serializer sees
  them: the response encoder and the frames flight sink, which encodes its
  outcome with a serializer of its own.

  The walk covers plain objects, arrays, `Map` and `Set`. A channel held by
  a class instance or behind an accessor is left alone — rebuilding one and
  invoking the other are not the runtime's to do. `markSafeError` remains
  the escape hatch, an `Error` that is a returned value is untouched, and
  the wire format is unchanged, cycles and shared references included.

- 9522945: Scripted server-function calls now go to their own data address, `<endpoint>/data/<id>`, leaving the bare `<endpoint>/<id>` address to plain HTTP (#3094). The two caller kinds get differently shaped answers — codec encodings for the client transport, verbatim responses / form-convention handling for everyone else — and shared caches key on the URL, so a header-driven shape meant one caller kind's cached answer could be replayed to the other (a `GET`-declared function returning a raw `Response` with a public cache policy could serve its codec encoding to a browser navigation, or its raw body to the app's own transport). The answer's shape is now a function of the URL alone. A reference's `.url` and rendered action urls stay on the bare address; reconstructed callables splice the `data` segment in ahead of the id for their own calls. Transitional: the instance header still summons the scripted shape at the bare address so already-loaded tabs survive a server deploy, with those answers forced `no-store`.
- 45f6b5f: Three server-function transport guards: the CSRF origin matcher's verdict is now checked strictly (`=== true`) so truthy non-booleans fail closed instead of open (#3169); an async `createEvent` is awaited instead of flowing downstream as a pending Promise that dropped every header the integration wrote while answering 200 (#3170); and a throwing `transformResult` on the thrown path is contained to the same sanitized 500 it produces on the return path instead of escaping the handler (#3171).
- fe4bfa0: Fix server function references typing as `any`: the emitted `server-functions` declarations referenced `ServerFunction`/`ServerFunctionMetadata` without importing them (the `export type` blocks only re-export the names), so under `skipLibCheck` every `GET`/`live`/`createServerReference` return type silently collapsed to `any` for consumers.
- 21a5122: Single-flight always folds the keyed envelope — the raw legacy payload shape is gone with the other RC shims. The unnamed registration's slice rides under its reserved id "true" like any named source, so `{ value, data }` has one shape, not two; the client always delivers `data[source]` to each consumer. The unrecognized-opt-in courtesy (arbitrary truthy header values reaching the unnamed hook) is also removed: only exact source ids run collection.
- f06f7b1: Pull a streamed server-function result behind a demand gate (#3118). The
  response stream was built with no `pull` and no queuing strategy, and
  every codec node is enqueued the moment it is parsed, so the producer ran
  as fast as it could resolve whether or not anyone was reading: one slow
  consumer buffered the whole result in server memory, unbounded and
  invisible to application code. The consumer's reads now drive `pull`,
  which releases one source pull at a time, so an unread stream stays near
  the queue size instead of running away.

  Scope: the gate sits on the source the runtime wraps, which is the
  result itself. An async iterable nested inside the result — `{ items:
rows() }` — is pumped by the codec directly and is not yet gated. Ending
  the stream releases a parked pull, so an aborted, cancelled or failed
  stream still closes its source; a consumer that abandons a stream without
  cancelling it now leaves the producer parked rather than running it to
  completion.

- 07471da: Add typed preload links to the server asset pipeline.

  Static manifests can attach `preloads: PreloadLink[]`, resolver results can carry the same shape for framework integrations, and any integration can register a link with `registerAsset("preload", link)`. The runtime preserves `as`, MIME type, CORS mode, integrity, referrer policy, fetch priority, and media attributes across string, streaming, embedded-head, custom-sink, and frame renders.

  `lazy()` and `clientOnly()` forward resolver-provided preload links alongside their JS and CSS.

  `JSX.HTMLPreloadAs` and `JSX.HTMLFetchPriority` are now exported for reuse.

  Preload links are explicit: manifest `assets` are not preloaded automatically. Existing stylesheet and modulepreload APIs are unchanged.

  Development builds warn when font or fetch preloads omit `crossorigin`, because a different eventual request mode cannot reuse that preload.

  Frame clients also retain and consume every late root asset record instead of dropping earlier records that reuse the same transport key.

- Updated dependencies [51ffcb9]
- Updated dependencies [91e300a]
- Updated dependencies [00d1d5d]
- Updated dependencies [07471da]
- Updated dependencies [0c02d42]
  - solid-js@2.0.0-rc.5

## 2.0.0-rc.4

### Minor Changes

- 475744c: Add `invoke(fn, options, ...args)` — the per-call server function invocator (#3057). Applies one call with invocation-scoped options: `signal` (aborting rejects the call and cancels the request; ends a live source's iteration across reconnects), `keepalive`, and `priority`. Longer-lived concerns are refused with a redirect to their home (`prepareRequest`, `withMeta`/`GET`, the data layer via `signal`) — never a `RequestInit` passthrough. Dispatch rides a registered-symbol invocation channel (`SERVER_FUNCTION_INVOKE`) that wrappers forward like declaration metadata, so `invoke` composes through `GET`, `live`, and integration wrappers that adapt it. On the server the call runs in-process: `signal` rejects the caller, transport hints are no-ops.
- 8d249c7: Patch-mode list hydration: claim + register only. The list driver claims each
  server row positionally through the row's own `_hk` key (a row-scoped
  explicit-id owner makes the compiled template's getNextElement resolve it),
  and patchDriver skips the initial force-apply while hydrating — server HTML
  stays the truth until the first transition. All driver-side `each` reads and
  the probe are id-isolated (throwaway/private explicit-id owners), so lazily
  minted prop-getter memos can no longer shift the ambient hydration id chain
  on either the engage or decline path.
- 8d249c7: Patch-mode list driver: keyed `<For>` over a store array is offered to the
  runtime's row-ops driver (create/bind at op-apply, LIS moves, node removal —
  no mapArray, no per-row owners, no DOM-side reconcile). `For` carries `$ll`
  metadata on a lazy classic accessor so unaware renderers and declined lists
  (non-store subject, impure rows proven by a bind-time owner probe, fallback
  or index usage) fall through to today's mapArray path unchanged. Array
  identity swaps keep keyed semantics by raw-identity matching. Adds
  `ownerIsBlank` (signals) for the purity probe and `driveList` (web, rxcore
  seam) for the runtime.
- 8d249c7: Close two list-driver coverage gaps found by the JFB store scenario: setter-
  channel structural mutation (push/splice/index assignment/permutation) now
  emits identity-keyed row ops at the fold — a driven list stays DOM-correct
  for stores mutated without reconcile — and empty-initial lists engage
  TENTATIVELY, deferring the purity probe to the first created row, with a
  late decline handing the region to the classic mapArray path through the
  runtime's re-entry thunk
- 8d249c7: Shallow store lists through the compiled driver: slot patches graduate from
  prototype to channel semantics (key-aligned value-replaced slots only —
  structure rides row ops — queued at effect phase under the registration
  owner), and the list driver collects a shallow row's compiled bodies at bind
  (rows are raw; nothing to register on) and dispatches them from the array's
  slot channel, rebasing indices with structural ops. Adds storeIsShallow;
  kind-changing subject swaps (shallow <-> deep) hand off to classic.

### Patch Changes

- 8d249c7: External-audit fixes on the patch-list driver surface: family (projection/optimistic) arrays now decline the driver — their structural changes emit no row/slot ops and the proxy identity is stable, so an engaged list would freeze on optimistic or projection structure (classic mapArray handles them correctly, including on identity-swap handoff). Shallow slot-patch registration is now multi-consumer — two driven lists over one shallow array previously overwrote each other's channel. Adds `storeHasFamily` (with server stub) and regression tests for both.
- 54506e0: Clarify invoke's wrapper contract: declaration wrappers (GET, live) forward the invocation channel mechanically (1:1 call mapping); wrappers that share calls (deduping caches, multicast channels) opt in deliberately or decline, and invoke's error now directs callers to the underlying reference or the wrapper's own idioms.
- 0043643: Document two boundaries of the client `fetch` option's contract: a retrying wrapper may re-send a request that got no response but must never replay one whose response ended (mid-body death may have executed a mutation; live-source reconnection is the runtime's job), and the call-to-request mapping is delivery detail, not contract.
- c9b4f2a: SSR `<select value>` resolution now handles empty-string bound values (#3013 follow-up). Empty attribute values serialize as bare attributes (`<select value>`, `<option value>`), which the flush-time pass didn't recognize — a bound `''` never marked the `value=""` placeholder option `selected`, so the pre-hydration page showed the first option while app state said `''`. The pass now reads the bare form as the empty string on both the select and its options, matching React's SSR output for the single-select placeholder pattern.
- 8c48a2e: Fix whole-document hydration dying when `useHead` coexists with shell-authored `<head>` children (#3081). A charset/base registration is spliced as a prelude immediately after the `<head>` open tag — a deliberate byte-placement constraint — landing it ahead of every head child the shell authored itself. The compiled head traversal is positional (raw `firstChild`/`nextSibling` chains in production), so the prepended tag shifted every read by one and hydration for the whole document died on a null read. `hydrate()` now moves the registry-inserted leading run (`data-dh` without the `data-dhf` in-place-rewrite stash) to the end of head before any claiming: the parser already consumed the byte-placement guarantees, the moved metas are inert in an unrendered element, and the walk sees exactly the shell's authored children. The in-place rewritten static `<title>` keeps its stash, its position, and its claim.
- 8d249c7: The list driver's identity matching unwraps store proxies on both sides — draft-authored permutations store row proxies verbatim, and matching them against raw records rebuilt every surviving row (caught by the JFB keyed-reorder identity gate).
- 2f01f23: Module-level "use server" exports now register by value: the server build registers each export's evaluated terminal initializer whole, so server-side wrappers compose onto every call path — `export const getUser = withValidation(schema, fn)` applies the wrapper to HTTP dispatch and in-process SSR calls alike, and patterns like `withDelay(fn, 400)` work for server mocks. The client build always emits bare references, so wrappers, schemas, and helpers stay server-only by construction. The compiler never inspects the initializer's shape; `registerServerReference` now throws at module eval when handed a non-function, turning stray non-function exports into loud boot errors instead of dead references. Anonymous default expressions (`export default withDelay(...)`, `export default async () => ...`) get a synthesized binding and register too — previously they were silently dropped from both builds. Supersedes the unreleased wrapped-export compile error.
- 8d249c7: Optimistic family arrays are drivable by the patch-mode list driver, completing the family channel: structural optimism (push/splice/reorder/replace in optimistic drafts) emits identity-diffed row ops at lane timing from the override channel — visible in flight, bypassing the transition stash like optimistic record patches — and reverts emit an identity RESYNC the driver resolves against the live post-revert view. The driver binds optimistic lists from the optimistic view (classic reads the same view through the proxy), and the identity-swap matcher is shared between swaps and resyncs. Equivalence matrix extended with async optimistic scenarios (mounted → in-flight → settled, revert and land, element-level and parent-key structural writes).
- 8d249c7: Patch channel is pay-for-use: the list driver and `patchDriver` moved out of the always-retained web runtime into `patch-driver.ts`, arming the insert seam lazily from `rowProof`/`patchDriver` (which only compiled patch-mode output imports); the store's emitters ride hooks installed at first registration (`patch-hooks.ts`) instead of static imports. Apps without patch-mode output retain only a ~100 B insert hook; the store write-path seams cost ~490 B on the store floor. Before this, every client app carried the full driver (~2.4 KB brotli).
- 8d249c7: Second re-audit hardening of the patch channel: adoption seams demote accessor-bearing adoptees to tracked effects in development, with a loud diagnostic (production emits directly — per-adoption accessor scans cost ~12% of dbmon's tick, and getter-bearing adoptees on patched records are a development-caught shape); setter-returned root replacements and chained-store swaps emit their patches and row ops at fold commit; the list driver's ops application builds every new row before any destructive step (a throwing row factory leaves DOM and bookkeeping atomically unchanged); patch errors route to the nearest computed ancestor so `Errored.reset()` can recompute it (reset also skips non-computed sources), and unhandled patch errors halt like unhandled effect errors; key equality is SameValueZero and occurrence-aware everywhere keys compare — NaN keys stay retained and duplicate keys adopt per occurrence on both channels; same-batch duplicate patch emissions coalesce (one application per batch, effect parity).
- 8d249c7: Third re-audit hardening of the patch channel: same-batch coalescing updates the queued entry in place (latest `next` wins — adoption replaces the captured object, so dropping later emissions applied stale state) and the drain clears the channel stamps (no batch retention on quiet records); the adoption remainder window builds from the misalignment point so prefix-consumed rows are never re-offered to duplicate keys; optimistic tentative matching gains SameValueZero + occurrence-aware parity with the plain channel; a failed row-ops application forces an identity resync on the next update (the store committed the failed topology while DOM kept the old one — positional ops would mis-index) and suppresses slot ticks until the baseline is restored; a throwing row factory also severs its own partial registrations.
- 8d249c7: Fifth-round hardening of the patch channel: no-op adoptions (A→B→A in one batch) clear the adopted flag so later setter row ops never freeze a driven list; transition merges retarget the moved entries' coalescing stamps (post-merge emissions coalesce instead of double-applying at commit); multi-consumer patch dispatch snapshots the registration list (a callback unbinding a sibling no longer skips consumers); the list driver's initial construction severs partial registrations on throw like update-time builds (one failed initial render no longer elevates patchCount globally); a failed apply actively resyncs from the next slot tick instead of waiting for a structural update; and identity swaps register the new subject's channels before applying so a throwing swap stays recoverable.
- 8d249c7: Patch-channel contract hardening from the stage-2 re-audit: ordinary `patchDriver` registrations unbind with their owner (entries no longer leak past unmount); merged transitions move their held-patch stash so no patch strands; the optimistic drain shares the normal drain's per-entry error isolation and boundary routing; accessor-bearing records are excluded at admission (scan-before-trust) and records that acquire accessors demote their patches to tracked effect fallbacks; writable projection arrays emit setter row ops at their fold-commit visibility moment; row-ops/slot registrations resolve chained backings to the ultimate owner; duplicate keys match occurrence-aware instead of first-wins; the production dev-token typo (`_DX_DEV_`) is fixed; `patchDriver: true` normalizes identically in Babel and the native loader, the option is typed in `TransformOptions`, and a `dom-patch` parity tier ratchets patch-mode output across both compilers (currently byte-identical on all fixtures).
- 8d249c7: Patch-channel semantics completion: a throwing patch now routes through its
  registering owner's queue chain to the enclosing error boundary (render-
  effect parity; sibling isolation preserved, unhandled errors still rethrow),
  and the dual-driver effect fallback splits phases with the same compiled
  body — a next===prev read pass tracks in compute, the force apply writes in
  the effect phase where transitions and batching expect DOM writes
- 8d249c7: Patch-mode lists now implement the identity semantics the view declares instead of the reconcile key's. Deep lists are unaffected (adoption preserves proxy identity, so key ops and reference semantics coincide). Shallow reference-keyed lists rebuild rows whose records were replaced — matching classic `mapArray` exactly, where the driver previously patched them in place (a default-on compiler mode must never change observable DOM identity). `For` forwards its `keyed` prop on the list metadata; explicit `keyed={fn}` lists decline the driver until the accessor-row binding contract lands.
- 8d249c7: Patch-channel arming is two-tier so the default-on cost stays proportional: `patchDriver` no longer retains the list driver (only `rowProof` — the compiled marker of a patch-mode list — arms the insert seam), and the store emitters split into value hooks (armed by `registerPatch`) and row hooks (armed by list registrations), so non-list patch templates never retain row binding, LIS, or reconcile's diff builders. Flip-preview size scenarios pin both tiers.
- 8d249c7: Patch-mode lists retain per-row unbind handles: a record the app keeps beyond its row's life no longer holds a live patch registration updating detached DOM — registrations are severed on row removal, contract-leave handoffs, and list disposal. Dev builds also warn when a stamped row's build attaches computations or cleanups to the shared list owner (owned work in handler/attribute value position is unsupported in patch-mode rows).
- 8d249c7: Projection (non-optimistic) family arrays are drivable by the patch-mode list driver: their recomputes walk reconcile, whose row/slot emissions were never family-gated and ride the transition-stamped apply queue. The blanket family decline narrows to optimistic families only (`storeHasOptimisticFamily`), whose user writes ride node overrides and emit no structural ops. Fixes chained-backing patch registration: a projection wrapper's backing is another store's proxy, so `registerPatch`/`patchableRaw` now resolve through the chain to the ultimate owner target — patches registered on wrapped projection rows previously never fired (value transitions fold on the source). Equivalence matrix extended with 13 projection scenarios including recompute-driven structure and retention topology.
- 8d249c7: Patch-mode list admission moves entirely to compile time: driveList engages only for row functions carrying the compiler's `rowProof` stamp (exported from @solidjs/web), and the runtime purity probe is deleted — no speculative execution of user row code, no probeMark/probeGate seams, no ownerIsBlank, no tentative empty-list engagement with late decline. Unstamped rows take the classic mapArray path before any DOM work; `lateClassic` remains only for engaged lists whose subject later leaves the contract (identity swap to a derived array, shallow/deep kind switch).
- 258c76a: Harden the server function handler's HTTP layer. The method gate is now an allowlist: POST always dispatches, GET and HEAD dispatch only to `GET`-declared functions, and every other verb answers 405 — previously a HEAD (or PUT/DELETE/PATCH) request bypassed the GET gate entirely and executed any registered function with attacker-chosen query arguments (#3069). HEAD runs the function like GET and strips the body per spec. Responses now default to `Cache-Control: no-store` unless the function set its own cache policy, and GET/HEAD requests to `GET`-declared functions skip the CSRF origin gate so their responses no longer carry the `Vary: Sec-Fetch-Site, Origin, Referer` that fragmented shared-cache entries — declared reads are protected by same-origin policy, and caching becomes opt-in on the wire instead of just in prose (#3071).
- 79b96cf: Address server function calls by path: `<endpoint>/<id>`, with arguments staying in the query.

  The id travelled in `X-Server-Function-Id`, with `?id=` as the fallback for requests the client runtime did not make. Both are gone; it moves into the path — what per-function edge rules, cache policies and `http.route` labels key on — leaving one place in the request that carries it, so a cache in front of the app cannot be made to store one function's response under another's key (#3070). POST addresses move too, and `endpoint` now gates dispatch on both halves: a request whose path does not start with it is not a call.

  `serverFunctionUrl(id, boundArgs?)` and `parseServerFunctionUrl(url)` ship on both entries for integrations composing action urls. A GET call whose url would exceed 2000 characters dispatches over POST instead, marked as a read — a cache miss rather than a 414.

  A read whose query is not an argument encoding hands that query to the function as a lone `URLSearchParams`, the read-side mirror of a no-JS form post decoding to a lone `FormData`, so a `method="get"` submit reaches the function it addresses. Which reading applies is decided by the url alone, never by a header; `args` stays reserved on the query, and a value under it that is not an argument array answers 400.

- 82b4e14: Add `fetch` to `configureServerFunctionsClient`: the function the transport sends every server-function request with, typed and called as `(address, init)` — the address relative to the document, as the global one receives it — so an ordinary fetch wrapper drops in, a hand-written one needs no casts, and `parseServerFunctionUrl` reads the id back out for telemetry. `null` restores the global.

  An app-shaped url is what makes it worth a seam: the handler takes a web `Request`, so a route that rewrites into the canonical address dispatches like any other call, and nothing downstream — the router's action-url interception, the plugin's dev middleware, the generated dispatch gate — has to learn a second address format. A wrapper forwards `init` — the call's `signal` rides on it — keeps the call same-origin, and hands back what the peer answered, unread. The seam is the client transport's exit only: a server-side call runs in process and never reaches a fetch.

  Also tidies the `endpoint` documentation on both entries, which the path-addressing change left saying the same thing twice.

- c07edcb: Fail a server function call on a response the runtime did not write, instead of resolving it to `undefined` (#3087).

  Only the protocol's error header and a 5xx counted as failure, so every other non-2xx was decoded as a result — and decoding a login page, or an empty 405, yields nothing. A response at 400 or above carrying no body format now fails the call with the status on the error, undecoded, and before the passthrough control flow uses: a refusal can carry a `Location` of its own, and the passthrough would have handed it back as control flow. Redirects are left alone — `fetch` follows them, so an interstitial arrives as its page at 200, and a 3xx only reaches the transport where something opted out of following one.

  `BodyFormat.Void` marks the one response the runtime encodes without a format to carry — a function that returned nothing — so `respond(undefined, { status: 400 })` stays a result alongside `new Response(null, { status: 404 })` and `respond(value, { status: 400 })`. A client that predates the tag decodes it the same way; a client that has it, talking to a server that does not, reads an untagged void 4xx as a refusal.

  A 2xx is not judged at all: a login page served at 200 is indistinguishable from a void result by header alone. One runtime-produced shape is caught with the foreign ones — a verbatim `X-Content-Raw` response at a non-2xx status, which an integration's `responseHandler` claims before the check.

- Updated dependencies [8d249c7]
- Updated dependencies [f0c3692]
- Updated dependencies [f3da41e]
- Updated dependencies [a10cf1a]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
  - solid-js@2.0.0-rc.4

## 2.0.0-rc.3

### Minor Changes

- 89a0531: Absorb the 0.50 expressions snapshot into this repo: lift compilers as `@solidjs/babel-plugin` and `@solidjs/compiler`, dump runtimes into `@solidjs/web` / `h` / `html` / `universal`. Origin: ryansolid/dom-expressions@e97e4290 (0.50.0-next.44).
- 89a0531: Collapse the expressions dump: drop the rxcore seam, flatten runtimes into package `src/`, delete `babel-preset-solid`, and publish compiler natives as `@solidjs/compiler-*`.

### Patch Changes

- 8710b78: Type the shared JSON codec options resolver so packed CommonJS declarations remain valid for strict Node16 consumers.
- e9ae1d2: Reuse text nodes for dynamic text in multi slots. `normalize` now leaves string/number values raw (the compute phase stays free of DOM writes and allocations, so transition forks cannot leak state before commit) and `insertExpression` materializes them at commit — adopting the positional text node with a `.data` write and allocating only when no text node is there. Previously every changed text value beside an element sibling allocated a replacement node and swapped it in, roughly halving update throughput on dbmon-style workloads. Hydration claiming still adopts the server's live text node, and a failed claim keeps the phantom-render semantics the old fresh-node allocation triggered.
- 848d25a: Type the server entry against the client `solid-js` declarations it actually resolves, type the client `HydrationScript` stub as a JSX component, and point published `@solidjs/web` types at the same JSX module `jsx-runtime` uses so router `Action`s type-check as form `action`s.
- 4fba79d: Fold render/hydrate policy into the runtime implementations, drop the duplicate `mergeProps` re-export, keep JSX type sources in `packages/web/jsx/`, and colocate the SSR package entry at `src/index.server.ts`.
- 7182195: Migrate the dumped DOM runtime from JavaScript plus colocated `.d.ts` files to TypeScript sources, so published types come from `tsc`.
- da59aea: Recover from `REACTIVITY_HALTED` in dev workflows. A halt is global to the runtime instance, so one uncaught error used to permanently brick HMR (hot swaps are signal writes, which a halted scheduler drops) and playground-style embedders (a fresh `render()` never mounts because its queued effects can never flush) until a full page reload. Now the refresh runtime revives scheduling before patching a hot update, and `render()` resets the halt in dev before mounting. `resetErrorHalt` is re-exported from `solid-js` (no-op on the server) so dev tooling can do the same. Production behavior is unchanged: a halt remains a hard crash.
- b8c4534: Use Solid-native names for internal development markers and experimental frame protocol identifiers.
- 7182195: Move frames, server-functions, and serialization implementations into their subpath folders. Bind `@solidjs/h` and `@solidjs/html` directly to `@solidjs/web` instead of taking a runtime argument.
- Updated dependencies [a85c889]
- Updated dependencies [28d5289]
- Updated dependencies [bbcce0a]
- Updated dependencies [35b30a1]
- Updated dependencies [da59aea]
- Updated dependencies [0205756]
- Updated dependencies [b8c4534]
  - solid-js@2.0.0-rc.3

## 2.0.0-rc.2

### Patch Changes

- 3878001: The shared frame host passes `delegateEvents` to `createFrameHost` as the new `delegate` option — behavior-claim event arming flows through platform glue instead of a core-entry global, keeping dom-expressions' tree-shaken client subsets free of the event system.
- 515ff56: Server-component mounts pass their raw client props to the frame runtime for behavior-claim resolution: ref/on\* positions on server-rendered elements (compiled under the `serverComponents` option) resolve by prop name through the mounted frame's live props at dispatch and materialize time.
- 3dbf12b: Fix the document-face slot-fill hydration misses (the chat welcome/status shape): adopted fills now claim the settled server markup instead of key-missing and re-rendering. Three defects, one per layer. `@solidjs/web`: the lazy async-read memos in `slotArgsProxy` minted a hydration child id the document producer never allocated (shifting every subsequent key in the occurrence namespace) and treated record-revived settled promises as pending — they are now `transparent` and fast-adopt the serializer's settle stamps. `solid-js` boundary: a SUPERSEDED fragment (settled `_fr` whose markup never shipped because an outer boundary converged first) was hydrated "straight through", claiming keys the document never emitted — the boundary now detects the unswapped placeholder, hydrates the showing fallback, and resumes with fresh client DOM. `solid-js` containers: `materializeContainerTrace` gains a synchronous path for the raw-stream trace wire shape, so a snapshot the document already delivered reads as ready DURING the synchronous claim walk instead of suspending a settled boundary into a phantom fallback.
- 8a44c9e: Pin hydration id parity for a conditional expression in a forwarded JSX prop (#3033). On rc.1 the prop getter's compiler-minted condition memo consumed a flat sibling id slot at read time, and the two sides read the getter at different walk points (server: open-tag attribute serialization, before children; client: attribute effect, after claiming them), so the forwarded keyed child failed its claim. On next the forwarded child keys compose under the memo's own id scope, which both sides agree on regardless of read order — a parity-harness scenario now guards this. Also documents why the `_$memo` runtime binding must NOT be transparent: the ssr generate wraps whole hole bodies in it, making its id slot the retry-stable scope deferred holes re-run under.
- e900893: Protect server-function requests from cross-site calls by default.
- ab0674c: Adopt `@dom-expressions/runtime` 0.50.0-next.44 and expose server-function call observers.
- e6d64f6: server-mock types adopt CSPNonce for renderToString/renderToStream, matching the runtime's per-destination nonce split (string or { script, style } with false to leave a destination un-nonced).
- Updated dependencies [db1fed6]
- Updated dependencies [3dbf12b]
- Updated dependencies [6692a2c]
- Updated dependencies [ccf2cb5]
- Updated dependencies [8a380d0]
  - solid-js@2.0.0-rc.2

## 2.0.0-rc.1

### Patch Changes

- 8fec5a3: Document the supported document-shell hydration pattern on hydrate(): when the server renders a full document but the client hydrates only the app subtree, wrap the shell in NoHydration and re-enter with Hydration around the app so both sides share a hydration id namespace (#3000). The pattern is now pinned by server/client test pairs.
- 56ca647: `lazy()` and `clientOnly()` accept an `{ export }` option to select a named export of the resolved module (defaults to `default`). The export name is a call-site literal available in both bundles, so lazy hydration still resolves the component synchronously from the preloaded module — wrappers that pick an export at runtime inside the import thunk remain unsupported and now fail loudly in dev. `lazy()`'s bundler-injected `moduleUrl` moves to the third argument to make room, matching `clientOnly()`.
- Updated dependencies [3c68ab2]
- Updated dependencies [62e7883]
- Updated dependencies [4f84cd5]
- Updated dependencies [8366208]
- Updated dependencies [66accfb]
- Updated dependencies [56ca647]
- Updated dependencies [366da09]
- Updated dependencies [254daf8]
  - solid-js@2.0.0-rc.1

## 2.0.0-rc.0

### Patch Changes

- Updated dependencies [427dc18]
- Updated dependencies [667a020]
- Updated dependencies [d9050a8]
  - solid-js@2.0.0-rc.0

## 2.0.0-beta.34

### Patch Changes

- 57194d8: Update dom-expressions to 0.50.0-next.42 — the multi-root hydrate/islands fix. Pages that call `hydrate()` more than once (islands entry-clients, Astro-style one-render-per-island documents) hydrate correctly: each root re-installs its own captured registry/gather and re-arms `hydrating` across the deferred module-preload render instead of racing other roots on the shared live `sharedConfig`, and the root module map serializes renderId-scoped (`<renderId>_assets`, with a bare `_assets` fallback for the single-render islands shape) so per-island `renderToString` writes stop clobbering each other's preload maps. Whole-document renders are unchanged.
- Updated dependencies [f14e4ec]
  - solid-js@2.0.0-beta.34

## 2.0.0-beta.33

### Patch Changes

- f3accb3: Container tier at the slot border (DR-2 case 3): projections passed as slot args to server components cross as bounded async traces — one snapshot, then PatchOp batches — and materialize on the client as live read-only projections. Server: the projection trace registry (`getProjectionTrace`) with a multi-consumer shared pump (one source iterator drives an append-only patch log; hydration resume and every slot crossing replay from their own cursor, snapshots captured only at stable pull boundaries). Client: `materializeContainerTrace` — a projection fed by the trace under its own root; the container reference is available synchronously, reads into it suspend until the snapshot (the fill's own `<Loading>` covers them), patch batches apply granularly, the trace's end latches the last state. The frames client installs the materializer, revives document-face `{ $tr, $ta }` marker literals at arg-read, and classifies containers FIRST and trap-safe (a pending projection's property probe throws not-ready): the slot props proxy returns the store instead of async-probing it, and the record-dedupe compare identity-tests containers through the host's `isContainer` hook.
- 8923ac6: Shrink CSR bundles by moving the hydration-phase coordination seams (`sharedConfig.isHydrationInProgress` / `sharedConfig.onHydrationEnd`) out of the `sharedConfig` object literal and into `enableHydration()`, matching the null-slot pattern every other hydration hook already follows. Declaring them in the literal retained their bodies and the hydration-phase bookkeeping they close over (`_pendingBoundaries`, `_hydrationDone`, the callback list) in every client bundle; installed by `enableHydration()` they shake out of pure-CSR builds (≈100 B brotli on the CSR size scenario, ≈80 B on the minimal-app floor). Both fields were already typed optional and documented as cross-package internal wiring; consumers treat absence as "not hydrating" — the refresh runtime already optional-chains, and `clientOnly` now falls back to a bare `queueMicrotask`, which is byte-for-byte the behavior `onHydrationEnd` itself had outside hydration.
- 3bcce84: Document-face live holes (Stage 4): `inServerComponentScope` gates live-hole arming and the iterable-memo pump to server-component render barriers on the document face, and the frames client pumps the `sc:live` channel record — one module-level reader broadcasting hole/attr ops to every adopted boundary (geometry routes; a log replay catches up boundaries that adopt after ops arrived, and call-driven streams supersede document ops).
- dd163c5: Apply document-face `slot` ops from the `sc:live` channel (DR-2 case 1 at t=0): a re-emitted occurrence record updates the adopted occurrence's live props in place. Slot ops are store-keyed rather than geometry-routed — two boundaries can share an occurrence name — so they carry the producing frame's id and only the owning boundary applies them.
- a8d56dc: `RequestEventLocals` reaches the public types through a real (non-type-only) re-export: the types build rewrites the copied `client.d.ts`'s `export type { RequestEventLocals }` to a plain re-export (failing loudly if upstream drifts), so `declare module "@solidjs/web"` augmentation identity never depends on TypeScript's `export type` alias handling. Acceptance type tests now cover augmentation from a `.ts` module that imports nothing from the package and from a module-form `.d.ts`, and RFC 12 documents the two sharp edges reproduced while investigating: a `declare module` block in a global _script_ file (a `.d.ts` with no top-level import/export) is an ambient module declaration that replaces the package's types wholesale rather than augmenting them, and a `foo.d.ts` sharing a sibling `foo.ts`'s basename is treated as compiled output and silently dropped from the program.
- 2722022: Frames client, size audit pass: (1) the seroval codec no longer ships in the eager graph — the per-response data tables materialize lazily through the frame host's new `prepareData` hook (`import("@solidjs/web/serialization")` awaited by the transport before the first `data` chunk delivers), so HTML chunks, scalar slot args and document records (self-executing hydration scripts) stay codec-free; the eager frames consumer drops from ~16.8 to ~10.9 kB gz, with the codec loading on demand only when serialized data actually arrives. A new size scenario pins the eager entry at 10.35 KB with the codec external, so a static seroval import creeping back fails CI. (2) The `sc:live` catch-up log compacts on last-value-wins keys (`type:fid:key`) instead of retaining every op for the life of the page — memory is bounded by distinct targets and a late-adopting boundary replays the latest state in one pass instead of the whole history.
- 3740fde: Include the cookie API declaration files in the published package for both ESM and CommonJS consumers.
- 09e2d3b: Server support for live markup holes (Stage 3): `creationStamp()` exposes an owner-creation counter the live-holes engine uses as an impurity gate, boundary output accessors (`Loading`, error boundaries) tag `$lhSkip` so boundary machinery is never treated as a re-runnable hole, and the async-iterable memo pump acquires the response-window hold (`ctx.hold()`) so iterable-fed holes stream every value before the response closes.
- 536dec5: Require a declared commit #0 for `ssrSource: "client"` (#2981). The server cannot run a client source, so the author must say what the pre-compute window renders: `loadingValue` on signal-family sources (`createMemo`, function-form `createSignal`/`createOptimistic`; an explicit `loadingValue: undefined` is a valid declaration — put the undefined in the type and branch on it), `seedLoadingValue: true` on store-family sources (`createProjection`, derived `createStore`/`createOptimisticStore`; the seed is what the window shows). Effects are exempt — nothing renders from them.

  Enforced at the type level (the bare `"client"` overloads are gone) and with a runtime error naming the fix — behind the dev flag on the client (zero production bytes; prod falls back to the previous gate behavior), always-on in the single-build server entry, where the implicit promotion would flush into markup. `Portal`'s internal client-sourced memos now declare `loadingValue: undefined` ("server renders nothing" is their honest commit #0).

- 45ef757: New `@solidjs/web/serialization/decode` entry: the codec's decode half on its own (the web plugin set, `createJSONDeserializer`, `createJSONDataTable`). The frames client and the server-function response path late-load this entry instead of the full serialization module, so the encode machinery ships to a browser only when rich arguments actually serialize — the lazy codec chunk drops from ~13 kB gz to ~6.5. The full `@solidjs/web/serialization` entry is unchanged (it re-exports the decode half).
- 3b97432: Update dom-expressions to 0.50.0-next.41 — the published runtime for the DR-2/live-holes arc this branch builds on. The container tier lands (DR-2 case 3): reactive containers passed as slot args cross the slot border as their trace — an async iterable of a snapshot plus PatchOp batches — and materialize back into live read-only containers on the client, on both faces, with the `ContainerTracePlugin` riding the codec's default plugin set and its hooks living in a registered global so duplicated bundle copies share one protocol endpoint. Live markup holes reach the document face (Stage 4 producer half: one per-document engine, re-emissions on an eagerly-serialized `sc:live` record) and live attribute holes ship element-addressed via `data-lha` (Stage 3); document-face slot args get per-arg pending (a not-ready getter rides its own boundary instead of coarse-holding the occurrence) and mint-suppressed fill interiors, and scope-minting arg expressions latch instead of re-emitting (no duplicate projections, no never-ending responses). Server functions decouple the transport/codec from the codec-free registry surface (`server-functions/registry.js` + a late-bound RPC seam on `globalThis`), so an app with zero server functions stops shipping seroval and the fetch RPC client; results negotiate the JSON fast path with a lazily-loaded codec, and `isJSONSafe` survives cyclic and deeply nested values so negotiation failures stop masquerading as function errors (#566). Also picks up the serializer decode split (lazy readers load half the codec), Node16-CJS importable main-entry types, tree-shakable `ResponseEnvelope`, hydrating inserts keeping `current` honest about the DOM, and the streaming-SSR retry robustness fixes (branded retry wrappers ending O(N²) stack growth; real errors in retry passes fail the request, not the process).
- 38a8b51: `httpHeader`/`httpStatus` retraction is declaration-exact instead of snapshot-restore: each response head keeps a ledger of live declarations per header (and for status), and disposing a scope removes only that scope's entry, replaying the survivors over the integration's base value in original write order. The write-time whole-field snapshot was only correct for LIFO disposal — when an earlier sibling SSR scope recovered while a later writer stayed live, restoring the earlier snapshot deleted the survivor's contribution (silently dropping e.g. a session `Set-Cookie`; same ordering hole for plain headers and `httpStatus`, #2984). Set-cookie ledgers stay entry-exact (`getSetCookie()` + re-append), and once a header's last declaration retracts its ledger is dropped so a later declaration re-reads a fresh base.
- da5646b: Server-function results negotiate a JSON fast path and the seroval codec
  loads lazily. The runtime's shared wire layer now late-loads the codec with a
  dynamic import the moment a Serialized body actually has to be encoded or
  decoded; since the server answers JSON-safe results (single-flight
  `{ value, data }` envelopes included) as plain JSON and void results
  body-less, a plain-data app's client bundle carries only the transport
  (~2.9 kB gz eager, down from ~7.3) and the codec arrives as a lazily-fetched
  chunk only when a rich value — a Date, a Map, a stream, a typed Error —
  appears on the wire. The packaging resolves that dynamic import to the public
  `@solidjs/web/serialization` entry (these single-file dists cannot
  code-split), so the app's bundler splits it at the package boundary and the
  lazily-loaded codec is the same module instance custom plugins are authored
  against.
- 57611e8: The production server bundles build with `_DX_DEV_` replaced to false. The main server Rollup target (dist/server.js/.cjs — the only node/worker/deno artifact) was missing `replaceDev(false)`, and babel constant-folds the unreplaced truthy `"_DX_DEV_"` literal, so the shipped artifact permanently took the dev branch of every build-mode gate — most damaging the committed-stub header guard, which is spec'd to throw in dev but `console.error` + no-op in production: a post-commit header write from late async SSR work crashed a live production request instead of being reported and dropped (#2982). The frames server target had the same omission (dev-only useHead/insert warnings shipped in prod). Because the constant folding erases the `_DX_DEV_` marker whether or not the replace ran, the contract is pinned behaviorally by a new spec that imports the built dist/server.js directly, bypassing the suite's source aliasing.
- Updated dependencies [f3accb3]
- Updated dependencies [8923ac6]
- Updated dependencies [3bcce84]
- Updated dependencies [23657d2]
- Updated dependencies [a37611e]
- Updated dependencies [ba7560f]
- Updated dependencies [28f7bec]
- Updated dependencies [09e2d3b]
- Updated dependencies [913913a]
- Updated dependencies [ce8e46b]
- Updated dependencies [c320429]
- Updated dependencies [766ea30]
- Updated dependencies [536dec5]
- Updated dependencies [af1c71e]
- Updated dependencies [ab5f83c]
- Updated dependencies [d7f95bb]
  - solid-js@2.0.0-beta.33

## 2.0.0-beta.32

### Patch Changes

- b160a5f: New `asyncArg` helper on `@solidjs/web/frames` (both faces): the type-level statement of the DR-2 value-tier contract at the slot border. What you pass is what ships — the promise / async iterable itself rides the data channel — but the client's prop read settles, so `Slot<P>` deliberately types the fill's props as the settled values. `asyncArg<T>(value: PromiseLike<T> | AsyncIterable<T>): T` is the identity that lets a server component pass an async value through a slot typed with its settled shape without widening `Slot`'s parameter type (which would leak async unions into every client fill's contextual typing).
- 311cc4e: DR-2 value tier, client half: async values passed whole as slot args (promises, async iterables) suspend at the consumption read. The slot-props proxy routes an async-valued prop through a lazily created async memo under the occurrence's owner, so the read follows the normal async path — it suspends into the covering loading boundary and settles when the server's data chunk lands. Applies on both the live-props and static-args paths. (The shell gate this leans on — a fresh mount's covering `<Loading>` holding until the frame's first apply — shipped separately; here it's what gives a t=0 fill's pending async arg read its covering boundary.)
- e999401: Fix a remounted `dynamic` server-component site rendering the first resolution's content instead of the latest call's (the away/back navigation regression on the identity split). `dynamic`'s kept-resolution path returns `prev` — a binding whose `.address` is frozen at the first resolution — and delivers fresh addresses only to currently-mounted sites, so a site that unmounts and later remounts initialized its address accessor from the stale binding: the fresh mount bound the first call's resident store (the SSR payload, in the document-adoption shape) while the remount's refetched response warmed a store nothing was bound to. The latest resolved address is now tracked at the `dynamic()` level and new mounts initialize from it; live-delivery into mounted sites is unchanged.
- c85b610: Stream-mounted slot fills now dispose at occurrence unmount (the lifecycle matrix's cleanup gap). A fill invoked from a stream microtask used to render under the boundary's owner, so its `onCleanup` and effects survived a later response dropping the occurrence and only died at boundary dispose — a leak for keyed churn in long sessions. Those fills now render under a per-occurrence owner tied to the frame's occurrence-level cleanup: a response that drops the occurrence (or a morph that destroys its range) disposes the fill's reactive scope right there, and a re-invocation supersedes the previous scope before rendering.

  Live-render invocations — a reveal boundary's content render, the t=0 adoption sync — deliberately keep their ambient owner. The covering render already owns their lifetime, and tying them to frame cleanups is actively wrong: the frame's zombie heuristic reads "mounted nodes without a parent" as a destroyed mount, but a pending fill's nodes are legitimately detached while its covering boundary shows the fallback — disposing there would kill the live pending effect and reveal the segment over a hole.

- af97611: A `<Loading>` inside a server component now reveals on document SSR (#2978). A deferred fragment whose producer ran on the SERVER has no client boundary to ever register as its claimant, so a `$df` settling after hydration completed was held forever by the held-swap policy (#2964) — fallback frozen on screen — while the frames classification gate (#2968) deferred on the very `fr.pending()` answer that hold kept true: a deadlock between two individually-correct policies. The fragment ledger now exposes the claimant contract (`_$HY.fr.claim`/`release`, the same one Loading boundaries use internally), and the frames document adoption — which owns the markup it adopts wholesale — goes on record as the claimant for every `pl-*` placeholder in its region: at adopt time, again for content revealed into the region later (an outer fragment's payload can carry a nested pending one), retiring its claims when the frame disposes. The secondary defect is fixed in the ledger itself: content whose placeholder range was removed (a refetch morphed over the region before the document delivered) can never swap, so it no longer keeps `fr.pending()` reading "in flight" for the rest of the page's life.
- 80970b7: Drain hydration records when a fragment reveals into an adopted server-component region. A slot invoked inside a server `<Loading>` ships its `sc:slot:` record with the deferred fragment — about the async's own delay after the boundary adopted, long after the adopt-time drain ran. That record was then stranded: the classification gate's only other re-drain arms on `_$HY.fr.pending()`, and the very reveal that delivers the record is what flips it false (a revealed fragment is no longer pending). The occurrence stayed recordless, so the next full sync — a refetch's stream apply — classified the region's render prop as a direct-insert value and evaluated it as a zero-arg accessor, whose props read halted the reactive system.
- dc7b5c2: Fix hydration id drift from allocation-capable prop getters in flow controls (#2976)

  A compiled conditional prop (`when={a ? x : b ? y : null}`) allocates a
  condition memo every time the getter is evaluated, under whichever node is
  reading. The server flow controls compensated for the client's internal memo
  slots with bare id burns, but evaluated the getters themselves under a
  different internal node than their client twins — so the getter's allocation
  landed in a different owner's id space on each runtime and drifted every
  hydration id assigned after it (unclaimed nodes, dead bindings).

  The server twins now evaluate each such getter inside a real node at the
  same child slot as the client: Show reads `when` through a mirrored
  conditionValue memo, Switch evaluates each Match's `when` inside per-match
  conditionValue memos under a mirrored switchFunc memo, and mapArray/repeat
  give the row id space its own owner at slot 0 with the memo at slot 1 so
  `each`/`count`/`from` getters evaluate where the client's computed node
  evaluates them (previously the allocation also shifted the row id base).
  Dynamic and boundary fallback getters were audited and already aligned. The
  compiler output is unchanged. Adds parity-harness scenarios for Show
  (dynamic + static), Switch, For, and Loading fallback ternaries.

- 8e148a8: `isPending` holds through a server component's args switch (#2977). An args change on a live site resolves its call at response-HEADER time — the identity split keeps the instance and rebinds the frame to the new address — but the header is not an answer: for exactly as long as the server held the shell on its own unboundaried async, the site read "settled" while the boundary still showed the PREVIOUS call's content, tearing the driving source's pending state against the screen ("count is 1" beside count-0's markup). The shell gate is now re-armable: an address switch re-pends the site until the new address's first apply — its shell content, a server-rendered `<Loading>` fallback (boundaried pends drop `isPending` as readily as a client fallback: the answer is on screen), or its error record (the pending state must never outlive the response). Async-holds-latest keeps the old content in place while the gate pends, and a warm store still answers instantly — arm-then-rebind is self-correcting, since a warm registration's synchronous seed releases the gate before any reader sees it.

  Both faces: the call-driven mount re-pends through its existing gate chain, and the t=0 adopted mount — whose return value is the raw SSR'd element that hydration claims in place, leaving no reader in the render graph to see an armed gate — gets a dedicated pending-observer effect that holds the delivering transition (the notes-search shape: adopted sidebar, then a search param changes the call).

- 595b9e9: RC API-freeze pass over the web surface (rides the matching `@dom-expressions/runtime` pass):
  - **`@solidjs/web/server-functions/rich-args`** ships. `enableRichArguments()` installs the codec's write half (~5 KB gz) as the client transport's `serializeArgs`, replacing the plain-JSON default that throws a directed message on Dates, Maps, Sets, typed arrays, and cycles. Importing the entry is the opt-in at the module-graph level — the serializer ships only when the app asks for it — and it externalizes against the shared `server-functions/client` instance, so the config write lands where the compiled reference proxies read.
  - **`renderToStringAsync` is gone** (server entry and browser mock). It was `renderToStream().then()` in a trench coat; `renderToStream` is now a real `PromiseLike<string>`, so `await renderToStream(code, options)` is the replacement — same options, resolves to the fully settled HTML.
  - **Server-function error sanitization keys on the build variant, not `NODE_ENV`.** The server-functions server entry now builds twice: the copy behind the `development` export condition (what Vite dev resolves) keeps full error fidelity, and every default resolution — production bundles, plain node, deep imports with no bundler signal — gets the sanitizing copy, failing safe. `markSafeError`/`isSafeError`/`SAFE_ERROR` export from the core entry next to the response helpers for intentional client-facing errors.
  - **`@solidjs/web/serialization` is marked integration-facing** — exempt from the 2.0 stability guarantee, per-export — and is now the single home of `createJSONDataTable` (the `/frames` duplicate re-export is removed).
  - **Every `/frames` export carries `@experimental` JSDoc** plus a banner per entry file, matching the changeset-level experimental framing.
  - **The browser mock matches the runtime signatures** (`onHead`, resolver-form `manifest`, `ssrClassName`/`ssrStyleProperty`/`ssrGroup`, `createRequestEvent`'s generic, `createSSRResponse` over `RequestEvent`), with a type-level test so drift can't recur, and compiler-output-only exports and wire plumbing are marked `@internal`.

- 687a993: Re-export the HTTP response-head lifecycle and middleware composition from the runtime (lands with the next `@dom-expressions/runtime` bump): `createRequestEvent` builds the canonical stub-backed request event; `createSSRResponse` derives the outgoing `Response` from a render result — committing the stub at shell flush, turning a pre-flush `Location` into a real redirect (`getExpectedRedirectStatus`), and appending a nonce-aware script fallback for post-flush redirects; `composeMiddleware` composes web-standard `(request, next) => Response` middleware inside the request scope. `@solidjs/web/server-functions` gains the `wrapInvocation` seam: a per-invocation wrap around server function execution (HTTP dispatch and direct SSR calls) with the invocation identity established. Documented in RFC 10 and RFC 12.
- 202acdd: New rxcore hook `ssrAsyncValue`, the reactive half of the document face's value tier (DR-2 at t=0): wraps an async slot arg in a full async-aware server memo so the inline fill's read throws `NotReadyError` until the value settles, then reads as the settled value — the SSR engine's hole machinery catches and re-pulls, so the covering boundary holds exactly as it does for any pending server read. `serialize: false` keeps the memo out of the hydration payload (the arg already ships once, through the slot record). The frame sink pre-taps async iterables down to a promise of their first yield, so the hook only ever sees thenables.
- d657df1: Fresh server-component mounts now shell-gate: the mount's covering `<Loading>` stays open until the frame's first content applies, instead of resolving over an empty `<dx-frame>` at response-header time (the empty-frame flash — the lifecycle matrix's shell-gate gap). The frame notifies before it syncs slots, so a t=0 fill's pending async read registers while the boundary queue is still open and the fallback holds seamlessly from fetch through settlement. Only call-driven mounts gate (the transport begins the address's stream before the binding resolves); placeholder mounts with no call in flight — the exhausted late-boundary waiter, client-only boots — still render their empty frame immediately, ready for a future call's stream.

  A frame `error` record also releases the gate, which requires the runtime's error-apply notification (on dom-expressions next, unpublished); until the runtime dependency bumps past it, a failed stream holds the fallback.

- 43b5aaf: The `asyncArg` docs model the correct authored form for slots with args: JSX (`<props.status …/>` — the compiler wraps each prop in a getter, deferring reads to the slot border), never a call, which evaluates its args eagerly in the component body — a top-level read, an error in most cases. Argless slots remain plain prop access.
- 1c03436: Update dom-expressions to 0.50.0-next.40 — the published runtime for the freeze-gap public API this branch re-exports. The cookie codec lands as core platform-gap primitives (`serializeCookie`/`parseCookieHeader`, dependency-free percent-encoded round-trip; reads via `parseCookieHeader(event.request.headers.get("cookie"))`, writes via `event.response.headers.append("set-cookie", ...)`), with committed-stub write loudness (a post-commit `event.response` header write throws in dev, reports + no-ops in prod) and the multi-`Set-Cookie` portability guarantee (entry-by-entry `getSetCookie()` + append everywhere headers materialize, so multi-cookie responses survive Node/undici, workerd and Deno identically). The server-function handler's commit seam is public as `commitEventResponse(response, event?)` — the second of a handler's two exits, idempotent at handler edges because an already-committed stub passes the response through untouched. The serializer entry re-exports seroval's plugin-authoring API (`createPlugin`, `OpaqueReference`) from the runtime's own seroval instance so custom codec plugins are version-pinned by construction, and `RequestEvent.locals` is typed by the exported, module-augmentable `RequestEventLocals` interface. Also picks up the frames fixes: slot records wait for their `{$ref}` data args' arrival (async ref values compare by identity, so a re-sent pending ref re-suspends instead of freezing the previous value), rebind resets per-stream root affinity so a byte-identical shell still answers an address switch (#2977's stuck `isPending` re-arm), and the ambient hydration gather treats frame regions as opaque.
- bef6da9: Implement the `waitAsset` rxcore seam for client-side CSS reveal gating (dom-expressions `docs/client-css-reveal-gating.md`). During a transition or boundary reveal, the runtime's `useHead` warms a registered stylesheet as `rel="preload"` at discovery (overlapping the fetch with the data wait) and calls `waitAsset(loadPromise)` from the gating compute; the seam throws `NotReadyError` while the sheet is loading so the transition holds — content and its CSS reveal together, client parity with SSR streaming's `$dfs` gate. Loaded, errored, and cached sheets pass through without a wait. One detached async node per promise (WeakMap-shared across readers), created outside the calling compute so the retry it triggers can't dispose it and so it never consumes a hydration id from the calling owner chain.
- 0813a51: `commitEventResponse(response, event?)` is exported from the server entry (with a loud client-side mock, like the other server-only helpers) — handler-lifecycle plumbing completing the response-head choreography's two exits: page results leave through `createSSRResponse`, any other `Response` (a middleware early return, an API result) leaves through `commitEventResponse`; application middleware never calls it. It runs the same fold the server-function handler's responses take — cookies append entry-by-entry, other stub headers gap-fill (minus the protocol-owned family and body metadata on bodiless responses), status never — then commits the stub. Idempotent at handler edges: an already-committed stub (a page response from `createSSRResponse`) passes through untouched, so handlers apply it unconditionally after their middleware chain unwinds. `event` defaults to the ambient `getRequestEvent()`.
- 0813a51: `event.locals` gets its typing augmentation point: `RequestEvent.locals` is typed by the exported, module-augmentable `RequestEventLocals` interface, replacing Start's ambient `App.RequestEventLocals` namespace (a plain exported interface, no global `App.*`). Augment `@solidjs/web` and the merge flows to `getRequestEvent()!.locals` everywhere the event surfaces — the main entry, `createRequestEvent`, the server-functions event — through one shared interface identity:

  ```ts
  declare module "@solidjs/web" {
    interface RequestEventLocals {
      user: User;
    }
  }
  ```

  The interface keeps the index signature the inline `Record` type had, so un-augmented code stays exactly as permissive as before (`event.locals.whatever = x` keeps typechecking); augmentation adds precision for the keys it names. The trade, matching Start's precedent: unaugmented keys read as `any` rather than erroring.

- 0813a51: `@solidjs/web/serialization` exports `createPlugin` and `OpaqueReference` — seroval's plugin-authoring API, re-exported from the runtime's own seroval instance so custom codec plugins are version-pinned by construction (a plugin built against your own `seroval` dependency edge would not fail the build; it would emit nodes the other end of the wire can't interpret — solid-start #1474). This closes the `@solidjs/start/serialization` gap for the Start retirement: author plugins from this subpath and feed them to the server-function `codec` option on both entries. `SerializerPlugin` is now generic (`SerializerPlugin<Value, Info>`; bare use unchanged), and the authoring surface is fully typed under `moduleResolution: "nodenext"` — the types are hand-declared against the pinned seroval line because seroval's own published d.ts degrade to `any` there. Deliberately excluded from Start's export list: seroval's granular context/`Plugin` type names — `createPlugin`'s generics carry the inference, and `SerializerPlugin` stays the one exported plugin type.
- Updated dependencies [af97611]
- Updated dependencies [dc7b5c2]
- Updated dependencies [b6071ba]
- Updated dependencies [3fd0499]
  - solid-js@2.0.0-beta.32

## 2.0.0-beta.31

### Minor Changes

- bcbe7e5: Server components Stage 2 (identity split): `dynamic` now consumes the transport's binding contract — a resolution branded `{ component, address }` whose component matches the mounted instance's keeps the instance and delivers the new address into a per-site live accessor ("same component, new props"), replacing the mount-stealing handoff protocol. The frames client mounts per-function components bound to per-call addresses (`followBinding` drives `frame.rebind`), document adoption binds the call's address from the hydration records, and the transport install drops the `documentComponent` seam — the document placeholder IS the per-function component. Argument changes at a live site, hover preloads, back-navigation re-materialization, and single-flight saves all flow through the one store-keyed-by-address model.

### Patch Changes

- 977b176: Thread the document wire id down as the adopted frame's claim scope. The identity split binds the frame to the call ADDRESS (function id + args hash), but the document producer stamps `_hk` hydration keys and region fids under the bare wire id — so every adopted claim on an args-bearing call (e.g. a note list keyed by search text) derived a `:hash`-suffixed prefix, missed the registry, and re-rendered fresh clones whose inserts moved the server-rendered `{$frame}` regions into a discarded detached tree: streamed content flashed and went blank. `claimScope` is the runtime's existing seam for exactly this (nested region frames already thread the root's scope down); adoptBoundary now passes the wire id through it.
- 70d0da6: frames: keep an adopted boundary's slot range reactive. The claim scope wrapped insert's accessor, so the binding's first read ran inside `runWithOwner`'s untracked window — reactive only by accident, via the re-read of whatever accessor that first read returned. A `<Loading>` answering a still-pending streamed fragment returns fallback NODES instead, leaving the effect with no dependency at all and the range permanently inert: the boundary's own resume still claimed the swapped-in server markup, so the region looked right, but nothing downstream ever re-rendered it (in the notes example, every navigation out of a late-settling note changed the URL and nothing else). The claim now wraps the insert CALL, so the first evaluation is the render effect's own compute — still under the producer's hydration keys, but tracked.
- edb3e36: Fix hydrated `clientOnly` desyncing DOM bookkeeping for following siblings. The client half's post-settle swap was armed with `onSettled`, which registers a tracked effect — an id-consuming owner the server half (whose only owner is the fallback mirror memo) never mints. Every sibling created after a hydrated `clientOnly` therefore derived its hydration id one slot past the server's, its template claim missed the registry, and `insert` tracked a never-inserted phantom node: the sibling's first post-hydration re-render reconciled against the phantom and inserted the new content beside the orphaned server node instead of replacing it (first surfaced as duplicated nodes after an HMR hot-swap of a component following a `clientOnly`). The swap is now armed through `sharedConfig.onHydrationEnd` — the ownerless "all hydration complete" channel — so `clientOnly` consumes exactly one child id on both sides.
- 38e2e72: Make the document boundary's record drain re-drainable and wire the adopt-time record-race seam (#2968). `adoptBoundary` previously absorbed `_$HY.r` slot/region records exactly once, synchronously at adoption — so a record whose data script ran after adoption was never delivered, and the frames client misclassified the invoked slot as argless content (halting the reactive system on the first props read). The drain now applies each key once but can run again, and the frame receives `recordsPending` (parser still running, or fragments still pending) plus `drainRecords`, letting a recordless occurrence wait one macrotask and classify with the record present.
- 40b05e1: One reveal owner for streamed document fragments (DR-4): the hydration
  runtime now keeps a fragment ledger — declarations are the serializer's
  `<id>_fr` records, settlement is seroval's status marks, reveals are the
  inline script's `_$HY.v` marks — published as `_$HY.fr` ({ pending,
  subscribe }). The frames client's document adoption reads "may a boundary
  still arrive" and learns of reveals from the ledger instead of scanning the
  page for `pl-*` templates and monkey-patching `_$HY.fe`. The ledger also
  detects truncation (#2958): a declaration still unsettled when the parser
  finishes is marked rejected with a truncation error, releasing its boundary
  through the normal rejection path instead of hanging on the fallback
  forever, and letting document-adoption waiters give up and mount fresh.
- 70d0da6: frames: keep waiting for a document boundary whose element is still held by a deferred fragment. `_$HY.done` stopped meaning "the page is complete" once post-done swaps became held-until-claimed (#2964) — a boundary rendering in that window mounted a fresh frame, orphaning the markup the replay then delivered, and left the id unclaimed so every later call resolved back to the document placeholder instead of fetching (a server-component region that never updates again). An unresolved `pl-*` placeholder now keeps the answer "not yet"; a reveal that exhausts the page's deferred fragments releases the waiter to mount fresh.
- 3ba6c86: Update dom-expressions to 0.50.0-next.36 (identity split, fragment reveal ledger, identity-first morph grafts, held recordless-occurrence classification) and drop the temporary local runtime link. With the runtime now re-checking a recordless adopted occurrence until records can no longer arrive, the frames integration's `recordsPending` answers the actual question — parser still running (`document.readyState === "loading"`) or fragments still pending — instead of borrowing `boundaryMayArrive()`'s `!_$HY.done` term: holding classification until client hydration completes pushed adopted mounts past the hydrate window, where the claim adopted markup the client's state had already moved past.
- ce60796: Update dom-expressions to 0.50.0-next.37. Serialized server-component references now self-bootstrap the `_$SC` registry — each hydration script's first reference carries it as an idempotent expression — so no integration needs to splice a bootstrap script into `<head>`. The old head-open splice (vite-plugin-solid) put a script ahead of the authored head elements, where the hydration walk claimed it as the first walked child and drifted every positional claim in the head by one (metas claimed as title, title as link), warning in dev and silently drifting in production. The compiler also picks up the directive-DCE fix for type-only import remnants (solid-start #2273): pruning the last value specifier out of a mixed import now removes the whole declaration instead of leaving a bare server-module edge in the client bundle.
- Updated dependencies [a60b288]
- Updated dependencies [40b05e1]
- Updated dependencies [15b512f]
  - solid-js@2.0.0-beta.31

## 2.0.0-beta.30

### Patch Changes

- 8c8b591: Emit early preload hints for `clientOnly` modules. The bundler's module-URL
  pass (the same one that annotates `lazy()`) now also annotates
  `clientOnly(() => import("x"))` calls, and the server half resolves the
  module's client assets through the manifest seam lazy uses, emitting plain
  link hints (`modulepreload` for js, stylesheet links for css) so the browser
  fetch starts on HTML arrival instead of when the client bundle evaluates the
  `clientOnly()` call. Deliberately not filed into the hydration asset map:
  the module is not required for hydration — the fallback is what hydrates —
  so mapping it would make the "preloaded before hydration" contract lie.
  Without an injected module URL (untransformed code) or an asset manifest,
  behavior is unchanged.
- 51f971b: Server-component boundaries that settle after the shell flush now mount (#2964). A boundary waiting on a pending streamed fragment registers as its claimant (`_$HY.fk`), so the fragment swap proceeds — or is held and replayed at registration — even after global hydration completes, instead of being discarded. The frames claim scope now also engages when a slot's server content is a pending fragment placeholder with no hydratable elements (a plain-text `Loading` fallback), so the deferred fragment resumes with hydration rather than falling through to a fresh client mount.
- 9cbdb85: Offer dynamic's previous component to the incoming one so same-function server components hand off the live mount

  When a `dynamic` call site's source resolves to a new server component for the same function under different arguments, the previous value is offered through the `COMPONENT_HANDOFF` contract before the swap: the mounted boundary rebinds to the new call and morphs in place instead of remounting, so client slot state (an expanded sidebar note while typing in search) survives argument changes. Async resolutions transform inside the source promise's own microtask via a transparent thenable — no added resolution hop — and a token guards superseded resolutions from handing off stale content.

- 4533813: Give invoked slot render props live, signal-backed props: the frames binding registers the runtime's `ctx.onUpdate` so a server morph that changes an occurrence's args updates the mounted component's props reactively instead of re-creating it — client state (expansion, focus) follows the entity across morphs and effects over changed args (e.g. a title flash) fire, matching compiled component semantics.
- Hand slot claims over from the enclosing hydration registry. `hydrate()`'s page-wide sweep gathers every `_hk` node including client slot roots inside server component frames, but adoption only ever claims them through its scoped registry — the root registry's copies survived to the end of hydration and every page load warned about "unclaimed" nodes that were claimed and live. The claim scope now removes its keys from the enclosing registry when it takes ownership of a range.
- c3fa949: Update dom-expressions to 0.50.0-next.35. Pulls in: live slot props (args changes rebind the mounted slot instead of re-creating it), call-site handoff for dynamic's live mount when a server component changes arguments, streamed-fragment reveals routed through the runtime reveal policy (`_$HY.f`) so late-arriving fragments are held for their claimant instead of discarded, and the morph fix that restores displaced slot ranges into wholesale-inserted parents (regrown list rows no longer render blank after clearing a search).
- Updated dependencies [51f971b]
- Updated dependencies [40af691]
- Updated dependencies [c3fa949]
  - solid-js@2.0.0-beta.30

## 2.0.0-beta.29

### Patch Changes

- 43039c8: Server-component boundary identity is now the call's intrinsic `(function, arguments)` address — per-args, exactly like the router's query cache, so a cached component always mounts the boundary showing the call it was cached for. Same-args refetches still resolve the identical component and morph in place (no remount through `dynamic`'s equals-gate); a source switching arguments swaps boundaries, re-materialized instantly from the frame host's retained state. This fixes hover preloads for other arguments morphing mounted content, and intermittently blank or stale pages when navigating back and forth between two routes inside the query cache's freshness window.
- 43039c8: The frames client bundle resolves the transport's wire-layer imports (server-function framing, addressing, response headers) to the external `@solidjs/web/server-functions/client` entry instead of bundling private copies — one copy of the framing code in an app, and the transport's flight consumer/codec reads are the shared built instance by construction (the getter-override seam is gone). Shrinks `frames/dist/client.js` by ~2.5 kB minified.
- 43039c8: Wire the frames single-flight protocol through `@solidjs/web/frames`: the server entry re-exports `frameTransformFlightResult` (install as `transformFlightResult` on the server-function handler — a mutation whose invalidated payload includes markup answers with regions + envelope in one frame-stream response), and single-flight delivery on the client reads the shared server-functions client instance by construction, since the frames bundle resolves the transport's wire-layer imports to that external entry.
- 0271a9d: Hoist SolidStart's remaining web-protocol pieces into `@solidjs/web`: `clientOnly`, the response primitives `httpStatus`/`httpHeader`, and the renamed `getServerFunctionInvocation` through the server-functions bridge.
  - **`clientOnly(() => import("./Comp"), { lazy? })`** (named export, both builds) wraps a dynamically imported component so it renders only in the browser: the server renders `props.fallback` and never starts the import, the client shows the fallback until load + mount and then swaps the real component in. Unlike `lazy()`, it avoids Suspense entirely and never server-renders the wrapped component, so it participates in no hydration asset manifest and its code is guaranteed to never run on the server; the mount gate keeps hydration mismatch-free. `{ lazy: true }` defers the import to the component's first render.
  - **`httpStatus(code, text?)` / `httpHeader(name, value, { append? })`** declare response status and headers during SSR for the lifetime of the calling reactive scope, writing to the request event's `response` head (core's `ResponseStub` shape, exposed by the integration via module augmentation — no framework event required). They're scope-tied _declarations_, not mutations — "while this reactive scope is live, the response has this status/header" (Solid reserves `set*` verbs for event-time mutation): call them bare in component/reactive-scope bodies like `createSignal`/`onCleanup`, including behind an `if`, and they un-declare on scope disposal. Retraction semantics fix two SolidStart reference bugs: writes snapshot the prior value at write time and restore it on disposal — a 404 page whose inner boundary recovers stays a 404 instead of being stomped back to 200, and header retraction is an exact revert instead of the reference's broken comma-splitting (split `", "`, join `","`). Both writes and retractions are no-ops once the integration marks the response head `committed` (head derived/sent — `response.committed`, not a flag on the event). On the client the primitives are no-ops. Core ships the functions only — no `<HttpStatusCode>`/`<HttpHeader>` JSX components; Start may provide component wrappers for compatibility, but the primitives are the API.
  - **`getServerFunctionInvocation`** (and its `ServerFunctionInvocation` type) re-export through `@solidjs/web/server-functions`, replacing `getServerFunctionMeta` — the rename resolves the near-collision with `getServerFunctionMetadata(fn)` (static declaration metadata) versus this accessor's info about the call in flight. Clean rename, no back-compat alias.

  Requires the next `@dom-expressions/runtime` release (the `ResponseStub`/`committed` response-head contract and the invocation rename land there).

- 11beaf4: Context barrier at server-component render roots. A server component renders inline in the document at t=0 but standalone on every refetch and mutation region, so an app-context read that resolved a provider at t=0 would silently break on the next response. `runInServerComponentScope` rebuilds the scope owner's context record so both renders agree by construction: user context is severed (default-less `useContext` throws an error explaining the boundary; defaulted contexts read their default), providers rendered inside the server component work normally, and boundary plumbing (`ErrorContext`, `RevealGroupContext`, `NoHydrateContext`) still crosses — Loading/Errored/reveal coordination between server-component content and enclosing boundaries is intentional. Client slot positions are unaffected: they re-enter the zone owner captured outside the barrier, keeping full app context during document SSR.
- 93ea8a1: Update dom-expressions to 0.50.0-next.34. Pulls in: single-flight for frames (`frameTransformFlightResult`, flight codec, per-frame versioning and outcome chunks), per-args boundary identity with host retention so cached server-component calls re-materialize instantly and never collide across argument sets, the server-component context barrier hook, keyed slot ranges relocating correctly across parents during morphs, a frame-client size pass, and the typed `transformFlightResult` seam.
- Updated dependencies [11beaf4]
- Updated dependencies [93ea8a1]
  - solid-js@2.0.0-beta.29

## 2.0.0-beta.28

### Patch Changes

- 8b20c1a: Export a `Slot<P>` type from `@solidjs/web/frames` for typing server-component client positions.

  A server component describes its client positions as props the server renders where client-owned markup belongs. Typing those by hand meant restating the client component's shape and adding `$key` to it, which pushed apps toward wrapper types per component. `Slot<P>` takes the client component's own props and adds the optional `$key`, so the hole is described with the same type that fills it:

  ```ts
  type ToggleSlot = Slot<ComponentProps<typeof Toggle>>;
  ```

  The type is exported from both halves of the subpath — server components are authored in universal code, so it has to resolve under the browser condition too. It is type-only, so nothing crosses into the client bundle.

- Update `@dom-expressions/runtime` to 0.50.0-next.33. The server function handler now pre-digests the single-flight outcome before invoking `collectFlightData` — `targetUrl` (the URL the client will show after the mutation, origin-checked), `revalidateKeys` (the outcome's `X-Revalidate` keys, split), and `foldedHeaders` (request headers with the mutation's `Set-Cookie` effects applied) arrive on the outcome, so integrations only supply the data strategy. Raw body-carrying `Response` values skip collection entirely. Adds `decodeResponsePayload` beside `decodeResponse` for splitting the single-flight envelope on manually opted-in calls.
  - solid-js@2.0.0-beta.28

## 2.0.0-beta.27

### Patch Changes

- 2a38f8a: Adopt @dom-expressions/runtime 0.50.0-next.32, which absorbs the router-agnostic wire protocols from Solid Router. Through the `server-functions` entries this adds: the flash cookie protocol (`FLASH_COOKIE`/`hasFlashCookie`/`clearFlashCookie` on both entries; `encodeFlashCookie`/`decodeFlashCookie` and the `FlashSubmission` shape on the server entry), `foldSetCookies` for replaying a mutation's `Set-Cookie` deltas onto request headers, `REVALIDATE_HEADER` as a named export next to the response helpers that write it, and `createNoJSHandler` — which `handleServerFunctionRequest` now applies to browser form posts by default, so form posts made without the client runtime redirect back with the outcome flashed instead of answering with a serialized payload (configure or disable via `handleNoJS`). Also fixes a thrown bodyless `Response` being nulled before reaching `handleNoJS`, which silently dropped the redirect target.
- 76cb1aa: Fix `dynamic()` and `lazy()` gating the SSR shell flush instead of suspending into their boundary

  Both registered their source promise as a renderer-blocking promise, so the document's first flush waited on it. An enclosing `<Loading>` never rendered its fallback and a slow source stalled the entire document — a 500ms server component pushed the shell from 27ms to 527ms with nothing streamed, and an un-preloaded `lazy()` held the shell for the full module load.

  The pending read now simply suspends, letting the nearest boundary own it and stream the content in behind its placeholder. Where there is no boundary to defer to the read becomes a root hole and the renderer blocks the shell on it as before, so a bare `dynamic()` or `lazy()` still resolves inline. Near-instant sources and preloaded modules continue to inline with no fallback flash.

  For `lazy()` this does not affect asset ordering: `assetsPending` gates the render memo separately, so a fragment still cannot flush before its styles and module map are registered.

  Also adds an internal `serialize: false` option to the server `createMemo`, which keeps a value out of the hydration payload while the subtree still hydrates normally (unlike `NoHydrateContext`, which opts the subtree out entirely and suppresses the id allocation needed for client parity). It carries the contract that the client recomputes the value. This lets the server `dynamic()` drop its hand-rolled promise tracking and mirror the client's two-memo shape, since its resolved value is a component function that must never cross the wire.

- 919a081: Frames: gather hydration-claim registries without descending into nested regions

  `claimRender` built each occurrence's registry with `querySelectorAll("*[_hk]")` over its existing nodes, which descends into nested `<dx-frame>` regions — content that belongs to nested occurrences running their own claims. On a deeply nested adopted tree (an HN comment thread) every level re-collected its entire subtree, making registry gathering O(nodes × depth). The registry is now gathered by a walk that treats region elements as opaque, so the total work across all claims is linear in the tree.

- 137e5ec: Adopt server-component boundaries that arrive after the shell flush. A boundary was looked up in a one-time `[data-fid]` snapshot of `document.body`, and a miss immediately mounted a fresh client frame. That decision is unrecoverable, and it was wrong for every server component whose source settles after the shell flush: the producer emits the resolver script (`$R[n](…, self._$SC.r(id))`) ahead of the markup, so the placeholder mounts while the boundary element is still in flight — on a live feed the shell flushes with a few hundred bytes of body, and the markup follows after `</html>` inside the reveal template. The server's markup then landed owned by nothing, visible but inert, while the stream drove an element outside the page: the boundary never updated again, so every navigation into it fetched correctly and changed nothing, and route changes left the orphan behind, stacking the old route's DOM under the new one.

  A miss while the document is still streaming now means "not yet" rather than "never": the boundary suspends — the enclosing `<Loading>` goes on showing the server's fallback, which is what the page is already displaying — and adopts the element when the reveal delivers it. Reveals are picked up from `_$HY.fe`, which the streaming layer already calls on every swap, wrapped rather than overwritten so other consumers keep working; when the producer passes the revealed fragment's parent, the rescan is scoped to what just arrived. Client-only boots are unchanged (no `_$HY`, or the document is done → mount fresh), and the index now skips nested region ids, which keeps it at a handful of entries instead of one per region.

- Updated dependencies [76cb1aa]
- Updated dependencies [17b0afb]
  - solid-js@2.0.0-beta.27

## 2.0.0-beta.26

### Patch Changes

- 685d597: Bump dom-expressions to 0.50.0-next.30. Picks up the hydration fix for streamed `<Loading>` fallbacks (#2936): a pending boundary's placeholder scaffolding (`<template id="pl-X">` and its `<!--pl-X-->` end comment) is now excluded from hydration claim arrays, so a reactive text hole in the fallback adopts the server-rendered node and updates replace it in place instead of appending debris.
- 144801e: Fix frames types build on fresh installs: map bare `@solidjs/web` in `frames/tsconfig.build.json` paths (alongside the existing server-functions/client mapping). The insert-dedup change imports `insert` from `@solidjs/web`, which fails under NodeNext without the package self-link that only local `link` checkouts have.
- b29ca0a: Adopt the element-based frame seams from `@dom-expressions/runtime`: a server-component boundary is now a client-owned `<dx-frame>` element rather than a branded comment-marker range. `boundaryComponent` uses `createFrameElement` and returns the element (which `insert` places natively in any position, fixing the array/fragment crash class), and `documentBoundary` adopts the SSR'd boundary element via `createFrame(el, { adopt: true })`, located by a single `[data-fid]` attribute query instead of a comment-pair TreeWalk. The occlusion drain, hydration-claim scoping, and stable-component transport policy are unchanged. Requires `@dom-expressions/runtime` with the element seam (`createFrameElement`/`FRAME_ID_ATTR`, `createFrame` adopt option); `createFrameInsertable`/`adoptFrameRange` are gone.
  - solid-js@2.0.0-beta.26

## 2.0.0-beta.25

### Patch Changes

- fc6cbaf: Fix the packaged frames client shipping without its transport half. `frames/dist/client.js` bundled a PRIVATE copy of the server-function client; because the frames entry never calls that copy's readers, rollup concluded the `configureServerFunctionsClient({ responseHandler: ... })` write inside `installServerComponents` was unobservable and tree-shook the entire call out of the artifact — published beta.23/24 could adopt document boundaries but never installed the frame-stream transport (t=0 intercept, refetch morphs, fresh boundaries all dead). The private copy was a correctness hazard even without the shake: its module-scoped config would never be seen by the compiled reference proxies, which call through `@solidjs/web/server-functions`. The frames client now imports `@solidjs/web/server-functions/client` and keeps it external, so the dist configures the same built instance the proxies resolve to, and a build-time assertion (`assertFramesClientTransport` in rollup.config.js) fails the frames build if the transport wiring ever drops out of the emitted chunk again.
- e654a59: Fix the frames types build: `types:copy-frames` expected compiled declarations at `frames/types/` that no step ever generated, breaking `pnpm types` (and CI builds). Frames declarations now compile via a dedicated `frames/tsconfig.build.json` (mirroring the storage submodule), and the published `types/frames` facades get their bundled `@dom-expressions/runtime` specifiers rewritten to relative paths so they resolve against the runtime d.ts files shipped alongside them.
  - solid-js@2.0.0-beta.25

## 2.0.0-beta.24

### Patch Changes

- f9a1e63: Frames: hydration claims are now gated to the adoption attach
  (`ctx.adopted`) — a stream-driven re-call of an adopted occurrence renders
  for real instead of claiming, so content the re-call displaces (moved-out
  `{$frame}` region ranges) is re-placed rather than silently dropped
  (dom-expressions#547).
  - solid-js@2.0.0-beta.24

## 2.0.0-beta.23

### Patch Changes

- 6c95f60: **Experimental — `@solidjs/web/frames`: server components.** Shipping as
  an experimental preview alongside Solid 2.0: the subpath, its API, and the
  underlying wire format are NOT covered by 2.0's stability guarantees and
  may change between prereleases. Expect a separate stabilization
  announcement.

  There is deliberately no new component API. A server component is a
  function returned from a server function, and `dynamic` is how you use it:

  ```tsx
  const getStory = /* "use server" fn returning (props) => JSX */;

  function StoryPage(props) {
    const Story = dynamic(() => getStory(props.storyId));
    return (
      <Story comment={(p) => <CollapsibleComment cid={p.cid}>{p.children}</CollapsibleComment>}>
        <ShareBar />
      </Story>
    );
  }
  ```

  Server content streams as HTML and morphs in place across refetches —
  client components inside it (and their state: focus, inputs, toggles)
  survive navigation. Nothing ships twice: no serialized component trees, no
  hydration data for server content, and at t = 0 the server-rendered
  document is adopted (zero requests at boot; wrappers claim their
  server-rendered DOM by hydration key). Content the client didn't render at
  SSR (e.g. collapsed threads) ships once as data and mounts later with zero
  network.

  Surface:
  - client: `installServerComponents()` (call once in the client entry),
    `getFrameHost`, and the frame/transport primitives routers build on
    (`applyFrameResponse`, `FRAME_APPLIED_EVENT`, `adoptFrameRange`,
    `createServerComponentHandler`). Server-component anchors/forms
    participate in the element-claim contract, so router link state works on
    server content unchanged.
  - server (`@solidjs/web/frames/server`): `frameTransformResult` /
    `frameTransformDirectResult` — install on the server-function handler
    and document SSR respectively — plus `renderServerComponent`,
    `renderToFrameStream`, `serverComponentResponse`, `createFrameSink`, and
    the document-shell pieces (`ServerComponentPlugin`,
    `SERVER_COMPONENT_BOOTSTRAP`).

  See `examples/hackernews` (and its SSR-SPA twin, the measured comparison)
  and dom-expressions' `docs/server-components.md`.

- Updated dependencies [6c95f60]
  - solid-js@2.0.0-beta.23

## 2.0.0-beta.22

### Patch Changes

- solid-js@2.0.0-beta.22

## 2.0.0-beta.21

### Patch Changes

- e88e2de: Bridge the settled server-function extension surface through `@solidjs/web/server-functions`: `GET(fn)`, the declaration-metadata channel (`withMeta`, `getServerFunctionMetadata`, `isServerFunction`), and the `prepareRequest` client hook — and drop the legacy per-reference `.GET`/`.withOptions` escape hatches (beta, no compatibility shims).
  - **`GET(fn)`** declares a server function callable over HTTP GET (arguments codec-encoded in the query string, cacheable URLs). Both environment halves export it: the browser build's returns the GET-transport callable, the server build's is identity-flavored (SSR stays in-process) and records the declaration so the handler answers 405 when the request method contradicts it. Function-level `"use server"` directives round-trip the wrapper call, so `export const getUser = GET(async (id) => { "use server"; ... })` needs no compiler support.
  - **`withMeta(fn, meta)`** attaches arbitrary user-declared transport metadata to a reference through the same channel and returns it, shallow-merging later writes; it composes with `GET` in either order. `getServerFunctionMetadata(fn)` reads the merged bag and `isServerFunction(fn)` is the structural guard — both detect by a registered-symbol brand, so they work across the separately bundled client/server entries; routers use them instead of property sniffing.
  - **`prepareRequest(init, { id, meta })`** on `configureServerFunctionsClient` (with the exported `PrepareRequestHook` type) runs before every outgoing server-function fetch — session-dynamic transport policy like OAuth bearer tokens, keyed per-function through `withMeta` declarations rather than id comparisons.
  - References keep the callable, `url`, and now expose `id` on both sides; `.GET` and `.withOptions` are gone — session-dynamic uses go through `prepareRequest`, and single-flight opt-in is already automatic via `subscribeFlightData`.

- 51de4f3: Bridge the single-flight mutation protocol through `@solidjs/web/server-functions`.

  Pulls in dom-expressions' generic single-flight protocol: on the server, `configureServerFunctionsServer({ collectFlightData })` (or the per-handler `collectFlightData` option on `handleServerFunctionRequest`) registers the hook that produces a data payload from a call's outcome — the handler folds it into the response as the standardized `{ value, data }` payload under the `X-Single-Flight` header. On the client, `subscribeFlightData(consumer)` registers the consumer the fetch transport delivers `data` to (with the response as envelope context — redirect location, revalidation keys) before returning `value` to the caller; the registration is universal, exported from both halves of the subpath, since routers are universal code. The flight-data types (`SingleFlightPayload`, `FlightDataConsumer`, `FlightDataContext`, `CollectFlightDataHook`, `ServerFunctionOutcome`) and `SINGLE_FLIGHT_HEADER` ride the copied type surface. Without a hook or consumer, behavior is byte-identical to before.

- Updated dependencies [b1b2f82]
- Updated dependencies [a79f974]
- Updated dependencies [e3d5fed]
- Updated dependencies [c4fad7a]
  - solid-js@2.0.0-beta.21

## 2.0.0-beta.20

### Patch Changes

- Updated dependencies [729a5e1]
- Updated dependencies [ff5c321]
- Updated dependencies [bbc5ac8]
- Updated dependencies [a24a4de]
- Updated dependencies [c7bb2c8]
- Updated dependencies [9f27cdf]
  - solid-js@2.0.0-beta.20

## 2.0.0-beta.19

### Patch Changes

- 32996e8: Add the server function runtime ABI as `@solidjs/web/server-functions` and the response helpers on the core entry.

  The `server-functions` subpath resolves per environment like the main entry: the browser condition gets the fetch transport (`createServerReference(id)` producing the client callable with the `url`/`GET`/`withOptions` surface, `configureServerFunctionsClient` for the endpoint and codec), while node/worker/deno get registration (`registerServerReference`, `registerServerFunction`, `getServerFunction`), the SSR in-process callable (`createServerReference(reference)`), and the web-standard `handleServerFunctionRequest(request, options) => Response` handler with `createEvent`/`provideEvent`/`transformResult`/`handleNoJS` hooks for integrations. Compiled `"use server"` output (vite-plugin-solid) targets this module as its runtime. Event scoping defaults to the AsyncLocalStorage that `@solidjs/web/storage`'s `provideRequestEvent` parks on `globalThis[RequestContext]` — now a registered symbol so the separately bundled entries agree.

  The response helpers (`redirect`, `reload`, `respond`, plus `ResponseEnvelope`/`isResponseEnvelope`) export from the core `@solidjs/web` entry — both client and server builds, one import site regardless of usage. They construct plain `Response` objects carrying the protocol signals (`Location`, `X-Revalidate`, statuses); client-only actions return them and the integration interprets the Response in memory, while server functions return (or throw) the same objects and the HTTP handler forwards their metadata. `respond(value, init)` — `json()` from SolidStart/Solid Router, renamed for what it actually does: pair a value with the response metadata a naked return can't express. Progressive enhancement stays invisible: the carried response holds a plain JSON body so consumers without the client runtime (no-JS form posts, direct HTTP) get real JSON, while integrations read `value` with no reparse. Envelope detection uses a registered-symbol brand so identity survives the separately bundled entries.

- cded919: Bump dom-expressions to next.22. Beyond the server-functions runtime, the bundles pick up a deduplicated `DOMElements` set (~1 KB minified for consumers that retain it) and hydration-time insert/event behaviors moved behind a runtime slot installed by `hydrate()`, so client-only bundles tree-shake them.
- Updated dependencies [d94d5c3]
- Updated dependencies [d0b9c91]
  - solid-js@2.0.0-beta.19

## 2.0.0-beta.18

### Minor Changes

- 9b4dd76: Add the `@solidjs/web/serialization` subpath exposing the runtime's Seroval serialization primitives: `createSerializer`, `DEFAULT_WEB_PLUGINS`, and `resolveSerializerPlugins` for the shared web plugin configuration, plus the isomorphic JSON codec (`serializeJSON` / `createJSONDeserializer`) for RPC-style transports such as server functions. The entry is opt-in — browser bundles only include it when imported, like `@solidjs/web/storage`. The seroval dependency floor moves to `~1.5.4` (1.5.3 and earlier carry a security issue; the codec also relies on `depthLimit` support).

### Patch Changes

- 9b4dd76: Bump dom-expressions to next.21 with the streamed fragment comment-scan fix and the reusable serializer/JSON-codec module backing the new `serialization` entry
- 43c537a: Emit `@solidjs/web/storage` types at the advertised path (#2873)

  The storage tsbuild used `rootDir: ".."`, so declarations landed at
  `storage/types/storage/src/index.d.ts` while package.json advertised
  `storage/types/index.d.ts`, breaking consumers of `@solidjs/web/storage`
  (e.g. solid-start). The build now resolves `@solidjs/web` against the built
  declarations and emits directly to `storage/types/index.d.ts`.

- 4a1d997: Portal no longer crashes SSR — portals are client-only islands (#2876)

  The server renders nothing for a `<Portal>`: children are never evaluated, no
  async starts, and nothing is serialized. Throwing (as earlier betas did) was
  caught by ancestor `Errored` boundaries and baked the error fallback into the
  streamed HTML for trees that render fine client-side.

  Both sides advance the parent's child-id counter by exactly one slot — the
  client scopes the portal's internals under a dedicated owner and the server
  consumes the matching id — so hydration ids for siblings after a portal stay
  aligned.

  On the client, the portal's content memo and effects are gated with
  `ssrSource: "client"`, so under hydration the children render fresh in the
  settle flush — no evaluation during the hydration walk, no effect-type
  switching (the 1.x timing hack). Async discovered inside a portal after
  settle forwards through already-initialized ancestor boundaries as ordinary
  pending status, so nothing regresses to a fallback; the portal simply attaches
  when its content is ready.

- 8ca127d: Update dom-expressions to 0.50.0-next.19. Pulls in resolver manifests: the
  `manifest` option of `renderToString`/`renderToStream` now also accepts
  `{ resolve(key), resolveSync?(key) }` (or a bare function) as an alternative
  to a static manifest object, so dev servers can answer asset lookups from
  their live module graph. `resolve` may return a promise and may resolve CSS
  entries to inline-style descriptors (`{ id, content, attrs }`) for HMR
  adoption; `resolveSync` is exposed on the render context as
  `resolveAssetsSync` for sync consumers like `lazy()`'s `moduleUrl` getter.
  Also picks up an internal perf refactor of root-level insert cleanup
  (foreign-sibling detection via O(1) pointer checks).
- Updated dependencies [500d484]
- Updated dependencies [7d21226]
- Updated dependencies [1b94264]
- Updated dependencies [9b4dd76]
- Updated dependencies [1561c7e]
- Updated dependencies [4e67d45]
- Updated dependencies [8ca127d]
  - solid-js@2.0.0-beta.18

## 2.0.0-beta.17

### Patch Changes

- Updated dependencies [928ba28]
- Updated dependencies [25a5685]
- Updated dependencies [fe9ed90]
- Updated dependencies [4cc6113]
- Updated dependencies [9b883e0]
  - solid-js@2.0.0-beta.17

## 2.0.0-beta.16

### Patch Changes

- 5dd2949: Update dom-expressions to 0.50.0-next.15 under the new `@dom-expressions` npm scope (`@dom-expressions/runtime`, `@dom-expressions/babel-plugin-jsx`, `@dom-expressions/hyperscript`, `@dom-expressions/tagged-jsx`). Includes the upstream fix where awaited `renderToStream` now waits out blocked root holes (#2779) and the server `mergeProps` sourcing fix (#2815). `@solidjs/html`'s runtime shim follows the upstream SLD → Tagged JSX rename (`createTaggedJSXRuntime` / `TaggedJSXInstance`).
- be9a07a: Server `dynamic()` now supports Promise sources (#2779). A Promise component/tag source previously fell through the sync function/string checks and rendered nothing. It now follows `lazy()`'s SSR contract: block async renderers and throw `NotReadyError` from a sync memo until the promise lands, so the streaming engine captures the position as a retry hole. Requires `@dom-expressions/runtime` 0.50.0-next.15, where awaited `renderToStream` waits out blocked root holes.
- 06e45e8: Fix `Portal` stranding one empty text node in its mount target per unmount: the cleanup removed the nodes in `[startMarker, endMarker)` but never `endMarker` itself, which the same effect run had appended. Toggling a Portal (the modal open/close pattern) accumulated one node per cycle, unbounded — invisible to `innerHTML` checks but breaking `:empty` selectors and `childNodes` counts on the mount target. The removal range is now inclusive of `endMarker`.
- 098876d: Fix hydration key mismatches when async holes defer past eager siblings
  (#2801 bug 2). New `ssrScope` (server): reserves one hydration id slot at
  registration and evaluates the hole — including async retries — under the
  reserved id with a zeroed child counter (a virtual scope in the style of
  mapArray's row-owner elision, so no owner allocation on the hot path). On
  the client, `@solidjs/web`'s `effect` wrapper now honors a `scope: true`
  option (set by the dom-expressions `insert` for compiler-tagged hole
  accessors) that makes the outer insert render effect non-transparent, giving
  the same hole its own id scope. Hole content ids gain one nesting level
  identically on both sides, so deferral timing can no longer shift sibling
  hydration keys.
- f6a3540: Update dom-expressions to 0.50.0-next.16. Pulls in: per-slot insertion markers so adjacent expression slots no longer destroy nodes migrating between them (#2830), delegated events reaching outer roots across nested render roots (#2832), recovery from module preload failures during hydration plus manifest asset URL normalization (#2817), non-destructive style object diffing with explicit-undefined removal (#2828), preserved JS value semantics for wrapped `&&` conditions, and the hole id scope hydration fixes (#2801).
- Updated dependencies [4b5272f]
- Updated dependencies [f8f992d]
- Updated dependencies [f658824]
- Updated dependencies [088f97e]
- Updated dependencies [4608539]
- Updated dependencies [f14e3e3]
- Updated dependencies [8b6c298]
- Updated dependencies [5bc9080]
- Updated dependencies [0e8672a]
- Updated dependencies [1458907]
- Updated dependencies [098876d]
- Updated dependencies [f6a3540]
  - solid-js@2.0.0-beta.16

## 2.0.0-beta.15

### Patch Changes

- a5d15f6: Fix Portal mount timing so earlier sibling refs can be used as Portal targets.
- 2c0a336: Rewrite `Portal` mounting: pass the real mount element to `insert` with the new `host` option instead of a `Proxy` wrapper, and run the insert in an owner-parented root that is disposed on mount change or Portal disposal. Fixes portal content accumulating on keyed swaps (#2757), `NO_OWNER_EFFECT` leaks from scheduled portal effects (#2758), and event retargeting for nodes inserted through replace paths.
- Updated dependencies [8402421]
- Updated dependencies [f083220]
- Updated dependencies [98a7385]
- Updated dependencies [c943c5c]
- Updated dependencies [4f14a34]
- Updated dependencies [bff4c21]
- Updated dependencies [52255dc]
  - solid-js@2.0.0-beta.15

## 2.0.0-beta.14

### Patch Changes

- adbdab3: Bump dom-expressions and babel-plugin-jsx-dom-expressions to 0.50.0-next.12.

  This picks up root-owned delegated event targeting: `render()` and `hydrate()` own delegated listeners for their root containers while compiler-emitted `delegateEvents([...])` declares only the delegated event names needed by compiled JSX.

- 153e80f: Bump dom-expressions and babel-plugin-jsx-dom-expressions to 0.50.0-next.13.

  This picks up the following runtime/compiler updates:
  - **Slot-owned node tagging** (resolves solidjs/solid#2030, solidjs/solid#2357): a single DOM node referenced from multiple JSX slots, or wrapped into a new slot's value between renders, no longer crashes `replaceChild` with "new child contains the parent" or vanishes during sibling-slot cleanup. Each runtime insertion now tags the inserted node with a per-slot symbol; destructive operations are gated on parent-and-tag ownership so foreign refs and migrated nodes are left alone. DOM renderer only.
  - **Init-throw scope cleanup**: when a user's render function (or anything inside `render()` / `hydrate()` init) throws, the partial render scope is now disposed instead of being orphaned, preventing leaked effects and stale subscriptions after a failed mount.
  - **Event-listener helper rename**: the compiler-emitted runtime helper that was previously `addEventListener` is now `addEvent`, avoiding the name collision with the native `EventTarget.addEventListener`. Compiler output reflects the new name automatically; runtime/userland code that imported `addEventListener` from `@solidjs/web` should switch to `addEvent`.
  - **JSX namespace cleanup**: previously tolerated `class:foo` and `style:foo` namespace syntax no longer gets special handling — both fall through to literal HTML attributes. Use `class={{ ... }}` for class toggles and `style={{ ... }}` for style properties.
  - **Static JSX marker**: the `/*@once*/` marker is removed from Solid's public JSX model. The compiler still recognizes a renamed `/*@static*/` marker for low-level cases (e.g. compiler internals), but Solid 2.0 guidance is to use normal reactive JSX, `defaultValue` / `defaultChecked` for DOM initial state, and `untrack` for intentional one-time JavaScript reads — not a marker-based replacement.

- adbdab3: Portal now participates in root-owned delegated events by registering outside-root mount points as listener containers for the owning render root.
- Updated dependencies
  - solid-js@2.0.0-beta.14

## 2.0.0-beta.13

### Patch Changes

- 4404f9f: Add an opt-in `isPending(fn, true)` render guard mode that lets pending reads follow the Loading path.
- 6fec663: Remove `on:` namespace event typings and document ref callbacks for native listener options.
- Updated dependencies [157dfe2]
- Updated dependencies [4404f9f]
- Updated dependencies [6fec663]
  - solid-js@2.0.0-beta.13

## 2.0.0-beta.12

### Patch Changes

- Updated dependencies [b964dc7]
- Updated dependencies [0a7c278]
- Updated dependencies [1c5cc7c]
- Updated dependencies [1833f14]
- Updated dependencies [12f15a2]
  - solid-js@2.0.0-beta.12

## 2.0.0-beta.11

### Patch Changes

- e16371f: Performance: add `CONFIG_SYNC` opt-in for sync-only computeds/effects. New `sync?: boolean` option on `MemoOptions`/`EffectOptions` skips the async-shape probe in `recompute` for nodes that provably never return Promise/AsyncIterable. Compiler-emitted `_$effect` and `_$memo` (via `@solidjs/web`'s `effect`/`memo` wrappers) opt in by default — `01_run1k` mean −0.62 ms and `08_create1k-after1k_x2` mean −0.80 ms in `js-framework-benchmark`. User-authored `createMemo`/`createEffect`/`createRenderEffect` keep full async-aware behavior unless they explicitly pass `sync: true`. Returning a Promise from a `sync: true` node throws `SYNC_NODE_RECEIVED_ASYNC` in dev (production silently stores the unawaited value, by contract).

  Correctness: `flush(fn)` now drains at every nesting level instead of only the outermost. Nested `flush(fn)` calls each honor their own contract — writes inside an inner `flush(fn)` propagate before it returns, rather than being held until the outer `flush(fn)` exits. Microtask scheduling and arg-less `flush()` are unchanged. Code that depended on the old hold-until-outermost behavior should switch to a harness-layer depth counter (see `js-reactivity-benchmark`'s `r3` / `r3-solid-target` adapters for the pattern).

- Updated dependencies [95ca987]
- Updated dependencies [cb04b8e]
- Updated dependencies [b0db6c9]
- Updated dependencies [47c0e6f]
- Updated dependencies [263be3f]
- Updated dependencies [59d84ba]
- Updated dependencies [80b4e8d]
- Updated dependencies [d2529e3]
- Updated dependencies [80b4e8d]
- Updated dependencies [80b4e8d]
  - solid-js@2.0.0-beta.11

## 2.0.0-beta.10

### Patch Changes

- 59dd11f: Docs prep for the 2.0 reference auto-generation pass: backfill JSDoc examples on previously-undocumented public APIs (`getObserver`, `isDisposed`, `createRenderEffect`, `onCleanup`, `createErrorBoundary`, `createLoadingBoundary`, `createRevealOrder`, `flatten`, `enableExternalSource`, `NotReadyError`, `NoHydration`, `Hydration`, `isServer`, `isDev`); normalize inline JSDoc code fences to `@example` tags on the JSX components (`<For>`, `<Repeat>`, `<Switch>`, `<Errored>`, `<Reveal>`, `dynamic`, `<Dynamic>`); and tag cross-package wiring / compiler-emitted exports with `@internal` so the doc generator can hide them from the user-facing surface (`getContext`, `setContext`, `createOwner`, `getNextChildId`, `peekNextChildId`, `enforceLoadingBoundary`, `sharedConfig`, `enableHydration`, `NoHydrateContext`, `$DEVCOMP`, `$PROXY`, `$REFRESH`, `$TRACK`, `$TARGET`, `$DELETED`, `ssr*` helpers, `escape`, `resolveSSRNode`, `mergeProps`, `ssrHandleError`, `ssrRunInScope`). Also extends the `equals` field JSDoc on `SignalOptions` / `MemoOptions` to mention `isEqual` as the default.
- Updated dependencies [59dd11f]
- Updated dependencies [e841f8c]
- Updated dependencies [a93a216]
- Updated dependencies [cf92b55]
- Updated dependencies [2a7c6a5]
  - solid-js@2.0.0-beta.10

## 2.0.0-beta.9

### Patch Changes

- d8d8c95: Reshape `createDynamic` into a `dynamic` factory.

  `createDynamic(source, props): JSX.Element` is replaced by `dynamic(source): Component<P>` — a `lazy`-style factory returning a stable component whose identity is driven by a reactive (and optionally async) source. `source` may return `null | undefined | false` to render nothing, so `() => cond() && Comp` works directly.

  ```tsx
  const Active = dynamic(() => (isEditing() ? Editor : Viewer));
  return <Active value={value()} />;
  ```

  The `<Dynamic component={...}>` JSX wrapper is unchanged at the call site; it now delegates to `dynamic` internally. Direct callers of `createDynamic(source, props)` should use `<Dynamic>` or `createComponent(dynamic(source), props)`.

- d31b3c6: Simplify `render` wrappers and give custom universal renderers deferred top-level mount.

  `@solidjs/web`'s `render()` is now a thin wrapper around `dom-expressions`' `render` — it threads `{ insertOptions: { schedule: true } }` through the new `insertOptions` seam (added in `dom-expressions@0.50.0-next.2`), scopes the `ASYNC_OUTSIDE_LOADING_BOUNDARY` dev window, and tail-flushes the queue. No behavioral change for end users; the local `createRoot` / `flatten` / `insert` plumbing that was inlined in the previous commit has moved back into `dom-expressions`.

  `@solidjs/universal` is no longer a pure re-export of `dom-expressions/src/universal.js`. It wraps `createRenderer` so the returned `render(code, element)` does `createRoot` + `insert(..., { schedule: true })` + tail `flush()`. Every custom universal renderer now inherits the same permissive top-level async semantics as `@solidjs/web`, without having to rewrite its own `render`.

- Updated dependencies [9015b12]
- Updated dependencies [fb2e43b]
- Updated dependencies [845b6bb]
- Updated dependencies [23f7550]
- Updated dependencies [8b9c5bf]
- Updated dependencies [9015b12]
- Updated dependencies [c324d2c]
- Updated dependencies [4620612]
- Updated dependencies [f7d5af6]
- Updated dependencies [c324d2c]
- Updated dependencies [c324d2c]
- Updated dependencies [3ee92f3]
- Updated dependencies [0ef177e]
- Updated dependencies [9015b12]
  - solid-js@2.0.0-beta.9

## 2.0.0-beta.8

### Patch Changes

- 34c65b8: CSR: async reads without a `Loading` ancestor no longer throw. The root mount now participates in transitions — when uncaught async surfaces during initial render, the root DOM attach is withheld until all pending settles and then attaches atomically. On the no-async happy path, `render()` still attaches synchronously before returning (via an internal tail `flush()`).

  **New `schedule` option on effects**

  `@solidjs/signals` exposes a new `schedule?: boolean` option on `EffectOptions`. When `true`, the initial effect callback is enqueued through the effect queue (the same path user effects already take) instead of running synchronously at creation. This lets the initial run participate in transitions — if any source bails during the compute phase, the callback is held until the transition settles.

  ```ts
  createRenderEffect(
    () => source(),
    v => {
      /* runs after flush, deferred by any pending transition */
    },
    { schedule: true }
  );
  ```

  `@solidjs/web`'s `render()` uses this option internally for its top-level insert, which is what enables permissive top-level async in CSR.

  **Dev diagnostic**

  `ASYNC_OUTSIDE_LOADING_BOUNDARY` is now a non-halting `console.warn` (severity downgraded from `error` to `warn`). With deferred-mount the runtime is correct; the diagnostic is an informative FYI rather than a correctness failure. The warning only fires during the synchronous body of `render()` / `hydrate()` — post-mount transitions (including lazy route changes) run under their own transitions with the guard off and do not emit this warning.

  Placing a `Loading` boundary remains the right tool when you want explicit fallback UI or partial progressive mount.

  **Known limitation: multi-phase async**

  Multi-phase async flows — for example, a `lazy()` component whose resolved body reads a second pending async memo — may still reveal partial DOM between waves. This is because the scheduler currently nulls `activeTransition` before running the completing flush's restored queues; a new transition started by recomputes during that phase does not re-stash already-restored callbacks. Single-wave nested async (including static siblings alongside a pending descendant) commits atomically. The multi-phase case is tracked as a follow-up; the recommended workaround today is to place a `Loading` boundary around multi-phase async subtrees.

- Updated dependencies [34c65b8]
- Updated dependencies [ed2079f]
- Updated dependencies [2597a4a]
- Updated dependencies [00c3f78]
- Updated dependencies [d46928f]
- Updated dependencies [000da61]
- Updated dependencies [2e4a924]
- Updated dependencies [ac0067a]
- Updated dependencies [ac0067a]
  - solid-js@2.0.0-beta.8
  - @solidjs/signals@2.0.0-beta.8

## 2.0.0-beta.7

### Patch Changes

- Updated dependencies [76b11b2]
- Updated dependencies [5869c94]
- Updated dependencies [3242e50]
- Updated dependencies [f18780e]
- Updated dependencies [ea7f892]
- Updated dependencies [5acf0ee]
- Updated dependencies [beb419e]
- Updated dependencies [bd563d0]
- Updated dependencies [e855fcb]
- Updated dependencies [5086c21]
- Updated dependencies [8511fc1]
  - solid-js@2.0.0-beta.7
  - @solidjs/signals@2.0.0-beta.7

## 2.0.0-beta.6

### Patch Changes

- Updated dependencies [df3f514]
- Updated dependencies [74ea248]
- Updated dependencies [4a954e7]
- Updated dependencies [159d204]
- Updated dependencies [6a87fb2]
  - solid-js@2.0.0-beta.6

## 2.0.0-beta.5

### Patch Changes

- Updated dependencies [03e2cca]
- Updated dependencies [8ef7ece]
- Updated dependencies [8db4de8]
- Updated dependencies [e6177b4]
- Updated dependencies [8ef7ece]
- Updated dependencies [009d3de]
- Updated dependencies [3bd00d2]
- Updated dependencies [3eed9c1]
- Updated dependencies [d037842]
- Updated dependencies [6b4af47]
  - solid-js@2.0.0-beta.5

## 2.0.0-beta.4

### Patch Changes

- 2922dbb: Add regression coverage for SSR Show hydration placement so Show content hydrates before its following sibling once the dom-expressions runtime fix is published.
- 8d3e093: Update the bundled `dom-expressions`, `hyper-dom-expressions`, and `lit-dom-expressions` baseline to pick up the spread children caching fix, and add regression coverage for intrinsic spread children and `Dynamic component="div"` granularity.
- Updated dependencies [681d6a5]
- Updated dependencies [2922dbb]
  - solid-js@2.0.0-beta.4

## 2.0.0-beta.3

### Patch Changes

- Updated dependencies [284738e]
- Updated dependencies [5c961fa]
- Updated dependencies [284738e]
- Updated dependencies [284738e]
- Updated dependencies [26ea296]
  - solid-js@2.0.0-beta.3

## 2.0.0-beta.2

### Patch Changes

- 8187065: Fix unnecessary sibling re-rendering when Show/conditional children update by wrapping insert accessor in a transparent memo, with reactive accessor detection to skip redundant memoization
- Updated dependencies [8187065]
- Updated dependencies [8187065]
- Updated dependencies [8187065]
- Updated dependencies [8187065]
- Updated dependencies [8187065]
  - solid-js@2.0.0-beta.2

## 2.0.0-beta.1

### Patch Changes

- dadeeeb: Add NoHydration/Hydration components, expose moduleUrl on lazy, fix mapArray hydration ID mismatch, update dependencies

  **NoHydration / Hydration components** — Moved from dom-expressions into solid-js using the owner-tree context API. `NoHydration` suppresses hydration keys and signal serialization for its children. `Hydration` re-enables hydration within a `NoHydration` zone with an `id` prop matching the client's `hydrate({ renderId })`. On the client, `NoHydration` skips rendering during hydration; `Hydration` is a passthrough. Lazy components inside `NoHydration` register CSS but not JS modules, enabling code-split islands without a compiler.

  **lazy().moduleUrl** — Exposed `moduleUrl` as a read-only property on lazy component wrappers (both client and server) to support Islands architectures and advanced asset discovery.

  **mapArray hydration ID fix** — Server-side `mapArray` was constructing owner IDs by decimal string concatenation (`"prefix" + 10 = "prefix10"`), while the client uses base-36 encoding (`"prefixa"`). Refactored to use parent/child `createOwner()` pattern matching the client, ensuring ID parity for lists with 10+ items.

  **Dependency updates** — `@solidjs/signals` ^0.11.3 (fixes strictRead in computations), `dom-expressions` 0.41.0-next.11 (resolveAssets base path prefixing, removed NoHydration/Hydration stubs), `babel-plugin-jsx-dom-expressions` 0.41.0-next.11 (SSR conditional memo alignment).

  **Test fixes** — Updated strict read warning message assertion, fixed SSR streaming test manifests to use relative paths (matching real Vite output), removed stale TODO, added comprehensive test suites for NoHydration/Hydration, mapArray base-36 IDs, ternary conditional ID parity, and Show fallback hydration toggling.

- Updated dependencies [dadeeeb]
  - solid-js@2.0.0-beta.1

## 2.0.0-beta.0

### Major Changes

- 2645436: Update to R3 based signals
- a4c833d: Update to new package layout, signals implementation, compiler

### Patch Changes

- b1646a5: update signals
- c74106f: fix multi insert/removal, ssr wip, async signal render
- 433eae5: Add `runWithOwner` to rxcore shim to support callback refs from updated dom-expressions runtime
- Updated dependencies [512fd5e]
- Updated dependencies [dea16f3]
- Updated dependencies [15dc3c6]
- Updated dependencies [c3e5e78]
- Updated dependencies [874c256]
- Updated dependencies [4cab248]
- Updated dependencies [1122d74]
- Updated dependencies [c78ec9f]
- Updated dependencies [9788bad]
- Updated dependencies [21fff6f]
- Updated dependencies [2645436]
- Updated dependencies [60f2922]
- Updated dependencies [433eae5]
- Updated dependencies [b1646a5]
- Updated dependencies [e8d8403]
- Updated dependencies
- Updated dependencies [1a1a5d4]
- Updated dependencies [5f29f14]
- Updated dependencies [85aa54f]
- Updated dependencies [433eae5]
- Updated dependencies [c74106f]
- Updated dependencies [f4b0956]
- Updated dependencies [3e3c875]
- Updated dependencies [75eebc2]
- Updated dependencies [568ed6f]
- Updated dependencies [75eebc2]
- Updated dependencies [d1e6e29]
- Updated dependencies [a4c833d]
- Updated dependencies [84c80f9]
- Updated dependencies [381d895]
- Updated dependencies [fbbd7e3]
- Updated dependencies [53dcb14]
- Updated dependencies [dea16f3]
  - solid-js@2.0.0-beta.0
