# Server Components: The Derivation

**Status:** Accepted design basis for the post-`0.50.0-next.35` architecture pass.
**Audience:** anyone changing `frame-client.js`, `frame-transport.js`, `frame-sink.js`, the
document inline scripts in `server.js`, or Solid's frames integration
(`@solidjs/web/frames`, `solid-js` hydration).
**Relationship to other docs:** [`server-components.md`](server-components.md) is the
usage-first spec, [`frame-streams-rfc.md`](frame-streams-rfc.md) is the wire format.
This document sits underneath both: it states the axioms the system is derived from,
maps every existing mechanism to the axiom it serves (or marks it compensatory), and
records the decisions of the first-principles pass. Where this document and the older
docs disagree, this document wins and the others get revised.

---

## 1. Why this document exists

The feature was specified by invariants (single-copy, hydrate-once, per-args identity,
state survival) but *implemented* by accretion: each bug got a locally-correct fix, and
several fixes created the conditions for the next bug. Three seams paid interest
repeatedly:

- **Reveal/claim ownership** needed fixes three rounds running — solidjs/solid#2964
  (late-settling boundary never mounts), then the reveal-policy rework (`_$HY.f`),
  then solidjs/solid#2967 (the rework changed what `_$HY.done` means, breaking
  `documentStreaming()`; plus a claim scope severing slot reactivity). Each fix was
  correct and each spawned the next, because *two* runtimes (document hydration and
  the frame client) own the same placeholder vocabulary.
- **Record shape per transport** produced the #547 cluster (`#refArgsUnchanged`, the
  `ctx.adopted` fork, `hy.r` absorption) and then solidjs/solid#2968 (adopt-time slot
  sync can run before its record is resolvable, misclassifying an invoked slot as
  argless content).
- **Boundary identity straddling cache and call site** produced the hover-preload
  morph bug, the sidebar-collapse bug, solidjs/solid#2965 (fast navigation permanently
  showing the wrong route), and the machinery stack that fixed them: call-site
  handoff, `forwards`, `rebind`, retention snapshots, live slot props, and the
  "preloads never hand off" rule.

Meanwhile the client surface reached ~3,400 lines / 8.5 KB min+gzip and the CI size
ceiling was ratcheted upward nearly every round. Ratcheting a guard to match actuals
is the guard failing.

The async work in Solid 2.0 established the antidote: state the axioms, derive the
mechanism set from them, and delete everything that exists only to compensate for a
mechanism that shouldn't exist. This is that pass for server components.

---

## 2. Axioms

Everything below is derived from these seven statements plus one liveness rule. A
mechanism that cannot cite an axiom is a bug in the architecture even if it fixes a
bug in the behavior.

- **A1 — Single-copy.** Server content travels exactly once: as HTML if it is
  markup, as a data record if the client needs the value. Never both. (At t = 0,
  values recoverable from the rendered page are recovered, not re-sent.)
- **A2 — Hydrate once.** Client components hydrate at t = 0 and never again. After
  boot the server never renders a client component; post-load responses carry server
  content and slot records only.
- **A3 — Addresses key content, not mounts.** Every byte the server produces belongs
  to a `(function, arguments)` address. Arrival — any transport: preload, refetch,
  single-flight region, document inline — *only writes the address's store*. There is
  no code path from arrival to DOM.
- **A4 — Sites own mounts.** A consumption site owns one mounted frame, bound to one
  address at a time. DOM changes are pulls: the bound address's store advanced a
  version, or the site rebound to a different address. Binding follows the site's own
  reactive expression, nothing else.
- **A5 — One record shape.** A slot/region record has one meaning and one
  availability point on every transport. The t = 0 document emits the same records a
  stream would; a consumer never branches on "how did this arrive."
- **A6 — One reveal owner.** A pending placeholder has exactly one owner: the frame
  store/flush model. The document is the t = 0 frame (id `""`), not a parallel
  system with its own policy.
- **A7 — Identity-first matching.** Occurrence identity is frame-wide. Reconciliation
  matches client-owned ranges by identity first and position second; a live range is
  *never* detached because of where it sat.
- **L1 — Liveness.** Every pending state resolves to exactly one of: content, error,
  or detectable truncation. Nothing pends silently forever. (This is the axiom
  solidjs/solid#2958 showed was missing: a truncated stream must be observable, and
  the `_$HY.fe` seam it relies on must actually exist.)

A1, A2 are unchanged from the shipped design and have never been the source of a bug
class. A3–A7 and L1 are the corrective ones.

### The derived data flow

```
  preload ──────┐
  refetch ──────┤ writes                    pulls (bound address, version)
  single-flight ├──────► store[(fn, args)] ◄──────── mounted frame ──── site
  t=0 document ─┘                                        (one per site)
```

Preload isolation, retention, and "morph on refetch" stop being rules anyone
maintains; they are unrepresentable-failure consequences of A3/A4:

- A hover-preload for `getNote(2)` writes `store[getNote,2]`. The viewer is bound to
  `store[getNote,1]`. Nothing observes the write. (The hover-morph bug cannot be
  expressed.)
- Navigating rebinds the site's frame from address 1 to address 2 — the same morph
  path as a version update on a bound address. If `store[2]` is warm, the morph is
  synchronous: that *is* retention, with no snapshot mechanism.
- A refetch of the bound address advances its store version; the frame pulls and
  morphs. Client-owned ranges survive by A7.

---

## 3. Decision records

### DR-1: The identity split (supersedes "boundary identity is the call", contract §3)

