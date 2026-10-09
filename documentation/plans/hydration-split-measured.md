# Hydration split — measured on the compiled server-component page (2026-10-07)

Branch `audit/hydration-split` off `wip/frames-tiers-integration` @ `3b70dd4c5`
(#3860's head, which carries `dynamicComponent` and the compiled SC page
scenarios of #3875). **Nothing here changes an engine**; the one commit is
this document. Companion documents: `solid-web-size-audit.md` (the 2026-10-05
solid/web audit — §3 rulings inventory, §5 tier measurements on the
hand-written `app: hydrating`, §5.3 the tier split, §6 "T + C, then P; no
carve"), `frames-a0-reattribution.md` §7 (the edited-dist method through
`scripts/size`'s bundler), #3875's body (the attribute-runtime presence table
on the compiled pages).

The question: **how much of the `solid-js` + `@solidjs/web` hydrating runtime
could leave the eager entry of a real server-component page, and at what
timing cost** — under the rule ruled this week: _no async in an otherwise
sync path_. A lazy chunk is acceptable only inside a moment that is already
async (a resume under a registered hold, a streamed fragment arriving, a
`live()` connection, a navigation fetch). Every candidate below names its
cover or is not a candidate. Everything is measured on the **compiled**
fixtures; the hand-written ones are not used.

**Answer in one paragraph.** The hydrating runtime on `page: compiled base
SC` is **19,672 B min of the page's 108,634 (≈ 5.9 KB of 34.87 KB br, 17 %)**,
plus 1,076 B of `@solidjs/signals` store-view walkers that `readShallow`
retains by static reference. Of that, what can leave the eager entry under
the rule, **measured as real shapes on edited dist copies**, is **−4,985 B
min / −1,405 B br (−4.0 %)**: the store hydration adapters ride the trace
tier's chunk (−2,505 / −653, cover: the tier load under the 3.1 hold — not a
new lazy moment, a chunk that is already lazy), `readShallow` reads a proxy's
own keys directly (−1,165 / −396, no async at all: a one-line change with
identical semantics), the live-source takeover installs from the sf client's
`live` module (−953 / −342, a static install-site move), and ruling 92's prod
prose is dev-gated (−356 / −83). The one tier that would add a lazy moment —
the post-wait half of the streaming resume — measures −1,167 B min / −360 br
as a floor and **≈ −0.1 to −0.3 KB br after its glue**; it is not worth a
protocol. `lazy()` and `clientOnly`/`NoHydration` are already at their
floors (the sync lookup and the kick-off are all that is eager; the
components are shaken per use). `app: compiled hydrating` — a non-SC page —
gets **−2,018 / −617** from the install-site moves alone (the SC-only
machinery, which contains the +118 B br Phase A added and the maintainer
accepted). The page lands at **33,464 B br** (103,649 min); the compiled
live page at 39,267 (from 40,266). **Recommendation (§6): hydration first —
specifically the `readShallow` line today, then (a) and the live install this
week (≈ 4 days, −1.4 KB on the SC page, no semantic change, no dependency on
the binding-slots ruling); the frames-client rewrite after the binding-slots
decision, which changes its number.** One measurement finding reaches past
hydration (§3.1): Rolldown assigns a module to the entry chunk whenever an
entry module imports it statically, **even when nothing eager uses the
import and the package is `sideEffects: false`** — so "the lazy chunk owns X"
only works when no eager module imports X's module at all; the install-slot
pattern (`enableHydration` assigns a function into a slot) pins the module
eager by construction.

**Landed (2026-10-07, `size/hydration-pass`, on `next` @ `d231b9911`).**
(e), (a) and (g-sc) are built, each its own commit; the §3 table's last
column carries what each measured as built against what this document
predicted. `page: compiled base SC` lands at **105,970 min / 34,321 br**
(−3,491 / −825 against `next`'s 109,461 / 35,146 on the same machine — the
baseline here is #3860's head, 108,634 / 34,869); `app: compiled
hydrating` at **98,995 / 30,991** (−677 / −164 — the Phase A bytes and
more); `app: hydrating (no stores)` 52,306 / 17,689 (−686 / −205). Two of
this document's candidates did not survive contact with the source: **(g)
is not a static move** — the takeover's gate machinery is shared with
ruling 55's divergence re-run, which `live()` never touches, so only the
`LIVE_*` arms (−348 / −143 as a cut, −144 / −47 as a slot) could move, and
their glue is over the ×3 budget; and **(g-sc)'s glue is paid by every SC
page** (≈ +220 min / +90 br on `page: compiled base SC`, the installers'
code and the frames client's call), not the ≈ 140 min the row estimated.
(f) waits on ruling 92; (b) was never worth a protocol. Caps ratcheted
(lower only, `ratchet.mjs`): hydrating (no stores) 17.91 → 17.70 KB,
hydrating + stores 29.19 → 28.94, compiled hydrating 31.17 → 31.01,
compiled base SC 35.13 → 34.34, compiled live 40.66 → 39.79, base SC
33.92 → 33.40, live SC 37.59 → 37.09.

---

## 1. Method

- **Build.** `pnpm install --frozen-lockfile`, `@solidjs/compiler` built
  (`napi build --release`), `turbo run build --force`, `scripts/size` `npm ci`
  — all in the worktree, nothing cached. Baseline matches every ledger note
  to the byte: compiled base SC **108,634 / 34,869**, compiled live
  **121,963 / 40,266**, compiled hydrating **99,431 / 31,075**, hydrating
  (no stores) 52,794 / 17,838, hydrating + stores 91,858 / 29,066 (local,
  macOS, Node 26, Rolldown pinned by `scripts/size/package.json`).
- **Attribution** (`tmp-tools/fnmap.mjs`, the frames-A0 tool extended to
  the eager graph): bundles each scenario exactly as `scripts/size/bundle.mjs`
  does, with a source map, and charges every mapped byte of **every eager
  chunk** (the entry plus the chunks it imports statically — the compiled
  live page is two) to the innermost named function of the dist source. The
  pieces sum to the chunk on all five scenarios (the live page's 762 B of
  cross-chunk import/export glue is the only unmapped residue). Units are
  grouped by concern in `tmp-tools/concerns.mjs`, following the solid/web
  audit's §2.1 map with the units added since (`hydrateWindow`,
  `holdBoundary`, `dynamicCore`).
- **Cuts** (`tmp-tools/edit.mjs`): exact-string edits over verbatim copies
  of the built `solid.js`, `web.js`, `container-trace.js`, `internal.js`
  under `tmp-tools/dist/<variant>/`, each anchor asserted to match once;
  measured with the copies overriding the dists in the same bundler
  configuration (`tmp-tools/run-cuts.mjs`, `--dist`). A **stub** keeps the
  call site and empties the body — the floor of a split. Where the real
  shape could be built as a dist edit it was (candidate (a):
  `tmp-tools/split-a.mjs` moves the adapters into their own module and
  rewires the imports), so its glue is **measured**, not estimated. Glue
  that is only estimated is marked and multiplied by 3, per this week's
  rule. The repo dists are never touched; `tmp-tools/` is git-excluded.
- **Brotli per group.** Measured by cut where a cut isolates the group;
  otherwise ≈ at 0.30 (the ratio the measured cuts cluster around: 0.23–0.36).

## 2. Attribution — the hydrating runtime on `page: compiled base SC`

Every `solid-js` + `@solidjs/web` unit reached, plus the two `@solidjs/signals`
rows hydration owns, by concern (minified B, exact). The non-hydration rows
are included so the page's two packages sum.

| concern                                                                           | compiled base SC | compiled hydrating | hydrating (no stores) | hydrating + stores | compiled live SC |                       br (base SC) |
| --------------------------------------------------------------------------------- | ---------------: | -----------------: | --------------------: | -----------------: | ---------------: | ---------------------------------: |
| hydration: claim walk & markers (web)                                             |            1,591 |              1,591 |                 1,185 |              1,186 |            1,615 |                              ≈ 480 |
| hydration: id allocation & keys                                                   |              248 |                248 |                   174 |                174 |              248 |                               ≈ 75 |
| hydration: `hydrate()` entry (sharedConfig installs, gather)                      |            1,919 |              1,919 |                 1,919 |              1,919 |            1,919 |                              ≈ 575 |
| hydration: sharedConfig lifecycle / `enableHydration` / end callbacks             |            1,281 |              1,274 |                 1,257 |              1,286 |            1,274 |                              ≈ 385 |
| hydration: events before hydration (`runHydrationEvents`)                         |              588 |                588 |                     — |                  — |              588 |                              ≈ 175 |
| hydration: serialized values — signal adapters, "server" mode                     |            2,642 |              2,431 |                 2,639 |              2,721 |            2,639 |                              ≈ 790 |
| hydration: serialized values — async-iterable / hybrid (signal side)              |            1,406 |              1,406 |                 1,406 |              1,406 |            1,406 |                              ≈ 420 |
| hydration: serialized values — **store adapters**                                 |        **2,821** |              2,844 |                 **—** |              2,981 |            2,821 |                   **653 measured** |
| hydration: live-source takeover (479 as units; 953 as a feature with its arms)    |              479 |                480 |                   479 |                480 |              479 |                   **342 measured** |
| hydration: `<Loading>` boundaries & streaming resume (ledger, truncation, assets) |            4,713 |              4,719 |                 4,704 |              4,719 |            4,706 | ≈ 1,410 (resume half 360 measured) |
| hydration: `lazy()` lookup & module assets                                        |              570 |                570 |                   570 |                570 |              570 |                              ≈ 170 |
| hydration: `clientOnly` / `NoHydration` / `Hydration`                             |                — |                  — |                     — |                  — |                — |                                  — |
| module scope (solid)                                                              |              659 |                651 |                   648 |                657 |              658 |                              ≈ 200 |
| signals core pulled by hydration (snapshot scope, context, ids)                   |              755 |                755 |                   747 |                755 |              754 |                              ≈ 225 |
| **hydration total**                                                               |       **19,672** |         **19,476** |            **15,728** |         **18,854** |       **19,677** |                        **≈ 5,900** |
| signals `store/utils.js` — the `readShallow` → `sourceKeys` walkers               |        **1,076** |              8,674 |                     — |                  — |            1,076 |                   **396 measured** |
| DOM runtime: insert / reconcile                                                   |            4,296 |              4,296 |                 4,300 |              4,308 |            4,297 |                                    |
| DOM runtime: events & delegation                                                  |            2,367 |              2,367 |                 1,995 |              1,997 |            2,367 |                                    |
| DOM runtime: attributes / props / class / style / template                        |            3,735 |              5,671 |                     — |                  — |            3,735 |                                    |
| render entry & module scope (web)                                                 |            1,469 |              1,388 |                   598 |                600 |            1,469 |                                    |
| flow controls (Show, For, Errored, Loading)                                       |              706 |                605 |                   705 |                707 |              703 |                                    |
| component model (createComponent, lazy)                                           |              362 |                363 |                   363 |                364 |              362 |                                    |
| SC mount: `dynamicComponent` / `dynamicCore`                                      |            1,280 |                  — |                     — |                  — |            2,377 |                                    |
| **`solid-js` + `@solidjs/web` + the two signals rows**                            |       **34,963** |         **42,840** |            **23,689** |         **26,830** |       **36,063** |                                    |

Reading it:

- **The store adapters are on the SC page and not on the no-stores app.**
  `app: hydrating (no stores)` carries 0 B of them: `enableHydration()`
  assigns `_hydrateStoreLike = hydrateStoreLike`, no eager wrapper reads
  the slot, Rolldown drops the dead write and the function with it. On the
  SC page the slot has exactly one reader — `container-trace.js`'s
  `core.withStoreHydration(createProjection$1, …)`, which lives in the
  **lazy** trace chunk — and because `withStoreHydration` is a function of
  the flat `solid.js` module (assigned to the entry chunk), the read is
  eager and so is everything it pins: `hydrateStoreLikeFn` 646,
  `hydrateStoreFromAsyncIterable` ≈ 1,000 (all parts), `createShadowDraft`
  ≈ 450, `applyPatches` 206, `quietAnswer` ≈ 200 (0 hits in every suite),
  `wrapStoreFn`, `hydrateStoreLike`, `withStoreHydration`. Editing one
  line of `container-trace.js` so it does not read the slot sheds 2,640 B
  from the eager page. This is the "≈ 1.1–1.3 KB br the trace chunk pins";
  measured it is **653–683 B br** (the audit's estimate was read off the
  with-stores scenario, where the adapters compress worse against more
  store code).
- **The `readShallow` walkers are retained, not reached.** `readShallow`
  returns a plain object untouched (`value[$PROXY] !== value`), so a
  dynamic `class={…}`/`style={…}` over a plain object never enters
  `sourceKeys`. For a proxy it calls `sourceKeys(value, SOURCE_PROXY)`,
  which is by definition `leafKeys(value, SOURCE_PROXY)` →
  `Reflect.ownKeys(value)`; the OMIT/MERGE arms (`collectKeys` 326,
  `mergeKeysOf`, `hiddenByAny`, `isHidden`, `addKey`, `leafOf`,
  `viewSource`) are kept only because the kind is a runtime argument the
  bundler cannot fold. The cheaper shallow read the maintainer asked about
  already exists for plain objects; what is missing is a direct
  `Reflect.ownKeys` for the proxy case.
- **Boundaries & streaming resume** is the largest group (4,713 B) and is
  mostly the **sync** half: `hydratedCreateLoadingBoundary` 1,181 runs in
  the root pass and must decide from `_fr` records whether to hydrate
  straight through or register; `initBoundaryResume`, the ledger state
  (`fragmentPolicy/State/Pending/Parked/Superseded`, `claimFragment`,
  `replayHeldFragment`), `watchTruncation`'s arming, `waitAndResume`'s
  promise plumbing, `createBoundaryTrigger` and `hydrateWindow` (also the
  frames client's synchronous adoption window) are all needed before any
  await. What runs only after an await — `resumeBoundaryHydration` 146,
  `rejectTruncatedRefs` 522, `markTruncated` 276, `whenRevealed` 84,
  `reportAssetFailure` 109, their inner closures — is 1,167 B.
- **Prod prose (ruling 92)** inside the groups above: 356 B min of five
  strings (`lazy()` not preloaded 90; the two preload-failure messages;
  the two truncation messages).
- `clientOnly` / `NoHydration` / `Hydration` appear on none of the five
  scenarios: shakeable per use today, nothing to do.
- Outside hydration but on the page through the frames bind tier's import
  edge: `assign` 242 + `assignProp` 787 (#3875's presence table; the
  `size/frames-bind-own-attributes` branch owns that question).
  `staticDynamic` 166 stays with `dynamicComponent` because
  `{ static: true }` is a runtime option.

The full unit list is Appendix A.

## 3. Candidates — each measured as a cut, each with its cover

Bytes are Δ min / Δ br on the eager graph against the same build (negative =
smaller). "stub" = body emptied, call site kept (the floor); "real" = the
shape as it would ship, glue included. Pins: §3 of `solid-web-size-audit.md`
(rulings by number) and the consistency harness's generic arm GH1–GH6
(`packages/web/test/consistency/generic/`: GH1–GH3 the resume's claim pass
over sources the snapshot does not cover, C19; GH4 fallback over settled
content, C9/C12; GH5 the preload hold counted, C3/R1; GH6 dispose during
preload, C14).

| id      | candidate                                                                                                                                                                                                                                                           | base SC (min / br)                                        | compiled hydrating | hydrating (no stores) | hydrating + stores |                  live SC | cover (the already-async moment)                                                                                                                                                                                                           | glue                                                                                                                                                                                                                                                    | pins                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | landed (2026-10-07, `size/hydration-pass`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -----------------: | --------------------: | -----------------: | -----------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(a)** | **store hydration adapters ride the trace tier's chunk** — stub (trace stops reading the slot)                                                                                                                                                                      | −2,640 / −683                                             |              0 / 0 |                 0 / 0 |              0 / 0 |            −2,644 / −644 | **the trace tier load** (`prepareTier("trace")`): a trace-carrying occurrence is HELD under the 3.1 hold until the tier installs; the adapters arrive with the materializer they serve                                                     | —                                                                                                                                                                                                                                                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | — (the stub)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
|         | (a) **real shape** — adapters in their own module, the trace entry carries its own copy, 13 helper exports in solid                                                                                                                                                 | **−2,505 / −653**                                         |              0 / 0 |                 0 / 0 |              0 / 0 |            −2,485 / −560 | same                                                                                                                                                                                                                                       | **measured 135 B min / ≈ 30 B br** eager (the helper exports); `trace.js` +2,719 min / +820 br (lazy, uncounted)                                                                                                                                        | rulings 51, 58, 60 — `solid/client-hydration` createStore(fn)/createProjection/createOptimisticStore(fn) hydration (11), "Async Iterable Hydration — createProjection/createStore(fn)" (8), `solid/hybrid-store-handoff` (28), `hydration/hybrid-store-handoff-3574` (4), `hydration/buffered-projection-repeat` (3), `solid/container-trace` (7), `lifecycle-matrix/container-args` (3); the contract's **C3(b)** (trace arg present at adoption — the red the S1 lazy-materializer attempt produced) | **landed** — built: compiled base SC **−2,550 / −575** (the cut's −2,511 / −563 plus `withStoreHydration` gone), compiled live −2,539 / −544, hydrating (no stores) 0 / 0, hydrating + stores 0 / −22, compiled hydrating 0 / +88 (layout: the adapters now sit earlier in `solid.js`); `trace.js` 8.18 → 8.71 KB br — rollup specialises the copy to the materializer's call shape (no `ssrSource`), so it is smaller than the +820 br measured here. 13 `@internal` helper exports on the client entry, mirrored as inert stubs on the server entry (export parity); `withStoreHydration` removed from both.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| (a′)    | for scale: no store adapters anywhere (what a store-using page would shed if it did not need them)                                                                                                                                                                  | −2,518 / −647                                             |      −2,724 / −600 |                 0 / 0 |      −2,724 / −702 |            −2,517 / −581 | none — a store-using page's `createStore(fn)` runs in the sync root pass; **not a candidate** for those pages                                                                                                                              |                                                                                                                                                                                                                                                         |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **(b)** | streaming-resume, post-wait half — stub (`resumeBoundaryHydration`, `rejectTruncatedRefs`, `markTruncated`, `whenRevealed`, `reportAssetFailure`)                                                                                                                   | −1,167 / −360                                             |      −1,168 / −270 |         −1,163 / −378 |      −1,168 / −391 |            −1,164 / −304 | the fragment promise's `.then` (a streamed fragment arriving) and the `DOMContentLoaded` listener (truncation) — both in the ruled list                                                                                                    | **minimal loader measured +134 B min** (one idempotent `import()` + two wraps; brotli ±); a real split also needs setters for `_hydratingValue`, `_truncated`, `_truncationRejectors`, `_revealSubs` and ≈ 10 imports: **≈ +250 B min more, ×3 = +750** | rulings 69–76 (12/13 load-bearing), 74 (4 spec files), 84; **GH1–GH4** (the resume's claim pass), `hydration/loading-late-fragment`, `truncated-stream*` (4), `write-before-resume`, `nav-before-resume`, `late-fragment-after-done`, `refresh-hmr-stream`                                                                                                                                                                                                                                             | skipped — nets ≈ 0 after glue (below); not built                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
|         | (b) net after glue                                                                                                                                                                                                                                                  | −808 / −133 measured (minimal); **≈ 0 to −300 min at ×3** |                    |                       |                    |                          | **timing cost:** the first streamed boundary's hydration waits one chunk fetch unless the server emits a `modulepreload` when it writes the `_fr` declaration (it knows then)                                                              |                                                                                                                                                                                                                                                         |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| (c)     | `lazy()` + module-asset preload                                                                                                                                                                                                                                     | 0                                                         |                  0 |                     0 |                  0 |                        0 | `lazy` is async by definition — but what is eager is the **sync** `_$HY.modules` lookup (258) and the preload **kick-off** (`loadModuleAssets` 312, which starts the await); nothing after the await is of size. **Already at its floor.** | —                                                                                                                                                                                                                                                       | rulings 81–86                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | at floor — nothing to land                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| (d)     | `clientOnly` / `NoHydration` / `Hydration`                                                                                                                                                                                                                          | 0                                                         |                  0 |                     0 |                  0 |                        0 | n/a — **absent from all five scenarios**; shakeable per use today                                                                                                                                                                          | —                                                                                                                                                                                                                                                       | rulings 87–89                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | at floor — nothing to land                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **(e)** | **`readShallow` reads a proxy's own keys directly** (`Reflect.ownKeys(value)` for `sourceKeys(value, SOURCE_PROXY)`)                                                                                                                                                | **−1,165 / −396**                                         |          +11 / −23 |                 0 / 0 |              0 / 0 |            −1,165 / −320 | **no async** — a one-line change with identical semantics (`sourceKeys` with kind `SOURCE_PROXY` IS `Reflect.ownKeys`); the ceiling is the whole of `store/utils.js` and it is reached                                                     | none                                                                                                                                                                                                                                                    | `hydration/style-adoption` (#3180, 5), `hydration/class` (#3189), `web/test` class/style object specs; the compiled hydrating app keeps the walkers through `spread` (its +11 is the inlined `Reflect.ownKeys`)                                                                                                                                                                                                                                                                                        | **landed** — built: compiled base SC **−1,165 / −344** (= the cut), compiled live −1,165 / −375, compiled hydrating +11 / −9 (keeps the walkers through `spread`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **(f)** | **prod prose dev-gated** (ruling 92's five strings → terse codes)                                                                                                                                                                                                   | **−356 / −83**                                            |        −356 / −116 |           −356 / −129 |        −356 / −167 |               −356 / −25 | no async                                                                                                                                                                                                                                   | none                                                                                                                                                                                                                                                    | ruling 92 (unpinned; a support decision — §7 Q8 of the solid/web audit)                                                                                                                                                                                                                                                                                                                                                                                                                                | skipped — needs ruling 92 (§7 Q8 of the solid/web audit); not built                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **(g)** | **live-source takeover installs from the sf client's `live` module** (S-live: gates, `takeOver`, the three arms, scope open/release)                                                                                                                                | **−953 / −342**                                           |        −953 / −299 |           −952 / −317 |        −953 / −394 | n/a (live page keeps it) | no async — a static install-site move; `live()` is the only producer of `LIVE_SOURCE`-branded values                                                                                                                                       | one slot on `solid-js/internal` + three guards: **≈ 60 B min est., ×3 = 180**, paid only by live pages                                                                                                                                                  | rulings 57 (live half), 99 — `solid/client-hydration` "live-branded sources — automatic takeover" (10), `hydration/frame-live-document` (2 runs), `web/frames-live-showing`                                                                                                                                                                                                                                                                                                                            | **skipped — not a static move.** The cut above removes the gate machinery (`nodeGate` / `liveGates` / `openScopes`, `armLiveTakeover`, `takeOver`, the scope open/release and the arm in the latched branch), which is SHARED with ruling 55's divergence re-run — a dependency write while a node is latched re-runs it at scope release, no `live()` involved (`solid/client-hydration` › "latched divergence", 3 specs; `hybrid-store-handoff`'s non-iterable shapes, 6). Moving it to the `live` module turns those red on every non-live page. The honest live-only residue — the `LIVE_LOCAL` adoption arm, the trace-detect arm, the `LIVE_RESUME_FROM` stamp, the three symbols — measures **−348 / −143** as a cut and **−144 / −47** as a slot the sf client's `live()` would fill (glue 204 B min, over the 60 × 3 = 180 budget), and the sf client has no `solid-js` import today (its build externals are seroval only), so the slot is a new package edge for ≈ 50 B br. Not built; the −953 / −342 here is not available under the rule. |
| (g-sc)  | SC-only machinery installed by `installServerComponents` (`holdBoundary`, `_$HY.fa`, `_$HY.fr`, `claimRoots`, the frame exclusion in the gather)                                                                                                                    | n/a (SC pages need it)                                    |    **−720 / −173** |           −720 / −248 |        −720 / −265 |                      n/a | no async — a static install-site move                                                                                                                                                                                                      | two slots (`solid-js/internal`, `@solidjs/web`): **≈ 140 B min est., ×3 = 420**, paid only by SC pages                                                                                                                                                  | rulings 15 (claimRoots clause), 80, 95–97, 101; frames-rulings 3.1–3.3; `web/frames-adopted-region-fragments` (5), `frames-late-boundary-client` (5), `hydration/adopted-claim-args-address`                                                                                                                                                                                                                                                                                                           | **landed** — built on the plain apps: compiled hydrating **−688 / −243** (99,683 → 98,995 min / 31,234 → 30,991 br; the dist edit's floor −722 / −200, real shape −680 / −221), hydrating (no stores) −686 / −205, hydrating + stores −686 / −217, compiled CSR −66 / −13 (the claim-roots walk left every `@solidjs/web` bundle). SC pages pay the installers: compiled base SC **+224 / +94**, base SC +236 / +86, compiled live +240 / +42, `frames: eager` +44 / +1 (one import + one call). Two `@internal` installers: `enableServerComponentHydration` (`solid-js`, typed on `solid-js/internal`) and `installServerComponentHydration` (`@solidjs/web`, calls the former); the frames client calls the latter where it installs its reveal hook. `_$HY.fr` moved with it (`truncated-stream.spec` installs the SC half to probe the ledger).                                                                                                                                                                                                    |
|         | of which **Phase A** (`holdBoundary`, `hydrateWindow` install, `_$HY.fa`) — the +118 B br accepted 2026-10-06                                                                                                                                                       | −184 / −83                                                |         −184 / −56 |            −184 / −81 |         −184 / −77 |               −184 / −48 |                                                                                                                                                                                                                                            |                                                                                                                                                                                                                                                         |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | inside (g-sc)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| (g2)    | `runHydrationEvents`' multi-container innermost-first replay (ruling 48's unpinned clause, 0 hits in every suite)                                                                                                                                                   | −251 / −93                                                |         −251 / −53 |                 0 / 0 |              0 / 0 |               −251 / −47 | no async — a **cut needing a ruling** (nested delegated containers replay order)                                                                                                                                                           | none                                                                                                                                                                                                                                                    | ruling 48 (the clause is unpinned; `hydration/dynamic-hydration-events` pins the single-container path)                                                                                                                                                                                                                                                                                                                                                                                                | not done — needs ruling 48                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| (g3)    | kept by static reference, no eager path on this page, **no cover**: `MockPromise`/`subFetch` trace run (≈ 460, runs sync in adoption); `cleanupFragment` 203 (sync at disposal); `removeOwnedChildren` 208 (DOM runtime, 0 tests); `quietAnswer` ≈ 200 (inside (a)) | —                                                         |                    |                       |                    |                          | — listed for completeness; the first three are structural, the last moves with (a)                                                                                                                                                         |                                                                                                                                                                                                                                                         |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### 3.1 Why (a)'s real shape needed a second instance, and what that says about every tier plan

The obvious implementation — move the adapters to `store-hydration.js`,
have `enableHydration()` import `hydrateStoreLike` from it for the slot
install, and have `container-trace.js` import it directly — **saves 76 B**
(variant `Areal`: 108,558 / 34,833). The adapter module lands in the entry
chunk: Rolldown assigns a module to the chunk of the entry that imports it
statically, and `solid.js` does; that the only _use_ of the import is a dead
write to a never-read slot does not move it, and `sideEffects: false`
(declared by all three packages; replicated in the variant) does not either.
Removing the install edge from `solid.js` (variant `Areal2`) puts the module
in `trace.js` (+2,719 min there) and the eager page drops −2,505 / −653 — but
that build breaks every page that creates a derived store in the root pass,
because the slot is never installed for them.

So the shape that works is: `solid.js` keeps today's install (its copy is
shaken on pages with no eager store wrapper, exactly as the no-stores app
shows), and the `container-trace` rollup entry **bundles its own copy** of
the adapter source instead of importing it. The adapters declare no
module-level state (261 lines of function bodies; `sharedConfig`,
`onHydrationEnd`, `UNASKED`, `subFetch`, the iterator helpers are imported
from the shared `solid.js` instance), so a second instance is semantically
inert. Its price: an SC page that also creates client derived stores ships
the adapters twice — eager in `solid.js` and lazily in `trace.js` (+2.7 KB
min / +0.8 KB br on the lazy chunk, not on the gate). The alternative that
avoids the duplicate is B.1 — the wrappers import the adapters — whose cost
(+1.7 KB br on a CSR app with stores) was measured and rejected on
2026-09-26 and is unchanged. **What B.1 would need to be acceptable** is a
conjunction (`enableHydration` ∧ a store wrapper) that import graphs cannot
express; `hydrateWindow` and the registered hold give the trace tier a
correct _moment_ to install from, but they do not give the plain app's
root-pass `createStore(fn)` one, so the install hook reached from the resume
helps only the SC page — which (a) covers without touching the slot.

The general finding: any plan of the form "X leaves the eager chunk by
riding lazy chunk L" requires that **no module in the eager graph imports
X's module**, dead or not. The `#2883` install-slot pattern (an eager
function assigns a function into a slot) pins X's module eager by
construction. For the frames tiers this held because the tier modules are
imported only by `import()`; for anything `solid-js` or `@solidjs/web`
installs itself it does not.

## 4. The honest total

Combined variants measured as one build (not summed from the rows):

| scenario                     |       as shipped |                                                    **allowed under the rule** — (a) real + (e) + (f) + (g) static moves |                after |       Δ br |  + (b) at ×3 glue | + (g2) with ruling 48 |
| ---------------------------- | ---------------: | ----------------------------------------------------------------------------------------------------------------------: | -------------------: | ---------: | ----------------: | --------------------: |
| **page: compiled base SC**   | 108,634 / 34,869 |                                                                              **−4,985 / −1,405** (`REAL`: a+e+f+g-live) | **103,649 / 33,464** | **−4.0 %** | ≈ −0.1 to −0.3 KB | −251 / −93 → ≈ 33,371 |
| page: compiled live SC       | 121,963 / 40,266 |                                                  −4,006 / −999 (`REALnolive`: a+e+f — the live page keeps its takeover) |     117,957 / 39,267 |     −2.5 % | ≈ −0.1 to −0.3 KB |            −251 / −47 |
| **app: compiled hydrating**  |  99,431 / 31,075 | **−2,018 / −617** (`PLAIN`: e+f+g-live+g-sc; (a) does not apply — the app has a store; (e) is noise under its `spread`) |  **97,413 / 30,458** | **−2.0 %** |         ≈ −0.1 KB |            −251 / −53 |
| app: hydrating (no stores)   |  52,794 / 17,838 |                                                                                                 −2,028 / −660 (`PLAIN`) |      50,766 / 17,178 |     −3.7 % | ≈ −0.1 to −0.3 KB |                     0 |
| app: hydrating + every store |  91,858 / 29,066 |                                                                                                 −2,029 / −717 (`PLAIN`) |      89,829 / 28,349 |     −2.5 % | ≈ −0.1 to −0.3 KB |                     0 |

**Landed (2026-10-07; against `next` @ `d231b9911`, measured on the same
machine — `next` had moved +15 min on most scenarios since this document's
baseline):** (e) + (a) + (g-sc), (f) and (g) not built (see the §3 column).

| scenario                     | `next` @ d231b9911 |               landed |  Δ min / Δ br |       Δ br |
| ---------------------------- | -----------------: | -------------------: | ------------: | ---------: |
| **page: compiled base SC**   |   109,461 / 35,146 | **105,970 / 34,321** | −3,491 / −825 | **−2.3 %** |
| page: compiled live SC       |   122,933 / 40,651 |     119,469 / 39,774 | −3,464 / −877 |     −2.2 % |
| **app: compiled hydrating**  |    99,672 / 31,155 |  **98,995 / 30,991** |   −677 / −164 | **−0.5 %** |
| app: hydrating (no stores)   |    52,992 / 17,894 |      52,306 / 17,689 |   −686 / −205 |     −1.1 % |
| app: hydrating + every store |    92,318 / 29,169 |      91,632 / 28,930 |   −686 / −239 |     −0.8 % |
| page: base SC                |   105,413 / 33,910 |     103,087 / 33,387 | −2,326 / −523 |     −1.5 % |
| page: live SC                |   117,456 / 37,610 |     115,130 / 37,073 | −2,326 / −537 |     −1.4 % |
| frames: eager                |    33,418 / 11,112 |      33,462 / 11,113 |      +44 / +1 |          — |

The SC page's −825 br is (a) −575 and (e) −344 less (g-sc)'s +94 of
installer glue; the plain hydrating apps' −164…−239 is (g-sc) alone ((a) is
0 there by construction, (e) ±10). What this document predicted and did
not materialise: (g)'s −342 (not a static move) and (f)'s −83 (unruled).

