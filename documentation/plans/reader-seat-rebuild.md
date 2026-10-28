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

| Today | File | Row(s) |
| --- | --- | --- |
| `recompute` head: `passLane`/`setPassLane`, `laneRoot`, `mount`, `creatorPass(context)?._flags & RECOMPUTING_DEPS` | `core.ts:325–366` | B1 (seat open) |
| `recompute` finally: `joined`, `el._config = … \| (flags & REACTIVE_PROBED)`, the kept flag set | `core.ts:595–628` | B2 (seat close) |
| `recompute` publish: born-held test `create ? !((flushTransaction \|\| passTx) && (joined \|\| creatorPass(oldcontext)?._flags & JOINED))`; pending first-pass hold `create && lane === null && joined && PENDING` | `core.ts:775–880` | B2 |
| `recompute` held re-pass arm (`CONFIG_HELD` → `joinPassTx`/`freshHook`/drop staging) | `core.ts:404–431` | L2/D2 for the pass's own node |
| `frameRead(c, el)` | `core.ts:1178` | L3, L4, V1, V4, D6 (ST side effect) |
| `bornInto(c, t)` | `core.ts:1219` | B1 "born into t" test used by V1/V4/L2 |
| `joinPass(c, el)`, `joinPassAt(c, t)` | `core.ts:1130–1160` | raise H side effect of D2/L2/L4 |
| `read`: fast-block `CONFIG_HELD` arm, `readerSeesCommitted`, `stagedScreen`, `stagedRead` calls; slow-path HELD arm, pending arm (`passLane !== null && !UNINIT → committed`), `committed → _value` | `core.ts:1835–2076` | U1, F1, L1–L4, D1–D2, D6–D7, V2–V3 |
| `serve(el, c)` and the duplicated hold arms | `core.ts:2088` | U1–U4, F1, L5, D3, D5 |
| `readerSeesCommitted`, `stagedScreen`, `stagedRead` | `core.ts` | F1, V2/V3, D1/D7 |
| `markVerdictReader`'s creator walk for `born` (`JOINED \| STAGED_READ`) | `verdict.ts:240` | B1 inheritance + the #4341 "V reads as D" narrowing |
| `route(c, t)`: seating a verdict pass via `setPassLane(verdictLane(t))`, `LANE_READ` | `verdict.ts` | posture V seats the pass; `t._verdict` stays the record |
| `observeFlight`, `provisionalVerdict` (incl. the `!probing → joinFuture(null)` arm #4393 removes), `verdictValue`'s OVERRIDE / HELD / staged / pending arms | `verdict.ts` | V1–V6, Vl1–Vl5, Vp1–Vp2 |
| `laneRead(c, el)`, `enterLane(l, c)`, `laneStage`'s `_parent._verdict === l` arms | `lanes.ts` | L6, L7, D4, D6–D8, V5 |
| `truthRead` arm selection | `truth.ts` | A1 |
| `stageError`'s `!passLane` + `STAGED_READ` test | `async.ts:188` | E staging when world ≥ Fl and the seat has neither lane nor V posture (D-41) |
| `flip`: `b._lane = b._armLane`; `arm`: `_armLane = passLane` | `boundaries.ts:210, 467` | `_armLane` is taken from the arming pass's `seatLane` |

Storage that goes with them: `REACTIVE_JOINED`, `REACTIVE_STAGED_READ`,
`REACTIVE_LANE_READ` (re-encoded as world rank + ahead); `FRAME_READ` and
`SCREEN_READ` become one STALE bit; `REACTIVE_PROBED` folds into
`CONFIG_VERDICT`. No new field on the node literal (`docs/NODE-SHAPE.md`).
Module state replaces them: `seatLane` (pointer), posture (byte), world
(byte), ahead (bit).

### 1.2 Kept

| Kept | Why |
| --- | --- |
| Transaction core: `Transaction`, `newTransaction`, `holdNode`, `list`, `unhold`, `holdFrame`, `blocked`, `blockersOf`, `merge`, `land`, `reruns`, `releaseQueues`, `txOf`, `resolveTx`, `liveTx`, `joinFuture`, `joinPassTx` | The hold relationship is not the question; who sits in it is. `joinPassTx` is the raise-H primitive the seat calls. |
| `async.ts` propagation: `notifyStatus`, `propagateStatus`, the lane-work `laneStageHook(sub, passLane, true, el)` call (rewired to `seatLane`) | Unchanged semantics; only the lane pointer it reads moves. |
| `boundaries.ts` except the two call sites above | Boundary flips and arming are consumers of the seat, not deciders. |
| `store/` — `stagingReader`, `readSource`, `familyAhead`, `nodeValue`, `serveDataKey`, `optimistic.ts` `foldedRead`/`fold`/`laneSet` | Out of scope (brief §6): they call `joinPassTx`, `stagedScreen`, `stagedRead`, `joinPassAt`. The swap keeps thin shims with those names over the seat until the store twins are addressed. RUL-1 (store mirrors signals' visibility matrix) is what makes the shims sufficient. |
| `lanes.ts` sub-hold core: `newLane`, `linkLanes`/`linkBlocked`/`unlink`, `verdictLane`, `supersede`/`dissolveLane`, `laneSeam`, `endLanes`, `lanesBlocked`/`nestedBlocked`, `laneOutcome`, `laneCorrections` | Lane lifecycle, not seating. Split out as `lanes-core.ts` (§2.2). |
| `lanes.ts` optimistic layer: guess values, `optimisticWrite`/`laneWrite`, `applyGuesses`, `fold`, `pendingGuesses`, `guessedValueOf`, `take`, `display`, `covered`, `inFlight`, `guessFlights` | Stays as `lanes.ts`; only its read arms (`laneRead`, `enterLane`) become rows. |
| `scheduler.ts` hook pattern (`laneStageHook` etc.) | The seat's display-ahead rows install through the same pattern. |

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

`shadowRead` then asserts (`assertInvariant`, which throws under `__TEST__`):

- `INV-seat-3 slot`: `expected.slot === actual` — slot **identity** (which
  storage), not value equality.
- `INV-seat-3 raise`: the predicted raise set matches the flag delta on `c`:
  raise H ⇔ `REACTIVE_JOINED` newly set; raise Fl ⇔ `REACTIVE_STAGED_READ`
  newly set; ST(t) ⇔ `REACTIVE_FRAME_READ` newly set (or `c` newly in
  `t._reruns`); raise lane ⇔ `REACTIVE_LANE_READ` newly set.

A failure message names `row`, the node (`el._name ?? id`), the reader,
the two slots, and the rule ids on the row. Reads that exit before a
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

## 5. Swap plan

Three to five PRs, serial, each in its own worktree (brief §4 item 4):

| PR | Content | Gate |
| --- | --- | --- |
| **S0 (this branch)** | Seat + slot under `__TEST__`, shadow wired, `INV-seat`, differential report, issues filed | Differential zero on the suites and 2,000/seed; 50k/seed reported; dist byte-identical (§5.1); CodSpeed flat |
| **S1 — live** | `slot()` becomes `read`'s decision; `openSeat`/`closeSeat` replace the `recompute` head/finally seating; the §1.1 deciders deleted; `stageError`, `flip`, `arm`, `propagateStatus` read `seatLane`; store shims (`joinPassTx`, `stagedScreen`, `stagedRead`, `joinPassAt`) kept as thin functions over the seat | Signals/solid/web suites green; generator 50k/seed × 3 clean (no shadow now — compare recorded `ASYNC_GEN_RECORD` outputs from S0 via `ASYNC_GEN_DIFF`); floor scenario and compiled hello world ≤ `next` post-P0 (`scripts/size gate.mjs`, `check-floor-caps.mjs`); CodSpeed |
| **S2 — lanes split** | `lanes-core.ts` / `lanes.ts` split; `isPending`-only scenario added to `scripts/size`; saving measured | Same suites; the isPending-only scenario must not retain `lanes.ts` (attribute.mjs); floor/hello world ≤ S1 |
| **S3 — cleanup** | Free `REACTIVE_JOINED`, `STAGED_READ`, `LANE_READ`, `PROBED`; `FRAME_READ`+`SCREEN_READ` → STALE; drop `setVerdict` dispatch, `laneRoot`, `passLane`; update `NODE-SHAPE.md`, `INTERNALS-ASYNC-STATE.md` | Same suites; size ≤ S2 |
| **S4 (optional)** | Store shims replaced once the store twins (brief §6) are addressed | Deferred; not part of this plan's exit |

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

Filled by the differential (§4). Format: row id · the rule · what the rule
requires · what today does · which side the shadow sides with · issue or
table fix.

_(none recorded before the differential ran; see the PR body for the
triage table and this section's final state)_

## 7. Blocked / two readings

Recorded as they arise, with both readings and the screen each produces.
Nothing is ruled here.
