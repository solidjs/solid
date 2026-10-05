# Frames / hydration consistency contract (2026-10-05)

Branch `spec/frames-consistency-contract` off `next` @ `ea5f1da07`. **Nothing
here changes an engine.** The branch carries this document, one pin per
invariant under `packages/web/test/consistency/`, and a property harness
under `packages/web/test/consistency/harness/`.

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
- **Verdict:** see §Table.

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
- **Pin:** `c02-revealed-occurrence-mounts.spec.tsx` — arms: (a) a render-prop
  occurrence (with record) inside a server `<Loading>` that reveals after
  adoption mounts; (b) a direct-insert occurrence (recordless by design) in
  the same position mounts; (c) the order reveal-before-adopt vs
  adopt-before-reveal gives the same final page.
- **Verdict:** see §Table.

### C3 — hydration-done counts every hold

When hydration reports done (`onHydrationEnd` fires, `isHydrationInProgress()`
reads false, `_$HY.done`), every occurrence in adopted content has claimed,
or the hold deferring it is counted so that done waits for it.

- **Mechanism:** `solid/src/client/hydration.ts:checkHydrationComplete` /
  `_pendingBoundaries` / `drainHydrationCallbacks` (what done waits on);
  `frame-client.ts:FrameImpl.#syncSlots`' deferrals (`#recordRefresh`, the
  `#refsUnresolved` skip) register with nothing.
- **Pin:** `c03-hydration-done-counts-holds.spec.tsx` — arms: (a) the #2968
  record defer; (control) record present at adoption.
- **Verdict:** **red on `next`** (arm a). See §Red R1.

### C4 — a record applies exactly once, in any drain order

A document record (`sc:slot:*`, `sc:region:*`, an `sc:live` op) and a stream
record each take effect on the content a frame shows exactly once, whatever
order drains, reveals and chunks interleave; a re-drain never re-invokes a
fill or re-pushes unchanged args.

- **Mechanism:** `client.ts:adoptBoundary.drainRecords` (`appliedRecords`),
  `frame-client.ts:createFrameHost.write` (the per-address version guard),
  `FrameImpl.apply` (`argsEquivalent` dedupe), `#refArgsUnchanged`,
  `#appliedHoles` (per-mount hole dedupe), `liveOps` compaction.
- **Pin:** `c04-record-applies-once.spec.tsx` — arms over orders:
  record-before-adopt / record-after-adopt; reveal-before-drain /
  drain-before-reveal; a live op replayed from the log vs arriving live;
  the same slot record re-sent on a stream (no re-call).
- **Verdict:** see §Table.

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
- **Pin:** `c05-data-response-scoped.spec.tsx` — arms: (a) two cold streams
  for one address, v1's `data` trailing v2's header; (b) the normal order
  (control).
- **Verdict:** see §Table.

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
- **Pin:** `c06-stale-wait-never-lands.spec.tsx` — arms: (a) switch during
  the wait, the new stream's data preceding its slot record; (b) refetch
  during the wait; (c) dispose during the wait; (control) the wait resolves
  in place.
- **Verdict:** see §Table.

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
- **Pin:** `c07-store-is-truth.spec.tsx` — all permutations of a response
  with a root, two segments (one nested), a fallback reveal and a reveal,
  compared against a direct materialization; a v2 root after v1's segment
  records.
- **Verdict:** see §Table.

### C8 — fan-out equality

All mounts of one address show the same server content and the same
resolved slot args at quiescence, whichever registered first, whatever each
mount's own version history, and however the registrations interleave with
the chunks.

- **Mechanism:** `frame-client.ts:createFrameHost` (`frames: Map<id, Set<Frame>>`,
  `register`'s one-apply seed + `rebase`, `apply`'s fan-out).
- **Pin:** `c08-fanout-equal.spec.tsx` — a second mount registering before,
  between and after the chunks; a later version reaching both.
- **Verdict:** see §Table.

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
- **Verdict:** see §Table.

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
  t=0 vs after a deferred record; the keys claimed (read off the registry
  hand-over) are equal and no key miss is logged on either path.
- **Verdict:** see §Table.

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
- **Pin:** `c11-trace-equals-oracle.spec.tsx` — random splits/timings of a
  snapshot + patch sequence against an oracle (`applyPatches` semantics
  reproduced in the test); two readers of one marker share identity;
  revival before the snapshot reads not-ready then settles.
- **Verdict:** see §Table.

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
  adopted frame: pending at adopt (fallback shows, no fetch), revealed later
  (content, fills mount), rejected (error fallback is fresh client DOM).
- **Verdict:** see §Table.

### C13 — one sweep, one frame

Live-hole and attr-hole re-emissions produced by one server sweep become
visible together: no observable point shows one hole of the sweep updated
while a sibling hole of the same sweep still shows the previous value.

