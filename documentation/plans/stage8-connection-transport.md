# Stage 8 Plan — connection-shaped transport, data tier first

_Drafted 2026-09-22; transport shape argued through the same night and
settled 2026-09-23 as today's per-source stream, framed as server-sent
events, with nothing to configure. Status: DESIGN AGREED in conversation,
awaiting review by the original author of RFC 10's `live`. Spec:
`documentation/solid-2.0/10-server-functions.md` ("`live(fn)`"; the transport
detour is under Alternatives considered). Design record:
`documentation/server-components/server-components-principles.md` §9.5 (and
§9.2.1 for why settlement is not here). This page is the checklist; it links
to those and does not restate them. Owner: Ryan._

## Objective

Make liveness survive the connection, with one declaration, one reconnect
loop, and one status surface across both tiers:

- **Data tier:** `live` claims the whole response — nested streams, not just
  the top-level iterable — over the per-source stream it already uses, now
  framed as server-sent events; its post-hydration takeover fires per scope.
- **Frames:** server components consume `live` (no loop of their own), take
  first values from the document render and hand off, reconnect
  conditionally by hole hash, and tear down when the client goes away.

The data tier is small by design — framing and a takeover fix. The
substance of the stage is Phase B. Everything lands with the page of a new
example that proves it. Existing examples (`rendering`, `hackernews`,
`notes`, `chat`) are untouched. Apps using `live` today keep working
with the flagged differences only (ledger below): fewer yields on a
digest-equal reconnect, per-scope takeover; live calls move to the live
address, so a client and server versioned apart miss each other on live
calls until both are current.

## Decisions (settled 2026-09-22/23; details in the spec/design)

- **D1 — Liveness is declared, by `live`, at the export.** Undeclared death
  is an error on both tiers. No frame-side resume loop, no window as the
  declaration.