**Shipped design:** the `(function, args)` address keys *everything* — the component
identity `dynamic` sees, the DOM boundary element, and the content store. Every args
change is therefore a component swap, which is a remount — so the design immediately
needed machinery to undo the remount for live sites: `COMPONENT_HANDOFF` (a brand the
new component uses to steal the old component's live mount), the path-compressed
`forwards` map, `FrameImpl.rebind` (change a live frame's id without teardown),
retention snapshots (a departing boundary stashes `{version, records}`), and an
explicit rule that preloads never trigger handoff. That stack is where the
hover-preload bug, the sidebar-collapse bug, and solidjs/solid#2965 lived.

**Previously rejected design (for the record):** one boundary per call *site*,
owner-captured, morphing across argument changes — with the *cache* keyed by site.
Rejected correctly: a fresh per-args cache hit could resolve a component that was
mounted showing different arguments' content. That failure was a cache-honesty
violation.

**Adopted design:** split the two roles the address was playing.

- The **store** is keyed per-address (cache-honest; 1:1 with a data layer's per-args
  cache entries by construction — the half of the shipped design that was right).
- The **mount** is keyed per-site. The component `dynamic` resolves is stable per
  *function*; args changes at a live site deliver a new binding to the same instance
  ("same component, new props" — the semantics compiled components already have),
  and the instance's frame rebinds its pull to the new address's store.

The rejected design's failure mode is unrepresentable here: a cache hit fills a
per-args store; a mount bound to a different address never observes it. The shipped
design's machinery is unnecessary here: there is no component swap to undo, so
handoff, forwards, rebind-by-id, retention snapshots, and the preload rule all
delete. What remains is the one genuinely-needed mechanism the patches were
approximating: a "new binding into the same live instance" delivery path — the same
shape `liveSlotProps` already has one level down, now applied at the boundary level
where it belongs.

State semantics are preserved exactly: slot occurrences whose ids persist across a
rebind keep their client state (what the collapse-bug fix was reaching for);
occurrences that disappear unmount (per-call state does not bleed across calls);
teardown is still disposal, never a version bump.

### DR-2: Async values at the slot border

**Where a read renders determines where it suspends.** A read rendered into
*markup* suspends on the server, into the fragment model — `Loading`,
placeholders, deferred reveals — because that is where a placeholder exists
by construction (DR-3). A read crossing as a *slot arg* never suspends the
server: the stream, the record, and every sibling arg ship immediately, and a
value that isn't ready yet crosses *as* pending. Suspension for data is
**client-side, at the consumption read** — a prop read through the live-props
proxy follows the normal async read path into the reading component's own
nearest `Loading`, exactly as a promise prop behaves between two client
components. Initial SSR's shape, applied to data: emit now, settle later,
reveal at the read site.

"Nearest `Loading`" is a **border-blind search**, and that is what makes the
no-boundary case already solved rather than a new hole. The frames client
reconstructs a client `Loading` at the seam of every server `<Loading>` it
reveals (`revealSeam`), precisely so a client fill that suspends top-level
without a boundary of its own defers to the *server's* boundary. The first
design deferred such fills to the parent *client* boundary outside the slot
instead, and was walked back: that boundary has already latched by reveal
time, so the suspension either re-collapses settled UI around the slot or
orphans entirely, and it answers with the wrong fallback — the server
already rendered the fallback for exactly this footprint, so the client
must hold *that*, at *that* granularity. (Pinned: the seam test asserts the
segment fallback holds while the outer fallback must **not** re-engage;
`boundaryScope` guards the ownership half — re-parenting a fill to the
frame's outer owner would let it escape the seam boundary that exists to
cover it.) A pending slot arg read at mount is just one more way top-level
suspension arises, and it escalates by the same path: the author's server
`Loading` covers unboundaried pending *data* exactly as it covers
unboundaried fill *markup*. One boundary tree spans both owners; what
differs across the border is who rendered the fallback, not where suspension
resolves. DR-2 completes the picture that seam decision started — together
they mean an author places boundaries by UX intent alone, never by which
side a value happens to arrive from.

**Data args are live bindings for the response window.** No node kind is
special: from the graph's perspective an expression, a sync memo, an async
memo, and a projection are all equally downstream of sources, so the border
must not draw a liveness cliff between them. (An earlier draft's "only
self-driving primitives stream" drew exactly that cliff — it described the
server implementation's shape, not the model's, and is superseded.) The
mechanism buys graph-consistent behavior without building a dependency graph
into SSR mode:

- At record emission, each arg getter becomes an open **binding** —
  `(record, arg, getter, last emitted state)`. Nothing holds; the record
  ships with its mix of settled values and pending marks. The server side is
  a binding ledger, not a boundary — the suspense boundary is the client
  component's own `Loading` at the prop read.
- The server has exactly one kind of update event: a **commit** — a generator
  yields, a promise settles — already funneled through the settlement choke
  points. Each commit bumps a global **epoch** and triggers one
  equality-gated re-evaluation sweep over the open bindings; changed values
  re-emit as ordinary live-props record updates. Between commits nothing
  runs: correctness by re-evaluation instead of by tracking, over the
  dumbest possible topology (sources → all bindings) — the right trade at
  SSR scale, where response windows are short, commits few, getters cheap.
- Server memos cache **per epoch** (one integer compare at pull; no
  subscriptions), so derivations recompute lazily when a sweep pulls them.
  Memos are pure by contract; re-running per epoch is the client contract
  applied to the server.
- **Lifecycle:** a binding opens at emission, updates on commits, and closes
  at response completion or region teardown. Completion latches the last
  value as final — principled, not truncation: the request-scoped graph is
  disposed, so its last value *is* its final value. A binding that never
  successfully evaluated **rejects** with a diagnosable error (the fragment
  ledger's truncation pattern), so a client `Loading` errors instead of
  hanging. Cross-request updates are owned by re-invocation (invalidate →
  the address re-streams → live props update the mounted instance).
  Unmounting the frame aborts the in-flight response, which disposes the
  sources — no new teardown protocol.
- Implementation notes settled in review: equality gating is *reference*
  equality (a getter minting a fresh object re-emits per commit — exactly
  what the client graph does with that getter; structural comparison would
  be a silent divergence); sweeps coalesce per flush (a burst of yields in
  one tick is one sweep, at most one emission per binding); a binding that
  emitted and later throws not-ready re-enters pending as
  pending-with-previous-value — the client async source already models
  latest-vs-suspend; bindings ride the sink's existing response-window
  context (it already holds projection taps and deferred holes), and a
  superseded region closes its bindings mid-response.

Classification (by the value's nature, before resolution — DR-3) decides each
binding's **wire shape**, never its liveness:

1. **Plain values** — including the results of expressions
   (`value={proj.a + 1}`) and sync memos: the value itself; re-emissions
   replace it, latest-wins. Pending-at-first-evaluation ships as a pending
   async value and resolves on a later sweep.

2. **Async values passed whole** (promises, async iterables, async memos):
   a pending record streams on, resolutions/yields ride later data chunks
   (seroval's streaming serialization is already this shape). Revives as a
   client **async source**; reads suspend at consumption. The receiving side
   already exists (the signal-backed live-props proxy plus the async read
   path) — this tier ships first.

3. **Containers passed whole** (projections and stores, or *parts* of them)
   cross as their **bounded async trace**: one snapshot, then patch batches,
   for as long as the response is open. Committed work, not demand-gated —
   solidjs/solid#2966's repro *is* this crossing.
   - *Why a trace and not a channel:* the server graph is request-scoped, so
     a reactive value's entire observable life fits inside the response
     window; a channel bounded by the response IS streaming serialization,
     and one that outlives it would require server sessions this
     architecture does not have. The binding lifecycle above applies
     unchanged — settle-at-completion, re-invocation for cross-request
     updates, abort-on-unmount.
   - *Why patches and not snapshots:* seroval dedupe is identity-keyed and
     in-place mutation keeps identity while changing content, so
     snapshot-per-frame back-references pin *stale* serializations.
     Immutable updates make snapshots cheap; in-place updates make patches
     cheap — Solid chose in-place, so the aligned wire format is the
     mutation log, which is also the single-copy answer: snapshot once,
     deltas after.
   - *The producer already ships:* projection hydration wraps the draft in a
     `PatchOp`-recording deep proxy (set/delete/array-splice ops by
     root-relative path) and serializes a tapped async iterable — one full
     snapshot, then `patches.splice(0)` per yield — consumed by
     `applyPatches`. It doesn't fire at this border only because its gate is
     the hydration-owner record path (`ctx.serialize(owner.id, …)`), which
     `NoHydration` — where server components render — correctly blocks.
   - *Hydration's trace, the frame store's envelope:* the trace is reused;
     hydration's transport identity is not. At the border it is addressed as
     `(occurrence, arg)` inside the slot record — a capability of the
     record, not a registry entry — version-gated by the store's existing
     discipline (a superseding stream's arrival means the old version's
     pending patch batches are *dropped*, never applied), and lifetime-bound
     to region teardown. The snapshot serializes through seroval directly
     (hydration's JSON-clone freeze would sever shared references within a
     record).
   - *The receiver is minted:* unlike hydration — where the client's own
     `createProjection` call is the patch target because the same component
     code runs on both sides — no user code runs on the client here, so the
     frames integration mints the counterpart: `createStore(snapshot)`
     pumped by `applyPatches`, handed to the live-props read. Fine-grained
     client reads work because it *is* a store.
   - *Parts ship as what you pass.* A nested node of a projection is itself
     a store proxy, so classification sees it; the unit that crosses is the
     passed subtree, never its root — the wire is an exposure contract
     (`{ first: state.items[0] }` must not leak siblings/ancestors), which
     rules out the hydration-equivalent root-reference design despite its
     free aliasing. Each arg gets a server-side filtered/rebased view of the
     one root-relative trace: ops strictly below the arg's path strip the
     prefix; an op at or above it projects the new value down as a sub-store
     root replacement (`[[], v]`); ops elsewhere are dropped *before* the
     wire. A part whose ancestor is deleted settles at its final projection.
     Overlapping parts are independent containers — share identity by
     passing the common ancestor once (also the cheaper wire).
   - *"Serialize what is read" holds at the author's granularity:* the
     client's reads happen after the server is gone, so narrowing to them is
     impossible without SSR-ing the client component or a demand-fetch
     waterfall against a disposed source. The projection (or passed part)
     is the author-declared read set and snapshot+deltas its minimal
     encoding — "ship less" = "project less," and passing a part is
     projecting less ad hoc. Single-copy is preserved because the record is
     the only copy when the client is the only consumer; render-AND-pass
     duplication is the authored, bounded concession DR-3 rule 2 names.
   - ***Build record (2026-08-10).*** Shipped as designed. The identity
     rationale that settled the wire format, recorded: granular patches
     carry **framework-owned identity** (root-relative paths recorded at
     write time by the producer's own proxy — never computed by diffing),
     which is what rules out the snapshot-plus-reconcile alternative:
     reconciliation needs domain keys the framework cannot assume, while
     the mutation log needs none. The letter was refined in four places
     the build discovered:
     - *The trace is multi-consumer.* Hydration's single-consumer tap became
       a shared pump: one source iterator drives an append-only patch log,
       and every `subscribe()` (hydration resume, each slot crossing) replays
       from its own cursor — snapshots captured only at stable points (no
       in-flight `next()`), so undrained writes can't double-apply.
     - *The receiver is a minted projection, not a bare store.* The client
       materializes the trace through `createProjection` under its own root:
       the container REFERENCE is available synchronously, reads INTO it
       suspend until the snapshot (the fill's own `<Loading>` covers them,
       same contract as the value tier), patch batches apply through
       `applyPatches`, and the result is readonly — writes stay
       producer-owned by construction.
     - *The envelope.* Seroval's own classification runs before plugin
       tests — it reads `.constructor` (detonating a pending proxy) and
       claims arrays outright — so raw containers can't be intercepted
       reliably. The sink swaps each traced container, at any depth of an
       argument, for a module-private `{ [TRACE] }` envelope (copy-on-write
       walk) and the plugin matches THAT. On the document face the record
       carries a `{ $tr, $ta }` marker literal instead, revived at arg-read
       and memoized per trace — one live container, however many references.
     - *Classification is trap-safe on BOTH faces, containers first.* The
       server probes by WeakMap (`isContainerTraced`) before any content or
       async probe; the client mirrors it by WeakSet
       (`isMaterializedContainer`) in the props proxy and the record-dedupe
       compare — where containers compare by identity only (same
       materialized instance adopts silently; a re-serialized trace is a new
       generation, a live-props change). The matrix surfaced this as a real
       gap: `.then` probes and serialization compares detonate pending
       containers.

     Scope lines, recorded: this round crosses **whole containers**
     (settled plain stores still ship as plain data — the trace registry
     only claims async projections). *Parts* (nested-node exposure with
     filtered/rebased traces, above) and *case 4* (async at container
     paths) remain the designed extensions; a part of a PENDING projection
     is not yet classifiable and must not be passed. And the write
     discipline stands as documented but **unenforced**: raw reactive
     writes during server render are wrong for ordinary SSR already
     (the markup may have flushed); enforcement is parked with case 4's
     diagnostics, not a Stage 5 deliverable.

4. **Async at container paths** (promises/pending nodes stored IN a
   projection): two clocks interleave at one path — the mutation log (a path
   may be reassigned before its promise settles; a superseded settlement must
   lose, so per-path latest-wins sequencing) and the settlement events
   ("pending" is a node state, not a value: minted-store reads of such paths
   must suspend through the async read path, and the sink must serialize from
   the raw target so a pending node cannot suspend the serializer). Excluded
   from the first container round with a diagnosable error naming the path;
   the sequencing discipline is designed into the container spec so this is
   an extension, not a retrofit.

5. **The serializer never crashes.** An unserializable value is a diagnosable
   error naming the slot and the type, not `Seroval Error (step: 1)`
   (solidjs/solid#2966's presenting symptom). With cases 1–3 unwrapping
   reactive values into their traces, this remains only as the guard for
   genuinely unserializable *outputs*.

Rejected alternatives, for the record: **holding** (deferring the slot record,
or the stream, on one arg — coarse, and contradicts case 1's granularity);
**resolving passed primitives server-side to dead values** (two suspension
sites for one kind of data, and updates the source produces later in the
response would be dropped); **write-once expressions** (settle at first
successful evaluation, then latch — a liveness cliff between `value={memo()}`
and `value={memo}` that no client border has; superseded by response-window
bindings); **persistent channels** (duplicate re-invocation with worse
lifetime semantics); **snapshot-per-frame dedupe** (stale back-references,
above). Server-content async (`<Loading>` inside server JSX)
is a different async and keeps the fragment model wholesale: one is markup the
server owns, the other is data the client owns.

**Status — the value tier (case 2) is implemented** (`dr2-value-tier`
branches, dom-expressions + solid, verified end-to-end in the chat example):

- *Server:* the record never waits — promises and async iterables serialize
  through the codec as pending data refs (seroval streams resolutions/yields);
  a not-ready thunk ships via retry-until-settled and rejections ride the data
  channel, never the stream face.
- *Client:* the slot-props proxy routes an async-valued prop through a lazy
  async memo under the occurrence's owner, so the read suspends into the
  covering boundary and, for iterables, IS the latest yield thereafter. Fresh
  call-driven mounts shell-gate (the covering `Loading` holds until the
  frame's first apply — content or error), giving a t=0 fill's pending arg
  read its boundary.
- *Typing:* `Slot<P>` deliberately keeps the fill's props settled;
  `asyncArg<T>(...): T` is the identity that types the async value at the
  border (widening `Slot`'s parameter would leak async unions into every
  fill's contextual typing).
- *Found under it:* signals' iterate loop assumed protocol-strict iterators;
  seroval's deserialized streams return buffered steps as bare
  `IteratorResult`s, which crashed the graph — fixed on `next` with
  `for await` assimilation semantics (plus the latent post-gap sync-settle
  drop). The value tier's consumption path depends on that fix.

**Status — the document face (t=0) has the value tier.** Everything
above was built call-driven-first; `createDocumentSlotProps` (the t=0
face, where the *server* is the consumer and the fill renders inline into
the document) predates DR-2, so its behavior was probed empirically and
then completed (`document-face-arg-tiers.spec.tsx`, solid-web server
suite; the shim-backed twins in the runtime's own
`frame-server-component.spec.js`):

- **Not-ready args were already handled — coarsely.** A thunk/getter
  throwing not-ready at the unwrap, or an eager call suspending in the
  component's render, propagates into the server component's own
  `<Loading>`: the section defers as a fragment and the retry delivers
  the settled value in markup. This is the "holding" alternative DR-2
  rejected for the stream face's granularity — the whole section holds
  instead of pending marks per arg — but at t=0 it is functional,
  orphan-free, and consistent with "markup is the snapshot." (One
  artifact: the retry re-invokes the slot, so the occurrence renumbers —
  markers and record stay consistent with each other.) Pinned as passing.
- **Async values passed whole now suspend at the inline read.** The
  document face wraps them in a full async-aware memo (rxcore's
  `ssrAsyncValue`, implemented over the reactive core's server memo): the
  read throws not-ready into the engine's hole machinery — the covering
  boundary holds, the re-pull delivers the settled value in markup — and
  since the throw happens in the *fill's own* template hole, the holding
  is finer than the thunk case's whole-section defer. The record is
  untouched: the async value itself still ships there, its resolution
  streaming through the document's data scripts, so page markup and the
  adopted client's read now agree (previously the markup shipped an
  empty hole over a raw promise read — a hydration mismatch).
- **Async iterables tap their first yield** — one source, every reader:
  the inline read settles on the first yield (markup is the V1 snapshot;
  later yields are the adopted client's story, per §10 of
  generator-only-model.md) and the record ships the complete sequence.
  Both are SEATS on the runtime's shared multicast of the source
  (`shareAsyncIterable`, solid-js/server: one pump, a log trimmed to the
  slowest open seat, the last seat out closes the source) — the same seat
  the server component's own memo over that source takes, and the same one
  the border walk (`toBorderForm`) hands the serializer for an iterable
  nested anywhere in a memo's answer or a slot arg. A generator yields to
  one reader; under a render the serializer is rarely the only one, so
  every read the runtime makes goes through a seat. (Superseded: the
  first build's per-site replay wrapper — one cursor handed between two
  consumers — which left a third reader splitting the yields.) This is the
  first-value lock's semantics arrived at from the transport side.

Mode invariance holds at the border: the same authored crossing behaves
identically whether the mount is call-driven or the initial document.
The Case 1 ledger still does not run on the document sink — deliberate
("the document is a snapshot"; within-response liveness is exclusively
the frame render's story) — and the matrix's document-adoption suite now
carries the arg-tier rows on both halves (the inline server render and
the adopted client's record read).

**Status — case 1 (expression bindings) is implemented**
(`dr2-expression-bindings` branches, stacked on the value tier, verified
end-to-end through Solid's SSR compile). The watched tier is live: `<props.slot
thing={thing()} />` — the compiled getter, the common authored form — now
re-evaluates at every commit the response observes and re-emits the
occurrence's record when the value changed, for the response window. What
shipped, against the design above:

- *The ledger rides the sink*, as designed: bindings open after the
  occurrence's record emits, for every re-runnable arg that classified as
  data — compiled getters (captured from the property DESCRIPTOR, which also
  fixed a latent crash: a not-ready getter re-thrown from the classifier's
  catch killed the stream), author thunks, memos passed whole. Eagerly
  evaluated call-expression args (`props.slot({ thing: thing() })`) stay
  write-once — JS evaluated them before the border, same as any client call.
- *The commit funnel needs no dependency graph*, as designed, but its choke
  points are two, not one: settlements the sink already SEES (a data flush —
  a serialized promise resolving, an iterator yielding; a fragment
  resolving; a pending arg's retry succeeding) schedule the sweep directly,
  and settlements a server-owned render makes INVISIBLE (noHydrate
  serializes nothing — the HTML is the data) reach it through a `ctx.commit`
  hook the frame render installs and the reactive core pokes at its settle
  sites. Sweeps coalesce per microtask, bump the epoch once per batch, and
  are reference-equality gated per binding. Refs MINTED by sweeps are
  excluded from the funnel, so a getter returning fresh identities re-emits
  at most once per real commit instead of looping the response.
- *Server memos cache per epoch*, as designed, with one precision the design
  glossed: epoch recompute applies to **sync-valued** computes only (the
  sync memo path and full memos whose last result was plain). Async memo
  values advance through their own settle machinery — re-running them would
  mint new promises/iterators. Iterator memos get their liveness from a
  **ledger-gated pump**: in a server-owned render nothing consumes the
  iterator past the first value (there is no serialization tap), so when —
  and only when — `ctx.commit` exists, the core keeps pulling, advancing the
  memo's value and committing per yield. The pump never HOLDS the response;
  completion latches the last yielded value.
- *Document SSR keeps the first-value lock, deliberately.* The tapped
  (hydration-serialized) iterator path still never advances the memo's
  value: markup rendered from V1 must keep reading V1 or a mid-stream
  boundary retry bakes V2 into HTML the client claims against V1's replay.
  Within-response liveness is exclusively the frame render's story, where no
  hydration claim exists. This is the one place case 1 is narrower than "no
  liveness cliff anywhere": the cliff at t=0 document SSR is hydration's
  consistency requirement, not a missing engine.
- *Re-emission is wire-only, as predicted:* re-emitted records ride the
  existing slot-record protocol (changed scalars inline; changed objects
  under write-once VERSIONED refs, `arg:<occ>:<key>@<n>`), the client's
  live-props path applies them, and the value-tier async wrap already reads
  a re-shipped pending ref as suspend-with-latest — settled → not-ready
  re-enters pending-with-previous exactly as specified. The end-of-response
  latch runs one final synchronous sweep before `complete`, so a commit in
  the last flush still ships.
- *Two lifecycle edges intentionally deferred:* a superseded region does not
  yet close its bindings mid-response (the enclosing response's sweeps just
  find them equality-stable), and a never-successful binding HOLDS
  completion through its serialized pending ref (the value tier's existing
  semantics) rather than rejecting at truncation — the diagnosable-reject
  pattern remains the design for abort/timeout handling when that lands.

Case 3 (container traces) is built — whole containers on both faces, per
its build record above. Case 4 (async at container paths) and the parts
extension remain design-settled, not yet implemented; case 5's
diagnosable-error guard exists for function args and unserializable
outputs at the record path.

The load-bearing distinction the value tier left ("live = self-announcing,
latched = watched") is retired: watched values — memo reads, expression
evaluation, state mutated by async settles — are live within the response
window through the ledger, which was the missing engine. Async memos are now
fully in the shipped column: whole or evaluated, first success ships and
later commits re-emit. What remains latched is only what the design says
must latch: values crossing at t=0 document SSR (hydration's first-value
lock — since upgraded by Stage 4's `sc:live` channel, which makes the
document face live within its own response window; see §9) and anything
after the response window closes (cross-request updates are
re-invocation's, by architecture).

**Ratified: liveness is exclusive to the slot border — markup holes settle
once.** *[Superseded 2026-08-07 by the reactive pole (§9): live markup
holes generalize the ledger to insert positions, built as Stage 3
(call-driven) and Stage 4 (t=0). What survives of this record is its
boundary conditions — the explicit-authoring concern is answered by holes
being commit-driven and impurity-gated rather than implicit re-renders,
and the "value at render time" / document first-value-lock analysis below
carried forward into Stage 3/4's latch semantics.]* `<p>{iterMemo()}</p>`
in server component markup renders the value
the hole resolved with and never retro-updates; only slot args get the
ledger. The line is ownership, not implementation budget: a slot arg crosses
into the client's LIVE reactive graph — something exists on the other side
to apply an update, and re-emitting a record is a value update. A flushed
markup hole has no live consumer; "updating" it means re-rendering and
re-shipping markup, which is not an update but a NEW RENDER — and markup
that advances is deliberately an explicit authoring form (the
progressive-emission proposal's generator components, one snapshot per
yield), never an implicit property of reading an async value in JSX.
Implicit markup liveness would hold responses open and re-ship HTML without
any author intent visible in the code. The author story has no dead ends:
ticking *data* passes the async value through a slot arg to a client fill;
ticking *markup* is a generator component. One precision: within a frame
response "first value" means **value at render time** — a fragment that
renders late reads the memo's then-current value (the pump may have advanced
it), which is client time-semantics (a later render reads later state).
Document SSR alone pins the strict first value, because hydration's replay
starts at V1 and the claimed markup must agree. Two consumers, two
consistency contracts, each matching what is alive on the other end.

### DR-3: Classification precedes resolution (template detection stays tractable)

Two rules keep the sink's content-vs-data decision and reverse templating decidable:

1. **Async slot args are data-only.** The wire shape — an HTML placeholder in the
   stream vs. a data chunk — is fixed at markup-emission time; a placeholder cannot
   be inserted retroactively after surrounding markup has flushed. Therefore a value
   that cannot be classified synchronously is data by definition: async slot args
   must resolve to serializable values, never JSX. Async *server content* goes
   through `Loading`/fragments, where the placeholder exists by construction.
   (Function-valued args keep the existing "resolve, then classify" treatment — they
   *can* be resolved synchronously.)
2. **Async args are never reverse-templatable.** Rendered markup shows a settled
   value; the async wrapper type (`Promise`? projection? plain value?) is not
   recoverable from content. Async args always ship as typed records. This is a
   bounded single-copy concession (the settled value may appear in both markup and
   record when the wrapper's value is displayed), accepted because inferring wrapper
   types from markup is precisely the kind of guessing this pass exists to remove.

### DR-4: The document is the t = 0 frame (one reveal owner)

The document inline scripts (`$df`, `$dfl`, `$dfs`/`$dfc`, the deferred/held queues)
and the frame client (`#segmentReady`/`#revealSegment`/style gating) are two
implementations of one concept: *a keyed pending segment with prerequisites,
revealed when ready*. The dual ownership is what made "who may swap this
placeholder after hydration is done" unanswerable — #2964, the `_$HY.f` policy
patch, and #2967's `documentStreaming()` breakage are all this seam.

Adopted: **one buffer, one consumer.** The inline bootstrap stays a dumb recorder
(tiny, no policy): fragment arrivals, style counts, and data records go into the
buffer exactly as they do today. The frames store/flush model becomes the *only*
consumer: at runtime boot, document state drains into frame `""`'s store, and every
reveal — document fragment or frame segment — is the same readiness predicate
(content present + structural prerequisite + declared deps + style gate) evaluated
by the same flush. Boundary claims are store reads by the owning boundary, not a
side-channel policy negotiated between two runtimes. `_$HY.done`, the fragment-claim
registry, the held-fragment replay, and `boundaryMayArrive`-style heuristics all
dissolve: "may this swap apply" becomes "is this write's owner bound," the same
question every other store write answers.

**Stage 3 refinement — the buffer is a ledger, not a frame instance.** Two
constraints sharpen the implementation without weakening the axiom. First, the
0 B non-consumer budget (§6): plain streaming apps use document fragments
without importing frames, so the one consumer for *document* fragments must
live in the hydration runtime, not the frames bundle — frame segments keep
`#revealSegment` for frame transports (disjoint content, same model). Second,
the record set that answers "what may the document still deliver?" already
mostly exists: the serializer's `<id>_fr` writes are the DECLARATIONS, seroval's
`.s` status marks are SETTLEMENT, and one added inline mark (`_$HY.v[id] = 1`
in `$dfr`, recording — not policy) is REVEAL, valid across the pre-boot window.
The hydration runtime owns the ledger (declared → settled → revealed, plus its
post-boot claimed/held policy state) and publishes it as `_$HY.fr`
(`{ pending, subscribe }`): the frames client's document adoption reads
"may a boundary still arrive" and learns of reveals from the ledger — the
`pl-*` document scans and the `_$HY.fe` monkey-patch delete. One scoped residue:
a settled-but-unswapped fragment (style-gated, retry-queued, reveal-grouped,
policy-held) reads as pending via its content template's continued presence —
a per-id `getElementById` at query time, an id-table lookup rather than the
tree scan this replaces. Pre-boot reveals stay inline mechanics ($dfr): before
the runtime exists there is no second writer, so no policy question — one
owner *at any moment* is the invariant, not one code location.

### DR-5: Identity-first reconciliation

The morph is currently position-first (two-cursor sibling reconcile) with a
frame-wide displaced-range index bolted on as a repair pass — grown across three
fixes (cross-parent relocation, teardown release, wholesale-insert restore, the
notes search-clear bug). Under A7 the index *is* the model: client-owned ranges
match by occurrence identity anywhere in the frame, and position governs only
server-owned nodes. The repair pass becomes the primary path; "a live range was
detached because its parent didn't match" stops being a reachable state.

---

## 4. Mechanism audit

Every mechanism in the current client surface, its axiom, and its disposition.
**Derived** = follows from an axiom, stays (possibly simplified). **Compensatory** =
exists to undo another mechanism's consequences; deletes with its cause.
**Presentation** = per-mount state, stays but is explicitly not content (see §5.4).

| # | Mechanism (current location) | Axiom | Disposition |
|---|---|---|---|
| 1 | Chunk→record store writes (`chunkToRecords`) | A3 | Derived — unchanged. |
| 2 | Multi-mount routing + pending buffer (frame host) | A3/A4 | **Done (Stage 2):** resident per-id stores; writes land mounted or not, mounts seed from the store. The pending buffer and sibling seeding deleted into it. |
| 3 | Retention snapshots (`snapshot`, last-unregister-wins) | — | **Done (Stage 2):** deleted — a warm store *is* retention. One residue: a last-unmount capture of a document-adopted interior (its content never rode chunks). Lifetime policy in §5.1. |
| 4 | HTTP pump (`applyFrameResponse`: `as`/`route`/restamp) | A3 | **Done (Stage 2):** responses apply as their call's address; the `route` map deleted (region roots address stores directly). |
| 5 | Version gating, policy A (stale-guard, not reset) | A3/A4 | Derived — unchanged, now explicitly per-address with client-stamped authority (§5.2). |
| 6 | Slot-record identity dedupe (`argsEquivalent`) | A5 | Derived, simplified: with one record shape the conservative `$ref` special-casing shrinks. |
| 7 | Prerequisite flush loop (`#flush`) | A6 | Derived — becomes THE reveal engine for document + frames (DR-4). |
| 8 | `frame:applied` event | — | Derived (router affordance) — unchanged. |
| 9 | Zero-allocation morph (`reconcileChildren`) | A7 | **Done (Stage 4):** identity-first (DR-5) — the reconcile records every wholesale-inserted root as a graft site. |
| 10 | Displaced-range index + stash/restore | A7 | **Done (Stage 4):** the index is the primary matching path; the O(frame) end-of-morph rescan (`restoreDisplacedRanges`) deleted into one walk over recorded graft sites (`flushGrafts`). |
| 11 | Root materialize vs morph split | A4 | Derived — unchanged. |
| 12 | Slot marker collection/parsing | A1 | Derived — unchanged. |
| 13 | Occurrence mount/re-call/unmount (`#syncSlots`) | A4 | Derived — unchanged in role; simpler inputs (A5). |
| 14 | Invoke context (`ctx`: adopted/invoked/existing/…) | A5 | Derived, shrinks: the `adopted` fork exists because t = 0 records differ (A5 removes the difference). |
| 15 | Live slot props (`ctx.onUpdate`, signal-backed proxy) | A4 | Derived — and generalized upward: the same "new binding, same instance" shape serves boundary rebinds (DR-1) and async arg updates (DR-2). |
| 16 | `#refArgsUnchanged` value-compare | A5 | **Done (Stage 2):** the #547 `$frame`-addition leniency deleted with unified records; the plain value-compare stays (it is the dedupe, not the patch). |
| 17 | `$ref`/`$frame` arg resolution + per-stream tables | A1/A3 | Derived; table scoping revisited under per-address stores (§5.2). |
| 18 | Region discovery from markup (`#discoverRegions`) | A5 | **Done (Stage 2, first half):** with A5, used regions have records on every transport; discovery remains only as claim wiring — and membership is now structural (outermost dotted id in this interior), not producer-prefix-matched, so address-keyed mounts adopt fn-id-prefixed markup. |
| 19 | Region bind/rebind/`renameRegion` (wire-id renames) | A3 | Compensatory: regions become store substructure keyed `(parent address, occurrence, arg)` (§5.3); wire-relative renames delete. |
| 20 | `hy.r` occlusion absorption (adopt-time fake chunks) | A5/A6 | Compensatory. Deletes: occluded content is ordinary records in the one buffer, drained by the one consumer (DR-4). |
| 21 | Segment reveal + placeholder discovery (`#revealSegment`) | A6 | Derived — and becomes the only implementation (DR-4). |
| 22 | Stylesheet gating + modulepreload | A6/L1 | Derived — unchanged, one instance instead of two. |
| 23 | Boundary-driven reveal seam (`options.reveal`) | A6 | Derived — unchanged. |
| 24 | Element claim sweeps (`CLAIM_SEAM`) | A2 | Derived — unchanged. |
| 25 | `<dx-frame>` element boundary | A4 | Derived — unchanged. |
| 26 | Dispose/rebind lifecycle (`FrameImpl.rebind`) | — | **Done (Stage 2):** rebind survives — but demoted from handoff protocol to delivery mechanics (the site's binding-follow effect calls it); dispose stays (teardown is disposal). |
| 27 | Address-keyed component registry (`byAddress` minting) | A3/A4 | **Done (Stage 2):** per-function components + per-address bindings (`COMPONENT_BINDING`, address as a second-argument accessor); `byAddress` is now a pure binding cache. |
| 28 | `COMPONENT_HANDOFF` brand + `forwards` map | — | **Done (Stage 2):** deleted. `dynamic` keeps its instance on component equality and delivers the address into per-site signals. |
| 29 | `ServerComponentPlugin` + flight codec refs | A1 | Derived — unchanged (component references serialize as addresses, never markup-as-data). |
| 30 | Single-flight application (`applyFlightResponse`) | A3 | Derived, simplified: regions address stores directly; no mount lookup, no per-frame `as`. |
| 31 | `slotsFor`/`claimRender`/reactive insert (Solid) | A2 | Derived; the claim-scope tracking hole (#2967's second bug) is fixed by construction: claims wrap the insert *call*, reads stay tracked. |
| 32 | Document boot: boundary index/claim/wait (`documentBoundary`) | A2/A6 | **Done (Stage 3):** "may a boundary still arrive" is the ledger's answer (`_$HY.fr.pending()`), reveal/exhaustion arrive by subscription; the `pl-*` document scans and `_$HY.fe` patch deleted. |
| 33 | Per-stream seroval tables (Solid `tables`) | A3 | Derived; keyed by address root (§5.2). |
| 34 | Boundary resume/scope capture (hydration.ts) | A2 | Derived — unchanged (multi-root hydrate is orthogonal). |
| 35 | Fragment reveal policy + claim registry (`_$HY.f`, `claimFragment`, `hasPendingFragment`) | — | **Done (Stage 3):** restructured into the fragment ledger (declared/settled/revealed/claimed/held, one Map) that also answers row 32 and detects truncation (§5.5); the ad-hoc claim/held Sets deleted into it. `hasPendingFragment` (claimRender's range-scoped template check) stays — the range is its own record. |

Score: 24 derived (several simplified), 8 compensatory deletions, 3 restructured.
The deletions are precisely the mechanisms with the worst bug-per-line record.

---

## 5. Settled questions

### 5.1 Store lifetime and eviction

A3 makes stores accumulate: preloads fill stores that may never mount. Policy:

- A store's lifetime couples to its **data-layer cache entry** where one exists: the
  transport exposes an eviction hook, and a `query`-wrapped call's cache eviction or
  invalidation evicts/marks the store. 1:1 addressing makes this coupling exact.
- For addresses never wrapped in a cache, the store follows the **response
  lifecycle + LRU floor**: bounded count, mounted-address stores are pinned,
  eviction of an unbound store is silent (a later bind refetches — the same behavior
  as a cold cache).
- Eviction of a *bound* address is not the eviction layer's call: teardown is
  disposal (the site unmounts), never a cache event morphing DOM (A3).

### 5.2 Versions, staleness, tables

- Versions are **per-address**, client-stamped at request time (the client is the
  only party that observes ordering across transports). Policy A is unchanged:
  stale writes drop, newer writes morph, teardown is disposal.
- A stream for address `A` racing a later refetch of `A`: the refetch's stamp is
  higher; the older stream's remaining chunks drop on arrival. No transition or
  navigation bookkeeping involved (solidjs/solid#2965's class is a version compare).
- In-flight streams for addresses no longer bound anywhere **write through** — they
  warm the store (arrival never touches DOM, so there is nothing to protect); actual
  request cancellation is the data layer's concern, not the transport's.
- Seroval cross-reference tables scope to the **response**, as today, but are
  indexed by address root rather than mounted-frame root (drops the mount lookup).

### 5.3 Regions under the split

A region is **store substructure**: identity `(parent address, occurrence, arg)`,
storage inside the parent address's store namespace. Consequences:

- The wire may still ship producer-relative child ids; they normalize to canonical
  region identity at the store boundary (one normalization, replacing scattered
  `renameRegion` calls at bind/resolve time).
- A parent rebind (site moves from address 1 to 2) leaves address 1's regions in
  address 1's store — retained with it, evicted with it. Region client state follows
  occurrence identity exactly as slot state does.
- Regions never register independently with the transport; nested `dx-frame`
  elements are mounts pulling substructure, so "route a region's async fragment to
  the region, not the root" (a shipped bug fix) becomes addressing, not routing.

### 5.4 Content vs presentation state

The store holds **content**: records, versions, completion/error. Everything
observable per-mount is **presentation**: segment-reveal progress, style waits,
fallback visibility, `frame:applied` reasons. The line matters for multi-mount
fan-out (two mounts of one address may be mid-reveal at different moments — reveal
state cannot live in the store) and it prevents the class of bug where a mount's
transient state leaks into retained content. Rule: nothing in the store references
DOM; nothing per-mount survives unmount.

### 5.5 Errors and truncation (L1)

- `:error` is content-level state in the store, per address+segment, cleared by a
  newer version's corresponding write (refetch-clears-error).
- `Errored` composes at the border exactly as `Loading` does: the mount surfaces the
  bound store's error state through the boundary seam; client boundaries decide UI.
- **Truncation is detected, not inferred:** a response ending without its terminal
  record marks every still-pending key of that version as truncated — an error-class
  store write (distinguishable from a server-sent error). **Document side done
  (Stage 3):** the parser finishing (DOMContentLoaded) is the transport's close;
  any `_fr` declaration still unsettled then is marked rejected with a truncation
  error, releasing its boundary through the normal rejection path and its
  document-adoption waiters through the ledger (closes solidjs/solid#2958 for
  documents). The sweep arms only when the runtime booted while the document was
  still streaming — a late-loaded runtime can't tell a completed page from a
  truncated one. Frame-stream truncation (pump ends without the root's `complete`
  chunk) lands with the `:error` content-state records above, not before them.

### 5.6 Head and assets

Head effects from server content ride the same shape as styles do today: **typed
asset records in the store, applied by the flush at reveal time**, deduplicated by
the head-management layer's identity rules (the in-flight head RFC owns element
identity; frames own delivery timing). Server components do not get a parallel head
mechanism. This seam is deliberately minimal until the head RFC lands; the only
commitment is that head effects are store records (A3) applied at reveal (A6).

### 5.7 Optimistic UI at the border

Single-copy has a consequence worth stating so users don't discover it as a bug:
**server content cannot be optimistically updated** — the client has no template to
re-render it (A1, A2). The blessed pattern: optimistic state lives in client slots
(which can overlay, badge, strike-through, or hide server content); server content
itself settles when the mutation's single-flight response morphs it. The transport
guarantees the two compose: a slot's optimistic state survives the settling morph
(A7), so the overlay never flickers. (Stage 7 refines, not repeals, this line:
transaction-scoped predictions may temporarily perturb server-rendered DOM,
re-asserted over every authoritative apply and evaporating at settlement — the
invariant that only server records make output durable stands. See §9.2.)

### 5.8 Producer-side symmetry

The sink gets the same audit in Stage 2/3 implementation:

- **Record shape (A5) lands server-side first**: t = 0 document emission writes the
  same slot/region records a stream would (used regions included), into the one
  buffer. The occlusion-lock machinery simplifies to "content not rendered by the
  wrapper ships as records" — one rule, no lock negotiation.
- Document assembly emits frame `""` (DR-4): the existing `$df`-family scripts
  become arrival recorders; policy code in inline scripts deletes.
- Per-root boundary scopes and hole-owner ids are unaffected (they serve A1/A2).

---

## 6. Size budget

Derived from the mechanism set, not ratcheted from actuals. Current measured
(min+gzip, CI-guarded): **8,228 B** full frames consumer, **1,097 B** morph
slice. Stage 2 delivered −402 B against the 8,610 B it started from: A5's
consumer patches −98, the resident-store host −88, the identity split −216
(handoff/forwards/route-map deleted, net of the binding wrapper). Stage 4
(DR-5) cost +20 consumer / +30 slice: graft sites recorded at insertion are
a *derived* mechanism (rows 9–10) — the by-construction guarantee costs the
recording, against which the deleted rescan was slightly smaller but O(frame)
per apply and scan-based ("roughly size-neutral" below was optimistic by 30 B;
the slice stays under its ≤ 1,100 budget). The #2968 deferral (+105 inside
these figures) stays until record delivery is ordered by construction; the
remaining distance to the ≤ 7,800 B budget is row 20's `hy.r` occlusion drain
and that deferral — both gated on the document sink emitting frame-shaped
records (producer work deferred to the wire freeze).

Deletions and simplifications from §4 (handoff stack, retention snapshots,
`#refArgsUnchanged`, `hy.r` absorption, rename machinery, reveal-policy glue,
registry restructure) remove machinery; DR-1's binding delivery and DR-2's async
revive add small derived mechanisms. Budget:

| Scenario | Budget | Rationale |
|---|---|---|
| frames: full consumer | **≤ 7,800 B** | ≥ 700 B of compensatory machinery deletes; new derived mechanisms are ≤ 200 B combined. |
| frames: morph slice | **≤ 1,100 B** | Identity-first restructure is roughly size-neutral (index becomes primary, repair pass deletes). |
| non-consumer | **0 B** | Unchanged: apps that don't import frames pay nothing. |

**Ratchet rule (replaces "actual + headroom"):** a ceiling increase requires a new
mechanism row in §4 citing its axiom. A fix that needs bytes without a new mechanism
is compensatory by definition — fix the cause instead.

---

## 7. What this supersedes

- Contract §3 in `server-components.md` ("Boundary identity is the call") is
  superseded by DR-1: *content* identity is the call; *mount* identity is the site.
  §3's cache-honesty guarantee (per-args stores 1:1 with cache entries, retained
  re-materialization) is preserved verbatim.
- The `_$HY.f` reveal-policy routing (`0.50.0-next.35`) is an interim step that
  DR-4 replaces wholesale.
- `frame-streams-rfc.md` §"Versioning" gains the per-address, client-stamped
  clarification of §5.2; §"Slot usage tracking and the streaming-occlusion case"
  is superseded by §5.8's one-rule record shape.
- The open questions in Solid RFC 11 (`documentation/solid-2.0/11-server-components.md`)
  resolve as: reverse templating — constrained by DR-3; router retention — absorbed
  into A3/A4 (warm stores); template/block payload mode — unaffected, still a
  post-stabilization optimization; stabilization criteria — this document's
  implementation (Stages 2–4) plus wire freeze.

## 8. Staging

1. **Interim triage** (pre-derivation architecture): land the solidjs/solid#2967
   fixes and #2968 — user-facing breakage doesn't wait for redesigns. Annotated
   below:
   - #2967 fix 1 (`boundaryMayArrive`): does **not** survive — DR-4 deletes the
     heuristic it improves. Land it anyway; correctness now matters.
   - #2967 fix 2 (claim wraps the insert call): **survives** — it is the derived
     shape (audit row 31).
   - #2968 (records resolvable before adopt sync): the *symptom* fix is interim;
     A5 removes the timing skew that causes it.
2. **Stage 2 — DR-1 + A5** (identity split + record shape) in dom-expressions and
   `@solidjs/web/frames`. Wire changes acceptable; the feature is experimental.
   **Done:** A5 producer (t=0 records stream-identical, every region as a
   `$frame` ref) + consumer patch deletions; resident-store host (buffer/
   retention/sibling-seeding subsumed); identity split (per-function
   components, `COMPONENT_BINDING` bindings, per-site delivery in `dynamic`,
   `followBinding` → `rebind`; handoff/forwards/`documentComponent`/route-map
   deleted). Verified end-to-end on notes + hackernews (navigation, search
   state retention, single-flight save, rapid history, preload isolation).
3. **Stage 3 — DR-4** (one reveal owner). Touches `server.js` inline scripts and
   Solid hydration; the largest single surgery.
   **Done** (as refined in DR-4 above): the fragment ledger in Solid's hydration
   runtime (declared `_fr` records + seroval settlement + the inline `_$HY.v`
   reveal mark) published as `_$HY.fr`; frames document adoption reads/subscribes
   instead of scanning for `pl-*` templates and patching `_$HY.fe`; document
   truncation detection (#2958). Remaining under this decision record: frame-side
   truncation (with §5.5's `:error` records) and row 20's `hy.r` occlusion drain
   (deletes when the document sink emits frame-shaped records — producer work
   deferred until the wire freeze forces it).
4. **Stage 4 — DR-5** (identity-first morph).
   **Done:** the reconcile records each wholesale-inserted subtree root at
   insertion (through nested morph levels), and one post-reconcile walk
   (`flushGrafts`) swaps bare marker pairs in those subtrees for live ranges
   from the index — every place a range could be owed is on the list by
   construction, so no full-frame repair scan and no reachable "detached
   because the parent didn't match" state. `restoreDisplacedRanges` and its
   frame-wide `collectSlots` rescan deleted; range placement unified in
   `placeRange` (stashed fragment vs attached start).
5. **Re-verify** (notes, hackernews, hackernews-spa end-to-end), set §6 budgets as
   the CI ceilings, close the issue sweep.
   **Done, with one residual:** all three examples verified end-to-end post-DR-5
   (notes: search filter/clear with expansion state, single-flight save, viewer
   intact through list morphs; hackernews: rapid top-level nav without blank
   pages, comment threads through back/forward, pagination, hover-preload
   isolation; hackernews-spa baseline: list/item round trip). Issue sweep:
   #2958/#2964/#2965/#2967/#2968 closed; #2966 stays open by design (DR-2's
   async-args tiers are the plan of record for it). CI ceilings are ratcheted
   to actual+20 (8,248 / 1,117) rather than set to the §6 budgets — the
   ≤ 7,800 consumer budget is unreachable until the two producer-gated
   deletions land (row 20's `hy.r` occlusion drain and the #2968 deferral,
   both waiting on document-sink frame-shaped records at the wire freeze),
   so pinning it now would just fail CI without forcing the right work.

## 9. Roadmap after DR-2 (revised 2026-08-07)

§8's stages are the derivation-architecture build and are complete. This
section is the forward roadmap from the DR-2 merge onward; its stage
numbers are the working vocabulary and are distinct from §8's.

The reactive pole is **ratified** (2026-08-07; the lean and its reasoning
are recorded in `generator-only-model.md` §9). Live markup holes — the
binding ledger generalized from `(occurrence, arg)` slot bindings to
insert positions — are the plan of record; the generator-only model is
retired as a pole and survives only as potential authoring sugar.

1. **Stage 1 — Close out DR-2.** **Done.** The value tier on both faces
   (call-driven; document face via the `ssrAsyncValue` rxcore seam), the
   Case 1 binding ledger with commit-epoch sweeps and server memo
   liveness, `asyncArg` border typing, the arg-tier matrix rows, and the
   chat example. Merged to `next` and released.
2. **Stage 2 — Ratify the pole.** **Done** (decision, not build): the
   reactive pole, ratified 2026-08-07.
3. **Stage 3 — Live holes, call-driven face.** **Built (2026-08-08, the
   `live-holes` branches) — the ship line.** After this stage the model
   is announceable: the complete reactive story for everything after
   load, standard SSR semantics at load. What shipped, per the scope:
   - Ledger generalization: **done.** Thunk-compiled content holes in
     live frame renders wrap in identified comment pairs
     (`<!--lh:N-->…<!--lh:/N-->`) and open ledger bindings; commits
     re-run them, equality-gate the resolved HTML (marker-stripped
     baselines), and re-emit changes as keyed `hole` chunks the client
     morphs in place. Convergence is commit-driven and impurity-gated:
     an evaluation that emits records or creates reactive scopes latches
     (the record gate and the rxcore creation stamp), retry chains
     resolve mint-suppressed (`$lhSuppress` through `buildAsyncWrap`),
     and boundary/slot machinery is `$lhSkip`-tagged out.
   - Content holes + the chat slice: **done.** The chat demo streams
     markdown token-by-token through a `<Loading>`-wrapped iterable-fed
     `innerHTML` hole, no client component; `ctx.hold()` keeps the
     response window open for bounded async traces.
   - Attribute holes: **done.** Markers can't sit inside tags, so a tag
     with in-tag thunk holes is element-addressed: `ssr()`'s position
     scan (extended with per-segment tag geometry) splices
     ` data-lha="N"` at the tag open and captures the attribute area as
     re-runnable parts — including positions dequeued from
     cross-element `ssrGroup` batches, split per element. Rebuilds ship
     as element-keyed `attr` chunks with explicit `removed` name lists
     (the server holds the previous text; the client tracks no name
     history) and the client patches the addressed element in place.
     Mid-attr escalations latch the tag.
   - Lifetime and error semantics: **done, one scoped deviation.**
     Stream end latches (the end-latch sweep is the floor); supersession
     spans evaluation (`ssr()` resolves interior holes at construction,
     so nested mints land in the parent's retire list — a parent
     re-emission retires the child ranges it replaces); a mid-window
     throw is terminal — the hole latches at its last markup and the
     failure ships as a hole-keyed error chunk, surfaced client-side as
     a one-time diagnostic. The deviation: "escalates to the owning
     boundary" is deferred — true escalation means boundary-region
     re-emission (server) or a frame error-throw surface (client), and
     the latter does not exist for ANY error tier yet (stream-level
     `:error` only releases gates today). The hole-keyed error record is
     the hook that surface will consume when it lands.
   - The t=0 latch: **done and pinned** — document renders mark nothing
     and inject nothing; bytes are untouched (first-value lock).
     Correct-but-static is the accepted degraded mode at t=0; catch-up
     liveness is Stage 4's upgrade, not a Stage 3 repair.
   - Matrix rows and docs: **done** — engine cells in dom-expressions
     `frame-live-holes.spec.js`, integration cells in solid-web
     (`frame-live-holes*.spec.tsx`), rows in the lifecycle matrix's
     "Live markup holes" section.
4. **Stage 4 — Liveness at t=0.** **Built (2026-08-09, the
   `document-liveness` branches).** The t=0 design made real: hole
   markers and `data-lha` addresses armed in document renders inside
   server component scope (plain document content keeps its exact
   bytes — the scope barrier); ops ride ONE `sc:live` channel record,
   serialized eagerly; adoption reconstructs the morph substrate from
   page bytes; catch-up replays ops that landed before a boundary
   adopted (geometry-routed); document ops go quiet when a call-driven
   version supersedes them; the end latch ships last values and closes
   the channel before flush. Case-1 getter args are live at t=0 too:
   document arg bindings re-emit fid-tagged `slot` ops on the same
   channel. Fill interiors are mint-suppressed (client-owned; the
   record is their liveness story).
5. **Stage 5 — Container tier (DR-2 case 3).** **Built (2026-08-10, the
   `container-traces` branches).** Projections cross the slot border as
   bounded async traces on both faces; the client materializes them
   into live read-only projections. See the case-3 build record in DR-2
   for what shipped and the scope lines (whole containers this round;
   parts and case 4 remain the designed extensions).
6. **Stage 6 — Behavior across the border: ref props and event
   props.** **Next build target (re-scoped 2026-08-18; supersedes
   the 08-16 predictions design, whose surviving model moved to
   Stage 7; the 08-13 claims sketch was folded in and then cut the
   same day — claims stay internal, see §9.1).** Functions already
   cross the slot border as render props; Stage 6 completes the
   taxonomy: a slot-arg function in *ref position* on a server
   element delivers the element to the client closure — typed
   through the server component's props, claim-engine lifecycle
   (fire on adoption, re-fire on morph re-materialization), owner
   and cleanup from the passing scope — and *event position*
   resolves through delegation at dispatch. The transform is behind
   the server-components compiler option (non-SC apps compile
   byte-for-byte as today); with it on, SSR cost is gated at
   evaluation by the render context's frame flag. One grammar: a
   prop, used in a JSX position — interactive elements are authored
   as JSX (hole thunks interleave `innerHTML` content with real JSX
   affordances), so no attribute-claim author surface exists. More
   fundamental than optimism and lands first: no transaction
   machinery, the claim engine already exists, and event wiring /
   third-party mounts / observers justify it standalone. Retires
   `$ref`/`frame.refs` as author surface. See §9.1.
7. **Stage 7 — Predictions.** **Design settled 2026-08-18 after a
   same-night four-shape search (§9.2's decision record): one
   declarative verb.** `predict(anchor, patch)` — transaction-scoped
   claims about server markup, anchored by elements in hand (Stage 6
   event/ref props; no names, no frame handle). The patch vocabulary
   is JSX attribute semantics (per-key baselines captured at apply,
   re-asserted over authoritative applies via the claim sweep,
   baseline-restored at settlement) plus four relational content
   keys — `before`/`prepend`/`append`/`after` — whose JSX renders
   under a transaction-scoped owner into foreign ranges the morph
   flows around; removal is their entire undo. No snapshots
   anywhere; `children` replacement is excluded by that rule.
   Content-key nodes persist across morphs, so predicted content may
   be interactive — the old display-only caveat is repealed.
   Substrate shipped 2026-08-15: keyed element matching in the morph
   (`$key` → `_key`). See §9.2. **Amended 2026-09-22 (§9.2.1):
   settlement is convergence** — a prediction settles when the
   authoritative markup agrees with it (keyed content matched,
   attribute value asserted), on any arrival path; pending indicators
   settle with the transaction. No watermark, no dependency on Stage 8.
8. **Stage 8 — Connection-shaped transport.** Promoted from parked: the
   sink-lifetime separation means SSE/socket transports turn the same
   authored component non-terminating (generator-only-model.md §9,
   "transport-indifference"). Includes making the discipline
   enforceable, not just documented: the live graph is a re-derivable
   projection of durable state — reconnection is re-invocation, and dev
   should surface violations. Seed recorded 2026-08-17 (§9.3): no new
   APIs on either side — a connection is a response that doesn't end;
   resume is supersession with settled emission; the document face is
   bounded by an opt-in window; mutations settle against a watermark.
   The related data-API question (top-level async iterators from plain
   `"use server"` calls) is scoped separately and comes first.
   **Design drafted 2026-09-22 (§9.5); pulled ahead of Stage 7.** The
   data-API prerequisite has landed (`live()` in
   `@solidjs/web/server-functions`, with its reconnect loop), and a
   frame render already stays connected to any unbounded source it
   reads — what is missing is the warranty. The design revises the
   seed on one line: liveness is declared, by `live` at the export,
   not observed — `live` extends to the response's lifetime (RFC 10)
   so nested-async answers and server components are one case, and
   frames consume its loop rather than mirror it. The transport is
   today's per-source stream framed as server-sent events — no
   declaration, no configuration; a backend that holds connections
   over HTTP/2 is the precondition. The seed's watermark (causal settlement for Stage 7) is retired:
   settlement is convergence (§9.2 amendment), and the two stages are
   independent. Plan: `documentation/plans/stage8-connection-transport.md`.

Ordering note (revised 2026-09-22): Stage 8 now precedes Stage 7,
and the two are independent. The 08-18 reasoning below still holds
for Stage 6; what changed is that `live()` shipped, which both
satisfied Stage 8's prerequisite and created an asymmetry — a
stream consumed on the client through `live()` reconnects, while a
server component reading the same feed on the server goes silently
static when its response dies (and so does any nested stream inside
a plain answer, which is the same gap one level down). Stage 8
closes that gap by extending `live` rather than adding beside it,
and completes the story (t=0 document → post-load liveness →
liveness that survives the connection). The
08-18 note's one coupling — "Stage 8 must eventually add causal
settlement" for predictions — is retired: predictions settle by
convergence (the §9.2 amendment), which needs nothing from the
transport, so neither stage waits on the other. Stage 8 first because
it completes a story; Stage 7 can land before, after, or alongside.

Ordering note (revised 2026-08-18): Stage 6 is the next target and
now *precedes* optimism — it is dependency-shallow (a compiler round
plus the existing claim engine; no solid-core or transaction changes)
and carries standalone value (event wiring, third-party mounts, the
chat demo's copy button). Stage 7 consumes Stage 6's anchors and its
re-assertion rides the same sweep. Stage 8 is independent afterward; it
must eventually add causal settlement (a mutation's transaction
remains open until the separate connection has applied its
authoritative frame version), but Stage 7 is first proved against
today's simpler single-flight ordering, where the response morph
lands before the action transaction settles.

**Parked here (2026-08-11), state of the world for whoever resumes:**
Stages 1–5 are built, merged to `next` in both repos, and released
(dom-expressions `0.50.0-next.41`; the paired solid release verified
against it — full suites plus browser passes over the chat and notes
examples). Nothing is in flight: no unmerged branches, no uncommitted
work; the `container-traces` worktree branches (`solid-dr2/`,
`dom-expressions-dr2/` siblings of the main checkouts) are fully folded
into `next` and exist only as workspaces. Development pairing
convention: solid's `pnpm-workspace.yaml` gains a
`'@dom-expressions/runtime': link:../dom-expressions-dr2/packages/runtime`
override marked DO NOT COMMIT; commits that touch the lockfile drop the
link, run `pnpm install --lockfile-only`, commit, then restore it.
Release-order invariant: dom-expressions publishes before solid bumps
its pins; solid's turbo cache can report a suite green without running
it — force-execute `packages/solid-web` and `packages/solid` tests when
verifying a release.

Still parked, deliberately: generator authoring sugar (the ledger's
supersession is already generator-ready); per-hole diff emission as a
wire optimization (contained by hole scope; adopted only where
measurement earns it). The chat demo's honest form sharpened the diff
case (2026-08-10): one hole over a growing reply re-ships the whole
rendered message per yield — O(n²) bytes over a generation for a few
words of new information each time. The first rung is NOT general
diffing (markup holes have no patch recorder; a wire diff would have to
be computed — the same line that parked the generator model's
server-side diffing): streamed text is append-mostly, and the hole
binding already retains its last emission for the equality gate, so a
prefix check yields an `append` op that ships just the tail, falling
back to full re-emission + morph whenever the prefix breaks (a code
fence closing retroactively). Additive to the chunk protocol; adopt
when measurement earns it.

### 9.1 Stage 6 design — behavior across the border: ref props and event props (2026-08-18)

Collapsed out of two prior sections during the 2026-08-17/18 design
pass (Dev's ref-prop sketch; the SSR-cost resolution that followed):
the 2026-08-16 predictions design that previously lived here is
superseded — its surviving model moved to §9.2 (Stage 7) — and the
2026-08-13 generalized-claims sketch that lived in §9.2 was folded
in as a "class direction" for a few hours before being cut the same
day (the internal-claims section below records why; the sketch
survives in git history). One grammar remains: a prop, used in a
JSX position. Stage 6 also moved *ahead* of optimism in the roadmap:
it is dependency-shallow (one compiler round plus the claim engine
that already exists — no transaction machinery, no solid-core
changes) and carries standalone value. Names remain provisional.

**The reframe that makes this one stage.** Functions already cross
the slot border: a function-valued slot arg *called* during server
render is a render prop — the call becomes a slot record, the client
executes the real closure, and the output fills the marked range.
The closure never ships; a coordinate does. Stage 6 completes that
taxonomy with the two remaining use sites, riding the same
occurrence/binding bookkeeping:

```text
use site         server emits                    client resolves via
────────         ────────────                    ───────────────────
called           slot record (id + args)         a range it renders into
ref position     claim marker on the element     claim engine (per-element scope)
event position   claim marker on the element     delegation (dispatch-time lookup)
```

One exposure story covers all three: what ships is never behavior,
only an address where behavior resolves from the passing scope. But
the two marker positions resolve through different machinery, and
the split is a real tiering (2026-08-18): events are the cheap,
common tier — no per-element lifecycle at all — while refs are the
powerful tier that pays for one.

**Ref props — the instance direction, typed.** The server component
uses a function prop in ref position; the client passes a closure:

```tsx
// client
<CodeBlock copyBtn={el => {
  const onClick = () =>
    navigator.clipboard.writeText(el.closest("pre")?.textContent ?? "");
  el.addEventListener("click", onClick);
  onCleanup(() => el.removeEventListener("click", onClick));
}} />

// server
function CodeBlock(props) {
  return <pre>
    <button ref={props.copyBtn} aria-label="Copy">⧉</button>
    <code>{highlighted}</code>
  </pre>;
}
```

This **replaces `$ref` strings and `frame.refs` as author surface**
(the 2026-08-16 addressing decision is superseded; the index
machinery survives internally, below). Coordination moved from a
stringly name resolved through a frame handle into the props
contract: the component's signature *declares* the handle, TypeScript
checks both ends, and there is no handle to acquire — the
`ServerComponent<P>` generic widens from "every prop is a `Slot`" to
"every prop is a `Slot` or a behavior function." Under the hood
nothing is new: the server recognizes a cross-border function in ref
position and emits a marker attribute (`_hk` family) whose value
indexes the occurrence's existing binding table — occurrence-scoped
by construction, so two instances of one component never bleed, and
an element carrying several bindings packs one attribute. Lifecycle
is the claim engine's, which is exactly the contract behavior wants:
fires per element (several elements may take the same prop), on
adoption and on morph re-materialization (new element identity → the
old per-element scope disposes, the callback re-runs, listeners
re-attach), NOT re-fired when an attribute patch lands on a
surviving element. The owner is the client component that passed the
prop, so `onCleanup` works and context resolves.

Two contract lines that fall out (2026-08-18). *Function form only*:
client Solid's assignment refs (`ref={myEl}`, `ref={els[i]}`)
compile to assignments and cannot cross the border — the
`ServerComponent` type says `(el: T) => void`, not `Ref<T>`. And
*no array refs*: the array idiom exists client-side because refs
fire once with no departure hook, but an ordered array is precisely
what morphs make a lie (after a reorder, insertion order no longer
matches document order — the misattribution `_key` just fixed,
reborn in userland). The claim lifecycle is richer — per-element
fire with cleanup — so N-element uses are per-element bodies, and a
genuine collection is a Set maintained by the same pattern
(`add` in the callback, `delete` in `onCleanup`). Nothing special
ships; the pattern is documentation, a helper only if it earns
itself later.

What refs buy beyond Stage 7's anchors — with event wiring now the
delegation tier's job, refs keep the element-in-hand-at-
materialization set: third-party mounts (chart/editor/map
libraries that want a DOM node, which server markup could never host
before); observers and measurement (`IntersectionObserver`,
`ResizeObserver`, focus management, scroll anchoring); persistent
client islands — client content living inside server markup mounts
through a real mount site fed by the ref prop (a `Portal` whose
`mount` is a ref-delivered signal, re-targeting when the claim
re-fires), NOT by hand-rolling `insert` inside the callback: a claim
callback is behavior attachment, not a mount, and it re-fires
(corrected 2026-08-18 — transaction-scoped optimistic content has
its own, lighter path: §9.2's content keys). At the limit a
client component is **pure behavior**: no markup of its own, a bag
of functions handed to a server component — the server owns
structure, the client owns interaction. That is the resolved form of
the Datastar comparison: they attach behavior through attributes
interpreted by a global runtime; we attach it through typed props
that resolve to real closures with owner, context, and cleanup.

**Event props — the same marker, delegated (mechanics revised
2026-08-18, superseding the same-day per-element-attach lean).**
`<button onClick={props.onCopy}>` on a server intrinsic emits the
same marker as a ref — but resolution is dispatch-time, not
lifecycle-time. The tell was the list case: one `onToggle` prop
serves N rows with identity read off the element (`data-id`, the
`_key` already there) — one handler, many elements,
identity-at-the-element *is* delegation, so the implementation
should literally delegate. No `addEventListener` per element:
the existing delegated-event up-walk (the same seam client Solid's
`delegateEvents` uses, which the router already sequences itself
after) additionally checks the marker attribute and resolves the
occurrence's binding table at dispatch. What falls out:

- *Zero per-element machinery.* Nothing attaches, so morphs have
  nothing to re-attach — the marker rides the markup through every
  re-materialization for free, and the claim sweep never touches
  event bindings.
- *Hole content gains event handlers.* The owner-creation latch
  means live markup holes cannot mint per-element claim scopes —
  but delegation needs none: a marker-bearing element arriving
  through a hole re-emission is live the instant it hits the DOM.
  Event props work in exactly the territory previously written off
  to attribute claims.
- *Solid semantics, not a third dialect.* Riding the client
  delegation seam inherits retargeted `currentTarget`,
  `preventDefault`/`stopPropagation` behavior, and ordering against
  the router's document-level handlers — a server-element handler
  behaves identically to a client-element handler, which largely
  dissolves the boundary-invisibility caveat this paragraph used to
  carry (the dead window before a frame's binding table arrives is
  what remains, and it is hydration's dead window, same answer).
- *Non-bubbling events keep the old plan.* `focus`/`blur`/media
  events can't delegate (same constraint as client Solid): those few
  fall back to per-element attachment through the claim path, or the
  bubbling variants (`focusin`/`focusout`).

Decided 2026-08-18: supported — a server component accepting `onX`
props reads exactly like normal Solid. The earlier "events are sugar
over the ref marker" framing inverted: events are the *cheaper*
tier, and by usage weight the bigger one (Datastar's catalog audit:
`data-on` is their interaction workhorse and maps entirely here;
their materialization tier — intersect/resize/scroll-into-view/init
— is the small set that genuinely needs refs; half their attributes
are the client-reactive-state layer Solid natively is, or `predict`'s
transaction-scoped slice of it). Refs remain the powerful tier for
element-in-hand at materialization: mounts, observers, measurement.

**The SSR cost story (settled 2026-08-18; opt-in amendment
2026-08-19): minimally detrimental by construction, and zero unless
asked for.** Handler expressions in SSR output are today dropped at
compile time, *unevaluated*. Behind a compiler option (the server
components flag — apps not enabling server components never get the
transform, and their SSR output compiles byte-for-byte as today),
the compiler round (Babel + Rust, the `$key` shape) emits a guarded
expression instead:

```js
sharedConfig.context.frame ? _$claim(props.onCopy) : ""
```

This is a compile-time capability flag with exact precedent in
`hydratable`, carrying the same known trade-off: modules precompiled
without the option can't offer ref/event positions inside an SC app,
just as non-hydratable precompiled code can't hydrate — acceptable
and established, since the plugin sets it app-wide and libraries
shipping source (the ecosystem norm) inherit the app's setting. With
the option on, the frame flag on the shared render context — the
established channel for ambient render mode (the async property,
hydration ids) — gates *evaluation*, not just output: normal SSR in
an SC-enabled app pays one property read per handler position and
the expression never runs (no new work, no new side effects,
byte-identical markup). Carrying the sink
reference on the context rather than a boolean makes the flag test
and the binding-table handle the same read. Inside a frame render
the brand test sorts values: cross-border function → marker into the
occurrence's binding table; anything else → empty string plus a
dev-mode warning naming the two exits ("this handler can never
run — pass it from the client's props, or bind a mutation to
`action=`"). The warning is runtime-only by necessity,
not laziness (2026-08-18): SSR compilation is context-blind — the
same compiled module serves hydratable SSR, where a local handler is
legitimate (the client compilation of the same source owns it), and
frame renders, where it's the mistake — so a static warning would
false-positive on every ordinary hydratable component. Only the
frame flag knows which face a render is on; the warning lives at the
same layer as the gate. The teachable line, with its one carve-out:
**requests may be server-authored (`action`/`formaction` serialize
to URLs and the router upgrades them through delegation);
interaction must be client-authored.** Zero client bytes for non-frames apps (the claim engine is
frames-bundle-only); markup weight only on elements that actually
claim. Pre-adoption clicks share hydration's dead window; if it ever
matters, root-level delegation for marker-bearing elements is the
known answer — deferred. In hydratable SSR the gate is closed by
scope (no frame context), so client-compiled hydration keeps sole
ownership of handlers — no double attachment.

**Claims stay internal (2026-08-18, second pass — the folded
attribute tier is cut).** The morning pass folded the 08-13
generalized-claims sketch in here as a "class direction" for content
not authored with props in scope; the evening pass killed it. The
attraction of this stage is that there is exactly ONE grammar — a
prop, used in a JSX position — and every rescue attempt for the
attribute tier reintroduced a second one (a `registerClaim` registry
with its own vocabulary; then a `claimAttr` string helper minting
markers in post-processing output, briefly). The load-bearing case
dissolved instead: **interactive elements are JSX — the pipeline
produces content, not affordances.** The chat copy button doesn't
need injecting into the markdown HTML string; the hole thunk
interleaves — prose ships as `innerHTML`, code blocks are real JSX
(`<pre><button onClick={props.onCopy}>⧉</button><code
innerHTML={highlighted}/></pre>`) — and this works inside a
streaming hole with nothing new: the thunk evaluates server-side,
the event marker is an attribute in the emitted HTML, delegation
resolves it at dispatch, and the owner-creation latch is irrelevant
because no per-element scope is needed. Ref props stay out of hole
interiors (they need the lifecycle the latch forbids); interaction
there is event-shaped anyway. The pure rule: **behavior means JSX
with a client prop. Content you won't parse into JSX gets no
behavior** — the escape is parsing it, not a registry.

What this kills as author surface, permanently: the `registerClaim`
public opening, the `data-*` affordance vocabulary and its tier
policy, the forward-polyfill program, the capability/context claim
form. The 08-13/14 sketches survive in git history (and remain the
reference if a future wave reopens the seam — nothing below
forecloses that; it is simply no longer plan of record). What does
NOT die: the element-claim seam itself (`registerElementClaim`,
`claimElement`, `claimElementTree`, `CLAIM_SEAM`) — it stays exactly
what it is today, frozen engine machinery with the router's link
layer as its one public consumer, gaining Stage 6's ref-marker
resolution as a second, *internal* consumer. Unnameable
post-processed content that needs *materialization-time* behavior
(an observer on every element of an injected string) is accepted as
unsupported.

**RC-freeze compatibility (2026-08-13, still binding).** The claim
trio is frozen public API — `@solidjs/web`'s client entry wholesale
re-exports the runtime client, so `registerElementClaim`/
`claimElement`/`claimElementTree` and their semantics (handlers
observe the navigation-relevant set: `a[href]`, `form[action]`) are
in the RC contract, with the router's `setupLinkClaims` as a live
consumer. Stage 6's internal ref-marker claim must route through its
own channel — the frozen `registerElementClaim` broadcast must NOT
widen to observe marker-claimed elements, or every frozen-API
consumer starts receiving element kinds the contract never promised.
Likewise the `CLAIM_SEAM` registered symbol (a flat handler array
shared across separately bundled — potentially differently
versioned — runtime copies) keeps its shape; the marker claim hangs
off its own registered symbol.

**Decide before stable (2026-08-13; the seam is movable during RC,
frozen after).** Two decisions harden at stable regardless of the
attribute tier's death, because the trio is frozen API either way:

1. *The navigation element set.* `a[href], form[action]` is baked
   into the frozen channel's semantics — consumer filters are
   written against it — and it is currently incomplete as a
   navigation contract: `area[href]` navigates, `button[formaction]`
   re-targets a form. Widening after stable changes what every
   registered handler receives. Settle the set during RC, or
   document it as closed and final.
2. *The seam global's shape.* `CLAIM_SEAM` holds a bare array shared
   across separately bundled — potentially differently versioned —
   runtime copies, so stable's shape is the wire format forever.
   Either reshape to an extensible object now, or commit to internal
   marker claims living on a second registered symbol (zero RC
   churn — the recorded lean).

**What died here (2026-08-18):** `$ref` and `frame.refs` as author
surface (the marker/index machinery survives as the internal claim
that resolves ref-prop coordinates); ref-only `Frame` acquisition
for behavior purposes; `$seam` was already dead; and — the evening
pass — the attribute-claim tier as author surface (`registerClaim`,
the affordance vocabulary; see the internal-claims section above).
`Portal` did NOT die — what died is its *addressing* (names through
a frame index): persistent islands still mount through it, fed by a
ref-prop signal, because a mount needs an owner, lifecycle, and
reactive re-targeting that a fire-again claim callback cannot
supply. `$key` is untouched — morph-only identity, no client-facing
role.

**The three load-bearing bolts (flagged spec-before-build in the
2026-08-18 audit; all three settled 2026-08-19 — Stage 6 is
build-ready):**

1. *Marker wire format — settled 2026-08-19: fully-qualified, one
   attribute.* Elements with cross-border behavior positions carry
   one marker attribute (`_bnd`, the `_hk` family) with grammar
   `_bnd="<occ>:<pos>=<row>[,<pos>=<row>]*"` — occurrence id, then
   position (lowercased event name, or `ref`) mapped to a row in
   that occurrence's binding table. Fully-qualified rather than
   ancestry-resolved, deliberately: encoding the occurrence id kills
   the nearest-occurrence-root walk (and its nested-region
   ambiguity) and stays correct for hole-emitted content wherever
   the DOM puts it. All positions on one element share one
   occurrence by construction — minted at one compile position
   during one occurrence render — so the id is paid once per
   element. Dispatch parses on first hit and caches keyed by the
   attribute's string value; morph rewrites invalidate by changing
   the string.
2. *Binding-table supersession — settled 2026-08-19: the risk
   dissolves into an invariant.* Rows are mint-order ordinals
   within one occurrence render (loops mint N rows, one per
   iteration — no compile-time-stable-index scheme survives loops,
   so none is attempted). The invariant: **markers in applied DOM
   always pair with the binding table of the same commit** —
   guaranteed by construction because the morph applier swaps the
   occurrence's table and patches the markup (including `_bnd`
   values on `_key`-preserved rows) in one synchronous step, and
   single-threaded JS means no dispatch interleaves. No versioning
   protocol needed. What remains is dispatch on nodes the morph
   dropped or detached mid-flight: row lookup misses, policy is
   drop + dev-warn (hydration's dead-window answer). Ref claims
   fire only from the post-apply sweep, so refs never see the
   window at all.
3. *Brand and composition rules — settled 2026-08-19: the stub is
   the brand.* A function-valued slot arg arrives server-side as a
   branded frame-function stub carrying its client coordinate —
   that is already what makes render props callable — so the
   evaluation test is stub-or-not, no new detection system. Branded
   → mint a row storing the coordinate (the same stub in multiple
   positions mints multiple rows to one coordinate, matching
   latest-props semantics). Unbranded function under the frame flag
   → empty string + the two-exit dev warning:
   `onClick={debounce(props.onCopy)}` on the server is a
   server-local closure and correctly fails — composition belongs
   on the client, before passing. Spreads: v1 recognizes named
   `ref`/`on*` JSX positions only; the SSR spread helper, under the
   frame flag in dev, warns on handler-bearing keys (static
   warnings are impossible — compilation is context-blind, as
   recorded above).

**Open questions (prototype-decidable).** The ref callback's cleanup
contract (returned cleanup vs ambient `onCleanup` — lean: both,
matching client refs); whether event sugar ships in the same
compiler round or the next; dead-window policy stated as drop
(hydration's answer) with root-replay as the known upgrade; the
per-node attribute check's cost on the shared delegation walk; the
re-fire dedupe contract for the internal marker claim (element-keyed
WeakSet is the obvious shape).

**As built (2026-08-20).** The implementation landed on both repos'
`ref-props` branches; where it diverged from the leans above, it
diverged simpler, and this paragraph is the record.

- *Bolt 1 dissolved into names.* The marker is
  `_bnd="pos=prop[,pos=prop]*"` — event type or `ref` mapped to the
  **client prop's name** (percent-encoded), not a binding-table
  index. Occurrence resolution is not a walk: the sweep that runs at
  every materialization/adoption/morph site stamps each marked
  element with its owning frame (`_$bndFrame` expando), so dispatch
  is expando → frame → `props[name]`, and hole-emitted content
  resolves identically to root content.
- *Bolt 2 evaporated.* With names addressing the frame's LIVE props
  there is no table to supersede — a dispatch after a props change
  reads the new function with no re-render, no version window, no
  misdispatch. The e2e pins this: flipping a signal the prop derives
  from swaps what the same DOM node's click resolves, morphlessly.
- *Bolt 3 shipped as specced.* The frame-function stub is the brand
  (`CLAIM_PROP`, carrying the original prop name for the marker);
  server-local functions in claim positions warn and drop; spreads
  carrying branded stubs warn at the spread site.
- *The compiler gate.* Babel + Rust emit, under `serverComponents`
  (set by the vite plugin's `serverFunctions.components`), a guarded
  hole: `sharedConfig.context.claims ? _$ssrClaim(map) : ""`. The
  gate value is an enum the SC entry points set — stream face
  unconditionally, document face scoped to SC renders — so hydratable
  document SSR outside server components stays byte-identical.
- *Arming is an option, not a global.* The size guard caught the
  first draft publishing `delegate` from the core client entry's
  module scope: that retained the whole event system in every
  tree-shaken subset (the router eager slice tripled). As landed,
  client.js contributes zero top-level bytes — the dispatch hook
  reads the registered-symbol seam from inside the delegation walk —
  and document-listener arming flows as `createFrameHost`'s
  `delegate` option, wired by platform glue to `delegateEvents`.
- *Refs fire owner-scoped, once per (element, prop).* v1 does not
  mint a per-element claim scope, but the sweep runs under the frame
  creator's ownerScope: effects, context, and `onCleanup` work inside
  the callback, with cleanups bound to the FRAME's owner — they run at
  disposal, not at element replacement (amended 2026-08-20; the first
  cut fired bare). Dedupe rides an element expando (a morph that
  replaces the element re-fires on the fresh node; in-place patches
  don't). Refs DO work inside hole interiors — the owner is the
  creator's, minted before the latch, so nothing trips it. Per-element
  scopes (cleanup at replacement) remain the known additive upgrade.
- *Proving case.* The chat demo's streamed markdown renders code
  blocks as JSX with `<button onClick={props.copy}>` — a client
  clipboard handler crossing into server markup that arrives through
  live-hole re-emissions, working mid-stream via the delegation
  path. §9.1 is implemented; what remains for the stage is release
  packaging (compiler binary sync, plugin release with the flag).

### 9.2 Stage 7 design — predictions: one declarative verb (settled 2026-08-18; supersedes the imperative-draft revival, overlays + entries, and the transactional draft)

Fourth and, by its structure, final form of this design. The
supersession chain compressed into one night's search once the
machinery was priced honestly, and the search record is the most
valuable thing on this page — four shapes were tried, and each wrong
one died on a *named cost*, which is how we know the survivor is a
minimum and not a mood:

```text
shape                            died on
─────                            ───────
imperative draft (mutate + add)  snapshot/restore/replay machinery —
  (08-14 seed; revived 08-18)    arbitrary mutation of server-owned
                                 nodes needs prior state; property
                                 writes are invisible to observation;
                                 restore must be a morph with property
                                 overrides. Died twice.
declarative patch + Portal       ceremony — mount site + optimistic
  entries (08-16)                store + row authored away from the
                                 action it predicts for.
patch + imperative additive      the split — two grammars for one
  body (08-18, hours)            concept; and a body exists only to
                                 place nodes, which is four words of
                                 vocabulary, not a function's worth.
patch + JSX-valued position      position-as-third-argument grows an
  argument (08-18, minutes)      hx-swap enum outside the patch.
```

The resolution: **placement is only four words, so it fits in the
patch.** One verb, one declarative shape:

```tsx
predict(el,   { checked: true });                              // mutation
predict(list, { append: <li class="pending">{title}</li> });   // creation
predict(row,  { class: "saving", after: <Spinner /> });        // both, one claim
```

The patch vocabulary is the element's JSX attribute surface, applied
by the same code path client JSX uses (`spread`/`assign` semantics):
`class`/`classList`, `style` strings and objects, plain attributes
including `data-*`/`aria-*`, the property-vs-attribute heuristics
(`checked`/`value`/`open` as properties), and the namespaced forms
(`attr:`/`prop:`/`bool:`) for free — **plus four relational content
keys**: `before`, `prepend`, `append`, `after` (the platform blessed
exactly this set: they are `insertAdjacentHTML`'s positions). An
author who can write a Solid attribute expression can write a
prediction; nothing outside that vocabulary exists to learn. Two
carve-outs, both dev-warned: behavior-shaped keys (`ref`, `on*`) are
excluded — behavior is Stage 6's job with its own element-scoped
lifecycle, and a prediction is a statement about state — and
content-destroying keys (`children`, `innerHTML`) are excluded by
the no-snapshot rule. `textContent` stays in with a stated edge: its
baseline is a string, a faithful undo only on text leaves —
predicting it on an element with element children is the `innerHTML`
violation in quieter clothes (dev mode checks `childElementCount`).

**Two rollback regimes inside one shape — why this is convergence,
not compromise.** Every claim a client can make about server markup
is one of two kinds, and they have different capture problems:

- *Mutation* ("this element will look different"). Rollback needs
  the prior state, and the only cheap, sound way to get it is for
  the author to declare which keys they touch — then baselines are
  bounded and captured per-key at apply time (`el.checked` read
  before written). This is precisely the data no other mechanism can
  reach: property writes fire no mutation records, and the morph
  deliberately preserves `checked`/`value`/`open` on matched nodes,
  so an undeclared property prediction would survive its own
  rollback. Declaration IS the rollback data — which is why mutation
  must be declarative, not why it's prettier.
- *Creation* ("new content will exist"). Rollback needs no memory at
  all — removal is the undo — and the engine built the nodes, so
  tracking is free without observing anything. Content-key JSX
  renders under a **transaction-scoped owner** into a
  marker-delimited range at the named position; the morph flows
  around it as foreign (the same skip slot fills use); settlement
  disposes the owner and removes the range.

The design invariant that falls out, worth guarding in review: **no
snapshots anywhere.** Which is also why the vocabulary has a
deliberate hole — there is no `children` key. Wholesale replacement
is mutation-shaped (it destroys server-owned content, so its undo
needs a snapshot). The line, stated for authors: *predictions
decorate and add; they never remove or rewrite what the server
rendered.* If a real case ever demands replacement, it is a
separately priced escalation tier, not a fifth content key.

**Anchors are elements in hand.** No names, no frame handle, no
index: the element arrives through Stage 6 — an event prop's
`currentTarget`, a ref prop's delivery — and entity identity travels
on the element (`data-id`, or the `_key` already present for the
morph). Per-entity ref naming schemes (`$ref={`check:${id}`}`)
dissolve entirely; the only ref props left are containers and
singletons, which retires the old "ref-name volume at HN scale"
wobble. The `_key` substrate is what makes an element pointer a
stable anchor: keyed matching preserves the node across reordering
morphs, so the common case never re-targets. Wholesale replacement
of an anchor is the uncommon case, and the claim engine's re-fire on
the replacement element is the re-target hook — attribute keys
re-baseline and re-apply; content ranges re-mount at their named
position.

**Same transaction wave (unchanged).** A prediction registers in the
current batch like an optimistic store write — visible immediately,
adopted into the action transition when that batch becomes one,
evaporating at settlement. Frames stay the third optimistic
participant beside signals and stores. Success and failure are one
code path: on success the settling morph's records already contain
the predicted state (attribute baselines are written back into
markup that now agrees; the authoritative row stands where the
pending range vanished); on failure the records did not advance and
the same restore/removal exposes them unchanged. Concurrent
transactions clear independently — A settling restores A's baselines
and removes A's ranges; B's predictions stand. Per-lane intent, no
inverse DOM patches.

**Re-assertion rides the claim sweep.** After every authoritative
apply that touches a predicted element — morph, hole update,
attribute record — attribute-key predictions re-capture baselines
from the fresh authoritative state and re-apply, so server updates
land *under* still-active predictions instead of erasing them.
Content ranges don't re-assert at all in the common case: they are
persistent foreign ranges the apply pipeline flows around. Which
repeals the old display-only caveat for them — the nodes are never
recreated, they have a real owner, so content inside a prediction
may be genuinely interactive (pending styling with live bindings, a
retry button that works).

**The settle race, answered by single-flight.** Does the "Sending…"
row coexist with the confirmed row? Under single-flight, no: the
confirming morph and the transaction settling are the same event, so
the range is removed in the tick its prediction comes true. The race
exists only when an out-of-band refresh lands mid-transaction with
the row already committed — a transient duplicate until settlement.
Entity-keyed settlement (matching a prediction to the authoritative
row that fulfills it) is deliberately NOT mechanism — it was the
overlay model's answer, and it required naming schemes this design
just deleted. Accepted, because it is stated. Stage 8's separate
connection needs the causal watermark (§9.3) before the single-flight
guarantee transfers. *(Amended 2026-09-22, §9.2.1: the watermark is
retired; off-response confirmation is convergence, which reopens the
entity-keyed ruling narrowly — see there.)*

**In-flight streaming (unchanged rule).** Authoritative updates do
not wait for optimism: every incoming chunk first advances the
authoritative records, the morph applies them (flowing around
prediction ranges), attribute-key predictions re-assert on the
result. `latest records + still-active predictions = visible DOM`.
One honest note on geometry: a prediction range parked *between*
authoritative siblings floats — it keeps its approximate position
(before its next surviving authoritative sibling) as the morph
inserts and reorders around it, not a guaranteed slot. Position-by-
DOM instead of position-by-model; for pending-row UX, the right
trade.

**Address-scoped (unchanged decision).** A prediction belongs to the
content address of its anchor, captured at write time — the DR-1
answer. Rebinding a mount to a new address never carries the old
call's predictions; rebinding back while the transaction is active
restores them; two mounts of one address show the same prediction.
The tier's honest boundary line stands: **predictions do not span
addresses.** An optimistic toggle against `getTodos("all")` does not
appear in `getTodos("active")`, though the server would reflect it
in both — the frame layer holds markup, not data. When optimism must
span multiple server renders or outlive a transaction, it is
data-shaped and belongs in a client store/projection (rendered, if
it must live inside server markup, through a ref-fed `Portal` — the
persistent-island path in §9.1, which remains available and simply
stops being the blessed path for transaction-scoped optimism).
Site-local state — focus, selection, an open menu — was never
prediction state; it stays with components and Stage 6 behavior.

**The worked case — TodoMVC add + toggle:**

```tsx
// ── server ("use server" component) ──────────────────────────
function Todos(props) {
  const todos = getTodos();
  return (
    <ul class="todo-list" ref={props.list}>
      <For each={todos}>{t => (
        <li $key={t.id} class={t.completed ? "completed" : ""}>
          <input type="checkbox" checked={t.completed}
                 data-id={t.id} onChange={props.onToggle} />
          <label>{t.title}</label>
        </li>
      )}</For>
    </ul>
  );
}

// ── client ───────────────────────────────────────────────────
const add = action(async (title: string) => {
  predict(list(), { append: <li class="pending">{title} <small>Sending…</small></li> });
  await createTodo(title);
});

const toggle = action(async (el: HTMLInputElement, completed: boolean) => {
  predict(el, { checked: completed });
  await toggleTodo(el.getAttribute("data-id"), completed);
});

<Todos list={setList}
       onToggle={e => toggle(e.currentTarget, e.currentTarget.checked)} />;
```

The optimistic row is one line inside the action it predicts for —
the colocation the imperative draft was chasing — and it makes no
attempt to mirror the server row (deliberately pending-styled), so
the "client fork that rots" failure mode has nothing to bite.

**Shipped substrate (2026-08-15, `keyed-morph`) — unchanged.** Keyed
element matching in the morph: `compatible()` requires equal `_key`,
so live element state — typed `value`, `checked`, `open`, focus —
follows the *entity* across reordering morphs. Shipped independently
(it corrected a live defect); here it is what makes element-in-hand
anchors stable and what keeps a prediction on the node it was made
about.

**Machinery ledger (the argument that settled the shape).** Net-new
engine code, all in known territory: the patch applier is the JSX
binding logic `spread`/`assign` already contain, wrapped with
per-key baseline capture; content keys are the fill machinery
(marker ranges, foreign skip — shipped) plus a transaction-scoped
`createRoot`; re-assertion and re-targeting are consumers of the
Stage 6 claim sweep; settlement hooks into the transaction machinery
solid already runs. Nothing from the imperative draft's expensive
tier — snapshots, restore-morph with property overrides, replay-wave
scheduling, per-run disposable roots, mutation capture — survives as
a requirement. dom-expressions owns the applier, ranges, and sweep
consumers; solid-web binds registration to Solid's transactions.

**Open questions.**

- Pre-materialization predictions: `predict` against an anchor whose
  frame hasn't adopted yet (queue until the claim delivers the
  element, or no-op with a dev warning). Lean: queue — actions can
  legitimately race adoption at t=0.
- Content-key naming: `before`/`prepend`/`append`/`after` vs the
  platform's `beforebegin`/`afterbegin`/`beforeend`/`afterend`.
  Lean: ours read better and map 1:1; document the mapping.
- The floating-range geometry above: whether "before next surviving
  authoritative sibling" is stated contract or implementation
  detail.
- Whether repeated `predict` calls on one anchor in one transaction
  merge (last-write-wins per key) or stack. Lean: merge per key —
  matches how authors think about "the predicted state."
- Dev-mode enforcement surface for the discipline line (warn on
  imperative writes to server-owned attributes from claim/action
  scopes).

**Acceptance gate — Server Component TodoMVC (restated).** Port the
existing `examples/todos` beside itself, preserving its delays, ~33%
write failure, per-item retry, bulk actions, filters, and
overlapping transitions. The existing app is the derived
`createOptimisticStore` reference implementation; the port replaces
its authoritative data/render with server-component markup plus
predictions. Pass condition: **every optimistic behavior lands in
`predict` patches (attribute or content keys) or in data-shaped
client state — zero imperative DOM writes, zero selector coupling,
zero vocabulary beyond JSX attributes and four position words.**
Toggle/pending/disabled/error markup are attribute keys; add is a
content key; counters and filter state are data-shaped (slot args /
client signals). Do not publish the API until add/remove/toggle
success and failure, checkbox correction, concurrent and bulk
mutations, retry/error markup, state retention across reordering
morphs (the `_key` substrate: focus, typed values), and clean
hydration all work. The decision criterion beyond correctness is
simplicity parity: if the port relocates the current store's
simplicity into prediction bookkeeping, the abstraction fails.

**Non-negotiable invariant (unchanged):** the frame itself remains
derived. Predictions may temporarily perturb its rendered
projection, but only an authoritative frame record can make that
output durable.

#### 9.2.1 Amendment — settlement is convergence (2026-09-22)

Found while designing Stage 8 (§9.5). The 08-18 text above settles a
prediction "at settlement" and the ordering note made settlement on a
persistent connection Stage 8's problem: "a mutation's transaction
remains open until the separate connection has applied its
authoritative frame version" — a WATERMARK the mutation ack would
name and the address's version would pass. Designing that watermark
opened a question with no good answer — who mints the version — and
the answer turned out to be that nobody needs to.

**The question, and why it has no owner.** On single-flight,
settlement is free: the mutation response carries the regions, and
delivery order is causality. On a persistent connection the mutation
is a separate POST and the live stream is an independent render
reacting to a feed — the client cannot tell WHICH emission reflects
its write, and versions are client-stamped stream ordinals (`bump`),
so a server ack cannot name one. This is "read your writes across a
subscription", and every sync system has answered it:

```text
system              mechanism                                        version minted by      one pipe?
──────              ─────────                                        ─────────────────      ─────────
Meteor DDP          method `updated` sent after its writes reach     connection order       yes
                    the client's subscriptions; latency comp holds
                    until then
Convex              mutation commits at log ts T; the socket           global log position    yes
                    delivers query results ≥ T before the mutation
                    promise resolves
Phoenix LiveView    server-held state; reconnect = remount            connection order       yes
Firestore           `hasPendingWrites` on snapshots until acked        connection order       yes
Linear sync         `lastSyncId`, a global sequence from Postgres;     database               no
                    clients hold and rebase against it
Electric SQL        shape offset = Postgres LSN; a write API returns   database (txid)        no
                    the txid; client waits until the shape stream
                    has delivered that txid
PowerSync           write acked with a checkpoint;                     database               no
                    `waitForCheckpoint` before dropping local state
CouchDB _changes    `since=<update_seq>`                               database               no
Replicache          per-client `lastMutationID`; pull returns the      client counter +       no
                    highest processed per client + an opaque cookie    server ack
Turbo 8 refresh     `X-Turbo-Request-Id` on the write; the refresh     request-id echo        no (causal)
                    broadcast echoes it; client skips its own
SSE                 `Last-Event-ID` resume cursor                      producer               n/a
HLC / Lamport       compare timestamps                                 clocks                 no
```

Five shapes: same-pipe ordering (unavailable — mutations are
separate POSTs; single-flight is the degenerate case), database
sequence (the only one that survives replication lag; costs an API —
the app must surface the sequence), client mutation counters (the
render must know which mutations it reflects — a database sequence in
other clothes), request-id echo (only for renders CAUSED by the
write), and clocks (true on one node, false under replication lag).
The finding: **no system mints a version for data it does not own.**
A candidate that kept versions client-stamped — "causal resume": after
the ack, force a superseding render of each invalidated address and
take ITS ordinal as the watermark — was sound on one primary and
wrong under a lagging replica (the transaction settles against a
render that does not contain the write; the predicted row vanishes
and the real one appears a beat later), and needed an opaque
source-token seam on the ack to be honest. Rejected.

**The resolution: apply `until()`'s principle to markup.** First,
what does NOT change: the 08-18 default stands. A prediction settles
with its transaction, and under single-flight the confirming morph
and the settling are the same event — no condition to express, no
version to compare. What the watermark was FOR is the other case:
confirmation arriving off-response (a mutation whose invalidation
did not cover the address; a fire-and-forget write whose truth comes
back on the live stream). For that case, `until` already states the
principle on the data face: "when does the world confirm this
condition", read from the authoritative view with the caller's own
optimism carved out — your own tentative write can never satisfy
your own ack. The same holds for a prediction: it is confirmed when
the AUTHORITATIVE MARKUP CONVERGES ON IT, and any arrival path
confirms — a single-flight region, the live stream's own emission, a
resume snapshot, another tab's mutation. Stage 7's vocabulary makes
every outcome prediction such a condition:

- A **content prediction with a `$key`** (`append: <li
  $key={clientId}>…</li>`) is confirmed when an authoritative morph
  brings an element with that key. The keyed-morph substrate (`$key`
  → `_key`, shipped 08-15) ADOPTS the predicted node, so there is no
  duplicate window — the same "correlate by key" guidance RFC 06
  gives for optimistic store rows.
- An **attribute prediction** (`checked: true`) is confirmed when an
  authoritative apply asserts the same value. Whether that render
  "reflects the write" stops mattering: the world agrees, and
  dropping the overlay changes nothing. A stale apply that disagrees
  is already handled — the claim sweep re-asserts the overlay over
  it (the 08-18 text).

Why this is strictly better than a watermark, not merely simpler:
under replication lag a stale render cannot confirm anything (no key
match, no matching value), so the prediction HOLDS until a render
that actually contains the write — truth, not time. Nothing rides
the ack. No version has an owner. It composes with `until()` in the
same action: `yield until(...)` over data and predictions held by
convergence share one transaction, one hold, one failure story
(reject → revert). And it matches §9.4's principle — relatedness is
declared, never inferred by infrastructure from co-occurrence;
settlement inferred from render-start time was the same category of
mistake.

**What convergence surfaces that the watermark hid: outcomes vs
indicators.** Not every patch predicts an outcome. `after: <Spinner
/>` and `class: "saving"` are PENDING INDICATORS — the server will
never render them, so they cannot converge; they live for the
transaction's lifetime and drop at its settlement. Stage 7 needs the
distinction: keyed content and attribute values the server is
expected to render settle by convergence; unkeyed content and
indicator attributes settle with the transaction. The 08-18 design's
"baseline-restored at settlement" is the indicator half; the outcome
half is new. Both need a failure floor: `until` has `timeout`, and a
convergence prediction whose truth never arrives should fail the
same way (thrown back at the yield; optimistic state reverts).

**What this reopens, narrowly.** The 08-18 text ruled "entity-keyed
settlement (matching a prediction to the authoritative row that
fulfills it) is deliberately NOT mechanism — it required naming
schemes this design just deleted." Convergence IS entity-keyed
confirmation, so the ruling is reopened — but only for the
off-response case the ruling accepted as "a transient duplicate
until settlement", and without the cost that killed it: the key is
the `$key` the author already writes on predicted content for keyed
morph retention, not a new naming scheme. Two things are NOT decided
here and belong to Stage 7's build: how an action holds for an
off-response confirmation (a yieldable from `predict`, or `until()`
over a prediction's confirmed state — the former is new surface, the
latter needs the prediction to be reactive), and whether convergence
also settles under single-flight (it would be a no-op there — the
same event — so the answer is probably "one rule", but it is not
load-bearing).

**Consequences for the roadmap.** Stage 7 no longer depends on Stage
8 in either direction — it needs nothing from the transport and can
be proved against single-flight, a live stream, or both. Stage 8's
watermark work item is deleted (§9.5). The only version that
survives is the client-stamped ordinal, as stale-guard and resume
cursor.

### 9.3 Stage 8 seed — connection-shaped transport (2026-08-17)

Recorded from the design conversation; nothing here is built (the
design that grew from this seed is §9.5, 2026-09-22). The
stage shrank three times during the pass, each time by discovering
the capability already existed — what remains is a continuation story
and a contract with failure, not a transport feature.

**Scope split (decided the same night).** Server-component liveness
(this section) is distinct from the data-API question: what a
top-level async iterator returned from a plain `"use server"` call
means as a Solid data primitive (consumption semantics, SSR, sharing,
reconnection). The data layer is prioritized FIRST and investigated
separately; the frames value tier should ride whatever it decides.
This seed covers the frame/markup face only.

**No new APIs — a connection is a response that doesn't end.**
`"use server"` is untouched on both sides. The component not
terminating is the entire liveness declaration, and it is observed,
not configured: the stream face already waits on reactivity, because
every live server source is await-shaped — a projection over a feed
sits on a pending `next()` between events, a generator holds an
outstanding yield, the retry loop holds an unsettled promise. There
is no "subscribed but nothing pending" state (raw post-flush writes
are already forbidden), so "waits on pending" and "waits on
reactivity" are the same wait, and a component over an infinite feed
would hold its response and keep emitting today. Stage 8 is the
warranty on that accident, plus the pieces below.

Configuration therefore lives at the edges, where config already
lives: the server entry owns the operational envelope (carrier
framing, hold caps, idle timeouts — per-route), the client host owns
reconnect policy (backoff, a knob beside retention). Because
reconnection is re-invocation, every cap is a QoS dial, not a
correctness switch: a 30-second platform limit produces a 30-second
resume cycle — chattier, still correct — degrading in the
pathological limit to long-polling, emergent and never implemented.

**Carrier is content negotiation.** *(Superseded 2026-09-22, §9.5
Wire and RFC 10 "`live(fn)`", Framing: every live response is framed as
server-sent events — no per-entry choice, no configuration, nothing
negotiated by the client.)* The invocation is a
POST whose response body is the record stream; "use SSE" is a response
*framing*, not a channel. The entry opts in (`carrier: "sse"`),
Content-Type carries the decision, the client picks its decoder off
the header. SSE framing, NOT the EventSource API (which cannot POST,
and whose auto-reconnect we do not want — the host owns resume): what
SSE buys is the middleboxes — proxies and platform load balancers
that buffer opaque chunked responses pass `text/event-stream`
unbuffered — plus comment-line heartbeats against idle timeouts, and
an `id:` field that is a natural home for the watermark. Live
responses ship `Cache-Control: no-store` (a cached clone of an
unbounded stream outlives its page). WebSocket stays deferred until
proven necessary — upgrade handshake, bidirectional, the client must
know a URL: the one carrier that would cost API.

**Taxonomy: promises for eventual, iterators for persistent.** Every
persistent thing the system already built is iterator-shaped —
container traces (snapshot + patch iterable), generator components,
live-hole re-emissions, the record stream itself. The only
promise-factory is the retry loop, correctly, because it names an
EVENTUAL value. Persistence and eventuality are the two async kinds;
promise factories masquerading as persistence should not exist.

**Resume is supersession, not continuation.** Iterators are not
seekable; re-invocation replays from the start. So a resume is a
SUPERSEDING RENDER of the address, never a continuation of the old
iterator: fresh snapshot from durable state, morph converges,
identical regions no-op, retained element state follows `_key`.
Value-tier iterables get fresh-instance supersession — the resumed
render's args replace the old ones, a client `For` re-renders from
the new iterable, nothing appends twice. Cursors (true positional
resume for sources with real sequence numbers) are an opt-in
optimization, never the baseline, because the baseline must hold for
sources that have none. The re-derivability line, sharpened: **if
losing the transport loses the value, the value belonged in durable
state, not in the iterator.** An in-flight LLM generation is eventual
wearing iterator clothes — its durable form (the message row) is what
a resume renders; the lost tail is app semantics, not framework
failure. Dev-mode chaos reconnect is the enforcement.

**Settled emission — progressiveness is consumer-relative.** The
client's async-holds-latest rule, applied at the emitter: do not
stream the settling journey to a consumer already holding content.
The progression — fallbacks, partial reveals, loading states — is UX
for an empty screen, not data; a resuming consumer has no empty
screen. Same render, two emission policies, selected by the request
itself (a resume request carries "I hold version N"; that bit IS the
selector): fresh consumer → progressive, today's streaming; resuming
consumer → render quietly to the existing settlement latch, emit one
converged snapshot, keep the sink open. Regression never hits the
wire — which retired the client-side version-floor guard an earlier
draft of this seed needed.

**Quiet resume contract.** A resume is lifecycle-silent: the host
resume loop runs OUTSIDE transitions (no `isPending` pulses on a
platform's 30-second cycle), retained content keeps boundaries
revealed (first-content gating and async-holds-latest already
guarantee no fallback flash), and a resume's own settlement settles
nothing transaction-shaped — predictions hold to their watermark,
never to the resume.

**Watermark = cursor.** A mutation ack carries "reflected as of
version N"; the transaction and its overlays hold until the
address's version passes N — whether that version arrives on the
original response, a live stream, or a resume snapshot. The same
"I hold version N" is the resume request's emission-policy selector.
Requires per-address versions monotonic across responses; the
address-resident store is the authority.

**Document face: bounded by a window, not by detection.** Persistence
cannot be detected — a feed's pending `next()` is byte-identical to a
finite generator's, and "will this settle?" is the halting problem —
so it is DEMONSTRATED instead: the document window (an entry-level
knob) closes the document response, and whatever outlives it is
persistent by demonstration. Eventual = settles within the window;
persistent = outlives it — an operational taxonomy, the same rule as
any transport cap. **Default = no window = today's
wait-for-full-settlement**: bounded generators stream their whole
progression into the document (full content, SEO) exactly as now;
nothing breaks. Setting the window is the opt-in to live-at-t=0, and
is REQUIRED there — an unbounded source with no window holds the
document open forever (tab spinner, `load` never fires, buffering
proxies, unflushed serializer state). At the window: clean close at a
record boundary, final sweep, a live-marker bit on frames whose
bindings remained open; adoption sees the bit and starts the resume
loop. The document is just the transport that ends first and most
predictably; the gap between close and resume is covered by the
settled snapshot (self-healing — no missed-event protocol). Honest
cost: one extra server render per live frame per page load — the
seam where per-address fan-out slots in later if it ever matters.

**Work items (the whole stage, current best understanding):**

1. Emission-policy selector on the frame render (progressive vs
   settled), driven by the request's "I hold version N".
2. Host resume loop: re-invoke on response death, backoff, outside
   transitions.
3. Fresh-iterable supersession proven on the resume path (existing
   rule; needs the test).
4. Watermark on mutation acks + monotonic per-address versions.
5. Server teardown on client disconnect: response abort cancels the
   generator and disposes the render — without this, every abandoned
   tab leaks a server loop.
6. Document window + live-marker bit + adoption-triggered resume.
7. Open surface question: expose connection state on the frame handle
   (a `connected` signal for "reconnecting…" UI) — small, additive,
   undecided.

Deliberately absent: any client authoring API, any server authoring
API, any subscription registry, any cursor protocol, WebSocket.

### 9.4 Batching seeds — relatedness decides atomicity (2026-08-22)

Recorded from the design conversation around router PR 554
(`batchedQuery`); nothing here is built. Three related findings, one
principle.

**The principle: atomicity follows relatedness, and relatedness is
something only the author can declare.** An author-declared batch
("these calls resolve together from one source" — one `WHERE id IN`,
one render pass) may settle atomically; that IS its semantics, and
there is no "slowest member" because there is one shared latency.
Infrastructure-observed co-occurrence (calls that merely happen in
the same tick) may share a CONNECTION but never a COMPLETION — atomic
settlement there couples unrelated latencies nobody consented to. A
mechanism that is declared by infrastructure but settles atomically
is claiming a relation nobody asserted; reject it on sight.

**Data batching (router-side, for the record).** The Svelte-style
server-resolver shape (`query.batch`: fn returns a lookup closure the
framework applies per-arg) is UNAVAILABLE here: a server function's
top-level function return already means "server component" — the
strictest protocol position we have — and no out-of-band flag should
overload it. The viable shape is the original PR's: the batch fn is a
plain server function (array in, ONE serializable value out, ships
once), and the per-caller lookup is a client-side pure derivation.
That makes batching pure caller-side promise coalescing — no wire
fact, nothing for this repo to declare — so it lives in the router
beside `query`, with two fixes owed: the collection queue must be
request-scoped on the server face (module scope = cross-request
bleed), and per-arg calls should key into the query cache
individually. Emergent win: a revalidation sweep's refetches
auto-coalesce.

**Server-component request grouping (transport seed, hold until
proven).** N same-tick SC invocations COULD ride one request: the
response side already multiplexes (records carry the producing
frame's id — regions, single-flight bodies, and the document face all
prove one-stream-many-components), so only the request-side
invocation shape is missing. Each batched entry keeps its own
`frameAddress(id, args)` — transport aggregation, identity untouched.
Per the principle, the batch shares the pipe, never the completion:
each component's shell flushes when IT renders (shell-gating
discipline already guarantees sync shells), and the one
implementation trap is buffering the batch response, which would
silently convert shared-connection semantics into atomic-completion
semantics. Held because the heavy cases are already covered (t=0 by
the document, mutations by single-flight). _Corrected 2026-09-23:_
this seed once also said Stage 8's persistent connection would
dissolve the question; Stage 8 settled as one event-stream response
per live source with nothing shared between them (§9.5), so there is
no pipe for grouping to ride and Stage 8 addresses none of this.
Coincident bounded reads after load remain uncovered. Discussion
#3603 (opt-in batching for server functions) proposes the request
side; the bar stated there is that per-URL `GET` reads and
many-per-request batching are two read models and core has picked
the first, so grouping has to justify itself as a second one, and
a serverless invocation count is a platform cost model — the same
argument declined for `hold`.

**Multi-component returns — object-first (designed, unbuilt).** A
server function returning `{ header: SC, feed: SC }` is
author-declared relatedness for components: one call settles
atomically (its semantics), each value is its own independently
addressed boundary. Mechanics discovered during the pass: the
serializer is ALREADY depth-agnostic (`ServerComponentPlugin` tests
the brand, not the position) — the top-level restriction lives
entirely in the two branding transforms (`frameTransformResult`,
`frameTransformDirectResult`), so the wire face is nearly free. What
it actually costs is identity: DR-1's "one call, one address" becomes
"one call, one address SPACE" — elements sub-addressed
`(fn, args, key)` — and the mount-identity half (per-function
placeholder memoization, the equals-gated dynamic, adoption) must
become per `(function, key)`. Objects first because property names
are stable sub-keys for free; ARRAYS are deferred until element
keying is author-declarable, because index-keyed identity
misattributes content stores on reorder — the keyed-morph lesson
repeating at the boundary level. What it buys is a real capability,
not sugar: client-side compositional control over server-rendered
units (hold the references, lay them out, filter/reorder/paginate
locally) while each unit stays server-owned, addressable,
refetchable, morphable — the thing "one component rendering a list
internally" structurally cannot do.

**Amendment (same night): the shared-query pattern eats most of the
motivation.** "Isolated components sharing one query" does NOT need
multi-returns: siblings take plain args and each AWAITS the same
declared query inside — request-scoped dedupe already collapses N
awaits into one fetch on the document face, and the request-grouping
seed above extends that to client-driven mounts (one request → one
request scope → one query). Addresses stay plain-data-keyed, each
unit independently refetchable, shell-gating owns each settle. (The
promise-as-argument variant of "fetch outside, await inside" is an
ANTI-PATTERN at the call border: promises are not address material —
every refetch mints a new identity and churns the content store.)
What object returns still uniquely own after this: the mixed
`{ data, card }` shape (machine data + its rendered presentation as
one atomically related value — the map/canvas/editor case), and
single-shot relatedness that cannot be re-derived through a query.
The identity work should wait for THOSE to bite, not for layout
cases the shared-query pattern serves.

**Don't await in the server function body — closure capture is the
preload (the actual insight of the conversation; the readings below
it were derived en route and stand on their own).** The idiom every
simple example teaches —
`const data = await db.query(id); return props => <div>…` — holds
the ENTIRE component hostage: the function hasn't resolved, so the
frame element, the shell, the stream's first byte all wait on the
query. The body can initiate WITHOUT awaiting and return
immediately; the pending promise rides in the CLOSURE (which never
crosses a serialization border — the address-material objection does
not apply), and the component consumes it through machinery it
already has: value tier, holes, `Loading` boundaries, shell gating.
Body = initiation scope, component = consumption scope. Authoring
rule for docs and snippets when that workstream opens: **await for
decisions (auth, redirect, branch), initiate-and-capture for
presentation** — the awaited form should be the exception that
signals "nothing below is valid without this."

This also RESTORES the strongest motivation for object returns,
which the shared-query amendment above had argued down: one body,
one un-awaited initiation, N returned components sharing the
closure — `const stats = db.bigQuery(range); return { kpis: () =>
<Kpis data={stats}/>, alerts: () => <Alerts data={stats}/> }` — one
db call, independently addressed boundaries, independent reveals.
Closure-shared state is single-shot relatedness that children
CANNOT re-derive through a deduped query; it is exactly the
carve-out where the per-key identity work earns its cost.

**The call as preload (derived en route, still true).** Intrinsic
addressing makes a call an idempotent NAME, so "invoke early, render
later" extends across the border: a route preload invokes the SC
function at hover/intent, and the mount, deriving the same
`frameAddress(fn, args)`, should ADOPT the in-flight call's
address-keyed store rather than reissue — the SC analog of
liveQuery's preload warming, with the key supplied by DR-1. Work
item before blessing: probe whether a mount adopts a concurrently
in-flight call at the same address; host retention proves the
re-mount case, the race case is likely "second call reissues"
today — wasteful, not wrong.

### 9.5 Stage 8 design — connection-shaped transport (drafted 2026-09-22; revised 2026-09-23: liveness is `live`, framing is server-sent events)

Builds on the §9.3 seed. This record is what the seed became once
audited against the tree as it is today and then argued through from
the data tier up: several of its claims are now verified mechanism
rather than expectation, one thesis line is revised, the one
dependency it carried on Stage 7 (the watermark) is retired (see
"Settlement is not this stage's concern" and §9.2.1), and its carrier
question is answered as today's per-source stream framed as
server-sent events, with no declaration and no configuration.
Names remain provisional. The implementation plan — phases, slices,
the example that vets each slice — is
`documentation/plans/stage8-connection-transport.md`; the data-tier
contract this design consumes is RFC 10 (`live(fn)`, including its
Framing bullet).

**What changed since the seed.** The scope split held: the data-API
question was built first as `live()` (`packages/web/server-functions/
src/client.ts`), a declaration wrapping a server function whose
answer is a value-shaped async iterable, owning the wire lifecycle —
each iteration its own connection, post-connect deaths re-invoked
with backoff, `onstatus` for wire state. `live()` is a CLIENT
decorator; a server component never sees it (it is already on the
server; it reads its sources raw). The design pass found the
asymmetry the ordering note names runs one level deeper than
"frames lack a reconnect loop": `live` itself stops at the
top-level iterable. An answer with NESTED streams — an object whose
properties are generators, or a component whose render streams over
the connection — is a one-value stream to it: nested deaths are
invisible, nested SSR handoff never happens. Server components are
not a special case needing their own loop; they are the nested-async
case, and the fix is to extend `live` to the response's lifetime
(RFC 10, "`live(fn)`"). Frames then CONSUME `live` rather than
mirror it — one declaration, one loop, one status surface across
both tiers — and everything frames add is about making the resume
quiet, not about liveness.

**Audit — the mechanism this design rests on:**

```text
fact                                                    where
────                                                    ─────
frame render over any async iterable pumps and holds   server/signals.ts (ctx.commit pump; ctx.hold)
  in server-component scope with ctx.commit armed —
  INCLUDING the document face
first-value lock on serialized memos; the frame pump    server/signals.ts (~1613: "later yields are the
  is the stated exception ("no hydration claim")          CLIENT's to apply")
SSR hybrid (first value, close) selected per OBJECT     server/signals.ts LIVE_SOURCE brand
  by the live brand — except a frame render's pump,
  where a branded source stays connected; projections
  follow the same rule as memos (Stage 8 B5: the frame
  pump drives their trace; live scope takes first value)
shell blockers: deferStream reads gate the first flush  web/src/server.ts serialize() / blockingPromises
response end gated on `!registry.size && !holds`        web/src/server.ts flushEnd
`complete` chunk emitted only when the render settles   frames/src/frame-sink.ts frameStream end()
client disconnect only sets `closed`; render continues  frames/src/frame-sink.ts serverComponentResponse cancel()
client applies chunks to body end, resolves either way  frames/src/frame-transport.ts applyFrames
versions client-stamped per address (`bump`)            frames/src/frame-transport.ts createServerComponentHandler
stale-guard per address on the client host              DR-5 / policy A
live() lifetime = top-level iterable; nested invisible  server-functions/src/client.ts live() pull()
reconnect loop with backoff, online wake, 4xx policy    server-functions/src/client.ts live()
Serialized/Json/Void negotiated per response            server-functions/src/server.ts encodeResult
SERVER_WRITE is a once-per-category WARNING             server/signals.ts (~788)
```

Two of those rows are the stage's first work: the `cancel()` row is a
live leak TODAY for any server component reading an unbounded source
(the abandoned tab's render pumps forever), and the `applyFrames` row
is the client not yet distinguishing a death from a completion.

**Thesis (revised).** The seed said: no new authoring API on either
side; the component not terminating IS the liveness declaration,
observed rather than configured. Half survives. There is still no
new API — but liveness is DECLARED, not observed, by `live`, the
data tier's existing declaration, at the export. The alternative
makes an undeclared stream's death mean two things — an error on
data, a silent re-invoke on frames — and needs a timeout (the
window) standing in for the declaration on the document face. The
rest of the thesis is unchanged: a connection is a response that
doesn't end; resume is re-invocation — a superseding render of the
address, never a continuation of the old iterator; progressiveness
is consumer-relative; if losing the transport loses the value, the
value belonged in durable state.

#### Wire

- **Same chunk protocol.** The one semantic shift: `complete` is the
  BOUNDED signal. A body that ends without it is a **death** — the
  resume trigger — never a completion. Bounded renders are untouched.
  This is the frames instance of the codec's own rule (RFC 10,
  Lifetime): completion is a record the producer writes, and a body
  that ends without it fails what it left open.
- **One SSE response per source (RFC 10, `live(fn)` → Framing).** `live`
  is for backends that hold connections — the feature's
  precondition, as it is for LiveView, Datastar, and SvelteKit's
  `query.live` — and there is nothing to configure. A live frame is
  its own request, as today, addressed to the live address
  (`<endpoint>/live/<id>`, the sibling of `/data/<id>`: a third
  caller kind receiving a third answer shape gets its own path, the
  #3094 rule), with the response framed as server-sent events
  (codec payloads as `data:` events, heartbeats, `no-store`,
  `X-Accel-Buffering: no`) so buffering middleboxes pass it
  through. Subscribing is a request;
  unsubscribing closes it, which is how teardown (below) is
  signalled; a frame under a streamed boundary connects when that
  boundary hydrates and a frame mounting after navigation connects
  when it mounts — nothing coordinates with anything else. HTTP/2
  is part of the precondition (six connections per origin under
  HTTP/1.1; the dev server speaks HTTP/2 with `server.https`; dev
  warns past five live connections otherwise). Frames own no
  transport vocabulary: `serverComponentResponse` writes through
  the   shared event-stream writer when the call arrived at the live
  address, `applyFrames` reads through the shared reader off the
  content type, `isFrameStreamResponse` stays `X-Frame-Stream`-based. On a backend that kills a response at a
  ceiling the stream dies there and `live` does what it does on any
  death — backoff, reconnect with its position, `onstatus` showing
  it — which is `query.live`'s behavior on the same platform and
  the honest one. `GET(fn)` remains the idiom for server components
  for its own reasons — a render is a read by construction, and GET
  buys URL identity and dedupe by address — and is orthogonal to
  framing. Considered and set aside the same night, recorded in RFC
  10: one shared channel per page (an SSE response is a fixed set at
  request time; adding to it needs a mailbox on the holding
  instance and fights a fine-grained client — a socket is the
  carrier where add is native, and remains the future if the
  connection count ever matters), a `transport: "polling" | "sse"`
  enum, and a `hold` that cycles live responses under a platform
  ceiling (future, one optional number, if asked for) — all in RFC
  10's Alternatives considered. There is no transport decision left;
  what remains is a framing note. Withdrawn unbuilt: `SSE(fn)`,
  `enableEventStream()`, framing-follows-method.
- **Resume request.** A reconnect (a `live` re-invocation after a
  death or a supersession, or the post-hydration takeover) carries
  `Last-Event-ID: <N>`, N the client's version ordinal for the
  address, and a bounded **have-list**: the opaque per-hole hashes
  the client holds for that frame (header, name provisional; when
  the list would exceed a budget the client omits it and accepts a
  full snapshot). Never as arguments — a position is not address
  material (an arg would mint a new `frameAddress` per resume and
  churn the content store; §9.4's promise-as-argument anti-pattern).
  The server reads the header's PRESENCE as "this is a resume" and
  the have-list as the conditional baseline; the ordinal stays
  opaque to it.
- **Hole hashes.** Every hole/fragment emission on every face —
  frame stream and document alike — carries an opaque digest of its
  content, minted by the server. The client stores digests per hole
  and never derives them from the DOM (browser serialization differs
  from the server's string). The document face seeding the ledger is
  what makes the first reconnect after hydration conditional.

#### Server face

1. **Teardown on disconnect (first slice; a bug fix today).**
   `serverComponentResponse`'s `cancel()` sets `closed` and drops
   writes; the render keeps producing. Fix: cancellation (and the
   request's `signal`) disposes the render root. The pump already
   handles disposal — `comp.disposed` closes the iterator and
   releases the hold — so this is wiring the Response lifecycle to
   the owner, not new machinery. `frameFlightResponse` gets the same
   wiring. Without this, every persistent render is a server loop
   with the client's lifetime and no one else's.
2. **Reconnect is a conditional render (replaces the seed's
   "settled emission policy").** With a resume header present the
   render emits a hole only when it has SETTLED and its digest
   differs from the have-list; a hole still pending is not emitted
   (the client already shows either its content or its fallback,
   and either may stand); reveals the client lacks stream as they
   settle. Three consequences, one rule: a no-op reconnect transfers
   nothing; a fallback is never emitted over content; the first
   connection after a document render (holes the document left as
   fallbacks) streams exactly the reveals that are missing. There is
   no progressive/settled MODE and no latch split in `flushEnd`;
   without a resume header the render is today's progressive stream.
   The compute cost is the whole component re-running per reconnect
   — LiveView's dead-then-connected cost, accepted. A stateful
   attach (the render root kept alive past the response for a grace
   window, the reconnect attaching by token) is the opt-in above
   this baseline for deployments that can route stickily; nothing
   here precludes it and nothing here depends on it.
3. **Document face — first value by scope.** A live-declared
   component reaches the document render with the brand on its
   component function (the in-process `live` wrapper puts it there);
   the frame render turns it into a scope flag, and every async
   source read in that scope takes the existing hybrid path: first
   value into markup, iterator closed, no pump, no `ctx.hold`. The
   shell waits for sources outside `Loading` boundaries exactly as
   today; sources under boundaries reveal in later flushes as today;
   the document completes when nothing is pending, as today. One
   value per source crosses the document — the data tier's
   first-value lock, applied where the "no hydration claim" exception
   no longer holds (the client's frame store opens at v0 = the
   document's markup). The frame's shell carries the live bit;
   adoption reads it and hands the binding to `live`. No "settled
   once" event, no window in the path.
4. **The window becomes a safety cap.** An UNDECLARED unbounded
   source in server-component scope at t=0 is an authoring error —
   today it holds the document open forever. The cap ends that
   render's participation at N ms with a dev diagnostic naming the
   source, and the client sees a bounded frame that completed
   early. Whether the cap is a knob (`renderToStream(code, {
   documentWindow })`) or a fixed dev-only warning is open decision
   (c); with the live handoff it no longer has a role for declared
   sources, which is what makes the question small. _Decided
   2026-09-25 (B3): fixed dev-only warning, `SSR_UNDECLARED_LIVE_SOURCE`
   after 5s of a document render still pumping; it names the owner and
   ends nothing — Stage 4's document live holes keep working._

#### Client face

1. **Death vs completion.** `applyFrameResponse` resolves either way
   today. The host learns the difference from the `:complete`
   record: a stream that ended without it, on a frame the server
   never declared complete, is dead. A stream-level `:error` from a
   definite rejection is a completion of the failing kind (no retry;
   `live`'s 4xx rule).
2. **`live` is the loop.** The frames `responseHandler` exposes the
   response's lifetime — the binding now, the stream's end and how
   it ended later — and `live`'s loop does what it does on data:
   death → backoff → re-invoke through the same reference, outside
   any transition (no `isPending` pulses on a platform that cycles
   connections). `dynamic` consumes an iterable of bindings. Because the
   binding is stable per address, the re-yield is the SAME binding
   and `dynamic`'s equals-gate holds: no remount, no fallback,
   retained element state follows `_key`, client slots keep their
   state. Quiet by construction, where on data a reconnect is a
   fresh object. No shared helper, no mirrored policy: there is one
   loop and frames call it.
3. **Hydration handoff.** For a live frame in the document, adoption
   yields the adopted binding into `live`'s iterable synchronously
   (there is no serialized value to hydrate — the markup is the
   value), then the loop reconnects with `Last-Event-ID: 0` and the
   have-list the document seeded. WHEN it reconnects is the frame's
   own hydration scope releasing — the root pass's release for a
   frame in the shell, the boundary's own `releaseSnapshotScope`
   for a frame under a streamed `Loading` — never page-wide
   hydration end. The shipped `armLiveTakeover` gate waits for
   `onHydrationEnd` (all boundaries), which holds every live node
   on the page for the slowest boundary and contradicts the
   per-boundary snapshot design; it is re-keyed per scope owner as
   part of this stage (behavior change to shipped `live`, flagged).
   The reconnect is conditional, so with nothing changed nothing
   crosses; what did change since the document rendered arrives as
   one morph. Honest cost: one server render per live frame per
   page load, the same price a live data source pays. _Built
   2026-09-25 (B3): the synchronous yield is the frames intercept's
   answer riding on the iterable (`LIVE_LOCAL`), adopted by the
   hydrating node as its value and re-yielded by the takeover run;
   a boundary still streaming answers with a promise that lands at
   its reveal, so the connect follows the fragment. No live bit in
   the shell record — the client derives the address from its own
   call. `Last-Event-ID` / have-list land with B4._ _Built
   2026-09-25 (B4), frame face: every content chunk carries a
   server-minted digest (root = skeleton digest + a `holes` map;
   fragment/hole/attr their own); the mount keeps a ledger of what
   it has APPLIED (a fragment counts at its reveal); the loop asks
   the frames handler per connect and sends the version ordinal as
   `Last-Event-ID` and the ledger as `X-Frame-Have` (`key=digest`
   pairs, omitted over 4096 bytes → full snapshot); the sink skips
   the root on a skeleton match and emits only the settled,
   differing holes — never a fragment or a fallback reveal over
   content the list names. NOT yet built: seeding the ledger from
   the document face. The document's hole engine numbers `lh:N`
   across the whole page and `pl-N` keys are document-global, while
   a frame render numbers both from zero, so the adopted interior's
   names do not align with what the same call's frame render would
   emit; the connect after adoption is therefore a full snapshot (a
   morph over adopted content, still no fallback) and every later
   reconnect is conditional. Closing it needs per-scope ordinals on
   the document face, `fid`-routed `sc:live` ops, and an alias in
   the have-list entry (`key=digest@clientKey`)._
4. **Supersession from another response is a death.** A live
   address whose store receives a newer version from a DIFFERENT
   response — a single-flight region for a call the mutation
   invalidated, a preload, a getter refetch — has been superseded
   exactly as a death would supersede it: the host cancels the
   connection, `live` sees the death, reconnects (conditionally). One
   rule for both events, and a consistency rule, not a causality
   one: the region's bump makes the open stream's later chunks inert
   under the stale-guard, so without the reconnect a live address
   goes silently static the first time any mutation touches it.
   Known cost: one reconnect per invalidating mutation per live
   address, concurrent with the connection that would have carried
   the update anyway. The mitigation belongs with §9.2.1's
   convergence work (an open connection is the authority for its
   address, so a live query's invalidation need not bump it) and is
   not this stage's. Corollary (built 2026-09-25): one live
   connection per address. Two live readers of one call would each
   supersede the other's stream on arrival and ping-pong for as long
   as both are mounted, so a second live reader's body is ended and
   its loop joins the first connection's lifetime — one death, one
   reconnect, shared.
5. **Undeclared death is an error.** A bounded server component
   whose stream dies mid-render surfaces through `frame.error` /
   the enclosing `<Errored>`, exactly as an undeclared generator
   dying mid-stream does on data. Nothing resumes on its own.
6. **Connection state: `onstatus`, not a frame-handle surface.**
   The seed's `connected` signal dissolves into `live`'s existing
   `onstatus` on the reference's iterable — the same three states,
   the same hook, for data and frames. Open decision (b) closes with
   no new surface.
7. **Hidden pages hold their connections.** A live frame in a
   background tab keeps its connection and its server render, as
   an `EventSource` keeps its connection — the platform does not
   pause, and neither does `live`. The cost is one held render per
   frame on a backend whose precondition is that it holds
   connections. A pause (grace window, status held through it, a
   takeover that fires while hidden parked until visible, disposal
   during a pause cancelling the parked work) was designed and
   deferred unbuilt (2026-09-23): the most intricate state machine
   on the data tier, a behavior change to shipped `live`, buying
   server cost only. Additive if asked for; the digest-equal skip
   (and B4's hole digests) already make a return reconnect free on
   the wire. RFC 10's rule; frames inherit it through the loop.

#### Projections pump too — a symmetry the tree currently breaks

`server/signals.ts` (~2154): "Projections have no server-component
continuation pump: a standing live answer always hands off after V1,
including no-hydrate/frame consumers." So inside a frame render a
`createMemo` over an async iterable is live and a `createStore` over
the same iterable is not. That is not a design choice to make; it is
a symmetry to restore. A projection and a memo differ in GRANULARITY
— a patch stream against a whole-value stream — and in nothing else;
the consumer's shape must not decide whether the source stays
connected. The pump is the same `ctx.commit`/`ctx.hold` shape with
the patch stream as its yields; the room-feed "list of messages"
shape wants exactly this. Under the document face's scope flag, a
projection takes first value like a memo does. Work item, not open
question.

#### Router-facing seams

The router is a consumer that MAY apply `live` and `GET` on the
author's behalf; the core spelling (`live(GET(feed))` at the export)
is the documented one and the reliable site for the GET grant. What
frames owe any such layer:

- **Stable binding as the multicast value.** A live query holding
  one iteration open shares the binding; every reader of the query
  gets the same component, and reconnects re-yield it.
- **Revalidate = reconnect.** Revalidating a live query closes the
  iteration and opens a new one — a fresh connection by
  construction — rather than a second render beside the open one.
- **Preload of a live reference is the layer's choice**, not the
  browser's: a browser-level prefetch of a live GET url opens a
  standing stream that nothing reads. A layer may warm the address
  store with a one-shot render or hold an iteration open. Whether
  `serverFunctionUrl` should refuse a live reference (as it refuses
  a POST reference) is open decision (d). _Decided 2026-09-25 (B6):
  it refuses. The data address it used to return is one the live
  call never requests; the one-shot url is the inner `GET(fn)`'s._

#### Settlement is not this stage's concern

The seed's watermark — "a mutation ack carries 'reflected as of
version N'; the transaction holds until the address's version passes
N" — existed only so Stage 7's predictions could settle against a
persistent stream. Retired (2026-09-22, §9.2.1): predictions settle
by CONVERGENCE — the authoritative markup coming to agree with the
prediction, the `until()` principle applied to markup — which needs
no version anyone must own. What survives here is only what Stage 8
needs on its own: the client-stamped ordinal as stale-guard and
resume cursor, and the hole digests as the conditional baseline.
Nothing in this stage depends on Stage 7 and nothing in Stage 7
depends on this stage.

#### Dev enforcement

- **Chaos reconnect.** Dev-only knob: kill live responses every N
  seconds — data and frames alike, since there is one loop.
  Re-derivability becomes something the app proves every few seconds
  in development instead of a documented discipline.
- **Undeclared unbounded at t=0.** The safety cap's diagnostic names
  the source and the scope, and points at `live`.
- **Connection budget over HTTP/1.1.** Each live source holds a
  connection; a browser allows six per origin under HTTP/1.1. Dev
  warns when a page opens more than five live connections over
  HTTP/1.1, naming them, and points at `server.https` (the dev
  server then speaks HTTP/2).
- **`SERVER_WRITE` becomes an error inside persistent renders.** The
  RFC 11 note said the guard should land before any server scope can
  outlive a request, because that is when an in-place write stops
  being an impurity and becomes a cross-request race or a cross-user
  leak. Stage 8 is that moment. The staged plan (warn now, throw
  later) is unchanged for bounded renders; a frame render with open
  holds is where the throw lands first. Public behavior change —
  flagged; scope is open decision (a).

#### Work slices

Data tier first, with no server components in sight, then frames —
each slice landing with the page of `examples/room` that proves it.
The full sequence, verification per slice, and the example mapping
live in `documentation/plans/stage8-connection-transport.md`; in
summary:

- **Phase A (data):** A1 framing — the live address
  (`<endpoint>/live/<id>`) on both ends, event-stream writer/reader
  for what it answers, heartbeats, `Last-Event-ID` with value-digest
  positions and the digest-equal first-emission skip, HTTP/1.1 dev
  warning; A2 `live` = response lifetime —
  nested brand walk, death vs completion, whole-answer re-yield, SSR
  first value per source, per-scope takeover (the `armLiveTakeover`
  fix, keeping the per-pass re-arm for islands), `onstatus`
  unchanged (the hidden-page pause deferred unbuilt — item 7); A3
  chaos knob.
- **Phase B (frames):** B1 teardown on disconnect; B2 frames consume
  `live` — response lifetime through the handler, `dynamic` over
  bindings, hydration adoption into the loop, supersession as death,
  `onstatus`; B3 document face — brand → scope flag → first value,
  live bit, cap; B4 conditional reconnect — digests on every
  emission, have-list on resume, settled-and-different rule; B5
  projections pump in frame scope; B6 `GET` server components end to
  end, live frame streams event-stream framed.

**Deliberately absent** (as in the seed): any new client or server
authoring API, any subscription registry or connection-local
subscription state (a live call is a direct call; any instance
answers any reconnect and the server remembers nothing), any cursor
protocol, WebSocket, stateful attach. Cursors — positional resume for sources
with real sequence numbers — remain an opt-in optimization over the
re-derivation baseline, never the baseline, because the baseline
must hold for sources that have none.

**Public API this stage touches** (flagged, per the engineering
standard): `live`'s behavior changes three ways on a shipped export
— it claims nested-async answers, its post-hydration takeover fires
per scope instead of at page-wide hydration end, and a
digest-equal reconnect yields nothing (a dying body already
rejects what it left open — that is the decoder's end-of-body
sweep today, not a change); `onstatus` becomes reachable for
server-component references through the same iterable;
`SERVER_WRITE` becomes an error in persistent renders; a dev-only
chaos-reconnect knob and a dev-only HTTP/1.1 connection warning;
the document window — if kept as a knob — as `documentWindow` on
`renderToStream`. Nothing to configure on the server; no new
option. New wire, not API: the live address `<endpoint>/live/<id>`
(live calls move there from the data address; a client and server
versioned apart miss each other on live calls until both are
current), the event-stream framing of what it answers,
`Last-Event-ID` (value digest; ordinal for a frame), the have-list
header, hole digests. Withdrawn before
shipping: `SSE(fn)`, `enableEventStream()`, `Accept:
text/event-stream` as a client declaration, the
framing-follows-method rule, the per-page channel, the
`live: { transport, hold }` server configuration, `connected` on
the frame handle. Deferred unbuilt: the hidden-page pause.

**Open decisions:** (a) `SERVER_WRITE` throw scope; (b) CLOSED —
connection state is `onstatus`; (c) safety cap: `documentWindow`
knob or fixed dev-only warning; (d) `serverFunctionUrl` on a live
reference — refuse, or answer and document the prefetch hazard;
(e) CLOSED — the address decides: the loop calls
`<endpoint>/live/<id>` and the server frames what it answers there
as an event stream (a header would put a third answer shape behind
a URL caches already hold for the second — #3094 — and reads carry
no transport header — #3406); a server-side `live` declaration may
cross-check in dev but cannot decide (topology); (f) is the plan's.
