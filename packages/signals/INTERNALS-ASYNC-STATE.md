# Async/Transition/Lane State Model — Working Notes

Living document for the pending/transition/optimistic-lane machinery in
`src/core/`. Captures the state model, the invariants we believe hold (with
confidence levels), and the assumptions/decisions made while reviewing. The
companion spec propositions (tier A/B/C) build on this.

Status: **working notes** — updated as understanding is verified. Anything
marked `[assumed]` has been inferred from code, not confirmed by a design
ruling. Anything marked `[ruled]` cites the decision.

## 1. Node state fields

A `Signal`/`Computed` participating in async/transitions carries:

| Field | Meaning | Written by |
| --- | --- | --- |
| `_value` | Committed, visible value | `recompute` (create/effect paths), `commitPendingNode`, `resolveOptimisticNodes`, `asyncWrite` (lane branch) |
| `_pendingValue` | Transition-held next value; `NOT_PENDING` sentinel when absent (one meaning — a pending commit; revert targets were eliminated 2026-07-07b, §5e) | `setSignal` (non-optimistic), `recompute` (held branch), `asyncWrite` (override-active branch) |
| `_overrideValue` | Optimistic override; `undefined` = not an optimistic node, `NOT_PENDING` = resting optimistic node, else = active override. A user write of literal `undefined` is stored as the `OVERRIDE_UNDEFINED` stand-in so it can't erase the brand (#2898); sites surfacing the override VALUE unwrap via `unwrapOverride`, slot identity tests stay raw | `setSignal` (optimistic branch), `recompute` (lane-corrected), `resolveOptimisticNodes` (clears to `NOT_PENDING`) |
| `_affectsCount` | Live `affects()` mark refcount: non-zero forces the node's verdict to `true` and propagates pending downstream via the node's sentinel (declared motion, §5g). Carried by source nodes, store leaf/track/has nodes, and per-record `$AFFECTS` carriers | `registerAffectsMark`/`markAffects` (+1, staged with the current transaction or a scope entry), `releaseAffectsMark` (−1 at settle / flush end; settles the sentinel when the count zeroes) |
| `_affectsSentinel` | The mark's identity on the pending-source rails (lazy): held in downstream `_pendingSources` like a real in-flight source, never a re-ask, never self-pending, branded with `_affectsFor` so settlement checks skip it | `getAffectsSentinel` (async.ts) |
| `_reask` | Question-scoped classification of the CURRENT pending window: `true` = the in-flight recompute is a re-ask of the same question (refresh with no input value change) — quiet, not pending (§5g). Meaningless while not `STATUS_PENDING` | `recompute` (from the `REACTIVE_REASK` flag), cleared by `clearStatus` and by value-change notifications (`insertSubs` clears the flag pre-recompute) |
| `_loading` | Open commit-#0 loading window (`[ruled]` A27): the node was born committed with a `loadingValue`/`seedLoadingValue` and its first real answer hasn't landed. While set, `handleAsync` serves `_value` instead of throwing `NotReadyError`, no transition is initiated or joined, and the verdict path never consults it (quiet by construction — the flag is invisible to `newQuestionInFlight`). Cleared by the first landing on any path (sync return in `recompute`, sync-resolved thenable, first iterator yield, `asyncWrite` settle); a real error leaves it set — errors answer reads but don't enter the lineage, so a retry serves commit #0 again | `computed()` (set at birth), `recompute`/`handleAsync`/`asyncWrite` (cleared on landing) |
| `_statusFlags` | `STATUS_PENDING` / `STATUS_ERROR` / `STATUS_UNINITIALIZED` | `notifyStatus`, `clearStatus`, commit paths |
| `_error` | Current error (`NotReadyError` for pending, `StatusError`-wrapped for real) | compute catch, `notifyStatus` |
| `_pendingSignal` | Lazily-created companion: boolean "is pending" signal for `isPending()` | `getPendingSignal`, updated via `updatePendingSignal` |
| `_latestValueComputed` | Lazily-created companion: shadow computed for `latest()` | `getLatestValueComputed`, written via `syncCompanions` |
| `_parentSource` | Companion → owner backlink (also store leaf → firewall chains) | companion creation |
| `_optimisticLane` | Lane this node currently belongs to | `assignOrMergeLane`, cleared by `resolveLane` (stale), `resolveOptimisticNodes`, `cleanupCompletedLanes` |
| `_transition` | Transition holding this node's pending state | `initTransition`, `reassignPendingTransition`, cleared by `resolveOptimisticNodes` |

Semantics of the `(_pendingValue, _overrideValue)` pair for an optimistic node
(see §5e — revert targets were eliminated 2026-07-07):