- **D2 — `live`'s lifetime is the response's.** Death = body ends with
  deferreds still open (the decoder's end-of-body sweep rejects them —
  today's behavior); completion = every deferred settled, the codec's
  own close records saying so. No terminal record is added. Reconnect
  re-yields the whole answer; nested iterators are never continued.
- **D3 — One SSE response per source, nothing to configure; no transport decision.** `live`
  requires a backend that holds connections over HTTP/2 — the precondition
  LiveView, Datastar, and SvelteKit's `query.live` share. A live call is a
  direct call whose response is framed as server-sent events. A platform
  that kills it at a ceiling produces a death and `live`'s ordinary
  reconnect; documented, not configured around. Set aside after a full
  argument (RFC 10, Alternatives considered, records why): a shared per-page channel (SSE cannot carry
  add; threading one in needs state or routing we will not require; it
  fights a fine-grained client), a `transport: "polling" | "sse"` enum
  (there is one stream), and a `hold` cycling responses under a ceiling
  (future, one optional number, if asked for). Withdrawn unbuilt: `SSE(fn)`,
  `enableEventStream()`, `Accept: text/event-stream` as a client
  declaration, framing-follows-method.
- **D4 — Document face takes first values by scope.** The brand on a live
  component's function becomes a frame-scope flag; every source in scope
  takes the existing hybrid path (first value, close). No pump, no hold, no
  "settled once" event. The window is reduced to a safety cap for
  undeclared unbounded sources.
- **D5 — Reconnect is a conditional render.** Server mints an opaque digest
  per hole on every emission (document included); client returns
  `Last-Event-ID` + have-list; server emits only holes that are settled and
  differ. Replaces progressive/settled modes. Compute re-runs; the wire is
  the diff.
- **D6 — `GET(fn)` is the server-component idiom; `live(GET(fn))` for
  standing ones.** Core spelling is primary; a router may apply either on
  the author's behalf and owns the grant-topology caveat when it does.
- **D7 — Connection state is `onstatus`.** No `connected` on the frame
  handle.
- **D8 — Takeover is per scope.** A live node reconnects when its own
  hydration scope releases (root pass release; a boundary's
  `releaseSnapshotScope`), not at page-wide `onHydrationEnd`. The shipped
  `armLiveTakeover` gate is re-keyed per scope owner. Behavior change to a
  shipped export; arguably its own fix ahead of the rest.
- **D9 — Hidden pages hold their connections (pause deferred, 2026-09-23).**
  A background tab keeps its live connections open, as an `EventSource`
  does; the cost is one held connection per source on a backend whose
  precondition is that it holds connections. The pause designed here (grace
  window ~30s, no status on the close, last status held, a takeover firing
  while hidden parked until visible, a consumer ending during a pause
  firing `"closed"` and cancelling its parked work, no opt-out) moves to
  Future-if-asked-for whole: the most intricate state machine on the data
  tier, a behavior change to a shipped export, buying server cost only.
  The D12 skip already makes a return reconnect free on the wire.
- **D12 — Digest-equal reconnect yields nothing.** A value-shaped source's
  position is the server's digest of its last payload string, sent as the
  event `id:`. On a reconnect whose `Last-Event-ID` equals the current
  value's digest the server suppresses the first emission only; the client
  iterable does not yield for that connection, later values flow. Makes the
  takeover reconnect free on the wire (the data-tier analog of B4's hole
  digests). Behavior change to a shipped export: fewer
  yields than today's `live` on reconnect.
- **D13 — Framing is selected by the address.** The loop calls
  `<endpoint>/live/<id>`, a sibling of the scripted `/data/<id>`, and the
  server frames whatever it answers there as an event stream. A third
  caller kind receiving a third answer shape gets a third path for the
  reason the data address exists (#3094: caches key on the URL; #3406:
  reads carry no transport header) — a header would put an event stream
  behind a URL caches already hold a data answer for. Only the loop calls
  the live address, and only the caller holding the `live` reference knows
  deterministically (a server-side `live(fn)` declaration has `GET`'s
  topology caveat, so it may cross-check in dev but cannot decide).
  `Last-Event-ID` rides as a request header on the live address only,
  which is `no-store` and never preloaded. Streamed answers at the data
  address stay byte-identical to today. Closes open (e).
- **D10 — Compatibility is a requirement.** Authoring surface unchanged;
  every client and server hook applies as to any direct call; no new
  endpoint, no new server option.
- **D11 — Sequence:** docs → Phase A (data, no server components) → Phase B
  (frames). B1 (teardown) and the D8 fix are independent and may land any
  time.

## Phase 0 — write it down (this worktree, `feat/sse-carrier`)

- [x] RFC 10: `live(fn)` subsection with its Framing bullet (per-source
      SSE, precondition incl. HTTP/2, failure on non-holding backends,
      compatibility); the transport detour recorded under Alternatives
      considered; runtime sentence and lifetime table updated. No
      transport section — there is no transport decision.
- [x] §9.5 rewritten around D1–D10; roadmap bullet 8 and ordering note
      aligned; §9.3 seed pointer corrected; §9.4 grouping seed corrected.
- [x] This plan.
- [x] Review by the `live` author; audit of the three files against the
      tree (findings F1–F4, N1–N5 folded: death-rejection flagged
      everywhere, digest skip specified and flagged, born-hidden takeover
      parks, (e) closed, withdrawn lists aligned, multi-line claim
      corrected, `break` during pause specified); committed (docs only, no
      changeset). Two corrections on entering A1: the terminal record was
      redundant (the decoder's end-of-body sweep already rejects open
      deferreds — F1 described today's behavior, so it is no longer a
      flagged change), and (e) re-closed as the live address rather than a
      header (D13).

## Phase A — data tier (`@solidjs/web/server-functions`), no server components

Demo: `examples/room`, page `/live`, SSR'd (stream mode). Server state is a
plain in-memory module with subscribe; sources are keyed by room. A dev-only
route on the node harness (`/__chaos/drop`) destroys the socket of every open
live response — death is a transport event, so the chaos is transport-level,
not a server function. The harness runs HTTP/2 (`server.https`) so the page
can hold more than five live sources; the HTTP/1.1 warning is demonstrated by
turning it off.

**Built.** `examples/room` ships all five source shapes (presence and
transcript as standing answers over a memo / a projection, the nested-async
room card, the undeclared summary under `<Errored>`, the slow-plain archive),
the chaos route in `vite.config.ts` plus the `chaosReconnectEvery` timer via
`src/server-config.ts`, and HTTP/2 in dev through `@vitejs/plugin-basic-ssl`.
Building it surfaced a pre-existing hydration bug (Feb `bfd9032`): the
adoption trace (`subFetch`) pulled the first step of ANY async iterable a
compute returned to prime async-generator computes, but a deserialized codec
stream read out of an adopted nested-answer value is not a generator — pulling
it under the mocked `Promise` corrupted its resolver queue and the next
streamed value threw `temp.s is not a function`. Fixed to pull only when the
result is its own iterator; the trace no longer opens a mock connection on a
live call's iterable (five takeover tests updated: trace opens 0, the takeover
opens 1). Regression test in `client-hydration.spec.ts`; its own changeset.
The same trace also opened a foreign iterable whose `[Symbol.asyncIterator]()`
IS the subscription (#3647, the router's `liveQuery`) — the fix covers it;
regression test in the issue's shape.

Finishing the demo (identity minted in an `onSettled` inside the hydrating
tree, `<Loading on={room}>` on the slow panels) surfaced three more, each
fixed with tests and its own changeset: (1) a write during the hydration pass
to a signal created BEFORE capture (`setSignal` on a module-level or provider
signal) propagated into the snapshot scope and skewed later reads — the first
such write now records the pre-write value as the snapshot, so it is held and
replayed at release like a creation-time snapshot (`@solidjs/signals`;
computeds landing through `setSignal`, firewall leaves and `_noSnapshot`
signals excluded); (2) the takeover's local first yield above (`@solidjs/web`);
(3) the server's `Loading` dropped `on` and its fake-depth ids did not account
for the client's dependency node, so every element under a boundary with `on`
missed its hydration key (`solid-js`; two parity-harness scenarios). Also
found while probing: a plain write in the same tick as an action call is one
frame with the action and lands when it settles — intended; the demo keeps
the clear entangled and binds the input through `latest(text)`, which shows
the clear at once. A keystroke during the hold is a rewrite of the held value:
`latest` shows it and it is what lands at settle (pinned in
`signals/tests/action.test.ts`).

### A1 — framing

- The live address (D13): `serverFunctionLiveAddress` beside the data
  address in `shared.ts`; `parseServerFunctionAddress` reports `live`; the
  loop targets it on both the POST path and `GET`'s composed path (the
  reference's `run` builds the live address when the loop asks — an internal
  option, not a public one); the handler treats it as scripted.
