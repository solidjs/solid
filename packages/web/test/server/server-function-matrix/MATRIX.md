# Server-function conformance matrix

This matrix owns the cross-road contracts of the server-function protocol.
Individual specs remain focused, but every invariant is checked against each
applicable invocation or transport road instead of being fixed at one caller.

Status legend: **pass** (ordinary green guard) · **audit** (reported by
#3232–#3253; contract and red reproduction still require maintainer review) ·
**ruling** (product/API policy, not accepted as a defect yet) · **n/a**
(structurally inapplicable).

## Roads

1. **HTTP dispatch** — request parsing, event creation, invocation, encoding.
2. **Direct call** — an in-process server reference called during SSR.
3. **Nested direct call** — a dispatched body calls another server reference.
4. **Deferred graph** — getters, promises, iterators, generators and streams
   reached after the function body returns, including nested containers.
5. **Single-flight fold** — mutation outcome plus requested data-source slices.
6. **No-JS form/flash** — form navigation, flash-cookie storage and replay.
7. **Client decode** — response framing, decoding, cancellation and teardown.
8. **Construction** — invocation through `new`; only policy gates apply.

## Invocation identity and policy gates

| Invariant | HTTP | Direct | Nested | Deferred | Construction | Coverage |
| --- | --- | --- | --- | --- | --- | --- |
| Address resolves to the function granted for that method | **pass** | n/a | n/a | n/a | n/a | `server-functions-addressing`, `server-functions-csrf`; #3237 **audit** |
| `wrapInvocation` applies exactly once and cannot be bypassed | **pass** | **pass** | #3240 **audit** | **pass** | #3242 **audit** | `server-functions-invocation-wrap`, `server-functions-request-event-scope` |
| A missing per-handler hook preserves configured policy | #3238 **audit** | #3238 **audit** | #3238 **audit** | n/a | #3238 **audit** | new focused spec required |
| `provideEvent` establishes one request event per logical invocation | **pass** | #3246 **ruling** | #3246 **ruling** | **pass** | #3246 **ruling** | `server-functions-event-hook`, `server-functions-request-event-scope` |
| `transformResult` observes the agreed success/failure surface | #3247 **ruling** | #3247 **ruling** | #3247 **ruling** | #3247 **ruling** | n/a | contract decision required |

## Request and argument boundary

| Invariant | HTTP | Direct | No-JS | Coverage |
| --- | --- | --- | --- | --- |
| Byte limits use bytes actually received and cancellation reaches the upload source | #3236 **audit** | n/a | #3236 **audit** | `server-functions-request-bounds`, `server-functions-content-length` |
| Body-format tags are recognized before decoding | **pass** | n/a | **pass** | `server-functions-body-formats`; #3245 covers the client half |
| Unsafe own keys are removed at every untrusted decode boundary | **pass** | n/a | #3233 **audit** | `server-functions-proto-keys`, `server-functions-open-gaps` |
| Decoded promises are always owned, even when their container is abandoned | n/a | n/a | #3232 **audit** | new focused spec required |

## Result graph and request scope

| Invariant | HTTP | Direct | Nested | Deferred | Coverage |
| --- | --- | --- | --- | --- | --- |
| Deferred execution re-enters the invocation's request event | **pass** | **pass** | #3241 **audit** | #3241 **audit** | `server-functions-request-event-scope` |
| Guard traversal reaches supported enumerable and descriptor-carried values without invoking hidden accessors | **pass** | **pass** | **pass** | #3235 **audit** | `server-functions-result-descriptors`, `server-functions-encode-hygiene` |
| An abandoned rejecting value cannot become an unhandled rejection | **pass** | **pass** | #3232 **audit** | #3232 **audit** | `server-functions-failure-sanitization` |
| One unencodable deferred value cannot erase an already committed sibling outcome | **pass** | n/a | n/a | #3243 **audit** | `server-functions-open-gaps` |

## Single-flight fold

| Invariant | Status | Coverage |
| --- | --- | --- |
| Folding never mutates or aliases an application-owned `Response` | #3234 **audit** | `server-functions-response-aliasing` |
| Each requested source id executes at most once | #3251 **audit** | `server-functions-single-flight` |
| One failed/unencodable slice cannot erase the mutation result or healthy slices | **pass** / #3243 **audit** | `server-functions-single-flight`, `server-functions-open-gaps` |
| Redirecting mutations preserve folding without trusting attacker-controlled navigation metadata | #3252 **ruling** | contract decision required |

## No-JS form and flash replay

| Invariant | Status | Coverage |
| --- | --- | --- |
| Flash values preserve falsy outcomes | #3248 **audit** | `server-functions-outcome-digest` |
| Every variable-length field participates in the cookie-size degradation ladder | #3249 **audit** | `server-functions-flash-bounds` |
| Refused form navigation returns to a safe, useful destination | #3250 **ruling** | `server-functions-nojs-destination` |
| Cookie attributes define the intended CSRF, lifetime and deployment policy | #3239 **ruling** | contract decision required |

## Client response lifecycle and fidelity

| Invariant | Status | Coverage |
| --- | --- | --- |
| The client consumes each response once and cancels/ends the connection it opened | #3244 **audit** | `server-functions-transport-failure` |
| Unknown body formats reject as protocol/version skew, never resolve `undefined` | #3245 **audit** | `server-functions-version-skew`, `server-functions-body-formats` |
| JSON fast-path classification preserves supported value identity, including `-0` | #3253 **audit** | new focused spec required |

## Triage verdicts (2026-09-03 audit pass)

Five independent audits reviewed every report against current `next`, the PR
implementation/tests, prior accepted fixes, and platform semantics.

**Accepted defects (implementation authorized, smallest shared-boundary fix):**

- #3232 decoder-minted rejected promises must always be owned (high).
- #3245 unknown body-format tags reject as version skew, never `undefined`.
- #3253 `-0` refuses the JSON fast path (loud, matching `NaN`).
- #3244 clone half only: `extractBody` owns its input; no unread tee branches.
  The connection-teardown half is deferred (can truncate pending nested refs).
- #3235 Error-carrier half only: enumerable channels on `Error` subclasses are
  guarded. Hidden/non-enumerable slot ownership stays rejected (per `47995412`).
- #3236 body caps bound bytes actually received; abort reaches the source.
- #3246 `provideEvent` exactly-once extends to the direct road (completes #3172).
- #3247 `transformResult` observes plain throws (docs already promise it).
- #3234 fold calls `ownResponse` before stamping cookies (completes #3155).
- #3251 single-flight source ids dedupe as a first-seen-order set.
- #3248 falsy half only: `0`/`false`/`""`/`null` outcomes flash; `url` is
  validated structurally, not by result truthiness.
- #3237 binding half only: a GET grant binds to function identity, not id;
  stale/unverifiable declarations fail closed.

**Rejected as proposed:**

- #3233 generic decode-boundary stripping — decoding does not pollute; the fix
  destroys legitimate `constructor`/`prototype` data on trusted results.
- #3243 slice-isolation preflight — collector contract already requires
  serializable output; the probe is incomplete and leaks an `@internal` helper.
- #3242's construct trap and #3244's completion-teardown — behavior changes
  without a defect.

**Rulings — resolved 2026-09-03:**

1. #3239 flash cookie: the payload (including form `input`, which the router's
   `filter(s.input)` attribution requires on the flash-seeded render) is
   AES-GCM encrypted, always, under a key derived (domain-separated,
   `solid.flash.v1`) from THE DEPLOYMENT SECRET — one secret per deployment,
   future features derive their own keys from it under their own domain
   strings. Resolution: explicit `secret` option → bundler-injected
   `globalThis.__SOLID_SECRET__` → no secret means no flash cookie plus a
   dev diagnostic. Envelope gains `SameSite=Lax` and `Max-Age=60`; the
   recorded `url` is the unbound base so `.with()`-bound forms match
   `fn.base`. No `__Host-` rename, no redaction heuristics. Runtime landed
   in `fbe5bef4` (encode/decode now async); companions:
   solid-vite-plugin#343 (secret injection into server builds) and
   solid-router#597 (async decoder absorbed by the submissions seed), both
   draft until rc.7 ships.