- `(NOT_PENDING, NOT_PENDING)` — resting optimistic node, behaves like a plain node.
- `(NOT_PENDING, active value)` — active override; readers see the override, `_value` is untouched.
- `(held value, active value)` — fresh authoritative value arrived while the override displays;
  it holds in `_pendingValue` and elevates to `_value` on its own transition's commit. Reverting
  is a pure drop of the override — `_value` is already correct. (Verdict: pending iff the held
  value *differs* from the displayed override — a matching confirm reveals nothing; §5g.)

## 2. Lanes (`lanes.ts`)

- One lane per optimistic *source signal* (`signalLanes` WeakMap), reused across writes to the same signal. Union-find merging (`_mergedInto`); merges move `_pendingAsync` and effect queues into the root.
- `_parentLane`: companion nodes (`_pendingSignal`/`_latestValueComputed`) get *child* lanes that intentionally do **not** merge with the parent (`assignOrMergeLane` parent/child carve-out) so `isPending` effects can flush before the parent's async settles.
- Lane lifecycle: created on optimistic write → nodes join via `insertSubs(node, true)` → `assignOrMergeLane` → lane-routed effects run when `_pendingAsync` is empty (`runLaneEffects`) → cleaned up by `cleanupCompletedLanes` when the owning transition completes (or when orphaned, `_transition === null`).
- `_pendingAsync` add/delete sites: added in `recompute`'s async catch under a lane (core.ts ~264), removed on async resolution (`asyncWrite`, async.ts ~214) and on lane-corrected recompute (core.ts ~254).

## 3. Transitions (`scheduler.ts`)

