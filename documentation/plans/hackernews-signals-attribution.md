# HackerNews — `@solidjs/signals` on the eager graph, module by module (2026-10-07)

Measurement only; no source changes. Branch `audit/hn-signals-attribution`
off `next` @ `be82cf3e2` carries this document and nothing else.

**Measured on:** `next` @ `be82cf3e2` (#3877) + #3838 @ `59f4994f4`
(`size/page-router-scenario`, the router wiring the HN scenario stacks on)

- #3879's one commit (`size/hackernews-scenario`, cherry-picked) — a detached
  HEAD in the `.wt/hn` worktree (`4228d1859`), fresh build (`@solidjs/compiler`
  `pnpm build`, `turbo run build --force`), harness `scripts/size` as #3879
  leaves it. The same measurements were first taken on `next` @ `7233451ee`
  (#3860) with the same base stack and are byte-identical: #3877 is
  engine-only, as its ledger note says.

The question: **on `page: hackernews`, which `@solidjs/signals` code is in
the eager bundle, module by module — and is the store engine (`store.ts`,
`reconcile`, `projection`, `optimistic`/lanes, `store/utils` merge/omit,
`createStore`) being pulled in, by which eager importer?** #3879's body
attributed signals at 64,308 B minified on its base (`49a8dca84` + #3838),
with `store/store.js` 18,081 of it — the frames client's container-trace
materializer — and the lanes 7,626 retained by the router's navigation core.

**Answer in one paragraph.** On current `next` the store _engine_ is **not
in HN's eager graph**: `store/store.js`, `store/reconcile.js`,
`store/projection.js` and `store/target.js` live in the lazy `trace.js` chunk
(25,470 B min / 8,202 B br, with `solid-js/internal/container-trace` and the
frames trace tier — #3860's tier split moved them), `store/optimistic.js`,
`store/storePath.js` and `store/affects.js` are shaken out of every chunk,
and `core/action.js` is in the router's lazy `serverForms.js`. Signals on HN
is **37,901 B minified** (26 % of the page's 145,323 / 47,780 br; the
harness's apportioned figure is 40,885), **+17,724 above the `signals: core
floor`** (20,177). What is above the floor, in order: the **lanes/verdict
6,683** (`core/lanes.js` 4,764 + `core/verdict.js` 1,919) retained only by
the router reading `isPending`/`latest` in `createRouterContext` and
`onSettled` in `createIntegration` — the navigation core, as solid-router#655
records; the **store residue 4,430** — `store/utils.js` 3,641 (the
merge/omit **view readers**: `mergeLookup`, `omitTable`, `mergeTable`,
`collectKeys`, `sourceKeys`, `resolvedTable`, `OmitView`/`MergeView` …) and
`store/types.js` 789 — retained by **`dynamic()`'s element arm**:
`dynamic → dynamicCore(…, staticElement) → spread(el, props)`, which reads
props through the view records because a prop source's kind is a runtime
value; the example's four `dynamic()` mounts (app.tsx's nav and the three
routes) are the only consumers, nothing in the frames client, the router or
the sf client touches a store; **`boundaries.js` 3,063** (`<Loading>` ×2,
the plugin's `DefaultErrorBoundary`, the frames client's hold boundary);
**core growth 1,070** (hydration's snapshot scope and the frame read:
`captureWriteSnapshot`, `clearSnapshots`, `markSnapshotScope`,
`setSnapshotCapture`, `ownerInSnapshotScope`, `releaseSubtree`,
`slotSignal`); `flatten.js` 666, `core/error-hooks.js` 519, `context` 210,
`trackedEffect` 225 (`onSettled`'s owner form), and ~400 B of small wrappers.
`mergeProps`/`omit`/`splitProps` themselves are **not** on the page (0 B of
`merge`, `omit`, `mergeView`, `omitView`); the solid-js **store hydration
adapters are** (2,821 B of `solid.js`, not signals: `hydrateStoreLike`,
`hydrateStoreFromAsyncIterable`, `createShadowDraft`, `applyPatches`,
`quietAnswer`, `withStoreHydration`), pinned by `enableHydration`'s slot
install and read by the lazy trace tier — the hydration-split document's (a).
Every one of these was confirmed by a cut on an edited dist copy (§3, §4): on
`dynamicComponent` HN sheds the whole store residue and the spread runtime
(**−7,987 / −2,339 br**); without the router's lane reads the whole of
`lanes.js`+`verdict.js` leaves (**−8,414 / −4,337**, ≈ −3.0 KB br of code
once the two-file layout cost is netted out); the adapters are **−2,625 /
−585**. All four at once: **126,284 / 40,511** (−19,039 / −7,269, −15 %),
with signals at 26,635 — 6,458 above the floor, all of it boundaries,
`flatten`, the error hook and hydration's core growth. No dev-only code
reaches the prod signals on this page (no `_SOLID_DEV_`/`__DEV__` residue; the
prose present is `"[REACTIVITY_HALTED]"` and the error class names).

---

## 1. Method

- **Build.** `pnpm install --frozen-lockfile`, `@solidjs/compiler` built
  (`napi build --release`), `turbo run build --force`; `scripts/size`'s
  pinned Rolldown 1.2.11. Every scenario matches the ledger: `signals: core
floor` 20,177 / 7,382, `+ createStore` 44,437 / 14,603, `+ isPending/latest`
  27,020 / 9,570, `page: compiled base SC` 109,300 / 35,079, `page: base +
router` 144,082 / 45,940 (#3838's re-based number), **`page: hackernews`
  145,323 / 47,780** — the entry 60,843 / 20,410 plus the eager `client.js`
  84,480 / 27,370 Rolldown hoists for the modules the lazy chunks share with
  the entry (bundle.mjs counts it; `attribute.mjs` reports both). #3879's
  recorded 176,581 / 54,557 was on `49a8dca84` + #3838; the −31,258 /
  −6,777 between them is `next`'s #3860 (the frames tiers) and #3838's
  re-base, and the scenario's inline cap will come down when #3879 re-bases.
- **Attribution.** `scripts/size/attribute.mjs` for the harness's per-module
  figures (standalone minify per module, apportioned to the chunk), and the
  frames-A0 / hydration-split source-map tool (`tmp-tools/fnmap.mjs`, git-
  excluded) for exact bytes: every mapped byte of every eager chunk charged
  to the innermost named function of its dist source; the pieces sum to the
  eager graph (889 B of cross-chunk import/export glue is the unmapped
  residue). The tables below use the source-map figures (they sum); the
  apportioned column is given once for the record.
- **Chunk ownership.** Rolldown's output, every chunk's module list
  (`tmp-tools/chunk-modules.mjs`), so "in the eager graph" and "in which
  lazy chunk" are read off the bundler, not inferred.
- **Cuts** (`tmp-tools/cuts.mjs`, `run.mjs`): exact-string edits over verbatim
  copies of `solid.js`, `web.js`, `container-trace.js`, `internal.js`, the
  frames `client.js`, the whole `signals/dist/prod/` tree, the router's
  `solid`-condition dist and the example's `src/`, under `tmp-tools/dist/
<variant>/` with the packages' `sideEffects: false` replicated (without it
  Rolldown keeps every module-level statement: +35 KB). Measured with the
  copies overriding the originals in the same bundler configuration. The
  verbatim variant (`L0`) reproduces the unedited numbers to the byte on
  both pages. The repo dists, the router install and the example are never
  touched.
- **Brotli.** Firm where a cut isolates a group; ≈ at 0.30 (the ratio the
  measured cuts cluster around, 0.22–0.36) where it does not, marked ≈. The
  eager graph is two files on HN; brotli'd as one file it would be 46,445 —
  a **1,335 B layout cost** that any cut collapsing the graph to one file
  recovers on top of its code (§4 nets it out where it happens).

## 2. Signals on HN by module

Exact minified bytes on the eager graph, with the group each module belongs
to and brotli by cut where a cut isolates the group.

| module                                                                                               | group                | HN (exact) | HN (attribute.mjs) | retained by                                                                                                                                                                                                                                                             |                                                                          br by cut |
| ---------------------------------------------------------------------------------------------------- | -------------------- | ---------: | -----------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------: |
| `core/core.js`                                                                                       | core                 |      7,407 |              8,504 | everything; +1,070 over the floor is hydration's snapshot scope and frame read (`captureWriteSnapshot`, `clearSnapshots`, `markSnapshotScope`, `setSnapshotCapture`, `ownerInSnapshotScope`, `releaseSubtree`, `slotSignal`)                                            |                                                               ≈ 2,200 (core group) |
| `core/scheduler.js`                                                                                  | core                 |      5,303 |              5,767 | the floor; +259: `ownFlights`, `enterAction`/`exitAction`, `setQuestion`/`nextQuestion`                                                                                                                                                                                 |                                                                                  — |
| `core/lanes.js`                                                                                      | **lanes/optimistic** |  **4,764** |              5,343 | the router: `isPending(source)`/`latest(source)` in `createRouterContext` (`isRouting`, `transitionIntent`, `pendingNavigation`, the redirect depth), `onSettled` in `createIntegration`                                                                                | **−3,002 measured** (lanes + verdict together, one-file basis; −4,337 as measured) |
| `core/async.js`                                                                                      | async                |      3,974 |              4,012 | the floor (`handleAsync` 1,654, status propagation); no `createAsync`/flight code of its own on this page                                                                                                                                                               |                                                                            ≈ 1,200 |
| `store/utils.js`                                                                                     | **store residue**    |  **3,641** |              3,425 | `web.js` `spread` through `dynamic()`'s element arm; `readShallow` inside it                                                                                                                                                                                            |          **−959 measured** (stub, with `types.js`); −1,682 with web's view readers |
| `boundaries.js`                                                                                      | boundaries           |      3,063 |              3,184 | `<Loading>` ×2 (app.tsx), `DefaultErrorBoundary` (`Errored`), the frames client's hold boundary (`createLoadingBoundary` from `solid-js/internal`), hydration's boundary installs                                                                                       |                                                                              ≈ 900 |
| `core/verdict.js`                                                                                    | **lanes/optimistic** |  **1,919** |              2,682 | as `lanes.js` (`verdictValue` 863, `isPending` 150, `latest` 76, `observeFlight`, `quietPending`)                                                                                                                                                                       |                                                                       (with lanes) |
| `core/owner.js`                                                                                      | core                 |      1,576 |              1,543 | the floor; +125 small accessors                                                                                                                                                                                                                                         |                                                                                  — |
| `core/effect.js`                                                                                     | core                 |      1,061 |              1,140 | the floor; +225 `trackedEffect` (`onSettled` under an owner)                                                                                                                                                                                                            |                                                                                  — |
| `core/heap.js`                                                                                       | core                 |      1,040 |                996 | the floor                                                                                                                                                                                                                                                               |                                                                                  — |
| `core/graph.js`                                                                                      | core                 |        877 |                861 | the floor                                                                                                                                                                                                                                                               |                                                                                  — |
| `store/types.js`                                                                                     | **store residue**    |    **789** |                789 | `store/utils.js` (`ownEnumerableKeys`, the brand symbols) and `web.js`'s `$PROXY`; **523 of it (`isWrappable`, `markRawIngest`, `markRawOne`, `isRawValue`, `setWriteOverride`) is used only by the lazy `trace.js` and sits eager because the module is pinned eager** |                                                                      (in the −959) |
| `flatten.js`                                                                                         | core (solid glue)    |        666 |                568 | `children()`/`insert`                                                                                                                                                                                                                                                   |                                                                              ≈ 200 |
| `core/error-hooks.js`                                                                                | error boundary       |        519 |                461 | `createErrorBoundary` → `reportClientError` (the production `configureClientErrors` hook; `labels` walks `_name`) — a prod feature, not dev residue                                                                                                                     |                                                                              ≈ 150 |
| `signals.js`                                                                                         | core                 |        477 |                537 | wrappers; +165 `onSettled` 125, `createRenderEffect`, `onCleanup`                                                                                                                                                                                                       |                                                                                  — |
| `core/error.js`                                                                                      | core                 |        436 |                404 | `NotReadyError`, `StatusError`, `NoOwnerError`, `ContextNotFoundError` (no `TimeoutError`)                                                                                                                                                                              |                                                                                  — |
| `core/context.js`                                                                                    | core                 |        210 |                221 | the router's `createContext`/`useContext`                                                                                                                                                                                                                               |                                                                                  — |
| `core/constants.js`                                                                                  | core                 |        179 |                448 | flags; 84 of it leaves with the lanes                                                                                                                                                                                                                                   |                                                                                  — |
| `store/store.js`, `store/reconcile.js`, `store/projection.js`, `store/target.js`                     | **store engine**     |      **0** |                  0 | **lazy `trace.js`** (25,470 / 8,202 with `container-trace.js` + the trace tier)                                                                                                                                                                                         |                                                                                  0 |
| `store/optimistic.js`, `store/storePath.js`, `store/affects.js`, `affects.js`, `map.js`, `reveal.js` | store engine / flow  |          0 |                  0 | in no chunk (shaken)                                                                                                                                                                                                                                                    |                                                                                  0 |
| `core/action.js`                                                                                     | lanes/optimistic     |          0 |                  0 | **lazy `serverForms.js`** (5,774 / 2,388 with the router's `data/action.js`)                                                                                                                                                                                            |                                                                                  0 |
| dev-only reaching prod                                                                               | —                    |      **0** |                  0 | no `_SOLID_DEV_`/`__DEV__`/`NODE_ENV` left in `dist/prod`; prose present: `"[REACTIVITY_HALTED]"` (`haltReactivity`, 157 B unit) and the error class names                                                                                                              |                                                                                  — |
| **total**                                                                                            |                      | **37,901** |         **40,885** |                                                                                                                                                                                                                                                                         |                                                                                    |

By group: **core 19,232** (incl. `flatten`), **async 3,974**, **lanes/optimistic
6,683**, **store engine 0**, **store residue 4,430**, **boundaries + error
hook 3,582**, dev-only 0.

The two eager chunks split the modules by sharing: `lanes.js` and
`verdict.js` are in the **entry** (reached only through the router's
modules, shared with no lazy chunk); every other signals module is in
`client.js`, the chunk the lazy tiers (`trace.js`, `bind.js`, `wire.js`,
`serverForms.js`) import from.

### 2.1 What is in `store/utils.js` on HN

Functions, exact bytes: `mergeLookup` 399, `collectTable` 370, `omitTable` 342,
`collectKeys` 326, `mergeTable` 220, `sourceKeys` 176, `mergeHas` 152, `addKey`
118, `resolvedTable` 110, `mergeHasStaticKeys` 104, `hasStaticKeys` 99,
`leafKeys` 96, `hiddenByAny` 94, `sourceGet` 93, `sourceHas` 93,
`entryHasStaticKeys` 79, `isHidden` 79, `mergeKeysOf` 74, `tableOf` 67,
`OmitView` (class + members) ≈ 130, `MergeView` ≈ 110, `mergeGet` 54,
`tableSet` 52, `viewOf` 52, `leafOf` 44, `viewSource` 42, `recordOf` 28,
module scope 45. **Absent:** `merge`, `omit`, `mergeView`, `omitView`,
`mergeSources`, `isStatic`, `sourceOwners` — the constructors `mergeProps` /
`omit` / `splitProps` call. What is on the page is the **reader** side: the
code `spread` needs to read a prop source that _might_ be a merge or an omit
view, because `spread`'s source kind (`SOURCE_PLAIN` / `SOURCE_PROXY` /
`SOURCE_MEMO` / `SOURCE_OMIT` / `SOURCE_MERGE`) is a runtime argument the
bundler cannot fold. The compiled base SC page carries 1,076 of the same
module — only the `readShallow` → `sourceKeys` walkers, through its compiled
`class`/`style` effects; HN's `toggle.tsx` effects do not retain `readShallow`
(cut E moves nothing on HN — §4), `spread` does.

## 3. Store engine: present? who imports it

**Chunk ownership (Rolldown's output, this build):**

| chunk                                                                     | kind                                         |        min / br | signals modules in it                                                                                                                                                         |
| ------------------------------------------------------------------------- | -------------------------------------------- | --------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entry.js`                                                                | eager (entry)                                | 60,843 / 20,410 | `core/lanes.js`, `core/verdict.js`                                                                                                                                            |
| `client.js`                                                               | eager (statically imported by the entry)     | 84,480 / 27,370 | `core/{error,constants,scheduler,heap,owner,graph,async,core,context,effect,error-hooks}.js`, `signals.js`, `store/types.js`, `flatten.js`, `boundaries.js`, `store/utils.js` |
| `trace.js`                                                                | lazy (`import("@solidjs/web/frames/trace")`) |  25,470 / 8,202 | **`store/target.js`, `store/store.js`, `store/reconcile.js`, `store/projection.js`** (+ `solid:container-trace.js`, `web/frames:trace.js`)                                    |
| `serverForms.js`                                                          | lazy (router `import("./serverForms.js")`)   |   5,774 / 2,388 | **`core/action.js`** (+ router `data/action.js`)                                                                                                                              |
| `bind.js`, `wire.js`, `regions.js`, `assets.js`, `decode.js`, `server.js` | lazy                                         |                 | none                                                                                                                                                                          |

So the store engine's one edge into this page — the frames client's
container-trace materializer, which #3879's body and the page ledger notes
name — is now behind `import()`: `client.js` (frames) → `prepareTier("trace")`
→ `trace.js` → `solid-js/internal/container-trace` → `createProjection$1`
from `@solidjs/signals` → `store/projection.js` → `store/store.js`,
`reconcile.js`, `target.js`. Nothing eager imports a store engine binding
that survives tree-shaking: `solid.js` imports `createStore$1`,
`createOptimisticStore$1`, `createProjection$1` for its wrappers, but the
wrappers (`createStore`, `createOptimisticStore`) are unused on HN and
Rolldown drops the import edge with them, so the modules are assigned to the
lazy chunk. (This is the complement of the hydration-split finding: an eager
import pins a module only while some retained eager statement uses it — a
dead slot write does; an unused wrapper does not.)

**What _is_ present, and its importer chains (binding level, confirmed by cut):**

| present                                                     |         bytes | chain (eager importer → … → signals)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | cut that removes it                                                                                                                                                                                                                                                                                                                   | leaves                  |
| ----------------------------------------------------------- | ------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `store/utils.js` view readers                               |         3,641 | `examples/hackernews/src/{app,routes/stories,routes/story,routes/user}.tsx` `dynamic(…)` → `@solidjs/web` `dynamic` → `dynamicCore(source, options, staticElement)` → `staticElement(tag, props)` → **`spread(el, props)`** → `solid-js/internal` {`resolvedTable`, `viewOf`, `OmitView`, `hasStaticKeys`, `sourceKeys`, `sourceHas`, `sourceGet`, `SOURCE_*`} → `internal.js` re-exports from `@solidjs/signals` → `store/utils.js`                                                                                                                    | **DC** (the example on `dynamicComponent`): −3,641 of `utils.js`, −789 of `types.js`, −2,161 of `web.js`'s own view readers (`spread`, `collectProps`, `collectSources`, `pushEntry`, `entryHas`/`Get`, `readShallow`, `collectTable`), −1,298 more of the element arm (`staticElement`, `createElement`, `assign`'s attribute paths) | all of it               |
| same, isolated from the attribute runtime                   |               | **WS** (`staticElement` assigns instead of spreading; keeps `assign`/`assignProp`): −6,591 / −1,682, signals −4,430 — the same 4,430 as DC, so the edge is `spread`'s view reading, not `dynamic` in general                                                                                                                                                                                                                                                                                                                                            |                                                                                                                                                                                                                                                                                                                                       |
| `readShallow` → `sourceKeys` walkers (inside the above)     |       ≈ 1,076 | `web.js` `readShallow` ← `spread`'s `collectProps`/`collectTable` (`style`/`class` props) — **not** the compiled templates on HN                                                                                                                                                                                                                                                                                                                                                                                                                        | **E** (`Reflect.ownKeys` for the proxy case): **+11 / −33 on HN, signals Δ 0** — `spread` keeps `sourceKeys` with a runtime kind, so the walkers stay; on compiled base SC the same cut is −1,165 / −293 (its only retainer there is `readShallow`)                                                                                   | nothing on HN           |
| `store/types.js`                                            |           789 | `store/utils.js` → `ownEnumerableKeys`, `$PROXY`/`$RECORD`/`$TARGET` (eager need ≈ 266); `web.js` → `$PROXY` (`value[$PROXY] !== value`, `$PROXY in source`); **`isWrappable` 296, `markRawIngest` 104, `markRawOne` 67, `isRawValue` 36, `setWriteOverride` 20 are imported only by `store.js`/`reconcile.js`/`projection.js` in the lazy `trace.js`** and ride eager because the module is pinned by `utils.js` (hydration-split §3.1's rule)                                                                                                         | DC / WS: −789 from the eager graph; `trace.js` grows +596 (25,470 → 26,066) — the module moves to the chunk that uses it                                                                                                                                                                                                              | all of it               |
| solid-js store hydration adapters (`solid.js`, not signals) |         2,821 | `web.js` `hydrate()` → `enableHydration()` installs `_hydrateStoreLike = hydrateStoreLike` (a retained write, so the import of `hydrateStoreLike` is live); the slot is read by `withStoreHydration` — exported from `solid.js` for the **lazy** `container-trace.js` (`core.withStoreHydration(createProjection$1, …)`) — and by the `createStore`/`createOptimisticStore` wrappers (not on HN). `hydrateStoreLike` → `hydrateStoreLikeFn` 698 → `hydrateStoreFromAsyncIterable` 1,091, `createShadowDraft` 445, `applyPatches` 206, `quietAnswer` 202 | **A** (the trace tier stops reading the slot; hydration-split (a) in stub form): **−2,625 / −585 on HN, −2,640 / −611 on compiled base SC**, signals ±3                                                                                                                                                                               | all of it (solid bytes) |
| frames client                                               | 0 store bytes | imports from `solid-js` only `createMemo`, `createOwner`, `createRenderEffect`, `createSignal`, `getOwner`, `onCleanup`, `runWithOwner`, `untrack`; from `solid-js/internal` `createLoadingBoundary`, `sharedConfig`; from `@solidjs/web` `insert`                                                                                                                                                                                                                                                                                                      | —                                                                                                                                                                                                                                                                                                                                     | —                       |
| router (`solid` condition)                                  | 0 store bytes | no `createStore`, `mergeProps`, `splitProps` or `omit` anywhere in `dist/**` (`grep`); location/params are `createSignal`/`createMemo`/`createMemoObject`                                                                                                                                                                                                                                                                                                                                                                                               | —                                                                                                                                                                                                                                                                                                                                     | —                       |
| sf client, slot props                                       | 0 store bytes | the binding-slot tier (`bind.js`) is lazy and imports no store binding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | —                                                                                                                                                                                                                                                                                                                                     | —                       |

**Lanes/verdict, for completeness (not stores, but "optimistic/lanes" was
asked):** `core/lanes.js` 4,764 + `core/verdict.js` 1,919 + 147 of
`constants`/`core`/`scheduler` that go with them = 6,835, retained **only**
by the router: `routing.js` `createRouterContext` — `routingPending =
createMemo(() => isPending(() => …))`, `isRouting`, `transitionIntent`,
`pendingNavigation` (`latest(source)._navigation`), the redirect-depth check
(`isPending(source) || integration.inflight?.() === headed`) — and
`routers/factory.jsx` `createIntegration`'s `runWithOwner(null, () =>
onSettled(…))`. Cut **RL** (those reads replaced by `false` / the plain read /
a microtask) removes every byte of both modules; `boundaries.js`,
`createOptimistic`, the frames client and hydration retain none of it (the
compiled base SC page, which has boundaries and frames but no router, has 0 B
of either). `core/action.js` is already lazy (`serverForms.js`).

## 4. Removal ceilings

Each cut alone, against the same build; Δ min / Δ br on the eager graph
(negative = smaller). "n/a" = the page has no such edge.

| cut                                                                                | what it is                                                                                             |                                                                                                                                                                                                                                                                                                                                                                                   **HN** |                                                         compiled base SC | what would break / who consumes it                                                                                                                                                    |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: | -----------------------------------------------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| store engine out entirely                                                          | —                                                                                                      |                                                                                                                                                                                                                                                                                                                                 **0 / 0** (already out: `trace.js` lazy, 25,470 / 8,202) |                                                             0 / 0 (same) | if removed from `trace.js` too: the container-trace materializer (`createProjection` in `solid-js/internal/container-trace`), i.e. server-component traces                            |
| **DC** — the example mounts with `dynamicComponent`                                | the store residue + the element arm's spread runtime (`page: base + router` already did this in #3838) |                                                                                                                                                                                                                                                                         **−7,987 / −2,339** → 137,336 / 45,441 (signals −4,430: `utils.js` −3,641, `types.js` −789; web −3,459; sf −100) |                                    0 / 0 (already on `dynamicComponent`) | nothing for HN — its four mounts are component-only (#3879's body: "the example should move to `dynamicComponent`")                                                                   |
| **WS** — `dynamic()`'s element arm assigns instead of spreads                      | the view-reader edge alone                                                                             |                                                                                                                                                                                                                                                                                                                                             −6,591 / −1,682 (signals −4,430; web −2,161) |                                                                    0 / 0 | `<Dynamic component="tag" {...merged}>` over `mergeProps`/`omit` sources; measurement only                                                                                            |
| **SU** — `store/utils.js` stubbed to the plain-object case                         | the module's ceiling                                                                                   |                                                                                                                                                                                                                                                                                                          −3,606 / **−959** (signals −3,602: `utils.js` −3,504 of 3,641, `types.js` −100) |                                                            −1,151 / −369 | `spread` over merged/omitted props, `mergeProps`/`omit`/`splitProps` consumers, `readShallow` of a proxy — every store-view user in web and solid                                     |
| **E** — `readShallow` reads a proxy's own keys directly                            | hydration-split (e)                                                                                    |                                                                                                                                                                                                                                                                                                                                                                **+11 / −33** (signals 0) |                                       **−1,165 / −293** (signals −1,181) | nothing (identical semantics) — but on HN it buys nothing while `spread` is on the page                                                                                               |
| **A** — store hydration adapters ride the trace tier                               | hydration-split (a), stub form                                                                         |                                                                                                                                                                                                                                                                                                                                                         **−2,625 / −585** (solid −2,630) |                                                        **−2,640 / −611** | nothing on the eager page; `trace.js` must carry the adapters (the doc's real shape: +2.7 KB lazy, 135 B of eager helper exports)                                                     |
| `mergeProps` / `omit` out                                                          | —                                                                                                      |                                                                                                                                                                                                                                                                                           **0 / 0** — not retained on HN (0 B of `merge`, `omit`, `mergeView`, `omitView`, `splitProps`) |                                                                    0 / 0 | n/a; what HN carries is the readers (SU / WS above)                                                                                                                                   |
| router `createStore` → signals                                                     | —                                                                                                      |                                                                                                                                                                                                                                                                     **n/a** — the router's `solid`-condition dist has no `createStore` (location, params, matches are signals and memos) |                                                                      n/a | —                                                                                                                                                                                     |
| **RL** — lanes/verdict out (router stops reading `isPending`/`latest`/`onSettled`) | the navigation-core edge of solid-router#655                                                           | **−8,414 / −4,337** → 136,909 / 43,443 (signals −6,835: `lanes.js` −4,764, `verdict.js` −1,919, `constants` −84, `core` −44, `scheduler` −19). The eager graph collapses to one file: ≈ −1.5 KB min of the delta is the cross-chunk import/export glue and −1,335 br is the second brotli stream, so the **code's own delta is ≈ −6.9 KB min / ≈ −3.0 KB br** (46,445 one-file → 43,443) |                                                          n/a (no router) | `isRouting`, `transitionIntent`, pending-target navigation, `onSettled`-ordered history commits — the router's pending/optimistic navigation model (#655's question, not a Solid cut) |
| **RS** — scroll restoration without `createEffect`                                 | #655's other edge                                                                                      |                                                                                                                                                                                                                                                                                                                                −122 / +14 (signals −52: the `createEffect` wrapper only) |                                                                      n/a | nothing of size: `core/effect.js` stays for hydration's effects and `trackedEffect`; #655's "`createEffect` leaves only with scroll restoration" does not hold on this base           |
| **ALL** — DC + E + A + RL as one build                                             |                                                                                                        |                                                                     **−19,039 / −7,269** → **126,284 / 40,511** (−15.2 %); signals **26,635** = floor + 6,458 (`boundaries` 3,064, `core` +1,026, `flatten` 666, `error-hooks` 519, `effect` +231, `scheduler` +240, `context` 210, `signals.js` +164, `owner` +123, `error` +100, `constants` +52, `async` +27, `graph` +30, `heap` +6) | **−3,805 / −892** → 105,495 / 34,187 (E + A; the other two do not apply) | as above, per cut; the HN half of it (DC + A) breaks nothing                                                                                                                          |

Reading it:

- **For HN the store residue is an application-side fix** (DC) and is the
  largest single item that costs nothing semantically: −7,987 / −2,339,
  of which 4,430 min / ≈ 0.96 KB br is signals' store bytes and the rest is
  `web.js`'s spread and element-arm runtime. The hydration-split document's
  (e) does not help HN until `spread` is off the page; after DC there is no
  `readShallow` left to fix (cut E on DC: 0).
- **The lanes are the router's**, and they are 6,835 min / ≈ 3.0 KB br on
  every page with `@solidjs/router` 2.0 — `page: base + router` carries the
  same 4,766 + 1,939. That is the navigation core's `isPending`/`latest`/
  `onSettled` design question in solid-router#655, not a Solid cut; this
  document only measures the ceiling.
- **The store hydration adapters** (A) are the one Solid-side item still on
  the table from the hydration-split plan: −585 br here, −611 on the SC page,
  in the real shape ≈ −560 to −650 after glue (that document's §3).

## 5. HN against the signals floor scenarios

Exact minified bytes per module on current `next`; "HN − floor" is what HN
carries of signals above `signals: core floor`.

| module                               |     **HN** | core floor | + isPending/latest | + createStore | compiled base SC | base + router | **HN − floor** |
| ------------------------------------ | ---------: | ---------: | -----------------: | ------------: | ---------------: | ------------: | -------------: |
| `core/core.js`                       |      7,407 |      6,337 |              6,402 |         6,493 |            7,315 |         7,407 |         +1,070 |
| `core/scheduler.js`                  |      5,303 |      5,044 |              5,098 |         5,098 |            5,180 |         5,317 |           +259 |
| `core/lanes.js`                      |      4,764 |          — |              4,742 |             — |                — |         4,766 |         +4,764 |
| `core/async.js`                      |      3,974 |      3,943 |              3,945 |         3,969 |            3,974 |         3,972 |            +31 |
| `store/utils.js`                     |      3,641 |          — |                  — |             — |            1,076 |             — |         +3,641 |
| `boundaries.js`                      |      3,063 |          — |                  — |             — |            3,061 |         3,069 |         +3,063 |
| `core/verdict.js`                    |      1,919 |          — |              1,913 |             — |                — |         1,939 |         +1,919 |
| `core/owner.js`                      |      1,576 |      1,451 |              1,455 |         1,544 |            1,572 |         1,574 |           +125 |
| `core/effect.js`                     |      1,061 |        830 |                835 |           836 |              836 |         1,061 |           +231 |
| `core/heap.js`                       |      1,040 |      1,034 |              1,038 |         1,040 |            1,041 |         1,040 |             +6 |
| `core/graph.js`                      |        877 |        847 |                853 |           877 |              877 |           877 |            +30 |
| `store/types.js`                     |        789 |          — |                  — |           683 |              789 |           689 |           +789 |
| `flatten.js`                         |        666 |          — |                  — |             — |              666 |           666 |           +666 |
| `core/error-hooks.js`                |        519 |          — |                  — |             — |              519 |           519 |           +519 |
| `signals.js`                         |        477 |        312 |                322 |           287 |              288 |           476 |           +165 |
| `core/error.js`                      |        436 |        336 |                336 |           336 |              436 |           436 |           +100 |
| `core/context.js`                    |        210 |          — |                  — |             — |              121 |           210 |           +210 |
| `core/constants.js`                  |        179 |         43 |                 81 |            43 |               95 |           125 |           +136 |
| `store/store.js`                     |          — |          — |                  — |        17,704 |                — |             — |              — |
| `store/reconcile.js`                 |          — |          — |                  — |         3,004 |                — |             — |              — |
| `store/projection.js`                |          — |          — |                  — |         2,172 |                — |             — |              — |
| `store/target.js` + `store/index.js` |          — |          — |                  — |           351 |                — |             — |              — |
| `map.js`                             |          — |          — |                  — |             — |            4,071 |         4,080 |              — |
| `core/action.js`                     |   — (lazy) |          — |                  — |             — |                — |           627 |              — |
| **total**                            | **37,901** | **20,177** |         **27,020** |    **44,437** |       **31,917** |    **38,850** |    **+17,724** |
| harness (`size.mjs`, apportioned)    |     40,885 |     20,129 |             26,962 |        44,377 |           33,885 |        41,545 |                |
| brotli, whole scenario               |     47,780 |      7,382 |              9,570 |        14,603 |           35,079 |        45,940 |                |

What accounts for the +17,724 over the floor, grouped: **lanes/verdict
6,683** (37.7 % — the router; the `+ isPending/latest` scenario prices the
same two modules at 6,655 on the floor), **store residue 4,430** (25.0 % —
`dynamic()`'s element arm), **boundaries + error hook 3,582** (20.2 % —
`<Loading>`, `Errored`, the frames hold), **core growth 1,070** (6.0 % —
hydration's snapshot scope and frame read), `flatten` 666, `context` 210,
`trackedEffect` 225, and ≈ 860 of small wrappers and accessors. HN sits
10,881 above `+ isPending/latest` and 6,536 below `+ createStore` — the
latter is the one comparison that does not hold module for module: HN's
`store/` bytes (4,430) are the view readers and the brand types, not one byte
of the engine `+ createStore` measures (23,914 of `store.js`, `reconcile`,
`projection`, `target`, `types` and `store/index`). Against `page: base + router` (38,850)
HN differs by `map.js` 4,080 and `action.js` 627 (the hand-written router
page keeps `For` alive and measures the flat router bundle, which inlines
the server-form fallback) against HN's `store/utils.js` 3,641 (the
hand-written page mounts with `dynamicComponent`).

## 6. Answer

**Are we pulling in stores somewhere, and from where?** The store engine is
not on HN's eager graph on current `next` — `store.js`, `reconcile.js`,
`projection.js`, `target.js` are in the lazy `trace.js` chunk behind the
frames trace tier (#3860), `optimistic.js`/`storePath.js`/`store/affects.js`
are shaken entirely, `action.js` is in the router's lazy `serverForms.js`,
and the only eager importers of store-engine bindings (`solid.js`'s
`createStore`/`createOptimisticStore` wrappers) are themselves unused and
dropped. What the page does carry is **4,430 B minified (≈ 0.96 KB br) of
`store/utils.js` + `store/types.js`** — the merge/omit **view readers**
(`mergeLookup`, `omitTable`, `mergeTable`, `collectKeys`, `sourceKeys`,
`resolvedTable`, `OmitView`/`MergeView`, …) plus the brand symbols and
`isWrappable`/`markRaw*` (523 B of which are eager only because the module is
pinned and the lazy trace chunk uses them) — reached by exactly one chain:
**the example's four `dynamic()` mounts → `@solidjs/web` `dynamic` →
`dynamicCore(…, staticElement)` → `spread(el, props)` → `solid-js/internal`'s
view-reader exports → `@solidjs/signals` `store/utils.js`.** Not the frames
client, not the router (which uses no `createStore`), not the sf client, not
the slot-props tier (lazy), and not `readShallow` on its own (cut E moves 0 B
on HN; the compiled templates here do not retain it). Moving the example to
`dynamicComponent` — the mount the router pages already use since #3838 —
removes every one of those bytes and the spread runtime with them (−7,987 /
−2,339 br, 4.9 % of the page). Separately, **2,821 B of `solid.js`** store
hydration adapters are eager through `enableHydration`'s slot install for the
lazy trace tier's `withStoreHydration` — the hydration-split document's (a),
−2,625 / −585 here. And the **lanes/verdict (6,683 B, ≈ 3.0 KB br)** are the
router's navigation core — `isPending`/`latest`/`onSettled` — not stores and
not Solid's to cut.

## 7. Caveats

- Local measurements (macOS, Node 26.4, Rolldown 1.2.11 pinned); CI (Linux,
  Node 24) has read identical minified bytes on every compiled scenario so
  far. Brotli on a cut moves ±30–90 B with layout; minified deltas are the
  firm numbers.
- The eager graph on HN is **two files** (the entry + the hoisted
  `client.js`); cuts that stop the lazy chunks sharing modules with the entry
  (RL, ALL) collapse it to one, and recover the 1,335 B br layout cost and
  ≈ 1.5 KB min of cross-chunk glue in addition to their code. §4 nets this
  out where it happens; the source-map attribution charges that glue to the
  last mapped unit before the export list (`adoptedCall` in the sf client
  reads 1,440 B on L0 for a three-line function) and to `<unmapped>` — a
  known artefact of the tool, visible only on two-file graphs, and not in
  any signals row.
- The `attribute.mjs` column apportions each module's standalone minify to
  the chunk and so differs from the source-map column by up to ≈ 1 KB per
  module (`core/core.js` 8,504 vs 7,407); both sum to their chunk. The
  tables use the source-map figures.
- The cuts are measurement shapes, not implementations: RL changes the
  router's semantics (no pending navigation); WS and SU drop view support
  from `spread`; A is the stub form (the real shape, per the hydration-split
  document, costs 135 B of eager helper exports and +2.7 KB on the lazy
  trace chunk). DC is the one cut that is also the right change for the
  example (component-only mounts).
- The brotli-by-group figures marked ≈ use 0.30; the measured cuts here
  cluster at 0.22 (A on the SC page) to 0.36 (RL one-file).
- `store/types.js`'s "523 B eager for the lazy chunk" is read from the
  function list (the eager code calls none of `isWrappable`, `markRawIngest`,
  `markRawOne`, `isRawValue`, `setWriteOverride`) and confirmed by the chunk
  move under DC (`trace.js` +596); the exact split inside the minified module
  is not separable further.
- #3879's inline cap (54.57 KB / 176,581) was set on its old base; on this
  stack the scenario measures 47,780 / 145,323. Lowering it is #3879's
  re-base, not this document's.
- Nothing here was run through the test suites: no source changed.

## 8. Reproducing

All tooling lives under `tmp-tools/` in the worktree (git-excluded by
`.git/info/exclude`) and is rebuildable from this section.

- `tmp-tools/lib.mjs`, `fnmap.mjs`, `units.mjs` — the hydration-split tools,
  with `lib.mjs`'s compile plugin brought up to #3879's `bundle.mjs`
  (`.tsx`, the `"use server"` directive pass under `compile.serverFunctions`,
  `.css` as empty) and `--dist <orig>=<copy>` accepting directories
  (`signals/dist/prod=…/signals`), mapped back for labels.
  `node tmp-tools/fnmap.mjs "page: hackernews" --json out.json`.
- `tmp-tools/signals-by-module.mjs <fnmap.json>` — §2's listing: every
  signals module with its named functions.
- `tmp-tools/chunk-modules.mjs "page: hackernews"` — §3's chunk ownership.
- `tmp-tools/cuts.mjs` — the named cuts (`e-readshallow`, `a-trace`,
  `dyncomp`, `w-spread-plain`, `stub-store-utils`, `router-nolanes`,
  `router-noscroll`) as exact-string replacements over verbatim copies
  under `tmp-tools/dist/L0/` (the signals `prod/` tree, the router dist and
  `examples/hackernews` copied whole, `sideEffects: false` replicated);
  `tmp-tools/run.mjs <variant>:<cut>+<cut> …` measures and attributes each
  variant on HN and the compiled base SC page and prints the Δ table;
  results in `tmp-tools/out/cuts.json`.
- `tmp-tools/concat-br.mjs "page: hackernews"` — the two-file layout cost.
