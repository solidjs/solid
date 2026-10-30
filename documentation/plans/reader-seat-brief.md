# Reader seat: the work, after the rulings review (2026-10-28)

Date: 2026-10-28. `next` @ `bc6377c19`. This is the brief every thread on
the async core works from. It supersedes the ruling list (§5) of the
reader-seat carve design; the design's model (§2) and table (§2.5) stand with
the changes in §4 below. Rules live in `packages/signals/docs/`; this file
cites them and does not restate them.

## 1. What the review found

The design asked eight rulings. Read one at a time against
`RULES-FUNDAMENTALS.md` and `RULES-DERIVED.md`:

- Six were already ruled. In three the code contradicts the rule (R2, R5,
  R7); in one a doc gloss misled (R3); in one a rule for optimistic lanes was
  never applied to verdict lanes (R4); one is D-2 as written (R6).
- Two were decided today (R1's scope, R8).
- One rule that was questioned, D-27, stands — and the reason it stands is
  now written down.

The pattern is the finding: the verdict path has drifted from the rules in
several places at once, and each drift was found by a generator case. That is
the case for the carve. It also makes P0 larger than the design priced.

| ruling          | outcome                                                                                                                                                                                                  | rule                        | where it is written                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------- |
| R1              | both orders show `[committed, true]`; not for the hold's own work                                                                                                                                        | A10, D-25, D-27, #3884      | D-25 (clarified 2026-10-28)                                          |
| R2              | the parent waits for a lane's flights; the lane never waits for the parent                                                                                                                               | F-6, F-1, F-3, 2026-10-01   | F-6 (amended 2026-10-28, `d1b938d3c`)                                |
| R3              | an untracked read of a live guess sees the guess, lane held or not                                                                                                                                       | F-11, A17                   | F-1 gloss (clarified, `40cde2cd6`)                                   |
| R4              | a pass reading two holds' display-ahead values is one reveal unit                                                                                                                                        | A15 #3335                   | D-25                                                                 |
| R5              | `latest()` opens no hold; the pass re-derives once at a park                                                                                                                                             | F-10, D-2, A10              | D-22                                                                 |
| R6              | E8 is an equivalence for render effects only                                                                                                                                                             | D-2, F-9                    | no change                                                            |
| R7              | `v:0 l:1` through a memo as inline; verdict work shows the screen for plain reads                                                                                                                        | F-6, D-25, D-26             | D-26, A15 note                                                       |
| R8              | `latest()` of a held first answer reveals; the plain read still throws                                                                                                                                   | D-22, F-9, S-40             | D-22, S-45                                                           |
| D-27            | stands: a verdict mount is mainline; a plain read is never display-ahead                                                                                                                                 | F-6, F-11                   | D-27, Lane vocabulary                                                |
| F-vlane         | today (rebuild §7 reading A): a fallback that went up beside the held frame stays there until the landing (#3540, #4337); the posture, not verdict-lane membership, is the rule; the #3884 clause stands | F-6, D-17, D-25 (#3884)     | D-25                                                                 |
| F-leaf          | today (rebuild §7 reading A): a pass that read a born node joins, a render effect included, and a node it creates is born held                                                                           | F-7, A29 ruling A, D-2, D-4 | D-27 (promoted from A29, 2026-10-28), A29 note                       |
| F-ahead-posture | today: a mount gated by a display-ahead read is mainline; it is not "ahead" by its creator's verdict posture — only lane work's children live in the lane                                                | F-6, D-27                   | no change — D-27 (clarified 2026-10-28) already rules it; rebuild §7 |

Every thread on this area reads, before anything else: the precedence rule
at the top of `RULES-FUNDAMENTALS.md` (a fundamental beats a derived rule
beats the archive; when code and a fundamental disagree, that is a finding
for the maintainer, not a ruling to pick), D-27's clarification (why the
fallback appears, and that it is correct), and discussion
[#3905](https://github.com/solidjs/solid/discussions/3905) (overlap means
merge; a node has one pending version; the escape hatches are `latest()` at
the read and `onFlush` at the write — not a new row in the slot table).

## 2. Bugs on `next` (P0a)

Each is one PR, one worktree, no shared git store, merged serially onto
`next` with a rebase. Each fix is minimal and correct; **no golfing** — the
carve deletes the code these fixes land in and pays the bytes back. Each pin
names its rule and, where the design has one, its seat row.

| #   | shape                                                                                                        | seam                                                                                                                                                                                                                     | rule            | row     |
| --- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- | ------- |
| R5  | #4365: `latest(a) + b()` in a plain flush computes `a` new beside `b` old; a throw sticks                    | `verdict.ts` `provisionalVerdict`, the `!probing` arm: drop `joinFuture(null)`, go through `watchVerdict`. Not at `stagedScreen`. Vl1 and Vl3 untouched                                                                  | D-22, F-10, D-2 | Vl2, W  |
| R7  | `[s(), L()]`, `L = memo(latest(s))`, shows `v:1 l:1` under an action holding `s`                             | lane read visibility for verdict-lane work: a plain read of a parent-held node serves committed and re-derives at the landing. Not at the memo                                                                           | D-26, F-6       | V1      |
| R8  | leaf `latest(m0)` under `Loading` keeps the fallback up when `m0`'s first answer landed in the action's tick | `verdictValue`/`heldLatest`: a held first answer is a produced value (`b`, not `f0`)                                                                                                                                     | D-22, S-45      | Vl4     |
| R4  | `[latest(x), latest(y)]` over two holds tears when the first hold's lane reveals                             | `verdict.ts` `route`: the `!passLane` short-circuit skips `linkLanes`; a second hold's verdict lane links like a second optimistic lane does                                                                             | A15 #3335, D-25 | D4 link |
| R1  | `[x(), isPending(x)]` on a mainline flip is held; the other order shows `[0, true]`                          | `markVerdictReader`'s "already JOINED → no posture" arm: on a first probe after a plain read, restart the pass once with verdict posture. Scoped by D-25: not for a pass born in the hold's world or re-run by its write | D-25, A10       | V1, B1  |

R7 and R8 are the generator's E9 differences and may already be filed among
#4374–#4378; check before filing. R4 and R1 need issues with the minimized
repro.

In flight already: #4362, #4363, #4364, #4367 (#4380), #4372–#4378. Merged:
#4355 (#4369), #4366 (#4381), #4379 (#4392). The #4365 fix in progress
should be checked against the seam above before it opens.

Each pin cites the rule by id in a comment and the scenario where one exists
(`S-45` for R8). `rules-index --check` must stay green.

## 3. Gate (P0b)

#4371 is on `next`. Add:

- Record/compare across two builds (`ASYNC_GEN_RECORD` / `ASYNC_GEN_COMPARE`):
  settle-point screens per case; zero new differences is the merge gate for
  every carve step.
- Pairs with their ruled expectations: E4 (`[a, b]` vs `[b, a]`: both show
  `[committed, true]`, D-25), E5 (inline probe vs probe in a memo, D-25),
  E8 as render effects only (D-2; the memo variant's D-2 difference is the
  expected baseline, not a failure), E9 with `v:0 l:1` (R7) and reveal (R8)
  as the expected screens.
- A CI job: seeds 3289, 91501, 7; 2,000 cases each; owned and unowned.

Baseline must be zero on E4/E5/E9 after §2 lands.

## 4. The carve: rebuild beside, then swap

> **Stopped (2026-10-29).** S1 failed its gate (the 50k differential and
> size) and the swap is not going ahead. S0 + M1 landed as a CI spec
> (#4438). `reader-seat-rebuild.md` §8 is the record and supersedes this
> section; what follows is the plan as it stood.

The model and the table stand; the plan is no longer the nine-step fold.
The design is `reader-seat-rebuild.md`: the seat and the slot table are
built _beside_ the existing deciders as `core/seat.ts` (+ the display-ahead
rows in `verdict.ts` and a `lanes.ts` core/layer split), reachable only
under `__TEST__`, and asserted against every decider on every read and
every pass; then one PR makes the seat live and deletes the deciders. Three
to five PRs (`reader-seat-rebuild.md` §5):

- **S0** — shadow under `__TEST__`, `INV-seat` pinned (a leaf never raises
  its world; posture is never inherited; the shadow agrees), differential
  on the suites, the oracle and 50k generator cases per seed (3289, 91501,
  7; owned and unowned; every pair). Every mismatch is a table error (fix
  the row, say so) or a bug on `next` (file it with rule id and row; do not
  fix in S0). Dist byte-identical.
- **S1** — the seat is live; `frameRead`, `bornInto`, `joinPass`,
  `readerSeesCommitted`, `stagedScreen`, `stagedRead`, `route`,
  `verdictValue`'s arms, `laneRead`'s arms and the duplicated hold arms of
  `read`/`serve` go. `t._verdict` (today `newLane(t)`) stays as the record;
  verdict passes are seated by posture, not `passLane`; verdicts have no
  node set (`latest()` is read-level, D-27). R7 is the semantic reason
  verdict work must not use the lane read path.
- **S2** — `lanes.ts` split into a sub-hold core and the optimistic layer;
  the isPending-only byte saving is **measured** (`scripts/size`), not
  estimated.
- **S3** — bits and hooks freed (`JOINED`, `STAGED_READ`, `LANE_READ`,
  `PROBED`; `FRAME_READ`+`SCREEN_READ` → one STALE bit).
- **S4** (deferred) — store shims replaced with the store twins (§6).

Gates: S0 differential zero; S1 and S3 floor scenario and compiled hello
world not above `next` post-P0; CodSpeed on every PR. Serial merges,
isolated worktrees — one PR lands at a time, each rebases, no two agents
share a git store (the #4366/#4373 incident).

The byte case is not the justification. The justification is the drift in
§1 and the bug concentration the audit measured. Say that in the PR bodies.

## 5. Exit for stable

- The 50k differential is clean on all three seeds at step 9.
- One week of generator CI on `next` with no new async issue.

Not "step 9 merged."

## 6. Out of scope, stated

- The store twins (O3/O5; E3's nine signatures). After steps 5 and 8.
- Hydration I27 (`CONFIG_IN_SNAPSHOT_SCOPE`).
- #3905 itself. The table's world should remain a reference to a hold record,
  not a closed enum, so a fourth world could be a row rather than a
  restructuring — but nothing is built for it.

## 7. Threads

- **A — rules and pins.** §2's R5, R7, R8, R4, R1 in that order (R5 is live;
  R7/R8 are generator-visible; R4/R1 need issues first). Serial.
- **B — in-flight fixes.** Lands #4362–#4378 serially with rebase; checks
  #4365's seam against §2.
- **C — gate.** §3.
- **Carve critical path** starts when A and B are merged and C baselines at
  zero on E4/E5/E9. Expect 4–5 thread-days before step 1 can start.
