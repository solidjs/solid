# Frames client — the residue pass: from 11.8 to ≤ 10.0 KB brotli (2026-10-06)

Branch `audit/frames-residue` off `wip/frames-tiers-integration` @ `5c5991cbd`
(PR #3860 = Phase A + B + C3 + C4 + C5; `next` @ `9d89df731`). **A
measurement-and-design pass, no code changes**: this document and nothing
else. Companions: `frames-a0-reattribution.md` (the rubric and the morning's
per-unit tables), `frames-savings-pass.md` (§3's landed paragraphs with their
measured glue), `frames-rulings.md` ("Public surface"), the PR bodies of
#3849 / #3860 / #3861 and the closed drafts #3840 #3842 #3844 #3847 #3848
#3854 #3856 #3857 #3858.

**The question.** The target is **frames eager client ≤ 10.0 KB brotli**
(`scripts/size` scenario `frames: eager client consumer`). The head is
**13,083 br / 40,000 min**. C6 (the bind tier, in flight) measures **−1,243**
on this head → **11,840**. C2 (the wire tier, measured, deferred) is −292.
What is the measured, itemised path from 11.8 down to ≤ 10.0 — or where
does it stall?

**The answer, in one paragraph.** The residue proper — the `preview` pull
form, the D list, the static fill path (R.insert), a leaner re-ask, S-ref's
pending read moved into the lazy table — is worth **≈ 1,450 br measured** on
an edited dist with its carriers sketched or estimated, and takes the
post-C6 client from **11,840 to ≈ 10.4 KB with C2** (≈ 10.7 without).
**It does not reach 10.0 by itself.** The stall is the transport plus the
correctness seams Phase A and B added (≈ 1.1 KB br of them, every one
load-bearing) plus hole-op application (504 br, ruled eager under the 8.0
reading) plus the router's claims (291 br, Phase D's). Crossing 10.0 needs
**both** of the two feature moves the plan deferred: **C1 (holes,
buffer-only, −516 in context / ≈ −450 net)** and **the claims chunk (−299 /
≈ −280 net)** — together the end state is **≈ 9.67 KB with ≈ 330 B of
margin**; C1 alone lands at the line with no margin, the claims chunk
alone ≈ 115 B over. Unifying the tiers' dispatch saves nothing (+6 min / −20 br, measured); the fallback pass,
the style gate, the hold's owner wrap and the dispose guard are measured
and left.

_Status: complete (2026-10-06). Every number marked measured was read from an
edited dist copy through the harness's own bundler (§1); estimates are marked._

---

## 0. Sources and method

- **Head.** `wip/frames-tiers-integration` @ `5c5991cbd`, built fresh in this
  worktree (`pnpm install --frozen-lockfile`; `pnpm turbo run build --force`,
  27/27; `packages/compiler` `pnpm build`). `scripts/size` reproduces #3860's
  recorded numbers to the byte on all seven scenarios used here: frames eager
  **40,000 / 13,083**; page base 119,044 / 37,772; page live 130,915 / 41,427;
  app hydrating (no stores) 52,794 / 17,838; hydrating + stores 91,858 /
  29,066; compiled hydrating 99,431 / 31,075; CSR 36,568 / 12,905.
- **Attribution.** The re-attribution's source-map function-size tool
  (`tmp-tools/fnmap.mjs`, rebuilt from §7 of that document; `acorn` +
  `@jridgewell/trace-mapping` over the harness's own Rolldown bundle with a
  hidden map) charges every byte of the minified entry chunk to the innermost
  named function in the dist source: **273 units, 40,000 B, 0 B
  unclassified, reconciles to the byte** (web/frames 35,920; the retained sf
  slice 3,797; import statements 283). The class map is the morning's
  (`classes.mjs`) extended by `classes-head.mjs`: the 32 units Phase A / B /
  C3–C5 added, each tagged with the step that added it; the residue entries
  of the 40 units those steps changed, re-apportioned against the current
  source; one new **group** `T.glue` (class T) for the eager bytes the seams
  left behind — loader entries, residency predicates, the held set, the
  dispatch helpers — so the glue totals separately.
- **Measurement.** `tmp-tools/edit.mjs <cut>[+<cut>…]` applies named cuts to
  a COPY of `frames/dist/client.js` (and, for one cut, the sf client dist),
  each an exact-string replacement asserted to match once (`node --check`
  on the result); `tmp-tools/measure-cuts.mjs` bundles the seven scenarios
  with the copy in place of the dist, through `scripts/size/bundle.mjs`
  itself. **Every cut leaves the four non-SC scenarios at 0 / 0.** The
  cumulative path (§4) is measured as one edited copy per row, not summed:
  brotli is not additive. C6 is included by re-applying its Phase-1
  `tight-nopair` edit (`c6-edit.mjs`, unchanged) to this head's dist — it
  applies cleanly and measures **−4,096 / −1,243** (C6's own record on C4's
  head: −4,130 / −1,256); the bind chunk is external, as the scenario keeps
  every tier chunk. C2 is **not** re-applied (its edit spans the sf dist with
  different anchors); its measured net on this very head (`c2-phase1.md`,
  `lean`: **−934 / −292**) is added arithmetically where marked.
- Tooling lives under `tmp-tools/` (git-excluded, rebuildable from this
  section); raw results under the workspace's `.wt-logs/residue-*`.

---

## 1. Attribution now

### 1.1 Class totals, head vs the morning

Frames eager, minified, **residue re-attributed** (the honest column); brotli
by class **measured by removing the class from an edited copy** where a
class can be cut cleanly, derived by subtraction where it cannot.

