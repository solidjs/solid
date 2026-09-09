# PROPOSAL: Image reveal gating ("Suspensey Images" for Solid)

Status: PROPOSAL ONLY. Nothing in this document is implemented. Drafted
2026-09-09 from a comparison of Brenly's `solid-books` demo
(https://solid-books.netlify.app) against `next-books.dev`, where the book
covers visibly appear together rather than popping in one by one. The goal is
to pin down what React is doing, what Solid already has, and the smallest
consistent design that closes the gap — for review before any code is written.

Related code this builds on (all shipped today):

- SSR reveal-gate runtime: `REPLACE_SCRIPT` in `packages/web/src/server.ts`
  (`$df`, `$dfs`, `$dfc`, `$dfg`, `$dfj`, `$dflj`). Stylesheet gating per
  fragment is emitted by `sink.fragment()`; nested propagation is
  `propagateBoundaryStyles`; entry kinds are described above
  `collectStreamStyles`.
- Client asset seam: `waitAsset` in `packages/web/src/client.ts`, used by
  `gateHeadResource` (`useHead` stylesheets warm as preload, then hold via
  `waitAsset`). Contract pinned in `packages/web/test/wait-asset.spec.tsx`
  and `use-head-css-gating-client.spec.tsx`.
- Boundary reveal machinery: `CollectionQueue` / `createCollectionBoundary` /
  `createRevealOrder` in `packages/signals/src/boundaries.ts`; `<Reveal>` in
  `packages/solid/src/client/flow.ts`.
- Head preloads: `useHead` (`packages/web/src/head.ts`, server + client
  entries) already supports `rel="preload" as="image"` with
  `imagesrcset`/`imagesizes`/`fetchpriority`.

---

## 1. What React actually does (verified 2026-09-09)

Source: `facebook/react` `main` — `packages/shared/ReactFeatureFlags.js`,
`packages/react-dom-bindings/src/server/fizz-instruction-set/ReactDOMFizzInstructionSetShared.js`,
PRs #32819, #32820, #33433; `next-books.dev` served HTML.

**Client (Fiber).** "Suspensey Images": a Transition or Suspense retry commit
waits until `<img>`s in the committing tree have decoded, capped at 500ms,
then commits everything at once. Sync updates never wait. `loading="lazy"`
and an `onLoad` handler opt an image out. The global flag
`enableSuspenseyImages` is still `false` on `main`; the behavior is enabled
only inside `<ViewTransition>` subtrees (#32820). `next-books` wraps
essentially the whole app in `<ViewTransition>`, so it gets it.

**Server / initial load (Fizz).** Entirely the inline instruction set; Fiber is
not involved. When the tree contains `<ViewTransition>`, Fizz ships
`revealCompletedBoundariesWithViewTransitions` as `$RV`. On boundary
completion:

1. `$RC` pushes into batch `$RB`. Batches are throttled (`FALLBACK_THROTTLE_MS
   = 300`, shortened near a 2300ms LCP target) so nearby completions reveal in
   one paint.
2. `$RV` applies `view-transition-name`s to exiting fallback elements and
   entering content, and collects `img[src]:not([loading="lazy"])` from the
   incoming content.
3. If any element received a name, `document.startViewTransition({ update })`.
   Inside `update`: swap, force layout, then wait on `document.fonts.ready`
   plus a `load`/`error` listener for every collected image that is not
   `.complete` **and is in the viewport**, raced against
   `SUSPENSEY_FONT_AND_IMAGE_TIMEOUT = 500`. The old snapshot stays on screen
   while it waits. Transitions serialize via `document.__reactViewTransition`.
4. No VT support or no names → plain reveal, no waiting. Images alone do not
   start a VT (open TODO in the source).

Two implementation details that matter for us:

- They use `load`, not `decode()`, because `decode()` promises do not settle
  while a view transition is pending (Chromium issue 420748301).
- Fizz streams boundary content into `<div hidden id="S:n">`, not
  `<template>`. Hidden elements still fetch images, so covers download from
  chunk arrival; the reveal only waits for the tail.

**What the demo does.** 28 covers: the first 10 are `next/image priority`
(head `<link rel="preload" as="image">`, no `loading="lazy"`); the other 18 are
lazy and excluded from gating. The grid has `vt-update="none"
vt-enter="auto"`, the skeleton `vt-exit="auto"`. So "all at once" = the
above-the-fold covers were in flight from the shell, and the VT reveal held
≤500ms for the visible ones.

## 2. What Solid has today

- **SSR gate for stylesheets, per fragment.** `$dfs(key, count, defer)` +
  `<link rel="stylesheet" onload="$dfc(key)">` emitted *outside* the
  `<template>` so they fetch on arrival; `$df` fires at count zero. Reveal
  groups compose (`$dfj` parks, `$dfg` releases). No timeout: a missing sheet
  is structural.
- **Client gate seam.** `waitAsset(promise)` throws `NotReadyError` while the
  promise is unsettled; boundaries and transitions hold and retry. Exported
  from the client entry only.
- **Cohesion.** `<Reveal order="together">` is explicit cross-boundary
  reveal coordination on both server and client.
- **Nothing produces image gates** on either side. `solid-books` streams the
  grid as one `$df` fragment with plain `<img>` tags: no lazy, no preload, no
  gate.

The structural difference from React: Solid has no commit phase. Content
under a pending `<Loading>` is not materialized (`CollectionQueue.run` holds
its effects while `_disabled`), and a transition's mutations are independent
effects. There is no single point to scan a finished tree, so an image can
only be observed *when it is created*. That is why any native solution is a
compiler + small-runtime change rather than a runtime scanner.

## 3. The principle

**The framework gates swaps, never first paint.** Assets a fragment or
boundary needs are warmed the moment they are discovered; the swap that would
show them holds until they are ready — bounded by a timeout for images,
unbounded for stylesheets. Shell content paints the way the browser paints
HTML. No hidden-content tricks; no JS in the first-paint path.

Consequences, stated so they are reviewed rather than discovered:

- *Data readiness decides shell-vs-stream (whether a fallback is ever shown);
  asset readiness decides when the swap happens.* The server never waits on
  an asset for the shell decision — it cannot observe client loads.
- Images outside the top-most boundary (or inside a boundary made blocking
  via `deferStream`) land in the shell and are **not gated**. The browser has
  no native render-block for images: `blocking="render"` on `<link
  rel=preload>` was implemented in Chromium and then removed from the spec
  (whatwg/html#7896 — "images typically appear in body and hence shouldn't
  have `blocking=render`"). React does not gate the shell either.
- The asymmetry with CSS (shell CSS *does* hold first paint) is the
  platform's: `<link rel=stylesheet>` in head is natively render-blocking.
  We inherit it; we do not paper over it.

## 4. Phase 0 — gaps that exist regardless (trivial)

1. Export a no-op `waitAsset` from the server entry (`index.server.ts`) so
   isomorphic code can import it. Today the client-only export breaks the SSR
   build of any component using it.
2. Document the interim userland recipe (client transitions only) in
   `documentation/solid-2.0/05-async-data.md`:

   ```tsx
   function Cover(props) {
     const img = (<img src={props.src} alt={props.alt} decoding="async"
                       loading={props.lazy ? "lazy" : undefined} />) as HTMLImageElement;
     if (isServer || sharedConfig.hydrating || props.lazy || img.complete) return img;
     const ready = Promise.race([img.decode().catch(() => {}), sleep(500)]);
     return createMemo(() => (waitAsset(ready), img));
   }
   ```

   Paired with `<Reveal order="together">` this gives the cohesive reveal on
   client navigation. It does nothing for the streamed first load.

## 5. Phase 1 — streaming image gate (server + compilers + runtime)

Mirror the stylesheet path exactly.

**Discovery.** Both compilers (`@solidjs/babel-plugin`, `@solidjs/compiler` —
parity is mandatory, shared test expectations) emit a registration call for
each *eligible* `<img>` in SSR output. Static `<img src="literal">` is a pure
string today, so this cannot be a runtime-only change. Eligible:

- has `src` or `srcset`;
- no `loading="lazy"`;
- not a child of `<picture>` (a preload cannot express source selection);
- if `srcset` uses `w` descriptors, `sizes` is present (the existing
  `registerAsset("preload")` validation already enforces this for head
  preloads — reuse it).

Registration attaches `{ src, srcset, sizes, crossorigin, referrerpolicy,
fetchpriority }` to the current boundary's asset set
(`tracking.currentBoundaryId`), beside the style entries. Dedupe by URL within
a fragment. Nested boundaries propagate like `propagateBoundaryStyles`.

**Emission.** In `sink.fragment()`, before the `<template>`:

```html
<link rel="preload" as="image" href="…" [imagesrcset="…" imagesizes="…"]
      [crossorigin referrerpolicy fetchpriority] onload="$dfc('key')" onerror="$dfc('key')">
```

one per image, counted into `$dfs`. Preload links are seen by the preload
scanner, so fetch starts on chunk arrival — earlier than React's hidden-div
approach — and it sidesteps the inert `<template>` entirely. When `$df`
swaps, the `<img>` resolves from cache.

**Runtime.** `$dfs` gains a timeout argument (or a sibling `$dfi(key, ms)`):
when armed, `setTimeout` force-drains the counter through the same release
path as a load (`_$HY.sc[key] = 0` → `$dfc` semantics → `$df`/`$dfg`).
Default 500ms, exposed as a render option. Stylesheets keep no timeout. Reveal
groups need no change: a timed-out member reads as zero.

**Shell.** Not gated (§3). Eligible shell images are *not* auto-preloaded:
over-preloading below-fold images on pages that never mark `lazy` is a real
regression risk and there is no gate benefit to offset it. Opt-in:
`fetchpriority="high"` on a shell `<img>` emits a head preload — reusing an
attribute authors already understand, symmetric with `loading="lazy"` as the
opt-out. `useHead` preload remains for anything more elaborate.

**Demo delta after Phase 1.** `loading="lazy"` past the first two rows,
`fetchpriority="high"` on the first row. Nothing else.

## 6. Phase 2 — client `<img>` producer (transition parity)

Same rule, same seam (`waitAsset`), same eligibility.

- **Dynamic `src`/`srcset`:** the compiler emits a dedicated helper instead of
  the generic attribute effect. Compute warms the image and calls
  `waitAsset(Promise.race([img.decode().catch(noop), timeout]))`; the effect
  applies the attribute. This is the "warm in compute" exception
  `gateHeadResource` already takes (idempotent, outside the reactive graph).
- **Static `src` in a template:** the compiler flags the template; the clone
  path registers the decode promise for its eligible images. Templates
  without images pay nothing. Note the throw site: template cloning happens
  in the (untracked) component body, so the `NotReadyError` surfaces in the
  enclosing computation — the same place `lazy()` throws. Verify this against
  `For` rows (mapArray roots) and `insert` holes.
- **Runtime paths** (`spread`, `Dynamic`, `h`, `html`): one `tag === "img"`
  branch in `assign`.
- **Skips:** `sharedConfig.hydrating` (content already visible),
  `img.complete`, `loading="lazy"`, presence of an `onLoad`/`on:load`
  handler (author owns the reveal).
- **Sync updates hold too.** Deliberate divergence from React, which cannot
  gate outside a Transition. `waitAsset` gates any tracked read, and holding
  an `<img>` swap ≤500ms until the replacement decodes is better UX than a
  blank frame — and it is what stylesheets already do. Pin in a test.
- `decode()` on the client; `load` on the server path. If the client swap is
  ever run inside a view transition, switch that path to `load` (Chromium
  `decode()`-under-VT bug).

## 7. Phase 3 — view-transition reveal (later; separate design)

Out of scope here; recorded so Phases 1–2 are checked against it. What a VT
buys React is a *post-layout, pre-paint window*: content is in the DOM and
measurable while the user still sees the old frame. That is what makes the
viewport filter and `fonts.ready` wait possible. Without it any post-insert
wait is visible, so our gate must sit before insertion and cannot know the
viewport.

A future `$df` variant that swaps inside `startViewTransition`, measures, and
waits only on in-viewport images composes on top of Phase 1: the preload gate
stays as the early-fetch and no-VT-browser baseline. It needs a
`<ViewTransition>`-class story for fallback/content naming first.

## 8. Decisions made explicit

| Decision | Position | Why |
|---|---|---|
| Timeout | 500ms for images, none for CSS; render option | Match React; CSS is structural |
| Shell images | Not gated; preload only via `fetchpriority="high"` or `useHead` | Browser owns first paint; avoid over-preload |
| Viewport filtering | No (Phases 1–2) | Impossible pre-insert; `lazy` + strict eligibility is the lever |
| Cross-boundary cohesion | `<Reveal>` only; no 300ms throttle heuristic | Explicit intent over timing |
| Sync updates (client) | Gate, ≤500ms | Consistent with `waitAsset`/CSS; better UX |
| Per-fragment cap | None | Timeout bounds harm; revisit with data |
| `<picture>` | Excluded | Preload cannot express it |
| Fetch mechanism (server) | Preload `<link>` with `onload`, not inline handlers on `<img>` | `<template>` is inert; scanner-visible; no per-`<img>` bytes; matches the stylesheet precedent (same CSP posture) |

## 9. Risks the author already sees

- **Bytes.** One `<link>` per eligible image duplicates the URL. Brotli
  handles repeats well, but a 100-image fragment with nothing marked lazy is
  100 links. Eligibility strictness and the `lazy` story are the mitigation;
  a cap was considered and rejected pending data.
- **Wait-on-everything.** Without viewport knowledge the gate waits on every
  eligible image in the fragment. The timeout bounds the harm; the UX
  regression case is a fragment where one below-fold image is slow and the
  author did not mark it lazy — content appears 500ms later than today.
- **Load ≠ decode on the server path.** Preload gives `load` (bytes), the
  `<img>` decodes after swap. Usually same-frame from cache; not React's
  client-side guarantee. Pin what we promise in a test.
- **Inline `onload` handlers** require CSP `'unsafe-hashes'` — already true
  for the stylesheet gate; this extends the surface, it does not create it.
- **Compiler parity.** Two compilers, one new emission. Shared expectations
  must cover every eligibility branch.
- **Throw site for static templates (Phase 2).** If the `NotReadyError` from
  a template clone lands somewhere that is not async-aware, the failure mode
  is an uncaught error, not a hold. Needs a test per creation context.

## 10. Acceptance gates

Server (`packages/web/test/server/`):
- Fragment with N eligible images emits N preload links before the
  `<template>` and `$dfs(key, N, defer, 500)`; `$df` fires on the Nth
  load/error.
- Timeout drains the counter and `$df` fires with images still pending.
- Excluded: `loading="lazy"`, `<picture>` children, `w`-descriptor `srcset`
  without `sizes`; URL dedupe within a fragment.
- Nested boundary propagation; reveal-group (`$dfj`/`$dfg`) interplay with a
  timed-out member.
- Shell `<img fetchpriority="high">` → head preload; other shell images →
  nothing.
- Byte-exact document snapshots updated with an audit note.

Client (`packages/web/test/`):
- Dynamic and static `src` hold a `<Loading>` until decode or timeout.
- Hydration and `complete` skip; `onLoad` opts out; `spread` path.
- Sync update holds ≤500ms (pinned as a decision).
- Static-template throw site under `insert` hole, `For` row, boundary root.

Compilers: shared expectations for Babel and Oxc output for every
eligibility branch.

Size: measure the web runtime delta (`$dfs` timer, client helper). The client
helper must be pay-for-use via import; templates without images must not
change output.

## 11. Explicit non-goals

- Gating the shell or first paint by any means.
- Viewport-aware waiting (Phase 3).
- Fonts (`document.fonts.ready`) — same window problem as viewport; Phase 3.
- Time-based cross-boundary batching (React's `$RB` throttle).
- A `<ViewTransition>` component or VT naming scheme.
- Changing the streaming payload from `<template>` to hidden elements.

## 12. Recommended order

Phase 0 immediately. Phase 1 as one PR (server + both compilers + runtime).
Phase 2 as a second PR. Phase 1 alone makes the demo look like Next's.
