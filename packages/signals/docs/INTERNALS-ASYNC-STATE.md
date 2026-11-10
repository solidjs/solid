# Async/Transition/Lane State Model — Working Notes

> **Index:** every rule ID cited from `src/` or `tests/` — this file's A/B/C/V ids, the INV/RUL/R/§ vocabularies of the internals and rules-mining docs — is listed with status, definition and citations in [`RULES-INDEX.md`](./RULES-INDEX.md) (generated; `node scripts/rules-index.mjs`). IDs are never renumbered.

Living document for the pending/transition/optimistic-lane machinery in
`src/core/`. Captures the state model, the invariants we believe hold (with
confidence levels), and the assumptions/decisions made while reviewing. The
companion spec propositions (tier A/B/C) build on this.

Status: **working notes** — updated as understanding is verified. Anything
marked `[assumed]` has been inferred from code, not confirmed by a design
ruling. Anything marked `[ruled]` cites the decision.

## 0. L2 — the hold model (2026-10-04): what replaced §1–§4

**Status: `[ruled]`** (the carve, 2026-09-30 → 2026-10-03; `documentation/plans/size-reduction-carve-step1.md` sections 8, 10, 16–21, 27–29, 31–35, 38–41 are the dated record). §1–§4 below describe the implementation this file was written against — transitions with `_asyncReporters`, lanes with `_overrideValue`/`signalLanes`, companions, the store's `_firewall` chain — and are kept for the reasoning record. They are not the running code. The invariants of §5 that name those fields are retired with them; the rules they protected are restated in `SPEC-ASYNC-SEMANTICS.md` ("The hold model — L2") and pinned by the tests named there.

