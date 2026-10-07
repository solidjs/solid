# `isPending` / `latest` / `onSettled` — closure or co-location? (2026-10-07)

Measurement and reading only; no source changes, no issue filed. Branch
`audit/is-pending-latest` off `next` @ `dafad1db3` (#3838) carries this
document and nothing else.

**Measured on:** `next` @ `be82cf3e2` (#3877) + #3838 @ `59f4994f4` + #3879's
commit — the detached HEAD `4228d1859` in the `.wt/hn` worktree, the same
build and harness as `documentation/plans/hackernews-signals-attribution.md`
(its `L0` reproduces here to the byte on every scenario: `page: hackernews`
145,323 / 47,780, `page: base + router` 144,082 / 45,940, `signals: core
floor` 20,177 / 7,382, `signals: + isPending/latest` 27,020 / 9,570).
`origin/next` moved during the work (`be82cf3e2..dafad1db3`: #3838 merged);
the measurements stay on `4228d1859`, which already carried #3838.

Two questions.

**Q1 (signals).** `isPending(source)` / `latest(source)` / `onSettled` are
core read primitives over any async. On HN they retain `core/lanes.js`
(4,764 B min) + `core/verdict.js` (1,919) ≈ 6.7 K min / ≈ 3.0 KB br. Is that
their genuine closure, or module co-location that a read-side / write-side
split of `lanes.ts` would shed?

**Q2 (router).** Where does `@solidjs/router@2.0.0-next.35` read
`isPending` / `latest` / `onSettled` internally versus `isRouting` as the
user-facing read; what does each use implement; is the router doing its own
holding or the core's; and what would a router that only re-exported
`isRouting = () => isPending(location)` retain when the app never calls it?

**Answer in one paragraph.** `onSettled` reaches none of it: it is
`trackedEffect` (225 B) + its own 125 B, no lanes, no verdict (fixture: +513
min / +162 br over the floor; on HN and the router page it costs 0 B because
the router's `action` path pins it anyway). `isPending` / `latest` are
**genuine closure on the lane engine's read side, co-location on its write
side.** `verdict.ts` is built on lanes by design — a verdict reader is work
of the holder's _verdict lane_ (`route → setPassLane(verdictLane(t))`), so
its pass is staged by `laneStage`, its node becomes a lane node read through
`laneRead`, judged at the seam by `laneSeam` / `lanesBlocked`, and ended at
the parent's landing by `endLanes → dissolveLane`. Those are needed to
answer "holds the latest?" correctly and are **2,877 B of `lanes.js`'s 4,742
(61 %)**. The other **1,865 B (39 %)** — `applyGuesses`, `laneCorrections`,
`supersede`, `laneOutcome`, `answered`, `stale`, `guessFlights`, `inFlight`,
`covered`, `laneWrite`'s guess branch, `dissolveLane`'s guess and correction
branches — is reachable only through a `CONFIG_GUESS` node (a
`createOptimistic` write) and is on the page because `lanes.ts` installs the
whole engine on `GlobalQueue` at module evaluation: once `verdict.ts` imports
three helpers from it, every install is a kept side effect. A read/write
module split sheds it: **−1,347 / −410 br** with no body edits (the installs
move), **−1,874 / −582 br** at the ceiling (the guess branches inside shared
functions move behind hooks); on HN −1,386…−1,933 min / −440…−652 br, on
`page: base + router` −1,354…−1,881 / −449…−572. `verdict.js` itself is all
read path; `latest` on its own is 274 B of it. On the router side, the
**holding is already the core's**: `navigate()` is a plain write of the
location signal (no `action`, no transition call anywhere in the router), and
the engine holds the frame while `matches()` and the route's queries are
pending. The router's reads implement _observations_ of that hold —
`isRouting` (its own memo over `matches()`/search/hash plus `isPending(source)`;
not a re-export), `intent` for `query`'s cache policy, `pendingTarget` for
`data-pending` links — and _bookkeeping_ (`headed = latest(source)`, the
redirect-depth probe); `onSettled` commits history at the landing. HN's app
never calls `isRouting` / `useIsRouting`; the router's own link claims,
scroll restoration, `pendingTarget` and `intent` do. **A re-export-only
router retains everything**: with every internal use stubbed and nobody
calling it, `isRouting` as a property of the context object still keeps
`isPending` referenced — HN 144,645 / 47,627 (−678 / −153), lanes 4,763 +
verdict 1,645 intact; removing the one property is −8,872 / −4,431 (the
RL ceiling plus the router's own stub savings).

---

## 1. Method

- Build, harness and tools as the HN attribution document §1: the `.wt/hn`
  worktree's fresh build, Rolldown 1.2.11, `tmp-tools/fnmap.mjs` source-map
  attribution (every mapped byte charged to the innermost named function of
  its dist source), cuts as exact-string (or single-match regex) edits over
  verbatim copies of the dists, the router's `solid`-condition dist and the
  flat `dist/index.js`, with `sideEffects: false` replicated
  (`tmp-tools/cuts.mjs`, `run-q.mjs`; `tmp-tools/` is git-excluded).
- **Fixtures** (`tmp-tools/fixtures/`, bundled like the harness's signals
  scenarios with `@solidjs/signals` aliased to `dist/prod/index.js`):
  - `floor.js` — an async memo (`createMemo(async …)`, Solid 2's async
    primitive; there is no `createAsync` export in this tree) read by a sync
    memo and an effect.
  - `pending.js` — (i) the floor plus `createMemo(() => isPending(user))` and
    `createMemo(() => latest(user))`. No `createOptimistic`, no `action`, no
    router.
  - `settled.js` — (ii) the floor plus `onSettled` in both forms: under an
    owner (the `trackedEffect` form) and `runWithOwner(null, () =>
onSettled(…))` (the router's queue form).
- **`page: base + router`** is measured with `@solidjs/router` aliased to the
  variant copy's flat `dist/index.js` (the `default` condition the scenario
  resolves); the verbatim copy reproduces the ledger's 144,082 / 45,940.
- Brotli: firm where a cut isolates a group; the HN eager graph is two
  files (entry + hoisted `client.js`), so a cut that empties the entry's
  share of signals collapses it to one and recovers the ≈ 1,335 B layout
  cost on top of its code (noted where it happens).

## 2. Q1 — signals

### 2.1 What the reads reach, by reading

`verdict.ts` (`latest`, `isPending`): opens a _verdict window_
(`setVerdict(verdictValue)`), marks the pass a verdict reader
(`CONFIG_VERDICT`), and `read()` dispatches every read inside the window to
`verdictValue`. For a node a transaction holds, `verdictRead → route` makes
the pass **work of the holder's verdict lane**: `setPassLane(verdictLane(t))`
(`lanes.ts`: `t._verdict ??= newLane(t)`) and `REACTIVE_LANE_READ`;
`heldNotFinal` / `heldLatest` answer. For a node staged but not yet held,
`provisionalVerdict` / `watchVerdict` defer to the seam (`stagedReaders`);
for an unheld flight, `pendingVerdict`; a reader served a flight's committed
value still observes it (`observeFlight`, installed as
`GlobalQueue._observeFlight` and called from `core.ts` `read`). For a lane's
node (`CONFIG_OVERRIDE`) it reads `laneValueOf` / `display` from `lanes.ts`.

From there the **core** reaches the lane engine through `GlobalQueue` hooks,
all of which `lanes.ts` installs at module evaluation:

| hook               | installed as                | called from                                                                                          | reached by a verdict reader?                                                                                                                                                     |
| ------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_laneStage`       | `laneStage`                 | `core.ts` `recompute` when `passLane !== null`; `async.ts` `propagateStatus`; `boundaries.ts` `flip` | **yes** — the verdict reader's pass has `passLane = verdictLane(t)`; its node is listed in the lane and gets `CONFIG_OVERRIDE`                                                   |
| `_laneRead`        | `laneRead`                  | `core.ts` `read` when `el._config & CONFIG_OVERRIDE`                                                 | **yes** — every plain read of a verdict-reader memo (e.g. `isRouting()` reading `routingPending()`)                                                                              |
| `_laneWrite`       | `laneWrite`                 | `core.ts` `setSignal` when `CONFIG_OVERRIDE`                                                         | **derivation branch yes** — an async landing is `setSignal(el, …)` (`async.ts:469`), so an async verdict-reader memo lands through it; the **guess branch** needs `CONFIG_GUESS` |
| `_laneOutcome`     | `laneOutcome`               | `core.ts` `recompute`, guarded by `el._config & CONFIG_GUESS`                                        | **no** — guess only                                                                                                                                                              |
| `_applyGuesses`    | closure                     | `scheduler.ts` `settle`                                                                              | the `judged = lanes.length` prefix **yes** (the seam loop reads it); `applyGuesses` body **no** — `pendingGuesses` is filled only by `optimisticWrite`                           |
| `_laneSeams`       | closure                     | `scheduler.ts` `settle`                                                                              | **yes** — judges every live lane (`laneSeam`: `blocked` → `_held` / `_shown`, `reruns`, `releaseQueues`), re-derives verdict readers that read a parked staging                  |
| `_laneCorrections` | closure → `laneCorrections` | `scheduler.ts` `settle`                                                                              | runs every seam while a lane exists, but acts only on `CONFIG_GUESS` nodes — **no**                                                                                              |
| `_endLanes`        | `endLanes`                  | `scheduler.ts` `settle` at a transaction's landing                                                   | **yes** — `dissolveLane(l, null)`: the verdict lane ends with its holder, its derivations' latest values commit                                                                  |
| `_lanesBlocked`    | `lanesBlocked`              | `scheduler.ts` `blocked(t)`                                                                          | **yes** — a blocked verdict lane blocks its parent (`linkBlocked`, `nestedBlocked`); `nestedBlocked`'s `guessFlights` leg is guess-only                                          |
| `_verdictLane`     | `verdictLane`               | `boundaries.ts` arming (`on: () => isPending(x)`)                                                    | **yes**                                                                                                                                                                          |
| `_laneGuesses`     | (observe only)              | `attribution.ts`                                                                                     | not in prod                                                                                                                                                                      |

`dissolveLane(l, into, except)` with `into !== null` (the correction path) is
called only from `supersede`, which is called only from `laneWrite`'s guess
branch, `laneOutcome` and `laneCorrections` — guess only. `optimisticWrite`,
`guessedValueOf`, `pendingGuessOf` are exports nobody imports on these
pages (`signals.ts`'s `createOptimistic` and `store/optimistic.ts` are unused)
and are already shaken.

**Why everything is retained although Rolldown shakes per function:** the
functions are not retained by import — they are retained by the
`GlobalQueue._x = fn` statements at the bottom of `lanes.js`. `sideEffects:
false` lets Rolldown drop the module when nothing imports from it (the core
floor has 0 B of it); once `verdict.js` imports `verdictLane`, `laneValueOf`,
`display`, the module is in, and every install is a property write on an
imported object — a side effect Rolldown must keep, and with it the function
it installs and that function's callees. So the dependency on the _read side_
is semantic (the hooks are called for a verdict reader), and the dependency
on the _write side_ is the module boundary.

### 2.2 Function classification (fixture (i), bytes)

`lanes.js` on fixture (i) — 4,742 B; the same functions at within a few
bytes on HN (4,764), the router page (4,766) and the `+ isPending/latest`
import scenario (4,742).

| function                   |         B | class                              | why                                                                                                                                                                                                      |
| -------------------------- | --------: | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `laneRead`                 |       453 | **read-essential**                 | every read of a lane node (verdict-reader memos included): authoritative / untracked / render-effect-stale-reader / `enterLane` cases                                                                    |
| `dissolveLane`             |       643 | **read-essential 394** / write 249 | the parent-landed path (`into === null`) ends the verdict lane and commits its derivations; the `else if (guess)` branch (54) and the correction path (195, reached only via `supersede`) are guess-only |
| `_laneSeams` closure       |       280 | **read-essential**                 | the seam: parked-staging readers (`CONFIG_VERDICT`, `REACTIVE_PROBE_UNANSWERED`), `laneSeam` over the judged prefix                                                                                      |
| `laneStage`                |       291 | **read-essential 264** / write 27  | lists the verdict reader's node in the lane, sets `CONFIG_OVERRIDE`; two `CONFIG_GUESS` tests are guess-only                                                                                             |
| `laneSeam`                 |       234 | **read-essential 221** / write 13  | judge, promote staging, release runs; one `CONFIG_GUESS` test                                                                                                                                            |
| `laneWrite`                |       229 | **read-essential 122** / write 107 | derivation branch (an async verdict-reader memo's landing); guess branch (`stale`, `supersede`, `_laneRebase`)                                                                                           |
| `enterLane`                |       145 | **read-essential**                 | a pass reading a lane node becomes its work; links two lanes read by one pass                                                                                                                            |
| `linkLanes`                |       136 | **read-essential**                 | two verdict lanes read by one pass are one reveal unit                                                                                                                                                   |
| `linkBlocked`              |       129 | **read-essential**                 | a linked lane blocked blocks the group                                                                                                                                                                   |
| `nestedBlocked`            |       107 | **read-essential 98** / write 9    | lanes under `t` block it; the `guessFlights` leg is guess-only                                                                                                                                           |
| `unlink`                   |        96 | **read-essential**                 | `dissolveLane`                                                                                                                                                                                           |
| `endLanes`                 |        95 | **read-essential**                 | the holder landed                                                                                                                                                                                        |
| `under`                    |        90 | **read-essential**                 | `enterLane` nesting                                                                                                                                                                                      |
| `laneValueOf`              |        83 | **read-essential**                 | `verdictValue`, `laneRead`, `dissolveLane`                                                                                                                                                               |
| module scope               |        86 | **read 67** / write 19             | `lanes`, `judged`; `pendingGuesses` is guess-only                                                                                                                                                        |
| `display`                  |        58 | **read-essential**                 | what the screen shows of a lane node                                                                                                                                                                     |
| `newLane`                  |        48 | **read-essential**                 | `verdictLane`                                                                                                                                                                                            |
| `lanesBlocked`             |        40 | **read-essential**                 | `blocked(t)`                                                                                                                                                                                             |
| `verdictLane`              |        35 | **read-essential**                 | the verdict lane                                                                                                                                                                                         |
| `_applyGuesses` closure    |        42 | **read 22** / write 20             | `judged = lanes.length` stays; the `applyGuesses` call goes                                                                                                                                              |
| `applyGuesses`             |       370 | **write-side**                     | opens lanes for written guesses                                                                                                                                                                          |
| `laneCorrections`          |       326 | **write-side**                     | body-end corollary: judges guesses whose truth is not in flight                                                                                                                                          |
| `supersede`                |       216 | **write-side**                     | the truth arrived for a guess                                                                                                                                                                            |
| `answered`                 |       115 | **write-side**                     | provenance of a guess's pass                                                                                                                                                                             |
| `guessFlights`             |       109 | **write-side**                     | a guess whose own refetch is up                                                                                                                                                                          |
| `laneOutcome`              |        99 | **write-side**                     | a written guess's own pass finished                                                                                                                                                                      |
| `inFlight`                 |        60 | **write-side**                     | `applyGuesses`, `guessFlights`                                                                                                                                                                           |
| `covered`                  |        59 | **write-side**                     | the value a guess covered                                                                                                                                                                                |
| `stale`                    |        40 | **write-side**                     | provenance test                                                                                                                                                                                          |
| `_laneCorrections` closure |        28 | **write-side**                     |                                                                                                                                                                                                          |
| **read-essential total**   | **2,877** |                                    | 61 %                                                                                                                                                                                                     |
| **write-side total**       | **1,865** |                                    | 39 %                                                                                                                                                                                                     |
| already shaken             |         0 |                                    | `optimisticWrite`, `guessedValueOf`, `pendingGuessOf`, `_laneGuesses`                                                                                                                                    |

`verdict.js` — 1,913 B, **all read path**: `verdictValue` 854, `isPending`
150, `quietPending` 124, `provisionalVerdict` 108, `heldNotFinal` 98,
`pendingVerdict` 92, `observeFlight` 82, `latest` 77, `markVerdictReader`
69, `heldLatest` 67, `route` 57, `watchVerdict` 48, `verdictRead` 39, module
27, `_witnessMark` 21. `latest` on its own (RI below, where every `latest`
call leaves and `isPending` stays): −274 B — `latest` 76, `heldLatest` 66,
`verdictValue` −122 (the `latestActive` branches fold once nothing sets it),
small residue.

What goes with them elsewhere (VO on HN): `constants.js` −84, `core.js`
−44, `scheduler.js` −19, `async.js` −4, `owner.js` −2 — 153 B of flags and
glue; signals −6,835 in all.

### 2.3 Measured

| variant                                  | what                                                                                                                                                                        |                                                                                        fixture (i) Δ min / Δ br |            `+ isPending/latest` Δ |          HN Δ | base + router Δ |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------: | --------------------------------: | ------------: | --------------: |
| **fixture (i) vs floor**                 | `isPending`/`latest` over an async memo                                                                                                                                     |                                 **+6,859 / +2,193** (lanes 4,742, verdict 1,913, other signals +182, entry +22) | +6,843 / +2,188 vs the core floor |             — |               — |
| **fixture (ii) vs floor**                | `onSettled` (owned + unowned)                                                                                                                                               | **+513 / +162** (signals +420: `trackedEffect` 225, `onSettled` 126, core 45, owner 25; **lanes 0, verdict 0**) |                                 — |             — |               — |
| **LW1**                                  | the write-side installs leave (`_laneOutcome`, `_laneCorrections`, `applyGuesses` body, `laneWrite`'s guess branch); shared functions untouched                             |                                                                         **−1,347 / −410** (lanes 4,742 → 3,401) |                     −1,347 / −409 | −1,386 / −440 |   −1,354 / −449 |
| **LW2**                                  | LW1 + the guess branches inside shared functions (`dissolveLane`'s `else if (guess)`, `nestedBlocked`'s `guessFlights`, the `CONFIG_GUESS` tests in `laneSeam`/`laneStage`) |                                                                                     **−1,679 / −509** (→ 3,072) |                     −1,679 / −511 | −1,737 / −550 |   −1,686 / −476 |
| **LW3**                                  | LW2 + `dissolveLane`'s correction path and held-queue drop (reached only via `supersede`)                                                                                   |                                                                                     **−1,874 / −579** (→ 2,877) |                     −1,874 / −582 | −1,933 / −652 |   −1,881 / −572 |
| floor / `onSettled` fixtures under LW1–3 |                                                                                                                                                                             |                                                                                                           0 / 0 |                                   |               |                 |

The fixture (i) and the harness's `+ isPending/latest` import scenario carry
identical `lanes.js` / `verdict.js` bytes (4,742 / 1,913): the import form is
a faithful proxy for the read use.

### 2.4 Closure vs co-location; what a split saves

- **Closure (read side): 2,877 B of `lanes.js` + 1,913 B of `verdict.js`
  (72 % of the pair) + ≈ 150 B of core glue ≈ 4,940 B min.** The verdict
  model is a lane model: the reader is the holder's verdict lane's work,
  shown now and re-derived at the landing, and the lane must be staged,
  read, judged and ended for `isPending` / `latest` to be correct across
  the hold (A10, A15, A19, A31 in `verdict.ts`'s header). Detaching verdicts
  from lanes would be a redesign of display-ahead reads, not a split.
- **Co-location (write side): 1,865 B min of `lanes.js` (28 % of the pair),
  ≈ 0.4–0.6 KB br.** Every byte is behind a `CONFIG_GUESS` test and only
  `createOptimistic` / `createOptimisticStore` produce one.
- **A read/write module split would shed it.** Shape: `lanes.ts` keeps the
  engine (`lanes`, `newLane`, `laneValueOf`, `display`, `enterLane`,
  `under`, `linkLanes`, `linkBlocked`, `unlink`, `verdictLane`, `laneStage`,
  `laneRead`, `laneSeam`, `_laneSeams`, `endLanes`, `dissolveLane`'s
  parent-landed path, `lanesBlocked`, `nestedBlocked`, `laneWrite`'s
  derivation branch, the `judged` prefix of `_applyGuesses`); a new
  `guesses.ts` takes `pendingGuesses`, `optimisticWrite`, `guessedValueOf`,
  `pendingGuessOf`, `inFlight`, `applyGuesses`, `supersede`, `covered`,
  `guessFlights`, `laneCorrections`, `laneOutcome`, `stale`, `answered`, and
  installs `_laneOutcome`, `_laneCorrections`, wraps `_applyGuesses`, plus
  the optional hooks the shared functions need: `_guessWrite` (`laneWrite`'s
  guess branch, ≈ 45 B on the read side), `_guessFlights` (`nestedBlocked`,
  ≈ 25 B) and a dissolve hook for `supersede`'s correction path and the guess
  re-homing (≈ 60 B, or a write-side copy of the per-node loop). `signals.ts`
  (`createOptimistic`) and `store/optimistic.ts` import from `guesses.ts`;
  `verdict.ts` keeps importing from `lanes.ts`. Pages with
  `createOptimistic` import both and lose nothing.
- **Estimated saving, net of the hooks: ≈ 1.3 KB min / ≈ 0.4 KB br (LW1
  shape, no body edits beyond the one hook) to ≈ 1.75 KB min / ≈ 0.55 KB br
  (LW3 shape) on every page that reads `isPending` / `latest` without
  `createOptimistic`** — every page with `@solidjs/router` 2.0 (HN −1,386…
  −1,933 / −440…−652; base + router −1,354…−1,881 / −449…−572), and the
  `+ isPending/latest` scenario from 27,020 to ≈ 25,200–25,700.

## 3. Q2 — router

### 3.1 Call sites (`solid` condition, `dist/**`; the flat `dist/index.js` has the same sites)

| #   | site                                                                                                                 | reads                                             | implements                                                                                                                                                                                                                                                                                                                | essential to the navigation model?                                                                                                                                                                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `routing.js:691` `routingPending = createMemo(() => isPending(() => { matches(); location.search; location.hash }))` | `isPending`                                       | "is the route-match derivation (lazy route boundaries included) or the location pending" — the memo half of `isRouting`                                                                                                                                                                                                   | **observation**, not the hold; the only way to probe `matches()` is from inside the router                                                                                                                                                                                                                                                                                     |
| 2   | `routing.js:702` `isRouting = () => routingPending() \|\| isPending(source)`                                         | #1, `isPending`                                   | the user-facing read (`useIsRouting`, `routing.js:96`) **and** the internal gate for #4, #8, #9, #10                                                                                                                                                                                                                      | **has its own logic — not a bare re-export** (the memo over `matches()` plus the raw probe of the location source)                                                                                                                                                                                                                                                             |
| 3   | `routing.js:703` `transitionIntent` → `router.intent` → `getIntent()` (`routing.js:551`)                             | `isPending(source)`, `latest(source)._navigation` | which navigation is asking: `"navigate"` / `"native"` / `undefined` (initial); read untracked by `query` (`data/query.js:147`) for its cache policy (hydration-value adoption window, `PRELOAD_TIMEOUT` vs `CACHE_TIMEOUT`, version bump on `"navigate"`), by `preload({ intent })` (`components.jsx:13`), by `liveQuery` | **substantive for `query`**; but the _fact_ is router bookkeeping — the router stamps `_navigation` on every write and already keeps `inflight` (`createIntegration`); it asks the engine instead of itself. Replaceable by widening `inflight` to every write (native pops included) and reading it; edge: `inflight` clears at settle, `isPending(source)` flips at the seam |
| 4   | `routing.js:708` `pendingNavigation` → `router.pendingTarget`                                                        | `isRouting()`, `latest(source)`                   | the in-flight target (`_navigation > 0`) → `data-pending` on claimed anchors (#8), `useLinkState().pending` (#10)                                                                                                                                                                                                         | **UI affordance**; replaceable by `inflight`                                                                                                                                                                                                                                                                                                                                   |
| 5   | `routing.js:801` `const headed = latest(source)` in `navigateFromRoute`                                              | `latest`                                          | the flushed world's heading: the base relative targets resolve against, the leave guard's destination, the redirect no-op check, the hop's `from`                                                                                                                                                                         | **bookkeeping**; replaceable by the integration's last written location                                                                                                                                                                                                                                                                                                        |
| 6   | `routing.js:837` `(isPending(source) \|\| integration.inflight?.() === headed)`                                      | `isPending`                                       | a redirect hop while the previous navigation is still pending → `navigationDepth` → `MAX_REDIRECTS`                                                                                                                                                                                                                       | already half router-side (`inflight`); the probe is the belt to `inflight`'s suspenders — replaceable                                                                                                                                                                                                                                                                          |
| 7   | `routers/factory.jsx:146` `runWithOwner(null, () => onSettled(() => { … history.set(next) }))`                       | `onSettled`                                       | commit the history entry once the navigation's transition settles (the URL changes when the new page shows); clears `inflight`                                                                                                                                                                                            | **essential to the model**; costs 0 B of lanes/verdict, and 0 B on either measured page (§3.3)                                                                                                                                                                                                                                                                                 |
| 8   | `claims.js:79`, `:127`                                                                                               | `router.isRouting()` (+ `pendingTarget`)          | `data-pending` on anchors; the one render effect that re-sweeps the anchor registry when routing flips                                                                                                                                                                                                                    | UI affordance, **default-on** (`setupLinkClaims` in `createRouter`)                                                                                                                                                                                                                                                                                                            |
| 9   | `routers/scrollRestoration.js:99`                                                                                    | `router.isRouting()`                              | hold the scroll restore until the traversal's transition commits                                                                                                                                                                                                                                                          | gating, **default-on** (`config.scrollRestoration ?? !history`); under the hold model a `createEffect` over `location.*` already runs at the landing, so for held writes the read is likely redundant — the comment guards native pops; needs a router test                                                                                                                    |
| 10  | `routing.js:240` `useLinkState().pending`                                                                            | `router.isRouting()`, `pendingTarget`             | per-link pending state                                                                                                                                                                                                                                                                                                    | UI affordance; only if the app calls `useLinkState`                                                                                                                                                                                                                                                                                                                            |
| 11  | `data/query.js:147` `untrack(getIntent)`                                                                             | via #3                                            | see #3                                                                                                                                                                                                                                                                                                                    | —                                                                                                                                                                                                                                                                                                                                                                              |
| 12  | `data/action.js:351`, `:404`                                                                                         | `onSettled`                                       | action settled hooks (`fn.onSettled`), `#580`                                                                                                                                                                                                                                                                             | the action path; lazy `serverForms.js` on HN, inlined on the flat dist                                                                                                                                                                                                                                                                                                         |

**Is the hold the router's or the core's?** The core's. `navigate()` →
`navigateFromRoute` → `setSource(next)` → `createIntegration`'s
`write(headed => resolveLocationWrite(headed, next))` — a plain write of a
`createSignal` (`ownedWrite`). There is no `action`, `startTransition` or
batch anywhere in `routing.js`, `routers/factory.jsx` or `routers/history.js`.
The engine holds the frame while `matches()` (lazy route boundaries) and the
route's `createMemo(async …)` / `query` reads are pending, and `read()` of
the location keeps serving the committed value — exactly what the router's
own comments rely on ("`read()` still holds the committed location while a
navigation is pending"; `headed` is "the pending navigation when one is
held, else the committed location"). The router already participates in
transitions the way `createMemo(async)` does: by writing and letting the hold
model hold. Its `isPending` / `latest` reads are how it _observes_ and
_reports_ that hold (`isRouting`, `intent`, `pendingTarget`) and how it
reads the proposal (`headed`); none of them is what keeps the old route on
screen.

**HN:** `examples/hackernews/src` imports `createRouter`, `defineRoute`,
`query` and route types from `@solidjs/router`; it never calls `isRouting`,
`useIsRouting` or `useLinkState`. What exercises the reads on HN is the
router itself: `query` → `intent` (#3), link claims (#8, default), scroll
restoration (#9, default), `pendingTarget` through claims (#4), `headed` and
the redirect probe on every `navigate()` (#5, #6), `onSettled` on every
navigation (#7). The `page: base + router` fixture (`createRouter`,
`useNavigate`, a `preload`) is the same.

### 3.2 Measured — the router's reads, piecewise

Δ min / Δ br against `L0`; signals Δ in parentheses. `RL2` is the HN
document's `RL` extended to the flat `index.js`.

| variant | router edit                                                                                                                       |                                                                        HN |                                   base + router |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------: | ----------------------------------------------: |
| **OS**  | #7 only: `onSettled` → `queueMicrotask`                                                                                           |                                                         +21 / +68 (**0**) |                               +12 / +35 (**0**) |
| **VO**  | #1–#6 only: `isPending → false`, `latest → s()`; `onSettled` kept                                                                 |                                                  −8,444 / −4,282 (−6,835) |                        −6,851 / −2,167 (−6,845) |
| **RL2** | all of it (VO + OS)                                                                                                               |                                                  −8,414 / −4,337 (−6,835) |                        −6,839 / −2,146 (−6,845) |
| **RI**  | the internal uses only (#3, #4's `latest`, #5, #6, #7 stubbed); `isRouting` (#1, #2) untouched                                    |                    −370 / −86 (−280: `verdict.js` −274, `latest`'s share) |                               −370 / −62 (−281) |
| **RR**  | RI + `isRouting` reduced to the bare re-export `() => isPending(source)` (the `routingPending` memo goes)                         |                                                        −464 / −100 (−280) |                               −462 / −94 (−269) |
| **RU**  | RR + nobody calls it: #4, #8, #9, #10 read `false`; `useIsRouting` unused; **`isRouting` stays a property of the context object** | **−678 / −153 (−275)** — `lanes.js` 4,763 + `verdict.js` 1,645 **intact** |   **−669 / −149 (−269)** — 4,766 + 1,658 intact |
| **RD**  | RU + the `isRouting` property removed from the object literal                                                                     |                           **−8,872 / −4,431 (−6,835)** → 136,451 / 43,349 | **−7,291 / −2,331 (−6,834)** → 136,791 / 43,609 |

Reading it:

- **`onSettled` is free here.** OS moves 0 signals bytes on both pages:
  `onSettled` (125) and `trackedEffect` (225) sit in the eager `signals.js`
  module because the router's `data/action.js` imports `onSettled` — a lazy
  chunk (`serverForms.js`) on HN, the pinned-module rule (a module in the
  eager graph carries every function a lazy chunk imports from it); inlined
  and eager on the flat dist. Its standalone cost is the fixture's +513 /
  +162, none of it lanes or verdict.
- **All 6.7 K is the verdict reads.** VO = RL2 on signals; the `onSettled`
  edge contributes nothing to the lanes/verdict retention.
- **Stubbing the internal uses alone saves 274 B of signals** — `latest` and
  its branches — because `isRouting` keeps `isPending`, and `isPending` is
  what retains both modules.
- **A re-export-only router retains everything (RU).** Even with every
  internal consumer gone and the app never reading it, `isRouting` as a
  property of the object `createRouterContext` returns keeps the closure
  `() => isPending(source)` alive — Rolldown does not drop an unused
  property of a returned object literal — and that one reference keeps
  `verdict.js`, which keeps `lanes.js` and its installs: 6,408 B min of
  signals for a read nobody makes. HN would ship 144,645 / 47,627.
- **Removing the property is the whole saving (RD):** −8,872 / −4,431 on HN
  (136,451 / 43,349 — the eager graph collapses to one file, so ≈ 1.5 KB min
  of cross-chunk glue and the 1,335 B brotli layout cost are in the delta;
  the code's own delta is ≈ −7.3 KB min / ≈ −3.1 KB br), −7,291 / −2,331 on
  `page: base + router`. The router's own code: `routing.js` 6,711 → 6,415,
  `claims.js` 1,512 → 1,405, `scrollRestoration.js` 934 → 923, `factory.jsx`
  +31 for the microtask stub.
- For a router that wants `isRouting` _shakeable_, the read has to be a
  module-level export the app imports (`useIsRouting` computing from the
  context's `location` source), not a context property, **and** the
  router's own consumers (#4, #8, #9, #10) must not read it — otherwise the
  default-on link claims and scroll restoration retain it on every page.

### 3.3 Essential vs replaceable

- **Essential as the model stands:** #7 `onSettled` (history commits at the
  landing — the one place the "URL changes when the page shows" rule lives);
  the _facts_ behind #3 `intent` (query's cache policy depends on which
  navigation is reading). Neither needs the verdict reads: #7 does not use
  them, and #3's fact is one the router produces itself when it writes.
- **Observations the app may or may not want:** #1/#2 `isRouting` (opt-in
  by nature — HN never asks), #4 `pendingTarget` + #8 `data-pending` + #10
  `useLinkState().pending` (link affordances), #9 scroll's `routing` gate
  (likely redundant for held writes; a test would settle the native-pop
  case).
- **Bookkeeping the router could keep itself:** #5 `headed` and #6 the
  redirect-depth probe already lean on `integration.inflight`; widening
  `inflight` to every write (native pops carry `_navigation: -1` and are not
  recorded today) and keeping the last written target would replace `latest(
source)` and `isPending(source)` in `transitionIntent`, `pendingNavigation`
  and `navigateFromRoute`. The edge to test: `inflight` is cleared by the
  `onSettled` callback, `isPending(source)` flips at the seam; a synchronous
  navigation (nothing pending) is "routing" for one microtask under the
  former and never under the latter — `query` reads `intent` untracked at
  the moment of the read, so the window matters only for a read landing in
  that gap.
- **Could the router participate in transitions without reading pending
  state at all?** For the _hold_, it already does — the hold is the core's.
  For the _reports_, yes if `isRouting` / `pendingTarget` / `intent` are
  derived from the router's own write bookkeeping and `isRouting` becomes an
  opt-in export; then a page like HN sheds the pair entirely (RD), and a page
  that calls `useIsRouting` pays the read-side closure (§2.4) — 4.9 K min
  today, ≈ 3.1–3.6 K after the signals split.

## 4. Recommendation

**Signals.** Split `lanes.ts` along the `CONFIG_GUESS` seam: the lane engine
stays (`verdict.ts` needs it — the read side is genuine closure), and a
`guesses.ts` write module takes `optimisticWrite` / `applyGuesses` /
`laneCorrections` / `supersede` / `laneOutcome` / `stale` / `answered` /
`covered` / `guessFlights` / `inFlight` with their installs and two or three
optional hooks for the guess branches inside `laneWrite`, `nestedBlocked` and
`dissolveLane`. It is mechanical — every moved path is already behind a
guess test, so no verdict semantics move — and worth ≈ 1.3–1.75 KB min /
≈ 0.4–0.55 KB br on every router page and on the `+ isPending/latest`
scenario. Do not try to detach verdicts from lanes to go further: the
remaining 2.9 K of `lanes.js` is what makes `isPending` / `latest` correct
across a hold, by design. `onSettled` needs nothing.

**Router.** The hold is the core's already; what the router buys with
`isPending` / `latest` is `isRouting`, `intent`, `pendingTarget` and the
redirect probe, and it pays 6.7 K min / ≈ 3.0 KB br of code for them on every
page whether or not the app asks — because `isRouting` is a context
property and the default-on claims / scroll features read it. The pay-for-use
shape: `isRouting` as an opt-in export (`useIsRouting`) rather than a
context property; `intent` / `pendingTarget` / `headed` / redirect depth from
the integration's own `inflight` bookkeeping widened to every write;
`data-pending` and the scroll gate either consuming the opt-in read or
dropping the probe (scroll likely needs no probe under the hold model —
verify the native-pop case). Measured ceiling for an app like HN: −8.9 K min
/ −4.4 KB br as bundled (≈ −3.1 KB br of code). This is solid-router#655's
question; nothing here is a Solid cut.

## 5. Caveats

- Measurement shapes, not implementations. LW1–3 edit the dist's minified
  function bodies; a real split adds the hooks estimated above (≈ 45–130 B
  min) and may reorganize `dissolveLane`. RI–RD change the router's
  semantics (no `intent`, no pending target, no redirect probe); RD's
  "property removed" is the mechanism check, not a proposal in that form.
- The fixture's "async memo" stands in for `createAsync`, which does not
  exist in this tree; `createMemo(async …)` is the primitive.
- #9's redundancy under the hold model is read from the engine's rules
  (effects run at the landing; a held write is not visible to an effect's
  compute) and the router's comment, not from a router test.
- #3's replaceability has the `inflight`-vs-seam window noted in §3.3; a
  router test should pin it before anything moves.
- `onSettled`'s 0 B on these pages is the pinned-module effect of the
  action path (`data/action.js`); a page whose router build had no action
  path would pay its +350 B of signals. It touches no lane or verdict code
  in any configuration.
- Local measurements (macOS, Node 26.4, Rolldown 1.2.11 pinned); minified
  deltas are the firm numbers, brotli moves ±30–90 B with layout. The HN
  two-file layout is noted where a cut collapses it.
- Nothing was run through the test suites: no source changed.

## 6. Reproducing

In the `.wt/hn` worktree (`4228d1859`, built), under the git-excluded
`tmp-tools/` (the HN attribution document's tooling plus):

- `tmp-tools/fixtures/{floor,pending,settled}.js` and
  `fixtures/scenarios.mjs` — the three fixtures as scenario objects
  (`EXTRA_SCENARIOS=tmp-tools/fixtures/scenarios.mjs` makes `fnmap.mjs` see
  them; `lib.mjs` `pickScenarios` accepts the extra list).
- `tmp-tools/cuts.mjs` — the new cuts: `lanes-nowrite-installs` (LW1),
  `lanes-nowrite-full` (LW2), `lanes-nowrite-correction` (LW3),
  `router-onsettled-only` (OS), `router-verdict-only` (VO), `router-nolanes`
  (RL2, now with the flat `index.js` edits), `router-int` (RI),
  `router-reexport` (RR), `router-isrouting-unread` (RU),
  `router-isrouting-dropped` (RD). Anchors may be a single-match RegExp for
  multi-line bodies.
- `tmp-tools/run-q.mjs --scenarios hn,router,pendimport,pending,floor,settled
<variant>:<cut>+<cut> …` — measures each variant on the chosen scenarios
  (`router` aliases `@solidjs/router` to the variant's flat `index.js`),
  attributes signals by module, lists `lanes.js` / `verdict.js` by function,
  prints the Δ table; results in `tmp-tools/out/q.json` and
  `q-<variant>-<scenario>.json`.
