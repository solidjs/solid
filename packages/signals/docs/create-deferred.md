# Design: `createDeferred` — an async memo that may lag, but never leads

> Status: **proposal** (design agreed 2026-09-08, not started). Origin: a
> Discord report (2026-09-03) of independent dashboard panels sharing one
> global selection store, where every panel's commit waited on the slowest
> panel's fetch (20–200ms panels held hostage by 3–10s panels). Semantics
> below are settled; the implementation seams are sketched and the open
> questions are listed — the lane-independence rule (§8.1) is the one that
> decides whether this is configuration of existing machinery or new
> machinery. §9 records why this is a migration primitive, not a niche one:
> combined with `loadingValue` it is the per-node opt-out from coordination
> that 1.0 → 2.0 migrations currently lack.

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

| Hatch | What it does | Why it doesn't answer the report |
| --- | --- | --- |
| `latest(() => x())` | Per-read: never suspends, serves staged/committed | Per read-site — impractical at scale; one non-`latest` read of the chain re-entangles everything; **leads** the clock (§4.2) |
| `<Show when={!isPending(() => x())}>` | Unmounts the panel while pending; `transitionComplete` prunes its dead reporters | Works, but is fallback-shaped (loses DOM/state) and incidental — the user rediscovered "show a fallback on refetch" through a side door |
| `<Loading on={key}>` | Resets the boundary on key change; collects pending locally instead of joining the hold | The designed fallback affordance — right answer when a skeleton is acceptable, no answer when old content must stay visible |
| `createEffect(x, v => setMirror(v))` | User effects don't report pending (`notifyEffectStatus` only notifies for `EFFECT_RENDER`), so the transition completes without the mirror's consumers | Amputates the node: `isPending(mirror)` is always false, `refresh` can't reach the query, errors route to the effect's owner, laziness is lost (always-on subscriber), lands one flush late, first load must be hand-rolled |

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

If real usage shows people deferring every query in a panel and wanting the
ambient version, a `<Deferred>` boundary can be layered on later as sugar over
the node. The primitive underneath should be the node.

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

| | `latest(fn)` | `createDeferred(fn)` |
| --- | --- | --- |
| Grain | Read-site lens; leaves no node | Graph node with identity |
| Staged (held) values | Served — **leads** | Never served — **lags only** |
| Own async in flight | Serves committed stale | Serves committed stale |
| Machinery | `optimisticComputed` shadow per read source | One node; no per-read companions |
| Analog | `createOptimistic` for reads (unconfirmed frontier) | Confirmed-only counterpart |

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

| With | Behavior | Note |
| --- | --- | --- |
| `<Loading>` | Owns first load (node transparent while uninitialized). Never sees refetch pending from a deferred node. | Nesting order irrelevant. Inside a deferred consumer, Loading collapses to a pure first-paint concern and `isPending` is _the_ refetch affordance. |
| `<Loading on={key}>` | Reset re-shows fallback only when refetch pending _arrives_ — a deferred node's refetch never arrives. | Inert for deferred sources. Dev-warn, or treat key change as a hard reset that re-opens the uninitialized path ("tear on refetch, skeleton on key change"). Decision pending (§8.2). |
| `<Errored>` | Rejections propagate normally. | Deferred defers pending, not errors. |
| `<Reveal>` | Untouched — coordinates first reveals only. | |
| `createOptimistic` / `action` | Overrides visible to all ordinary readers (A17), so optimistic UI inside a deferred consumer works. A deferred panel does not hold an action's transition open. | The latter is the point. |
| `isPending` | Verdict-loud (§2.4). | `isPending(store.leaf)` through the §4.5 composition must see the memo's flight via leaf → firewall → memo (§8.3). |
| `latest` | Orthogonal; `latest(() => deferred())` is legal and pointless (nothing staged to lead with). | Eager tearing stays a deliberate per-read act with the loud name. |
| `until` / `refresh` | Edges intact, so both reach the node. `refresh(deferred)` re-asks; `until(() => deferred())` awaits the authoritative landing. | Confirm `until`'s authoritative-view read tunnels past the clamp (it must see the landing, not the stale). |

## 6. Implementation sketch

Seams, in order of confidence.

### 6.1 Read contract = a loading window that never closes

The loading window already implements the read side exactly:

```ts
// core/async.ts — handleAsync
if (el._loading) return el._value;                 // serve committed, no transition
globalQueue.initTransition(resolveTransition(el));
throw new NotReadyError(context!);

// core/core.ts — recompute catch
if (notReady && el._loading) parkLoadingWindow(el, e);   // register for settle,
// "NO read-visible pending status, no downstream propagation, no transition,
//  no lane registration — the committed loading value keeps serving."
```

Two differences from `loadingValue`: the window closes at the first real
answer (`el._loading = false` at every landing site) — deferred keeps it open
for every recompute after commit #0; and the window is verdict-quiet by
design — deferred must be verdict-loud. Concretely: a `CONFIG_DEFERRED` bit;
the landing sites that clear `_loading` leave it set when the bit is on (or
the checks become `_loading || _config & CONFIG_DEFERRED`); the uninitialized
first flight is _not_ windowed (the node starts `STATUS_UNINITIALIZED` like a
plain memo so §2.6 holds). The verdict side (§6.3) supplies the loudness.