2. #3249 flash overflow: refuse to flash (plain redirect, no cookie) — never a
   silent prefix. Landed in `3393fb62`.
3. #3250 refused no-JS navigation: ratified as-is — security refusals keep raw
   statuses and never flash; a refused request is of unproven origin and its
   `Referer` is attacker-controlled. Closed, no code change.
4. #3252 `targetUrl`: a same-origin `Location` is server-authored and alone
   names the fold destination; no `Referer` corroboration. Closed as ratified.
5. #3240/#3238 `wrapInvocation`: entry-only semantics kept and pinned
   (`c08e9742`); invalid hook values throw at hook resolution on both roads
   (`ed6b6053`). No hop-by-hop propagation.
6. #3237 `withMeta({ method })` against an existing grant: throws in dev,
   fails closed (grant revoked) in prod (`12263816`).
7. #3241 supported carriers: plain objects and arrays, copy-on-write — user
   containers are never mutated; Set/Map/frozen slots documented out of scope
   (`84a94bc1`).
8. #3248 `undefined` outcome: writes no flash cookie, pinned by test
   (`f21e060b`).
9. #3242 construction: native Proxy semantics stay; no construct trap.

**Landed fixes (all merged to `next` 2026-09-03):** #3232 `ff2ecf11`,
#3234 `c0bc9baa`, #3235 `5cee0f77`, #3236 `7009adfd`, #3237 `12263816`,
#3238 `ed6b6053`, #3239 `fbe5bef4`, #3241 `84a94bc1`, #3244 `b7b17abf`,
#3245 `6c9f8f45`, #3246 `292bdc52`, #3247 `a1ff2860`, #3248 `f21e060b`,
#3249 `3393fb62`, #3251 `a14c1385`, #3253 `6bb51c9b`. Every issue in the
sweep is closed and every accepted fix is on `next`; the two cross-repo
companions (solid-vite-plugin#343, solid-router#597) ride as drafts until
2.0.0-rc.7 ships. The **audit**/**ruling** markers in the tables above
record the pre-triage state and read as resolved per this section.

## Extraction and merge discipline

- A red test demonstrates current behavior; it becomes an ordinary guard only
  after its contract is accepted.
- Each accepted cell lands with the smallest shared-boundary fix, focused
  tests, a `solid-js`/`@solidjs/web` patch changeset when package source
  changes, and before/after retained-size measurements.
- Independent cells remain independent commits. Categories merge sequentially;
  remaining branches rebase after each batch.
- New exports, option semantics and browser/cookie policy changes require an
  explicit maintainer ruling before implementation.
- PR #3254 remains the source audit; it is not the integration branch.
