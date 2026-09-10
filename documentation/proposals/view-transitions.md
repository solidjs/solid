# PROPOSAL: View Transitions (`<ViewTransition>` boundary)

Status: PROPOSAL ONLY. Nothing in this document is implemented. Not a 2.0.0
gate — a 2.x fast-follow, internally gated (see "Gates" below), no longer
platform-blocked. Converged September 2026 from a design exploration of what
automatic View Transition support looks like in Solid 2.0. The design runs on
the stable Level 1 platform API (Chrome 111+, Safari 18+, Firefox in flight).
If the spike validates, Solid ships the only automatic view-transition
integration on *stable* browser APIs (React's requires their canary channel) —
a differentiator, not polish.

Related code this builds on (all shipped today):

- Scheduler / transition machinery: `flush`, `schedule`, `GlobalQueue` in
  `packages/signals/src/core/scheduler.ts`; transitions and optimistic writes
  in `packages/signals/src/core/action.ts`.
- Boundary reveal machinery: `CollectionQueue` / `createCollectionBoundary` /
  `createLoadingBoundary` in `packages/signals/src/boundaries.ts` — the
  per-boundary queue gating this design's detection and held commits rely on.
- Flow controls the component sits alongside: `Loading` / `Errored` / `Reveal`
  in `packages/solid/src/client/flow.ts`.
- Async model context: `documentation/solid-2.0/05-async-data.md`,
  `documentation/solid-2.0/01-reactivity-batching-effects.md`.

---

## Governing principle

**A view transition is a transition whose completion is animated.** The boundary does not create a new timing category — it flags that when this transition completes, the commit rides through the platform's animation machinery and lands one rendering opportunity later. All existing transition semantics (value application at completion, `flush()` behavior mid-transition, `isPending`, optimistic writes, interruption) apply unchanged. Users learn nothing new.

Corollary: since **every write is a transition** in 2.0, every commit is a transition completion — so the boundary needs only a *predicate* for which completions animate. Deferring a matched sync write's commit is not a new semantic: it is a transition that stays pending one frame, using the existing pending vocabulary (`isPending`, stash/restore, reads return old values across `flush()`) that users already have for every async write.

## Public API (one primitive, ever)

```tsx
// Sibling to Loading/Errored/Reveal; SSR entry is a passthrough no-op.
<ViewTransition name="hero" update="cross-fade" enter="slide-up" exit="fade-out">
  <Show when={selected()} keyed>{item => <HeroCard item={item} />}</Show>
</ViewTransition>

// Sync activation without actions: gate on explicit sources.
<ViewTransition on={tab()} update="cross-fade">...</ViewTransition>
```

- **Activation: a two-clause predicate, automatic.** (1) Default: two structural triggers, partitioned by whether a fallback participates. **(1a) Transaction settlement** — a pending transition's stash touches the boundary: the held-content morph (old content held, `isPending` true, swap on settle) and optimistic apply/revert. **(1b) `Loading` queue readiness flips within the boundary, both directions** — fallback reveal and fallback removal (first reveal, `on` reversion, post-reversion recovery). 1b is required because whenever a fallback actually displays, the transaction has *bailed out early* — committed immediately with the fallback — and the later reveal is a boundary-local `CollectionQueue` release with no settling transaction or stash in sight; settlement detection structurally cannot see it. Both triggers are structural (stash topology / queue state; no value reads), and mirror React's two documented triggers (Transitions *and* Suspense reveals — a Suspense reveal isn't a transition for them either). Sync transactions that never pend (e.g. typing inside the boundary) never animate and never defer. (2) `on`: explicit sync sources — a matched write's commit defers as a one-frame pending transition. Not gated on the `action` keyword: every write is a transition, so privileging one entry point would be arbitrary. No user-facing `startViewTransition`, no imperative VT API anywhere in the programming model (React exposes none either). The scheduler issues the platform call itself. Cost note: animating a fallback reveal means the fallback appears one frame later — inherent to animating it, applies only under a `ViewTransition`.
- **No required flow-control pairing, no replacement detection.** The trigger is commit-based (which commits touch the boundary's queue subtree), never DOM-structural — the scheduler never inspects whether a root element was replaced. `Show`/`Switch` are the natural pairing for enter/exit content but are not load-bearing: a `For` reorder, a text/attribute update from a settling action, any qualifying commit inside the scope animates. Enter/exit classification derives from named-element connectedness across the commit (old-only = exit, new-only = enter, both = update/morph), not from which flow control produced the change. Unnamed changes fall back to the platform default: a cross-fade of the boundary's root group.
- **Composition with `Loading`:** `<ViewTransition>` typically wraps the `Loading` boundary (so the fallback↔content swap is inside the animated scope). This is safe by construction: clause-1 detection is structural (1a checks whether the settling stash touches the boundary's queue; 1b intercepts readiness flips of descendant `Loading` queues — no reactive read of content values at the component level), and the component is *readiness-transparent* — it never propagates pending, or it would block the fallback beneath it. `on` is the only value-reading surface: it uses the guarded-tracking shape `createLoadingBoundary` already uses for its own `on` option — a not-ready read neither throws nor blocks; the pending→ready flip counts as the change, landing on the settling commit and degrading gracefully into clause-1 behavior. Docs note: `on` is for sync sources; async activation is automatic, so async accessors in `on` are harmless but redundant.
- `name`: `view-transition-name` for child elements (auto-generated if omitted); applied pre-snapshot, reverted post-`ready` to avoid duplicate-name failures.
- `enter`/`exit`/`update`: mapped to `view-transition-class`. `share`: same `name` removed in one subtree and inserted in another in the same commit morphs as a shared-element transition (commit-wide name registry).
- **Transition types** hang off action definitions — `action(genFn, options?)` is an additive optional parameter (actions aren't the activation gate, but they remain the only write entry point with *identity* to hang metadata on; React needs call-site `addTransitionType` because `setState` doesn't). Class props may accept `{ type: class }` objects for direction-aware variants.
- **No animation event props.** Animation timing is platform surface: the native `ViewTransition` object is reachable via `element.activeViewTransition` on the scope (`finished`/`ready` promises). If demand warrants convenience later: a single `transition={vt => ...}` prop exposing the native object — never an `onStart`/`onFinish` event family.
- **Unsupported browsers: skip the animation, commit immediately** — the ecosystem-wide consensus (SvelteKit, React, React Router, Nuxt; only Astro simulates and nobody followed). Real VT is unpolyfillable.

## Design point: why we ship no manual `startViewTransition`

Most prior-art frameworks ship a manual call (SvelteKit's `onNavigate` pattern, React Router's `viewTransition` prop, Nuxt's route option, Angular's `withViewTransitions()`), so declining to ship one is a deliberate position, not an omission. Five reasons:

1. **It adds a name, not a capability — uniquely for Solid.** `document.startViewTransition(() => flush(fn))` is complete in userland because `flush` is public and guarantees a full synchronous commit. The prior-art frameworks ship helpers because their users *cannot* do this themselves: React Router needs internal `flushSync` wiring; SvelteKit needed a new lifecycle hook (`onNavigate`) because the navigation commit moment wasn't otherwise reachable; none of them have a general-purpose "commit everything now" primitive to hand users. Solid is the one framework where the platform API is already directly usable. A blessed wrapper would be pure surface area.
2. **Manual can only reach half the problem, and it's the wrong half to bless.** A manual call covers only call-site-initiated sync commits. Async settlements — async computations resolving, action settlement, optimistic reconcile/revert — are scheduler-owned and unreachable manually *in principle* (by the time completion is observable, the old DOM is gone). A blessed manual API makes sync animation first-class while the async-first framework's signature features can't animate — and worse, it teaches users to restructure away from the async primitives (fetch-then-set) to get animations. Note also that manually wrapping a write whose downstream is async animates the wrong commit: the sync/optimistic part, not the settlement users actually want animated.
3. **The two-ways split is a documented hazard, not a hypothetical.** The one ecosystem with both models (React Router's manual prop + React's automatic component) treats their coexistence as a footgun — React's docs explicitly warn not to mix them, because both sides want to own the platform call (duplicate/skipped transitions). Shipping manual now and automatic later manufactures that situation deliberately, with the manual API becoming the deprecated way the ecosystem has already built on.
4. **Call-site wrapping is the pattern 2.0 explicitly removed.** `startTransition`/`useTransition` were cut in favor of transitions being implicit in the model. A manual VT call is the same viral shape: every code path that can trigger the update (button, keyboard handler, deep link) must remember to wrap, and a missed path animates inconsistently. The boundary declares intent once, where the content renders.
5. **The prior art, read carefully, supports this.** The frameworks that ship manual calls are navigation-scoped because the router commit is the *only* commit they can sequence — manual is their ceiling, not their choice. The only framework with an automatic tier (React) ships no manual API at all. And SvelteKit — the closest philosophical comparison — deliberately ships *no abstraction*, just a well-placed lifecycle point and documentation of the raw platform pattern: recipe over API, which is exactly our position.

What this costs, honestly: edge cases outside any boundary (one-off document-level effects, library authors) use the raw platform recipe instead of a framework export. That's one line of documented platform code, and it's the appropriate layer for them — the same reasoning as animation timing living on `activeViewTransition` rather than a framework hook. solid-router wrapping its own navigation commits internally is unaffected (implementation detail, no public surface).

## Worked examples

### Clause 1 — async settlement, zero config (the flagship case)

```tsx
import { createSignal, createMemo, Show, For, Loading } from "solid-js";
import { ViewTransition } from "@solidjs/web";

function Inbox() {
  const [selectedId, setSelectedId] = createSignal<string>();
  // 2.0: any computation may return a Promise; readiness flows through the graph.
  const message = createMemo(() => selectedId() && fetchMessage(selectedId()!));

  return (
    <div class="split">
      <ul>
        <For each={messages()}>
          {m => <li onClick={() => setSelectedId(m.id)}>{m.subject}</li>}
        </For>
      </ul>

      {/* No activation config. First load: the fallback reveal is a Loading
          queue release inside this boundary (trigger 1b) — animated.
          Subsequent selections: held content, settlement stash touches this
          boundary (trigger 1a) — animated. Typing/clicking elsewhere never
          activates it: sync transactions that don't pend never animate. */}
      <ViewTransition name="detail" update="cross-fade">
        <Loading fallback={<Skeleton />}>
          <Show when={message()} keyed>
            {msg => <MessageDetail msg={msg} />}
          </Show>
        </Loading>
      </ViewTransition>
    </div>
  );
}
```

What the user's code observes on click:

1. `setSelectedId(id)` — transition starts; `isPending` true; old detail stays on screen (existing 2.0 behavior).
2. Fetch resolves — scheduler sees the settling stash touches a VT boundary queue → defers the commit one rendering opportunity and calls `startViewTransition`. Reads still return the old message during this frame; `flush()` behaves as during any pending transition.
3. Old snapshot → callback commits the whole flush (values + DOM) → new snapshot → `onSettled` fires, `isPending` clears.
4. Cross-fade plays. Anyone needing animation end: `detailEl.activeViewTransition?.finished`.

Variant: add `on={selectedId()}` to the `Loading` boundary and subsequent selections revert to the skeleton while pending. Both flips are readiness changes of the `Loading` queue (trigger 1b) — note the transaction *bails out early* the moment the fallback commits, so neither the reversion nor the recovery is a transaction settlement; 1a alone would miss both. Content → skeleton → content is choreographed end to end, at the cost of the skeleton appearing one frame later.

### Clause 2 — sync source via `on` (no action, no async)

```tsx
function Settings() {
  const [tab, setTab] = createSignal<"profile" | "billing">("profile");

  return (
    <>
      <nav>
        <button onClick={() => setTab("profile")}>Profile</button>
        <button onClick={() => setTab("billing")}>Billing</button>
      </nav>

      {/* Plain sync write. When `tab` changes, that commit defers one frame
          (a one-frame pending transition — existing semantics) and animates.
          Form inputs inside don't match `on`, commit normally, never animate. */}
      <ViewTransition on={tab()} enter="slide-up" exit="fade-out">
        <Show when={tab() === "profile"} fallback={<Billing />}>
          <Profile />
        </Show>
      </ViewTransition>
    </>
  );
}
```

### Direction-aware variants — types from action identity

```tsx
// Proposed additive options parameter; types derive from the call's args.
const navigate = action(function* (to: string, dir: "back" | "forward") {
  yield* loadRoute(to);
}, { types: (to, dir) => [`nav-${dir}`] });

<ViewTransition
  enter={{ "nav-forward": "slide-in-right", "nav-back": "slide-in-left", default: "fade-in" }}
  exit={{ "nav-forward": "slide-out-left", "nav-back": "slide-out-right", default: "fade-out" }}
>
  <RouteOutlet />
</ViewTransition>
```

### The CSS side (plain platform CSS, no framework involvement)

```css
::view-transition-old(.cross-fade) { animation: fade-out 150ms ease-out; }
::view-transition-new(.cross-fade) { animation: fade-in 200ms ease-in; }

::view-transition-old(.slide-out-left) { animation: slide-out-left 200ms ease-in; }
::view-transition-new(.slide-in-right) { animation: slide-in-right 200ms ease-out; }

@media (prefers-reduced-motion: reduce) {
  ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) {
    animation: none !important;
  }
}
```

## Commit mechanism: delayed whole-commit

When a completing transition touches VT boundaries, extend the transition by one rendering opportunity and run the *entire* commit — stashed value application and all effects — via the platform call. 2.0 already holds value application for a transition's full duration (stash/restore); this extends an existing hold, not a new kind.

Timeline:

1. An animatable commit is due → defer it one rendering opportunity, call `startViewTransition`. Two structural detection points feed this: **(a)** a settling transition's stash touches a VT boundary's queue (held-content morphs, optimistic apply/revert), and **(b)** a `Loading` boundary's `CollectionQueue` inside a VT scope flips readiness — either direction. (b) exists because a displayed fallback means the transaction bailed out early (committed with the fallback); the eventual reveal is a queue release, not a settlement, so (a) can never see it. The VT queue is an ancestor of the `Loading` queue, so intercepting the release/disable is a walk up the queue tree. A fallback round-trip (content → skeleton → content) produces chained platform calls under the coalescing/skip policy.
2. Browser captures **old** state at the next rendering opportunity. Sync writes landing before capture commit immediately as normal and appear in the old snapshot — correct, they are genuinely pre-settlement. Controlled inputs never interact with the feature.
3. Callback runs the commit: **pure phase + render effects only** — framework-bounded work, because rendering is frozen from old capture until the callback resolves; app code stays out.
4. Browser captures **new** state; `updateCallbackDone` resolves.
5. **User effects (including `onSettled`) release on `updateCallbackDone`.** Reuses the existing `[render, user]` queue phases — redirecting `run(EFFECT_USER)`, not new taxonomy; matches React's mutation-inside / passive-after cut. `isPending` clears here. The deferred user queue must be release-gated so an event-driven flush landing in the sub-frame window doesn't drain it early.
6. Animation plays on the pseudo-elements; `finished` resolves (platform surface only).

Semantics that follow:

- **No frame exists where state and DOM disagree.** During the extension, reads and DOM both reflect pre-settlement state — indistinguishable from the transition taking one frame longer. `flush()` during the extension hits existing "transition not yet complete" semantics; no carve-outs, docs stay strong.
- **Settlement is after-snapshot, not after-animation.** Rationale: (1) animation duration is CSS-controlled — settlement gated on it would let styling edits change program timing; (2) the contract is "graph idle, DOM committed, inspectable" — focus/measure/attach should run while the animation plays (the new-side image is a live capture, so post-settle mutations render through); (3) mechanically, `updateCallbackDone` *is* after-snapshot.
- **User-effect writes start a fresh cycle** (new flush, possibly a new transition with platform skip semantics) rather than being absorbed into the in-flight one — absorption would let app code extend the render-paused window unboundedly. Docs note: animation-sequenced work belongs on `activeViewTransition.finished`, not `onSettled`.
- **Overlapping completions coalesce** into one platform call per commit window; a new transition during an active animation follows platform skip semantics.
- **No readiness policy of its own.** The boundary never waits for nested pending work before animating — it animates the commit Solid was already going to make, one frame later. Navigating into a view with still-pending `Loading` boundaries animates to the fallback state, then each reveal animates separately (trigger 1b) as data arrives. "Wait for everything" is expressed the same way as without animations: omit inner `Loading` boundaries so the transaction holds to a single settlement. An animated boundary must never render differently than an unanimated one.

Remaining costs: pre-commit affected-detection (the spike), document-global coordination until scoped VT is broadly usable, and one frame of settlement latency on animated transitions (inherent to capture).

## Cost model and tree-shaking

- **No tax without the component.** Core's only touchpoint is an interception check at *transition completion* (not per write/effect/flush phase), implemented as a null function-pointer slot: `if (vtInterceptor) ...`. The interceptor installs when the feature module is used — the existing `enableHydration()` pattern. Unused feature = one never-taken branch per transition completion.
- **With boundaries mounted:** the completion check consults the boundary registry (the spike's stash-touches-queue test); cost scales with boundary count per transition completion, not app size. Transitions touching no boundary commit exactly as today. The +1 frame applies only to commits that activate a boundary. `on` tracking is a computation owned by the boundary itself (mounts/unmounts with it).
- **Tree-shakeable:** component, coordinator, name management, and interceptor installation live in the `@solidjs/web` feature module — unimported means dropped means never installed. Core's residual footprint is the null slot and branch (the concrete form of the "keep transition completion interceptable" obligation). `action(genFn, options?)` types are inert unless passed.

## Platform target

- **Build on Level 1** (`document.startViewTransition`): Chrome 111+ (2023), Safari 18+ (Sep 2024), Firefox behind Nightly flag (144+ line). The only layer safe for public API.
- **Element-scoped VT as progressive enhancement**: Chrome/Edge 147 only (April 2026); Level 2 editor's draft; WebKit/Mozilla positions open; entry-point signature may still change (`element.startViewTransition()` vs `document.startViewTransition({ scope })`). Where available it upgrades to concurrent per-boundary animations; same code shape, no architectural dependence.
- **The async update callback is permanent**: synchronous capture was requested and declined ([csswg-drafts #9400](https://github.com/w3c/csswg-drafts/issues/9400)) — capture must run inside the rendering loop. The one-frame extension is the irreducible minimum, in every browser, forever.
- [csswg-drafts #12125](https://github.com/w3c/csswg-drafts/issues/12125) (`controlled` capture / `beginCapture()`/`endCapture()`): with delayed whole-commit, no longer load-bearing for Solid. Remaining value is ergonomic (callback inversion, promise plumbing, sync platform entry points like popover close / `popstate`). Non-blocking; watch or comment at leisure.

## Gates (internal, in order)

1. **Design call:** confirm the two-clause activation predicate — by default, (1a) transaction settlements touching the boundary *and* (1b) `Loading` queue readiness flips within it (both directions), plus (2) `on` for explicit sync sources (whose matched writes defer as one-frame pending transitions). Superseded framings: "actions-only" (wrong — every write is a transition; the `action` keyword is not the gate) and "settlements-only" (wrong — a displayed fallback means the transaction bailed out early, so every fallback reveal/removal, including the *first* reveal, is a queue release invisible to settlement detection).
2. **Spike:** affected-detection cost at both trigger points — (1a) at transition completion, before applying anything, determine whether the stash touches any VT boundary's queue; (1b) when a `Loading` `CollectionQueue` flips readiness, determine whether a VT queue is an ancestor (a parent-pointer walk) and defer the release drain rather than running it inline. Queue-organized stashes and the queue tree suggest both are cheap; this is the only place implementation could be uglier than the design. Also verify the null-slot interceptor pattern (`enableHydration()`-style) keeps the no-boundary path at a single never-taken branch.
3. **Release bandwidth** vs the 2.0 critical path — target a 2.0-line minor; the feature is fully additive.

Non-blocking watches: scoped VT second engine (upgrades the concurrency enhancement), Firefox L1 stable (marketing floor), #12125 (ergonomics only).

## 2.0 core obligations (passive) and forward compatibility

No 3.0 required — everything the boundary consumes is internal or additive:

- New component export alongside `Loading`/`Errored`/`Reveal`; `action(genFn, options?)` optional parameter.
- Internal precedents for held commits already exist twice: `CollectionQueue` gating effects for pending `Loading` subtrees, and `render()` withholding root DOM attach until uncaught async settles ([documentation/solid-2.0/08-dev-diagnostics.md](../solid-2.0/08-dev-diagnostics.md)).
- Event-handler `flush()` wrapping (performance experiments) is compatible — queue gating works regardless of flush trigger.

Obligations while the feature waits:

- Preserve per-boundary/queue gating and keep **transition completion interceptable** (the one-frame extension point) through any scheduler rework.
- Don't promise "settled means painted" in docs; `flush()` docs stay strong as-is ("transition not yet complete" already covers the extension).
- solid-router may integrate navigation transitions internally around commits it owns (no public API). The flush recipe — `document.startViewTransition(() => flush(fn))` — is a platform escape hatch, documented as such at most.

## Follow-ups

- `For`/`Repeat` per-row auto-naming (reorders animate positionally once rows carry names): **no compiler required** — naming needs the row's DOM node, not static analysis; `mapArray`'s stable per-row mapping + runtime node resolution provide identity and target (same capability refs use). But not trivial: (1) names must not be permanent — every named element is snapshotted by every containing transition, so the substance of the feature is lifecycle management (apply to registered rows pre-capture, name new rows post-commit, revert on `ready`) via a registry coordinated with the boundary; (2) single-element-root rows only (runtime-detected, dev warning otherwise); (3) opt-in per usage (`<For viewTransition>`-style), never automatic — snapshot cost scales with list length. Baseline: manual `style={{ "view-transition-name": ... }}` works today with the permanent-name over-snapshot caveat; the affordance is the lifecycle management users shouldn't hand-roll. Ships independently, later.
- Sibling-induced layout shifts (a boundary that *moved* because a neighbor changed) are not detected by dirty queues; React measures before/after. Ship as a known gap or measure later.

## Appendix

### Rejected designs (and why)

- **Public manual tier** (`startViewTransition(fn)` helper + helper-orchestrated boundaries): see "Design point: why we ship no manual `startViewTransition`" in the main body for the full rationale (userland-complete via `flush`, can't reach scheduler-owned async commits, two-ways split, call-site wrapping contra 2.0 philosophy, prior art read correctly).
- **Held-queue split commit** (apply state eagerly, hold only DOM effects): created a frame where reads and DOM disagree, requiring release-on-write carve-outs for `flush()` and controlled inputs. Entirely an artifact of splitting state from DOM; superseded by delayed whole-commit.
- **Pre-capture** (capture at action start to absorb the wait into the pending window): the capture-to-commit gap freezes the captured scope (snapshot pixels, dead interactions); the pending window is exactly the long gap platform guidance forbids.

### Why React needed automatic — and Solid does too, for async

React required reconciler integration because userland has no reliable synchronous commit, no access to enter/exit element lifetimes, and no capture atomicity under interleaving. Solid's `flush(fn)`, real DOM nodes, and atomic flushes solve all three — but only for commits the call site initiates. The shared fundamental: *a commit owned by the scheduler cannot be wrapped from outside.* React made everything scheduler-owned; Solid makes async scheduler-owned (async computations resolving, action settlement, optimistic reconcile/revert, `Loading` reveals). The manual workaround is opting out of the async primitives per interaction — untenable for an async-first framework.

Complexity Solid escapes regardless: fiber-diff change discovery (enter/exit is structural — boundary memo swap + dirty queue), concurrent-renderer lanes, gesture-driven transitions.

### Prior art

- **React `<ViewTransition>` (Canary)** — the only update-scoped precedent. `enter`/`exit`/`update`/`share`/`default` class props, `addTransitionType`, event callbacks; activates only for Transitions/Suspense/`useDeferredValue` (validates gated activation — plain writes never animate). Requires canary.
- **Astro `<ClientRouter />`** — navigation-scoped, MPA-first; `transition:name`/`animate`/`persist` directives; lone fallback-simulation shipper.
- **SvelteKit `onNavigate`** — deliberately no abstraction; users call the platform API around a navigation commit.
- **Vue/Nuxt** — no core integration; Nuxt experimental `viewTransition` on routes; community libs otherwise.
- **Angular** (`withViewTransitions()`) and **React Router v7** (`viewTransition` prop) — navigation-scoped wrappers.

Everyone except React scopes VT to the router; Solid's design covers the general case with the router case falling out of it.

### Key references

- [csswg-drafts #9400](https://github.com/w3c/csswg-drafts/issues/9400) — synchronous snapshots declined (why the one-frame extension is irreducible).
- [csswg-drafts #12125](https://github.com/w3c/csswg-drafts/issues/12125) — `controlled` capture proposal (ergonomic interest only, post delayed-whole-commit).
- CSS View Transitions Level 2 editor's draft — scoped VT, types, cross-document.