- **Mechanism:** `frame-transport.ts:applyFrames.drain` (one `host.apply` per
  chunk, an `await` between), `frame-client.ts:FrameImpl.#flush` (hole pass
  per flush), `#applied` (a `frame:applied` event per hole). The wire carries
  no sweep delimiter (principles §… "sweeps coalesce per flush … at most one
  emission per binding" — per binding, not per sweep).
- **Pin:** `c13-sweep-atomic.spec.tsx` — two holes re-emitted by one sweep
  arrive in one body write; a `frame:applied` listener and a
  `MutationObserver` must never observe one updated without the other.
- **Verdict:** see §Table.

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
- **Pin:** `c14-dispose-clean.spec.tsx` — arms: dispose during the record
  defer; during a `{$ref}` wait on a stream; during a late-boundary wait;
  mid-stream — then deliver everything and assert nothing moved.
- **Verdict:** see §Table.

### C15 — a staged refetch lands at the commit, whole

A refetch of an address a mount is showing never shows its content beside
siblings a transaction still holds: slot args preview into the live fills in
the pass that delivered the token, and markup, store, mounts and regions
land at that transaction's commit — never when the body finishes arriving.

- **Mechanism:** `frame-transport.ts:createServerComponentHandler.stage` /
  `stagedContent` / `named`, `client.ts:followAddress` (compute `preview`,
  effect `commit`), `frame-client.ts:FrameImpl.preview`, `client.ts:stageTables`.
- **Pin:** `c15-staging-atomic.spec.tsx` — a refetch inside an action whose
  transaction is held by a sibling async write: the frame's text and the
  sibling's text change in the same frame; a staged response's chunks never
  write through before the commit.
- **Verdict:** see §Table.

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
- **Pin:** `c16-reference-identity.spec.tsx` — the component behind the
  document's `_$SC.r(id, address)` binding is the component the transport's
  binding carries after a refetch and after an args switch; the instance
  (frame element) stands through both.
- **Verdict:** see §Table.

### C17 — the shell gate answers only to the bound address

A mount's covering boundary resolves no earlier than the first apply
(content or error) of the address the mount is bound to, and an address
switch re-pends it until the new address's first write — the previous
address's late chunks never release it.

- **Mechanism:** `client.ts:boundaryComponent` (`applied`/`mountGate`/`settle`,
  `onApply`), `client.ts:followAddress` (re-arm in the pass, the frameless
  host waiter under the new address), `frame-client.ts:FrameImpl.rebind`
  (`#appliedRootValue = undefined`, the root record dropped).
- **Pin:** `c17-gate-bound-address.spec.tsx` — a switch while the old
  address's stream is still open: its late `html`/`complete` leaves the
  gate pending; the new address's first chunk releases it.
- **Verdict:** see §Table.

## Table

| #   | invariant                           | mechanism (carrier)                                         | pin                                    | `next`  |
| --- | ----------------------------------- | ----------------------------------------------------------- | -------------------------------------- | ------- |
| C1  | claim once / replace / one adopter  | `claimRender`, `slotsFor.settle`, `#replaceRange`, `claimedBoundaries` | `c01-claim-once`              | _tbd_   |
| C2  | no inert server content             | `#syncSlots`, `adoptBoundary` reveal cascade                | `c02-revealed-occurrence-mounts`       | _tbd_   |
| C3  | done counts every hold              | `_pendingBoundaries` vs `#recordRefresh`/`#refsUnresolved`  | `c03-hydration-done-counts-holds`      | **red** |
| C4  | record applies once, any order      | `drainRecords`, `write`, `argsEquivalent`, `#appliedHoles`  | `c04-record-applies-once`              | _tbd_   |
| C5  | data response-scoped                | `beginStream`/`tableFor`, `host.apply` (data path)          | `c05-data-response-scoped`             | _tbd_   |
| C6  | held record never lands stale       | `#refsUnresolved` retry, `rebind`, `dispose`                | `c06-stale-wait-never-lands`           | _tbd_   |
| C7  | store is the truth                  | `#flush`, `#segmentReady`, `#resetStreamState`              | `c07-store-is-truth`                   | _tbd_   |
| C8  | fan-out equality                    | `createFrameHost.register`/`apply`                          | `c08-fanout-equal`                     | _tbd_   |
| C9  | no phantom                          | `claimRender`, `slotArgsProxy`, settled-branch hydration    | `c09-no-phantom`                       | _tbd_   |
| C10 | ids timing-independent              | `claimRender` owner id, `#invokeSlot` ctx                   | `c10-ids-timing-independent`           | _tbd_   |
| C11 | trace equals oracle                 | `materializeContainerTrace`, `materialize` memo             | `c11-trace-equals-oracle`              | _tbd_   |
| C12 | boundary parity at claim            | `hydratedCreateLoadingBoundary`, `claimRegionFragments`     | `c12-boundary-parity`                  | _tbd_   |
| C13 | one sweep, one frame                | `applyFrames.drain`, `#flush` hole pass                     | `c13-sweep-atomic`                     | _tbd_   |
| C14 | disposal leaves nothing             | `dispose`, `unregister`, adopt cleanups                     | `c14-dispose-clean`                    | _tbd_   |
| C15 | staged refetch lands whole          | `stage`/`stagedContent`, `followAddress`                    | `c15-staging-atomic`                   | _tbd_   |
| C16 | one component identity              | `componentFor`/`bindingFor`/`showing`, `sameInstance`       | `c16-reference-identity`               | _tbd_   |
| C17 | gate answers to the bound address   | `boundaryComponent` gate, `followAddress` re-arm, `rebind`  | `c17-gate-bound-address`               | _tbd_   |

## Red on `next`

_(filled in as pins land — each: minimal shape, observed vs expected frame,
diagnosis in the code's terms, severity)_

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
(medium; the claim itself still lands).

### R2 — C7: a refetch whose shell is byte-identical never reveals its new segment

**Shape.** One frame; v1 = root shell with a `<Loading>` placeholder `pl-a`
+ `fragment a` + `reveal a` (revealed: the placeholder is gone, A1 shows).
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
`<Loading>` whose shell did not change (high).

## Harness

`packages/web/test/consistency/harness/` — see its README. Summary of what
it generates, the oracle, seeds and results: _(filled in after the runs)_.

## S1 delta

_(filled in after step 5)_