Reading the totals:

- The SC page's **−1,405 B br** is three things of comparable size: the
  trace-owned adapters (−653, a module-layout change under an existing
  lazy moment), the `readShallow` line (−396, no change in behaviour), and
  the live install move (−342, pinned by 13 specs). The prose is −83.
  None of them adds an async moment; none changes a ruling.
- **`app: compiled hydrating` gets −617 B br**, of which the SC-only
  machinery is −173 (the Phase A bytes the maintainer accepted are inside
  it at −56 to −83 — brotli reads them smaller here than the +66/+52 they
  measured as additions on their own bases), the live install −299, the
  prose −116. The page the maintainer "would like back" comes back five
  times over, from install-site moves alone.
- **(b) is the only true tier here and it does not pay.** Its floor is
  −360 B br on the SC page; its minimal loader is measured (+134 min) and
  the module-state setters a real split needs are not, so at ×3 the net is
  ≈ 0 to −0.3 KB br — for a new chunk, a server `modulepreload` at the
  `_fr` declaration to avoid delaying the first streamed boundary, and
  GH1–GH4 to re-prove across a chunk boundary. The §5.3 estimate of
  "−1.5 to −2.5 KB on hydrating pages" for lazy stream machinery is not
  there: 72 % of the boundary group runs synchronously in the root pass.