- Live responses: `Content-Type: text/event-stream`, `Cache-Control:
no-store`, `X-Accel-Buffering: no`, the Serialized format header; the
  codec's payload strings one per `data:` event; comment heartbeat every
  20s. Payloads are `JSON.stringify` output and contain no raw CR/LF, so
  the SSE multi-line split/reassembly is defensive only — implemented,
  tested with a synthetic payload. Event-stream writer beside `createChunk`
  and reader beside `ChunkReader` in `shared.ts`; the handler picks the
  writer off the address; the client picks the reader off the content type.
  The reader is built by `live()` itself — a per-iteration wire slot rides
  the loop's invoke options under a process-local symbol, carries the
  reader factory and the position, and is threaded through `extractBody` /
  `deserializeStream` — so a client that never imports `live` carries no
  event-stream parser (the `provideRPC` pattern, per iteration).
- `Last-Event-ID` on reconnect (D12): a cursor source reads the header off
  the request; a value-shaped source's events carry `id: <digest>` where
  the digest is over `JSON.stringify(value)` of a JSON-safe yield (the codec
  record itself is not stable across yields — its reference ids depend on
  what came before — so it is not the thing digested; a yield that is not
  JSON-safe carries no id and is never skipped). On a reconnect whose
  `Last-Event-ID` equals the current value's digest the server skips the
  first emission only and the client iterable does not yield for that
  connection. Never an argument. The position lives on the iteration's wire
  slot (the reader writes it, the next connect reads it), never on a value
  and never in user code's reach. A one-value answer is positioned the same
  way; skipped, it is an empty stream and the iteration completes with
  nothing — as it would have after the one value the client already had.