**State.** A node is `_value` (committed) or `_pendingValue` (staged for this flush). Cold state lives on the node's extension `_x`: `_transaction` (the `Transaction` holding it, `CONFIG_HELD`), `_lane` (a lane's value for it, `CONFIG_OVERRIDE`; `CONFIG_GUESS` for a written guess), `_q` (the question a flight answers — A18 provenance), `_reask` (a quiet re-ask's classification, A19 exc. 2), `_marks` (`affects()` count), `_pendingSources`/`_inFlight`/`_error` (the async core, unchanged). Per-pass flags on `_flags`: `REACTIVE_JOINED` (the pass read the future), `REACTIVE_FRAME_READ` (a stale reader, re-derived at the landing), `REACTIVE_STAGED_READ` (the pass read this flush's staging as the screen), `REACTIVE_LANE_READ`/`REACTIVE_SCREEN_READ` (lane work), `REACTIVE_PROBE_UNANSWERED` (a verdict probe answered before the flush had a transaction), `REACTIVE_REASK`, `REACTIVE_ZOMBIE` (a parked frame's child).

**Transaction** (`core/scheduler.ts`): `_nodes` (what it holds), `_reruns` (stale readers to re-derive at its landing), `_queues` (stashed effect runs), `_open` (actions running in it), `_lane`/`_parent`/`_verdict`/`_shown`/`_held` (lanes), `_into` (merged — `resolveTx`), `_marks`. The flush's seam (`settle`): run the heap; the lane corrections; `joinFuture` decided the flush's transaction (a pass went pending, a read of a held node joined); every staged node of the flush is held (`holdNode`) with its pass's frame (`holdFrame`; its members are flagged `CONFIG_HELD_FRAME` until their commit — born into the transaction, `bornInto`: they read its world whichever flush runs them, #4010) — a loading source is nobody's frame, a tick that nets to the committed value is no proposal (A34 (2)) — and the store holds the node-less stagings (`_storePark`); the lane seams; every transaction no frame waits on lands (`land`: `commitPendingNode` over `_nodes`, `reruns`, `releaseQueues`); the store folds (`_storeCommit`). `blocked(t)`: an open action, or a pending node it holds that a frame reader observes (`blockedBy`/`onScreen`), or a lane under it blocked. Membership is one relation (`merge`), so the direction rule (SPEC "The hold model — L2", 2026-10-06: a hold never waits on work that has never committed) is implemented where a node's commit status is checked — the loading-source skip, the boundary scope, the born-held enqueue and landing — not by the transaction.

**Read** (`core/core.ts`): the fast block for a plain signal; `frameRead` (a render effect, a verdict reader, lane work — the screen, `staleReader`; not a reader born into the node's transaction, `bornInto`: it has no screen); `joinPass` (a held node's staging — the pass is the transaction's); `stagedRead` (this flush's staging as the screen); a pending node served committed to a frame reader (`_observeFlight` — the verdict module's hook). `recompute` decides the pass's frame after the pass (`CONFIG_STAGED`, held children, zombies).

**Lanes** (`core/lanes.ts`): `optimisticWrite` → `pendingGuesses` → `applyGuesses` at the seam opens the lane under the frame's transaction; `laneValueOf`/`display`/`guessedValueOf`; `enterLane`/`laneRead` (lane work; untracked reads enter); `laneWrite` (a landing on a lane's node — `stale(el, question)` holds an older answer beneath the guess, `supersede` resolves a differing truth); `laneOutcome`; `dissolveLane`/`endLanes`; `laneSeam` (blocked parks, unblocked shows); `_laneSeams` (passes that read a parked staging re-derive); `linkBlocked`; `_laneRebase` is the store's (keyed re-base of an older truth beneath an arrangement guess).

**Verdicts** (`core/verdict.ts`): one cold path off `read` while a window is open (`verdictValue`); `verdictRead` routes the pass into the holder's verdict lane; `provisionalVerdict`/`watchVerdict` for a staging not yet held; `heldNotFinal`/`quietPending`/`pendingVerdict`; `observeFlight`; `_witnessMark` for the store's `affects()`.

**Store** (`store/*`): the target (`target.ts` — `v`, `pb`, `k` the container node, `n` leaves, `h` presence, `dk` deep, `fam`), `readSource` (which backing a read serves — the key is the hold's unit), `pullFamily` (the firewall as a pull), `holdWithDerive`, `stageOn`/`_storePark`/the fold queue (`queueFold`/`drainFolds`/`foldTarget`), `optimistic.ts` (guesses on lanes, `LaneView`, `_laneRebase`), `projection.ts` (`runProjectionComputed`, `wakeFamily` via `propagateStatus`, `settleFamily`, `errorFamily`), `affects.ts` (the store half of marks).

## 1. Node state fields

A `Signal`/`Computed` participating in async/transitions carries:

| Field                  | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Written by                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_value`               | Committed, visible value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `recompute` (create/effect paths), `commitPendingNode`, `resolveOptimisticNodes`, `asyncWrite` (lane branch)                                                                                                                                                                                                                                                                       |
| `_pendingValue`        | Transition-held next value; `NOT_PENDING` sentinel when absent (one meaning — a pending commit; revert targets were eliminated 2026-07-07b, §5e)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `setSignal` (non-optimistic), `recompute` (held branch), `asyncWrite` (override-active branch)                                                                                                                                                                                                                                                                                     |
| `_overrideValue`       | Optimistic override; `undefined` = not an optimistic node, `NOT_PENDING` = resting optimistic node, else = active override. A user write of literal `undefined` is stored as the `OVERRIDE_UNDEFINED` stand-in so it can't erase the brand (#2898); sites surfacing the override VALUE unwrap via `unwrapOverride`, slot identity tests stay raw                                                                                                                                                                                                                                                                                                            | `setSignal` (optimistic branch), `recompute` (lane-corrected), `resolveOptimisticNodes` (clears to `NOT_PENDING`)                                                                                                                                                                                                                                                                  |
| `_affectsCount`        | Live `affects()` mark refcount: non-zero forces the node's verdict to `true` and propagates pending downstream via the node's sentinel (declared motion, §5g). Carried by source nodes, store leaf/track/has nodes, and per-record `$AFFECTS` carriers                                                                                                                                                                                                                                                                                                                                                                                                      | `registerAffectsMark`/`markAffects` (+1, staged with the current transaction or a scope entry), `releaseAffectsMark` (−1 at settle / flush end; settles the sentinel when the count zeroes)                                                                                                                                                                                        |
| `_affectsSentinel`     | The mark's identity on the pending-source rails (lazy): held in downstream `_pendingSources` like a real in-flight source, never a re-ask, never self-pending, branded with `_affectsFor` so settlement checks skip it                                                                                                                                                                                                                                                                                                                                                                                                                                      | `getAffectsSentinel` (async.ts)                                                                                                                                                                                                                                                                                                                                                    |
| `_reask`               | Question-scoped classification of the CURRENT pending window: `true` = the in-flight recompute is a re-ask of the same question (refresh with no input value change) — quiet, not pending (§5g). Meaningless while not `STATUS_PENDING`                                                                                                                                                                                                                                                                                                                                                                                                                     | `recompute` (from the `REACTIVE_REASK` flag), cleared by `clearStatus` and by value-change notifications (`insertSubs` clears the flag pre-recompute)                                                                                                                                                                                                                              |
| `_loading`             | Open commit-#0 loading window (`[ruled]` A27): the node was born committed with a `loadingValue`/`seedLoadingValue` and its first real answer hasn't landed. While set, `handleAsync` serves `_value` instead of throwing `NotReadyError`, no transition is initiated or joined, and the verdict path never consults it (quiet by construction — the flag is invisible to `newQuestionInFlight`). Cleared by the first landing on any path (sync return in `recompute`, sync-resolved thenable, first iterator yield, `asyncWrite` settle); a real error leaves it set — errors answer reads but don't enter the lineage, so a retry serves commit #0 again | `computed()` (set at birth), `recompute`/`handleAsync`/`asyncWrite` (cleared on landing)                                                                                                                                                                                                                                                                                           |
| `_statusFlags`         | `STATUS_PENDING` / `STATUS_ERROR` / `STATUS_UNINITIALIZED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `notifyStatus`, `clearStatus`, commit paths                                                                                                                                                                                                                                                                                                                                        |
| `_error`               | Current error (`NotReadyError` for pending, `StatusError`-wrapped for real)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | compute catch, `notifyStatus`                                                                                                                                                                                                                                                                                                                                                      |
| `_pendingSignal`       | Lazily-created companion: boolean "is pending" signal for `isPending()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `getPendingSignal`, updated via `updatePendingSignal`                                                                                                                                                                                                                                                                                                                              |
| `_latestValueComputed` | Lazily-created companion: shadow computed for `latest()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `getLatestValueComputed`, written via `syncCompanions`                                                                                                                                                                                                                                                                                                                             |
| `_parentSource`        | Companion → owner backlink (also store leaf → firewall chains)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | companion creation                                                                                                                                                                                                                                                                                                                                                                 |
| `_optimisticLane`      | Lane this node currently belongs to                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `assignOrMergeLane`, cleared by `resolveLane` (stale), `resolveOptimisticNodes`, `cleanupCompletedLanes`                                                                                                                                                                                                                                                                           |
| `_transition`          | Transition holding this node's pending state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `initTransition`, `reassignPendingTransition`, cleared by `resolveOptimisticNodes` and the `commitPendingNodes` loop (#3140/#3143: a stamp never outlives its transaction — a committed value needs no affiliation, and a dangling stamp let any later write, even a value-equal no-op, resurrect the finished transaction; `initTransition` refuses `_done === true` as the belt) |

Semantics of the `(_pendingValue, _overrideValue)` pair for an optimistic node
(see §5e — revert targets were eliminated 2026-07-07):

- `(NOT_PENDING, NOT_PENDING)` — resting optimistic node, behaves like a plain node.
- `(NOT_PENDING, active value)` — active override; readers see the override, `_value` is untouched.
- `(held value, active value)` — fresh authoritative value arrived while the override displays;
  it holds in `_pendingValue` and elevates to `_value` on its own transition's commit. Reverting
  is a pure drop of the override — `_value` is already correct. (Verdict: pending iff the held
  value _differs_ from the displayed override — a matching confirm reveals nothing; §5g.)
- `(held value, active value)` **+ `CONFIG_OVERRIDE_SUPERSEDED`** (#3331, A18 supersession) — the
  held value came from the node's source — its own async landing, or a sync recompute driven by
  an upstream change — and differs from the override. The pair is read two ways: tracked readers
  (`read` with a computed observer) get the held value via `GlobalQueue._overrideRead` (the engine's selection for every tracked read of an override; #3479 folded `_supersededRead` and the lane outside-view rule into it) — the
  graph derives from the truth — while untracked reads and the applied frame still get the
  override. The bit is set by `supersedeOverride` (optimistic.ts), reached from every own-source
  publish under an override: `asyncWrite`'s override branch and both of `recompute`'s
  (differing value → the staged branch; equal value → the "unchanged" branch, where the hook also
  owns the authoritative-observer wake, #3164/#3303). Cleared by a later equal arrival on the same
  node (un-supersedes: the override is the graph's value again), by a fresh `optimisticWrite`, and
  by `resolveOptimisticNodes` — which, seeing it, skips the revert-time `insertSubs(node, true)`
  re-derive: the graph already moved. Setting it also demotes the node's lane cascade (DFS over
  subs: clear `_optimisticLane`, drop from `_pendingAsync`) and notifies subs on the plain
  channel, so the corrected derivations are transaction work held to the commit, not lane work
  applied ahead of it; the override's own downstream flight, when it lands, finds no lane and no
  observer and is inert. **Ordering** (`_overrideTime`, stamped with `clock` at the optimistic
  write): a sync recompute in the same tick as the override derives from that batch's staged
  inputs — truth that predates the override — and does not supersede; the async landing path has
  no such case (a landing is always a later tick). **Provenance** (`_overrideStamp`, stamped with
  the scheduler's `origin` at the optimistic write, and renewed to a newer `origin` by a same-value
  write on the fast path — the newer action re-asks the question without writing a new override): `origin` is the invocation sequence of the
  action whose ambient window is running — `action()` sets it for each slice (the first slice's
  window runs to the scheduled flush; `flush()` clears it at the end of every drain) — and
  `handleAsync` captures it per flight; `asyncWrite` re-arms the flight's capture for the landing's
  synchronous propagation (including the flush it runs), so a sync wrapper recomputing under the
  landing derives under the flight's provenance and flights it registers inherit it. A differing
  arrival with `origin` older than `_overrideStamp` is a stale question (an earlier action's
  refetch landing after a later action's override on the same node — the two transactions have
  merged, so `_overrideOwner` cannot tell them apart) and returns before setting the bit: staged,
  held to the commit, unobservable. `origin === 0` (mainline) is never stale.
  **Store twin:** a derived optimistic store's truth lands on its nodes through `setSignal`
  under `projectionWriteActive` (the authoritative posture); on an override-covered node that
  dispatches to `GlobalQueue._landOnOverride` (optimistic.ts) — stage the truth whatever its
  relation to the committed value (a landing equal to committed still differs from the override),
  sync companions, then `supersedeOverride`. `supersededRead` serves the truth staged OR committed:
  a mainline landing commits at the head of its flush, ahead of the heap run, and the override
  drops only at the batch's end — in that window the graph must not fall back to the override it
  has left (the store's async-derive landing reaches it; a node's `asyncWrite` rides its flight's
  transaction and never does). Pinned in `tests/store/lane-authority-twins.test.ts`.

## 2. Lanes (`lanes.ts`)

- One lane per optimistic _source signal_ (`signalLanes` WeakMap), reused across writes to the same signal. Union-find merging (`_mergedInto`); merges move `_pendingAsync` and effect queues into the root.
- `_parentLane`: companion nodes (`_pendingSignal`/`_latestValueComputed`) get _child_ lanes that intentionally do **not** merge with the parent (`assignOrMergeLane` parent/child carve-out) so `isPending` effects can flush before the parent's async settles. The parent is read from the owner's `_optimisticLane` when the companion lane is created (`getOrCreateLane`), so every path that assigns a node's lane and pokes its companions must assign first: `notifyStatus` does (#3379 — a memo made pending by propagation before it rode the lane got a parentless companion lane, which the indicator's other dep merged into the held lane; `isPending` then waited on the async it reports).
- A subscriber whose lane was merged is followed to its root (`findLane`) like any other and goes through the same parent/child check (#3409). The earlier shortcut — a merged `_optimisticLane` is stale, take the source lane — skipped that check: an `isPending(() => [a(), b()])` reader of two async siblings of one optimistic value got the two companion child lanes (siblings, so they merge), and the parent lane's next notification then moved it onto the held parent, where its verdict waited on the async it reports while `isPending(a)` and `isPending(b)`, each on one unmerged child lane, flipped at once.
- Lane lifecycle: created on optimistic write → nodes join via `insertSubs(node, true)` → `assignOrMergeLane` → lane-routed effects run when the lane is not held (`runLaneEffects` → `laneHeld`) → cleaned up by `cleanupCompletedLanes` when the owning transition completes (or when orphaned, `_transition === null`).
- `_pendingAsync` add/delete sites: added in `recompute`'s async catch under a lane (core.ts ~264), removed on async resolution (`asyncWrite`, async.ts ~214) and on lane-corrected recompute (core.ts ~254). The set records the async the lane _owns_, not what holds it.
- Replay gating (#3330): `laneReadsCommitted` hands a lane reader the committed `_value` of a staged node and records the reader in the batch's `_gatedSubs` for a re-run at commit — only when `_pendingValue !== _value`. A lane recompute that already published the value (INV-11) leaves the two equal; recording the reader anyway replayed its effects against an unchanged frame.
- The outside view of a held lane (#3460, `readsHeldCommitted`, lanes.ts): a held lane is a transaction seen from the outside. A render effect OFF the lane (`currentOptimisticLane` null or another root) that reads a value the lane is revealing — an override (`read()`'s override arm → the engine's `_overrideRead`, one hook for every tracked read of an override, which also carries the A18 supersession selection) or a `latest()` shadow (`latestRead`) — is served the committed `_value`, publishes now, entangles nothing (a sync write is never held by a lane, exactly as a stale reader of a held transaction), and is queued on the lane's own render queue (`_effectQueues[0]`, `enqueueSub` unless disposed) so the release re-runs it — `runLaneEffects` at the reveal, or `cleanupCompletedLanes` at the owning transaction's commit. The committed value is what is on screen: the lane defers its own readers' runs, so the speculative value is nowhere visible until the release. A reader ON the lane computes the lane's reveal and takes the lane's value as before; the reader's demotion at body-end (A18, `endOptimism`) is unaffected — the lane is no longer held, so the override is the visible value. Was: only a reader under ANOTHER lane got the committed shadow; a mainline reader — mounted mid-hold (`Late: 1` beside the deferred `Value: 0`) or re-run by an unrelated sync write — showed the speculative value. Engine-owned: a lane implies the engine, so the plain core pays one `CONFIG_HAS_LANE` test. Pinned: `tests/lane-outside-view.test.ts`.
- Late readers of a transaction hold (#3330 store twin → general): the stale-reader term of `read()`'s value selections (`heldFromStale`, core.ts — the fast paths and the slow path) serves a render effect the committed `_value` of a node another live transaction staged, and records the reader in that transaction's `_gatedSubs`. The commit is silent (the staging walk was the notification), so a reader that linked after the walk — an effect created during the hold, a store key first read under it — would otherwise show the old value past the reveal. An effect the transaction itself computed (`_valueTransition` resolves to it) is not recorded: it re-derives at the commit through its parked run or the contested re-derive (#3322), and a replay would publish the frame twice. Pinned in `tests/spec-async-semantics.test.ts` ("a reader that links to a held node during the hold"). **First observer (#3458):** the stale reader's carve-out joins the transaction's reporters for the node when it has an entry (#3374); when it has none — the flight was up but nobody displayed it (`b` in flight beside the observed `a`), and this reader is the FIRST to — `heldFromStale` notifies the pending status up the reader's queue chain under the transaction (`runInTransition(txn, () => c._queue.notify(c, STATUS_PENDING, …))`), the one registration site (INV-3), so the transaction now waits on the flight it revealed a reader of. Before, the join found nothing, the transaction was judged complete on `a` alone, and revealed `Count: 1 | A: 1` beside the committed `B: 0`. A collecting boundary on the chain consumes the notification as ever (A33). Pinned: `tests/first-observer-stale-reader.test.ts`.
- Hold rule (`laneHeld`, #3289; per-node lookup #3335): a lane is held iff some `_pendingAsync` node is in the `_asyncReporters` of **any live transaction** (`waitingTransition(node) !== null`) — i.e. a render effect observed it pending and no boundary consumed the status (INV-3, the one registration site). Not "its transaction's": lanes merge across transactions (#2912) and the merged root's transaction recorded only one member's observations. Same rule as `transitionComplete`: unrendered async and fallback-caught async hold nothing. The two facts arrive in either order (a node created by the lane's own reveal is observed first and stamped on a later re-ask), which is why the hold is a predicate over both records rather than a registration. The predicate prunes as it reads (#3426): `waitingTransition` asks `sourceObserved`, the same live-reporter test `transitionComplete` runs, so a reporter that died (disposed, behind a fallback, no longer reading the node) stops holding the lane at the next check. A live action parks its transaction without a verdict, so this is the only prune an optimistic frame whose last async reader unmounted mid-action ever gets — the lane used to hold on the dead registration until the flight nobody observed landed.

## 3. Transitions (`scheduler.ts`)

- Created by `initTransition` on the first transition-worthy write; at most one `activeTransition` per flush; concurrent ones merge (`mergeTransitionState`, `_done` forwarding pointer).
- `initTransition` ends by scheduling a flush: the ambient window is one flush by definition, but parking is flush-driven, so a transaction opened with no writes (an action that only awaits) would otherwise leave `activeTransition` and the adopted batch armed across the async gap, capturing the next unrelated work to arrive — the A26-rejected behavior (#3141).
- `_asyncReporters: Map<source, Set<reporter>>` — which computeds are blocked on which async sources. **Entries open only from `GlobalQueue.notify` during render-effect status notification** `[ruled — async-registration-invariants rule]`. One reporter may join an entry that already exists from elsewhere: a stale reader served a pending node's committed value by the reveal carve-out (`heldFromStale`, §3 below) joins that node's entry (#3374) — it observes the flight, so it holds the transaction on it the way the reader that opened the entry did, and dies with disposal the same way (`reporterBlocksSource`: the read linked the node as a dep).
- `_pendingNodes` — nodes whose `_pendingValue` commits when the transition completes (`commitPendingNodes` → `commitPendingNode`).
- Held children (#3404): a node's owned children (nested effects, memos, `onCleanup` registrations) belong to the frame that committed them. `recompute` defers the previous pass's children as zombies (`_pendingFirstChild` / `_pendingDisposal`, rendering mainline until `commitPendingNode` disposes them — or until the owner's own death, #3561: `disposeChildren`'s `self` path drains the parked frame before setting `REACTIVE_DISPOSED`, the flag the commit's drain returns on; a rerun's `disposeChildren(el)` leaves it parked) unless `CONFIG_HELD_CHILDREN` is set — the pass that built them never committed (a staged value, a pending window, a run under a held transaction), so no frame ever showed them and they die on the spot. Set at recompute's tail whenever the pass's result waits on a commit, cleared by `commitPendingNode`. A `_transition` stamp alone says nothing about the children: status propagation stamps a parked dependent without recomputing it, so its children are still the committed frame's, and disposing them when the source lands ran their cleanups mid-hold. Exception: a transaction-owned effect recomputed mainline (contested, #3322) publishes directly, so that pass's children are the frame's and it releases its zombies itself — its commit rides the transaction, not the flush. Zombies and the lane channel (#3444): when the parking batch _is_ the transaction, `flush` cancels the zombie recomputes its staged writes queued (`cancelZombieRecompute`) — a zombie renders mainline until the commit disposes it, and the staged world is one it never displays. A zombie dirtied through the lane channel (`REACTIVE_OPTIMISTIC_DIRTY`: an override, or a `latest()` companion the write synced) is the exception and runs: the lane's values _are_ the mainline frame, so the still-visible branch a held `Show` was removing showed `latest(count)` at 0 beside the same read outside at 1. Its pass runs under the lane and its run lands on the lane's effect queue, so a held lane defers it exactly as it defers every other reader's; the commit disposes it as before. Pinned: `tests/nested-render-effect-async-cleanup.test.ts`. Lane frames (#3662): a lane pass on an _effect_ direct-commits, so the frame it replaces is not a transaction zombie — it leaves the screen when the lane's queue applies the effect's run (A30), and a held lane defers that run with the frame still displayed. `recompute`'s parking site flags the owner `CONFIG_LANE_FRAME` instead of queuing and stamping it for the action's commit (stamped so, the #3412 refresh re-run of a later lane pass disposed that pass's freshly built children on the spot and held their replacements for a commit that never came — the reported keyed-`Show` disappearance); the tail's release gate treats a lane pass like a contested mainline pass (an older frame's zombies are released, the flag is not left set for another transaction's commit). While set: the parked frame is not a hold (excluded from `needsPendingCommit` and from the tail's release drain); a superseding lane pass disposes the live children on the spot (a frame no run applied) and keeps the parked one; `cancelZombieRecompute` skips the #3444 exception for its members (`laneZombie` — the lane's values reach the screen through the run that retires them); `reporterBlocksSource` reads the lane's transaction as the one staging their removal (#3463). Drained by the lane's render entry the parking site pushes before the pass builds the new frame — so the retired frame's `onCleanup`s run ahead of every side-effect callback of the new frame (the effect's apply, a child effect's first run); compute order is unconstrained (cleanups before side effects, ruled 2026-09-26) — by `commitPendingNode` if a hold commits the node first, or with the owner's death (#3561). A held lane holds its transaction, so "revert before the run applies" is unreachable: `_cleanupLanes` applies the queued runs before the overlay's reversion pass. Lane work and transaction work (ruled 2026-09-28, #3698; maintainer: "zombies shouldn't be messing with things here"): the parking site decides by the pass's owner, not the node's kind, and the replaced children stay the displayed frame's until the pass's own result reaches the screen. Mainline work retires them at the flush's commit; transaction work — a pass under a held transaction, its result waiting on the commit — parks transaction zombies as above (#3404), retired at that commit; lane work — a pass over a lane, on an effect or a memo alike — parks a lane frame, retired when the lane applies (at once for a lane that is not held, at the release for one that is): an effect's lane pass publishes its run and a memo's its derived override (A17), and neither is queued or stamped for the action's commit on the parked frame's account. Zombies exist for transaction work only; lane work has none. #3662 had gated the lane frame on `isEffect` and left a memo's lane pass on the zombie path: `needsPendingCommit` was true on `_pendingFirstChild` alone, `queuePendingNode` filed the memo as the action's pending node and `reassignPendingTransition` stamped it, and its next mainline recompute re-entered the hold through the stamped-memo arm — a `Show` whose `when` getter owns a compiler-emitted memo held an unrelated sync write for the action's lifetime, against #3460. The gate is now `lane` alone; every other `CONFIG_LANE_FRAME` site (`laneZombie`, `reporterBlocksSource`, `commitPendingNode`, the owner's death) was already owner-generic. Pinned: `tests/optimistic-move-keyed-show-3662.test.ts`, `tests/lane-pass-stamped-effect-3662.test.ts`, `tests/lane-frame-held-lane-3662.test.ts`, `tests/lane-frame-deferred-run-3662.test.ts`, `tests/optimistic-read-lane-not-transaction-3698.test.ts`.
- `_optimisticNodes` — nodes whose override reverts at completion (`resolveOptimisticNodes`).
- Incomplete-transition flush stashes queues (`stashQueues`) and continues with a fresh view; completion restores them, commits pending, reverts optimistic, replays `_gatedSubs`, cleans lanes.
- `_contested` — effects whose single value slot was written under this transaction and then overwritten by another live transaction or by mainline (#3322). Effects are not shared state, so a shared effect never merges transactions (memos do, via their `_transition` stamp; `recompute`'s stamp re-entry is memo-only since #3407 — an effect's pass belongs to whatever dirtied it); instead `Effect._valueTransition` records which view produced `_value`, `recompute`, when that owner changes, registers the effect on every owed live transaction, and `finalizePureQueue` re-dirties them **before** its heap run so the re-derive and the effect phase land in the same pass — the other view's value is never published. Exception: a settle that reverts optimism (a non-empty `_optimisticNodes`) re-dirties them **after** `_resolveOptimistic`, with the gated replay — between `commitPendingNodes` and the revert the truth is committed but the overrides still display, and a re-derive there composes the two (the #3164 tear; the reveal wake sits post-revert for the same reason). The slot meanwhile holds the frame already on screen, so nothing new is published early. Rules that fall out: a stale (render) reader with no transaction active is mainline and sees a foreign transaction's staged signal as committed (`read`'s fast path and `readNodeFast` apply `stale && el._transition !== null`, matching the slow path); a value computed mainline needs no protection (mainline publishes what it computes, and a transaction whose writes never touched the effect finds it still correct at commit).
- `onSettled` and the revert re-derive (#3411): the settle drops the overrides in the commit pass and only _enqueues_ their subscribers (the revert's `insertSubs`, the contested and gated replays, the store clears); the pass after re-derives them, and reads do not pull (`prepareComputed(el, false)`). An unowned `onSettled` callback is a one-shot in the commit pass's user phase, so it read the optimistic source already reverted next to a sync memo of it still holding the optimistic value. The fire waits for the heap to drain instead — while `dirtyQueue` has work it re-enqueues itself (`run` swaps the queue, so the re-enqueue lands in the next pass; `enqueue` keeps the drain alive) — which is what settled means: no derivation outstanding. Forcing the re-derive into the commit pass is not an option: an optimistic write completing in its own flush shows its lane frame (applied by `cleanupCompletedLanes`) before the truth, and the store clears compose a torn shape when their readers re-derive inside finalize (#3164).
- Finalize re-entry (#3319): `finalizePureQueue` can _enter_ a held transaction partway through — a store commit hook (`bumpDeep` on a node the transaction owns), a boundary `_checkSources` write, or a stamped recompute in its heap — and `initTransition` then adopts the batch being finalized. Two rules keep that consistent. **State:** finalize captures the batch it started with and, if `currentBatch` changed, commits/reverts nothing batch-derived (the entered transaction owns it now); a _completing_ transaction whose ambient batch was separate (the #2916 shape) still settles its own containers, since adoption never touched them. **Effects:** ownership. A run applies with the commit of the transaction that computed its value (`Effect._valueTransition`). The ordinary effect phase runs with `activeTransition` set only in a flush whose finalize entered one, so `runEffect` leaves runs owned by a still-held transaction queued — `_modified` stays set — for the next gate to stash with the owner, while everything computed mainline (the write that caused the flush) applies now. Lanes are exempt by construction: they apply their own effects ahead of their transaction (the optimistic view) and their runner ORs `LANE_RUN` into the `type` it passes; the creation-time immediate run in `effect()` passes it too. The exemption is keyed on the _effect_ still having a lane, not on the runner: after a supersession demotes the cascade (#3331, §1), a `LANE_RUN` runner reaching a now lane-less effect whose value was computed under a still-held transaction leaves it queued like any owned run — otherwise the lane would apply the corrected derivation ahead of the commit that is supposed to reveal it. Known residue: writes staged by a hook _before_ the entry are adopted (held) and, because finalize's heap runs after its hooks, their dependents recompute owner-stamped and park with them; an entry that happens _inside_ that heap can leave an earlier mainline-computed effect applied over an adopted source — narrow, and inherited from adoption rather than from this rule.
- `transitionComplete`: prunes dead reporters (`reporterBlocksSource`), transition is done when no live reporter still blocks a source that is **still pending** (a non-empty `_pendingSources`) and no active-override node is blocked on someone else's async. Judged by the set, not `_error.source` (#3375: a later-pending input overwrites it on propagation while the flight is still in the air) and not the self entry alone (#3462: an upstream re-ask that supersedes the source's own flight retires that entry and leaves the source pending on the re-ask — its reader still cannot render, and the landing folds the transaction in; judged complete instead, a re-entry before the landing, such as a repeated write to the held signal, committed the held writes beside the reader's stale frame). **Zombies (#3463):** a reporter with `REACTIVE_ZOMBIE` — its owner's pass replaced it, its disposal staged in a live transaction (held children, #3404) — is still on screen and is live for every hold but one: `reporterBlocksSource(reporter, source, verdict)` walks the zombie's `_parent` chain to the first non-zombie owner and resolves the transaction staging its removal (the owner's `_transition`, or `activeTransition` for a `CONFIG_HELD_CHILDREN` owner); the zombie is moot only when that transaction is the one being judged (`verdict`) — done, and the commit disposes it; not done, and it stays parked regardless — or is already done. `sourceObserved(transition, source, verdict?)` passes `verdict ? transition : null`, and keeps (rather than prunes) a zombie the verdict passed over: moot for this verdict, it still holds a lane's reveal while the transaction stays parked on something else. Before, a zombie counted as disposed everywhere, and the lane revealed `Value: 1` beside the zombie's `Details: 0`. Pinned: `tests/lane-outside-view.test.ts` (#3463).
- Fallback-caught async holds nothing — in both orders (A33; ruled 2026-09-12, #3375). A collecting boundary consumes the notification, so a reader under a fallback never registers. A reader registered while its boundary showed content (forwarded) stays registered when the boundary's `on` changes and it flips to the fallback; `reporterBlocksSource` therefore walks the reporter's `_queue._parent` chain and treats a reporter behind a collecting pending-type boundary (`_collectionType & STATUS_PENDING && !_initialized`) as not live. If nothing outside the boundary consumes the flight, the hold is over; a reader outside it still holds. The reset itself calls `wakeParked()` so the re-judgement happens in the same drain. The hold moves onto the boundary, not off the screen (#3459): the reset also collects, from every live transaction's `_asyncReporters` (INV-3, the one record of a forwarded reader), the sources of each reporter it routes — `_holds`: under this queue with no collecting pending-type boundary between — plus that reporter's `_pendingSources`, and flips to the fallback if it found any. A forwarded reader already pending never re-notifies (status propagation dedupes on its `_pendingSources`), so without this a sibling reader's fresh flight was the only source collected, and its landing revealed the still-flying one stale (`B: 1 | Fast: 1 | Slow: 0`). Pinned: `tests/loading-reset-collects-forwarded-3459.test.ts`.
- Wake of parked transactions (`wokenTransitions`): the flush judges only the _active_ transaction; a parked one is re-entered by a stamped node's landing (`settleTransition`), a stamped recompute, or an action resuming. A reporter that stops counting for another reason — its boundary reset (above), or its disposal by ambient work (#3372: `disposeChildren(self)` on a node with `_transition` and `STATUS_PENDING`; a pending reader is always queued as a pending node, so the stamp is reliable) — is none of those: `reporterBlocksSource` would prune it at the next check, but no check comes, and the writes held with it stay staged. Such sites record the transaction (deduped) and schedule; the flush re-enters a woken transaction from the `finally` of a full pass — reached from the park exit and the normal exit alike — and only when idle: no `activeTransition` and `!scheduled`, which at that point means an empty dirty heap, nothing staged in the ambient batch (`_batch._pendingNodes`), no write since the heap ran (every write re-arms it) and, the finalize having reverted them, no optimistic ambient nodes. Entering adopts the ambient batch, and ambient work present at that instant would be held behind flights it never read; a wake in a pass with work just falls to the next. The staged-nodes term is the fast drain's and the park exit's idle test too; the full pass omitted it, and a node the finalize staged with no subscriber to dirty the heap — an optimistic store settle's keyset bump (`_clearOptimisticStores`) under a reader that tracks only `length` — was adopted and stamped by the wake, so a later ambient write to that node joined the parked transaction (A34) and its optimistic override never reverted. Pinned: `tests/store/woken-transaction-adopts-staged-bump.test.ts` (matrix F6). Entries are popped in a loop until one enters: a wake whose transaction completed by other means is a bare return (`initTransition` on `_done`) and must not strand the ones behind it. The fast drain defers to the full path while a wake is outstanding so such dead entries are still consumed. A wake with other live reporters re-parks; the idle pass is its only cost. Known shape: the ambient write that triggered the reset commits in its own pass and the released hold in the idle pass after it — two effect runs in one synchronous drain (`Sum: 1`, `Sum: 2` at the same clock time in the #3375 pin), never a visible tear.
- A write proposes (A34, #3494). Two mechanisms. **Join at flush (`batchJoins`, scheduler.ts):** `setSignal` on a node stamped by a transaction that is not active enters it at once inside a flush; from mainline it pushes the transaction to `batchJoins` (dupes are harmless: `initTransition` on the active transaction returns) and calls `schedule()` — the write may be a repeat that leaves through the equality gate without scheduling, and a join left for a later flush adopted that flush's unrelated tick (#3519 review); `flush()` enters each at its start — after the companion re-sync, inside the `try` (the adoption runs user comparators; a throw must not leave `_running` set), before the heap — adopting the tick's ambient batch; the fast sync path (`canUseSimpleSyncFlush`) is bypassed while a join waits, so the whole tick reveals with the hold ("both are suggesting a value"). Recorded before `setSignal`'s equality gate: a repeat of the held value is a proposal too, and had no other route in (a differing value re-asks the flight, which the adoption already held). #3473 had removed the entry from mainline because it set `activeTransition` for the rest of the caller's block — a memo created after the write was born the transaction's (A29) — and thereby dropped the grouping; deferring the entry keeps mainline code between the write and the flush mainline. **No proposal (adoption loop of `initTransition`):** an unstamped (`_transition === null`) signal (`!_fn`), or an initialized writable memo under `REACTIVE_MANUAL_WRITE` (`createSignal(fn)`'s setter routes through `setMemo → setSignal`; parity, #3519 review — a computed's other stagings are its pass's result and may equal an uninitialized `undefined`), whose staged value equals its committed one (`_equals`) is unstaged through `commitPendingNode` with `_pendingValue` cleared first (the commit's own cleanup: companions snapped, the manual-write flag dropped) and neither stamped nor pushed to the transaction — its subscribers were walked at the write and re-derive the same value; its companions need no snap, the flush-start re-sync (A28) already read the equality through `computePendingState`. `computePendingState` gates its "staged, therefore pending" arm on the same inequality (a staged value equal to the committed one is final). Before, `setShow(false); setShow(true); setCount(1)` stamped `show` into `count`'s hold with nothing to reveal: `isPending(show)` read true for the hold's life, and the later `setShow(false)` — the tick above routes it to the stamp — was held and then lost (gabbev's coalesced-toggle case). Pinned: `tests/write-proposals-3494.test.ts`. The unstamped guard (fuzzer latest-2 #1470, S3): a parked transaction's batch folds into a merge through this same loop, and its nodes carry FLUSHED proposals — an action's `1` then `0` on a committed `0` is a held node, not a fresh tick's no-op. Dropped, the node kept its dead stamp and was pushed nowhere; the authoritative `1` that followed queued under the merged transaction as another transaction's node, and `commitPendingNodes` skipped it — readers revealed `1` beside a source anchor stuck at `0`. **A held derivation is not a proposal (A34 (3), #3612):** a writable memo / derived store has ONE staging slot (`_pendingValue`, the leaves' for a store) — the transaction's re-derivation and a user write share it — so the two are told apart by the manual-write flag: `heldDerivation(el)` (core.ts) is "stamped by a transaction that is not the active one, and `REACTIVE_MANUAL_WRITE` clear on the node or its `_firewall`". `setMemo` asks before the write: held, the updater composes on `_value` (the committed frame the writer read), `setSignal` stages and joins as for any proposal (A28 stash, companions, `batchJoins`), and `rederiveHeld` marks the node DIRTY and enqueues it in place of `markManualWrite` — the joined flush recomputes it under the transaction with `prev = _pendingValue`, the written value, and restages `f(inputs)`. The derived store's setter (`derivedStoreWrite`, store.ts) decides from its leaf notifications (`notifyWrites` records a hit for a leaf whose `_firewall` is the running setter's node and which `heldDerivation` reads as held) and flags or re-derives the projection node after them; a flagged projection re-running its fold sees the written draft as the prior state. Not asked by `setSignal` itself: its other stamped-node writers (an async landing's `setSignal(el, () => value)`, companions, rows) are the transaction's own work. The flag is the discriminator, so it is state, not scheduling: `updateIfNecessary`'s post-pull flag wipe carries `REACTIVE_MANUAL_WRITE` (a probe that recomputed nothing used to lift it — an `isPending(b)` between two writes decided whether the second was a proposal or a `prev`); the flag is cleared by the node's recompute or the commit (`commitPendingNode`). It has no scheduling role (core R31, rule B, #3733): a manual write neither refuses nor cancels its node's re-run, so a source change or `refresh()` — in the write's flush or later — re-derives with the write as `prev`, under the transaction when one holds the node. (#3740's frame-scoped heap refusal, `masked`/`_manualWriteTime`, is gone; before it the refusal lifted only at the commit, so an action's write masked its node for the whole hold — a regression from #2692's `b0db6c90f` that #3026 had patched for `refresh()` alone.)
- A pending mark over a kept-tail link re-derives its subscriber (A30 amendment, #3494 review; fuzzer latest-1 #2141, O2; #3519 review; fuzzer branches-1 #1105): `notifyStatus`'s `forEachDependent` callback, for `STATUS_PENDING` when `link._gen !== sub._depGen` — the link was not (re)validated by the subscriber's current pass (`link()` stamps the pass generation on every link in the `[deps.._depsTail]` prefix), i.e. it lies in the tail A30 keeps (a staged or unchanged pass) or, mid-pass, has not been re-read yet — calls `enqueueSub(sub); schedule()` and returns: no `_pendingSources` entry, no `initTransition(sub._transition)` (the A15 held-memo entanglement arm), no downstream `notifyStatus`. O(1). Clears and errors (`STATUS_NONE`/`STATUS_ERROR`) still ride every link. The recompute decides: reading the pending dep registers the node through its own read; reading a held input enters that transaction (A29); reading neither leaves nothing. Why not skip (the first amendment): a mainline flight on a dep the committed frame derives from left that frame on screen beside its new inputs — `selected` (held pass: constant `0`, tail to `remote` kept) published `1 0` with `query=1`. Why not mark (base): the mark's registration and entanglement bind the node's holder to a flight the held frame never reads — a hide joined to a parked action (A34) held the action's truth on the memo's orphaned re-ask; a branch memo held in a transaction, its kept-tail dep a manual flight, entangled the transaction with a flight nobody resolved and kept a gated reader hidden (#1105, S2/L1). Gating `reporterBlocksSource` instead was wrong (first attempt, S1 flood in the fuzzer): it runs mid-pass from `heldFromStale` → `waitingTransition`, when the reporter's tail sits at the dep just read and the pending dep it is about to throw on is still past it — the registration was pruned and never re-added.
- Reporter liveness through a memo (#3494): `reporterBlocksSource`'s deps scan, for each dependency of this pass, also asks `dep._x._pendingSources.has(source)` — a stale reader served a held memo's committed value never turned pending itself, so its only trace of the flight is the memo between them; `_pendingSources` is transitive, one hop covers any depth. Beside a release in the same flush (a gate closes on the flight's last reader as a new reader reveals the memo), the verdict judged the new reader dead and released `count=1` beside the `Copy: 0` it displayed. And `transitionBlocked` (optimistic.ts) skips companions (`_parentSource`): a `latest()` shadow created from mainline over a pending memo is backfilled under the owner's transaction (A28 (3)) with an active override and a `NotReadyError` — the exact shape of an authoritative blocker — and held a released write until the orphaned request landed.
- Staged reads enter (A29, #3408): `read()` calls `enterStagedRead` on every selection that returns `_pendingValue` — the fast paths and the slow path — and it enters `el._transition` unless that is null (ambient batch), already active, or the read is a probe (`pendingCheckActive`). The third entry beside `setSignal` on a stamped node and `recompute` of a stamped node; rule text and the `Panel: 1` beside `Count: 0` shape live in the spec. A stale (render) reader never reaches it: the carve-out below serves it the committed value.
- Dependencies are the committed frame's (A30, #3410): `recompute`'s tail trims the previous pass's dependency tail only for a pass that published or changed nothing (`_pendingValue === NOT_PENDING` and no `_error`); a staged pass leaves it linked and `commitPendingNode` trims after a clean pass (`_error == null` — a set `_error` means the last pass threw, kept its full list, and `_depsTail` marks where it stopped); an effect pass that direct-committed but still owes a run (`_modified`, #3438 — the flush may stash that run into a transaction it opens later) leaves it for `runEffect` to trim once the run applies. `__OBSERVE__` fan-in counting walks the validated prefix only, so a held tail does not inflate distinct-source counts. Why commit-time and not the pass, and the `Selected: 0` beside `Count: 1` shape: the spec. **Unchanged pass (#3469, `heldTrims`, scheduler.ts):** a pass that changed nothing replaced nothing either, and cannot know at its own tail whether the flush that ran it will park with its inputs held — `b() ? b() : a()` computed `1` from the held `b=1`, equal to the `1` it had from `a`, trimmed `a`, and the mainline `a=2` never reached it. `recompute`'s tail now trims at once only for a creation pass, an OPT-dirty pass, or a tracked effect (its frame is replaceable like a direct commit — it runs after the commit and a spurious run is user-visible); any other unchanged pass with a stale tail is pushed to `heldTrims`, drained by `commitPendingNodes` (the flush committed: trim) and cleared when the flush parks (the tail stays linked until a committing pass trims it — one spurious recompute at most). Pinned: `tests/held-frame-dependencies.test.ts`.
- Reveal-hold and its carve-out (#3305, #3334, re-ruled 2026-09-10): a reader landing on a node with `STATUS_PENDING` throws — the throw reaches `GlobalQueue.notify`, which opens a transaction for the reveal if none is active (#3305) and records the source as its reporter (INV-3); the reveal completes when the flight lands. One carve-out, the staged-value rule's twin for flights: a **stale** (render) reader of a node pending in some **other** transaction shows the node's committed value, does not entangle (its own writes stay outside that transaction), is recorded for that transaction's commit replay (`heldFromStale`), and joins the transaction's reporters for the node when it has an entry (#3374) — the reader displays the pre-flight value, so the transaction cannot commit the flight's inputs ahead of its answer just because the reader that opened the entry was disposed (a keyed remount). It is refused — the reader holds — when the committed value would tear against the frame: the node carries `CONFIG_INPUTS_PUBLISHED` (a batch or transaction committed with the node still pending, `commitPendingNode`'s computed branch: the flight's inputs are on screen; cleared when the node next enters pending from a settled state, `notifyStatus`), or the node is routed through a live lane (`GlobalQueue._laneLive` → `resolveLane`, exact rather than sticky: lane-revealed inputs, optimistic or `latest`), or the node is uninitialized (nothing committed to show). The stamp itself is pending-node bookkeeping and decides nothing. Replay hygiene: an effect recorded in `_gatedSubs` that later recomputes _under_ the transaction sees its staged view and is applied by the commit (ownership) — `recompute` drops the stale recording at its start (`activeTransition._gatedSubs.delete`), and a lane's committed-view read re-records during the run, so the lane replay (`laneReadsCommitted`) is untouched.
- Settle-time re-entry, lane-routed nodes (#3334): `handleAsync`'s `settleTransition` re-enters `resolveTransition(el)` — for a lane-routed node the transaction that _owns_ the lane. That owner's commit is only the override's confirm/revert; the landing itself is revealed by the lane. If a transaction is _waiting_ on the node (`waitingTransition(el)`), the settle enters that one instead: entering the owner would fold a reveal that only waits on the flight into the owner's action (A18 node corollary, #2912). Every other transaction waiting on the flight then folds in explicitly (`enterWaiting`, #3407 — see the next bullet): each reveal that discovered the flight completes at its landing (A15).
- Re-park sweep (#3456, `recompute`'s catch): a pass that re-parks on a new pending source set drops what the earlier pass carried. `handleAsync` resets the node's `_pendingSources` to the new set, but a source the pass no longer reaches — its branch switched (`count === 1 ? details() : 0` → an own promise), or a fresh flight replaced its inputs' pending with its own — stays copied onto dependents that reached it only through here, and that source's landing walk stops at this node (nothing left to retire) before it finds them; a dependent then waits forever on a flight it has no path to (`Panel: hidden` after `selected` landed). The catch now settles, against the node, every previously carried source (`outgoingPendingSources`) absent from the new set (`settlePendingSource(el, source)`) — the re-park twin of the unchanged-value recovery sweep; a dependent with another path to the source keeps it (`retryReaches`). The sync twin recovers on its own (an errored pass keeps its dropped dep linked, so the landing still reaches the node); pinned beside it. Pinned: `tests/pending-source-repark.test.ts`.
- Pending propagation onto a held memo entangles (#3443): `notifyStatus`'s dependent walk, on a pending propagation reaching a memo another live transaction _holds_ — stamped by it AND pending on its work or carrying its staged `_pendingValue`; not behind a boundary — enters that transaction — `initTransition(sub._transition)`, merging it into the active one or, with none active, entering it and adopting the ambient batch (the write that started this flight becomes its). A memo the first transaction holds and the second flight now feeds cannot reveal before the second lands (A15: a shared derivation of both), and propagation is the one moment that is known: it marks the memo pending without recomputing it (its inputs' _values_ are unchanged), so the memo's stamped re-entry — the entanglement's usual site — never ran, the first flight landed, its transaction's verdict saw only its own reporters (the memo's reader had registered for the second flight in the _second_ transaction, INV-3 keyed by transaction), and it revealed `A: 1` beside the memo's committed `Sum: 0`. The stamp alone decides nothing (#3334): a memo the transaction once queued but holds nothing of — status clear, nothing staged — is not entangled, or a `Dynamic` switched twice mid-flight would drag the superseded first call's gate into the live second call's reveal (`call-driven-lifecycle` args-switch-gate: the second write supersedes the first through the shared output memo, and only the live answer settles it). Effects are skipped (`_type`): an effect entangles nothing by itself (A15 shared-hole corollary) — its reader registers with the flight's transaction at queue notification and the landing folds waiters in (`enterWaiting`). Consequence pinned alongside: a write whose async work flows into a held memo is held with it (`page=1` beside `count=1` while `details` re-asks — before, the ambient page=1 committed a pass ahead), which is also why the #3375 boundary-reset pin now publishes `Sum: 2` once at the reset instead of `Sum: 1 | Sum: 2`. Pinned: `tests/overlapping-flights.test.ts`.
- Pass provenance for effects (#3407): a render effect's pass belongs to whatever dirtied it. `recompute` re-enters a stamped node's transaction only for memos (their value _is_ that transaction's work); an effect stamped by a transaction — it observed that transaction's flight — and dirtied by another transaction's write, or by mainline, runs that writer's pass, reads the held flight as a stale reader (committed value, `heldFromStale`) and publishes with the writer. The pass entangles only if it _observes_ a pending flight (the carve-out refused: inputs published, lane-live, uninitialized) — the throw reaches `GlobalQueue.notify`, which registers the writer's transaction as a reporter, and the flight's landing folds it in. Before, `recompute` re-entered an effect's stamp whenever _any_ other transaction was active: a sync `action` write to a signal that merely shared a hole with a held async (`{b()}:{detailsA()}`) merged into the async's transaction and waited (`0:0 → 2:1`, no `1:0`), while the same write made plainly passed through; two independent flights read in one hole settled as one unit. Now both writers publish on their own (`1:0` at the write, `1:1` at the landing; two flights land at their own times). The re-entry's other job — delivering a landing to the transactions waiting on it — moves to the landing itself: `settleTransition` enters every parked transaction whose reporters still observe the node (`enterWaiting`, over `sourceObserved`), including the waiter of a stampless node (a flight started under a batch that committed beneath it, #3305), whose landing used to open a fresh batch that the stamped reader's re-entry folded into the waiter. Pinned: `tests/shared-effect-no-entangle.test.ts`; the reveal-completion pins (`spec-async-semantics` A15, `reveal-carve-out`, `stale-read-uninitialized-cross-transition`) are the regression net for the fold.
- The action body's end starts the correction (#3427, `endOptimism`, called from `flush` after the heap and before the verdict): with the bodies over (`_acted` and no live `_actions`) and nothing _authoritative_ in flight — no override node's own source (`transitionBlocked`), no held flight that does not derive from an override (`sourceObserved` and not `resolveLane`) — each override's truth (the staged value an A17-silent landing left, else the committed value) supersedes it now, as an arriving differing truth does (A18): the graph re-derives from the truth as the transaction's held work, and the transaction settles when _that_ lands. The lane-derived flights were questions about the guess; nobody reads their answer. Before, the settle waited for the obsolete flight, revealed the obsolete optimistic frame when it landed, then reverted and re-asked — a waterfall with a flash. A co-written plain load the action asked for (`setSaving(true); setPage(2)`) is authoritative and keeps the optimistic world up until it lands. Optimistic **store** edits opt the whole transaction out (their truth is the base layer under an overlay with no tracked/displayed split); companions (`_parentSource`) answer for their owner and snap at settlement, not here. Pinned: `tests/optimistic-lane-release.test.ts`.

## 4. Write paths (all must stay equivalent)

Every path that produces a value for a node must maintain the companions via
`syncCompanions` `[ruled — #2831 fix]`:

1. `setSignal` — direct write (line ~1033).
2. `asyncWrite` — async resolution, four branches: setter / override-active / lane-routed / plain `setSignal` fallback. Its status clear is `landStatus`, not `clearStatus`: a landing answers the node's OWN question, so it retires the self entry only. An input re-asked while the flight was up (`a` restarted while `b`'s first flight was in the air, #3373) marks `b` pending on `a` by propagation with `b`'s flight still current — nothing superseded it — and the landing keeps `b` pending on `a` (value written and held; `a`'s settle releases it or its value change re-asks `b`). The complement at registration: `handleAsync` drops entries inputs propagated earlier — the run read them, so a pending input was masked for it (an active override, A17) and does not describe the new flight's answer.
3. `recompute` — transition-held sync derivation (line ~334, `activeTransition || el._transition` guard).

Comparator (`_equals`) errors on any of these paths are node errors, routed
through `notifyStatus(STATUS_ERROR)` `[ruled — #2837]`. `setSignal` checks
`STATUS_UNINITIALIZED` _before_ invoking the comparator so a user comparator
never sees `undefined` prev on first commit `[decided while fixing #2837]`.

## 5. Invariants for `__TEST__` assertions

Confidence: **high** = implementation self-consistency, assert now.
**medium** = believed structural, assert but watch for false positives.

> Gating: the machinery lives in `core/invariants.ts` behind `__TEST__`, not
> `__DEV__`. The per-write Set tracking and per-flush quiescence sweep cost
> 5-21% across the CodSpeed suite when they ran under `__DEV__` (measured
> 2026-07-06, run for 61722cbe), which would also tax every user's dev build.
> Call sites remain `__DEV__`-guarded for prod tree-shaking; bodies
> early-return unless `__TEST__`. Benchmarks run with `__TEST__: false`
> (see `vite.config.ts` benchmark-mode define).

- **INV-1 (high)** `pendingProbe` is non-null only inside an `isPending()` call
  (it saves/restores; nothing else may write it).
- **INV-2 (high)** A node with an _active_ override (`hasActiveOverride`) is
  registered in a transition's/queue's `_optimisticNodes`. (The original
  revert-target half was retired with §5e — there is no revert target to
  assert.)
- **INV-3 (high)** `_asyncReporters` gains entries only inside
  `GlobalQueue.notify` (render-effect notification path). Guard flag around the
  legal write site; assert on any other mutation. `[ruled]` A reporter joining
  an EXISTING entry has one further site: the reveal carve-out in `read()`
  (`heldFromStale`, #3374) — the transaction already waits on that node, the
  reader now observes it. A boundary-consumed flight has no entry and stays
  consumed.
- **INV-4 (medium)** After any of the three write paths completes for node `el`
  with value `v`: if `el._pendingSignal` exists it reflects
  `computePendingState(el)`, and if `el._latestValueComputed` exists its signal
  value is `v` (companion coherence, #2831).
- **INV-5 (medium)** A lane in `activeLanes` has `_mergedInto === null`
  (merged lanes must be removed or never enumerated as roots) — note:
  `cleanupCompletedLanes` iterates `activeLanes` and checks `_mergedInto`,
  so today merged lanes _do_ linger in `activeLanes`; the invariant is that
  they are skipped everywhere. Assert the weaker form: a merged lane's
  `_pendingAsync` and `_effectQueues` are empty (moved on merge).
- **INV-6 (medium)** At the end of a completing-transition flush: every node in
  the completed transition's `_optimisticNodes` has `_overrideValue === NOT_PENDING`
  and `_transition === null`; the transition's lanes are gone from `activeLanes`.
- **INV-7 (medium)** `_pendingValue !== NOT_PENDING` on a non-optimistic node
  implies the node is queued (`_pendingNode`/`_pendingNodes`) or held by a
  transition — a pending value with no committer is a leak (the #2827 class).
- **INV-8 (RETIRED 2026-07-07b, §5e)** Hold-provenance: a `_pendingValue` on an
  optimistic node was tracked as either a _revert target_ (the pre-override
  value stashed for the revert) or a _held authoritative value_, and the
  invariant asserted a resting node never carried a revert target. That
  provenance proved a held value on a resting node is always a refetch /
  transition hold — pending like a plain memo (V1, §5d) — and then the A18
  re-rule eliminated revert targets altogether (§5e), leaving `_pendingValue`
  one meaning and nothing to distinguish. The tracker was deleted with them.
  The ID stays: `invariants.ts` and §5d/§5e/§7 cite it for the proof it gave.
  Its lane-scoped successor ("live lane members are only released by their own
  lane's resolution", C2) is queued, not asserted.
- **INV-9 (high)** An `isPending` companion of a DISPOSED owner reads `false`
  at quiescence — a stale `true` outliving its source would hold a spinner
  forever (the #2845 disposal edge). Enforced by the disposal guard in
  `computePendingState` plus the `snapCompanionsToState` call in
  `disposeChildren`.
- **INV-10 (high)** Affects-count balance (question-scoped model, 2026-07-13;
  replaces the retired mask assertion): at quiescence every node that ever
  carried an `affects()` mark has `_affectsCount === 0` — every registration
  was released by exactly one settle/flush-end. A leaked count would latch a
  verdict `true` forever (the declared-motion analogue of the INV-9 latch).
- **INV-11 (high, structural — pinned, not asserted)** A recompute's equality
  gate compares the new result against the slot it is about to publish to:
  the override for an override-covered node (a written one, or the derived
  one a previous lane pass left — `CONFIG_DERIVED_OVERRIDE`, #3479), `_value`
  for a lane pass's FIRST publish (no override yet: the compare is against the
  committed value the override will shadow) and for an effect's or a
  reversion pass's direct commit, `_pendingValue` for a transaction-staged
  run. **Lanes stage (#3479):** a lane pass on a memo no longer direct-commits
  `_value`; it publishes into the override slot (`laneOverride`), so the
  committed view an outsider is served (`readsHeldCommitted`) is a whole frame
  — the source's shadow and its derivations — and the lane's own view is the
  override end to end. The reversion pass (OPT-dirty with no live lane, the
  override dropped) and an effect's lane pass still direct-commit. "Unchanged" is
  a statement about what the publishing view will show, so comparing against
  a different view produces torn frames: #3330 compared a lane recompute
  against a `_pendingValue` an earlier action write had staged, called the
  identical result unchanged, and revealed the override without its
  derivation. Pinned in `tests/spec-async-semantics.test.ts` (A17, #3330);
  not a runtime assertion because the publishing slot is decided inside the
  same branch that compares. Corollary (#3377): a lane pass also _retires_
  the transaction-staged `_pendingValue` it supersedes, override or not — a
  node that adopted the lane through its deps (a `latest()` read; the
  companion is an optimistic node) may have staged a hold on an earlier,
  lane-free pass of the same transaction, and left in place that older frame
  commits over the fresh one. Derived-override lifecycle (#3479): joins the
  lane's transaction's `_optimisticNodes` on its first publish (the ambient
  batch would revert an async landing's at its own end); reverts with it —
  _promoted_ to `_value` when not superseded (sources revert before their
  derivations in that list, and a source whose truth differs dirties them, so
  a derivation the revert did not dirty is what the truth yields), dropped
  when superseded (the truth is staged); the slot disarms to `undefined` for
  a plain memo and stays `NOT_PENDING` for a written node the lane corrected.
  Demoted by its source's supersession (A18), its plain re-derivation runs
  the sync twin and its landing takes `asyncWrite`'s hold-and-supersede
  branch (never the plain `setSignal`, which would read the armed slot as a
  fresh optimistic write and open a lane with the memo as source). Until then,
  _every_ pass over it is the lane's pass, whatever channel dirtied it
  (`recompute`'s derived-override branch): it is still a member, its inputs
  serve the lane's view, and its result is the lane's — run plain, the sync
  twin read a re-derived lane view (a fresh tuple) as a differing truth,
  superseded and demoted, and the lane's next pass dropped that staged
  "truth" and left the flag pointing at a `_value` never committed (fuzzer
  latest-1 #2481: a boundary reset re-ran a lane-born memo). A fresh lane
  publish clears `CONFIG_OVERRIDE_SUPERSEDED` for the same reason.
- **INV-seat family (medium, recording — `core/seat.ts`, S0 of
  `documentation/plans/reader-seat-rebuild.md`)** The reader-seat shadow:
  under `__TEST__` every `read` computes the old deciders' answer and the
  new `slot()` beside it, and every `recompute` opens a seat beside the
  old head seating. Mismatches are recorded (registry, `SEAT_SHADOW_REPORT`
  JSON lines per test file) rather than thrown, unless
  `globalThis.__SEAT_SHADOW_STRICT__` is set — the differential needs the
  shape of every class, not the first throw.
  - **INV-seat-1** (amended 2026-10-28, D-27 / F-leaf) a leaf's world is
    its reads': a leaf (posture L) served the screen raises nothing; one
    that read a born node or the hold's own staging (L2/L4, raise H) is in
    the hold's world and its children are born held (#4166). The original
    "a leaf never raises its world" was wrong — it could not express
    `verdict-mount-render-effect-4166`. After a read whose row predicts no
    raise, the seat's world is unchanged.
  - **INV-seat-2** posture is never inherited: recomputed from the node
    alone (`_config`, `_type`, the probe window) at seat open and close;
    the node's own transitions during a pass (`CONFIG_FRAME` set by a
    boundary's output, `CONFIG_VERDICT` set by a probe or cleared at the
    pass's end) are exempt.
  - **INV-seat-3** the shadow agrees: slot identity per read, world state
    per read (every posture, leaves included since the amendment), verdict
    seat per read, lane seat and born-held per pass (rows B1, B2). Known
    differences — today wrong by rule, filed — are allow-listed by shape
    (`shadowKnown`, each entry naming its issue) and counted apart. The
    open classes and their readings are the design doc's §6/§7.

Rejected for assertion (state space too dynamic, would need semantic rulings):
whether `_optimisticLane` must always resolve to a live lane (stale lanes are
legal and lazily cleared by `resolveLane`).

### Dated findings — where they went

The findings that used to follow here (§5a–§5h, 2026-07-06 → 2026-07-16) are kept verbatim under **History — dated findings** at the end of this file, with their numbers (other docs cite them). What still governs the current model:

- **§5d — the #2838 redesign as landed** (2026-07-07): the companion/oracle structure in §1–§4 IS this redesign. Live.
- **§5e — revert-target elimination** (A18 re-rule): `_pendingValue` has one meaning; INV-8 retired. Live.
- **§5g — question-scoped pending** (A24, supersedes the mask): `_reask`, `_affectsCount`, the sentinel rails. Live.
- **§5h — seed invisibility on derived stores** (A25). Live.
- **§5a–§5c** — the first assertion runs and the companion-vs-oracle census: how the redesign was arrived at. Historical.
- **§5f — the mask model** (A20/A21): SUPERSEDED by §5g six days later; kept for the reasoning record only.

## 6. Assumptions / open questions (feed into tier B/C propositions)

- `[RULED 2026-07-07 → A19/V3]` When async is in flight on a node whose
  transition already completed: `isPending` must report `true` — the
  observable value is not final. See decision log and SPEC A19.

- `[assumed]` A resting optimistic node (`_overrideValue === NOT_PENDING`) is
  semantically identical to a plain node for every read/pending computation
  (#2799/#2806 lean this way; not stated as a rule).
- `[assumed]` Parent/child lane independence (companion lanes don't merge with
  owner lanes) is a design decision, not an accident — the `assignOrMergeLane`
  carve-out encodes it. (The other encoder, `updatePendingSignal`'s late
  merge at override-clear, was removed as dead under the mask model — §5f.)
- `[open]` When two transitions merge, should `isPending` observers of a source
  in transition A report pending for async that only transition B is waiting
  on? (Current behavior: yes, merged transitions are one unit.)
- `[RULED 2026-07-07 → C2]` A revert may only clear lane assignments that
  resolve to the reverting node's own lane — reverts do not trump other live
  lanes. `insertSubs`'s blanket reversion clear is wrong in principle
  (unobservable today); fix + assertion queued for the #2838 redesign.
- `[RULED 2026-07-07 → C3, closed by A19]` Early transition completion after
  reporter pruning is by design — transitions coordinate rendered commits
  only. Verdict correctness in the leftover window is A19's job (V3).

## 7. Decision log

- 2026-11-10: **The lane engine split along the guess boundary** (the
  §8.6 split, b3926358b, ported onto today's `lanes.ts`; a module boundary,
  no rule). `lanes.ts` keeps the sub-hold core every lane needs — the lane
  record (`newLane`, `verdictLane`), link / blocked / reveal / landing
  (`linkLanes`, `laneSeam`, `laneSeams`, `endLanes`, `dissolveLane`,
  `lanesBlocked`, `heldMountUnder`, `laneWait`), the lane read and a lane
  pass's tail (`laneRead`, `enterLane`, `laneStage`), `laneWrite`'s
  derivation arm, `adoptParked`, `laneServed` — installed by verdict.ts's
  verdict lanes as before. The new `guesses.ts` carries what only a written
  guess reaches: `optimisticWrite` and the unflushed guesses, the seam's
  `applyGuesses`, `take` and the `kept` give-back, `supersede` and the
  correction round (`laneCorrections`), `laneOutcome` with the provenance
  test (`stale`, `answered`), a write landing on a guess (`guessWrite`,
  `laneWrite`'s old guess arm) and a revert landing's give-back
  (`revertLanding`, `endLanes`' old `kept` loop). The core reaches them
  through `installGuessLayer` (lanes.ts: `take`, `guessWrite`,
  `revertLanding`, each site behind CONFIG_GUESS or `guessed`) and
  `installGuessHooks` (scheduler.ts: `laneOutcome`, `applyGuessesAt`,
  `laneCorrections`, every site null-tolerant); `guessed` stays the core's
  flag, armed by the layer (`armGuessed`) so a bundle without it folds the
  arms, and `markJudged` is the core's side of `applyGuessesAt`. `marked`,
  `inFlight`, `guessFlights`, `rerun`, `landBeneath` stay in the core
  (`dissolveLane`, `lanesBlocked`, `laneSeams` read them with no guess
  written). Measured (scripts/size, next @ 083a0bd78): `+ isPending/latest`
  −531 B brotli / −1,551 B minified, the three live pages −454 to −533 B,
  every floor and plain-store scenario 0 B, `hydrating + every store
primitive family` (both halves) +15 B brotli / +157 B minified. Suites,
  the seat shadow and 50k × 3 seeds against `next`'s recording: no screen
  moves (documentation/plans/reader-seat-rebuild.md §9.3).
- 2026-11-09: **A store guess is one node — the guess carrier** (S2's
  shape, ported onto `next` without S1's staging; D-33's point-of-write
  clause, S-59, #4724). Before, an optimistic setter was scattered into the
  lane engine as one guess per written leaf, presence key and index, plus a
  `LaneView` arrangement snapshot on the container node; a whole-array
  rewrite with one changed row escalated to a guess on the list, which two
  actions then shared — the second action's guess joined the first's lane
  (blocked on its refresh) and the two holds merged, so the refresh's
  failure landed in a hold that could not commit (#4724's three rows). Now
  `store/optimistic.ts` makes one `$PATCH` slot node per target per lane
  (`t.kg`, oldest first) whose lane value is the setter's draft, with the
  keys it changed recorded on it (`wk`, `del`; a keyed list's rows as
  written and its removed keys when the membership changed). A row the
  setter carried over is not a write: the draft's rows are clones, so a
  carried row is the view's own object again in the frame (`echoes`, #3898),
  and its proxy identity holds. Reads of a guessed key go through the
  carrier, tracked (store.ts `guessFor`: the record, and for a read every
  index and the length of an arrangement guess — a list reader enters the
  lane through them); the key's leaf stays the reader's subscription point
  but is silent at a landing while the guess covers the key (`leafSet`,
  `notifyWrites`: only keys the guess changed — a carried key's leaf tells
  its readers as ever, or a `repeat` over a derived store published the
  appended row one flush late). Enumeration, presence and descriptors read
  the carrier's frame (the descriptor arm ahead of the presence node). A
  landing reaches each live carrier as a snapshot of the truth frame
  (`judgeGuesses`, from `notifyWrites` and `adoptPB` — a returned-rows
  derive never passes the former), judged by `patchEquals` over the guess's
  keys: confirmed beneath, re-based over an older truth, folded (D-34), or
  a correction. The snapshot matters: a derive rewrites its backing in
  place, and a truth staged by reference compared equal to the next landing
  and never re-staged (#4690's whole cause here). Every carrier arm sits
  behind the optimistic hooks (`read`, `has`, `descriptor`, `frame`,
  `covers`, `judge`), and the carrier list lives in the optimistic module,
  not on the target: a plain store pays `optHooks !== null && t.o` on its read
  path and nothing else — the hook's null check first, then one field
  (`t.o`, an optimistic family's target, set at creation), never a call.
  Both halves matter: with the hooks installed by one
  `createOptimisticStore` anywhere, a call per read on every plain store
  showed on CodSpeed as −6 to −11% on the store microbenches (review of
  #4729, second round); and in a bundle with no optimistic store the
  hook is a `let` nothing assigns, so the minifier folds the null check
  to false and deletes the arm — gating on the field alone kept 0.85 KB
  minified of carrier arms in every plain-store bundle (review of #4729: the first cut had
  the arms inline in store.ts, +206 B brotli on `+ createStore`; behind the
  hooks that scenario falls 174 B, since the LaneView and chained-link
  code it used to carry is gone). Core gained two hook calls, `_slotDirty`
  in `laneDirty` and `_slotRerun` in the landing re-run, so a carrier's
  readers of its keys' leaves re-derive as the lane's; the chained-link
  `follow`/`_slotCovered` plumbing went (no leaf carries a lane value), and
  `OPTIMISTIC_REVERTED` fans a carrier out per guessed key. Gates: signals suite whole, shadow six, web configs whole;
  the #4724 pin green through both setters. Size against `next`: core 0,
  compiled floor 0; plain-store scenarios −0.17 to −0.23 KB brotli; the
  scenario carrying optimistic stores +0.2 KB (the parked S branch was
  +0.7–1.0 KB on the same scenarios).
- 2026-11-08: **A display-ahead gate is the same mainline mount with any
  number of memos between the probe and the branch** (S-58, D-25's third
  sentence; prompted by PR 4708, closed). S-46's plain row was built on
  11-07 for `<Show>` and the compiled ternary, and a hand-written gate one
  memo from the probe still attached with its hole empty — a gap in the
  engine's seating, not in the rule. Two causes, both on the lane side:
  verdict.ts `keepReaders` — when the probing memo re-derives at the seam
  to the same value, its held readers' staging is published mainline
  instead of re-run (one key, one child); right for a value, wrong for a
  frame holding a mount a probing pass opened (CONFIG_MOUNT_AHEAD, born
  held, not behind a fallback: `holdsMount`), which `<Show>`'s truthiness
  memo had kept one read away. Such a reader stays held and attaches at
  the landing. And lanes.ts `mountPending` counted a mount as waiting only
  on a flight; a mount whose frame is an open action (`_open`) waits too —
  S-53′, the plain read under an errored boundary inside an action, which
  the lane revealed with its hole empty. Both checks walk one lane-module
  list (`aheadMounts`, `heldMountUnder`): born-held mounts collected from
  the live transactions' node lists, each list scanned past where it was
  last scanned (`Transaction.scanned`), so a held node is looked at once in
  its life and a seam with no such mount, the common case, pays a loop over
  an empty list — not readers × held nodes (review of PR 4720). The S-58
  row runs S-46's shape
  through the runner's new `gate` variant: `"memo"` (one memo that probes
  and mounts) and `"cond"` (a truthiness memo and a branch memo), both
  pinned to `<Show>`'s screens; `web/test/display-ahead-gate-hops.spec.tsx`
  pins the four shapes in real JSX. Two pins guard the limits: a `<Loading>`
  inside the branch still shows its fallback ahead (#3851, S-31) and the
  #3540 matrix's early fallback (hidden mounts do not keep the branch;
  memos never count, only render effects). 0 B on the core floor; +57 B
  brotli on the isPending/latest chunk (the list and its scan), caps raised
  with ledger lines. The same day, the maintainer's table (S-58′): the row
  held for a plain-only leaf and broke once the leaf's one grouped effect
  also read ahead — `[latest(m2), m0()]`, or `[latest(m0), m0()]` of the
  same node — under a hand-written gate: `<Show>` and a split leaf kept
  the fallback, the gates attached with the committed `m0` beside the
  ahead read. The born-held arm for a stamped mount sat inside core.ts
  `frameRead`'s `!verdict` branch, so a mount whose own pass had opened a
  window was a verdict reader first and served the screen (A10's pair,
  which is a mainline leaf's rule, not a mount's); and `read`'s pending
  arm handed such a reader to `observeFlight` the same way. Both now test
  the stamp first: a mount a probing pass opened observes the flight on its
  first pass whatever it read ahead, and is born held. −2 B brotli on the
  core floor (the clause left the big condition), +7 B on the
  isPending/latest chunk. Pins: S-58 case ′ (three variants) and
  `web/test/display-ahead-gate-leaf-reads.spec.tsx`, the table itself.
  Review (#4723): the new arm, ahead of the lane-over return and the
  stale-reader path, also fired for lane work reading a held node that is
  not pending — the guess's target under a zero-hop gate — and joined the
  flush to the hold (D-37). The arm keeps the old lane guard (`!lane ||`
  el pending). The row the review asked for (case ′ with the write inside
  an action, a guess on `id`) found the same frame on `next` by another
  path: under a guess lane the stamped mount's first pass read the lane's
  pending node through lanes.ts `laneRead`'s render-effect arm, which
  serves lane work the screen (A15's stale reader, D-28) — the mount
  initialized with S-46's frame inside the lane's, revealed at the action's
  landing, and kept it after the answer (F-1). The plain-only leaf tore the
  same way; only the single-memo gate escaped, by re-creating its branch at
  the landing. `laneRead` now returns NOT_PENDING for a stamped
  uninitialized mount reading a pending node: it waits on the flight
  (`read`'s throw) as in a mainline flush. Pins: S-58 cases ″ (the mixed
  leaf) and ‴ (the plain-only leaf), each through `<Show>`, both
  hand-written gates and a split leaf. 0 B on the core floor; +18 B brotli
  on the isPending/latest chunk (guard and lane arm together).
- 2026-11-07: **A question is asked only of the truth** (F-2's producer
  clause; F-6's limit). Prompted by GabbeV's `experiment/unified-updates`
  (its tests run against `next`, the differing screens tabled as S-51–S-56)
  and settled on #4677: the badge, an async memo over `id` and
  `isPending(id)`, asked `badge(0, true)` from its display-ahead pass while
  the engine held `id = 1`. The stale ask was licensed by L2's rule 6
  (2026-10-04, "a verdict reader of a held node is the holder's verdict
  lane's — shown now"), which seated the reader's whole pass, body included,
  in a lane; A10's atomic pair (#2831, 2026-07-06) made the pass runnable on
  the committed value; Decision 1 and the D-25 collapse (2026-11-05)
  generalized it to memos and read #3905 as "not needed". The model as
  ruled: one version per node; the hold is the only producer of a change's
  consequences; the display — render effects, compiled bindings, user
  effects (their callback runs at the frame they belong to), and the sync
  derivations feeding them — is the one declared, terminal, kept-not-computed
  inconsistency, so memo-inline parity holds and S-27's memo row stands; the
  act is the async derivation, which is the hold's wherever it is reached;
  `latest` is never stale and `isPending` is a fact, readable anywhere; a
  guess is not stale until corrected (D-34 already said so); inside a hold's
  work a verdict about that hold is answered. #3905 is not warranted: the
  display lane cannot ask, so there is nothing to propagate. Full #3905 (two
  versions everywhere) was weighed and declined — the inconsistency is meant
  to be narrow. Rows: S-51 (one question, of the truth; the `isPending` hole
  shows at once), S-52 (the #4349 held shape was the odd one out), S-53
  (`latest` shows a held recovery ahead, value/error symmetry), S-54
  (pending stays true for a held, unshowable answer), S-56 (a guess before
  the first answer shows); S-55 standing (F-11). Built the same day for S-51
  (`askerJoins`, core `frameRead`/`read`, verdict.ts, scheduler `laneDirty`,
  the seat table's V0/Vp0 rows): the marker is `CONFIG_ASYNC` kept across
  windows (`holdWork` pairs it with CONFIG_OWN_PROBE); a plain or
  `isPending` read of a held or staged node by such a pass joins the frame
  and un-seats it from a verdict lane; it is re-derived by neither the seam
  nor a verdict lane's pass; it carries no inherited verdict posture, so a
  memo over it inherits none (#4504). `latest`-only askers stay lane work
  (F-6), so the verdict lane keeps those flights — the simplification §17
  hoped for is not there. Cost: +205 B brotli on the isPending/latest chunk.
  The `truth-asks` oracle's twelve gate cases became improvements; 29 pins
  in four files lost their display-ahead questions. S-54 built next
  (verdict.ts, the lane-node probe arm): a lane derivation's answer that
  landed while the lane is held on a sibling's flight keeps `isPending`
  true for a reader outside the lane, which re-derives at the reveal
  (`staleReader(c, l)`); three checkout pins in `createOptimistic.test.ts`
  changed (opacity waits for the lane while `latest()` text shows ahead).
  +34 B brotli on the isPending/latest chunk. S-53 built next (core.ts
  `recompute`, scheduler.ts the park): a recovery to the last good value
  in a flush that has joined a hold is a change of answer, so it stages
  with the shown error and is held, where before it published silently
  (`settleErroredDependents`, #2949's path) and left the display-ahead
  readers downstream with nothing to show ahead of — the `Show` it gated
  was held whole and the boundary kept `[E]` until the landing; the park
  no longer nets a staging that replaces a shown error. `latest` of the
  held recovery shows it ahead as it shows a held value, the readers are
  verdict-lane work, and the boundary recovers at the lane's seam. Unheld
  recoveries keep the silent path (same screen; #2701's boundary
  depends on it). The #4403 pin flipped. S-53's plain-read case (`′`) is
  S-46's plain row: the branch born held, the `Show` waits — today the hole
  attaches empty (#4417's mechanism), which the shown error masked before.
  +11 B brotli on the core floor. S-56 built next: the memo-form setter
  no longer calls `devGuardOptimisticBeforeLoad` (signals.ts) — the engine
  already carried a guess over an uninitialized node as its lane value, so
  the guess shows in place of the loading, `isPending` is true while the
  first flight is up, the function form receives `undefined`, and the first
  answer judges it; a guess whose lane never shows is void at the
  correction as before (the A18 d pin). The guard stays for derived
  optimistic stores: without it the store's screen stays loading while an
  untracked read sees the guess, and the first answer folds the guess in
  rather than judging a shown one — store engine work, parked with the
  store branch. Three pins flipped. S-52's #4349 shape built next
  (verdict.ts `observeFlight`): a render effect routed into a verdict lane
  no longer reads a flight "as lane work" that holds nothing (the D-26
  arm, #4661) — it observes the flight as a memo reading the same pair
  does (`verdictRead`, a frame reader), so an action ending inside the
  call is held on the flight it just probed instead of landing beneath it
  (CONFIG_INPUTS_PUBLISHED, #3305) and re-running the effect on the
  committed world, where the published-inputs read parked it. The pair
  shows `[true, 41]` ahead in every shape — render effect or memo, probe
  before or after the plain read — and the landing reveals `[false, 42]`.
  One pin flipped (the #4349 file's last case); the refresh shapes are
  unchanged. A few bytes fewer. Last, S-57 (the experiment's A2, "optimism
  winning when combined"): a plain write whose derivation became a guess's
  lane work was published beside the stale derivation because the lane had
  taken the only question; ruled F-2 as written — the write holds on the
  lane's flight and reveals with it, the frames entangled. Built the same
  day (lanes.ts `laneStage` → `laneWait`, at the tail of the lane pass —
  first as a core hook from `recompute`'s NotReady arm, moved out of the
  core the same day): a pass that read this flush's staging, ran as a
  guess's lane's and went pending makes the flush join a frame, lists the
  node on the lane (`Transaction.waits`, on the lane; `lanesBlocked` finds
  the frame through `over` with `liveTx`, so a frame merged since still
  waits — the `merge` append this replaced was 21 B brotli of core) and
  sets the lane `over` the frame, so the lane's work reads the frame's
  staging as its own world (core `frameRead`'s `over` arm) and holds while
  the frame does (`laneSeam`): one question (`label(5, 10)`), one reveal. The pass is
  dropped from `stagedReaders` so the seam does not re-ask the old world's
  question. Not the hold's own work (its parent already waits on the lane,
  `nestedBlocked`), not a verdict lane's `latest`-only asker (the same
  sentence, not built: the write publishes as before), and not a lane
  already over another live frame (a keyed rebase over a landing's answer,
  #4536 — `over` is one slot): the write publishes as before, beside the
  lane's answer to its old question (#4577's matrix keeps its screens).
  No pin flipped; the S-57 row's case 1 is standing. S-46's plain row built
  last, prompted by PR 4708 (the probe-gated mount without `<Show>`'s hop):
  a first pass under a pass that probed is stamped CONFIG_MOUNT_AHEAD at
  `recompute`'s head (one test of the creator's REACTIVE_PROBED, inside the
  existing lane-engine block), and core.ts `frameRead` no longer serves such
  a render effect the screen on its first pass: the branch a display-ahead
  read gates is a mainline mount whose first read of the hold's staging or
  flight is born held, not a D-3 leaf. lanes.ts `lanesBlocked` holds a
  verdict lane's reveal while a stamped render effect in its nodes' frames
  is born held and still waiting — on its own flight, or on a flight its
  frame holds (`mountPending`; only flights count, an orphaned first-mount
  leaf would otherwise deadlock the lane): revealed earlier, the branch
  attached with its hole empty (#4417) or with the committed value a seam
  re-derive's mount read (S-46's ✗ rows). Real `<Show>` and the compiled
  ternary keep the fallback through the flight and attach at the landing;
  the e1-3289-1831 pin flipped to `[F]` for that step and the S-46 row's
  case 1 is standing. A first build walked the owner chain on every held
  read (+43 B brotli on the core floor) and was reverted for the stamp
  (+8 B core, +96 B on the isPending/latest chunk — the seam walk). Not
  built: a hop-less single-memo gate (the branch reads the probing memo
  directly, PR 4708's target) still attaches with its hole empty — the
  insert effect reading it is routed into the verdict lane and its run goes
  with the lane's reveal; a mount whose own pass reads another node ahead
  (`[latest(m2), m0()]`, PR 4708's exact scenario) is served `m0`'s committed
  value by the verdict arm (A10 generalized to a different node, which D-25
  narrowed); S-53′ likewise. PR 4708's own two pins do not flip: its `gate`
  variant in the runner does not model the compiled ternary (real JSX
  paints at the landing, the runner's gate never does). After the day's
  trims the core floor is 7,423 B brotli (M1 7,406, cap 7,430) and the
  compiled hello world 9,979 B (cap 9,980): S-53 ~10 B, S-46's stamp ~8 B;
  the isPending/latest chunk carries the rest (+415 B over M1, the seam
  walk `mountPending` ~335 B minified the next thing to trim). Last, D-34's
  `latest` clause (decision 3, #4689): a shown guess a correction re-homed
  into its hold (`supersede`/`dissolveLane` mark it, `keptGuess`) keeps the
  screen's value for `latest` while the hold is blocked — verdict.ts's held
  arm returns `_value` before `heldLatest`; once the hold lands (`blocked`
  false) the landing's re-derive reads the staging, so a `latest`-only
  reader shows the truth at the commit and not a frame later. Built for a
  signal and for a superseded keyed row; seven pins flipped from "latest
  answers the truth" to the displayed guess (#4336's signal form, #4329,
  #3698, #3331's entangled and provenance cases). Not built for a lane a
  correction folded under (rows removed, `Transaction.folded`): `latest`
  of a folded guess reads the world whole as before — kept rows beside the
  truth's length tore inside one `latest` (#4336's store forms) when tried
  per leaf; the arrangement needs to be kept as a whole or not at all.
  +25 B brotli on the isPending/latest chunk, 0 on the core floor.

- 2026-07-17: **A18 store corollary — per-transaction optimistic layer**
  (#2899). `createOptimisticStore`'s override layer is one record per store
  target, but a settling action must consume only its own entries: layer
  writes stamp their transaction in `STORE_OPTIMISTIC_OWNERS` (per key,
  `null` = ambient), and `clearOptimisticOverride` scopes the settle-path
  clear to keys whose resolved owner (merge chains via `currentTransition`,
  dead owners never strand) is the completing transition. Node-level
  overrides already had this granularity via `_optimisticNodes`; this is the
  layer's half. Same-key writes entangle through the shared node as before;
  projection landings still clear everything. Also fixed with #2898 in the
  same window: literal-`undefined` optimistic writes land as
  `OVERRIDE_UNDEFINED` so they can't erase the `_overrideValue` brand.
- 2026-07-16: **A25 ruled — seed invisibility on derived stores** (#2897).
  The seed is a draft for the derive function; outside consumers get
  NotReady (dev strictRead scopes: `PENDING_ASYNC_UNTRACKED_READ` first)
  from every untracked trap path — get, has, ownKeys — until the first
  resolution / first yield lands. Self reads and write-path (reconcile)
  reads exempt. Returning the seed leaked an unobservable value; returning
  `undefined` breaks non-nullable types. Implementation in §5h; six
  createProjection.async pins updated from the old seed-visible behavior.
- 2026-07-13: **A20/A21 re-ruled — question-scoped pending** (supersedes the
  2026-07-07c mask; converged from the #2844/#2728 threads with GabbeV and
  brenelz after cause-scoped pending, per-path masking + UNCHANGED vouching,
  `background()`, and lane-bounded vouches were each rejected). The verdict
  definition is now "a value change in flight that has not yet revealed, or a
  live `affects()` mark": same-question re-asks (refresh/poll/confirm) are
  silent; a new question pends monotonically and nothing silences it;
  optimistic writes are verdict-inert (display without decree — honest mixed
  state over an in-flight question); `affects(target, key?)` is the sole,
  additive declaration verb (single optional key since 2026-07-14 — the
  variadic form read as a 1.x path and was dropped). Vouching, `UNCHANGED`,
  and the store-wide mask are deleted concepts. `isPending` keeps its name (isStale was weighed —
  semantics now match "stale" but the argument-taking form already reads as
  data-scoped; revisit only with docs-team pressure). Implementation in §5g;
  scenario matrix pinned in `tests/question-scoped-pending.test.ts`.
- 2026-07-08: two open items carried out of the retired issue-triage log:
  (1) **queued cleanup from #2838** — the `_parentSource !== el` read-ternary
  exemption and the `NotReadyError` catch in `read()`'s latest branch
  survive the redesign; the suite passes without the former (probed,
  reverted) — take both in the next code-reduction pass with proper
  analysis. (2) **watch-item from #2850** — `unwrapStoreValue` (set-trap
  value extraction) deliberately consults only `STORE_OVERRIDE`, not the
  optimistic overlay: writing another store's optimistic _guesses_ into a
  target store's base data is a different semantic question than reading
  (the guess would outlive its revert). Flag if it comes up.
- 2026-07-07c: **A20 re-ruled — the mask** (supersedes the previous day's
  "overrides are unsettled" entry below; GabbeV model adopted after the
  #2844/#2728 discussions and the todos-example precedent). **(SUPERSEDED
  2026-07-13 by the question-scoped pending re-rule above; kept for the
  reasoning record.)** An active
  override reads `isPending === false` for its whole lifetime, on every node
  kind, in both forms — action affordances belong in the data (co-written
  flags / separate `createOptimistic(false)`), never in verdicts. **A21**
  added: for derived optimistic stores the mask is store-wide (any live
  optimistic write silences the whole store — "the store is the boundary";
  writes to the same store entangle). **A8** re-ruled: `latest` is an
  override the system writes for itself as soon as a held value exists, so
  the latest form follows the source's own async only (never pending on
  signals/sync computeds; false the instant the fetch resolves even if the
  commit is held by merged async). **A9** re-ruled: both forms report a
  firewall refetch on resting leaves (old latest-form filter gone; A21 is
  the only silencer). Implementation in §5f; INV-10 enforces; the
  repo agent rules (`.cursor/rules/async-registration-invariants.mdc`) carry
  the mask rules so future changes can't regress them silently.
- 2026-07-07c: disposal latch fixed (INV-9, the #2845 edge):
  `computePendingState` returns `false` for disposed nodes and
  `disposeChildren` snaps companions, so no verdict outlives its source.
- 2026-07-07: #2838 core redesign landed — V1–V4 fixed (see §5d). The
  carve-out removal reverses the #2799 _mechanism_ while preserving its
  intent (the original #2799 symptom — pending muted during refresh — is
  covered by the A13 spec tests; the fix's over-broad skip was V1's cause).
- 2026-07-07: considered and REJECTED — mode-conditional NotReady from
  `isPending` (throw only during SSR/hydration, return a value in CSR).
  Rationale for rejection: (1) the tracked-uninitialized read is the ONLY
  throwing case — everything post-initialization is already safe outside
  boundaries in every mode, so the proposal only legalizes hand-rolled
  initial-load boundaries (`isPending(data) ? spinner : data()`); (2)
  boundaries are structural (SSR streaming and hydration reveal need
  delimited regions), verdicts are informational — a safe-everywhere client
  primitive becomes the easiest way to write loading UI that SSR cannot
  stream, creating a CSR→SSR migration cliff in code authors consider
  finished; (3) it forks a primitive's semantics by execution mode right
  after V1–V3 established that verdicts must not depend on context
  accidents; (4) the one-rule model "isPending performs the read you give
  it" (the probe is not a shield) stays true in every environment today.
  Keep A16/B5a as ruled.
- 2026-07-07: A20 — overrides are unsettled; pending scope is a property of
  the read. **(SUPERSEDED next day by the 2026-07-07c mask re-rule above;
  kept for the reasoning record.)** (1) An active override reads `isPending === true` uniformly (every
  node kind): overrides mask stale _content_ (A17), not _settlement_ — the
  community no-extra-boolean idioms depend on it. Non-derived optimistic
  signals/stores are transaction-scoped values, not predictions (no source can
  confirm them; reversion is certain), so they are pending for the override's
  whole lifetime. (2) An optimistic write pends exactly the leaves it touched
  (known change set); a refetch pends every read of the store (unbounded
  change set) — broadness is what unbounded uncertainty looks like, not a
  store rule. (3) Three-form algebra: `latest` strips _coordination_
  (transition holds, broad firewall inheritance) and nothing strips
  _confirmation_ (own async in flight, active override) — so the latest form
  is the "unconfirmed edit?" discriminator on store leaves, and is identical
  to the plain form on standalone self-async nodes (A8): `latest`
  discriminates _whose_ unsettledness you read, never _why_. An alternative
  ("override = settled latest view → latest form as pure reload detector")
  was considered and set aside: it makes the unconfirmed-edit question
  inexpressible in any form and breaks the published community idioms, while
  its reload-only question is already answered by scoping reads at
  triggers/sources. NOTE the no-contradiction result that settled the ruling:
  the "optimism guards against pending" pattern (News/Finance) is downstream
  value-shielding — the override stops _invalidation_ from cascading, so a
  downstream memo stays clean and its own verdict stays false; pending
  propagates through async status flags, not through cached values, so the
  optimistic node's own `pending === true` never "reads through" a clean
  memo. Both halves are pinned by the News/Finance action tests.
  Latest-form leaf filtering is currently broken (fires during pure refresh,
  then the companion is STUCK true at settle — INV-4 catches the stuck
  state): pinned as V4 for the #2838 redesign.
- 2026-07-07: C2 ruled — reverts do not trump other live lanes; a revert
  releases only members of the reverting node's own lane. Fix + INV-8-style
  assertion ("live lane members are only released by their own lane's
  resolution") queued for the #2838 redesign.
- 2026-07-07: C3 closed by A19 — early transition completion in reporter-less
  graphs is legal; verdicts must not depend on it (V3 pins the symptom).
- 2026-07-07: C1 → A19 — `isPending(x)` ≡ "the observable value of x is not
  final". Three causes with independent lifetimes: (i) transition-held write
  (ends at commit), (ii) own async in flight (ends at resolution), (iii)
  fresh value held uncommitted by an entangled transition (ends at commit).
  Uninitialized async is loading, not pending; its initial NotReady plays to
  boundaries for SSR/hydration (A16). Partially reverses the earlier
  boundary-scoped framing, which was cause (i) wrongly generalized to
  (ii)/(iii). Verdicts must not depend on reporters/graph topology. Causes
  (ii)/(iii) land with the #2838 redesign — pinned as V3/V1 expected
  failures until then.
- 2026-07-07: B4 → A18 — an override's lifetime is bound to its own async
  source, not its transition. Own-source resolution clears/corrects the
  override immediately (fresh value, never the pre-write value); unrelated
  async in a merged transition must not delay the correction or the async it
  triggers. Together with A17: the override holds while its own fetch is in
  flight (transition can't complete and drop it), and yields the moment the
  authoritative value arrives. **(Superseded by the 2026-07-07b re-rule
  below.)**
- 2026-07-07b: A18 re-ruled during the revert-target elimination (§5e) —
  an override's lifetime is bound to **its own transition**, and `_value`
  changes only at commit points. In unmerged graphs own-source resolution IS
  the lane-transition's completion, so behavior coincides with the original
  ruling (all original A18 pins unchanged). In genuinely merged transitions,
  corrections reveal atomically with the merged completion — pending true
  throughout (A20) — instead of escaping early via the revert-commit. The
  "unrelated async must not delay" concern was re-examined: matching
  confirmations collapse silently either way; corrections propagate
  internally on arrival (no waterfalls); only the reveal is gated, honestly
  dimmed. Maintainer: "the non-blocking aspect… this only gates the reveal";
  "`_value` elevation should only happen at the end of the transition."

- 2026-07-06: C4 → A17 — an active optimistic override is THE value for every
  reader (ambient and tracked), regardless of entanglement, until its owning
  transition completes. `transitionComplete` no longer excludes self-sourced
  pending optimistic nodes from blocking completion.
- 2026-07-07: A17 clarification — no-tearing is enforced at the EFFECT level,
  not the read level. When async derived from the optimistic value is in
  flight, the lane holds its render effects (`runLaneEffects` skips lanes with
  `_pendingAsync`), so the rendered view updates as one unit; but direct reads
  (ambient or in-graph) still return the override immediately. An attempted
  read-level gate (return committed value from ownerless reads while the lane
  holds) broke 19 real-world pinned tests (CategoryDisplay/News-Finance in
  `createOptimistic.test.ts` — "direct read shows optimistic, effect waits")
  and was reverted. Render effects read close to ambient semantics (stale
  reads), so a read-level gate cannot distinguish them cleanly anyway.
- 2026-07-06: #2837 — comparator errors are node errors (boundary-containable);
  `setSignal` checks uninitialized before comparator.
- 2026-07-06: #2839 — `EffectBundle.error` is compute-phase only; effect-phase
  throws escalate to boundary/halt. Compute-phase errors in _user_ effects
  without a handler: log + skip run, system stays alive.
- 2026-05..07: #2829/#2831 — `latest()`/`isPending()` fixes; `syncCompanions`
  is the single companion-update chokepoint; `[false, undefined]` test pins
  were a regression, not design.
- #2822 — `ASYNC_OUTSIDE_LOADING_BOUNDARY` is warn-only; the old hard-error
  path was vestigial.
- #2761/#2762 — uncaught errors halt the system loudly (`REACTIVITY_HALTED`);
  recovery belongs to error boundaries.
- #2838 (tracked) — `latest()` shadow should become write-driven post-release;
  the probe-based design is acknowledged overcomplication.

### 2026-11-06 — the seven spike rules rewritten in screen vocabulary; their mechanism text and amendment history moved here verbatim

`RULES-DERIVED.md` D-2, D-17, D-22, D-23, D-25, D-27 and D-34 are now one or two sentences naming their scenario rows (executable: `packages/web/test/async-gen/rulings`, generated into `SCENARIOS.md`). What each rule said before — mechanism, dated amendments, pins, deviations — is kept below unchanged, as the archive the short form was collapsed from. A sentence here is not a rule; the rows are.

#### D-2 as of 2026-11-05 (archive)

##### D-2. A new memo joins a hold by reading it, not by being created

**From:** F-2, F-1, F-7. **Scenarios:** S-3, S-6, S-31.

A memo or effect created while a hold is live is not the hold's because it is new. It becomes the hold's if its first pass reads a held value, sync or async (D-1): it is then _born held_ — it has no committed value until the hold's commit, an untracked read of it throws `NotReadyError` meanwhile, and a render effect created with it first runs at that commit. A render effect that reads it throws, so it holds the change that mounted it (F-2): the branch does not attach until the commit — never an empty slot — unless a fresh boundary catches the read (F-4). A new memo that reads nothing held and nothing pending publishes now. A fresh render effect that reads the held value _directly_ shows the committed value (D-3). The entry is the pass's alone: a write made after the mount is a mainline write, not the action's. **Inside a flush**, a first pass that reads a value this same flush staged (not yet held) is treated as the frame's: it publishes with the flush, and if the flush parks it re-derives on the committed values; only a mount made under a display-ahead reader whose first pass read such a staging is born held (D-27). A boundary a held memo mounts in the same flush is not the hold's by creation: its content does not join, and it appears with the memo at the commit (D-13), on its fallback if its content is still pending then.

A sync memo that has read a held value has produced one, so `latest` of it returns that pending value. It has no committed value, so it has no verdict: inside an owner `isPending` of it holds its reader as its read does — the reader runs at the commit, where the answer is final — and unowned it is `false` (F-9, D-23, D-24). An async memo has produced nothing until its answer lands, so `latest` of it throws. That answer is the hold's while a render effect outside a boundary consumes it, so the hold waits for it (F-2). If no such render effect reads it, the answer is the memo's own first commit once the hold has landed. A lane held on async downstream of the read does not paint, and does not hide a value `latest` can already return.

"In general transitions can hold on any unready read. But new memos created don't need to be part of it" (2026-10-07): a transition holds on any unready read (F-2); creation alone joins nothing. The word in that sentence was async; what was meant was a held value.

**Collapses:** [A29](./SPEC-ASYNC-SEMANTICS.md#a29-a-tracked-read-served-a-live-transactions-staged-value-enters-that-transaction) creation-time form ("born held", 2026-09-14/15, #3451) and its 2026-10-07 amendment "A verdict lane's mount over a staging" (#3851/#3869); L2 statement 3 as amended 2026-10-07; [O2](./SPEC-ASYNC-SEMANTICS.md#o2-creation-under-a-transaction-escapes-the-hold--recorded-not-ruled) (its text is stale — see Flagged); N1 (reverted 2026-10-02); #3761 (ruled against 2026-10-05); recovery 3.1/3.3; #3800 (the async first answer; drafted as D-5 and withdrawn as its own rule 2026-10-09) and the direction rule's value bullets (#3820). **Status:** standing, ruled 2026-10-09 (`tests/born-held.test.ts`, `tests/verdict-mount-first-pass-3851.test.ts`). The async first answer is ruled; built in #3977 (the memo is held into the hold it read, and the hold waits for it unless a boundary that has not shown content catches it; `issue-3800-repro.test.ts`, `direction-rule-probe.test.ts`) (S-6, U-1). Fixed 2026-11-02 (#4417, #4574): a park re-derive that gives back the staging it superseded keeps its held readers and their children (one key, one child), and an insert of a DOM node waits while its subtree holds a child born into the open hold.

#### D-17 as of 2026-11-05 (archive)

##### D-17. A display-ahead read in `on` shows the fallback now, beside the held frame

**From:** F-6, F-5. **Scenarios:** S-21.

`on` re-arms from whatever it reads, and the fallback appears when that read's frame has landed (D-15). `on={latest(id)}`, an `isPending()` or an optimistic signal reads a value whose frame has already landed, so the fallback shows now, beside the page that is still held: `[A] → [A + spinner] → [B + spinner] → [B + comments]`. The hold still owns every read of the held value. Content under the boundary stays off screen until it is ready; content under it that reads nothing held reveals as soon as it lands. No diagnostic. The `[A + spinner]` frame is the new id's loading state inside the old page, the same shape as a header showing the new id early. A memo between `isPending` and `on` behaves as the direct read does. What the _fallback_ reads is not `on`: a fallback reading `latest(id)` shows the new id once it is on screen (F-6), but the swap that `on={id()}` asks for still lands with its frame (D-15), never beside the held value (#4337).

**Collapses:** #3575, B-AHEAD, recovery 6.1, §27 7a (#3528), `tests/loading-on-frame-following-3540.test.ts` §4, `tests/loading-on-rearm-reveal-3540.test.ts` ("on: () => latest(dep)"). **Status:** standing, ruled 2026-10-09 as the frame rule, not a break through the hold.

#### D-22 as of 2026-11-05 (archive)

##### D-22. `latest(x)` reads the newest value a flush has carried; it throws before a first value

**From:** F-6, F-10, F-9. **Scenarios:** S-25, S-45.

`latest(x)` answers the held write (the newest value a flush has processed, held or not — for a memo nobody has read, the value the flushes it missed would have given it), the optimistic value where one displays, the arrived truth under a superseded override, and the committed value of a node whose own flight is up (below the async nothing newer exists). A sync derivation of a held source is visible through it (the held recompute is a write path like any other). It throws `NotReadyError` only when no value has been produced — before a first landing, including an async memo with no resolution — in every scope. It returns `T`, never `undefined`. A lane held on async downstream of the read does not paint, and does not hide a value `latest` can already return. A memo behind a fallback, or in a branch not yet attached, has still produced its value, so `latest` returns it — a memo born held included: its plain read throws, and `latest` returns its pending value (F-9). Resolved async never pairs `[false, undefined]`. **A first landing a hold carries is a produced value (clarified 2026-10-28, amended 2026-10-30):** an async memo's first answer that lands in the same tick as a write to its input that a hold carries — an action's, or a plain write re-asking it — is held with it (D-4), and `latest` of it returns that answer while the plain read still throws (F-9); a `Loading` whose only read is `latest` of it shows the answer now (S-40). The frame is whole: the screen's committed input beside the answer to it. **A memo nobody has read has still produced what the flushes it missed would have given it (ruled 2026-10-30, #4474):** `latest` of a memo on the observation lifecycle (unowned, or `lazy: true`) whose sources have committed values is that value, computed on the committed world (laziness is never observable — #3078, #4366, #4474). An identity memo over an async memo, read for the first time in the flush that re-asks the async memo, shows the async memo's landed answer and is pending on the re-ask, the same screen as with a prior reader of it; a plain read of it in that mount is not display-ahead (D-27): its reader is born held (D-2) and shows the re-ask's answer. **Inside a flush, `latest()` of a staging not yet held is the frame's read like any other (clarified 2026-10-28):** it serves the staging, opens no hold, and leaves a plain read beside it in the same pass reading the staging too (F-10: one frame for every channel); if the flush parks, the pass re-derives once as a verdict reader (D-2, A10). A `latest()` read that manufactured a hold for the frame so its pass could run once made the plain reads after it see the screen in a flush that then committed (#4365).

**Collapses:** [A28](./SPEC-ASYNC-SEMANTICS.md#a28-a-write-becomes-visible-at-flush--to-every-channel) (`latest` reads the flushed staged world), [A11](./SPEC-ASYNC-SEMANTICS.md#a11-sync-derivations-of-held-sources-are-visible-through-latestispending), [A7](./SPEC-ASYNC-SEMANTICS.md#a7-resolved-async-never-reads-false-undefined), [A17](./SPEC-ASYNC-SEMANTICS.md#a17-an-active-override-is-the-displayed-value-until-its-transaction-commits-and-the-graphs-value-until-its-own-source-answers) (`latest` returns the arrived value). **Status:** standing. **Fixed 2026-10-31 at the release (#4474).** The memo was not lazy but unowned — a memo on the observation lifecycle (unowned, or `lazy: true`) computes eagerly and, blocked on an uninitialized async source, is re-enqueued by that source's landing like any dependent; the settle walk queued its retry and then, finding it unobserved, released it (`async.ts`: `releaseIfSettledUnobserved` → `unobserved` pulled the retry back out of the heap), so the node never computed the landing and woke later with no value. Now the release waits for the pass the walk queued (REACTIVE_RELEASE_AFTER): the retry runs — once, as the owned twin's does — and `recompute`'s tail releases the node if it is still unobserved and settled (#2934's no-perpetual-recompute contract kept; #3078's read-revives and pre-heap reclaim untouched). Both read orders read as ruled through the existing paths (`tests/latest-unread-identity-memo-4474.test.ts`, `web/test/latest-unread-identity-memo-4474.spec.tsx`, `tests/released-memo-retry-runs-4474.test.ts`). A fix at the wake was built first and parked on 2026-10-31 (reference branch `fix/core-batch-4474-4417`, commit `ed85ca2a3`: +186 B brotli on the core floor and a generator regression, 91501 #15992) — history, not the mechanism. Consequence worth knowing: a settle's one retry is a compute — an unobserved async memo over a landing source starts the one flight its owned twin starts, then is released at that flight's landing.

#### D-23 as of 2026-11-05 (archive)

##### D-23. `isPending(x)`: three causes, two exceptions, question-scoped, atomic with the value

**From:** F-9, F-1. **Scenarios:** S-26, S-27.

`isPending(x)` is `true` while any of three causes holds: (i) a write held by a live hold; (ii) the node's own async in flight for a new question; (iii) a fresh value landed but held uncommitted by a hold it is entangled with — and `false` the moment none does. Exception 1: a node with no committed value — a first load, or a memo born held over a held value (D-2) — is loading, not pending. A node answered and then re-asked in the same flush — an async first answer that lands in the tick a write re-asks it — is not a first load (amended 2026-10-30): its answer is a produced value, so `latest` of it shows the answer and `isPending` of it is `true`, the re-ask being a new question; so is a derivation of it with no value of its own, at any depth (F-9, D-22). It has no verdict: inside an owner `isPending` of it does what its read does — a first load's `NotReadyError` goes to a boundary or holds the change (F-2); a reader of a memo born held is held with it, or caught by a boundary that has not shown content — and the reader runs at the commit, where the answer is final; unowned it is `false` (D-24). A node with a committed value is judged wherever its readers are: on screen, behind a fallback, or in a branch not yet attached. **A node initialized while pending by propagation is committed and pending (ruled 2026-10-31, #4569):** an answer that lands on a node with no committed value while an upstream re-ask has marked it pending by propagation — its own flight still current, nothing superseded it (#3373) — initializes the node: a node's question changes only when the node itself re-runs, so the answer is current, and the node is committed and pending on the upstream flight. Content that reads only its verdict reveals with `true` (S-40: a fresh boundary reading only a display-ahead channel shows what it has); content that reads the node holds until the chain settles — a first reveal has no screen to keep (F-2). That asymmetry is the rule, not a bug; a reading that kept the node loading would need a supersession by propagation no rule has, a new resting state, and would treat an uninitialized node more strictly than a committed one. A verdict on content that may have no committed value is read inside the boundary that owns it — `<Loading><p>{m()}</p><span>{isPending(m) ? "updating" : ""}</span></Loading>` — where its reader is caught with the content; read outside, it holds the change that mounted it. Either way no answer is shown before the commit: `<input disabled={isPending(data)}>` is never seen enabled over an unjudged value (`packages/web/test/ispending-guard-born-held.spec.tsx`). No verdict is the honest answer: `true` would say "updating" for something never shown, and `false` would read as settled to a guard like `if (!isPending(x)) save(x())`. Exception 2: a re-ask of the same question is quiet; an `affects()` mark is a declared new question and pends exactly the marked data and what derives from it, released when the declaring hold settles (or at flush end, ambient). `[isPending(x), x()]` read in one scope never pairs `true` with the fresh value: a verdict reader sees the screen — in either read order — unless it is a node a hold's fetch is waiting on (D-25). `isPending(() => latest(x))` follows `x`'s own non-quiet async only — on a signal or sync memo the latest form is never pending — so `[isPending(() => latest(x)), latest(x)]` never pairs `true` with the fresh value either. A spinner driven by `isPending` fires while the owner's async is still in flight (it does not wait for the hold).

**Collapses:** [A19](./SPEC-ASYNC-SEMANTICS.md#a19-ispendingx--the-observable-value-is-not-final-three-causes), [A24](./SPEC-ASYNC-SEMANTICS.md#a24-question-scoped-pending-pending-iff-a-value-change-is-in-flight-or-an-affects-mark-is-live), [A10](./SPEC-ASYNC-SEMANTICS.md#a10-ispendingx-x-is-atomic-within-one-scope), [A8](./SPEC-ASYNC-SEMANTICS.md#a8-ispending--latestx-follows-xs-own-async-only--verdicts-are-per-channel), [A14](./SPEC-ASYNC-SEMANTICS.md#a14-companion-nodes-get-child-lanes-that-do-not-merge-with-the-owner), [A20](./SPEC-ASYNC-SEMANTICS.md#a20-superseded-optimistic-writes-announce-a-store-wide-pending)/[A21](./SPEC-ASYNC-SEMANTICS.md#a21-superseded-the-store-wide-mask) (superseded — the mask is gone), recovery 6.3. **Status:** standing. A probe alone holds nothing; a plain read beside it holds (`optimistic-settle-verdicts.test.ts` #3409, `question-scoped-pending.test.ts` 3.4; #3977). `isPending` of a memo born held, read inside and outside the boundary: `tests/fresh-boundary-born-held-reader.test.ts` (#3977; the engine joins the reader to the hold as the read does, which is the throw's observable effect). A first load answered while pending by propagation from an upstream re-ask, under a boundary (the issue's verdict-only content, a 3-deep chain, the plain-read controls that hold) and in a root: `tests/first-load-superseded-answer-4569.test.ts`, `packages/web/test/first-load-superseded-answer-4569.spec.tsx` (#4569, ruled 2026-10-31). **Known deviation (#4469, 2026-10-30):** a verdict reader is re-run at every landing of a hold it observed, even when the landing changes nothing it read; the gate that would skip it needs a deps walk. Measured 2026-10-30: two cheaper gates broke F-9/D-23 (verdict-memo-flight-no-reask) and #4189 (errored-store-probe-settled-3962) pins and failed the frozen floors by +31/+36 B. A plain reader of the same recovered hold is not in this: it shows the committed value for the whole hold and runs once, at the commit, since a recovery to a value equal to the last good one is still a change of answer (D-41, D-9). Pinned in `tests/hold-recovers-landing-reruns-4469.test.ts` (the verdict rows `it.fails`). A verdict reader of a signal whose writes net to its committed value in the tick an action opens a hold is not in this either (#4485, fixed 2026-10-30): the writes made no proposal (D-8), so the reader is not the hold's stale reader and `isPending(s)` stays `false` (`tests/netted-verdict-reader-4485.test.ts`).

#### D-25 as of 2026-11-05 (archive)

##### D-25. A display-ahead reader's own async is held; a memo computes under its own posture

**From:** F-6, F-1. **Scenarios:** S-29.

What is rendered from a display-ahead read reveals together with it: an async memo over `latest(x)` holds the `latest` view's reveal until it lands; a combined `isPending(() => [fast(), copy()])` over two async memos, one wrapped in a sync memo, stays `true` until both land, because a memo's value is one shared slot — it computes under its own hold posture, never under the posture of whichever reader pulled it. A node whose fetch a hold is waiting on is that hold's work, not a verdict reader: a pass that re-runs it while its fetch is in flight reads plainly — following the change it is fetching for — even if an earlier pass of it called `isPending` or `latest` (#3884). A memo's posture is what it reads: one that reads a verdict reader's value is a derivation of a display-ahead read, and a verdict reader itself — `createMemo(() => [held(), V()])` with `V = createMemo(() => isPending(x) && latest(e))` shows `V`'s verdict now, beside the screen's `held()`, as the inline probe and a render effect reading both do (#4050: a Provider's children memo over a router shell). **The probe decides the pass's posture in either read order (clarified 2026-10-28):** a pass that probes is a verdict reader whether the probe came before or after a plain read of the same held node — `[x(), isPending(x)]` and `[isPending(x), x()]` both show `[committed, true]` now and re-derive at the landing (A10) — unless the pass is the hold's own work: born in its world (D-27, #4341) or re-run by the write it holds (#3884 above). Those two read plainly; a probe does not rescue them. A pass that read two holds' display-ahead values is one reveal unit of both (A15 lanes corollary, #3335): it waits for either lane's flight, never showing one hold's `latest()` beside a half-computed derivation of the other's.

**A verdict posture outlives the pass that asked (ruled 2026-10-28):** a pass that asked (`isPending`, `latest`) is the hold's verdict reader on every later run of its node until one completes having asked nothing — that run still reads as a verdict reader; the next is an ordinary derivation. On each such run its plain read of a node the hold holds is the screen's (a frame reader, A10; re-derived at the landing as A15's stale reader) and it joins nothing, whoever dirtied it — a sync write, a boundary redraw, a landing. The hold's own work is not in this: a node whose fetch the hold waits on, or a pass born in its world, reads plainly whatever it asked before (the #3884 clause and D-27 #4341 above, unchanged). A boundary's display-ahead swap is this posture handed on: an `on` pass that read `latest`/`isPending` is a verdict reader, and the fallback swap it asks for runs as that reader's work — the output's pass reads nothing of the held frame (a pending tree is linked, not read) and its answer, the fallback, is shown now beside the held frame and stays the screen until the landing, instead of being staged with the write's frame as a plain `on`'s swap is (D-15): `[A] → [A + spinner] → [B + spinner] → [B + comments]`, never `[A] → [B + spinner]`. Only the `on` pass's asking counts: `latest()` inside the fallback is the fallback's own display-ahead, not the swap's — a plain `on` over an action-held input lands the swap with the frame whatever the fallback reads (#4337). Today two memories carry this — `CONFIG_VERDICT` left on the node by the pass that probed, and the node's listing in the hold's verdict lane (`fallback`'s `b._lane`, `recompute`'s head) — and the rule is the posture, not the membership. Pins: `tests/loading-on-rearm-3540.test.ts`, `tests/loading-on-frame-following-3540.test.ts` §4–5, `tests/loading-on-latest-fallback-4337.test.ts`. **An inherited posture is not a probe (2026-11-02, #4544):** a pass whose verdict posture is only inherited — it read a verdict memo, and neither it nor its node's last pass opened a window of its own — is the hold's work where it reads the hold's own write (a sync write the hold holds, not a flight's answer): it is served that staging and joins the hold, as a plain derivation does. One flush or several make no difference (F-10): before the flush parks, the pass reads the flush's own write as that staging, leaving the verdict lane an earlier read of the verdict memo seated it in, as the other read order keeps it out. Not a staging a window asked of under the hold that holds it (or in this flush, before one): `[latest(x), x()]` through a memo stays atomic (A10, D-26: `tests/latest-memo-inline-parity.test.ts`). That mark is the hold's — it expires when the hold lands or dissolves, and a later hold reads the node as never asked. A pass that probes in its own body stays the hold's verdict reader and reads the screen (F-6 over a staging it holds). When a frame born into the hold (a render effect never committed) reads such a reader's settled value and goes pending on what that display-ahead value asks for, the pending does not hold the hold (F-6: display-ahead readers never hold the change they read ahead of): the hold lands, the reader re-derives at the landing (A15) and the frame with it. A lane's reveal still waits on it (S-29). A store key is served the same with or without a node (R2, signal parity): a node-less staging is this flush's own write with no node a window could have asked through, so the posture alone decides (2026-11-04, #4681). Pins: `tests/verdict-memo-held-branch-4544.test.ts`, `tests/posture-store-parity.test.ts` S9.

**Collapses:** [A31](./SPEC-ASYNC-SEMANTICS.md#a31-a-memo-computes-under-its-own-lane-posture-never-its-pullers) (#3442), §20.1 question 3 ("Yeah definitely it is held. Consistent with any optimistic update"), OL-R24/R25/R34, recovery 6.2. **Status:** standing. A memo over a verdict memo: `tests/verdict-memo-under-held-memo-4050.test.ts`, `packages/web/test/held-shell-pending-feedback-4050.spec.tsx` (U-10). **Fixed 2026-11-01:** the verdict shortcut in `propagateStatus` (a probed source settling re-derives its verdict reader) now clears the settled source from the reader's pending sources — left in place, an errored probe target stranded a reader re-parked on a second source at that source's landing; `tests/verdict-shortcut-pending-source-liveness.test.ts`.

#### D-27 as of 2026-11-05 (archive)

##### D-27. A verdict reader's mount is a mainline mount

**From:** F-6, F-4, F-1. **Scenarios:** S-31, S-46.

A `<Show when={latest(x) > 0}>` opens at once (display-ahead). The `<Loading>` it mounts is a mainline mount: it does not inherit the display-ahead world, so its content reads the screen's `x`. Inside an action's own flush that content's first pass reads the staging the action is about to hold, so it is born held (D-2): the boundary shows its fallback beside the committed `x = 0`, and `content 1` appears at the landing. Never `content 1` beside `x = 0`. A first pass created by an _optimistic_ lane, by contrast, is that lane's work (a binding an optimistic mount creates lands with its element).

**Why the two differ, and what the mount's content may show (clarified 2026-10-28).** A plain read is never display-ahead; only a read that asks (`latest`, `isPending`) or a slot that is guessed (an optimistic value, F-11) is. A guess is _slot-level_: it is the value of its slot for the whole screen, so every plain read of it agrees and an optimistic mount's plain reads show it without tearing. `latest(x)` is _read-level_: only the reads that say `latest` see the held value. A mount's children are _gated_ by the display-ahead read, not _derived_ from it (F-6's "what is rendered from a display-ahead read" is the derivation — `fetch(latest(x))` — not the branch it opens); their plain `x()` is an independent read, and showing it the held value would make a plain read's answer depend on which `Show` wraps it — two plain reads of one signal disagreeing on one screen. So the content reads the screen, and the fallback it shows is `Loading` declining to tear over content that is, by the author's choice of a plain read, not yet the committed value. To show the held value inside the branch, read it there as `latest(x)`: `content {latest(x)}` shows `content 1` now, with no fallback. **Whoever opened the hold (ruled 2026-10-30):** an action is a way to extend a hold, not a different kind of one — a plain write held by an async memo on screen is the same case: the branch a display-ahead `Show` opens is born held and keeps the fallback until the landing, `latest(x)` inside shows ahead, a `Loading` inside shows its fallback (S-46, `tests/display-ahead-plain-write-content.test.ts`).

**A joined pass's children are the hold's (promoted from A29, 2026-10-28):** a pass — a render effect included — that read a node with no screen to fall back to (a node born into the hold, never committed: D-2; D-4's tick-join) joins the hold: it has no committed value to show, so it is not a leaf reading the screen (D-3) but a reader that waits (A29 ruling A, 2026-10-01: "every reader derives from it — a render effect included — and joins"). A node it creates during that pass is born held: its value commits with the frame, and a mainline reader of it waits rather than showing it ahead of the frame (F-7) — the subtree-disagreement tear this rule guards against, a child's value on screen beside a parent frame still held. Shape: a lazy outlet's render effect reads a router query memo that has no committed value and creates a memo during that pass; the memo is the navigation's, even where its own first pass reads nothing held. This is the third mount beside the two above — a verdict reader's is mainline, an optimistic lane's is the lane's, a joined pass's is the hold's — and A29's "a held pass's children compute but do not effect and die with the commit that replaces their frame" is its archive form. Pins: `tests/lane-uninitialized-landing-3648.test.ts`, `tests/boundary-output-frame-reader.test.ts`, `tests/loading-fallback-in-flush-3540.test.ts`, `tests/fuzz-findings-l2.test.ts`.

**Collapses:** #3851/#3869 (2026-10-07), [A29](./SPEC-ASYNC-SEMANTICS.md#a29-a-tracked-read-served-a-live-transactions-staged-value-enters-that-transaction)'s 2026-10-07 amendment, L2 statement 3 as amended, #3835. **Status:** standing (`tests/verdict-mount-first-pass-3851.test.ts`, `tests/optimistic-mount-binding-3835.test.ts`).

**Parked (2026-10-31, #4417; issue open).** The ruling stands: the branch a display-ahead `Show` opens under a plain write's hold is born held and attaches once, at the landing, with its content (S-46 — today it attaches with its text hole empty, F-2's empty slot; and the `[1,2,2]` mount-count pins of `tests/boundary-not-born-held-3540.test.ts` / `web/test/loading-on-keyed-boundary-3540.spec.tsx` see a third mount). A fix was attempted on 2026-10-30 beside #4474's ("a pass whose mount is the hold's is the hold's": a render effect born held under a verdict-lane mount marks its creator pass joined, and `laneStage` leaves the verdict lane for the hold; reference branch `fix/4417-display-ahead-attach-parked`, commit `04c218537`) and dropped before #4474's reference branch was cut: it looped forever on the generator's seed 91501 #32043 (`boundarySeam` → `redraw` re-enqueueing a held boundary's output every round) and opened four new findings (seed 7 #1691 E6, #17379 E1, #38770 E6, #46918 E1). Rulings reaffirmed 2026-10-31 after a rules review: S-46 reading A (born held, attaches at the landing — entailed by D-27 and D-2's in-flush carve-out; attaching with the committed value instead would re-rule S-31's `[fallback]` row) and the `[1,2,2]` mount count. No mechanism inside the size budget is known for either half: adoption's frame half measures ≥100 B minified on the live-page floor; the display-ahead attach attempt looped. Parked; issue open; pins stay `test.fails` at the ruled screens: the S-46 plain row in `web/test/display-ahead-plain-write-content-s46.spec.tsx`, the four `[1,2,2]` rows. Fixed 2026-11-02 (#4417, #4574): a park re-derive that gives back the staging it superseded keeps its held readers and their children (one key, one child), and an insert of a DOM node waits while its subtree holds a child born into the open hold.

#### D-34 as of 2026-11-05 (archive)

##### D-34. A different truth corrects the graph now and the screen at the commit; what the screen never showed is void

**From:** F-11, F-1, F-6. **Scenarios:** S-33, S-44.

When an override's own source answers (its own landing, or a sync recompute from an upstream change): an equal answer confirms silently — nothing re-runs; a different answer corrects — derivations re-derive from the truth now as the hold's work (downstream refetches restart at once, no waterfall), the screen and untracked reads keep what the screen showed until the commit, `latest()` answers the truth and `isPending()` reads `true` while they differ, and the correction reveals with the hold. "Keep the override" means keep what _showed_: a guess the screen never displayed — its reveal held on its own downstream flight, including through a shown `Loading` — is void at the correction, and untracked reads see the committed value, as the screen does. A later landing equal to the override restores it as the graph's value. **A write before the first landing is no guess (ruled 2026-11-03, maintainer, #4656):** "if it hadn't landed it isn't optimistic, its loading" (09:22); "Write before load in the non optimistic case gets squashed.. optimistic is odd one because its visible. Idd be ok with it erroring I think"; "I guess it could be in a second list but then it wouldn't have this problem" (09:27); "That or chat input is disabled until it loads" (09:29). An optimistic write to a source whose first answer has not landed — a `createOptimistic` signal's, an optimistic store's, keyed or `key: null`, seed or not — throws `OPTIMISTIC_WRITE_BEFORE_LOAD` in DEV and guesses nothing; the remedies are a separate list (an outbox) for the pending items, or the action disabled until the source has loaded. Production behaviour is unchanged (not specified). So nothing in this rule, or in D-35's re-base, meets a first load.

A keyed store's arrangement guess (rows by key) that the screen showed is not voided by a correction: the truth folds beneath it (one the screen never showed is void, as above). Derivations outside the lane re-derive from the truth now and join the hold, `until`/`resolve` keep their postures over it (an `until` outside the lane reads the truth and joins the hold, D-31), and `latest()` shows the hold's world whole. Lane passes, untracked reads and the screen keep the guess until the commit, and at the commit rows match by key. So a row the truth returns keeps its identity, a row another tab added shows at the commit, and the first of two overlapping actions confirming does not void the second's guess (2026-10-21). A folded lane's list pass inside a frame that already has a transaction reads that frame's stagings as the screen, as a verdict reader does, so it never pairs the truth's length with the guess's rows.

A new question is not the guess's own source answering. When a guess's node re-asks because an input changed outside the guess's own action (a plain `setSel(1)` while a post that guessed over `sel() = 3` is out), the guess cannot stand beside the new input — that frame would show the new input over the old question's answer and the guess (F-1) — so the frame that changed the input is held with the guess's action (2026-10-28, #4336). The screen keeps the old input and the guess until that action commits, then shows the new input with its answer as one frame, however the reads are grouped into render effects (#4284). Meanwhile `isPending` reads `true` while the new question is in flight or held (F-9), `latest()` answers the newest truth (F-6), and untracked reads see the screen. A `refresh()` re-asks the same question and holds nothing new; the guess's own action changing the input is the correction above. A store's derive is one node asking one question for every key, so the hold is decided where the guess is read: a frame still reading a guess when the flush ends is held with it, and a read of a key with no guess is an ordinary pending read (F-2) — `comments[1]` waits for issue 1's answer, not for a post that guessed on `comments[3]`. An input set through its own optimistic write asks the new question in its own lane: the other action's guess does not answer it, so the lane waits for its own answer (F-6) and then shows it, with the guessed node (for a store, every guessed slot of the target its derive writes) as the lane's derivation from there (F-11); the guess's readers wait with the lane, however the reads are grouped into render effects. The other action's guess was only displaced: when the input's action ends without writing the truth, its lane's world is void, the revert re-asks the old question as the revert's work, and the displaced guess comes back in the revert's frame over that answer — `#1: ` then `#3: dana | mine (sending)`, nothing between — and lives until its own action settles (D-33). If the input's action commits, the displaced guess is gone, as for any correction.

**Collapses:** [A18](./SPEC-ASYNC-SEMANTICS.md#a18-an-override-lives-exactly-as-long-as-its-own-transaction-a-newer-truth-from-the-source-supersedes-it-in-the-graph-immediately-on-screen-at-commit) supersession (#3331, 2026-09-09/10) and (d) before the first commit, "Correction display is what showed" (2026-10-05), lane contract 2, lane ruling 5, [A17](./SPEC-ASYNC-SEMANTICS.md#a17-an-active-override-is-the-displayed-value-until-its-transaction-commits-and-the-graphs-value-until-its-own-source-answers) (2026-09-09), OS-R39. **Status:** standing. Fixed 2026-11-05 (#4690): a shown guess a `refresh()` from outside its action corrected keeps the action's hold open while its own source is in flight, as an uncorrected guess does (`lanes.ts` `lanesBlocked`). With nothing rendering the source, the hold landed with the action's write, so effects and untracked reads showed the re-ask's answer until the action's own `refresh()` landed while rendered readers kept the guess — a tear between effect-only and rendered readers, not a flicker on screen; `tests/optimistic-outside-reask-4690.test.ts`.

### 2026-11-06b — the derived rules collapsed 40 → 24; the folded and rewritten rules as they stood

Sixteen rules folded into nine absorbers (D-1, D-9, D-12, D-17, D-23, D-25, D-33, D-34, D-41), D-30 shortened; each stub in `RULES-DERIVED.md` names where it went. The text as of the collapse, verbatim:

#### D-2 as of 2026-11-06 (archive)

##### D-2. A new memo joins a hold by reading it, not by being created

**From:** F-2, F-1, F-7. **Rows:** S-3, S-6, S-31. **Pins also:** `tests/born-held.test.ts`, `tests/issue-3800-repro.test.ts`, `tests/verdict-mount-first-pass-3851.test.ts`.

A memo or render effect is the hold's when a pass of it reads a value the hold holds — its first pass included — never because it was created while the hold was open. Born held, it has no answer until the commit: a plain read of it throws, `latest` of it shows what it produced, and a render effect that reads it holds the change that mounted it, so the branch attaches whole at the commit, never around an empty slot — unless a fresh boundary catches the read (F-4). A first pass that reads this flush's staging is born held when the flush parks, whoever opened the branch (ruled 2026-11-05, decision 4 in `documentation/plans/optimism-seam-spike-brief.md` §8).

**Status:** standing. Mechanism and history: `INTERNALS-ASYNC-STATE.md` §7, the 2026-11-06 entry.

#### D-11 as of 2026-11-06 (archive)

##### D-11. A hold ends when its last on-screen reader leaves

**From:** F-3. **Scenarios:** S-13.

A hold lasts while an on-screen reader still observes a flight it waits on. When the last such reader leaves — disposed, re-run without the read (a gate closing), reset behind a fallback — the writes the hold kept for those readers alone commit at once; a hold is never kept open by a reader that no longer derives from the flight, nor by a display-ahead reader. A `Loading` reset moves the wait onto the boundary instead (D-14).

**Collapses:** [O3](./SPEC-ASYNC-SEMANTICS.md#o3-a-render-effect-gated-away-from-a-never-landing-flight-keeps-the-sources-write-held--fixed), #3426, #3372, #3375, A23 (a probe is never a blocker). **Status:** standing.

---

#### D-13 as of 2026-11-06 (archive)

##### D-13. A boundary whose own mount is held appears at that hold's commit

**From:** F-4, F-7. **Scenarios:** S-15.

Whether a fallback is seen depends on whether the boundary is on screen. A fresh boundary opened by `<Show when={x()}>` with `x` held, or nested in content a hold has not revealed, is not on screen until that hold commits; it appears then, showing its fallback if its content is still loading, its content otherwise. A boundary mounted by a pass that itself joined a hold is the same case.

**Collapses:** the 2026-10-06 boundary-scope ruling ("a boundary mounted as part of a hold appears at that hold's commit"), #3869's "a boundary a held memo mounts in the same flush … appears with the memo at the commit". **Status:** standing. Built (U-3, 2026-10-14): a born-held first pass is not caught when the flush has joined the hold and the pass is its own, so the boundary the mount creates reads its content with the hold and appears at its commit — `tests/loading-fallback-in-flush-3540.test.ts` "a boundary mounted by a pass that joined the hold appears at its commit, no fallback", and the `flight` forms of "a boundary mounted by the hold" (a `<Show>` over a landing, flat and nested). Still order-dependent: a boundary created in the mount before anything in it joins the hold prepares its fallback first (the synchronous first render into the unattached branch) and swaps at the commit, never painted. The same gap shows when a render effect outside the boundary holds the mount (D-12): the boundary prepares its fallback with the held change and swaps to its content in the commit's own flush — never painted, but run (`tests/fresh-boundary-born-held-reader.test.ts`, the outside cases).

#### D-14 as of 2026-11-06 (archive)

##### D-14. A fallback-caught flight holds nothing; an `on` reset moves the wait onto the boundary

**From:** F-3, F-5. **Scenarios:** S-16, S-17.

A flight whose only observers are render effects behind a fallback holds no change — a memo under the boundary that no render effect reads was never an observer at all, and one rendered by an effect outside the boundary is that effect's read (F-3). In both orders: a render effect created under a fallback never counts, and a reader that counted while the boundary showed content stops counting the moment `on` sends it back to the fallback. Writes the hold kept for those readers alone commit at once (`Boundary: Loading... | Sum: 2` publishes as one frame); a reader outside the boundary still holds (`Sum` waits until `details` lands). The wait does not vanish; it moves onto the boundary: after the reset the fallback stays until every reader under it has settled — including readers whose flights started before the reset — then one coherent reveal.

**Collapses:** [A33](./SPEC-ASYNC-SEMANTICS.md#a33-a-fallback-caught-flight-holds-no-transaction-a-loading-reset-moves-the-hold-onto-the-boundary) (#3375, #3459), §23.1 item 1, recovery 2.2. **Status:** standing. The nested form — an outer `on`-reset boundary not waiting for a flight its nested `on`-reset boundary catches — is built (U-4, 2026-10-13: a reader a nested collecting boundary holds is that boundary's alone; `tests/fuzz-findings-l2.test.ts`, fuzzer finding F1). The re-arm over a hold is built (U-9, 2026-10-14): content an earlier hold staged under the boundary, or that reads a hold after the re-arm, is the boundary's — the fallback shows now and the content reveals at that hold's commit, which does not wait for it; no redraw loop (`tests/loading-fallback-in-flush-3540.test.ts`, the re-armed shapes; `tests/loading-on-frame-following-3540.test.ts` §3b, §3c). A fallback staged into the hold its readers land in folds back at any seam, not only the re-arm's own: readers still pending at the re-arm land into that hold a flush later, and the content is ready when it commits (#4379, `tests/loading-on-held-filter-refresh-4379.test.ts`).

#### D-21 as of 2026-11-06 (archive)

##### D-21. An armed boundary lets a lane reveal: the async under the fallback does not hold it

**From:** F-4, F-3, F-6. **Scenarios:** S-24.

An armed boundary catches a lane the same way it catches a transition (D-12, D-14). A fallback lets a transition end early because the reads under it hold nothing; a fallback lets a lane end early for the same reason. A display-ahead value whose own async sits under that fallback is not held by it, so it reveals immediately, beside the fallback: header `1 | loading`, then `1 | details 1` when the async lands. A reader of that same async outside the boundary still holds the lane, as an outside reader still holds a transition. A disarmed boundary is not this rule: it forwards, and the lane holds on the async under it until that lands (F-5).

**Collapses:** the fuzzer-finding F6 ruling's fallback half (2026-10-05, "a boundary on its fallback still holds nothing", A33, B5). The showing-content half of that ruling is F-5, pinned by `tests/fuzz-findings-l2.test.ts` "F6: a lane holds through a Loading boundary showing content". "A boundary output that never committed holds nothing" (2026-10-05) is F-3. **Status:** standing, as the lane form of D-12 and D-14. A header `latest(id)` beside an `on={id()}` re-arm is D-16.

---

#### D-15 as of 2026-11-06 (archive)

##### D-15. `on` is a dependency list; the swap lands with the frame of the change that caused it

**From:** F-4, F-5, F-7. **Scenarios:** S-18.

`on` is a tracked expression whose value is irrelevant; a write to anything it reads re-arms the boundary. Optimistic writes and a source going pending notify like any write; an expression that reads nothing reactive never does; a zero-argument function is a tracked accessor, not a callback. The fallback follows the frame of that read: it lands with the change that caused it — now, when nothing else on the page waits on that change (`[A] → [B + spinner] → [B + comments]`); together with the rest of the new page during a held navigation (the shell reads `product(id)` outside: `[A] → [B + spinner] → [B + comments]` with the spinner arriving with B, not beside A). While that frame is held, the boundary has entered the fallback and the screen keeps the old content; the fallback is seen only if the hold lifts before the new content is ready. If the content is ready when the frame commits, no fallback is ever shown. The children are not re-created.

**Collapses:** #3575 (GabbeV's design, ruled 2026-09-21), B-ON, B-FRAME, recovery 4.1/4.2/5.1/5.2, the `createLoadingBoundary` JSDoc, `05-async-data.md`. **Status:** standing (`tests/loading-on-frame-following-3540.test.ts` §1–§2).

#### D-16 as of 2026-11-06 (archive)

##### D-16. A re-arm whose data is also read outside the boundary never shows its fallback; a race lost is not reported

**From:** F-5, F-7, F-2. **Scenarios:** S-19, S-20.

When the frame of an `on` change waits on the very source the boundary waits on — because a live reader _outside_ the boundary also reads it (a sibling `<Loading>` over the same data, a header that renders it) — the re-arm has entered its fallback, and that fallback is not shown. Only a reader whose read throws holds; an `isPending()` or `latest()` of the data in the header does not (F-2, F-6) — unless the same render effect also reads the data plainly: that read holds (F-6). The hold lifts when the data lands, the content is ready in the same frame, and the fallback is never seen: `[A] → [B + comments]`. DEV reports `LOADING_ON_OUTSIDE_HOLD` once, at the change; the fix is structural (one boundary owns the read). A fresh mount by a separate change is not this rule: the held change is not its frame, so its fallback shows now (D-12). The diagnostic is re-arms only. This is only the flight the `on` change itself started: an outside reader of a flight the change did not start, or content an earlier action holds by a staged write, does not keep the re-arm's fallback from showing now (§3b, §3c of the frame-following pins). A frame held past the content's landing by something _else_ — the write's `action` staying open, other data the shell waits on — is a race the fallback may still win, a legitimate outcome, and nothing is reported (S-20).

A header that reads `latest(id)` beside `on={id()}` shows the new id beside the boundary's old content for the whole hold. That is `latest` (F-6). The boundary's `on` still reads the held value, so its fallback stays off screen; the header does not pull it on screen.

**Collapses:** #3575, #3584 (the after-the-fact report removed), B-SAME-SOURCE, B-RACE, recovery 5.3/5.4, `08-dev-diagnostics.md` `LOADING_ON_OUTSIDE_HOLD`. The 2026-10-06 sentence "committed content included, belongs to that boundary" (deferred in #3824) is this rule's off-screen half. Read as a visible spinner beside the outside reader's stale data, it is withdrawn (2026-10-09). **Status:** standing, ruled 2026-10-09 (`loading-on-frame-following-3540.test.ts` §3, §5).

#### D-24 as of 2026-11-06 (archive)

##### D-24. `isPending` never throws unowned; the probe is reads-only

**From:** F-9, F-12. **Scenarios:** S-28.

`isPending(fn)` returns `false` from an unowned caller (an event handler, imperative code) whose thunk throws a real error or reads a node with no committed value (a first load, or a memo born held — D-23); inside an owner — a component body, a computation, `untrack()` within either — the reader participates in loading boundaries: a first load's `NotReadyError` propagates, and a reader of a memo born held is held with it (D-23). In DEV, a plain `untrack()` in a component body that reads a pending memo the same body created throws `PENDING_ASYNC_UNTRACKED_READ` instead: its `NotReadyError` would re-run the body onto a fresh pending memo forever. Untracked inside a computation, `isPending`/`latest` is a snapshot, as any untracked read is: it does not make the computation a verdict reader, so the computation is not re-derived when its own dependencies go pending — a throw still reaches it through `untrack`. Event handlers are the supported untracked use (#3946: a router's link claim probing inside the computation that creates the anchor). `latest()` shares the mechanism but throws in every scope (D-22). The probe's thunk return value is never inspected: `isPending(() => store)` reads nothing and reports `false`; whole-store questions are asked through reads. (The direct-argument form `isPending(store)` is accepted API for post-2.0.)

**Collapses:** [A16](./SPEC-ASYNC-SEMANTICS.md#a16-ispending-never-throws-in-untracked-contexts) (B5/B5a; wording corrected 2026-09-14), [A23](./SPEC-ASYNC-SEMANTICS.md#a23-the-ispending-probe-is-reads-only). **Status:** standing. The untracked snapshot: `tests/untracked-verdict-rederive.test.ts`, `packages/solid/test/show-untracked-verdict.spec.ts` (#3946).

#### D-26 as of 2026-11-06 (archive)

##### D-26. A `latest()`/optimistic reader mounted or re-run mid-hold shows the committed value and reveals with the lane

**From:** F-6, F-1, F-3. **Scenarios:** S-30.

A held display-ahead world ("a lane") is a hold seen from the outside. A render effect _off_ it that reads what it is revealing — mounted mid-hold, or re-run by an unrelated sync write — shows the committed value (what is on screen), publishes now, entangles nothing, and re-derives at the release: `Late: 0` at the mount, `Details: 1 | Late: 1 | Value: 1` at the release. `latest()` is not special here: a `createOptimistic` source behaves the same. A reader whose removal is staged in a live hold is still on screen and keeps holding the lane while visible; `latest()` read in such a branch peers through to the proposal. A direct leaf reading a lane's derivation shows the lane's revealed value and re-derives at the reveal (control and content never disagree); a derivation between (a memo, a boundary's tree) carries the future and is born held with its mount (D-2). The same holds for a render effect that reads an optimistic value before its lane is judged: if the lane holds on a derivation's flight, the effect shows the committed value and `latest()` of the guess shows the guess beside it, whether the two reads share one render effect or not — `1 x1 / 5`, then `5 x5 / 5` at the landing (#4284). **Inside the lane, "sees the parent's landings" is about computing, not showing (clarified 2026-10-28):** a lane derivation that reads a value the parent holds joins that hold (D-1) — it computes now, so async downstream of it starts without waiting for the commit, and its result shows at the commit as the hold's work. What lane work _displays_ is the screen plus the lane's own values: its guesses, or what its `latest()` reads asked for. A plain read in lane work of a node the parent holds and the lane does not show ahead is the screen's value, in a verdict lane as in an optimistic one (F-6: "a plain read beside it is a read"); `[s(), L()]` with `L = createMemo(() => latest(s))` shows `v:0 l:1`, as the inline `[s(), latest(s)]` does. A15 #3460's sentence is the computing half.

**Collapses:** [A15](./SPEC-ASYNC-SEMANTICS.md#a15-transition-entanglement-is-graph-driven-lanes-settle-as-one-reveal) lanes corollary (#3460, #3463, #3479, #3662, #3698), #3444, the fuzzer-finding F8 ruling (2026-10-05, #3806), the adopted-staging ruling. **Status:** standing; fuzzer finding F5b ("a stale reader of a held re-guess shows the revealed guess") pinned `it.fails`. Grouping: `tests/lane-render-effect-grouping-4284.test.ts`. Fixed 2026-11-02 (#4629, #4633, #4637): a second action's guess into a slot whose earlier action's `refresh()` is in flight shows now, beside the screen's value of the re-asked node (the plain read in lane work above), whatever order the pass reads them in (D-28); `tests/projection-second-guess-4629.test.ts`, `tests/optimistic-second-guess-reask-4629.test.ts`. Fixed 2026-11-03 (#4666): the same with the second guess written into a different `createOptimistic` log — a reader held by another action's hold shows the guess at once when every flight it waits on is a `refresh()` re-ask (D-34 ¶3: it holds nothing new), and a reader pending on that hold's new question stays held (#4577); also into a log whose lane has already shown, where a held leaf reads that lane's staging as the screen and re-derives at its reveal, not as its frame's staging; `tests/optimistic-second-log-guess-4666.test.ts`.

#### D-27 as of 2026-11-06 (archive)

##### D-27. The branch a display-ahead `Show` opens is a mainline mount; its plain reads are the screen's

**From:** F-6, F-4, F-1. **Rows:** S-31, S-46. **Pins also:** `tests/verdict-mount-first-pass-3851.test.ts`, `tests/display-ahead-plain-write-content.test.ts`, `web/test/display-ahead-plain-write-content-s46.spec.tsx`.

`<Show when={latest(x) > 0}>` opens now; what it mounts is gated by the read, not derived from it, so its plain reads mean what they mean on the rest of the screen. A first pass under it that reads the hold's staging plainly is born held (D-2) and the branch attaches at the landing — on its fallback inside a `<Loading>` (S-31), as nothing until then without one (S-46); `latest(x)` inside shows ahead at its own site. Whoever opened the hold, an action or a plain write an async memo holds, makes no difference.

**Status:** standing; S-46's plain row ruled, not built — today the branch attaches with its hole empty. Mechanism and history: `INTERNALS-ASYNC-STATE.md` §7, the 2026-11-06 entry.

#### D-28 as of 2026-11-06 (archive)

##### D-28. A read throws on its own; an earlier read does not disarm a later throw

**From:** F-1, F-2, F-4. **Scenarios:** S-39.

A read that has nothing to show throws, and a throw ends the pass, so the pass is held. Whether it throws is a property of that read. An earlier read in the same pass does not change it: an earlier `latest(s)` does not stop a later `n0()` — a lane derivation whose value has never shown — from throwing. `[n0(), latest(s)]` throws on `n0()` and `latest(s)` never runs. `[latest(s), n0()]` reads `latest(s)`, then `n0()` throws anyway. Both orders hold the mount: control stays off until `n0(1)` lands, then control and `[1, 1]` together. Under a fresh `<Loading>` the same throw is caught (F-4): control on, the fallback, then `[1, 1]`.

Order is not irrelevant. A throw means the rest of the pass does not run, so the two orders are different computations. What must not depend on order is the throw. The empty slot — control on, child absent — is that throw going missing: `latest(s)` put the reader in the lane and `n0()` waited as lane work instead of throwing.

**Collapses:** `read-order-ruling-brief.md` case 827 (the brief's "order never changes what a mount shows" was the wrong statement of this), `rewrite-bugs-rulings.md` item 1. **Status:** standing, ruled 2026-10-09. The `latest`-first order still suppresses the throw today. A fresh `<Loading>` that reads only `latest(s)` beside a sibling reading `n0()` never reads the throwing value, so it is not this rule (D-12, F-6, S-40).

#### D-32 as of 2026-11-06 (archive)

##### D-32. Nothing shows a write before its flush; a guess with nothing to be optimistic over is void

**From:** F-10, F-11. **Scenarios:** S-25, S-32.

`set(count, 30); latest(count)` is the pre-write answer until the flush that carries it, after which `latest(count)` is 30 and `latest(doubled)` is 60 in the same instant. `isPending(x)` is `false` for an unflushed write. A `latest()`/`isPending()` reader created after several flushes answers as if it had always existed (its answer is the holding change's, and lives and reverts with the hold). An optimistic write is visible from the flush that carries it, as a guess over that frame's hold: one an action holds stays for the action's lifetime; one made in a frame that something else holds (a plain write waiting on async) rides that hold. A guess written in a frame that commits with nothing held is as if it never happened — nothing is applied, no effect sees it. A28 (5) and OL-R5 installed that guess for the flush and reverted it (`[1, 2, 1]`): the narrowest width that could be built then. Lane contract 2 (2026-10-01) closes that gap. The `createOptimistic` JSDoc states the tightened rule.

**Collapses:** [A28](./SPEC-ASYNC-SEMANTICS.md#a28-a-write-becomes-visible-at-flush--to-every-channel) (1)–(5), [O4](./SPEC-ASYNC-SEMANTICS.md#o4-adopted-unflushed--the-signals-verdict-channels-see-a-write-no-flush-has-carried--fixed), lane contract 2, OL-R5, OS-R22. **Status:** standing.

#### D-35 as of 2026-11-06 (archive)

##### D-35. Provenance: an older question's answer never corrects a newer guess; the body's end corrects what nothing authoritative is answering

**From:** F-11. **Scenarios:** S-34, S-35.

Two rapid actions on one slot: the older action's refetch landing after the newer override is a question the user has since changed — it is staged for the commit but does not supersede (no downstream re-derivation, no pending flip; `latest` keeps the override; `isPending` is `true` because the held value differs). Only the override's own action, a later action, or mainline supersedes. A keyed store landing beneath an arrangement guess is re-based over the older truth by row key. When every action body has returned and nothing authoritative is in flight — not the override's own source, not a plain load the action asked for — each override still in force is corrected by the truth at hand (the staged equal landing, else the committed value), for a store guess as for a signal's; display is unchanged until the commit.

**Collapses:** [A18](./SPEC-ASYNC-SEMANTICS.md#a18-an-override-lives-exactly-as-long-as-its-own-transaction-a-newer-truth-from-the-source-supersedes-it-in-the-graph-immediately-on-screen-at-commit) provenance (2026-09-10; Q-D 2026-10-03), body-end corollary (#3427), §27 question 1, L2 statement 5, OL-R20, OS-R24/R43/R45. **Status:** standing.

#### D-39 as of 2026-11-06 (archive)

##### D-39. An error fallback is the display; it stays until a new answer replaces the error

**From:** F-12, F-3, F-1. **Scenarios:** S-38.

An `<Errored>` flipping to its fallback is a boundary going back to its fallback: the nodes behind it stop holding (unless read elsewhere, where they error too), and non-errored nodes that lose their only visible consumer that way stop holding as well. The error stays on screen until a new answer replaces the errored one — a pending is not a value: over `Errored > Loading(never shown)`, a write publishes beside the old error (`0 | Fetch error for 0` → `1 | Fetch error for 0` → `1 | Fetch error for 1`); the inner fallback is hidden behind the error. While the fallback shows, nothing under it is on screen, so its recovery re-arms the whole subtree (ruled 2026-11-02, #4627, re-ruling async-gen 91501 #1831): every `<Loading>` under it has not shown content — whether or not it showed content before the error — and once the errored source has its new answer, each catches what is still pending in the replacement frame and shows its fallback beside the recovered content, as on a first load (F-4, D-12): `[Crash][finding related]`. After the recovery the ordinary rules apply: the first content such a `<Loading>` shows makes it a shown boundary, and a later re-ask keeps that content (F-5). The error stays up while something no inner `<Loading>` catches still waits: the errored source's own re-ask (the write above), a pending read directly under the `<Errored>` with no `<Loading>` between (a pending is not a value; #4592), or a recovery that is part of a held write, action or transition, which reveals with that hold (D-41). `Errored` builds its function fallback in its own scope, like `Show`, once per show: a re-derive of the boundary while the fallback shows — a second reader caught, the same error propagated again, a retry pending after `reset()`, a later error — keeps the built fallback, its DOM and focus with it; a later error reaches it through the error accessor; the fallback is disposed once the content that replaces it is on screen — at the commit, when the swap is held (#3991). A fallback that no live reader holds heals: the boundary waits on what threw only while a reader that caught the error is alive, so when the last one is disposed (a `<Show when={isPending(m)}>` closing over `m()` as the action that made `m` throw settles) the content shows again — what a fresh render with the same inputs shows, since nothing on it reads the error (ruled 2026-10-28, #4373).

**Collapses:** §23.1 items 2–3, §27 7b (2026-10-02; the top-level `isPending(count)` affordance was lost by this ruling, knowingly), recovery 9.1–9.3. **Status:** standing. The recovery re-arm (#4627): `tests/errored-recovery-fresh-loading-4627.test.ts`, `tests/latest-memo-inline-parity.test.ts` (#1831 rows), `packages/web/test/errored-recovery-nested-loading-4425.spec.tsx`, `tests/derived-store-recovery-wake.test.ts` (the store twin, plain and held in an action), the "inside Loading" rows of `tests/errored-recovery-stale-memo-4592.test.ts` and `packages/web/test/errored-recovery-stale-memo-4592.spec.tsx` (their no-boundary rows keep the error: a pending is not a value). A recovery written in an action's tick is the action's and keeps the error up until its hold reveals the inner fallback: the last row of `tests/errored-recovery-fresh-loading-4627.test.ts`, `packages/web/test/async-gen/e1-3289-122.spec.ts` (async-gen 3289 #122). Once per show: `tests/createErrorBoundary.test.ts` ("instantiates the fallback once per show"), `packages/web/test/errored-show-retry-3991.spec.tsx`; the held swap: `tests/boundary-fallback-held-swap-3991.test.ts`; healing when the last reader is disposed: `tests/errored-heal-disposed-reader-4373.test.ts`, `packages/web/test/errored-heal-disposed-reader-4373.spec.tsx`.

---

#### D-36 as of 2026-11-06 (archive)

##### D-36. A resting optimistic node is a plain memo

**From:** F-9, F-11.

With no active override, `createOptimistic(fn)` is observationally a `createMemo(fn)` for `read`/`latest`/`isPending` at every checkpoint of a refetch cycle — before any override and after a full cycle reverted; a revert is not a refetch and never pends.

**Collapses:** [A12](./SPEC-ASYNC-SEMANTICS.md#a12-resting-optimistic-nodes-report-pending-like-a-plain-memo), [A13](./SPEC-ASYNC-SEMANTICS.md#a13-resting-optimistic--plain-async-memo-at-every-checkpoint), V1–V3/V5. **Status:** standing.

#### D-37 as of 2026-11-06 (archive)

##### D-37. A lane sees the screen plus its own guesses and never holds a sync write

**From:** F-6, F-11, F-1.

The optimistic world is the screen plus the action's guesses: derivations of a guess publish into that world (a memo over an optimistic value shows the speculative result to the lane's readers and to direct reads, the committed one to readers off the lane — a whole frame either way). Lane work never makes its node the action's: an unrelated sync write re-running a `<Show>` over an optimistic value publishes at once and the action stays open; the frame a lane pass replaces leaves the screen when the lane's run applies, after a held lane's reveal, never before.

**Collapses:** L2 statement 4 and §19 (2026-10-01), [A17](./SPEC-ASYNC-SEMANTICS.md#a17-an-active-override-is-the-displayed-value-until-its-transaction-commits-and-the-graphs-value-until-its-own-source-answers) "lanes stage" (#3479), [A15](./SPEC-ASYNC-SEMANTICS.md#a15-transition-entanglement-is-graph-driven-lanes-settle-as-one-reveal) lane work vs transaction work (#3662, #3698), OL-R9/R31. **Status:** standing.

---

#### D-33 as of 2026-11-06 (archive)

##### D-33. An optimistic value lives exactly as long as the hold it was made over; same-slot writes entangle, disjoint slots do not

**From:** F-11. **Scenarios:** S-32.

An override's lifetime is that of the hold it was made over — in the usual shape, its own action's: the hold committing reverts (or lands the truth beneath) exactly its own writes; concurrent actions on disjoint slots — different signals, different store keys — settle independently; same-slot writes from two actions entangle, and the slot reverts only when the last of them settles. Ownership never travels through a shared reader: a render effect reading keys two actions wrote merges their reveals for scheduling, not their ownership. Regular writes in the same action hold (F-2); at the end, revert and commit are one frame.

**Collapses:** [A18](./SPEC-ASYNC-SEMANTICS.md#a18-an-override-lives-exactly-as-long-as-its-own-transaction-a-newer-truth-from-the-source-supersedes-it-in-the-graph-immediately-on-screen-at-commit) lifetime, store corollary (#2899), node corollary (#2912); OL-R6/R14–R18/R26; OS-R18–R23. **Status:** standing.

#### D-12 as of 2026-11-06 (archive)

##### D-12. An armed `<Loading>` whose mount is not held shows its fallback now; its content appears when ready

**From:** F-4, F-7, F-6. **Scenarios:** S-14, S-40.

An armed `<Loading>` catches the render effects under it that are pending (F-4) — membership is the render effect's position, not where a memo was created — whether the read is a first load, a held value, or a memo born held over one; what it catches holds nothing outside it. When the frame that mounts it is not held — a click with nothing else holding, a mainline flush, a root `render`, a mount nested under a disarmed boundary, a separate change made while another hold is up — that frame is shown now, so the fallback is seen now, and the content appears when it is ready: with that hold's commit for content that derives from a hold, at the landing for its own first load. A reader elsewhere on screen that holds the same value does not hold that frame: `save` holds `count = 1` with `Count 0 | Slow 0` on screen, and a separate `setOpen(true)` opens `<Show when={open()}><Loading>{m()}</Loading></Show>` with `m` a memo of `count` — the screen is `Count 0 | Slow 0 | open true | [fallback]`, then `Count 1 | Slow 1 | open true | count 1` at `save`'s commit (S-14). The fallback is not seen when the mounting frame is itself held: the boundary is part of the held change (D-13), or a render effect in the same branch, outside the boundary, holds it (F-2). Content under it that is bound by a render effect (`<p>{m()}</p>`) is caught the same way, so the boundary never reveals empty content. Content under it that is only loading (its own first fetch) appears at the landing, and the hold does not wait for it (F-4). A derivation _outside_ the boundary in the same flush still holds the tick (D-4). A fresh boundary whose content reads only `latest` of a held value, and nothing pending, shows that value now. A sibling that reads the unresolved async stays on the old content. The boundary does not wait for the sibling (F-6, S-40). `isPending` of the boundary's value is false: the fallback is not a value of the source. `isPending` and `latest` of the content behind it are that content's own: `latest` of a memo born held is its pending value, and `isPending` of it holds its reader as its read does — read inside the boundary, the reader is caught with the content (F-9, D-22, D-23).

**Collapses:** [A29](./SPEC-ASYNC-SEMANTICS.md#a29-a-tracked-read-served-a-live-transactions-staged-value-enters-that-transaction) boundary exemption (#3540), "A boundary that has not shown content owns its subtree" (2026-10-06) and #3824, direction rule bullet 4, B-FRESH, B-ROOT, recovery 1.1–1.4, 8.1; the dropped A35 / fuzzer MH8 (Flagged). **Status:** standing (`tests/boundary-not-born-held-3540.test.ts`; the reader's position, a memo created outside the boundary: `tests/fresh-boundary-born-held-reader.test.ts`, #3977; a memo created inside the boundary: `issue-3800-repro.test.ts`, built 2026-10-14 (U-1) — the boundary catches it and its answer is staged with the hold, which does not wait for it). Ruled 2026-09-18 (#3540: "A `Loading` mounted while a write is held shows its fallback; the hold stays with readers that have content to keep") and reaffirmed 2026-10-09. A draft of 2026-10-09 that kept the fallback off screen while any outside reader held the same value is withdrawn; so is the 2026-10-06 "fresh mount stays closed beside an outside reader" draft (withdrawn 2026-10-07).

#### D-34 as of 2026-11-06 (archive)

##### D-34. A different truth corrects the graph now and the screen at the commit; what the screen never showed is void

**From:** F-11, F-1, F-6. **Rows:** S-33, S-44. **Pins also:** `tests/spec-async-semantics.test.ts` "#3331", `tests/optimistic-question-change-4336.test.ts`, `tests/optimistic-key-guess-reask-4329.test.ts`.

When a guess's own source answers: an equal answer confirms silently; a different one corrects — derivations re-derive from the truth now as the hold's work, so downstream refetches restart at once — while the screen, untracked reads and `latest` of the displayed slot keep the guess until the commit, and a guess the screen never showed is void at the correction (S-33). A guess is an edit over the answers to the question it was written over: an answer to a new question is not its truth, and the frame that changed the input is held with the guess's hold until it commits (S-44); a `refresh()` re-asks the same question and holds nothing new. A write before a source's first answer is no guess (DEV `OPTIMISTIC_WRITE_BEFORE_LOAD`, #4656).

**Status:** standing; the `latest` clause ruled, not built (decision 3, #4689). Mechanism and history: `INTERNALS-ASYNC-STATE.md` §7, the 2026-11-06 entry.

#### D-1 as of 2026-11-06 (archive)

##### D-1. Reading a held value joins its hold

**From:** F-2, F-7, F-1. **Scenarios:** S-1, S-2.

A derivation that reads a value a hold has not yet revealed — a memo whose branch flips onto a held signal, a derived store's fold reading a held key through its draft — derives from the held world, so its result belongs to that hold and reveals with it. Tracked or untracked makes no difference (`untrack` is about dependencies, not about which world a pass derives from). A render effect is not a derivation: it reads the screen (D-3).

**Collapses:** [A29](./SPEC-ASYNC-SEMANTICS.md#a29-a-tracked-read-served-a-live-transactions-staged-value-enters-that-transaction) (read form, #3408; generalized 2026-10-01 "ruling A"), [A11](./SPEC-ASYNC-SEMANTICS.md#a11-sync-derivations-of-held-sources-are-visible-through-latestispending) (the sync derivation is visible through `latest`), L2 statement 2 "Reading the future joins it", CS-R31/#3733 (a derive reading a held key joins). **Status:** standing.

#### D-17 as of 2026-11-06 (archive)

##### D-17. A re-arm shows its fallback with the frame of the `on` pass

**From:** F-6, F-5, F-4. **Rows:** S-21, S-48, S-49. **Pins also:** `tests/loading-on-frame-following-3540.test.ts` §4–5, `tests/loading-on-rearm-3540.test.ts`, `tests/loading-on-latest-fallback-4337.test.ts`.

`on` is a dependency list: a change to anything it reads arms the boundary, and what it returns is never compared. The pass that reads it is a pass like any other. One whose every read of a held value was ahead (`latest`, `isPending`, a guess) has a frame that has landed, so the fallback shows now beside the held screen (S-21); one that read a held value plainly — a value it did not also read ahead (D-25) — is that hold's work, and the swap lands with the hold's frame (S-48; the mixed `on`, S-49, ruled 2026-11-05). What the fallback itself reads is its own display-ahead, not the swap's.

**Status:** standing; S-49 ruled, not built. Mechanism and history: `INTERNALS-ASYNC-STATE.md` §7, the 2026-11-06 entry.

#### D-9 as of 2026-11-06 (archive)

##### D-9. Entanglement is graph-driven; what shares an on-screen async derivation settles as one

**From:** F-1, F-2, F-3. **Scenarios:** S-11.

Two changes whose async work is observed by a shared on-screen derivation settle as one unit; changes on fully disjoint graphs settle independently. "Observed by a shared reader" is a pass observing the flight pending — a render effect's mere existence entangles nothing (D-3). A second flight reaching a memo another hold already holds enters that hold at the propagation, not at the memo's next pass. A reveal that _discovers_ an async already in flight — a `Show` opening onto a pending node whose inputs are already visible — joins the hold that flight blocks, as its first observer if nothing displayed it before; when the flight's inputs are themselves still held elsewhere, the reveal is a stale reader of that other hold (shows committed, entangles nothing, re-derives at its commit). A reader whose removal a hold has _staged_ is still on screen and holds for every other change until the commit removes it; a removal nothing holds releases at once. Removing a flight's last on-screen reader releases the write it held, even when a `latest()` of the flight follows.

**Collapses:** [A15](./SPEC-ASYNC-SEMANTICS.md#a15-transition-entanglement-is-graph-driven-lanes-settle-as-one-reveal) and its corollaries (#3407, #3443, #3305/#3334 reveal, #3458 first observer, #3463 zombies, #3494 through-a-memo and beside-a-release), [O3](./SPEC-ASYNC-SEMANTICS.md#o3-a-render-effect-gated-away-from-a-never-landing-flight-keeps-the-sources-write-held--fixed). **Status:** standing; fuzzer finding F2 ("a landing does not reveal a gate its stale reader re-derives onto a new flight") pinned in `tests/fuzz-findings-l2.test.ts` (built, #4071).

#### D-25 as of 2026-11-06 (archive)

##### D-25. A display-ahead read never holds the change it reads ahead of; its reader's own async holds the reader

**From:** F-6, F-1. **Rows:** S-27 (the memo case), S-29, S-50. **Pins also:** `tests/ispending-combined-atomic-3442.test.ts`, `tests/verdict-memo-held-branch-4544.test.ts`, `tests/latest-memo-inline-parity.test.ts`.

A pass's posture is decided by its own reads in that pass, never inherited from a creator or a memo it reads (#4544) and never carried into its next run. Each `latest` or `isPending` read sees the hold's world and joins nothing. A plain read of a node this pass also read ahead is the screen's: the two channels of one node agree within a scope, so `[x(), isPending(x)]` shows `[committed, true]` now in either order (A10, S-27). A plain read of any other held value makes the pass the hold's work (D-1): a mixed `on` waits (S-49), and a memo that probed on its last run and probes nothing on this one holds the tick (S-50, both ruled 2026-11-05). What is rendered from a display-ahead read waits for that read's own async, as one reveal (S-29).

**Status:** standing; S-49 and S-50 ruled, not built. The 2026-10-28 paragraph "a verdict posture outlives the pass that asked" is withdrawn: its ruled screen is D-17's, and its general clause had no pin. Mechanism and history: `INTERNALS-ASYNC-STATE.md` §7, the 2026-11-06 entry.

#### D-41 as of 2026-11-06 (archive)

##### D-41. An error is an answer: it ends the wait like a value, and it shows when a value would

**From:** F-2, F-1, F-12, D-39. **Scenarios:** S-42, S-43. **Ruled 2026-10-15** (Q-6 B, from #3886; first drafted as D-40 in #3995).

A rejection, a compute-phase throw or a comparator throw is the answer to the question its node asked. As an answer it _settles_ the async: a hold never waits on an errored flight, and nothing here changes what a hold waits for. But settled is not shown. A value that lands on a held node is staged until the frame reveals (F-2); an error that lands on a held node is staged the same way, because the error fallback is content (F-4) and showing it beside the previous frame's other content is the torn screen F-1 forbids. Until the reveal: the screen keeps what it showed, an ordinary outside read serves the committed value (it reads the screen, D-29, D-34), `createEffect`'s error arm does not run, `<Errored>` does not flip, `resolve`/`until`/`refresh` do not reject (D-31), `isPending` of it is `true`, and `latest` of it throws the proposed error — the one way to see the answer early (F-6). At the reveal the error and everything that waited with it show as one frame: the arm runs, the boundary shows its fallback, the outside read throws, `isPending` is `false`.

Recovery is the mirror (D-39): a shown error stays the display until the frame that carries its replacement reveals — through a pending retry, and through a held recovery, success or a different failure. A recovery to a value equal to the last good one is still a change of answer: payload equality never silences it, held or not.

A first load that rejects has no previous content to keep: born held (D-2), it stays loading until its frame commits, as a first load's value does; under an armed boundary it is the boundary's and shows with the boundary's frame (F-4). A derivation that reads a staged error throws it, as it would read a staged value: its own pass errors and stages with the same frame.

**What it does not say.** It does not say an error keeps a hold open. It does not say an unheld error waits: with nothing held, an error publishes at the flush that found it, like a value (S-38). It does not say `latest` hides the error. It does not change what a boundary catches (F-12), the effect arms (D-38), or the halt.

**Built 2026-10-15.** An error a held node's flight or pass finds is staged in `_pendingValue` (CONFIG_STAGED_ERROR) and committed with the frame, which publishes it through the ordinary error path; a held recovery keeps the shown error (`_shownError`) until its own commit, and a recovery equal to the last good value is a change of answer, held or not. `watch` (`resolve`, `until`, `refresh`) rejects at the landing. The duplicated immediate-publish path is gone. Pins: `tests/error-is-an-answer.test.ts`, `tests/watch-error-outcomes.test.ts` (GabbeV, #3886).

**Derived stores (closed 2026-10-30, #4489).** A derived store's (`createStore(fn)`, projections, optimistic stores) held rejection is staged like a memo's: an untracked read of its property reads the screen until the frame reveals. Pinned in `tests/error-is-an-answer.test.ts` and `tests/optimistic-held-error-untracked-read-4489.test.ts`. The standalone cases from #3886's audit (a write to a failed writable memo, error-wrapper formatting, comparator release, snapshot capture) are not this rule. **Status:** standing.

#### D-23 as of 2026-11-06 (archive)

##### D-23. `isPending(x)` is true while a new question about `x` has no committed answer

**From:** F-9, F-1. **Rows:** S-26, S-27. **Pins also:** `tests/question-scoped-pending.test.ts`, `tests/latest-isPending-consistency.test.ts`, `tests/ispending-combined-atomic-3442.test.ts`.

True while an input change is held, while `x`'s own flight for a new question is up, or while a landed answer waits in a hold; false the moment the shown value is final. A re-ask of the same question is quiet; an `affects()` mark is a declared new question; a guess is verdict-inert. A node with no answer (D-22) has no verdict: owned, the probe does what a read does — it suspends or holds; unowned, it is false (D-24). `[isPending(x), x()]` read in one scope never pairs `true` with the fresh value, in either order; the `latest` channel is judged on its own (A8, S-27).

**Status:** standing. Mechanism and history: `INTERNALS-ASYNC-STATE.md` §7, the 2026-11-06 entry.

#### D-30 as of 2026-11-06 (archive)

##### D-30. Stores: pending is per key; a derived store's seed is never visible; a declared first paint is loading

**From:** F-9, F-1. **Scenarios:** S-36, S-37.

Pending is per node — per store key: a held write to a plain store pends exactly the touched keys; a derived store's leaves report the derive's new-question refetch like any async memo, in both forms, and a quiet re-ask (`refresh(store)`) is quiet on them too. So do the leaves of a derive that is a verdict reader only through what it reads (D-25) and was served a flight's committed value: a tracked reader of them reads the flight as the memo's reader would — one that mounts mid-flight is held (F-2) and shows the flight's answer, never the old question's — and the derive computes that landing plainly, as the hold's work (D-25) (#4491, `tests/unread-derive-midflight-mount-4491.test.ts`). A derived store's landing resumes the frame that asked it: when a consumer of its leaves goes async, the landed leaves are held with that frame and read stale and pending until it reveals (signal parity); an untouched sibling key is final. A derived store's seed is a draft for the derive, never an observable value: until the first resolution (first yield for a generator) every outside read — tracked, untracked, `in`, enumeration — throws `NotReadyError` (DEV in a component body: `PENDING_ASYNC_UNTRACKED_READ`); write-path reads see it. A seedless derived store (`createStore(fn)` with a derive that takes no draft) starts from an empty record, the same unobservable draft. `loadingValue` / `seedLoadingValue` promote a first value to commit #0: reads serve it, no boundary trips, no hold starts or extends, `isPending` is `false` on every axis until the first real landing — a hydration invariant (the server always answers `false`) — after which the node is an ordinary memo.

**Collapses:** [A9](./SPEC-ASYNC-SEMANTICS.md#a9-store-leaves-behind-a-firewall-report-the-firewalls-new-question-refetch), [A22](./SPEC-ASYNC-SEMANTICS.md#a22-pending-is-per-node-store-wide-only-for-the-firewalls-own-work) (amended 2026-10-03), [A25](./SPEC-ASYNC-SEMANTICS.md#a25-a-derived-stores-seed-is-a-draft-never-an-observable-value), [A27](./SPEC-ASYNC-SEMANTICS.md#a27-the-commit-0-loading-window-is-loading-class-and-verdict-quiet), the L2 stores ruling (statement 7), OS-R30–R36, PJ-R23/R30/R31. **Status:** standing; one adoption shape pinned `it.fails` (`adoption-unchanged-key-read-3706.test.ts`, a row first read after the adoption).

## History — dated findings (§5a–§5h)

Verbatim, in original order. See "Dated findings — where they went" under §5 for which still govern.

### 5a. Findings from the first assertion run (2026-07-06)

Enabling the assertions against the existing green suite immediately produced
two findings — one real defect, one wrong assumption of mine:

- **INV-5 fired 20× — real defect (fixed).** `mergeLanes` _copied_ the merged
  lane's `_pendingAsync` and effect queues into the root but never cleared the
  originals. All routing goes through `findLane()` after a merge, so the stale
  copies were dead weight (retained node references — a leak) and made
  "merged lane is empty" unverifiable. Fixed: merge now moves instead of
  copies. This is the only production behavior change from the assertion work.
- **INV-4 as first formulated fired 83× — my assumption was wrong.** I asserted
  that at quiescence a companion `_pendingSignal` must equal a fresh
  `computePendingState(owner)`. False positive: in pure-signals graphs (no
  render effects) transitions complete immediately, so async can still be in
  flight _after_ the transition is gone; `computePendingState` then reports
  `true` while the companion (correctly, per lane semantics) still reads
  `false`. The invariant is now scoped to _fully settled_ owners (no pending
  status, no held value, no override). What the companion should read in that
  in-between window is a **semantic** question, not a consistency one — see §6.

### 5b. Findings from the second assertion pass (2026-07-06, INV-2 + window probes)

- **INV-2 implemented and green.** Active override ⇒ `_pendingValue` revert
  target + registration in a `_optimisticNodes` list, checked at the end of
  every flush. Verified the assertion actually fires via a mutation test
  (deregistering a live override throws INV-2).
- **Blocked-merged window probes** (optimistic node entangled with a second
  async source through a shared reader; own fetch resolved, transition still
  blocked) surfaced two ruled-spec violations (V1: A13 — resting optimistic
  `isPending` false where the plain control is true; V2: A7/A13 — `latest()`
  read-order dependence / `[false, undefined]`) and one new open question
  (C4: ambient reads of an active override see the committed value when
  entangled, the override when not). See SPEC-ASYNC-SEMANTICS.md "Known
  violations" (all fixed 2026-07-07; pinned in
  `tests/spec-async-semantics.test.ts`, "V1–V5" describe).
- **C4 root cause (ruled + fixed same day).** The entangled divergence was a
  premature revert, not a read-path issue: on the first flush after the write,
  `transitionComplete`'s reporter loop found no live blockers (the shared
  reader's dep is the _joined_ memo, whose dep walk doesn't reach the sources,
  and it never re-notified because the lane served it the override), and the
  optimistic-node backstop loop excluded nodes pending on **their own** fetch
  (`_error.source !== node`, from 128f5e59). The transition completed and
  `resolveOptimisticNodes` dropped the override one tick after the tracked
  reader saw it. Fix: remove the self-source exclusion — a transition holding
  an optimistic node with an active override and _any_ in-flight async
  (its own fetch included) is not complete. Ruled as A17.

### 5c. Companion-vs-oracle census (2026-07-07, #2838 pre-work)

A non-asserting diff logger (`devCensusCompanions`, enabled via the
`COMPANION_CENSUS` env var) compared every live companion against a fresh
oracle at the end of every flush across the whole suite. Nine distinct
divergence fingerprints; the taxonomy:

**Pending companions (6 fingerprints, ~most-hit first):**

| owner state at flush end                       | companion | oracle |
| ---------------------------------------------- | --------- | ------ |
| plain node, own async in flight (`sp=1`)       | false     | true   |
| ACTIVE override, revert target held            | false     | true   |
| plain node, transition-held `_pendingValue`    | false     | true   |
| store leaf (uninit) behind refetching firewall | false     | true   |
| resting optimistic, refetch in flight          | false     | true   |
| active override + own fetch in flight          | false     | true   |

**Latest shadows (3 fingerprints, all on settled-or-override owners):**

- shadow holds a stale previous value while the owner is fully settled;
- shadow reads `undefined` while the owner has a committed value (the V2
  `[false, undefined]` family);
- shadow reads `undefined` while an override is ACTIVE (A17 violation via
  `latest()`: the shadow never mirrored the override).

**The headline finding: every pending divergence is one-directional.**
Companions only ever _under-report_ (`false` when the oracle says `true`) —
no fingerprint showed a companion stuck `true` against a `false` oracle at a
flush boundary (the V4 stuck-true case exists but arises past settle, caught
by INV-4). The probe-driven design misses _activations_: nothing refreshes a
companion when (1) status flags change (async starts), (2) an override is
written, (3) a `_pendingValue` hold is written. Shadows additionally
initialize to `undefined` and never mirror overrides.

**Redesign requirement derived from the census:** the write-driven companion
must be updated at exactly four transition points — status-flag transitions
(notifyStatus/clearStatus), override set/clear, pendingValue hold/commit,
and (for shadows) initialization from the committed value + override
mirroring. Those four cover all nine fingerprints plus V1–V4.

### 5d. The redesign as landed (2026-07-07, closes #2838's core)

Companions stayed lazy and probe-created; what changed is that every oracle
input now flows through to them, and settlement re-derives them:

1. **Oracle simplification (V1).** The #2799 resting-optimistic carve-out in
   `computePendingState` was removed. INV-8 provenance proved a resting node
   can never hold a revert target (revert targets only coexist with an ACTIVE
   override; the revert commits the value), so a held value on a resting node
   is always a refetch/transition hold — pending, like a plain memo.
2. **Missing write path (V1/V2).** `asyncWrite`'s resting-hold branch now
   calls `syncCompanions` like every other write: the arriving value updates
   the verdict and is pushed into the `latest()` shadow (no more read-order
   freeze).
3. **Settlement checkpoint (V3).** `snapCompanionsToState(owner)`: called
   from `commitPendingNode` and `resolveOptimisticNodes` (second pass over
   the settled batch — the batch is spliced, not cleared, because snaps can
   push fresh optimistic nodes). It re-derives the companion from
   `computePendingState` and writes the verdict COMMITTED (not via
   `setSignal` — an override window opened at settlement would itself need a
   settlement, re-scheduling forever while async is in flight). A companion
   with an active override is skipped: its own revert re-enters the snap.
   Shadows whose cached value diverged from committed state are invalidated
   (dirty + heap + notify) so the next pull re-derives; coherent shadows are
   left alone (dirtying them re-ran effects with half-settled state).
   `_pendingSignal._parentSource` is now always the owner (was: only for
   store-leaf chains) so the checkpoint can find the owner from a reverted
   companion.
4. **Status pokes flow to the whole companion tree (V3/V4).**
   `updatePendingSignal(el)` recurses into `el._latestValueComputed` (the
   shadow's verdict derives from the owner), and `notifyStatus`/`clearStatus`
   on a firewall call `updateChildCompanions` — probed leaves re-derive when
   the firewall's async starts/settles (no more stuck-true leaf companions).
5. **A20 latest-form filter (V4).** ~~`computePendingState`'s `_parentSource`
   branch strips broad firewall inheritance for optimistic-capable leaves
   with no unconfirmed edit.~~ **Superseded by the mask model (§5f)** — the
   filter belonged to the one-day "overrides are unsettled" A20 and was
   replaced by the per-channel verdict + mask checks. The companion-poke
   plumbing from this item (point 4 above) is what survives.

Post-redesign census: **zero divergence fingerprints** across the suite
(the census itself was refined to compare the companion's _visible_ value —
override first, A17 — and to ignore one-flush holds already queued for
commit, where the A10 pair rule makes the disagreement unobservable).
Cost: +253 B gzip on `dist/prod.js` (+1.0%); core reactivity benchmarks
unchanged within noise. C2's `insertSubs` blanket lane-clear on reversion
remains queued (still unobservable; needs dead-lane plumbing).

### 5e. Revert-target elimination (2026-07-07b — A18 re-rule)

The `_pendingValue` slot used to mean three things: a plain write awaiting
flush commit, a transition-held value awaiting transition commit, and the
_revert target_ for an active override (refreshed from four write sites,
committed by `resolveOptimisticNodes` at revert). The third meaning is gone.
The invariant set is now:

- **`_pendingValue` has one meaning: a pending commit.** Every held value
  elevates to `_value` at its own transition's commit (or the plain flush
  commit), through `queuePendingNode`/`commitPendingNode` — no exceptions.
- **`_value` changes only at commit points.** Under an active override the
  hold and its eventual commit are unobservable (A17: every reader gets the
  override; the one raw-`_value` reader — the stashed-read exception — only
  admits plain optimistic signals, which have no authoritative writer).
- **Revert is a pure drop.** `resolveOptimisticNodes` clears the override,
  compares it against `_value`, notifies on divergence — commits nothing.
  Holds under an active override queue into their transition (`recompute`'s
  queue gate allows override-active nodes through; `asyncWrite`'s override
  branch collapsed into the resting branch), so nothing leaks (INV-7) and
  nothing reveals before its transition completes.
- Holds under an active override do **not** notify subscribers (`asyncWrite`
  skips `insertSubs` under an active override): the visible value is
  unchanged; the revert is the notification point.

This fixed a real clobber bug (**V5**, pinned in the spec suite): the old
first-override stash (`_pendingValue = _value`) overwrote a refetch value
held on a resting node in the blocked-merged window, so the revert
resurrected stale data. INV-2 no longer asserts a revert target; the INV-8
hold-provenance tracker was deleted (one meaning — nothing to distinguish).

An intermediate design ("silent commit": arrivals under an override write
`_value` directly, elevation immediate) was implemented and discarded — it
kept the old reveal-at-revert timing but gave `_value` a context-dependent
meaning. The commit-point discipline (maintainer re-rule of A18) reveals
corrections atomically with their own (possibly merged) transition;
corrections still _propagate_ internally on arrival, so downstream refetches
start immediately — the schedule only gates the reveal. (Verdict during the
window: under the 2026-07-13 model a held _correction_ — differing from the
displayed override — reads pending; a matching confirm stays quiet. The
2026-07-07c mask read `false` throughout; §5g.)

### 5f. The mask model (2026-07-07c — A20/A21 re-rule, #2844/#2728) — SUPERSEDED

> **SUPERSEDED 2026-07-13 by the question-scoped pending model (§5g).** The
> mask (`_optimisticMask`/`STORE_MASKED`/`maskStoreTarget`) is deleted;
> optimistic writes no longer decree certainty. Kept for the reasoning
> record — the _value_ lifecycle described here (A17/A18, holds, reveals)
> survives unchanged; only the verdicts moved.

The verdict oracle was rewritten around one rule: **an active override is
certainty by decree, and `isPending` follows the channel the read observes.**
`computePendingState` is now a short decision ladder:

1. **Disposal guard** — `REACTIVE_DISPOSED` → `false` (INV-9; a dead source
   can never settle).
2. **Store-wide mask** — `(firewall || node)._optimisticMask` → `false`
   (A21; the store is the primitive the decree covers).
3. **Latest-shadow branch** (`_parentSource` set): the fresh channel.
   Owner has an active override → `false` (the decree); owner's firewall
   masked → `false`; otherwise pending iff the owner (or its firewall) has
   `STATUS_PENDING` without `STATUS_UNINITIALIZED` — in-flight async only,
   **no held-value checks**: the shadow already shows held values, so a hold
   cannot supersede what it shows (A8: "false as soon as that async is done,
   even if the same update has other async still running").
4. **Own active override** → `false` (A20 node-scoped mask).
5. **Held store leaf defers to its firewall** — while the firewall's own
   work is in flight the firewall carries the verdict (probes collect both);
   the leaf reports only holds the firewall does not explain (manual
   projection writes; holds outliving a settled firewall). Prevents
   duplicate leaf/firewall effect churn during projection loads.
6. **Held value** (`_pendingValue`, initialized) → `true` (plain channel:
   a pending commit supersedes the committed value — A19 causes i/iii).
7. **Own async in flight** (initialized) → `true` (A19 cause ii).

Supporting machinery:

- **`maskStoreTarget(target, on)`** (store.ts): flips `STORE_MASKED` on the
  store target and maintains the firewall's `_optimisticMask` counter;
  on 0↔1 transitions pokes the firewall's companion and every probed leaf's
  (`updatePendingSignal` + `updateChildCompanions`). Raised from
  `prepareStoreWrite`/`deleteProperty` on the first optimistic write to a
  target; lowered from `clearOptimisticStore`/`clearOptimisticOverride`
  when the target's optimistic state fully clears. Plain stores without a
  firewall never set the flag.
- **Disposal snap** (owner.ts): `disposeChildren` calls
  `snapCompanionsToState` on disposed owners that have companions, so a
  latched `true` verdict reverts and notifies instead of outliving its
  source (INV-9).
- **INV-10** (invariants.ts): end-of-flush assertion of the mask, both arms
  (active-override owners and store-wide-masked firewalls/leaves), using the
  companion's _observable_ verdict (override first, A17).

Dead machinery removed with the model (verified by suite + census):

- `updatePendingSignal`'s late lane-merge block (merging a companion's
  sub-lane into the source's lane when an override cleared) — with masked
  verdicts there is no `true`→`false` edge at override-clear to coordinate;
  `mergeLanes`/`signalLanes` imports left with it.
- `read()`'s probe special-case that forced `pendingProbe.found = true` for
  firewall/override hits — verdicts now come uniformly from
  `computePendingState` over collected sources.

Cost: net −27 B raw / +8 B gzip on minified `dist/prod.js`; core reactivity
and store benchmarks flat within noise (best-of-3 isolated runs).

### 5g. Question-scoped pending (2026-07-13 — supersedes the mask, #2844/#2728)

The verdict was re-derived from one definition: **a read is pending iff a
value change is in flight for it that has not yet revealed, or it carries a
live `affects()` mark.** "In flight" is question-scoped: async whose tracked
inputs are value-stable (refresh/poll/confirm — a _re-ask_ of the same
question) is not a value change in flight — the shown answer still answers
the question being asked. Three consequences replace the mask's one rule:

1. **Same-question motion is silent.** A bare `refresh()` (or any re-ask with
   no input value change) never pends. The fresh value reveals silently. This
   absorbs the honest half of the rejected `background()` proposal without
   erasing ground truth: a _new_ question (any tracked input changed value)
   pends everything under the source until its answer reveals, and **nothing
   can silence it** — pendingness is monotone, additive-only.
2. **Optimistic writes are verdict-inert.** An active override neither reads
   pending on its own slot (it IS the displayed value; only a held
   authoritative _correction_ that differs from the override re-opens the
   verdict — a matching confirm reveals nothing) nor masks anything else. The
   store-wide mask (A21) and the node mask (A20-as-decree) are deleted: an
   override displaying over an in-flight new question is an honest mixed
   state — `{ value: guess, pending: true }`. To downstream async, an
   optimistic write is a real input change (it launches real fetches that
   pend their own slots).
3. **`affects(target, key?)` is the sole declaration verb.** A mark is
   additive pending on exactly the marked data (store record → every record
   reachable from it at declaration time, by identity — captured child
   proxies included, #2882; leaf key → that slot; accessor → that source)
   **and on everything derived from it**: marks ride the same status rails
   as real in-flight async (§ affects-on-rails below), so memos/effects over
   marked data read pending like they would over a real pending source,
   while the marked values themselves stay readable. Live from declaration
   to its transaction's settle/revert (ambient marks release at flush end).
   The declared reload idiom — `affects(x); refresh(x)` — is how process
   intent ("this work will change x") enters the verdict when the graph
   can't see it yet; the mark's own channel is never a re-ask, so the
   refresh's quiet classification cannot silence the declared window.

Verdict ladder (`computePendingState`): disposal guard → live
`_affectsCount` → latest-shadow branch (owner's `_affectsCount`, then owner
async in flight and non-quiet) → held-leaf firewall deferral (quiet firewall
flight doesn't explain a held change) → held value (correction check under
an override) → own async in flight and non-quiet. "Quiet" = every blocking
pending source is a re-ask of its own unchanged question (`quietPending`,
reading `_reask`).

Supporting machinery:

- **Re-ask classification.** `refresh()` sets `REACTIVE_REASK` unless the
  node already carries value-change dirt (DIRTY/CHECK **or heap membership —
  `insertSubs` schedules by heap insertion alone**); `insertSubs` clears the
  flag on every value-change notification (a new question supersedes the
  re-ask); `recompute` consumes it into `_reask` with a monotone guard (a
  node already pending on an unanswered new question stays non-quiet);
  `clearStatus` resets it on landing. When a reask classification changes
  while pending, `repollDownstreamVerdicts` re-derives companions downstream.
- **Affects on rails** (async.ts/scheduler.ts): a mark is a synthetic
  in-flight change on the normal status rails, under its own **sentinel**
  pending-source (`getAffectsSentinel`, one per marked node, branded with
  `_affectsFor`). `registerAffectsMark` bumps `_affectsCount`, stages the
  registration with the current transaction (ambient registrations are
  adopted by `initTransition`, merged by `mergeTransitionState`, mirroring
  `_optimisticNodes`), pokes the node's companions, and **propagates
  `STATUS_PENDING` downstream** from the marked node via `notifyStatus` with
  a `NotReadyError(sentinel)` — so downstream verdicts derive from the
  ordinary `newQuestionInFlight` clause. The separate identity is what keeps
  the channels from clearing each other: a landing on the marked node
  settles only the node's OWN source entry (`settlePendingSource` is
  source-parameterized); `quietPending` never reports quiet while a sentinel
  is among the sources (its `_reask` is permanently false), so a declared
  reload survives its refresh's quiet classification; and neither
  `transitionComplete` check counts a sentinel-sourced pending as a blocker
  (`_affectsFor` brand) — a mark releases AT settle, so self-blocking would
  deadlock. The marked node itself never carries `STATUS_PENDING` (marks
  are value-transparent at the source; its own verdict is the
  `_affectsCount` clause), and **mark-only pending is value-transparent
  through derivation too** (#2886): `read()` skips the suspension branch
  when the owner's pending sources are all sentinels (`onlyMarkPending`,
  gated by `activeAffectsMarks`), so a live tracked reader over mark-pended
  derived nodes — a `mapArray` over a marked store — keeps rendering fresh
  optimistic values instead of throwing. Computeds that recompute mid-window shed the
  sentinel via `clearStatus` and re-acquire it through the read path:
  `read()` records marked sources into the recompute's `affectsReads`
  accumulator (gated by the global `activeAffectsMarks` counter; probe
  reads excluded so an `isPending` wrapper memo doesn't mark itself), and
  `recompute` applies them after its commit (`applyAffectsReads` — earlier
  would route the fresh value into the error-skip branch). Re-acquisition
  is **transitive** (#2893 bug 3): value-transparency removed real async's
  re-throw-on-read (the mechanism that re-establishes a source at every
  derivation level), so a tracked read of a mark-pended _owner_ also feeds
  the reader's `affectsReads` — `collectMarkSources` maps the owner's
  sentinel sources back to their still-live `_affectsFor` nodes. Without
  this, pendingness died on the first mid-window recompute past depth one,
  and the `isPending()` probe itself (whose prepare step recomputes
  retryable NotReady holders) stripped the status it was reporting on.
  Propagation is **transaction-inert** (#2893 bug 2): pended subscribers
  are NOT queued as pending nodes — they hold no value needing a
  transition-scheduled commit, and queueing stamped the marking action's
  transaction onto them at stash, from which point ANY write dirtying one
  (a plain write to the marked signal, or to an unmarked signal merely
  sharing a downstream memo) was captured and frozen until the action
  settled. Same rule at recompute: mark-only `STATUS_PENDING` doesn't
  count toward `needsPendingCommit`. A **real error outranks a mark**
  (#2893 bug 4): `notifyStatus` drops mark-sourced propagation onto nodes
  holding `STATUS_ERROR`, and `recompute` skips `applyAffectsReads` when
  the compute ended errored — landing the sentinel would clobber `_error`
  with a `NotReadyError` that value-transparency promises can never
  surface, with no arriving value to ever restore the user's error.
  `releaseAffectsMark` decrements at the transaction's settle (or plain
  flush end for ambient marks), settles the sentinel out of every
  downstream `_pendingSources` (waking `_blocked` nodes), and snaps
  companions through the settlement checkpoint (committed, not
  transition-scoped — the settle walk snaps too, for the same reason).
  (The settle walk is also why `addPendingSource`'s container migration
  must check BOTH slots — #2893 bug 1: a third source landing in the
  emptied singular slot next to the Set put `removePendingSource` into a
  refusal state that stranded the Set's sentinels forever, `isPending`
  stuck `true` — deterministically hit by a keyless store mark over
  `mapArray`, whose internal computed subscribes to exactly three covered
  nodes.)
- **Store addressing** (store.ts): `affects(record)` upserts a per-record
  `$AFFECTS` node (the mark's carrier — registry key and liveness anchor),
  walks the record's subtree — reading through write overlays — registering
  the mark on **every live node** in it (property leaves, `$TRACK`,
  has-nodes: the edges existing readers subscribed through), and snapshots
  the reachable raw identities into the mark's scope (`affectsScopes`,
  released with the carrier's last registration). Nodes created during the
  window inherit the mark at birth (`getNode` → `inheritAffectsMarks`, keyed
  by the owning record's raw identity; inherited marks are released with the
  carrier's entry), which is how captured child proxies (`<For>` rows,
  #2882) and late tracked reads observe a mark their read path never
  traverses. `affects(record, key)` marks the named leaf node (single key —
  keys are not a path). Witnessing (`witnessAffectsMark`, pendingCheckActive
  traps + the `snapshot`/`deep` walk in utils.ts) now only covers untracked
  probes over records whose nodes never materialized: it adds the record's
  own `$AFFECTS` carrier and any scope carrier containing the record's raw
  to the probe. Tracked probes need none of this — they read real nodes,
  which carry marks directly. The per-node companion channel (not a shared
  version signal) is load-bearing for wake-ups: companions carry their own
  optimistic lane, which is what lets a late registration's wake escape an
  incomplete transition's effect stash.
- **Probe rethrow scope** (core.ts `isPending`): only a truly UNINITIALIZED
  source's NotReady rethrows out of the probe (loading participates in
  readiness); an initialized source throwing NotReady during a quiet re-ask
  window yields an honest `false` instead of poisoning the surrounding memo.
- **INV-10** (invariants.ts): affects-count balance at quiescence (§5).

The trade taken knowingly (the "silent unknowns" objection): a re-ask that
_will_ return different data (server-side change, poll catching motion) is
silent until the new value reveals — the system cannot know, and the model
prefers honest silence over blanket alarm. The escape hatch is declarative:
whoever knows the work matters declares `affects`. What the mask model
answered with entangled decrees ("the store is the boundary") this model
answers with slot-scoped facts and slot-scoped declarations; the foos bug
and list over-lighting both fall out (an optimistic increment can't silence
an unrelated in-flight navigation; an optimistic list add doesn't pend
sibling rows because the confirm refresh is a quiet re-ask).

### 5h. Seed invisibility on derived stores (2026-07-16 — A25, #2897)

A derived store's seed is a draft for the derive function, never a value an
outside reader may observe. Memos already enforced this (untracked reads of
an UNINITIALIZED node throw NotReady out of `read()`; strictRead scopes get
the `PENDING_ASYNC_UNTRACKED_READ` dev error first), but the store proxy's
untracked fall-throughs bypassed `read()` entirely — `get` returned the raw
seed value, `has`/`ownKeys` leaked its structure.

The guard is `throwIfUninitialized(target)` (store.ts): if the target's
`STORE_FIREWALL` carries `STATUS_UNINITIALIZED`, throw `firewall._error ??
new NotReadyError(firewall)`. Placement in the three read traps:

- **get** — untracked fall-through only, after the dev strictRead checks
  (the `PENDING_ASYNC_UNTRACKED_READ` error wins in component bodies for
  the more descriptive message / infinite-loop prevention). Tracked reads
  already throw through their node in `read()`. `selfRead` (observer IS the
  firewall — the derive function working its own draft) is exempt: that is
  what the seed is for. `writeOnly` paths return before the guard.
- **has** — untracked fall-through; `writeOnly`/`selfRead` early-return
  above the guard.
- **ownKeys** — untracked and not `writeOnly` (reconcile's enumeration
  during the first landing IS the initialization and must see the draft).

The window closes when `STATUS_UNINITIALIZED` clears: first resolution for
promise derives, **first yield landing** for async-iterator derives — later
yields are revealed snapshots, readable between yields while the generator
keeps running. Supersession keeps the window open (a discarded stale yield
lands nothing). Rejected alternatives: returning the seed (leaks a value the
reader can never observe updating), returning `undefined` (breaks
non-nullable types).
