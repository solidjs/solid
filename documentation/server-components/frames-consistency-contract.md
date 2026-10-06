# Frames / hydration consistency contract (2026-10-05)

Branch `spec/frames-consistency-contract` off `next` @ `a8c98bd2e` (the pins
were first measured at `ea5f1da07`; the ten `next` commits between —
compiler/babel SSR spans, signals fuzzer fixes, the server `<Loading>`
yield (#3808), the hydration payload's rejections (#3803) — change no
verdict: identical suite counts and campaign tallies on both bases). **Nothing
here changes an engine.** The branch carries this document, one pin per
invariant under `packages/web/test/consistency/`, and a property harness
under `packages/web/test/consistency/harness/`. Counts on `next` at the
end of the audit: 17 invariants stated, 2 more found by the harness (C18,
C19); 7 hold (C1, C8–C11, C14–C16 — eight pins), 11 red (C2–C7, C12, C13,
C17, C18, C19), ten red diagnoses R1–R10.

The question this answers is not the one `documentation/plans/sc-layer-audit.md`
§3 answers. That inventory lists 75 statements of what the server-components
client **asserts** — per mechanism, in the code's own voice. This document
asks what must hold for the **page** to be consistent — the whole page, as a
user and the hydration runtime observe it — and then pins each statement
against `next` to find out whether it holds. The model is the signals core's
L2 section (`packages/signals/docs/SPEC-ASYNC-SEMANTICS.md`, "The hold model —
L2"): one-sentence rulings, the mechanism meant to carry each, a named pin,
and a verdict. The maintainer's brief: _"I don't know if I trust anything here
to be sound — the first version was just get it done."_ Treat every
**holds** below as "a pin could not break it", not as a proof.

Companion inputs: `server-components-principles.md` (A1–A7/L1, DR-1…5),
`frame-streams-rfc.md` (RFC 11), `documentation/solid-2.0/11-server-components.md`,
`12-ssr-http.md`, and the plan's §3 numbering, cited below as "§3 _n_".

## Vocabulary

- **Occurrence** — one slot marker pair (`<!--slot:k:start-->…<!--slot:k:end-->`)
  or one binding-slot consumer set in a frame's server content; `k` is
  `prop` or `prop#n`.
- **Claim** — the hydration-attach invocation of an adopted occurrence: the
  fill renders under the producer's key chain (`sc-<fid>-<k>-`), its
  components take the server-rendered nodes by key, and the fill answers
  `undefined` over `ctx.existing` (nothing moves).
- **Shows** — what the DOM between a frame's boundaries holds at an
  _observable point_: after any synchronous apply, at any microtask
  checkpoint (a `MutationObserver` callback), at any `frame:applied` event.
- **Quiescent** — no chunk in flight, no pending microtask or macrotask the
  page armed, the scheduler flushed.
- **Hold** — anything that defers an occurrence's claim or a record's apply
  past the pass that discovered it: the `{$ref}` wait (§3 12), the #2968
  record defer (§3 45), a late-boundary wait (§3 43), a stylesheet gate
  (§3 21), S1's `prepareArgs` wait (on `size/s1-lazy-store-materializer`).

## Status key

**holds on `next`** — the pin passes and tried the orders/timings the
invariant claims independence over. **red on `next`** — the pin fails
(`test.fails`), with the observed frame and a diagnosis in §Red. **untestable**
— no observation point exists for the clause, or the shape cannot be built
without the server renderer in the hydrate suite (why, in the row).

## The invariants

Each: one sentence; the mechanism meant to carry it (`file:function`); the
pin; the verdict on `next`. Pins live in `packages/web/test/consistency/`,
named `c<nn>-<slug>.spec.tsx`; each test title names its arm.

### C1 — claim once, or replace, never both, never twice

Every server-rendered node inside a frame's content is, by quiescence,
either claimed exactly once (by the hydrate pass or by the fill that owns its
range) or removed by a deliberate replacement — never claimed by two passes,
never left in the document beside a fresh clone of itself; a boundary element
is adopted by at most one frame.

- **Mechanism:** `frames/src/client.ts:claimRender` (a range-scoped registry
  handed over from the root registry), `client.ts:slotsFor.settle` (the
  in-place check that turns a render into a claim), `frame-client.ts:FrameImpl.#replaceRange`,
  `client.ts:adoptBoundary` + `claimedBoundaries` (one adopter per element),
  `client.ts:documentBoundary` (a second mount goes fresh).
- **Pin:** `c01-claim-once.spec.tsx` — arms: (a) two occurrences claim once
  each with no key miss and node identity preserved; (b) a fill that returns
  fresh nodes replaces, leaving no server node of the range behind; (c) a
  second mount of the same function while the first adopted mounts fresh and
  the adopted element is untouched.
- **Verdict:** **holds on `next`** (3/3); the harness's C1 laws (key miss,
  unclaimed, duplicate, node identity) fired in none of 1000 cases.

### C2 — no inert server content

At quiescence, every occurrence whose marker pair is in a frame's shown
content and whose prop the client supplies is mounted — including
occurrences a document fragment reveals into an adopted region _after_
adoption — so no server-rendered client content sits in the page without a
live fill behind it.

- **Mechanism:** `frame-client.ts:FrameImpl.#syncSlots` (range discovery over
  the frame's content), `client.ts:adoptBoundary`'s `fr.subscribe` cascade
  (`claimRegionFragments` + `drainRecords`, #2978/#2968), `#recordRefresh`.
  A re-sync after a reveal happens only when the reveal brings a _new_
  record (`drainRecords` → `host.apply` → `#flush` → `#syncSlots`); nothing
  re-syncs on the reveal itself.
- **Pin:** `c02-revealed-occurrence-mounts.spec.tsx` — arms: (a1) a
  render-prop occurrence inside a server `<Loading>` that reveals after
  adoption, its record landing _with_ the reveal, mounts and is live; (a2)
  the same with the record landing _after_ the reveal; (b) a direct-insert
  `children` occurrence (recordless by design) revealed after adoption;
  (c1/c2) reveal-before-adopt and adopt-before-reveal give the same page.
- **Verdict:** **red on `next`** (arms a2, b; a1, c1, c2 hold). See §Red R3.

### C3 — hydration-done counts every hold

When hydration reports done (`onHydrationEnd` fires, `isHydrationInProgress()`
reads false, `_$HY.done`), every occurrence in adopted content has claimed,
or the hold deferring it is counted so that done waits for it.

- **Mechanism:** `solid/src/client/hydration.ts:checkHydrationComplete` /
  `_pendingBoundaries` / `drainHydrationCallbacks` (what done waits on);
  `frame-client.ts:FrameImpl.#syncSlots`' deferrals (`#recordRefresh`, the
  `#refsUnresolved` skip) register with nothing.
- **Pin:** `c03-hydration-done-counts-holds.spec.tsx` — arms: (a) the #2968
  record defer; (b) a container-trace arg present at adoption (the S1
  `prepareArgs` probe); (control) record present at adoption.
- **Verdict:** **red on `next`** (arm a; b and control hold). See §Red R1.

### C4 — a record applies exactly once, in any drain order

A document record (`sc:slot:*`, `sc:region:*`, an `sc:live` op) and a stream
record each take effect on the content a frame shows exactly once, whatever
order drains, reveals and chunks interleave; a re-drain never re-invokes a
fill or re-pushes unchanged args.

- **Mechanism:** `client.ts:adoptBoundary.drainRecords` (`appliedRecords`),
  `frame-client.ts:createFrameHost.write` (the per-address version guard),
  `FrameImpl.apply` (`argsEquivalent` dedupe), `#refArgsUnchanged`,
  `#appliedHoles` (per-mount hole dedupe), `liveOps` compaction.
- **Pin:** `c04-record-applies-once.spec.tsx` — arms: (a) record-before-adopt
  with re-drains, an equal re-send and a changed record; (b) record-after-adopt
  (deferred) then a re-drain; (c) reveal-before-drain, then a second reveal's
  drain; (d) drain-before-reveal (a reveal-grouped fragment whose record is in
  the document at adoption); (e1) a live hole op replayed from the log; (e2)
  a live op arriving after adoption, then an identical re-send.
- **Verdict:** **red on `next`** (arm d; a, b, c, e1, e2 hold). See §Red R3.

### C5 — data is response-scoped

A `{$ref}` in a slot record resolves only against the data table of the
response that carried the record; the data of a superseded or foreign
response never answers it, in any arrival order of the two responses' chunks.

- **Mechanism:** `client.ts:beginStream`/`tableFor` (rotate per response at
  the handler's `onStream`), `frame-transport.ts:createServerComponentHandler.handle`
  (`bump` + `onStream` at header time), `frame-client.ts:createFrameHost.apply`
  — a `data` chunk goes straight to `applyData` and **bypasses the store's
  version guard**, so a superseded stream's late data lands in whatever table
  is current for the address.
- **Pin:** `c05-data-response-scoped.spec.tsx` — arms (production shared
  host, real codec output, two preloads of one address with held bodies):
  (a) v1's `data` trails v2's header, v2's record references the same ref
  id; (b) the rotation observed through `host.resolve` directly; (c) control
  — v1 complete before v2's header; (d) v2's data first, then v1's late data
  (the mounted fill keeps v2's value); (e) the same shape through `dynamic`
  alone (A → B → A → B while B's first body is open).
- **Verdict:** **red on `next`** (arms a, b, e; c, d hold). See §Red R4.

### C6 — a held record never lands on content it no longer belongs to

A record held on an unresolved `{$ref}` (or a late document record) is
applied only while the frame still shows the response that carried it; after
an address switch, a refetch that supersedes it, or disposal during the
wait, it never mounts or updates a fill.

- **Mechanism:** `frame-client.ts:FrameImpl.#syncSlots` (`#refsUnresolved`
  skip + "the stream's own next flush retries"), `FrameImpl.rebind`
  (`#resetStreamState(true)` → `clearStreamRecords` drops `seg/hole/attr/:error`
  and the root but **keeps `slot:*`**; `#resolveRef` then routes by the
  frame's _new_ id), `FrameImpl.dispose`, `client.ts:followAddress.drop`.
- **Pin:** `c06-stale-wait-never-lands.spec.tsx` — arms (swapped ref
  numbering between the two responses so a cross-resolution reads as a
  swapped pair): (a1) switch during the wait, the new stream ordering
  data → html → slot; (a2) the same with html → data → slot; (b1) refetch
  during the wait, v1's late data before v2's commit; (b2) refetch during
  the wait, v1's data never before the commit; (c) dispose during the wait;
  (control) the wait resolves in place.
- **Verdict:** **red on `next`** (arms a1, b2; a2, b1, c, control hold). See §Red R5.

### C7 — the store is the truth

After every flush, a frame's shown server content is the materialization of
its resident store at the frame's version: the root record is applied, every
segment whose content, reveal gate, stylesheets and placeholder are present
is revealed, no fallback stands where a revealed segment belongs, and no
record of an older version is visible — for every arrival order of the
response's chunks.

- **Mechanism:** `frame-client.ts:FrameImpl.#flush` (the repeat-until-no-progress
  segment loop), `#segmentReady`, `#revealSegment`, `#showFallback`,
  `#resetStreamState`, `createFrameHost.write`.
- **Pin:** `c07-store-is-truth.spec.tsx` — arms: (a) all 720 arrival orders
  of a six-record response (root, two fragments, a fallback reveal, two
  reveals) end at the oracle with no fallback/segment coexistence at any
  apply; (b) the fallback reveal alone materializes, the real reveal replaces
  it; (c) a v2 root byte-identical to v1's resets the segment.
- **Verdict:** **red on `next`** (arm c; a, b hold). See §Red R2.

### C8 — fan-out equality

All mounts of one address show the same server content and the same
resolved slot args at quiescence, whichever registered first, whatever each
mount's own version history, and however the registrations interleave with
the chunks.

- **Mechanism:** `frame-client.ts:createFrameHost` (`frames: Map<id, Set<Frame>>`,
  `register`'s one-apply seed + `rebase`, `apply`'s fan-out).
- **Pin:** `c08-fanout-equal.spec.tsx` — a second mount of one `dynamic()`
  registering before / between / after the first response's chunks, then a
  same-args refetch reaching both; `{$ref}` args resolving equally in both
  at v1 and v2; a mount registering after the second version.
- **Verdict:** **holds on `next`** (5/5 arms).

### C9 — no phantom

No fresh DOM is rendered where server markup for the same occurrence
exists: a settled boundary never shows a fallback over settled server
markup, no hydration key misses on an adopted range, and no fresh clone
replaces a claimable node — whether the fill claims in the adopt pass or
after a hold.

- **Mechanism:** `client.ts:claimRender` (keys from the producer's chain, the
  range declared as claim roots), `client.ts:slotArgsProxy` (the transparent
  async memo, the `s`/`v` stamp fast-adopt), `solid/hydration.ts:hydratedCreateLoadingBoundary`
  (settled `_fr`/serialized refs hydrate straight through),
  `frame-container-plugin.ts:materialize` + `hydration.ts:materializeContainerTrace`
  (the synchronous `.on()` replay so a delivered snapshot reads ready in the
  claim walk).
- **Pin:** `c09-no-phantom.spec.tsx` — arms: (a) an async (settled-stamped)
  arg read in the fill; (b) a container-trace arg whose snapshot is already
  delivered; (c) a plain fill after the record defer; each asserting no
  key-miss warning, no fallback frame, node identity preserved.
- **Verdict:** **holds on `next`** (3/3 arms).

### C10 — hydration ids are timing-independent

The hydration ids a fill's components claim under are a function of the
producer's key chain (`sc-<fid>-<k>-`) alone — identical whether the claim
runs in the adopt pass, after the #2968 record defer, after a `{$ref}` wait,
or after a fragment reveal.

- **Mechanism:** `client.ts:claimRender` (`createOwner({ id: prefix })`),
  `frame-client.ts:FrameImpl.#invokeSlot` (`ctx.frame`/`ctx.key` from the
  producer's `claimScope`), `client.ts:slotArgsProxy` (transparent memo),
  `client.ts:liveSlotProps` (`createSignal` over an object → core signal, no
  id consumed).
- **Pin:** `c10-ids-timing-independent.spec.tsx` — the same page claimed at
  t=0 (a), after the record defer (b), after a fragment reveal (c); the key
  claimed and the node adopted are the producer's on every path.
- **Verdict:** **holds on `next`** (3/3 arms).

### C11 — a trace materializes to one value, equal to its oracle

A materialized container trace reads, at every observable point, as the
direct materialization of the same snapshot and patch prefix would —
not-ready before the snapshot, then the snapshot with every patch applied so
far — and its value is independent of how the data was split and timed; one
trace materializes to one store however many readers revive it.

- **Mechanism:** `solid/hydration.ts:materializeContainerTrace` (sync `.on()`
  replay into a queue the projection drains; version bump per live
  emission), `frame-container-plugin.ts:materialize` (WeakMap memo per
  stream), `reviveContainerTraces`, `ContainerTracePlugin.deserialize`.
- **Pin:** `c11-trace-equals-oracle.spec.tsx` — arms: (a) snapshot before
  revival, patches after; (b) revival before the snapshot (not-ready, then
  equal); (c) 1 batch vs N batches vs random partitions give equal prefixes
  and final value; (d) two revivals of one marker are one object, and the
  page face shows the oracle at every observed frame; (e) array-rooted
  del/insert/set/length patches; (control) the trace's end latches.
- **Verdict:** **holds on `next`** (7/7 arms).

### C12 — boundary parity at claim

A `<Loading>`/`<Errored>` boundary inside adopted content shows at claim
exactly what the shell shows at that position — content for a settled
fragment, the fallback for a pending one, the error fallback for a rejected
one — and changes only when the document (or a stream) delivers.

- **Mechanism:** `solid/hydration.ts:hydratedCreateLoadingBoundary` (`_fr`
  states: pending / settled / parked / superseded / rejected), `fragmentPolicy`
  (held swaps), `client.ts:adoptBoundary.claimRegionFragments` (#2978: the
  adoption claims server-produced placeholders so a late swap lands).
- **Pin:** `c12-boundary-parity.spec.tsx` — a server `<Loading>` inside the
  adopted frame: (a) pending at adopt (fallback shows, no fetch, ledger
  pending); (b) revealed after adopt (content replaces the fallback in one
  frame, fills mount); (c) rejected after adopt (an error fallback, the
  rejection surfaced). The "fresh error fallback" clause is only partially
  testable: a server-only `<Loading>` has no client twin to render one.
- **Verdict:** **red on `next`** (arm c; a, b hold). See §Red R6.

### C13 — one sweep, one frame

Live-hole and attr-hole re-emissions produced by one server sweep become
visible together: no observable point shows one hole of the sweep updated
while a sibling hole of the same sweep still shows the previous value.

- **Mechanism:** `frame-transport.ts:applyFrames.drain` (one `host.apply` per
  chunk, an `await` between), `frame-client.ts:FrameImpl.#flush` (hole pass
  per flush), `#applied` (a `frame:applied` event per hole). The wire carries
  no sweep delimiter (principles §… "sweeps coalesce per flush … at most one
  emission per binding" — per binding, not per sweep).
- **Pin:** `c13-sweep-atomic.spec.tsx` — (a) document face: two `sc:live` ops
  written in one synchronous span; (b) stream face: two `hole` chunks in one
  burst; a `frame:applied` listener and a `MutationObserver` must never
  observe one updated without the other; (control) one hole alone.
- **Verdict:** **red on `next`** (arms a, b; identical torn frames on both
  faces). See §Red R7. This confirms the assumption in the rulings draft
  (`frames-rulings.md`, branch `spec/frames-rulings`) that C13 needs a wire
  sweep delimiter: no client-side unit larger than one op exists today, so
  no client change alone can carry the invariant.

### C14 — disposal leaves nothing

Disposing a mount — during hydration, during a `{$ref}`/record/boundary
wait, or mid-stream — leaves no frame registered on the host, no live
applier, no boundary waiter, no pending timer, and no later chunk, record or
reveal touches the DOM or invokes a fill.

- **Mechanism:** `frame-client.ts:FrameImpl.dispose` (unregister first,
  cleanups, record hygiene, `#recordRefresh` cleared), `createFrameHost.unregister`,
  `client.ts:adoptBoundary`'s `onCleanup` (applier, `fr` unsubscribe, fragment
  claims released), `client.ts:documentBoundary`'s `boundaryWaiters` cleanup,
  `client.ts:followAddress.drop`.
- **Pin:** `c14-dispose-clean.spec.tsx` — arms: (a) dispose during the
  record defer (`readyState` "loading"), the record lands after; (b) during a
  `{$ref}` wait on a stream, the data lands after; (c) during a late-boundary
  wait, the fragment reveals after and a fresh mount adopts it; (d) mid-stream
  (hole, slot, root morph after dispose); (control) the undisposed twin lands
  everything.
- **Verdict:** **holds on `next`** (5/5). The disposed frame unregisters
  first, its `#recordRefresh` is cleared, the live applier and fragment claims
  retire, and a fresh mount adopts the element the dead one never claimed
  with no key miss.

### C15 — a staged refetch lands at the commit, whole

A refetch of an address a mount is showing never shows its content beside
siblings a transaction still holds: slot args preview into the live fills in
the pass that delivered the token, and markup, store, mounts and regions
land at that transaction's commit — never when the body finishes arriving.

- **Mechanism:** `frame-transport.ts:createServerComponentHandler.stage` /
  `stagedContent` / `named`, `client.ts:followAddress` (compute `preview`,
  effect `commit`), `frame-client.ts:FrameImpl.preview`, `client.ts:stageTables`.
- **Pin:** `c15-staging-atomic.spec.tsx` — a refetch inside an `action`
  whose transaction is held by a sibling async write (`heldSibling`), a
  `MutationObserver` recording every distinct `sibling|root|fill` frame:
  (a) the body completes before the sibling releases; (b) the sibling
  releases first, the body completes after; (c) a second refetch supersedes
  the first while staged; (control) a refetch holding nothing else lands at
  body end.
- **Verdict:** **holds on `next`** (4/4). Nothing of the staged version is
  visible, applied (`frame:applied`) or versioned in the host before the
  commit; root, fill and sibling change in one frame in both orders; a
  superseded staged version never shows; the fill is updated in place (one
  read of the new arg, no re-call).

### C16 — one component identity per function

A server-function call resolves, on every path — the document's hydration
reference, the transport's post-load answer, a flight reference in a
mutation envelope, a re-call after an address switch — to a binding whose
mount component is the same object, so a `dynamic` site never remounts
across hydration and navigation.

- **Mechanism:** `frame-transport.ts:createServerComponentHandler`
  (`componentFor`, `bindingFor`, `showing`, `resolveServerComponent`),
  `client.ts:installServerComponents` (`_$SC.r` and its `b`/`c` tables),
  `web/src/index.ts:dynamic` (`sameInstance`, `resolveBinding`).
- **Pin:** `c16-reference-identity.spec.tsx` — (a)(b)(d) one document page:
  the hydration reference `_$SC.r(id, A)` adopts the SSR'd element, then a
  staged refetch of A, a switch to B, a re-call of A — every resolution's
  `COMPONENT_BINDING.component` is `_$SC.r(id)` and the `<solid-frame>` is
  the same node throughout; (c) a flight reference inside a single-flight
  envelope resolves through `resolveServerComponent` to the same component
  and the site switching from the transport's answer to the envelope's
  value keeps its element.
- **Verdict:** **holds on `next`** (2/2, covering the four paths).

### C17 — the shell gate answers only to the bound address

A mount's covering boundary resolves no earlier than the first apply
(content or error) of the address the mount is bound to, and an address
switch re-pends it until the new address's first write — the previous
address's late chunks never release it.

- **Mechanism:** `client.ts:boundaryComponent` (`applied`/`mountGate`/`settle`,
  `onApply`), `client.ts:followAddress` (re-arm in the pass, the frameless
  host waiter under the new address), `frame-client.ts:FrameImpl.rebind`
  (`#appliedRootValue = undefined`, the root record dropped).
- **Pin:** `c17-gate-bound-address.spec.tsx` — arms: (a) switch delivered
  while A is open: A's late html/complete leave the gate pending, B's first
  chunk releases it; (b) an error record as B's first chunk releases it;
  (c) A's html arrives while B's header is pending: B's delivery re-pends
  the boundary, never showing A; (d) B releases first, A's late chunks keep
  B; (control) no switch.
- **Verdict:** **red on `next`** (arms a, c; b, d, control hold). See §Red R8.

## Table

| #   | invariant                          | mechanism (carrier)                                                    | pin                               | `next`            |
| --- | ---------------------------------- | ---------------------------------------------------------------------- | --------------------------------- | ----------------- |
| C1  | claim once / replace / one adopter | `claimRender`, `slotsFor.settle`, `#replaceRange`, `claimedBoundaries` | `c01-claim-once`                  | holds             |
| C2  | no inert server content            | `#syncSlots`, `adoptBoundary` reveal cascade                           | `c02-revealed-occurrence-mounts`  | **red** (a2, b)   |
| C3  | done counts every hold             | `_pendingBoundaries` vs `#recordRefresh`/`#refsUnresolved`             | `c03-hydration-done-counts-holds` | **red** (a)       |
| C4  | record applies once, any order     | `drainRecords`, `write`, `argsEquivalent`, `#appliedHoles`             | `c04-record-applies-once`         | **red** (d)       |
| C5  | data response-scoped               | `beginStream`/`tableFor`, `host.apply` (data path)                     | `c05-data-response-scoped`        | **red** (a, b, e) |
| C6  | held record never lands stale      | `#refsUnresolved` retry, `rebind`, `dispose`                           | `c06-stale-wait-never-lands`      | **red** (a1, b2)  |
| C7  | store is the truth                 | `#flush`, `#segmentReady`, `#resetStreamState`                         | `c07-store-is-truth`              | **red** (c)       |
| C8  | fan-out equality                   | `createFrameHost.register`/`apply`                                     | `c08-fanout-equal`                | holds             |
| C9  | no phantom                         | `claimRender`, `slotArgsProxy`, settled-branch hydration               | `c09-no-phantom`                  | holds             |
| C10 | ids timing-independent             | `claimRender` owner id, `#invokeSlot` ctx                              | `c10-ids-timing-independent`      | holds             |
| C11 | trace equals oracle                | `materializeContainerTrace`, `materialize` memo                        | `c11-trace-equals-oracle`         | holds             |
| C12 | boundary parity at claim           | `hydratedCreateLoadingBoundary`, `claimRegionFragments`                | `c12-boundary-parity`             | **red** (c)       |
| C13 | one sweep, one frame               | `applyFrames.drain`, `#flush` hole pass                                | `c13-sweep-atomic`                | **red** (a, b)    |
| C14 | disposal leaves nothing            | `dispose`, `unregister`, adopt cleanups                                | `c14-dispose-clean`               | holds             |
| C15 | staged refetch lands whole         | `stage`/`stagedContent`, `followAddress`                               | `c15-staging-atomic`              | holds             |
| C16 | one component identity             | `componentFor`/`bindingFor`/`showing`, `sameInstance`                  | `c16-reference-identity`          | holds             |
| C17 | gate answers to the bound address  | `boundaryComponent` gate, `followAddress` re-arm, `rebind`             | `c17-gate-bound-address`          | **red** (a, c)    |
| C18 | classification waits for the drain | `#syncSlots` defer / `drainRecords` (one apply per record)             | `harness/replay` (C18 ×3)         | **red**           |
| C19 | a claim shows the value it read    | hydration claim pass (non-mutating) × trace replay                     | `harness/replay` (C19 ×2)         | **red**           |

C18 and C19 are shapes the property harness found (§Harness); they are
stated as invariants in §Harness-found invariants below and pinned in
`harness/replay.spec.tsx`.

## Harness-found invariants

### C18 — classification waits for the drain

A recordless adopted occurrence is classified (direct-insert vs invoked) only
after every record the document already holds for the boundary has been
applied: no sync that runs between the parser's end and the deferred drain —
the drain's own first `host.apply`, a live op, the live pump's catch-up
read — may evaluate a render prop as a zero-arg accessor.

- **Mechanism:** `frame-client.ts:FrameImpl.#syncSlots` (#2968 defer: arms
  `#recordRefresh` only while `recordsPending()`; classifies otherwise),
  `client.ts:adoptBoundary.drainRecords` (one `host.apply` per record, each a
  synchronous `#flush` → `#syncSlots`), `recordsPending` (`readyState` /
  `fr.pending()`).
- **Pin:** `harness/replay.spec.tsx` C18 ×3 (`test.fails`) + control.
- **Verdict:** **red on `next`.** See §Red R9.

### C19 — a claim shows the value it read

A fill claiming server-rendered text shows, after the claim, the value its
first read produced: when a container trace's patches landed before the
claim, the DOM shows the patched value, not the snapshot the server rendered.

- **Mechanism:** `web/src/client.ts:insertExpression` (a hydrating render is
  a claim pass, not a mutation pass — by design), `materializeContainerTrace`
  (replays snapshot + patches synchronously at revive, so the first read is
  already the patched value), `claimRender`.
- **Pin:** `harness/replay.spec.tsx` C19 ×2 (`test.fails`) + control.
- **Verdict:** **red on `next`**, **green on S1** (§S1 delta). See §Red R10.

## Red on `next`

Each: minimal shape, observed vs expected frame, diagnosis in the code's
terms, severity, and the existing test that should have caught it.

### R1 — C3: hydration reports done while an adopted occurrence is still deferred

**Shape.** One adopted boundary, one render-prop occurrence whose server
nodes are in the page; the parser is still running (`readyState === "loading"`)
and the occurrence's `sc:slot:` record has not executed when the boundary
adopts. **Observed:** `onHydrationEnd` fires with the fill never invoked and
`isHydrationInProgress()` already false; the claim happens a macrotask later
when the record lands. **Expected:** done waits for (or counts) the deferred
claim. **Where it goes wrong.** `#syncSlots` defers the occurrence through
`#recordRefresh` (a `setTimeout`) and re-syncs after `drainRecords`; that
hold registers with nothing the hydration runtime counts —
`_pendingBoundaries` only knows `<Loading>` registrations
(`initBoundaryResume`) — so `checkHydrationComplete` drains the moment the
root pass ends. Every consumer of done (`clientOnly`, the refresh runtime's
`isHydrationInProgress`, `onSettled`-style callbacks, dev's completion
check) sees a page whose adopted ranges are not yet live. The same shape
applies to the `{$ref}` wait on a stream-fed boundary and, on S1, to the
`prepareArgs` wait. **Severity:** correctness of the hydration-phase signal
(medium; the claim itself still lands). **Should have been caught by:**
`hydration/adopted-slot-late-record.spec.tsx` "waits for the record instead
of invoking the callback argless" — it asserts the claim lands, never when
`onHydrationEnd` fired relative to it; `frames-late-boundary-client.spec.tsx`
"waits for a fragment still holding the element after hydration reports
done" treats done-before-claim as the expected order.

### R2 — C7: a refetch whose shell is byte-identical never reveals its new segment

**Shape.** One frame; v1 = root shell with a `<Loading>` placeholder `pl-a`

- `fragment a` + `reveal a` (revealed: the placeholder is gone, A1 shows).
  v2 = the SAME root html (the shell of a server component rarely changes
  between refetches; fragment names restart per stream, so `pl-a` again) +
  `fragment a` (A2) + `reveal a`. **Observed:** the DOM keeps showing A1; v2's
  `seg:a` and its reveal gate sit in the store forever. **Expected:** v2's
  shell re-applies (placeholder back, fallback), then A2 reveals. **Where it
  goes wrong.** `FrameImpl.apply`'s version-bump arm calls `#resetStreamState()`
  (segments, fallbacks, holes, assets, the error latch) but **not**
  `#appliedRootValue`, which only `rebind` clears; `#flush` then value-skips the
  root (`root.value !== this.#appliedRootValue` is false), so v1's revealed
  interior stays in the DOM with no placeholder, and `#segmentReady("a")`
  fails its structural prerequisite (`#findPlaceholder` finds nothing) on
  every later flush. The store is v2; the page is v1. Staging (#3759) commits
  through the same `host.apply` path and has the same hole. **Severity:**
  stale content after refetch for every server component with a streamed
  `<Loading>` whose shell did not change (high). **Should have been caught
  by:** `frames-client.spec.tsx` "mounts, fills slot ranges from props, morphs
  on re-fetch without remounting" — its refetch changes the root html, so the
  value-skip never fires; no existing refetch test streams a `<Loading>`
  segment under an unchanged shell.

### R3 — C2 / C4: a fragment reveal is not a sync trigger (three arms, one root)

**Shape.** An adopted frame whose root is a pending server `<Loading>`
placeholder; the fragment that reveals into it carries an occurrence. Three
arrivals of the record relative to the reveal: _(C2 a2)_ the `sc:slot:`
record executes **after** the `$df`; _(C2 b)_ the occurrence is a
direct-insert `children` range, recordless by design; _(C4 d)_ the record is
in the document (and the `_fr` settled) **before** adoption but the
fragment's `$df` is parked in a reveal group. **Observed:** in all three the
revealed range is in the page with its server markup and no fill behind it —
`invocations.length === 0`, a signal bump the fill reads changes nothing,
nothing is logged; in C4(d) the record is additionally marked applied
(`appliedRecords`) so it can never apply again. **Expected:** one invocation
per occurrence, live afterwards. **Where it goes wrong.** The only thing that
re-walks a frame's content for occurrences is `FrameImpl.#syncSlots`, and it
runs only from `#flush`, which runs only when `host.apply` writes a record.
`adoptBoundary`'s `fr.subscribe` cascade reacts to a reveal by
`claimRegionFragments` + `drainRecords`; `drainRecords` applies only records
whose key is **new** to `appliedRecords`. So: a reveal with no new record
(C2 b, C2 a2 at reveal time) applies nothing and no sync runs; a record that
lands later (C2 a2) is a plain property write to `_$HY.r` observed by
nothing (the `#recordRefresh` timer arms only when a sync discovered a
recordless occurrence while `recordsPending()`, and no sync ever ran over
the revealed range); a record drained **before** the reveal (C4 d) runs its
sync while the range is still inside `<template>`, finds no marker pair,
and is consumed. The design treats "record arrives" as the sole event and
"range becomes visible" as a non-event. **Severity:** silent dead content
after any streamed boundary inside a server component whose client prop is
direct-insert or whose record trails the reveal (high — no diagnostic, no
recovery). **Should have been caught by:** `frames-adopted-region-fragments.spec.tsx`
"a record delivered with the fragment reaches the frame" — delivers the
record **with** the fragment (the one order that works, C2 a1) and asserts
only on a render-prop occurrence; nothing covers a recordless range or a
reveal-grouped `$df`, and `hydration/adopted-slot-late-record.spec.tsx`
tests the defer for an occurrence already in the shell.

### R4 — C5: a superseded response's late `data` lands in the current table

**Shape.** Two responses for one address (two preloads with held bodies, or
A → B → A → B through `dynamic` while B's first body is still open). v2's
header rotates the address's table; v1's `data` chunk for ref `"1"` arrives
after that; v2's record references `{$ref:"1"}` (ids restart per response);
v2's own data for `"1"` comes last. **Observed:** the fill mounts with v1's
value ("old") and stays there after v2's data and `complete` — a record is
never re-resolved once applied; through `host.resolve` directly, v1's late
chunk is readable as v2's `"1"` and a second straggler overwrites v2's value
after it landed. **Expected:** the record waits for v2's data; v1's chunks
are unreachable after the rotation. **Where it goes wrong.** `client.ts`
`beginStream` rotates by `tables.set(address, undefined)`; `tableFor` creates
the table lazily at first use. `createFrameHost.apply` routes `data` chunks
straight to `applyData` with **no version check** — the store's version guard
covers record writes only — so v1's late chunk is the first use and creates
the table that is now v2's; `createJSONDataTable.apply` sets the key on every
`initial` record, so whichever response's chunk arrives last owns the key.
The transport restamps chunks with the response's version, but the data
path never reads it; nothing associates a `data` chunk with the stream that
carried it once the header has rotated. **Severity:** wrong values shown
under a refetch/switch race, with no diagnostic (high — the shape is a
double-click or a fast back/forward). **Should have been caught by:**
`frames-client.spec.tsx` "suspends an async slot arg at the consumption read
and settles from the data chunk" and `frames-optimistic-hold.spec.tsx`
"multi-flight, `{$ref}` args on the shared host" — both use one response per
table rotation; neither lets a superseded body keep delivering after the
next header.

### R5 — C6: a held `slot:*` record outlives the response that carried it

**Shape (a1).** A's `{k:$ref"1", j:$ref"2"}` record is held unresolved
(A's data never arrives); the site switches to B; B's stream sends
`data → html → slot` (a legal order under RFC 11). **Observed:** at B's
html flush the fill **mounts** with A's record resolved against B's table —
the swapped pair `jB/kB` shows until B's own record live-updates it.
**Shape (b2).** A refetch of a shown address while v1's record is held;
v1's data never arrives before the staged commit. **Observed:** at the
commit the fill mounts once with v1's record read through v2's table
(`j2/k2`), then v2's record corrects it in the same task; `seen` records
both. **Expected:** no mount until the current response's own record.
**Where it goes wrong.** `FrameImpl.rebind` → `#resetStreamState(true)` →
`clearStreamRecords` drops seg/hole/attr/:error and the root but **keeps
every `slot:*` record** (the dedupe that preserves occurrence state across a
same-address morph); after the rebind `#resolveRef` routes by the frame's
_new_ id → `tableFor(B)`, so `#refsUnresolved` turns false the moment B's
data lands and B's html's flush applies A's record. In (b2),
`stage(...).commit` installs the staged tables (`tables.set(A, v2's)`)
**before** replaying the buffered chunks; the first replayed chunk (`start`)
bumps the version and flushes, and v1's held record resolves through v2's
table before v2's own record is replayed. `preview` cannot help: it pushes
only into mounted occurrences and a held one is not mounted. **Severity:**
a one-frame wrong mount (swapped/foreign args) on switch or refetch during a
`{$ref}` wait (medium-high; args are semantically wrong, not just stale).
**Should have been caught by:** `frames-live.spec.tsx` "switching arguments
ends the old connection … keeps the instance" — the old stream's record is
fully resolved there; no test leaves a record held across a rebind or a
staged commit.

### R6 — C12: a rejected server `<Loading>` fragment empties its position silently

**Shape.** An adopted frame with a pending server `<Loading>`; the server's
error path for a post-flush fragment writes a blank content template
(`sink.fragment(key, " ")`), activates it (`$df`), and rejects `<key>_fr`.
**Observed:** the swap lands the blank template — text goes "loading" → " ",
the fallback is gone, `fr.pending()` reads false, and nothing is logged.
**Expected:** an error fallback at the position (fresh client DOM) and the
rejection surfaced. **Where it goes wrong.** The server `<Loading>` has no
client twin: `hydratedCreateLoadingBoundary`'s `s === 2` branch (resume
fresh, error to the nearest `<Errored>`) runs only for a boundary that
registered against `<key>_fr`; the adoption's `claimRegionFragments` claims
the placeholder only so the swap may proceed, and the ledger's
`fragmentPolicy` swaps whatever template the document wrote. The `_fr`
rejection has no consumer (the serializer's thenable swallows it). The page
converges on an empty range with no record of the failure anywhere.
**Severity:** silent data loss on a server-side error inside a server
component (medium — the error _is_ server-side, but the client erases the
fallback and tells no one). **Should have been caught by:** nothing covers
a rejected fragment inside adopted markup; `frames-adopted-region-fragments.spec.tsx`
covers settled and undeliverable fragments only.

### R7 — C13: one sweep, two frames

**Shape.** Two live holes of one frame re-emitted by one server sweep —
document face: two `sc:live` ops written in one synchronous span; stream
face: two `hole` chunks in one burst. **Observed:** `frame:applied` fires
`a1|b0` then `a1|b1`; a `MutationObserver` sees `a0|b0 → a1|b0 → a1|b1` —
the first hole lands and is visible at a microtask checkpoint while the
second still shows the previous value. **Expected:** no torn pair. **Where
it goes wrong.** The document channel is a `ReadableStream` read one op at a
time (`pumpLiveChannel`: `reader.read().then(op => applyLiveOp(op); pump())`);
the stream transport does one `host.apply` per framed chunk with an `await`
between (`applyFrames.drain`). Each op is its own `FrameImpl.apply` →
`#flush` → `#applyHole` → `#applied(version, "morph")`, a microtask apart.
The wire carries no sweep delimiter (the server coalesces per **binding**,
not per sweep), so the client has no unit larger than one op to make
atomic. **Severity:** visible tearing between related live values (e.g. a
count and its label) for one microtask per sweep (low-medium; cosmetic
unless a consumer reads both). **Should have been caught by:**
`hydration/document-live-channel.spec.tsx` "morphs its hole to every op" and
`frames-live.spec.tsx` — both stream one hole at a time and assert final
text only.

### R8 — C17: the shell gate answers to the frame's address, which lags the binding

**Shape (a).** A's stream is held open after its header; the site switches
to B (delivered); A's late html and complete arrive before B's first chunk.
**Observed:** A's html **releases** the gate — frames `waiting → A → B`.
**Shape (c).** A's html arrives while B's header is still pending; then B
is delivered. **Observed:** at B's delivery the fallback drops and the site
shows **A** until B's html morphs it. **Expected:** `waiting → B` in both.
**Where it goes wrong.** `followAddress` re-arms the gate in its compute
half (and registers the frameless waiter under B) but defers
`frame.rebind(B)` to its effect half, which runs at the commit — and that
commit is stashed behind the very gate the boundary is pending on. The frame
therefore stays registered under A; `createFrameHost.apply` fans A's html to
it, `#flush` → `onApply`, and `boundaryComponent`'s `onApply` calls
`settle()` unconditionally — `release` is by then the re-armed gate's
resolver, so A's apply releases B's gate. In (c) A's `onApply` released the
gate legitimately, so the gate memo already holds the element when B is
delivered; the re-arm makes it pend **with** a value, and under
async-holds-latest the `<Loading>` drops its fallback for content that was
never on screen. (If the maintainer rules that holds-latest behaviour, (c)
belongs to a display invariant rather than C17.) **Severity:** a flash of
the address the user switched away from (medium; one morph later it is
right). **Should have been caught by:** `frames-client.spec.tsx` "a
remounted site binds the latest call's address (away/back)" and
"preloading the args a mounted site navigated away from does not morph its
boundary" — both complete the old stream before the switch or never deliver
the new one; no test leaves the old stream open across a delivered switch.

### R9 — C18: a sync between the parser's end and the deferred drain classifies undrained records as content

**Shape.** One adopted boundary, two render-prop occurrences whose records
are still owed when the boundary adopts (`readyState === "loading"`, the
#2968 defer arms); both records execute, then the parser finishes
(`readyState` leaves "loading") before the deferred `setTimeout` fires.
Minimal: `[item#0 item#1] :: H R0 R1`. Two further triggers with ONE
occurrence: a live hole op arriving after the record and before the drain
(`[item#0] hole :: H R0 L(ab)`), and ops logged before adoption replayed by
the live pump's first async read (`L L H R0`). **Observed:** the drain's
first `host.apply` (or the live op) runs `#flush` → `#syncSlots`; the other
occurrence is still recordless — its record sits undrained in `_$HY.r` —
and `recordsPending()` is now false, so it is classified direct-insert and
its render prop is evaluated as a zero-arg accessor. A real fill reads
`props.text` there: `TypeError` inside the insert effect →
`[REACTIVITY_HALTED]` — the whole page stops updating. **Expected:** no
zero-arg evaluation; both occurrences claim with their args. **Where it goes
wrong.** The #2968 defer treats `recordsPending()` as the only guard: once
the parser is done, any sync classifies whatever is recordless, but the
records that already executed are only moved from `_$HY.r` into the store
by `drainRecords`, which the frame calls only inside the `#recordRefresh`
timer — and applies one record at a time, each apply syncing the frame. The
window between "parser done" and "timer fired" (one macrotask) is exactly
where a document's tail — the frame's data scripts followed by the end of
the response, parsed in one go — lands. **Severity:** page-halting crash
under a realistic ordering, no recovery (high). **Should have been caught
by:** `hydration/adopted-slot-late-record.spec.tsx` and the #2968 pins —
they use one occurrence and keep `readyState` "loading" through the drain,
so no sync ever runs over an undrained record with the parser done.
**Fix shape (frames-client):** drain before classifying (call
`drainRecords` — or consult `_$HY.r` — in `#syncSlots` before the
direct-insert branch), and/or make `drainRecords` apply all records before
the first sync.

### R10 — C19: a claim keeps the snapshot's text when the trace moved before the claim

**Shape.** One render-prop occurrence with a container-trace arg; the
server rendered the snapshot (`n = 2`); a patch (`n = 5`) lands before the
fill claims — record→patch→hydrate, patch→record→hydrate, or
hydrate→patch→record (deferred claim). **Observed:** the fill's first read
is `5` (the trace replays synchronously at revive), yet the DOM keeps `2`
with no warning; it catches up at the next patch — unless that patch sets
the same value, in which case the store never changes and the DOM stays
stale indefinitely (`item#1trace(0,-2,0) :: R1 R0 T1.0 H T1.1`). **Expected:**
the claimed text equals the value read. **Where it goes wrong.** A hydrating
`insertExpression` is a claim pass — "not a mutation pass" — by design; the
trace model assumes the server text IS the store's first value, which holds
only if no patch precedes the claim. On S1 (`9927ddddd`, "a held
container-trace fill hydrates like a resident one") the shape is green: the
held fill's claim runs under a path that reconciles the text with the live
value (the same path that produces C3(b)'s red there). **Severity:** stale
value shown after hydration with no diagnostic; self-heals on the next
distinct patch (medium). **Should have been caught by:** `c11-trace-equals-
oracle` (d) — it patches only after the claim; no hydration test lets a
container trace move between SSR and claim.

## Harness

`packages/web/test/consistency/harness/` (see its README): a fast-check
scenario generator over one adopted boundary — 1–4 occurrences (render-prop
with a plain or container-trace arg, or direct-insert `children`), 0–2
server `<Loading>` fragments, an optional live hole, a late dispose — and a
shuffled schedule of the required events (hydrate, each record, each reveal,
trace patches in order, live ops, ticks, microtasks). The runner builds the
page with `support.ts`'s `bootPage` (production host, shipped document
runtime, real `hydrate`), mocks the parser's clock (`readyState` "loading"
while records/reveals are owed), and checks the oracle after every event:
immediate laws (G no-runtime-error; C1 key-miss / unclaimed / duplicate /
node-identity; C4 invoke-once / known hole value; C14 dispose-no-invoke /
no-apply; C18 classify-after-drain), settled laws at ticks and the end (C11/
C19 trace vs oracle; C4 live-op-latest; C12 fragment parity; C14 host
cleared), end laws (C3 done-counts-holds; C2 every-range-live / reactive
after a signal bump). Survey mode tallies by invariant; shrink mode reduces
one counterexample to JSON.

Campaigns on `next` (`1f8b2caf4`):

| seed  | cases | ignore           | cases with findings | findings by invariant                                                                      |
| ----- | ----- | ---------------- | ------------------- | ------------------------------------------------------------------------------------------ |
| 3289  | 500   | —                | 323                 | C3 280 (R1), C19 71 (R10, new), C18 49 (R9, new), C2 16+11 (R3), C11 0, C4 0, C12 0, C14 0 |
| 91501 | 500   | —                | 327                 | C3 268, C19 68, C18 55, C2 26+25                                                           |
| 91501 | 500   | C3, C18, C19, C2 | **0**               | nothing else surfaces                                                                      |

Shrink mode (seed 3289, ignore C3) reduces to
`[item#0 item#1 children] :: H R1 R0` → C18 on the first failing case.
Replay pins (`harness/replay.spec.tsx`): C18 ×3 (two records drained after
the parser finished; a live op before the drain; the pump's catch-up read),
C19 ×2 (patch before claim, two orders), C2 ×1 and C3 ×1 (R3/R1
rediscovered), three passing controls and a smoke. Harness bugs fixed during
sanity (laws were mis-stated, the contract text was not): the fill's
occurrence-id read is `untrack`ed (a top-level fill read is a
`STRICT_READ_UNTRACKED` diagnostic); a zero-arg fill evaluation is counted as
C18 and returns inert content instead of halting the system so later laws
stay readable; a trace occurrence whose first patch preceded the claim is
C19 regardless of later patches.

Limitations: one boundary per page; no stream face (refetch/switch —
C5/C6/C13/C15/C17 are pinned by hand); every case after the first runs in
the post-`_hydrationDone` regime; trace snapshots always precede the record;
the parser's clock flips synchronously after the last owed event (the
tightest realistic timing).

## S1 delta

Worktree `~/Development/wt-sc-contract-s1`, branch
`spec/frames-consistency-contract-s1` = `size/s1-lazy-store-materializer` @
`9927ddddd` + the eight pin/harness commits cherry-picked (clean). Consistency
suite there: 60 passed, 20 expected-fail, **3 failed**, 1 skipped (the
campaign). Versus `next` (61 passed, 22 expected-fail, 1 skipped):

- **Newly red:** C3 (b) — "container-trace arg present at adoption: the
  occurrence has claimed by hydration end". On S1 the materializer loads
  lazily and `prepareArgs` holds the occurrence; hydration-done fires before
  the held claim (the claim and a later patch still land). Same family as
  R1 (a hold hydration does not count).
- **Newly green:** C19 ×2 — the `test.fails` pins pass on S1: a trace patch
  before the claim IS shown (`R0 T H` runs with no finding at all, node
  identity included; `H T R0` shows the oracle and only C3 fires). The held
  container-trace fill of `9927ddddd` claims through a path that reconciles
  the text with the live value.
- Everything else identical to `next` (every other pin and expected-fail
  agrees; the codec warm-up probe chunk keeps C5/C6 portable).

## Recommended fix order

Hydration-core (`packages/solid/src/client/hydration.ts`, `web/src/client.ts`):

1. **R1/C3** — count frame holds (`#recordRefresh`, `#refsUnresolved`, S1's
   `prepareArgs`) in what hydration-done waits on; this also fixes the S1
   newly-red C3(b).
2. **R6/C12** — give a rejected server `<Loading>` fragment a consumer
   (error fallback + surfaced rejection) instead of the blank swap.
3. **R10/C19** — decide: either the claim pass reconciles a text hole whose
   value already differs (narrow, trace-only), or the trace model forbids
   patches before the claim (the producer holds them until the record's
   claim) — S1's held-fill path shows the former is reachable.

Frames-client (`packages/web/frames/src/`):

1. **R9/C18** (new, page-halting) — drain before classifying; batch the drain.
2. **R3/C2+C4** — make a reveal a sync trigger (re-walk the revealed range;
   do not consume a record drained while its range is still in `<template>`).
3. **R2/C7** — clear `#appliedRootValue` on a version bump so an identical
   shell re-applies its placeholders.
4. **R4/C5** — version-check the `data` path (or tag tables by response).
5. **R5/C6** — drop held `slot:*` records on rebind / staged commit, or
   re-resolve them against the carrying response only.
6. **R8/C17** — rebind the frame to the new address in the compute half (or
   make `onApply` check the address) so a stale address cannot release the
   gate.
7. **R7/C13** — needs a wire sweep delimiter (producer + transport), per the
   rulings draft; client-only work cannot carry it.

## Generic hydration — classification and pins (2026-10-06)

Branch `test/hydration-consistency-generic` off `wip/frames-pass-integration`
@ `00dbc8663` (#3837). The question: are the reds above frames-only, or are
some of them plain Solid 2 hydration holes that a page with no server
component would hit? Method: classify each invariant and red, then drive
the generic twin of every candidate through a **frames-free** page —
`hydrate()` over a `renderToStream` document with two sibling streamed
`<Loading>` boundaries (`packages/web/test/harness/generic-hydration.tsx`,
artifacts rendered by `test/server/generic-hydration.gen.spec.tsx`), by
hand (`test/consistency/generic/*.spec.tsx`) and under a property harness
(`test/consistency/generic/{scenario,run,campaign}`, opt-in behind the same
`CONSISTENCY_FUZZ` knobs as §Harness). **Nothing here changes an engine.**

**Answer: yes — six generic reds, four of them one class.** GH1–GH3 are the
plain-Solid form of R10/C19 (a claim pass that reads a value the markup was
not rendered from and does not reconcile the text); GH4 is the plain form
of the frames pass's "unrevealed boundary with `STATUS_PENDING` shows
fallback"; GH5/GH6 are the plain form of R1/C3 and C14 for a hold the
hydration runtime does not count — the root module preload. Everything else
in C1–C19 is either frames-only or holds on plain pages (1000 harness cases,
two seeds, no finding outside the six).

### Classification

Key: **SC-only** — needs frames/slots/records to express; **generic-restated**
— the SC case is an instance of a plain hydration rule (§3 _n_ cites
`documentation/plans/solid-web-size-audit.md` §3) that could break without
frames; **generic-suspect** — shared mechanism, nothing in the plain suite
pinned it before this pass. "Plain verdict" is what the generic pins and
harness found.

| #   | class            | plain rule (§3) / mechanism                                                                                                  | plain verdict                                                     |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| C1  | generic-restated | §3 1–2, 8 — `getNextElement` claim-by-key, the claim pass never mutates (`client.ts:insertExpression`)                       | holds; key misses only as consequences of GH3/GH4                 |
| C2  | generic-restated | §3 70, 76 — `resumeBoundaryHydration` is driven by the `_fr` settle + `whenRevealed`, not by the DOM reveal                  | holds (every range live and reactive, 1000 cases)                 |
| C3  | generic-restated | §3 35–37, 69 — `_pendingBoundaries` / `checkHydrationComplete`; the root preload wait (`client.ts:hydrate` `rootMapping`)    | holds for `<Loading>`; **red GH5** (preload hold not counted)     |
| C4  | SC-only          | document records (`drainRecords`) have no plain twin; the plain "applies once" is C1's no-duplicate                          | —                                                                 |
| C5  | SC-only          | per-response data tables                                                                                                     | —                                                                 |
| C6  | SC-only          | held `slot:*` records across rebind                                                                                          | —                                                                 |
| C7  | SC-only          | frame store / `#flush`                                                                                                       | —                                                                 |
| C8  | SC-only          | frame fan-out                                                                                                                | —                                                                 |
| C9  | generic-restated | §3 8, 68, 70 — settled fragment hydrates straight through (`hydratedCreateLoadingBoundary`) into an UNREVEALED core boundary | **red GH4** (fallback committed over settled content)             |
| C10 | generic-restated | §3 18, 22, 70 — ids from the owner's counter; a resume's `gather(id)`                                                        | holds (both orders claim the server nodes, no miss)               |
| C11 | SC-only          | container traces                                                                                                             | —                                                                 |
| C12 | generic-restated | §3 68 — `_fr` states pending / settled / parked / superseded / rejected (the rejected arm has a client twin on plain pages)  | holds at settle points; the transient violation is GH4            |
| C13 | SC-only          | live holes / sweeps                                                                                                          | —                                                                 |
| C14 | generic-restated | §3 35, 69 — `initBoundaryResume` disposal release + `cleanupFragment`; the preload path's deferred disposer                  | holds for boundaries; **red GH6** (dispose during preload)        |
| C15 | SC-only          | staging                                                                                                                      | —                                                                 |
| C16 | SC-only          | component identity                                                                                                           | —                                                                 |
| C17 | SC-only          | shell gate / address                                                                                                         | —                                                                 |
| C18 | SC-only          | occurrence classification                                                                                                    | —                                                                 |
| C19 | generic-suspect  | §3 6, 38, 71 — `normalize` adopts the text node without a write; the snapshot scope (#3504) is what makes the read match     | **red GH1, GH2, GH3** (three sources the snapshot does not cover) |
| R1  | generic-restated | a hold registered with nothing hydration counts                                                                              | **GH5** is its plain twin                                         |
| R2  | SC-only          | `#appliedRootValue`                                                                                                          | —                                                                 |
| R3  | SC-only          | a plain reveal IS a trigger (C2 row)                                                                                         | holds                                                             |
| R4  | SC-only          | data path version                                                                                                            | —                                                                 |
| R5  | SC-only          | rebind                                                                                                                       | —                                                                 |
| R6  | SC-only          | a server `<Loading>` with no client twin; the plain `s === 2` arm resumes fresh (`hydration/diagnostics`)                    | holds                                                             |
| R7  | SC-only          | sweep delimiter                                                                                                              | —                                                                 |
| R8  | SC-only          | gate / address                                                                                                               | —                                                                 |
| R9  | SC-only          | classification vs drain                                                                                                      | —                                                                 |
| R10 | generic-suspect  | the claim pass is not a mutation pass; the trace is one source without a snapshot — GH1–GH3 are the others                   | **GH1–GH3**                                                       |

The frames pass's six "smelled generic" findings, placed: (1) `initBoundaryResume`
ids vs the fragment ledger — SC-only (a plain boundary's id IS its fragment
key by design; the `sc:` prefix is the frames fix); (2) a hold on a page that
never ran `hydrate()` — SC-only in that shape (`initBoundaryResume` is
reached only under `hydrating`), but its generic twin — a hold the runtime
does not count — is GH5; (3) unrevealed boundary + `STATUS_PENDING` →
fallback — **generic, GH4** (the `flatten` memo-of-a-promise arm was not
reproduced on a plain page); (4) `$df` not a sync trigger — plain `<Loading>`
resumes on the `_fr` settle, holds; (5) R10's class for the plain adapters —
**generic, GH1–GH3** (the hybrid async-iterable signal path is protected by
its creation-time snapshot of the first yield; the store path parks its
backlog past hydration end — both by reasoning, not pinned); (6) events vs a
hold — **generic**: GH5's second arm (the bootstrap stops capturing once the
wrong done drained the queue) and GH4's lost click.

### Generic reds

Pins: `packages/web/test/consistency/generic/replay.spec.tsx` (GH1–GH4, over
the harness's laws) and `preload-hold.spec.tsx` (GH5, GH6). Schedules read
as `describeScenario` prints them: `H` hydrate, `Cn` the stream's n-th chunk,
`W` a client write to the module-level signal, `P` a push to the module-level
store list, `Ea`/`Eb` a click on a boundary's button, `t` a 20ms settle, `m` a
microtask, `X` dispose.

#### GH1 — C19: a memo created before capture is read live by a resume's claim pass

**Shape.** `const label = createRoot(() => createMemo(() => "label:" + path()))`
at module level (a global store module), read in the shell and in both
boundaries; `setPath("/b")` after `hydrate()` and before the fragments land
(`[ab] :: H W t C0 C1 C2 t`). **Observed:** the shell shows `label:/b`; each
boundary's resume claims the server text `label:/a` while the memo it read
says `label:/b` — the `.raw` hole beside it (the plain signal) reads the
snapshot `/a`, claims, and catches up to `/b`; `.label` never does until the
memo changes again. **Expected** (the write-before-resume contract, #3504):
the boundary resumes against the server snapshot, then catches up. **Where
it goes wrong.** `captureWriteSnapshot` records the pre-write value of a
plain SIGNAL written during capture (`core.ts:setSignal`), and a computed
created during capture gets its creation value as snapshot (`core.ts:computed`);
a computed created BEFORE capture has neither, recomputes live when its
dependency is written, and the in-scope reader finds no `_snapshotValue` to
serve. `normalize` then adopts the text node without a write (§3 6) and
`insertExpression`'s claim arm returns the value (§3 8). **Severity:** stale
DOM, no diagnostic, until the next distinct change (medium). **Fix direction
(not applied):** the computed analog of `captureWriteSnapshot` — when a
computed without a snapshot recomputes while capture is active and it is not
itself in a snapshot scope, record its pre-recompute value; or make the claim
pass reconcile a text hole whose read differs from the node (which also
covers R10).

#### GH2 — C19: a shell async memo adopted pending re-runs before a later boundary resumes

**Shape.** `shared = createMemo(async () => "shared:" + path())` in the shell,
read only inside the boundaries (pending when the shell flushes, so the
client adopts it pending: no creation snapshot — `computed()` skips
`STATUS_PENDING`, and an async landing "reveals" by design). It lands
`shared:/a` with the first fragment; a write re-runs it (`H C0 C1 t W t C2 t`);
the second boundary resumes reading `shared:/b` and claims `shared:/a`.
**Observed:** `b.shared shared:/a ≠ shared:/b` beside `b.raw /b` — one
boundary internally inconsistent. **Expected:** `shared:/b` once settled.
**Severity:** stale DOM, no diagnostic (medium). **Fix direction:** same
as GH1 (the first landed value of a pending-adopted computed is the server's
value and could seed its snapshot), or reconcile at claim.

#### GH3 — C19 / C1: a store write to a leaf no reader has materialized is not snapshotted

**Shape.** `const [store, setStore] = createStore({ items: ["i0", "i1"] })` at
module level; `<For each={store.items}>` inside each boundary; a push
(`setStore(s => s.items.push("i2"))`) after `hydrate()` and before the
fragments land (`H P C0 C1 C2 t`). **Observed:** at each resume `<For>` reads
three items against two server rows — `Hydration key miss for "…620"` (a
detached `<li>` the warning blames on id namespaces) and a list one row
short until the next structural change. **Expected:** two rows claimed, the
third inserted at release. **Where it goes wrong.** No shell reader had read
`items.length`, so the write mutates the raw target with no leaf signal to
capture; the leaf is created at the resume's first read with the post-write
value and a snapshot OF that value. Materializing the leaf before the write
(a shell reader of `items.length`) makes the same schedule green — the hole
is exactly "unmaterialized leaf". **Severity:** stale DOM + misleading dev
diagnostic (medium). **Fix direction:** under capture, a store write to an
unmaterialized leaf materializes it (so `captureWriteSnapshot` sees the
pre-write value) or records a per-target pre-write snapshot.

#### GH4 — C9 / C12 / events: a boundary resuming while a shell async source is in flight commits its fallback over the settled content

**Shape.** The GH2 page; the write lands BEFORE the first fragment
(`H W C0 C1 m t`): `shared` is superseded by a client flight (15ms); the
boundary's fragment reveals and it resumes while the flight is open.
**Observed:** the resume's content reads `shared` pending; the core boundary
has never revealed on the client, so it falls back — the fallback is
rendered in the claim window (`Hydration key miss for "410"`, `<p class="fb a">`,
a phantom the claim arm keeps out of the DOM), then `releaseSnapshotScope`
re-runs the insert OUTSIDE the window and commits it: the server `<section>`
is detached and a fresh client `<p class="fb a">a-loading</p>` stands in
its place until the flight lands, when the same server nodes are
re-attached (node identity holds, parity holds at the settle point). A
click queued on the server section at its reveal (`H W m C0 C1 C2 Eb`)
replays while the section is detached — the walk from the detached button
never reaches the delegated container — and is consumed: `b: 1 clicks, 0 handled`.
**Expected:** the settled server content is the boundary's revealed value
(async-holds-latest), no fallback, no detach, the click replays. **Where it
goes wrong.** `hydratedCreateLoadingBoundary`'s settled paths hand the
server content to `coreLoadingBoundary` as a fresh, UNREVEALED boundary;
"revealed" is a client-render fact the hydration path never asserts. The
frames pass's finding (3) is this, with frames. **Severity:** visible
fallback flash over settled content, focus/selection loss, lost pre-hydration
input (medium-high). **Fix direction:** a boundary hydrating straight
through / resuming from a settled fragment starts revealed (the claimed
content is its value), so a pending read holds.

#### GH5 — C3: hydration-done does not count a root's module preload

**Shape.** Two roots; A's `hydrate()` finds `a_assets` and defers its render
behind `loadModuleAssets`; B's `hydrate()` runs synchronously meanwhile
(islands entry-clients start several roots in one tick — the code comment
in `hydrate` names the shape). **Observed:** B's pass ends → `checkHydrationComplete`
→ `drainHydrationCallbacks`: `onHydrationEnd` fires, `isHydrationInProgress()`
reads false, `_$HY.done = true` a macrotask later — while A has claimed
nothing and cannot until its module lands. Second arm: with a queued click
to drain, the replay nulls `_$HY.events` at done and the bootstrap stops
capturing; a click on A's server markup during A's wait is neither queued
nor handled (`a: 0` where 1 was sent). A third root starting after the
timeout would degrade to `render()` (§3 33; reasoned from the `_$HY.done`
guard, not pinned). **Expected:** done waits for the preload. **Where it
goes wrong.** The wait registers with nothing the completion check counts —
`_hydratingValue` is a per-root flag the next root's `finally` clears, and
`_pendingBoundaries` knows only `<Loading>` registrations. R1 with the
record defer swapped for the preload. **Severity:** wrong done + lost input
(medium-high in islands setups). **Fix direction:** count the preload wait
as a pending registration — the same `_pendingBoundaries++` / release pair
`initBoundaryResume` keeps (what `sharedConfig.holdBoundary` wraps, minus
its owner requirement: `hydrate`'s preload branch has no owner yet) around
the `p.then`.

#### GH6 — C14: disposing a root during its module preload does not cancel the deferred render

**Shape.** `const dispose = hydrate(App, el)` with a pending `_assets`
preload; `dispose()` before the module lands. **Observed:** `hydrate` returns
`() => disposer && disposer()` with `disposer` unset until the preload's
`.then`; the call is a no-op, the render runs when the module lands, and
the root stays live (a write re-renders it) with no handle left — a second
call to the same function reaches the late disposer. **Expected:** nothing
renders after dispose. **Severity:** leaked live root (low-medium; HMR and
test teardown are the realistic callers). **Fix direction:** a `disposed`
flag in `hydrate`'s preload branch, checked before the deferred `render`
(and clearing `hydrating` / checking completion when set).

### Generic holds confirmed

On the plain page (hand pins in `replay.spec.tsx` "generic holds", and the
harness's 1000 cases with `CONSISTENCY_IGNORE=C1,C9,C19,E` → 0 findings):

- **C2 / C10** — both fragment orders, hydrate before / between / after the
  chunks: every boundary claims its server nodes (node identity, no
  duplicate, no key miss absent a client write), is invoked once, and
  reacts after a post-done write.
- **C3** — hydration-done waits for both streamed `<Loading>` boundaries in
  either order; `isHydrationInProgress()` stays true until then.
- **C12** — pending → the server fallback shows; revealed → content, no
  fallback (at every settle point).
- **C14** — dispose while both are pending, or between the reveals: the late
  chunks touch nothing, nothing runs, no error (the placeholder range is
  removed at disposal; a late `$df` queues a retry that never lands).
- **Events** — a click queued before `hydrate()` on a settled fragment, or
  after a reveal before the resume, replays exactly once at the claim
  (absent GH4's detach).
- **#3504 snapshot** — the plain signal written during hydration resumes on
  the snapshot and catches up in every schedule (the control beside GH1).
- Reasoned, not pinned: the hybrid async-iterable SIGNAL adapter is covered
  by its creation snapshot (the first yield is delivered synchronously, so
  the memo is not pending at creation); the STORE adapter parks its backlog
  past hydration end (§3 60); `lazy()` without `moduleUrl` under a settled
  boundary takes the async path and cannot claim — the documented
  degradation of §3 81, not a hole.

### Harness arm

`packages/web/test/consistency/generic/` — same knobs as §Harness
(`CONSISTENCY_FUZZ=1 CONSISTENCY_SEED=… CONSISTENCY_CASES=… CONSISTENCY_IGNORE=…
CONSISTENCY_MODE=survey|shrink`, run against `test/consistency/generic`).
Scenario: a fragment order (`ab` / `ba`, two server renders) and a shuffled
schedule of `hydrate`, the stream's chunks (wire order kept), an optional
client write and store push (after `hydrate` — before it they are an app
mismatch, outside the contract), clicks on either boundary, a dispose,
0–3 settles, 0–2 microtasks. Laws: G no-runtime-error; C1 no-key-miss /
no-unclaimed / node-identity / no-duplicate; C9 no-fallback-over-settled;
C3 in-progress-until-done / done-counts-holds; C12 fragment-parity; C19
claim-shows-signal / -memo / -async-memo / -store-list; C14 dispose-no-invoke
/ dispose-no-dom; C2 every-range-live / -reactive; E queued-click-replays-once.

| seed  | cases | ignore         | cases with findings | findings by law                                                                                                                      |
| ----- | ----- | -------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 3289  | 500   | —              | 101                 | C1 no-key-miss 95, C19 store-list 60 (GH3), C19 memo 55 (GH1), C9 fallback-over-settled 26 (GH4), C19 async-memo 16 (GH2), E 8 (GH4) |
| 91501 | 500   | —              | 99                  | C1 84, C19 memo 60, C19 store-list 48, C9 26, C19 async-memo 15, E 4                                                                 |
| 91501 | 500   | C1, C9, C19, E | **0**               | C2, C3, C12, C14, G: nothing surfaces                                                                                                |

Limitations: one page shape (two sibling boundaries; no nested boundaries,
no `lazy()`, no `<Errored>`); the server's chunking is fixed per order
(three chunks: the first boundary's data, `shared` + its fragment, the
second fragment); `_hydrationDone` is a worker latch so every case after
the first runs post-done (a reveal before `hydrate()` is held and replayed
at registration — both regimes are legal pages); `readyState` is not
mocked (plain hydration consults it only for truncation).

### Caveats

- The verdicts are "a pin could not break it", as above. The harness covers
  one page; nested boundaries resolving out of order, `lazy()` inside a
  boundary and two `hydrate()` roots are covered only by the existing suite
  (`parity-harness`, `loading-lazy-resume-3749`, `multi-root-registry`).
- GH4 self-heals for the DOM (the server nodes return); its lasting damage
  is the lost input and the focus/selection loss, which the pin observes
  through the click only.
- Severity of GH5 depends on the islands setup: a single deferred root is
  fine (control pinned); the red needs a second root finishing while the
  first waits.