- The §5.3 "stream-adoption tier" (S-ai, −547 br on the hand-written app:
  `hydrateSignalFromAsyncIterable`, `normalizeIterator`, the hybrid
  handoff) is **not a candidate under the rule**: an async-iterable
  compute adopts its first yield synchronously in the root pass
  (`hydrateSignalLike` → `hydrateSignalFromAsyncIterable` decides at
  creation). Keying it on a server record and preloading through
  `_assets` would make `hydrate()` async on pages that have a stream
  source and no `lazy()` — a sync path made async. Listed so it is not
  re-estimated; the seam-D form of it needs a ruling that
  `hydrate()`-with-a-root-module-map is itself the async moment.

## 5. The attribution in brotli, by cut, on the SC page

What the hydrating runtime's ≈ 5.9 KB br divides into once the measured
cuts are known: **structural and sync** (claim walk, ids, entry, lifecycle,
events, the "server"-mode adapters, the async-iterable adoption, the sync
half of boundaries, `lazy()`'s lookup, module scope, the signals pulls) ≈
4,400 B br — the plain tier of `solid-web-size-audit.md` §5.2, re-measured
on a compiled page; **movable under the rule** 653 + 342 + 83 = **1,078 B br**
(+ the 396 of store-view walkers that are signals bytes hydration does not
own but a compiled page pays); **movable only with a new lazy moment** 360
B br floor (b); **movable with a ruling** 93 B br (g2).

## 6. Recommendation — hydration first, by bytes per day; the rewrite after the binding-slots ruling

| pass                                                                                                                                   |    bytes on `page: compiled base SC` (br) |                                                                                      effort |   KB / day | semantic risk                                                                                                                                                                | depends on                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------: | ------------------------------------------------------------------------------------------: | ---------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(e)** `readShallow` → `Reflect.ownKeys`                                                                                              |                                  **−396** |                                                                                 **0.1 day** |    **≈ 4** | none (identical by definition of `sourceKeys`); class/style adoption specs                                                                                                   | nothing                                                                                                                                                                                                                                                    |
| **(a)** adapters as their own source module; the `container-trace` entry bundles its copy; 13 `@internal` helper exports on `solid-js` |                                  **−653** |                                                                                    ≈ 2 days |     ≈ 0.33 | none intended (same code, second instance; no module state); gate: `solid/container-trace`, `lifecycle-matrix/container-args`, contract **C3(b)**, the store hydration specs | the frames tier mechanism as it stands (no new tier)                                                                                                                                                                                                       |
| **(g)** live takeover installed by the sf client's `live` module (`_liveTakeover` slot on `solid-js/internal`)                         |                                  **−342** |                                                                                     ≈ 1 day |     ≈ 0.34 | none intended; 13 specs pin it; the sf client already imports `solid-js/internal`                                                                                            | nothing                                                                                                                                                                                                                                                    |
| **(f)** prod prose dev-gated                                                                                                           |                                       −83 |                                                                                    0.25 day |     ≈ 0.33 | a support decision (ruling 92)                                                                                                                                               | the maintainer's answer to §7 Q8 of the solid/web audit                                                                                                                                                                                                    |
| (g-sc) SC-only machinery from `installServerComponents`                                                                                | 0 on SC pages; −173 on compiled hydrating |                                                                                     ≈ 1 day |          — | none intended; frames-rulings 3.1–3.3 + 15 specs                                                                                                                             | nothing                                                                                                                                                                                                                                                    |
| **hydration pass, (e)+(a)+(g)+(f)**                                                                                                    |                             **≈ −1.4 KB** |                                                                              **≈ 3.5 days** |  **≈ 0.4** | no ruling touched; no new async moment; no wire fact                                                                                                                         | **not** on the binding-slots decision                                                                                                                                                                                                                      |
| (b) lazy resume half                                                                                                                   |                         ≈ −0.1 to −0.3 KB |                                                                   ≈ 3 days + server preload |     ≈ 0.07 | GH1–GH4 across a chunk boundary; a timing change on the first streamed boundary                                                                                              | a `modulepreload` emitted at the `_fr` declaration                                                                                                                                                                                                         |
| **frames-client rewrite** (the alternative the question weighs)                                                                        |                             ≈ −2 to −3 KB | ≥ 2 weeks (28.5 KB min of client under a 19-law contract, 6 generic reds, the C-tier seams) | ≈ 0.15–0.3 | re-derivation of C1–C19; the a0 doc's R-units and S1 hold class                                                                                                              | **the binding-slots decision**: a rewrite without binding slots is smaller (drops `bind.js` 4.8 KB lazy and the `assign`/`assignProp` 1,029 min the bind edge keeps eager — ≈ −0.3 KB br more on the page) and its number is not known until that is ruled |

**Hydration first.** The hydration pass is ≈ 1.4 KB br on the SC page in
≈ 3.5 days at ≈ 0.4 KB/day, with no semantic change, no new async moment,
no wire fact, and no dependency on anything unruled; (e) alone is a line and
0.4 KB. The rewrite is a larger prize at a lower rate and a higher risk, and
its size **depends on the binding-slots decision** — so it should be sized
after that ruling, not before it, and the hydration pass fits in the gap.
The order inside the hydration pass: (e) today; (a) and (g) this week as
two PRs (each a layout/install-site move pinned by existing specs; (a)'s
gate is the consistency suite's C3(b), which the S1 lazy-materializer
attempt turned red and this shape should not); (f) when ruling 92 is
answered; (g-sc) as the SC-only cleanup that returns the Phase A bytes on
non-SC pages. Do **not** build (b): its measured floor is 360 B br and its
honest net is a tenth of that.

**Public-API notes, stated as their own items** (none of this is in the
branch; it is what the recommended passes would touch):

- (a) adds ≈ 13 `@internal` exports to `solid-js`'s client dist for the
  adapter module to import (`readSerializedOrCompute`, `subFetch`,
  `readHydratedValue`, `wrapFirstYield`, `adoptedAnswerStream`,
  `withHydrationGate`, `onHydrationEnd`, `noHydrationId`,
  `markTopLevelSnapshotScope`, `hasLoadingWindow`, `isAsyncIterable`,
  `syncThenable`, `UNASKED`) and a new rollup entry; no user-facing export,
  prop, option or diagnostic changes.
- (g) adds one `@internal` slot installer on `solid-js/internal`, consumed
  by `@solidjs/web/server-functions`' `live` module.
- (g-sc) adds two `@internal` slots (`solid-js/internal`, `@solidjs/web`),
  consumed by `@solidjs/web/frames`' `installServerComponents`; the frames
  client's ruling-101 toggle moves with it.
- (e) changes no signature and no documented behaviour.
- (f) changes the text of five production error messages (ruling 92).
- (g2) would change documented behaviour (ruling 48's replay order) and
  needs a ruling first.

## 7. Caveats

- Local measurements (macOS, Node 26); CI (Linux, Node 24) has read
  identical bytes on every compiled scenario so far (#3875), but brotli on
  a cut moves ±50–90 B with layout; minified deltas are the firm numbers.
  The brotli figures for (f) and (b)'s glue are inside that noise band
  (the glue variant measured −18 B br on the SC page while adding 134 B
  min).
- `REAL` combines (a) in its real shape with (e), (f), (g) applied to the
  `Areal2` base, which has **no** install edge; it is valid for the three
  scenarios with no eager store wrapper (compiled base SC, compiled live
  SC, hydrating no-stores) and **not** for the two store-using apps, whose
  rows use the `PLAIN` combination over verbatim copies. No row in §4 mixes
  the two.
- (a)'s real shape was measured as a dist edit (`split-a.mjs`); the source
  change is a module split plus rollup config, and the second-instance
  argument rests on the moved functions declaring no module-level state —
  verified on the built dist, to be re-verified on the source.
- (b)'s glue is measured for the minimal loader only; the module-state
  setters are estimated and tripled. Its number is a range for that reason.
- The hydrating runtime's brotli-by-group figures marked ≈ use 0.30; the
  measured cuts cluster at 0.23–0.36.
- `#3875`'s ledger note read the store-adapter cost on the SC page from the
  hand-written with-stores scenario (≈ 1.1–1.3 KB br); measured by cut on
  the compiled page it is 653–683 B br. The minified figure (2,821) is as
  the ledger had it.
- Nothing here was run through the test suites: no source changed. The
  pins column names what a PR must run.

## 8. Reproducing

All tooling lives under `tmp-tools/` in the worktree (git-excluded) and is
rebuildable from this section; nothing was written outside the workspace.

- `tmp-tools/lib.mjs`, `fnmap.mjs`, `units.mjs`, `measure.mjs` — the frames
  A0 tools (`frames-a0-reattribution.md` §7), with `lib.mjs` extended to
  the **eager graph** (`chunks[]`, `eager[]`, the entry plus statically
  imported chunks, each brotli'd alone as `bundle.mjs` does) and an
  `--alias spec=file` option; `fnmap.mjs` attributes every eager chunk.
  `node tmp-tools/fnmap.mjs "page: compiled base" --json out.json`.
- `tmp-tools/concerns.mjs` + `join.mjs` — the concern map and the join that
  produces §2 and Appendix A:
  `node tmp-tools/join.mjs "base SC=fn-scbase.json" … --md --units "base SC"`.
- `tmp-tools/edit.mjs <variant>:<cut>+<cut>` — the named cuts (`a-trace`,
  `a-stub`, `b-resume`, `b-glue`, `e-readshallow`, `f-strings`, `g-live`,
  `g-sc`, `g-phaseA`, `g-events-sort`) as exact-string replacements over
  `tmp-tools/dist/L0/` (verbatim copies); `BASE=<variant>` starts from
  another variant's files. `tmp-tools/run-cuts.mjs` builds and measures a
  list of variants on the five scenarios and prints the Δ table; results in
  `tmp-tools/out/cuts.json`.
- `tmp-tools/split-a.mjs [variant]` — (a)'s real shape (the adapter module,
  the helper exports, the trace import); `Areal2` is the same with the
  install edge removed; `tmp-tools/measure-areal.mjs <variant>` measures a
  variant that adds a module under an alias.
- Baseline JSON: `tmp-tools/out/fn-{scbase,chyd,hyd,hydst,sclive}.json`.

---

## Appendix A — every `solid-js` + `@solidjs/web` unit on `page: compiled base SC`, by concern (minified B)

**hydration: claim walk & markers (web)** — 1,591 B: `installHydrationRuntime > hydrationRt.reclaimRegion` 348, `getNextElement` 226, `isHydrating` 190, `getNextMarker` 182, `claimChildNodes` 181, `stripTextSeparators` 165, `isPlaceholderScaffolding` 116, `installHydrationRuntime > hydrationRt.claimInitial` 88, `installHydrationRuntime > hydrationRt.dedupEvent` 76, `installHydrationRuntime` 19

**hydration: id allocation & keys** — 248 B: `hydrationGetNextContextId` 129, `noHydrationId` 45, `getHydrationKey` 42, `scope` 32

**hydration: `hydrate()` entry (sharedConfig installs, gather)** — 1,919 B: `hydrate` 1,196, `gatherHydratable` 335, `hydrate > sharedConfig.cleanupFragment` 203, `hydrate > sharedConfig.captureBoundaryScope` 102, `hydrate > sharedConfig.has` 32, `hydrate > sharedConfig.load` 31, `hydrate > sharedConfig.gather` 20

**hydration: sharedConfig lifecycle / enableHydration / end callbacks** — 1,281 B: `enableHydration` 415, `drainHydrationCallbacks` 178, `enableHydration > set` 116, `isClaiming` 89, `markTopLevelSnapshotScope` 89, `onHydrationEnd` 88, `hydratedCreateRoot` 59, `enableHydration > sharedConfig.holdBoundary` 59, `enableHydration > hy.fe` 47, `isHydrationInProgress` 45, `enableHydration > get` 33, `createRoot` 32, `checkHydrationComplete` 31

**hydration: events before hydration** — 588 B: `runHydrationEvents` 588

**hydration: serialized values — signal adapters (server mode)** — 2,642 B: `hydrateSignalLike` 544, `readSerializedOrCompute` 495, `subFetch` 285, `readHydratedValue` 214, `hydratedEffect` 203, `hydratedCreateErrorBoundary` 190, `hasLoadingWindow` 93, `hydratedCreateSignal` 76, `withHydrationGate` 68, `hydratedCreateMemo` 55, `MockPromise.withResolvers` 40, `hydratedCreateRenderEffect` 39, `hydrateSignalLike > detect` 35, `createMemo` 32, `createErrorBoundary` 26, `createRenderEffect` 26, `createSignal` 25, `syncThenable` 24, `subFetch > window.fetch` 24, `MockPromise#finally` 23, `MockPromise#catch` 21, `MockPromise#then` 20, `hydrateSignalLike > flip` 17, `MockPromise[k]` 15, `syncThenable > then` 13, `MockPromise.withResolvers > resolve` 12, `MockPromise.withResolvers > reject` 10, `MockPromise` 9, `UNASKED.then` 8

**hydration: serialized values — async-iterable / hybrid (signal side)** — 1,406 B: `normalizeIterator > next` 337, `hydrateSignalFromAsyncIterable` 187, `wrapFirstYield.[Symbol.asyncIterator] > next` 132, `forwardIteratorReturn` 100, `hydrateSignalFromAsyncIterable.it.next > then` 85, `isAsyncIterable` 74, `adoptedAnswerStream.[Symbol.asyncIterator] > next` 72, `wrapFirstYield` 64, `adoptedAnswerStream.[Symbol.asyncIterator].next > then` 56, `normalizeIterator` 42, `adoptedAnswerStream` 37, `wrapFirstYield > [Symbol.asyncIterator]` 34, `adoptedAnswerStream > [Symbol.asyncIterator]` 34, `hydrateSignalFromAsyncIterable > iterable.[Symbol.asyncIterator]` 34, `hydrateSignalFromAsyncIterable > it.next` 32, `normalizeIterator > return` 32, `hydrateSignalFromAsyncIterable > it.return` 29, `wrapFirstYield.[Symbol.asyncIterator] > return` 25

**hydration: serialized values — store adapters** — 2,821 B: `hydrateStoreLikeFn` 646, `hydrateStoreFromAsyncIterable.[Symbol.asyncIterator] > next` 354, `hydrateStoreFromAsyncIterable > process` 327, `hydrateStoreFromAsyncIterable` 238, `applyPatches` 206, `quietAnswer.[Symbol.asyncIterator] > next` 136, `createShadowDraft` 125, `hydrateStoreFromAsyncIterable.[Symbol.asyncIterator].next > then` 86, `createShadowDraft > getOwnPropertyDescriptor` 78, `createShadowDraft > deleteProperty` 75, `hydrateStoreLike` 74, `withStoreHydration` 61, `createShadowDraft > set` 52, `wrapStoreFn` 44, `createShadowDraft > ownKeys` 41, `hydrateStoreLikeFn > detect` 35, `quietAnswer > [Symbol.asyncIterator]` 34, `hydrateStoreFromAsyncIterable > [Symbol.asyncIterator]` 34, `quietAnswer` 32, `hydrateStoreFromAsyncIterable.[Symbol.asyncIterator] > return` 32, `createShadowDraft > get` 29, `createShadowDraft > has` 29, `hydrateStoreFromAsyncIterable > fail` 20, `hydrateStoreLikeFn > flip` 17, `createShadowDraft > activate` 16

**hydration: live-source takeover** — 479 B: `armLiveTakeover` 164, `liveScopeOf` 105, `takeOver` 104, `releaseLiveScope` 71, `openLiveScope` 25, `TAKEN` 10 (the three arms inside `readSerializedOrCompute`, the `LIVE_*` symbols and the gate maps bring the feature to 953 B when cut)

**hydration: `<Loading>` boundaries & streaming resume (ledger, truncation, assets)** — 4,713 B: `hydratedCreateLoadingBoundary` 1,181, `rejectTruncatedRefs > sweep` 370, `waitAndResume` 291, `watchTruncation` 286, `hydrateWindow` 278, `markTruncated` 276, `initBoundaryResume` 159, `rejectTruncatedRefs` 152, `anyFragmentPending` 146, `resumeBoundaryHydration` 146, `fragmentParked` 127, `fragmentSuperseded` 125, `fragmentPending` 115, `initBoundaryResume > release` 112, `reportAssetFailure` 109, `scheduleResumeAfterAssets` 103, `ownedFragment` 99, `fragmentPolicy` 88, `whenRevealed` 84, `replayHeldFragment` 73, `createBoundaryTrigger` 72, `fragmentState` 58, `fragmentAbort` 54, `subscribeFragments` 49, `claimFragment` 38, `createLoadingBoundary` 34, `hydratedCreateLoadingBoundary > afterAssets` 28, `scheduleResumeAfterAssets > doResume` 28, `hydratedCreateLoadingBoundary > resumeFresh` 16, `hydratedCreateLoadingBoundary > resumeRejected` 16

**hydration: `lazy()` lookup & module assets** — 570 B: `loadModuleAssets` 312, `lazyHydrationLookup` 258

**module scope (solid)** — 659 B: `<module>` 643 (`solid.js`), `<module>` 16 (`internal.js`)

**signals core pulled by hydration** — 755 B: `releaseSubtree` 158, `getContext` 121, `captureWriteSnapshot` 101, `clearSnapshots` 85, `ownerInSnapshotScope` 62, `setSnapshotCapture` 57, `releaseSnapshotScope` 33, `isDisposed` 32, `peekNextChildId` 31, `NoOwnerError` 28, `ContextNotFoundError` 24, `markSnapshotScope` 23

**signals `store/utils.js` — the `readShallow` → `sourceKeys` walkers** — 1,076 B: `collectKeys` 326, `sourceKeys` 176, `addKey` 118, `leafKeys` 96, `hiddenByAny` 94, `isHidden` 79, `mergeKeysOf` 74, `leafOf` 44, `viewSource` 42, `<module>` 27

**DOM runtime: insert / reconcile** — 4,296 B: `reconcileArrays` 1,311, `insertExpression` 1,099, `insert` 590, `cleanChildren` 312, `normalize` 304, `ownsAllChildren` 302, `removeOwnedChildren` 208, `appendNodes` 100, `reconcileArrays > isLive` 70

**DOM runtime: events & delegation** — 2,367 B: `eventHandler` 624, `eventHandler > handleNode` 249, `addEvent` 239, `registerDelegatedContainer` 206, `unregisterDelegatedContainer` 198, `tagHost` 178, `findOwner` 122, `delegateEvents` 111, `attachDelegatedEvent` 91, `unregisterDelegatedRoot` 79, `eventHandler > walkUpTree` 79, `eventHandler > retarget` 65, `registerDelegatedRoot` 57, `eventHandler > get` 28, `addEvent > listener` 22, `attachDelegatedEvent > handler` 19

**DOM runtime: attributes / props / class / style / template** — 3,735 B: `assignProp` 787, `className` 651, `style` 423, `setAttribute` 280, `classListToObject` 266, `assign` 242, `readShallow` 208, `setProperty` 198, `flattenClassList` 170, `setAttributeNS` 141, `create` 140, `template` 110, `applyRef` 71, `ref` 48

**render entry & module scope (web)** — 1,469 B: `<module>` 1,084, `render` 309, `effect` 76

**flow controls** — 706 B: `Show` 262, `For` 111, `Errored` 104, `Loading` 83, `For > create` 43, `narrowedError` 38, `For > fallback` 23, `Show > equals` 21, `Loading > on` 11, `For > list` 10

**component model** — 362 B: `lazy > wrap` 144, `lazy > load` 81, `lazy` 74, `createComponent` 41, `lazy.load > comp` 22

**SC mount: `dynamicComponent` / `dynamicCore`** — 1,280 B: `dynamicCore` 549, `dynamicCore > sameInstance` 219, `staticDynamic` 166, `dynamicCore > resolveBinding` 141, `bindingOf` 90, `dynamicCore > then` 63, `dynamicComponent` 32, `staticDynamic > address` 20

## Appendix B — every cut variant measured (Δ min / Δ br against the same build)

| variant    | cuts                                                                    |           base SC | compiled hydrating | hydrating (no stores) | hydrating + stores |          live SC |
| ---------- | ----------------------------------------------------------------------- | ----------------: | -----------------: | --------------------: | -----------------: | ---------------: |
| A          | a-trace (stub)                                                          |       −2,640/−683 |                0/0 |                   0/0 |                0/0 |      −2,644/−644 |
| Areal      | (a) split, install edge kept — **the adapters stay eager**              |           −76/−36 |              0/−42 |                   0/0 |              0/−55 |           −76/+3 |
| Areal2     | (a) split, install edge removed (valid for no-store-wrapper pages only) |       −2,505/−653 |     (−2,767/−652)† |                   0/0 |     (−2,767/−728)† |      −2,485/−560 |
| Astub      | a-stub (for scale)                                                      |       −2,518/−647 |        −2,724/−600 |                   0/0 |        −2,724/−702 |      −2,517/−581 |
| B          | b-resume (stub)                                                         |       −1,167/−360 |        −1,168/−270 |           −1,163/−378 |        −1,168/−391 |      −1,164/−304 |
| Bglue      | b-glue (minimal loader alone)                                           |          +134/−18 |           +134/+75 |              +134/−10 |           +134/−22 |         +134/+62 |
| E          | e-readshallow                                                           |       −1,165/−396 |            +11/−23 |                   0/0 |                0/0 |      −1,165/−320 |
| F          | f-strings                                                               |          −356/−83 |          −356/−116 |             −356/−129 |          −356/−167 |         −356/−25 |
| Glive      | g-live                                                                  |         −953/−342 |          −953/−299 |             −952/−317 |          −953/−394 |     (−951/−264)‡ |
| Gsc        | g-sc                                                                    |      (−720/−206)‡ |          −720/−173 |             −720/−248 |          −720/−265 |     (−720/−180)‡ |
| GphaseA    | g-phaseA                                                                |          −184/−83 |           −184/−56 |              −184/−81 |           −184/−77 |         −184/−48 |
| Gsort      | g-events-sort                                                           |          −251/−93 |           −251/−53 |                   0/0 |                0/0 |         −251/−47 |
| AEFL       | a-trace+e+f+g-live (stub a)                                             |     −5,114/−1,426 |        −1,298/−380 |           −1,308/−454 |        −1,309/−440 | (−5,112/−1,330)‡ |
| **REAL**   | **(a) real + e + f + g-live**                                           | **−4,985/−1,405** |                  † |           −1,308/−454 |                  † |                ‡ |
| REALnolive | (a) real + e + f                                                        |     −4,026/−1,100 |                  † |                     — |                  † |  **−4,006/−999** |
| REALB      | REAL + b-resume (stub)                                                  |     −5,933/−1,637 |                  † |           −2,252/−669 |                  † |                ‡ |
| REALBglue  | REAL + b-resume + b-glue                                                |     −5,793/−1,538 |                  † |           −2,118/−657 |                  † |                ‡ |
| **PLAIN**  | **e + f + g-live + g-sc**                                               |                 ‡ |    **−2,018/−617** |       **−2,028/−660** |    **−2,029/−717** |                ‡ |
| PLAINB     | PLAIN + b-resume                                                        |                 ‡ |        −3,386/−979 |         −3,386/−1,049 |      −3,397/−1,111 |                ‡ |
| PLAINBglue | PLAIN + b-resume + b-glue                                               |                 ‡ |        −3,252/−983 |         −3,252/−1,007 |      −3,263/−1,027 |                ‡ |

† not a valid build for that page (the install edge the page's store wrappers need is removed). ‡ removes machinery that page needs (live takeover on the live page; SC-only machinery on SC pages); shown where measured for scale only.
