# `solid-js` + `@solidjs/web` — size audit and decision (2026-10-05)

Branch `size/solid-web-audit` off `next` @ `ea5f1da07`. **Nothing here changes
an engine**; the one commit on the branch is this document. Companion
documents: `size-reduction-carve-step1.md` (the signals carve, #3774 — the
method: scenario suite, function-level attribution, structural vs incidental,
rulings-first), `sc-layer-audit.md` (the server-components layer, branch
`size/sc-audit` — the document shape this one matches and the source of the
exact-attribution tool), `size-reduction-audit.md` (the 2026-09-26 plan).

The question, in the maintainer's words: "Signals is in a good place and we
are working on frames — this seems like the other natural place. Look if
hydration is too large." The same app that costs 36.5 KB min / 12.81 KB br
rendered costs 52.4 KB / 17.65 KB hydrated: **+16.0 KB min / +4.8 KB br**
for hydrating. That delta is the first thing itemised to the function (§1).

**Answer in one paragraph.** Hydration is **not** the carve candidate the
signals core was. The +15,959 B min delta is 148 functions, every one of
them named here; **79 % of it (12.6 KB min / ≈ 3.9 KB br) is the plain
hydration tier a renderToStream app needs under the current rulings** — the
claim walk, id allocation, the serialized-value adoption, `<Loading>` resume
with the fragment ledger and truncation sweep, `lazy()` module assets. The
rest separates cleanly along seams the code already has: **≈ 1.5 KB min /
0.5 KB br exists only for server components or `live()`** (the live-source
takeover, the `_$HY.fr` ledger publication, `claimRoots`, the frames
exclusion in the gather), and **≈ 1.8 KB min / 0.55 KB br is the
async-iterable / hybrid stream adoption** a page with no stream source never
runs. The incidental share a rewrite would recover inside the plain tier is
**≈ 1.3–1.6 KB min (≈ 0.4 KB br)** — a dead protocol arm, a six-times
repeated asset gate, a property-interceptor seam, prod error prose, one
duplicated marker walk — and the 101 hydration rulings are 76 % pinned by a
spec (77 load-bearing, 13 weakly pinned, 11 unpinned). The carve's decision
rule — residue inside the hot paths — fires weakly: CSR carries ≈ 0.3 KB of
hydration residue, against the 2.9 KB the signals carve found inside
`recompute`/`read`. **The larger finding is outside hydration and outside the
scenario suite:** no `scripts/size` scenario compiles a template, so the DOM
attribute runtime is never measured for a plain app. Compiling a small
realistic app (§1.3) shows one element `{...props}` retains **6.9 KB min /
2.0 KB br** (web's spread/assign/className/style plus the merge/omit view
machinery in `@solidjs/signals` store/utils), a component spread
(`mergeProps`) **3.2 KB min / 0.86 KB br** more, **12.8 KB min / 3.7 KB br
together** — 25 % of that app's minified bytes and larger in brotli than the
whole hydration delta. Hello world also carries **1.9 KB min / 0.64 KB br of
event delegation** because `render()` registers the delegated root eagerly.
Recommendation (§6): **tiering plus targeted cuts, no carve** — move the
SC/live hooks into the frames client's install, key the stream-adoption
adapters on a server record (the SC audit's seam D), take the five cuts, add
a compiled-template scenario pair to the gate, and open the props-machinery
question (spread's reach into the view tables) as its own ruling. Expected
floors: hydrating 17.65 → **≈ 16.2–16.7 KB br**, compiled CSR −1.2 to
−1.8 KB br if spread gets a plain-object path, the hello-world floor 9.81 →
≈ 9.2 KB br only if delegation registration moves (with a realism caveat).

---

## 1. Scenario baseline

`node size.mjs --json` at `ea5f1da07`, local (macOS, Node 26.4, Rolldown
1.2.11). CI (Linux, Node 24, Size run 37352390215 at the same commit) reads
**identical bytes on every scenario**. `origin/next` moved to `c8aac88f9`
(`fix(compiler): preserve TSRX expression and comment spans`, compiler-only)
while this was measured; no runtime dist changed.

### 1.1 The shipped scenarios

| scenario                                                      | minified B |   brotli B | cap      | headroom | lazy (not counted) |
| ------------------------------------------------------------- | ---------: | ---------: | -------- | -------: | ------------------ |
| app: render + one signal (the simple-app floor)               |     27,597 |      9,811 | 9.83 KB  |       19 | —                  |
| app: CSR with Show/For/Loading/Errored/lazy                   |     36,478 |     12,815 | 12.82 KB |        5 | lazy-page 42 br    |
| app: hydrating (no stores) with Show/For/Loading/Errored/lazy |     52,437 | **17,648** | 17.66 KB |       12 | lazy-page 42 br    |
| app: hydrating + every store primitive family                 |     91,387 |     28,736 | 28.80 KB |       64 | lazy-page 42 br    |
| page: base server components                                  |    145,408 |     44,829 | 44.84 KB |       11 | decode.js 6,074 br |

**Per-package attribution, exact** (source map, `/tmp/sw-fn/fnmap.mjs` —
the SC audit's tool rebuilt against this worktree; the pieces sum to the
chunk on every scenario, 0 unmapped). `size.mjs`'s apportioned column is in
parentheses where it disagrees by more than 2 %.

| package (source map, exact)     |  floor |    CSR | hydrating (no stores) | hydrating + stores |       page base |
| ------------------------------- | -----: | -----: | --------------------: | -----------------: | --------------: |
| `@solidjs/signals`              | 20,711 | 28,424 |       29,620 (28,265) |             65,304 |          57,389 |
| `solid-js`                      |    113 |  1,264 |       12,377 (15,353) |             15,484 | 16,089 (18,273) |
| `@solidjs/web`                  |  6,640 |  6,656 |        10,306 (8,689) |             10,319 | 20,168 (18,989) |
| `@solidjs/web/frames`           |      — |      — |                     — |                  — |          38,989 |
| `@solidjs/web/server-functions` |      — |      — |                     — |                  — |          12,588 |
| scenario entry                  |    133 |    134 |                   134 |                280 |             185 |

Three things the shipped suite says about these two layers before any
function is named:

- **`solid-js` is 1,264 B in a CSR app.** The component model and flow
  controls are thin wrappers over `@solidjs/signals` (`Show` 282, `For` 187,
  `lazy` 320, `Errored` 104, `Loading` 94, `createComponent` 43); the
  machinery they stand on (`mapArray` 4,074, `boundaries.js` 3,053) is
  signals bytes. `solid-js`'s 12,377 B in the hydrating app is **one module:
  `client/hydration.ts`** (10,490 B of it).
- **`@solidjs/web` is 6,640 B in hello world and 6,656 in CSR** — the
  flow controls add nothing to web. Of the 6,640: the insert/reconcile family
  3,908 (`reconcileArrays` 1,381, `insertExpression` 822, `insert` 479,
  `cleanChildren` 311, `normalize` 305, `ownsAllChildren` 302,
  `removeOwnedChildren` 208, `appendNodes` 100), **event delegation 1,954**
  (`eventHandler` 1,009, `registerDelegatedContainer` 204,
  `unregisterDelegatedContainer` 196, `tagHost` 178, `findOwner` 122,
  `attachDelegatedEvent` 110, `unregisterDelegatedRoot` 78,
  `registerDelegatedRoot` 57), `render` 310, module scope 201, `isHydrating`
  191, `effect` 76.
- **No shipped scenario compiles a template.** The four `app:` fixtures are
  hand-written DOM (`document.createElement`) that return the flow
  components as values; none of them calls `template`, `setAttribute`,
  `className`, `style`, `spread`, `addEvent`, `delegateEvents`,
  `getNextElement` or `getNextMarker`. The attribute runtime is reached by
  exactly one scenario — `page: base`, through `dynamic()`'s string-tag
  branch (the SC audit's B.3, 9,862 B) — so the cost of the DOM runtime to a
  **plain** compiled app has never been on the gate. §1.3 measures it.

### 1.2 The headline: CSR → hydrating, itemised

**+15,959 B minified / +4,833 B brotli** (+43.7 % / +37.7 %) over 148
units: `solid-js` +11,113, `@solidjs/web` +3,650, `@solidjs/signals` +1,196
(the snapshot-scope, context and error pieces hydration pulls), entry 0.
Grouped by concern (minified, exact; brotli where a dist-copy variant
measured the group — §5 — otherwise at the delta's observed ratio 0.30):

| concern (Δ CSR → hydrating)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |      min B |                                                                                          br B (measured / ≈) | share |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------: | -----------------------------------------------------------------------------------------------------------: | ----: |
| **`<Loading>` resume, fragment ledger, truncation** — `hydratedCreateLoadingBoundary` 1,240, `rejectTruncatedRefs` 522, `resumeBoundaryHydration` 321, `waitAndResume` 291, `watchTruncation` 286, `markTruncated` 276, `initBoundaryResume` 271, `anyFragmentPending` 146, `scheduleResumeAfterAssets` 131, `fragmentParked` 127, `fragmentSuperseded` 125, `reportAssetFailure` 109, `fragmentPending` 102, `whenRevealed` 84, `fragmentPolicy` 81, `replayHeldFragment` 73, `createBoundaryTrigger` 72, `fragmentState` 58, `fragmentAbort` 54, `releaseFragment` 49, `subscribeFragments` 49, `claimFragment` 38 |  **4,511** |       **1,353 measured** (S-stream: the whole group + the ledger install) — of which truncation 314 measured |  28 % |
| **serialized-value adapters (signal / memo / effect / error boundary)** — `hydrateSignalLike` 596, `readSerializedOrCompute` 465, `normalizeIterator` 411, `hydrateSignalFromAsyncIterable` 367, `subFetch` 309, `wrapFirstYield` 255, `readHydratedValue` 214, `hydratedEffect` 203, `adoptedAnswerStream` 199, `hydratedCreateErrorBoundary` 190, `forwardIteratorReturn` 100, `hasLoadingWindow` 93, `hydratedCreateSignal` 76, `isAsyncIterable` 74, `withHydrationGate` 68, `MockPromise` 141 (five units), `hydratedCreateMemo` 53, `hydratedCreateRenderEffect` 39, `syncThenable` 37, wrappers 23            |  **3,921** |                                  ≈ 1,180 — of which the async-iterable / hybrid half **547 measured** (S-ai) |  25 % |
| **`hydrate()` entry** — `hydrate` 1,584 (inner: `cleanupFragment` 203, `captureBoundaryScope` 102, `has`/`load`/`gather` 83), `gatherHydratable` 332                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |  **1,916** |                                                                                                        ≈ 575 |  12 % |
| **sharedConfig lifecycle** — `enableHydration` 602 (inner: the `hydrating`/`done` interceptors `set` 112 + `get` 33, `hy.fe` fan-out 47), `drainHydrationCallbacks` 177, `isClaiming` 89, `onHydrationEnd` 88, `markTopLevelSnapshotScope` 87, `hydratedCreateRoot` 59, `isHydrationInProgress` 45, `checkHydrationComplete` 31, `createRoot` wrapper 6                                                                                                                                                                                                                                                              |  **1,184** |                                         ≈ 355 — of which the `_$HY.fr` publication **92 measured** (S-frpub) |   7 % |
| **claim walk & DOM adoption (web)** — `installHydrationRuntime` 532 (`reclaimRegion` 348, `claimInitial` 89, `dedupEvent` 76), `claimChildNodes` 181, `stripTextSeparators` 165, `isPlaceholderScaffolding` 116, `isHydrating` −4                                                                                                                                                                                                                                                                                                                                                                                    |    **990** | ≈ 300 — of which `claimRoots` + the frames exclusion **115 measured** (W-sc, with `gatherHydratable`'s loop) |   6 % |
| **signals core pulled by hydration** — `releaseSubtree` 158, `getContext` 121, `captureWriteSnapshot` 100, `clearSnapshots` 81, `ownerInSnapshotScope` 62, `setSnapshotCapture` 54, `releaseSnapshotScope` 33, `isDisposed` 32, `peekNextChildId` 31, `onCleanup` 28, `NoOwnerError`/`ContextNotFoundError` 48, `markSnapshotScope` 23                                                                                                                                                                                                                                                                               |    **771** |                                                                                                        ≈ 230 |   5 % |
| **module scope (solid)** — `sharedConfig` literal, `NoHydrateContext`, the `LIVE_*` registered symbols, the ledger maps (`_fragments`, `_truncated`, `_revealSubs`, `_truncationRejectors`), `openScopes`/`liveGates`/`nodeGate`, `latchedOnce`, `UNASKED`, the `MockPromise` IIFE shell, the slot variables                                                                                                                                                                                                                                                                                                         |    **597** |                                                                                                        ≈ 180 |   4 % |
| **`lazy()` lookup & module assets** — `loadModuleAssets` 312 (web), `lazyHydrationLookup` 258                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |    **570** |                                                                                                        ≈ 170 |   4 % |
| **live-source takeover (RFC 11 §9.5 client face)** — `armLiveTakeover` 155, `liveScopeOf` 105, `takeOver` 104, `releaseLiveScope` 71, `openLiveScope` 25, `TAKEN` 10 (+ the three arms inside `readSerializedOrCompute` and the `LIVE_*` symbols: the whole feature measures 914 min)                                                                                                                                                                                                                                                                                                                                |    **470** |                                                                           **287 measured** (S-live, 914 min) |   3 % |
| **signals (everything else)** — `read` +119, `setupComputedNode` +82, `signal` +57, `core/error.js` +52, 40 units of ±1–13 B (the hydrating scenario's slightly different call graph re-minifies shared code)                                                                                                                                                                                                                                                                                                                                                                                                        |    **425** |                                                                                                        ≈ 130 |   3 % |
| **DOM runtime: insert / reconcile, hydration arms** — `insertExpression` +275 (the claim-pass arm, the phantom-node check, the #3749 stay-put arm), `insert` +112 (`claimInitial`/`reclaimRegion` call sites), `normalize` −1                                                                                                                                                                                                                                                                                                                                                                                        |    **386** |                                                                                                        ≈ 115 |   2 % |
| **id allocation & keys** — `hydrationGetNextContextId` 129, `noHydrationId` 45                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |    **174** |                                                                                                         ≈ 50 |   1 % |
| **events** — `eventHandler` +36 (the `dedupEvent` call)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |     **36** |                                                                                                            — |     — |
| **render entry / flow / component model**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |          8 |                                                                                                            — |     — |
| **total**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **15,959** |                                                                                                    **4,833** |       |

The full 148-row table is Appendix A. Read top-down: **the boundary/stream
machinery and the value adapters are 53 % of the delta**; the entry and
lifecycle 19 %; the walk 6 %. Nothing on the list is a surprise feature —
every row maps to a numbered ruling in §3.

### 1.3 A compiled app (new measurement, not on the gate)

Because the suite never compiles a template, a small realistic app was
compiled with the built Babel plugin (`/tmp/sw-fn/compiled/app.jsx`: a todo
list with a class object, a style object, delegated `onClick`/`onInput`, a
non-delegated `on:focus`, an `<input value>` binding, a `ref`, one element
spread `<button {...props.buttonProps} disabled>`, one component spread
`<Item {...item} toggle>`, text holes, `Show`/`For`/`Loading`/`Errored`/`lazy`)
in `dom` and `hydratable` modes and bundled through `bundle.mjs` with the
same aliases:

| scenario (`/tmp` only)                                 | minified B | brotli B | signals |   solid |    web |   app |
| ------------------------------------------------------ | ---------: | -------: | ------: | ------: | -----: | ----: |
| compiled: CSR app                                      |     51,898 |   17,498 |  35,430 |   1,259 | 13,279 | 1,930 |
| compiled: hydrating app (same app through `hydrate()`) |     69,271 |   22,694 |  36,615 |  12,382 | 18,201 | 2,073 |
| Δ CSR → hydrating                                      |    +17,373 |   +5,196 |  +1,185 | +11,123 | +4,922 |  +143 |

Two findings the shipped suite cannot see:

1. **The hydration delta on a compiled app is +17.4 KB min / +5.2 KB br**,
   not +16.0 / +4.8: the hydratable walk helpers (`runHydrationEvents` 588,
   `getNextElement` 226, `setProperty` 198 — DOM mode writes `el.value = v`
   directly, hydratable routes it through a helper so the write can be
   skipped during the walk — `getNextMarker` 182, `getHydrationKey` 42) and
   the app's own compiled output growing by ≈ 10 % (`getNextElement`/
   `getNextMarker` destructures, `scope()` wrappers, `runHydrationEvents()`
   calls). The solid side is byte-identical to the scenario's (+11,123 vs
   +11,113).
2. **Props are the DOM runtime's biggest line item.** Scenario CSR →
   compiled CSR is +15,420 B min, of which the app is 1,930 and the runtime
   13,490: web +6,623 (`spread` 805, `assignProp` 787, module-scope attribute
   tables +790, `className` 651, `style` 423, `collectProps` 282,
   `setAttribute` 280, `classListToObject` 266, `addEvent` 261, `pushEntry`
   260, `assign` 242, `readShallow` 207, `flattenClassList` 170,
   `collectTable` 160, `collectSources` 155, `setAttributeNS` 141, `create`
   140, `delegateEvents` 111, `template` 110, `setStyleProperty` 86,
   `applyRef` 71, `entryHas`/`entryGet` 136, `ref` 48, `resolveSource` 49)
   and **signals +7,006 — all of it `store/utils.js`** (`merge` 1,020,
   `sourceDescriptor` 464, `get` 413, `mergeLookup` 397, `collectTable` 369,
   `omitTable` 341, `collectKeys` 324, `tableDescriptor` 287, `mergeTable`
   220, 40 more). `spread` reads a source through the merge/omit **view
   records** (`viewOf`, `OmitView`, `resolvedTable`, `sourceKeys`,
   `sourceHas`, `sourceGet`, `hasStaticKeys` via `solid-js/internal`), so
   one `{...props}` on an element retains the view machinery whether or not
   the app ever calls `mergeProps`. Measured on edited copies of the compiled
   output (§5.3): the element spread alone **6,852 min / 2,017 br**, the
   component spread (`mergeProps`) alone **3,197 / 856**, both **12,825 /
   3,680** — the shared view tables land on whichever goes last.

---

## 2. Function-level attribution of `solid-js` and `@solidjs/web`

**Method.** `/tmp/sw-fn/fnmap.mjs` bundles a scenario exactly as
`bundle.mjs` does but with a source map, walks every mapped segment of the
minified entry chunk and charges its bytes to the innermost _named_ function
of the dist source (acorn; class methods, `const f = () =>`, object-literal
methods and assignment targets are named; anonymous closures roll up). The
pieces sum to the chunk exactly on all seven scenarios (five shipped + the
two compiled). Source files were recovered by declaration lookup
(`/tmp/sw-fn/group.mjs`); the concern map is `/tmp/sw-fn/concerns.mjs`.

### 2.1 By concern, `solid-js` + `@solidjs/web` only (minified B, exact)

| concern                                                                  |     floor |       CSR |  hydrating | hyd + stores |  page base |
| ------------------------------------------------------------------------ | --------: | --------: | ---------: | -----------: | ---------: |
| hydration: `<Loading>` resume, fragment ledger, truncation               |         0 |        22 |      4,533 |        4,541 |      4,541 |
| DOM runtime: insert / reconcile                                          |     4,086 |     4,092 |      4,478 |        4,486 |      4,475 |
| hydration: serialized-value adapters (signal/memo/effect/error boundary) |        40 |        79 |      4,000 |        4,008 |      4,008 |
| hydration: entry (`hydrate()`, gather)                                   |         0 |         0 |      1,916 |        1,916 |      1,916 |
| DOM runtime: events & delegation                                         |     1,776 |     1,781 |      1,817 |        1,819 |      2,189 |
| hydration: sharedConfig lifecycle / `enableHydration` / end callbacks    |        20 |        20 |      1,204 |        1,228 |      1,222 |
| hydration: claim walk & DOM adoption (web)                               |       191 |       195 |      1,185 |        1,186 |      1,997 |
| flow controls (`Show`, `For`, `Errored`, `Loading`, `narrowedError`)     |         0 |       700 |        699 |          701 |        700 |
| module scope (solid)                                                     |        53 |        79 |        676 |          684 |        693 |
| render entry & module scope (web)                                        |       587 |       588 |        598 |          600 |      2,556 |
| hydration: `lazy()` lookup & module assets                               |         0 |         0 |        570 |          570 |        570 |
| hydration: live-source takeover                                          |         0 |         0 |        470 |          471 |        471 |
| component model (`createComponent`, `lazy`)                              |         0 |       364 |        363 |          364 |        364 |
| hydration: id allocation & keys                                          |         0 |         0 |        174 |          174 |        216 |
| hydration: store adapters (only when a store primitive is imported)      |         0 |         0 |          0 |        3,055 |      2,815 |
| SC-only (`materializeContainerTrace`)                                    |         0 |         0 |          0 |            0 |        843 |
| DOM runtime: attributes / props / spread / `dynamic()` / style / class   |         0 |         0 |          0 |            0 |      6,681 |
| **`solid-js` + `@solidjs/web` total**                                    | **6,753** | **7,920** | **22,683** |   **25,803** | **36,257** |

Context (`getContext` 121) and the snapshot-scope primitives are signals
bytes and sit in §1.2's "signals core pulled by hydration" row; `mergeProps`
/ `splitProps` / `children` are not in any shipped scenario (`mergeProps` is
`@solidjs/signals`' `merge`, re-exported — §1.3).

### 2.2 Top 20 units, `solid-js` + `@solidjs/web`, hydrating (no stores)

|   # | unit                                                                                                                                                                                                                          | package | concern                   | min B |
| --: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------- | ----: |
|   1 | `hydrate` (inner: `cleanupFragment` 203, `captureBoundaryScope` 102, `has` 32, `load` 31, `gather` 20; outer 1,196 — the head-prelude move, the `_assets` preload flow with its two `render` arms, the sharedConfig installs) | web     | entry                     | 1,584 |
|   2 | `reconcileArrays` (`isLive` 70)                                                                                                                                                                                               | web     | insert / reconcile        | 1,381 |
|   3 | `hydratedCreateLoadingBoundary` (`afterAssets` 24, `resumeFresh` 12, `resumeRejected` 12)                                                                                                                                     | solid   | boundaries                | 1,240 |
|   4 | `insertExpression`                                                                                                                                                                                                            | web     | insert / reconcile        | 1,101 |
|   5 | `eventHandler` (`handleNode` 249, `walkUpTree` 79, `retarget` 65, `currentTarget.get` 28)                                                                                                                                     | web     | events                    | 1,045 |
|   6 | module scope, solid                                                                                                                                                                                                           | solid   | module scope              |   666 |
|   7 | `enableHydration` (`set` 112, `hy.fe` 47, `get` 33)                                                                                                                                                                           | solid   | lifecycle                 |   602 |
|   8 | `hydrateSignalLike` (`detect` 35, `flip` 17)                                                                                                                                                                                  | solid   | adapters                  |   596 |
|   9 | `insert`                                                                                                                                                                                                                      | web     | insert / reconcile        |   591 |
|  10 | `installHydrationRuntime` (`reclaimRegion` 348, `claimInitial` 89, `dedupEvent` 76)                                                                                                                                           | web     | claim walk                |   532 |
|  11 | `rejectTruncatedRefs` (`sweep` 370)                                                                                                                                                                                           | solid   | boundaries (truncation)   |   522 |
|  12 | `readSerializedOrCompute`                                                                                                                                                                                                     | solid   | adapters                  |   465 |
|  13 | `normalizeIterator` (`next` 337, `return` 32)                                                                                                                                                                                 | solid   | adapters (async iterable) |   411 |
|  14 | `hydrateSignalFromAsyncIterable` (`next > then` 85, `next` 32, `return` 29)                                                                                                                                                   | solid   | adapters (async iterable) |   367 |
|  15 | `gatherHydratable`                                                                                                                                                                                                            | web     | entry                     |   332 |
|  16 | `resumeBoundaryHydration`                                                                                                                                                                                                     | solid   | boundaries                |   321 |
|  17 | `lazy` (`wrap` 143, `load` 81)                                                                                                                                                                                                | solid   | component model           |   320 |
|  18 | `cleanChildren`                                                                                                                                                                                                               | web     | insert / reconcile        |   312 |
|  18 | `loadModuleAssets`                                                                                                                                                                                                            | web     | lazy / assets             |   312 |
|  20 | `render`                                                                                                                                                                                                                      | web     | entry                     |   309 |
|  20 | `subFetch` (`window.fetch` 24)                                                                                                                                                                                                | solid   | adapters (trace run)      |   309 |

Next ten: `normalize` 305, `ownsAllChildren` 302, `waitAndResume` 291,
`watchTruncation` 286, `Show` 282, `markTruncated` 276, `initBoundaryResume`
271, `lazyHydrationLookup` 258, `wrapFirstYield` 255, `readHydratedValue` 214. All 105 units of the two packages in this scenario are Appendix B.

### 2.3 The DOM attribute runtime (page base and the compiled CSR app)

Not reached by the plain scenarios; on `page: base` through `dynamic()`
(`dynamic` 960, `spread` 812, `assignProp` 787, `className` 651,
`runHydrationEvents` 588, `style` 423, `collectProps` 282, `setAttribute`
280, `classListToObject` 266, `addEvent` 261, `pushEntry` 261, `assign` 242,
`getNextElement` 226, `readShallow` 208, `createElement` 205, `staticDynamic`
182, `flattenClassList` 170, `collectTable` 160, `collectSources` 155,
`setAttributeNS` 141, `delegateEvents` 111, `staticElement` 102, `bindingOf`
90, `applyRef` 71, `entryHas`/`entryGet` 136, `resolveSource` 49, `ref` 48,
`getHydrationKey` 42, module-scope tables +1,957 — the `Properties`,
`ChildProperties`, `Aliases`, `DelegatedEvents`, `Namespaces` sets from
`constants.ts`); on the compiled CSR app the same set minus `dynamic`'s own
pieces, 6,623 B of web plus 7,006 B of `signals/store/utils.js` (§1.3).

### 2.4 What the compilers emit vs what `@solidjs/web` exports

Thirty JSX fixtures compiled with both compilers in `dom`, `hydratable` and
`ssr` modes (`/tmp/sw-fn/compiler-helpers.md`, `.json`): the two compilers'
helper sets are **identical on 68 of 69 outputs**. Across the matrix the
compilers import **38 distinct names** from `@solidjs/web` (29 DOM-side
including the four builtIn re-exports `For`/`Show`/`Portal`/`Dynamic`, 11
SSR-side; `scope`/`mergeProps`/`For`/`Show` on both), plus 7 reached only by
extra probes (`getNextMatch` for a document shell, `getFirstChild`/
`getNextSibling` in dev, `ssrSelectValues`, `ssrClaim`, `sharedConfig`,
`ssrStyleProperty`). **Hydratable mode adds exactly five DOM helpers**:
`getNextElement` (every template root), `getNextMarker` (every hole beside
siblings), `runHydrationEvents` (a root carrying a delegated event or a
spread), `setProperty` (`value`/`checked`/`innerHTML`/`textContent`, direct
property writes in DOM mode) and `scope` (hole accessors that can allocate
ids); delegated events switch from the `_$$click` property form to
`addEvent(el, "click", fn, true)`.

`dist/web.js` exports **122 names; 80 are emitted by nothing**. Classified:
public user API (`render`, `hydrate`, `isServer`, `isDev`, `dynamic`,
`clientOnly`, `Hydration`, `NoHydration`, `useHead`, `registerElementClaim`,
`claimElementTree`, the `response.ts` helpers, cookies, `RequestContext`,
`httpStatus`/`httpHeader`); builtIn re-exports the fixtures did not use
(`Errored`, `Loading`, `Switch`, `Match`, `Repeat`, `Reveal`); runtime
internals exported for sibling packages (`assign`, `dynamicProperty`,
`untrack` — `@solidjs/h`; `registerDelegatedRoot`/`unregisterDelegatedRoot`
— `@solidjs/element`; the four `registerDelegatedContainer` family members —
`Portal`; `getHydrationKey`, `installHydrationRuntime`, `acquireAsset`,
`warmAsset`, `waitAsset`); server-mock stubs so isomorphic imports resolve
(`renderToString`, `renderToStream`, `createRequestEvent`, the `ssr*` family,
`generateHydrationScript`, `HydrationScript`, `takeHydrationValue`,
`getHydrationWriter`, `getRequestEvent`, `getTraceContext`); the constants
tables (`ChildProperties`, `DOMElements`, `DOMWithState`, `DelegatedEvents`,
`SVGElements`, `MathMLElements`, `VoidElements`, `RawTextElements`,
`Namespaces` — consumed by `@solidjs/h`, `@solidjs/html` and `dynamic()`);
and **two dev-only helpers exported from the production artifact**
(`getFirstChild`, `getNextSibling` — emitted only under `dev && hydratable`;
in prod their `_SOLID_DEV_` body folds to a one-line accessor). Export
surface costs nothing once tree-shaken; the list matters for §6.3's
contract, not for bytes. **Candidates it does surface:** `getFirstChild`/
`getNextSibling` as exports of `web.js`; `assign`/`dynamicProperty`/`untrack`
exported only for `@solidjs/h`.

**Parity finding (not a size item).** `<template>` with children: Babel
compiles it (`template(\`<template><div>…\`)`); the native compiler rejects it
("The HTML provided is malformed … Browser HTML: `<template></template>`")
because its validator's serializer drops template `.content`where parse5's
keeps it. Both compile a childless`<template>`. The native refusal is the
safer behaviour (the runtime's `template()`walks`firstChild`, which would
not descend into `.content`), but the two must agree.

The 1.x attribute namespaces are gone as compiler concepts: `use:`, `on:`,
`oncapture:`, `attr:`, `bool:`, `class:`, `style:`, `classList` all compile
to `setAttribute(el, "<literal>", v)`; only `prop:` is special. `class={{…}}`
object literals compile to inline `classList.toggle`, so `className` is
reached only through `spread`/`assignProp` and non-literal class values.

### 2.5 Coverage of the two layers by the client suites

`vitest --coverage` (v8), three suites (`/tmp/sw-fn/coverage-report.md`,
`covjoin.mjs`): the web hydrate suite (49 files, 275 tests, pass), the web
client suite (122 files, 1,139 pass + 1 expected fail), the solid suite (41
files, 818 pass; 1 failure — `cross-package-fields.spec.ts` needs
`packages/universal/dist`, which the filtered turbo build does not produce:
environmental, not a code failure). The web suites load `solid-js` as the
built `solid.dev.js`, so solid's hydration coverage is reported on the dist
(function names survive) and on the source from solid's own suite.

| file                                           | functions covered | branches covered | notes                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------- | ----------------: | ---------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/src/client.ts`                            |           147/168 |      1,054/1,318 | uncovered functions with bytes on the hydrating bundle: **`removeOwnedChildren` 208** (the "foreign nodes present" arm of a markerless clear — late-flushed stylesheet links at the end of `<body>`; no test reaches it); dead in tests but reached by compiled apps: `flattenClassList` 170, `setAttributeNS` 141, `claimElementTree` |
| `web/src/index.ts`                             |             48/51 |            91/99 | `staticDynamic` inner arrows                                                                                                                                                                                                                                                                                                           |
| `web/src/render.ts`, `reconcile.ts`, `head.ts` |               all |          88–93 % |                                                                                                                                                                                                                                                                                                                                        |
| `solid/dist/solid.dev.js` (web suites)         |           238/295 |          594/752 | the uncovered 57 are server-face exports (`ssr*`, `runInServerComponentScope`, …) and `quietAnswer`                                                                                                                                                                                                                                    |
| `solid/src/client/hydration.ts` (solid suite)  |           165/219 |          489/666 | `quietAnswer` **0 hits in every suite** (202 B, with-stores bundles only — the promise-shaped quiet run a hybrid store's handoff would take if the source changed shape between the trace and the handoff run)                                                                                                                         |

**Dead-by-construction bytes in `app: hydrating (no stores)`: 208 B**
(`removeOwnedChildren`); **in the with-stores bundle 410 B** (+`quietAnswer`).
The rest of both layers is reached by at least one test.

**One protocol arm is alive only in hand-crafted unit tests.** In
`hydratedCreateLoadingBoundary` the "sync SSR path: `ctx.serialize(id, …)`"
branch — a boundary whose **own** id carries an object record (`{s:1}` →
hydrate straight through, `{s:2}` → gather, a pending promise →
`waitAndResume(p, resume, assetPromise)` with `hydrateRejected = true`) — is
hit 18/0/22 times by `solid/client-hydration.spec.ts` ("Loading boundary:
already-serialized settled ref", and tests that set `_$HY.r[id]` to a
promise), **0 times by the web hydrate suite**, whose 15 artifact-driven
files replay real server output. The server writes a boundary's own id in
exactly one shape: the string `"$$f"` (`packages/solid/src/server/
hydration.ts` lines 508, 543, 570, 632); a pending or settled boundary
streams under `id_fr`. The arm (≈ 250 B min incl. `waitAndResume`'s
default-true parameter) is a protocol the server stopped emitting, pinned by
tests that construct it by hand — a ruling, not a deletion, decides it (§7).

Uncovered-branch hot spots: `eventHandler` 21/69 missed (resume-node,
shadow-DOM and portal re-targeting arms), `assignProp` 15/57, `setAttribute`
10/22, `runHydrationEvents` 7/14 (the multi-container innermost-first sort is
never exercised — ruling #48's unpinned clause), `hydratedCreateLoadingBoundary`
12/74 (the `"$$f"` + assets arm, the `s===2` fragment arm's asset variants,
the superseded arm's asset variants — all asset-gating permutations),
`readSerializedOrCompute` 3/26 (the `LIVE_LOCAL` arm — frames only),
`enableHydration` 6/16 (`hy.f` already installed, `hy.fe` pre-existing).
Two more worth naming because they sit on the hydrating hot path: `hydrate()`'s
post-preload _success_ deferred-render arm has 0 hits in every suite (only the
preload-failure arms are tested), and `isHydrating`'s `claimRoots` loop is
entered 3× but its `contains` test is never true — the nested `"/"` depth
lines of `reclaimRegion` are likewise never hit. Neither is dead by
construction; both are unpinned.

---

## 3. Rulings inventory — what client hydration guarantees

Numbered one-sentence statements in the L2 rulings' voice, each with the
mechanism that carries it today (`file:function`, lines at `ea5f1da07`) and
its pin: **Load-bearing** — a spec title names the rule; **weakly pinned** —
a spec reaches the path but no title names it; **unpinned** — only code, a
comment, a doc sentence or a PR body asserts it. `[SC-only]` marks
machinery no plain `hydrate()` app reaches; `[SC clause]` a plain-app
statement carrying a clause only server components exercise; `[dev-only]`
`_SOLID_DEV_`/`IS_DEV`-gated behaviour. Files: `H` =
`packages/solid/src/client/hydration.ts`, `C` = `packages/web/src/client.ts`,
`I` = `packages/web/src/index.ts`, `R` = `packages/web/src/render.ts`, `CO`
= `packages/solid/src/client/component.ts`, `F` =
`packages/solid/src/client/flow.ts`, `S` = `packages/web/src/server.ts`
(protocol producer), `FR` = `packages/web/frames/src/client.ts` (the SC
consumer). Sources: `documentation/solid-2.0/{12-ssr-http,05-async-data,
03-control-flow,07-dom,11-server-components,08-dev-diagnostics,MIGRATION}.md`;
every `describe`/`it` title under `packages/web/test/hydration`,
`lifecycle-matrix`, the hydration-touching client specs and
`packages/solid/test` (`/tmp/sw-fn/spec-titles-hydration.txt`); the 146
`__artifacts__` through `harness/hydration-records.ts`; PR/issue bodies
#3749 #3770 #3771 #3671 #3666 #3504 #2917 #2919 #2883 #3540 #3609 #3567
#3574 #3571 (`/tmp/sw-fn/pr-bodies-hydration.txt`); the issue numbers cited
in the sources (list at the end of this section).

### 3.1 Claim walk & markers

1. **A compiled template under hydration resolves its root by `_hk` key lookup in the per-root registry — never by cloning — and records the claimed node in `sharedConfig.completed`.** — `C:getNextElement` 2332–2373 over the registry `C:gatherHydratable` 2975–3014 builds (`querySelectorAll('*[_hk]')`, renderId-prefix scoped). **Load-bearing**: `hydration/parity-harness` › "hydration parity harness — client hydrate" (141 scenario runs asserting no key misses); `hydration/document-shell` › "hydrating the island subtree claims nodes and stays reactive"; `welcome-status-loaded`/`-streamed` › "the adopted fill claims the server nodes with no key misses".
2. **A registry miss falls back to a fresh, detached template instance (`template(true)`, bypassing the dev shell guard) so the render completes; the miss is reported only in dev.** — `C:getNextElement` fallback arm. **weakly pinned**: parity-harness spies `console.warn` for the miss text; `hydration/eager-jsx-falsy-show` (#3163) reaches the detached path.
3. **[dev-only] A claimed node whose `tagName` differs from the template root warns.** — `C:getNextElement` under `_SOLID_DEV_`. **Load-bearing**: `hydration/diagnostics` › "warns on tag mismatch between claimed node and JSX template", "no tag mismatch warning when tags match".
4. **A fragment/expression hole is bounded by `<!--$-->`…`<!--/-->`; `getNextMarker` depth-counts nested pairs, returns the end comment as the insert marker and the enclosed nodes as the claim array.** — `C:getNextMarker` 2382–2401. **Load-bearing**: `hydration/show-fallback` › "Show inserts before following sibling after hydration", "Show with fallback inside div (component-returned fragment)".
5. **Server `<!--!$-->` text-hole separators are removed from the DOM at claim time so adjacent text nodes stay individually claimable; `<template id="pl-*">`/`<!--pl-*-->` scaffolding is excluded from claim arrays but left in the DOM for the later `$df` swap (#2936).** — `C:claimChildNodes` 1350–1366, `C:stripTextSeparators` 1329–1343, `C:isPlaceholderScaffolding` 1371–1375, installed via `C:installHydrationRuntime.claimInitial`; producer `S` 5991–6139. **Load-bearing**: `hydration/text-node-adoption` › "server text hole beside an element is adopted, then updated in place"; `hydration/loading-fallback-reactive-text` › "#2936 — fallback updates while the boundary is pending".
6. **A text hole adopts the server text node (reuses it, later writes `data`) only when the previous node is itself hydrating (`isHydrating(prev)`); a detached eager subtree is never adopted and hydrates fully initialised (#3163).** — `C:normalize` 2855–2883; `C:insertExpression` string arm. **Load-bearing**: `text-node-adoption`; `hydration/eager-jsx-falsy-show` › "#3163: eager JSX hidden by an initially false <Show>" (2).
7. **A raw primitive inside a claimed array is a failed text claim; the mismatch recovers on the first reactive update.** — `C:insertExpression` primitive-in-array arm. **Load-bearing**: `hydration/text-node-adoption` › "claim mismatch (element where text expected) recovers on first update".
8. **Phantom-render protection: while hydrating, `insertExpression` on a parent that is not a hydrating node returns `current` untouched — the claim pass never mutates DOM it does not own.** — `C:insertExpression` early `isHydrating(parent)` arm; `C:isHydrating` 2515–2537. **weakly pinned**: reached by every hydrate spec and `hydration/onsettled-hydrate`; no title names it. The arm's comment names the adopted-fill shape — **[SC clause]** in motive, plain in mechanism.
9. **Nodes already in their parent stay put: a late `lazy()` module resolving over SSR nodes under `<Loading>` must not remove and re-insert them (focus survives) (#3749).** — `C:insertExpression` #3749 arm. **Load-bearing**: `hydration/loading-lazy-resume-3749` (3 titles).
10. **A sole child of `0`/`NaN` claimed from server text is dropped when the hole later becomes an element (#3571).** — `C:insertExpression` sole-child arm. **Load-bearing**: `hydration/hydrate-falsy-sole-child-issue-3571`.
11. **When a `$df` swap replaces a hole's region while its bookkeeping still points at removed nodes, the runtime re-claims the live region (parent children, or the marker-bounded range) so text matches positionally again.** — `C:installHydrationRuntime.reclaimRegion` 1284–1306. **Load-bearing**: `hydration/insert-refresh-drift` › "insert `current` tracking across hydration (#2801 bug 1)" (2); `hydration/refresh-hmr-stream` › "HMR swap between the $df reveal and the hydration resume leaves no orphaned server DOM".
12. **Attribute, property, class and style bindings write nothing during hydration: the server markup is authoritative and pre-hydration user state (`value`, `checked`, selection) is preserved (#3179, #3180, #3182, #3189, #2957).** — `C:setProperty` 587–605, `C:setAttribute` 715–744, `C:className` 757–805, `C:style` 853–902, `C:setStyleProperty` 937, `C:assignProp` 2571–2626 (incl. 2609 `else if (isHydrating(node)) return value; // TODO IS this correct?`). **Load-bearing**: `hydration/style-adoption` › "#3180: style bindings during hydration" (5); `hydration/stateful-input-adoption` › "#3182: stateful DOM properties during hydration" (5).
13. **`className` under hydration still seeds `node._$classes` from the bound value so post-hydration object-class diffs compute against the server state (#3189).** — `C:className`. **Load-bearing**: `hydration/class` › "updates an object value after an in-place mutation".
14. **`spread` under hydration skips the same DOM writes but still installs handlers/refs, and a reactive spread update after hydration keeps `innerHTML` content (#2737, #3388, #3105, #3297).** — `C:spread` 1000–1081. **Load-bearing**: `hydration/spread-innerhtml` › "#2737: spread + innerHTML across hydration". Handler clause **weakly pinned**.
15. **`isHydrating(node)` is true only when `sharedConfig.hydrating`, the owner is inside the current claim window (`isClaiming()`), and the node is connected — or [SC clause] descends from a declared `sharedConfig.claimRoots` range.** — `C:isHydrating` 2515–2537; `H:isClaiming` 248–256. **Load-bearing**: `solid/hydration-root-snapshot-scope-3504`, `hydration/onsettled-hydrate`; the claimRoots clause **[SC-only]** pinned by `hydration/adopted-claim-args-address`.
16. **[dev-only] `getFirstChild`/`getNextSibling` validate walk structure and warn with a `describeSiblings` rendering; in prod they are raw DOM accessors.** — `C:getFirstChild`/`getNextSibling`/`describeSiblings` 2403–2463. **Load-bearing**: `hydration/diagnostics` › "Phase 2: Walk validation" (5).
17. **`getNextMatch(el, tag)` skips non-matching siblings so parser-inserted wrappers do not derail the positional walk.** — `C:getNextMatch` 2376; emitted for `<html>`/`<head>`/`<body>` shells. **unpinned** in the hydration corpus (compiler snapshot tests only).

### 3.2 Id allocation & keys

18. **Hydration ids mint at creation time via `sharedConfig.getNextContextId` and must reproduce the server counter path; with no owner the call throws, under `NoHydrateContext` it yields `undefined`.** — `H:hydrationGetNextContextId` 224–229; `C:getHydrationKey` 3017. **Load-bearing**: `solid/id-parity` (12 titles).
19. **The server stamps `_hk=<id>` on every template root; the client registry is scoped by the `renderId` prefix so island renders and multi-root pages do not collide (#3000).** — `S:ssrHydrationKey`; `C:gatherHydratable` (`key.startsWith(root)`). **Load-bearing**: `hydration/document-shell` › "async island: serialized reactive values adopt by id under the island namespace"; `hydration/multi-root-registry`.
20. **`transparent: true` computations — and `render.ts` `effect` unless `scope: true` — consume no id slot; `render.ts` `memo()` is NOT transparent (#3033).** — `R:effect`/`R:memo`; `H:noHydrationId` 798–801. **Load-bearing**: `solid/client-hydration` › "transparent effect runs live and consumes no hydration id slot"; `solid/id-parity` › "transparent memo does not consume a child-id slot (client)".
21. **An id-less owner (null owner, or owner without an id) takes the transparent path: computes live, consults no registry, shifts no sibling id, logs nothing (#3609).** — `H:noHydrationId` and every facade's early check. **Load-bearing**: `solid/hydration-null-owner-3609` (14); `hydration/null-owner-3609` (4).
22. **`<For>` builds its `mapArray` eagerly while hydrating so the list's id slot is spent at source position; outside hydration creation stays lazy (#3161).** — `F:For` 98–106. **weakly pinned**: parity-harness `for-list` scenarios reach it.
23. **`<Portal>` consumes exactly one id slot (`createOwner`) and its anchor memo uses `ssrSource:"client"` + `loadingValue: undefined` so it serializes nothing and never mismatches (#2876, #2981).** — `I:Portal` 130–230. **weakly pinned**: parity-harness portal scenarios.
24. **`dynamic()` allocates three memos (factory / value / render) — one extra owner id per instance relative to a plain call — and an async source adopts exactly one hydration record per instance; a sync source serializes nothing (#3666, #3671).** — `I:dynamic` 404–509. **Load-bearing**: `hydration/dynamic-async-loading-3666` (3 runs); `frame-nonlive-document-3666-*` (5); PR #3671.
25. **String-tag `dynamic()`/`staticElement` claims via `getNextElement` and calls `runHydrationEvents`, so events queued on it replay (#3386).** — `I:staticDynamic` 515, `I:staticElement` 537–558. **Load-bearing**: `hydration/dynamic-hydration-events` › "#3386: dynamic() replays events queued during hydration".
26. **`createUniqueId()` returns the hydration context id while hydrating so generated ids match the server markup.** — `CO:createUniqueId` 220–223. **unpinned** in this corpus.
27. **Refresh-runtime `$$component` registration under an id-carrying owner consumes no hydration child ids (#2920).** — refresh runtime over `H:isHydrationInProgress`. **Load-bearing**: `solid/refresh-hydration` (4).
28. **`clientOnly` spends exactly one id (its gate memo) on both faces; the loaded component swaps in ownerless via `onHydrationEnd`.** — `I:clientOnly` 648–713. **Load-bearing**: `hydration/client-only` › "hydrates the fallback without mismatch, then swaps the loaded component in".
29. **Compiled conditionals (ternary / IIFE memo) consume one child id per condition level identically on both faces; the `observedComponent` dev wrapper is id-transparent.** — `H:hydratedCreateMemo` + compiler output. **Load-bearing**: `solid/id-parity` › "ID Parity: ternary conditional memos" (7), "observedComponent transparent wrapper" (3).
30. **JSX passed through a non-children prop takes the same id slot on server and client (#3567).** — compiler predicate (Babel/Oxc), verified under `hydrate()`. **Load-bearing**: `hydration/slot-hydration-3567` (18 scenarios).
31. **Cross-face counterpart: server async retry paths reset owner child ids so the client's single pass matches (#2900).** — `packages/solid/src/server/*`. **Load-bearing**: `solid/server/async-retry-child-reset` (5). (Server-side; listed because 18 depends on it.)

### 3.3 `sharedConfig` lifecycle

32. **Only `hydrate()` calls `enableHydration()` and `installHydrationRuntime()`; a CSR bundle that never imports `hydrate` shakes every hydration facade, walk hook and the fragment ledger (#2883).** — `C:hydrate` 2178–2180; `H:enableHydration` 1840–1937; `C:installHydrationRuntime` 1265–1318. **unpinned**: #2883 and code comments; the size suite (`app: CSR` vs `app: hydrating`) is the only assertion — and it holds: CSR carries 191 B (`isHydrating`) + ≈ 100 B of null-slot guards.
33. **If `_$HY.done` is already true, `hydrate()` degrades to `render()` over the existing child nodes.** — `C:hydrate` 2181. **unpinned**.
34. **Every `hydrate()` root installs its own `registry`/`gather`; `boundaryScopes` is created once and shared so a boundary resuming after another root started claims against the root it registered under (#2917).** — `C:hydrate` 2225–2241; `H:initBoundaryResume` (`captureBoundaryScope`). **Load-bearing**: `hydration/multi-root-registry` › "root A's late resume claims against A's registry after root B hydrated"; `solid/multi-root-hydration` (2).
35. **`_pendingBoundaries` is not zeroed when a second root starts: hydration is globally done only when every root's boundaries resumed, and disposing a pending root releases its count instead of holding hydration open (#2917).** — `H:enableHydration` hydrating setter 1900–1911; `H:initBoundaryResume` disposal release. **Load-bearing**: `solid/multi-root-hydration` (2 titles).
36. **Completion runs once (`drainHydrationCallbacks`): clear snapshots, disable capture, `flush()`, run `onHydrationEnd` callbacks, then on a macrotask run `verifyHydration` (dev), set `_$HY.done = true` and clear the registry.** — `H:drainHydrationCallbacks` 327–342. **Load-bearing**: `hydration/diagnostics` › "orphan detection fires automatically via drainHydrationCallbacks"; `solid/client-hydration` › "onHydrationEnd callbacks fire after snapshot cleanup".
37. **Completion is checked only when the root's synchronous pass is over AND no boundary is pending — a write that ends hydration early would misclaim a still-pending boundary.** — `H:checkHydrationComplete` 344–348. **Load-bearing**: `hydration/nav-before-resume` › "shell nodes recompute on the write, pending boundaries resume, hydration ends once", "ending hydration at the write misclaims a still-pending boundary".
38. **The root pass runs under a snapshot scope marked before its first child: signal writes during the pass (`onSettled`, `createEffect`) are held until release (#3504).** — `H:markTopLevelSnapshotScope` 258–266; `H:hydratedCreateRoot` 1725–1734. **Load-bearing**: `solid/hydration-root-snapshot-scope-3504` (3); `solid/client-hydration` › "Snapshot Hydration" (5).
39. **When the root pass ends, the shell's live nodes release (`releaseLiveScope`) even while boundaries are still pending (D8); a node under a boundary releases when that boundary hydrates.** — `H:enableHydration` setter 1912–1919. **Load-bearing**: `solid/hydration-latch`; `solid/client-hydration` › "a live node in the shell reconnects when the root pass ends, before a slow boundary lands", "a live node under a boundary reconnects when that boundary hydrates, not when the page does".
40. **Public `isHydrating()` reports the claim window (true in the root pass, false after, per-boundary during a streamed resume); `isHydratable()` is positional (false under `<NoHydration>` or with no owner).** — `H:isHydrating` 293, `H:isHydratable` 310. **Load-bearing**: `solid/hydration-state-api` (3).
41. **`onHydrationEnd(cb)` runs `cb` on a microtask when not hydrating and otherwise queues it for completion; the refresh runtime optional-chains `isHydrationInProgress` to defer HMR swaps during a streamed resume (#2919).** — `H:onHydrationEnd` 318–325, `H:isHydrationInProgress` 272. **Load-bearing**: `hydration/refresh-hmr-stream` (4).
42. **`sharedConfig.hydrating`/`done` are defined properties: false→true resets done flags and arms snapshot capture; true→false releases the root scope and checks completion; `done=true` drains.** — `H:enableHydration` 1894–1936. **weakly pinned**: every hydrate spec passes through; no title.
43. **[dev-only] After completion, `verifyHydration` warns listing still-connected unclaimed `_hk` nodes.** — `C:hydrate` 2243–2255. **Load-bearing**: `hydration/diagnostics` (2 titles).
44. **Registry-inserted `data-dh` head metas (charset/base prelude) at the front of `<head>` are moved to the end before any claim so positional head reads align (#3081).** — `C:hydrate` 2182–2199. **Load-bearing**: `hydration/document-shell` › "useHead prelude ahead of shell-authored head children hydrates whole document (#3081)".
45. **Stylesheet reveal gating in `useHead` is skipped while `sharedConfig.hydrating` — the server already gated the paint.** — `C:gateHeadResource` 2009–2026. **Load-bearing**: `hydration/document-shell` › "useHead stylesheets: loading sheets neither halt hydration nor resume a gated fragment early".
46. **Delegated events are root-owned: `hydrate()`→`render()` registers the container so handlers resolve per root and a disposed root unregisters.** — `C:render` 367, 394, 402. **weakly pinned** in the hydration corpus (delegation specs live in the client suite).

### 3.4 Events before hydration

47. **The server bootstrap `_$HY={events:[],completed:new WeakSet,r:{},fe(){}}` captures the configured event types (default `click`, `input`) at the nearest `_hk` ancestor before any client module runs; the records script must precede the client entry.** — `S:generateHydrationScript` 5657–5664; doc `12-ssr-http.md`. **weakly pinned**: `hydration/dynamic-hydration-events` exercises replay; the ordering rule is doc-only.
48. **Queued events replay on a microtask once their target is in `completed`, stop at the first uncompleted target (ordered), replay innermost delegated container first, and release `events`/`completed` once `done`.** — `C:runHydrationEvents` 2466–2512. **Load-bearing**: `hydration/dynamic-hydration-events` › "a click queued before hydration reaches the handler". Innermost-first and release clauses **unpinned** (the `matches` sort has 0 hits).
49. **A replayed event is deduped against a live dispatch of the same event object (`dedupEvent`), so a pre-hydration click never fires twice.** — `C:installHydrationRuntime.dedupEvent` 1310–1316; `C:eventHandler` 2629. **unpinned**.
50. **Event bindings (`addEvent`, spread handlers) are the one binding class not suppressed during hydration: they attach to claimed nodes immediately.** — `C:addEvent` 813; `C:spread`. **weakly pinned**: parity-harness click assertions after hydrate.

### 3.5 Serialized values — the signal and store adapters

51. **A function-form compute (`createMemo`, `createSignal(fn)`, `createOptimistic(fn)`, `createProjection`, `createStore(fn)`, `createOptimisticStore(fn)`) adopts the serialized value at its id instead of running; value forms pass through unwrapped; without hydration every facade delegates to core.** — `H:readSerializedOrCompute` 512–579; `H:hydrateSignalLike` 1365–1488; `H:hydrateStoreLikeFn` 1528–1699; `H:hydratedCreateMemo/Signal` 1490–1498. **Load-bearing**: `solid/client-hydration` › "createOptimistic Hydration" (5), "createProjection Hydration" (4), "createStore(fn) Hydration" (5), "createOptimisticStore(fn) Hydration" (2).
52. **Records are `{s:1,v}` (settled) / `{s:2,v}` (rejected) stamps or bare values; nullish payloads adopt rather than recompute (#2914); a rejected stamp rethrows; an observed rejection is reported once (#2997).** — `H:readHydratedValue` 474–496. **Load-bearing**: `solid/client-hydration` › "Nullish serialized values (#2914)" (5).
53. **A pending record (thenable) is adopted as the async source; inside a loading window (`loadingValue`/`seedLoadingValue`) it serves commit #0 through the pass and lands when it arrives, without holding hydration end.** — `H:readHydratedValue` thenable arm; `H:hasLoadingWindow` 702. **Load-bearing**: `solid/hybrid-memo-handoff` › "a pending answer under loadingValue serves commit #0 through the pass and lands when it arrives"; `solid/hybrid-store-handoff` › "hydration end is not held by a pending server answer, and the answer still lands after it".
54. **`ssrSource:"server"` (default) and `"hybrid"` read the registry; `"client"` never does — with a declared `loadingValue` it serves commit #0 through the pass, bare it is unasked (`UNASKED`, a never-settling thenable) and computes once the gate flips.** — `H:UNASKED` 612; `H:withHydrationGate` 1353; doc `05-async-data.md`. **Load-bearing**: `solid/client-hydration` › "ssrSource client modes" (3 describes, 10 titles), "bare ssrSource 'client' — unasked through the gate, computes after" (6), "ssrSource 'client' + loading window — verdict-quiet through hydration" (2).
55. **Adopt-and-latch: an adopted non-iterable answer does not re-run the client compute until a dependency changes; a dependency write while latched re-runs at hydration end (`latchedOnce` divergence arming, "server" mode only).** — `H:latchedOnce` 509; `H:readSerializedOrCompute` 552–579. **Load-bearing**: `solid/client-hydration` › "latched divergence — mid-stream dependency changes commit at hydration end" (3); `solid/hybrid-store-handoff` › "hybrid store — non-iterable shapes latch: identical to 'server' (maintainer ruling)" (6).
56. **The adoption trace runs the compute with `Promise` and `fetch` mocked (`MockPromise`, `subFetch`) to learn its shape and track its reads without issuing requests; `Promise.withResolvers`/`Promise.try` are covered; a deserialized or foreign iterable is never pulled.** — `H:MockPromise` 398–419, `H:subFetch` 421–455. **Load-bearing**: `solid/client-hydration` › "adoption trace — Promise statics" (2), "the adoption trace does not pull an iterable it did not construct (a deserialized stream)", "the adoption trace does not open a foreign iterable whose iterator() connects".
57. **Live-branded sources (`LIVE_SOURCE`) take over automatically: adopt, then re-run the live compute at scope release with `LIVE_RESUME_FROM` naming the adopted value; unbranded computes keep adopt-and-latch; a later islands pass arms its own takeover.** — `H:LIVE_SOURCE/LIVE_RESUME_FROM/LIVE_LOCAL` 624–641; `H:takeOver` 589–597; the gates 659–699. **Load-bearing**: `solid/client-hydration` › "live-branded sources — automatic takeover" (10). [SC clause] `LIVE_LOCAL` (the document's answer with no serialized record, 529–549) is reached only by frames. The whole feature is reached only by `live()` sources — a server-function transport concept.
58. **Hybrid async-iterable handoff follows five rules: (1) wait for the first server answer to land; (2) only the handoff run's first yield is the duplicate; (3) a rejected server answer is the adopted answer until `refresh()`; (4) a dependency change before landing supersedes the server answer and drops its late rejection; (5) the handoff opens no pending window (#2993, #3498, #3574); (6) it arms only for an async-iterable source — sync and promise shapes are "server".** — `H:adoptedAnswerStream` 947–972, `H:wrapFirstYield` 865–893, `H:quietAnswer` 901; store side `H:createShadowDraft` 803; the two handoff bodies `H:hydrateSignalLike` 1417–1481 and `H:hydrateStoreLikeFn` 1550–1695. **Load-bearing**: `solid/hybrid-memo-handoff` (15), `solid/hybrid-store-handoff` (28), `hydration/hybrid-memo-handoff` (8 runs), `hydration/hybrid-store-handoff-3574` (4 runs).
59. **Server async-iterable payloads: the first yield hydrates, buffered yields conflate to the latest, a terminal `done` never clobbers the last yield (#3060), live yields apply one at a time, and disposal forwards `iterator.return()`.** — `H:normalizeIterator` 717–765; `H:hydrateSignalFromAsyncIterable` 974–1030. **Load-bearing**: `solid/client-hydration` › "Async Iterable Hydration — createMemo" (7), "— buffered multi-yield replay" (8), "Promise-of-AsyncIterable Hydration — createMemo".
60. **Store adapters hydrate from a snapshot that replaces the seed wholesale (#2948), park the patch backlog past the hydration pass via `onHydrationEnd`, then apply ONE conflated update; `Repeat`/`For` claims survive buffered replay.** — `H:hydrateStoreFromAsyncIterable` 1032–1207; `H:applyPatches` 767. **Load-bearing**: `solid/client-hydration` › "Async Iterable Hydration — createProjection" (5), "— createStore(fn)" (3), "store buffered backlog: hydration pass sees first-yield state, then ONE conflated update"; `hydration/buffered-projection-repeat` (3).
61. **`createErrorBoundary`/`<Errored>` render the fallback from a serialized error exactly once, pass through when none exists, and `reset` recovers to live behaviour; nested boundaries resolve by id.** — `H:hydratedCreateErrorBoundary` 1500–1522. **Load-bearing**: `solid/client-hydration` › "Error Boundary Hydration" (13); `solid/public-boundary-exports`.
62. **`createEffect`/`createRenderEffect` adopt the serialized value at their id — effects spend an id slot on both faces unless transparent.** — `H:hydratedEffect` 1739–1767. **Load-bearing**: `solid/client-hydration` › "non-transparent effect adopts the serialized value at its id".
63. **`takeHydrationValue(id)` is take-and-remove: a resolved value, a thenable that settles with the record, or `undefined`; `getHydrationWriter` is undefined on the client.** — `C:takeHydrationValue`; doc `05-async-data.md`. **Load-bearing**: `web/take-hydration-value` (4).
64. **A compute under a pending boundary (`_hp` ancestor) defers to that boundary's resume instead of reading the registry during the root pass.** — `H:readSerializedOrCompute` `_hp` check; `H:initBoundaryResume` marks `_hp`. **weakly pinned**: `hydration/write-before-resume`, `nav-before-resume`.
65. **Pre-shell pending stubs batch into one `_$HY.r.$B` write and a spreader task files them under their real keys — the client never observes `$B`.** — `S` 2212–2245; consumer `C:hydrate` `sharedConfig.load/has`. **weakly pinned**: `harness/hydration-records.ts` spreads `$B` for the 146 artifacts; no title.
66. **Hydration scripts omit error stacks outside development; `serializeErrorStacks` pins the choice independent of `NODE_ENV` (#3152, #3468).** — serializer (server side). **Load-bearing**: `web/runtime/serializer` (2 titles).
67. **Finding: the client's only record channels are `_$HY.r` through the `sharedConfig.load`/`has` closures `hydrate()` installs, plus `takeHydrationValue`** — there is no `_$HY.set`/`_$HY.load`. — `C:hydrate` 2205–2206. **unpinned** (negative result).

### 3.6 `<Loading>` boundaries & streaming resume

68. **`<Loading>` under hydration branches on record shape: `id` = `"$$f"` → the fallback is showing, content renders fresh on the client; `id_fr` → fragment path (settled / parked / superseded / rejected / pending); `id_assets` → also wait for module assets.** — `H:hydratedCreateLoadingBoundary` 2994–3188. **Load-bearing**: `solid/client-hydration` › "Loading boundary: fragment registration channel (_fr)" (6), "Loading + asset waiting during hydration" (6). The **object-record-under-bare-id arm** (`{s:1}` straight through, `{s:2}`, a pending promise) is pinned only by hand-built `_$HY.r` fixtures (`"Loading boundary: already-serialized settled ref"` 2) — the server never emits it (§2.5).
69. **A pending boundary increments `_pendingBoundaries`, marks its owner `_hp`, captures its root's registry/gather, and releases exactly once — on resume, rejection or disposal (which also removes `pl-*` scaffolding).** — `H:initBoundaryResume` 2569–2609; `C:hydrate` `cleanupFragment` 2209–2224. **Load-bearing**: `solid/multi-root-hydration`; `hydration/truncated-stream*` (4).
70. **Resume re-enters a claim window scoped to the boundary: swap in the captured registry/gather, `gather(id)` collects only that prefix's `_hk` nodes (frame interiors included), set `_claimOwner`, flip `hydrating`, render, `flush()`, release the boundary's live scope.** — `H:resumeBoundaryHydration` 2482–2541; `C:gatherHydratable` prefix arm. **Load-bearing**: `hydration/loading-late-fragment` › "claims the streamed fragment, no duplicate, no client work"; `solid/client-hydration` › "Loading resumes inner Errored under server-aligned owner IDs".
71. **A render the resume window forces outside the boundary (an `onSettled` write revealing a shell `<Show>`) is a client render — fresh nodes, no registry lookup (#3504).** — `H:isClaiming`; `C:isHydrating` 2517–2522. **Load-bearing**: `hydration/onsettled-hydrate` (3); `solid/hydration-root-snapshot-scope-3504` (3).
72. **Fragment ledger: `$df(id)` routes to `_$HY.f` (`fragmentPolicy`); before `done` the swap proceeds and the registered boundary claims; after `done` a fragment with no claimant is held intact and replayed when its boundary registers (#2964).** — `H:fragmentPolicy` 2655–2661, `H:replayHeldFragment` 2668, `H:claimFragment` 2679, `H:releaseFragment` 2686. **Load-bearing**: `hydration/late-fragment-after-done` (2 titles).
73. **A fragment is tracked as pending / parked / superseded / rejected; a fragment parked above an `<Errored>` keeps the `<Loading>` content, and the server's `flushEnd` is gated by pending root holes (#3770, #3771).** — `H:fragmentPending` 2709, `H:fragmentSuperseded` 2724, `H:fragmentParked` 2735, `H:whenRevealed` 2742. **weakly pinned** on the client: PR bodies #3770/#3771 and server-suite titles carry it; `hydration/diagnostics` › "Errored wrapping Loading hydrates late rejected fragment into fallback" reaches the rejected arm.
74. **Stream truncation: `watchTruncation` arms on `DOMContentLoaded` when the runtime booted while the document was still streaming; a cut before a declared fragment settles rejects its `$R` resolvers (`rejectTruncatedRefs`), so boundaries — including ones registering after the cut — release through the rejection path and never hang (#2958).** — `H:watchTruncation` 2777–2801, `H:rejectTruncatedRefs` 2832–2870, `H:markTruncated` 2872. **Load-bearing**: `hydration/truncated-stream` › "stream truncated before a declared fragment settles (#2958)"; `truncated-registry` › "consumed and unconsumed keyed promises both reject instead of hanging"; `truncated-stream-late-boundary`; `truncated-stream-template`. The mechanism couples to seroval's resolver shape (`$R` entries `{p, s, f}`).
75. **A rejected fragment resumes WITHOUT hydrating serialized children — the boundary re-renders fresh (a recovery), and `IS_OBSERVE` records it.** — `H:recover` 2551; the rejected arm. **Load-bearing**: `solid/client-recovery-record` (4); `solid/client-hydration` › "rejected \_fr resumes without hydrating serialized children"; `hydration/diagnostics` › "late Loading rejection hydrates without orphan warning".
76. **`waitAndResume` abandons (`fragmentAbort`) when the stream is cut before its fragment lands; a write before the boundary resumes commits the shell, and the boundary resumes then catches up.** — `H:fragmentAbort` 2896, `H:waitAndResume` 2900–2943. **Load-bearing**: `hydration/write-before-resume` › "a write before a boundary resumes: the shell commits, the boundary resumes then catches up"; `hydration/nav-before-resume` (2). Abort clause **weakly pinned**.
77. **Placeholder protocol: `<template id="pl-N">…<!--pl-N-->` brackets a pending boundary; `$dfr` swaps the range, sets `_$HY.v[id]=1`, fires `_$HY.fe`, applies `_$HY.hp` head patches, `$dfd` drains; `$dfl`/`$dflj` materialize the fallback template.** — `S` REPLACE_SCRIPT 1620–1670; client consumers `C:claimChildNodes`, `H:enableHydration` `fe` fan-out 1884–1890. **Load-bearing**: artifact-driven `hydration/write-before-resume`, `late-fragment-after-done`; fallback-materialize clause **[SC-only]** pinned by `lifecycle-matrix/call-driven-lifecycle`.
78. **A streamed fragment that registered new stylesheets reveals only after every sheet settles (`$dfs`/`$dfc`/`data-dfc`).** — `S` stylesheet gate scripts. **Load-bearing**: `web/runtime/stylesheet-gate` (5). (Server-emitted; the client cost is ruling 45 and `fragmentParked`.)
79. **HMR/refresh swaps during a streamed resume leave no duplicate content and no orphaned server DOM (#2919).** — refresh runtime over `H:isHydrationInProgress` + `C:reclaimRegion`. **Load-bearing**: `hydration/refresh-hmr-stream` (4).
80. **`_$HY.fr = {pending, subscribe, claim, release}` exposes the ledger's claimant contract to integrations that own server markup wholesale (#2978); `_$HY.fe` fans every `$dfr` out to ledger subscribers.** — `H:enableHydration` 1870–1892; `H:anyFragmentPending` 2751, `H:subscribeFragments`. **[SC-only]** consumer `FR` 1184–1231, 1492. **Load-bearing**: `web/frames-adopted-region-fragments` › "deferred fragments inside an adopted region (#2978)" (5); `web/frames-late-boundary-client` (5).

### 3.7 `lazy()` + module assets

81. **`lazy()` under hydration peeks its id and resolves synchronously from `_$HY.modules[key]`; `{export}` selects a named export; a cached module lacking the export throws loudly in dev (#3011); without `moduleUrl` and no cached module it takes the async path.** — `CO:lazy` 127–199; `H:lazyHydrationLookup` 1790–1838. **Load-bearing**: `solid/client-hydration` › "lazy() hydration-aware rendering" (7).
82. **A `moduleUrl`-bearing `lazy()` whose module is not preloaded throws unconditionally during hydration; only the diagnosis prose is dev-gated (#3338; size gate #2883).** — `H:lazyHydrationLookup` 1817–1835. **Load-bearing**: `solid/client-hydration` › "lazy throws when module not cached during hydration".
83. **`hydrate()` preloads the root module map (`<renderId>_assets`, falling back to `_assets`) before rendering and re-installs the root's registry/gather around the deferred render; on failure a non-document root falls back to client render, a document root abandons hydration and reports the cause via `reportError`/`console.error` (#3338).** — `C:hydrate` 2256–2322; `C:loadModuleAssets` 2130–2154; producer `S` 5852–5871. **Load-bearing**: `hydration/preload-failure-document-root` (3).
84. **A boundary's `id_assets` record makes `<Loading>` wait for module assets alongside its data; a rejected preload still resumes the boundary (client-rendering its content) instead of hanging.** — `H:scheduleResumeAfterAssets` 2953; `H:reportAssetFailure` 2949 (prod `console.error`). **Load-bearing**: `solid/client-hydration` › "Loading + asset waiting during hydration" (6).
85. **`waitAsset(promise)` is a transparent memo (no id slot) that holds the reading computation during hydration until the asset settles (#3600, #3609).** — `C:waitAsset` 160–172. **Load-bearing**: `hydration/wait-asset-hydration`.
86. **The importer of `lazy()`/`clientOnly` is invoked at most once per instance (per-instance memo, #2915, #2999, #3675).** — `CO:lazy`. **weakly pinned**: `hydration/client-only` › "stays on the fallback (no mismatch) while the module is still loading after settle".

### 3.8 `clientOnly` / `NoHydration` / `Hydration`

87. **`<NoHydration>` returns `undefined` while hydrating (server markup untouched, nothing claimed) and sets `NoHydrateContext` so ids beneath are `undefined`.** — `H:NoHydration` 3204–3211. **Load-bearing**: `solid/hydration-state-api`; server half `solid/test/nohydration` (31).
88. **`<Hydration>` on the client is a passthrough; the id-namespace re-entry is server-side and the client aligns via `hydrate(code, el, { renderId })`.** — `H:Hydration` 3231–3233. **Load-bearing**: `hydration-state-api` › "a nested <Hydration> is a client passthrough".
89. **`clientOnly` is mismatch-free by construction: it hydrates the fallback, stays on it while the module loads, and swaps after hydration end.** — `I:clientOnly` 648–713. **Load-bearing**: `hydration/client-only` (2).

### 3.9 Dev / diagnostics that reach prod

90. **[dev-only] Client-creating a document-shell template while hydrating throws loudly (#3259).** — `C:create` 407–427. **Load-bearing**: `web/template-document-shell` (2).
91. **[dev-only] `UNSCOPED_HOLE_ALLOCATED_IDS` snapshots `devPeekNextContextId` around a hole evaluation and warns when a hole allocates ids outside a scope.** — `C:insert` 1236–1258; `H:enableHydration` 1856. **unpinned** in the hydration corpus (doc `08-dev-diagnostics.md`).
92. **Prod-shipped strings every hydrating app pays for: "Hydration module preload failed, falling back to client render:", "Hydration module preload failed; rendering boundary content on the client:", the `lazy()` "was not preloaded before hydration" head, and "Hydration value was truncated…"/"Hydration fragment … was truncated…" — not `_SOLID_DEV_`-gated.** — `C:hydrate` 2316; `H:reportAssetFailure` 2950; `H:lazyHydrationLookup` 1826–1827; `H:rejectTruncatedRefs` 2855; `H:markTruncated` 2875. **unpinned** (size finding; ≈ 330 B min of prose).
93. **No `HYDRATION_*` diagnostic codes exist: every hydration warning is a plain `console.warn`/`console.error`, so none can be suppressed by code.** — doc `08-dev-diagnostics.md`. **unpinned**.
94. **[dev-only] `enforceLoadingBoundary(true)` wraps the root render so an unboundaried async read under hydrate/render is flagged.** — `C:render` 365, 398. **unpinned** in the hydration corpus.

### 3.10 SC-only machinery

95. **[SC-only] `sharedConfig.claimRoots`: a detached range declared as claim roots is walked as hydration even though it is not connected (async slot fills re-inserted on reveal).** — `C:isHydrating` 2523–2536; `FR:claimRender` 326–356. **Load-bearing**: `hydration/adopted-claim-args-address`; `hydration/binding-slot-adoption`; `hydration/adopted-slot-live`.
96. **[SC-only] `claimRender` builds a scoped registry (`gatherClaims`, not descending into nested `[data-fid]` frames), deletes those keys from the root registry, and renders under `createOwner({ id: "sc-<frame>-<key>-" })`; a `pl-*` placeholder in the range engages the scope even with no `_hk` nodes (#2964).** — `FR:gatherClaims` 298–306, `FR:hasPendingFragment` 316–324, `FR:claimRender` 326–358. **Load-bearing**: `welcome-status-loaded/-streamed`, `adopted-fallback-residue` (2), `adopted-slot-late-record`.
97. **[SC clause] The root `gatherHydratable` sweep skips `_hk` nodes inside `[data-fid]` frame regions (found once per page, containment-tested) so late scoped claims are not reported as unclaimed; a prefix-scoped gather collects wherever the keys sit.** — `C:gatherHydratable` 2977–3011. **weakly pinned**: frames adoption specs; plain apps pay the `querySelectorAll("[data-fid]")` probe and the loop.
98. **[SC-only] `materializeContainerTrace` revives a `{ $tr, $ta }` marker into a live read-only store; frames install it via `setContainerTraceMaterializer`.** — `H:materializeContainerTrace` 1226–1342. **Load-bearing**: `solid/container-trace` (7); `lifecycle-matrix/container-args` (3). (Shaken from every plain scenario; the SC audit's B.2.)
99. **[SC-only] `LIVE_LOCAL`: a compute with no serialized record whose result is a live source carrying the document's local answer adopts that answer and arms takeover at scope release (RFC 11 §9.5 client face 3).** — `H:readSerializedOrCompute` 527–549; `H:armLiveTakeover`. **Load-bearing**: `hydration/frame-live-document` (2 runs); `web/frames-live-showing`.
100.  **[SC-only] An async `dynamic()` over a server component adopts its landing record (`_$SC.r(id, address)`) so the frame mounts from the document with zero requests (#3671).** — `I:dynamic` 404–509. **Load-bearing**: `hydration/frame-nonlive-document-3666-*` (5); `lifecycle-matrix/document-adoption`.
101.  **[SC-only] `hydrate()`-less hydration windows: frames flip `sharedConfig.hydrating` for a synchronous render then restore it, relying on the setter contract in 42.** — `FR:claimRender` 345–357; `H:enableHydration` setter. **unpinned** (comment only; a subtle dependency on 42).

### 3.11 Count

**101 statements: 77 load-bearing, 13 weakly pinned (2, 8, 22, 23, 42, 46,
47, 50, 64, 65, 73, 86, 97), 11 unpinned (17, 26, 32, 33, 49, 67, 91, 92, 93,
94, 101).** `[SC-only]` 8 (80, 95, 96, 98, 99, 100, 101 and the `claimRoots`
clause of 15); plain-app statements carrying an `[SC clause]` 4 (15, 57,
77, 97; 8 only in its motive). Load-bearing statements with an unpinned or weakly
pinned clause: 4 (14 handler clause, 48 innermost-first/release, 76 abort,
77 fallback-materialize). `[dev-only]` 7. Pin density by sub-concern
(load-bearing / total): claim walk 15/17; ids 12/14; lifecycle 12/15;
**events 1/4** — the thinnest-pinned area (bootstrap ordering, innermost-first
replay, dedup, queue release are named by no title); adapters 15/17;
boundaries 12/13; lazy 5/6; clientOnly 3/3; dev 1/5; SC-only 5/7.

**Statements that exist only because of SC (frames / `live()`) and would not
be needed by a plain hydrating app:** 80 (`_$HY.fr` publication — 340 B min
/ 92 B br measured), 95 + the clause of 15 (`claimRoots` — inside the 259 min
/ 115 br of W-sc), 97 (the frames exclusion in the gather — the other half of
W-sc), 99 + the live half of 57 (the takeover — 914 min / 287 br measured),
98 (already shaken), 100 (`dynamic()` — the SC audit's B.3, not on the plain
scenarios), 101 (a dependency on 42, no bytes of its own). **Together ≈ 1.5
KB min / ≈ 0.5 KB br of the hydrating app** is there for server components.

Unlike the SC layer's inventory, where the unpinned statements were hygiene
paths, three of hydration's unpinned statements carry real mechanism: 32 (the
pay-for-use shape of `enableHydration` — asserted only by the size gate), 49
(`dedupEvent`, 76 B + the call) and 92 (≈ 330 B of prod prose). And one
load-bearing statement (68) pins a protocol arm the server does not emit.

**Cited issues/PRs** (one line each; `/tmp/sw-fn/rulings-hydration.md` has
the full list): #574 legacy key fallback · #2737 spread + innerHTML · #2801
insert `current` drift · #2876/#2981 Portal serializes nothing · #2883
pay-for-use hydration runtime · #2900 server retry resets child ids · #2914
nullish serialized values · #2915/#2999/#3675 lazy importer once · #2917
multi-root registry · #2919 HMR during streamed resume · #2920 `$$component`
consumes no ids · #2936 `pl-*` scaffolding excluded · #2948 store snapshot
replaces seed · #2957/#3182 stateful DOM props · #2958 truncation · #2964
held fragment after done · #2978/#2979 `_$HY.fr` claimant contract · #2993
hybrid generator continues · #2997 rejection reported once · #3000 island
namespace · #3011 `lazy({ export })` · #3012/#3033 transparent memo parity ·
#3060 terminal `done` · #3081 head prelude · #3105/#3297/#3388 spread under
hydration · #3152/#3468 error stacks · #3161 `For` eager under hydration ·
#3163 eager JSX under false `<Show>` · #3179/#3180/#3189 attribute/style/
class no-ops · #3259 shell template guard · #3338 document-root preload
failure · #3386 string-tag `dynamic` replays events · #3498 shadow draft ·
#3504 root snapshot scope · #3540 Loading `on` · #3567 non-children JSX slot
· #3571 sole-child `0` · #3574 hybrid store handoff · #3600/#3609 `waitAsset`
transparent, null owner · #3666/#3671 async `dynamic()` adoption · #3749
nodes stay put · #3770/#3771 parked fragments, `flushEnd` gate.

---

## 4. Structural vs incidental

Per concern group: the bytes a ruling requires (structural) vs the bytes
that exist because of how mechanisms were layered (duplicated seams, shims,
dead branches, several helpers for one job, dev paths not fully gated).
Minified bytes on `app: hydrating (no stores)` unless noted; brotli at the
group's measured figure or the delta's ratio (0.30).

| concern                                                                |                  min B |              structural |                                                                    incidental (est.) | evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------- | ---------------------: | ----------------------: | -----------------------------------------------------------------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<Loading>` resume, fragment ledger, truncation                        |                  4,533 |                  ~3,850 |                                                                             **~680** | (a) the object-record-under-bare-id arm of `hydratedCreateLoadingBoundary` + `waitAndResume`'s `hydrateRejected` default — a protocol the server stopped emitting (§2.5) ≈ 250; (b) the module-assets gate is woven through **six** branches — four literal copies of `assetPromise ? assetPromise.then(() => queueMicrotask(x), err => { reportAssetFailure(err); queueMicrotask(x) }) : queueMicrotask(x)` (lines 3052–3063, 3111–3119, 3137–3145, 3176–3183) plus `scheduleResumeAfterAssets` (3030–3034, 3148) and `waitAndResume`'s own assets arm (2927–2942) — instead of one `afterAssets(assetPromise, fn)` ≈ 250; (c) `reportAssetFailure`'s prod string 109 → ≈ 70 recoverable; (d) `fragmentParked`/`fragmentSuperseded` each probe `_$HY.v[id]` + `getElementById` twice (one `fragmentDom(id)` would do) ≈ 60; (e) `createBoundaryTrigger` toggles snapshot capture around a signal read to mint a trigger — a seam cost of the snapshot design, ≈ 40 (structural to 38). The ledger itself, truncation (1,138 B, pinned by 4 files), resume, `initBoundaryResume`'s once-only release are rulings 68–80 line by line.                                                                                                                       |
| serialized-value adapters (signal/memo/effect/error boundary)          |                  4,000 |                  ~3,500 |                                                                             **~500** | (a) four ways to hand the engine a quiet step — `syncThenable`, `wrapFirstYield`, `quietAnswer` (0 hits, with-stores only), `adoptedAnswerStream`'s inline thenable — and two conflating iterators: `normalizeIterator` (411) for the signal shape and the inline iterator of `hydrateStoreFromAsyncIterable` (≈ 600, with stores) for the store shape; the shared rule is 59/60's "buffered yields conflate, park past the pass" — one implementation parameterised by the sink would save ≈ 350 **in the with-stores bundle** and ≈ 150 here; (b) the hybrid handoff is written twice (`hydrateSignalLike` 1417–1481 and `hydrateStoreLikeFn` 1550–1695 — identical `detect`/`hydrated`/`live`/`flip`/`adopted`/`creating`/`landedOnCreate` state machines, `prev` vs `draft` the only difference) ≈ 450 duplicated **with stores**, 0 here; (c) `hasLoadingWindow` re-probes `options` at each call site (93) — a flag on the node would be ≈ 30; (d) `readHydratedValue`'s `refresh` callback parameter exists so the trace runs before the unwrap — ≈ 40 of indirection. The `MockPromise`/`subFetch` trace run (≈ 460) is **structural to ruling 56** as written, though it is the adapters' most fragile mechanism (global `Promise`/`fetch` swap). |
| `hydrate()` entry                                                      |                  1,916 |                  ~1,450 |                                                                             **~470** | (a) `render(code, element, [...element.childNodes], options)` appears three times — the sync path, the post-preload path, the preload-failure fallback — with the registry/gather re-install duplicating `resumeBoundaryHydration`'s swap ≈ 150; (b) `cleanupFragment` (203) is a DOM walk over `pl-*` scaffolding living in web only so `hydration.ts` stays DOM-free — the fragment ledger that owns `pl-*` is in solid; one owner would be ≈ 120 smaller; (c) the #3081 head-prelude move (≈ 120) compensates for a server byte-placement constraint on the client — structural to ruling 44 as ruled, incidental to the architecture (the server could emit the prelude where the walk expects it and mark it); (d) `_$HY.modules`/`_$HY.loading` lazily created here and in `lazyHydrationLookup`'s `?.` chains ≈ 40; (e) the prod preload-failure string (≈ 60). `gatherHydratable`'s frames loop is counted under SC (§5).                                                                                                                                                                                                                                                                                                                          |
| sharedConfig lifecycle                                                 |                  1,204 |                    ~900 |                                                                             **~300** | the `hydrating`/`done` **property interceptors** (`Object.defineProperty` ×2 with closures: ≈ 250 B) — a cross-package seam that lets web's `sharedConfig.hydrating = …` assignments drive solid's scope release and completion; an explicit `beginPass()/endPass()` pair on the internal surface would be ≈ 100 and would also make ruling 101 (frames toggling the flag) an API call instead of a side effect; `isHydrationInProgress`/`onHydrationEnd`/`isClaiming` installs ≈ 50 of slot plumbing (structural to 32).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| claim walk & DOM adoption (web)                                        |                  1,185 |                  ~1,000 |                                                                             **~185** | `reclaimRegion`'s marker walk (lines 1289–1305) is `getNextMarker`'s depth-counted walk run backwards — the same `$`/`/` protocol implemented twice ≈ 120; the `claimRoots` loop in `isHydrating` is SC (§5); `dedupEvent` is ruling 49 (unpinned).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| signals core pulled by hydration                                       |                    771 |                     771 |                                                                                    0 | the snapshot scope (ruling 38), `getContext` for `NoHydrateContext` (18/87), `peekNextChildId` (positional adoption).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| module scope (solid)                                                   |                    597 |                    ~550 |                                                                                  ~50 | the `MockPromise` static-method table (`for (const k of [...7 names])`) ≈ 50 — structural to 56's "statics are covered".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `lazy()` & module assets                                               |                    570 |                    ~450 |                                                                             **~120** | the `lazy()` "was not preloaded before hydration" head is prod prose (ruling 82 says the throw is unconditional and only the diagnosis is dev-gated — but the head itself is ≈ 90 B); `loadModuleAssets`' `new URL(..., document.baseURI).href` normalisation is a Vite `?import` workaround ≈ 30 (structural to the bundler contract).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| live-source takeover                                                   | 470 (914 as a feature) | 914 for a `live()` page |                              **0 structural for a plain app; all of it pay-for-use** | measured −914 min / −287 br when removed (S-live). Keyed by `live()` sources, a `@solidjs/web/server-functions` concept; the arms sit inside `readSerializedOrCompute`, so the seam is a hook slot the sf client installs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| id allocation & keys                                                   |                    174 |                     174 |                                                                                    0 | rulings 18, 21.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| DOM runtime: insert / reconcile (hydration arms)                       |                    386 |                    ~340 |                                                                                  ~45 | `insertExpression`'s claim-pass loop allocates `arr ? value : [value]` per call; the phantom-node check and the #3749 arm are rulings 8–9; `[].concat(value).every(...)` ≈ 45 could share the loop above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| events (`dedupEvent` call)                                             |                     36 |                      36 |                                                                                    0 |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **hydration total (the +15,959 delta's two packages + signals pulls)** |             **15,959** |            **≈ 13,000** | **≈ 1,450 incidental (9 %) + 914 pay-for-use (live) + 340 (`_$HY.fr`) + 259 (W-sc)** | ≈ 0.4 KB br incidental; ≈ 0.5 KB br SC/live; ≈ 0.55 KB br stream adoption (structural but pay-for-use, §5).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

**Outside hydration** (the groups every scenario carries):

| concern                                                 |  min B |                              structural |                                 incidental (est.) | evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------- | -----: | --------------------------------------: | ------------------------------------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOM runtime: events & delegation (floor)                |  1,954 | 1,954 for an app with a delegated event | **1,877 min / 636 br pay-for-use in hello world** | `render()` calls `registerDelegatedRoot(element)` eagerly, which retains `eventHandler` (1,009), the container registry and `findOwner`/`tagHost` in a bundle whose compiled output never calls `delegateEvents`. Measured −1,877 / −636 (W-deleg). **Realism caveat:** the floor scenario sets `el.onclick` by hand; a compiled hello world with `<button onClick>` emits `delegateEvents(["click"])` and keeps every byte. The seam is still right — `render` records the root, `delegateEvents` installs the attach — but it moves the floor scenario, not most apps. `eventHandler` itself (shadow DOM, portals via `_$host`, nested roots via `$$EVENT_OWNER`, `composedPath`) is structural to the per-root delegation design; 21/69 branches are untested.                                                                                                                                                                                                                                                                                                                                                           |
| DOM runtime: insert / reconcile (floor)                 |  3,908 |                                  ~3,700 |                                              ~200 | `reconcileArrays` 1,381 is retained by hello world for the array arm of `insertExpression` it never takes — residue by construction of a single `insert`, not a layering fault; `ownsAllChildren`/`removeOwnedChildren` (510) exist for one case — foreign nodes (late stylesheet `<link>`s) appended to a markerless root — and `removeOwnedChildren` is reached by no test (§2.5): **unpinned mechanism ≈ 300 B**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| CSR residue of hydration                                |   ~300 |                                       — |                                              ~300 | `isHydrating` 191 + the `hydrationRt !== null` / `sharedConfig.hydrating` guards in `insert`, `insertExpression`, `normalize`, `eventHandler` ≈ 100. This is the whole of what the carve's decision rule measures here: **0.3 KB vs the signals carve's 2.9 KB**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| DOM runtime: attributes / props / spread (compiled CSR) | 13,629 |                                  ~7,000 |                **≈ 6,000 by design, 0 by ruling** | `spread` reads sources through `@solidjs/signals`' merge/omit **view records** (`viewOf`, `OmitView`, `resolvedTable`, `sourceKeys`, `sourceHas`, `sourceGet`, `hasStaticKeys`), so one element spread retains `store/utils.js` (6,790 B) alongside web's 5,345 B (`spread`, `assign`, `assignProp`, `className`+`classListToObject`+`flattenClassList` 1,087, `style`, `collectProps`/`pushEntry`/`collectSources`/`collectTable`/`readShallow`/`entryHas`/`entryGet`/`resolveSource` 1,249, `addEvent`, `setAttributeNS`, tables). The ruling (`spread` applies the union of own string keys, later sources winning, reading only the winning source — the comment at 985–992) needs none of the view machinery for **plain-object** sources; the views exist so a `mergeProps()`/`omit()` proxy passed to a spread is read without its traps (a perf decision, 1032–1046). Measured: element spread 6,852 min / 2,017 br; `mergeProps` 3,197 / 856; both 12,825 / 3,680 (§5.3). A plain-object fast path that falls back to the view read for a `$PROXY` source is the obvious seam; its size is a design question (§7). |
| module scope (web, compiled)                            |    992 |                                     992 |                                                 0 | the attribute/property/alias/namespace tables from `constants.ts` — the DOM contract.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**Layer residue in shared paths** — the carve's test. Hydration's arms
inside CSR-shared functions total **≈ 700 B in the hydrating bundle**
(`insertExpression` +275, `insert` +112, `eventHandler` +36, `isHydrating`
191, `normalize`'s adoption loop ≈ 90) and **≈ 300 B in the CSR bundle**.
The hydration layer is already a module behind null slots (`hydrationRt`,
the `_create*` override slots, `_lazyHydrationLookup`) — the #2883 phase-3
design — and the slots work: `enableHydration` installs them, Rolldown
folds the guards. There is no 2.9 KB inside `read`/`recompute` to free. What
the layer lacks is **two more slots of the same kind**: one the frames client
installs (SC tier) and one a stream-source page installs (adapter tier).

---

## 5. Hydration specifically — is the +16 KB structural?

### 5.1 Tier measurements on edited dist copies

Measured, not estimated (`/tmp/sw-fn/variants.mjs`): copies of the built
`solid.js`/`web.js` under `/tmp` with the function bodies stubbed or the
arms removed, bundled through `bundle.mjs` with the scenario's alias pointed
at the copy; the repo dists are untouched. A stub keeps the call site, as a
real split behind a slot would, so each figure is the **floor** of the move;
a real seam adds its own bytes (≈ 50–150 B min per slot, the #2883 pattern).

| variant (app: hydrating (no stores))                                                                  | min B (Δ)           | br B (Δ)          | what it removes                                                                                                                                                                                | tier                                                               |
| ----------------------------------------------------------------------------------------------------- | ------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| as shipped                                                                                            | 52,437              | 17,648            |                                                                                                                                                                                                |                                                                    |
| **S-live** — no live-source takeover                                                                  | 51,523 (−914)       | 17,361 (−287)     | `armLiveTakeover`, `liveScopeOf`, `takeOver`, `openLiveScope`/`releaseLiveScope`, `nodeGate`/`liveGates`/`openScopes`, the three `LIVE_*` symbols, the three arms in `readSerializedOrCompute` | SC / `live()` only (rulings 57 live half, 99)                      |
| **S-ai** — no async-iterable adoption / hybrid handoff                                                | 50,604 (−1,833)     | 17,101 (−547)     | `hydrateSignalFromAsyncIterable`, `normalizeIterator`, `wrapFirstYield`, `adoptedAnswerStream`, `forwardIteratorReturn`, `isAsyncIterable`, the hybrid branch of `hydrateSignalLike`           | pay-for-use: stream sources (rulings 58, 59)                       |
| S-live + S-ai                                                                                         | 49,690 (−2,747)     | 16,821 (−827)     |                                                                                                                                                                                                |                                                                    |
| **S-trunc** — no truncation sweep (#2958)                                                             | 51,268 (−1,169)     | 17,334 (−314)     | `watchTruncation`, `rejectTruncatedRefs`, `markTruncated`, `fragmentAbort`, `_truncationRejectors`                                                                                             | **structural** (ruling 74, 4 spec files) — measured for scale only |
| **S-frpub** — no `_$HY.fr` ledger publication                                                         | 52,097 (−340)       | 17,556 (−92)      | the `{pending, subscribe, claim, release}` object and `anyFragmentPending` (reached by nothing else)                                                                                           | SC only (ruling 80)                                                |
| **W-sc** — no frames exclusion in `gatherHydratable`, no `claimRoots` in `isHydrating`                | 52,178 (−259)       | 17,533 (−115)     |                                                                                                                                                                                                | SC only (rulings 15 clause, 95, 97)                                |
| W-multiroot — no #2917 `boundaryScopes` capture                                                       | 52,292 (−145)       | 17,614 (−34)      |                                                                                                                                                                                                | islands only — **structural** (ruling 34); for scale               |
| **PLAIN TIER = S-live + S-ai + S-frpub + W-sc**                                                       | **49,090 (−3,347)** | **16,703 (−945)** | everything a plain hydrating page without stream sources never runs                                                                                                                            |                                                                    |
| S-stream — no streaming boundaries at all (`hydratedCreateLoadingBoundary` → core; no ledger install) | 47,570 (−4,867)     | 16,295 (−1,353)   | the whole §1.2 first row: a **renderToString-only** hydration                                                                                                                                  | lower bound; rulings 68–80 removed                                 |
| S-stream + S-live + S-ai + W-sc (lower bound)                                                         | 47,311 (−5,126)     | 16,250 (−1,398)   |                                                                                                                                                                                                |                                                                    |

The same plain tier on the other scenarios: **hydrating + every store**
91,387 / 28,736 → 88,702 / 28,079 (−2,685 / −657; the store adapters keep
their own iterator, so S-ai saves less); **compiled hydrating app** 69,271 /
22,694 → 65,922 / 21,725 (−3,349 / −969); the compiled app without streaming
boundaries at all: 64,399 / 21,283 (−4,872 / −1,411).

### 5.2 Reading the delta

Of the **+15,959 min / +4,833 br**:

| part                                                                                                                                          |   min B | br B (measured / ≈) | share | verdict                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------: | ------------------: | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **claim walk + id plumbing + `hydrate()` entry + lifecycle + insert arms + module scope + signals pulls**                                     | ≈ 6,200 |             ≈ 1,850 |  39 % | **structural** (rulings 1–46, 61–62); incidental inside it ≈ 1,000 (the interceptor seam, the three `render` arms, `cleanupFragment`'s layering, the duplicated marker walk, prod strings)                                                                                                                          |
| **`<Loading>` resume + fragment ledger + truncation + assets**                                                                                | ≈ 4,500 |      1,353 measured |  28 % | **structural for a streaming app** (rulings 68–79, 83–84 — 12/13 load-bearing); incidental ≈ 680 (the dead bare-id arm, the six asset gates); a renderToString-only app does not need it, but there is no server-side signal today that says "this document has no fragments" — the ledger install is unconditional |
| **serialized-value adoption, "server" mode (`readSerializedOrCompute`, `readHydratedValue`, the trace run, the facades, the error boundary)** | ≈ 1,900 |               ≈ 570 |  12 % | **structural** (rulings 51–56, 61); incidental inside it ≈ 450 (§4)                                                                                                                                                                                                                                                 |
| **async-iterable adoption + hybrid handoff**                                                                                                  |   1,833 |        547 measured |  11 % | **structural but pay-for-use**: rulings 58–59 are load-bearing, and a page with no async-iterable or hybrid source never enters them; the server knows at serialization time whether it wrote one                                                                                                                   |
| **live-source takeover + `LIVE_LOCAL`**                                                                                                       |     914 |        287 measured |   6 % | **SC / `live()` only**: no plain hydrating app has a live-branded source                                                                                                                                                                                                                                            |
| **`_$HY.fr` publication + `claimRoots` + frames gather exclusion**                                                                            |     599 |        207 measured |   4 % | **SC only**                                                                                                                                                                                                                                                                                                         |

So: **≈ 12.6 KB min / ≈ 3.9 KB br (79 %) is the plain tier under the current
rulings**; **≈ 1.5 KB min / 0.5 KB br is SC machinery a plain app carries**;
**≈ 1.8 KB min / 0.55 KB br is stream adoption a page without streams
carries**; and **≈ 1.45 KB min / ≈ 0.4 KB br of the plain tier is
incidental** (§4). Hydration is not "too large" for what it promises — it is
large because it promises a lot (101 statements, 76 % pinned) and because
three of its tiers are installed unconditionally.

### 5.3 The tier split

**Today:** one tier. `hydrate()` → `enableHydration()` installs every slot,
publishes `_$HY.fr`, installs the live gates, keeps the frames exclusion and
`claimRoots` in web's walk; the frames client (`@solidjs/web/frames`)
_consumes_ those hooks but installs nothing of its own except the
container-trace materializer (B.2 of the SC audit).

**Proposed: plain hydration vs SC-capable, installed by the consumer.**

| piece                                                                      | lives today                   | moves to                                                                                                                                                       | measured saving (plain app) | cost on an SC page                                                                               |
| -------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------: | ------------------------------------------------------------------------------------------------ |
| live-source takeover (gates, `takeOver`, the three arms)                   | `hydration.ts`, unconditional | a slot `_liveTakeover` the **server-functions client** installs when `live()` is imported (`live()` is the only producer of `LIVE_SOURCE`-branded values)      |          −914 min / −287 br | +≈ 60 B min for the slot and its three guards; the sf client already imports `solid-js/internal` |
| `_$HY.fr` publication (`anyFragmentPending`, the object)                   | `enableHydration`             | `publishFragmentLedger()` on `solid-js/internal`, called by the frames client's `installServerComponents` (its only consumer)                                  |                  −340 / −92 | 0 (the same bytes, installed from the consumer)                                                  |
| `claimRoots` loop in `isHydrating`, frames exclusion in `gatherHydratable` | `web/src/client.ts`           | a `hydrationExt` slot (`{ isClaimed(node), excludeFromGather(el) }`) the frames client installs                                                                |                 −259 / −115 | +≈ 80 B min                                                                                      |
| async-iterable adoption + hybrid handoff                                   | `hydration.ts`, unconditional | a slot installed when the **server** recorded a stream source in the document (`_$HY.r["_stream"]` or a flag on the first such record) — the SC audit's seam D |               −1,833 / −547 | +≈ 100 B min for the slot; the server half already knows (it serializes the iterable)            |
| **SC tier total**                                                          |                               |                                                                                                                                                                |    **−1,513 min / −494 br** | ≈ +140 B min on `page: base`                                                                     |
| **SC + stream-adoption tier**                                              |                               |                                                                                                                                                                |    **−3,347 min / −945 br** | the stream slot also costs the frames page nothing unless it serializes a stream                 |

Where it lands, on an edited dist (floors, before the slots' own bytes):
`app: hydrating (no stores)` **49,090 min / 16,703 br** (−5.4 %); the
compiled hydrating app 65,922 / 21,725. The SC audit's B.2 already measured
the other direction (the materializer leaves the eager SC page); these two
slots are the hydration-side mirror of that move and need the same seam D.

What does **not** move: the truncation sweep (structural, 4 spec files), the
#2917 multi-root capture (34 B br; islands are a plain-app shape), the
`<Loading>` resume and ledger (a renderToString-only tier would save another
1,353 br but there is no record today that says "no fragments" — a server
flag `_$HY.r["_nofr"]` would be a new wire fact; listed in §7, not
recommended as a first step).

---

## 6. Decision

### 6.1 Options and floors

| option                                                                                                                                                                          |     render + one signal (min / br) |                    CSR |                                                  hydrating (no stores) |                             compiled CSR app (not on the gate) | what it buys                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------: | ---------------------: | ---------------------------------------------------------------------: | -------------------------------------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **today**                                                                                                                                                                       |                     27,597 / 9,811 |        36,478 / 12,815 |                                                        52,437 / 17,648 |                                                51,898 / 17,498 |                                                                                                                                                                                                                                                                          |
| **T — tiering only** (SC slots → frames/sf install; stream-adoption slot keyed by a server record)                                                                              |                          unchanged |              unchanged | ≈ 49,250 / **≈ 16.75 KB** (−0.9 KB br; floors −945 + ≈ 50 br of slots) |                                                      unchanged | no rulings touched; two new internal slots (public-surface note below); needs the seam D the SC audit's S3 builds                                                                                                                                                        |
| **C — targeted cuts only** (dead bare-id arm, one asset gate, prod strings dev-gated, `begin/endPass` for the interceptors, one marker walk, `cleanupFragment` with the ledger) |                          unchanged |              unchanged |                             ≈ 51,000 / **≈ 17.2 KB** (−0.4 KB br est.) |                                                      unchanged | one ruling (68's dead arm), one internal-surface change (the interceptor seam → explicit calls), otherwise mechanical                                                                                                                                                    |
| **T + C**                                                                                                                                                                       |                          unchanged |              unchanged |                          ≈ 47,800 / **≈ 16.3 KB** (−1.3 KB br, −7.5 %) |                                                      unchanged | the recommended hydration programme                                                                                                                                                                                                                                      |
| **P — props seam** (`spread` plain-object fast path; view read only for `$PROXY` sources)                                                                                       |                          unchanged |              unchanged |                                                              unchanged | ≈ 46,000–48,000 / **≈ 15.7–16.3 KB** (−1.2 to −1.8 KB br est.) | needs a ruling (spread over plain objects reads them directly); `mergeProps`' own 3.2 KB stays with its proxy design                                                                                                                                                     |
| **D — delegation registration lazy** (`render` records, `delegateEvents` attaches)                                                                                              | 25,720 / **9,175** (−636 measured) | 34,600 / 12,184 (−631) |                                                                 ≈ −630 |                                  unchanged (the app delegates) | moves the floor scenario; real apps with any delegated event keep every byte; worth doing only if hello world without events is a shape the floor should measure honestly                                                                                                |
| **R — rulings-first rewrite of `hydration.ts`**                                                                                                                                 |                          unchanged |              unchanged |          ≈ 48,000 / ≈ 16.4 KB (C's cuts + ≈ 300 B of seam unification) |                                                      unchanged | −≈ 1.7 KB min over T+C at best (the two handoff bodies and two iterators are with-stores bytes); 101 rulings to re-derive against 15 artifact-driven files and a wire format shared with `server.ts`; the carve's decision rule does not fire (0.3 KB of residue in CSR) |

Minified is the structural number; brotli the shipped one. T's figures are
measured floors plus a guessed slot cost; C's are estimates read off §4; P's
range is the measured spread cost (6,852 / 2,017 with `mergeProps` kept)
less what a plain-object path must keep (`assign`/`assignProp`/`className`/
`style` ≈ 2.9 KB min, which a spread still needs).

### 6.2 Recommendation: **T + C, then P as its own ruling; no carve**

Why not a carve, as for signals:

- **The decision rule does not fire.** The signals carve was justified by
  residue inside `recompute`/`read`/the flush — 2.9 KB of the 4.4 KB removed
  — that only a rebuild could reach. Hydration's residue in CSR is 0.3 KB
  (`isHydrating` + four null-slot guards); its layers are already behind
  slots (#2883 phase 3) and the slots work. What is missing is two more
  slots and a server record — packaging, not rebuilding.
- **The prize is small and mostly already separable.** Incidental inside the
  plain tier is ≈ 1.45 KB min / 0.4 KB br (9 %); the tiers are ≈ 3.3 KB /
  0.95 KB and need no rewrite. A rewrite's extra over T + C is ≈ 300–600 B
  min of seam unification whose larger half (the duplicated handoff and
  iterator) lives in the with-stores bundle.
- **The rulings are pinned.** 77 of 101 have a spec; the 11 unpinned are
  three mechanisms (32, 49, 92) and eight hygiene/dev statements. A carve
  "re-derives each rule from its tests"; here 15 of the 49 hydrate files are
  artifact-driven replays of real server output — the tests already hold the
  protocol, and the one place they diverge from the server (68's bare-id
  arm) is a deletion, not a re-derivation.
- **The wire format is two-sided** (§6.3): `hydration.ts` is one half of a
  protocol whose other half is `server.ts`'s 7,116 lines and the serializer.
  A rewrite that changes any record shape re-records 146 artifacts.

Why not tiering only: the five cuts are cheap, each is mechanical except the
dead arm (a ruling), and two of them (the interceptor seam, `cleanupFragment`
with the ledger) make the SC slot cleaner to install — frames today toggles
`sharedConfig.hydrating` as a side-effecting assignment (ruling 101).

Why P is separate: the props finding is the layer's largest number (12.8 KB
min / 3.7 KB br on a compiled app) and it is **not** incidental in the §4
sense — `spread` reads through the view records _by design_ so a
`mergeProps()` result spreads without its traps. Whether a plain-object
source should take a direct path is a design ruling the maintainer owns;
the measurement is here so the ruling is informed. It also argues for the
gate change in S1: the scenario suite cannot see this cost today.

### 6.3 Risks: the compiler contract and the hydration wire format

**The compiler contract.** Every helper the compilers emit is a public
surface shared by `@solidjs/compiler` and `@solidjs/babel-plugin`, which must
stay in parity (their fixture expectations are shared). From `§2.4` and
`client.ts`'s declarations, the signatures a change in this layer could
touch:

| helper                                                                 | signature (runtime declaration)                                                                                                                                                                                                                | touched by                                                |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `template`                                                             | `(html: string, flag?: 1 \| 2) => () => Element`                                                                                                                                                                                               | —                                                         |
| `getNextElement`                                                       | `(template?: () => Element) => Element`                                                                                                                                                                                                        | T (if `claimRoots` moves, `isHydrating` keeps its shape)  |
| `getNextMarker`                                                        | `(start: Node) => [Node, Node[]]`                                                                                                                                                                                                              | C (one marker walk shared with `reclaimRegion`)           |
| `getNextMatch`                                                         | `(start: Node, elementName: string) => Element`                                                                                                                                                                                                | —                                                         |
| `getFirstChild` / `getNextSibling`                                     | `(node, expectedTag)` — dev + hydratable only, exported from prod `web.js`                                                                                                                                                                     | C (export hygiene)                                        |
| `runHydrationEvents`                                                   | `() => void`                                                                                                                                                                                                                                   | —                                                         |
| `getHydrationKey`                                                      | `() => string \| undefined`                                                                                                                                                                                                                    | —                                                         |
| `insert`                                                               | `(parent, accessor, marker?, init?, options?: { host?, schedule?, name? })` — compilers use args 1–4                                                                                                                                           | C (claim-pass arm shape), D (none)                        |
| `scope`                                                                | `<T extends () => any>(fn: T) => T` (`fn.$s = true`)                                                                                                                                                                                           | —                                                         |
| `effect` / `memo`                                                      | `render.ts`; configurable via `effectWrapper`/`memoWrapper`                                                                                                                                                                                    | —                                                         |
| `setAttribute` / `setAttributeNS` / `setProperty` / `setStyleProperty` | `(node, name, value)` / `(node, ns, name, value)`                                                                                                                                                                                              | —                                                         |
| `className` / `style`                                                  | `(node, value, prev?)`                                                                                                                                                                                                                         | P (unchanged signature; `spread` is the caller)           |
| `readShallow`                                                          | `(value: unknown) => unknown`                                                                                                                                                                                                                  | P                                                         |
| `addEvent`                                                             | `(node, name, handler, delegate: boolean)`                                                                                                                                                                                                     | D (none — `delegateEvents` is the installer)              |
| `delegateEvents`                                                       | `(eventNames: string[]) => void`                                                                                                                                                                                                               | D (gains the attach install; signature unchanged)         |
| `spread`                                                               | `(node, sources: unknown[] \| accessor, skipChildren?, skip?, name?)` — compilers emit `(el, props)` or `(el, [a, props, b], true)`                                                                                                            | **P** (behaviour over plain objects; signature unchanged) |
| `ref` / `applyRef`                                                     | `(fn, element)` / `(r, element)`                                                                                                                                                                                                               | —                                                         |
| `claimElement`                                                         | `<T extends Element>(node: T) => T`                                                                                                                                                                                                            | —                                                         |
| `createComponent` / `mergeProps` / `getOwner`                          | re-exports from `solid-js` / `@solidjs/signals`                                                                                                                                                                                                | P (`mergeProps` stays)                                    |
| builtIns                                                               | `For`, `Show`, `Switch`, `Match`, `Loading`, `Reveal`, `Repeat`, `Errored`, `Portal`, `Dynamic`                                                                                                                                                | —                                                         |
| SSR                                                                    | `ssr`, `ssrElement`, `ssrElementAttribute`, `ssrAttribute`, `ssrClassName`, `ssrStyle`, `ssrStyleProperty`, `ssrStyleProperties`, `ssrGroup`, `ssrHydrationKey`, `ssrSelectValues`, `ssrClaim`, `escape`, `scope` (`ssrScope`), `sharedConfig` | —                                                         |

None of T, C or D changes a signature; P changes `spread`'s behaviour for
plain-object sources, not its shape. The parity finding (`<template>` with
children) is independent of this audit and should be filed on its own.

**The hydration wire format** — what the client reads and a change must keep
or version (producer `packages/web/src/server.ts` + the serializer; consumer
`hydration.ts`/`client.ts`; pinned byte-for-byte by the 146 artifacts):

- Markup: `_hk="<id>"` on every template root; `<!--$-->`…`<!--/-->` hole
  pairs; `<!--!$-->` text separators; `<template id="pl-N">`…`<!--pl-N-->`
  placeholders; `data-dh`/`data-dhf` head markers; `data-fid` frame brand
  (SC); `[data-dfc]` stylesheet counters.
- `_$HY`: `r` (the record map), `events`, `completed`, `fe`, `f`, `v`, `hp`,
  `done`, `modules`, `loading`, `fr` (SC), the `$df`/`$dfr`/`$dfd`/`$dfs`/
  `$dfc`/`$dfl`/`$dflj` reveal scripts, `$R` (seroval's resolver scope, read
  by the truncation sweep).
- Record shapes under `_$HY.r`: a bare value; `{s:1,v}`/`{s:2,v}` stamps; a
  thenable; `"$$f"` under a boundary id; `<id>_fr` (a promise) for a
  streamed boundary; `<id>_assets` and `<renderId>_assets`/`_assets`
  module maps; `$B` pre-shell batches; `sc:*` records (SC); async-iterable
  replays (the serializer's stream adapter).
- Ids: the owner-chain counter (`getNextChildId`), `renderId` prefixes,
  `sc-<frame>-<key>-` claim prefixes (SC), `transparent` owners consuming
  none, one extra owner id per `dynamic()` instance (#3671).
- Internal cross-package surface (`solid-js/internal`): `sharedConfig` and
  its slots (`load`, `has`, `gather`, `registry`, `completed`, `events`,
  `boundaryScopes`, `captureBoundaryScope`, `cleanupFragment`,
  `loadModuleAssets`, `getNextContextId`, `devPeekNextContextId`,
  `isHydrationInProgress`, `onHydrationEnd`, `isClaiming`, `claimRoots`,
  `verifyHydration`), `enableHydration`, `_lazyHydrationLookup`,
  `materializeContainerTrace`, `NoHydrateContext`, the registered symbols
  `solid.LiveSource`/`solid.LiveResumeFrom`/`solid.LiveLocal`.

**Public-API notes for the maintainer, stated as their own item:** T adds two
internal slots on `solid-js/internal` (a live-takeover installer and a
fragment-ledger publisher) and one on `@solidjs/web` (a hydration extension
slot for `claimRoots`/gather exclusion) — all `@internal`, consumed by
`@solidjs/web/frames` and `@solidjs/web/server-functions`; C replaces the
`sharedConfig.hydrating`/`done` property interceptors with explicit internal
calls (the frames client's ruling-101 toggle must change with it); none of
T/C/D changes a user-facing export, prop, option or diagnostic. P changes no
signature; whether its behaviour change (plain-object spread reads directly)
counts as a documented-behaviour change is part of the ruling in §7.

### 6.4 The test corpus that gates the work

| suite                                                                                                                                                                                                                                                                                                                                                                                  |  files |                        tests | what it pins                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----: | ---------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/web/test/hydration/*.spec.tsx`                                                                                                                                                                                                                                                                                                                                               |     49 |     95 titles → **275 runs** | rulings 1–17, 19, 24–25, 28, 30, 34, 36–37, 41, 43–45, 48, 60, 63–64, 68–79, 83, 85–86, 89, 95–96, 99–100; 15 files replay `__artifacts__` |
| `packages/web/test/lifecycle-matrix/*.spec.tsx`                                                                                                                                                                                                                                                                                                                                        |      8 |                           52 | SC lifecycle (77's fallback clause, 98, 100)                                                                                               |
| `packages/web/test/*.spec.tsx` touching hydration                                                                                                                                                                                                                                                                                                                                      |      7 |                           19 | 63, 80, 90 (plain: `take-hydration-value`, `template-document-shell`)                                                                      |
| `packages/web/test/runtime/*.spec.js` (server emission of the protocol)                                                                                                                                                                                                                                                                                                                |      4 |                           60 | 47, 66, 78                                                                                                                                 |
| `packages/solid/test/*` client-face (`client-hydration` 139, `hybrid-store-handoff` 28, `hybrid-memo-handoff` 15, `hydration-null-owner-3609` 14, `id-parity` 12, `container-trace` 7, `client-recovery-record` 4, `refresh-hydration` 4, `hydration-state-api` 3, `hydration-root-snapshot-scope-3504` 3, `multi-root-hydration` 2, `public-boundary-exports` 2, `hydration-latch` 1) |     13 |                          234 | 18, 20–21, 27, 29, 35–40, 51–62, 68, 70, 75, 81–82, 84, 87–88, 98                                                                          |
| `packages/web/test/harness/__artifacts__/*.json`                                                                                                                                                                                                                                                                                                                                       |    146 |                            — | the document face byte-for-byte (recorder-maintained; the server suite rewrites them on drift)                                             |
| `scripts/size` (the three frozen caps + the two page caps)                                                                                                                                                                                                                                                                                                                             |      — |                            — | ruling 32 (the pay-for-use shape) — the only assertion it has                                                                              |
| **total**                                                                                                                                                                                                                                                                                                                                                                              | **81** | **640 runs + 146 artifacts** |                                                                                                                                            |

Gaps a gate should close before any pass: the events group (47–50: bootstrap
ordering, innermost-first replay, `dedupEvent`, queue release — 1/4 pinned;
`runHydrationEvents`' `matches` sort has 0 hits), `removeOwnedChildren` (0
hits, 208 B), the asset-gating permutations of `hydratedCreateLoadingBoundary`
(12/74 branches), `eventHandler`'s resume/shadow/portal arms (21/69),
`assignProp` (15/57), `setAttribute` (10/22), `setAttributeNS` and
`flattenClassList` (0 runtime hits; compiled apps reach both), and a
**compiled-template scenario** on the size gate.

### 6.5 Step plan with per-step size gates

Each step is its own PR off `next`, reports before/after on the same base,
is gated by `scripts/size` (every scenario ≤ cap) **plus** the step's own
expectation here; a step landing outside its band is the finding. Caps are
lowered at each landing (the ratchet). Brotli figures are CI's.

| step                                                 | content                                                                                                                                                                                                                                                                                                                                                                  | gate                                                                                                                                   | expected                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **S0**                                               | this audit                                                                                                                                                                                                                                                                                                                                                               | —                                                                                                                                      | done                                            |
| **S1 — gate + pins**                                 | add `app: compiled CSR` and `app: compiled hydrating` (the §1.3 fixture, compiled at build time by the harness through the Babel plugin, caps at CI-measured + 10 B); spec the 11 unpinned and 13 weakly pinned statements, the events group first; pin or delete `removeOwnedChildren`; branch tests for the asset-gating permutations                                  | 0 B on every existing scenario; the two new caps                                                                                       | ≈ +30 tests                                     |
| **S2 — C, the five cuts**                            | (1) ruling on 68's bare-id arm, then delete it and `waitAndResume`'s default; (2) one `afterAssets` helper; (3) dev-gate the four prod strings (ruling 92); (4) one marker walk (`getNextMarker` reused by `reclaimRegion`); (5) `cleanupFragment` moves beside the ledger (solid owns `pl-*`), `begin/endPass` replace the interceptors (frames' toggle becomes a call) | hydrating **≤ 17.30 KB**; CSR, floor, page base ±20 B                                                                                  | −0.35 to −0.45 KB br                            |
| **S3 — T1, the SC slots**                            | `publishFragmentLedger()` called from `installServerComponents`; a web `hydrationExt` slot for `claimRoots`/gather exclusion installed by the frames client; the live-takeover slot installed by the sf client's `live()` module                                                                                                                                         | hydrating **≤ 16.85 KB**; page base **≤ 44.95 KB** (+≈ 140 B min of slots); frames eager unchanged                                     | −0.45 to −0.5 KB br                             |
| **S4 — T2, the stream-adoption slot** (needs seam D) | the server records "this document serializes an async iterable / hybrid source"; the client installs `hydrateSignalFromAsyncIterable` + the hybrid handoff from that record through the `lazy()` manifest path (the SC audit's S3)                                                                                                                                       | hydrating **≤ 16.35 KB**; `hydrating + every store` moves by the same −0.65 KB; the compiled hydrating fixture −0.95 KB                | −0.5 to −0.55 KB br                             |
| **S5 — P, the props ruling and its seam**            | ruling: a plain-object spread source is read directly (own string keys, later sources win); `viewOf` only for `$PROXY` sources; `className`'s array/nested forms stay                                                                                                                                                                                                    | compiled CSR **≤ 16.3 KB** (from 17.50); page base −≈ 1 KB br (the `dynamic()` string-tag branch spreads too); CSR/floor/hydrating 0 B | −1.2 to −1.8 KB br                              |
| **S6 — D, delegation registration** (optional)       | `render` records the root; `delegateEvents` installs the attach for every recorded root                                                                                                                                                                                                                                                                                  | floor **≤ 9.20 KB**; CSR **≤ 12.20**; the compiled fixtures 0 B                                                                        | −0.63 KB br on the two hand-written floors only |
| **S7 — with-stores dedupe** (optional)               | one hybrid handoff body parameterised by the adopted-value sink (`prev` vs shadow draft); one conflating iterator for the store and signal shapes                                                                                                                                                                                                                        | `hydrating + every store` **≤ 27.9 KB**; no-stores scenarios 0 B                                                                       | ≈ −0.8 KB min / −0.25 KB br                     |

Expected end state: `app: hydrating (no stores)` **≈ 16.3 KB br** (−7.5 %;
≈ 47.8 KB min); the compiled hydrating fixture ≈ 20.3 KB br; compiled CSR ≈
16 KB br; the floor and CSR unchanged unless S6 is wanted. S1–S4 need one
ruling (68); S5 needs one; S2's interceptor change is an internal-surface
change frames must follow.

---

## 7. Open questions for the maintainer

1. **The bare-id boundary arm (ruling 68, §2.5).** The server writes a
   boundary's own id only as `"$$f"`; the client still handles an object
   record or a promise there, pinned by unit tests that hand-build `_$HY.r`.
   Delete the arm and retire those tests as a protocol the server no longer
   speaks — or is a sync-`renderToString` boundary with a settled promise
   under its own id a shape some integration still produces?
2. **SC hooks installed by the consumer (S3).** `_$HY.fr`, `claimRoots`, the
   frames exclusion and the live takeover exist for `@solidjs/web/frames` and
   `live()`. Is "the consumer installs the slot" (two internal installers on
   `solid-js/internal`, one on `@solidjs/web`) the right ownership, or
   should the frames client keep consuming what `hydrate()` publishes and the
   bytes stay on every hydrating app?
3. **Stream adoption keyed by a server record (S4).** The async-iterable /
   hybrid adapters are load-bearing (rulings 58–59, 55 specs) and cost every
   hydrating app 547 B br whether or not the document has a stream source.
   The server knows at serialization time. Is a record (`_$HY.r["_stream"]`)
   plus the seam-D preload an acceptable new wire fact — and should it ride
   the same mechanism the SC audit's S3 builds, or wait for it?
4. **`spread` and the view machinery (S5).** One `{...props}` on an element
   retains 6.9 KB min / 2.0 KB br because `spread` reads through the merge/
   omit view records so a `mergeProps()` proxy spreads without its traps. Is
   a plain-object path (direct own-key read; view read only when the source
   is `$PROXY`) consistent with the spread ruling as you hold it — "the union
   of own string keys, later sources winning, only the winning source read"?
   And is `mergeProps`' own 3.2 KB min / 0.86 KB br (the proxy-with-tables
   design) the intended price of a component spread?
5. **A compiled-template scenario on the gate (S1).** The suite's four app
   fixtures are hand-written DOM, so the attribute runtime, `mergeProps`,
   `spread` and the hydratable walk helpers are measured by no cap. Add the
   §1.3 pair (compiled at harness build time through the Babel plugin, which
   the harness already has as a workspace package), with caps at
   CI-measured + 10 B?
6. **Delegation registration (S6).** `render()` registers the delegated root
   eagerly, which costs the hand-written floors 636 B br they cannot use. A
   compiled hello world with any `onClick` keeps the bytes. Is the floor
   scenario meant to measure "render + one signal, no events" honestly (then
   S6 is right), or should the floor fixture compile a `<button onClick>` and
   the delegation bytes be accepted as the floor's?
7. **The interceptor seam (S2.5).** `sharedConfig.hydrating`/`done` as
   property interceptors let web drive solid by assignment (and frames
   toggles the flag for a synchronous render, ruling 101). Replace with
   `beginPass()`/`endPass()`/`markDone()` on `solid-js/internal` (≈ −150 B,
   and ruling 101 becomes a call)? It is a cross-package internal-surface
   change the frames client must follow in the same PR.
8. **Prod prose (ruling 92).** ≈ 330 B min of hydration error text ships in
   production (`lazy()` not preloaded, two preload-failure messages, two
   truncation messages). #2883 asked for pay-for-use diagnostics; dev-gate
   the text and keep a terse prod code, or is the prod text a deliberate
   support decision?
9. **`<template>` with children — compiler parity.** Babel compiles it, the
   native compiler rejects it (§2.4). The native refusal matches what the
   runtime's `template()` can do; should Babel adopt the same validation (a
   shared fixture expectation), and is that a separate issue?
10. **A renderToString-only hydration tier?** Removing streaming boundaries
    entirely measures −1,353 B br, but needs a new wire fact ("this document
    has no fragments"). Worth a record, or is streaming the default shape
    every hydrating app should pay for?
11. **With-stores duplication (S7).** The hybrid handoff and the conflating
    iterator each exist twice (signal-shaped and store-shaped), ≈ 850 B min
    in the with-stores bundle. Unify behind a sink parameter, or keep the
    two bodies separate on purpose (the comment at 1596–1600 says they
    follow "the same rules 1–6 on the same helpers")?

---

## 8. Housekeeping checked with this audit

`node check-floor-caps.mjs origin/next`: no cap raised.

**Caps that could be lowered to CI head + 10 B** (rounded up to 0.01 KB),
from the `ea5f1da07` CI run (37352390215) — the maintainer decides; none
lowered here:

| scenario                            |    CI head | cap          | head + 10 → cap       | lowerable                                                                                               |
| ----------------------------------- | ---------: | ------------ | --------------------- | ------------------------------------------------------------------------------------------------------- |
| signals: core floor                 |      7,319 | 7.33 KB      | 7,329 → 7.33          | at the rule                                                                                             |
| **signals: + createStore**          | **14,504** | **14.53 KB** | **14,514 → 14.52 KB** | **yes, 14.53 → 14.52** (inline `limit:` in `scenarios.js`)                                              |
| signals: + isPending/latest         |      9,456 | 9.47 KB      | 9,466 → 9.47          | at the rule                                                                                             |
| app: render + one signal            |      9,811 | 9.83 KB      | 9,821 → 9.83          | at the rule                                                                                             |
| app: hydrating (no stores)          |     17,648 | 17.66 KB     | 17,658 → 17.66        | at the rule                                                                                             |
| **app: hydrating + every store**    | **28,736** | **28.80 KB** | **28,746 → 28.75 KB** | **yes, 28.80 → 28.75** (inline `limit:`)                                                                |
| app: CSR                            |     12,815 | 12.82 KB     | 12,825 → 12.83        | no (head + 5)                                                                                           |
| app: CSR, observe tier              |     14,388 | 14.39 KB     | 14,398 → 14.40        | no (head + 2)                                                                                           |
| **app: CSR, observe + attribution** | **28,587** | **28.62 KB** | **28,597 → 28.60 KB** | **yes, 28.62 → 28.60** (inline `limit:`; the SC audit read 28,612 at `6f77b1bde` — #3798 took 25 B off) |
| frames: eager client consumer       |     13,770 | 13.78 KB     | 13,780 → 13.78        | at the rule                                                                                             |
| page: base server components        |     44,829 | 44.84 KB     | 44,839 → 44.84        | at the rule                                                                                             |
| page: live server components        |     48,454 | 48.47 KB     | 48,464 → 48.47        | at the rule                                                                                             |
| server: floor                       |      1,331 | 1.34 KB      | 1,341 → 1.35          | no (head + 9)                                                                                           |
| server: renderToString              |     20,412 | 20.42 KB     | 20,422 → 20.43        | no (head + 8)                                                                                           |

Also noted, not changed: `packages/solid/test/cross-package-fields.spec.ts`
fails in a worktree built with `--filter='!./examples/*'
--filter='!test-integration'` because it scans `packages/universal/dist`,
which that filter set does not build (the suite's one failure in §2.5).

---

## 9. Reproducing

All measurement scripts live outside the repo under `/tmp/sw-fn/` and are
reproducible from this document:

- `fnmap.mjs <scenario> [--module s] [--json f]` — source-map function
  attribution (the SC audit's tool with its paths pointed at this worktree;
  acorn + `@jridgewell/trace-mapping` from the workspace's `node_modules`,
  Rolldown from `scripts/size/node_modules`); it also knows the two
  compiled scenarios (`compiled/measure.mjs`). `group.mjs` (per-package
  totals, the CSR→hydrating / compiled deltas, per-module tables with source
  lookup), `concerns.mjs` (the §1.2/§2.1 grouping — the function → concern
  map is in the file), `variants.mjs` (the §5 dist-copy edits, output
  `variants.out`), `compiled/compile.mjs` + `compiled/app.jsx` (the §1.3
  fixture through `packages/babel-plugin/index.js`).
- JSON: `fn-{floor,csr,hyd,hydstore,base,ccsr,chyd}.json`, `baseline.json`;
  tables `table-*.md`, `delta-*.md`; `ci-head-ea5f1da07.txt`.
- Rulings: `rulings-hydration.md`, `spec-titles-hydration.txt`,
  `pr-bodies-hydration.txt`.
- Compilers: `compiler-helpers.md`/`.json`, `web-exports.json`,
  `compiler-probe/` (30 fixtures × {dom, hydratable} × {babel, native}, 7 ×
  ssr; `run.cjs`, `extra.cjs`, `compare.cjs`, `exports.cjs`).
- Coverage: `cov-{hydrate,client,solid}/coverage-final.json`, merged by
  `covjoin.mjs` into `coverage-report.md`. Commands: in `packages/web`,
  `npx vitest run [--config vite.config.hydrate.mjs] --coverage
--coverage.provider=v8 --coverage.reporter=json
--coverage.reportsDirectory=/tmp/sw-fn/cov-<name> --coverage.all=false
--coverage.include='src/**/*.ts'
--coverage.include='**/packages/solid/dist/solid.dev.js'
--coverage.allowExternal=true`; in `packages/solid`, the same with
  `--coverage.include='src/client/**/*.ts' --coverage.include='src/*.ts'`.
  The web server suite was not run (its artifact recorder writes into the
  tree). The web specs need the native compiler binary; a fresh worktree
  requires `pnpm run build:debug` in `packages/compiler` first (produces only
  the gitignored `compiler.node`). Joined output: `/tmp/sw-fn/coverage-report.md`,
  `coverage-findings.md`, `coverage-summary.json`.
- CI numbers: `gh run view 37352390215 --repo solidjs/solid --log | grep
brotli`.

---

## Appendix A — CSR → hydrating (no stores), every unit (minified B, exact)

`/tmp/sw-fn/delta-csr-hyd.md`; 148 units, +15,959 B. Sorted by Δ.

|                            Δ min B |   CSR | hydrating | unit                                                                                                                        | module                   |
| ---------------------------------: | ----: | --------: | --------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
|                             +1,584 |     0 |     1,584 | `hydrate`                                                                                                                   | web                      |
|                             +1,240 |     0 |     1,240 | `hydratedCreateLoadingBoundary`                                                                                             | solid                    |
|                               +602 |     0 |       602 | `enableHydration`                                                                                                           | solid                    |
|                               +599 |    67 |       666 | `<module>`                                                                                                                  | solid                    |
|                               +596 |     0 |       596 | `hydrateSignalLike`                                                                                                         | solid                    |
|                               +532 |     0 |       532 | `installHydrationRuntime`                                                                                                   | web                      |
|                               +522 |     0 |       522 | `rejectTruncatedRefs`                                                                                                       | solid                    |
|                               +465 |     0 |       465 | `readSerializedOrCompute`                                                                                                   | solid                    |
|                               +411 |     0 |       411 | `normalizeIterator`                                                                                                         | solid                    |
|                               +367 |     0 |       367 | `hydrateSignalFromAsyncIterable`                                                                                            | solid                    |
|                               +332 |     0 |       332 | `gatherHydratable`                                                                                                          | web                      |
|                               +321 |     0 |       321 | `resumeBoundaryHydration`                                                                                                   | solid                    |
|                               +312 |     0 |       312 | `loadModuleAssets`                                                                                                          | web                      |
|                               +309 |     0 |       309 | `subFetch`                                                                                                                  | solid                    |
|                               +291 |     0 |       291 | `waitAndResume`                                                                                                             | solid                    |
|                               +286 |     0 |       286 | `watchTruncation`                                                                                                           | solid                    |
|                               +276 |     0 |       276 | `markTruncated`                                                                                                             | solid                    |
|                               +275 |   826 |     1,101 | `insertExpression`                                                                                                          | web                      |
|                               +271 |     0 |       271 | `initBoundaryResume`                                                                                                        | solid                    |
|                               +258 |     0 |       258 | `lazyHydrationLookup`                                                                                                       | solid                    |
|                               +255 |     0 |       255 | `wrapFirstYield`                                                                                                            | solid                    |
|                               +214 |     0 |       214 | `readHydratedValue`                                                                                                         | solid                    |
|                               +203 |     0 |       203 | `hydratedEffect`                                                                                                            | solid                    |
|                               +199 |     0 |       199 | `adoptedAnswerStream`                                                                                                       | solid                    |
|                               +190 |     0 |       190 | `hydratedCreateErrorBoundary`                                                                                               | solid                    |
|                               +181 |     0 |       181 | `claimChildNodes`                                                                                                           | web                      |
|                               +177 |     0 |       177 | `drainHydrationCallbacks`                                                                                                   | solid                    |
|                               +165 |     0 |       165 | `stripTextSeparators`                                                                                                       | web                      |
|                               +158 |     0 |       158 | `releaseSubtree`                                                                                                            | signals core             |
|                               +155 |     0 |       155 | `armLiveTakeover`                                                                                                           | solid                    |
|                               +146 |     0 |       146 | `anyFragmentPending`                                                                                                        | solid                    |
|                               +134 |     0 |       134 | `<module>`                                                                                                                  | hydrating-app.js (entry) |
|                               +131 |     0 |       131 | `scheduleResumeAfterAssets`                                                                                                 | solid                    |
|                               +129 |     0 |       129 | `hydrationGetNextContextId`                                                                                                 | solid                    |
|                               +127 |     0 |       127 | `fragmentParked`                                                                                                            | solid                    |
|                               +125 |     0 |       125 | `fragmentSuperseded`                                                                                                        | solid                    |
|                               +121 |     0 |       121 | `getContext`                                                                                                                | signals context          |
|                               +119 |   793 |       912 | `read`                                                                                                                      | signals core             |
|                               +116 |     0 |       116 | `isPlaceholderScaffolding`                                                                                                  | web                      |
|                               +112 |   479 |       591 | `insert`                                                                                                                    | web                      |
|                               +109 |     0 |       109 | `reportAssetFailure`                                                                                                        | solid                    |
|                               +105 |     0 |       105 | `liveScopeOf`                                                                                                               | solid                    |
|                               +104 |     0 |       104 | `takeOver`                                                                                                                  | solid                    |
|                               +102 |     0 |       102 | `fragmentPending`                                                                                                           | solid                    |
|                               +100 |     0 |       100 | `captureWriteSnapshot`                                                                                                      | signals core             |
|                               +100 |     0 |       100 | `forwardIteratorReturn`                                                                                                     | solid                    |
|                                +93 |     0 |        93 | `hasLoadingWindow`                                                                                                          | solid                    |
|                                +89 |     0 |        89 | `isClaiming`                                                                                                                | solid                    |
|                                +88 |     0 |        88 | `onHydrationEnd`                                                                                                            | solid                    |
|                                +87 |     0 |        87 | `markTopLevelSnapshotScope`                                                                                                 | solid                    |
|                                +84 |     0 |        84 | `whenRevealed`                                                                                                              | solid                    |
|                                +82 |    99 |       181 | `setupComputedNode`                                                                                                         | signals core             |
|                                +81 |     0 |        81 | `clearSnapshots`                                                                                                            | signals core             |
|                                +81 |     0 |        81 | `fragmentPolicy`                                                                                                            | solid                    |
|                                +76 |     0 |        76 | `hydratedCreateSignal`                                                                                                      | solid                    |
|                                +74 |     0 |        74 | `isAsyncIterable`                                                                                                           | solid                    |
|                                +73 |     0 |        73 | `replayHeldFragment`                                                                                                        | solid                    |
|                                +72 |     0 |        72 | `createBoundaryTrigger`                                                                                                     | solid                    |
|                                +71 |     0 |        71 | `releaseLiveScope`                                                                                                          | solid                    |
|                                +68 |     0 |        68 | `withHydrationGate`                                                                                                         | solid                    |
|                                +62 |     0 |        62 | `ownerInSnapshotScope`                                                                                                      | signals core             |
|                                +62 |     0 |        62 | `MockPromise.withResolvers`                                                                                                 | solid                    |
|                                +59 |     0 |        59 | `hydratedCreateRoot`                                                                                                        | solid                    |
|                                +58 |     0 |        58 | `fragmentState`                                                                                                             | solid                    |
|                                +57 |   162 |       219 | `signal`                                                                                                                    | signals core             |
|                                +54 |     0 |        54 | `setSnapshotCapture`                                                                                                        | signals core             |
|                                +54 |     0 |        54 | `fragmentAbort`                                                                                                             | solid                    |
|                                +53 |     0 |        53 | `hydratedCreateMemo`                                                                                                        | solid                    |
|                                +52 |    52 |       104 | `<module>`                                                                                                                  | signals error            |
|                                +49 |     0 |        49 | `releaseFragment`                                                                                                           | solid                    |
|                                +49 |     0 |        49 | `subscribeFragments`                                                                                                        | solid                    |
|                                +45 |     0 |        45 | `isHydrationInProgress`                                                                                                     | solid                    |
|                                +45 |     0 |        45 | `noHydrationId`                                                                                                             | solid                    |
|                                +39 |     0 |        39 | `hydratedCreateRenderEffect`                                                                                                | solid                    |
|                                +38 |     0 |        38 | `claimFragment`                                                                                                             | solid                    |
|                                +37 |     0 |        37 | `syncThenable`                                                                                                              | solid                    |
|                                +36 | 1,009 |     1,045 | `eventHandler`                                                                                                              | web                      |
|                                +33 |     0 |        33 | `releaseSnapshotScope`                                                                                                      | signals core             |
|                                +32 |     0 |        32 | `isDisposed`                                                                                                                | signals owner            |
|                                +31 |     0 |        31 | `peekNextChildId`                                                                                                           | signals owner            |
|                                +31 |     0 |        31 | `checkHydrationComplete`                                                                                                    | solid                    |
|                                +28 |     0 |        28 | `onCleanup`                                                                                                                 | signals                  |
|                                +25 |     0 |        25 | `openLiveScope`                                                                                                             | solid                    |
|                                +24 |     0 |        24 | `NoOwnerError#constructor`                                                                                                  | signals error            |
|                                +24 |     0 |        24 | `ContextNotFoundError#constructor`                                                                                          | signals error            |
|                                +23 |     0 |        23 | `markSnapshotScope`                                                                                                         | signals core             |
|                                +23 |     0 |        23 | `MockPromise#finally`                                                                                                       | solid                    |
|                                +21 |     0 |        21 | `MockPromise#catch`                                                                                                         | solid                    |
|                                +20 |     0 |        20 | `MockPromise#then`                                                                                                          | solid                    |
|                                +15 |     0 |        15 | `MockPromise.k`                                                                                                             | solid                    |
|                                +13 |   459 |       472 | `computed`                                                                                                                  | signals core             |
|                                +13 |   389 |       402 | `createEffectNode`                                                                                                          | signals core             |
|                                +12 |    76 |        88 | `<module>`                                                                                                                  | signals core             |
|                                +11 |   287 |       298 | `setSignal`                                                                                                                 | signals core             |
|                                +11 |   202 |       213 | `<module>`                                                                                                                  | web                      |
|                                +10 | 1,047 |     1,057 | `createBoundary`                                                                                                            | signals boundaries       |
|                                +10 |     0 |        10 | `TAKEN`                                                                                                                     | solid                    |
|                                 +9 | 1,969 |     1,978 | `recompute`                                                                                                                 | signals core             |
|                                 +8 |     0 |         8 | `then`                                                                                                                      | solid                    |
|                                 +7 | 2,259 |     2,266 | `updateKeyedMap`                                                                                                            | signals map              |
|                              +6 ×5 |       |           | `createMemo`, `createErrorBoundary`, `createRoot`, `createRenderEffect`, `createLoadingBoundary` wrappers                   | solid                    |
|                              +5 ×3 |       |           | `<module>` (constants), `GlobalQueue#settle`, `createSignal` wrapper                                                        | signals / solid          |
| +3 ×2, +2 ×2, +1 ×24, −1 ×6, −2 ×2 |       |           | re-minification noise across shared signals units; `lazy` −1, `For` −1, `render` −1, `normalize` −1, `isHydrating` −4 (web) |                          |
|                               −134 |   134 |         0 | `<module>`                                                                                                                  | csr-app.js (entry)       |

## Appendix B — every `solid-js` + `@solidjs/web` unit in `app: hydrating (no stores)`

105 units, 22,683 B (`/tmp/sw-fn/table-hyd-solid.md`, `table-hyd-web.md`).
Concern letters: **HB** boundaries · **HA** adapters · **HR** entry · **HC**
lifecycle · **HW** claim walk · **HL** live takeover · **HZ** lazy/assets ·
**HI** ids · **DI** insert/reconcile · **DE** events · **RE** render/module ·
**FC** flow · **CM** component model · **SM** module scope.

| unit                                                                 | pkg            | concern |             min B |
| -------------------------------------------------------------------- | -------------- | ------- | ----------------: |
| `hydrate`                                                            | web            | HR      |             1,584 |
| `reconcileArrays`                                                    | web            | DI      |             1,381 |
| `hydratedCreateLoadingBoundary`                                      | solid          | HB      |             1,240 |
| `insertExpression`                                                   | web            | DI      |             1,101 |
| `eventHandler`                                                       | web            | DE      |             1,045 |
| `<module>`                                                           | solid          | SM      |               666 |
| `enableHydration`                                                    | solid          | HC      |               602 |
| `hydrateSignalLike`                                                  | solid          | HA      |               596 |
| `insert`                                                             | web            | DI      |               591 |
| `installHydrationRuntime`                                            | web            | HW      |               532 |
| `rejectTruncatedRefs`                                                | solid          | HB      |               522 |
| `readSerializedOrCompute`                                            | solid          | HA      |               465 |
| `normalizeIterator`                                                  | solid          | HA      |               411 |
| `hydrateSignalFromAsyncIterable`                                     | solid          | HA      |               367 |
| `gatherHydratable`                                                   | web            | HR      |               332 |
| `resumeBoundaryHydration`                                            | solid          | HB      |               321 |
| `lazy`                                                               | solid          | CM      |               320 |
| `cleanChildren`                                                      | web            | DI      |               312 |
| `loadModuleAssets`                                                   | web            | HZ      |               312 |
| `render`                                                             | web            | RE      |               309 |
| `subFetch`                                                           | solid          | HA      |               309 |
| `normalize`                                                          | web            | DI      |               305 |
| `ownsAllChildren`                                                    | web            | DI      |               302 |
| `waitAndResume`                                                      | solid          | HB      |               291 |
| `watchTruncation`                                                    | solid          | HB      |               286 |
| `Show`                                                               | solid          | FC      |               282 |
| `markTruncated`                                                      | solid          | HB      |               276 |
| `initBoundaryResume`                                                 | solid          | HB      |               271 |
| `lazyHydrationLookup`                                                | solid          | HZ      |               258 |
| `wrapFirstYield`                                                     | solid          | HA      |               255 |
| `readHydratedValue`                                                  | solid          | HA      |               214 |
| `<module>`                                                           | web            | RE      |               213 |
| `removeOwnedChildren`                                                | web            | DI      |               208 |
| `registerDelegatedContainer`                                         | web            | DE      |               206 |
| `hydratedEffect`                                                     | solid          | HA      |               203 |
| `adoptedAnswerStream`                                                | solid          | HA      |               199 |
| `unregisterDelegatedContainer`                                       | web            | DE      |               198 |
| `isHydrating`                                                        | web            | HW      |               191 |
| `hydratedCreateErrorBoundary`                                        | solid          | HA      |               190 |
| `For`                                                                | solid          | FC      |               187 |
| `claimChildNodes`                                                    | web            | HW      |               181 |
| `tagHost`                                                            | web            | DI      |               178 |
| `drainHydrationCallbacks`                                            | solid          | HC      |               177 |
| `stripTextSeparators`                                                | web            | HW      |               165 |
| `armLiveTakeover`                                                    | solid          | HL      |               155 |
| `anyFragmentPending`                                                 | solid          | HB      |               146 |
| `scheduleResumeAfterAssets`                                          | solid          | HB      |               131 |
| `hydrationGetNextContextId`                                          | solid          | HI      |               129 |
| `fragmentParked`                                                     | solid          | HB      |               127 |
| `fragmentSuperseded`                                                 | solid          | HB      |               125 |
| `findOwner`                                                          | web            | DE      |               122 |
| `isPlaceholderScaffolding`                                           | web            | HW      |               116 |
| `attachDelegatedEvent`                                               | web            | DE      |               110 |
| `reportAssetFailure`                                                 | solid          | HB      |               109 |
| `liveScopeOf`                                                        | solid          | HL      |               105 |
| `takeOver`                                                           | solid          | HL      |               104 |
| `Errored`                                                            | solid          | FC      |               104 |
| `fragmentPending`                                                    | solid          | HB      |               102 |
| `appendNodes`                                                        | web            | DI      |               100 |
| `forwardIteratorReturn`                                              | solid          | HA      |               100 |
| `Loading`                                                            | solid          | FC      |                94 |
| `hasLoadingWindow`                                                   | solid          | HA      |                93 |
| `isClaiming`                                                         | solid          | HC      |                89 |
| `onHydrationEnd`                                                     | solid          | HC      |                88 |
| `markTopLevelSnapshotScope`                                          | solid          | HC      |                87 |
| `whenRevealed`                                                       | solid          | HB      |                84 |
| `fragmentPolicy`                                                     | solid          | HB      |                81 |
| `unregisterDelegatedRoot`                                            | web            | DE      |                79 |
| `hydratedCreateSignal`                                               | solid          | HA      |                76 |
| `effect`                                                             | web            | RE      |                76 |
| `isAsyncIterable`                                                    | solid          | HA      |                74 |
| `replayHeldFragment`                                                 | solid          | HB      |                73 |
| `createBoundaryTrigger`                                              | solid          | HB      |                72 |
| `releaseLiveScope`                                                   | solid          | HL      |                71 |
| `withHydrationGate`                                                  | solid          | HA      |                68 |
| `MockPromise.withResolvers`                                          | solid          | HA      |                62 |
| `hydratedCreateRoot`                                                 | solid          | HC      |                59 |
| `fragmentState`                                                      | solid          | HB      |                58 |
| `registerDelegatedRoot`                                              | web            | DE      |                57 |
| `fragmentAbort`                                                      | solid          | HB      |                54 |
| `hydratedCreateMemo`                                                 | solid          | HA      |                53 |
| `releaseFragment`                                                    | solid          | HB      |                49 |
| `subscribeFragments`                                                 | solid          | HB      |                49 |
| `isHydrationInProgress`                                              | solid          | HC      |                45 |
| `noHydrationId`                                                      | solid          | HI      |                45 |
| `createComponent`                                                    | solid          | CM      |                43 |
| `hydratedCreateRenderEffect`                                         | solid          | HA      |                39 |
| `claimFragment`                                                      | solid          | HB      |                38 |
| `syncThenable`                                                       | solid          | HA      |                37 |
| `narrowedError`                                                      | solid          | FC      |                32 |
| `checkHydrationComplete`                                             | solid          | HC      |                31 |
| `createLoadingBoundary` wrapper                                      | solid          | HB      |                28 |
| `createErrorBoundary` / `createRoot` / `createRenderEffect` wrappers | solid          | HA/HC   |             26 ×3 |
| `openLiveScope`                                                      | solid          | HL      |                25 |
| `createMemo` / `createSignal` wrappers                               | solid          | HA      |             25 ×2 |
| `MockPromise#finally` / `#catch` / `#then` / `.k`                    | solid          | HA      | 23 / 21 / 20 / 15 |
| `TAKEN`                                                              | solid          | HL      |                10 |
| `<module>`                                                           | solid internal | SM      |                10 |
| `then`                                                               | solid          | HA      |                 8 |

## Appendix C — every `solid-js` + `@solidjs/web` unit in `app: CSR`

35 units, 7,920 B (`/tmp/sw-fn/table-csr-web.md`, `table-csr-solid.md`).
The floor scenario's web is the same 20 units at 6,640 B (`insertExpression`
822, `insert` 479, `normalize` 305, `isHydrating` 191, module scope 201;
the rest identical); its solid is 108 B (`<module>` 53, the six wrappers 20
B each less what `createRoot` shares).

| unit                                                                                  | pkg            | concern          | min B |
| ------------------------------------------------------------------------------------- | -------------- | ---------------- | ----: |
| `reconcileArrays`                                                                     | web            | DI               | 1,381 |
| `eventHandler`                                                                        | web            | DE               | 1,009 |
| `insertExpression`                                                                    | web            | DI               |   826 |
| `insert`                                                                              | web            | DI               |   479 |
| `lazy`                                                                                | solid          | CM               |   321 |
| `cleanChildren`                                                                       | web            | DI               |   312 |
| `render`                                                                              | web            | RE               |   310 |
| `normalize`                                                                           | web            | DI               |   306 |
| `ownsAllChildren`                                                                     | web            | DI               |   302 |
| `Show`                                                                                | solid          | FC               |   282 |
| `removeOwnedChildren`                                                                 | web            | DI               |   208 |
| `registerDelegatedContainer`                                                          | web            | DE               |   206 |
| `<module>`                                                                            | web            | RE               |   202 |
| `unregisterDelegatedContainer`                                                        | web            | DE               |   198 |
| `isHydrating`                                                                         | web            | HW (CSR residue) |   195 |
| `For`                                                                                 | solid          | FC               |   188 |
| `tagHost`                                                                             | web            | DI               |   178 |
| `findOwner`                                                                           | web            | DE               |   122 |
| `attachDelegatedEvent`                                                                | web            | DE               |   110 |
| `Errored`                                                                             | solid          | FC               |   104 |
| `appendNodes`                                                                         | web            | DI               |   100 |
| `Loading`                                                                             | solid          | FC               |    94 |
| `unregisterDelegatedRoot`                                                             | web            | DE               |    79 |
| `effect`                                                                              | web            | RE               |    76 |
| `<module>`                                                                            | solid          | SM               |    67 |
| `registerDelegatedRoot`                                                               | web            | DE               |    57 |
| `createComponent`                                                                     | solid          | CM               |    43 |
| `narrowedError`                                                                       | solid          | FC               |    32 |
| `createLoadingBoundary` wrapper                                                       | solid          | HB               |    22 |
| `createSignal` / `createErrorBoundary` / `createRoot` / `createRenderEffect` wrappers | solid          | HA/HC            | 20 ×4 |
| `createMemo` wrapper                                                                  | solid          | HA               |    19 |
| `<module>`                                                                            | solid internal | SM               |    12 |
