# Server-components layer — size audit and rewrite decision (2026-10-05)

Branch `size/sc-audit` off `next` @ `6f77b1bde`. **Nothing here changes an
engine**; the two commits on the branch are this document and a size-harness
fix. Companion documents: `size-reduction-audit.md` (the 2026-09-26 plan whose
packaging tier — B.2, B.3, C, D, E — this re-evaluates),
`size-reduction-carve-step1.md` (the signals carve, #3774, whose method this
borrows), `documentation/server-components/server-components-principles.md`
(axioms A1–A7/L1, DR-1…5, the §4 mechanism audit, the §6 size budget),
`documentation/server-components/frame-streams-rfc.md` (RFC 11).

The question: the SC layer has grown (three Size-Exceptions on the frames
scenario in a week — `e133516c8`, #3759 +773 B br / +2,262 min) — does it get a
rulings-first rewrite pass like the signals carve, or only the packaging work
already planned?

**Answer in one paragraph.** The SC layer costs a page **27.1 KB brotli /
93.0 KB minified** over the hydrating baseline. Of that, **≈13.5 KB br is
reachable by the packaging tier without a rewrite** (measured on edited dist
copies: B.2 −7.7, B.3 −2.4, live tier −0.5, sf natural-body split −0.5,
binding-slot tier −2.5), because — unlike the signals core, where the removed
layers left 2.9 KB of residue _inside_ `recompute`/`read`/the flush — the
frames client's layers (live, binding slots, staging, adoption, container
traces) are separable functions with ≈1.3 KB min of residue in shared paths.
The incidental share a rewrite would recover is **≈7 KB min (13.5 % of the SC
modules) ≈ 2 KB br**, mostly duplicated seams (two dedupes, two gates, two
waiters, two bootstraps, two version spaces, two asset loaders, two reveal
engines) and per-fix patches the principles doc already lists as compensatory
(§4 rows 14, 19, 20; the #2968 deferral). Recommendation: **package first,
then a scoped rulings pass on three seams** (regions as store substructure,
one apply path for staged content, A5-complete records) — not a full carve.
The wire format and the server half (§6.3) make a from-scratch rewrite an
order of magnitude more expensive than the signals carve for a tenth of its
prize.

---

## 1. Scenario baseline

`npm run -s size -- --json` at `6f77b1bde`, local (macOS, Node 26.4,
Rolldown 1.2.11). CI (Linux, Node 24) at the same commit reads **identical
bytes on every scenario** (run 37287144468) — the "local brotli differs by a
few bytes" caveat did not bite at this head.

| scenario                                                                   | minified B | brotli B | cap      | headroom | lazy (not counted)              |
| -------------------------------------------------------------------------- | ---------: | -------: | -------- | -------: | ------------------------------- |
| app: hydrating (no stores) with Show/For/Loading/Errored/lazy              |     52,421 |   17,650 | 17.66 KB |       10 | lazy-page 42 br                 |
| frames: eager client consumer (frames client + transport, lazy codec)      |     43,310 |   13,770 | 13.78 KB |       10 | — (codec external)              |
| page: base server components (hydrating + dynamic + frames + sf reference) |    145,392 |   44,762 | 44.78 KB |       18 | decode.js 22,986 min / 6,074 br |
| page: live server components (base + live/GET + action + isPending/latest) |    157,312 |   48,436 | 48.45 KB |       14 | decode.js 22,986 / 6,074        |

**Per-package attribution** — two columns because they disagree. `size.mjs`
apportions each module's _standalone_ minified size to the chunk (bundle.mjs);
the source map gives the exact minified bytes each module occupies in the
chunk (`/tmp/sc-fn/fnmap.mjs`, §2). The apportioning undercounts the frames
client by ~10 % and overcounts signals/solid; the source-map column is the one
the rest of this document uses.

| package (source map, exact)     | hydrating (no stores) | frames scenario | page base | page live | page base as `size.mjs` prints it |
| ------------------------------- | --------------------: | --------------: | --------: | --------: | --------------------------------: |
| `@solidjs/signals`              |                29,604 |               — |    57,373 |    64,843 |                            60,004 |
| `solid-js`                      |                12,377 |    — (external) |    16,089 |    16,089 |                            18,273 |
| `@solidjs/web`                  |                10,306 |    — (external) |    20,168 |    20,191 |                            18,989 |
| `@solidjs/web/frames`           |                     — |          39,199 |    38,989 |    38,989 |                            35,501 |
| `@solidjs/web/server-functions` |                     — |           3,797 |    12,588 |    16,963 |                            12,389 |
| scenario entry                  |                   134 |               — |       185 |       231 |                               236 |

(`size.mjs`'s hydrating column reads signals 28,251 / solid 15,352 / web
8,688 — the same ±10 % apportioning skew.)

**The SC layer's marginal cost to a page** (page base − hydrating (no stores)):
**92,971 B minified / 27,112 B brotli** (+177 % / +154 %). Where it goes
(source map, exact):

| marginal piece                      |  min B |  share | what it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | -----: | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `web/frames` client                 | 38,989 |   42 % | the frame runtime + transport (§2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `web/server-functions` client       | 12,588 | 13.5 % | reference proxy, dispatch, framing, codec seam, GET                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `@solidjs/signals` store engine     | 27,769 |   30 % | `store/store.js` 17,715 + `utils` 3,641 + `reconcile` 3,017 + `projection` 2,120 + `types` 766 + `target` 214 + ~300 core residue — pulled by the frames client's eager `setContainerTraceMaterializer(materializeContainerTrace)` (plan B.2)                                                                                                                                                                                                                                                                                                                                                    |
| `solid-js` store hydration adapters |  3,712 |    4 % | `hydrateStoreFromAsyncIterable` 1,091, `materializeContainerTrace` 843, `hydrateStoreLikeFn` 699, `createShadowDraft` 445, `applyPatches` 206, `quietAnswer` 202, … — same cause                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `@solidjs/web`                      |  9,862 | 10.6 % | `dynamic` 960 + the attribute runtime its string-tag branch retains (`spread` 812, `assignProp` 787, `className` 651, `style` 423, `setAttribute` 280, `classListToObject` 266, `collectProps`/`pushEntry`/`readShallow`/`collectTable`/`collectSources`/`entryHas`/`entryGet` 1,202, `addEvent` 261, `delegateEvents` 111, `assign` 242, `createElement` 205, `staticDynamic` 182, `staticElement` 102, `runHydrationEvents` 588, `getNextElement` 226, `bindingOf` 90, module-scope tables +1,957) (plan B.3 — but see §5: `assign` is now also retained by the frames client's binding slots) |
| other                               |    ~60 |      — |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Live − base**: 11,920 min / 3,674 br — `signals/core/lanes.js` 4,626 +
`verdict.js` 1,896 + `action.js` 626 (+ scheduler/core residue 229) =
7,377 for `isPending`/`latest`/`action`; `web/server-functions` +4,375
(`live` 2,767, `EventStreamReader` 1,141, `textDigest`/`positionDigest`
328, `trackLiveConnection`, `liveAddressFor`, module-scope +120).

**Growth record of the frames scenario** (from the ledger in
`scripts/size/scenarios.js`): 10.37 KB br after Stage 5 (container tier) →
11.1 (Stage 6 behaviour props, since retired) → 11.27 (typed preloads) →
11.40 (identity canonicalization) → 11.45 (#3470 seams) → 11.50 (#3638 one
delivery path) → 11.67 (#3653 live Phase A, +316 min in the sf slice) →
12.40 (#3660 live Part B, **+2,343 min**) → 12.42 (#3671) → _Rolldown
re-base 11.77_ → 12.70 (#3704 binding slots, **+3,259 min** net of the
retired `_bnd` path) → 12.98 (#3714 text positions, +760 min) → 13.00
(#3774 L2 gate fix, +75 min) → 13.78 (#3759 staging, **+2,262 min**). The
principles doc's §6 budget for "frames: full consumer" was **≤ 7,800 B
min+gzip** (≈ 7.0 KB br); shipped is 13.77 KB br. Three features — live
(B2–B4), binding slots, staging — are 8.3 KB of the 39 KB minified frames
client, and every one is spec-pinned (§3).

---

## 2. Function-level attribution of the SC layer

**Method.** `/tmp/sc-fn/fnmap.mjs` (outside the repo) bundles a scenario
exactly as `bundle.mjs` does but with a source map, then walks every mapped
segment of the minified entry chunk and charges its byte length to the
innermost _named_ function in the original dist source containing the
segment's origin (acorn over the dist; class methods, `const f = () =>`,
object-literal methods and assignment targets are named; anonymous closures
roll up to their nearest named ancestor). Unlike the carve's `fnattr.mjs`
(split-and-minify-standalone) the pieces sum to the chunk exactly: 43,310 /
145,392 / 157,312 / 52,421 B, 0 unmapped on the pages. `attribute.mjs` stops
at the module, so this is the tool the brief asked for. The source map maps
to the flat dist files; the TS source file of each unit was recovered by
declaration lookup (`/tmp/sc-fn/group.mjs`).

### 2.1 By concern (page base; minified B, exact)

| concern                                                                                                                                                                                                           | frames client |  sf client |      total |                                                                                                     share of SC modules |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------: | ---------: | ---------: | ----------------------------------------------------------------------------------------------------------------------: |
| template slots: occurrences, regions, args (`#syncSlots`, `#invokeSlot`, `#resolveArgs`, `slotsFor`, `slotArgsProxy`, `collectSlots`, regions bind/rename/reconcile, range walkers)                               |         8,116 |          0 |      8,116 |                                                                                                                  15.7 % |
| frame store / host / flush core (`createFrameHost`, `chunkToRecords`, `FrameImpl#apply`/`#flush`/`#applyRoot`/`#applied`/`dispose`, fields)                                                                       |         6,076 |          0 |      6,076 |                                                                                                                  11.8 % |
| transport / fetch / single-flight (`applyFrames`, handler `handle`/`bindingFor`/`applyFlightResponse`, `ServerComponentPlugin`, `ChunkReader`, `createChunk`, `deliverFlightData`, `frameAddress`/`stableString`) |         2,944 |      2,611 |      5,555 |                                                                                                                  10.8 % |
| references / server-function client core (`dispatchServerFunction`, `createRequest`, `initializeResponse`, `createServerReference`, `GET`, registry)                                                              |             0 |      5,105 |      5,105 |                                                                                                                   9.9 % |
| binding slots: positions (#3704/#3714: `bindDataOccurrence`, `slotPositions`, `ownedPositions`, `textPosition`, `consumersEqual`, owned class/style morph)                                                        |         4,080 |          0 |      4,080 |                                                                                                                   7.9 % |
| document adoption / hydration-key payload (`adoptBoundary`, `documentBoundary`, `installRevealHook`, boundary index/waiters/arrivals, `claimRender`, `installServerComponents`' `_$SC` mirror, `intercept`)       |         3,850 |        142 |      3,992 |                                                                                                                   7.7 % |
| codec seam, eager half (`loadCodec`/tables/`getFrameHost`; sf `getHeadersAndBody`, `extractBody`, `isJSONSafe`, `serializeArguments`, `deserializeStream`, `decodeResponse`)                                      |           575 |      3,021 |      3,596 |                                                                                                                   7.0 % |
| morph / reconcile (`reconcileChildren`, `morphAttributes`, `morphNode`, grafts, range stash/adopt/move)                                                                                                           |         2,704 |          0 |      2,704 |                                                                                                                   5.2 % |
| live/GET on the base page (connections/`hold`/`bump` cancel, `resume` + have-list, `#applyHole`/`#applyAttrs`/`findLiveTarget`, `pumpLiveChannel`, `applyFrames`' wire plumbing, `isEventStream`)                 |         2,368 |        275 |      2,643 |                                                                                                                   5.1 % |
| staging / land-at-commit (#3759: handler `stage` + `named`/`settled`/`stagedContent`, `stageTables`, `FrameImpl#preview`, `#regionsChange`, host `preview`, region staging in `applyFlightResponse`)              |         1,871 |          0 |      1,871 |                                                                                                                   3.6 % |
| assets / preload / stylesheet mirror (`ensureStylesheet`, `ensurePreload`, `ensureModulePreload`, `applyInlineStyles`, `qualifierValue`, `findHeadElement`)                                                       |         1,717 |          0 |      1,717 |                                                                                                                   3.3 % |
| module scope (brands, constants, maps, exports)                                                                                                                                                                   |         1,001 |        613 |      1,614 |                                                                                                                   3.1 % |
| segments / reveal / fallback (`#revealSegment`, `#segmentReady`, `#showFallback`, placeholders)                                                                                                                   |         1,353 |          0 |      1,353 |                                                                                                                   2.6 % |
| error handling (`serverFunctionFailure`, `parseRetryAfter`, `errorFromTrailer`, `errorRecord`)                                                                                                                    |           168 |        821 |        989 |                                                                                                                   1.9 % |
| address switch / rebind / shell gate (`followAddress`, `boundaryComponent`, `FrameImpl#rebind`/`rebase`, the adopted face's gate)                                                                                 |           970 |          0 |        970 |                                                                                                                   1.9 % |
| container traces, eager half (`reviveContainerTraces`, `materialize`, `isContainerTraceMarker`, `isMaterializedContainer`, `setContainerTraceMaterializer`) — plus the 31,481 B it pulls from signals/solid       |           700 |          0 |        700 |                                                                                                                   1.4 % |
| element claims                                                                                                                                                                                                    |           496 |          0 |        496 |                                                                                                                   1.0 % |
| dev / diagnostics / observe                                                                                                                                                                                       |             0 |          0 |          0 | prod folds them (`devSlotOrphan`, `devCheckRange`, `slotShapeFinding`, `shapeOf`, `observed*` absent from the artifact) |
| **total**                                                                                                                                                                                                         |    **38,989** | **12,588** | **51,577** |                                                                                                                         |

On the **frames scenario** (package, web/solid external) the frames client is
39,199 B (+210: the import statements of five externals) and the retained sf
slice 3,797 B (`ChunkReader` 1,283, `deserializeStream` 610, `stableString`
601, `errorFromTrailer` 218, `deliverFlightData` 185, `createChunk` 163,
`configureServerFunctionsClient` 113, `hashArguments` 115, module scope 116,
…). The grouping is otherwise byte-for-byte the page's. On the **live page**
the sf client grows to 16,963 (live 4,530 under the live group).

### 2.2 Top 20 units (page base)

|   # | function                                                                                                                                                                                                                          | module               | concern(s)                         | min B |
| --: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------- | ----: |
|   1 | `createServerComponentHandler` (closure: `handle` 553, `applyFlightResponse` 422+, `stage` 189+302 in its methods, `resume` 189, `bump` 176, `showing` 118, `bindingFor` 94, `hold` 68, `componentFor` 59, `named` 53, outer 355) | web/frames           | transport; staging; live; adoption | 3,025 |
|   2 | `bindDataOccurrence` (`write` 653 + its `st.ref` 52, `valuesFor` 396, `writeText` 153, `release` 49, outer 446)                                                                                                                   | web/frames           | binding slots                      | 1,749 |
|   3 | `createFrameHost` (`write` 302, `unregister` 253, `apply` 182, `register` 179, `preview` 124, `serialize` 90, `storeFor` 73, `get` 57, `resolve` 53, outer 150)                                                                   | web/frames           | store/host core; staging           | 1,463 |
|   4 | `adoptBoundary` (`drainRecords` 367+50, `claimRegionFragments` 153, `recordsPending` 121, `applyLiveOp` 68, `settle` 38, `arm` 26, outer 597)                                                                                     | web/frames           | adoption; live; gate               | 1,420 |
|   5 | `dispatchServerFunction`                                                                                                                                                                                                          | web/server-functions | references                         | 1,338 |
|   6 | `slotsFor` (`get` 861 + `settle` 139 + `evaluate` 128 + `bind` 72, outer 95)                                                                                                                                                      | web/frames           | template slots                     | 1,295 |
|   7 | `FrameImpl.#syncSlots`                                                                                                                                                                                                            | web/frames           | template slots                     | 1,228 |
|   8 | `applyFrames` (`drain` 461, `end` 155+46+12, `connection.cancel` 127, `errorRecord` 85, outer 335)                                                                                                                                | web/frames           | transport; live; errors            | 1,221 |
|   9 | `FrameImpl.#flush`                                                                                                                                                                                                                | web/frames           | store/host core                    | 1,146 |
|  10 | module scope, frames client (`Symbol.for` brands ×7, regexes, `stagedContent`, `ServerComponentPlugin`, header constants, `tables`/`liveOps`/`liveAppliers`/`claimedBoundaries`/`boundaryWaiters`/`arrivals`/`handlerOwners`)     | web/frames           | module scope                       | 1,001 |
|  11 | `reconcileChildren`                                                                                                                                                                                                               | web/frames           | morph                              |   952 |
|  12 | `createRequest`                                                                                                                                                                                                                   | web/server-functions | references                         |   906 |
|  13 | `chunkToRecords`                                                                                                                                                                                                                  | web/frames           | store/host core                    |   815 |
|  14 | `GET` (`send` 347, `run` 159, `get` 25, `wrapped` 15, outer 209)                                                                                                                                                                  | web/server-functions | references                         |   755 |
|  15 | `initializeResponse`                                                                                                                                                                                                              | web/server-functions | references                         |   688 |
|  16 | `getHeadersAndBody`                                                                                                                                                                                                               | web/server-functions | codec seam                         |   669 |
|  17 | `extractBody`                                                                                                                                                                                                                     | web/server-functions | codec seam                         |   653 |
|  18 | `isJSONSafe`                                                                                                                                                                                                                      | web/server-functions | codec seam                         |   647 |
|  19 | module scope, sf client                                                                                                                                                                                                           | web/server-functions | module scope                       |   613 |
|  20 | `FrameImpl.#applyAttrs`                                                                                                                                                                                                           | web/frames           | live (attr holes)                  |   612 |

Next ten: `stableString` 607, `deserializeStream` 588, `installServerComponents`
588, `ChunkReader#next` 558, `#invokeSlot` 536, `#refArgsUnchanged` 534,
`#revealSegment` 510, `FrameImpl#preview` 505, `morphAttributes` 493,
`ChunkReader#readChunk` 492. The full sorted table (234 units) is Appendix A.

### 2.3 Per source file (page base)

| file                                                                                                                |  min B | note                                                           |
| ------------------------------------------------------------------------------------------------------------------- | -----: | -------------------------------------------------------------- |
| `web/frames/src/frame-client.ts` (3,193 lines, importless `FrameImpl` + host + morph)                               | 22,609 | 58 % of the frames client                                      |
| `web/frames/src/client.ts` (1,636 lines, the Solid binding: slots, boundaries, adoption, `installServerComponents`) |  9,683 |                                                                |
| `web/frames/src/frame-transport.ts` (1,038 lines, handler + `applyFrames` + plugin)                                 |  4,642 |                                                                |
| `web/frames/src/frame-container-plugin.ts`                                                                          |    700 | eager half only; the seroval plugin rides the lazy codec chunk |
| `web/server-functions/src/shared.ts`                                                                                |  5,885 | framing, addressing, body encodings, decode                    |
| `web/server-functions/src/client.ts`                                                                                |  5,805 | dispatch, references, GET (live 4,375 more on the live page)   |
| `web/server-functions/src/registry.ts`                                                                              |    285 |                                                                |
| module-scope / plugin object methods (unattributed to a file)                                                       |  1,968 |                                                                |

### 2.4 Coverage of the SC sources by the client suites

`vitest --coverage` (v8) over the whole `@solidjs/web` client suite (122
files, 1,139 tests) merged with the whole hydrate suite (275 tests),
`include` = the SC client sources; merged in `/tmp/sc-fn/covjoin.mjs`.

| file                                   | functions covered | branches covered | uncovered functions with bytes on the page                                                                                                                                                                      |
| -------------------------------------- | ----------------: | ---------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frames/src/client.ts`                 |           123/131 |          377/432 | none (the 8 are tiny arrows)                                                                                                                                                                                    |
| `frames/src/frame-client.ts`           |           135/145 |          810/970 | `ensureStylesheet` 474, `applyInlineStyles` 276 — **no client or hydrate test loads a stylesheet or inline style through a frame** (`runtime/stylesheet-gate.spec.js` tests `web.js`'s loader, not this mirror) |
| `frames/src/frame-transport.ts`        |             51/62 |          188/223 | none                                                                                                                                                                                                            |
| `frames/src/frame-container-plugin.ts` |             12/18 |            41/70 | none retained                                                                                                                                                                                                   |
| `server-functions/src/client.ts`       |             46/59 |          274/390 | `parseRetryAfter` 168                                                                                                                                                                                           |
| `server-functions/src/shared.ts`       |             42/60 |          156/302 | `errorFromTrailer` 218, `decodeResponse` 82 (server-side specs exercise them; the client bundle carries them untested from the client)                                                                          |

Uncovered-branch hot spots (frames client): `#applyAttrs` 10/35 missed,
`reconcileChildren` 10/65, `#refArgsUnchanged` 8/41, `#revealSegment` 7/14,
`#showFallback` 8/16, `#flush` 6/54, `#syncSlots` 5/71, `morphAttributes`
5/26, `findRangeStart` 5/6; sf client: `live` 22/61, `dispatchServerFunction`
15/70, `serverFunctionFailure` 9/14, `initializeResponse` 9/18,
`createRequest` 4/34. Dead-by-construction bytes in prod are **≈ 750 B min**
(the two stylesheet functions); the rest of the SC client is reached by at
least one test. The server suite was not run for coverage (its artifact
recorder rewrites `test/harness/__artifacts__` on drift).

---

## 3. Rulings inventory

What the SC transport guarantees, as numbered statements in the L2 section's
voice: one sentence, then the mechanism that carries it today
(`file:function`). **Load-bearing** = a spec pins it (named); **unpinned** =
only code or comments assert it. Sources: the principles doc (A1–A7, L1,
DR-1…5, §5, §9.5), RFC 11, PR bodies #3759 / #3660 / #3653 / #3704 / #3714 /
#3671 / #3770 / #3771 / #3763, the spec titles under `packages/web/test`
(frames: 29 files / 101 tests client+hydrate, 22 files / 139 tests server;
server-functions: 58 files / 525 tests), and the issue-number citations in
the sources (#547, #2964, #2968, #2977, #2978, #3094, #3097, #3100, #3102,
#3110, #3173, #3174, #3244, #3406, #3638, #3640, #3641, #3759).

### 3.1 Addressing, identity, stores (A3/A4, DR-1)

1. **Content is keyed by the call's address** — `frameAddress(id, args)`, the function id plus a stable hash of the arguments; every transport (preload, refetch, single-flight region, document) writes only that address's store. — `server-functions/shared.ts:frameAddress/hashArguments/stableString`; `frame-client.ts:createFrameHost.apply → write(storeFor(id))`. **Load-bearing**: `frames-client` "ownerless calls resolve by call address: same args stable, different args independent", "preloading the args a mounted site navigated away from does not morph its boundary".
2. **Mounts are keyed by site; the component `dynamic` sees is stable per function**, and an argument change at a live site delivers a new address into the same instance instead of remounting. — `frame-transport.ts:createServerComponentHandler.componentFor/bindingFor` (`COMPONENT_BINDING = { component, address }`), `web/src/index.ts:dynamic.sameInstance/resolveBinding`, `client.ts:followAddress → frame.rebind`. **Load-bearing**: `frames-client` "an ARGS-CHANGE handoff … updates the live occurrence", "a remounted site binds the latest call's address"; `frames-dynamic-contract`; `frames-live` "switching arguments … keeps the instance"; `hydration/frame-live-document-switched`.
3. **A warm store re-materializes synchronously**; retention is the resident store, not a snapshot. — `createFrameHost.register` (one apply of the whole seed, then `frame.rebase()`), `FrameImpl.rebind`. **Load-bearing**: `frames-client` "remounted site…", `frames-occlusion-client` "expand mounts from store, zero network". The one residue — the last-unmount `contentHTML` capture of a document-adopted interior (`createFrameHost.unregister`) — is **unpinned**.
4. **A store lives for the session**; eviction hangs off the purge form of `unregister(id)` and nothing calls it. — `createFrameHost.unregister` (no-frame form). **Unpinned**, and §5.1's policy (data-layer coupling + LRU floor) is unbuilt.
5. **Versions are per address, client-stamped; a stale (older) write drops, a newer one morphs in place, teardown is `dispose()` never a version bump (policy A).** — `createFrameHost.write`, `FrameImpl.apply` (the `v < version` / `v > version` arms), handler `bump`. **Load-bearing**: `frames-client` "morphs on re-fetch without remounting"; RFC 11 §"Versioning and stale chunks"; `frames-live` supersession.
6. **Per-response state resets on a version bump** — reveal/fallback bookkeeping, applied-hole dedupe, processed assets, the once-per-stream error notification, `seg:`/`hole:`/`attr:`/`:error` records — while slot records survive (the dedupe is what preserves occurrence state). — `FrameImpl.#resetStreamState`, `frame-client.ts:clearStreamRecords`. **Load-bearing** indirectly (`frames-client` "one server component mounted twice fans the stream out", reveal specs); the exact record set that clears is **unpinned**.
7. **Several mounts of one address share one store and every chunk fans out to all of them**; a late mount seeds from the store. — `createFrameHost` (`frames: Map<id, Set<Frame>>`). **Load-bearing**: `frames-client` "one server component mounted twice fans the stream out to both instances".
8. **A region is a nested frame keyed by `(occurrence, arg)`; its wire name (`$frame` childId) may change per stream and the live region frame rebinds to the new name without re-calling.** — `FrameImpl.#resolveArgs` (regions cache by arg), `renameRegion`, `#reconcileRegions`, `#regionsChange`. **Load-bearing**: `frames-optimistic-hold` "renamed nested region: the region follows the rename", `frames-used-region-client`. (§5.3 rules regions should be store substructure with one normalization; today the rename is reconciled at three sites.)

### 3.2 Chunks, records, the flush (A5/A6)

9. **Chunks are writes into a keyed record store, not events; application is prerequisite-driven and order-independent** — a record whose target is not in the DOM yet stays pending and any later flush retries. — `chunkToRecords`, `FrameImpl.apply → #flush` (the repeat-until-no-progress segment loop, the hole pass, the assets pass). **Load-bearing**: RFC 11 §"Chunk readiness and buffering"; `frames-binding-slots` "a zero-arg occurrence whose only consumers arrive late … binds when they appear"; `frames-adopted-region-fragments`.
10. **`data` chunks are response-scoped and never land in a frame's store**; they go to the host's data table for the stream's root id (nested region ids prefix-match their root). — `chunkToRecords` (`data → {}`), `createFrameHost.apply`, `client.ts:tableFor/ensureTable/beginStream`. **Load-bearing**: `frames-client` "suspends an async slot arg at the consumption read and settles from the data chunk".
11. **The codec loads lazily: the transport awaits `prepareData` before delivering the first `data` chunk, and the sequential loop queues every later chunk behind the load.** — `frame-transport.ts:applyFrames.drain` (`if (chunk.type === "data" && host.prepareData) await host.prepareData()`), `client.ts:loadCodec` (the decode-only entry). **Load-bearing** for the size half (`frames:` scenario externals; `dist-frames-server-instance`); the ordering half (records referencing data arrive after the data table has it) is pinned through "suspends an async slot arg…" only — **weakly pinned**.
12. **A record whose `{$ref}` data has not arrived is not applied** — the stream's own html/complete flush re-syncs with the same record once the table has the value. — `FrameImpl.#syncSlots` (`#refsUnresolved` guard), `#preview` (same guard). **Unpinned** as its own statement (the comment is the only record; it is the fix for pushing `undefined` into a live fill).
13. **An equivalent re-sent slot record keeps the existing record object** (no re-call, occurrence state preserved); a record differing only in `{$ref}` identity but equal in resolved value is adopted without a re-call. — `FrameImpl.apply` (`argsEquivalent`), `#refArgsUnchanged` (value compare with the container-identity and async-identity carve-outs). **Load-bearing**: `frames-used-region-client` "an identical re-sent record does not re-call", `frames-live` "a client slot's state … survives a reconnect: the re-sent slot record is equivalent".
14. **A live container (materialized trace) compares by identity only, never by probe**; an async value on either side of a compare is a change. — `#refArgsUnchanged`, `slotArgsProxy` (containers first). **Load-bearing**: `frames-client` DR-2 value-tier tests; `server/container-traces`. The identity-only rule for containers is **unpinned** on the client.
15. **Root asset records accumulate across the shell and late chunks** so a frame registering later receives the full snapshot. — `createFrameHost.write` (the `seg::assets` arm). **Load-bearing**: `preload-links-frame-client` "retains every late root asset record until a frame registers".
16. **`complete` is the bounded signal; a body ending with a started frame still open is a death, never a completion** (RFC 11 §9.5 D1); without a live loop the death is an `error` record on the frame. — `applyFrames` (`open` map, `end → sweep`). **Load-bearing**: `frames-live` "a body ending with the frame open is a death", "an UNDECLARED frame's body ending before complete is an error on the frame".
17. **A stream-level `:error` is a completion of the failing kind** (no retry); keyed errors scope to the hole or segment they name; an error record is an apply (it releases a gate). — `chunkToRecords` (`:error`, `hole:*:error`, `seg:*:error`), `#flush` (`#errorNotified`). **Load-bearing**: `frames-live` "a stream-level error record is a completion of the failing kind"; the gate-release-on-error half is **unpinned**.

### 3.3 Segments, reveal, assets (A6, L1)

18. **A segment reveals when its content record, its placeholder and its stylesheets are all present**; readiness is checked against store + DOM, not arrival order, and revealing one segment may unblock another (the retry drain). — `#segmentReady`, `#revealSegment`, `#flush`'s `progressed` loop. **Load-bearing**: `frame-server-component` "streams a real <Loading> boundary as fragment + reveal chunks"; `frames-client` "covers an unboundaried async client fill revealed in a deferred segment".
19. **A fallback gate materializes the placeholder template's content without resolving the segment** (`$dfl` semantics). — `#showFallback`. **Load-bearing**: `server/frame-live-resume` "a fragment the client shows as a fallback streams when it settles"; the client half is **weakly pinned** (reached by coverage, no title names it).
20. **When a `reveal` hook is provided, the reveal is boundary-driven**: a fresh client `<Loading>` shows the server fallback while the segment's fills are pending, so an unboundaried async fill is covered rather than orphaned. — `client.ts:revealSeam`, `#revealSegment` (seam branch). **Load-bearing**: `frames-client` "covers an unboundaried async client fill revealed in a deferred segment (no orphan)"; `server/frame-ssr-seam`. The imperative (no-hook) reveal path is **unpinned** and dead on Solid pages.
21. **Stylesheets gate reveals: a link this loader created settles on load or error; a link already in the document counts as settled.** — `frame-client.ts:ensureStylesheet`, `#segmentReady`. **Unpinned** (no client test reaches `ensureStylesheet`/`applyInlineStyles`; the `runtime/stylesheet-gate.spec.js` tests `web.js`'s loader).
22. **Typed preloads apply by full request identity and adopt document links across equivalent spellings** (`as` case, `crossorigin` three-state, empty source set = absent). — `ensurePreload`, `findHeadElement`, `qualifierValue` (mirror of `head.ts`). **Load-bearing**: `preload-links-frame-client` (4). (`preload-links-adopt-client` (10) pins the same spellings for `web.js`'s `useHead` loader — the mirror's twin, not the mirror.)
23. **Every apply that lands server content dispatches a bubbling `frame:applied` event** from the parent element (reason: materialize/morph/reveal/error), constructed from the element's realm. — `#applied`. **Unpinned** as a title (used by the router; the realm rule is a comment).

### 3.4 Morph (A7, DR-5)

24. **A newer version morphs server-owned nodes in place and never detaches a client-owned slot range or a fragment placeholder**; ranges match by occurrence identity first and position second. — `reconcileChildren`, `adoptRange`/`stashRange`/`flushGrafts` (graft sites), `compatible`, `preservesOpen`. **Load-bearing**: `frames-client` "morphs on re-fetch without remounting", `frames-hn-client` "global client-only collapse affects current and future navigated stories"; RFC 11 §"Correctness invariant: never detach a client-owned range".
25. **The morph keeps a text-position pair it meets again** (same element, same key) so the client's text node survives a refetch. — `reconcileChildren`, `isTextStart`. **Load-bearing**: `frames-binding-slots` "a refetch keeps the client's text", "a TEXT range the morph re-creates … rebinds".
26. **A morph skips attribute positions a fill owns** — including a live `attr` re-emission's whole-text match — and the owned class names / style properties inside `class`/`style`. — `morphAttributes`, `applyOwned`, `morphOwnedClass`, `morphOwnedStyle`, `#applyAttrs`. **Load-bearing**: `frames-binding-slots` "survives morphs", "a rebind that RELEASES value positions leaves the server's own attributes alone".
27. **An `attr` re-emission matches the element to the whole attribute text and removes attributes absent from it** (a resume's re-emission carries no `removed` list). — `#applyAttrs`. **Load-bearing**: `frames-live-resume` "an attr re-emission without a `removed` list … still drops the attributes that vanished".
28. **Elements the morph rewrites in place re-claim** (`href`/`action` set or removed) against the same element-claim registry compiled output uses. — `#claimTree(node, direct)`, `morphAttributes`. **Load-bearing**: `frames-client` "streamed SC anchors claim under the boundary owner; disposal runs consumer cleanup" (the removal arm is **unpinned**).

### 3.5 Slots — template occurrences (RFC 11 §Slot model, A5)

29. **A slot occurrence is identified by its marker key (`prop` or `prop#n`); the callback resolves by the prop, threaded up through nested frames; a direct-insert occurrence mounts with empty props and a render-prop occurrence with its resolved args.** — `#syncSlots`, `#resolveSlot`, `#resolveSlotRecord`, `propOf`. **Load-bearing**: `frames-client` "mounts, fills slot ranges from props", "props the server never placed stay unmounted; unknown occurrences without props stay empty"; `server/frame-server-component`.
30. **The hydration-attach invocation of an adopted range is the only one a consumer may answer with a claim** (return `undefined`, `existing` is the output); stream re-calls must render for real (#547). — `#invokeSlot` (`ctx.adopted`), `client.ts:slotsFor.settle` (the in-place check). **Load-bearing**: `frames-used-region-client` (#547), `hydration/adopted-slot-live`.
31. **A render-prop call gets live props: an args change pushes re-resolved props into the same instance (`ctx.onUpdate`) instead of re-calling**; a genuine re-call disposes the previous fill's scope first. — `#syncSlots` (the `update` arm), `client.ts:liveSlotProps`, `slotsFor` (`bindings`/`fillScopes` dispose-previous). **Load-bearing**: `frames-client` "a re-sent slot record with CHANGED args updates the live occurrence in place (no re-call)".
32. **An async slot arg is passed whole and suspends at the consumption read** into the reader's nearest boundary (DR-2 value tier); the memo is `transparent` so it consumes no hydration key, and a settled record-revived promise adopts synchronously (`s`/`v` stamps). — `slotArgsProxy`. **Load-bearing**: `frames-client` "suspends an async slot arg at the consumption read", "an async-iterable slot arg reads as the latest yield"; `server/document-face-arg-tiers`. The stamp fast-adopt is **weakly pinned** (hydration specs reach it; no title).
33. **A fill runs once, untracked, as a component body does**; its top-level read is a one-time read dev names. — `slotsFor.evaluate` (`untrack(…, label)`), `bindDataOccurrence`. **Load-bearing**: `frames-client` "a template fill runs as a component body", `frames-binding-slots` "a fill runs once, as a component body does".
34. **Reactive slot content owns its range through `insert` before the end marker** (returning `undefined`), with `existing` seeding the reconcile; the claim scope wraps the insert call, not the accessor. — `slotsFor` (`ctx.range` branch), `claimRender`. **Load-bearing**: `hydration/adopted-slot-live` "keeps updating when the claim's first read is not an accessor" (#2967).
35. **Stream-mounted fills render under a per-occurrence owner that dies with the occurrence; live-render fills keep the ambient owner.** — `client.ts:boundaryScope` (`streamInvoke`), `slotsFor` (`fillOwner`). **Unpinned** as a title (the leak it fixes — fills registering on the boundary owner — has no spec).
36. **A mounted occurrence whose output the morph destroyed remounts fresh** (the zombie heuristic). — `#syncSlots` (`prevFirst && !prevFirst.parentNode`). **Unpinned**; DR-5 says the state is unreachable under identity-first matching.
37. **An occurrence gone from the server content unmounts and releases its record, caches and regions; a region's record is deleted from the store that owns it unless a live occurrence of the same name holds it.** — `#unmountSlot`, `#removeSlotRecord`. **Load-bearing** (unmount) via `frames-binding-slots` "an occurrence's end detaches…"; the record-hygiene rule is **unpinned**.

### 3.6 Slots — binding positions (§9.2.3–9.2.5)

38. **One slot per data context, bound per position: the fill runs once per occurrence; value positions are written from one render effect's compute, diffed per position by `assign`; handlers are direct listeners read once at bind; `ref` fires once per element; a consumer change rebinds without re-running the fill.** — `client.ts:bindDataOccurrence` (`valuesFor`/`write`/`release`), `frame-client.ts:slotPositions`, `consumersEqual`, `#syncSlots` (rebind arm). **Load-bearing**: `frames-binding-slots` (21 tests), `hydration/binding-slot-adoption`, `server/frame-binding-slots` (31).
39. **A rebind that releases a value position leaves the server's attribute alone; a released handler unbinds; an outgoing occurrence must not clear a handler an incoming occurrence set on the same element.** — `bindDataOccurrence.write` (`clearing`, `handlerOwners`). **Load-bearing**: "a rebind that RELEASES value positions…", "an occurrence's end detaches the listeners it attached".
40. **A text position renders as a client insert renders a primitive** (string/number as text, nullish/boolean as nothing) between its marker pair. — `bindDataOccurrence.writeText`, `textPosition`. **Load-bearing**: `frames-binding-slots` TEXT tests (5).
41. **Marker keys and names are percent-encoded on the wire and decoded on the client.** — `slotEntry`. **Load-bearing**: `server/frame-binding-slots` "keys and class names percent-encode onto the marker alphabet".

### 3.7 Document face, adoption, hydration payload (A1/A2, DR-4)

42. **The page is the t = 0 record: a call whose function has an unclaimed SSR'd boundary is answered locally and synchronously, with no request; a boundary is consumed exactly once.** — `client.ts:installServerComponents.intercept`, `claimedBoundaries`, `server-functions/client.ts:createServerReference.run` (the synchronous intercept seam). **Load-bearing**: `frames-hn-client` "initial document load: adopt + claim, zero data", `hydration/frame-nonlive-document-3666-*` "no request", `frames-live-showing`.
43. **A boundary the page may still deliver is a deferred local answer (a promise), settling true at the reveal that carries it or false once the page has no reveal left**; the mount suspends and adopts on delivery instead of mounting fresh. — `awaitBoundary`/`arrivals`, `boundaryWaiters`, `boundaryMayArrive` (`_$HY.fr.pending()`), `installRevealHook`, `documentBoundary`. **Load-bearing**: `frames-late-boundary-client` (5).
44. **Adoption applies the document's slot and region records before binding the frame**, re-drained on every reveal and on the #2968 defer loop; records key by the wire (function) id and land in the address's store. — `adoptBoundary.drainRecords`, `fr.subscribe` cascade. **Load-bearing**: `frames-occlusion-client`, `hydration/adopted-slot-late-record` "waits for the record instead of invoking the callback argless", `frames-adopted-region-fragments` "a record delivered with the fragment reaches the frame".
45. **A recordless invoked occurrence defers classification while the document can still run data scripts** (`recordsPending`: parser running, or a fragment pending), re-syncing a macrotask later. — `#syncSlots` (`#recordRefresh`), `adoptBoundary.recordsPending`. **Load-bearing**: `hydration/adopted-slot-late-record`. Principles §4 row 20 and the §6 note call it interim ("until record delivery is ordered by construction").
46. **An adopted boundary claims every deferred-fragment placeholder in its region** (and in content revealed into it later) so the held-swap policy does not hold them forever; claims release with the frame. — `adoptBoundary.claimRegionFragments`. **Load-bearing**: `frames-adopted-region-fragments` (#2978).
47. **Claims re-enter hydration under the producer's key chain** (`sc-<frame>-<key>-`), with a range-scoped registry handed over from the root registry, and the range declared as claim roots. — `client.ts:claimRender`, `gatherClaims`, `hasPendingFragment`. **Load-bearing**: the hydration frame specs, `frames-hn-client`.
48. **The document live channel (`sc:live`) is one `ReadableStream` of ops, pumped once at module level and broadcast to every adopted boundary; the log compacts last-value-wins per target and replays to late adopters; slot ops carry `fid` and only the owning boundary applies them.** — `pumpLiveChannel`, `liveOps`, `adoptBoundary.applyLiveOp`. **Load-bearing**: `hydration/document-live-channel`, `server/document-live-holes`.
49. **The `_$SC` bootstrap resolves an addressed reference to the call's binding and records address → id; the client mirrors it for pages whose data scripts carried none.** — `frame-sink.ts:SERVER_COMPONENT_BOOTSTRAP_EXPR`, `client.ts:installServerComponents` (`g._$SC = { c, a, b, r }`), `handler.showing`. **Load-bearing**: `frame-live-document-artifact` (the addressed reference), `hydration/frame-nonlive-document-3666-*` (#3671 adoption).
50. **Hydration-key shape: one record per async `dynamic()` instance and one extra owner id per instance** (value memo + render memo); a server component landing crosses as a flight reference `_$SC.r(id, address)`. — `web/src/index.ts:dynamic`, `ServerComponentPlugin.serialize`. **Load-bearing**: `dynamic-hydration`, `dynamic-static`, the re-recorded artifacts (#3671).

### 3.8 Transport, flight, references (RFC 10/11, §3.1 of the shipped contract)

51. **A frame-tagged response resolves the call with a binding, never data; the response streams into the address's store as the only observable effect.** — `handler.handle`, `FRAME_STREAM_HEADER`. **Load-bearing**: `frames-client`, `frames-flight-delivery` "the component resolved to its binding".
52. **The single-flight envelope's `outcome` chunks decode through the same `deliverFlightData` path a plain body takes; each consumer gets its slice; a bare error-tagged envelope throws, one with metadata is control flow; an envelope-less single-flight frame response is truncation.** — `applyFlightResponse`, `shared.ts:deliverFlightData/hasFlightMetadata`. **Load-bearing**: `frames-flight-delivery` (5, #3638/#3641), `server/server-functions-single-flight`, `-flight-*` (3 files).
53. **A mutation whose own result is markup resolves to the call's binding when the header names the frame.** — `applyFlightResponse` (`rootId ? settled(...) : envelope.value`). **Load-bearing**: `frames-flight-delivery` (#3641), `dist-frames-server-instance`.
54. **The frames client, the server-function client and the serialization entry are one instance per app**: the frames dist imports the sf client externally and inlines no registry; resolving its wire-layer imports to that entry makes the config the transport reads the shared one by construction. — `rollup.config.js:externalizeSharedTransport/assertFramesClientTransport`. **Load-bearing**: `dist-frames-server-instance` (#3640), `dist-nested-manifests`.
55. **Chunk framing is `;0x<8 hex>;` length-prefixed UTF-8 JSON, one implementation on both faces**; event-stream framing carries codec payloads as `data:` events with `id:` positions and comment heartbeats. — `shared.ts:createChunk/ChunkReader`, `createEventChunk/EventStreamReader/isEventStream`. **Load-bearing**: `runtime/chunk-reader`, `server-functions-live-framing`, `server/frame-live-framing`.
56. **A reference's call goes to the data address (`/_server/data/<id>`), a live call to the live address, the rendered `url` is the plain address; bound arguments ride `?args=`.** — `client.ts:createServerReference/siblingAddressFor`, `shared.ts:serverFunction*Address`, `parseServerFunctionAddress`. **Load-bearing**: `server-functions-addressing`, `frames-get` (3), `server/frame-get` (5).
57. **A GET-encoded call carries no transport header of its own** (#3406); flight collection is asked for only on mutation calls with registered consumers; `prepareRequest` must return an init with the transport's method (#3174). — `createRequest`. **Load-bearing**: `server-functions-get-grant-binding`, `server-functions-http-hygiene`, the single-flight specs; the #3174 validation is **weakly pinned** (branches uncovered by the client suite).
58. **Argument encoding ladder**: no args → bare; one natural-HTTP-encoding arg → as-is; JSON-safe list → JSON; JSON-safe leading + natural trailing → `?args=` + body; else the codec, which is opt-in (`enableRichArguments`). — `initializeResponse`, `shared.ts:getHeadersAndBody/isJSONSafe`, `serializeArguments`. **Load-bearing**: `server-functions-body-formats`, `-undefined-arguments`, `-negative-zero`, `-flash-bound-form`.
59. **Only what the runtime wrote may resolve a call**: a ≥ 400 without the body-format header is a refusal; a 2xx with neither body format nor `X-Content-Raw` is "not our server" (#3173); among encoded responses only the error tag rejects (#3097); redirects/revalidation/single-flight on a read pass through whole (#3102); 304 is left alone. — `dispatchServerFunction`, `serverFunctionFailure`. **Load-bearing**: `server-functions-transport-failure`, `-redirect-*`, `-error-carrier-guard`, `-failure-signal`, `-version-skew` (#3110 `unknownFunction`), `-result-descriptors`.
60. **The transport decodes the response body itself, never a clone** (#3244). — `dispatchServerFunction`, `extractBody`. **Load-bearing**: `server-functions-body-buffering`.
61. **A streaming result's `return()` aborts the call** (the controller the call minted) so the server tears the producer down. — `dispatchServerFunction` (the async-iterator wrap). **Load-bearing**: `server-functions-live-lifetime`, `server/frame-teardown` "cancelling the response body returns the standing source".
62. **The seroval plugin for a branded component serializes a reference (`self._$SC.r(id, address)`), never markup-as-data; the flight codec injects it by tag.** — `ServerComponentPlugin`, `flightCodec`. **Load-bearing**: `server/frame-hn` "every comment text crosses the wire exactly once", `frame-live-document-artifact`.

### 3.9 Live (§9.5 client face 1–7; Stage 8 B2–B4)

63. **`live` is the loop; frames consume it**: the handler resolves the loop's binding and hangs the response's end on the loop's wire slot — death → backoff and re-invoke into the same binding; completion → the iteration closes. — `handler.handle` (the `LIVE_WIRE` arm), `applyFrames` (`connection.ended/cancel`), `sf client.ts:live/trackLiveConnection`. **Load-bearing**: `frames-live` (8), `server-functions-live-retry`, `-live-lifetime`.
64. **One live connection per address; a second live reader joins the first's lifetime and its own body is ended.** — handler `connections`/`hold`, `handle` (`current && !current.done`). **Load-bearing**: `frames-live` "two live readers of one call share one connection".
65. **A newer version from another response supersedes the live connection: the host cancels it and the loop reconnects** (client face 4). — handler `bump` (`connection.cancel`). **Load-bearing**: `frames-live` "a newer response for the address from another call supersedes the live connection".
66. **A reconnect carries the address's version ordinal as `Last-Event-ID` and the mount's have-list under `X-Frame-Have` (omitted over 4,096 B → full snapshot); the ledger tracks what the mount has APPLIED (root digest + holes, each reveal, each hole/attr), never derived from the DOM.** — handler `resume`, `encodeHaveList`, `FrameImpl.have/#recordHave`, `createRequest` (wire headers). **Load-bearing**: `frames-live-resume` (5), `server/frame-live-resume` (9), `server/frame-live-framing` (B4).
67. **A live-hole or attr-hole record applies when its target is in the DOM, deduped by record identity per mount; a hole error latches and is a one-time diagnostic.** — `#flush` (hole pass), `#applyHole`, `#applyAttrs`, `findLiveTarget`, `#appliedHoles`. **Load-bearing**: `server/frame-live-holes*`, `hydration/document-live-channel`; the per-mount dedupe (a fresh mount replays the warm store's holes) is **unpinned**.
68. **The post-adoption connect is a full snapshot** (the document face does not seed the ledger); every later reconnect is conditional. — `#have` is `undefined` for a document-adopted root. **Load-bearing**: `frames-live-resume` "a root without digests leaves no ledger". Recorded as not built in §9.5.

### 3.10 Address switch, gates, staging (#2977, e133516c8, #3759)

69. **A fresh mount's covering boundary stays open until the frame's first apply** (content or error); only mounts a stream has begun for gate — a placeholder mount with no call in flight renders its empty frame now. — `client.ts:boundaryComponent` (`applied = !tables.has(id)`, `mountGate`, `onApply → settle`). **Load-bearing**: `frames-client` "mounts, fills slot ranges…", `frames-dynamic-contract` "pending keeps stale content"; the "only switches with a stream begun gate" rule is **unpinned**.
70. **An address switch re-arms the gate in the pass that sees the new address and registers a frameless waiter under it; the gate settles on the new address's first write; the rebind runs in the effect half at the commit — the switch IS display, one reveal (ruling 2026-10-04).** — `followAddress` (compute half: `rearm()` + `host.register(address, { apply: settle })`; effect half: `stagedContent.commit`, `drop()`, `frame.rebind`). **Load-bearing**: `frames-morph-in-transition` "switch: the new call's content waits for the other work the write started", `frames-client` "call-driven lifecycle" (a second switch mid-flight binds), `frames-client` "a memo-wrapped source delivers a switched address from inside the compute (dev-safe)" (`ownedWrite`).
71. **A refetch of an address a mount is SHOWING is staged, not written: chunks buffer under the address, the call resolves to a content token (`address\0version`) when the body is buffered, and the mount lands it in two halves — `preview` (slot args into the live fills, in the pass of the transaction that delivered the token) and `commit` (markup, store, mounts, regions, at that transaction's commit).** — handler `stage`/`named`/`settled`/`stagedContent`, `FrameImpl#preview`, `createFrameHost.preview`, `stageTables` (STAGED_DATA), `contentAddress`. **Load-bearing**: `frames-morph-in-transition` (3), `frames-optimistic-hold` (6 — "a refetch of a SHOWING call reads pending until its content applies; a cold call still settles at the header"), signals pins `compute-write-joins-transition`, `settle-folds-queued-writes`.
72. **A cold mount or a switch to an address nothing shows writes through with header-time resolution** (the shell gate is its hold). — `handler.handle` (`host.get(address) ? stage(...) : undefined`). **Load-bearing**: `frames-optimistic-hold` "a cold call still settles at the header".
73. **A staged response that is superseded by a newer version is dropped; a staged response that no reader mounts is never shown.** — handler `bump` (`staged.delete`), `named` (`entry.token === token`). **Load-bearing**: `frames-live` supersession test (updated by #3759).
74. **Single-flight regions for a showing call route by root and land when the integration's cache takes the slice** (the mutation's data delivery). — `applyFlightResponse` (`regions`, `regionOf`, per-frame `version` staging). **Load-bearing**: `frames-morph-in-transition` "single-flight: the mutation's region lands with the data the response seeds", `frames-optimistic-hold` "single-flight: the region lands with the cache seed".
75. **A region whose args add or rename a `{$frame}` is structural and waits for the commit; a preview adopts a record only when its refs are resolvable through the staged tables.** — `FrameImpl#preview`, `#regionsChange`, `#refsUnresolved(args, resolve)`. **Load-bearing**: `frames-optimistic-hold` "renamed nested region", "`{$ref}` args on the shared host".

### 3.11 Count

**75 statements: 65 load-bearing, 4 weakly pinned (reached by a spec but no
title or assertion names the rule: 11, 19, 32, 57), 6 unpinned (4, 12, 21,
23, 35, 36).** Nine load-bearing statements carry one unpinned clause (the
`contentHTML` residue in 3, the exact reset set in 6, the client-side
container identity rule in 14, gate-release-on-error in 17, the imperative
reveal path in 20, the claim-removal arm in 28, record hygiene in 37, the
per-mount hole dedupe in 67, "only switches with a stream begun gate" in 69).
Everything unpinned is small (≤ 750 B min each; ≈ 2.3 KB together) and mostly
hygiene or non-Solid paths. The load-bearing set covers the wire format, the
store model, the morph invariant, both slot kinds, adoption, live and staging
— i.e. there is no large mechanism here that only a comment defends, which is
the opposite of what the signals carve found in the hold rules.

---

## 4. Structural vs incidental

For each concern: the bytes a ruling requires (structural) vs the bytes that
exist because of how mechanisms were layered over time (incidental:
duplicated seams, compatibility shims, dead branches, two ways to do one
thing, per-fix additions). Estimates are minified bytes on the page base,
read off the function table; brotli at the SC layer's observed ratio
(≈ 0.29) where a total is given.

| concern                              |      min B |              structural |                                                                                                                   incidental (est.) | evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------ | ---------: | ----------------------: | ----------------------------------------------------------------------------------------------------------------------------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| template slots                       |      8,116 |                  ~6,300 |                                                                                                                          **~1,800** | (a) two dedupes: `argsEquivalent` 217 at apply (record level) and `#refArgsUnchanged` 534 at sync (value level) — one rule (13) carried twice because tables rotate per response; A5 says one record shape shrinks it. (b) region identity reconciled at three sites — `renameRegion` 84, `#reconcileRegions` 165, the rename arm of `#resolveArgs` ~60, `#regionsChange` 124 (in staging) — §4 row 19 "compensatory; wire-relative renames delete" when regions are store substructure (§5.3). (c) the nested-frame thread-up protocol (`resolveSlot`/`resolveSlotRecord`/`removeSlotRecord` options + their three methods ≈ 325) — same ruling. (d) the `adopted` fork (`ctx.adopted`, `settle`'s in-place check, `claimRender` ×2 call sites ≈ 300) — §4 row 14 "shrinks when A5 removes the difference". (e) the zombie heuristic ~120 — DR-5 says unreachable. (f) `isAsyncValue` (client.ts 119) and `isAsyncLike` (frame-client.ts 98): the same probe spelled twice because frame-client is importless. (g) `slotsFor`'s two dispose-previous maps (`bindings`, `fillScopes`) with identical bookkeeping ≈ 250. |
| frame store / host / flush core      |      6,076 |                  ~5,500 |                                                                                                                            **~550** | `contentHTML` + the capture arm of `unregister` ≈ 190 (§4 row 3's residue); the root-assets accumulate special case in `write` ≈ 120 (a patch for one record kind reusing a key); `#flush` walks the whole flat record store three times with string-prefix tests (segments, holes, assets) ≈ 200 of repeated loop code that a bucketed store would not need; `FrameImpl.#version` duplicating `store.version` (→ `rebase`, the `#version = undefined` resets) ≈ 60.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| transport / single-flight            |      5,555 |                  ~5,200 |                                                                                                                            **~350** | `showing()`'s branding of the per-function placeholder (118) is a patch so cache-seeded readers pass `dynamic`'s equals-gate before a binding exists; `applyFrames`' public generality (`as` remap, `version` as number-or-function, `perFrame` map) that the bundled handler always drives one way ≈ 150; `bindingFor` vs `stage`'s token-binding mint (two binding constructors) ≈ 50. The rest — `ChunkReader` 1,283, `stableString` 607 (address hashing), `deliverFlightData`, `applyFlightResponse` — is rulings 1, 51–55.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| references / sf client core          |      5,105 |                  ~4,500 |                                                                                                                            **~600** | `GET` re-implements `createServerReference`'s proxy/`run`/`send` (≈ 300 of its 755 duplicate the reference constructor); `createRequest` carries ~250 B of `prepareRequest` guidance text in prod (two multi-line error messages) — dev-only candidate; `serializeArguments`' 330 B message (counted under codec).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| binding slots                        |      4,080 |                  ~3,700 |                                                                                                                            **~300** | `bindDataOccurrence.write` keeps its own diff state (`prev`, `handlers`, `clearing`, `handlerOwners`) above `assign`'s diff because handlers are read once and `assign` cannot tell a released position from an unchanged one — a second diff layer. Otherwise rulings 38–41 line by line; the whole group is a pay-for-use tier (E.c, §5).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| document adoption                    |      3,992 |                  ~2,700 |                                                                                                                          **~1,300** | §4 row 20 (compensatory, "deletes under DR-4"): `drainRecords` 417 + `appliedRecords`; the #2968 deferral (`recordsPending` 121 + `#recordRefresh` arm in `#syncSlots` ≈ 150 + the drain hook) ≈ 300 — "interim until record delivery is ordered by construction"; the #2978 cascade (`claimRegionFragments` 153 + the `fr.subscribe` body ≈ 100) compensates for the fragment ledger not knowing adopted regions own their placeholders; two late-boundary waits (`boundaryWaiters` for the mount path, `arrivals` for the intercept path) resolved from the same subscription ≈ 150 duplicated; `documentAddress` 91 scans `_$SC.a` because the t = 0 record does not carry the address to the mount; the `_$SC` bootstrap exists twice (server expression string in `frame-sink`, client mirror `installServerComponents.r` 208).                                                                                                                                                                                                                                                                                    |
| codec seam (eager)                   |      3,596 |                  ~3,200 |                                                                                                                            **~400** | `serializeArguments` is 415 B of which ~330 is an error message (prod text; dev-only candidate); `deserializeStream`'s live arm (`wire`, `end`/`sweep`/`close` ≈ 150) runs with `wire` undefined on every non-live page (#3653's own note). `getHeadersAndBody` 669 is structural but pay-for-use (E.b).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| morph / reconcile                    |      2,704 |                  ~2,650 |                                                                                                                                 ~50 | DR-5 landed (graft sites are the identity index); nothing duplicated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| live/GET on the base page            |      2,643 | 2,643 (for a live page) |                                                                 0 structural; **all of it is pay-for-use on a non-live page** (E.a) | measured floor −1,762 min / −525 br when stubbed with call sites kept. The document live channel (`sc:live`) is reachable without `live()`, so the tier key is "the server emitted holes/channel", not the import.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| staging (#3759)                      |      1,871 |                  ~1,250 |                                                                                                                            **~600** | `FrameImpl#preview` (505) re-implements the mounted-and-args-changed arm of `#syncSlots` (`refsUnresolved` → `regionsChange` → `refArgsUnchanged` → `resolveArgs` → `update`) as a second apply path threaded host → frame → regions; `stageTables` (183) is a second data-table map keyed the same way as `tables`; `named`/`settled`/`stagedContent`/`contentAddress`/the `\0` token encoding (≈ 150) exist because the token must travel through `dynamic`'s address accessor as a string. The rulings (71–75) are structural; the _shape_ — staging as a parallel path rather than a "staged version" bit on the one store write the host already version-guards — is the incidental part. The #3759 waiter + re-arm split (ruling 70) is ≈ 80 B and ruled; not incidental.                                                                                                                                                                                                                                                                                                                                         |
| assets / preload / stylesheet mirror |      1,717 |                    ~950 |                                                                                                                            **~750** | `ensureStylesheet` 474 and `applyInlineStyles` 276 are reached by no client or hydrate test; the whole group is an "import-free mirror of the client asset registry" (`web/src/client.ts:acquireAsset/findAssetElement`, `head.ts:qualifierValue`) kept separate by frame-client's importless rule — a rule `client.ts` already breaks by importing `insert`/`assign` from `@solidjs/web`. On a page that also uses `useHead` the two loaders both ship.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| module scope                         |      1,614 |                  ~1,500 |                                                                                                                                ~100 | seven `Symbol.for` brands, header names, the handler/plugin objects: the cross-bundle contract (ruling 54).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| segments / reveal / fallback         |      1,353 |                  ~1,200 |                                                                                                                            **~150** | the imperative (no `reveal` hook) swap branch of `#revealSegment` is dead on Solid pages (the binding always passes the seam). The larger item is cross-package: an SC page runs **two reveal engines** — `web.js`'s `$df`/`$dfl` document runtime and the frame's `#revealSegment`/`#showFallback` — which DR-4 ("the document is the t = 0 frame, one reveal owner") planned to unify; not countable as deletable without that work (~1.3 KB on whichever side goes).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| error handling                       |        989 |                    ~900 |                                                                                                                                 ~90 | `parseRetryAfter`'s HTTP-date arm (uncovered); `errorFromTrailer` is reached only from the server suite.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| address switch / gate                |        970 |                    ~720 |                                                                                                                            **~250** | the shell gate is implemented twice with the same `arm`/`settle`/`setGate`/`ownedWrite` signal/`createMemo` pattern — `boundaryComponent` and the adopted face in `adoptBoundary` (≈ 150 duplicated); `rebase()` + `rebind`'s version/root resets exist because the frame carries a version beside the store's (≈ 100).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| container traces (eager)             |        700 |                     700 | 0 structural; **packaging-incidental: the module-load install pulls 31,481 B** (signals store engine 27,769 + solid adapters 3,712) | B.2 measured −27,722 min / −7,669 br.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| element claims                       |        496 |                     496 |                                                                                                                                   0 | ruling 28.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **total (SC modules)**               | **51,577** |             **~44,000** |                                                                                              **≈ 7,300 min (14 %) ≈ 2.0–2.2 KB br** |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Per-fix additions, itemized (all inside the figures above): #2968 deferral
≈ 300, #2978 cascade ≈ 250, #2977 re-arm gate ≈ 250 (ruled, structural),
#547 adopted-vs-recall fork ≈ 200, #3759 waiter ≈ 80 (ruled), `showing()`
brand ≈ 120, `contentHTML` residue ≈ 190, root-assets accumulate ≈ 120, the
two-dedupe pair ≈ 500, the three rename sites ≈ 430.

**Layer residue in shared paths** — the test the signals carve turned on. The
layered capabilities (binding slots 4,080, live 2,368, staging 1,871, adoption
3,850, container traces 700, gate 970 = 13,839 B, 36 % of the frames client)
leave **≈ 1.3 KB min inside the core paths**: `#syncSlots`' consumer arms
≈ 300, `#flush`'s hole/attr and assets passes ≈ 500, `chunkToRecords`'
digest/holes/hole/attr cases ≈ 250, `morphAttributes`/`reconcileChildren`'s
owned-position and text-pair arms ≈ 140, `collectSlots`' `_s:` branch ≈ 100.
That is 3 % of the frames client, against the signals carve's finding that
2.9 KB of the 4.4 KB removed lived inside `recompute`/`read`/the flush. The
frames layers are modules already; what they lack is the import edge that
would let them tree-shake — which is the packaging tier.

**Outside the SC modules but only SC pages pay** (§1): the store engine +
adapters 31,481 and `dynamic`'s attribute runtime 9,862 are 44 % of the
layer's marginal cost and 0 % of its rulings — pure packaging.

---

## 5. Packaging baseline — what the planned tier saves without a rewrite

Measured, not estimated, wherever a dist copy could be edited to simulate the
move (`/tmp/sc-fn/variants.mjs`: copies of the built dists under `/tmp` with
the import or the function body replaced, bundled through `bundle.mjs` with
the scenario's alias pointed at the copy; the repo dists are untouched). A
stub keeps the call site, as the real split behind a slot/seam would, so each
figure is the floor of the move, not its ceiling; the real split adds the
seam's own bytes (≈ 100–300 B min per seam, the carve's hook-slot experience).

| move (plan §B/§E)                                                                                                                                                                            | page base min / br (Δ)                                     | page live min / br (Δ)              | frames scenario            | firmness                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| as shipped                                                                                                                                                                                   | 145,392 / 44,762                                           | 157,312 / 48,436                    | 43,310 / 13,770            | —                                                                                                                                                                                                                                                                         |
| **B.2** materializer lazy (frames client stops importing `materializeContainerTrace` at module load; needs the server-driven preload seam §D so revival stays synchronous at the claim walk) | 117,670 / **37,093 (−7,669)**                              | 129,533 / **40,707 (−7,729)**       | −77 / −23 (its own bytes)  | **firm** (import edit; the whole store engine + adapters leave)                                                                                                                                                                                                           |
| **B.3** `dynamic()` string-tag branch lazy (`staticElement` behind the seam)                                                                                                                 | 137,375 / **42,390 (−2,372)**                              | 149,295 / 46,045 (−2,391)           | —                          | **firm**, and **smaller than the plan's −4.3 KB**: since #3704 the frames client imports `assign` for binding slots, so `assignProp`/`className`/`style`/`setAttribute`/… stay retained through that edge; only `spread`/`collectProps`/… leave. B.3 alone is −8,017 min. |
| B.2 + B.3                                                                                                                                                                                    | 109,628 / **34,683 (−10,079)**                             | 121,492 / **38,358 (−10,078)**      | —                          | firm                                                                                                                                                                                                                                                                      |
| **E.a** live tier out of the eager client (resume/have-list, connections/cancel, hole + attr apply, document channel pump)                                                                   | −1,701 / **−481** → 34,202                                 | n/a (a live page keeps it)          | −1,762 / **−525** → 13,245 | **floor** (bodies stubbed, sites kept). Needs a server-known key: "this response/document carries holes or a channel" — it is not `live()`-only.                                                                                                                          |
| **E.b** sf natural-encoding bodies + codec-args message + Retry-After/trailer parsing behind a lazy seam                                                                                     | −1,606 / **−476** → 33,726                                 | −1,607 / −519 → 37,384 (+E.a)       | −214 / −65                 | **floor**; the plan's "~−1 KB" assumed `isJSONSafe`/`stableString`/`extractBody` could leave — they cannot (every call with arguments hashes them; every data answer decodes).                                                                                            |
| **E.c** binding-slot tier behind the `_s:` marker (the #3704 follow-up; `assign` import leaves with it)                                                                                      | −8,138 / **−2,504** → **31,222**                           | −8,140 / −2,542 → 34,842 (with E.a) | ≈ −4,000 / ≈ −1,000 (est.) | **firm on the page** (measured); with B.3 it is what recovers the plan's −4.3 KB for `dynamic` (web 14,615 → 10,689).                                                                                                                                                     |
| B.2 + E.c without B.3                                                                                                                                                                        | 112,075 / 35,424                                           | 123,938 / 39,147                    |                            | shows `assign` does leave with E.c: web 18,524 (the attribute runtime stays only through `dynamic`'s string tag).                                                                                                                                                         |
| **C** `preserveModules` for `solid-js`/`@solidjs/web`                                                                                                                                        | 0 on these scenarios (single-entry)                        | 0                                   | 0                          | prerequisite for B.2/B.3 (the materializer and `staticElement` are welded into flat dists) — the plan's §C stands.                                                                                                                                                        |
| **D** server-driven preload seam                                                                                                                                                             | +≈ 300–600 B min on the server + client (the seam itself)  |                                     |                            | guessed; the one mechanism B.2, B.3, E.a, E.c all need.                                                                                                                                                                                                                   |
| codec                                                                                                                                                                                        | already lazy: decode.js 22,986 / 6,074 as a separate chunk |                                     | external                   | nothing to do.                                                                                                                                                                                                                                                            |

**Packaging-only floors** (all tiers, seams' own cost added back at +400 B
min / +120 B br per page — a guess):

| scenario                      | today            | packaging only                                               | Δ                       |
| ----------------------------- | ---------------- | ------------------------------------------------------------ | ----------------------- |
| frames: eager client consumer | 43,310 / 13,770  | ≈ 37,700 / **≈ 12.3 KB** (E.a + E.b + E.c)                   | ≈ −1.5 KB br            |
| page: base server components  | 145,392 / 44,762 | ≈ 98,600 / **≈ 31.4 KB**                                     | **−13.4 KB br (−30 %)** |
| page: live server components  | 157,312 / 48,436 | ≈ 113,300 / **≈ 35.5 KB** (B.2 + B.3 + E.b + E.c; E.a stays) | **−12.9 KB br**         |
| app: hydrating (no stores)    | 52,421 / 17,650  | unchanged                                                    | 0                       |

Both pages land inside the 30–40 KB band the 2026-09-26 plan set, on
packaging alone — as that plan predicted ("Both SC pages reach the band on
packaging alone"), with B.3 smaller and E.c larger than it estimated.

---

## 6. Decision

### 6.1 Options and floors

| option                                                                                               | frames eager (min / br)  | page base                 | page live                 | what it buys beyond the other                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P — packaging only** (C → D → B.2, B.3 → E.c → E.a, E.b)                                           | ≈ 37.7 K / **≈ 12.3 KB** | ≈ 98.6 K / **≈ 31.4 KB**  | ≈ 113.3 K / **≈ 35.5 KB** | −13 KB br on both pages; no rulings needed; no wire change. Leaves the ≈ 2 KB br of duplicated seams and the two reveal engines.                                                                                                         |
| **C — carve only** (rulings-first rewrite of `web/frames` ± `server-functions` client, no packaging) | ≈ 35.5 K / **≈ 11.5 KB** | ≈ 137.5 K / **≈ 42.5 KB** | ≈ 149.5 K / **≈ 46.2 KB** | −7 KB min incidental (§4) + −2.3 KB min from the three seam re-derivations (regions as substructure, one apply path, A5-complete) − ≈ 1 KB of new mechanism ≈ **−8 KB min ≈ −2.3 KB br**. The store engine and `dynamic`'s runtime stay. |
| **P + C' — package first, then a scoped rulings pass on three seams**                                | ≈ 31.5 K / **≈ 10.5 KB** | ≈ 92 K / **≈ 29.7 KB**    | ≈ 106.5 K / **≈ 33.5 KB** | P's −13 KB, then ≈ −1.8 KB br (the incidental bytes inside the E.a/E.c tiers leave with the tiers, so the carve's eager-page share shrinks from 2.3 to ≈ 1.8).                                                                           |

Minified is the structural number; brotli the shipped one. P's figures are
measured floors + a guessed seam cost; C's are estimates from §4's table; the
carve's actual landing would be known only by doing it.

### 6.2 Recommendation: **P + C'** — package first, then a scoped rulings pass; not a full carve

Why not a carve first, as for signals:

- **The decision rule of the carve does not fire.** The signals carve was
  justified by residue: capabilities nobody used cost hello world 4.4 KB
  inside the hot paths, and only a rebuild could take them out. Here the
  layers are separable functions with ≈ 1.3 KB min of residue (3 % of the
  frames client); the import edge is what is missing, and that is packaging.
  44 % of the layer's marginal cost (store engine + adapters, `dynamic`'s
  attribute runtime) is not even in the SC modules.
- **The prize is a tenth of the signals one.** Incidental ≈ 7 KB min ≈ 2 KB
  br against a 27 KB br layer (7 %); the signals floor went −46 %.
- **The rulings are pinned.** 65 of 75 statements have a spec; the six
  unpinned ones and nine unpinned clauses are hygiene and non-Solid paths
  worth ≈ 2.3 KB min together. A carve
  "re-derives each rule from its tests" — here the tests already hold the
  rules, so the carve would mostly be re-expressing the same mechanisms.
- **The compatibility surface is wide and two-sided** (§6.3): a rewrite of the
  client is a rewrite against a wire format and a 7,400-line server half
  (`frame-sink.ts` 2,771 + `server-functions/server.ts` 4,651) that must keep
  emitting what the new client reads. Signals had no peer.

Why not packaging only:

- The duplicated seams (two dedupes, two gates, two waiters, two bootstraps,
  two version spaces, two asset loaders, three rename sites, the preview path)
  are the per-fix growth pattern the frames ledger shows (each Size-Exception
  added a mechanism beside the existing one), and the principles doc's own §4
  dispositions (rows 14, 19, 20; the #2968 deferral) are still open two months
  on. Packaging moves them into tiers; it does not stop the next feature
  adding a fourth rename site.
- Three of them are design seams the principles doc already ruled and did
  not build: **regions as store substructure** (§5.3), **A5-complete records**
  (DR-4 row 20 + the #2968 deferral), and — new since — **staged content as a
  store state** rather than a parallel apply path. Those are small, rulings
  exist, and a pass that builds them under a per-step size gate is the carve's
  method at the right scale.

Order: packaging first because it is independent of the rulings, three times
larger, and lowers the surface the rulings pass then measures against (the
incidental bytes inside the binding-slot and live tiers leave with the tiers,
so the pass is scoped to the eager core).

### 6.3 The risk signals did not have: a wire format and a server half

Everything a client rewrite must keep reading/writing unchanged (or
version), from the sources:

**Response/request headers** — `X-Frame-Stream` (value: the producing frame
id), `X-Frame-Have` (have-list `key=digest,…`, budget 4,096), `X-Single-Flight`
(request: registered source ids; response: folded sources),
`X-Server-Function-Format` (`BodyFormat`), `X-Server-Function-Error`,
`X-Server-Function-Redirect`, `X-Server-Function-Unknown`, `X-Revalidate`,
`X-Content-Raw`, `Last-Event-ID` (version ordinal / value digest),
`Retry-After`, `Content-Type: text/event-stream`, `Cache-Control: no-store`,
`X-Accel-Buffering: no`.

**Framing** — `;0x<8 hex>;` length-prefixed UTF-8 JSON chunks (`createChunk`/
`ChunkReader`); SSE framing (`data:` events, `id:`, `:\n\n` heartbeat).

**`FrameChunk` kinds and fields** — `start`, `html` (+`digest`, `holes`),
`fragment` (key), `hole` (key), `attr` (key, `attrs`, `removed?`), `reveal`
(`keys`, `waitForStyles?`, `fallback?`), `data` (`key`/`node`/`initial` or
eval `payload`), `assets` (`modules`, `styles`, `inlineStyles`, `preloads`),
`slot` (`key`, `args` with `{$ref}`/`{$frame}` markers), `complete`, `error`
(`key?`), and `outcome` (single-flight envelope text). Versions are the
client's; `as` remaps the root id.

**Store record keys** (observable through `frame.store`, `isRevealed`, the
`:error` read) — `""`, `seg:<k>`, `seg:<k>:reveal|fallback|assets|error`,
`slot:<occurrence>`, `hole:<k>`, `attr:<k>`, `hole:<k>:error`, `:complete`,
`:error`.

**DOM markers the server emits and the client parses** — `<solid-frame
data-fid>` (`FRAME_ID_ATTR`), `<!--slot:<id>:start-->` / `<!--slot:<id>:end-->`,
`<template id="pl-N">` + `<!--pl-N-->`, `<!--lh:N-->…<!--lh:/N-->`,
`data-lha`, `_s:<position>="<occurrence>:<key>[=<name>]"` (percent-encoded),
`<!--_s:t=<occurrence>:<key>-->…<!--/_s:t-->`, `_hk` hydration keys and the
`sc-<frame>-<key>-` claim prefix, `_key`, `a[href]`/`form[action]` claim set.

**Hydration data** — `_$HY.r["sc:slot:<fid>:<occ>"]`,
`_$HY.r["sc:region:<childId>"]` (value or promise), `_$HY.r["sc:live"]`
(`ReadableStream` of `{ type: hole|attr|slot|error, key, fid?, … }` ops),
the fragment ledger API `_$HY.fr.{pending, subscribe, claim, release}`,
`_$HY.done`; the `_$SC` bootstrap (`c`, `a`, `b`, `r(id, address?)`, `impl`,
`reg`) in two copies (`frame-sink.ts:SERVER_COMPONENT_BOOTSTRAP_EXPR`, the
client mirror); one hydration record + one extra owner id per async
`dynamic()` instance (#3671); the serializer stamps `s`/`v` on promises.

**Registered symbols (cross-bundle contracts)** — `solid.component-binding`
(`{ component, address }`), `solid.server-component`,
`solid.server-component-source`, `solid.server-component-address`,
`solid.element-claims`, `solid.container-trace`, `solid.container-trace-state`,
`solid.LiveSource`, `solid.LiveResumeFrom`, `solid.LiveLocal`,
`solid.ServerFunctionMetadata`, `solid.ServerFunctionInvoke`,
`solid.ServerFunctionRPC`; the module-local `LIVE_WIRE`, `STAGED_DATA`, the
`\0` content-token separator inside address strings.

**Addresses** — `frameAddress(id, args)` = id + hash of `stableString(args)`
(the hash algorithm is a wire contract between `showing()` records, flight
references and the client's own calls); `/_server/<id>`, `/_server/data/<id>`,
`/_server/live/<id>`, `?args=<JSON>`; the GET url length ceiling.

**Server-function reference shape** — `createServerReference(id, name?,
base?)` proxy exposing `id`, `url`, `SERVER_FUNCTION_METADATA`,
`SERVER_FUNCTION_INVOKE`; `GET(fn)`, `live(fn)`;
`configureServerFunctionsClient({ endpoint, codec, fetch, prepareRequest,
responseHandler: { handle, capture, intercept, resume }, serializeArgs })`;
the compiler ABI (`"use server"` output calls `createServerReference`).

**Seroval** — `ServerComponentPlugin` (tag `solid/server-component`), the
container-trace plugin in the default plugin set (lazy decode chunk),
`__SEROVAL_REFS__`, `createJSONDataTable`'s `apply`/`resolve` and the
deserializer's `open`/`close`/`abort`.

**Public `@solidjs/web/frames` API (experimental)** — `installServerComponents`,
`getFrameHost`, `createFrame`, `createFrameHost`, `createFrameElement`,
`applyFrameResponse`, `isFrameStreamResponse`, `createServerComponentHandler`
(+ `.resume`, `.showing`), `FRAME_STREAM_HEADER`, `FRAME_HAVE_HEADER`,
`FRAME_HAVE_BUDGET`, `FRAME_APPLIED_EVENT`, `asyncArg`; `Frame`/`FrameHost`/
`FrameOptions`/`SlotContext`/`Slot`/`AttributeSlot` types; `@internal`:
`Frame.preview`, `FrameHost.preview`, `contentAddress`, `stagedContent`,
`STAGED_DATA`, `encodeHaveList`/`decodeHaveList`.

A rewrite that changes any of the first seven blocks changes the server half
too (`frame-sink.ts`, `server-functions/server.ts`, `src/server.ts`'s hole
engine, the compilers' `serverComponents` output for `_s:` markers) and
re-records the 146 `__artifacts__` fixtures. The signals carve changed no
peer.

### 6.4 The test corpus that gates a rewrite

| suite                                                                                                                                                                                         |    files |                   tests | what it pins                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------: | ----------------------: | ------------------------------------------------------------------------------------------------------ |
| `packages/web/test/frames-*.spec.tsx` + hydration frame specs + `preload-links-frame-client` + `dist-frames-server-instance`                                                                  |       29 |                     101 | rulings 1–3, 5, 7–9, 13, 16–18, 20, 22, 24–34, 38–47, 49–53, 63–75                                     |
| `packages/web/test/server/frame-*`, `document-live-*`, `server-frame-records`, `hydration-transfer`, `container-traces`, `document-face-arg-tiers`, `tree-rewrite`, `concurrent-render-trace` |       22 |                     139 | the server half of every wire statement; B4 conditional render; binding-slot faces                     |
| `packages/web/test/server/server-functions-*.spec.tsx` + `runtime/chunk-reader`, `runtime/serializer`                                                                                         |       58 |                     525 | rulings 55–62, framing, addressing, encodings, failure policy, live lifetime                           |
| `packages/web/test/harness/__artifacts__`                                                                                                                                                     | 146 JSON |                       — | the document face byte-for-byte (recorder-maintained)                                                  |
| signals pins for staging                                                                                                                                                                      |        2 |                       4 | `compute-write-joins-transition`, `settle-folds-queued-writes`                                         |
| examples                                                                                                                                                                                      |        5 |                       — | `todos-server`, `chat`, `notes`, `hackernews`, `room` (browser-verified in the PRs; no automated gate) |
| **total**                                                                                                                                                                                     |  **111** | **765 + 146 artifacts** |                                                                                                        |

Gaps a gate should close before any pass: the 6 unpinned statements and 9
unpinned clauses (§3.11, ≈ 2.3 KB of mechanism), `ensureStylesheet`/`applyInlineStyles` (0 client
tests), the uncovered branches of `#applyAttrs` (10/35), `reconcileChildren`
(10/65), `#refArgsUnchanged` (8/41), `live` (22/61),
`dispatchServerFunction` (15/70).

### 6.5 Step plan with per-step size gates

Each step is its own PR off `next`, reports before/after on the same base,
and is gated by `scripts/size` (every scenario ≤ cap) **plus** the step's own
expectation stated here; a step that lands outside its band is the finding,
not a failure to hide. Caps are lowered at each landing (the ratchet).

| step                                                                | content                                                                                                                                                                                                                                                                            | gate (br, page base / page live / frames eager)                                          | expected                    |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------- |
| **S0**                                                              | this audit                                                                                                                                                                                                                                                                         | —                                                                                        | done                        |
| **S1 — pins**                                                       | spec the 6 unpinned statements and 9 unpinned clauses + the two stylesheet functions + the five uncovered-branch hot spots; no runtime change                                                                                                                                      | 0 B on every scenario                                                                    | ≈ +25 tests                 |
| **S2 — C**                                                          | `solid-js`/`@solidjs/web` built `preserveModules` (as signals); route splitting works; store wrappers in their own modules                                                                                                                                                         | single-entry scenarios ±layout only (≤ ±50 B each)                                       | 0                           |
| **S3 — D**                                                          | the server-driven preload seam: SSR records "this document needs module X" (trace serialized / string-tag `dynamic` / holes or channel emitted / `_s:` markers emitted); the document preloads X through the `lazy()` manifest path; the client awaits it before the scope's claim | ≤ +150 B br each page; server floor ≤ +100                                               | the one mechanism S4–S6 use |
| **S4 — B.2**                                                        | materializer loaded through D                                                                                                                                                                                                                                                      | page base **≤ 37.3 KB**, live **≤ 41.0**                                                 | −7.7 / −7.7                 |
| **S5 — B.3 + E.c**                                                  | string-tag `dynamic` and the binding-slot tier through D; `assign` leaves the eager frames client                                                                                                                                                                                  | page base **≤ 32.5**, live **≤ 36.3**; frames eager **≤ 12.8**                           | −4.9 / −4.9 / −1.0          |
| **S6 — E.a + E.b**                                                  | live/holes/channel tier (key: holes or channel emitted) and the sf natural-body/message/trailer split                                                                                                                                                                              | page base **≤ 31.6**; frames eager **≤ 12.3**; live page unchanged ±100                  | −0.9 / −0.5                 |
| **S7 — rulings pass, seam 1: regions as store substructure** (§5.3) | region identity `(address, occurrence, arg)` normalized once at the store boundary; `renameRegion`/`#reconcileRegions`/`#regionsChange`/the thread-up options delete                                                                                                               | frames eager **≤ 11.9**; retained frames suite 0 regressions                             | ≈ −1.0 KB min               |
| **S8 — seam 2: one apply path for staged content**                  | a staged version is a store write the host holds under a "not shown" bit and releases at the commit; `preview` becomes the ordinary args-update arm reading the held version; `stageTables` folds into version-keyed tables                                                        | frames eager **≤ 11.6**; `frames-morph-in-transition` 3/3, `frames-optimistic-hold` 6/6  | ≈ −0.7 KB min               |
| **S9 — seam 3: A5-complete records** (DR-4 row 20, #2968)           | the document sink emits frame-shaped records into the one buffer before adoption can observe them; `drainRecords`, the deferral, `documentAddress`, one of the two waiters delete                                                                                                  | frames eager **≤ 11.3**; hydration frame specs 0 regressions; artifacts re-recorded once | ≈ −0.8 KB min               |
| **S10 — dedupes, gates, loaders**                                   | one dedupe (`#refArgsUnchanged` subsumes `argsEquivalent` or vice-versa), one gate helper, one `isAsync*`, the asset mirror routed through `web`'s registry via `client.ts`'s existing import edge                                                                                 | frames eager **≤ 10.8**                                                                  | ≈ −1.2 KB min               |

Expected end state: frames eager ≈ 10.5–10.8 KB br, page base ≈ 29.5–30 KB,
page live ≈ 33.5 KB. S1–S6 need no rulings; S7–S9 each need one ruling (§7).
DR-4's "one reveal engine" is deliberately not a step: it is a design change
on the document runtime (`$df` family) with ≈ 1.3 KB at stake, and should be
its own plan if the maintainer wants it.

---

## 7. Open questions for the maintainer

1. **Regions as store substructure (S7).** §5.3 rules the identity
   `(parent address, occurrence, arg)` and says wire-relative renames delete
   — but the wire still ships producer-relative child ids and the server
   half (`frame-sink`) addresses region chunks by them. Normalize on the
   client at the store boundary (no wire change, ≈ −1 KB), or change the
   wire to emit canonical region ids (server change, re-record artifacts)?
2. **Staged content as a store state (S8).** #3759 chose a parallel path so
   the shown response's tables stay in place while the staged one decodes.
   Is "the host holds a version under a not-shown bit and releases it at the
   commit" an acceptable restatement of rulings 71–75, given it moves the
   hold from the handler into the host (`FrameHost` gains a held-version
   notion)? The `\0` token through `dynamic`'s address accessor would stay.
3. **A5-complete records (S9).** The #2968 deferral is "interim until record
   delivery is ordered by construction" — DR-4's document sink emitting
   frame-shaped records. Is S9 in scope for this effort or does it wait for
   the wire freeze the principles doc ties it to?
4. **The tier key for E.a.** The document live channel and live holes are
   reachable without `live()`; the proposed key is "the server emitted holes
   or a channel for this document/response". Confirm, or rule that holes are
   `live`-only.
5. **E.c's behaviour change.** A page whose first binding-slot markers arrive
   in a _post-load stream_ (not the document) takes a chunk load before the
   fill binds — the same accepted change B.3 makes for CSR `dynamic`. Accept?
6. **Two reveal engines (DR-4).** Out of this plan unless ruled in; ≈ 1.3 KB
   on one side. Does the maintainer want it scoped as its own pass?
7. **The §6 frames budget.** The principles doc's "frames: full consumer
   ≤ 7,800 B min+gzip" is 2× under what ships and predates live, binding slots
   and staging. Replace it with per-tier budgets (eager core / live tier /
   binding tier / adoption) once S5–S6 exist?
8. **Store eviction (ruling 4).** Nothing calls the purge form; §5.1's policy
   is unbuilt. Pin "stores live for the session" as the rule, or build the
   LRU floor?
9. **Unpinned rulings worth keeping vs dropping** (S1): the imperative
   reveal path (20), the zombie heuristic (36), the once-per-stream
   gate-release-on-error (17), the `contentHTML` capture (3). Pin or delete?
10. **`attribute.mjs` has the same filter bug** `size.mjs` had (`i !== minAt
    - 1`with`minAt = -1`drops the first positional filter without`--min`). Fix in the same housekeeping PR?

---

## 8. Housekeeping checked with this audit

Done on this branch (separate commit `chore(size): size.mjs keeps the first
positional filter without --json`): `filters` excluded index `jsonAt + 1`,
which is index 0 when `--json` is absent, so `node size.mjs "core floor"`
measured all 14 scenarios. Verified: with and without `--json` (flag first or
last) one scenario runs; two filters select two; the JSON carries only the
filtered scenario.

**Not done — premise did not hold.** The ask was to lower `app: CSR, observe
tier + attribution engine enabled` from 28.62 back to 28.61 KB on the basis
that CI measured 28,599 B at `eaddda42c`. CI's Size runs read **28,612 B at
`eaddda42c`** (run 37286841301) and **at `6f77b1bde`** (run 37287144468);
**28,592 B at `b0c6e6af7`** and `7addcc656` (before #3777); and the #3777
ledger note in `scenarios.js` itself records "measured at 28,612 B against
`next` @ 6be6c5174's 28,592 (+20 B)". Local reads 28,612 too. 28.61 KB
(28,610 B) would fail CI by 2 B; the cap stays 28.62 KB, which is already
head + 8 B, under the head + 10 rule.

`node check-floor-caps.mjs origin/next`: no cap raised.

**Caps that could be lowered to CI head + 10 B** (rounded up to 0.01 KB),
from the `6f77b1bde` CI run — the maintainer decides; none lowered here:

| scenario                        |    CI head | cap          | head + 10 → cap       | lowerable                                               |
| ------------------------------- | ---------: | ------------ | --------------------- | ------------------------------------------------------- |
| signals: core floor             |      7,321 | 7.33 KB      | 7,331 → 7.34          | no (cap is head + 9)                                    |
| **signals: + createStore**      | **14,508** | **14.53 KB** | **14,518 → 14.52 KB** | **yes, 14.53 → 14.52** (inline limit in `scenarios.js`) |
| signals: + isPending/latest     |      9,446 | 9.45 KB      | 9,456 → 9.46          | no (head + 4)                                           |
| app: render + one signal        |      9,812 | 9.83 KB      | 9,822 → 9.83          | at the rule                                             |
| app: hydrating (no stores)      |     17,650 | 17.66 KB     | 17,660 → 17.66        | at the rule                                             |
| app: hydrating + every store    |     28,785 | 28.80 KB     | 28,795 → 28.80        | at the rule                                             |
| app: CSR                        |     12,807 | 12.82 KB     | 12,817 → 12.82        | at the rule                                             |
| app: CSR, observe tier          |     14,389 | 14.39 KB     | 14,399 → 14.40        | no (head + 1)                                           |
| app: CSR, observe + attribution |     28,612 | 28.62 KB     | 28,622 → 28.63        | no (head + 8)                                           |
| frames: eager client consumer   |     13,770 | 13.78 KB     | 13,780 → 13.78        | at the rule                                             |
| page: base server components    |     44,762 | 44.78 KB     | 44,772 → 44.78        | at the rule                                             |
| page: live server components    |     48,436 | 48.45 KB     | 48,446 → 48.45        | at the rule                                             |
| server: floor                   |      1,331 | 1.34 KB      | 1,341 → 1.35          | no (head + 9)                                           |
| server: renderToString          |     20,412 | 20.42 KB     | 20,422 → 20.43        | no (head + 8)                                           |

---

## 9. Reproducing

All measurement scripts live outside the repo under `/tmp/sc-fn/` and are
reproducible from this document:

- `fnmap.mjs <scenario> [--module s] [--json f]` — source-map function
  attribution (acorn + `@jridgewell/trace-mapping` from the workspace's
  `node_modules`, Rolldown from `scripts/size/node_modules`); `group.mjs`
  (source-file lookup, page-vs-hydrating diffs), `concerns.mjs` (the §2.1
  grouping — the function → concern map is in the file), `covjoin.mjs`
  (merge of the two `coverage-final.json`s, uncovered functions joined to
  bytes), `variants.mjs` (the §5 dist-copy edits), `titles.mjs` (spec title
  extraction). JSON: `fn-{frames,base,live,hyd}.json`, `baseline.json`,
  `variants.out`, `spec-titles-{client,server,sf}.txt`, `pr-bodies.txt`,
  `ci-head-6f77b1bde.txt`.
- Coverage: `npx vitest run --coverage --coverage.provider=v8
--coverage.reporter=json --coverage.include='frames/src/**/*.ts'
--coverage.include='server-functions/src/{client,shared,registry}.ts'
--coverage.include='serialization/src/*.ts' --coverage.all=false` in
  `packages/web` (default config = client suite; `--config
vite.config.hydrate.mjs` = hydrate suite). The server suite was not run
  for coverage (its artifact recorder writes into the tree).
- CI numbers: `gh run view <id> --repo solidjs/solid --log | grep "brotli"`
  for the Size workflow's push runs on `next`.

---

## Appendix A — every unit of the SC modules on page base (minified B, exact)

Concern letters: **O** template slots · **K** store/host/flush core · **T**
transport · **R** references · **B** binding slots · **H** adoption · **C**
codec seam · **M** morph · **L** live · **S** staging · **P** assets · **Z**
module scope · **V** segments · **E** errors · **A** switch/gate · **N**
container traces · **X** claims. A unit tagged with several letters is a
closure whose inner functions belong to different concerns (the §2.1 totals
split them at the inner-function level).

| function                         | module           | concern | min B |
| -------------------------------- | ---------------- | ------- | ----: |
| `createServerComponentHandler`   | frames           | TSLH    |  3025 |
| `bindDataOccurrence`             | frames           | B       |  1749 |
| `createFrameHost`                | frames           | KSC     |  1463 |
| `adoptBoundary`                  | frames           | HLA     |  1420 |
| `dispatchServerFunction`         | server-functions | R       |  1338 |
| `slotsFor`                       | frames           | O       |  1295 |
| `FrameImpl##syncSlots`           | frames           | O       |  1228 |
| `applyFrames`                    | frames           | TLE     |  1221 |
| `FrameImpl##flush`               | frames           | K       |  1146 |
| `<module>`                       | frames           | Z       |  1001 |
| `reconcileChildren`              | frames           | M       |   952 |
| `createRequest`                  | server-functions | R       |   906 |
| `chunkToRecords`                 | frames           | K       |   815 |
| `GET`                            | server-functions | R       |   755 |
| `initializeResponse`             | server-functions | R       |   688 |
| `getHeadersAndBody`              | server-functions | C       |   669 |
| `extractBody`                    | server-functions | C       |   653 |
| `isJSONSafe`                     | server-functions | C       |   647 |
| `<module>`                       | server-functions | Z       |   613 |
| `FrameImpl##applyAttrs`          | frames           | L       |   612 |
| `stableString`                   | server-functions | T       |   607 |
| `deserializeStream`              | server-functions | CL      |   588 |
| `installServerComponents`        | frames           | HTC     |   588 |
| `ChunkReader#next`               | server-functions | T       |   558 |
| `FrameImpl##invokeSlot`          | frames           | O       |   536 |
| `FrameImpl##refArgsUnchanged`    | frames           | O       |   534 |
| `FrameImpl##revealSegment`       | frames           | V       |   510 |
| `FrameImpl#preview`              | frames           | S       |   505 |
| `morphAttributes`                | frames           | M       |   493 |
| `ChunkReader#readChunk`          | server-functions | T       |   492 |
| `ensureStylesheet`               | frames           | P       |   474 |
| `slotArgsProxy`                  | frames           | O       |   459 |
| `ownedPositions`                 | frames           | B       |   444 |
| `serverFunctionFailure`          | server-functions | E       |   435 |
| `serializeArguments`             | server-functions | C       |   415 |
| `boundaryComponent`              | frames           | A       |   399 |
| `FrameImpl##resolveArgs`         | frames           | O       |   368 |
| `claimRender`                    | frames           | H       |   366 |
| `installRevealHook`              | frames           | H       |   366 |
| `createServerReference`          | server-functions | R       |   364 |
| `collectSlots`                   | frames           | O       |   346 |
| `consumersEqual`                 | frames           | B       |   333 |
| `FrameImpl#apply`                | frames           | K       |   326 |
| `FrameImpl##bindRegions`         | frames           | O       |   301 |
| `pumpLiveChannel`                | frames           | L       |   285 |
| `FrameImpl#dispose`              | frames           | K       |   282 |
| `applyInlineStyles`              | frames           | P       |   276 |
| `morphOwnedStyle`                | frames           | B       |   274 |
| `normalizeSlotContent`           | frames           | O       |   274 |
| `configureServerFunctionsClient` | server-functions | R       |   264 |
| `slotPositions`                  | frames           | B       |   261 |
| `qualifierValue`                 | frames           | P       |   260 |
| `reviveContainerTraces`          | frames           | N       |   258 |
| `morphOwnedClass`                | frames           | B       |   256 |
| `documentBoundary`               | frames           | H       |   255 |
| `FrameImpl#rebind`               | frames           | A       |   253 |
| `collectRegionElements`          | frames           | O       |   250 |
| `findHeadElement`                | frames           | P       |   246 |
| `ensurePreload`                  | frames           | P       |   239 |
| `flushGrafts`                    | frames           | M       |   236 |
| `findLiveTarget`                 | frames           | L       |   232 |
| `FrameImpl##applyRoot`           | frames           | K       |   231 |
| `followAddress`                  | frames           | A       |   230 |
| `textPosition`                   | frames           | B       |   229 |
| `FrameImpl##segmentReady`        | frames           | V       |   227 |
| `slotEntry`                      | frames           | B       |   220 |
| `errorFromTrailer`               | server-functions | E       |   218 |
| `argsEquivalent`                 | frames           | K       |   217 |
| `FrameImpl##applied`             | frames           | K       |   213 |
| `FrameImpl##unmountSlot`         | frames           | O       |   204 |
| `FrameImpl#constructor`          | frames           | K       |   200 |
| `deliverFlightData`              | server-functions | T       |   189 |
| `FrameImpl##applyHole`           | frames           | L       |   185 |
| `stageTables`                    | frames           | S       |   183 |
| `siblingAddressFor`              | server-functions | R       |   180 |
| `materialize`                    | frames           | N       |   177 |
| `hasPendingFragment`             | frames           | H       |   176 |
| `compatible`                     | frames           | M       |   170 |
| `parseRetryAfter`                | server-functions | E       |   168 |
| `FrameImpl##reconcileRegions`    | frames           | O       |   165 |
| `createChunk`                    | server-functions | T       |   163 |
| `ensureModulePreload`            | frames           | P       |   163 |
| `claimTree`                      | frames           | X       |   161 |
| `adoptRange`                     | frames           | M       |   161 |
| `gatherClaims`                   | frames           | H       |   157 |
| `applyOwned`                     | frames           | B       |   156 |
| `morphNode`                      | frames           | M       |   156 |
| `FrameImpl##showFallback`        | frames           | V       |   154 |
| `isContainerTraceMarker`         | frames           | N       |   152 |
| `findPlaceholder`                | frames           | V       |   146 |
| `stashRange`                     | frames           | M       |   140 |
| `getFrameHost`                   | frames           | C       |   140 |
| `encodeHaveList`                 | frames           | L       |   136 |
| `moveRangeBefore`                | frames           | M       |   131 |
| `findRangeStart`                 | frames           | M       |   130 |
| `makeFrameElement`               | frames           | K       |   128 |
| `afterMarker`                    | frames           | O       |   125 |
| `FrameImpl##regionsChange`       | frames           | S       |   124 |
| `eachInRange`                    | frames           | O       |   124 |
| `withMeta`                       | server-functions | R       |   123 |
| `deserialize`                    | frames           | T       |   121 |
| `ChunkReader#constructor`        | server-functions | T       |   119 |
| `isAsyncValue`                   | frames           | O       |   119 |
| `findBoundaryElement`            | frames           | H       |   119 |
| `indexBoundaries`                | frames           | H       |   118 |
| `hashArguments`                  | server-functions | T       |   117 |
| `awaitBoundary`                  | frames           | H       |   117 |
| `FrameImpl##resetStreamState`    | frames           | K       |   115 |
| `createFrameElement`             | frames           | K       |   114 |
| `rangeClose`                     | frames           | O       |   113 |
| `isReactiveContent`              | frames           | O       |   111 |
| `tableFor`                       | frames           | C       |   107 |
| `FrameImpl##refsUnresolved`      | frames           | O       |   105 |
| `revealSeam`                     | frames           | V       |   102 |
| `FrameImpl##removeSlotRecord`    | frames           | O       |   101 |
| `FrameImpl##recordHave`          | frames           | L       |   101 |
| `flightCodec`                    | frames           | T       |   101 |
| `clearStreamRecords`             | frames           | K       |   100 |
| `isAsyncLike`                    | frames           | O       |    98 |
| `hasFlightMetadata`              | server-functions | T       |    97 |
| `isEventStream`                  | server-functions | L       |    96 |
| `FrameImpl##replaceRange`        | frames           | O       |    94 |
| `documentAddress`                | frames           | H       |    91 |
| `serverFunctionDataAddress`      | server-functions | R       |    90 |
| `serverFunctionLiveAddress`      | server-functions | L       |    90 |
| `localOrSend`                    | server-functions | H       |    90 |
| `consumersOf`                    | frames           | B       |    89 |
| `parseFragment`                  | frames           | K       |    87 |
| `ensureTable`                    | frames           | C       |    87 |
| `slotStartId`                    | frames           | O       |    86 |
| `serialize`                      | frames           | T       |    86 |
| `serverFunctionAddress`          | server-functions | R       |    85 |
| `isSlotMarker`                   | frames           | O       |    85 |
| `liveSlotProps`                  | frames           | O       |    85 |
| `FrameImpl##resolveSlotRecord`   | frames           | O       |    84 |
| `renameRegion`                   | frames           | O       |    84 |
| `boundaryScope`                  | frames           | O       |    84 |
| `decodeResponse`                 | server-functions | C       |    82 |
| `boundaryMayArrive`              | frames           | H       |    82 |
| `FrameImpl##regionsFor`          | frames           | O       |    80 |
| `async`                          | frames           | T       |    79 |
| `removeUntil`                    | frames           | O       |    77 |
| `claimHandlers`                  | frames           | X       |    76 |
| `isMaterializedContainer`        | frames           | N       |    76 |
| `ChunkReader#drain`              | server-functions | T       |    75 |
| `FrameImpl##discoverRegions`     | frames           | O       |    75 |
| `isReadCall`                     | server-functions | R       |    74 |
| `FrameImpl##resolveRef`          | frames           | C       |    73 |
| `FrameImpl#contentHTML`          | frames           | K       |    72 |
| `FrameImpl##runSlotCleanups`     | frames           | O       |    71 |
| `FrameImpl##claimContent`        | frames           | X       |    70 |
| `placeRange`                     | frames           | M       |    69 |
| `preservesOpen`                  | frames           | M       |    66 |
| `parseServerComponent`           | frames           | T       |    66 |
| `propOf`                         | frames           | O       |    65 |
| `segmentName`                    | frames           | V       |    64 |
| `loadCodec`                      | frames           | C       |    64 |
| `FrameImpl##firstContent`        | frames           | K       |    61 |
| `getServerFunctionMetadata`      | server-functions | R       |    60 |
| `getFlightDataConsumer`          | server-functions | T       |    60 |
| `disposeRegions`                 | frames           | O       |    58 |
| `provideRPC`                     | server-functions | R       |    57 |
| `FrameImpl##claimTree`           | frames           | X       |    57 |
| `isFrameElement`                 | frames           | K       |    57 |
| `isPlaceholderStart`             | frames           | V       |    57 |
| `isFrameStreamResponse`          | frames           | T       |    54 |
| `isServerFunction`               | server-functions | R       |    52 |
| `adoptedCall`                    | server-functions | H       |    52 |
| `claimNode`                      | frames           | X       |    52 |
| `FrameImpl##resolveSlot`         | frames           | O       |    52 |
| `isFrameRef`                     | frames           | O       |    52 |
| `provideServerFunctionRPC`       | server-functions | R       |    50 |
| `frameAddress`                   | server-functions | T       |    50 |
| `isDataRef`                      | frames           | O       |    50 |
| `isTextStart`                    | frames           | B       |    49 |
| `FrameImpl##scoped`              | frames           | X       |    49 |
| `FrameImpl##materialize`         | frames           | K       |    49 |
| `createFrame`                    | frames           | K       |    46 |
| `test`                           | frames           | T       |    46 |
| `getFlightDataSourceIds`         | server-functions | T       |    45 |
| `FrameImpl##findPlaceholder`     | frames           | V       |    41 |
| `FrameImpl##parent`              | frames           | K       |    40 |
| `ChunkReader#cancel`             | server-functions | T       |    39 |
| `contentAddress`                 | frames           | S       |    39 |
| `FrameImpl##clearContent`        | frames           | K       |    38 |
| `FrameImpl#get error`            | frames           | E       |    37 |
| `setContainerTraceMaterializer`  | frames           | N       |    37 |
| `FrameImpl#isRevealed`           | frames           | V       |    36 |
| `FrameImpl##collectSlots`        | frames           | O       |    34 |
| `beginStream`                    | frames           | C       |    32 |
| `claimedAttr`                    | frames           | X       |    31 |
| `FrameImpl##processedAssets`     | frames           | P       |    31 |
| `getServerFunctionsCodec`        | server-functions | C       |    30 |
| `FrameImpl#get version`          | frames           | K       |    29 |
| `FrameImpl##styleFlush`          | frames           | P       |    28 |
| `FrameImpl##revealed`            | frames           | K       |    27 |
| `FrameImpl##fallbackShown`       | frames           | K       |    27 |
| `FrameImpl##appliedHoles`        | frames           | K       |    27 |
| `FrameImpl##mountedSlots`        | frames           | K       |    27 |
| `FrameImpl##slotCleanups`        | frames           | K       |    27 |
| `FrameImpl##slotArgs`            | frames           | K       |    27 |
| `FrameImpl##slotUpdaters`        | frames           | K       |    27 |
| `FrameImpl##slotRegions`         | frames           | K       |    27 |
| `FrameImpl##slotResolvedRefs`    | frames           | K       |    27 |
| `FrameImpl##slotNodes`           | frames           | K       |    27 |
| `FrameImpl##slotConsumers`       | frames           | K       |    27 |
| `FrameImpl##slotRebinders`       | frames           | K       |    27 |
| `FrameImpl#get store`            | frames           | K       |    27 |
| `configureServerFunctionsCodec`  | server-functions | C       |    26 |
| `FrameImpl#rebase`               | frames           | A       |    24 |
| `FrameImpl##store`               | frames           | K       |    23 |
| `isBoundaryId`                   | frames           | H       |    23 |
| `slotEnd`                        | frames           | O       |    22 |
| `FrameImpl#have`                 | frames           | L       |    22 |
| `afterRange`                     | frames           | O       |    22 |
| `afterText`                      | frames           | B       |    20 |
| `dataAddressFor`                 | server-functions | R       |    19 |
| `placeholderId`                  | frames           | V       |    16 |
| `preview`                        | frames           | S       |    12 |
| `commit`                         | frames           | S       |    10 |
| `FrameImpl##recordRefresh`       | frames           | K       |     8 |
| `FrameImpl##hasContent`          | frames           | K       |     6 |
| `FrameImpl##errorNotified`       | frames           | K       |     6 |
| `FrameImpl##disposed`            | frames           | K       |     6 |
| `FrameImpl##element`             | frames           | K       |     3 |
| `FrameImpl##start`               | frames           | K       |     3 |
| `FrameImpl##end`                 | frames           | K       |     3 |
| `FrameImpl##options`             | frames           | K       |     3 |
| `FrameImpl##version`             | frames           | K       |     3 |
| `FrameImpl##appliedRootValue`    | frames           | K       |     3 |
| `FrameImpl##have`                | frames           | K       |     3 |
| `FrameImpl##slots`               | frames           | K       |     3 |