- Created by `initTransition` on the first transition-worthy write; at most one `activeTransition` per flush; concurrent ones merge (`mergeTransitionState`, `_done` forwarding pointer).
- `initTransition` ends by scheduling a flush: the ambient window is one flush by definition, but parking is flush-driven, so a transaction opened with no writes (an action that only awaits) would otherwise leave `activeTransition` and the adopted batch armed across the async gap, capturing the next unrelated work to arrive — the A26-rejected behavior (#3141).
- `_asyncReporters: Map<source, Set<reporter>>` — which computeds are blocked on which async sources. **Populated only from `GlobalQueue.notify` during render-effect status notification** `[ruled — async-registration-invariants rule]`.
- `_pendingNodes` — nodes whose `_pendingValue` commits when the transition completes (`commitPendingNodes` → `commitPendingNode`).
- `_optimisticNodes` — nodes whose override reverts at completion (`resolveOptimisticNodes`).
- Incomplete-transition flush stashes queues (`stashQueues`) and continues with a fresh view; completion restores them, commits pending, reverts optimistic, replays `_gatedSubs`, cleans lanes.
- `transitionComplete`: prunes dead reporters (`reporterBlocksSource`), transition is done when no live reporter still blocks a pending source and no active-override node is blocked on someone else's async.

## 4. Write paths (all must stay equivalent)

Every path that produces a value for a node must maintain the companions via
`syncCompanions` `[ruled — #2831 fix]`:

1. `setSignal` — direct write (line ~1033).
2. `asyncWrite` — async resolution, four branches: setter / override-active / lane-routed / plain `setSignal` fallback.
3. `recompute` — transition-held sync derivation (line ~334, `activeTransition || el._transition` guard).

Comparator (`_equals`) errors on any of these paths are node errors, routed
through `notifyStatus(STATUS_ERROR)` `[ruled — #2837]`. `setSignal` checks
`STATUS_UNINITIALIZED` *before* invoking the comparator so a user comparator
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
- **INV-2 (high)** A node with an *active* override (`hasActiveOverride`) is
  registered in a transition's/queue's `_optimisticNodes`. (The original
  revert-target half was retired with §5e — there is no revert target to
  assert.)
- **INV-3 (high)** `_asyncReporters` gains entries only inside
  `GlobalQueue.notify` (render-effect notification path). Guard flag around the
  legal write site; assert on any other mutation. `[ruled]`
- **INV-4 (medium)** After any of the three write paths completes for node `el`
  with value `v`: if `el._pendingSignal` exists it reflects
  `computePendingState(el)`, and if `el._latestValueComputed` exists its signal
  value is `v` (companion coherence, #2831).
- **INV-5 (medium)** A lane in `activeLanes` has `_mergedInto === null`
  (merged lanes must be removed or never enumerated as roots) — note:
  `cleanupCompletedLanes` iterates `activeLanes` and checks `_mergedInto`,
  so today merged lanes *do* linger in `activeLanes`; the invariant is that
  they are skipped everywhere. Assert the weaker form: a merged lane's
  `_pendingAsync` and `_effectQueues` are empty (moved on merge).
- **INV-6 (medium)** At the end of a completing-transition flush: every node in
  the completed transition's `_optimisticNodes` has `_overrideValue === NOT_PENDING`
  and `_transition === null`; the transition's lanes are gone from `activeLanes`.
- **INV-7 (medium)** `_pendingValue !== NOT_PENDING` on a non-optimistic node
  implies the node is queued (`_pendingNode`/`_pendingNodes`) or held by a
  transition — a pending value with no committer is a leak (the #2827 class).
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

Rejected for assertion (state space too dynamic, would need semantic rulings):
whether `_optimisticLane` must always resolve to a live lane (stale lanes are
legal and lazily cleared by `resolveLane`).

## 5a. Findings from the first assertion run (2026-07-06)

Enabling the assertions against the existing green suite immediately produced
two findings — one real defect, one wrong assumption of mine:

- **INV-5 fired 20× — real defect (fixed).** `mergeLanes` *copied* the merged
  lane's `_pendingAsync` and effect queues into the root but never cleared the
  originals. All routing goes through `findLane()` after a merge, so the stale
  copies were dead weight (retained node references — a leak) and made
  "merged lane is empty" unverifiable. Fixed: merge now moves instead of
  copies. This is the only production behavior change from the assertion work.
- **INV-4 as first formulated fired 83× — my assumption was wrong.** I asserted
  that at quiescence a companion `_pendingSignal` must equal a fresh
  `computePendingState(owner)`. False positive: in pure-signals graphs (no
  render effects) transitions complete immediately, so async can still be in
  flight *after* the transition is gone; `computePendingState` then reports
  `true` while the companion (correctly, per lane semantics) still reads
  `false`. The invariant is now scoped to *fully settled* owners (no pending
  status, no held value, no override). What the companion should read in that
  in-between window is a **semantic** question, not a consistency one — see §6.

## 5b. Findings from the second assertion pass (2026-07-06, INV-2 + window probes)

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
  reader's dep is the *joined* memo, whose dep walk doesn't reach the sources,
  and it never re-notified because the lane served it the override), and the
  optimistic-node backstop loop excluded nodes pending on **their own** fetch
  (`_error.source !== node`, from 128f5e59). The transition completed and
  `resolveOptimisticNodes` dropped the override one tick after the tracked
  reader saw it. Fix: remove the self-source exclusion — a transition holding
  an optimistic node with an active override and *any* in-flight async
  (its own fetch included) is not complete. Ruled as A17.

## 5c. Companion-vs-oracle census (2026-07-07, #2838 pre-work)

A non-asserting diff logger (`devCensusCompanions`, enabled via the
`COMPANION_CENSUS` env var) compared every live companion against a fresh
oracle at the end of every flush across the whole suite. Nine distinct
divergence fingerprints; the taxonomy:

**Pending companions (6 fingerprints, ~most-hit first):**

| owner state at flush end | companion | oracle |
| --- | --- | --- |
| plain node, own async in flight (`sp=1`) | false | true |
| ACTIVE override, revert target held | false | true |
| plain node, transition-held `_pendingValue` | false | true |
| store leaf (uninit) behind refetching firewall | false | true |
| resting optimistic, refetch in flight | false | true |
| active override + own fetch in flight | false | true |

**Latest shadows (3 fingerprints, all on settled-or-override owners):**

- shadow holds a stale previous value while the owner is fully settled;
- shadow reads `undefined` while the owner has a committed value (the V2
  `[false, undefined]` family);
- shadow reads `undefined` while an override is ACTIVE (A17 violation via
  `latest()`: the shadow never mirrored the override).

**The headline finding: every pending divergence is one-directional.**
Companions only ever *under-report* (`false` when the oracle says `true`) —
no fingerprint showed a companion stuck `true` against a `false` oracle at a
flush boundary (the V4 stuck-true case exists but arises past settle, caught
by INV-4). The probe-driven design misses *activations*: nothing refreshes a
companion when (1) status flags change (async starts), (2) an override is
written, (3) a `_pendingValue` hold is written. Shadows additionally
initialize to `undefined` and never mirror overrides.

**Redesign requirement derived from the census:** the write-driven companion
must be updated at exactly four transition points — status-flag transitions
(notifyStatus/clearStatus), override set/clear, pendingValue hold/commit,
and (for shadows) initialization from the committed value + override
mirroring. Those four cover all nine fingerprints plus V1–V4.

## 5d. The redesign as landed (2026-07-07, closes #2838's core)

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
(the census itself was refined to compare the companion's *visible* value —
override first, A17 — and to ignore one-flush holds already queued for
commit, where the A10 pair rule makes the disagreement unobservable).
Cost: +253 B gzip on `dist/prod.js` (+1.0%); core reactivity benchmarks
unchanged within noise. C2's `insertSubs` blanket lane-clear on reversion
remains queued (still unobservable; needs dead-lane plumbing).

## 5e. Revert-target elimination (2026-07-07b — A18 re-rule)

The `_pendingValue` slot used to mean three things: a plain write awaiting
flush commit, a transition-held value awaiting transition commit, and the
*revert target* for an active override (refreshed from four write sites,
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
corrections still *propagate* internally on arrival, so downstream refetches
start immediately — the schedule only gates the reveal. (Verdict during the
window: under the 2026-07-13 model a held *correction* — differing from the
displayed override — reads pending; a matching confirm stays quiet. The
2026-07-07c mask read `false` throughout; §5g.)

## 5f. The mask model (2026-07-07c — A20/A21 re-rule, #2844/#2728) — SUPERSEDED

> **SUPERSEDED 2026-07-13 by the question-scoped pending model (§5g).** The
> mask (`_optimisticMask`/`STORE_MASKED`/`maskStoreTarget`) is deleted;
> optimistic writes no longer decree certainty. Kept for the reasoning
> record — the *value* lifecycle described here (A17/A18, holds, reveals)
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
  companion's *observable* verdict (override first, A17).

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

## 5g. Question-scoped pending (2026-07-13 — supersedes the mask, #2844/#2728)

The verdict was re-derived from one definition: **a read is pending iff a
value change is in flight for it that has not yet revealed, or it carries a
live `affects()` mark.** "In flight" is question-scoped: async whose tracked
inputs are value-stable (refresh/poll/confirm — a *re-ask* of the same
question) is not a value change in flight — the shown answer still answers
the question being asked. Three consequences replace the mask's one rule:

1. **Same-question motion is silent.** A bare `refresh()` (or any re-ask with
   no input value change) never pends. The fresh value reveals silently. This
   absorbs the honest half of the rejected `background()` proposal without
   erasing ground truth: a *new* question (any tracked input changed value)
   pends everything under the source until its answer reveals, and **nothing
   can silence it** — pendingness is monotone, additive-only.
2. **Optimistic writes are verdict-inert.** An active override neither reads
   pending on its own slot (it IS the displayed value; only a held
   authoritative *correction* that differs from the override re-opens the
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
  derivation level), so a tracked read of a mark-pended *owner* also feeds
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
*will* return different data (server-side change, poll catching motion) is
silent until the new value reveals — the system cannot know, and the model
prefers honest silence over blanket alarm. The escape hatch is declarative:
whoever knows the work matters declares `affects`. What the mask model
answered with entangled decrees ("the store is the boundary") this model
answers with slot-scoped facts and slot-scoped declarations; the foos bug
and list over-lighting both fall out (an optimistic increment can't silence
an unrelated in-flight navigation; an optimistic list add doesn't pend
sibling rows because the confirm refresh is a quiet re-ask).

## 5h. Seed invisibility on derived stores (2026-07-16 — A25, #2897)

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
  optimistic overlay: writing another store's optimistic *guesses* into a
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
  carve-out removal reverses the #2799 *mechanism* while preserving its
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
  node kind): overrides mask stale *content* (A17), not *settlement* — the
  community no-extra-boolean idioms depend on it. Non-derived optimistic
  signals/stores are transaction-scoped values, not predictions (no source can
  confirm them; reversion is certain), so they are pending for the override's
  whole lifetime. (2) An optimistic write pends exactly the leaves it touched
  (known change set); a refetch pends every read of the store (unbounded
  change set) — broadness is what unbounded uncertainty looks like, not a
  store rule. (3) Three-form algebra: `latest` strips *coordination*
  (transition holds, broad firewall inheritance) and nothing strips
  *confirmation* (own async in flight, active override) — so the latest form
  is the "unconfirmed edit?" discriminator on store leaves, and is identical
  to the plain form on standalone self-async nodes (A8): `latest`
  discriminates *whose* unsettledness you read, never *why*. An alternative
  ("override = settled latest view → latest form as pure reload detector")
  was considered and set aside: it makes the unconfirmed-edit question
  inexpressible in any form and breaks the published community idioms, while
  its reload-only question is already answered by scoping reads at
  triggers/sources. NOTE the no-contradiction result that settled the ruling:
  the "optimism guards against pending" pattern (News/Finance) is downstream
  value-shielding — the override stops *invalidation* from cascading, so a
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
  throws escalate to boundary/halt. Compute-phase errors in *user* effects
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
