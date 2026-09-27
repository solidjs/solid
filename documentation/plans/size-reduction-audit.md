# Size reduction — audit and options (2026-09-26)

Branch `size/audit` off `next` @ `663031d7b`. All numbers are **minified + brotli (q11)**
against the built prod dists, bundled with esbuild the way `scripts/size` does it. Measurement
scripts live outside the repo (`/tmp/size-audit/{attr,fnattr,hist,exp}.mjs`); they are
reproducible from this document.

Targets stated for this effort: hello world well under 10 KB; a server-component page ≤ 30–40 KB
on the upper end. Today: **12.6 / 47.3 / 46.5–53.5 KB**.

**Reframed 2026-09-26 (evening), after G was measured.** The target is the size every real app
ships, not any single scenario. Every real app has async, hydration and (on the server-component
path) the frames client; hello world is a vanity number and is now informational — its cap stays
frozen as governance, not as a goal. Pay-for-use and tree-shaking work (B, C, E) moves bytes
between chunks or out of apps that skip a feature; under this framing it is second-order. The
first-order work is making the code everyone ships smaller with the same semantics: §4.I, the
density audit, comes next.

**Harness switched to Rolldown (2026-09-26, later that night).** Every number in this document
is an esbuild number (size-limit's bundler). The harness now bundles with Rolldown — what Vite
ships — and every cap was re-based; Rolldown lands 4–9% lower on the same artifacts (floor
9,922 → 9,506; base SC page 46,852 → 44,635; live 51,156 → 48,802). Deltas in the tables here
stay valid as deltas; absolute targets should be read against the Rolldown caps in
`scripts/size/floor-caps.json`.

## 1. Baseline

| Scenario                                                                 |     min |         br | signals | solid-js |   web | frames |    sf |
| ------------------------------------------------------------------------ | ------: | ---------: | ------: | -------: | ----: | -----: | ----: |
| `createSignal` alone (signals)                                           |  25,499 |  **9,217** |   25.5K |          |       |        |       |
| signals floor (signal/memo/effect/root/flush)                            |  27,604 |  **9,844** |   27.6K |          |       |        |       |
| signals floor + `createStore`                                            |  51,828 |     17,165 |   51.8K |          |       |        |       |
| **hello world** (`render` + one signal)                                  |  35,639 | **12,615** |   28.3K |     0.2K |  7.1K |        |       |
| CSR: Show/For/Loading/Errored/lazy                                       |  44,806 |     15,776 |   36.3K |     1.3K |  7.1K |        |       |
| hydrating, no stores                                                     |  62,144 |     21,220 |   36.8K |    14.9K | 10.3K |        |       |
| hydrating + every store family                                           |  97,242 |     31,487 |   71.4K |    15.2K | 10.3K |        |       |
| **base server components** (hydrating + `Dynamic` + frames + sf ref)     | 148,562 | **47,256** |   67.7K |    15.8K | 20.3K |  31.8K | 12.7K |
| **live SC**, no client stores (+ `live`/`GET`, action, isPending/latest) | 145,728 | **46,522** |         |          | 10.4K |  31.8K | 17.2K |
| live SC + client stores + `Dynamic`                                      | 169,462 | **53,537** |   83.7K |    16.1K | 20.3K |  31.8K | 17.2K |

Solid 1.9.15 on the same shapes: floor **2.55 KB**, floor+store 3.8, render+signal **3.9**,
hydrate+Show/For/Suspense/ErrorBoundary/lazy/Dynamic **9.2**. Solid 2 is 3–4.5× on every row.

### Where the signals floor is (function-level, share of retained bytes)

`GlobalQueue` (scheduler class: flush, transitions, parking, stashing) ≈ 16%; `recompute` ≈ 10%
(~650 source lines, one function); `handleAsync` ≈ 8%; `read` ≈ 5%; `notifyStatus`, `Queue`,
`finalizePureQueue`, `disposeChildren`, `setSignal`, `runEffect` 1.5–2.5% each. Module split:
`core.js` 8.9K min, `scheduler.js` 7.9K, `async.js` 4.7K, `owner.js` 1.6K, `heap.js` 1.2K,
`effect`/`graph`/`lanes` ~0.9K each. A bare `createSignal` retains 92% of the floor: memo, effect,
root and flush together add 2 KB min. **The floor is not "features you imported"; it is the
model.**

## 2. Trajectory (published `@solidjs/signals`, same floor import)

| version       | date       | signal only |     floor | floor + store |
| ------------- | ---------- | ----------: | --------: | ------------: |
| 0.9.0         | 2026-01-07 |       3,248 |     3,724 |         5,979 |
| **0.10.0**    | 2026-02-13 |       4,701 | **5,180** |         7,802 |
| 0.13.13       | 2026-04-14 |       6,369 |     6,838 |         9,462 |
| 2.0.0-beta.10 | 2026-04-30 |       6,692 |     7,143 |        10,030 |
| 2.0.0-rc.0    | 2026-08-12 |       6,685 |     7,224 |        13,086 |
| 2.0.0-rc.5    | 2026-09-01 |       7,435 |     8,019 |        14,648 |
| 2.0.0-rc.9    | 2026-09-18 |       8,950 |     9,570 |        16,746 |
| `next` today  | 2026-09-26 |       9,217 |     9,844 |        17,165 |

Maintainer's framing: the 0.10 era added features; Feb 2026 is the meaningful baseline. From
there the floor is **+90%** and floor+store **+120%**, with no new primitive after beta. rc.0 →
today is +2.6 KB in six weeks. The ratchet ledger in `scripts/size/.size-limit.js` (290 lines of
notes for the floor alone, 55 issue references) attributes the rc-era growth as:

- ≈ 65%: transaction/hold consistency rules — A15/A17/A18/A28/A29/A30/A31/A34, lanes stage,
  born-held, contested effects, reporters, parked/woken transactions, held trims, unflushed masks
  (`SPEC-ASYNC-SEMANTICS.md`).
- ≈ 15%: the stage-3 perf batch — explicitly bytes-for-monomorphic-speed.
- ≈ 10%: `loadingValue` window, promise-of-AsyncIterable flattening, iterator teardown.
- ≈ 10%: disposal/ownership fixes, hydration snapshot capture, misc.

Every bump was individually justified at +10–300 B. The ledger's own rule ("the winning move is
relocation into pay-for-use modules") was applied to optimistic and verdict — 33 of the 42
`GlobalQueue` hook slots are installed by those two modules and shake out of the floor — but
**the hold model itself is not behind the seam**. The scheduler's comment is the architecture:
"Ambient work IS a transaction."

## 3. Findings by category

### F1. The reactive floor — "every flush is a potential transaction"

**What it costs.** ~9.8 KB br for a signal, before any DOM. Of the three targets, hello world
is _only_ this: `web.js` contributes 7.1K min (~2.5 KB br) and nothing else is there.

**Why.** A plain sync write may become a held transaction if any derivation downstream goes
async (graph-driven entanglement, A15), so every node carries committed/staged/override slots,
every read selects among them (`read`, `serve`, `readerSeesCommitted`, `enterStagedRead`), every
recompute decides publish-vs-stage and enters/leaves transactions, every effect can be contested,
and every flush can park. The code is gated by flags at runtime (cheap to execute) but not by
imports (every byte ships). `recompute` alone threads: lane posture, derived overrides, born-held
staging, zombie children, pending-source sweeps, reask, loading windows, contested effects, dep
trim deferral, A28 promotion.

**Constraint (maintainer, 2026-09-26): public API changes are off the table.** That removes
the one lever that would take async out of the floor. "Install the async engine on first
thenable" does not tree-shake anything — code has to be in the bundle to be installable, and
pay-for-use only works off an import edge, which `createMemo(async …)` does not have. Async stays
in the floor. What remains:

1. _Arrest and relocate (no semantic change)._ Freeze the three floor caps (§A, landed); move
   cold arms behind existing hook slots (`heldFromStale`, `reporterBlocksSource`, `wakeParked`,
   `resyncUnflushedCompanions`, `captureWriteSnapshot`, born-held's boundary walk). The ledger
   records several of these as "relocation measured NO-WIN" because the _call site_ stays, so
   expect **−0.5 to −1 KB**, not more. Re-measure the stage-3 perf trade (~0.4 KB bought
   monomorphism on the core loop) piece by piece with CodSpeed; keep what still pays.
2. _Behavior leniency (maintainer: "more lenient on behavior, perhaps")._ Explicit transactions
   (`action`, lanes, `startTransition`) keep most of the scheduler's transaction apparatus
   regardless. The candidates are the **mainline implicit** hold rules: A28 unflushed masks,
   A29 born-held, A34 write-as-proposal, contested effects (#3322/#3319), reporters and
   parked/woken transactions (#3375/#3426), held trims (A30), the pending-source re-park sweeps
   (#3371/#3456). Their ledgered costs sum to ~3.5 KB minified → **−1.5 to −2.5 KB br on every
   scenario** (the earlier −3 to −4 KB estimate assumed transactions themselves could go; they
   cannot). Each rule fixed a real torn frame in a fuzzer or an issue and would come back as
   accepted tearing outside explicit transactions. Deliverable before any code: a table of the
   ~15 rules — bytes, motivating issue, and the visibility-oracle cells that flip — for a
   per-rule ruling.

**Ceiling.** With async in the floor, hello world lands at **~9.5–10 KB** after (1) and (2) —
under the 10 KB goal with a thin margin, and only if (2) is ruled in. Without (2) it is ~11.8.

### F2. Governance — the ratchet is permissive by construction

Sixty ratchets in ten weeks, each small, each with a paragraph of justification; the harness
records history but does not resist growth. Proposals:

- Floor caps (signals floor, hello world, hydrating-no-stores) become **hard**: a bump requires an
  equal-or-larger relocation out of the floor in the same PR, or a maintainer-signed exception.
- Add the two server-component scenarios from this audit (`sc-base`, `sc-live` — see §1) to the
  harness so the target pages are measured, not inferred.
- Every scenario also reports **per-package minified bytes** (esbuild metafile) so a bump is
  attributed at PR time, not in a later audit.
- The 2,479-line `.size-limit.js` is itself a smell: move the ledger prose to a
  `SIZE-LEDGER.md` and keep the config to scenarios and caps.

### F3. Store engine shape

`store/next/store.js` 17.1K min + `reconcile` 3.2K + `projection` 1.6K + `store/store` 1.2K +
`target` 0.2K ≈ **23K min / ~7.3 KB br** for `createStore` alone (the function form pulls
reconcile and projection by design). Function-level: proxy `traps` (7.5K un-mangled),
`notifyWrites`, `drainFolds`, `ensurePB`/`adoptPB`/`materializePB`/`privatizeCommitted`/
`pendingBackingVisible`/`visibleKeys`/`cloneRaw`/`flattenOverlay` — i.e. **roughly half the
store is the dual committed/pending backing (`.v`/`.pb`) and its fold protocol**, the store's
own implementation of F1's hold model. Solid 1's store (proxy + per-key signals + path setter +
reconcile) is 3.8K min.

Options:

1. _Follow F1._ Whatever F1's leniency ruling removes from mainline removes the matching store
   arms (`ensurePB`/`adoptPB`/`privatizeCommitted`/`drainFolds` mainline paths). Estimate
   **−2 to −3 KB br** for store users, sized after F1.
2. _Split families by import._ Would need the derived form to be its own spelling — a public
   API change, ruled out. `createStore` carrying projection and reconcile is accepted as
   inherent.
3. _Shape review of `traps`._ 200 lines for get/has/set/deleteProperty/ownKeys/getOwnPropertyDescriptor
   with committed/pending/override selection per trap. Worth a pass once (1) decides what the
   traps must select among.

### F4. Packaging leaks (no semantic change; the fastest wins for server components)

Measured on `sc-base` (47.3 KB br):

| Change                                                                                      | br after |            Δ |
| ------------------------------------------------------------------------------------------- | -------: | -----------: |
| as shipped                                                                                  |   47,256 |              |
| frames client stops eagerly installing `materializeContainerTrace` (store engine goes lazy) |   40,163 |  **−7.1 KB** |
| + `Dynamic` without the full `spread`/`mergeProps` runtime (see F5)                         |   35,153 | **−12.1 KB** |

Same on `sc-live` without client stores: 46.5 → **39.5 KB** with the materializer alone.

Causes, each an "install everything on enable" pattern:

- `@solidjs/web/frames` client: `setContainerTraceMaterializer(materializeContainerTrace)` at
  module load; the materializer calls solid's hydration-aware `createProjection`, i.e. the whole
  store engine, for a container trace most pages never receive. The previous audit found the
  document face needs the materializer _synchronously_ during the claim walk when a trace is
  present — so the fix is: the server knows whether it serialized a trace; when it did, it
  preloads the materializer module (through the same manifest path `lazy()` chunks use) and the
  frames client awaits it before that scope's claim; when it didn't, nothing loads.
- `solid-js` `enableHydration()` installs `_hydrateStoreLike` → `hydrateStoreLikeFn`,
  `hydrateStoreFromAsyncIterable`, `createShadowDraft`, `applyPatches` (~7.9K min un-mangled)
  in every hydrating app, store or not. **Measured and rejected (B.1, 2026-09-26).** Moving the
  reference into the wrappers (`createStore` etc.) saves **789 B** br on the hydrating no-store
  app — not the 1.2 KB estimated, since inside a hydrating bundle much of the adapter compresses
  against the signal-hydration code it resembles — and costs **+1,739 B** br on a CSR app that
  imports `createStore`: the adapter drags the generic hydration infrastructure it shares with
  signal hydration (`readSerializedOrCompute`, `wrapFirstYield`, `adoptedAnswerStream`,
  `quietAnswer`, `subFetch`, `MockPromise`, `withHydrationGate`, live-scope helpers, ~5.5K
  min) into a bundle that had none of it. Tree-shaking cannot express "retained only when
  `enableHydration` _and_ a store primitive are both referenced", so one deployment class pays
  either way; factoring the generic helpers behind their own slots would make the trade
  roughly symmetric (≈ −0.8 / +0.8) at the cost of threading a dozen helpers through slots — a
  zero-sum move. Only a separate import for the derived store form would make the conjunction
  expressible, and that is an API change. The hydrating no-store app does not pay for the
  store _engine_ (nothing from `signals/store/*` is retained); the 0.8 KB adapter is the only
  dead-by-construction piece, and it stays.
- `solid-js` and `@solidjs/web` are flat single-file dists; route-level splitting through them
  fails (a lazy route's `createStore` colors the engine into the main chunk). `preserveModules`
  for both, as signals already does. This does not move the single-entry harness numbers
  (brotli layout shifts a little) but fixes real apps' route splits; the previous audit measured
  ~9–10 KB br on the room example's `/`. **Measured 2026-09-26: `preserveModules` alone does
  not fix it.** Chunk assignment is per _module_ in both esbuild and Rollup, and each package is
  effectively one module: a per-module build of `solid-js` yields `client/hydration.js` at
  114 KB unminified carrying the signal, store, boundary and root wrappers together
  (`flow.js` 14K, `component.js` 6K, `core.js` 6K, `index.js` 4K are the rest); `@solidjs/web`
  yields `client.js` at 104 KB (the entire DOM/attribute runtime) plus `index.js` 32K. A
  synthetic entry + lazy route that uses `createStore`, split with esbuild: flat dists put
  the store engine in the shared chunk (main route 21,795 B br); the per-module tree does the
  same (21,825 B). The store wrappers must live in their own module before route splitting
  can work — see §C.
- `configureServerFunctionsClient` is installed by the frames client (needed — same instance),
  fine. The sf client's `live` loop + ledger/resume path was listed as carried by consumers that
  never call `live` (~1 KB br). **Measured 2026-09-26: not so.** `live`, `EventStreamReader`
  and the digests (~10.7K min un-mangled) already shake out of the base page; `live` reaches
  the shared reader through an `options[LIVE_WIRE]` seam, and the reader's residue on the base
  page is a few presence checks (< 0.3 KB br). `GET` (1.8K min) IS pinned on every page with a
  server reference — by design, through the late-bound RPC seam routers read instead of
  importing the transport — and a real page always has the router, so it is spoken for. What
  remains in the sf client for pay-for-use is the rich-argument request encoding
  (`getHeadersAndBody`/`extractBody`/`isJSONSafe`/`stableString`, ~5K min), which is §E's sf
  item.

### F5. `dynamic()` retains the element runtime — 4.3 KB br

(`<Dynamic>` is deprecated and not part of this effort; the numbers are for `dynamic()`.)
`hydrating` 21.2 → `hydrating + dynamic()` **25.5 KB**: the string-tag branch (`staticElement`)
references `spread`, which retains the entire attribute runtime — `assignProp`, `style`,
`className`, `classListToObject`, `SVGElements`, `eventHandler`, `setAttribute` (+10K min in
`web.js`) plus the props helpers it reads from `store/utils` (+3.8K). For server components
`dynamic(() => getStory(id()))` is _the_ client surface, and in that use it resolves a component
and never spreads onto an element.

The API shape stays. Fix (packaging tier, via the server-driven preload seam, §D): the element
runtime is loaded only when the SSR render saw a string-tag `dynamic`; the document preloads it
and the client awaits it before the claim. A CSR bundle whose first string-tag `dynamic` renders
with no `spread` elsewhere takes a chunk load at that render — the one accepted behavior change
in the packaging tier. Estimate **−4.3 KB br** on every SC page.

### F6. Frames client and transport (~10.3 + 3.7 KB br)

`frames/client.js` 31.8K min; `FrameImpl` (the class: morph, slots, live holes, ledger, reconnect,
behaviors, grafts) is ~30% of it, then `adoptBoundary`, `createFrameHost`, `slotsFor`,
`reconcileChildren`, `applyFrames`, `chunkToRecords`, `morphAttributes`, `ensureStylesheet`.
`server-functions/client.js` 12.7K min (dispatch, `ChunkReader`, `initializeResponse`,
`deserializeStream`, `createRequest`, `getHeadersAndBody`, `extractBody`, `isJSONSafe`,
`stableString`) — 17.2K with `live`/`GET`.

This is HTMX-sized on its own, sitting on a 21 KB reactive floor. Options:

1. _Tier the frames client by wire feature._ Base: html/fragment/hole apply + slots + morph.
   Installed: live holes + reconnect + ledger/have-list (`live` pages only), behaviors, grafts,
   container traces (F4). The server knows which records a response can carry and can preload
   the tier. Estimate **−3 to −4 KB br** for `sc-base`, ~0 for `sc-live`.
2. _The static face_ — a signals-free frames consumer — was considered and **rejected**
   (maintainer, 2026-09-26): a real page's baseline carries the router, and the features the
   router needs are the base. Recorded for the reasoning; not pursued.
3. _sf transport diet._ `stableString`/`isJSONSafe`/`extractBody`/`getHeadersAndBody` are the
   request-encoding side; a GET-only/`live` page never posts rich args. Split rich-arg encoding
   from the reader (**~−1 KB br**).

### F7. `solid-js` hydration layer (15 KB min in every hydrating page)

`client/hydration.ts` is 3,178 lines; retained in the no-store hydrating app: hydrated
boundary (3.8K un-mangled), store adapters (F4, ~8K), `enableHydration` 2K, `hydrateSignalLike`
1.9K, `resumeBoundaryHydration`, `normalizeIterator`, `rejectTruncatedRefs`,
`readSerializedOrCompute`, `wrapFirstYield`, `adoptedAnswerStream`, `quietAnswer`, `subFetch`,
`watchTruncation`, `markTruncated`, `MockPromise`. Much of this is the async-iterable handoff
protocol (server stream → client resume) and truncation handling. Options: (a) F4's adapter
split; (b) the iterable-handoff path (`normalizeIterator`, `wrapFirstYield`,
`adoptedAnswerStream`, `subFetch`, `watchTruncation`) installs only when the document carries
an unfinished stream — the server knows; (c) with `preserveModules` these become separate
modules and the split is natural. Estimate **−1.5 to −2.5 KB br** on hydrating pages.

## 4. The plan (agreed 2026-09-26)

Constraints: no public API changes; async stays in the floor; `createStore` carrying
projection/reconcile is inherent; more leniency on behavior is possible; the router is part of
every real baseline; a signals-free frames client is out.

### A. Measurement — landed first, alone

- `page: base server components` and `page: live server components` scenarios in
  `scripts/size` (the codec aliased to a stub, as it is a lazy chunk in production).
- `attribute.mjs`: per-package minified bytes for every scenario, run after size-limit.
- The three floor caps frozen in `floor-caps.json`; `check-floor-caps.mjs` fails a PR that
  raises one without a `Size-Exception:` line. Lowering is always allowed. The two page caps
  joined the freeze the same day (#3673 follow-up): the SC goal is the one the measured wins
  cover, so it gets the same protection against `next` growing under it.
- Win: 0 bytes. This is the mitigation for `next` moving under the effort: growth becomes a
  per-PR decision the reviewer sees, not a paragraph in a 2,500-line config.

### B. Eager installs → pay-for-use (no semantics)

1. ~~`enableHydration()` store adapters — the wrappers import the adapter directly; the enabler
   stops filling the slot.~~ **Rejected after measurement** (F4): −0.8 KB on hydrating no-store
   pages, +1.7 KB on CSR pages with stores. Not shipped; the 0.8 KB stays in the hydrating
   floor and the §5 table below already excludes it (the SC pages never counted it).
2. Frames materializer — loaded only when the server serialized a container trace (§D).
   **−7.1 KB** on SC pages without client stores.
3. `dynamic()` element runtime — loaded only when the server rendered a string-tag `dynamic`
   (§D). **−4.3 KB** on every SC page.
4. ~~sf client `live` loop + ledger/resume split behind the `live` import.~~ **Already the
   case** (F4): `live` shakes out of the base page today; residue < 0.3 KB. Nothing to ship.
   The sf pay-for-use work is §E's rich-argument encoding split.

### C. Module layout (no semantics)

`solid-js` and `@solidjs/web` built `preserveModules` like signals. Single-entry numbers barely
move; route-level splitting through both packages starts working (prior audit: ~9–10 KB on the
room example's `/`), and it is a **prerequisite for B.2 and B.3** — the materializer and
`staticElement` are welded into flat files today, so a lazy import would lazy-load a facade and
leave the engine eager.

### D. The server-driven preload seam (one mechanism for B.2, B.3, E)

The SSR render records "this document needs client module X" (a trace was serialized; a
string-tag `dynamic` rendered; an unfinished stream is being handed off). The document preloads
X through the same manifest path `lazy()` chunks use; the client awaits it before the claim walk
of the scope that needs it. Build once, used three times.

### E. Frames client, transport and hydration tiering (no semantics)

- Frames: base tier = html/fragment/hole apply + slots + morph; installed tiers = live holes +
  reconnect + have-list ledger, behaviors, grafts. **~−2–3 KB** on the base page.
- sf transport: split rich-arg request encoding from the reader. **~−1 KB**.
- `solid-js` hydration: the async-iterable handoff path installs only when the document carries
  an unfinished stream (§D). **~−1.5–2.5 KB** on hydrating pages.

### F. Core floor without semantic change

Re-measure the stage-3 perf trade with CodSpeed; relocate cold arms behind existing slots.
**−0.5 to −1 KB**, every scenario. The relocation half is now measured
(`size-reduction-g-rulings.md`, F1–F5): the async-iterable consumer (−322 B), the store sweep
(−82), companions resync (−37), dormant sweep (−29), lane hook sites (−24) — **~−0.5 KB**
together, each a small `packages/signals` PR behind an existing-style install hook. The
perf-trade half remains an estimate.

### G. Core floor with behavior leniency (needs rulings)

~~The ~15 mainline implicit hold rules (F1, "behavior leniency"). **−1.5 to −2.5 KB**.~~
**Measured 2026-09-26 — see `size-reduction-g-rulings.md`.** Every rule site in `recompute`
(21) and the scheduler (10) was stubbed and the floor re-measured: all of them together are
**−824 B**; the largest single ruling (#3404 zombie children) is 127 B. The −1.5–2.5 estimate
came from the growth ledger and was wrong by 2–3×: the ledger counted what each fix added,
most of which is shared machinery later fixes also use. Even the model-level ceiling — no
implicit holds anywhere, transactions only through `action` — measures **−1.2 KB**, because
the machinery stays reachable from `runEffect`/`owner`/`heap` and the explicit paths. The
bytes are the model (`GlobalQueue` 11.5K, `recompute` 7.5K, `handleAsync` 6K un-mangled), not
the rules. **Recommendation: no rulings; take F's relocations instead.**

### H. Stores (follows G)

~~The store's `.v`/`.pb` arms that mirror whatever G removes. **−2 to −3 KB** for store users.~~
Falls with G: the store arms mirror rules whose removal is now measured at a few hundred bytes
in core; their store twins will be the same order. Not pursued unless measured otherwise.

### I. Density — the code everyone ships, made smaller (no semantics)

Same rigor as G, aimed at "what does each package spend its bytes on" rather than "what could be
shaken". Per package (signals 64.8K, frames client 31.8K, web 20.2K, solid 15.8K, sf 12.7K min
on the base SC page), measured:

1. The stage-3 perf trade — hot paths inlined/specialized for CodSpeed (~15% of rc growth);
   re-measure which still pay, un-inline the rest.
2. Property mangling headroom in `solid-js` and `@solidjs/web` (signals mangles `_` props with a
   shared name cache; the other two do not).
3. The frames client and sf transport as implementations — duplicated helpers, generality with
   no consumer, prod-retained diagnostics. The largest unaudited surface on the page.
4. Prod-retained strings and dev residue across all four packages.
5. Model consolidation in signals (`GlobalQueue` + `recompute` + `handleAsync` + `read` ≈ 33K of
   68K un-mangled): fewer concepts with the same observable semantics. A redesign, not a size
   PR — decided after 1–4 are measured.

Considered and declined the same evening: an async engine behind a dynamic-import seam (hybrid:
static install from any async-implying import, `import()` fallback from the first thenable).
Measured −2.1 KB on the floor as a lower bound and it would reach hello world 10 with no API or
semantic change for any realistic app — but it only helps apps with no async, which are
benchmarks. Recorded in `size-reduction-g-rulings.md`; not pursued.

## 5. Expected landing (brotli, KB)

|                           | today | after B+C+D |  + E |   + F |          + G+H |
| ------------------------- | ----: | ----------: | ---: | ----: | -------------: |
| hello world               |  12.7 |        12.7 | 12.7 | ~11.5 | **~10.6–11.1** |
| page: base SC             |  46.9 |       ~35.3 |  ~31 |   ~30 |        **~28** |
| page: live SC (no stores) |  51.2 |       ~40.4 |  ~37 |   ~36 |        **~34** |
| live SC + client stores   |   ~54 |         ~49 |  ~46 |   ~45 |        **~40** |

Goals: hello world 10, SC pages 30–40. Both SC pages reach the band on packaging alone; the
page with client stores sits at the top of it. **Hello world does not reach 10 under the fixed
API** (G measured, 2026-09-26): the floor is 9.9 of hello world's 12.7, and every semantic
lever together — rulings, relocations, the model-level ceiling — is worth ~1.1–1.2 KB, the
perf-trade re-measure perhaps another 0.5–1; that lands at ~10.6–11.1. The one lever that
reaches 10 is keeping `handleAsync` and the transaction entry it drives off the plain
`createSignal`/`createMemo` path — a packaging/API decision recorded as out of scope in §2.
(Table
re-based 2026-09-26 without B.1 and on the `next` @ 3af4696fb baselines; B.1 was −0.8 on the
hydrating column of the SC pages, so B+C+D lands ~0.8 higher than first estimated.)

## 6. Order and risk

1. A — one PR, no runtime change, lands before any cutting.
2. ~~B.1 and B.4~~ — both measured 2026-09-26: B.1 rejected (zero-sum across deployment
   classes), B.4 already the case. See F4. Category B is B.2 and B.3, both behind C and D.
3. C, then D, then B.2 and B.3 on top of D. D touches SSR and the frames client where Stage 8
   is active: one focused PR, timed with that work.
4. E in parallel once D exists.
5. ~~F any time; G's ruling table in parallel; G+H implementation after the rulings.~~ G
   measured and closed (`size-reduction-g-rulings.md`); H falls with it. F's relocations fold
   into whatever later touches `flush`; not a separate effort.
6. **I (density audit) is next** — before D/C/E, since it decides whether "smaller for
   everyone" has 5 KB in it or 15, and that decides how much of B–E is worth building.

Every category ships to `next` as its own small PR, rebased daily; no long-lived branch. Each PR
reports before/after on the same base commit, and `next`'s number is recorded at each landing so
drift is attributed to the PR that caused it. While the effort runs, any PR touching
`packages/signals/src/core` states its floor delta in its body.
