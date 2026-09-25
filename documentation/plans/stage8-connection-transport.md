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
- **Built (branch `feat/frames-live`).** `renderToStream` gains
  `signal?: AbortSignal` — the one teardown handle for a render whose
  transport cannot report a dead consumer through the sink or the readable
  view (a frame render's emission never touches the document writable);
  abort runs the existing disconnect path (`abandon("signal")`,
  `SSR_STREAM_ABANDONED` with `data.reason: "signal"`). The frame responses
  own a teardown controller: the body's `cancel()` aborts it, the request's
  signal (passed by `frameTransformResult` / `frameTransformFlightResult`
  from `event.request.signal`) chains into it, and the body closes itself
  on abort since a torn-down render never ends its sink. The flight
  response stops at the frame in progress and skips the rest. The other
  half was in the reactive core: the frame-scope pump only noticed
  `comp.disposed` when `next()` settled, so a source parked on a wait was
  held until its next yield — the demo's lesson, on the runtime side. The
  pump now closes its source from the compute's disposal (`onDisposed`
  hooks run by the owner's disposal flag), both pump sites sharing one
  `pumpIterator`. Pinned in `frame-teardown.spec.tsx` (body cancel; request
  abort ends the body; already-aborted request renders nothing; through
  the handler; flight response) and `server-diagnostics.spec.tsx` (the
  document face: reason `signal`, sink never touched again).

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
- **Built (branch `feat/frames-live`), call-driven face.** Server: a call
  at the live address reaches `frameTransformResult` through the
  invocation record (`getServerFunctionInvocation().live`), and
  `serverComponentResponse({ live })` frames the chunks as server-sent
  events with the live headers, the idle heartbeat and the dev chaos knob
  (`armLiveBody`, shared with the codec stream). Client: the loop's wire
  slot rides on the `responseHandler` ctx; `applyFrames` reads an
  event-stream body through the loop's reader, counts the frames `start`ed
  and not `complete`d (a nested region rides inside its parent), and
  resolves the connection's end for the loop — `open > 0` is a death, `0`
  a completion, `sweep` writes the open frames' error records if the
  iteration ends by error, `close` leaves them standing. Without a loop,
  an open frame at body end gets the error record itself (undeclared
  death). `bump` cancels the address's live connection (supersession →
  death → the loop reconnects), and the handler holds ONE live connection
  per address: a second live reader's body is ended and its loop joins
  the first's lifetime — without this two readers of one call supersede
  each other's stream for as long as both are mounted. `dynamic` is
  untouched: the memo pumps the live iterable as any async iterable, and
  the re-yielded binding is equality-quiet on its own. Pinned in
  `frames-live.spec.tsx` (death → reconnect, same binding, morph, no
  fallback, no remount; complete → closed, no reconnect; stream `error` →
  closed; supersession → cancel + reconnect; undeclared death → error;
  shared connection; composer draft across a reconnect; argument switch)
  and `frame-live-framing.spec.tsx` (framing/headers at the live address,
  data address unchanged, standing response stays open with heartbeat,
  chaos ends it as a death, knob inert in prod). `dynamic`'s source type
  admits `AsyncIterable<T>` — type-only; the runtime pumped it already.
  Not here: the adoption bullet above (yield the adopted binding,
  reconnect at scope release) needs the live bit in the shell record — it
  lands with B3, as does the "live frame under a slow boundary" verify
  item (document face).
- **Demo built and verified (2026-09-25, headless Chrome, two tabs).**
  `examples/room` page `/`: `roomPanel` is `live(GET(async (room, me) =>
component))` in `src/lib/room-panel.tsx`, mounted with `dynamic(() =>
roomPanel(room, me))` once the tab has an identity (call-driven face);
  presence and transcript are memos over the same watchers as `/live`,
  joining is `onCleanup(join(room, me))`, the composer is a client slot.
  Observed: the other tab's join and leave arrive as morphs; _Kill every
  connection_ → `connected → reconnecting → connected (1 reconnect)`,
  render number climbs, zero fallback appearances (MutationObserver), same
  `solid-frame` and same `<input>` element, draft intact; the post lands
  as a transcript row through the standing render with no reconnect;
  production build passes and the server-only room state is absent from
  the client bundle.

### B3 — document face

