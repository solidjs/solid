# Frames consistency rulings — prior art

**Status:** research note, 2026-10-05. Companion to
`frames-rulings.md` (branch `spec/frames-rulings`, read at `f4b15a0a8`) and
`frames-consistency-contract.md` (branch `spec/frames-consistency-contract`).
Nothing here is a ruling; it records what comparable systems do at each of
the rulings' open seams, what broke for them, and whether that bears on the
draft recommendation.

## Scope and method

The rulings document names eight readings the maintainer must decide or nod
to — **1.3, 1.4, 1.6, 2.3, 3.1, 3.3, 3.5, 3.6** — and three product
questions — what a rejected server-only `<Loading>` shows after adopt
(C12 (c)), whether a settles-once projection crosses as a trace or as a
promise-of-snapshot, and whether crossing containers are live by default —
plus one wire fact the principle cannot supply (may `slot` trail `html`).
Between the first draft (`5257a0cbb`) and `f4b15a0a8` the maintainer's
principle ("SCs are no different than other rendered data"; "hydration
ending follows non-SC Solid 2"; "a frame is one async value outward, its
inner boundaries are the server's") decided 1.3 (yes), 1.4 (full), 1.6 (i),
2.3 (yes), 3.1 (ruled) and 3.3 (yes, re-shaped). For those the question this
note answers is *does prior art agree with the decision, and what does it
warn the implementation about*; for 3.5, 3.6 and the product questions it is
*does prior art move the recommendation*.

Reference systems, grouped as asked:

1. **React Server Components / Flight** (`react`, `react-server-dom-*`),
   with **Fizz** (the streaming HTML server and its inline instruction set),
   the **Next.js App Router** as the largest deployed Flight client, React
   Router v7's RSC mode and Waku where they differ.
2. **Remix / React Router** data layer (loaders, fetchers, revalidation).
3. **Hotwire Turbo** (Frames + Streams), **htmx** as the second DOM-addressed
   system, and **Phoenix LiveView**.
4. **Qwik** (resumability, `<Resource>`, containers) and **Astro server
   islands**.
5. **Marko** (`<await>` / `<try>`), **Vue** (hydration mismatch handling,
   lazy hydration), **SolidStart 1.x / Solid Router** (`createAsync` /
   `query`).

**Marking.** `[V]` = verified in a primary source (source file with line
numbers as fetched from `main` on 2026-10-05, official reference docs, RFC
text, or the issue/PR itself). `[I]` = inferred — a consequence I draw that
the source does not state, or a reading of behaviour from code I did not
execute. Issue titles were checked against the GitHub API; line numbers
drift and are given as orientation, not as a stable citation. Where a
secondary source (blog, talk) was the only one, it is named as such.

Our vocabulary is the rulings': *frame* (one adopted or client-mounted
server component), *record* (the slot/args chunk that binds a frame to an
address), *response/version* (one fetch of a frame's address; a refetch
advances the version), *address switch* (a mount rebinding to another
address), *claim* (the hydration pass adopting server markup), *hold* (a
pending state the client keeps the page unsettled on; L1 says every hold is
bounded), *container trace* (a store crossing as snapshot + patches), *shell
gate* (the `<Loading>` that the frame's first write releases).

---

## Which systems can speak to which questions

Reference systems differ first in *how a server-rendered unit is addressed*,
and that decides which of our questions they can even express. The matrix
below is used in every per-reading table's "can speak?" column.

| system | unit and address | 1.3 / 1.4 response identity | 1.6 gate on switch | 2.3 reveal is an apply | 3.1 hydration-done | 3.3 / C12c claim owns outcome | 3.5 classify after drain | 3.6 claim reads snapshot | fan-out / lockstep (A3/A4) | live containers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RSC / Flight + Fizz | a *tree* per request; a row id is meaningful only inside its `Response` | **strong** | **strong** (navigation, stale dehydrated boundary) | **strong** (`$RC` → `_reactRetry`) | **strong** (no page-wide done; per-boundary) | **strong** (server error → fallback → client retry → boundary) | partial (`readyState` + marker state) | **strong** (`hydrateText`, `getServerSnapshot`) | **silent** — a component rendered twice is two subtrees | contrast — "server isn't stateful" |
| Next.js App Router | Flight client + action queue + router cache | **strong** (discarded actions, cache) | strong | strong (bugs #94170, #98097) | partial | partial | — | — | silent | — |
| React Router / Remix | loaders/fetchers keyed by route + fetcher key; one data table per router | **strong** (load ids, interruption) | partial (navigation preempts) | — | — | partial (`errorElement` after data) | — | — | partial — one loader, many consumers of its data | contrast — request/response |
| Turbo Frames / Streams | DOM id (`<turbo-frame id>`, `target`/`targets`) | partial (one in-flight fetch per frame) | partial (`turbo:before-frame-render`) | — | — | **strong** (`turbo:frame-missing`) | — | — | **contrast** — one response per target; `targets` fans one payload to many ids | contrast — Streams are push, Frames are pull |
| htmx | DOM target + `hx-sync`, `hx-swap-oob` | partial (`hx-sync` strategies) | — | — | — | — | — | — | **contrast** — `hx-swap-oob` fans out by id, no shared state | — |
| Phoenix LiveView | one server-held rendered tree per connection, diffs by position; components by `(module, id)` | **strong** (`joinRef`, pending-diff races) | partial | — | partial (no hydration; `phx-update`) | partial (crash → remount) | — | partial | **closest** — components identified by id irrespective of position | **the** live-by-default system |
| Qwik | container; state serialized once at container end | — | — | — | **strong** (no hydration-done at all) | — | — | partial (end-state serialization) | — | contrast (`<Resource>` pauses SSR) |
| Astro server islands | `<script>`/fallback per island, `fetch` per island | — | — | partial (hydration clobbers late island) | — | **strong** (silent fallback on failure) | — | — | silent — duplicate islands are separate fetches | — |
| Marko | `<await>`/`<try>` boundary in the HTML stream | — | — | — | partial (client-reorder move script) | **strong** (`@catch` in place) | — | — | — | — |
| Vue | component vnode; hydration per node | — | — | — | partial (lazy hydration, no page-wide done) | — | — | **strong** (claim pass patches text) | — | — |
| Solid Router `query` | cache keyed by `key + args` | **strong** (cache entry, last resolver wins) | — | — | — | — | — | — | partial — one cache entry, many `createAsync` readers | contrast |

Read the row weights as asked: Flight/Fizz for supersession, boundary
completion and errors after the shell; Turbo/htmx as the contrast for
addressing and "identical response still applies"; LiveView for
applied-state-per-version and live containers; Qwik/Astro for alternatives
to hydration-done; Marko/Vue/Solid Router where a specific mechanism is the
closest analogue.

---

## Addressing: content-keyed (us) vs tree-shaped (RSC) vs DOM-addressed (Turbo/htmx)

**Our shape (A3 + A4, maintainer 2026-10-05).** A server component is
rendered data. One store per *address* (component + args), any number of
frames bound to it; each mount keeps its own client slot fills; a refetch
advances the address's version once and every bound site morphs together.
Contract C8 (fan-out equality) holds on `next`. The maintainer's own
framing: "RSCs are most like us — server components as data. We use HTML,
but things like Turbo/htmx use DOM addressing. We could have the same SC
inserted in multiple places; sure, the client slot fills could be different,
but the server portions would update in lockstep."

### The three shapes

**Tree-shaped (RSC / Flight).** `[V]` A Flight response is one tree per
request. Row ids are resolved against `Response._chunks`
(`ReactFlightClient.js` ≈ L390–395: `_chunks: Map<number, SomeChunk>`,
`_closed`, `_tempRefs`); there is no cross-response table. On the server,
object deduplication is per request — `writtenObjects: WeakMap`
(`ReactFlightServer.js` ≈ L619, L747) — so the same component element
rendered twice in one request is written once and referenced twice *within*
that response, and nothing survives it. The RSC RFC's refetch sequence
(`0188-server-components.md` ≈ L340–352) refetches a *subtree* and
reconciles it against the client tree, preserving client state. `[I]` A
server component mounted in two places is two subtrees with no shared
address; a refetch of one is not a refetch of the other unless the whole
enclosing tree is refetched. Fan-out equality is not a property RSC can
state, hence not one it can violate. The RFC says why
(≈ L590–592): "How is this different from Phoenix LiveView? … Our server
isn't stateful. … The tradeoff is we refetch more coarsely."

**DOM-addressed (Turbo, htmx).** `[V]` A `<turbo-frame id>` fetches its own
`src`; `FrameController.#visit` cancels the frame's previous in-flight fetch
(`frame_controller.js` ≈ L345–358: `this.#currentFetchRequest?.cancel()`)
and `#loadFrameResponse` extracts the *matching id* out of the response
document and renders it (≈ L325–343). Turbo Streams target `target="dom_id"`
or `targets=".selector"`; the latter is fan-out of *one payload* to many
elements, with no state behind it ([Streams reference](https://turbo.hotwired.dev/reference/streams),
"Targeting Multiple Elements"). htmx targets an element and lets the response
carry out-of-band fragments that swap by id anywhere on the page
([`hx-swap-oob`](https://htmx.org/attributes/hx-swap-oob/)); concurrency is
per element and opt-in via [`hx-sync`](https://htmx.org/attributes/hx-sync/)
(`drop` default, `abort`, `replace`, `queue first|last|all`). `[I]` Two
frames showing the same server content are two addresses that happen to
agree; the server has to *know* about both (OOB, `targets`) to keep them
in step, and nothing stops them drifting. Identity between responses is by
DOM id, so a stale response *does* land if it arrives after a newer one
unless the per-target fetch was cancelled — Turbo cancels, htmx only under
`hx-sync`.

**Connection-tree (LiveView).** `[V]` One server process holds one rendered
tree per connection; the client holds `Rendered` and merges diffs by
position (`rendered.js` `mergeDiff` ≈ L116, `mutableMerge` ≈ L183: a source
carrying `s` (statics) replaces wholesale, otherwise it merges into the
cached node). Components are addressed by `cid`, and the docs state identity
is `(module, id)` *irrespective of position*: "Two live components with the
same module and ID are treated as the same component, regardless of where
they are in the page. … A component is only discarded when the client
observes it is removed from the page"
([`Phoenix.LiveComponent`](https://hexdocs.pm/phoenix_live_view/Phoenix.LiveComponent.html)).
`[I]` That is the nearest thing in the references to our content-keyed
address: one server-side state, one `cid`, update once. Whether the client
renderer supports the *same* `cid` at two DOM positions simultaneously is
not something I verified; the docs describe identity surviving a *move*, not
a duplicate.

**Content-keyed (us).** The address is the content's identity. The client
keeps one store per address and many frames per store. Supersession is per
address (one version counter), not per site and not per request tree.

### What each implies

| property | content-keyed (us) | tree-shaped (RSC) | DOM-addressed (Turbo/htmx) | connection-tree (LiveView) |
| --- | --- | --- | --- | --- |
| same SC in two places | one store, lockstep (A4) | two subtrees, independent | two targets; server must fan out (OOB / `targets`) | one `cid`; moves keep state |
| stale response | per-address version stamp drops it (1.4) | per-request; a superseded request's tree is discarded wholesale (Next action queue) | per-target cancel (Turbo) or opt-in (`hx-sync`); a late response otherwise lands | `joinRef` drops messages from an old join; diffs otherwise in channel order |
| identical response | re-applies the root (our 2.2) because the version moved | reconciles; no-op commit | swaps anyway (Turbo re-renders the frame; htmx swaps) | diff is empty; nothing moves |
| duplicate fetch for the same content | impossible by construction | possible (two subtrees, one request — deduped by `writtenObjects` *within* the request only) | per target: two frames = two fetches | one process, one render |
| a site switching address | rebind: the site unbinds from store A, binds to B; A's other sites unaffected | re-render of the subtree with new props | change `src`; previous fetch cancelled | change assigns; same `cid` or a new one |

### Bugs our shape makes unrepresentable

- **Per-target duplicate fetch and drift.** `[I]` Turbo's `targets` and
  htmx's OOB exist because two targets showing the same content are two
  addresses; forgetting one is a server-side bug class (the OOB fragment
  not included) that A3 removes — there is one address to refetch.
- **Hover-preload morph / the wrong instance updating.** `[I]` In RSC a
  preloaded subtree and the visible one are different trees; a refetch
  landing in the preloaded tree does nothing for the visible one. With A4 a
  preload advances the address and every bound site sees it — which is also
  the risk below.
- **"Same content, different staleness".** `[I]` DOM-addressed systems can
  show v2 in one frame and v1 in another after a partial failure. A single
  version per address makes that state impossible — every site shows the
  store's latest applied version or is mid-apply.

### Bugs our shape invites that theirs cannot have

- **A site rebinding while another site still shows the old address**
  (the `rebind` / R5 / R8 class). `[I]` In RSC and Turbo an address switch
  is local to the subtree or target; nothing else is bound to the old
  address. Under A3 the old store may still have bound sites, so "drop the
  previous version" (1.4) and "the gate is the bound address's" (1.5/1.6)
  must be evaluated per *binding*, not per store — a response arriving for
  address A after site 1 switched to B is stale for site 1 and current for
  site 2. R8 (gate released by a superseded address) is exactly this shape,
  and no reference system has an analogue to warn from; the closest is
  LiveView's `(module, id)` identity, where the analogous question (a
  component moved while another reference still points at it) is answered
  by "discarded only when the client observes it removed".
- **Lockstep as a product surprise.** `[I]` A3/A4 means a refetch triggered
  at one site (say, a form in a sidebar card) also morphs the hero card
  bound to the same address. RSC never does this (two subtrees), LiveView
  does it by design. The contract should say so where it says C8 holds.
- **Fan-out of a *failed* version.** `[I]` Under 3.3-as-ruled the frame is
  one async value outward; a rejected version rejects every bound site at
  once. In RSC a failed subtree fails one boundary. This is consistent with
  the principle (one errored async value) but is a page-wide blast radius
  the references don't have.
- **Hold accounting across sites.** `[I]` One address, many frames, one
  `_$HY.r` ledger: 3.2's "registered once per frame" is the right unit
  precisely because the store is shared — if the hold were per store, a
  frame unbinding could release a hold another frame still needs (the
  Vue #15091/#15252 shape, below, in a form Vue cannot reach because its
  holds are per component instance).

### Conclusion of this section

Prior art does not contain our shape. RSC is the model for *what a server
component is* (data, a tree, refetched coarsely) and is silent on fan-out;
Turbo/htmx are the contrast (addresses are DOM positions; fan-out is a
server-side chore; staleness per target); LiveView is the only system with
content identity independent of position and the only one that pays the
live-by-default cost. The maintainer's A3/A4 reading is therefore
*unprecedented but not contradicted*: it collapses a bug class (drift between
duplicates) that DOM-addressed systems have to manage by hand and trades it
for a bug class (rebinding while other sites remain) that no reference system
can exhibit, so no reference system has debugged it for us. The rulings
already name that class (R5, R8, 1.5, 1.6) — the prior art's contribution
is to say the per-*binding* evaluation of staleness and gate is the thing to
pin, because it is the one place our model has no outside check.

---

## Seam 1 — Response identity

### 1.3 A record resolves its refs through its own response's table, wherever the frame is bound

**Our question:** when a `slot` record's `{$ref}`s point at `data` chunks,
are they looked up in the table of the response that delivered the record,
even if the frame is bound at a mount that adopted a different response?
(Decided *yes* by the principle, corollary 1; this section asks whether
prior art agrees.)

| system | can speak? | what it does | source | known failure modes | bearing |
| --- | --- | --- | --- | --- | --- |
| Flight client | yes | `[V]` A row id resolves only in its own `Response._chunks`; `getChunk` after `close()` yields an error chunk (or a halted one under `_allowPartialStream`); `reportGlobalError` rejects every still-pending chunk of that response. | [`ReactFlightClient.js`](https://github.com/facebook/react/blob/main/packages/react-client/src/ReactFlightClient.js) ≈ L390, L1289, L1658, L5702 | None found for cross-response refs — the type system makes them impossible. | **for** — response-scoped tables are the baseline; a ref has no meaning outside its response. |
| Flight server | yes | `[V]` `writtenObjects` dedupes per request; `temporaryReferences` are a per-request escrow. | [`ReactFlightServer.js`](https://github.com/facebook/react/blob/main/packages/react-server/src/ReactFlightServer.js) ≈ L619, L747 | — | **for** — identity of shared objects is a per-request fact on the producer too. |
| Next.js App Router | yes | `[V]` A navigation preempting a pending server action marks it `discarded`; its Flight payload is not applied to the tree, but its *revalidation intent* is kept and becomes a deferred `ACTION_REFRESH`. | [`app-router-instance.ts`](https://github.com/vercel/next.js/blob/canary/packages/next/src/client/components/app-router-instance.ts) ≈ L112–128, L197–218 | [#84299](https://github.com/vercel/next.js/issues/84299) transition deadlock — a discarded action never settled its promise. | **for**, with a warning: a dropped response must still *settle* whatever awaited it. |
| React Router | yes | `[V]` Every load is stamped with an incrementing id; `abortStaleFetchLoads(landedId)` aborts in-flight loads with `id < landedId`; `interruptActiveLoads` cancels and marks for revalidation. | [`router.ts`](https://github.com/remix-run/react-router/blob/main/packages/react-router/lib/router/router.ts) ≈ L3539, L3633, L3666 | [#15365](https://github.com/remix-run/react-router/pull/15365) stale reload id left behind after abort → invariant throw; [#10473](https://github.com/remix-run/react-router/issues/10473) fetcher revalidation race. | **for** — identity is stamped at issue, and the stamp is what staleness is judged against. |
| LiveView / Phoenix | yes | `[V]` `Channel.isMember` drops a message whose `joinRef` is not the current join ("dropping outdated message"). | [`channel.js`](https://github.com/phoenixframework/phoenix/blob/main/assets/js/phoenix/channel.js) ≈ L241–250 | [#3710](https://github.com/phoenixframework/phoenix_live_view/pull/3710), [#3957](https://github.com/phoenixframework/phoenix_live_view/pull/3957) — pending diffs dropped or misapplied around a pending link/join. | **for** — plus the warning that "current" must be read at the right moment. |
| Solid Router `query` | yes | `[V]` A cache entry is `[ts, promise, value, intent, versionSignal]`; `handleResponse` writes `cached[2] = v` for whichever promise settles *last* — no stamp. | [`query.ts`](https://github.com/solidjs/solid-router/blob/main/src/data/query.ts) | [#464](https://github.com/solidjs/solid-router/issues/464) stale entry reused after hydration; [#497](https://github.com/solidjs/solid-router/issues/497) first `revalidate()` + `refetch()` did not refresh. | **for** by counter-example — an unstamped shared table is the bug. |
| Turbo | partial | `[V]` One fetch per frame; a new visit cancels the previous. | [`frame_controller.js`](https://github.com/hotwired/turbo/blob/main/src/core/frames/frame_controller.js) ≈ L345–358 | — | orthogonal — no refs to resolve; identity is the target. |
| Qwik / Astro / Marko / Vue | no | Single response per page/island; no second response to confuse. | — | — | orthogonal. |

**Verdict.** Prior art is unanimous where it can speak: a reference has
meaning only in the response that produced it, and the systems that lacked a
stamp (Solid Router's `cached[2]`) or lost it (RR #15365) shipped the exact
bug 1.3 forbids. The principle's "yes" is strengthened. Repercussion to
carry: Next #84299 — when a response is dropped as stale, everything that
awaited one of its refs must still settle (reject), or the waiting
computation deadlocks; Flight does this with `reportGlobalError`/`close`
erroring pending chunks, and our bounded-hold rule (L1) needs the same
explicit "close rejects the pending" on the stale path, not just on the
truncation path (§5.5 of the principles already states it for the document
face's close; 1.3/1.4 should state it for supersession).

### 1.4 A version bump drops what the previous version never applied

**Our question:** when a refetch advances an address's version, is the
previous version's un-applied state dropped *entirely* (full) or only its
root/applied cache (narrow)? (Decided *full*; the precondition — may
`slot` trail `html` — stays open.)

| system | can speak? | what it does | source | known failure modes | bearing |
| --- | --- | --- | --- | --- | --- |
| Next.js App Router | yes | `[V]` "Only advance the queue if the settled action is still at its head" (≈ L54–90); a preempted action is `discarded` wholesale — nothing of its payload is applied — but `didRevalidate` is carried forward as a deferred refresh. | [`app-router-instance.ts`](https://github.com/vercel/next.js/blob/canary/packages/next/src/client/components/app-router-instance.ts) | [#88343](https://github.com/vercel/next.js/issues/88343) "Race condition in action queue can undo navigation", fixed by [#95391](https://github.com/vercel/next.js/pull/95391); [#84299](https://github.com/vercel/next.js/issues/84299). | **for (full)** — partial application of a superseded payload was the bug; the fix is discard-all, keep-the-intent. |
| Flight client | yes | `[V]` A `Response` is closed as a unit; a superseded response is simply not read further, and `close()` errors its pending chunks. | `ReactFlightClient.js` ≈ L1289, L5702 | — | **for (full)**. |
| React Router | yes | `[V]` Interruption → abort + mark revalidation (`interruptActiveLoads`); a loader result from an aborted load is never merged (`cancelledFetcherLoads`). | `router.ts` ≈ L3539 | [#14506](https://github.com/remix-run/react-router/issues/14506) fetcher idle before new loader data → flicker; [#10623](https://github.com/remix-run/react-router/pull/10623). | **for (full)**, warning: the *state* flag ("idle") must not flip before the *data* of the winning version has landed — our "applied means shown" (2.4). |
| Remix concurrency doc | yes | `[V]` "latest wins", stale responses discarded; the cancelled request still reaches the server (potential for stale data). | [Remix: Concurrency](https://remix.run/docs/en/main/discussion/concurrency) | — | **for**; the server-side effect of a dropped response is not undone. |
| LiveView | yes | `[V]` On reconnect the LiveView `mount/3`s again and a full render replaces the tree — nothing from the old connection's pending diffs is merged. | [`Phoenix.LiveView` docs](https://hexdocs.pm/phoenix_live_view/Phoenix.LiveView.html) | [#3957](https://github.com/phoenixframework/phoenix_live_view/pull/3957) pending diff race while join pending. | **for (full)** at the connection level; within a connection there is no version — ordering is the channel's. |
| Turbo | partial | `[V]` Cancelling the previous fetch means its response never renders; there is no partial state to drop. | `frame_controller.js` ≈ L345–358 | — | **for**, trivially — the DOM-addressed shape has no un-applied state. |
| Solid Router `query` | yes | `[V]` No drop: the later-settling promise wins (`cached[2]`), regardless of which was issued later. | `query.ts` | #464, #497 | **for** by counter-example. |
| Qwik / Astro / Marko / Vue | no | — | — | — | orthogonal. |

**Verdict.** Everything that can speak says *full*: a superseded unit of
response is discarded as a unit. Two warnings for the implementation. (1)
Next's discarded-but-revalidated case: dropping a version must not drop a
*side effect it carried* — if a stale response's `slot` record was the one
that would have released a gate or scheduled a revalidation, the current
version must do it (R8 is the same shape from the other side). (2) RR
#14506: the version must not be reported "applied/idle" until the winning
version's data has landed. On the precondition (slot trailing html): no
reference streams a *structured record after the markup it binds*; Fizz
emits the `<div hidden id="S:n">` content and then the `$RC` instruction
that swaps it in (so the instruction trails the markup, always), and Flight
rows carry their model inline. `[I]` The closest precedent for "the binding
may arrive after the thing it binds" is Fizz's own ordering — markup first,
instruction second — which is the *opposite* assumption from the sink's
"records ahead of markup". That is not an argument either way; it is a note
that the references fix one order and we fix none (RFC 11), and the
#2968 defer exists because of that choice.

### 1.6 A switch keeps on screen what was on screen

**Our question:** when a mount switches address, is the shell gate's value
(i) the bound address's own pending state — the old content stays until the
new address writes — or (ii) the latest value from either address?
(Decided (i).)

| system | can speak? | what it does | source | known failure modes | bearing |
| --- | --- | --- | --- | --- | --- |
| React Suspense (client) | yes | `[V]` Inside a Transition React "keep[s] showing the previous page instead of hiding any already revealed content"; a non-transition update that suspends shows the fallback again; `key` on the boundary opts into "show the fallback instead of the previous content" for *different* content. | [react.dev › Suspense](https://react.dev/reference/react/Suspense) ("Preventing already revealed content from hiding", "Resetting Suspense boundaries on navigation") | — | **for (i)**, with a named exception: the author may ask for a reset with `key`; we have no analogue (and A29 #3540's exemption plus the `<Loading>` retain rule say we don't want one by default). |
| React hydration (dehydrated boundary) | yes | `[V]` If a parent update makes not-yet-hydrated HTML stale, React "will hide it and replace it with the fallback" (WG #37); in code, "This boundary has changed since the first render … unable to hydrate" → client render or selective-hydration lane. | [reactwg/react-18 #37](https://github.com/reactwg/react-18/discussions/37); [`ReactFiberBeginWork.js`](https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberBeginWork.js) ≈ L3051 | React's own TODO (≈ L3109–3113): "The Fizz runtime might still stream in completed HTML, out-of-band. Should we fix this?" | **for (i) in spirit, against in mechanism**: React discards the stale *dehydrated* content for a fallback because it cannot morph it; we can morph adopted markup, so (i)'s "keep what was on screen" is available to us where it is not to React. |
| Next.js App Router | yes | `[V]` Navigation preempts a pending action; the pending action's result does not land in the new route's tree. | `app-router-instance.ts` ≈ L197–218 | #88343 (navigation reverted by a stale action — R8's shape). | **for (i)** — the gate belongs to the current address. |
| React Router | partial | `[V]` Navigation interrupts active loads; the new location's loaders own the pending state (`state.navigation`). | `router.ts` ≈ L3539 | — | **for (i)**. |
| LiveView | partial | `[V]` `live_patch`/`live_navigate` keep the current DOM until the new render diff arrives; #3710 fixed a race where a diff arriving during a pending link was mishandled. | [#3710](https://github.com/phoenixframework/phoenix_live_view/pull/3710) | #3710 | **for (i)**, warning: "pending" state must be evaluated against the *target* of the switch, not the moment the diff arrived. |
| Turbo Frames | partial | `[V]` Changing `src` keeps the current frame content until the response renders (`turbo:before-frame-render` is the hook to intercept); `aria-busy`/`busy` marks the pending frame. | `frame_controller.js` ≈ L87–130, L325–343 | — | **for (i)** — the DOM-addressed shape *only* has (i). |
| htmx | partial | `[V]` Target keeps content until swap; `hx-sync="…:replace"` cancels the previous request so the old response cannot land. | [`hx-sync`](https://htmx.org/attributes/hx-sync/) | — | **for (i)**. |
| Qwik / Astro / Marko / Vue | no | — | — | — | orthogonal. |

**Verdict.** Prior art is for (i) wherever it can speak, and nowhere does a
system show a *previous address's* pending state as the current one. The
decision stands. The repercussion the references warn about is React's TODO
at L3109: when old content is discarded for a fallback, a late completion
from the old stream can still arrive "out-of-band" — our equivalent is a
late `html`/`slot` for the previous address arriving after the switch, which
1.3/1.4 drop by version; (i) is only safe *because* 1.4 is full. The React
`key` reset is the one product behaviour the references have that (i) lacks:
an author-chosen "this is different content, show the fallback". Note it as
a possible option, not a default.

---

## Seam 2 — Applied state per version

### 2.3 A reveal is an apply

**Our question:** when a held or hidden frame is revealed (a `<Loading>`
resolves, a parked occurrence is released), does the reveal run the same
apply path as a fresh landing — binding records, releasing holds, triggering
hydration of the revealed subtree — rather than merely un-hiding?
(Decided *yes*.)

| system | can speak? | what it does | source | known failure modes | bearing |
| --- | --- | --- | --- | --- | --- |
| Fizz runtime | yes | `[V]` `completeBoundary` (`$RC`) moves the hidden content into place, sets the marker to complete, and then calls the boundary's `_reactRetry` if one was registered — the reveal explicitly re-triggers the reconciler's hydration of that boundary. `clientRenderBoundary` (`$RX`) does the same after marking `$!`. A completed boundary with no content node is ignored; a missing boundary removes the content. | [`ReactDOMFizzInstructionSetShared.js`](https://github.com/facebook/react/blob/main/packages/react-dom-bindings/src/server/fizz-instruction-set/ReactDOMFizzInstructionSetShared.js) ≈ L378–461 | [Next #94170](https://github.com/vercel/next.js/issues/94170) — opener emitted as `$~` instead of `$?`, so `$RC` "silently no-ops" and the content is orphaned; [Next #98097](https://github.com/vercel/next.js/issues/98097) — a boundary is never hydrated until interaction. | **strongly for** — React learned that un-hiding without re-entering the apply path leaves the subtree dead. |
| React reconciler | yes | `[V]` `registerSuspenseInstanceRetry`: if the instance is not pending, or the document has finished loading, call back now; otherwise store `_reactRetry` and also listen for `DOMContentLoaded`. | [`ReactFiberConfigDOM.js`](https://github.com/facebook/react/blob/main/packages/react-dom-bindings/src/client/ReactFiberConfigDOM.js) ≈ L4367 | React #35821 / #36134 (a ping with no scheduled callback — `useDeferredValue` stuck) as a cousin: a state change that nobody is woken for. | **for** — "revealed" without a wake-up is a hold with no release. |
| Next.js App Router | yes | `[V]` #97036: "Client navigation intermittently commits into a permanent Suspense fallback … zero in-flight network, reload-only recovery". | [#97036](https://github.com/vercel/next.js/issues/97036) | itself | **for** — the failure is a reveal that never happens because nothing re-enters the apply path. |
| Astro server islands | partial | `[V]` The island replacer reads the response body and swaps it in; [#12394](https://github.com/withastro/astro/issues/12394): a framework parent hydrating after the island landed clobbered the island's DOM. | [`server-islands.ts`](https://github.com/withastro/astro/blob/main/packages/astro/src/runtime/server/render/server-islands.ts) ≈ L249–264 | #12394 | **for** — a landing that is not an apply in the enclosing tree's terms gets overwritten by the next apply that is. |
| Marko 5 `<await client-reorder>` | partial | `[V]` Placeholder + a move script that relocates the late content; the client runtime then hydrates the moved content as part of the component's init. | [`await/renderer.js`](https://github.com/marko-js/marko/blob/main/packages/runtime-class/src/core-tags/core/await/renderer.js) ≈ L227–253 | — | **for** (the move is followed by init, not just un-hiding). |
| Vue lazy hydration | partial | `[V]` A lazy strategy (`hydrateOnVisible` …) defers *hydration*, not display; firing it runs the full hydrate. | [Vue › Async Components › Lazy Hydration](https://vuejs.org/guide/components/async#lazy-hydration) | [#15091](https://github.com/vuejs/core/issues/15091) / [#15092](https://github.com/vuejs/core/pull/15092) / [#15252](https://github.com/vuejs/core/pull/15252) — the strategy fired after the node was detached or the component unmounted. | **for**, warning: the deferred apply must check it still has a live target. |
| Turbo / htmx / LiveView / Qwik / RR | no | No hidden-then-revealed state; content is swapped when it arrives. | — | — | orthogonal. |

**Verdict.** The strongest agreement in the whole survey. Fizz's `$RC`
calling `_reactRetry` *is* "a reveal is an apply", and the two Next.js bugs
(#94170, #98097) plus #97036 are what happens when the reveal and the apply
are separate steps and one is skipped. The decision stands and is
strengthened. Repercussion: Vue #15091/#15252 — an apply that was deferred
must re-validate its target (the frame may have unbound, the mount may have
switched, R5's held record may belong to an outlived response) before
running; a reveal-as-apply on a dead target must be a no-op, not a throw.

---

## Seam 3 — Hydration-done accounting

### 3.1 Hydration-done follows non-SC Solid 2 (ruled)

**Our question (now ruled):** does the frames client's pending work count
toward the page's hydration-done exactly as a non-SC `<Loading>` does —
registered as a pending boundary via the existing ledger — rather than via a
second notion of done? The question for prior art: does any system have a
page-wide "hydration done", and what did the ones without it pay?

| system | can speak? | what it does | source | known failure modes | bearing |
| --- | --- | --- | --- | --- | --- |
| React | yes | `[V]` No page-wide done. Every dehydrated Suspense boundary is a fiber; it completes by `$RC`, client-renders by `$RX`, or — once the document has finished loading — a still-pending marker is treated as a fallback (`isSuspenseInstanceFallback` = `$!` or (`$?` and `readyState !== 'loading'`)) and client-rendered. `hydrateRoot` has `onRecoverableError`; there is no `onHydrated`. | `ReactFiberConfigDOM.js` ≈ L4315–4367; [react.dev › hydrateRoot](https://react.dev/reference/react-dom/client/hydrateRoot) | Next #86151 (soft navigation stuck with `loading.js` — root-caused to a React ping without a scheduled callback), React #35821/#36134. | **for** the shape (every hold is a counted boundary with a bounded resolution — L1) and **for** having no second notion of done. |
| Vue | yes | `[V]` No page-wide done; `app.mount()` hydrates synchronously, async components and lazy strategies hydrate later per component. | [Vue › SSR › Hydration](https://vuejs.org/guide/scaling-up/ssr#client-hydration) | #15091, #15252 (per-component holds outliving their target). | **for** — and shows the cost of per-instance holds with no ledger: nothing tells the hold its target is gone. |
| Qwik | yes | `[V]` No hydration, therefore no hydration-done; state is serialized once at the container's end (`qwikloader` resolves the container by walking from `lastElementChild`), and `<Resource>` "will pause rendering until the resource is resolved" during SSR. | [Qwik › Resumable](https://qwik.dev/docs/concepts/resumable/); [`qwikloader.ts`](https://github.com/QwikDev/qwik/blob/main/packages/qwik/src/qwikloader.ts) | [qwik-evolution #16](https://github.com/QwikDev/qwik-evolution/discussions/16) — out-of-order streaming requires forward references for unresolved promises and a single-pass serializer; not shipped. | **orthogonal with a lesson**: Qwik avoids the accounting by refusing to stream pending state. We stream it, so we must count it. |
| Astro server islands | partial | `[V]` Islands are fetched after load; the page is "done" without them; nothing tracks their completion. | [Astro › Server islands](https://docs.astro.build/en/guides/server-islands/) | #12394 (clobbered by a later hydration) | **for** counting — the uncounted island is the one that gets clobbered. |
| Marko | partial | `[V]` `<await>` with `client-reorder` moves content when it arrives; component init runs per boundary. | `await/renderer.js` | — | neutral. |
| LiveView | partial | `[V]` No hydration; the client joins and the server renders. Pending = "not joined yet"; `phx-update="ignore"` for DOM the client owns. | [`Phoenix.LiveView` docs](https://hexdocs.pm/phoenix_live_view/Phoenix.LiveView.html) | — | orthogonal. |
| Turbo / htmx / RR / Solid Router | no | — | — | — | orthogonal. |

**Verdict.** Agrees. No reference has a second notion of done, and the one
system that does have a per-boundary accounting (React) bounds every hold
three ways (`$RC`, `$RX`, document-loaded ⇒ fallback ⇒ client render). The
repercussion for 3.2 (the mechanism): React's third bound — *the parser
finishing turns "pending" into "failed"* — is what makes the accounting
total. Our §5.5 "parser finishing is the transport's close; unsettled `_fr`
marked rejected" is the same rule and must apply to the holds 3.2 registers
through `initBoundaryResume`, or a frame whose stream was truncated holds the
page forever (Next #86151's user-visible shape).

### 3.3 A claim is a promise to account for the outcome (re-shaped)

**Our question:** when the client claims a server-rendered fragment whose
`_fr` later rejects, who shows the outcome? Re-shaped by corollary 4: the
client shows *the server's rendered outcome* — never a blank, never a
client-invented error state; the fix is the server half (the document face
writes a blank at `server.ts:2911`); the client minimum is a dev-only
report. The contract's C12 (c) "fresh client error fallback at the
position" is rejected. Does prior art agree that the server owns the error
rendering, and what happens to systems whose client stays silent?

| system | can speak? | what it does | source | known failure modes | bearing |
| --- | --- | --- | --- | --- | --- |
| React Fizz + hydration | yes | `[V]` An error inside a boundary after the shell: Fizz emits the boundary's *fallback* HTML and `$RX` with a digest; on the client React retries rendering; if the client render also throws, the nearest error boundary shows. `onError` (server) and `onRecoverableError` (client) both fire; `reportError` is the default. Never silent, never blank. | [react.dev › renderToPipeableStream › Recovering from errors outside the shell](https://react.dev/reference/react-dom/server/renderToPipeableStream#recovering-from-errors-outside-the-shell); `ReactFiberBeginWork.js` ≈ L2969 ("The server could not finish this Suspense boundary … Switched to client rendering") | — | **mixed**: *for* "the server renders the outcome" (fallback HTML is server-rendered), *against* "no client arm" — React's second act is a client retry and then a *client* error boundary. Note React has no server error boundary to render into; we do (a server `<Errored>`), which is why corollary 4 can make the server half sufficient. |
| Marko 5 / 6 | yes | `[V]` `<await>` with `<@catch>` renders the catch body *in place* in the stream; without one the error goes to `out.error(err)` and the stream errors. Default 10 s timeout → `TimeoutError`. Marko 6 `<try>`: "the content is replaced with the content of the `@catch`". | [`await/renderer.js`](https://github.com/marko-js/marko/blob/main/packages/runtime-class/src/core-tags/core/await/renderer.js) ≈ L227–253; [Marko 6 core tags](https://markojs.com/docs/reference/core-tag) | — | **for** the re-shaped 3.3 exactly: the server renders the error outcome into the fragment; the client has nothing to invent. |
| Turbo Frames | yes | `[V]` A response without a matching frame fires cancelable `turbo:frame-missing`; by default Turbo "writes an informational message into the frame and throws an exception" (`TurboFrameMissingError`). | `frame_controller.js` ≈ L414–444; [Turbo events](https://turbo.hotwired.dev/reference/events); [#863](https://github.com/hotwired/turbo/pull/863) | Before #863 a missing frame broke out of the frame to a full-page visit. | **for** "never blank, report loudly"; the message is client-written only because Turbo has no server-rendered error slot. |
| Astro server islands | yes | `[V]` `replaceServerIsland` returns silently on a non-200 or non-`text/html` response; the fallback stays; nothing is surfaced. | `server-islands.ts` ≈ L249–264 | [#15945](https://github.com/withastro/astro/issues/15945) (island not rendered); [#17680](https://github.com/withastro/astro/pull/17680) (endpoint missing in static builds — fallback permanently visible). | **against silence** — this is the failure the dev-only report must catch: a fallback that is indistinguishable from "still loading". |
| LiveView | partial | `[V]` A crash in the LiveView process → the client sees the channel close and re-joins → `mount/3` re-runs and re-renders; a crash in a LiveComponent crashes the parent. Nothing is rendered *as* an error; the page re-renders. | `Phoenix.LiveView` docs ("Life-cycle" / reconnect) | — | orthogonal to C12 (c)'s shape (no partial error outcome exists). |
| React Router | partial | `[V]` A loader error renders the route's `errorElement` at the route's position; a *deferred* value's rejection renders `<Await errorElement>` at the value's position. | [React Router › `<Await>`](https://reactrouter.com/api/components/Await) | — | **for** "the outcome renders at the position" and, like React, it is a *client* arm — the server has no error template. |
| Vue / Qwik / Solid Router | no | — | — | — | orthogonal. |

**Verdict.** Prior art splits on *who* renders the outcome, and the split
tracks whether the system *has* a server-side error boundary. React, Turbo
and React Router render the error on the client because their servers emit
a fallback or nothing; Marko, which has a server-side `@catch`, renders it in
place and the client does nothing — exactly the re-shaped 3.3. So the
re-shaped reading has a precedent (Marko) and the rejected C12 (c) client arm
has a reason to exist only where no server arm exists. What every system
agrees on is **never silent**: Astro is the cautionary case — a fallback left
in place with nothing surfaced ("permanently visible") was indistinguishable
from loading. The repercussion is two-fold: the server half must *actually
render* the error outcome into the fragment on the document face (today a
blank), and the dev-only report (3b) is not optional polish — it is the only
thing standing between us and Astro's failure when a server `<Errored>` is
absent and the error escapes as the frame's `:error`.

### 3.5 An occurrence is classified only after every delivered record has drained

**Our question:** is an occurrence judged "pending / settled / rejected"
only after every record the response delivered has been drained into its
frame — so the parser's end alone does not classify what the ledger still
has in flight? (The principle says no reading to decide; confirm wording.)

| system | can speak? | what it does | source | known failure modes | bearing |
| --- | --- | --- | --- | --- | --- |
| React hydration | yes | `[V]` `isSuspenseInstanceFallback` reads *both* the boundary's marker state (`$!`, `$?`, `$~`) and the parser's state (`readyState !== 'loading'`); `registerSuspenseInstanceRetry` handles "Fizz completed it between render and commit" by calling back immediately. `completeBoundary` marks `$~` on a batched boundary "so we know not to client render it at the end of document load". | `ReactFiberConfigDOM.js` ≈ L4315–4367; `ReactDOMFizzInstructionSetShared.js` ≈ L408–461 | [Next #94170](https://github.com/vercel/next.js/issues/94170) — a wrong marker state at classification time made the swap a no-op. | **for** — classification reads the ledger (the marker) and the parser together; a boundary that has been *delivered but not yet applied* is explicitly protected from being classified as failed at document end. |
| Flight client | partial | `[V]` `close()` after the stream ends errors only chunks still *pending*; chunks delivered but not yet initialized (lazy) are resolved from their delivered bytes, not errored. | `ReactFlightClient.js` ≈ L1289, L5702 | — | **for** — "delivered" and "settled" are distinct states and close respects the first. |
| LiveView | partial | `[V]` Diffs apply in channel order; `mergeDiff` replaces a node wholesale when statics arrive, else merges; no per-patch stamp. #3957: a diff delivered while the join was pending was handled at the wrong moment. | `rendered.js` ≈ L116, L183; #3957 | #3957 | **for**, as a warning — classification before the delivered backlog drains is the bug class. |
| Turbo | partial | `[V]` `complete` is set only after `view.render(renderer)` resolves (≈ L335–336), not when the response arrives. | `frame_controller.js` ≈ L325–343 | — | **for** — "complete" is after apply, not after delivery. |
| Vue / Qwik / Astro / Marko / RR / htmx / Solid Router | no | — | — | — | orthogonal. |

**Verdict.** Prior art agrees with the sentence as written and supplies the
wording the maintainer asked to confirm: *delivered is not drained, and the
parser's end classifies only what was never delivered*. React's `$~` marker
exists precisely to carry "delivered, applying, don't fail me at document
end" across the batch boundary, which is our "delivered-undrained term" in
`recordsPending`. The repercussion the references name (Next #94170): the
classification must read a state the *drain* maintains, not one the
*delivery* sets, or a record that arrived in a shape the drain did not
recognise (a multi-record chunk, a trailing `slot`) is counted as drained
when it was only delivered.

### 3.6 A claim shows the value it read — and reads what the markup was rendered from

**Our question:** when a patch beyond the server's snapshot lands before the
claim, does (i) the claim pass rewrite the text hole, (ii) the producer hold
patches until the claim, or (iii) the consumer park the backlog until
hydration ends and apply it after? (Principle supports (iii); open because
the contract named (i).)

| system | can speak? | what it does | source | known failure modes | bearing |
| --- | --- | --- | --- | --- | --- |
| React hydration | yes | `[V]` `hydrateText` compares and returns `false` on mismatch; it never writes (`suppressHydrationWarning` leaves the stale text in place). A mismatch → `throwOnHydrationMismatch` → client render up to the nearest Suspense boundary. React 18 upgrade guide: React "will no longer patch up" text mismatches. `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)`: the server snapshot is used *on the server and during hydration*, must match, and the store's current value is applied after as an update. `useDeferredValue(value, initialValue)` is the same shape for a single value. | [`ReactDOMComponent.js`](https://github.com/facebook/react/blob/main/packages/react-dom-bindings/src/client/ReactDOMComponent.js) ≈ L3384; [`ReactFiberHydrationContext.js`](https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberHydrationContext.js) ≈ L583; [react.dev › useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore); [React 18 upgrade guide](https://react.dev/blog/2022/03/08/react-18-upgrade-guide) | WG #37 (Sebastian): data during hydration must be the exact same as the server's; suspend on the HTML stream's data. | **for (iii)** and **against (i)**: the claim pass is non-mutating by design; the "read the server's snapshot, apply the live value after" pattern is a first-class API. |
| Vue hydration | yes | `[V]` Text mismatch → warn and patch `node.data` (≈ L184–195); element text → patch `textContent` (≈ L486–502); node mismatch → `handleMismatch` removes the node and client-renders (≈ L708–760); `data-allow-mismatch` suppresses. | [`hydration.ts`](https://github.com/vuejs/core/blob/main/packages/runtime-core/src/hydration.ts) | Historically mismatches were silent in production (the `data-allow-mismatch` attribute was added so the warning could be made louder). | **for (i)** — Vue is the one system whose claim pass reconciles text; it pays with a mutation pass that covers text only (structure → re-render) and with a warning surface it had to add. |
| Qwik | partial | `[V]` State is serialized once at the container's end; the client resumes from the *final* server state — there is no "value moved after the markup" because SSR pauses on `<Resource>`. | Qwik › Resumable / State docs; `qwikloader.ts` | qwik-evolution #16 — streaming pending state needs forward refs; unsolved. | **(ii)-like** — the producer holds, bounded by the response's end; the discussion is explicit that this is the hard part of streaming. |
| LiveView | partial | `[V]` No claim: the server's first render is the DOM; the first diff after join applies as an update. `phx-update="ignore"` marks DOM the server must not touch. | `Phoenix.LiveView` docs; bindings | — | **for (iii)** by analogy: the server render is the snapshot, the join's diff is the backlog, applied after as an update. |
| Marko | partial | `[V]` The `<await>` result is rendered into the stream when resolved; there is no later patch before init. | `await/renderer.js` | — | orthogonal. |
| Astro | partial | `[V]` The island's response is swapped in as delivered; no reactive value behind it. | `server-islands.ts` | — | orthogonal. |
| Solid Router 1.x | partial | `[V]` `createAsync` seeds from the serialized server value; `query`'s cache then serves it; a later revalidation applies as an update. #464: the stale entry was *reused* after hydration when it should have been refetched. | `query.ts`; [#464](https://github.com/solidjs/solid-router/issues/464) | #464 | **for (iii)** — this is the `"hybrid"` rule the rulings cite; the bug was in the release (nothing bumped), not in the seed. |
| Turbo / htmx / RR | no | No hydration pass. | — | — | orthogonal. |

**Verdict.** The weight is on (iii). React — the system whose claim pass is
closest to ours (comment-marked holes, non-mutating hydration) — removed
text patch-up in 18 and exposes "serve the server snapshot during hydration,
apply the live value as an update after" as `useSyncExternalStore`'s
`getServerSnapshot` and `useDeferredValue`'s `initialValue`; that is (iii)
with the park made an API. Vue is the lone precedent for (i) and it buys
text-only coverage (structure still re-renders) at the cost of a mutation
pass and a mismatch-reporting surface it later had to strengthen. Nobody
does (ii) on a live stream; Qwik does it by refusing to stream. Prior art
therefore *strengthens* the (iii) recommendation. The repercussion: React
documents that under `suppressHydrationWarning` the stale text stays until
the next distinct update — our R10/C19 shape — and chose to document rather
than fix it; (iii)'s park releasing at hydration end is strictly better than
that (the backlog *does* apply), so long as the release is bounded (L1) and
ordered after 3.2's frame hold, as the rulings already pin.

---

## Product questions

### C12 (c) — what a rejected server-only `<Loading>` inside a server component shows after adopt

**Our question:** the contract's "fresh client error fallback at the
position" versus the principle's "what the server rendered for that outcome
(its `<Errored>` fallback, or the boundary's own markup); with no server
`<Errored>` the error escapes as the frame's `:error`".

| system | can speak? | what it does | source | known failure modes | bearing |
| --- | --- | --- | --- | --- | --- |
| React Fizz | yes | `[V]` Server renders the *fallback* (not an error UI) and `$RX` with a digest; client retries and, on failure, the nearest *client* error boundary renders. The server has no error boundary primitive to render into. | react.dev › renderToPipeableStream | — | **partial for the contract's option** (a client error UI *does* appear) but only because React has no server `<Errored>`; `[I]` with one, React's behaviour would be Marko's. |
| Marko | yes | `[V]` `@catch` rendered in place by the server. | `await/renderer.js` ≈ L227–253; Marko 6 `<try>` | — | **for the principle's option**. |
| Turbo | yes | `[V]` Writes a visible message, throws, fires a cancelable event so the app can render its own. | `frame_controller.js` ≈ L414–444 | — | **for "never blank"**; the client writes because there is no server slot. |
| Astro | yes | `[V]` Keeps the fallback silently. | `server-islands.ts` ≈ L249–264 | #15945, #17680 | **against** — the outcome the principle's option must not degrade to when no `<Errored>` exists. |
| LiveView | partial | Crash → re-mount, full re-render. | docs | — | orthogonal. |
| RR `<Await errorElement>` | partial | Client-rendered error at the value's position. | RR docs | — | as React. |

**Verdict.** The principle's option (server renders the outcome; frame's
`:error` is the outward face otherwise) has a precedent in Marko and is the
natural form for a system that *has* a server-side error boundary; the
contract's client-arm option is what systems without one do. Prior art does
not argue for adding the client arm back. It does insist — Turbo, React,
Marko all — that the outcome be *visible and attributable*: a digest or
message reaches the developer. The repercussion is the Astro case: when
there is no server `<Errored>` and the enclosing client `<Errored>` is the
only face, the document-face blank at `server.ts:2911` must become the
rendered error outcome before C12 (c) can be re-pinned, otherwise the frame
shows a blank with its `:error` set — Astro's state with an extra flag.

### Settles-once projections crossing as a trace vs promise-of-snapshot

**Our question:** should a server projection that settles once (a flight
that has landed) cross as a live container (snapshot + patch backlog, with
S1's park) or as a promise of a snapshot (a value)? (Principle prefers
promise-of-snapshot.)

| system | can speak? | what it does | source | known failure modes | bearing |
| --- | --- | --- | --- | --- | --- |
| Flight | yes | `[V]` Promises and async iterables are distinct wire types (`serializePromiseID` ≈ L3081 vs `serializeAsyncIterable` ≈ L1402); a resolved promise is a value row; an iterable streams rows until done. | `ReactFlightServer.js` ≈ L1402, L3081 | — | **for** — the producer's state (settled vs streaming) chooses the wire type, not the consumer's site. |
| React `useSyncExternalStore` | partial | `[V]` A store with a server snapshot *is* a live subscription; a value you only read once is a plain prop. | react.dev | — | **for** — "live" is the producer's property. |
| LiveView | yes | `[V]` Everything is a live assign; `temporary_assigns` and streams exist to opt *out* of keeping state the server will not change again. | `Phoenix.LiveView` docs (`temporary_assigns`, streams) | — | **for** — the live-by-default system had to add an escape hatch for settled data; the principle's "a value if it has settled" is that hatch applied at the source. |
| Qwik | partial | `[V]` `useResource$` / `server$` are request-response; resolved values serialize as values. | Qwik docs | — | **for**. |
| Solid Router 1.x | partial | `[V]` `createAsync` returns an accessor over a promise; it does not stream. | `query.ts` | — | **for** (a value). |
| Turbo / htmx / Astro / Marko / Vue | no | — | — | — | orthogonal. |

**Verdict.** Prior art agrees with the principle: the wire type follows the
producer's state. Flight's split between promise rows and iterable rows is
the direct precedent — a landed flight is a value. Repercussion: this is a
DR-2/wire decision (the tier is the sink's), and once a settled producer
crosses as a value, 3.6 (iii) has nothing to park for it — the park remains
only for producers that are still live, which is the maintainer's "live if
the producer is live, a value if it has settled".

### Whether crossing containers are live by default

**Our question:** when a producer is still live at render time, does it
cross as a live container by default (DR-2 case 3), or must a site opt in?
(Principle: live when the producer is live.)

| system | can speak? | what it does | source | known failure modes | bearing |
| --- | --- | --- | --- | --- | --- |
| LiveView | yes | `[V]` Live by default: one process per connection holds every assign; cost paid with `temporary_assigns`, streams, `phx-update="ignore"`, reconnect = full re-render, `static_changed?` reload on asset version mismatch. | `Phoenix.LiveView` docs; changelog | changelog: "no component for cid" errors, outdated clients refreshed with jitter | **for**, with the cost sheet: live-by-default needs an explicit *not-live* escape (we have it: settled → value) and a story for the connection dropping (ours: a response ends; the trace is closed by §5.5). |
| RSC | yes | `[V]` "Our server isn't stateful … we refetch more coarsely." | RSC RFC ≈ L590–592 | — | **against** as a design philosophy; `[I]` but RSC's choice is forced by having no server-held reactive graph to project from, which we do. |
| Qwik | partial | `[V]` Request-response; `<Resource>` pauses SSR. | Qwik docs | qwik-evolution #16 | **against** by default; the discussion shows the serializer work needed to stream pending state at all. |
| Remix / RR | partial | `[V]` Request-response; `defer`/`<Await>` streams a promise once. | RR docs | — | **against** by default (one settle, no live). |
| Turbo Streams | partial | `[V]` Live push over a socket, DOM-addressed, no state. | Streams reference | — | neutral — live without a store. |
| Astro / Marko / Vue / htmx | no | — | — | — | orthogonal. |

**Verdict.** The only live-by-default precedent is LiveView, and it works;
every request-response system is "not live" because it has no server graph
to stay live from, not because live was tried and rejected. The principle's
"live if the producer is live" is consistent with LiveView's experience
provided the two things LiveView had to add exist: an escape for settled
data (the previous item gives it structurally) and a defined end (the
response's close rejects/closes the trace — §5.5). Repercussion: LiveView's
`static_changed?` and "no component for cid" are the version-skew bugs a
live system meets — a client whose code is older than the server's stream;
our frames have no version handshake and should at least report skew in dev.

### May `slot` trail `html` on the wire

**Our question:** RFC 11 fixes no order; the sink emits records ahead of
markup; the contract's C6 (a1) assumes the reverse is legal.

`[V]` No reference streams a binding record *after* the markup it binds as a
legal order: Fizz always emits the hidden content first and the `$RC`
instruction after (the instruction is the "record" and it trails the
"html"); Flight rows are self-describing and their order is the server's
(a row may be referenced before it arrives, in which case the client
creates a pending chunk and fills it — `getChunk` on an unknown id of an
open response calls `createPendingChunk`, `ReactFlightClient.js` ≈ L1673). Turbo Streams carry template and target in one element.
LiveView diffs carry statics and dynamics together. `[I]` So the references
offer two models: *fix one order* (Fizz: markup then instruction) or *make
both orders legal by letting the consumer create a placeholder for whichever
side arrives first* (Flight's pending chunk). The #2968 defer is the second
model for one site; if "no ordering policy" stays, Flight's pending-chunk
discipline — a reference to an unseen id creates the slot and whoever
arrives second fills it — is the general form, and it is what "the #2968
defer generalizes to every sync" would mean. Prior art does not pick; it
says the two consistent choices are "one order" or "placeholders both ways",
and that "records ahead of markup, usually" is neither.

---

## Summary table

| reading | draft / principle recommendation | prior-art consensus (systems that can speak) | agree? |
| --- | --- | --- | --- |
| 1.3 refs resolve in their own response | yes (decided) | unanimous: Flight, Next, RR, Phoenix, Solid Router (by counter-example) | **agree**; add: a dropped response still settles its waiters (Next #84299) |
| 1.4 version bump drops the previous version | full (decided) | unanimous: Next discard-wholesale, Flight close, RR abort, LV remount | **agree**; add: carry the dropped version's revalidation intent (Next), don't flip "applied" early (RR #14506) |
| 1.6 switch keeps on screen what was on screen | (i) per-address gate (decided) | for (i): React transitions, Turbo/htmx by construction, Next, LV | **agree**; React's `key` reset is the one opt-in we lack |
| 2.3 a reveal is an apply | yes (decided) | strongly for: Fizz `$RC`→`_reactRetry`; Next #94170/#98097/#97036 are the counter-case | **agree (strongest)**; add: re-validate the target before a deferred apply (Vue #15091) |
| 3.1 hydration-done follows non-SC Solid 2 | ruled | no reference has a second done; React bounds every hold incl. at parser end | **agree**; add: parser end must settle registered holds (§5.5 applied to 3.2) |
| 3.3 claimant owns the outcome | yes, re-shaped: server renders the outcome, no client `<Errored>` arm, dev report | split by capability: Marko (server `@catch`) = ours; React/Turbo/RR render on the client because no server arm exists; Astro silent = the anti-pattern | **agree with the re-shape**; the dev report is load-bearing, not polish |
| 3.5 classify after the drain | confirm wording | React reads marker + `readyState`, protects delivered-unapplied with `$~`; Turbo `complete` after render; LV #3957 | **agree**; wording: "delivered is not drained; parser end classifies only the undelivered" |
| 3.6 claim reads the snapshot | (iii) consumer parks | React (iii) via `getServerSnapshot`/`initialValue`, no text patch-up since 18; Vue alone does (i); nobody does (ii) on a stream | **agree, strengthened** |
| C12 (c) rejected server `<Loading>` after adopt | server-rendered outcome; frame `:error` outward; client arm rejected | Marko = ours; client arms exist only where no server arm does; all insist on visible + attributable | **agree**; Astro is the degenerate case to avoid |
| settles-once projection | promise-of-snapshot | Flight's promise-row vs iterable-row; LV's `temporary_assigns` as the retrofitted escape | **agree** |
| containers live by default | live if the producer is live | LV is the only precedent and works; request-response systems aren't live for lack of a server graph | **agree**, with LV's cost sheet (escape for settled; defined end; skew reporting) |
| `slot` may trail `html` | open | references either fix one order (Fizz) or make both legal via placeholders (Flight pending chunks) | **no consensus to borrow**; "usually one order" is the one shape nobody has |
| A3/A4 addressing | one store, many frames, lockstep; C8 holds | no precedent; RSC silent, Turbo/htmx the contrast, LV nearest (`(module,id)` identity) | **not contradicted**; pin per-*binding* staleness/gate (R5/R8) — no outside check exists |

### The three places prior art agrees most strongly

1. **2.3, a reveal is an apply.** Fizz's completion instruction *calls the
   boundary's retry*; the three Next.js incidents where it did not fire are
   our R3 ("reveal not a sync trigger") in production.
2. **3.6 (iii), the claim reads the snapshot and parks the rest.** React
   removed text patch-up and made "server snapshot during hydration, live
   value after" an API; Vue, the only (i), had to add a mismatch surface.
3. **1.3/1.4, response-scoped identity, drop the superseded version whole.**
   Every system with two responses in flight stamps them and discards the
   loser as a unit; the two that didn't (Solid Router's `cached[2]`, RR's
   lost reload id) are the bugs.

### The places prior art most disagrees, or cannot help

1. **3.3's "no client `<Errored>` arm".** React, Turbo and React Router all
   render the error on the client. The disagreement dissolves once you note
   none of them has a server-side error boundary to render into (Marko does,
   and does what we do) — but it means the server half is not optional and
   the dev report is the whole client story.
2. **A3/A4 fan-out.** Nothing in the references shares one store across
   sites. The bug class it introduces (a site rebinding while others stay
   bound) has no prior debugging to lean on.
3. **`slot` trailing `html`.** No reference leaves order unspecified; they
   fix one or accept both with placeholders.

---

## Things the references do that we don't, and might want

- **A recoverable-error channel with a digest** — React's `onRecoverableError`
  (client) paired with `onError`'s returned digest (server) so a client-side
  report can be correlated with the server log. Our 3b dev-only report would
  carry the frame id and the `_fr`'s error; a digest from the server half
  makes it correlatable in production too.
- **Reveal calls retry** — Fizz's `_reactRetry` on `$RC`/`$RX`. Our 2.3
  decides this; the pattern worth copying is that the *instruction itself*
  carries the wake-up, so there is no second registration to forget.
- **Parser end as the third bound** — React's `isSuspenseInstanceFallback`
  treating pending + `readyState !== 'loading'` as failed. §5.5 states it
  for `_fr`; 3.2 should state it for the registered holds.
- **"Delivered, applying, don't fail me" marker** — Fizz's `$~` across a
  batched completion. The analogue is 3.5's delivered-undrained term; make
  it a state the drain owns.
- **Discarded but revalidated → deferred refresh** — Next's action queue
  keeps the intent of a dropped response. Our 1.4-full should carry a dropped
  version's gate release / revalidation to the current version.
- **Incrementing load ids with `abortStaleFetchLoads(landedId)`** — React
  Router's explicit "everything older than what just landed is aborted"
  sweep, versus our per-address version check at apply time. Same result;
  RR's form aborts the network request too (saves the bytes).
- **`turbo:frame-missing` / `turbo:before-frame-render`** — cancelable
  events at "the response has no content for this target" and "about to
  render"; the first is the user-facing hook for a 3.3 outcome the app wants
  to render itself; the second is where an app would interpose on a 1.6
  switch.
- **Per-target concurrency policy** — htmx's `hx-sync` (`drop | abort |
  replace | queue first|last|all`). We fix `replace` (latest wins) per
  address; `queue last` is the one alternative an author plausibly wants
  for a form-driven frame.
- **Join/version stamp on the connection** — Phoenix's `joinRef`; LiveView's
  `static_changed?` version-mismatch reload with jitter. We have a version
  per address but no client-code-version handshake; a dev-mode skew warning
  is cheap.
- **`phx-update="ignore"`** — a DOM region the server's morph must not
  touch. Our client slot fills are that by construction (A3: per-mount
  fills), but an explicit escape for third-party-mutated DOM inside a
  server-rendered fragment has no analogue yet.
- **`@catch` in place with a default timeout** — Marko renders the error
  outcome into the stream and bounds every `<await>` at 10 s by default. The
  first is 3.3's server half; the second is L1 with a number.
- **Read the body before mutating the DOM** — Astro's island swap buffers the
  full response before touching the fallback, so a failed body never leaves
  a half-swapped target. Our apply is per-version-root, which has the same
  property; worth stating as an invariant (2.4 "applied means shown").
- **Suspense `key` reset** — React's author-chosen "this is different content,
  show the fallback" on navigation. (i) for 1.6 is the right default; an
  opt-in reset per mount is the one thing the default cannot express.
- **Single-pass serializer with forward references** — Qwik's plan for
  out-of-order streaming (qwik-evolution #16): emit an unresolved promise as
  a forward ref and patch it when it lands. Our `data`/`{$ref}` already does
  this; the note is that Qwik's team identified "serialize the promise as
  not-serialized, fill later" as the one hard problem of streaming state —
  which is exactly the ground 1.3/1.4 and the `slot`-trailing-`html`
  question stand on.

---

## Sources

Primary sources read for this note (fetched 2026-10-05; line numbers as of
`main`/`canary` that day):

- React: [`ReactDOMFizzInstructionSetShared.js`](https://github.com/facebook/react/blob/main/packages/react-dom-bindings/src/server/fizz-instruction-set/ReactDOMFizzInstructionSetShared.js), [`ReactFlightClient.js`](https://github.com/facebook/react/blob/main/packages/react-client/src/ReactFlightClient.js), [`ReactFlightServer.js`](https://github.com/facebook/react/blob/main/packages/react-server/src/ReactFlightServer.js), [`ReactFiberBeginWork.js`](https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberBeginWork.js), [`ReactFiberConfigDOM.js`](https://github.com/facebook/react/blob/main/packages/react-dom-bindings/src/client/ReactFiberConfigDOM.js), [`ReactDOMComponent.js`](https://github.com/facebook/react/blob/main/packages/react-dom-bindings/src/client/ReactDOMComponent.js), [`ReactFiberHydrationContext.js`](https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberHydrationContext.js); [RSC RFC 0188](https://github.com/reactjs/rfcs/blob/main/text/0188-server-components.md); react.dev [`renderToPipeableStream`](https://react.dev/reference/react-dom/server/renderToPipeableStream), [`hydrateRoot`](https://react.dev/reference/react-dom/client/hydrateRoot), [`useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore), [`Suspense`](https://react.dev/reference/react/Suspense), [React 18 upgrade guide](https://react.dev/blog/2022/03/08/react-18-upgrade-guide); [reactwg/react-18 #37](https://github.com/reactwg/react-18/discussions/37); issues [#35821](https://github.com/facebook/react/issues/35821), [#36134](https://github.com/facebook/react/pull/36134).
- Next.js: [`app-router-instance.ts`](https://github.com/vercel/next.js/blob/canary/packages/next/src/client/components/app-router-instance.ts); issues [#84299](https://github.com/vercel/next.js/issues/84299), [#86151](https://github.com/vercel/next.js/issues/86151), [#88343](https://github.com/vercel/next.js/issues/88343), [#94170](https://github.com/vercel/next.js/issues/94170), [#95391](https://github.com/vercel/next.js/pull/95391), [#97036](https://github.com/vercel/next.js/issues/97036), [#98097](https://github.com/vercel/next.js/issues/98097).
- React Router / Remix: [`router.ts`](https://github.com/remix-run/react-router/blob/main/packages/react-router/lib/router/router.ts); [Concurrency](https://remix.run/docs/en/main/discussion/concurrency); [`<Await>`](https://reactrouter.com/api/components/Await); issues [#10473](https://github.com/remix-run/react-router/issues/10473), [#10623](https://github.com/remix-run/react-router/pull/10623), [#14506](https://github.com/remix-run/react-router/issues/14506), [#15365](https://github.com/remix-run/react-router/pull/15365).
- Turbo / htmx: [`frame_controller.js`](https://github.com/hotwired/turbo/blob/main/src/core/frames/frame_controller.js), [`frame_element.js`](https://github.com/hotwired/turbo/blob/main/src/elements/frame_element.js); [Events](https://turbo.hotwired.dev/reference/events), [Streams](https://turbo.hotwired.dev/reference/streams); [#863](https://github.com/hotwired/turbo/pull/863); htmx [`hx-sync`](https://htmx.org/attributes/hx-sync/), [`hx-swap-oob`](https://htmx.org/attributes/hx-swap-oob/).
- Phoenix / LiveView: [`channel.js`](https://github.com/phoenixframework/phoenix/blob/main/assets/js/phoenix/channel.js), [`rendered.js`](https://github.com/phoenixframework/phoenix_live_view/blob/main/assets/js/phoenix_live_view/rendered.js); [`Phoenix.LiveView`](https://hexdocs.pm/phoenix_live_view/Phoenix.LiveView.html), [`Phoenix.LiveComponent`](https://hexdocs.pm/phoenix_live_view/Phoenix.LiveComponent.html), [Bindings](https://hexdocs.pm/phoenix_live_view/bindings.html), [JS interop](https://hexdocs.pm/phoenix_live_view/js-interop.html), [Changelog](https://hexdocs.pm/phoenix_live_view/changelog.html); PRs [#3710](https://github.com/phoenixframework/phoenix_live_view/pull/3710), [#3715](https://github.com/phoenixframework/phoenix_live_view/pull/3715), [#3957](https://github.com/phoenixframework/phoenix_live_view/pull/3957).
- Qwik: [Resumable](https://qwik.dev/docs/concepts/resumable/), [State](https://qwik.dev/docs/components/state/); [`qwikloader.ts`](https://github.com/QwikDev/qwik/blob/main/packages/qwik/src/qwikloader.ts); [qwik-evolution #16](https://github.com/QwikDev/qwik-evolution/discussions/16).
- Astro: [`server-islands.ts`](https://github.com/withastro/astro/blob/main/packages/astro/src/runtime/server/render/server-islands.ts); [Server islands guide](https://docs.astro.build/en/guides/server-islands/); [#12394](https://github.com/withastro/astro/issues/12394), [#15945](https://github.com/withastro/astro/issues/15945), [#17680](https://github.com/withastro/astro/pull/17680).
- Marko: [`await/renderer.js`](https://github.com/marko-js/marko/blob/main/packages/runtime-class/src/core-tags/core/await/renderer.js) (Marko 5); [Marko 6 core tags](https://markojs.com/docs/reference/core-tag).
- Vue: [`hydration.ts`](https://github.com/vuejs/core/blob/main/packages/runtime-core/src/hydration.ts); [Async components › Lazy hydration](https://vuejs.org/guide/components/async#lazy-hydration), [SSR › Hydration mismatch](https://vuejs.org/guide/scaling-up/ssr#hydration-mismatch); [#15091](https://github.com/vuejs/core/issues/15091), [#15092](https://github.com/vuejs/core/pull/15092), [#15252](https://github.com/vuejs/core/pull/15252).
- Solid Router: [`query.ts`](https://github.com/solidjs/solid-router/blob/main/src/data/query.ts); [#464](https://github.com/solidjs/solid-router/issues/464), [#497](https://github.com/solidjs/solid-router/issues/497).
- Ours: `documentation/server-components/frames-rulings.md` (`f4b15a0a8`), `frames-consistency-contract.md`, `server-components-principles.md`, `frame-streams-rfc.md` (RFC 11), `packages/signals/docs/SPEC-ASYNC-SEMANTICS.md`.
