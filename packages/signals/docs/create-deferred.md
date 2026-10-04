# Design: `createDeferred` — an async memo that may lag, but never leads

> Status: **implemented on L2** (design agreed 2026-09-08; implemented
> 2026-09-28 against the pre-L2 core as #3710; **re-implemented 2026-10-04 on
> the hold model** — `SPEC-ASYNC-SEMANTICS.md` "The hold model — L2" — as a
> pay-for-use module, `src/deferred.ts`, §6.4; pinned by
> `tests/createDeferred.test.ts`, one test per proposition D1–D9 plus §2.1,
> §8.1, §8.2 and the L2 pins). Origin: a Discord report (2026-09-03) of
> independent dashboard panels sharing one global selection store, where
> every panel's commit waited on the slowest panel's fetch (20–200ms panels
> held hostage by 3–10s panels). Semantics below are settled and unchanged
> through both implementations; **§6 describes the L2 mechanism** and
> records, per seam, what the #3710 implementation did on the pre-L2 core
> and why it moved. The 2026-09-08 sketch's lane-engine landing (§6.2) is
> two implementations gone: the plain write path landed in #3710, and on L2
> "never leads" is the seam's hold decision over the flush's pending nodes
> — the same decision every pending pass gets. §9 records why this is a
> migration primitive, not a niche one: combined with `loadingValue` it is
> the per-node opt-out from coordination that 1.0 → 2.0 migrations currently
> lack.

## 1. The problem

Solid 2.0 holds while async. A write stages into `_pendingValue` for the
flush; the moment a render effect observes a downstream async memo pending,
the flush _parks_ (L2, `SPEC-ASYNC-SEMANTICS.md` "The hold model"): every
node staged in it — the shared write and every sibling's staged derivation —
is held by one `Transaction`, and the transaction lands only when no frame on
screen derives from a flight it holds (`blocked`). One atomic commit, gated
on the slowest observed flight. Meanwhile the flush's effect runs are
stashed with the transaction, so even effects whose sources never went
pending wait. (Pre-L2 the same hold was `initTransition` adopting the batch,
`_asyncReporters`, `transitionComplete` and `stashQueues`; the shape of the
problem did not change.)

This is the right default: committing the fast panel early would show
new-period data beside old-period data. But it means there is no way to say
"this subtree is an independent visual unit; let it fall behind rather than
hold everyone." Today's escape hatches each miss:

| Hatch                                 | What it does                                                                                                                                           | Why it doesn't answer the report                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `latest(() => x())`                   | Per-read: never suspends, serves staged/committed                                                                                                      | Per read-site — impractical at scale; one non-`latest` read of the chain re-entangles everything; **leads** the clock (§4.2)                                                                                                |
| `<Show when={!isPending(() => x())}>` | Unmounts the panel while pending; `transitionComplete` prunes its dead reporters                                                                       | Works, but is fallback-shaped (loses DOM/state) and incidental — the user rediscovered "show a fallback on refetch" through a side door                                                                                     |
| `<Loading on={key}>`                  | Resets the boundary on key change; collects pending locally instead of joining the hold                                                                | The designed fallback affordance — right answer when a skeleton is acceptable, no answer when old content must stay visible                                                                                                 |
| `createEffect(x, v => setMirror(v))`  | User effects don't report pending (`notifyEffectStatus` only notifies for `EFFECT_RENDER`), so the transition completes without the mirror's consumers | Amputates the node: `isPending(mirror)` is always false, `refresh` can't reach the query, errors route to the effect's owner, laziness is lost (always-on subscriber), lands one flush late, first load must be hand-rolled |

The missing primitive is the effect-write-back's decoupling with the graph
edge kept intact. The only edge property that causes the hold is _outward
pending propagation_; everything else about the edge (identity, laziness,
error routing, verdict visibility, phase ordering) should survive.

## 2. The primitive

```ts
createDeferred<T>(
  fn: (prev?: T) => T | PromiseLike<T> | AsyncIterable<T>,
  options?: NodeOptions<T>
): Accessor<T>
```

A special kind of async memo. Once it has a committed value, its own
non-finality is invisible to the downstream graph:

1. **Consumers never suspend on it.** Reads during a refetch return the
   committed value. No `NotReadyError` reaches downstream, so no consumer
   becomes an async reporter and no transition is held by this node.
2. **It never leads.** Reads never return a staged `_pendingValue`, only
   committed truth. (This is the difference from `latest`, §4.2.)
3. **Its landings commit on their own schedule.** A resolution that arrives
   while an unrelated transition is incomplete still commits and its
   consumers' effects still flush — the node is not hostage to holds it
   didn't cause.
4. **It is verdict-loud.** `isPending(() => x())` reports the in-flight
   refetch exactly as for a plain async memo (A19 cause ii). The graph
   doesn't see pending; the probes do. This is what drives the panel's
   "stale, refreshing…" affordance.
5. **Errors propagate.** A rejected refetch throws to the nearest `<Errored>`
   like any memo. Stale-while-revalidate is fine; stale-while-silently-broken
   is not. (A keep-stale-on-error opt-in could exist later; not the default.)
6. **It is transparent while uninitialized.** Before the first resolution
   there is nothing committed to serve, so the initial `NotReadyError`
   propagates to `<Loading>` as usual (A19 exception 1: loading, not
   pending). The `loadingValue` option composes: a node born committed has no
   uninitialized window.
7. **SSR: identity.** Mirrors `latest` in `server/signals.ts` (`latest` is
   `fn => fn()` there): on the server everything is first load and the server
   always waits, so `createDeferred` behaves as `createMemo`. No serialization
   surface — the node is derived, nothing crosses the wire.
8. **Hydration: server-rendered content is commit #0.** Sources hydrate
   initialized, so the first client refetch tears against server content —
   stale-while-revalidate from the first frame.

The one-line contract: **a deferred node may lag the global clock, but never
leads it.**

### The report, solved

```tsx
// Each panel owns the policy for its own fetch. Nothing else changes.
const rows = createDeferred(async () => fetchPanelRows(store.period, store.dept));

return (
  <section class={{ stale: isPending(() => rows()) }}>
    <For each={rows()}>{row => <Row row={row} />}</For>
  </section>
);
```

Period changes: neither panel reports, the store write commits immediately,
each panel shows its previous rows until its own fetch lands — the fast one
at 200ms, the slow one at 10s — with `isPending` driving the stale
indicator. Something reading `rows()` under a `<Loading>` still gets the
fallback on first load.

### 2.1 `createDeferred` + `loadingValue`: the fully uncoordinated node

`loadingValue` removes the _initial_ affordance: the node is born committed,
has no uninitialized window, never reaches `<Loading>`, and is verdict-quiet
during its first flight (existing ruling). `createDeferred` removes every
_subsequent_ one. Together the node is invisible to all coordination
machinery; the only observers left are `isPending` on refetches and the
sentinel value on first load. That is 1.0's `createResource` without
Suspense — a value and a loading flag, no coordination — with the graph kept:

```tsx
const tabData = createDeferred(
  () => TabAPI.get(store.period, store.department.id),
  { loadingValue: undefined }
);

<Show when={tabData()} fallback={<LoadingIndicator />}>          // first load: 1.0 idiom
  <div class={{ refreshing: isPending(() => tabData()) }}>     // refetch: stale + indicator
```

Note the first-load spinner keys on the sentinel, not on `isPending` — the
loading window is verdict-quiet by design. For fallback-on-every-refetch
(content remounts, exactly 1.0's `isLoading` pattern): drop `loadingValue`,
`<Loading>` for first load, `<Show when={!isPending(() => tabData())}>` for
the rest. That pattern works today only by the accident of
reporter-pruning-on-unmount; with `createDeferred` it works by construction.

This makes coordination **opt-out per node**, which is what §9 is about.

### 2.2 What the user actually sees

For a single panel in isolation: **nothing new.** Same states, same
affordances — stale content stays on screen, `isPending` drives the
indicator, `<Loading>` covers first load, `<Errored>` covers rejection. No
new visual vocabulary; deferred is a choreography change, not a UI state,
which is why it needs no component.

The differences are in the panel's timing relative to everything else:

|                               | Hold (default async memo)                                                            | `createDeferred`                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| When the data swaps           | At the group's commit (slowest reporter lands)                                       | At _this_ fetch's landing                                                                                                                                   |
| How long `isPending` is true  | Until the group commits — the fast panel shows "refreshing" for the slow panel's 10s | Until _this_ fetch lands — 200ms                                                                                                                            |
| Selector label vs. panel data | Flip together                                                                        | Label flips at once (nobody holds the write); data follows when it lands. The interval is the tear (§4.3) — `isPending` being loud is what makes it legible |
| Held sync writes (theme)      | Flip at commit                                                                       | Flip at commit — same as hold; `latest` is the one that would flip early                                                                                    |
| In-flight future              | Peekable via `latest`                                                                | Not visible through this node; `latest(() => d())` is a no-op. Overrides on _other_ nodes still show (A17)                                                  |

The removed option is exactly one: peeking at the in-flight future of this
node. Everything else the user could do before, they can do after.

### 2.3 How to teach it

Do not teach the behavior difference — §2.2 shows it is too subtle to carry
a decision. Teach a UX question the reader can already answer:

> **When this data is being refetched, what should the user see?**

| The user should see…                                    | Use                                                                               |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Nothing change until everything related is ready        | default `createMemo(async …)`                                                     |
| …but the control I just touched reflects my input _now_ | `latest()` on the control, `isPending` to dim the held content                    |
| A placeholder                                           | `<Loading>` (first load); `<Loading on={key}>` (refetch when the subject changed) |
| The previous answer with a "refreshing" indicator       | `createDeferred` + `isPending`                                                    |

Rows one and two are the same view: the standard held interaction is _tab
highlights immediately, content waits, content dims while it waits_ — `latest`
on the input, default on the data, `isPending` between them. `latest` is
therefore not rare; it is the **input-side** affordance (show my change while
what depends on it loads). `createDeferred` is the **data-side** one (show
the previous result while the next one loads). They answer different halves
of the same screen and compose.

The test for the last row: _"If this widget showed last period's numbers for
five seconds with a spinner on it, is that fine or wrong?"_ Fine → deferred
(dashboards, feeds, search-as-you-type, charts — **independent widgets**).
Wrong → default (forms, detail pages, totals — **coherent views** whose parts
must agree). The originating report called its components "independent
panels" unprompted; that word is the tell.

The frame that keeps it inside the model rather than an escape from it: 2.0
is _consistency by default, staleness by declaration_, and it already had one
declaration — `loadingValue` ("this placeholder is an acceptable answer
before the first real one"). `createDeferred` is its sibling ("the previous
answer is an acceptable answer between real ones"): same kind of statement,
same place (the node, in the data layer), adjacent phase of the same node's
life. **Two declarations of acceptable staleness — `loadingValue` before the
first answer, `createDeferred` between answers.** The things that _were_
escape hatches are the ones this replaces (§1).

The subtlety is the safety property, not the hazard: a single widget looks
identical either way, so a wrong choice is cheap and visible in both
directions — wrong-default is sluggish but correct; wrong-deferred is a brief
label/data mismatch inside a composed view — and the fix is one word. `latest`
is different in kind: applied to the _input_ it is the everyday affordance;
applied to _data_ (or scoped over a region, §4.2) it front-runs
orchestration. That is why it stays a per-read call at the site where the
author knows which one they are looking at, rather than becoming a node
trait or a scope.

Placement controls overuse: not on the getting-started async page. On a
"coordination and staleness" page beside `<Loading on>` and `latest`,
introduced after the reader has seen the hold and asked "what if I don't want
to wait?" Migration (§9) is the exception — front and center, framed as a
step with an exit.

## 3. What it is not

- **Not a boundary.** No owner/subtree scope, no `<Deferred>` component (§4.1).
- **Not a read lens.** Not `deferred(() => ...)` used inline like `latest` /
  `isPending`. It creates a node with identity, ownership, laziness — hence
  the `create` prefix (§4.4).
- **Not a store primitive.** No `createDeferredStore` / deferred projection
  (§4.5).
- **Not a memo option.** No `createMemo(fn, { deferred: true })` (§4.6).
- **Not a wrapper.** `createDeferred(() => existingMemo())` works (the clamp
  is cause-agnostic, §4.7) but is a degenerate case, not the design.

## 4. Decisions and rationale

The discussion moved through several shapes. Each reversal is recorded
because the reasons are the spec.

### 4.1 Graph node, not owner-scoped boundary

The first shape was a `<Deferred>` boundary applying a read mode to every
computation owned under it. Two arguments seemed to favor it — tearing is a
view policy, so scope it at the view; and commit timing lives in the queue
tree, which is owner-shaped — and both evaporated once the read semantics
changed to committed-only (§4.2):

- **Coloring dissolves.** The objection to node-scope was provenance-mixing:
  a deferred node feeding a composite that also reads a held source. With
  `latest`-style eager reads that is a real coloring problem. With
  committed-only reads a deferred node is a _pending firewall_: `STATUS_PENDING`
  terminates at the node and downstream sees a plain value that updates late.
  Composites, other holds, transitions all behave normally below it. Nothing
  to reason about at joins.
- **The flush half has a graph-shaped mechanism already.** The lane engine
  (`lanes.ts`, `runLaneEffects`) is precisely a per-source flush partition
  that fires while the main queues are stashed — it is how `isPending`
  companions repaint mid-transition today. No new queue-tree node type.
- **Honesty and granularity.** Under a boundary, a theme switch's
  async-derived fanout tears _because it happens to live inside the region_
  — including async someone adds next month who never saw the boundary
  above them. The region silently converts future holds into tears. With a
  node, every place the UI can stagger is a `createDeferred(...)` visible in
  the data layer, and unmarked state in the same region keeps full
  atomicity. Tear points are enumerated, not ambient.
- **Per-consumer policy via plumbing.** `query` for the control that should
  hold, `createDeferred(() => query())` for the panel that may lag — one
  source, two policies, explicitly wired.
- **Ergonomics were misjudged.** The report objected to `latest()` at every
  _read site_. A panel has one or two query memos, not fifty reads;
  `createDeferred` at the _definition site_ is a different burden entirely.

A `<Deferred>` boundary is not planned. The theme-fanout discussion (§4.3) is
evidence that ambient scope is a bug as often as a feature, and the
definition-site ergonomics (one `createDeferred` per query, not one `latest`
per read) remove the pressure that motivated it. The node is the primitive.

### 4.2 Committed-only, not `latest` semantics

The first read mode considered was scope-level `latest`. Counter-example: a
global theme switch whose transition deliberately waits on image loads so the
theme flips atomically. `latest` does not merely skip suspension — it eagerly
serves the staged `_pendingValue` ("an override the system writes for itself
the moment a held value exists", A8). A deferred region built on it would
flip to the new theme **immediately** while the rest of the app holds:
front-running the orchestration, not lagging it.

Committed-only fixes this. The region reads the committed theme (old, like
everyone), and flips with the global commit. And the panels case still
resolves — nobody reports, the store commits, each memo serves stale until it
lands, landings commit ambiently.

So `latest` and `createDeferred` share "never suspend, never report" and
differ on two axes:

|                      | `latest(fn)`                                        | `createDeferred(fn)`             |
| -------------------- | --------------------------------------------------- | -------------------------------- |
| Grain                | Read-site lens; leaves no node                      | Graph node with identity         |
| Staged (held) values | Served — **leads**                                  | Never served — **lags only**     |
| Own async in flight  | Serves committed stale                              | Serves committed stale           |
| Machinery            | `optimisticComputed` shadow per read source         | One node; no per-read companions |
| Analog               | `createOptimistic` for reads (unconfirmed frontier) | Confirmed-only counterpart       |

Committed-only is also cheaper: the companion-per-source machinery exists to
expose in-flight staged values, which this never does.

### 4.3 Lag is not atomic — the trade is stated, not hidden

Committed-only removes leading; it cannot make lagging atomic. Theme commits
globally; direct sync reads inside a deferred consumer flip at that commit;
an async memo in the same component that derives from theme (a themed fetch)
goes pending and — if it is deferred — serves its old-theme result until it
lands. The fanout staggers at every async membrane. Sync derivations stay
consistent with their inputs, so the tear surface is exactly the set of
deferred async nodes, but each is a stagger point.

This is inherent to tearing, not to this design (React's `useDeferredValue`
produces the identical mixed render). The triangle:

- **Hold** (default): atomic fanout everywhere; everyone waits on the slowest.
- **Tear** (`createDeferred`): nobody waits; multi-path fanout staggers at
  deferred nodes. You bound _where_ and _which direction_, never _whether_.
- **Region-atomic lag**: the region advances as a unit, showing a consistent
  old snapshot. Requires reading the _old_ theme after the global commit —
  the single-slot graph has nowhere to read it from. Value forking per
  region (React snapshots/lanes), a second computation frontier. Not this.

Guidance mirrors `<Loading>`: defer the data slot, not the chrome. Themed
containers/headers/controls outside, async-derived content inside.

### 4.4 `createDeferred`, not `deferred`

It is a node: identity, ownership/disposal, lazy pull, an edge others
subscribe to. That is what the `create` prefix denotes. The bare forms
(`latest`, `isPending`, `untrack`, `until`, `refresh`) are read-time lenses or
ambient operations that leave no node behind; `deferred(x)` would file this
in that family and falsely signal "same kind of thing as `latest`."

The name is reclaimed from 1.x, where `createDeferred(source, { timeoutMs })`
was the idle-scheduled `useDeferredValue` analog and was deliberately dropped
from 2.0 ("take it outside", `packages/solid/src/index.ts`). Same lineage —
"show the previous value while the new one isn't ready" — with readiness now
defined by the async graph rather than a timer, no `timeoutMs`. The 1.x
version didn't earn core because it was buildable in userland; this one earns
it because it cannot be built without amputating the node (§1).

### 4.5 No store version

Optimism needs `createOptimisticStore` because it is a **wrapper** touching
the _write surface_: `setOptimistic(s => s.items[3].done = true)` is a
per-leaf override that must live in the proxy's write path at the granularity
of the wrapped shape. Async never needed `createAsyncStore` because it is a
**source trait** — how one derive computation resolves, no write surface,
shape-independent — and stores consume it through their fn:
`createStore(async () => ...)`.

Deferred is a source trait in async's sense. So it inherits async's store
story: stores consume it through their fn.

```ts
const rows = createDeferred(async () => fetchRows(period()));
const [store] = createStore(() => rows());
```

Trace: first load — `rows` uninitialized, throws, the store's firewall goes
uninitialized, leaves throw, `<Loading>` catches. Refetch — `rows` is in
flight but its committed value hasn't moved, so the firewall **does not
re-run**; leaves untouched, nothing suspends, the store is never pending.
Landing — `rows` commits, the firewall re-runs, one reconcile, changed leaves
notify. Exactly one diff per landing, same as `createStore(async fn)` does
today. The only thing that moved is which node awaits the promise. A
store-side firewall clamp would have nothing to clamp: the firewall never
sees pending because the clamp already happened upstream.

A deferred _view_ of an existing store (mirror projection) is a full copy to
toggle a read policy. Nobody wants that; not offered.

Rule of thumb for the docs: **fetch in memos, shape in stores — collapsed
when nothing sits between them.** `createStore(async fn)` is the collapsed
form, available because async is _detected_ (a promise shows up). Deferred is
_declared_ — it is always a "something in between" — so it forces the split.
The extra line is the visible marker of where the policy lives.

### 4.6 Separate pay-for-use module, not a memo option

`{ deferred: true }` on `createMemo`/`createStore` puts the clamp in the
always-shipped path. The codebase already answers this for the analogous
feature: `core/optimistic.ts` and `core/verdict.ts` install themselves as
optional hooks on `GlobalQueue` (`_optimisticWrite`, `_transitionBlocked`,
`_runLaneEffects`, `_latestRead`, …) called with `?.` from core, and store
optimism lives in its own module with its own creator. Core pays a config-bit
check and an optional call; the body ships only if imported. Bundle size is
budgeted (`scripts/size/.size-limit.js`) and relocation into pay-for-use
modules is the sanctioned move.

Consistency check against `loadingValue`, which is _also_ a declared
async-resolution policy but is a memo option: the rule is "resolution
policies are memo-level; they become separate exports when they carry a
dependency worth shaking." `loadingValue` drags in nothing; deferred drags in
the lane engine. Anyone deferring a panel is also using `isPending`, so they
have already paid for lanes.

### 4.7 fn form is the design; wrapping is a consequence

`createDeferred(async () => fetch(...))` _is_ the async memo; deferred is a
trait on how it resolves. Nothing is wrapped. `createDeferred(() => query())`
over an existing held memo falls out for free _if_ the clamp keys on "this
node is non-final" regardless of cause — a source throwing `NotReadyError`
lands the computed in the same `_blocked`/pending state as an own promise in
flight. Its use case (two policies over one fetch: summary header holds,
heavy chart lags) is real but narrow. Not forbidden, not advertised.

## 5. Interaction table

| With                          | Behavior                                                                                                                                                                                                                                                                             | Note                                                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `<Loading>`                   | Owns first load (node transparent while uninitialized). Never sees refetch pending from a deferred node.                                                                                                                                                                             | Nesting order irrelevant. Inside a deferred consumer, Loading collapses to a pure first-paint concern and `isPending` is _the_ refetch affordance.                                                                 |
| `<Loading on={key}>`          | Reset re-shows fallback only when refetch pending _arrives_ — a deferred node's refetch never arrives.                                                                                                                                                                               | Inert for deferred sources; documented, not warned (the boundary cannot cheaply know it covers one). A "hard reset re-opens the uninitialized path" upgrade remains available (§8.0).                              |
| `<Errored>`                   | Rejections propagate normally.                                                                                                                                                                                                                                                       | Deferred defers pending, not errors.                                                                                                                                                                               |
| `<Reveal>`                    | Untouched — coordinates first reveals only.                                                                                                                                                                                                                                          |                                                                                                                                                                                                                    |
| `createOptimistic` / `action` | Overrides visible to all ordinary readers (A17), so optimistic UI inside a deferred consumer works. A deferred panel does not hold an action's transition open.                                                                                                                      | The latter is the point.                                                                                                                                                                                           |
| `isPending`                   | Verdict-loud (§2.4): the latest-form verdict (A8), made the only form.                                                                                                                                                                                                               | Pending does not propagate through sync derivations of a deferred node (they never re-run), so the probe needs a reachability walk for derived reads including store leaves (§8.1). In the initial implementation. |
| `latest`                      | Complementary, not competing: `latest` is the input-side affordance (show my change while its consequences load), `createDeferred` the data-side one (show the previous result while the next loads). `latest(() => deferred())` is legal and a no-op (nothing staged to lead with). | In a held view they compose: `latest` on the control, `isPending` dimming the content.                                                                                                                             |
| `until` / `refresh`           | Edges intact, so both reach the node. Authoritative readers bypass the clamp (D9): `refresh(deferred)` parks and resolves on the landing; `until(() => deferred())` sees only settled truth.                                                                                         | Without the bypass `refresh` resolves with the stale value — a real bug (§6.3a).                                                                                                                                   |

## 6. Implementation (as landed on L2, 2026-10-04)

Seams, in order of confidence. Each records the L2 mechanism, then — where
it differs — what #3710 did on the pre-L2 core and why the move. The
vocabulary is the spec's L2 module map: `core/scheduler.ts` (`Transaction`,
`holdNode`, `blocked`, the seam `settle`, `land`), `core/core.ts` (`read`'s
hold rules, `recompute`), `core/verdict.ts` (one cold read path), `affects.ts`
(marks).

**In one paragraph.** A deferred node is a plain memo whose answered passes
run inside the commit-#0 loading window (A27): the pass neither throws nor
goes `STATUS_PENDING`, so nothing observes a flight, the flush does not park,
and the write that re-asked the node commits with its tick (D1). The window
is the flight. Its verdict is a mark on the node — the `affects()` channel
(A24), whose scope is the flight: registered at its start, released at its
landing (D4). "Never leads" (D2) is the seam's own hold decision: the
wrapper queues the node as a pending node of the flush it ran in, with
nothing staged; if that flush parks, the node is held with the transaction
like any pending node, and its landing re-enters the hold (A34 (1)). The
authoritative readers ask the module (D9). Nothing lane-shaped, nothing in
`read()`.

### 6.1 Read contract = the loading window, re-opened per pass

The loading window already implements the read side exactly — unchanged on
L2 (A27 Mechanism (L2): "unchanged async core — `_loading` on the node;
`handleAsync` serves `_value` instead of throwing while set;
`parkLoadingWindow` registers the flight's dependents without read-visible
pending"):

```ts
// core/async.ts — handleAsync
if (el._loading) return el._value; // serve committed
throw new NotReadyError(context!);

// core/core.ts — recompute catch
if (notReady && el._loading) parkLoadingWindow(el, e); // register for settle,
// "NO read-visible pending status and no downstream propagation — the
//  committed loading value keeps serving."
```

So the clamp is not a core branch at all: it is a **compute wrapper**
(`deferredCompute`, `src/deferred.ts`). Once the node has answered, every
pass re-opens the window (`el._loading = true`) before calling the user's
compute. A thrown `NotReadyError` is a flight (the wrapping form, D8: core
parks the node on the upstream, window open); a real error closes the window
and is the answer (D6); a sync value closes it. An async-shaped result — a
thenable or an async iterable, checked untracked — is **registered by the
wrapper itself** through `handleAsync`, as a projection's body registers its
own flight (`recompute` takes the self-registered value): when `handleAsync`
returns, a thenable that resolved synchronously or a stream whose first
yield was buffered has _landed_ — the window is closed and no flight opens;
only a result still in the air opens one. The wrapper classifies the
_outcome_, not the shape, so the verdict never flickers for an answer that
was never in flight (A10). (#3710 classified the shape before `handleAsync`
ran and opened a flight for every thenable; a sync-resolved one then closed
its window at a site with no hook — the §8.3 "known edge", gone.)

"Answered" is sticky in the wrapper's closure: initialized and the window
closed. The uninitialized first flight is _not_ windowed — the node starts
`STATUS_UNINITIALIZED` like a plain memo, so D5 holds and `<Loading>` owns
the first load; on L2 an uninitialized source is nobody's frame at the seam
(a loading source is not held), its observers are, and its first landing is
commit #0. With `loadingValue` (§2.1) the node is born committed with its
window open: the first flight is the A27 window (verdict-quiet), and the node
answers when that flight lands; from there refetches are loud.

`_loading` keeps its meaning — the committed value is serving while an
answer is in flight — and every site that makes an answer observable
closes it: `asyncWrite`'s equal-value landing (nothing staged),
`commitPendingNode` for a staged landing (this flush's sweep, or a
transaction's `land`), the sync paths. The one core change on this side:
`commitPendingNode`'s window close is **gated on a staged value** (it was
unconditional), so a deferred node committed with nothing staged — queued
for the seam's hold decision (§6.2) and swept by a committing flush, or held
by a transaction that landed before the flight did — keeps its window open:
the flight is still up. Byte-neutral (the line moved into the existing
block).

The node's _public_ status stays clean — never `STATUS_PENDING` from a
consumer's perspective, never a blocker of any transaction (`blocked` counts
pending held nodes a frame observes; a deferred node is never pending) —
and the in-flight state is carried where the verdict looks (§6.3). `read()`
is untouched (§6.3a).

### 6.2 Landing schedule = the plain write path; never leads = the seam's hold

**The landing** is `asyncWrite`'s plain path — `setSignal(el, () => value)`
then `flush()` — what it always was for a memo whose flight nobody observed.
On L2 the question the 2026-09-08 sketch answered with lanes ("a landing
during an unrelated held transition is adopted into it and held hostage")
does not arise: a transaction holds **nodes**, not flushes (ruling 1, "one
frame concept"). The theme's transaction holds the theme's staged nodes and
has stashed its own flush's runs; the panel's landing runs its own flush,
joins nothing (the deferred node is not held), commits at its seam, and its
consumers' effects run. Pinned by "the deferred consumer repaints while the
theme transition is still held" (D3).

**Never leads (D2).** The plain path does not know the flight was asked
against a staged write, and on L2 the deferred pass is the one pass the
seam would otherwise never see: a pass that _changes_ is queued (staged) and
held if the flush parks; a pass that goes _pending_ is queued and held; a
deferred pass does neither — it served the committed value — so the seam
would not list it, and its landing would commit beside a `period` the
sibling still holds. So the wrapper queues it: a flight opened inside a
flush is queued as a pending node of that flush (`openFlight` →
`queuePendingNode(el)`) with nothing staged, and the seam decides as it does
for every pending node — a flush that parks holds it (`holdNode`,
`CONFIG_HELD`, `_x._transaction`), a flush that commits sweeps it
(`commitPendingNode` with nothing staged: a no-op, the window gated open,
§6.1). Held, its landing's `setSignal` re-enters the hold (A34 (1): a write
to a held node joins its transaction): the answer stages under the
transaction and reveals with the write it was asked with, never ahead of
it. Not pending, it never blocks that transaction (`blocked`), so the
sibling's landing lands the transaction with the deferred node committed
unstaged — the write reveals, the panel follows. Pinned by both orders.

The same decision, from the pass's side: a flight asked against this
flush's staging is this frame's (ruling 3, "a staging read is the frame's")
— the deferred pass read the staging as a derivation would, and its result
is a question whose answer belongs to the frame that asked it. Queueing is
how `recompute` hands a pass to the seam for exactly that decision; the
wrapper does it for a pass `recompute` would not have queued.

**Inside an action** the same mechanism makes the flight the action's work:
the action's write is held by its transaction, the deferred pass runs in
the flush that parks into it, the node is held with it, and the landing
stages under it until the body returns — or, the body returning first, the
transaction lands with the node unstaged and the panel follows ambiently.
The action never waits on the flight. Pinned ("L2 — inside an action").

(#3710 did the same queueing against the pre-L2 batch: "the adoption stamps
the deferred node with the transition like every other pending node; its
landing then arrives at `setSignal` with `el._transition` set and takes the
existing 'write to a held node re-enters its transition' arm." The L2
form is the seam's `holdNode` and `setSignal`'s `joinFuture(txOf(el))`.)

**Downstream** is untouched: the landing is an ordinary commit, so sync
derivations recompute on the ordinary rails; D10 stays withdrawn.

The wrapping form (§4.7, upstream `NotReadyError`) takes the
`parkLoadingWindow` branch in `recompute`'s catch (the wrapper opened the
window); when the upstream settles, the settle walk re-runs the node
(`_blocked`) and its sync result stages on the same plain path — under the
upstream's transaction if the upstream was held (the pass is served the
staged value and joins, A29), so a wrapped held memo's value reveals with
the hold while the deferred node's own consumers were never suspended.
Pinned by D8.

**Convergence with an in-flight optimistic action** (§8.2) is not a
lane-merge question. The landing is an ambient commit — the same event as a
signal written mid-action — and A17 answers it: a consumer of both the
deferred node and the guess keeps seeing the guess, and repaints with the
new data now. Pinned: `["rows-1:false", "rows-1:true", "rows-2:true"]` then
the revert at settle.

### 6.3 Verdict = an `affects()` mark whose scope is the flight

The loading window is verdict-quiet _because it has nothing to see_: the node
carries no `STATUS_PENDING` and no staged `_pendingValue`, and L2's one
verdict read path (`verdictValue`, core/verdict.ts) answers exactly those
(`pendingVerdict`, `heldNotFinal`). A deferred node in flight is in the same
state — and, because its committed value doesn't change, its derivations
never re-run and never pick up status either. So the verdict cannot ride the
recompute rails; it rides the mark channel `affects()` already built on L2
(ruling 9): **a count on the node** (`_x._marks`, affects.ts `mark`),
pull-derived coverage at probe time (`GlobalQueue._marked` → `marked`: the
probed node, or one reachable through its current dependencies; a read
through a derived store's family pulls the derive inside the verdict window,
`pullFamily` → `readNode(fw)`, so the leaves are covered too), and a push —
the verdict readers downstream re-derive — at registration and release.

What differs from `affects()` is the mark's **scope**. An `affects()` mark is
listed with its transaction (released at the landing) or the ambient list
(released at the seam, kept while the node's flight is up). A deferred
flight's mark is scoped to the flight: registered by `openFlight` (`mark` +
the push), released by `closeFlight` (`unmark` + the push) — from the
landing hook, ahead of the landing's write (§6.4), from the wrapper on a sync
answer, and from the seam for a rejected flight or a dead node. The module
owns the lifecycle; affects.ts exports the two counters (`mark`/`unmark`)
and nothing else of its machinery is touched. Full lifecycle in §8.1.

**Quiet re-asks** (A24) are open flights without a mark: the waiters park
on them (D9), the verdict stays `false`. A new question superseding a quiet
flight marks it; a re-ask superseding a loud flight leaves the mark (A19
exc. 2: the re-ask does not launder the new question).

**The push** (`wake`, deferred.ts) walks the node's subscribers through
derivations, stopping at effects — affects.ts's `repoll`, with one more
clause at a close: an authoritative reader parked on the flight
(`_pendingSources.has(flight)`) is re-enqueued too (§6.3a). Verdict readers
on L2 are linked to the node directly (no companions), so the landing's own
`insertSubs` re-runs the direct ones; the walk is for the derived ones and
for equal-value landings, which write nothing.

**Why the mark drops at the landing, not at the commit.** A verdict reader
re-run by the landing's write reads the landing as a plain memo's reader
does: `landStatus` clears a plain memo's pending _ahead of_ the write, so the
reader finds a staging that will commit (final, A28) or be held (not final,
A19 iii — `heldNotFinal`). The deferred mark drops at the same point for the
same reason; from the landing on, the node's non-finality is its staging's,
and a landing held by a transaction reads pending through `heldNotFinal`
exactly as a plain memo's does. (A mark released at the commit instead made
the reader run twice for the same `true` — found by the D1 pin.)