- In-process `live` wrapper brands the component function; frame render
  reads it at scope entry → scope flag → memo and projection async paths
  select the hybrid (first value, close) branch; no pump, no hold in scope.
- ~~Live bit in the frame's shell record; adoption reads it.~~ Not needed:
  the client knows the call is live from its own reference, and the frames
  intercept derives the call's address from its own `(id, args)` — see
  Built below.
- Safety cap for undeclared unbounded sources in scope at t=0, with a dev
  diagnostic naming the source. Open (c) decided: fixed dev-only warning.
- **Verify:** document completes with a live component mounted at t=0; one
  value per source in the HTML; boundaries reveal through the document;
  post-hydration reconnect fires once per live frame, at its scope release.
- **Demo:** `/` SSR'd, transcript in the HTML, panel live after hydration.
- **Built (2026-09-25).** Server half: `runInServerComponentScope(fn, {
live })` sets a `LiveServerComponentContext` flag on the scope (inherited
  by nested scopes); `frameTransformDirectResult` passes the brand it finds
  on the wrapped component at RENDER time (the in-process `live` wrapper
  brands after the wrap); `processResult` selects the hybrid branch for
  every async source under the flag (`inLiveServerComponentScope`) and
  judges the scope from the memo's OWNER, not `currentOwner` — a stream
  arriving through a promise is classified in a continuation with no owner
  current, which also fixes the pre-existing misclassification of an
  unbranded thenable-resolved stream in server-component scope (it
  serialized instead of pumping; pinned). Client half, three pieces. (1)
  The frames intercept is consulted by `live()` SYNCHRONOUSLY at the call
  and its answer rides on the iterable as `LIVE_LOCAL` (registered symbol,
  `solid.LiveLocal`): a hydrating node with no serialized value
  (`dynamic`'s `serialize: false` memo) adopts that answer as its value
  now — the markup is the value; no pending beat, so the `<Loading>` never
  re-renders its fallback — and arms its takeover; the takeover run's
  iteration yields the adopted binding first (`LIVE_RESUME_FROM`), then
  connects with the intercept skipped (`wire.adopted`). A consumer outside
  any hydration scope iterates instead: the seed is yielded first, then the
  connect follows. (2) The intercept answers a boundary the page may STILL
  deliver (`boundaryMayArrive`) with a promise — a deferred local answer,
  settling at the reveal that carries the element (the binding) or when the
  page has nothing left to deliver it (a miss after all: the caller
  fetches). The live iteration awaits it, so a live frame under a streamed
  `<Loading>` connects after its fragment lands, never ahead of the
  document's own render; the plain proxy path gets the same answer (a
  `dynamic(() => call())` over a streaming boundary no longer fetches what
  the document is delivering). (3) `dynamic`'s memo `equals` is
  `sameInstance`: same component, same address is the same instance
  (placeholder branded by `showing` vs the per-address binding), and a
  same-component/other-address pair delivers the address instead of
  swapping — the mount never re-renders at these seams. No live bit in the
  shell record: `bindingFor(frameAddress(id, args))` on the client IS the
  address the server keyed the boundary under. Safety cap:
  `SSR_UNDECLARED_LIVE_SOURCE` (dev-only `warn`, `kind: "ssr"`) after 5s
  of a document render still pumping an async iterable in server-component
  scope; frame-stream renders (`options.sink`) are never judged (the
  render context carries `document`). Pinned: `test/server/frame-live-
document.spec.tsx` (brand → first value + close; unbranded pumps; nested
  inherits; thenable-resolved streams both ways; the cap fires once, names
  the owner, not for a live-branded sibling), the parity pair
  `test/server/frame-live-document-artifact.spec.tsx` →
  `test/hydration/frame-live-document.spec.tsx` (loaded and streamed
  replays: adopts at t=0 with zero requests, exactly one connect after the
  scope release at the live address, `computes === 2`, `status ===
["connected"]`, same `solid-frame`/`h1`/composer `input` with its draft
  through the morph and through a death → reconnect, no key miss, no
  fallback after content), `frames-live-showing.spec.tsx` (client-only
  reader of a shown call: adopt, then one connect), and two cases in
  `frames-late-boundary-client.spec.tsx` (deferred intercept lands / misses
  after exhaustion). Open (a) (`SERVER_WRITE` throw scope in persistent
  renders) is NOT decided here — left for the maintainer.