- Dev: warn once when a page holds more than five live connections and its
  document came over HTTP/1.x (the navigation entry's `nextHopProtocol`
  stands in for the origin's — a live response's own resource-timing entry
  only exists once it has ended), naming them, pointing at `server.https`.
- Built and verified (2026-09-23): `server-functions-live-framing.spec.tsx`
  — 21 cases covering the verify list below except the browser-only items
  (`curl -N` equivalent is the raw handler body; devtools EventStream tab
  is manual). Existing `live` tests pass unchanged. Not in A1: a cursor
  source naming its own `id:` — the header is readable off the request,
  but nothing lets a yield carry a caller-chosen id yet (future, if asked
  for).
- **Verify:** framing round-trip incl. a synthetic multi-line payload;
  digest round trip — equal digest yields nothing and later values flow,
  unequal digest yields at once, a non-JSON-safe yield carries no id and
  always flows; a streamed answer at the data address is byte-identical to
  today; a mid-body death at either address rejects (today's behavior,
  pinned); existing `live` tests pass unchanged except where they assert a
  yield on a digest-equal reconnect; `curl -N` against the live address
  shows an event stream; devtools EventStream tab lists events.
- **Demo:** presence panel over `live(GET(async function*))`, visibly an
  event stream.

### A2 — `live` = response lifetime, per-scope takeover

- Client loop: lifetime observed through the stream's end + how it ended;
  death → backoff → re-invoke → re-yield the whole answer; completion →
  complete. Plain async functions returning nested-async objects produce an
  iterable that yields once per connection.
- Server half (in-process): brand the answer that IS the source — the
  top-level iterable, or a function-valued answer (a component). Nothing
  nested is branded: the sources inside a value answer are bounded (they
  end on their own; a standing stream nested in a value is misuse, B3's
  safety cap and diagnostic cover it).
- Takeover resumes from the adopted value: hydration's takeover run stamps
  the live answer with the SSR value it replaces (`solid.LiveResumeFrom`,
  registered symbol, internal to solid-js ↔ `@solidjs/web`); the client
  loop digests it into its first connection's `Last-Event-ID`, so a takeover
  that finds the same value on the server costs nothing on the wire (D12 as
  promised). The iteration yields the adopted value itself first, locally,
  before it connects: the takeover node re-ran its compute and holds
  nothing, and with the server's first emission skipped it had no other way
  to land — left pending it opened a transition that held every write of
  the tick that released it (the demo's identity mint) until the source
  changed. Equality-quiet for a memo, a no-op reconcile for a projection.
- SSR: the top-level branded source takes first value and closes (existing
  hybrid path). A nested source needs no handoff — the serializer pumps it
  to its end — but it does need SHARING: a generator yields to one reader,
  and the serializer pumping the answer and a memo reading
  `answer().progress` are two (the common case). Landed as its own commit,
  general, not live-specific: every iterable read the runtime makes on the
  server goes through a seat on a shared multicast of the source
  (`shareAsyncIterable`: one pump, log trimmed to the slowest seat, last
  seat out closes); the serializer takes its seat through the frames'
  border walk (`toBorderForm`, formerly `envelopeContainerTraces`) applied
  at `context.serialize` — memo values on the document face and B3's frame
  document face — and to slot args in the frame sink, whose first-yield tap
  uses the same seats. Projections keep their own generator; the trace is
  their multicast.
- **D8 fix:** `armLiveTakeover` keyed per snapshot-scope owner; flips on that
  scope's release (root pass end, or the boundary's own
  `releaseSnapshotScope`). No live node waits on another boundary. The
  shipped gate's per-pass re-arm (discarded on flip so a later hydration
  pass — islands — arms a fresh one) must survive the re-keying.
- Undeclared streaming death rejects the consumer's pull; `<Errored>`
  catches it.
