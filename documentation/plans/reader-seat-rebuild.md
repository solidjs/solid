# Reader seat — rebuild beside, differential, then swap

Date: 2026-10-28. Branch `seat/rebuild-beside` off `next` @ 9bd9c3475.
Companion: `reader-seat-brief.md` (the rulings review and the P0a bugs; its
§4 points here). Rule precedence throughout: `RULES-FUNDAMENTALS.md` >
`RULES-DERIVED.md` > `SPEC-ASYNC-SEMANTICS.md`. Where this document and a
rule disagree, the rule stands and the disagreement is a finding (§6), never
a ruling made here.

The question every read answers is "which world does this reader see":
the screen (`_value`, slot **C**), this flush's staging (`_pendingValue`,
**P**), a lane's value (`_x._lane`, **Lv**; a lane's derivation, **Dv**), a
truth (**T**), not ready (**NR**) or an error (**E**). Today that answer is
spread across eleven deciders in four files. The rebuild gives it one seat
per pass and one table (`reader-seat-brief.md` §4; copied in §2.3 below),
builds the table _beside_ the deciders under `__TEST__`, proves agreement
on the suites and the generator, and only then swaps.

## 1. Module boundary

### 1.1 Replaced (becomes rows of the table)

| Today                                                                                                                                                                                                              | File                     | Row(s)                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | ---------------------------------------------------------------------------- |
| `recompute` head: `passLane`/`setPassLane`, `laneRoot`, `mount`, `creatorPass(context)?._flags & RECOMPUTING_DEPS`                                                                                                 | `core.ts:325–366`        | B1 (seat open)                                                               |
| `recompute` finally: `joined`, `el._config = … \| (flags & REACTIVE_PROBED)`, the kept flag set                                                                                                                    | `core.ts:595–628`        | B2 (seat close)                                                              |
| `recompute` publish: born-held test `create ? !((flushTransaction \|\| passTx) && (joined \|\| creatorPass(oldcontext)?._flags & JOINED))`; pending first-pass hold `create && lane === null && joined && PENDING` | `core.ts:775–880`        | B2                                                                           |
| `recompute` held re-pass arm (`CONFIG_HELD` → `joinPassTx`/`freshHook`/drop staging)                                                                                                                               | `core.ts:404–431`        | L2/D2 for the pass's own node                                                |
| `frameRead(c, el)`                                                                                                                                                                                                 | `core.ts:1178`           | L3, L4, V1, V4, D6 (ST side effect)                                          |
| `bornInto(c, t)`                                                                                                                                                                                                   | `core.ts:1219`           | B1 "born into t" test used by V1/V4/L2                                       |
| `joinPass(c, el)`, `joinPassAt(c, t)`                                                                                                                                                                              | `core.ts:1130–1160`      | raise H side effect of D2/L2/L4                                              |
| `read`: fast-block `CONFIG_HELD` arm, `readerSeesCommitted`, `stagedScreen`, `stagedRead` calls; slow-path HELD arm, pending arm (`passLane !== null && !UNINIT → committed`), `committed → _value`                | `core.ts:1835–2076`      | U1, F1, L1–L4, D1–D2, D6–D7, V2–V3                                           |
| `serve(el, c)` and the duplicated hold arms                                                                                                                                                                        | `core.ts:2088`           | U1–U4, F1, L5, D3, D5                                                        |
| `readerSeesCommitted`, `stagedScreen`, `stagedRead`                                                                                                                                                                | `core.ts`                | F1, V2/V3, D1/D7                                                             |
| `markVerdictReader`'s creator walk for `born` (`JOINED \| STAGED_READ`)                                                                                                                                            | `verdict.ts:240`         | B1 inheritance + the #4341 "V reads as D" narrowing                          |
| `route(c, t)`: seating a verdict pass via `setPassLane(verdictLane(t))`, `LANE_READ`                                                                                                                               | `verdict.ts`             | posture V seats the pass; `t._verdict` stays the record                      |
| `observeFlight`, `provisionalVerdict` (incl. the `!probing → joinFuture(null)` arm #4393 removes), `verdictValue`'s OVERRIDE / HELD / staged / pending arms                                                        | `verdict.ts`             | V1–V6, Vl1–Vl5, Vp1–Vp2                                                      |
| `laneRead(c, el)`, `enterLane(l, c)`, `laneStage`'s `_parent._verdict === l` arms                                                                                                                                  | `lanes.ts`               | L6, L7, D4, D6–D8, V5                                                        |
| `truthRead` arm selection                                                                                                                                                                                          | `truth.ts`               | A1                                                                           |
| `stageError`'s `!passLane` + `STAGED_READ` test                                                                                                                                                                    | `async.ts:188`           | E staging when world ≥ Fl and the seat has neither lane nor V posture (D-41) |
| `flip`: `b._lane = b._armLane`; `arm`: `_armLane = passLane`                                                                                                                                                       | `boundaries.ts:210, 467` | `_armLane` is taken from the arming pass's `seatLane`                        |

Storage that goes with them: `REACTIVE_JOINED`, `REACTIVE_STAGED_READ`,
`REACTIVE_LANE_READ` (re-encoded as world rank + ahead); `FRAME_READ` and
`SCREEN_READ` become one STALE bit; `REACTIVE_PROBED` folds into
`CONFIG_VERDICT`. No new field on the node literal (`docs/NODE-SHAPE.md`).
Module state replaces them: `seatLane` (pointer), posture (byte), world
(byte), ahead (bit).

### 1.2 Kept

| Kept                                                                                                                                                                                                                         | Why                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transaction core: `Transaction`, `newTransaction`, `holdNode`, `list`, `unhold`, `holdFrame`, `blocked`, `blockersOf`, `merge`, `land`, `reruns`, `releaseQueues`, `txOf`, `resolveTx`, `liveTx`, `joinFuture`, `joinPassTx` | The hold relationship is not the question; who sits in it is. `joinPassTx` is the raise-H primitive the seat calls.                                                                                                                                                             |
| `async.ts` propagation: `notifyStatus`, `propagateStatus`, the lane-work `laneStageHook(sub, passLane, true, el)` call (rewired to `seatLane`)                                                                               | Unchanged semantics; only the lane pointer it reads moves.                                                                                                                                                                                                                      |
| `boundaries.ts` except the two call sites above                                                                                                                                                                              | Boundary flips and arming are consumers of the seat, not deciders.                                                                                                                                                                                                              |
| `store/` — `stagingReader`, `readSource`, `familyAhead`, `nodeValue`, `serveDataKey`, `optimistic.ts` `foldedRead`/`fold`/`laneSet`                                                                                          | Out of scope (brief §6): they call `joinPassTx`, `stagedScreen`, `stagedRead`, `joinPassAt`. The swap keeps thin shims with those names over the seat until the store twins are addressed. RUL-1 (store mirrors signals' visibility matrix) is what makes the shims sufficient. |
| `lanes.ts` sub-hold core: `newLane`, `linkLanes`/`linkBlocked`/`unlink`, `verdictLane`, `supersede`/`dissolveLane`, `laneSeam`, `endLanes`, `lanesBlocked`/`nestedBlocked`, `laneOutcome`, `laneCorrections`                 | Lane lifecycle, not seating. Split out as `lanes-core.ts` (§2.2).                                                                                                                                                                                                               |
| `lanes.ts` optimistic layer: guess values, `optimisticWrite`/`laneWrite`, `applyGuesses`, `fold`, `pendingGuesses`, `guessedValueOf`, `take`, `display`, `covered`, `inFlight`, `guessFlights`                               | Stays as `lanes.ts`; only its read arms (`laneRead`, `enterLane`) become rows.                                                                                                                                                                                                  |
| `scheduler.ts` hook pattern (`laneStageHook` etc.)                                                                                                                                                                           | The seat's display-ahead rows install through the same pattern.                                                                                                                                                                                                                 |

## 2. New layout

### 2.1 `core/seat.ts` — the seat and the slot dispatch

```
export const enum World { S = 0, Fl = 1, H = 2 }
export const enum Posture { D, L, V, Vl, Vp, A, F }
export const enum Slot { C, P, Lv, Dv, T, NR, E }

// module state, saved/restored by recompute (the "seat")
export let seatWorld: World, seatLane: Transaction | null, seatAhead: boolean, seatPosture: Posture
export function openSeat(el, create): SavedSeat   // B1: inherit {world, lane, ahead} from the running creator pass; posture from el._config
export function closeSeat(saved, el, create): BornHeld // B2: born-held decision; freshHook own
export function raise(w: World): void              // D-1: a read only raises
export function slot(c, el): Slot                  // U/F/L/D rows; dispatches V/Vl/Vp/A and lane rows to aheadHook
export let aheadHook: ((c, el, posture) => Slot) | null   // installed by verdict.ts; null in an app without isPending/latest/createOptimistic
```

`slot` is a table, not a decision tree: posture × node-state bits → row id;
the row id selects the slot and the side effects (raise Fl/H/lane, ST(t), W,
AH(t)). Side effects are issued by `slot`, never by callers. The U rows need
no seat (no pass); F needs only the posture.

Pay-for-use: `seat.ts` knows only `World`, `Posture.D/L/F`, slots C/P/NR/E
and the raise primitives. Everything with a lane or a verdict in it reaches
`seat.ts` through `aheadHook`, so an app that never imports `createOptimistic`,
`isPending` or `latest` retains the seat but not the display-ahead rows.

### 2.2 `lanes.ts` split

- `core/lanes-core.ts` (sub-hold core): create (`newLane`), judge-blocked
  (`lanesBlocked`/`nestedBlocked`, parent waits for a lane's flights — F-6
  2026-10-28 amendment), reveal at seam (`laneSeam`, `laneSeams`), link
  (`linkLanes`/`linkBlocked`/`unlink`), end with parent (`endLanes`,
  `dissolveLane`, `supersede`). `verdictLane(t)` lives here: a verdict
  record is a lane record with no node set. Installs `lanesBlockedHook`,
  `laneSeamsHook`, `endLanesHook`, `laneOutcomeHook`.
- `core/lanes.ts` (optimistic layer): guess values (`_x._lane`),
  `laneWrite`/`optimisticWrite`, `applyGuesses`, `fold`, supersession of
  guesses, `laneStage`, and the guess arms of `laneRead` (rows L6, L7, D4,
  V5, Vl5). Installs `laneReadHook`, `laneStageHook`, `laneWriteHook`,
  `applyGuessesHook`, `laneCorrectionsHook`.
- An `isPending`-only app imports `verdict.ts` → `lanes-core.ts`; it must
  not retain `lanes.ts`. The byte saving is **measured** at the swap PR with
  `scripts/size` (scenario: isPending without createOptimistic), not
  estimated here.

### 2.3 `verdict.ts` keeps

`latest`, `isPending`, the probe window (`probing`, `probeFound`,
`latestActive`), `watchVerdict`, `quietPending`, `heldNotFinal`,
`pendingVerdict`, `observeFlightHook` installation. It loses `route`,
`markVerdictReader`'s creator walk, `provisionalVerdict`'s seating, and
`verdictValue`'s arm selection: those become the V/Vl/Vp rows, implemented
as the `aheadHook` installed into `seat.ts`. The probe window becomes a
posture narrowing (V → Vl under `latest`, V → Vp under `isPending`), read
by `openSeat`/`slot`, so `setVerdict(verdictValue)` dispatch goes.

The table (authoritative copy in `reader-seat-brief.md` §4 and the task
brief) is reproduced in `packages/signals/src/core/seat.ts` as the row
comments, one row per `case`, with its rule ids. Rows are referenced here by
id only.

## 3. Shadow harness

All under `__TEST__` (`"false"` in `rollup.config.js`'s `flags()` and in
every size script; `"true"` in `packages/signals/vite.config.ts` for the dev
tier). Rollup drops `if (__TEST__) {…}` blocks whole, so the dist is
byte-identical; §5.1 checks that, not asserts it.

### 3.1 Reads

`read(el, c)` gains, at its head:

```ts
if (__TEST__ && !shadowBypass) return shadowRead(el, c);
```

`shadowRead` sets the bypass, calls `read` again (the real body), and
compares. Inside the body two `__TEST__` statements record state:

- **Decision point.** After the fast-block guard (signals) or after the
  slow path's pull/update and `c._flags |= owner & CONFIG_VERDICT` (V6) —
  i.e. where today's deciders begin — `shadowExpect(el, c)` snapshots
  `c`'s flags and computes `slot(c, el)` in **predict mode** (no side
  effects; returns the row id, the slot and the predicted raise set).
- **Return sites.** Each `return el._value` / `return el._pendingValue` /
  lane-hook return / throw records the slot the old decider chose
  (`shadowActual = Slot.C` etc.). `laneRead`, `verdictValue`, `truthRead`
  and `serve` record their own.

`shadowRead` then compares. As built, the shadow **records** into a
registry keyed `kind|row|expected|actual|state` and throws only when
`globalThis.__SEAT_SHADOW_STRICT__` is set (one assertion per read would
stop a suite at its first mismatch and hide the shape of the rest); the
signals/solid/web vitest configs append one JSON line per test file when
`SEAT_SHADOW_REPORT=<file>` is set, and
`packages/signals/scripts/seat-shadow-summary.mjs` aggregates them into
the triage table. `SEAT_SHADOW_TRACE=<key fragment>` prints a stack for
the first three hits of a class.

- `INV-seat-3 slot`: `expected.slot === actual` — slot **identity** (which
  storage), not value equality. `T` (truth) is accepted when `truthRead`
  throws NR.
- `INV-seat-3 world`: not a flag delta per read — the old flags are set
  once per pass and stay set, so a delta says nothing after the first
  raise — but a **world-state** comparison after each read:
  `max(JOINED → H, STAGED_READ → Fl, openWorld)` on `c` against the seat's
  world. Skipped for posture L (a leaf's world is `INV-seat-1`'s business,
  and today does raise a leaf — §7 F-leaf). The lane seat is compared at
  the pass's end only (B2), a raise to a lane being one bit on the old side.
- Raises the old code applies outside `read` are mirrored into the seat:
  `shadowExternalRaise` from `joinPass`/`joinPassAt` (store reads,
  `verdictValue`'s `probing && owned`) and `stagedRead` (store staged
  reads); `shadowSwapSeat` from a boundary's display-ahead swap
  (`fallback`'s `b._lane`).

A failure message names `row`, the node (`el._name ?? id`), the reader,
the two slots, and the node-state bits. Reads that exit before a
decision point (verdict dispatch handled in `verdictValue`'s own shadow,
untracked `!c` reads that return before any decider, `pull` throwing) leave
`shadowExpect` unset and are not compared. `shadowBypass` is consumed by
the first re-entry only, so reads nested in a pull are each shadowed.

### 3.2 Passes

`recompute` gains two `__TEST__` statements:

- After the head seats the pass (`setPassLane`, `laneRoot`, `mount`):
  `openSeat(el, create)` runs beside it and asserts `seatLane ===
passLane`, `seatAhead === !!mount || creator JOINED` (the old ahead), and
  `seatWorld` against the old starting world (H when the pass was born into
  the tick's hold — `bornInto(el, flushTransaction ?? passTx)`; the
  creator's world on a first pass — `creatorPass(context)._flags &
(JOINED | STAGED_READ)`; else S). Failure names row B1.
- In the finally, before `_config` is written: the seat's born-held
  prediction (`world === H || (ahead && world >= Fl)`, tick has a hold,
  minus the nested-derivation-left-pending exclusion) against the old
  `joined || creatorPass(oldcontext)?._flags & JOINED` arm; and `freshHook`'s
  own (`born held without ahead`) against today's `!mount &&
flushTransaction`. Failure names row B2.

### 3.3 `INV-seat` family (`invariants.ts`, documented in

`INTERNALS-ASYNC-STATE.md` §5)

- **INV-seat-1 — a leaf never raises its world.** A signal read raises the
  reader's world only through a row that says so (D-1): after a read of a
  leaf whose row predicted no raise, `seatWorld` is unchanged.
- **INV-seat-2 — posture is never inherited.** At `openSeat`, posture comes
  from `el._config`/`_type` and the probe window only; a first pass whose
  inherited world is Fl/H narrows V to D (#4341) — that is a narrowing of
  its own posture, not an inheritance. Checked by recomputing posture from
  the node alone at `closeSeat` and comparing.
- **INV-seat-3 — the shadow agrees.** §3.1 and §3.2 assertions.

### 3.4 Running the shadow outside the signals suite

`solid` and `web` tests, and the generator, consume `@solidjs/signals`
through the package `exports` `"test"` condition → `dist/dev.js`, where
`__TEST__` is `false`. `rollup.config.js` gains an environment switch:
`SIGNALS_TEST_DEFINE=true pnpm --filter @solidjs/signals build` emits a dev
dist with `__TEST__: "true"`; the default build is unchanged (verified §5.1).
The differential across solid/web/generator runs against that build and the
dist is rebuilt plain afterwards (`pnpm build`) before measuring.

## 4. Differential protocol

Order, each on the `SIGNALS_TEST_DEFINE` build where needed:

1. `pnpm --filter @solidjs/signals test` (vitest, `__TEST__` true natively).
2. Visibility oracle: `VISIBILITY_POSTURE_REPORT=/tmp/posture.md
VISIBILITY_ORACLE_REPORT=/tmp/oracle.md pnpm exec vitest run
tests/visibility-oracle-posture.test.ts tests/visibility-oracle.test.ts
tests/visibility-oracle-store.test.ts` in `packages/signals`.
3. `pnpm --filter solid-js test`, `pnpm --filter @solidjs/web test`.
4. Generator (`packages/web/test/async-gen`): `ASYNC_GEN=1
ASYNC_GEN_SEED={3289,91501,7} ASYNC_GEN_CASES=2000 ASYNC_GEN_PAIRS=all
ASYNC_GEN_MODE=survey`, owned and unowned; then `ASYNC_GEN_CASES=50000`.
   A shadow assertion surfaces as a thrown `INV-seat-3` inside the case; the
   campaign records it with the case's seed and index, which is the
   minimized repro's starting point (`ASYNC_GEN_MODE=shrink`).

### 4.1 Triage

Every mismatch is one of two things, decided against the rule ids on the
row, not against the code:

- **Table error** — the old decider's slot is what the rule requires. Fix
  the row (in `seat.ts`, this document §6 and the brief's table) and say so
  in the PR. No code behaviour changes.
- **Bug on `next`** — the new slot is what the rule requires. File an issue
  with the minimized repro, the rule id and the seat row; add it to the
  triage table in the PR body. **Do not fix it here**: the shadow then
  carries an explicit allow-list entry (`shadowKnown(row, issue)`) so the
  differential is otherwise zero and the swap PR closes the issue by
  construction.
- A mismatch where the rule itself admits both readings is a finding (§6),
  with both readings and the screen each produces; the row keeps today's
  behaviour until ruled.

The P0a bugs already identified (brief §2: R5 #4365 Vl2/W, R7 V1, R8 Vl4,
R4 D4 link, R1 V1/B1) are expected mismatches of the second kind; PRs
#4383/#4393 are open against `next` and the rows reproduce their pinned
behaviour (Vl2's `watchVerdict` path, Vl4/L7's `NOT_PENDING` for an
uninitialized lane node). When they merge, the allow-list entries for them
go.

### 4.2 Results (S0, 2026-10-28)

Counts are the shadow's: reads compared / passes seated / mismatch
classes / instances. Every mismatch is bucketed in §6 (table fixes,
applied) or §7 (two readings, awaiting a ruling); no class was found where
the new slot is right and today wrong by a rule, so no issue was filed.

| run                                                 |      reads |     passes | classes | instances |
| --------------------------------------------------- | ---------: | ---------: | ------: | --------: |
| signals suite (375 files, green)                    |    965,402 |    238,364 |      40 |       137 |
| visibility oracle (posture / oracle / store)        |     11,379 |      8,322 |       0 |         0 |
| solid suite                                         |      2,389 |      1,546 |       0 |         0 |
| web suite (the 27 `.spec.ts` files that load here¹) |    254,902 |    155,740 |      25 |        74 |
| generator 2,000 × {3289, 91501, 7}, every pair      |  6,969,627 |  5,153,328 |     143 |     4,127 |
| generator 50,000 × {3289, 91501, 7}, every pair²    | 67,328,944 | 43,755,988 |     133 |     8,821 |

¹ The worktree has no `@solidjs/compiler` binary, so the 153 `.spec.tsx`
files fail to load on `next` too; CI runs them.
² All three seeds abort on `next` before 50,000 cases with `Potential
Infinite Loop Detected. Kept alive by scheduled work` (seed 7 inside the
first 2,000; 3289 at ~427 s, 91501 at ~638 s), identically on the plain
build without the shadow — a generator finding on `next`, not a shadow
finding, reported in the PR and not minimized here. Seeds 3289 and 91501
also report one `equivalence/E7` signature each on both builds.

The 50k run added two table rows to §6 (L4/L2/V1' staged error, V3 under
published inputs) and no new two-readings item; by bucket (2k → 50k):
F-ahead-posture 1,461 → 2,922; F-vlane 1,054 → 2,431; F-vworld 1,101 →
2,308; F-transitive 301 → 684; B2 display-ahead residue 104 → 257; F-mount
97 → 180.

## 5. Swap plan

Three to five PRs, serial, each in its own worktree (brief §4 item 4):

| PR                   | Content                                                                                                                                                                                                                                                                                                         | Gate                                                                                                                                                                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S0 (this branch)** | Seat + slot under `__TEST__`, shadow wired, `INV-seat`, differential report, issues filed                                                                                                                                                                                                                       | Differential zero on the suites and 2,000/seed; 50k/seed reported; dist byte-identical (§5.1); CodSpeed flat                                                                                                                                                                  |
| **S1 — live**        | `slot()` becomes `read`'s decision; `openSeat`/`closeSeat` replace the `recompute` head/finally seating; the §1.1 deciders deleted; `stageError`, `flip`, `arm`, `propagateStatus` read `seatLane`; store shims (`joinPassTx`, `stagedScreen`, `stagedRead`, `joinPassAt`) kept as thin functions over the seat | Signals/solid/web suites green; generator 50k/seed × 3 clean (no shadow now — compare recorded `ASYNC_GEN_RECORD` outputs from S0 via `ASYNC_GEN_DIFF`); floor scenario and compiled hello world ≤ `next` post-P0 (`scripts/size gate.mjs`, `check-floor-caps.mjs`); CodSpeed |
| **S2 — lanes split** | `lanes-core.ts` / `lanes.ts` split; `isPending`-only scenario added to `scripts/size`; saving measured                                                                                                                                                                                                          | Same suites; the isPending-only scenario must not retain `lanes.ts` (attribute.mjs); floor/hello world ≤ S1                                                                                                                                                                   |
| **S3 — cleanup**     | Free `REACTIVE_JOINED`, `STAGED_READ`, `LANE_READ`, `PROBED`; `FRAME_READ`+`SCREEN_READ` → STALE; drop `setVerdict` dispatch, `laneRoot`, `passLane`; update `NODE-SHAPE.md`, `INTERNALS-ASYNC-STATE.md`                                                                                                        | Same suites; size ≤ S2                                                                                                                                                                                                                                                        |
| **S4 (optional)**    | Store shims replaced once the store twins (brief §6) are addressed                                                                                                                                                                                                                                              | Deferred; not part of this plan's exit                                                                                                                                                                                                                                        |

Exit for stable is the brief's §5: the 50k differential clean on all three
seeds after S3, then one week of generator CI on `next` with no new async
issue.

### 5.1 Byte-identity check for S0

```
pnpm build                          # default: __TEST__ false
cd scripts/size && npm ci && node size.mjs --json /tmp/seat-head.json
SIZE_PACKAGES_ROOT=<next checkout> node size.mjs --json /tmp/seat-base.json
node gate.mjs /tmp/seat-head.json /tmp/seat-base.json
```

plus a direct `diff -r` of `packages/signals/dist` between the two
checkouts. The PR body carries both.

## 6. Findings — rows against rules

Format: row id · the rule · what the rule requires · what today does ·
which side the shadow sides with · table fix. Table fixes below are
applied in `seat.ts`; the brief's table (`reader-seat-brief.md` §4) is the
maintainer's and is not edited here. No row was found where the NEW slot
is right and today is wrong by a rule — every slot disagreement traced to
a table gap or to a two-readings item (§7); no issue was filed.

- **U4 · D-41** — the table threw `_shownError` (a write or retry
  replacing a shown error, #4110) only for signals; today throws it for a
  memo's untracked read too, and F-9's NR (no value yet) wins over it.
  Today is right ("the error stays the display"). Fix: U rows ordered
  f0 → NR, errored/`_shownError` → E, born staged → NR, else C.
- **Vl1 · #3460 (A15 lanes corollary)** — the table served the proposal
  (P) to every `latest()` reader of a held node; today a render effect
  outside the hold's own flush while its verdict lane is blocked is a
  stale reader (C, re-derived at the reveal) — L7's shape for a lane.
  Today is right. Fix: row `Vl1'`.
- **Vl1 / Vl4 · D-41** — `latest()` of a staged error throws it
  (`staged()`); the table said P. `isPending()` never throws (it reads the
  screen); the table's "errored → E" for Vp rows holds only where today
  falls through every arm — the error is thrown last, as `verdictValue`
  does. Fix applied.
- **L6 / D4 (lane's own flight) · D-37** — lane work reading a lane
  derivation in flight: the table said C once the reader had a value;
  today throws NR regardless (`read` sets `committed` only for
  non-OVERRIDE nodes). Today is right: the lane's own flight is the lane's
  wait. Fix applied.
- **L7' · D-2** — a leaf held by the flush's transaction reading a lane
  derivation's staging: today serves the staging (the hold's own value);
  the table had no row. Fix: row `L7'`.
- **V6 · D-25 / #4050** — a verdict pass's derivation is stored today as a
  _verdict lane's_ value (`CONFIG_OVERRIDE`, lane rows); the brief has no
  lane for verdicts, so at the swap it is a plain memo. Row `V6` added:
  Lv ≡ Dv, NR in flight, P for a leaf the flush's hold holds. The seat
  memory this relies on today is §7 F-vlane.
- **B2 leaf clause · D-27 / #4166** — the brief's born-held test (`world
= H`, or `ahead && world ≥ Fl`) can never hold for a leaf, whose world
  never rises (INV-seat-1); today a render effect a verdict-lane mount's
  content creates, reading a staging of the flush, is born held
  (`verdict-mount-render-effect-4166`). Today is right. Fix: a leaf under
  a display-ahead mount that read a staging (`L1`, mark SR) is born held;
  a leaf that read the hold's own staging or a born node (`L2`/`L4`, mark
  HOLD) is born held without its world moving.
- **B2 nested-derivation exclusion · #4203 / #4340 / #3851** — today the
  exclusion ("a nested derivation left pending is not born held") applies
  only when the creator itself is in no lane (`prevLane`, which includes a
  verdict lane). Read with "verdict lanes are not lanes" it would apply to
  a verdict reader's direct mount and break #3851. Fix: the exclusion is
  for a mount whose creator is merely _under_ a display-ahead mount, not
  itself display-ahead (`creatorDirect`).
- **D1 / L1 · F-9** — a node staged, uninitialized **and** in flight
  (`s u f`: a lane landing promoted `INPUTS_PUBLISHED` beneath a new
  flight) has nothing to show: NR, not the staging. Fix: the pending rows
  win over the staged rows whenever the node is in flight.
- **D2 (held, nothing staged) · D-2** — a held node with no staging
  (`h`, pending when its flush parked) read by a derivation: today C with
  the join (H); the table's D2 said P. Fix: `staged ? P : C`, raise H
  either way.
- **L4 / L2 / V1' · D-41** (50k only) — a leaf, or a frame reader born
  into the hold, reading a held node whose staging is an error
  (`stageError`): today `stagedRead` throws it; the table's L rows said P.
  Same rule as the Vl1/Vl4 finding, on the plain-read rows. Fix: the
  staged slot is `stagedError ? E : P` on every row that serves a
  staging.
- **V3 · F-9** (50k only) — a verdict reader's plain read of a node
  staged **and** in flight with `INPUTS_PUBLISHED` (`s f ip`): the table's
  V3 served the staging; today the flight decides (`V4'`, NR — #3305, the
  committed value would tear against the published inputs). The D1/L1
  finding above, on the V rows. Fix: the V2/V3 arm yields to the flight
  rows when the node is in flight with published inputs.

## 7. Blocked / two readings

Recorded as they arise, with both readings and the screen each produces.
Nothing is ruled here. Each names the mismatch class it leaves in the
differential (PR body table) so the swap can be gated on a ruling.

- **F-vlane — verdict lanes as node sets.** Today a pass that probed
  stages into the hold's _verdict lane_ (`CONFIG_OVERRIDE` node whose
  `_x._transaction` is the verdict lane), and its next pass is seated as
  the verdict lane's by that membership (`recompute`'s head) — even a
  pending re-pass whose `CONFIG_VERDICT` the head cleared (#3884), and a
  boundary output a display-ahead re-arm swapped (`fallback`'s `b._lane`,
  #3540/#4337). The brief: "verdicts have NO node set; verdict passes are
  seated by POSTURE", plus D-25's probe restart. Reading A (today): the
  seat persists through membership — a re-pass reads held nodes as a
  stale reader (C) before it probes again; the swap keeps showing the
  fallback beside the held frame. Reading B (brief, letter): the re-pass
  is D/L until it probes; a held node read before the probe is P (joins)
  — the #3540 swap would follow the write's frame. The shadow models A:
  the seat opens `probed` when its own node sits in a verdict lane, the
  swap marks `AH`; the slot residue is the `V6`/`V4'`/`L2 (oldVlane)`
  classes. Needs a ruling on how posture persists across passes without a
  node set (sticky `CONFIG_VERDICT` until a pass completes without
  probing? the swap marking the output `CONFIG_VERDICT`?).
- **F-leaf — a leaf's children.** INV-seat-1 keeps a leaf at world S;
  the brief inherits `{world, lane, ahead}` from the running creator.
  Today a render effect that read a born node (`L4`: `joinPass`) or the
  hold's own staging is JOINED, and a memo it creates is born held
  through `creatorPass(oldcontext)._flags & JOINED` (A29: "a held pass's
  children are the transaction's"). Reading A (today): the memo is born
  held — its value commits with the hold; a verdict reader of it sees
  P/NR. Reading B (brief): the memo publishes directly (world S) and
  re-derives if the flush parks. Shapes: `lane-uninitialized-landing-3648`
  (router query memo under a lazy outlet's render effect),
  `boundary-output-frame-reader`, `loading-fallback-in-flush-3540`,
  `fuzz-findings-l2`. Classes: `B1 inherited world (old creator JOINED,
new < H)`, `B2 born held (old true, new false; world 0 …)`.
- **F-mount — who is the creator.** The brief: the running creator pass
  is `context` while it recomputes, never the owner. Today's display-ahead
  mount (`laneRoot`/`mount`) is module state — any pass running when the
  node is created, a `runWithOwner(otherOwner)` creation included
  (`fallback`'s `b._fb` memo is created under `out._parent`) — while
  today's world inheritance uses `creatorPass(context)` (the owner's
  computed), so a `runWithOwner` into a finished pass's owner inherits
  that pass's _last_ JOINED flag (it survives until the next pass's wipe).
  Reading A: creator = the running pass (seat stack top). Reading B:
  creator = `creatorPass(context)`. The shadow uses B, searching the seat
  stack for it. Classes: `B1 ahead (old true, new false; creator running
false)`.
- **F-ahead-posture — ahead by posture without a lane.** The brief: ahead
  = creator display-ahead (verdict posture or in a lane). Today `mount`
  comes only from `passLane`/`laneRoot`, so a mount made by a verdict
  reader that has not routed into a verdict lane (a boundary output
  carrying `CONFIG_VERDICT` from an earlier pass, F-6's memo over a
  verdict) is not "ahead" today. Classes: `B1 ahead (old false, new true;
creator running true, creator memo:value|children|effect)` — ×29 in
  web, ×1,276 in the generator at 2k/seed; downstream B2 differences are
  rare (`world 0, ahead true … rows L1,L1`).
- **F-vworld — do verdict reads move the world?** The table gives the
  verdict rows marks (`AH`, `W`, `ST`) and no raise, except `Vp2`/`V1'`;
  today a verdict read of a staged or held node also sets
  `REACTIVE_STAGED_READ`/`JOINED` on the reader (`route`,
  `provisionalVerdict`, `observeFlight`, F-6's flag copy), which feeds the
  old born-held test for mounts under it. D-1 says the world only
  raises; D-23/A10 say a verdict reader reads the screen. Classes: every
  `world after the read (old 1|2, new 0; Vl|Vp|V posture)` with equal
  slots, plus `D5 (E, old 2)` — today joins the hold before throwing a
  held node's error.
- **F-transitive — how far does the world inherit?** The brief inherits
  the world from the running creator, which inherited its own:
  transitive. Today's born-held arm checks one level
  (`creatorPass(oldcontext)` JOINED); `markVerdictReader`'s `born` walk is
  the only transitive one. Shape: mapArray row roots under a joined pass
  (`store/optimistic-maparray-index-frame-f1`,
  `lazy-memo-rebuilt-reader-4142`). Reading A (today): a grandchild of a
  joined pass that read only committed values publishes directly. Reading
  B (brief; A29 read transitively): born held. Classes: `B2 born held
(old false, new true; world 2, ahead false, mount false … rows
∅|L0|D0|L1)`.