- **Fixed while building the demo (2026-09-25).** The demo's document call
  and its standing call differ (`roomPanel(room, null)` on the page, the
  browser mints the identity, `roomPanel(room, me)` after) — a kept
  resolution that moves the adopted instance to the standing address. The
  FIRST reconnect after that swung the frame back to the document's
  address: `sameInstance` read "the address that is not the delivered one"
  as incoming, but the memo HOLDS the document's binding forever (a kept
  resolution never replaces its value), so the reconnect's re-yield of the
  standing binding was compared against the first address and the other
  one — the document's — was delivered. The gate now reads its arguments
  as `(prev, next)` and delivers `next`'s address when it is not the one
  showing. That order is what every commit path in the signals core uses
  except one — the lane landing in `asyncWrite` called `equals(value,
prev)`; corrected to `(prev, value)`. Pinned:
  `test/hydration/frame-live-document-switched.spec.tsx` (own file: the
  frames client's boundary index is module state) — adopt, connect,
  switch arguments → re-bound to the standing address, death → reconnect
  stays there with the reconnect's render showing, draft intact. The
  `frame-live-document` harness carries a third mode (`switched`) for its
  artifact.
- **Demo built and verified (2026-09-25).** `/` renders the panel INTO the
  document (the `Show` gate is gone: `Panel` takes `me: Identity | null`
  and `roomPanel` joins only when it has an identity — the document's
  render watches; the browser's connection is the one that joins). Verified
  in the browser against the dev server: transcript in the HTML at t=0,
  zero fallbacks, exactly one live request — made when the identity is
  minted during hydration, at the standing address — the same
  `solid-frame`/composer `input` retained through the morph, and chaos →
  "reconnecting" → a fresh render ~500ms later on the same nodes with the
  draft intact and presence unchanged, three rounds in a row.

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
- **Built (2026-09-25) — the frame face; the document seed is left, with
  its design below.** Digests: `textDigest` (the `positionDigest` hash over
  a string) is minted by the frame sink on every content emission — `html`
  carries the digest of the root's SKELETON (the html with every live-hole
  range and slot range emptied, markers kept: `frameSkeleton`) plus a
  `holes` map of the digests of every live hole inside it (`lh:N` over the
  marker-free range, `lha:N` over the attr baseline the engine registers
  through the new `sink.attrBaseline`); `fragment` carries its own digest
  and its `holes`; `hole`/`attr` carry theirs (the document channel's ops
  too). Client ledger: `FrameImpl` keeps `have()` — reset by a root apply
  to `{ "": digest, ...holes }`, extended at each REVEAL (a fragment
  received but not revealed is not claimed — a death between the two must
  still ask for it), kept current by hole/attr applies — applied state,
  never the DOM. Resume request: the live loop asks the response handler
  per connect (`responseHandler.resume(info)` → `{ position, headers }`);
  the frames handler answers with the address's version ordinal as
  `Last-Event-ID` and the ledger encoded under `X-Frame-Have` (decision (f):
  that name; `key=digest` pairs, comma-joined; omitted over 4096 bytes —
  the render is then a full snapshot). Server rule: `frameTransformResult`
  reads the header at the live address only and passes it as
  `FrameStreamOptions.resume.have`; the sink skips the root (and its
  assets) when the skeleton digest matches, then emits each top-level hole
  whose digest differs (nested markers kept, so nested holes stay live) and
  each addressed attr whose text differs; a fragment the list names is
  skipped — no fragment, no reveal, no styles — in favor of the differing
  holes inside it (its keyed error still surfaces); a fragment the list
  lacks streams whole as it settles; fallback reveals over listed content
  never ship. A skeleton that differs re-ships the root and the render is
  the progressive stream it always was — the client resets its ledger on a
  root. "Settled" is by construction: the root and fragment html the sink
  sees are resolved. Pinned: `test/server/frame-live-resume.spec.tsx`
  (digests on every emission; no-op reconnect → `start, complete`; changed
  root hole → one hole; changed hole inside a revealed fragment → one hole,
  no fragment; fragment the client lacks → fragment + reveal, no root; a
  pending hole never emitted while a settled sibling is; skeleton change →
  full render), `test/frames-live-resume.spec.tsx` (ledger over
  root/fragment/reveal/hole; first connect carries nothing; reconnects
  carry the ordinal and the ledger; a digest-less root leaves no ledger),
  `frame-live-framing.spec.tsx` (the header through
  `handleServerFunctionRequest`; ignored at the data address). Verified in
  the browser: chaos → the reconnect request carries `Last-Event-ID: 1`
  and the have-list; the answer is 279 bytes — `start`, the composer's
  `slot` record, ONE `hole` (the render counter) — on the same nodes.
- **Demo adjustment.** The panel's render counter was a static hole
  (`{render}`), which made every skeleton differ and every reconnect a full
  root. It reads through a call now (`{renderNo()}`), so it is a live hole
  and the one thing a reconnect transfers. General lesson recorded in the
  README: what the author wants compared per reconnect must be a hole.
- **Left: the document seed (the "empty reconnect after hydration").** The
  connect after adoption has no ledger — `have()` is `undefined` for a
  document-adopted interior — so it is a full snapshot today (as it was;
  no fallback: the root morphs over adopted content). Seeding it needs the
  document face to name its holes and fragments the way a FRAME render of
  the same call would, and it does not: the document's live-hole engine is
  one per document (`lh:N` numbered across every component on the page —
  the client relies on document-unique ids to geometry-route `sc:live`
  ops), and `pl-N` fragment keys are document-global DOM ids, while a
  frame render numbers both from zero. The design: per-component-scope
  ordinals on the document face (the engine counts per scope owner; the
  renderer counts boundaries per scope), a have record per frame
  (`sc:have:<fid>`, frame-keyed → `[digest, documentKey]`) emitted at the
  component's end-of-scope, `sc:live` ops carrying `fid` so per-scope ids
  can repeat across components, the have-list entry format extended with
  the client's alias (`key=digest@clientKey`) and the sink speaking the
  client's names for the rest of the response when it skips the root, and
  the document's skeleton digest computed over the frame-equivalent bytes
  (slots stripped — the frame face renders them empty, the document face
  inline). Not started; flagged for the maintainer as the B4 remainder.
- **Attr holes on a resume (fixed 2026-09-25).** A resume's attr
  re-emission carries no `removed` list (the server has the client's
  previous text only as a digest). The client no longer needs one: an
  attr emission is the tag's WHOLE attribute area, so `#applyAttrs` now
  matches the element to it the way the root morph matches server output
  (`morphAttributes`) — sets what is present, removes what is not, keeps
  `data-lha` and a `<details>`/`<dialog>` `open`. The server's list is
  still honored where it comes. Pinned in `frames-live-resume.spec.tsx`.

### B5 — projections pump in frame scope

- `createProjection`/`createStore` over an async iterable in a server-owned
  frame render pumps like a memo (`ctx.commit`/`ctx.hold`, patch stream as
  yields); under the document-face scope flag, first value like a memo.
- **Verify:** memo and projection over the same source behave identically
  in frame scope and on the document face.
- **Built (2026-09-25).** `createProjection` (and `createStore`'s derived
  form) judges its scope the way `processResult` does — from its own owner
  (`scopeOwner`), so a stream arriving through a promise is classified
  correctly — and takes the memo's effective-mode rule: declared hybrid, or
  any source under a live component's document render, or a branded live
  source wherever the server consumes it EXCEPT the frame pump. The frame
  pump (`pumps`: no serialization channel and `pumpsInScope`) drives the
  projection's SHARED trace pump — a slot-border trace subscriber may be
  pulling the same iterator, and the source must have one consumer — under
  a response hold with the document-face cap (`openPumpHold`, shared with
  the memo's `pumpIterator`); every batch is a commit, reads follow the
  LIVE state (`markReady(state)` — no hydration claim to lock for), and
  disposal closes the source from the disposal. A thenable-resolved
  iterable (an async derive returning a generator, or the NotReady retry)
  takes its first value as a resolution and pumps the rest once it has
  landed (`pendingPump`). The trace log is kept empty while no subscriber
  reads it (a subscriber starts at the log's end) so a standing render
  does not accumulate patches. The trace subscriber's stable point is now
  "no undrained writes" rather than "no pull in flight": under the pump a
  pull is always in flight, parked on a standing source, and waiting for
  it held the snapshot until the world moved. Pinned:
  `test/server/frame-live-holes-projection.spec.tsx` (value-yielding
  projection and draft-mutating `createStore` re-emit holes per yield and
  complete when the source ends; memo and projection over one source emit
  identically; thenable-resolved pumps; live-branded stays connected and
  closes on abort; under the live scope: first value, closed, document
  completes). The welcome/status parity artifacts re-generated: the same
  shell, and in `rest` the trace's batch now lands ahead of the slot
  record's re-emission (the pump pulls eagerly instead of at the
  serializer's pace) — independent channels, order not contractual.

### B6 — `GET` server components end to end

- `GET(fn)` on a server component dispatches through the frames handler over
  GET; a live frame stream is event-stream framed through the shared writer;
  `applyFrames` reads through the shared reader off the content type; the
  has-method grant works for frame responses.
- Decide open (d): `serverFunctionUrl` on a live reference.
- **Verify:** GET frame stream decodes; `curl -N` shows an event stream of
  frame records; POST fallback for long arguments still decodes.
- **Built (2026-09-25) — mostly verification; one decision.** The path was
  already whole: `GET(fn)`'s client half dispatches the call over GET at
  the data address (`?args=` JSON) and the frames handler claims the
  frame-stream answer off `X-Frame-Stream` whatever the method; the live
  loop's call takes the live address and reads the event-stream framing
  through its own reader; the server's `GET()` grant governs dispatch and
  the origin gate before `transformResult` ever sees a component, so a
  frame response is granted or refused exactly as a codec one; the POST
  fallback for long arguments (JSON body, format 8) lands at the data
  address and answers the same records. Pinned now:
  `test/server/frame-get.spec.tsx` (a cross-site GET at the data address
  → `application/x-frame-stream`, length-prefixed, arguments from the
  query; the live address → `text/event-stream`, one `data:` line per
  record, the same records; undeclared → 405 same-origin / 403 cross-site,
  body never runs; the POST fallback; `serverFunctionUrl`) and
  `test/frames-get.spec.tsx` (the fetched url is GET with no body and
  equals `serverFunctionUrl(ref, ...args)`; long arguments → POST JSON at
  the data address, same mount; the live refusal). Verified with `curl -N`
  against the room dev server: the live address streams `data: {"type":
"start"…}` / `slot` / `html` events; the data address the length-prefixed
  records. Cache headers are the transport's (`no-store` unless the
  function sets its own) — a GET server component is cacheable when its
  author says so, like any read.
- **Open (d) decided (maintainer, 2026-09-25): the live address.**
  `serverFunctionUrl(live(GET(fn)), ...args)` returns
  `<endpoint>/live/<id>[?args=...]` — the url the reference's own call
  requests, so a fetch of it is the call (a standing event stream: fetch it
  by hand with `curl -N`; do not preload or prefetch it, which would open
  a stream nothing reads — documented on the helper). It used to return
  the DATA address, one the live call never requests (an earlier pass
  refused instead; refusal removed the manual/debug url, which had no
  other public source). The one-shot url is the inner `GET(fn)`'s. Both
  entries (the body is `serverFunctionUrlFor` in shared).

## Public API ledger (flag before each lands)

| Change                                                                                                                                                                                                                                                                                                                                                                      | Kind                                | Slice |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ----- |
| `live` behavior over nested-async answers (response lifetime)                                                                                                                                                                                                                                                                                                               | behavior change, shipped fn         | A2    |
| `live` takeover fires per scope, not at page-wide hydration end                                                                                                                                                                                                                                                                                                             | behavior change, shipped fn         | A2    |
| `live` digest-equal reconnect yields nothing (D12)                                                                                                                                                                                                                                                                                                                          | behavior change, shipped fn         | A1    |
| `live` takeover iteration yields the adopted value first, locally, before its first connection                                                                                                                                                                                                                                                                              | behavior change, shipped fn         | A2    |
| `setSignal` during hydration capture snapshots a pre-capture plain signal's pre-write value (held, replayed at release)                                                                                                                                                                                                                                                     | behavior change, signals            | A2    |
| Server `Loading` honors `on` (hydration ids match the client)                                                                                                                                                                                                                                                                                                               | bug fix                             | A2    |
| Live calls move from the data address to `<endpoint>/live/<id>` — a client and server versioned apart miss each other on live calls until both are current                                                                                                                                                                                                                  | wire (address)                      | A1    |
| Event-stream framing of what the live address answers; `Last-Event-ID` (value digest as `id:`; cursor sources read the header)                                                                                                                                                                                                                                              | wire                                | A1    |
| `X-Accel-Buffering` / `no-store` on live responses                                                                                                                                                                                                                                                                                                                          | wire (headers)                      | A1    |
| Dev warning: >5 live connections over HTTP/1.1                                                                                                                                                                                                                                                                                                                              | new dev-only diagnostic             | A1    |
| Dev chaos-reconnect knob: `chaosReconnectEvery` on `configureServerFunctionsServer`                                                                                                                                                                                                                                                                                         | new dev-only option                 | A3    |
| `renderToStream({ signal })` — the request's abort tears the render down as a disconnect; flows through `renderToFrameStream` / `renderServerComponent` / `serverComponentResponse` options                                                                                                                                                                                 | new option                          | B1    |
| `SSR_STREAM_ABANDONED` `data.reason` gains `"signal"`                                                                                                                                                                                                                                                                                                                       | diagnostic data                     | B1    |
| Frame responses tear the render down on body `cancel()` and on the request's abort; the frame-scope pump closes its source at disposal                                                                                                                                                                                                                                      | bug fix                             | B1    |
| `ServerFunctionInvocation.live` — the invocation record says whether the call arrived at the live address                                                                                                                                                                                                                                                                   | new field                           | B2    |
| `FrameStreamOptions.live` on `serverComponentResponse`; a live frame response is an event stream (live headers, heartbeat, chaos knob)                                                                                                                                                                                                                                      | new option, wire                    | B2    |
| `applyFrameResponse`: a body ending before a started frame's `complete` is that frame's error (undeclared death, RFC 11 §9.5 D1)                                                                                                                                                                                                                                            | behavior change, frames             | B2    |
| One live connection per address: a second live reader of the same call joins the first connection's lifetime instead of opening its own                                                                                                                                                                                                                                     | behavior, frames + live             | B2    |
| `dynamic` source type admits `AsyncIterable<T>` (a `live` server component reference's answer); runtime unchanged                                                                                                                                                                                                                                                           | type-only widening                  | B2    |
| `onstatus` reachable for server-component references                                                                                                                                                                                                                                                                                                                        | existing surface, new reach         | B2    |
| `LIVE_LOCAL` (`Symbol.for("solid.LiveLocal")`): the document's answer for a live call rides on the iterable `live()` returns; a hydrating node adopts it as its value and takes over at scope release                                                                                                                                                                       | new registered symbol, protocol     | B3    |
| Frames intercept answers a boundary the page may still deliver with a PROMISE of the binding (a miss when nothing is left to deliver it); a `dynamic(() => call())` over a streaming boundary waits for the document instead of fetching                                                                                                                                    | behavior change, frames             | B3    |
| `dynamic` `equals`: same server-component instance (same component + same address, or same component with the address delivered) is equal — placeholder vs per-address binding no longer remounts                                                                                                                                                                           | behavior change, `dynamic`          | B3    |
| `SSR_UNDECLARED_LIVE_SOURCE` — dev-only `warn` after 5s of a document render still pumping an async iterable in server-component scope (open (c): fixed warning, no knob)                                                                                                                                                                                                   | new dev-only diagnostic             | B3    |
| `runInServerComponentScope(fn, { live })` / `inLiveServerComponentScope()` on `solid-js/internal` (internal, `@internal`)                                                                                                                                                                                                                                                   | internal surface                    | B3    |
| Server: an unbranded thenable-resolved async stream in server-component scope now pumps (was: serialized) — scope judged from the memo's owner                                                                                                                                                                                                                              | bug fix                             | B3    |
| `dynamic` `equals` reads `(prev, next)` and delivers `next`'s address — a reconnect after the source switched arguments stays at the standing address (was: swung back to the first)                                                                                                                                                                                        | bug fix, `dynamic`                  | B3    |
| Signals core: the lane landing in `asyncWrite` calls a user `equals` as `(prev, next)` like every other commit path (was: `(next, prev)`)                                                                                                                                                                                                                                   | bug fix, comparator contract        | B3    |
| Server `createProjection`/`createStore` over an async iterable in a server-owned frame render pumps (holds the response, commits per yield, reads follow the live state); a live-branded source there stays connected (was: first value, close); under a live component's document render every source takes its first value (was: only hybrid/branded)                     | behavior change, server projections | B5    |
| Server projection slot-border trace: the snapshot waits only for undrained writes, not for a pull in flight; under the frame pump the trace's batches ship at the pump's pace (earlier than the serializer's)                                                                                                                                                               | behavior, trace timing              | B5    |
| Frame chunks carry server-minted digests: `html` (`digest` = skeleton, `holes` map), `fragment` (`digest`, `holes`), `hole` (`digest`, `holes` for nested), `attr` (`digest`); the document `sc:live` channel's `hole`/`attr` ops carry `digest` — `FrameChunk` gains the `hole`/`attr` members and these optional fields                                                   | wire + type                         | B4    |
| `X-Frame-Have` request header (`FRAME_HAVE_HEADER`, `FRAME_HAVE_BUDGET` = 4096 exported from `@solidjs/web/frames` client and server; `encodeHaveList`/`decodeHaveList` internal) — the resume's have-list, `key=digest` pairs; `Last-Event-ID` on a frame reconnect is the address's version ordinal (open (f) decided)                                                    | wire                                | B4    |
| `FrameStreamOptions.resume?: { have }` — a conditional render: root skipped on skeleton match, holes/attrs emitted only when settled and different, listed fragments skipped for their holes, no reveal (fallback reveals included) over listed content; `frameTransformResult` reads the header at the live address                                                        | new option + server behavior        | B4    |
| `Frame.have?()` — the mount's ledger of what it shows (applied state); `createServerComponentHandler(...).resume(info)` and `responseHandler.resume?(info)` → `{ position, headers }` consulted by the `live` loop per connect (the wire slot gains `headers`)                                                                                                              | new API                             | B4    |
| `textDigest(text)` on `server-functions/shared` (internal; re-exported by the server entry for the frames artifact); `frameSkeleton(html)` exported by the frame-sink module only (test seam, not on the entry)                                                                                                                                                             | internal                            | B4    |
| Room demo: the render counter is a live hole (`{renderNo()}`) so a reconnect transfers it alone                                                                                                                                                                                                                                                                             | example                             | B4    |
| Frame attr holes: an `attr` re-emission matches the element to the tag's whole attribute text (sets what is present, removes what is not; keeps `data-lha` and a `<details>`/`<dialog>` `open`) — the root morph's rule; `removed` still honored. Attributes a client behavior added to an attr-hole element are removed at the next re-emission, as the morph removes them | behavior change, frames client      | B4    |
| `SERVER_WRITE` throws in persistent renders — NOT built in Part B; open (a), maintainer's stance: server input is derived, writes stay forbidden; scope (persistent only vs everywhere) to decide                                                                                                                                                                           | behavior change                     | B3+   |
| ~~`documentWindow` on `renderToStream`~~ — open (c) decided: fixed dev-only warning, no knob                                                                                                                                                                                                                                                                                | withdrawn                           | B3    |
| `serverFunctionUrl(liveRef, ...args)` returns the live address `<endpoint>/live/<id>[?args=...]` (was: the data address, which the live call never requests) — open (d) decided                                                                                                                                                                                             | behavior change                     | B6    |
| Withdrawn unbuilt: `SSE(fn)`, `enableEventStream()`, `Accept: text/event-stream` as declaration, framing-follows-method, per-page channel, `live: { transport, hold }`, `connected` on the frame handle                                                                                                                                                                     | —                                   | —     |

## Open decisions

| #   | Question                                                                                                                                  | Decide in |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| (a) | `SERVER_WRITE` throw scope in persistent renders                                                                                          | B3        |
| (b) | Connection state surface — CLOSED: `onstatus`                                                                                             | —         |
| (c) | Safety cap — CLOSED (B3): fixed dev-only warning, `SSR_UNDECLARED_LIVE_SOURCE` at 5s; no knob                                             | —         |
| (d) | `serverFunctionUrl` on a live reference — CLOSED (B6): refuses, like a POST reference; the one-shot url is the inner `GET(fn)`'s          | —         |
| (e) | How the server knows a call is live — CLOSED (D13): the address (`/live/<id>`); a server-side `live` declaration cross-checks in dev only | —         |
| (f) | Have-list header — CLOSED (B4): `X-Frame-Have`, `key=digest` pairs, omitted over 4096 encoded bytes (full snapshot then)                  | —         |

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
