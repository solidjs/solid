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
applied), §7 (two readings, awaiting a ruling) or the untraced residue
below; no class was found where the new slot is right and today wrong by
a rule, so no issue was filed.

| run                                                                         |      reads |     passes | classes | instances |
| --------------------------------------------------------------------------- | ---------: | ---------: | ------: | --------: |
| signals suite (376 files, green; table as committed)                        |    965,386 |    238,343 |      40 |       151 |
| visibility oracle (posture / oracle / store)                                |     11,379 |      8,322 |       0 |         0 |
| solid suite                                                                 |      2,389 |      1,546 |       0 |         0 |
| web suite (the 27 `.spec.ts` files that load here¹)                         |    254,902 |    155,740 |      25 |        74 |
| generator 2,000 × {3289, 91501, 7}, every pair                              |  6,969,627 |  5,153,328 |     143 |     4,127 |
| generator 50,000 × {3289, 91501, 7}, every pair² — before the two 50k fixes | 67,328,944 | 43,755,988 |     220 |     8,821 |
| generator 50,000 × {3289, 91501, 7}, every pair² — table as committed       | 67,328,944 | 43,755,988 |     209 |     8,706 |

¹ The worktree has no `@solidjs/compiler` binary, so the 153 `.spec.tsx`
files fail to load on `next` too; CI runs them.
² All three seeds abort on `next` before 50,000 cases with `Potential
Infinite Loop Detected. Kept alive by scheduled work`, and at the same
case on a dist built without `SIGNALS_TEST_DEFINE` (no shadow): seed 7 at
case 1158 (the E8 `remount` run; `last staged node: computed`), 3289 at
case 3963 (the base run; `value`), 91501 at case 5807 (the E8 `remount`
run; `signal`) — a generator finding on `next`, not a shadow finding,
reported in the PR and not minimized here. (The campaign does not print
the index; a throwaway replay of its survey loop did.) Seeds 3289 and
91501 also report one `equivalence/E7` signature each on both builds.