- No hidden-page handling (D9): a background tab's connections stay open.
- `onstatus` otherwise unchanged.
- **Verify:** nested-async death/reconnect/completion; a nested source read
  by a memo and pumped by the serializer is shared (one pump, whole
  sequence to both); a live node in the shell reconnects before a slow boundary
  lands; a live node under a boundary reconnects when that boundary
  hydrates; a later hydration pass (islands) arms its own takeover;
  undeclared death is an error; `invoke` signal ends the iteration across
  reconnects; single-flight never requested on live calls.
- **Demo:** room card over `live(GET(async () => ({ name, topic, messages,
presence })))` with a projection over `messages`; summary over an
  undeclared bounded generator inside `<Errored>`; chaos shows declared
  sources reconnect (status pill) and the undeclared one errors; a slow
  `Loading` boundary elsewhere on the page does not delay the header's live
  source; two tabs see each other's presence; closing a tab removes it
  (teardown); a tab in the background keeps its presence.
- **Demo verified (2026-09-25, headless Chrome, two tabs):** each tab lists
  both; chaos → the three declared pills go reconnecting → connected, each
  counting one reconnect, and the undeclared summary shows `The stream died`
  with Regenerate; the room card re-yields with a new connection number; a hidden
  tab stays listed; closing a tab removes it in ~100 ms. Two model fixes on
  the way: `leave()` must remove only the entry its own connection joined (a
  reconnect re-joins under the same id before the dead connection's
  `finally` runs — the late leave was removing the new entry), and a standing
  source parked on an `await` cannot be `return()`ed until that await
  settles, so the watchers race the request's abort signal
  (`getRequestEvent().request.signal`) — otherwise the leave waits for the
  room's next event. The production harness (`server.js`) now couples the
  socket's close to the request's signal, as the dev plugin does. RFC 10
  carries both as contract (the `live` bullet "Teardown is the request's
  abort"; the host's duty under `createEvent`), without the mechanism.
  Proposed, not built (a new dev-only diagnostic — needs a go-ahead): after
  an abort, warn when a live source's `return()` has not settled within a few
  seconds, naming the source — the only way a typical author learns their wait
  is not observing the signal.

### A3 — dev chaos-reconnect knob

- Dev-only configuration that kills live responses every N seconds, data and
  frames alike: `configureServerFunctionsServer({ chaosReconnectEvery: ms })`
  — the event-stream writer errors the body N ms after the response opens
  (a death, not a completion: the stream is still open), cleared when the
  response completes on its own; inert outside the dev build. Frames' live
  responses ride the same writer, so B2 is covered when it lands. The
  harness route stays as the manual switch.
- **Verify:** a standing answer dies under the knob and the loop reconnects
  (`connected → reconnecting → connected`); the knob is inert in the
  production build.

## Phase B — frames (`@solidjs/web/frames`, `solid-js/server`)

Demo: `examples/room`, page `/` — `Room` is a live server component at t=0
(transcript + presence read through a projection over the same in-memory
subscribe), the composer is a client slot, `send` is an action that
invalidates the room query (so supersession is visible), presence also shown
by a client component over the A2 source. One undeclared streaming server
component ("summarize the room") for the bounded contrast.

### B1 — teardown on disconnect (independent; a bug fix today)

- `serverComponentResponse.cancel()` and the request `signal` dispose the
  render root; same for `frameFlightResponse`.
- **Verify:** closing a frame stream mid-render ends the source iterator
  (`return()` observed) and releases the hold.

### B2 — frames consume `live`

- The frames `responseHandler` exposes response lifetime (binding now; end +
  how it ended later) so `live`'s loop can run over it.
- `dynamic` consumes an async iterable of bindings; re-yield of the same
  binding passes the equals-gate (no remount, no pending pulse).
- Hydration adoption yields the adopted binding into `live`'s iterable
  synchronously; the loop reconnects at the frame's own scope release (D8)
  when the frame's live bit is set.
- Supersession from another response (rule 5) cancels the connection; `live`
  sees a death.
- Undeclared frame death → `frame.error` / `<Errored>`.
- `onstatus` reachable through the reference's iterable.
- **Verify:** death vs `:complete`; reconnect outside transitions; same
  binding identity across reconnect; supersession → reconnect; undeclared
  death is an error; `Composer` draft survives a reconnect; a live frame
  under a slow boundary does not delay a live frame in the shell.
- **Demo:** the room panel reconnects on chaos with no fallback flash.

### B3 — document face

- In-process `live` wrapper brands the component function; frame render
  reads it at scope entry → scope flag → memo and projection async paths
  select the hybrid (first value, close) branch; no pump, no hold in scope.
- Live bit in the frame's shell record; adoption reads it.
- Safety cap for undeclared unbounded sources in scope at t=0, with a dev
  diagnostic naming the source. Decide open (c): knob vs fixed dev warning.
- **Verify:** document completes with a live component mounted at t=0; one
  value per source in the HTML; boundaries reveal through the document;
  post-hydration reconnect fires once per live frame, at its scope release.
- **Demo:** `/` SSR'd, transcript in the HTML, panel live after hydration.

### B4 — conditional reconnect

- Digest per hole on every hole/fragment emission (frame streams and the
  document face); client ledger per address; `Last-Event-ID` + have-list
  header on resume (bounded; omitted over budget); server rule: emit a hole
  only when settled and different; never emit a fallback over content.
- **Verify:** no-op reconnect transfers zero holes; a changed hole
  transfers one; a hole the client holds as fallback receives its reveal
  when it settles; a hole that never settles is never emitted.
- **Demo:** devtools shows an empty reconnect after hydration when nothing
  changed.

### B5 — projections pump in frame scope

- `createProjection`/`createStore` over an async iterable in a server-owned
  frame render pumps like a memo (`ctx.commit`/`ctx.hold`, patch stream as
  yields); under the document-face scope flag, first value like a memo.
- **Verify:** memo and projection over the same source behave identically
  in frame scope and on the document face.

### B6 — `GET` server components end to end

- `GET(fn)` on a server component dispatches through the frames handler over
  GET; a live frame stream is event-stream framed through the shared writer;
  `applyFrames` reads through the shared reader off the content type; the
  has-method grant works for frame responses.
- Decide open (d): `serverFunctionUrl` on a live reference.
- **Verify:** GET frame stream decodes; `curl -N` shows an event stream of
  frame records; POST fallback for long arguments still decodes.

## Public API ledger (flag before each lands)

| Change                                                                                                                                                                                                  | Kind                        | Slice |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----- |
| `live` behavior over nested-async answers (response lifetime)                                                                                                                                           | behavior change, shipped fn | A2    |
| `live` takeover fires per scope, not at page-wide hydration end                                                                                                                                         | behavior change, shipped fn | A2    |
| `live` digest-equal reconnect yields nothing (D12)                                                                                                                                                      | behavior change, shipped fn | A1    |
| `live` takeover iteration yields the adopted value first, locally, before its first connection                                                                                                          | behavior change, shipped fn | A2    |
| `setSignal` during hydration capture snapshots a pre-capture plain signal's pre-write value (held, replayed at release)                                                                                 | behavior change, signals    | A2    |
| Server `Loading` honors `on` (hydration ids match the client)                                                                                                                                           | bug fix                     | A2    |
| Live calls move from the data address to `<endpoint>/live/<id>` — a client and server versioned apart miss each other on live calls until both are current                                              | wire (address)              | A1    |
| Event-stream framing of what the live address answers; `Last-Event-ID` (value digest as `id:`; cursor sources read the header)                                                                          | wire                        | A1    |
| `X-Accel-Buffering` / `no-store` on live responses                                                                                                                                                      | wire (headers)              | A1    |
| Dev warning: >5 live connections over HTTP/1.1                                                                                                                                                          | new dev-only diagnostic     | A1    |
| Dev chaos-reconnect knob: `chaosReconnectEvery` on `configureServerFunctionsServer`                                                                                                                     | new dev-only option         | A3    |
| `onstatus` reachable for server-component references                                                                                                                                                    | existing surface, new reach | B2    |
| Have-list header; hole digests                                                                                                                                                                          | wire                        | B4    |
| `SERVER_WRITE` throws in persistent renders                                                                                                                                                             | behavior change             | B3+   |
| `documentWindow` on `renderToStream` — only if open (c) says knob                                                                                                                                       | new option (conditional)    | B3    |
| `serverFunctionUrl` refusing live references — only if open (d) says                                                                                                                                    | behavior change (cond.)     | B6    |
| Withdrawn unbuilt: `SSE(fn)`, `enableEventStream()`, `Accept: text/event-stream` as declaration, framing-follows-method, per-page channel, `live: { transport, hold }`, `connected` on the frame handle | —                           | —     |

## Open decisions

| #   | Question                                                                                                                                  | Decide in |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| (a) | `SERVER_WRITE` throw scope in persistent renders                                                                                          | B3        |
| (b) | Connection state surface — CLOSED: `onstatus`                                                                                             | —         |
| (c) | Safety cap: `documentWindow` knob or fixed dev-only warning                                                                               | B3        |
| (d) | `serverFunctionUrl` on a live reference: refuse or document                                                                               | B6        |
| (e) | How the server knows a call is live — CLOSED (D13): the address (`/live/<id>`); a server-side `live` declaration cross-checks in dev only | —         |
| (f) | Have-list header name and budget                                                                                                          | B4        |

## Known costs (stated, not solved here)

- **One connection per live source.** HTTP/2 makes it free; HTTP/1.1 caps at
  six per origin (dev warning; `server.https`).
- **A backend that cannot hold cycles every live response.** Death, backoff,
  reconnect with positions, `onstatus` showing it — `query.live`'s behavior
  on the same platform. A buffering proxy that ignores `X-Accel-Buffering`
  is silent until the stream dies. Both are the deployment's to fix.
- One reconnect render per live frame per page load (post-hydration
  takeover). Conditional, so usually empty on the wire; compute still runs.
- One reconnect per invalidating mutation per live address (rule 5).
  Mitigation belongs with §9.2.1's convergence work.
- Stateful attach (render kept alive past the response; reconnect by token)
  is the opt-in above the stateless baseline; out of scope, not precluded.

## Future, if asked for

- `live: { hold?: ms }` — end each live response cleanly at `hold` with a
  _more_ marker for platforms with a response ceiling; the loop re-asks at
  once. One optional number; nothing here precludes it.
- A socket carrier where subscribe/unsubscribe are native, if the
  connection count ever matters. Same positions, same records.
- Built-in sharing of identical live calls (SvelteKit's `query.live` does
  this); today sharing is the graph's or a data layer's.
- `reconnect()` of a live source inside a mutation's single flight
  (`query.live` has it) for sources that depend on something the mutation
  changed.
- The hidden-page pause (deferred 2026-09-23; designed in full, unbuilt):
  `visibilitychange` → hidden starts a grace timer (~30s); visible before
  it fires cancels it and nothing happens; firing closes every live
  connection on the page without a status event and the last status holds.
  Visible after a close → reconnect with position, conditional (the D12
  skip makes it free when nothing changed); the reconnect fires
  `"connected"` when it lands or enters the ordinary backoff when it does
  not. A source in backoff when the page hides parks its retry until
  return. A takeover whose scope releases while the page is hidden parks
  the connect until visible (born-hidden pages connect nothing). A
  consumer that ends its iteration during a pause (`break`, disposal)
  fires `"closed"` and cancels its parked retry or takeover — nothing is
  left waiting on `visibilitychange`. Datastar's default; `EventSource`
  and `query.live` do not pause. Deferred because it buys server cost only
  — one held connection per source in a background tab, on a backend
  whose precondition is that it holds connections — for the most
  intricate state machine on the data tier and a behavior change to a
  shipped export. Build it if a real server-cost problem shows up; it is
  additive. With it would come the declaration-level opt-out for sources
  that must be heard in the background — notifications, a call ringing
  (Datastar's `openWhenHidden`) — a property of the source, on `live`'s
  declaration, not per call.

## Out of scope

Cursors as a protocol (only the `Last-Event-ID` seam), WebSocket, any
subscription registry or connection-local subscription state, any new
authoring API for liveness, any server configuration for liveness, Stage 7's
predictions (independent; §9.2.1).