**Display-ahead** (ruling 6) holds for the deferred verdict as for every
verdict: a tracked `isPending(d)` re-run in a flush that parks is routed into
the holder's verdict lane by `verdictValue`'s mark arm (`verdictRead` when
`flushTransaction !== null`) — shown now, re-derived at the landing. Pinned
("L2 — the verdict is display-ahead").

(#3710's verdict was a predicate over its own sets read from `markWalk`,
counted in `activeAffectsMarks`, pushed by `_repollVerdicts` onto per-node
companions in "live" or "snap" mode. Companions, `markWalk` and the two
repoll modes do not exist on L2; the count and the walk do, so the mark is
one of affects.ts's own.)

### 6.3a Authoritative readers bypass the clamp (D9)

`refresh(node)`'s waiter contract depends on the read **parking**: it pulls
the node and "the read either parks on the re-ask's pending window … or
serves the sync answer." A deferred node never parks, so `await
refresh(deferred)` would resolve **immediately with the stale value**. That is
a correctness bug, and it lands on exactly the §9 audience who wanted
`refresh` to work.

Fix at the two readers. `refresh`'s waiter and `until`'s predicate are the
promise-delivery readers (ruling 8; `until` is `CONFIG_AUTHORITATIVE`, which
already reads the truth beneath a lane's guess — A17's carve-out), so the
bypass lives in their computes (`watch`, signals.ts) rather than in
`read()`:

- `refresh`'s waiter, after `read(node)`, throws `NotReadyError(node)` when
  the node itself is an unanswered open flight (`unansweredFlight(node,
null)`).
- `until`'s predicate, after `fn()`, walks its own current dependencies
  (respecting the recomputing tail; a store slot node hops to its family's
  derive through `GlobalQueue._slotDerive`, since a read through the family
  pulls the derive without linking it) for an unanswered open flight and
  throws `NotReadyError(flight)`. Transitive: `until(() => derived() > 5)`
  over a memo of a deferred node, and `until(() => store.items.length)` over
  a derived store built on one, wait for the landed truth.

"Unanswered" excludes a flight whose answer is staged (held by a
transaction): authoritative reads see staged truth — which is what lets
`yield until(...)` inside the action whose own write asked the flight settle
on the held answer instead of deadlocking (the landing staged under the
action is answered; the predicate re-runs in the action's flush, reads the
staging, joins, and delivers — the action's own reader delivers the frame it
read). Either way the waiter parks (pending on the flight as its source),
and the flight's close releases it: a direct parker through the landing's
own `settlePendingSource` walk, and — the walk stops at a derivation that
never went pending — every parker through the module's `wake` (§6.3), so an
equal-value landing beneath an unchanged derivation releases
`until(() => derived())` too. Pinned ("L2 — D9's push"). Both checks return
on one `Set.size` compare when no flight is open, and neither is in the
floor; `refresh`/`until` retain the walk and nothing else of the module.

**Quiet re-ask (A24).** `refresh(d)` must park the waiter and keep
`isPending` false. A plain memo classifies the re-ask in `recompute` (the
`reask` local → `_x._reask` once the pass goes pending); a deferred node's
pass never goes pending once answered, so the wrapper classifies it:
`recompute`'s pre-pass flag wipe now carries `REACTIVE_REASK` through the
pass (the `finally` mask still drops it), and the wrapper reads it. A flight
opened by a re-ask is open but unmarked; a new question superseding it marks
it; a re-ask superseding a loud flight leaves the mark.

### 6.4 Module layout

A pay-for-use module, `src/deferred.ts`, beside `affects.ts` and
`boundaries.ts` (the public primitives layered on core). It owns the wrapper,
the open and loud flight sets, `openFlight` / `closeFlight`, the push
(`wake`), the D9 walk (`unansweredFlight`) and the seam sweep. It imports
`mark`/`unmark`/`onSeam` from `affects.ts` — the sweep (a rejected flight, a
dead node) runs from affects.ts's own seam hook (`_releaseAmbientMarks`), a
mark-scope release like the ambient one, so no second core hook is spent on
the same instant — so `createDeferred` retains the mark module (and not the
verdict layer that reads it: a program that never asks `isPending` pays
nothing for the answer; `tests/treeshake.test.ts` pins both).
`createDeferred` lives in `signals.ts` beside `createMemo`:
`installDeferred()` then `computed(deferredCompute(compute), options)`.

What core carries, all of it in the floor:

- `recompute`'s pre-pass wipe keeps `REACTIVE_REASK` (a mask constant);
- `commitPendingNode`'s window close is gated on a staged value (§6.1);
- `GlobalQueue._deferredLanded`, called with `?.` from `asyncWrite` ahead of
  the landing's write (§6.3);
- `GlobalQueue._slotDerive` (store/store.ts installs it): a slot node's
  family derive, for D9's walk.

`verdict.ts` is untouched: the mark is read where `affects()`'s are. No
INV-4 twin (L2 has no companions to check against an oracle).

Facades: `packages/solid/src/client/hydration.ts` (`createDeferred`
hydrates like `createMemo`, through the `_hydrateSignalLike` adapter slot
as `createOptimistic` does, so hydrating bundles that never call it do not
retain it) and `packages/solid/src/server/signals.ts` (`createDeferred =
createMemo` identity, D7); exported from both `solid-js` entries.

### 6.5 Constants

None. The brand is the wrapper; the state is `_loading` plus membership in
two module-level sets and a mark count the node already carries. No
`CONFIG_*` bit, no `NodeExtension` field.

## 7. Spec propositions (to add to `SPEC-ASYNC-SEMANTICS.md` on landing)

Numbered provisionally; renumber into the A-series when adopted.

- **D1.** An initialized `createDeferred` node in flight is read as its
  committed value by every tracked and untracked consumer; no
  `NotReadyError` propagates from it, it is never `STATUS_PENDING`, so no
  frame observes it and no transaction is blocked by it (L2 `blocked`; was
  "never appears in any transition's `_asyncReporters`").
- **D2.** A `createDeferred` node never serves a staged `_pendingValue`. Its
  observable value changes only at (i) a global commit that includes it or
  (ii) its own landing. It never observably leads a held write.
- **D3.** A `createDeferred` landing that arrives during an incomplete
  unrelated transition commits and its consumers' effects flush without
  waiting for that transition. Consumers that also read a source held by that
  transition see its committed value (A29's stale-reader term) and are
  replayed at its commit. A landing during an in-flight optimistic action is
  an ambient commit like any other: consumers of both keep the override (A17)
  and repaint with the new data now (§8.2).
- **D4.** `isPending(() => d())` for a deferred `d` follows A19 unchanged:
  `true` while `d`'s own non-quiet flight is in flight, `false` the instant
  it lands. `[isPending(() => d()), d()]` read in one scope is atomic (A10).
- **D5.** An uninitialized `createDeferred` node is loading, not pending
  (A19 exception 1): its first `NotReadyError` propagates to loading
  boundaries and it participates in SSR streaming / hydration reveal like a
  plain memo.
- **D6.** A rejected `createDeferred` flight sets `STATUS_ERROR` and throws
  to readers like a plain memo. Deferral never masks an error with a stale
  value.
- **D7.** On the server, `createDeferred` is observationally `createMemo`.
- **D8.** `createDeferred(() => m())` over a held memo `m` behaves per D1–D6
  with `m`'s `NotReadyError` as the cause of non-finality; `m`'s other
  consumers are unaffected.
- **D9.** To a promise-delivery reader (`refresh`'s waiter, `until`'s
  `CONFIG_AUTHORITATIVE` predicate — L2 ruling 8) a `createDeferred` node in
  flight throws `NotReadyError` like a plain memo. `await refresh(d)`
  resolves with the landed value, never the served stale one;
  `until(() => d())` evaluates only settled truth — a landing staged under a
  transaction is settled truth to it. (Same standing as A17's
  guess-invisibility for authoritative readers.)
- ~~**D10.** (amends A18) `_value` changes at commit points or at a lane
  landing.~~ Withdrawn at implementation (§6.2): the landing is a plain
  commit, not a lane landing; A18 stands unamended.

Pinned in `tests/createDeferred.test.ts`, one `describe` per proposition.

## 8. Open questions

### 8.0 Resolved by reading the code (2026-09-08)

Kept as a record so the reasoning isn't relearned.

- **Lane independence** (was 8.1, "decides the whole cost"). The feared
  failure — a deferred lane merging into an unrelated transition — is not a
  mechanism that exists: lanes merge with lanes, transitions hold lanes only
  through observed reporters, and a deferred node is never a reporter. Cost
  collapsed from "small or medium" to "small, with one accepted merge case."
  _Superseded at implementation:_ the landing does not use lanes at all
  (§6.2, #3479 drift), so the question is moot and the merge case is gone.
- **`until` / `refresh`** (was 8.4, "verify"). Not a verification — a bug.
  `refresh(deferred)` would resolve with the stale value because the waiter
  relies on the read parking. Fix is D9 (authoritative readers bypass the
  clamp), by the A17 precedent. §6.3a.
- **`isPending` on the deferred node itself** (half of 8.3). Trivial: one
  `computePendingState` clause plus a companion poke at flight start. §6.3.
- **`<Loading on={key}>`** (8.2). Inert; documented, not warned — the
  boundary cannot cheaply know it covers a deferred source (it only learns of
  sources when pending arrives, which never happens). The "hard reset
  re-opens the uninitialized path" upgrade stays available if asked for.

### 8.1 `isPending` through derivations of a deferred node (the one real engineering item)

**Why `isPending` is loud at all.** A19 cause (ii) — "the node's own async in
flight" — ends at resolution, not at commit; it was never transition-bound.
A8 already rules that `isPending(() => latest(x))` follows `x`'s own async
only and flips `false` the instant the fetch resolves regardless of held
commits. A deferred node's verdict is exactly the latest-form verdict, made
the only form. It is loud where the loading window is quiet because the
window's stale value was _declared_ as the answer (affordance in the value
channel) while a refetch's stale value is merely the _previous_ answer. And
it is the primitive's only refetch affordance: without it deferred is silent
SWR and the §9 audience is back to hand-rolled `isLoading` flags.

**The gap is general, not store-specific.** Cause (ii) normally reaches
derivations _through recompute_: a sync memo over a pending async memo
re-runs, reads pending, throws, becomes blocked, and so carries
`STATUS_PENDING` itself. A deferred node's committed value does not change
during a refetch, so its derivations **never re-run** and carry nothing —
`isPending(() => count())` for `count = createMemo(() => rows().length)` is
`false` while `rows` refetches. The channel that carries cause (ii)
downstream is the very thing deferral turns off. The store composition
(§4.5, leaf → firewall → memo) is the most important instance because it is
the recommended pattern, not a special case.

**Fix: the `affects()` mechanics, verdict channel only.** `affects()` is
already the "doesn't hold above, shows pending below, without recompute"
primitive (on L2, ruling 9 — rebuilt transaction-inert), and it is built as
two channels:

- _Pull_: a mark is only a count on the node (`_x._marks`); coverage of
  everything derived from it is computed at probe time by `marked`
  (affects.ts) — dep-graph reachability through the probed node's current
  dependencies; a read through a derived store's family pulls the derive
  inside the verdict window (`pullFamily`), which is how leaf → derive → memo
  is covered. Nothing is stored downstream, so rewires and mid-window
  recomputes cannot strand or strip it.
- _Push_: the verdict readers downstream (`CONFIG_VERDICT`, linked to the
  node directly — L2 has no companions) re-derive on registration and
  release, through derivations, stopping at effects (`repoll`).

A deferred node in flight is a mark of this kind, with one structural
difference: `affects()` marks are listed with a transaction (released at its
landing) or the ambient list (released at the seam), and a deferred node
never has a transaction to end. Its mark is therefore **a mark whose scope
is the flight**: the same count on the node, registered and released by the
module that owns the flight. Note that `_inFlight` itself cannot serve as
the flight's identity for this: it is never nulled at an async landing (it
persists as the supersession identity token that `asyncWrite` /
`handleError` compare against), so "`_inFlight` non-null" would read
pending forever after the first landing; the open-flight set is the
identity.

Lifecycle (as landed on L2): **opened** by `openFlight`, called by the
wrapper when an answered node's pass leaves a flight in the air (an
async-shaped result `handleAsync` did not land synchronously, or a thrown
`NotReadyError`, D8) — marked unless a quiet re-ask; a loadingValue node's
first flight is the A27 window and not a flight (verdict-quiet). **Closed**
by `closeFlight` — `unmark` and the push — from the landing hook
(`asyncWrite`, ahead of the landing's write, §6.3), from the wrapper (a sync
answer, or a flight found closed or errored at the next pass), and from the
seam (a rejected flight, a node disposed mid-flight). `asyncWrite` is
identity-gated, so a superseded flight's landing cannot close the flight the
newer one owns. By case: lands → closed ahead of the write, verdict readers
re-derive, waiters released (D9); from there the node's non-finality is its
staging's (a landing held by a transaction reads pending through
`heldNotFinal`, A19 iii, as a plain memo's does). Rejects → `STATUS_ERROR`,
throws to `<Errored>`; the seam of the flush the error's readers schedule
closes the flight, so the error outranks the verdict from there (D6) — a
verdict reader re-run in that flush's heap read the mark once more over the
same `true` it already showed, and re-derives at the close. Superseded →
stays open until the _new_ flight lands. Hangs → stays open, same as any
async memo's `STATUS_PENDING`. Quiet re-ask (A24) → open, unmarked. Disposed
→ closed at the next seam that runs. A disposal inside a flush gets that
flush's seam; one outside a flush schedules nothing (`disposeChildren`
forces a seam only for a held flight or a stale frame reader), so the dead
node's mark outlives it until the next write's flush — a pending verdict
over a value that will never change, bounded by the application's next
flush, taken over the 5 B the dispose clause cost. Nothing leaks: the set is
the lifecycle, the count follows it.

Deliberately **not** copied from `affects()`: the scope lists and the
boundary channel. A mark holds nothing on L2 either (`blocked` never sees
one), so "doesn't hold above" is the channel's own property; what the
deferred flight adds is a release schedule that is the flight's rather than
a transaction's or the seam's.

**Push placement.** Both pushes sit with the set: flight start in
`openFlight`, close in `closeFlight`. On L2 the verdict readers are plain
subscribers of the node, so order against the pending-node queue is
irrelevant (no companion publishes a staged verdict twice). The push does
not hop a derived store's family — `repoll` and `wake` walk subscribers, and
a family's leaves do not subscribe to its derive — so a _tracked_ probe
through a derived store's leaves is re-derived by the landing's leaf changes,
not by the flight's open or an equal-value close; an untracked probe is exact
either way (the pull). The same holds for `affects()` on L2 (a memo mark
through a derived store); if the maintainer wants the push to hop families
it is one derive → family back-reference in `repoll`, for both.

**Decision (revised 2026-09-08).** In the initial implementation, not a
follow-up: the docs' own recommended composition would otherwise show a
visible hole (`isPending(() => store.items.length)` false during refetch).
`isPending(rows)` on the memo itself needs only the §6.3 clause and works
regardless.

### 8.2 A landing during an in-flight optimistic action — **resolved at implementation: A17, no lane**

The sketch's case: an effect reading a deferred node and an in-flight
optimistic action's override converges, merges lanes, and waits on the
action; it was accepted as "one paint at settle." With the plain landing path
(§6.2) there is no lane to merge. The landing is an ambient commit — the same
event as a signal written mid-action — and the engine already rules it: the
consumer of both re-derives with the override intact (A17) and repaints with
the new data now; at settle the override drops over the landed data. The
todo case: two rows from deferred `rows`; the user toggles row A inside an
action still awaiting the server; the refetch lands mid-action.

- **Row B repaints now.** It reads only deferred-derived data.
- **Row A repaints now too, toggled.** `rows-1:false → rows-1:true →
rows-2:true`, then `rows-2:false` at settle. The committed (un-toggled)
  value is never shown while the action runs.

Two paints on A instead of the sketch's one — but the second is the revert
the action owes regardless, and the data no longer waits on an unrelated
server round-trip, which is the primitive's whole point. Pinned. (The
settle's run count is the lane engine's — identical for a plain signal
written mid-action — and is not this primitive's to pin.)

### 8.3 Smaller

- Default `equals`: the source's own (inherit `NodeOptions`) — same as memo.
- Store / projection as the fn's return value: a memo returning a store
  reference is legal today; deferral doesn't change that but is also not
  meaningful for it (leaf pending routes through the returned store's own
  firewall). Document, don't special-case.
- `refresh(d)` quiet re-ask (A24): with the D9 bypass the waiter parks like a
  plain memo's, so quiet/loud classification should fall through unchanged.
  Confirm the quiet re-ask keeps `isPending(() => d())` false (A24) while
  still resolving the waiter.
- ~~`CONFIG_DEFERRED = 1 << 19`.~~ No config bit was spent: the brand is
  the compute wrapper (§6.5).
- ~~**Known edge: a synchronously-resolved refetch.**~~ Closed on L2 (§6.1):
  the wrapper registers the flight through `handleAsync` itself and
  classifies the outcome, so a thenable that resolves synchronously (a
  `MockPromise`-style value) never opens a flight — no mark, no stale
  verdict downstream. Pinned ("L2 — a refetch that resolves synchronously
  is a landing").
- **Error precedence timing.** A rejection closes the flight at the seam of
  the flush its readers schedule (`<Errored>`'s output and verdict readers
  re-derive on an error, and schedule), not inside `handleError`: a hook
  there would be a third floor call for a transient — a verdict reader
  re-run in that flush's heap reads the mark once more over the `true` it
  already showed, then re-derives `false` at the close. At rest, an errored
  deferred node is never pending (D6, A16's "error outranks").

Not open — rejected, recorded so they aren't re-proposed: a `<Deferred>`
boundary (§4.1: ambient scope is the theme-fanout hazard; not planned) and a
`createMemo(fn, { deferred })` option (§4.6; the lane-dependency half of that
argument fell with §6.2 — what remains is that a separate name is the
teachable unit (§2.3, §9's "delete `Deferred`" step) and keeps the door open
to relocation, which is how it landed (§6.4).

## 9. Migration role (raises the priority)

The originating report continued (2026-09-07) into a migration critique that
is legitimate and worth locating precisely. It is not an objection to the
hold model. It is that `createMemo(async () => ...)` **looks** like "1.0 plus
promises" but silently enrolls the node in program-wide coordination that 1.0
never had. Nothing errors; everything gets slower together; the user spent
two weeks finding out why. A silent semantic change under a familiar API is
the worst migration profile, and the only escapes were per-read (`latest`),
fallback-shaped (`<Loading on>`), or off-graph (effect write-back — which the
docs discourage, so advice to "keep your 1.0 effect+signal fetching" directly
contradicts them, and the user noticed).

`createDeferred` (§2.1) is the missing per-node dial, and that changes what
it is: not a niche SWR tool but the migration primitive. Coordination becomes
a gradient rather than a cliff:

1. **Mechanical.** Split effects (return from the first callback, consume in
   the second); find and fix read-after-write. Unavoidable.
2. **Convert fetches to `createDeferred`**, with `loadingValue: undefined`
   where the 1.0 code checked for `undefined`. The app behaves like 1.0;
   `refresh` / `isPending` now work; the graph is intact.
3. **Per query, delete `Deferred`** to opt into coordination where it helps
   (panels that _should_ reveal together). Each step removes a word; each is
   independently reversible.

The mirror-image risk — teams that never leave step 2 — is acceptable: a team
that doesn't want coordination shouldn't have it forced on them, provided the
default for fresh code stays coordinated and the docs are explicit about what
step 3 buys.

Doc consequences (owed regardless of this primitive, sharper with it):

- The async-memo page's **first paragraph** states that async memos hold the
  graph, with the shared-selector-panels scenario as the canonical surprise,
  and a decision table for the three affordances: `<Loading on>` (fallback),
  `isPending` + `<Show>` (1.0-shaped fallback), `createDeferred` (stale).
- A **pattern-keyed** migration guide:
  - `createResource` + `<Suspense>` → async memo + `<Loading>` (they were
    already approximating coordination; the closest match).
  - `createEffect(on(...))` + signal/store + `<Show when={!loading()}>` →
    `createDeferred` + `isPending` + `<Show>`.
  - `createResource` with `.loading` checks, no Suspense →
    `createDeferred` + `loadingValue: undefined` + `<Show when={data()}>`
    (the literal translation).
- The effect-write-back discouragement stays; `createDeferred` is what makes
  it fair to keep.