The 50k run added two table rows to §6 (L4/L2/V1' staged error, V3 under
published inputs) and no new two-readings item. Re-run with the table as
committed, the three seeds lose exactly the 11 classes / 115 instances
those two fixes cover and gain none (reads and passes are identical). By
bucket (2k → 50k, the previous triage's reading): F-ahead-posture 1,461 →
2,922; F-vlane 1,054 → 2,431; F-vworld 1,101 → 2,308; F-transitive 301 →
684; B2 display-ahead residue 104 → 257; F-mount 97 → 180.

Read literally against the class signatures §7 names, 623 instances / 43
classes of the 50k (unchanged by the two fixes) match no §6 finding or §7
item. They are listed with counts under the PR body's residue row and
left **untraced** here: `B1 ahead (old true, new false; creator running
true)` ×406 / 4 classes; `D5` E vs NR for an errored node in flight
(`u f` · `f ip` · `u f ip` · one `f d vlane`; D and V postures; 4 under
`oldVlane`) ×101 / 17; `L8` E vs NR, the same shape at a leaf ×34 / 6; `V1` C vs P (`s h`,
`oldNoLane`) ×57 / 2; `V4` C vs NR (`f ip`; 8 under `oldVlane`, 4 not)
×12 / 5; `V1''` P vs E (`s h u ip` — the D-41 staged-error shape on a row
the §6 fix did not touch) ×2 / 2; `V1'` P vs C ×2 / 2 and `Vl1` P vs C
×1 / 1 (`s h`, `oldNoLane`, world 2 / 0); world after the read old 2 →
new 1 with equal slots (`Vl1` / `Vp1` / `Vl5`) ×7 / 3; `B2 born held (old
true, new false; world 1, no mount, rows L8)` ×1 / 1.

### 4.3 Results (S1 M1 re-baseline, 2026-10-29)

The shadow merged onto `next` @ 5e68925cc (after #4401, #4397, #4383,
#4393, #4406, #4412, #4419), the §6.1 table fixes applied, and every
remaining class traced. "Known" are the filed `next` bugs the shadow
carries by name (`shadowKnown`: #4426, #4427, #4428, #4429); the
generator runs also diff every screen against a recording of the same
cases on a plain `next` build (`ASYNC_GEN_DIFF`, zero differences).

| run                                                     |     reads |    passes | classes | known                          |
| ------------------------------------------------------- | --------: | --------: | ------: | ------------------------------ |
| signals suite (393 files, green)                        |   965,383 |   242,322 |       0 | —                              |
| visibility oracle (posture / oracle / store)            |    11,379 |     8,322 |       0 | —                              |
| solid suite (54 files, green)                           |     2,388 |     1,546 |       0 | —                              |
| web suite (194 files incl. compiled `.spec.tsx`, green) |    99,152 |    80,488 |       0 | #4426 ×1, #4427 ×1             |
| generator 2,000 × seed 7, every pair                    |   856,775 |   856,072 |       0 | #4428 ×11, #4429 ×1            |
| generator 2,000 × seed 3289, every pair                 | 1,066,134 |   965,603 |       0 | #4428 ×11, #4426 ×10, #4427 ×7 |
| generator 2,000 × seed 91501, every pair                | 8,800,109 | 5,351,433 |       0 | #4428 ×9                       |

Bytes: `pnpm build` (default `__TEST__` false) measured by `scripts/size`
against `next` @ 5e68925cc built the same way — every scenario identical
in brotli and minified bytes (`+ isPending/latest` 11,026 B brotli /
30,408 B minified on both; rc.19 10.38 KB, L2 9.44 KB — the growth is
#4393/#4397/#4383's, ledgered by #4412). `packages/signals/dist/prod` and
`observe` differ from the base only in statement braces and import order
left where `__TEST__` blocks were removed (the minifier erases both).

## 5. Swap plan

**Status 2026-10-29: stopped.** S1 was built through M5 on `seat/s1-swap`
(#4430) and is not landing; §8 has the measurements and the decision. S0
plus the M1 re-baseline — the table, the shadow, `INV-seat` — land alone
as a CI spec (the "spec PR", #4438). S2–S4 below do not proceed as planned; the
next step is a decision in §8.6, not a PR.

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

### 6.1 S1 M1 re-baseline (2026-10-29) — the 43 untraced classes and the six rulings, traced

The S0 residue (§4.2, 623 instances / 43 classes at 50k) and the classes
the six S0 PRs (#4401, #4397, #4383, #4393, #4406, #4412) added were each
traced to a mechanism. Every one is a table gap, a ruling now applied, or a
bug on `next` (two, filed — the first of the second kind). The table fixes:

- **V1'' · D-41** — a verdict reader born into the hold reading a held node
  whose staging is an error: `stagedSlot` (E), as the L4/L2/V1' fix. The
  owed S0 row.
- **The three "today" rows (F-vlane, F-leaf, F-ahead-posture)** — modelled
  as ruled: the verdict seat is the hold the pass's own node's verdict
  lane names (`vhold`, resolved), persisting by posture; a leaf that read
  a born node or the hold's own staging is in the hold's world
  (INV-seat-1 amended, L2/L4 raise H); `ahead` comes from a lane seat or a
  verdict seat, never from a verdict posture alone.
- **F-mount (reading A) and F-transitive, as implemented** — the creator
  is the running pass (seat stack top) for ahead-ness, lane (when the
  owner's pass is running — a `runWithOwner` into an owner not running,
  `fallback`'s `b._fb`, is not lane work by birth: "the swap is structure")
  and the one-level world; the branch's world for the #4341 window rule
  (`creatorsWorld`, today `creatorReads`) is the owner chain's running
  passes — a lazy memo another owner made, first pulled inside a pass
  that read a staging, is not that pass's branch (web `e1-3289-1831`,
  `latestDerive`: ×13 world / ×12 verdict-seat classes before the fix).
  World inheritance for born-held stays one level — the running pass's
  own reads (`creatorWorld = p.ownWorld`). The two alternatives were each
  run through the suites: transitive (`p.world`) — 14 born-held and 29
  inherited-world differences (`optimistic-maparray-index-frame-f1` ×13,
  `match-born-latest-4341` ×10, `loading-fallback-in-flush-3540` ×5,
  `lazy-memo-rebuilt-reader-4142` ×2); born-into-the-hold counts as the
  hold's world (`bornTx` → H, A29's letter) — 7 (`3540` ×5, `4142` ×2).
  One level leaves only the `fallback` shape below (#4428). §7
  F-transitive is reopened on it.
- **F-vworld, as implemented** — verdict reads leave marks and do not
  raise; the `D5` exception (join before re-throwing a held node's error)
  is kept; the `D5`/`L8` E-vs-NR residue traced to the `_shownError`
  screen slot (`screen`: an errored node's `_shownError` is thrown where
  `read` serves `throwShown` — `committed || !c`, the CONFIG_VERDICT
  `stagedScreen` arm — else the row's slot) and the D-41 retry
  (`tracked && el._time < clock` recomputes and re-reads: the outer read
  is `SLOT_SNAPSHOT`, the nested one compares).
- **`seam` / `seamFlight` (Vl/Vp rows) · D-22, D-25** — `provisionalVerdict`
  (a staging not held: `AH` once the flush has a hold, `W` before) and
  `pendingVerdict` (a flight: `latest` opens the flush's transaction for
  it — `AH`; `isPending` watches the seam — `W`) are marks of the window
  rows; `latest()` of a flight with `joinFuture(null)` names the hold the
  read left behind (`shadowLeave` fills the transaction at leave time).
- **`laneNP` / `dispNP` · #4362, #4363** — a lane node with nothing in
  either view (born in the lane, nothing produced) falls through the lane
  rows to the plain rows (`laneValueOf`/`display` return `NOT_PENDING`); a
  render leaf over it is NR, not the committed value (#4338).
- **Lane rows for a boundary's structure · A15, #4283** — the D-28 leaf
  treatment of a lane (L6/L7: a stale reader of the lane, re-derived at
  the reveal) is a render effect's; a boundary's output and tree
  (`CONFIG_FRAME`, posture L on the plain rows per #4283) read a lane as a
  derivation does — they enter. The table had every posture-L reader take
  the leaf rows. Checked by flipping `laneRead` to the table's reading: a
  fallback-showing `<Loading>` whose `on` is `latest(b)` then holds
  `latest(b)` (`lane-hold-on-observation` "a fallback-showing boundary
  around the memo does not hold latest(b)"), and a boundary's content
  serves a flight committed beneath its inputs — the tear A15's reveal
  corollary forbids for every reader kind (`l2-fuzz-existing-rules`, seed
  3289 #922). Today is right. Fix: `renderLeaf` is `_type === EFFECT_RENDER`.
- **The swap is structure · #3540, #4337** — `fallback`'s `read(b._fb)` is
  bracketed: what the fallback's build reads ahead (a verdict, a lane) is
  the fallback's display-ahead, not the output's; the output's seat is
  saved before and restored after (today `passLane` and the
  PROBED/LANE_READ flags). Shadow: `shadowSeatSave`/`shadowSeatRestore`.
- **D8 · F-2, D-37** — lane work with a value reading a flight that is not
  the lane's own reads the screen — when the node has one; a first load
  in flight (`u f`) is NR for every reader. The table's D8 had no
  `!uninit`.
- **Vl4' · D-22, #3376** — `latest()` of a node staged **and** in flight
  (`s f`, initialized): the staging is newer than the screen, so `latest`
  shows the proposal (`staged(el)`), the verdict is the flight's
  (`pendingVerdict`); outside a flush the committed value (A28, as Vl3).
  The table's Vl4 served C whenever the node was in flight. `isPending`
  reads the screen (Vp1) either way. Generator seed 3289 #310.
- **`_marked` (affects) · affects.ts** — a live `affects()` mark on the
  node or a dependency makes an `isPending` reader the flush's verdict
  reader (`AH`) when the flush has a hold; a mark of the window rows.
- **A-as-V · F-6** — an authoritative reader (`until`/refresh waiter) that
  also carries `CONFIG_VERDICT` (F-6's flag copy) reads a hold's node as a
  verdict reader (`frameRead`); `truthRead` is for lane nodes only.
- **`RAISE_VSEAT` links a lane seat · `enterLane`** — a pass in a lane
  that reads a verdict lane's node is seated as the hold's verdict reader
  (today `passLane` becomes the verdict lane; the lanes link).

**Bugs on `next` (filed; the swap fixes them by construction, the shadow
carries them as `shadowKnown` entries):**

- **#4426 · V1' P vs C** — a verdict reader born into hold `T`
  (`CONFIG_HELD_FRAME`, uninitialized), run by a flush whose transaction
  is not `T`, reading a node `T` holds: `frameRead`'s `bornInto(c, T)`
  joins the pass, then `stagedScreen`'s `bornInto(c, flushTransaction)`
  serves the screen the same read ruled it not to have (A29, #4010).
  Generator seed 3289 #911; one instance in the 1,500-case gate.
- **#4427 · V6 Lv vs P** — `laneRead`'s D-28 reset compares verdict lanes
  by identity: a derivation in `A._verdict` after `A` merged into the seat's
  hold `B` reads as another hold's lane; the leaf leaves its own verdict
  seat and is served the staging (L7'). D-28/#4284 is about another
  hold's lane; #3905-adjacent. Generator seed 3289 #43; one instance.
- **#4428 · B2 born held (old true, new false)** — `fallback`'s `b._fb`,
  created by `runWithOwner(out._parent, …)` while the output's pass runs:
  the born-held test asks `creatorPass(oldcontext)` — one level up the
  _owner_ chain, the enclosing pass, running and JOINED — where the pass
  actually running (the output) read nothing held. Today is a third
  reading of F-transitive (neither one-level-running-creator nor
  transitive); the entry is carried under the one-level reading pending
  §7's ruling. Generator seeds 7 #82 / 3289 #374 / 91501 #37 (+ 7 #138,
  3289 #1647, 91501 #166 with the fallback reading a staging); 31
  instances at 2k × 3; no suite shape; no screen difference.
- **#4429 · Vl4 P/P, world old 2 new 0** — `isPending`'s `probing` flag is
  left set around a memo's pass the probe pulled (`verdictValue` resets
  only the dispatch, A31): a `latest()` of a born-into-the-future node
  inside that pass takes the probe's `joinPass` arm and the pulled pass
  joins the hold; `probeFound` leaks the same way. F-vworld: a verdict
  read raises no world. Generator seed 7 #1691; one instance; no screen
  difference.

**Expected, not classes:** `B1 inherited world (old creator JOINED, new 0)`
for a `runWithOwner` into an owner that is not the running pass (`<For>`'s
lazy `mapArray` under the component's owner) is the F-mount reading-A
difference by definition; the shadow compares the owner's flag only when
the owner is the running pass, and the born-held decision at the close
still compares for every pass (zero classes besides #4428 above).

## 7. Blocked / two readings

Recorded as they arise, with both readings and the screen each produces.
All six are closed as of 2026-10-28: three ruled by the maintainer
(today's behaviour — the rules as they stand — over the brief's reading:
F-vlane, F-leaf, F-ahead-posture) and three left to the agent as
implementation choices with no screen change in the differential (F-mount,
F-vworld, F-transitive); each item ends with its ruling or choice. Each
still names the mismatch class it leaves in the differential (PR body
table) so the residue can be read against it.

- **F-vlane — verdict lanes as node sets.** Today a pass that probed
  stages into the hold's _verdict lane_ (`CONFIG_OVERRIDE` node whose
  `_x._transaction` is the verdict lane), and its next pass is seated as
  the verdict lane's by that membership (`recompute`'s head) — a
  boundary output a display-ahead re-arm swapped (`fallback`'s `b._lane`,
  #3540/#4337). The #3884 pending re-pass is not among these: in
  `tests/superseded-transition-verdicts-3884.test.ts` the parked memo
  never enters a verdict lane (its probe follows a staged plain read, so
  `route` refuses — `verdict.ts` `JOINED|STAGED_READ`) and what the pin
  exercises is `core.ts`'s `CONFIG_VERDICT` head-clear; that case is the
  hold's own work under D-25's existing clause, not a persisted posture.
  The brief: "verdicts have NO node set; verdict passes are
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
  **Ruled 2026-10-28 (maintainer):** reading A — today's behaviour. The
  rule is the posture, not the membership: a pass that asked is the hold's
  verdict reader on every re-run until it completes a pass that asked
  nothing, so a `Loading` fallback that went up beside the held frame
  stays up beside it until the landing rather than travelling with the
  write's frame (#3540, #4337; `tests/loading-on-latest-fallback-4337.test.ts`,
  `tests/loading-on-rearm-3540.test.ts`,
  `tests/loading-on-frame-following-3540.test.ts` §4–5), and today's
  verdict-lane membership is only the mechanism that happens to carry it.
  Written in D-25 as "A verdict posture outlives the pass that asked
  (ruled 2026-10-28)". The general persistence claim (a probing memo's
  later non-probing run reads a held node as the screen) rests on
  `core.ts` — `CONFIG_VERDICT` set at the pass tail from the probe, cleared
  only after a pass that did not probe, read by the next pass's frame
  read — and has no dedicated pin yet; S1 adds one.
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
  **Ruled 2026-10-28 (maintainer):** reading A — today's behaviour. Now
  D-27 "A joined pass's children are the hold's" (promoted from A29
  ruling A, with a dated note under A29): a pass — a render effect
  included — that read a node with no screen to fall back to joins the
  hold, and a node it creates during that pass is born held; its value
  commits with the frame and a mainline reader of it waits. Consequence
  for §3.3: INV-seat-1 ("a leaf never raises its world") must admit the
  born-node read — a leaf that read one is in the hold's world and its
  children inherit it; a leaf that read only committed values still
  raises nothing.
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
  **Choice 2026-10-28 (agent, no screen change in the differential):**
  reading A — creator = the running pass (seat stack top), for both
  ahead-ness and world inheritance. The owner-based `creatorPass(context)`
  path and its stale-JOINED-flag hazard retire with the swap.
  (2026-10-29: the owner-vs-running-pass difference for world inheritance
  is one shape — `fallback`'s `b._fb`, #4428 — and whether its answer is
  A's or today's depends on F-transitive's ruling below.)
- **F-ahead-posture — ahead by posture without a lane.** The brief: ahead
  = creator display-ahead (verdict posture or in a lane). Today `mount`
  comes only from `passLane`/`laneRoot`, so a mount made by a verdict
  reader that has not routed into a verdict lane (a boundary output
  carrying `CONFIG_VERDICT` from an earlier pass, F-6's memo over a
  verdict) is not "ahead" today. Classes: `B1 ahead (old false, new true;
creator running true, creator memo:value|children|effect)` — ×29 in
  web, ×1,276 in the generator at 2k/seed; downstream B2 differences are
  rare (`world 0, ahead true … rows L1,L1`).
  **Ruled 2026-10-28 (maintainer):** today; no rule change. D-27 as
  clarified 2026-10-28 already rules it: a mount gated by a display-ahead
  read is a mainline mount, its plain reads are the screen's, and it is
  not "ahead" by its creator's verdict posture — only lane work's children
  live in the lane. The seat's ahead bit comes from a lane, never from a
  verdict posture alone; the brief's "verdict posture or in a lane" is
  the brief's reading, not the rule.
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
  **Choice 2026-10-28 (agent, no screen change in the differential):**
  verdict reads leave marks (`AH`/`W`/`ST`) and do not raise the reader's
  world. Today's one exception — the join before re-throwing a held
  node's error (`D5`) — is kept until the `D5` residue (an errored node in
  flight, 101 instances at 50k, §4.2) is traced.
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
  **Choice 2026-10-28 (agent, no screen change in the differential):**
  whichever the seat stack makes simpler, with the shadow continuing to
  prove equal slots (301 instances at 2k, no slot difference found).
  **Reopened 2026-10-29 (S1 M1) — needs a ruling.** The condition of the
  choice ("equal slots") does not hold for either reading once the seat
  stack names the running creator (F-mount reading A); today is a third
  reading, and the two candidates each differ from it in a disjoint
  shape, both born-held differences (a first value staged vs published —
  behaviour, not a slot):
  - **Reading A' — one level, running creator** (`creatorWorld =
p.ownWorld`; D-27's letter, "a node it creates during that pass").
    Differs from today only under `runWithOwner` to a running ancestor
    that read the future while the running pass did not: `fallback`'s
    `b._fb` (#4428; 31 passes at 2k × 3 seeds, no suite shape). Today:
    born held (the ancestor's flag, one level up the _owner_ chain); A':
    publishes. Screens equal in every case.
  - **Reading B — transitive** (`creatorWorld = p.world`; A29 "a held
    pass's children are the hold's", #4341 "its branch exists only in that
    world"). Agrees with today on #4428; differs in 14 suite passes: a
    `mapArray` row root under a pass that inherited the hold's world
    without reading it (`optimistic-maparray-index-frame-f1` ×13) and a
    born-into render effect's child (`lazy-memo-rebuilt-reader-4142` ×1)
    — today they publish, B says born held — plus 29 inherited-world
    diagnostics (`match-born-latest-4341` ×10, `loading-fallback-in-flush-3540`
    ×5, …). Suites stay green either way (the shadow does not act), so
    whether B's born-held changes a screen is unmeasured.
  - **Reading C — born into the hold counts** (`bornTx` → H for the
    creator's children, A29's letter for a born-into pass): differs in 7
    suite passes (`3540` ×5, `4142` ×2 — a render effect born into the
    hold whose child reads only the screen; today publishes).
  - **Today** — one level up the owner chain of the creation context,
    running or not: `creatorPass(oldcontext)._flags & JOINED`. Not a rule
    anyone wrote; where the owner is not running it reads a stale flag.
    The shadow carries A' (today's letter minus the owner-vs-running-pass
    difference) with #4428 as its known class, so the differential reads
    zero; the swap (M3) must implement the ruling, and M3 is blocked on it
    only for this arm (`bornHeld`'s `creatorWorld`). Question for the
    maintainer: is a pass's child born held when the pass itself read
    nothing of the hold but exists only in it (B), or only when the pass
    read the hold (A')? If B, the 14 suite shapes are `next` bugs to file;
    if A', #4428 stands as filed.

## 8. S1 result and decision (2026-10-29)

S1 was built in full on `seat/s1-swap` (#4430, head 2cc81e3b4; base
`next` @ 5e68925cc with S0 merged on top): M2 made the table `read`'s
decision and turned the old deciders into the shadow's oracle; M3a/M3b
swapped the pass side (the seat as module state, born-held on F-transitive
B, `creatorReads`/`route` gone, D-2's re-derive in place for #4417); the
floor split and the two mandatory floor levers; M4 split `lanes.ts` into
`lanes-core.ts` and `lanes.ts` and tried the brief's deletion list; M5 ran
the gate. The suites are green and the shadow reads zero classes on every
suite. The gate **failed** on the 50k differential and on size, and the
swap is **stopped**. This section is the record; the numbers are the PR
body's, measured as §4.3 describes (`pnpm build` with `__TEST__` false,
`scripts/size` of the branch against each tree, each tree's own native
compiler). The brief's §4 ("the carve") is superseded by this section.

### 8.1 Size

Columns: base `next` @ 5e68925cc (rc.20), S1 head (8ae8829e8), rc.19
(d2323b077), L2 (1b9ceb679). brotli / minified bytes; "n/a" = the tree
cannot bundle the scenario (L2 predates `dynamicComponent`). Floors in
bold. Frames and the server scenarios are byte-identical to base.

| scenario                                    | base rc.20 br / min | S1 head br / min | rc.19 br / min |  L2 br / min  | head − base   |
| ------------------------------------------- | ------------------: | ---------------: | -------------: | :-----------: | ------------- |
| **signals: core floor**                     |        7415 / 19908 |     7709 / 20404 |   7422 / 20018 | 7315 / 20022  | +294 / +496   |
| signals: + createStore                      |       14875 / 43875 |    15252 / 44400 |  14876 / 43882 | 14517 / 44381 | +377 / +525   |
| signals: + isPending/latest                 |       11026 / 30408 |    12087 / 32582 |  10376 / 28809 | 9438 / 26678  | +1061 / +2174 |
| signals: + until/refresh                    |        8041 / 21719 |     8345 / 22220 |   8049 / 21823 | 7741 / 21258  | +304 / +501   |
| **app: render + one signal**                |        9769 / 26739 |    10087 / 27240 |   9776 / 26850 | 9801 / 27576  | +318 / +501   |
| app: hydrating                              |       18710 / 53567 |    19042 / 54194 |  18586 / 53368 | 17632 / 52417 | +332 / +627   |
| app: hydrating + every store primitive      |       32410 / 98589 |   33949 / 102582 |  30941 / 95094 | 28770 / 91505 | +1539 / +3993 |
| app: CSR with Show/For/Loading/Errored/lazy |       13423 / 37015 |    13746 / 37513 |  13358 / 36949 | 12807 / 36457 | +323 / +498   |
| app: CSR, observe tier                      |       15193 / 41969 |    15503 / 42471 |  15115 / 41899 | 14378 / 40981 | +310 / +502   |
| app: CSR, observe tier + attribution        |       29727 / 88303 |    30043 / 88803 |  29660 / 88239 | 28599 / 86287 | +316 / +500   |
| **app: compiled floor**                     |        9961 / 27271 |    10290 / 27772 |   9968 / 27382 | 9990 / 28107  | +329 / +501   |
| app: compiled CSR                           |       26257 / 79986 |    26633 / 80488 |  26162 / 79709 | 25069 / 78881 | +376 / +502   |
| app: compiled hydrating                     |      32463 / 100730 |   32891 / 101356 | 32231 / 100323 | 30886 / 99141 | +428 / +626   |
| frames: eager client consumer               |       11754 / 34886 |    11754 / 34886 |  11754 / 34886 | 12997 / 41048 | +0 / +0       |
| page: base server components                |      33658 / 101587 |   34032 / 102210 | 33501 / 101310 |      n/a      | +374 / +623   |
| page: live server components                |      38700 / 117125 |   39926 / 119464 | 37884 / 115166 |      n/a      | +1226 / +2339 |
| page: compiled base server components       |      35664 / 107956 |   36040 / 108582 | 35533 / 107686 |      n/a      | +376 / +626   |
| page: compiled live server components       |      42654 / 125267 |   44001 / 128194 | 41793 / 123161 |      n/a      | +1347 / +2927 |
| page: base + router                         |      41167 / 125417 |   41502 / 126035 | 40951 / 125144 |      n/a      | +335 / +618   |
| page: live + router                         |      48307 / 142529 |   49644 / 145411 | 47398 / 140419 |      n/a      | +1337 / +2882 |
| **server: floor**                           |         1275 / 3255 |      1275 / 3255 |    1275 / 3255 |  1331 / 3324  | +0 / +0       |
| **server: renderToString**                  |       22786 / 77473 |    22786 / 77473 |  22786 / 77473 | 20412 / 71813 | +0 / +0       |

After the two levers every non-server floor is ≈ +500 B minified / ≈ +300 B
brotli over base. Per module, core floor, minified (standalone-minified ×
chunk scale; the chunk totals are authoritative):

| module         |       base | before levers |  after (a) | after (b) = head                            | what remains                                                                                                                                                               |
| -------------- | ---------: | ------------: | ---------: | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| chunk total    | **19,908** |    **20,721** | **20,599** | **20,411** (20,404 after `reruns` deletion) | +503                                                                                                                                                                       |
| `seat.js`      |          0 |         1,116 |      1,113 | 1,104                                       | `plainRows` (direct side effects) 61 %, the seat state (`seatWorld`, `childBorn`, `bornInto`, `postureOf`, `unflushed`) 21 %, constants 11 %, `slot`'s engine dispatch 8 % |
| `core.js`      |      7,144 |         6,761 |      6,676 | 6,603                                       | the old deciders gone (−705); `readSlow`'s serve switch + the `SLOT_SNAPSHOT` arm + `claim` ≈ +165                                                                         |
| `scheduler.js` |      4,757 |         4,801 |      4,788 | 4,751                                       | `snapshotCaptureActive` moved here (−); hook declarations (+)                                                                                                              |
| `async.js`     |      3,561 |         3,577 |      3,567 | 3,537                                       | identifier drift                                                                                                                                                           |
| `owner.js`     |      1,273 |         1,278 |      1,275 | 1,264                                       | identifier drift                                                                                                                                                           |
| others         |      3,173 |         3,188 |      3,180 | 3,152                                       | identifier drift                                                                                                                                                           |

Lever (a): M3b's in-place re-derive arms run behind `verdictApplyHook`'s
installer (−122 floor, +106 on engine scenarios). Lever (b): `plainRows`
fires `joinPass` / `stagedRead` / `staleReader` / `markLateLinker` / `link`
itself and returns the slot alone; the engine rows stay packed behind
`applyMarksHook` (−188 floor; +211 `+ isPending/latest`, +110 live page).
`+ isPending/latest` is +2,174 B minified over base: the engine's rows
(`seatRows` ≈ 900, M3b's `adoptReaders` ≈ 650, the lane rows) net of the
M4 split's −1,661.

### 8.2 Deletions

Each candidate of the brief's list was cut on the head and judged by the
differential (signals suite + shadow; the subsumed set also by the full
battery and the 50k gate). Bytes are `+ isPending/latest` / live page /
floor, minified.

| candidate                                                   | verdict                 | evidence                                                                                                                                                                                                             | bytes                    |
| ----------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `laneServed` / `MARK_SERVED` / `laneServedHook`             | **deleted** (5ea7d894a) | base drops a served reader's pending source 24× in the signals suite; head 0× — the slot never leaves the source on the reader (the stale screen is served under `staleReader`'s mark)                               | −104 / −106 / 0          |
| `reruns`' `if (!u._lane)` carve-out (`REACTIVE_FRAME_READ`) | **deleted** (23160e65d) | the carve-out retained the mark 141× on head (49 no-ops); clearing unconditionally changes no result — the re-read re-raises it through MARK_ST while the flight is up (#4397's test green)                          | −7 / −7 / −7             |
| `heldBy` (`laneSeams`' `!blocked(t) \|\| heldBy(t, r)`)     | **kept — undecidable**  | its true arm fires 0× on base and 0× on head in the signals suite; the battery is identical with it cut. The differential cannot show the table subsumes code nothing exercises — dead since before S1, or unreached | would be −281 / −278 / 0 |
| `holdWork` / `REACTIVE_WINDOW` / `CONFIG_ASYNC`             | kept — not subsumed     | cut: 32 failures (`latest-two-readers-one-ask-4393`, `verdict-memo-flight-no-reask`, `latest-first-one-pass-4402`, …) — pass scheduling, not a read decision                                                         | —                        |
| `adoptParked`                                               | kept — not subsumed     | cut: 28 failures; it is M3b's #4417 answer on the pass side                                                                                                                                                          | —                        |
| `revealing`                                                 | kept — not subsumed     | cut: 7 failures                                                                                                                                                                                                      | —                        |
| `laneDirty` verdict render-effect arm                       | kept — not subsumed     | cut: 4 failures (`latest-memo-inline-parity`)                                                                                                                                                                        | —                        |
| `laneSeams` verdict-lane arm / plain arm                    | kept — not subsumed     | cut: 11 / 6 failures                                                                                                                                                                                                 | —                        |
| `stagedScreen`                                              | kept                    | store.ts still calls it (the store twins are S4)                                                                                                                                                                     | —                        |

The read-side deciders (M2: `read`'s slow block, `frameRead`,
`readerSeesCommitted`, `serve`, `throwShown`; `laneRead`, `enterLane`;
`verdictRead`, `watchVerdict`, `provisionalVerdict`'s read arm,
`pendingVerdict`, `observeFlight`, `staged`, `heldLatest`) and the pass-side
ones (M3a: the one-level born-held arm, `creatorReads`, `route`) were
replaced by rows and proven by the shadow at 0 classes on every suite. The
verdict-lane node set stays (F-vset ruled reading 2: the reveal record).

### 8.3 The 50k differential

Generator 50,000 × seeds 7 / 3289 / 91501, every pair, screens diffed
against a plain `next` recording (`ASYNC_GEN_DIFF`). 2k × 3 was clean at
every milestone; at 50k **25 cases differ** (9 / 10 / 6). Against the
recording every difference is a mid-hold screen; two of the cases also
break an equivalence pair `next` kept — one of them at the pair's final,
quiet screen. Replayed on base, M2, M3a, M3b and the head to attribute
each to a milestone:

| cases | shape                                                                                                                                                                                                                                                                                                                                                 | introduced at                           | status                                                                |
| ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------- |
|    20 | under a display-ahead `<Show when=latest(x)>` the lane work shows the committed value, or an inner `<Show when=x()>`'s fallback, where `next` showed the staged one (D-37's shape, 91501 #411; 7 #9846 #13595 #19106 #20324 #21348 #39486 #42058 #48845; 3289 #3598 #8992 #12559 #22669 #28591 #30977 #34631 #49646; 91501 #3494 #5871 #14705 #45722) | **M3b** (143d829bf, the #4417 adoption) | a class of 21 with #411 — listed for a ruling as a class, not assumed |
|     2 | `next` bugs the adoption closes: 3289 #464 (E9) and 91501 #8991 (E9: `latest()` through a memo showed `lm0:3` where the leaf showed an empty span)                                                                                                                                                                                                    | M3b / M3a                               | closed by S1; to be extracted on their own                            |
|     1 | **3289 #39609 (E8, remount)** — the reader born in the flush that applies the write ends with the inner `<Show when=m0()>` content missing from its **final, quiet** screen; the reader born before shows it                                                                                                                                          | **M3a** (b6ea9ceb1)                     | **regression** — S1 breaks a pair `next` kept; pinned `test.fails`    |
|     1 | **7 #45702 (E9, latestDerive)** — `latest()` through a memo shows the content frame at one settle where the leaf form shows nothing; finals agree                                                                                                                                                                                                     | **M3b** (143d829bf)                     | **regression** — pinned `test.fails`                                  |

M3a is the pass side: the seat as module state, born-held on F-transitive
reading B, `creatorReads` deleted, `route` folded. B was moved on 2k × 3
with "no screen moves"; #39609 is a final-screen move at 50k.

The shadow itself at 50k: **19 / 13 / 15 classes** (0 in every suite),
not traced to a milestone (a 50k shadow run per milestone is ≈ 95 min). Row
V6 (a reader of a verdict-lane node) in four variants — slot `V6→L0` /
`V6→D0` expected C got Lv, slot `V6` expected Lv got Dv, marks `LST` vs
`leave+LST` and `laneRead` vs `leave+laneRead` (the oracle fires a `leave`
the table does not); L4 expected P got C ×3; B2 born held ×7 (reading B's
known class). #4427's known filter catches 54 of the V6 family; these are
its unmatched variants.

### 8.4 Decision

The slot table does what it was built to do: it replaces the read and
seating deciders — `core.js` shrinks by ≈ 540 B minified on the core floor
(7,144 → 6,603) — and the shadow proves the replacement at 0 classes on
every suite. But the bytes that grew on `next` between rc.19 and rc.20 are
not the deciders'. They live in the seam / reveal / hold layer (the
overnight batch: `lanes.ts`'s seams, +1,330 B minified), which the table
does not touch, and which the 50k differential shows is load-bearing: the
D-37 class and #45702 came with M3b's adoption of the provisional readers
into the verdict lane (the reveal record), #39609 with M3a's pass side —
every screen that moved, moved where the seat meets that layer. So S1 is
**additive**: +294 B brotli on the core floor and +1,061 B on
`+ isPending/latest` over rc.20, further from rc.19 (10.38 KB) and L2
(9.44 KB) rather than closer. A rebuild that is bigger than what it
replaces, and that moves two final screens, is not the carve the brief
argued for. **The swap is stopped.** Nothing from M2 onward lands.

### 8.5 Method

- **2k generator cases are not evidence for a ruling.** F-transitive
  reading B was moved on 2k × 3 seeds with zero screen differences (§7);
  50k × 3 found a final-screen regression at that very milestone (3289
  #39609). Every S0/M1 statement of the form "no screen moves" rested on
  2k. Rulings — and the choices delegated to the agent on "no screen
  change" — require 50k × 3 seeds, with a `next` recording to diff against,
  before the decision is written down.
- **Size claims require measurement before design.** The brief's byte
  case for the carve was a module-split estimate; the first measured
  number (M2: floors +570 B minified) arrived after the read side was
  already swapped, and the levers that followed recovered 310 B of it.
  Any future proposal that cites bytes carries a `scripts/size` table
  measured on a scratch build of the proposal's shape, not an estimate.
- **Attribute before fixing.** Replaying the 25 cases on every milestone
  build is what separated one `next` bug, one class for ruling and two
  regressions; without it the inventory would have been "25 differences".
  The per-milestone shadow at 50k was not run (≈ 95 min each) and its 47
  classes stay untraced — the cost of a differential is paid in full or it
  is not a differential.

### 8.6 Salvage and the next decision

Landed or to be extracted on their own, each measured on its own:

- **This spec PR** (#4438) — S0 + M1 (`seat/spec`): the table as an executable
  spec under `__TEST__`, the shadow comparing every read and recompute
  against the deciders, `INV-seat`, the shadow report and summary script.
  Byte-identical in `dist` (§5.1 re-run on `next` @ 5e68925cc: 22 / 22
  scenarios equal in brotli and minified). It keeps the deciders honest
  from CI without changing them.
- **The #4417 fix** (M3b's D-2 re-derive in place / `adoptReaders`) and
  the **two `next` bugs** it closes (3289 #464, 91501 #8991) — extracted
  from the swap as their own change against today's deciders, with the
  50k pair check (the #45702 regression came with this change in S1 and
  must not come with the extraction).
- **The `lanes-core` / `lanes` split** (M4, 97ed6a00e: `+ isPending/latest`
  −1,661 B, live page −1,662 B) — measured in isolation on `next`, without
  the seat, before it is proposed.

Not salvaged: M2, M3a, the floor split and levers, the two deletions
(their justification was the table being live). `seat/s1-swap` stays as
the record; #4430 is closed.

The next decision is not a PR. It is whether to rebuild the seam / reveal /
hold layer — the place the bytes and the regressions both live — and it is
to be decided on these numbers (§8.1, §8.3) and a measured proposal (§8.5),
not started.