Hot-path cost: `read()` must not learn a new branch. Keep the node's _public_
status clean — never `STATUS_PENDING` from a consumer's perspective — and carry
in-flight state where the verdict machinery already looks.

### 6.2 Landing schedule = the lane engine

A landing that arrives while an unrelated transition is active would be
adopted into it (`currentBatch = this._batch = activeTransition`) and held —
the panel becomes hostage to the theme's image loads. The existing escape is
the lane: companions (`_pendingSignal` is an `optimisticSignal`, latest
shadows are `optimisticComputed`) write through `optimisticWrite` →
`getOrCreateLane`, each lane carries its own transition, and "in unmerged
graphs, own-source resolution IS the lane-transition's completion, so the
correction reveals on arrival" (A18). `runLaneEffects` flushes lanes with
empty `_pendingAsync` while the main queues are stashed.

So a deferred node is `CONFIG_OPTIMISTIC`-shaped for its landings, with one
crucial difference from an override: the landing is _authoritative_ and must
elevate to `_value` on arrival, not sit as an `_overrideValue` that reverts.
Whether this is "an optimistic node whose override is always immediately
confirmed by itself" or a distinct lane-write path is an implementation
choice; the observable requirement is §2.3.

### 6.3 Verdict = existing companion path

`isPending` collects probe sources and reads each source's `_pendingSignal`
companion; `computePendingState` already classifies "own async in flight and
non-quiet" (A19 cause ii, A8) as pending. A deferred node in flight should
report through this path unchanged. The one thing to verify is that whatever
suppresses the loading window's verdict (§6.1, "verdict-quiet") is keyed on
the window, not on the served-committed read, so the deferred node is loud.

### 6.4 Module layout

`core/deferred.ts`: exports `createDeferred`; imports `optimistic.ts` (lanes)
and `verdict.ts`; installs any new hooks on `GlobalQueue` (`_deferredLanding?`
or similar) following the `optimistic.ts` pattern at its module bottom.
Re-exported from `signals.ts`. Facades: `packages/solid/src/server/signals.ts`
(`createDeferred = createMemo`-equivalent identity, mirroring `latest`);
`packages/solid/src/client/hydration.ts` if `createMemo` there needs a
hydration-aware twin (likely just delegation — nothing to serialize).

### 6.5 Constants

`CONFIG_DEFERRED` in `constants.ts`. Confirm remaining bit budget in
`BITWISE_OPERATIONS.md`.

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
  waiting for that transition (subject to §8.1).
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

## 8. Open questions

### 8.1 Lane independence (decides the whole cost)

A render effect that reads a deferred node **and** a transition-held source
(theme) is downstream of both the deferred lane and the main transition. Lanes
merge on graph overlap (`mergeLanes`). If that merge pulls the deferred lane
into the theme transition, D3 fails — the panel is hostage again. A14 already
gives companions an exemption ("child lanes that do not merge with the
owner's lane: an `isPending` effect fires while the owner's async is still
in flight"). The deferred lane needs the same standing: consumers reading it
alongside held sources must not merge it into their transitions. Whether
that is the existing companion rule generalized, or a new rule, is the
question that determines whether this is a small change or a medium one.
Reproduce first: deferred landing during a held theme transition, assert the
panel repaints with new data + committed (old) theme.

### 8.2 `<Loading on={key}>` under deferral

Inert (§5) or promoted to "hard reset re-opens the uninitialized path"? The
latter is genuinely useful (paginate → tear; switch entity → skeleton) but
means the deferred node must know about boundary reset propagation rather
than being a pure resolution trait. Lean: ship inert with a dev warning; add
the reset interplay if asked for.

### 8.3 `isPending` through the store composition

`isPending(() => store.items.length)` where the store derives from a deferred
memo: A9 says a leaf reports its firewall's refetch, but here the firewall is
never pending — the flight is one hop further up, in the memo. If the probe's
source collection walks leaf → firewall → memo it works for free; if not,
`isPending(rows)` is the fallback and the leaf form needs a small extension.
Test both forms.

### 8.4 `until` / `refresh` past the clamp

`until(() => d())` must resolve on the authoritative landing, not the served
stale value — the authoritative-view read path (`_notifyAuthoritativeObservers`,
A18 tunneling) is the precedent. `refresh(d)` should re-ask and be a quiet
re-ask (A24) if inputs are value-stable. Verify both.

### 8.5 Smaller

- Default `equals`: the source's own (inherit `NodeOptions`) — same as memo.
- Store / projection as the fn's return value: a memo returning a store
  reference is legal today; deferral doesn't change that but is also not
  meaningful for it (leaf pending routes through the returned store's own
  firewall). Document, don't special-case.
- A `<Deferred>` boundary later as sugar (§4.1) — only on usage evidence.
- `createMemo(fn, { deferred })` as a second surface — only if the option
  form is repeatedly asked for _and_ a way is found to keep the lane
  dependency out of the floor bundle.

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
