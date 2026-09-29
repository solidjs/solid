# Design: `createDeferred` — an async memo that may lag, but never leads

> Status: **implemented** (design agreed 2026-09-08; implemented 2026-09-28
> as a pay-for-use module, `core/deferred.ts`, §6.4; pinned by `tests/createDeferred.test.ts`, one
> test per proposition D1–D9 plus §2.1, §8.1 and §8.2). Origin: a Discord
> report (2026-09-03) of independent dashboard panels sharing one global
> selection store, where every panel's commit waited on the slowest panel's
> fetch (20–200ms panels held hostage by 3–10s panels). Semantics below are
> settled and unchanged. **The landing mechanism changed between design and
> implementation** (§6.2): the 2026-09-08 sketch landed through the lane
> engine; by implementation time the lanes stage (#3479) had made a memo's
> lane pass a _derived override_, not a direct commit, so that path no longer
> commits at all. The landing now takes the plain write path with no lane
> involvement — smaller, and D3's "accepted coupling" with in-flight actions
> disappears with it (§8.2). §9 records why this is a migration primitive,
> not a niche one: combined with `loadingValue` it is the per-node opt-out
> from coordination that 1.0 → 2.0 migrations currently lack.

## 1. The problem

Solid 2.0 holds while async. A write stages into `_pendingValue` and joins the
ambient batch; the moment any downstream async memo throws `NotReadyError`,
`initTransition` adopts the whole batch — the shared write and every
sibling's staged derivations — into one `Transition`. Every render effect that
observes a pending async source registers in `_asyncReporters`, and
`transitionComplete` will not release until all of them settle. One atomic
commit, gated on the slowest reporter. Meanwhile `stashQueues` parks the
entire effect-queue tree, so even effects whose sources never went pending
wait.

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

## 6. Implementation (as landed)

Seams, in order of confidence. Where the 2026-09-08 sketch differs, the
sketch is quoted and the change recorded.

### 6.1 Read contract = the loading window, re-opened per pass

The loading window already implements the read side exactly:

```ts
// core/async.ts — handleAsync
if (el._loading) return el._value; // serve committed
globalQueue.initTransition(resolveTransition(el));
throw new NotReadyError(context!);

// core/core.ts — recompute catch
if (notReady && el._loading) parkLoadingWindow(el, e); // register for settle,
// "NO read-visible pending status, no downstream propagation, no transition,
//  no lane registration — the committed loading value keeps serving."
```

So the clamp is not a core branch at all: it is a **compute wrapper**
(`deferredCompute`, `core/deferred.ts`). Once the node has answered, every
pass re-opens the window (`el._loading = true`) before calling the user's
compute, and classifies the result: a thenable or async iterable (checked
untracked) or a thrown `NotReadyError` is a flight — core then serves the
committed value or parks, exactly as for a loadingValue window; a sync value
or a real error closes the window again before core sees it. Every site that
makes an answer observable already clears `_loading` (asyncWrite's direct
branch, `commitPendingNode`, the sync-resolve and iterator paths), so the
window closes itself at landing with no deferred-specific code there.

"Answered" is sticky in the wrapper's closure: initialized and the window
closed. The uninitialized first flight is _not_ windowed — the node starts
`STATUS_UNINITIALIZED` like a plain memo, so D5 holds and `<Loading>` owns
the first load. With `loadingValue` (§2.1) the node is born committed with
its window open: the first flight is the A27 window (verdict-quiet), and the
node answers when that flight lands; from there refetches are loud.

`_loading` keeps its meaning — the committed value is serving while an
answer is in flight — and every reader of it (the verdict's held-value gate
in `computePendingState`, the projection's commit gating) sees a deferred
flight the way it sees a loadingValue window. The one core change on this
side: `commitPendingNode`'s window close is gated on a staged value (it was
unconditional), so a flight queued as a pending node with nothing staged
(§6.2) is not closed by the batch's commit sweep. Byte-neutral.

The node's _public_ status stays clean — never `STATUS_PENDING` from a
consumer's perspective — and in-flight state is carried where the verdict
machinery looks (§6.3). `read()` is untouched (§6.3a).

### 6.2 Landing schedule = the plain write path (revised at implementation)

**The sketch** (2026-09-08) landed through the lane engine: ensure a lane at
landing time so `asyncWrite` took its lane branch, which then
direct-committed `_value`, poked companions and propagated on the
optimistic-dirty channel — "the landing path already exists verbatim." That
was verified against `lanes.ts` / `optimistic.ts` as they stood.

**What changed.** The lanes stage (#3479, landed between design and
implementation) made a memo's lane pass publish a _derived override_
(`GlobalQueue._laneOverride`: the speculative result lives in the override
slot, `_value` stays the committed truth, and the node joins the
transaction's optimistic nodes to be reverted and re-derived). A deferred
landing routed there would not commit; it would become an override with no
transaction to end. The lane path is not a landing path any more.

**What landed instead.** Nothing lane-shaped. The landing is `asyncWrite`'s
plain branch — `setSignal(el, () => value)` then `flush()` — which is what
it always was for a memo whose flight nobody observed. The question the
sketch answered with lanes ("a landing during an unrelated held transition
is adopted into it and held hostage") has a simpler answer in the scheduler
itself: a transition that fails to complete parks **its own** flush's
queues (`stashQueues`), sets `activeTransition = null` and installs a fresh
batch. A landing that arrives later runs its own flush in that fresh batch
with no active transition, commits, and its consumers' effects run. The
theme's held nodes stay held (they are stamped with the theme's
transition); the panel's aren't. Pinned by "the deferred consumer repaints
while the theme transition is still held" (D3).

**Never leads (D2)** needs one addition, because the plain path does not
know the flight was asked against a staged write. A flight opened _inside a
flush_ is queued as a pending node of the current batch
(`openFlight` → `queuePendingNode(el)`), with nothing staged. If a
sibling turns that batch into a transition, the adoption stamps the
deferred node with the transition like every other pending node; its
landing then arrives at `setSignal` with `el._transition` set and takes the
existing "write to a held node re-enters its transition" arm — the landing
joins the hold and reveals with the write it was asked with, never ahead of
it. If nothing holds the batch, the queued node is committed by the sweep as
a no-op (`commitPendingNode` gates the window close on a staged value; a
node with nothing staged is untouched). Pinned by both orders: "deferred
lands first" (the landing waits for the sibling) and "sibling lands first"
(the write reveals, the panel follows).

**Downstream** is untouched: the landing is an ordinary commit, so sync
derivations recompute on the ordinary rails and D10 — the A18 amendment
"`_value` changes at commit points or at a lane landing" — is withdrawn;
there is no lane landing.

The wrapping form (§4.7, upstream `NotReadyError`) takes the
`parkLoadingWindow` branch in `recompute`'s catch (the wrapper opened the
window); when the
upstream settles, the settle walk recomputes the node and its sync result
commits on the same plain path. Pinned by D8.

**Convergence with an in-flight optimistic action** (§8.2 in the sketch) is
no longer a lane-merge question. The landing is an ambient commit — the
same thing as a signal written mid-action — and A17 answers it: a consumer
of both the deferred node and the override keeps seeing the override, and
repaints with the new data now. Pinned: `["rows-1:false", "rows-1:true",
"rows-2:true"]` then the revert at settle.

### 6.3 Verdict = the `affects()` mark mechanics, verdict channel only

The loading window is verdict-quiet _because it has nothing to see_: the node
carries no `STATUS_PENDING` and no held `_pendingValue`, and
`computePendingState` reads exactly those. A deferred node in flight is in
the same state — and, because its committed value doesn't change, its
derivations never re-run and never pick up status either. So the verdict
cannot ride the recompute rails; it rides the mark channel `affects()`
already built (pull-derived coverage via `markWalk` reachability, push via
`_repollVerdicts`). Full mechanism in §8.1. In one line: the mark is "`_loading`
on a node in `deferred.ts`'s open-flight set, and not in its quiet set";
`markWalk` looks for it right after the error check, flight start and landing
repoll. The flight is counted in `activeAffectsMarks` so the verdict's gate
stays one compare. `notifyMarkBoundaries` and transaction registration are
skipped — that is what "doesn't hold above" means mechanically.

**Repoll mode at flight start** (found by the D1 pinning test). The
companion write has two modes: the live `setSignal` — the companion's own
lane lets the wake escape an incomplete transition's effect stash (#2887) —
and the committed snap used inside queue finalization. Flight start uses
the live write only when a transition is active. With none, the live write's
override has nothing to ride: the batch reverts it at finalize and re-derives
the verdict from committed state, so a reader woken by the lane ran a second
time for the same `true`. `openFlight` publishes committed when
`activeTransition === null`. The landing repoll runs from the landing hook
(§6.4) and is snap when called from `commitPendingNode` (queue
finalization), live from `asyncWrite` — the same split `affects()` release
uses.

### 6.3a Authoritative readers bypass the clamp (D9)

`refresh(node)`'s waiter contract depends on the read **parking**: it pulls
the node and "the read either parks on the re-ask's pending window … or
serves the sync answer." A deferred node never parks, so `await
refresh(deferred)` would resolve **immediately with the stale value**. That is
a correctness bug, and it lands on exactly the §9 audience who wanted
`refresh` to work.

Fix at the two readers. `refresh` and `until` are the only authoritative
readers (`CONFIG_AUTHORITATIVE_READ`, which already tunnels past optimistic
overrides — A17: "overrides invisible to the predicate"), so the bypass
lives in their computes rather than in `read()`:

- `refresh`'s waiter, after `read(node)`, throws `NotReadyError(node)` when
  the node itself is an unanswered open flight.
- `until`'s predicate effect, after `fn()`, walks its own current deps
  (respecting the recomputing tail, hopping firewalls, skipping probe links)
  for an unanswered open flight and throws `NotReadyError(flight)`. This is
  transitive: `until(() => derived() > 5)` over a memo of a deferred node
  also waits for the landed truth.

"Unanswered" excludes a flight whose answer is staged (held by a
transition): authoritative reads see staged truth. Either way the waiter
parks, and the flight's close (`closeFlight` → `settlePendingSource`)
releases it. Both checks return on one `Set.size` compare when no flight is
open, and neither is in the floor.

**Quiet re-ask (A24).** `refresh(d)` must park the waiter and keep
`isPending` false. A plain memo classifies the re-ask in `applyReask` on the
catch side of `recompute`; a deferred node's pass never throws once
answered, so the wrapper classifies it: `recompute`'s pre-pass flag wipe now
carries `REACTIVE_REASK` through the pass (the `finally` mask still drops
it), and the wrapper reads it. A flight opened by a re-ask joins the quiet
set; a new question superseding a quiet flight turns it loud; a re-ask
superseding a loud flight stays loud (`applyReask`'s rule). The flight's
close clears both sets.

### 6.4 Module layout

A pay-for-use module, `core/deferred.ts`, following the `optimistic.ts` /
`verdict.ts` pattern. It owns the wrapper, the open and quiet flight sets,
`openFlight` / `closeFlight`, the D9 walk and the INV-4 dev twin.
`createDeferred` lives in `signals.ts` beside `createMemo`:
`installDeferred()` then `computed(deferredCompute(compute), options)`.

What core carries, all of it in the floor:

- `recompute`'s pre-pass wipe keeps `REACTIVE_REASK` (a mask constant);
- `commitPendingNode`'s window close is gated on a staged value (§6.1);
- one hook, `GlobalQueue._deferredLanded`, installed by `createDeferred`
  and called with `?.` at the two window-close sites that land an answer:
  `commitPendingNode` (snap) and `asyncWrite`'s direct branch (an equal-value
  landing, which stages nothing).

The hook is needed only for the push half: the mark reads closed the moment
`_loading` clears (pull), but downstream companions would not re-derive. A
flight that closes at a site with no hook — a sync-resolved thenable — is
pruned from the set by the node's next pass; its downstream companions are
not re-polled (known edge, §8.3).

`verdict.ts` imports the mark (`deferredMark`, a two-condition read over the
sets); INV-4's twin is installed through `InvariantHooks` in dev by
`installDeferred`, so `invariants.ts` does not import the module (it would
close an import cycle through `scheduler.ts`).

Facades: `packages/solid/src/client/hydration.ts` (`createDeferred`
hydrates like `createMemo`, through the `_hydrateSignalLike` adapter slot
as `createOptimistic` does, so hydrating bundles that never call it do not
retain it) and `packages/solid/src/server/signals.ts` (`createDeferred =
createMemo` identity, D7); exported from both `solid-js` entries.

### 6.5 Constants

None. The brand is the wrapper; the state is `_loading` plus membership in
two module-level sets. No `CONFIG_*` bit, no `NodeExtension` field.

## 7. Spec propositions (to add to `SPEC-ASYNC-SEMANTICS.md` on landing)

Numbered provisionally; renumber into the A-series when adopted.

- **D1.** An initialized `createDeferred` node in flight is read as its
  committed value by every tracked and untracked consumer; no
  `NotReadyError` propagates from it and it never appears in any
  transition's `_asyncReporters`.
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
- **D9.** To a `CONFIG_AUTHORITATIVE_READ` reader (`refresh`'s waiter,
  `until`'s predicate) a `createDeferred` node in flight throws
  `NotReadyError` like a plain memo. `await refresh(d)` resolves with the
  landed value, never the served stale one; `until(() => d())` evaluates only
  settled truth. (Same standing as A17's override-invisibility for
  authoritative readers.)
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
primitive, and it is built as two channels:

- _Pull_: a mark is only a count on the node (`_affectsCount`); coverage of
  everything derived from it is computed by `markWalk` — dep-graph
  reachability through current deps, hopping store firewalls (exactly
  leaf → firewall → memo). Nothing is stored downstream, so rewires and
  mid-window recomputes cannot strand or strip it.
- _Push_: `_repollVerdicts(node)` re-derives every materialized companion
  downstream on registration/release, on the companion's own lane so the
  wake escapes an incomplete transition's effect stash (#2887).

A deferred node in flight is a mark of this kind, with one structural
difference: `affects()` marks are transaction-owned refcounts released at
settle/revert, and a deferred node never has a transaction to end. Its mark
is therefore **node state whose lifecycle is the flight** — `_loading` on a
member of the open-flight set, not a count. Note that `_inFlight` itself
cannot serve: it is never nulled at an async landing (it persists as the
supersession identity token that `asyncWrite` / `handleError` compare
against), so "`_inFlight` non-null" would read pending forever after the
first landing.

Lifecycle (as landed): **set** by `openFlight`, called by the wrapper when
an answered node's pass produces a flight (an async result or a thrown
`NotReadyError`, D8); a loadingValue node's first flight is the A27 window
and not a flight (verdict-quiet). **Cleared** by the window itself: every
site where an answer becomes observable clears `_loading`, so the mark reads
closed at once. `closeFlight` then drops the set entry, repolls and releases
waiters — from the landing hook (`asyncWrite`'s direct branch,
`commitPendingNode` for a staged landing), from the wrapper on a sync or
error result, and lazily at the next pass for a close with no hook.
`asyncWrite` and `handleError` are identity-gated, so a superseded flight's
landing cannot close the flight the newer one owns. By case: lands →
cleared, repoll, waiters released (D9). Rejects → `STATUS_ERROR`; error
outranks the verdict (the mark is read after `markWalk`'s error check, A16)
and throws to `<Errored>`; the entry is pruned at the next pass. Superseded
→ stays open until the _new_ flight lands. Hangs → stays open, same as any
async memo's `STATUS_PENDING`. Quiet re-ask (A24) → open but in the quiet
set, reads quiet. No release step, nothing to leak; the landing repoll is
the "release."

Then: `markWalk` looks for the mark after its error check; flight start and
landing call `_repollVerdicts` (mode per §6.3). The gate stays one integer
compare: the flight is counted in `activeAffectsMarks` itself
(`shiftAffectsMarks(±1)`), not a second counter. `isPending(store)` (A23)
takes the same walk from the firewall. INV-4 (dev) grew a twin of the walk:
a companion reachable from an open flight is covered, not stale.

Deliberately **not** copied from `affects()`: `notifyMarkBoundaries` (the
visual channel that holds `<Loading>` fallbacks / reveal order) and the
`_affectsNodes` transaction registration. "Doesn't hold above" is precisely
"skip those two." Deferred is the verdict channel of `affects` without its
boundary channel.

**Push placement.** Both repolls sit with the set: flight start in
`openFlight`, landing in `closeFlight`. The flight-start
repoll runs _before_ the node is queued as a pending node (§6.2): pending
nodes commit in queue order, and a node queued ahead of its companion's
staged verdict would have `_snapCompanions` publish that verdict a second
time.

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
- **Known edge: a synchronously-resolved refetch.** A thenable that resolves
  synchronously inside `handleAsync` (a `MockPromise`-style value, never a
  native promise) closes the window at the sync-resolve site, which has no
  landing hook. The mark reads closed immediately and the set entry is
  pruned at the next pass, but companions downstream of the node are not
  re-polled, so a derived `isPending` can read `true` until something else
  re-derives it. Native promises always land through `asyncWrite`. Accepted
  rather than spend a third floor hook call on it.

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
