# Consolidation — one implementation per rule

**Status:** design, 2026-09-16. Read-only pass over `next` at `5fa224a4a` (#3479 in). Nothing here is implemented. Written for a decision, not as a plan of record.

## 1. Why

The last two months' async fixes are ~four rules, each fixed several times at different sites:

| Rule (stated per outcome)                    | Sites that each decide it (enforced per site)                                                                                                                                                                                                                      | Fixes to the same rule                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Which value does a reader off the hold see   | `readNodeFast`, `read` fast block, `read` slow tail, `overrideRead`, `latestRead`, `gatedRead`, `laneReadsCommitted`, `readsHeldCommitted`, store `nodeValue` / `serveDataKey` / `pendingBackingVisible` / `heldFromReader` / `visibleOverride` / `optimisticView` | #3330 #3334 #3460 (two places) A29 (three sites) A28 (four sites) |
| Is this reporter live                        | `reporterBlocksSource` (one predicate, five stand-ins) + three independent _wake_ sites: `disposeChildren`, `recompute` tail, boundary reset                                                                                                                       | #3372 #3375 #3426 #3458 #3463 #3488                               |
| Dependencies are the committed frame's (A30) | `commitPendingNode` trim, `runEffect` trim, `heldTrims` (unchanged pass), `trimStaleDeps` at pass end                                                                                                                                                              | #3410 #3438 #3461 #3469                                           |
| Decided at the pass, known at the verdict    | `CONFIG_HELD_CHILDREN`+`_pendingFirstChild`/`_pendingDisposal`, `_modified`+`_queueStash`, `heldRevealed`, `_gatedSubs`, `heldTrims`, `_contested`, `_flushedStaged`                                                                                               | one bespoke mechanism per fix                                     |

Two instruments now exist that did not when those fixes were written: the posture matrix (621 enumerated cells: state × posture × reader → served value, entanglement) and the semantic fuzzer (#3446, 20 laws over generated graphs; baseline on this `next`: 984 pass / 4 fail / 12 policy). Both say "zero semantic change" is now a checkable claim rather than a hope, which is the precondition for any of what follows.

Three open violations are the concrete targets; each is a consequence of the site count:

- **O3, same-flush form** (fuzzer P1, cases 21/79; pinned `it.fails`): gate closes and source is written in one flush → the reporter's pass runs under the transaction and _stages_ its value, so A30 keeps its previous dep on the memo linked past `_depsTail` until commit; `reporterBlocksSource`'s deps scan walks the whole list, finds the kept dep, and calls the reporter live. The hold keeps the dep that keeps the hold. Rule 2's predicate reading Rule 3's deferral — verified by probe 2026-09-16 (pass ran once; not pending; `_pendingValue = "hidden"`; deps `[show, memo]`, tail after `show`).
- **O4 / S1** (pinned `it.fails`): after same-tick adoption, the signal's `unflushedValue` reads a stamped node with no stash as "flushed, held" and `latest`/`isPending` see a write no flush carried; the store's `flushedStaged` path does not. Two definitions of "unflushed". Rule 1.
- **O2** (recorded, not ruled): creation under a transaction / in boundary content escapes the hold while mainline creation is born held. One rule (A29) implemented at one of its sites. Rule 1 / Rule 4. A ruling question first — the consolidation makes whichever answer is chosen hold everywhere.

## 2. Inventory (as of `5fa224a4a`)

Condensed from a read-only walk; line numbers are approximate to ±5 and will drift.

### Rule 1 — value selection

Core, in evaluation order per site:

- `readNodeFast` (`core.ts` ~1699–1737): bail gate → `READ_SLOW` on any special mode (`latestReadActive`, `pendingCheckActive`, `_fn`, `_firewall`, override, snapshot, `activeTransition`, lane, `unflushedStaged && pending`, strict); else link; then **T1**: `!c || pending === NOT_PENDING || CHILDREN_FORBIDDEN || (stale && heldFromStale)` → `_value`, else `enterStagedRead; _pendingValue`.
- `read` fast block (~1739–1783): same eligibility, same **T1** verbatim.
- `read` slow tail (~1966–1995): `noCommitted && !c` → throw; `unflushedValue` arm (A28) → committed / stash + `markLateLinker`; then **T1 extended**: `+ laneReadsCommitted`, `+ (CONFIG_HELD_TRUTH && !latest && !AUTHORITATIVE)`, `+ !noCommitted` guard on the stale arm.
- `read` override arm (~1912–1938): active override, not authoritative, `!unflushedOverride` → tracked with lane/superseded → `overrideRead`, else `unwrapOverride`.
- `read` pending arm (~1821–1878): stale carve-out (`!UNINITIALIZED && !INPUTS_PUBLISHED && !laneLive && heldFromStale`) → committed; else throw / `laneSuspends`.
- `heldFromStale` (~1544–1555): foreign transaction → true, with side registration into `_gatedSubs` / `_asyncReporters`.
- `enterStagedRead` (~1578–1611): A29 entry; companion/verdict exemptions; born-held record for mainline creation.
- `unflushedValue` / `unflushedOverride` (~1640–1663): A28.
- `overrideRead` (`optimistic.ts` ~429–445): `stale && readsHeldCommitted` → `_value`; not superseded → override; stale foreign owner → override; else enter + pending/committed.
- `gatedRead` (~556–567), `laneReadsCommitted` (~573–614), `readsHeldCommitted` (`lanes.ts` ~143–154): lane-side "prefer committed" with `_gatedSubs` registration.
- `latestRead` (`verdict.ts` ~479–551), `flushedStaged` (~170–176), `computePendingState` (~259–314): verdict channels; re-derive visible override, unflushed, stale-foreign, shadow pending.

Store twins (`store/next/store.ts`, `optimistic.ts`): `heldFoldTransition` / `foreignHold` / `heldFromReader` (≡ `heldFromStale` for backings), `readSource` + `pendingBackingVisible` (≡ T1 extended for backings, plus draft / write-override / opt-family arms), `heldTruthMasked` (≡ HELD_TRUTH arm), `visibleOverride` (≡ override arm's `unflushedOverride` gate), `nodeValue` (untracked view: override → pending → backing), `serveDataKey` (per-key: length / opt / draft overlay, then `readNodeFast`/`readNode` tracked or `nodeValue` untracked), `optimisticView` (deep compose of flushed overrides).

**Duplicated conditions (each is a place a rule change must be threaded by hand):** T1 ×2 verbatim, T1-extended ×1 + store backing twin; stale-foreign → committed ×5; CHILDREN*FORBIDDEN → committed ×3; A28 unflushed ×6 call sites over two helpers (signal) plus `flushedStaged` (verdict) — and the store gets a \_different* answer for adopted nodes (S1); override-vs-truth ×3; HELD_TRUTH mask ×2; `enterStagedRead` on staged serve ×4.

### Rule 2 — reporter liveness

- Predicate: `reporterBlocksSource` (`scheduler.ts` ~1499–1542): DISPOSED → dead; ZOMBIE → walk to non-zombie parent, judge by its transaction vs verdict; boundary walk (`_collectionType & PENDING && !_initialized`) → dead (A33); `_pendingSources.has(source)` → live; deps scan through `_parentSource`/`_firewall` → live; `pending && _error.source === source` → live. Callers: `sourceObserved` → `transitionComplete`, `waitingTransition`, `enterWaiting`, `_endOptimism`, `_transitionBlocked`.
- Registration: `notify` (~897–931, INV-3), `heldFromStale`, store optimistic path.
- **Events that retire a reporter, each pushing `wokenTransitions` independently:** `disposeChildren` (`owner.ts` ~86, #3372), `recompute` tail (`core.ts` ~727, #3488), boundary reset → `wakeParked` (`boundaries.ts` ~319). Consumed in flush's `finally` on an otherwise idle pass (~892).
- **Verdict placement:** `transitionComplete` at ~774, after `runHeap(dirtyQueue)` and **before** effects; on incomplete: `stashQueues` (~805) parks the _entire_ render/user queues, `finalizePureQueue(null, true)`, return. This ordering is O3's same-flush form.

### Rule 3/4 — deferred decisions (one structure each today)

| Decision recorded at the pass      | Carrier                                                                       | Applied at commit                                                               | Dropped at park                                           |
| ---------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Staged value                       | node `_pendingValue`, `t._pendingNodes`                                       | `commitPendingNode(s)`                                                          | kept (re-stamped)                                         |
| Children of a held pass            | `CONFIG_HELD_CHILDREN`, `_x._pendingFirstChild/_pendingDisposal`, zombie heap | `_dispose(zombie=true)` in `commitPendingNode`                                  | zombie heap cancelled if batch===txn; immediate on re-run |
| Effect run owed                    | `_modified`, `_queueStash`                                                    | `restoreQueues` → `runEffect` (re-enqueues if `_valueTransition` open)          | stashed whole-queue                                       |
| Deps trim (A30)                    | `_depsTail`, module `heldTrims[]`                                             | `commitPendingNodes` drains; `runEffect` trims; per-node in `commitPendingNode` | `heldTrims.length = 0`                                    |
| Gated / stale readers to replay    | `t._gatedSubs`                                                                | `finalizePureQueue` enqueue+clear                                               | kept; merged on merge; adopted from ambient               |
| Held-truth reveal                  | node `CONFIG_HELD_TRUTH`, module `heldRevealed[]`                             | post-`_resolveOptimistic` `insertSubs`                                          | never (park never commits)                                |
| Cross-txn effect write             | `t._contested`                                                                | `finalizePureQueue` enqueue                                                     | merged                                                    |
| Held rewrite's flushed value (A28) | `_x._flushedStaged`, module `unflushedRewrites[]`                             | cleared at flush start                                                          | n/a (tick-local)                                          |

Ambient `_batch` and a live `Transition` already share the same field set — the "cargo" concept exists; it has no lifecycle API.

## 3. Shape

Three moves, ordered by blast radius. Each is zero-semantic-change by construction _except_ where it closes a pinned violation, and each is gated on the matrix, both oracles, and the fuzzer baseline before and after.

### 3a. Rule 2 — one retirement event, one verdict placement

**`retireReporter(reporter)`** — a single entry point that the three wake sites call instead of pushing `wokenTransitions` themselves. Body is today's dedup'd push + `schedule()`, keyed on `reporter._transition`. Pure refactor; the three call sites lose their inline copies.

**Same-flush O3.** A first reading of this case blamed effect parking (the run stashed, never proving itself dead). The probe says otherwise: the compute ran, staged `"hidden"`, and the effect is judged live only because `reporterBlocksSource`'s deps scan reads the dep A30 deliberately keeps linked past `_depsTail` for the commit to trim. Two rules, one wrong answer; the fix is in the predicate, not the scheduler:

_Liveness reads the pass's deps, not the committed frame's._ For a reporter with a staged pass (`_pendingValue !== NOT_PENDING`), the deps scan stops at `_depsTail` — the dependencies this pass actually read. A kept tail is the committed frame's business (A30: a write to a dep the committed value still derives from must reach the node) and says nothing about whether the reporter still observes the flight. One predicate, one line, and it is the `readerLive()` consolidation's first concrete content: the predicate must know which frame it is asking about.

Case 21 then resolves without any parking change: the pass no longer reads the memo → not live → the transaction completes at the verdict already in place, the same flush. Stash-by-world (`#3407` applied to `stashQueues`) is _not_ needed for this and should not be done on its account; it remains a separate question (§6).

### 3b. Rule 1 — shared predicates, then one `serve`

Not a single `serve()` first. The perf constraint is hard and measured (2026-09-15): `readNodeFast` past ~460 B of bytecode, or a call on its staged branch, costs 10–15% on propagation; `setSignal` past the inline budget costs 10–20% on the write loop. The fast path must stay a tiny inlinable guard that handles the trivial case and bails. Value selection therefore has exactly **two** implementations by design — the fast ternary (T1) and one slow `serve` — and the target is to make the third-through-eleventh disappear, not the second.

Step 1 — **shared predicates**, no behavior change: `readerSeesCommitted(el, c)` (= T1-extended's disjunction, including HELD_TRUTH and lane arms), `visibleOverride(el)` (already exists store-side; core's override arm inlines the same test), `unflushed(el)` with **one** definition used by `unflushedValue`, `flushedStaged`, `pendingBackingVisible` and `nodeValue`, and `readerClass(ctx)` — the three ways a reader relates to a hold, today spread over three unrelated flags: **derives** (a tracked pass: joins, or is born held), **displays** (a render/user effect's apply: sees the committed frame now, replays at the reveal — `_gatedSubs`), **observes** (verdict pulls `_verdictPull`, companions `_parentSource`: mirrors of the flushed world, never join). Direct-commit readers (`CONFIG_DIRECT_COMMIT` — `resolve()`/`until()`) are **not** observers: they are derivers with a tunnel _inside their own transaction_ (the arm that lets a hold not deadlock on its own acknowledgment), and from mainline over a **foreign** hold they wait for the commit like any deriver — #3492 pins that a mainline `resolve()` must never resolve with an unrelated action's unrevealed frame, which is exactly what exempting them from born-held (#3490) leaked. `enterStagedRead`, `heldFromStale` and `recompute`'s commit arm each test a different subset of these flags today. This step closes **S1**: "unflushed" = staged outside a flush and not yet carried by one, whatever the stamp — one predicate, so the signal and the store cannot disagree. Mechanism: `queuePendingNode` outside a flush already sets `unflushedStaged`; a per-node bit set there and cleared by the carrying flush (`resyncUnflushedCompanions` walks the batch's pending nodes — it is already the flush-start hook) makes adoption irrelevant to the test.

Step 2 — **`serve(el, reader)`** as the slow tail: `read`'s slow arms, `overrideRead`, `latestRead`'s value selection and the store's `nodeValue`/`readSource` value decision call it; the store keeps its structural arms (draft overlay, length, chained, opt family) and delegates the _value_ decision. `gatedRead`/`laneReadsCommitted`/`readsHeldCommitted` fold into `readerSeesCommitted` with their `_gatedSubs` registration as a side effect of the predicate, as `heldFromStale` already does.

Bytes: expect roughly neutral to slightly positive. Three mechanism-preserving consolidations this month came back +13…+85 B; the pitch is one site per rule, not size.

### 3c. Rule 3/4 — cargo lifecycle

Give the shared batch/transaction field set the two functions it lacks: `applyCargo(t)` (today's `commitPendingNodes` + `_gatedSubs` replay + `heldRevealed` wake + `heldTrims` drain + zombie dispose, in the order `finalizePureQueue` runs them) and `dropCargo(t)` (today's park path: `heldTrims.length = 0`, zombie cancel, `stashQueues`). `heldTrims` and `heldRevealed` move from module arrays onto the transaction they belong to (a module array is only correct while one transaction commits at a time, which `finalizePureQueue` guarantees today — by accident of sequencing, not by construction). New deferrals then have exactly one place to go.

This is the largest move and the one with the least direct violation behind it; it can wait for the first new "decided at the pass" fix to motivate it, or be done when 3a/3b have settled.

## 4. Verification protocol (per PR)

1. `tests/visibility-oracle.test.ts`, `-store.test.ts`: every cell unchanged.
2. `tests/visibility-oracle-posture.test.ts`: 621-cell report diffed against the pre-change report; the only permitted diffs are the cells a pinned violation says should flip.
3. Fuzzer (#3446) campaign, same seed: baseline 984 / 4 / 12; permitted change is the pinned violation's cases.
4. CodSpeed on the PR; write-loop benches (`update1to1`, `update1to1000`, `diamond`, `avoidable`) alternating pairs; `--print-bytecode` for `readNodeFast`, `read`, `setSignal`, `recompute` before/after.
5. Size: floor and the nine brotli scenarios; report the delta, do not sell it.

## 5. Sequencing

1. **3a** — `retireReporter` + the deps-scan bounded by `_depsTail` for staged passes. Closes O3's same-flush form (fuzzer 4 → 0 expected). Smallest blast radius; touches `reporterBlocksSource` and three wake sites.
2. **3b step 1** — shared predicates incl. one `unflushed`. Closes S1. Touches `core.ts` read arms, `verdict.ts`, store `store.ts`; no fast-path change.
3. **O2 ruling**, then whichever answer, applied once via `enterStagedRead` (born held everywhere: the `creatingPass` prototype, +83 B) or via `recompute`'s create arm (escapes everywhere: retire the mainline born-held form).
4. **3b step 2** — `serve`.
5. **3c** — cargo lifecycle, when motivated.

## 6. Open questions for the maintainer

- **Stash-by-world (not required for O3):** `stashQueues` parks the whole render/user queue when a transaction parks, including effects dirtied only by a mainline write in that round. #3407 read literally says those belong to mainline and should run. Not a violation anyone has pinned; flagged as a candidate rule to make explicit, not a change to make now.
- **O2:** born held everywhere, or escapes everywhere. Either is consistent; the current state (mainline held, transaction/boundary creation escapes) is the only inconsistent option. **Insight from #3482 (2026-09-16):** born-held bundles two decisions that should be separate — _ownership_ (the created value belongs to the transaction it derived from) and _application_ (skip the effect's first run, replay at commit). The ownership half was right even in #3482's misuse: the post-`await` `until()` _was_ the action's reader, and born-held correctly made it the action's. What deadlocked was a reader created in the wrong posture (post-`await`, mainline by mechanism) over its _own_ action's hold — and from mainline, waiting for the commit is the correct behavior for that reader class (#3492: a mainline `resolve()` over a foreign hold must not see the held frame; the direct-commit tunnel is only for a reader inside its own transaction). So born-held was right on both halves there; the misuse is what put the reader in a posture where "right" deadlocks, and the docs/lint are the fix. "Born held everywhere" remains the recommendation for O2's actual question — creation _under_ a transaction / in boundary content — ownership and application both following derivation, as mainline creation already does (the `creatingPass` prototype, +83 B). The `CONFIG_DIRECT_COMMIT` exemption proposed in #3482 is declined on the evidence, not on taste. A further argument for posture-independence: the posture is exactly what users get wrong (`await` vs `yield`), so a rule that changes with the posture turns a documentation slip into a semantic one.
- **`readsHeldCommitted` and the lane arms:** folding them into `readerSeesCommitted` assumes lanes are "a transaction with an override"; if lanes are meant to diverge from transactions later, keep them as a separate predicate that `serve` consults.
- **Post-`await` posture:** pinned by #3492 for the direct-commit readers (three postures: own step, own `await` continuation, foreign mainline) as a standalone file. Worth folding into the matrix as a posture (`ownActionAfterAwait`) so the other reader kinds get the same rows; not urgent.
- **Loosening:** once `serve` exists, each of its arms is a constraint with a measurable blast radius (flip it, rerun the matrix). Candidates surfaced so far: O2 (two born-held forms → one), the `CONFIG_HELD_TRUTH` mask (one arm, two sites), and the stale-foreign carve-out in the pending arm (`INPUTS_PUBLISHED`), which exists to serve one shape (#3305).
