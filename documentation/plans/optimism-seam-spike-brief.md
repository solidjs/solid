# Optimism: the seam / reveal / hold layer spike (2026-11-05)

Date: 2026-11-05. `next` @ `4fe75321d`. Branch `tembo/optimism-seam-spike-brief`.
Companion record: `reader-seat-rebuild.md` §8 (the S1 result this brief starts
from) and the analysis report of the same date ("Solid 2 stores and optimism:
three assessments, the shape to move to, and the rules scan"). Rules live in
`packages/signals/docs/`; this brief cites them and does not restate them.

## 0. Why this spike, and why not S1 again

S1 (`seat/s1-swap`, #4430, 2026-10-29) replaced the read and seating deciders
with the posture table and passed every suite, and the gate still failed:
+294 B brotli on the core floor, +1,061 B on `+ isPending/latest`, 25 of 150k
generator cases moved, two of them final screens. §8.4's diagnosis is the
premise here: **the bytes and the moved screens live in the seam / reveal /
hold layer of `lanes.ts`** (`laneSeam`, `laneSeams`, `endLanes`,
`dissolveLane`, `supersede`, `applyGuesses`, the Transaction state
`_shown`/`_held`/`_links`/`_verdict`/`over`/`folded`, `revealing`,
`adoptParked`, `heldBy`, the `stagedReaders` repair), which the table did not
touch. That layer is still growing: the three commits since the analysis pin
(#4687, #4691, #4693) added 81 lines to `lanes.ts`, among them a `marked`
set that holds two kinds of member, a `waiting` set, and a `walk` over the
landing's subscribers.

The table's own evidence has drifted too. The seat shadow landed at zero
mismatch classes on 2026-10-29 (#4438). On today's `next`, over the scalar
pins, it reads **80 classes** (126,390 reads compared, 274 files); the
largest are Vp1 and V2 "expected C, got P" — verdict readers served a
staging — which match the D-25 amendments of 2026-11-02 (#4544). The shadow
is not gated in CI. Whichever side is right, the rule table and the code
disagree in eighty places a week after they agreed in none.

So this spike does not rebuild the deciders. It asks whether the layer under
them can be made ordinary.

## 1. The question

**H1 — the value model.** Today a node has three value homes: `_value`
(committed), `_pendingValue` (a transaction's staging), `_x._lane` (the
lane's value: a written guess or a lane pass's derivation). Every seam,
reveal, dissolve and supersede step is a shuffle between the three
(`laneSeam` promotes `_pendingValue` → `_x._lane`; `dissolveLane` has four
outcomes per node; `supersede` moves the guess into `_value` "so the parent's
re-derivation compares against what is seen"; `display`, `laneValueOf`,
`truthRead` and `laneRead`'s seven exits choose among them per read).

A17 as amended says the override is the displayed value **and** the graph's
value until its own source answers. Between the guess and its landing nothing
but `until` needs a value other than the guess. The hypothesis: a guess is
the node's `_value`; the value it covered lives in a revert log on the
transaction (one entry per guessed node); a landing beneath a shown guess is
an ordinary write staged under the parent hold (`_pendingValue`); a lane
derivation is ordinary staging under the lane transaction, revealed by the
lane's commit. `_x._lane`, `display`, `laneValueOf`, the promote step, and
the lane arms of `read` go. `until` reads the log.

This is a relocation, not a reduction, of what the system knows: guess,
staged truth and covered value still exist. What it removes is the third
read path and the lane-specific promote / dissolve / supersede code, which
is where §8.4 says the bytes are.

**H2 — verdict readers by posture, no lane record.** C1 (below) says posture
is a property of a read. A display-ahead read registers its reader for
re-derivation at the hold's landing — the mechanism frame readers already
use (`_reruns`, `staleReader`) — instead of listing it in a verdict lane.
`verdictLane`, `t._verdict`, and the 25 `isVerdict` discriminators go. S1
kept `t._verdict` "as the reveal record"; this spike tests whether, once H1
has made lane values ordinary staging, the record is needed at all.

The spike's output is a yes or no for each, with numbers, and — if yes — the
scalar interface the store work targets: `optimisticWrite(node, guess)`, the
outcome on a guessed node, the comparator hook.

## 2. Rules first

Two rule texts are written before any mechanism, as proposals in
`RULES-DERIVED.md` (not rulings; the maintainer rules). They must reproduce
the ruled screens; where they would not, that is a finding.

- **C1.** A read is one of three kinds. A plain read sees the screen, and a
  plain read served a held staging makes its pass that hold's work. A
  display-ahead read (`latest`, `isPending`) sees the hold's world, registers
  its reader for re-derivation at that hold's landing, and never joins. An
  authoritative read (`until`) sees the truth. A pass has reads; it has no
  posture. (Absorbs A10, A31, D-25's "either order", "posture outlives the
  pass", "inherited posture is not a probe"; D-26's parity clauses; D-28;
  D-27's verdict-reader mount.)
- **C2.** A node has an answer once any landing has reached it, held or
  committed, or a first paint was declared at creation. `latest(x)` is the
  newest answer and throws only when there is none. `isPending(x)` is true
  iff `x` has an answer and a new question about `x` is unanswered on screen.
  A re-ask of the same question is not a new question; an `affects()` mark is
  a declared one. (Absorbs A19 exc. 1, A27, D-22/D-23's same-flush and
  pending-by-propagation amendments.)

The seat table (`core/seat.ts`) is then re-derived to C1 and C2 — rows, not
mechanism — and the shadow re-baselined. Each of today's 80 classes is
triaged per `reader-seat-rebuild.md` §4.1: a row error (the code is right
under the rule), or a bug on `next` (the row is right), filed and
allow-listed, never fixed in the spike.

## 3. Scope

Scalar only. The store is out of scope and stays compiled; its hooks are
reached only by store tests, which the spike skips (`tests/store/**` and the
202 files that use `createStore` / `createOptimisticStore` /
`createProjection`). The store work is the analysis report's §4 and starts
after this spike's answer. Boundaries are consumers of the seat, not
deciders; no boundary change. The in-flush mount split (report §7 C4) is a
ruling, not a spike target: a mismatch there is a finding.

## 4. Baselines (recorded 2026-11-05 on `4fe75321d`)

| suite / measure                                   | result                                                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `@solidjs/signals` full                           | 481 files, 6,744 passed, 14 expected fail, 2 skipped                                          |
| scalar pin set (275 files)                        | 3,834 passed, 12 expected fail, 7 skipped                                                     |
| `solid-js`                                        | 55 files, 926 passed                                                                          |
| `@solidjs/web`                                    | 2,006 passed, 3 expected fail; one failure on the first run that did not reproduce (see §4.1) |
| seat shadow, scalar pins                          | 80 mismatch classes; top: Vp1 C→P ×66/×38/×36, V2 C→P ×29, V6 ×28, D6 C→P ×26                 |
| generator 2k × {3289, 91501, 7}                   | 0 findings; recordings `/tmp/gen-<seed>-2k.json`                                              |
| generator 50k × 3, pairs E1,E2,E2e,E3,E6,E7,E8,E9 | recording (`/tmp/gen-<seed>-50k.json`)                                                        |

Size (brotli / minified, `scripts/size` on the fresh build; caps in `scenarios.js`):

| scenario                            |     br |     min |    cap |
| ----------------------------------- | -----: | ------: | -----: |
| signals: core floor                 |  7,421 |  19,825 |  7,430 |
| signals: + isPending/latest         | 12,239 |  33,615 | 12,250 |
| signals: + createStore              | 15,089 |  43,868 | 15,100 |
| signals: + until/refresh            |  8,044 |  21,641 |  8,060 |
| app: render + one signal            |  9,800 |  26,597 |  9,800 |
| app: hydrating + every store family | 33,398 | 100,547 | 33,410 |
| page: live server components        | 40,289 | 121,153 | 40,300 |

Three scenarios sit within 11 B of their caps; the spike's size gate is "not
above base", measured, not "under cap".

### 4.1 Environment notes

`dist-artifacts.test.ts` needs `pnpm build` first. The compiled size
scenarios need the compiler's native build (`pnpm --filter @solidjs/compiler
run build`, Rust toolchain). The generator's pairs flag is a comma list of
`PAIR_DEFS` keys, not `all`. The web suite's single first-run failure did not
reproduce on the second run; it is treated as flaky until it recurs, and the
test is named in the spike log when it does.

## 5. Milestones and gates

Each milestone is one branch off the previous, green on the scalar pins, and
measured before the next starts. Nothing lands on `next` from the spike; the
spike's deliverable is §1's answer.

- **M0 — rules and table.** C1, C2 as proposals; seat rows re-derived; the 80
  classes triaged. No mechanism change; dist byte-identical (§5.1 of the
  rebuild doc). Gate: shadow at 0 classes against the re-derived rows, with
  every allow-list entry naming an issue.
- **M1 — H1, the value model.** Guess into `_value`; revert log on the
  transaction; `until` reads the log; lane derivations as lane-transaction
  staging; `_x._lane`, `display`, `laneValueOf`, `truthRead`'s arm selection,
  `laneRead`'s value arms removed. Gate: scalar pins green; shadow 0; size
  not above base on the four floors and `+ isPending/latest`.
- **M2 — the lifecycle.** `laneSeam`'s promote step and `LEFT_SHOWN` go
  (reveal = the lane transaction's commit); `dissolveLane`'s four outcomes
  become commit or revert-log replay; `supersede` becomes a write plus a log
  drop; `marked`, `revealing`, `adoptParked`, `heldBy` each cut and judged
  by the differential (the rebuild's §8.2 method: a candidate nothing
  exercises is "undecidable", not "deleted"). Gate: as M1, plus 2k × 3
  against the recordings at 0.
- **M3 — H2.** Verdict readers by posture; `verdictLane`, `_verdict`,
  `isVerdict`, `route`'s seating go; display-ahead readers register through
  `_reruns`. Gate: as M2.
- **M4 — the full gate.** 50k × 3 with every pair against the recordings;
  every differing case replayed on M1, M2, M3 to attribute it; `scripts/size`
  table from the scratch build; the full signals, web and solid suites. The
  answer is written into this file's §6 with the numbers.

What stops the spike: a floor above base after M2; a final-screen move at
50k that C1 or C2 does not explain; a milestone that needs a new flag or
hook on a core node to pass its gate.

## 6. Result

- **H1 — yes.** The two-slot value model keeps every screen: scalar pins 3,885 pass as on `next`, the full signals suite 6,745 pass, the seat shadow at `next`'s six classes, 2,000 generated cases × 3 seeds with no difference (the 50k differential for seed 3289 is running). It is a relocation, as §1 said: `_x._lane`, `display`, `laneValueOf`, the promote step and the lane arms of `recompute` are gone; the covered value lives in a record and a guess's location follows a per-node mark. Size: the core floor −50 B minified, the optimism chunk +102 B, truth readers +102 B. H1 does not pay for itself in bytes; it is the scalar interface the store work targets (§13.1: a guess is a value on a node, `latestOf`/`covered`/`underOf` the three views).
- **H2 — no.** The verdict lane is the record of F-6's group: a hold's display-ahead readers show together, each waiting for its own async and never for the hold. Without the group, `tests/verdict-contract.test.ts`'s shape tears (§15). A correct cut would take about −400 B from the optimism chunk; the maintainer ruled F-6 stands.
- **What this says about the engine's size.** After M1 the lane engine's remaining bytes are the group's seam (`laneSeams`, `laneRead`'s arms, `enterLane`'s exceptions, `heldBy`, `entered`, `adoptParked`, `revealing`) — the price of F-6, D-25's exceptions and the repairs #4349, #4393, #4397 as they stand. The simplification the maintainer wants is not in the scalar engine's value model; the next step of the plan (stores alone, then together: one lane node per store root with a patch-valued guess) is where the duplicated machinery is (`store/optimistic.ts`'s `_laneRebase`, `fold`, `foldedRead`, `laneSet`, `_slotTake`, and lanes.ts's `take`/`kept`/`marked`, all store-only).

## 7. Commands

```sh
# scalar pins (packages/signals)
pnpm exec vitest run $(cat /tmp/scalar-pins.txt | tr '\n' ' ') --reporter=dot
# seat shadow over the scalar pins, then the summary
SEAT_SHADOW_REPORT=/tmp/seat.jsonl pnpm exec vitest run $(cat /tmp/scalar-pins.txt | tr '\n' ' ') --reporter=dot
node scripts/seat-shadow-summary.mjs /tmp/seat.jsonl
# generator differential (packages/web), one seed
ASYNC_GEN=1 ASYNC_GEN_SEED=3289 ASYNC_GEN_CASES=50000 ASYNC_GEN_PAIRS=E1,E2,E2e,E3,E6,E7,E8,E9 \
  ASYNC_GEN_MODE=survey ASYNC_GEN_DIFF=/tmp/gen-3289-50k.json pnpm exec vitest run test/async-gen/campaign.spec.ts
# size (scripts/size, after pnpm build at the root)
node size.mjs --json /tmp/size-head.json --no-gate
```

## 8. Decisions, walked through with the maintainer

### Decision 1 — posture is per read (settled 2026-11-05)

_Rows: S-21, S-48 (standing), S-49 and S-50 (ruled, not built) — executable in `packages/web/test/async-gen/rulings`._

Asked first as an A/B on a memo re-run by a sync write. That shape has no
pin: the rebuild doc says the general claim "rests on `core.ts`" (the verdict
bit shares REACTIVE_PROBED's bit, is copied from the probe at the pass's
tail, and is read by the next pass) "and has no dedicated pin yet". The
ruled screen is the boundary's (F-vlane, `24adaff59`, 2026-10-28): a
`<Loading on={latest(id)}>` shows its fallback now, beside the held shell,
pinned in `loading-on-frame-following-3540` §4–5, `loading-on-rearm-3540`,
`loading-on-latest-fallback-4337`.

`on` is a dependency list (its value is never compared), so the re-arm's
timing is the ordinary rule for the `on` pass: a plain read of a held
staging makes the pass the hold's work and its re-arm is held (D-1); a
display-ahead read publishes now and re-arms now. No posture has to outlive
a pass or be handed between nodes.

```tsx
<Loading on={id()} fallback={<Spinner />}>…</Loading>               // follows the frame (#3540)
<Loading on={latest(id)} fallback={<Spinner />}>…</Loading>         // the spinner now (D-17)
<Loading on={[latest(id), filter()]} fallback={<Spinner />}>…</Loading> // waits while filter is held
```

Settled:

- **C1 stands, refined 2026-11-06.** A pass's posture is decided by its own reads in that pass: never inherited (#4544), never carried into the next run. A plain read of a node the pass also read ahead is the screen's (A10: `[x(), isPending(x)]` in a memo shows `[committed, true]` now, S-27's memo case — the R1 ruling of 2026-10-28 stands); a plain read of any other held value makes the pass the hold's work (S-49, S-50). The first draft of C1 ("a pass has reads, not a posture") would have held the probing memo until the commit; the S-27 memo row caught it.
- **D-25's paragraph "A verdict posture outlives the pass that asked (ruled
  2026-10-28)" is withdrawn.** D-17 restated in one sentence: a re-arm is
  ahead iff every held value the `on` expression read, it read ahead.
  Mechanism: the swap belongs to the frame of the `on` pass that armed it —
  one pointer recorded at arm time (`_armLane` minus the lane).
- **A memo that probed once and is later re-run by a sync write** reads the
  held value as a plain read, joins the hold, and the tick holds with it.
  Today (run on `4fe75321d`): with a prior probe the sync write publishes
  beside the held value (`m=0 k=1`, twice); with no probe the tick holds.
  The second is the rule.
- **Change against today, flagged:** the mixed `on={[latest(id), filter()]}`
  with `filter` held re-arms ahead today (any probe makes the pass a verdict
  reader); under this it waits for the frame.

M0 checks: the three loading-on pins under the re-derived rows; two new pins
— the memo-and-sync-write shape holds the tick; the mixed `on` form waits.

### Decision 2 — "answer" is defined as today (settled 2026-11-05)

_Rows: S-26, S-27, S-45 (the leaf and memo cases ruled, not built; the plain case standing)._

C2 is written with reading (ii): a node has an **answer** once it has a
committed value, or its own async has landed into a hold, or a first paint
was declared at creation. A sync memo born held has **produced** a value
(`latest` returns it, D-22) but has no answer: no verdict, its owned reader
is held with it and runs at the commit (D-2, D-23 exception 1, F-9's
hydration parity). No screen changes. Exception 1 becomes the definition;
#4459, #4569 and A27 are instances. The spike implements one predicate where
`core.ts`, `verdict.ts` and `seat.ts` each spell the uninitialized /
first-landing / netted test today.

### Decision 3 — `latest` of a slot displaying a guess shows the displayed value (settled 2026-11-05)

_Rows: S-33 (standing), S-44 (ruled, not built: `latest(comments)` at the new question's landing)._

Asked as "is a guess an answer or an edit". The answer kept provenance as it
is and moved the question to what `latest` means.

- **Scenario 1 (S-44 row 1, #4336) is unchanged.** A guess is an edit over
  the answers to the question it was written over; an answer to a new
  question is not its truth, and the frame that changed the input is held
  with the edit's hold. The displaced-guess rows stay.
- **Provenance is unchanged** (D-35, A24): a same-question landing from
  outside the hold still supersedes in the graph — plain-read derivations
  re-derive from it at once as the hold's work, so #3331's downstream
  refetch still starts early — and `isPending` reads true while the held
  truth differs.
- **What changes is `latest`.** Since U-10 (#4050, 2026-10-14) `latest`
  inside a memo decides membership: the memo's result shows now instead of
  being held. A17's older clause also handed it the graph's value, so a
  `latest`-built count showed the landed truth beside rows showing the guess
  (#4689, found by ReactiveScript's checker, whose `latest x` means only
  "don't wait"). Ruled: `latest` of a slot that is displaying a guess answers
  the displayed value until the hold commits. `until` keeps the truth.
- **Re-ruled:** D-22's "the arrived truth under a superseded override";
  A17's #3331 amendment narrows to plain-read derivations; D-34's
  "`latest()` answers the truth" under a shown guess. S-44's `latest` column
  at step 2 becomes the displayed guess (a view built only from `latest`
  reads shows `#1: dana | mine (sending)`; today's `#1: ` tears count
  against rows the same way #4689 did). Approved unscoped.
- **#4689 is a bug under this.** Fix: delete the `laneValueOf` pick at
  `verdict.ts:521` and make `latestView` the displayed view; re-pin
  `optimistic-key-guess-reask-4329.test.ts:382`; re-check the 17 files that
  read `latest` over an optimistic primitive around a re-ask (35 read it at
  all). A deletion in the read decider, not the seam layer: can land ahead of
  the spike. #4685 (D-23 cause (iii) under lane entanglement) stays a
  separate bug in the spike's layer.
- **Chains built on `latest` of a guessed slot** correct at the commit
  instead of the landing; plain-read chains are unchanged.

### Decision 4 — a first pass that reads this flush's staging is born held when the flush parks (settled 2026-11-05)

_Rows: S-3, S-6, S-31 (standing), S-46 (the plain row ruled, not built: today the branch attaches with its hole empty)._

Run on `4fe75321d`, plain write and action alike:
`primed: a=0 A closed B closed → flushed: A panel=1 (published into a closed
gate) · B open (no panel inside) → landed: a=1 B panel=1 A open`.

- A mount behind a plain gate written in the same tick never shows early:
  the gate's write is held with the tick (D-4). D-2's in-flush clause
  ("publishes with the flush; if the flush parks it re-derives on the
  committed values") only produced invisible work — the content's first pass
  published the staged value into a branch nobody could see.
- A mount behind a display-ahead gate (`<Show when={latest(x) > 0}>`) opens
  now; its content, reading `x()` plainly, is born held: fallback now if a
  `<Loading>` is inside (S-31), nothing visible until the landing if not
  (S-46, the deferred insert of #4574), content at the landing.
- **Ruled (b):** a first pass that reads this flush's staging, when the
  flush parks, is born held — D-2's main clause, with the in-flush exception
  removed. No screen changes. Reading (a) (re-derive on committed) was
  rejected: it would show the old content inside a gate opened by the new
  value and re-rule S-31's fallback row and S-46.
- **Mechanism:** the first-pass half of the `stagedReaders` repair goes;
  `bornInto` and `CONFIG_HELD_FRAME` stay as the rule rather than the
  exception. Pins to add: mount A's content held with its gate; mount B's
  content born held under both write kinds.

### What M0 now consists of

1. C1 and C2 (Decision 2's definition of "answer") written into
   `RULES-DERIVED.md` as proposals; D-25's carry-over paragraph withdrawn;
   D-17 restated per Decision 1; D-2's in-flush exception removed per
   Decision 4; D-22/D-34 amended per Decision 3.
2. Seat rows re-derived to them; the 80 shadow classes triaged (row error,
   or bug on `next` with an issue and an allow-list entry).
3. New pins: memo-and-sync-write holds the tick; mixed `on` waits; mount A
   held with its gate; mount B born held. The #4689 fix (a deletion in
   `verdict.ts` and `latestView`) may land ahead of the spike with its
   re-pins.

## 9. Executable rulings (2026-11-06)

The rows above are executable: `packages/web/test/async-gen/rulings/S-<n>.ts`
(the scenario in the generator's grammar, the expected screen per step, the
✗ screens), run by `rulings.spec.ts` in `pnpm test`, with the `SCENARIOS.md`
blocks generated from the same objects (`RULINGS_WRITE=1 pnpm exec vitest run
test/async-gen/rulings` in `packages/web`; the spec fails when a block is
stale). The seven rules D-2, D-17, D-22, D-23, D-25, D-27 and D-34 are one or
two sentences naming their rows; their former text is archived in
`INTERNALS-ASYNC-STATE.md` §7. Six cases are `ruled-not-built` and record
today's screen beside the ruled one: S-44 (the `latest` clause and, found by
the run, an owned `isPending` probe reading false after the outside change
where the imperative probe reads true), S-45 leaf and memo, S-46 plain, S-49,
S-50. The grammar grew `on`, rich actions with guesses and refreshes,
optimistic sources, gated and `isPending` inputs, `isPending(() => latest(x))`
reads, and branch-owned memos; the random generator does not emit them.

## 10. M0 triage of the seat shadow's 80 classes — first pass (2026-11-06)

Run: `SEAT_SHADOW_REPORT` over the 275 scalar pin files on `4fe75321d`; 126,390 reads compared, 80 mismatch classes. Dispositions under the rules as rewritten (§8 and `RULES-DERIVED.md`), by reading the rows in `core/seat.ts` against them. Nothing in `seat.ts` is changed yet; each line is a proposed row edit or a drop, to confirm before the table is re-derived.

| family                                                                          | classes | hits | state                                                                                                          | disposition                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------- | ------: | ---: | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vp1 `expected C, got P`, node `s u` (staged, uninitialized)                     |     ~20 | ~190 | a probe of a node born staged, reader often a first pass (`cU`)                                                | **row error.** An uninitialized node has no screen; D-22/D-23: no answer, no verdict — the probe's read does what a read does and is served the staging. `windowRow`'s `staged && !pending` branch returns `SLOT_C` for `isPending`; for `uninit` it should be `stagedSlot` with `RAISE_H` when owned, as `Vp2` already does for a held node.                                    |
| Vp1 `expected C, got P`, node `s` (staged this flush, not held), `w0 flushTx`   |     ~10 |  ~30 | a plain read of this flush's staging inside an `isPending` window                                              | **decision needed.** A probe is reads-only (A23): the value its thunk is served never reaches a screen; what matters is the side effect (join, AH, W). The table asserts the slot. Proposal: Vp rows assert side effects only. If the slot must be asserted, the same-node clause says the probed node's own value is the screen's, and these would be code deviations to trace. |
| Vp1 / V1 `expected C, got P`, node `s h`, reader `cH cSameTx w2`                |     ~10 |  ~40 | the hold's own work (a pass held by the same hold) probing or plainly reading its hold's staging               | **row error.** D-25: the hold's own work reads plainly whatever it asked (#3884, #4341). `windowRow`/`heldRow` exclude only `seatBornInto`; add "held by the same hold" (`cSameTx`).                                                                                                                                                                                             |
| V2 `expected C, got P`, V posture from the sticky bit                           |       4 |   61 | a pass whose V posture is carried (`CONFIG_VERDICT` from a previous run) or inherited reading a staging        | **row error, the carry-over.** `postureOf` returns V from the sticky `CONFIG_VERDICT`; under D-25 as rewritten posture is this pass's own probes. The seat records the nodes this pass probed (`seat.probed`); V applies to a plain read of a probed node only (same-node), D/L otherwise. Resolves these with the V1 sticky cases.                                              |
| V6 / V2 / B2 "verdict seat after the read" and "at the pass's end"              |     ~16 |  ~70 | slot agrees; the verdict-lane membership bookkeeping differs                                                   | **drop.** The verdict lane is mechanism (membership), not a rule; D-25 as rewritten has no "verdict seat". The table stops asserting `vseat`; H2 removes the record.                                                                                                                                                                                                             |
| D6 `expected C, got P`, D posture, `s h · inLane`, `flushIsElTx`                |       6 |  ~50 | lane work (a derivation) reading the parent hold's staging in the hold's own flush                             | **row error.** D-26 (clarified 2026-10-28), the computing half: a lane derivation that reads a value the parent holds joins that hold and computes from the staging now; it shows at the commit. `D6` predates that clarification. → `P` with `RAISE_H`.                                                                                                                         |
| D6 `expected C, got P`, L posture (`t1`), `s h · inLane`                        |       3 |  ~12 | a render effect in a lane reading the parent hold's staging                                                    | **trace.** D-26's displaying half says a plain read in lane work of a node the parent holds is the screen's; the code serves the staging. Either the leaf is the hold's own work in its own flush (`flushIsElTx`, L2) or this is a deviation.                                                                                                                                    |
| D6 / L6 / L0 / D0 / L4 / D4 "world after the read"                              |      ~9 |  ~60 | slot agrees; the seat's world bookkeeping (S/Fl/H) differs after a stale or lane read                          | **drop or adjust.** A stale read (`MARK_ST`) does not raise the world under D-1; the table's world ledger is seat mechanism, not a screen. Keep only where a world change predicts a later slot.                                                                                                                                                                                 |
| L7' `expected P, got Dv/Lv/NR`, `s d lane shown lheld`, reader `cH cOtherTx t1` |       6 |   23 | a render effect held by another hold reading a shown lane's derivation whose staging is the lane's next reveal | **row error.** #4666 (2026-11-03): "a shown lane's `_pendingValue` is the lane's staging for its next reveal, not the frame's" — the leaf reads the screen (`Dv`) and re-derives at the reveal. `L7'` was written for the pre-#4666 reading.                                                                                                                                     |
| B2 "seatLane at the pass's end (rows L7')"                                      |       1 |    8 | follows L7'                                                                                                    | **drop with L7'.**                                                                                                                                                                                                                                                                                                                                                               |

Net: every class but the three-class D6 leaf family and the ten Vp1 slot-in-a-window classes is a row error or a bookkeeping assertion the rewritten rules do not make. No class is yet a bug on `next`; the one candidate from the rulings run is S-44's owned probe (false where the imperative probe reads true), which is not in the shadow's scalar pins.

Before the table is re-derived: (1) the same-node clause in D-25 — **confirmed 1a, 2026-11-06**; (2) `isPending`-window rows assert side effects only and (3) verdict-seat and world-ledger comparisons leave the table — **taken as consequences of "the rows are the rules", 2026-11-06** (a probe's served value and a lane membership are not screens); the join comparison stays, since D-1 names it. Then M0.2 edits the rows, re-runs to zero, and files any class that survives.

## 11. M0.2 — the seat table re-derived (2026-11-06)

`core/seat.ts` edited beside the deciders (test-only; dist unchanged). Shadow over the 275 scalar pin files, 126,390 reads: **80 classes → 6 classes (8 reads)**, with 538 reads under three named deviations of today's code from the rewritten rules. Suites green.

What changed in the table:

- **Posture is this pass's own reads.** `postureOf` no longer returns V from the sticky `CONFIG_VERDICT`. The seat records the nodes the pass read ahead (`probed`, seeded from the node's previous pass — today's sticky bit is how a plain-first memo stays order-independent across runs); a plain read of one of them takes the V rows (the same-node clause, 1a); any other plain read of a held value takes the plain rows (joins).
- **`isPending`-window reads**: slot not compared, side effects compared (decision 2).
- **Comparisons dropped** (decision 3): the `Fl` rank (`REACTIVE_STAGED_READ`, D-2's in-flush re-derive, withdrawn by decision 4) and the verdict seat, at reads, at B1 and at B2. The join (`REACTIVE_JOINED`, D-1) is still compared, for derivations; a render effect's membership is the tick's (D-4). The verdict seat stays as an internal selector for a lane node's read (a verdict memo's own value versus its display is screen-visible).
- **Rows corrected:** a born-staged node under `isPending` has no screen (Vp2, the staging); the hold's own work — a pass the same hold holds — reads its hold's staging whatever it asked (V1''/Vp1''/Vl1'', #3884/#4341) and joins unless born into the hold; a shown lane's staging is the lane's next reveal, not the frame's (L7', #4666); lane work in a lane re-based over the hold's answer reads the hold's staging, the hold's flight as the screen (D6', `Transaction.over`, #4536 — the store seam the report's §4 removes).
- **Two attempts reverted, recorded so they are not retried:** "lane work in the hold's own flush reads the staging and joins" (D6'') cascaded into ~2,500 spurious join mismatches — lane work reads the screen (D-37) except through `over`; and the own-work rows must not raise a join for a probe's inner read or for a pass born into the hold.

The three deviations, allow-listed by predicate (`known` in `seat.ts`). They are not issues to file: each is the mechanism M1–M3 replace (the sticky verdict bit, the verdict lane, the carry-over), ruled in §8 and pinned by S-49 and S-50 as `it.fails`; the allow-list counts go to zero when M3 lands, and the two rows flip.

| label                                                 | reads | what today does                                                                                                                                                          | what the rule says                                                                        |
| ----------------------------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| D-25 pass-wide posture (S-49, S-50)                   |   368 | a probe makes the pass a verdict reader for every held read in it (the sticky bit, or the verdict-lane seat): the screen, no join; on a staged error, the proposed error | a plain read of a node the pass did not read ahead joins (D-1); the same-node clause only |
| D-25 verdict-lane membership over the hold's own work |   159 | a pass the hold holds, seated in the hold's verdict lane by membership, reads the screen and does not join                                                               | the hold's own work reads its staging and is the hold's                                   |
| D-25 carry-over (S-50)                                |    11 | a node probed last pass, read plainly this pass without a probe, is the screen's                                                                                         | the plain read joins                                                                      |

The six residual classes (8 reads; `fallback-fn-latest-runaway-4467` ×4, `held-branch-verdict-reader-4010`, `verdict-probe-committed-4648`): a V1 read served the staging where the table says the screen, a V4 read thrown NotReady where the table says the screen, two join disagreements on own-work rows for a pass still uninitialized (`cU`), and two bookkeeping reports (B1 inherited world, B2 born held) under a creator that joined per the code. Each needs a trace, not a row change.

M0 is done to the point the spike needs: the table encodes the rewritten rules, and what it disagrees with is named. The spike's M1 starts from here.

## 12. The derived rules collapsed (2026-11-06)

With the glossary holding the definitions and the rows holding the screens, sixteen derived rules were restatements of other rules or of the fundamentals. They are stubs now — the ID stays, the stub names where the rule went — and their rows and pins moved to the absorber; the text as it stood is archived in `INTERNALS-ASYNC-STATE.md` §7 (the 2026-11-06b entry).

| absorber | absorbed         | why                                                                                                                  |
| -------- | ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| D-1      | D-2              | the same sentence once _the hold's work_ and _born held_ are glossary terms                                          |
| D-9      | D-11             | D-9's last clause and F-3's statement                                                                                |
| D-12     | D-13, D-14, D-21 | the held half of "the fallback is seen when the frame that armed it is"; F-3/F-4/F-5 restated; the lane form of D-12 |
| D-17     | D-15, D-16       | D-17's first sentence; a consequence of it (the outside-hold clause and the diagnostic kept)                         |
| D-23     | D-24             | one sentence of the isPending rule                                                                                   |
| D-25     | D-26, D-27, D-28 | the same-node clause; D-1 after decision 4 plus the glossary's _Lane_; per-read posture stated for throws            |
| D-33     | D-32             | F-10 restated plus the glossary's void-guess clause                                                                  |
| D-34     | D-35             | D-34's second paragraph                                                                                              |
| D-41     | D-39             | contained in D-41 as "recovery is the mirror"                                                                        |
| —        | D-36, D-37       | consequences of the glossary's _Guess_ and _Lane_ plus D-25; D-36 stays as a pin                                     |

D-30 shortened to its one distinct sentence. `RULES-DERIVED.md`: 40 rules, 14,335 words on 2026-11-05 → 24 live rules, about 7,600 words. Checks: every row a folded rule listed is listed by its absorber; the rulings spec and the rules index pass; the boundary rules D-18 and D-19 and the hold rules D-3, D-4, D-6, D-7, D-8, D-10 stand as they were.

## 13. M1 — the value model (2026-11-06)

Inventory on the merged `next` (`45648f782`): the third slot `_x._lane` had 27 sites in `lanes.ts`, 5 in `core.ts`, 3 in `verdict.ts`, 2 in `truth.ts`, 1 in `async.ts` (DEV), 1 in `store.ts`, 8 plus 6 `laneValueOf` picks in `store/optimistic.ts`; `display`, `laneValueOf`, `truthRead`, `covered`, `guessedValueOf` were built on it; the lane record carries `_shown`, `_held`, `_links`, `over`, `folded`, `latest` for it.

### 13.1 The model as built

A node keeps two value slots, as any held node: `_value` is what the screen shows, `_pendingValue` the staging of the transaction holding it. For a lane's node the holder is the lane. One mark on the extension, `_x._shown`, says the lane has shown a value of the node; one record beside the slots, `covers` (truth.ts, a WeakMap by node), holds what the two slots cannot.

- **A lane derivation** stages its pass's answer in `_pendingValue`; the lane's reveal (`laneSeam`) commits it into `_value` with `commitPendingNode` (a staged error publishes there, D-41; the frame the pass built retires the one it replaces) and marks the node shown. After the reveal a re-run stages again and the next unblocked seam commits it. `covers` keeps what the screen showed before the first reveal: a pass that leaves a shown lane outside a held frame is judged against it (the screen moves at the seam's wake, #3892/#4367), and a leaf asks the mark whether the lane has ever shown the node (`laneRead`'s "never", #3334).
- **A guess** is in `covers` until the lane shows it; the reveal swaps it into `_value` and the record takes the covered value for the revert. A truth landing beneath a guess is the node's staging (`_pendingValue`, the parent's; `landBeneath`), as before — a staging on a guess is the truth beneath it whether a hold holds it or the same tick staged it (A18's `isPending`, `until`, the revert's "superseded").
- `latestOf(n)`: a guess's guess (`_value` once shown, the record before); a derivation's staging else its screen value (NOT_PENDING for a node born in the lane with nothing shown). `screenOf(n)`: `_value` (NOT_PENDING uninitialized). `covered(n)`: the record once shown, `_value` before; a store slot asks the store with that as the fallback (`_slotCovered(n, v)`, a chained link following the inner store). `underOf(n)`: the staging, else the covered value.
- A guess node's lane can change (`laneStage` lists a pending pass's node on the lane whose work it is; `take`): the mark and the record go with the node, so where its guess lives does not depend on which lane it is in. (A per-lane record needed a value move at every change of lane; a config bit for the mark is not available — all 32 are taken, bits 23–24 by the effect type.)
- The store's chained links write their committed value on every read ("the link follows the inner store", S4): `follow(n, v)` (store.ts) writes `_value` unless a shown lane owns it.

### 13.2 What went, what stayed

Gone: `_x._lane` and its initialization; `display`; `laneValueOf` (replaced by `latestOf`); `laneSeam`'s promote step (the reveal is a commit); `recompute`'s lane arms for the pass's prev and the equality gate (−50 B minified on the core floor); `laneWrite`'s shown/unshown branch; `dissolveLane`'s per-node value outcomes and its `loading` list; `verdictValue`'s dead "first load" throw; `supersede`'s slot shuffle; `async.ts`'s DEV lane clause; the store's slot moves in `holdWithDerive`; `_slotCovered`'s write into `_value`.

Stayed, for M2/M3: `LEFT_SHOWN` (the seam's wake for a pass that left a shown lane; without it #3528 shows the stale frame it would have shown on `next` with a later landing — the principled fix is a frame reader keeping what it shows until the landing, and under H2 the verdict lanes this arises in are gone); `laneRead`'s routing arms (M2); the verdict override arm in `verdictValue` (M3); the `#4666` arm, now `l._shown && isVerdict(l)` (a verdict lane's staging is the frame's, S-39; a guess lane's is the lane's).

### 13.3 Record

- Scalar pins: 276 files, 3,885 pass, 12 expected fail, 1 skipped — the same counts as `next`. One pin text changed: `tests/settle-walk-invariant.test.ts`'s lane-override case fakes `_pendingValue` instead of `_x._lane`. No screen pin changed.
- Full signals suite: 481 files, 6,745 pass, 14 expected fail, 2 skipped (store tests included; the chained links needed `follow`).
- Seat shadow: 6 classes, the same six as `next` (M0.2's residue), 126,720 reads. One row changed: L7' is now `l._shown && vlane` (the #4666 arm as it is).
- Generator differential: seeds 3289, 91501, 7 × 2,000 cases against `next`'s recordings — 0 cases differ.
- Size (minified / brotli vs the base measurement, `scripts/size`): core floor −50 / −15; + createStore +14 / 0; + isPending/latest +102 / +3 (within its cap); + until/refresh +102 / +56 (over its cap: truth.ts carries `covers`, `covered`, `underOf` and `latestOf` for `truthRead`, which `until` installs whether or not a lane exists). The floors shrank; the optimism chunk grew by the helpers (`setLaneValue`, `cover`, `landBeneath`, `screenOf`), the guess swap at the reveal and `take`. The M1 gate as written ("not above base on + isPending/latest") is missed by 102 B minified; the brotli cap holds.

### 13.4 Open

- Size: the two +102 B. M2 removes `LEFT_SHOWN`, `dissolveLane`'s remaining outcomes and `laneRead`'s arms; `truthRead`'s installation (signals.ts `watch`) could move to the lane engine so a bundle with `until` and no lane carries none of truth.ts.
- The 50k base recordings: seed 3289 recorded on `next` (2.7 h, not 10 min); 91501 and 7 run from the `/workspace/solid-base` worktree (built `next`). The M1 build's 50k differential for 3289 runs against it.

## 15. M3 — H2 cut, and the rule it meets (2026-11-06)

H2 was built on `tembo/spike-h2-cut` (one commit, not green): `verdictLane`, `_verdict`, `isVerdict`, `heldBy` and the verdict arms of `enterLane`, `laneRead`, `laneSeams` and `verdictValue` removed; a window read, or a read of a display-ahead reader's value, marks the pass display-ahead of the hold (`route`: `REACTIVE_LANE_READ`, listed on the hold through `_x._transaction` with CONFIG_VERDICT and no CONFIG_HELD — no new field); the park seam commits what such a pass staged; its effect runs go to one ahead queue released with the lanes' reveals; a boundary's display-ahead swap marks the output's pass the same way. 147 of 3,898 pins fail.

**The finding is a rule, not a bug.** F-6: display-ahead readers "wait for their _own_ async, in their own lane" — the transaction's verdict readers are one optimistic frame (lane contract 3; `tests/verdict-contract.test.ts`, "a verdict reader whose own pass goes async holds the transaction's verdict frame, not the parent"). Posture per read has no group: each reader shows when its own pass completes. After M1 the verdict lane is exactly that group record — the readers, their queued runs, and the seam's judgement of them together — with no value of its own. So the answer to H2 as asked ("is the record needed at all?") is: it is needed as long as F-6 groups.

**The stake, measured.** The cut as built: `+ isPending/latest` −430 B minified / −177 B brotli against M1 (lanes.js −669); the cut leaked +185 B onto the core floor through the ahead queue and hook plumbing in scheduler.ts and core.ts, which a correct version must keep behind the verdict engine's hooks. A correct H2 is worth about −400 B on the optimism chunk and nothing elsewhere.

**The decision** (Decision 5, for the maintainer; the shape of `tests/verdict-contract.test.ts`):

```ts
const [q, setQ] = createSignal("a");
// The hold: q's change is held on results' flight.
const results = createMemo(() => fetchResults(q()));
// A display-ahead reader with async of its own.
const suggest = createMemo(() => fetchSuggest(latest(q)));
// A display-ahead reader with none.
createRenderEffect(() => `input:${latest(q)}`, log);
setQ("b"); // then resolve suggest, then resolve results
```

| #   | Event                                | Today (F-6: one frame per hold)                       | Posture per read (no group) |
| --- | ------------------------------------ | ----------------------------------------------------- | --------------------------- |
| 1   | `setQ("b")` flushes; both flights up | nothing shows: `input:b` waits for `suggest`'s flight | `input:b` shows now         |
| 2   | `suggest` lands                      | `input:b` and `suggest:b` show together               | `suggest:b` shows           |
| 3   | `results` lands                      | `results:b`                                           | `results:b`                 |

**Ruled (maintainer, 2026-11-06): F-6 stands.** The second column is a tear — a verdict reader with no async of its own showing `b` beside a verdict reader of the same `q` still showing `a` — and F-6 exists to prevent it. A hold's display-ahead readers are one frame; the verdict lane is that frame's record and stays. H2 is **no**. `LEFT_SHOWN` stays with it.

## 16. A question is asked only of the truth (ruled 2026-11-07)

GabbeV's `experiment/unified-updates` branch (a scalar engine without lanes; 137 agent-written stages; 2,111 failing tests and over every size cap at its last checkpoint) was read for its rulings, not its code. Its 384 new tests were run against `next`: 177 + 25 pass unchanged, 26 files need its own modules, about 100 screens differ. Most of the differences are one philosophy — a guess, an input landing, an input error masked until the action ends — which contradicts F-11 and A18 and was declined. Seven rows were tabled and ruled in one sitting, each with code and a frame table; the rulings spec pins today's screen and records the gap. The spec gained a no-yield action (#4349's shape) and a `truth-asks` oracle.

**The ruling that settled them** came from #4677: the badge, an async memo over `id` and `isPending(id)`, asked `badge(0, true)` from its display-ahead pass while the engine held `id = 1`. That stale ask was licensed by L2's rule 6 (2026-10-04: a verdict reader's whole pass seated in a lane), enabled by A10's atomic pair (#2831, 2026-07-06), and generalized to memos on 2026-11-05 (Decision 1, D-25, S-27's memo row, "#3905 not needed"). Written as F-2's producer clause and F-6's limit rather than a new fundamental:

- One version per node. The hold is the only producer of a change's consequences: nothing asks of the value the screen keeps.
- The display is the one declared, terminal, kept-not-computed inconsistency: a render effect, a compiled binding, a user effect (its callback runs at the frame it belongs to), and the sync derivations feeding them may hold the value they showed beside the verdict about its successor. Memo-inline parity holds; S-27's memo row stands.
- The act is the async derivation. Reached from a display-ahead value it is the hold's and asks of the truth. Async in a user effect is the author's.
- `latest` is never stale; `isPending` is a fact; both read anywhere. A guess is not stale until corrected (D-34). Inside a hold's work, a verdict about that hold is answered.
- #3905 is not warranted: the display lane cannot ask, so there is nothing to propagate. Full #3905 (two versions everywhere) was weighed and declined: the inconsistency is meant to be narrow. The verdict lane stays; it loses its flights.

| Row | Ruled | Today |
| --- | --- | --- |
| S-51 #4677 | the badge asks once, of the truth; the `isPending` hole shows at once | the display-ahead pass asks `badge(0, true)` and its answer gets a frame |
| S-52 #4349 | `[isPending(x), x()]` shows pending beside the committed value in every shape, render effect or memo | the action-ends-inside-the-call shape holds the pair as one |
| S-53 #4403 | `latest` shows a held recovery ahead, value/error symmetric | the error stays until the action lands |
| S-54 | `isPending` stays true for a held, unshowable answer | clears when the answer is ready |
| S-55 | standing: `refresh` under a guess is the guess's own source answering (F-11) | same |
| S-56 | a guess before the first answer shows; the first answer judges it | the dev guard refuses it |
| S-57 (their A2) | a plain write whose derivation became a guess's lane work holds on that flight and reveals with the lane (F-2 as written) | the write publishes beside the stale derivation, because the lane took the only question |

**Measured on today's engine:** the `truth-asks` oracle finds 12 stale asks in the regression gate's 1,500 cases (seed 3289), all one shape — an async memo reading `latest(s)` beside a plain `s`, D-25's same-node clause handing the pass the screen's `s`. Recorded in `baseline.json` as known; they become improvements when the clause is built.

**Deferred to the build, on purpose:** how a pass is known to ask before it asks; the verdict lane losing `blocked`, its seam arms and #3869's first-pass seating; the #4349 and #4677 pins rewritten. Built on M1 (the lane value model), independent of S1–S3.

## 17. Building the producer clause (2026-11-07, `tembo/m1-truth-asks`)

The rule (§16): nothing asks of a value the screen keeps; the display may show it beside the verdict about its successor; an act — an async derivation — reached from a display-ahead value is the hold's. The mechanism has to answer three questions the rule leaves to it.

**1. How the engine knows a pass asks before it has asked.** It already records it: `CONFIG_ASYNC` is set by `handleAsync` when a pass produces a flight and cleared by a sync answer. Today the bit is also cleared when the pass opens a verdict window (`markVerdictReader`), because `holdWork` used it to mean "async memo with no window of its own". That conflation is the exemption that let a probing async memo run display-ahead and ask. The build keeps `CONFIG_ASYNC` as "this derivation's last answer was a flight", moves the no-window condition in `holdWork` onto `CONFIG_OWN_PROBE` (the window bit the recompute tail already keeps), and uses `CONFIG_ASYNC` as the asker marker. Residue, stated once: a derivation whose last answer was synchronous is not an asker until it asks; in the ahead pass it reads the screen and, if it fetches on that pass, issues one request whose answer never shows. In real code that pass takes the synchronous branch because it sees the old input; the only body that trips it fetches *because* `isPending` is true. (`_x._q` was considered as the marker — set by every flight, never reset — and rejected: guesses stamp it on optimistic memos that never ask.)

**2. Where the asker leaves the display.** Two reads, both of a *held* node (one whose successor the engine holds; a node merely in flight has no successor and stays as today):

- A plain read of a held node by an asker is not served the screen. `frameRead` returns false for it: the pass reads the staging and `joinPass` makes it the hold's. If a window read earlier in the same pass had routed it into the holder's verdict lane, it is un-seated: `passLane` cleared when it is that verdict lane, `REACTIVE_LANE_READ` cleared, the `_reruns` entry the probe pushed removed (a joined pass is re-derived by the landing as any held pass is, not twice). An optimistic lane seat is kept: a pass that read a guess is lane work by F-6 and S-57 governs how its frame meets a held write.
- An `isPending` read of a held node by an asker joins the hold the same way and answers in the hold's world: `false`, the hold's own write is its answer (§16, rule 7). This is what removes the order dependence: `isPending(id)` before `id()` and after it give the same pass, the hold's, asking once. `latest` of a held node stays ahead — the staging is the truth, and F-6's example (an async memo over `latest(x)`) keeps its lane.

The reads that stay as today: a sync derivation's reads (the display, memo parity), any read of an in-flight node, `latest` anywhere, a window read by a pass with an optimistic lane seat.

**3. What the verdict lane loses — corrected after the build.** Only the askers that read a held value plainly or probe it leave the lane. An async memo over `latest(x)` alone stays lane work by F-6's own example, so a verdict lane can still carry flights, `blocked` still applies to it, and #4687's reveal-whole has a verdict-lane case left. No simplification came from this step; the mechanism is additive (+205 B brotli on the isPending/latest chunk). What did go: the asker's second pass (the lane's re-derivation of a question already asked of the truth), the inherited verdict posture on askers (#4504's memo-over-asker now holds by construction), and the stale questions in 29 pins across `latest-two-readers-one-ask-4393`, `verdict-memo-flight-no-reask`, `latest-first-one-pass-4402`, `midflight-memo-over-reask-4504`, `unread-derive-midflight-mount-4491`.

**Pins that changed (built).** The twelve `truth-asks` gate cases are improvements in `baseline.json`; S-51 is standing; the seat table gained V0/Vp0 and the shadow is back at six classes. `ispending-async-derivation-4677`'s own fixture is the residue case (the badge is synchronous at id 0, so not yet an asker) and keeps its screens; the S-51 row, whose badge is always async, flipped. The #4349 held shape (S-52) is untouched by this step.

**Order.** S-51 first (this mechanism), gates and size against M1; then S-54, S-53, S-56, S-52, S-57.

**S-54 (built 2026-11-07).** The lane-node probe arm in `verdictValue`: a lane derivation whose answer landed while the lane is held (`l._held`, a sibling's flight) is still pending for a reader outside the lane; the reader is registered as the lane's stale reader so it re-derives at the reveal. Not for the lane's own work (it reads the lane's latest, which answers its question) and not for a verdict lane that is merely mid-flush (it reveals this seam). Three checkout pins changed: `isPending(shippingInfo)` stays true while the lane holds on tax, the `latest()` text showing "DHL" ahead on its own channel (A8). +34 B brotli on the isPending/latest chunk.

**S-53 (built 2026-11-07).** `recompute`: a recovery to the last good value in a flush that has joined a hold is a change of answer (D-41), staged with the shown error and held — before, it published silently (the #2949 path), so `latest(m)` had no held recovery to show ahead of and the `Show` it gated was held whole, the boundary keeping `[E]` until the landing. The park no longer nets a staging that replaces a shown error. The #4403 pin flipped (the boundary recovers while the action is open). The plain-read case (S-53′) is S-46's plain row, ruled not built: the hole attaches empty today (#4417's mechanism), which the shown error masked before. +11 B brotli on the core floor.

**S-56 (built 2026-11-07).** The memo-form optimistic setter drops the DEV guard; the engine already carries the guess as the uninitialized node's lane value, so it shows in place of the loading and the first answer judges it (the function form receives `undefined`). Three pins flipped; the A18 (d) pin keeps its reads (an unshown guess is void at the correction). Not the store form: a derived optimistic store's screen cannot show a guess before its first landing (untracked reads see it, the screen stays loading, and the first answer folds the guess in), so `OPTIMISTIC_WRITE_BEFORE_LOAD` stays for stores — a store engine question for the maintainer, parked with the store branch. No size change expected (dev-only code).

**S-52, the #4349 shape (built 2026-11-07).** `observeFlight` drops its D-26 arm: a render effect routed into a verdict lane observes the flight it reads plainly, as a memo reading the pair does, instead of reading the screen "as lane work" that holds nothing. The action ending inside the call is then held on the flight it just probed (F-2) rather than landing beneath it, so the effect is never re-run on the committed world with the published-inputs read that parked it. `[isPending(x), x()]` shows `[true, 41]` ahead in every shape and either read order; the landing reveals `[false, 42]`. One pin flipped; the refresh shapes (quiet re-ask, `affects`) are unchanged. A few bytes fewer.

**S-57 (built 2026-11-07).** From `laneStage` at the tail of the lane pass (first a core hook called from `recompute`'s NotReady arm, moved out of the core the same day; the wait list lives on the lane and the frame is found through `over`, which also dropped a `merge` append worth 21 B brotli of core): a pass that read this flush's staging, ran as a guess's lane's and went pending makes the flush join a frame waiting on that node (`Transaction.waits`, judged in `lanesBlocked`) and sets the lane `over` the frame — the lane's work reads the frame's staging as its own world (`frameRead`'s existing `over` arm) and holds while the frame does, so `label(5, 10)` is the one question and `ordinary = 10` reveals with the lane. Limits, each falling back to today's screen: the hold's own work (its parent already waits on the lane), a verdict lane's `latest`-only asker (the same sentence, not built), and a lane already over another live frame (`over` is one slot; #4577's matrix keeps its screens). No pin flipped. Size: see the commit.

**S-46's plain row (built 2026-11-07, after PR 4708).** A first pass under a probing pass is stamped CONFIG_MOUNT_AHEAD at `recompute`'s head; `frameRead` does not serve such a render effect the screen on its first pass (born held instead); `lanesBlocked`'s `mountPending` holds a verdict lane's reveal while a stamped mount in its nodes' frames still waits on a flight. `<Show>` and the compiled ternary keep the fallback through the flight and attach at the landing (the e1-3289-1831 pin flipped). First built as an owner-chain walk on every held read (+43 B core) and reverted for the stamp: +8 B core, +96 B isPending/latest. After the S-57 move the core floor is 7,423 B brotli (cap 7,430) and the compiled hello world 9,979 B (cap 9,980). Not built: the hop-less single-memo gate (PR 4708's target), the mount whose own pass reads another node ahead (PR 4708's exact scenario), S-53′. PR 4708's runner `gate` variant does not model the compiled ternary.

**D-34's `latest` clause (#4689, built 2026-11-07).** `keptGuess` (lanes.ts: the `marked` set a correction re-homes a shown guess into) read by verdict.ts's held arm: `latest` of such a node is its screen value while the hold is blocked, the staging once it lands. A signal and a superseded keyed row keep the displayed guess (seven pins flipped); a folded keyed arrangement still reads the world whole — kept per leaf it tore (#4336's store forms). S-44's frame 7 now matches; its frame 5 (`isPending` true for an outside input change under a guess) is still open. +25 B isPending/latest, 0 core.

**S-58, the gate with any hop count (built 2026-11-08, after #4717 merged; PR 4708 closed).** `keepReaders` (verdict.ts) no longer publishes a probe's held reader mainline when that reader's frame holds a born-held mount (`holdsMount`: a render effect stamped CONFIG_MOUNT_AHEAD, held, uninitialized, not behind a fallback); `mountPending` (lanes.ts) counts a mount under an open action as waiting. Both walk `aheadMounts`, a lane-module list of born-held mounts collected incrementally from the holds' node lists (one look per held node), so a seam without such a mount pays nothing (PR 4720 review). One-hop and zero-hop gates now keep the fallback through the flight like `<Show>` and the compiled ternary; S-53′ flips to standing with it. Runner `gate: "memo" | "cond"` variant; web pin `display-ahead-gate-hops.spec.tsx`. 0 B core, +57 B isPending/latest.

**S-58′, the mount whose own pass reads ahead (built 2026-11-08, the maintainer's table).** The born-held arm for a stamped mount moves ahead of `frameRead`'s verdict branch and `read`'s pending arm skips `observeFlight` for it: a mount a probing pass opened observes the flight on its first pass whatever it read ahead. `[latest(m2), m0()]` and `[latest(m0), m0()]` in one grouped effect now keep the fallback under every gate, as `<Show>` and a split leaf did. −2 B core, +7 B isPending/latest; row S-58 case ′ and the web pin `display-ahead-gate-leaf-reads.spec.tsx`.