| class | morning (`23176235d`, 43,310 min / 13,770 br) | **head (`5c5991cbd`, 40,000 / 13,083)** | Δ min | br morning (measured) | **br head** |
| --- | ---: | ---: | ---: | ---: | ---: |
| **T — transport** | 23,380 (54.0 %) | **27,913 (69.8 %)** — of which `T.glue` 1,116 | +4,533 | 7,773 | **≈ 9,640** (derived; `T.holes` 504 and `T.glue` ≈ 350 measured / est. inside it) |
| **R — restates core** | 6,655 (15.4 %) | **2,444 (6.1 %)** | −4,211 | 1,863 | **844** (measured: `stage+insert+fallback+stamp`) |
| **F — feature** | 11,134 (25.7 %) | **7,887 (19.7 %)** | −3,247 | 3,816 | **≈ 2,300** (C6 1,243 + C2's deletion 485 + claims 291 measured; the regions / assets / trace eager remnants ≈ 280 est.) |
| **D — dead / incidental** | 2,141 (4.9 %) | **1,756 (4.4 %)** | −385 | 318 | **300** (measured: the seven-item D cut) |
| total | 43,310 | 40,000 | −3,310 | 13,770 | 13,083 |

R + D together: **1,126 br measured** (the morning: 2,181). The morning's
R fell by two thirds (R.gate, R.dedupe, R.version, R.claim, R.drain,
R.claimant, R.refwait are gone; R.stage lost its tables and `onStream` but
kept the `preview` carrier; R.insert is untouched; R.reveal kept the fallback
pass). **T grew by 4.5 KB min**: the Phase A seams (A1 S-flush, A1b S-ref,
A2 S-hold, A7 the error face — ≈ 3,700 min of new or grown T units) and B's
mechanism with the three tiers' triggers (`T.glue`, 1,116 min). F fell by
the three cut tiers (trace / regions / assets ≈ −3,800) less what each kept
eager.

By group on the head (min, residue re-attributed): T.wire 6,098 · T.store
4,821 · F.bind 4,758 · T.slots 4,217 · T.morph 4,181 · T.doc 2,918 ·
T.holes 1,926 · D 1,756 · F.wire 1,576 · **R.stage 1,572** · **T.glue
1,116** · T.decode 1,052 · T.flight 789 · **R.insert 622** · T.refs 613 ·
F.claims 486 · F.regions 477 · F.assets 360 · **R.reveal 190** · T.claim
182 · F.event 160 · F.trace 70 · R.error 60.

### 1.2 What left, what arrived, what grew (vs the morning's per-unit table)

**Left — 62 units, 6,163 min.** The three cut tiers' eager halves:
`ensureStylesheet` 423, `applyInlineStyles` 275, `qualifierValue` 260,
`findHeadElement` 245, `ensurePreload` 238, `ensureModulePreload` 162,
`#processedAssets` / `#styleFlush` (C5); `collectRegionElements` 248,
`#bindRegions` 213 + its three thread-ups, `#reconcileRegions` 164,
`#regionsChange` 123, `renameRegion` 83, `#regionsFor` 80,
`#discoverRegions` 74, `disposeRegions` 58, `isFrameRef` 51, `#slotRegions`
(C4); `reviveContainerTraces` 257, `materialize` 173,
`isContainerTraceMarker` 152, `isMaterializedContainer` 75,
`setContainerTraceMaterializer` 36 (C3). The R deletions: `#refArgsUnchanged`
530, `argsEquivalent` 216, `#slotResolvedRefs`, `#refsUnresolved` 104,
`#resolveRef` 73 (A1b R.dedupe / R.refwait); `hasPendingFragment` 176,
`gatherClaims` 156 (A2b R.claim); `claimRegionFragments` 153 (A5′
R.claimant); `recordsPending` 121, `#recordRefresh` (A4 R.drain);
`clearStreamRecords` 100, `rebase` 24, `#appliedRootValue` (A1 R.version);
`stageTables` ×5 ≈ 180, `beginStream` 31, `ensureTable` 86,
`stage.entry.stream` 54, `onStream` 19 (A1b: the per-response cell is
`tableFor`'s version key); `followAddress.drop` 38, `boundaryComponent.arm` /
`.settle` / `.onApply`, `adoptBoundary.arm` / `.settle` (A1 R.gate);
`#isRevealed` 36, `#revealed`, `#fallbackShown` (A3 R.reveal);
`#errorNotified` (A7). `isAsyncLike` 98 (the duplicate probe — `isAsyncValue`
is the one left and is live).

**Arrived — 32 units, 2,975 min, by the step that added them.**

| step | units (min) | eager total (min) | the PR's own glue figure |
| --- | --- | ---: | ---: |
| **A1** S-flush (#3830) | `createFrameHost.landing` 174, `lands` 43, `handle.begin` 48, `landing` 224 (≈ 90 of it A7's error arm), `boundaryComponent` re-shaped 307 → 228, the landing section of `createFrameHost.apply` ≈ 200 | ≈ 610 | S-flush −187 min net on the frames client (#3849 note) |
| **A1b** S-ref + the dedupe to the fill's memo (#3844) | `settleArgs` 307, `pendingRef` 232, `settleWait` 214, `sameArg` 305, `Boxed` 38, `tableFor` +83 (version key), the data-arm + end-of-response wait arms of `createFrameHost.apply` ≈ 380, `isCalled` 42 (A0's `#` rule) | ≈ 1,600 | "≈ +330 B min of pending-read machinery" (#3844) — the memo equality (`sameArg`) was never budgeted; the morning estimated the dedupe replacement at ≈ 140 |
| **A2** S-hold (#3837 / #3840) | `adoptBoundary.hold` 84, `#hold`, `#releaseHold` 41, the `waiting` lines in `#syncSlots` ≈ 60 | ≈ 190 | −109 br frames net (R.claim deletion) |
| **A3** a reveal is an apply (#3848) | `#revealSegments` 341 (replaces the two sets + `isRevealed` + the retry loop; `#flush` −333) | ≈ 0 net | −45 min / ±0 br |
| **A5′** ownership by rendering (#3847) | `installRevealHook.hy.fa` 51, `disposedFrames` + `FRAME_SELECTOR` + the dispose guard ≈ 90 | ≈ 140 | −204 min / −51 br net (the C14 guard +116) |
| **A7** the error face + re-ask (#3848) | `failing` 87, `callFor` 32, `reask` 165, `calls` + two `calls.set` ≈ 50, `landing`'s error arm ≈ 90, the host's reject arms ≈ 60 | ≈ 480 | +747 min / +272 br |
| **B** the tier mechanism (#3854) | `prepareTier` 163, `tierReady` 25, `needsRegions` 31, `tierLoaders` / `tierLoads` / `liveFrames` 45, `installServerComponents` +60 (`tiers` option, `sc:tiers` read), `handle` +40 (header read), `applyFrames.drain` +40 (`chunk.tiers` await), constructor +20 | ≈ 420 | +473 min / +145 br |
| **C3** traces tier (#3856) | `carriesTrace` 72, `needsTrace` 38, `tierLoaders.trace` 48, `#heldRecords` 27 + its four arms ≈ 80, the `claiming` thread ≈ 25 | ≈ 290 | +467 min / +156 br (incl. the held-record mount) |
| **C4** regions tier (#3858) | `tierLoaders.regions` 52, `FrameImpl#get options` 29, `#outer` + the three thread-ups ≈ 80, `R?.bind` ×3 ≈ 50, `needsRegions` at the update site ≈ 20, `preview`'s `R.changed` / `R.frames` ≈ 60 | ≈ 290 | +518 min / +186 br |
| **C5** assets tier (#3857) | `tierLoaders.assets` 50, the `#segmentReady` style-gate term 115, `#flush`'s assets walk dispatch ≈ 110, the kept record cases (`chunkToRecords` `assets`, `host.write`'s accumulate) ≈ 200 | ≈ 480 | +508 min / +131 br |

`T.glue` on the head, measured as a group by cut where it can be: the
unified-dispatch experiment (§2, `unify`) rewrites all of it and moves
+6 min / −20 br — **there is no slack in the seams' shape**; their cost is
the hand-offs themselves.

**Grew (|Δ| ≥ 50, stayed):** `createFrameHost.apply` 182 → **873** (+691:
the data guard, the waits, the landing, the end-of-response rejection —
A1 / A1b); `tableFor` +83; `drainRecords.apply` +76 and `drainRecords` +34
(A4's declared-record arms); `slotArgsProxy.get.make` +71 (`sameArg`
equality, `Boxed`); `chunkToRecords` +67 (A6's `ops` and `complete.bound`);
`applyFrames` +58 and `.drain` +33 (B); `showing` +58; `unregister` +57
(`shown` / `shownVersion` in the capture arm); `installServerComponents` +43
(B). **Shrank:** `#flush` −333 (A3, C5), `claimRender` −183 (A2b's
`hydrateWindow` in solid), `#resolveArgs` −151 (C4), `#apply` −145 (A1b's
dedupe arm), `followAddress` −93, `#revealSegment` −89, `boundaryComponent`
−79, `preview` −73, `installRevealHook` −72 (A5′'s G9).

### 1.3 R and D on the head, unit by unit

| unit | min | class | measured br (§2) |
| --- | ---: | --- | ---: |
| `FrameImpl#preview` | 432 | R.stage | with the carrier: `stage` −542 ceiling |
| `createServerComponentHandler.stage` (+ `.entry.*`, `.named`, `.settled`, `.binding`, `stagedContent` ×4, `contentAddress`, `CONTENT_TOKEN`) | ≈ 480 | R.stage | — |
| `createFrameHost.preview` | 157 | R.stage | — |
| `followAddress` | 92 | R.stage (the token's two halves) | — |
| `applyFlightResponse.regionOf` + the staged-region arm | ≈ 110 | R.stage | — |
| `normalizeSlotContent` 274, `slotsFor.get.settle` 143, `isReactiveContent` 111, `#replaceRange` 94 | 622 | R.insert | `insert` −207 |
| the fallback pass of `#revealSegments` ≈ 130 + `#showFallback` 60 | 190 | R.reveal | `fallback` −79 |
| the s / v fast-adopt in `slotArgsProxy.get.make` | 60 | R.error | `stamp` −30 |
| `installServerComponents.g._$SC.r` (+ `.c[i]`) | 207 | D | `mirror` −80 |
| `documentAddress` (+ its call) | 95 | D | `docaddr` −28 |
| `slotsFor.get`'s second dispose map (`bindings` beside `fillScopes`) | ≈ 250 attributed; 82 by cut | D | `dispmap` −20 |
| `FrameImpl#contentHTML` + `unregister`'s capture arm | 72 + 230 | D | `capture` −73 |
| the zombie heuristic in `#syncSlots` | 104 | D | `zombie` −35 |
| the imperative (no-`reveal`-hook) branch of `#revealSegment` | 121 | D | `imperative` −27 |
| `showing`'s `COMPONENT_BINDING` brand | 96 | D | `brand` −22 |
| the `adopted` fork in `#invokeSlot` | 100 | D (as the morning listed it) | **not cut** — it is the claim-vs-render decision; deletes only when the t = 0 difference goes (A5) |
| `bindDataOccurrence.write`'s second diff layer | 300 | F.bind (D-like) | leaves with C6 |

---

## 2. Measured candidates

Frames eager Δ min / Δ br against the head (40,000 / 13,083); page base and
page live Δ br; the four non-SC scenarios are **0 / 0 on every row**. "Ceiling"
= the item deleted whole with nothing in its place; "carrier" = what must be
built for the pins to stay green, measured where sketched (`pullcarrier`),
estimated otherwise (×3 the loader-line rule where a seam is unbuilt — the
pattern every tier in #3860 showed).

| # | item | class | Δ frames min / br | page base br | page live br | carrier / glue | **net br (est.)** | risk — pins at stake, design, wire |
| --: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1a | `preview` — the staging **push** half out (commit-only form): `FrameImpl#preview`, `host.preview`, `entry.preview`, `stagedContent.preview` | R.stage | −719 / −216 | −227 | −236 | 0 | — | **not a candidate**: C15 ×4 stay green but `frames-optimistic-hold` ×3 go red (`false/false` in the derivation trace — #3844's finding, re-stated) |
| 1b | `stage` — **everything** out: the buffer, the token, `stagedContent`, `contentAddress`, `CONTENT_TOKEN`, the token arms of `handle` / `applyFlightResponse`, `followAddress` → a plain rebind effect | R.stage | **−1,643 / −542** | −564 | −558 | — (ceiling) | — | C15 ×4 red, optimistic-hold ×3 red: the refetch's morph lands at body end beside siblings the transaction still holds |
| 1c | **the `preview` pull form** = 1b + the carrier sketch (§3.1): a staged record set per address in the host written through as chunks arrive, promoted at the commit; a version tick per frame written in the follow's compute half; the live props read the staged record through it | R.stage | **−803 / −300** | −217 | −264 | **sketch measured: +840 min / +242 br** over 1b (a first honest cut, not golfed; B's first cut was +233 → +145 after golfing) | **−300** (band −250 … −350) | **design**: C15 ×4, `frames-optimistic-hold` ×3, `frames-morph-in-transition` ×3, principles §9.2.2; `c17-gate-bound-address`; public surface: `FrameHost.preview` / `Frame.preview` / `stagedContent` / `contentAddress` removed (approved 2026-10-06, "not even beta") |
| 2a | `_$SC` client mirror | D | −234 / −80 | −70 | −151 | 0 (or ≈ +60 for a minimal `r` without the address arms) | −80 … −60 | **behaviour**: a page whose data scripts carried no reference (so the server never emitted the bootstrap) and a CSR boot have no `_$SC.r` → `handler.component` throws. Needs the server to emit the bootstrap unconditionally on SC pages (≈ +200 B of document output) or the client to keep a minimal `r` |
| 2b | `documentAddress` | D | −95 / −28 | −49 | −3 | 0 | −28 | an unbound adopted mount (direct `_$SC.r(id)` placeholder, no binding) binds the function id instead of the call's address — a post-load refetch under the address would not reach it; `frames-adopted-*` pins to check. Deletes cleanly only with 2a's server half (the t = 0 record carries the address to the mount) |
| 2c | the second dispose map (`bindings` → `fillScopes`) | D | −82 / −20 | −76 | −24 | 0 | −20 | safe (identical bookkeeping; both maps dispose the previous invocation under the same key) |
| 2d | `contentHTML` + the last-unmount capture | D | −272 / −73 | −128 | −72 | 0 | −73 | **behaviour**: a document-adopted boundary's content is not retained for a later mount of the same address (it re-fetches). Unpinned (the morning's note stands); principles §4 row 3 |
| 2e | the zombie heuristic | D | −104 / −35 | −10 | −34 | 0 | −35 | DR-5: unreachable under identity-first matching; the lifecycle matrix's morph rows are the pins |
| 2f | the imperative branch of `#revealSegment` | D | −121 / −27 | −65 | −54 | 0 | −27 | **public surface**: `FrameOptions.reveal` is optional on `createFrame` / `createFrameElement` (`@experimental`) — the branch is reachable from a consumer that passes none; a documented "reveal is required" or a default seam |
| 2g | `showing`'s `COMPONENT_BINDING` brand | D | −96 / −22 | −3 | −22 | 0 | −22 | **behaviour**: a cache-seeded reader at t = 0 whose site later switches calls would remount instead of delivering through `dynamic`'s equals-gate; the adopted-switch pins (`c17` (b), the notes-search shape) to check |
| **2** | **the D list, together** (2a–2g) | D | **−1,004 / −300** | −289 | −305 | 0 … +60 | **−300 … −240** | the sum of the above |
| 3 | **R.insert** — every fill through `insert`: `normalizeSlotContent`, `isReactiveContent`, `settle`, `#replaceRange` go; the reactive branch is the only branch | R.insert | **−713 / −207** | −158 | −193 | ≈ 0 (`insert` is already the reactive branch's call) | **−207** | **public surface**: the marker-less `createFrame` consumer path (`client.ts` "No range handle … degrade to the snapshot") needs an anchor or a documented removal (re-attribution §5.3 item 5); behaviour: a static fill is an `insert` of a non-function value (no effect created — `insertExpression` with no render effect) |
| 4a | the fallback pass of `#revealSegments` + `#showFallback` | R.reveal | −330 / −79 | −110 | −117 | DR-4 2c (the document fragment as a store write — "its own plan, ≈ 1.3 KB on whichever side goes") | **−79** only under DR-4 | **design**: what `$dfl` does for the document face; C8, C14 (c), the lifecycle matrix's fallback rows |
| 4b | the style gate (C5's reveal-readiness term) | F.assets glue | −115 / −25 | −89 | −83 | — | **not deletable** | `tier-assets-ready` ×5 red: the FOUC guard |
| 5a | `FRAME_HAVE_HEADER` / `FRAME_HAVE_BUDGET` off the client entry's export list | F.wire | −64 / −28 | 0 | 0 | 0 | −28 | **public surface**: two exported constants leave the eager entry (C2's `lean` keeps + re-exports them at +45 br; the tier would import them from the sf client or carry its own copy). The pages already tree-shake them — the cost is the frames scenario's whole-entry measurement |
| 5b | the declared-record arms in `drainRecords` (A4's client half) | T (A4) | −102 / −31 | −17 | −19 | — | **not deletable** (the declared protocol; the synchronous `s === 1` read keeps an adopt-time claim inside the window); ≈ 10 br golfable |
| 6a | the whole re-ask path (`reask`, `callFor`, `calls`, the RPC symbols, `landing`'s arm) | T (A7) | **−434 / −154** | −57 | −209 | — (ceiling) | — | `frames-errored-reset-refetch` ×9 red: `reset` would show the error again |
| 6b | **the lean re-ask**: the sf client hands `ctx.retry` (a thunk re-dispatching the same call with its declared metadata); frames keeps `calls` and `reask = address => callFor(address)?.retry?.()` | T (A7) | **−235 / −74** | −76 | −54 | sf client ≈ +100 min / +30 br (page base and live pay it; frames eager does not — the sf slice this scenario keeps has no `dispatchServerFunction`) | **−74 frames / ≈ −45 pages** | **design** (§3.3): `ServerFunctionsClientConfig`'s `responseHandler` ctx gains `retry` (internal); the nine A7 pins unchanged; GET stays GET by construction |
| 7 | the C3 hold's `runWithOwner` + `untrack` wrap | T.glue (A2) | −16 / −9 | −10 | −9 | — | **not deletable** | `sharedConfig.holdBoundary` reads `getOwner()` (`hydration.ts:1805`); a chunk-microtask hold has no owner without the wrap |
| 8a | the nested-region marking in the dispose guard | T (A5′) | −45 / −4 | +34 | +34 | — | −4 | not worth a line |
| 8b | the whole dispose guard (`disposedFrames`, `hy.fa`'s check) | T (A5′) | −114 / −25 | −5 | +18 | — | **not deletable** | `c14-dispose-clean` (e) red (verified by #3847) |
| 9 | **unifying the tiers' dispatch**: one `tier(name)` helper (module or start the load), one `waitsOn(record, consumers)` predicate for both sync sites, the assets walk and the style gate through the same helper | T.glue | **+6 / −20** | −18 | −9 | — | **≈ 0** | nothing to gain: the seams' cost is the hand-offs at the sites the code left, not the helpers' shape. The indirection would cost one extra call per readiness check for no bytes |
| 10 | the s / v fast-adopt in `slotArgsProxy` | R.error | −92 / −30 | −6 | −50 | `readHydratedValue` exported from `solid-js/internal` ≈ +10 | −20 | the frames copy lacks #2997's rejection-observe (the export fixes that too); a declared record's settled promise must still read synchronously at a t = 0 claim (C1 / C9) — the export, not a deletion |
| 11 | the sf slice's live arm of `deserializeStream` | sf (E.a2) | −154 / −45 | −80 | −74 | — | — | **not frames'**: `shared.ts` serves `live()` for non-frame answers; C2's pass found it cannot move into a frames chunk. An sf-side lazy arm (E.b class) — the page's, not this scenario's |
| 12 | **S-ref's pending read in the table** — the ceiling: `pendingRef`, `settleWait`, the waits in `apply`, `record.pending`'s arm | T (A1b) | **−884 / −289** | −225 | −257 | decode chunk (lazy) ≈ +120 min for pending-on-missing + reject-at-close; frames ≈ +120 min / +40 br to keep the "fresh mount waits" count | **≈ −250** | **design** (§3.2): the table answers an undelivered key with a promise it settles at the key's `data` chunk and rejects at `close` / `abort` (L1); C5 (a, b, e), C6 (a1), `frames-flight-delivery`, the `{$ref}` rows of the lifecycle matrix |
| 13 | **claims + `frame:applied` to the router's chunk** — the ceiling: `claimHandlers` / `claimNode` / `claimTree` / `claimedAttr` / `#claimTree` / `#claimContent`, the `claim` thread through the morph, the `CustomEvent` dispatch | F.claims + F.event | **−890 / −291** | −228 | −344 | ≈ +60 min / +20 br seam (the router installs a sweep hook the morph calls) | **≈ −270** | **public surface**: `FRAME_APPLIED_EVENT` leaves the client entry; the router contract (`CLAIM_SEAM`) becomes "the router sweeps on install and on the seam's call"; plan Phase D's own item |
| 14 | **C1 — hole-op application as a tier** — the ceiling: `#applyHole`, `#applyAttrs`, `findLiveTarget`, the hole pass, `pumpLiveChannel` + the op log, `applyLiveOp` + the catch-up (the record cases stay) | T.holes (E.a1) | **−1,870 / −504** | −459 | −507 | loader entry + `#flush` dispatch + the pump's dispatch + the applier hand-off ≈ +190 min / **+65 br**; server `needs("holes")` at `createLiveHoles`' first `openBinding` ≈ +30 min | **≈ −440** | **the 8.0 ruling reversed** (holes eager); buffer-only, no hold (plan §1's holes row); `tier-holes-buffer.spec` as the plan drafted it; C13 control arm, C18's pump catch-up arm unchanged |
| 15 | two golfs: `sameArg`'s `Boxed` arm folded; one content-record helper in `chunkToRecords` | — | −144 / −6 | −41 | −22 | — | ≈ 0 | brotli already folds the repetition — not worth touching |
| — | **C6** (bind tier, `tight-nopair`, re-applied on this head) | F.bind | **−4,096 / −1,243** | −1,159 | −1,160 | included (C6 P1: glue +1,134 min / +315 br over the deletion) | **−1,243** | in flight |
| — | **C2** (wire tier, `lean`, measured on this head by its own pass) | F.wire | −934 / −292 | −264 | −258 | included (+576 / +193) | **−292** | deferred; keeps `FRAME_HAVE_*` exported (+45 br — 5a is the rest of it) |

Three measured facts worth lifting out of the table: (i) **the push half
of `preview` is 216 br and the token carrier 326 br**, so the pull form's
carrier has to come in under ≈ 240 br to beat commit-only-plus-nothing; the
sketch did (242, before golfing) but only just; (ii) **S-ref as built costs
289 br eager** against the morning's ≈ 80 estimate — the pending read was
built in the host when the table (lazy) is where the key lives; (iii) **the
D list is 300 br**, every item of it with a small behaviour or surface
consequence, none of it free.

---

## 3. Designs needed

### 3.1 The `preview` pull form (R.stage — item 1c)

**What the token does today** (#3759, kept by #3844). A refetch of an
address a mount is SHOWING cannot reach the mount through `dynamic`: the
call resolves to the same binding, and `dynamic` delivers a kept resolution
only when its address differs. So the handler stages the response (buffers
its chunks under the address) and resolves the call to a **token binding**
whose accessor yields `address\0version`. `dynamic` writes the new accessor
in the transaction that read the call; `followAddress`'s compute half runs
in that pass and **pushes** the staged slot args into the live fills
(`stagedContent.preview` → `host.preview` → `FrameImpl#preview` →
`update(props)`), so a fill deriving optimistic intent re-derives from the
new args in the pass that dissolves the intent (§9.2.2); the effect half
commits the buffer as the store's writes at the commit (C15). The carrier
is 1,643 min / 542 br; its push half 719 / 216.

**The pull form.** Keep the two things that are load-bearing — the version
travels through the accessor (`dynamic` must see a new value), and the
morph waits for the commit — and replace the push with a read:

1. **Host.** A response for a showing address writes through, as every
   response does, into a **staged record set** on the store
   (`store.staged = { version, records }`) instead of `records`; `write`
   decides by "frames are bound and the shown landing is not an error" (the
   `showing` test moves from the handler into the host). Nothing is
   buffered in the handler; `stage` / `staged` / `latest` / `settled` /
   `named` / `stagedContent` / `contentAddress` / `CONTENT_TOKEN` go. The
   call still resolves to a binding whose accessor yields a **new value** —
   the plain address with the version appended is the smallest (the token
   survives as a convention, not as machinery; `contentAddress` becomes a
   `split` at the two read sites or the accessor returns `[address, version]`).
2. **Frame.** `followAddress`'s compute half does one thing: `frame.stage(
   host.staged(address))` — stamps the staged set on the frame and bumps a
   per-frame **version tick** (`createSignal(0, { ownedWrite: true })`, the
   `failing` pattern). Its effect half: `frame.rebind(address); frame.commit()`
   → `host.promote(address)` replaces `records` / `shown` with the staged set
   and applies it to every bound frame as one write — the morph lands at
   the commit, exactly where `stagedContent.commit` lands it today.
3. **Fills.** `liveSlotProps`' source becomes `() => ctx.staged?.() ||
   args()`; `ctx.staged` reads the frame's tick, then the staged record for
   the occurrence (unless it names a region — those wait for the commit, as
   `preview` skips them today), resolved through `#resolveArgs`. A fill's
   per-prop memo (`sameArg` equality) therefore **reads** the staged args in
   the pass that delivered the version — A29 stages the derivation with the
   transaction; no push, no `#slotUpdaters` reach from the handler.

**What it must keep green.** `c15-staging-atomic` ×4 (the root, fill and
sibling change in one frame; a superseding refetch while staged lands only
the newest, whole; the control lands at body end) — the promote-at-commit is
what carries these; `frames-optimistic-hold` ×3 multi-flight arms (the
`false/false` trace) — the compute-half read is what carries these; the
single-flight arm and the renamed-region arm (regions wait for the commit,
as today); `frames-morph-in-transition` ×3; `c17-gate-bound-address` (b)
(a switch under a staged refetch); `c05` (the staged response decodes into
its own table — unchanged, tables are version-keyed); the staged-regions
arm of `applyFlightResponse` (a region for a showing call is staged like a
refetch — the host's write rule covers it once regions bump per frame).
**Pins that change:** none by assertion; `FrameHost.preview` / `Frame.preview`
/ `stagedContent` / `contentAddress` (`@internal`) are removed — approved
2026-10-06.

**Bytes.** Deletion ceiling −542 br; the sketch's carrier +242 br measured
(host `staged` / `promote` ≈ 300 min, the frame's `stage` / `commit` /
`stagedRecord` ≈ 250, the `ctx.staged` read ≈ 100, `write`'s staged branch
≈ 150); **net −300**, band −250 … −350 after golfing. The three glue rules
this pass learned apply: budget the carrier at the sketch (+242), not below
it.

### 3.2 S-ref's pending read belongs to the table (item 12)

As built (#3844), the host mints a pending promise per undelivered key per
response (`pendingRef`), settles it when the key's `data` chunk lands
(`settleWait`, re-applying every record it was the last open read of), and
rejects every open wait at `complete` / `:error` (L1) — 884 min / 289 br
**eager**. The morning's S-ref put pending-on-missing in the **decode
chunk** (lazy): the table is where the keys live and `createJSONDataTable`
already knows which keys it has. The design: `table.resolve(ref)` returns a
promise for an absent key, settled by the table's own `apply` of that key
and rejected by its `close()` / `abort()` — `deserializeStream` already
calls `abort` at an unexpected end; the frames host calls `close` at
`complete`. What stays eager: `record.pending` as a count of promise-valued
args (so a **fresh mount still waits** for its record to settle rather than
pending into its covering boundary — the behaviour #3844 chose), one
`.then` per pending arg to re-apply the record (≈ 120 min / 40 br). Net
**≈ −250** eager; the decode chunk +≈ 120 min (lazy, reported not counted).
Pins: C5 (a, b, e), C6 (a1), the `{$ref}` rows of the lifecycle matrix,
`frames-flight-delivery`, `frames-optimistic-hold`'s `{$ref}` arm. Public
surface: `FrameHostOptions.resolve` keeps its signature; the table's
`resolve` contract changes (a promise for a missing key) — the serialization
package's, `@internal`.

### 3.3 The lean re-ask (item 6b)

A7 records the call per address (`calls`, `callFor`) and re-invokes it by
minting a server reference through the RPC seam, copying the declared
metadata and honouring `GET` — 165 min for `reask` plus the two symbols,
because `handle` sees `ctx = { id, meta, args }` and no callable. The leaner
shape: the sf client's dispatch hands the response handler a **retry
thunk** in `ctx` (`retry: () => dispatch(id, args, meta)` — the call shape
it already has in hand, declared metadata included), and frames' re-ask is
`callFor(address)?.retry?.()`. Frames −235 min / −74 br; the sf client
+≈ 100 min / +30 br (page base and live pay it; the frames eager scenario's
sf slice has no `dispatchServerFunction`). The nine A7 pins are unchanged
(GET stays GET by construction — the thunk is the original call). Public
surface: the handler ctx gains `retry` (internal to the sf client ↔ frames
seam; `ServerComponentHandlerOptions` unchanged).

### 3.4 The fallback pass (item 4a) — DR-4's structural form

The stream face's `$dfl` analogue: a `seg:<k>:fallback` record materializes
the placeholder template's content once. 330 min / 79 br. It deletes under
DR-4 (2c): the document fragment as a write into frame `""`'s store so the
document runtime's `$dfr` / `$dfl` own both faces — "its own plan, ≈ 1.3 KB
on whichever side goes", and A0 reverses DR-4's direction (a module `$dfr`
in solid is ≈ +150 br on every hydrating page). **Leave it**: 79 br is not
a reason to open DR-4.

### 3.5 C1 — the holes tier (item 14)

The plan's row C1 as drafted, plus what this pass found: the sink announces
`assets` / `regions` / `wire` / `bind` / `trace` today and **not `holes`**
— C1 needs `needs("holes")` at `createLiveHoles`' first `openBinding`
(frame-sink, ≈ +30 min). Client: the chunk carries `#applyHole` /
`#applyAttrs` (less the owned arms, C6's) / `findLiveTarget` / the hole pass
/ `pumpLiveChannel` + the op log / `applyLiveOp`; the eager client keeps the
record cases, one dispatch in `#flush` (`tierLoads.holes?.r?.flush(this,
…)`), one in `drainRecords` (`?.pump()`), and the applier hand-off in
`adoptBoundary` (host, id, address). Buffer-only: hole records stay pending
in the store until the install's flush; the document stream buffers until
the pump starts; no hold, no 3.1 question. Ceiling −504 br; glue ≈ +65 br
(three dispatch lines + a loader entry — C5's dispatch glue was +67 br for
the same count); **net ≈ −440**. The one decision it needs is the 8.0
reading's reversal (plan §6 decision 1): holes were ruled eager as
"transport incl. streaming values"; this is the single item that moves the
end state across 10.0 with margin.

### 3.6 Claims + `frame:applied` to the router (item 13)

Phase D's row as drafted: the router installs `CLAIM_SEAM` and owns the
sweep; the frames client keeps a ≈ 60-min seam the morph calls at the sites
it claims today (`#applyRoot`, `#applyHole`, the segment swap, the fallback,
the adopt-time sweep). Ceiling −291 br; net ≈ −270. Public surface:
`FRAME_APPLIED_EVENT` leaves the client entry (the router's chunk exports
it); behaviour: a sweep before the router's chunk loads misses the first
morph's anchors — the router re-sweeps on install, as for CSR content.

### 3.7 The `_$SC` mirror and `documentAddress` (items 2a, 2b)

The mirror serves two pages: one whose hydration data scripts carried no
reference (the server emits the bootstrap with the first reference each
script serializes — a page with SC markup and no serialized reference has
none), and a CSR boot. Deleting it needs the server to emit the bootstrap
whenever the render used a server component (≈ +200 B of document output,
only on SC pages) and `installServerComponents` to require `_$SC` (a dev
error when absent). `documentAddress` goes with it once the t = 0 record
carries the address to every mount (the bound path already does; the
unbound direct-placeholder mount is the one that scans). Together −109 br;
output-shape change, document face only.

---

## 4. The path to ≤ 10.0 KB

Frames eager brotli, **each row measured as one edited dist** (C6's edit
re-applied on this head as the base; the residue cuts composed on top; the
non-SC scenarios 0 on every row). C2 is arithmetic (its own measurement on
this head, −292), marked. "Glue owed" is the estimated carrier a ceiling row
still has to pay; the "built" column subtracts it.

| step | item | Δ br (row, measured) | **cumulative, measured** | glue owed (est.) | **built** (cum. − glue) | built, with C2 (−292, arith.) | gate / risk |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 0 | head `5c5991cbd` | | **13,083** | | | | |
| 1 | **C6** bind tier (`tight-nopair`, in flight) | −1,243 | **11,840** | 0 (C6's glue is in) | 11,840 | 11,548 | C6's pins; `tier-bind-hold`; the click-replay finding (C6 P1) |
| 2 | **the D list** (2a–2g) + the s / v stamp (10) + the nested marking (8a) + `FRAME_HAVE_*` off the entry (5a) | −349 | **11,491** | +10 (`readHydratedValue` export); the mirror's server half is output, not client bytes | 11,501 | 11,209 | 2a / 2b need the server to emit the bootstrap unconditionally; 2f / 5a / 10 are public-surface items; 2d / 2g are behaviour changes |
| 3 | **the `preview` pull form** (1c; carrier sketched **and measured in the row**) | −277 | **11,214** | 0 | 11,224 | 10,932 | **design** §3.1; C15 ×4, optimistic-hold ×3, morph-in-transition ×3 |
| 4 | **R.insert** — every fill through `insert` (3) | −196 | **11,018** | 0 | 11,028 | 10,736 | public surface: the marker-less `createFrame` path |
| 5 | the fallback pass (4a) | −75 | 10,943 | DR-4 (its own plan) | — | — | **not recommended** (§3.4); kept to show it does not matter — the rows below are measured **without** it where marked |
| 6 | **the lean re-ask** (6b) | −78 | **10,865** (10,940 without row 5) | pages +30 | 10,950 | 10,658 | **design** §3.3 (sf client ctx) |
| 7 | **S-ref's pending read to the table** (12, ceiling) | −289 | **10,576** (≈ 10,637 without row 5) | **+40** frames; decode chunk +≈ 120 min lazy | ≈ 10,687 | ≈ 10,395 | **design** §3.2; C5 ×3, C6 (a1) |
| 8 | **claims + `frame:applied` to the router** (13, ceiling) | −299 | **10,277** (≈ 10,338 without row 5) | **+20** seam | ≈ 10,408 | ≈ 10,116 | public surface (`FRAME_APPLIED_EVENT`); the router contract |
| 9 | **C1 — the holes tier** (14, ceiling) | −516 | **9,761** | **+65** glue; server `needs("holes")` | ≈ 9,896 | ≈ 9,604 | **the 8.0 ruling reversed** |
| 9′ | rows 1–4 + 6–9 (no fallback pass), measured as one dist | | **9,822** | +135 | **9,957** | **≈ 9,665** | the recommended set, every carrier in |
| — | everything at its ceiling (no carriers: `stage` whole, `reask` whole, the style gate) | | 9,389 | — | — | ≈ 9,100 | the floor from here, not a build |

(Pages on row 9′: base 119,044 → 108,460 min / 37,772 → **34,701** br; live
130,915 → 120,332 / 41,427 → **38,355** — before C2's −264 / −258 and the
glue.)

**Where it crosses — built (glue in), no fallback pass:**

| set | built br | with C2 (−292) | vs 10,000 (with C2) |
| --- | ---: | ---: | ---: |
| rows 1–4 + 6 (the residue proper, every carrier in) | ≈ 10,950 | ≈ 10,658 | +658 |
| + row 7 (S-ref to the table) | ≈ 10,687 | ≈ 10,395 | +395 |
| + row 8 (claims to the router) | ≈ 10,408 | ≈ 10,116 | **+116 — does not cross** |
| + row 9 (C1 holes) instead of row 8 | ≈ 10,236 | ≈ 9,944 | **−56 — crosses with no margin** (over by 52 without the `_$SC` mirror + `documentAddress`) |
| + rows 8 **and** 9 | **≈ 9,957** | **≈ 9,665** | **−335 — crosses, ≈ 330 B of margin** (−43 without C2) |
| the same without the `_$SC` mirror + `documentAddress` (2a, 2b: −108) | ≈ 10,065 | ≈ 9,773 | −227 |

**The stall.** The residue proper — the pull form, the D list, R.insert, the
lean re-ask, S-ref to the table — is **≈ 1,450 br** on top of C6 and stops
at **≈ 10.4 KB with C2** (≈ 10.7 without). Crossing 10.0 with margin needs
**both** of the two feature moves the plan deferred to Phases C1 / D: the
holes tier (≈ −450 net) **and** the claims chunk (≈ −280 net); C1 alone
(with C2 and the mirror) lands ≈ 55 B under — no margin — and the claims
chunk alone ≈ 115 B over. What stays at ≈ 9.65 is: the
transport (`T.wire` / `T.store` / `T.slots` / `T.morph` / `T.doc` /
`T.decode` / `T.flight` / `T.refs` ≈ 22,000 min — the morning's T less its
hole-op half and less R.insert), the correctness seams Phase A built
(S-flush's landing node, the error face, S-hold, the version-keyed tables,
S-ref's pending count — ≈ 2,400 min / ≈ 750 br, every one pinned by the
contract), B's mechanism with the four tiers' triggers (≈ 1,300 min / ≈ 400
br — §2's `unify` shows it has no slack), and the eager remnants of the cut
tiers (the regions drain arm, the assets record cases and gate, the trace
probe — ≈ 900 min / ≈ 280 br, each a "kept eager" line of its step). None
of those is deletable without a wire or ruling change. The incremental
route has exactly two tierable things left (holes, claims) and it needs
both.

---

## 5. Recommendation

In this order; each row's gate is the plan's (named pins flip or stay
green, `scripts/size` at or under its cap with the ratchet, the harness's
two seeds clean):

1. **C6, as designed** (in flight; −1,243). Nothing here changes it.
2. **The D list without the mirror** (2c, 2d, 2e, 2f, 2g + the stamp export
   10; ≈ −210 br in context) in one small PR, each item's consequence
   flagged: the second dispose map and the zombie heuristic are free; the
   capture arm, the imperative branch and the brand are small behaviour /
   surface changes to rule on individually. Take `FRAME_HAVE_*` off the
   entry with C2, not here; take the mirror and `documentAddress` (−108)
   only with the server's unconditional bootstrap (§3.7).
3. **The `preview` pull form** (§3.1; −277 with its carrier). The one design
   with a real payoff and a real risk surface — build it against the carrier
   sketch's budget (+242 br), with C15 ×4 and optimistic-hold ×3 as the
   gate. It also simplifies the handler (no `stage` / `latest` / `named` /
   token) and `applyFlightResponse` (regions bump per frame, no staged-region
   map).
4. **R.insert** (−196) with the marker-less `createFrame` path ruled (an
   anchor requirement on `createFrame`, documented).
5. **S-ref to the table** (§3.2; ≈ −250 built) — a decode-chunk change plus
   a host simplification; worth it on its own terms (the pending read lives
   where the keys live).
6. **The lean re-ask** (§3.3; −78 frames, +30 pages).
7. **C2** (−292), taking `FRAME_HAVE_*` off the entry with it (−28 more if
   the two constants leave the client surface).
8. **C1** (§3.5; ≈ −450 built) — the first decision item: it reverses the
   8.0 reading.
9. **Claims to the router** (§3.6; ≈ −280 built) — the second decision item
   and Phase D's; it needs the router's own chunk to ride.

**End state with 1–9 built and every carrier in: ≈ 9.67 KB (≈ 9.77 without
the mirror).** With 1–7 only: ≈ 10.4 — over. With 1–8 (C1 but not claims):
≈ 9.94 with the mirror, ≈ 10.05 without — at the line, no margin. With 1–7
+ 9 (claims but not C1): ≈ 10.12 — over. **The target is reachable
incrementally, but only with both remaining tiers, and the margin is one
mid-sized item (≈ 330 B).**

**Leave:** the fallback pass (DR-4 is not worth 79 br), the style gate, the
declared-record arms, the hold's owner wrap, the dispose guard, the two
golfs, and the unification of the tier dispatch (measured at zero).

---

## 6. Caveats

- **Brotli context.** The path rows are measured as single edited copies, so
  the cumulative column is real; the "with C2" column is arithmetic (C2's
  own measurement on this head, −292), and the per-item single-cut figures
  in §2 do not sum to the combined rows (they are each against the
  unchanged head). The ±30 br drift between the sum of singles and the
  combined rows is the usual context effect.
- **The pull-form carrier is a sketch**, not a working implementation: it
  parses, carries no dangling identifier, and has the shape §3.1 describes,
  but no pin ran against it. Its +242 br is the budget to build against,
  not a ceiling — B's first honest cut golfed from +233 to +145; C3–C5's did
  not golf below their first cut.
- **The ceilings of rows 7–9** (S-ref to the table, claims, holes) have their
  glue estimated (+40 / +20 / +65 br) from the pattern this pass measured on
  C3–C5 (one dispatch line ≈ 20–25 br; a loader entry ≈ 11–15 br). They are
  not ×3-of-a-loader-line estimates — they count the hand-offs — but they
  are estimates.
- **C6 is re-applied, not re-measured by C6**: its `tight-nopair` edit
  applies cleanly to this head's dist and measures −1,243 here against
  −1,256 on C4's head. C6 as it lands may differ by its own golfing; the
  path's row 1 is C6's to confirm.
- **The D list's behaviour items** (the capture arm, the brand, the
  imperative branch, `documentAddress`) were measured, not pinned: §2 names
  the pins to check for each. The morning's "unpinned" for the capture arm
  stands; the brand and the imperative branch may have pins this pass did
  not run.
- **Class totals in brotli** are measured for R (844) and D (300) by cut;
  F (≈ 2,300) and T (≈ 9,640) are derived — F from C6 + C2's deletion +
  claims measured plus the three tiers' eager remnants estimated, T by
  subtraction.
- **`FRAME_HAVE_*`'s 28 br is the scenario's**, not a page's: the pages
  tree-shake the two exports already; the frames eager scenario measures
  the whole entry with its export list, so an exported constant costs it
  what it would cost a consumer that keeps the whole module.
- Nothing here changes an engine or a wire; the two wire-adjacent items
  (`needs("holes")`, the unconditional bootstrap) are named as the decisions
  they are.

---

## Appendix A — every unit on the head (273 units, 40,000 B; by whole unit)

Class and group per `classes-head.mjs`; units Phase A / B / C added are
listed with their step in §1.2.

| unit | module | min B | class | group |
| --- | --- | --: | --- | --- |
| `FrameImpl##syncSlots` | web/frames | 1241 | T | T.slots |
| `<module>:web/frames` | web/frames | 978 | T | T.wire |
| `reconcileChildren` | web/frames | 942 | T | T.morph |
| `chunkToRecords` | web/frames | 882 | T | T.store |
| `createFrameHost.apply` | web/frames | 873 | T | T.store |
| `slotsFor.get` | web/frames | 860 | T | T.slots |
| `FrameImpl##flush` | web/frames | 813 | T | T.store |
| `bindDataOccurrence.write` | web/frames | 652 | F | F.bind |
| `FrameImpl##applyAttrs` | web/frames | 606 | T | T.holes |
| `stableString` | web/server-functions | 601 | T | T.wire |
| `adoptBoundary` | web/frames | 590 | T | T.doc |
| `installServerComponents` | web/frames | 564 | T | T.doc |
| `ChunkReader#next` | web/server-functions | 558 | T | T.wire |
| `createServerComponentHandler.handle` | web/frames | 535 | T | T.wire |
| `applyFrames.drain` | web/frames | 494 | T | T.wire |
| `ChunkReader#readChunk` | web/server-functions | 492 | T | T.wire |
| `morphAttributes` | web/frames | 490 | T | T.morph |
| `FrameImpl##invokeSlot` | web/frames | 483 | T | T.slots |
| `deserializeStream` | web/server-functions | 446 | T | T.decode |
| `ownedPositions` | web/frames | 444 | F | F.bind |
| `bindDataOccurrence` | web/frames | 443 | F | F.bind |
| `FrameImpl#preview` | web/frames | 432 | R | R.stage |
| `createServerComponentHandler.applyFlightResponse` | web/frames | 418 | T | T.flight |
| `adoptBoundary.drainRecords` | web/frames | 401 | T | T.doc |
| `bindDataOccurrence.valuesFor` | web/frames | 396 | F | F.bind |
| `applyFrames` | web/frames | 390 | T | T.wire |
| `createServerComponentHandler` | web/frames | 380 | T | T.wire |
| `FrameImpl##revealSegment` | web/frames | 358 | T | T.morph |
| `FrameImpl##revealSegments` | web/frames | 341 | T | T.morph |
| `collectSlots` | web/frames | 340 | T | T.slots |
| `consumersEqual` | web/frames | 333 | F | F.bind |
| `createFrameHost.write` | web/frames | 316 | T | T.store |
| `createFrameHost.unregister` | web/frames | 310 | T | T.store |
| `createFrameHost.settleArgs` | web/frames | 307 | T | T.store |
| `sameArg` | web/frames | 305 | T | T.slots |
| `<unmapped>` | <unmapped> | 283 | T | T.wire |
| `installRevealHook` | web/frames | 282 | T | T.doc |
| `morphOwnedStyle` | web/frames | 274 | F | F.bind |
| `normalizeSlotContent` | web/frames | 274 | R | R.insert |
| `slotPositions` | web/frames | 261 | F | F.bind |
| `morphOwnedClass` | web/frames | 256 | F | F.bind |
| `documentBoundary` | web/frames | 251 | T | T.doc |
| `FrameImpl#dispose` | web/frames | 244 | T | T.store |
| `FrameImpl#rebind` | web/frames | 235 | T | T.store |
| `flushGrafts` | web/frames | 233 | T | T.morph |
| `createFrameHost.pendingRef` | web/frames | 232 | T | T.store |
| `textPosition` | web/frames | 229 | F | F.bind |
| `boundaryComponent` | web/frames | 228 | T | T.doc |
| `findLiveTarget` | web/frames | 228 | T | T.holes |
| `FrameImpl##applyRoot` | web/frames | 228 | T | T.morph |
| `FrameImpl#constructor` | web/frames | 228 | T | T.store |
| `landing` | web/frames | 224 | T | T.store |
| `FrameImpl##segmentReady` | web/frames | 222 | T | T.morph |
| `slotEntry` | web/frames | 220 | F | F.bind |
| `errorFromTrailer` | web/server-functions | 218 | T | T.wire |
| `createFrameHost.register` | web/frames | 218 | T | T.store |
| `FrameImpl##resolveArgs` | web/frames | 215 | T | T.slots |
| `createFrameHost.settleWait` | web/frames | 214 | T | T.store |
| `slotArgsProxy.get.make` | web/frames | 211 | T | T.slots |
| `FrameImpl##applied` | web/frames | 200 | F | F.event |
| `tableFor` | web/frames | 188 | T | T.decode |
| `deliverFlightData` | web/server-functions | 185 | T | T.flight |
| `FrameImpl##unmountSlot` | web/frames | 184 | T | T.slots |
| `claimRender` | web/frames | 182 | T | T.claim |
| `FrameImpl##applyHole` | web/frames | 181 | T | T.holes |
| `FrameImpl#apply` | web/frames | 181 | T | T.store |
| `createServerComponentHandler.resume` | web/frames | 178 | F | F.wire |
| `createServerComponentHandler.bump` | web/frames | 176 | T | T.wire |
| `pumpLiveChannel.pump` | web/frames | 175 | T | T.holes |
| `createFrameHost.landing` | web/frames | 174 | T | T.store |
| `createServerComponentHandler.showing` | web/frames | 174 | T | T.doc |
| `createServerComponentHandler.stage` | web/frames | 171 | R | R.stage |
| `compatible` | web/frames | 170 | T | T.morph |
| `installServerComponents.g._$SC.r` | web/frames | 168 | D | D |
| `installServerComponents.reask` | web/frames | 165 | T | T.wire |
| `createChunk` | web/server-functions | 163 | T | T.wire |
| `prepareTier` | web/frames | 163 | T | T.glue |
| `adoptRange` | web/frames | 160 | T | T.morph |
| `claimTree` | web/frames | 157 | F | F.claims |
| `createFrameHost.preview` | web/frames | 157 | R | R.stage |
| `morphNode` | web/frames | 156 | T | T.morph |
| `applyOwned` | web/frames | 155 | F | F.bind |
| `applyFrames.end` | web/frames | 155 | T | T.wire |
| `FrameImpl##showFallback` | web/frames | 155 | T | T.morph |
| `bindDataOccurrence.writeText` | web/frames | 153 | F | F.bind |
| `createFrameHost` | web/frames | 150 | T | T.store |
| `pumpLiveChannel` | web/frames | 148 | T | T.holes |
| `findPlaceholder` | web/frames | 144 | T | T.morph |
| `slotsFor.get.settle` | web/frames | 143 | R | R.insert |
| `stashRange` | web/frames | 139 | T | T.morph |
| `encodeHaveList` | web/frames | 136 | F | F.wire |
| `findRangeStart` | web/frames | 130 | T | T.morph |
| `moveRangeBefore` | web/frames | 130 | T | T.morph |
| `slotsFor.get.evaluate` | web/frames | 128 | T | T.slots |
| `applyFrames.connection.cancel` | web/frames | 127 | F | F.wire |
| `makeFrameElement` | web/frames | 127 | F | F.regions |
| `adoptBoundary.drainRecords.apply` | web/frames | 126 | T | T.doc |
| `afterMarker` | web/frames | 125 | T | T.slots |
| `eachInRange` | web/frames | 123 | T | T.slots |
| `ServerComponentPlugin.deserialize` | web/frames | 121 | T | T.refs |
| `ChunkReader#constructor` | web/server-functions | 119 | T | T.wire |
| `isAsyncValue` | web/frames | 119 | D | D |
| `findBoundaryElement` | web/frames | 116 | T | T.doc |
| `awaitBoundary` | web/frames | 115 | T | T.doc |
| `hashArguments` | web/server-functions | 115 | T | T.wire |
| `configureServerFunctionsClient` | web/server-functions | 113 | T | T.wire |
| `rangeClose` | web/frames | 112 | T | T.morph |
| `isReactiveContent` | web/frames | 111 | R | R.insert |
| `indexBoundaries` | web/frames | 108 | T | T.doc |
| `<module>:web/server-functions` | web/server-functions | 101 | T | T.wire |
| `flightCodec` | web/frames | 101 | T | T.refs |
| `FrameImpl##recordHave` | web/frames | 101 | F | F.wire |
| `revealSeam` | web/frames | 100 | T | T.slots |
| `slotArgsProxy.get` | web/frames | 99 | T | T.slots |
| `slotsFor` | web/frames | 97 | T | T.slots |
| `hasFlightMetadata` | web/server-functions | 96 | T | T.flight |
| `isEventStream` | web/server-functions | 96 | F | F.wire |
| `FrameImpl##removeSlotRecord` | web/frames | 94 | T | T.slots |
| `FrameImpl##replaceRange` | web/frames | 94 | R | R.insert |
| `createServerComponentHandler.bindingFor` | web/frames | 93 | T | T.wire |
| `followAddress` | web/frames | 92 | R | R.stage |
| `documentAddress` | web/frames | 91 | D | D |
| `createServerComponentHandler.applyFlightResponse.version` | web/frames | 91 | T | T.flight |
| `createFrameHost.serialize` | web/frames | 90 | T | T.refs |
| `consumersOf` | web/frames | 89 | F | F.bind |
| `applyFrames.errorRecord` | web/frames | 89 | T | T.wire |
| `failing` | web/frames | 87 | T | T.store |
| `loadCodec` | web/frames | 86 | T | T.decode |
| `parseFragment` | web/frames | 86 | T | T.morph |
| `ServerComponentPlugin.serialize` | web/frames | 86 | T | T.refs |
| `isSlotMarker` | web/frames | 85 | T | T.slots |
| `slotStartId` | web/frames | 85 | T | T.slots |
| `boundaryScope` | web/frames | 84 | T | T.slots |
| `adoptBoundary.hold` | web/frames | 84 | T | T.glue |
| `liveSlotProps` | web/frames | 84 | T | T.slots |
| `boundaryMayArrive` | web/frames | 82 | T | T.doc |
| `createFrameElement` | web/frames | 81 | T | T.store |
| `slotArgsProxy.getOwnPropertyDescriptor` | web/frames | 79 | T | T.slots |
| `installServerComponents.intercept` | web/frames | 79 | T | T.doc |
| `parse.async` | web/frames | 79 | T | T.refs |
| `removeUntil` | web/frames | 77 | T | T.morph |
| `claimHandlers` | web/frames | 76 | F | F.claims |
| `FrameImpl##resolveSlotRecord` | web/frames | 76 | T | T.slots |
| `ChunkReader#drain` | web/server-functions | 75 | T | T.wire |
| `slotArgsProxy` | web/frames | 75 | T | T.slots |
| `createFrameHost.storeFor` | web/frames | 73 | T | T.store |
| `carriesTrace` | web/frames | 72 | T | T.glue |
| `FrameImpl##revealSegment.content` | web/frames | 72 | T | T.morph |
| `FrameImpl##resetStreamState` | web/frames | 72 | T | T.store |
| `FrameImpl#contentHTML` | web/frames | 72 | D | D |
| `slotsFor.get.bind` | web/frames | 71 | T | T.slots |
| `FrameImpl##runSlotCleanups` | web/frames | 71 | T | T.slots |
| `deserializeStream.interpretChunk` | web/server-functions | 71 | T | T.decode |
| `FrameImpl##claimContent` | web/frames | 69 | F | F.claims |
| `FrameImpl##findPlaceholder` | web/frames | 69 | T | T.morph |
| `placeRange` | web/frames | 69 | T | T.morph |
| `createServerComponentHandler.hold` | web/frames | 68 | F | F.wire |
| `parseServerComponent` | web/frames | 66 | T | T.refs |
| `preservesOpen` | web/frames | 66 | T | T.morph |
| `propOf` | web/frames | 65 | T | T.slots |
| `segmentName` | web/frames | 64 | T | T.store |
| `deserializeStream.end` | web/server-functions | 63 | F | F.wire |
| `createServerComponentHandler.applyFlightResponse.regionOf` | web/frames | 63 | R | R.stage |
| `FrameImpl##firstContent` | web/frames | 61 | T | T.morph |
| `createServerComponentHandler.componentFor` | web/frames | 59 | T | T.wire |
| `getFlightDataConsumer` | web/server-functions | 58 | T | T.flight |
| `createFrameHost.get` | web/frames | 57 | T | T.store |
| `isPlaceholderStart` | web/frames | 57 | T | T.morph |
| `adoptBoundary.applyLiveOp` | web/frames | 56 | T | T.holes |
| `FrameImpl##claimTree` | web/frames | 56 | F | F.claims |
| `isFrameElement` | web/frames | 55 | T | T.store |
| `createServerComponentHandler.stage.entry.commit` | web/frames | 52 | R | R.stage |
| `createServerComponentHandler.stage.entry.preview` | web/frames | 52 | R | R.stage |
| `FrameImpl##resolveSlot` | web/frames | 52 | T | T.slots |
| `createServerComponentHandler.named` | web/frames | 52 | R | R.stage |
| `bindDataOccurrence.write.st.ref` | web/frames | 52 | F | F.bind |
| `tierLoaders.regions` | web/frames | 52 | T | T.glue |
| `claimNode` | web/frames | 51 | F | F.claims |
| `getFrameHost` | web/frames | 51 | T | T.decode |
| `installRevealHook.hy.fa` | web/frames | 51 | T | T.doc |
| `createServerComponentHandler.stage.entry.apply` | web/frames | 50 | R | R.stage |
| `tierLoaders.assets` | web/frames | 50 | T | T.glue |
| `FrameImpl##scoped` | web/frames | 49 | T | T.slots |
| `isTextStart` | web/frames | 49 | F | F.bind |
| `bindDataOccurrence.release` | web/frames | 49 | F | F.bind |
| `createServerComponentHandler.applyFlightResponse.target.apply` | web/frames | 49 | T | T.flight |
| `getFrameHost.applyData` | web/frames | 48 | T | T.decode |
| `createServerComponentHandler.begin` | web/frames | 48 | T | T.wire |
| `frameAddress` | web/server-functions | 48 | T | T.wire |
| `tierLoaders.trace` | web/frames | 48 | T | T.glue |
| `createFrame` | web/frames | 46 | T | T.store |
| `FrameImpl##materialize` | web/frames | 46 | T | T.morph |
| `ServerComponentPlugin.test` | web/frames | 46 | T | T.refs |
| `applyFrames.end.sweep` | web/frames | 46 | T | T.wire |
| `getFlightDataSourceIds` | web/server-functions | 43 | T | T.flight |
| `createFrameHost.lands` | web/frames | 43 | T | T.store |
| `isCalled` | web/frames | 42 | T | T.slots |
| `FrameImpl##releaseHold` | web/frames | 41 | T | T.glue |
| `FrameImpl##parent` | web/frames | 40 | T | T.morph |
| `isFrameStreamResponse` | web/frames | 40 | T | T.wire |
| `getFrameHost.resolve` | web/frames | 40 | T | T.decode |
| `ChunkReader#cancel` | web/server-functions | 39 | T | T.wire |
| `installServerComponents.g._$SC.r.g._$SC.c[i]` | web/frames | 39 | D | D |
| `contentAddress` | web/frames | 38 | R | R.stage |
| `needsTrace` | web/frames | 38 | T | T.glue |
| `claimedAttr` | web/frames | 37 | F | F.claims |
| `FrameImpl##clearContent` | web/frames | 37 | T | T.morph |
| `FrameImpl#get error` | web/frames | 37 | T | T.store |
| `createServerComponentHandler.applyFlightResponse.onOutcome` | web/frames | 36 | T | T.flight |
| `createFrameElement.dispose` | web/frames | 33 | T | T.store |
| `FrameImpl##collectSlots` | web/frames | 33 | T | T.slots |
| `installServerComponents.g._$SC.impl` | web/frames | 33 | T | T.doc |
| `slotArgsProxy.ownKeys` | web/frames | 33 | T | T.slots |
| `callFor` | web/frames | 32 | T | T.wire |
| `needsRegions` | web/frames | 31 | T | T.glue |
| `FrameImpl##invokeSlot.ctx.onUpdate` | web/frames | 29 | T | T.slots |
| `FrameImpl#get options` | web/frames | 29 | T | T.glue |
| `FrameImpl#get version` | web/frames | 29 | T | T.store |
| `isBoundaryId` | web/frames | 29 | T | T.doc |
| `getServerFunctionsCodec` | web/server-functions | 28 | T | T.decode |
| `createServerComponentHandler.stagedContent.preview` | web/frames | 28 | R | R.stage |
| `FrameImpl##appliedHoles` | web/frames | 27 | T | T.holes |
| `FrameImpl##heldRecords` | web/frames | 27 | T | T.glue |
| `FrameImpl##mountedSlots` | web/frames | 27 | T | T.slots |
| `FrameImpl##slotArgs` | web/frames | 27 | T | T.slots |
| `FrameImpl##slotCleanups` | web/frames | 27 | T | T.slots |
| `FrameImpl##slotConsumers` | web/frames | 27 | F | F.bind |
| `FrameImpl##slotNodes` | web/frames | 27 | T | T.slots |
| `FrameImpl##slotRebinders` | web/frames | 27 | F | F.bind |
| `FrameImpl##slotUpdaters` | web/frames | 27 | T | T.slots |
| `FrameImpl#get store` | web/frames | 27 | T | T.store |
| `afterRange` | web/frames | 26 | T | T.slots |
| `createServerComponentHandler.stagedContent.commit` | web/frames | 26 | R | R.stage |
| `installServerComponents.component` | web/frames | 25 | T | T.doc |
| `tierReady` | web/frames | 25 | T | T.glue |
| `asyncArg` | web/frames | 24 | T | T.refs |
| `Boxed#constructor` | web/frames | 24 | T | T.slots |
| `configureServerFunctionsCodec` | web/server-functions | 24 | T | T.decode |
| `installServerComponents.showing` | web/frames | 24 | T | T.doc |
| `FrameImpl##invokeSlot.ctx.onCleanup` | web/frames | 23 | T | T.slots |
| `FrameImpl##store` | web/frames | 23 | T | T.store |
| `FrameImpl#have` | web/frames | 22 | F | F.wire |
| `createServerComponentHandler.resolveServerComponent` | web/frames | 22 | T | T.wire |
| `placeholderId` | web/frames | 21 | T | T.morph |
| `createServerComponentHandler.settled` | web/frames | 21 | R | R.stage |
| `slotEnd` | web/frames | 21 | T | T.slots |
| `deserializeStream.end.sweep` | web/server-functions | 21 | F | F.wire |
| `createServerComponentHandler.binding` | web/frames | 20 | T | T.wire |
| `slotArgsProxy.has` | web/frames | 20 | T | T.slots |
| `afterText` | web/frames | 19 | F | F.bind |
| `createServerComponentHandler.bindingFor.binding` | web/frames | 16 | T | T.wire |
| `createServerComponentHandler.stage.binding` | web/frames | 16 | R | R.stage |
| `ChunkReader` | web/server-functions | 15 | T | T.wire |
| `FrameImpl` | web/frames | 15 | T | T.store |
| `Boxed` | web/frames | 14 | T | T.slots |
| `createServerComponentHandler.applyFlightResponse.start` | web/frames | 13 | T | T.flight |
| `applyFrames.end.close` | web/frames | 12 | F | F.wire |
| `stagedContent.preview` | web/frames | 12 | R | R.stage |
| `stagedContent.commit` | web/frames | 10 | R | R.stage |
| `deserializeStream.end.close` | web/server-functions | 9 | F | F.wire |
| `FrameImpl##disposed` | web/frames | 6 | T | T.store |
| `FrameImpl##hasContent` | web/frames | 6 | T | T.store |
| `FrameImpl##appliedError` | web/frames | 3 | T | T.store |
| `FrameImpl##appliedRoot` | web/frames | 3 | T | T.store |
| `FrameImpl##element` | web/frames | 3 | T | T.store |
| `FrameImpl##end` | web/frames | 3 | T | T.store |
| `FrameImpl##have` | web/frames | 3 | F | F.wire |
| `FrameImpl##hold` | web/frames | 3 | T | T.glue |
| `FrameImpl##options` | web/frames | 3 | T | T.store |
| `FrameImpl##outer` | web/frames | 3 | T | T.glue |
| `FrameImpl##slots` | web/frames | 3 | T | T.slots |
| `FrameImpl##start` | web/frames | 3 | T | T.store |
| `FrameImpl##version` | web/frames | 3 | T | T.store |

by seam (whole units tagged):
  A1     1590
  A1b    1362
  A3      341
  A7      284
  B       219
  C3      185
  A2      128
  C4       84
  A5       51
  C5       50
  A0       42

